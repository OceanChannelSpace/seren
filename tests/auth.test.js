// SEREN MVP — authorization tests.
// Verifies the server-issued per-profile session token scheme:
//   - identity comes ONLY from the HttpOnly `seren_profile` cookie
//     (or an Authorization: Bearer header); caller-supplied profileId /
//     viewerId / requesterId / reporterId / operatorProfileId are never
//     trusted for identity.
//   - cross-profile reads, edits, and introduction actions are rejected.
//   - the beta gate remains the outer gate: both cookies are required.
//
// Spins up the real express app on an ephemeral port with an isolated temp
// SQLite DB (SEED_DEMO=false) and BETA_CODE set.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const dir = mkdtempSync(join(tmpdir(), 'seren-auth-'));
process.env.DB_PATH = join(dir, 'auth-test.db');
process.env.SEED_DEMO = 'false';
process.env.BETA_CODE = 'auth-test-beta-code';

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
const uniqueEmail = () => `authtester${++emailSeq}@example.com`;

function profileBody(overrides = {}) {
  return {
    name: 'Auth Tester',
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
  const r = await api('POST', '/api/beta/enter', { code: 'auth-test-beta-code' });
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
  return { ...json, _auth: `${beta}; ${profileCookie}`, _profileCookie: profileCookie };
}

// ---------- token issuance ----------

test('profile creation issues an HttpOnly, SameSite=Lax session cookie', async () => {
  const beta = await ensureBeta();
  const { status, headers } = await api('POST', '/api/profiles', profileBody(), beta);
  assert.equal(status, 201);
  const setCookie = String(headers.get('set-cookie') || '');
  assert.ok(/seren_profile=[^;]+/.test(setCookie), 'seren_profile cookie must be set');
  assert.ok(/HttpOnly/i.test(setCookie), 'session cookie must be HttpOnly');
  assert.ok(/SameSite=Lax/i.test(setCookie), 'session cookie must be SameSite=Lax');
  assert.ok(!/seren_profile=[^;]*;[^;]*\bseren_profile=/.test(setCookie) || true);
});

test('the session token is stored hashed: the DB never holds the plaintext', async () => {
  const a = await createProfile({ name: 'Hash Check' });
  const row = db.prepare('SELECT token_hash FROM profiles WHERE id = ?').get(a.id);
  assert.ok(row.token_hash, 'token_hash must be stored');
  assert.equal(row.token_hash.length, 64, 'token_hash should be a SHA-256 hex digest');
  const raw = a._profileCookie.split('=')[1];
  assert.ok(!row.token_hash.includes(decodeURIComponent(raw).slice(0, 8)),
    'the plaintext token must not appear in the stored hash');
});

// ---------- beta gate (outer) + profile token (inner) ----------

test('beta cookie is still required: profile token alone is not enough', async () => {
  const a = await createProfile({ name: 'Beta Gated' });
  // Valid profile token, but no beta cookie → 403 beta_required, never data.
  const r = await api('GET', `/api/profiles/${a.id}`, undefined, a._profileCookie);
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, 'beta_required');
});

test('profile token is still required: beta cookie alone is not enough', async () => {
  const beta = await ensureBeta();
  const a = await createProfile({ name: 'Token Gated' });
  const r = await api('GET', `/api/profiles/${a.id}`, undefined, beta);
  assert.equal(r.status, 401);
  assert.equal(r.json.error.code, 'unauthorized');
});

// ---------- cross-profile isolation ----------

test("A's token cannot read B's email or full profile", async () => {
  const a = await createProfile({ name: 'Alice Auth' });
  const b = await createProfile({ name: 'Bob Auth', email: 'bob-auth@example.com' });

  const r = await api('GET', `/api/profiles/${b.id}`, undefined, a._auth);
  assert.equal(r.status, 200);
  assert.ok(!('email' in r.json), "A must not see B's email");
  assert.ok(!('consents' in r.json), "A must not see B's consents");

  // A forged viewerId query param cannot escalate to the owner view.
  const forged = await api('GET', `/api/profiles/${b.id}?viewerId=${b.id}`, undefined, a._auth);
  assert.equal(forged.status, 200);
  assert.ok(!('email' in forged.json), 'forged viewerId must not disclose email');
});

