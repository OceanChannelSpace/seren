// SEREN MVP — decline-block tests.
// A decline (either kind) durably blocks further direct requests from the
// declined requester to the decliner, across every request-creation path.
// The block is directional, survives new introduction rows, and only the
// decliner can lift it.
//
// Spins up the real express app on an ephemeral port with an isolated temp
// SQLite DB (SEED_DEMO=false) and BETA_CODE set.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const dir = mkdtempSync(join(tmpdir(), 'seren-decline-'));
process.env.DB_PATH = join(dir, 'decline-test.db');
process.env.SEED_DEMO = 'false';
process.env.BETA_CODE = 'decline-test-beta-code';

// Dynamic import so DB_PATH / SEED_DEMO / BETA_CODE are honored at load time.
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
const uniqueEmail = () => `declinetester${++emailSeq}@example.com`;

function profileBody(overrides = {}) {
  return {
    name: 'Decline Tester',
    email: uniqueEmail(),
    interests: ['meditation', 'yoga'],
    intention: 'I want to find a meditation partner for daily morning practice.',
    connectionPrefs: { seeking: ['practice-partner'], availability: 'Mornings' },
    consents: { introductions: true, community_visible: true, ai_matching: true },
    ...overrides,
  };
}

async function api(method, path, body, auth) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Cookie = auth;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json, headers: res.headers };
}

function cookieValue(headers, name) {
  const m = new RegExp(`(?:^|,)\\s*${name}=([^;]+)`).exec(String(headers.get('set-cookie') || ''));
  return m ? `${name}=${m[1]}` : null;
}

// The beta gate is the outer gate: enter once, reuse the cookie everywhere.
let betaCookie = null;
async function ensureBeta() {
  if (betaCookie) return betaCookie;
  const r = await api('POST', '/api/beta/enter', { code: 'decline-test-beta-code' });
  assert.equal(r.status, 200, 'beta entry should succeed');
  betaCookie = cookieValue(r.headers, 'seren_beta');
  assert.ok(betaCookie, 'beta entry should set a seren_beta cookie');
  return betaCookie;
}

async function createProfile(overrides = {}) {
  const beta = await ensureBeta();
  const { status, json, headers } = await api('POST', '/api/profiles', profileBody(overrides), beta);
  assert.equal(status, 201, 'fixture profile creation should succeed');
  const profileCookie = cookieValue(headers, 'seren_profile');
  assert.ok(profileCookie, 'profile creation must set a seren_profile session cookie');
  return { ...json, _auth: `${beta}; ${profileCookie}` };
}

const connectionPayload = (targetId) => ({
  targetId,
  connectionType: 'practice-partner',
  message: 'I would love to connect and practice together sometime soon.',
});

// B sends A a targeted request; returns the introduction id.
async function requestAsBtoA(b, a) {
  const r = await api('POST', '/api/connections/request', connectionPayload(a.id), b._auth);
  assert.equal(r.status, 201, 'setup request should succeed');
  return r.json.introduction.id;
}

// ---------- decline -> block ----------

test('decline records a durable block: repeat direct request is rejected', async () => {
  const a = await createProfile({ name: 'Decliner' });
  const b = await createProfile({ name: 'Requester' });

  const introId = await requestAsBtoA(b, a);
  const d = await api('POST', `/api/introductions/${introId}/decline`, undefined, a._auth);
  assert.equal(d.status, 200, 'decline should succeed');

  const retry = await api('POST', '/api/connections/request', connectionPayload(a.id), b._auth);
  assert.equal(retry.status, 403, 'repeat request after decline must be rejected');
  assert.equal(retry.json.error.code, 'declined_previously');
});

test('decline_hidden via respond also blocks future requests', async () => {
  const a = await createProfile({ name: 'Quiet Decliner' });
  const b = await createProfile({ name: 'Quiet Requester' });

  const introId = await requestAsBtoA(b, a);
  const r = await api('POST', `/api/introductions/${introId}/respond`,
    { response: 'decline_hidden' }, a._auth);
  assert.equal(r.status, 200, 'decline_hidden should succeed');

  const retry = await api('POST', '/api/connections/request', connectionPayload(a.id), b._auth);
  assert.equal(retry.status, 403);
  assert.equal(retry.json.error.code, 'declined_previously');
});

test('the block is directional: the decliner may still reach out', async () => {
  const a = await createProfile({ name: 'Dir Decliner' });
  const b = await createProfile({ name: 'Dir Requester' });

  const introId = await requestAsBtoA(b, a);
  await api('POST', `/api/introductions/${introId}/decline`, undefined, a._auth);

  // A (the decliner) requesting B (the declined requester) is unaffected.
  const r = await api('POST', '/api/connections/request', connectionPayload(b.id), a._auth);
  assert.equal(r.status, 201, 'decliner may still reach out themselves');
});

