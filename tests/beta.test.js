// SEREN MVP — private beta gate tests.
// Spins up the real express app with BETA_CODE set and an isolated temp
// SQLite DB; verifies the gate blocks API data until the code is entered.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const dir = mkdtempSync(join(tmpdir(), 'seren-beta-'));
process.env.DB_PATH = join(dir, 'beta-test.db');
process.env.SEED_DEMO = 'false';
process.env.BETA_CODE = 'test-beta-code-123';

// Dynamic import so BETA_CODE is honored at server-module load time.
const { app, db } = await import('../src/server.js');

const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const BASE = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try { db.close(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true });
});

async function req(method, path, { body, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }
  return { res, data };
}

function profileBody() {
  return {
    name: 'Beta Tester',
    email: `beta${Math.random().toString(36).slice(2)}@example.com`,
    interests: ['meditation'],
    intention: 'Testing the private beta gate with a valid intention string.',
    connectionPrefs: { seeking: ['friendship'], availability: 'Evenings' },
    consents: { introductions: true, community_visible: true, ai_matching: true },
  };
}

test('health check stays open in beta mode', async () => {
  const { res, data } = await req('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.equal(data.status, 'ok');
});

test('beta status reports locked state without a cookie', async () => {
  const { res, data } = await req('GET', '/api/beta/status');
  assert.equal(res.status, 200);
  assert.equal(data.beta, true);
  assert.equal(data.entered, false);
});

test('API data is blocked without a beta cookie', async () => {
  const { res, data } = await req('GET', '/api/profiles');
  assert.equal(res.status, 403);
  assert.equal(data.error.code, 'beta_required');
});

test('profile creation is blocked without a beta cookie', async () => {
  const { res, data } = await req('POST', '/api/profiles', { body: profileBody() });
  assert.equal(res.status, 403);
  assert.equal(data.error.code, 'beta_required');
});

test('wrong beta code is rejected', async () => {
  const { res, data } = await req('POST', '/api/beta/enter', { body: { code: 'nope' } });
  assert.equal(res.status, 403);
  assert.equal(data.error.code, 'beta_code_invalid');
});

test('correct beta code issues a cookie that unlocks the API', async () => {
  const entered = await req('POST', '/api/beta/enter', { body: { code: 'test-beta-code-123' } });
  assert.equal(entered.res.status, 200);
  assert.equal(entered.data.entered, true);
  const setCookie = entered.res.headers.get('set-cookie');
  assert.ok(setCookie && setCookie.includes('seren_beta='));
  assert.ok(setCookie.includes('HttpOnly'));
  const cookie = setCookie.split(';')[0];

  const status = await req('GET', '/api/beta/status', { cookie });
  assert.equal(status.data.beta, true);
  assert.equal(status.data.entered, true);

  const created = await req('POST', '/api/profiles', { body: profileBody(), cookie });
  assert.equal(created.res.status, 201);
  assert.ok(created.data.id);

  const listed = await req('GET', '/api/profiles', { cookie });
  assert.equal(listed.res.status, 200);
  assert.ok(Array.isArray(listed.data.profiles));
});

test('static app shell still loads without a cookie so the gate can render', async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('id="main"'));
});
