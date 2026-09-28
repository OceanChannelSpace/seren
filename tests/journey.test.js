// SEREN MVP — end-to-end journey with REAL server restarts.
// Verifies that a profile and an accepted introduction persist across process
// restarts, and that seed members are not duplicated when the DB already exists.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function waitForListening(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`server did not start within ${timeoutMs}ms; output: ${out}`));
    }, timeoutMs);
    const onData = (d) => {
      out += String(d);
      if (/listening on port/.test(out)) { cleanup(); resolve(); }
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`server exited before listening (code=${code} signal=${signal}); output: ${out}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('exit', onExit);
    };
    child.stdout.on('data', onData);
    child.once('exit', onExit);
  });
}

async function startServer(port, dbPath) {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, SEED_DEMO: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForListening(child, 15000);
  return child;
}

async function stopServer(child, timeoutMs = 10000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const result = await Promise.race([
    exited.then(() => 'exited'),
    new Promise((r) => setTimeout(() => r('timeout'), timeoutMs)),
  ]);
  if (result === 'timeout') child.kill('SIGKILL');
  await exited;
}

async function api(base, method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, json };
}

test('full user journey persists across real server restarts', { timeout: 90000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'seren-journey-'));
  const dbPath = join(dir, 'journey.db');
  const port = await freePort();
  let child = null;
  const killChild = async () => {
    const c = child;
    child = null;
    await stopServer(c);
  };

  try {
    // --- first server instance (seeds the demo members) ---
    child = await startServer(port, dbPath);
    const base = `http://127.0.0.1:${port}`;

    const health = await api(base, 'GET', '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.status, 'ok');
    assert.equal(health.json.seeded, true);

    // (a) create a profile via the API
    const created = await api(base, 'POST', '/api/profiles', {
      name: 'Journey Tester',
      email: 'journey@example.com',
      interests: ['meditation', 'breathwork'],
      intention: 'I want a breathwork buddy to practice with every Sunday morning.',
      connectionPrefs: { seeking: ['practice-partner'], availability: 'Sunday mornings' },
      consents: { introductions: true, community_visible: true, ai_matching: true },
    });
    assert.equal(created.status, 201);
    const profileId = created.json.id;

    // (b) request an introduction → accept it
    const reqIntro = await api(base, 'POST', '/api/introductions/request', {
      requesterId: profileId,
      intention: 'I want a breathwork buddy to practice with every Sunday morning.',
    });
    assert.equal(reqIntro.status, 201);
    const introId = reqIntro.json.introduction.id;
    const proposedId = reqIntro.json.proposed.id;
    assert.notEqual(proposedId, profileId, 'introduction proposes someone else');

    const accepted = await api(base, 'POST', `/api/introductions/${introId}/accept`);
    assert.equal(accepted.status, 200);
    assert.equal(accepted.json.status, 'accepted');

    // (c) kill the server
    await killChild();
    assert.equal(child, null);

    // (d) start a NEW server process on the same DB_PATH
    child = await startServer(port, dbPath);
    const base2 = `http://127.0.0.1:${port}`;

    // (e) the profile and the accepted introduction persisted with correct statuses
    const got = await api(base2, 'GET', `/api/profiles/${profileId}?viewerId=${profileId}`);
    assert.equal(got.status, 200);
    assert.equal(got.json.name, 'Journey Tester');
    assert.equal(got.json.email, 'journey@example.com');
    assert.deepEqual(got.json.interests, ['meditation', 'breathwork']);

    const inbox = await api(base2, 'GET', `/api/introductions?profileId=${profileId}`);
    assert.equal(inbox.status, 200);
    const persisted = inbox.json.introductions.find((i) => i.id === introId);
    assert.ok(persisted, 'accepted introduction still listed after restart');
    assert.equal(persisted.status, 'accepted');
    assert.equal(persisted.requesterId, profileId);
    assert.equal(persisted.proposedId, proposedId);
    assert.ok(persisted.note.length > 0);
    assert.equal(typeof persisted.score, 'number');

    // (f) seed members were NOT duplicated on restart
    const all = await api(base2, 'GET', '/api/profiles');
    assert.equal(all.status, 200);
    const seeds = all.json.profiles.filter((p) => p.isSeed);
    assert.equal(seeds.length, 6, 'exactly 6 seed members after restart');
    assert.equal(all.json.profiles.length, 7, '6 seeds + 1 user profile, nothing duplicated');
    const seedNames = new Set(seeds.map((p) => p.name));
    assert.equal(seedNames.size, 6, 'seed member names are unique');
  } finally {
    await killChild();
    rmSync(dir, { recursive: true, force: true });
  }
});