test('the blocked viewer sees the profile as unavailable for requests', async () => {
  const a = await createProfile({ name: 'Flag Decliner' });
  const b = await createProfile({ name: 'Flag Requester' });
  const c = await createProfile({ name: 'Flag Bystander' });

  const introId = await requestAsBtoA(b, a);
  await api('POST', `/api/introductions/${introId}/decline`, undefined, a._auth);

  const asB = await api('GET', `/api/profiles/${a.id}`, undefined, b._auth);
  assert.equal(asB.status, 200);
  assert.equal(asB.json.requestBlocked, true, 'declined requester must see requestBlocked');

  const asC = await api('GET', `/api/profiles/${a.id}`, undefined, c._auth);
  assert.equal(asC.status, 200);
  assert.ok(!asC.json.requestBlocked, 'unaffected third party must not see requestBlocked');
});

test('an unaffected third party can still send requests to the decliner', async () => {
  const a = await createProfile({ name: 'Third Decliner' });
  const b = await createProfile({ name: 'Third Requester' });
  const c = await createProfile({ name: 'Third Party' });

  const introId = await requestAsBtoA(b, a);
  await api('POST', `/api/introductions/${introId}/decline`, undefined, a._auth);

  const r = await api('POST', '/api/connections/request', connectionPayload(a.id), c._auth);
  assert.equal(r.status, 201, 'third party requests are unaffected');
});

test('auto-match never reintroduces a declined pair', async () => {
  // Unique keywords so only this test's A can match B's request text.
  const a = await createProfile({
    name: 'Auto Decliner',
    intention: 'I want to find a meditation partner for lighthouse vigils at dawn.',
  });
  const b = await createProfile({ name: 'Auto Requester' });
  // C shares nothing with B, so only A can ever match B.
  const c = await createProfile({
    name: 'Auto Other',
    interests: ['tarot'],
    intention: 'Looking for a tarot study buddy for weekend card readings together.',
    connectionPrefs: { seeking: ['friendship'], availability: 'Weekends' },
  });

  const first = await api('POST', '/api/introductions/request', { intention: 'lighthouse vigils' }, b._auth);
  assert.equal(first.status, 201);
  assert.equal(first.json.proposed.id, a.id, 'B should first be matched with A');

  await api('POST', `/api/introductions/${first.json.introduction.id}/decline`, undefined, a._auth);

  const second = await api('POST', '/api/introductions/request', { intention: 'lighthouse vigils' }, b._auth);
  if (second.status === 201) {
    assert.notEqual(second.json.proposed.id, a.id, 'auto-match must not reintroduce a declined pair');
  } else {
    assert.equal(second.status, 404, 'no eligible match is also acceptable');
  }
  void c;
});

// ---------- undo ----------

test('the decliner can lift the block; requests flow again', async () => {
  const a = await createProfile({ name: 'Undo Decliner' });
  const b = await createProfile({ name: 'Undo Requester' });

  const introId = await requestAsBtoA(b, a);
  await api('POST', `/api/introductions/${introId}/decline`, undefined, a._auth);

  const blocked = await api('POST', '/api/connections/request', connectionPayload(a.id), b._auth);
  assert.equal(blocked.status, 403);

  const lift = await api('DELETE', `/api/decline-blocks/${b.id}`, undefined, a._auth);
  assert.equal(lift.status, 200);
  assert.equal(lift.json.removed, true);

  const retry = await api('POST', '/api/connections/request', connectionPayload(a.id), b._auth);
  assert.equal(retry.status, 201, 'requests work again after the decliner allows them');

  const view = await api('GET', `/api/profiles/${a.id}`, undefined, b._auth);
  assert.ok(!view.json.requestBlocked, 'requestBlocked clears after the block is lifted');
});

test('only the decliner can lift their own block', async () => {
  const a = await createProfile({ name: 'Own Decliner' });
  const b = await createProfile({ name: 'Own Requester' });
  const c = await createProfile({ name: 'Own Bystander' });

  const introId = await requestAsBtoA(b, a);
  await api('POST', `/api/introductions/${introId}/decline`, undefined, a._auth);

  // The declined requester cannot lift the block against themselves.
  const selfLift = await api('DELETE', `/api/decline-blocks/${b.id}`, undefined, b._auth);
  assert.equal(selfLift.status, 200);
  assert.equal(selfLift.json.removed, false, 'requester cannot remove a block placed on them');

  // A third party cannot lift someone else's block either.
  const thirdLift = await api('DELETE', `/api/decline-blocks/${b.id}`, undefined, c._auth);
  assert.equal(thirdLift.status, 200);
  assert.equal(thirdLift.json.removed, false);

  // The block still holds.
  const retry = await api('POST', '/api/connections/request', connectionPayload(a.id), b._auth);
  assert.equal(retry.status, 403);
});

test('lifting requires authentication', async () => {
  const beta = await ensureBeta();
  const r = await api('DELETE', '/api/decline-blocks/1', undefined, beta);
  assert.equal(r.status, 401, 'no profile token means no unblock');
});