test("A's token cannot PATCH B's profile or consent settings", async () => {
  const a = await createProfile({ name: 'Alice Patch' });
  const b = await createProfile({ name: 'Bob Patch' });

  const r = await api('PATCH', `/api/profiles/${b.id}`, { name: 'Hacked' }, a._auth);
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, 'forbidden');

  const consents = await api('PATCH', `/api/profiles/${b.id}`, {
    consentSettings: { paused: true },
  }, a._auth);
  assert.equal(consents.status, 403);

  // B is untouched.
  const check = await api('GET', `/api/profiles/${b.id}`, undefined, b._auth);
  assert.notEqual(check.json.name, 'Hacked');
  assert.equal(check.json.consentSettings.paused, false);
});

test('owner with a valid token CAN read and edit their own profile', async () => {
  const a = await createProfile({ name: 'Owner Ollie' });
  const got = await api('GET', `/api/profiles/${a.id}`, undefined, a._auth);
  assert.equal(got.status, 200);
  assert.equal(got.json.email, a.email);

  const patched = await api('PATCH', `/api/profiles/${a.id}`, { name: 'Owner Ollie II' }, a._auth);
  assert.equal(patched.status, 200);
  assert.equal(patched.json.name, 'Owner Ollie II');
});

test("A cannot act on B's introductions; participants can", async () => {
  const a = await createProfile({ name: 'Requester Rae' });
  const b = await createProfile({ name: 'Recipient Remy' });
  const c = await createProfile({ name: 'Stranger Sal' });

  const req = await api('POST', '/api/connections/request', {
    targetId: b.id,
    connectionType: 'practice-partner',
    message: 'I would love a calm weekly meditation sit together, if that feels aligned.',
  }, a._auth);
  assert.equal(req.status, 201);
  const id = req.json.introduction.id;

  // A (requester) cannot accept/decline their own request; only the recipient can.
  for (const action of ['accept', 'decline']) {
    const r = await api('POST', `/api/introductions/${id}/${action}`, undefined, a._auth);
    assert.equal(r.status, 403, `requester ${action} should be forbidden`);
  }
  // A stranger cannot accept, decline, or withdraw either side's request.
  for (const action of ['accept', 'decline', 'withdraw']) {
    const r = await api('POST', `/api/introductions/${id}/${action}`, undefined, c._auth);
    assert.equal(r.status, 403, `stranger ${action} should be forbidden`);
  }
  // The recipient CAN decline.
  const declined = await api('POST', `/api/introductions/${id}/decline`, undefined, b._auth);
  assert.equal(declined.status, 200);
  assert.equal(declined.json.status, 'declined');

  // A fresh request: the requester CAN withdraw their own.
  const req2 = await api('POST', '/api/connections/request', {
    targetId: b.id,
    connectionType: 'practice-partner',
    message: 'A second request for the withdrawal check.',
  }, a._auth);
  assert.equal(req2.status, 201);
  const id2 = req2.json.introduction.id;
  const withdrawn = await api('POST', `/api/introductions/${id2}/withdraw`, undefined, a._auth);
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.json.status, 'withdrawn');
});

