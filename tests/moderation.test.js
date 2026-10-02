// SEREN MVP — host moderation tests.
// The report queue is host-only: SEREN_HOSTS (env, comma-separated emails)
// marks host profiles. Non-hosts get 403 everywhere; hosts can list,
// dismiss, and hide reported profiles.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const dir = mkdtempSync(join(tmpdir(), 'seren-mod-'));
process.env.DB_PATH = join(dir, 'mod-test.db');
process.env.SEED_DEMO = 'false';
process.env.BETA_CODE = 'mod-test-beta-code';
process.env.SEREN_HOSTS = 'host@example.com, second.host@example.com ';

const { app, db } = await import('../src/server.js');

const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const BASE = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try { db.close(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true });
});

// ---------- helpers ----------

let emailSeq = 0;
const uniqueEmail = (base = 'modtester') => `${base}${++emailSeq}@example.com`;

function profileBody(name, email) {
  return {
    name,
    email,
    interests: ['meditation', 'yoga'],
    intention: 'I want to find a meditation partner for daily morning practice.',
    connectionPrefs: { seeking: ['practice-partner'], availability: 'Mornings' },
    consents: { introductions: true, community_visible: true, ai_matching: true },
  };
}

const pick = (setCookie, name) => (setCookie.match(new RegExp(name + '=[^;]+')) || [])[0] || '';

async function createMember(name, email) {
  let r = await fetch(`${BASE}/api/beta/enter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'mod-test-beta-code' }),
  });
  assert.equal(r.status, 200);
  const beta = pick(r.headers.get('set-cookie') || '', 'seren_beta');
  r = await fetch(`${BASE}/api/profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: beta },
    body: JSON.stringify(profileBody(name, email)),
  });
  const bodyText = await r.text();
  assert.equal(r.status, 201, `profile creation failed: ${bodyText}`);
  const data = JSON.parse(bodyText);
  const cookie = [beta, pick(r.headers.get('set-cookie') || '', 'seren_profile')].filter(Boolean).join('; ');
  return { id: data.id, cookie };
}

async function api(method, path, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data };
}

// ---------- fixtures ----------

const host = await createMember('Mod Host', 'host@example.com');
const host2 = await createMember('Second Host', 'second.host@example.com');
const alice = await createMember('Mod Alice', uniqueEmail('alice'));
const bob = await createMember('Mod Bob', uniqueEmail('bob'));

// Alice reports Bob.
const rep = await api('POST', '/api/reports', {
  reportedId: bob.id, reason: 'spam', details: 'Sent me three identical pitches.',
}, alice.cookie);
assert.equal(rep.status, 201);
const reportId = rep.data.report.id;

// ---------- tests ----------

test('non-host gets 403 on the report queue', async () => {
  const r = await api('GET', '/api/reports', undefined, alice.cookie);
  assert.equal(r.status, 403);
  assert.equal(r.data.error.code, 'forbidden');
});

test('non-host gets 403 on dismiss and hide-profile', async () => {
  const d = await api('POST', `/api/reports/${reportId}/dismiss`, {}, alice.cookie);
  assert.equal(d.status, 403);
  const h = await api('POST', `/api/reports/${reportId}/hide-profile`, {}, alice.cookie);
  assert.equal(h.status, 403);
});

test('unauthenticated requests are rejected: beta gate then auth', async () => {
  // No cookies at all: the outer beta gate answers 403.
  const r = await api('GET', '/api/reports');
  assert.equal(r.status, 403);
  assert.equal(r.data.error.code, 'beta_required');

  // Beta cookie but no profile token: 401 from the auth layer.
  const beta = await fetch(`${BASE}/api/beta/enter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'mod-test-beta-code' }),
  });
  const betaCookie = pick(beta.headers.get('set-cookie') || '', 'seren_beta');
  const r2 = await api('GET', '/api/reports', undefined, betaCookie);
  assert.equal(r2.status, 401);
});

test('host can list reports with reporter/reported details', async () => {
  const r = await api('GET', '/api/reports', undefined, host.cookie);
  assert.equal(r.status, 200);
  const found = r.data.reports.find((x) => x.id === reportId);
  assert.ok(found, 'report visible to host');
  assert.equal(found.reporterId, alice.id);
  assert.equal(found.reportedId, bob.id);
  assert.equal(found.reason, 'spam');
  assert.equal(found.status, 'open');
  assert.ok(found.createdAt);
});

test('second host email (with surrounding spaces) is also a host', async () => {
  const r = await api('GET', '/api/reports', undefined, host2.cookie);
  assert.equal(r.status, 200);
});

test('host dismisses a report', async () => {
  const d = await api('POST', `/api/reports/${reportId}/dismiss`, {}, host.cookie);
  assert.equal(d.status, 200);
  assert.equal(d.data.status, 'dismissed');
  const r = await api('GET', '/api/reports', undefined, host.cookie);
  assert.equal(r.data.reports.find((x) => x.id === reportId).status, 'dismissed');
});

test('host hide-profile hides the reported profile from discovery', async () => {
  // Fresh report so the hide path is exercised on an open report.
  const rep2 = await api('POST', '/api/reports', {
    reportedId: bob.id, reason: 'safety-concern', details: 'Felt unsafe.',
  }, alice.cookie);
  assert.equal(rep2.status, 201);
  const h = await api('POST', `/api/reports/${rep2.data.report.id}/hide-profile`, {}, host.cookie);
  assert.equal(h.status, 200);
  assert.equal(h.data.status, 'actioned');

  // Bob no longer appears in discovery for Alice.
  const list = await api('GET', '/api/profiles', undefined, alice.cookie);
  assert.equal(list.status, 200);
  const ids = (list.data.profiles || []).map((p) => p.id);
  assert.ok(!ids.includes(bob.id), 'hidden profile excluded from discovery');

  // Direct view degrades to the minimal hidden view (no email, no details).
  const view = await api('GET', `/api/profiles/${bob.id}`, undefined, alice.cookie);
  assert.equal(view.status, 200);
  assert.ok(!view.data.email, 'no email on hidden view');
  assert.equal(view.data.hidden, true);
});

test('hide-profile on an unknown report is 404', async () => {
  const h = await api('POST', '/api/reports/99999/hide-profile', {}, host.cookie);
  assert.equal(h.status, 404);
});

test('/api/me exposes isHost without leaking the host list', async () => {
  const mHost = await api('GET', '/api/me', undefined, host.cookie);
  assert.equal(mHost.status, 200);
  assert.equal(mHost.data.isHost, true);
  assert.equal(mHost.data.id, host.id);

  const mAlice = await api('GET', '/api/me', undefined, alice.cookie);
  assert.equal(mAlice.status, 200);
  assert.equal(mAlice.data.isHost, false);

  // The host list itself is never exposed: /api/meta has no host data.
  const meta = await api('GET', '/api/meta', undefined, host.cookie);
  assert.equal(meta.status, 200);
  assert.ok(!JSON.stringify(meta.data).includes('host@example.com'));
});

test('/api/me requires authentication', async () => {
  const r = await api('GET', '/api/me');
  assert.equal(r.status, 403); // outer beta gate, no cookies at all
  const beta = await fetch(`${BASE}/api/beta/enter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'mod-test-beta-code' }),
  });
  const betaCookie = pick(beta.headers.get('set-cookie') || '', 'seren_beta');
  const r2 = await api('GET', '/api/me', undefined, betaCookie);
  assert.equal(r2.status, 401); // auth layer: no profile token
});