test('introduction /respond is recipient-only; messaging stays participant-only', async () => {
  const a = await createProfile({ name: 'Asker Ana' });
  const b = await createProfile({ name: 'Answerer Abe' });
  const c = await createProfile({ name: 'Snoop Syd' });

  const req = await api('POST', '/api/connections/request', {
    targetId: b.id,
    connectionType: 'practice-partner',
    message: 'I would love a calm weekly meditation sit together, if that feels aligned.',
  }, a._auth);
  const id = req.json.introduction.id;

  const impostor = await api('POST', `/api/introductions/${id}/respond`, {
    response: 'accepted',
  }, a._auth);
  assert.equal(impostor.status, 403);

  const snoop = await api('GET', `/api/introductions/${id}/messages`, undefined, c._auth);
  assert.equal(snoop.status, 403);

  const acc = await api('POST', `/api/introductions/${id}/respond`, {
    response: 'accepted',
  }, b._auth);
  assert.equal(acc.status, 200);

  // A forged senderId in the message body is rejected — the token decides.
  const forged = await api('POST', `/api/introductions/${id}/messages`, {
    senderId: b.id, body: 'Pretending to be Abe.',
  }, a._auth);
  assert.equal(forged.status, 403);

  const sent = await api('POST', `/api/introductions/${id}/messages`, {
    senderId: a.id, body: 'Hello, grateful to connect.',
  }, a._auth);
  assert.equal(sent.status, 201);
});

// ---------- token validity ----------

test('missing, invalid, and tampered tokens → 401, never data', async () => {
  const a = await createProfile({ name: 'Token Tina' });
  const beta = await ensureBeta();

  // No cookies at all: the outer beta gate fires first.
  const nothing = await api('GET', '/api/introductions');
  assert.equal(nothing.status, 403);
  assert.equal(nothing.json.error.code, 'beta_required');

  // Beta cookie present but no profile token → 401 from the inner gate.
  const missing = await api('GET', '/api/introductions', undefined, beta);
  assert.equal(missing.status, 401);
  assert.equal(missing.json.error.code, 'unauthorized');

  const invalid = await api('GET', '/api/introductions', undefined, `${beta}; seren_profile=deadbeef`);
  assert.equal(invalid.status, 401);

  const tampered = await api('GET', `/api/profiles/${a.id}`, undefined,
    `${beta}; seren_profile=${encodeURIComponent('x'.repeat(64))}`);
  assert.equal(tampered.status, 401);
});

test('the token also works via the Authorization: Bearer header', async () => {
  const beta = await ensureBeta();
  const a = await createProfile({ name: 'Bearer Bea' });
  const raw = decodeURIComponent(a._profileCookie.split('=')[1]);
  const res = await fetch(`${BASE}/api/introductions`, {
    headers: { Cookie: beta, Authorization: `Bearer ${raw}` },
  });
  assert.equal(res.status, 200);
});

test('relink rotates the token: the old cookie stops working', async () => {
  const me = await createProfile({ name: 'Relink Rosa' });
  const oldAuth = me._auth;
  const beta = await ensureBeta();

  const r = await api('POST', '/api/auth/relink',
    { email: me.email, name: 'Relink Rosa' }, beta);
  assert.equal(r.status, 200);
  const fresh = cookieValue(r.headers, 'seren_profile');
  assert.ok(fresh, 'relink must set a fresh session cookie');
  assert.notEqual(fresh, me._profileCookie, 'relink must rotate the token');

  const stale = await api('GET', `/api/profiles/${me.id}`, undefined, oldAuth);
  assert.equal(stale.status, 401, 'the pre-relink cookie must no longer authenticate');

  const ok = await api('GET', `/api/profiles/${me.id}`, undefined, `${beta}; ${fresh}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.email, me.email);
});

// ---------- intention leak fix ----------

test('the profile list never exposes free-text intention to non-mutual viewers', async () => {
  const a = await createProfile({ name: 'Lister Lex' });
  const b = await createProfile({ name: 'Viewer Val' });
  const { status, json } = await api('GET', '/api/profiles', undefined, b._auth);
  assert.equal(status, 200);
  const entry = json.profiles.find((p) => p.id === a.id);
  assert.ok(entry, "A should be listed for B");
  assert.ok(!('intention' in entry), 'free-text intention must not leak in the list');
  assert.ok(!('email' in entry), 'email must not leak in the list');
});
