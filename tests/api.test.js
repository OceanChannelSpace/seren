// SEREN MVP — API tests.
// Spins up the real express app on an ephemeral port with an isolated temp
// SQLite DB (SEED_DEMO=false); fixtures are created through the API itself.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const dir = mkdtempSync(join(tmpdir(), 'seren-api-'));
process.env.DB_PATH = join(dir, 'api-test.db');
process.env.SEED_DEMO = 'false';

// Dynamic import so DB_PATH / SEED_DEMO are honored at db-module load time.
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
const uniqueEmail = () => `tester${++emailSeq}@example.com`;

function profileBody(overrides = {}) {
  return {
    name: 'Test Seeker',
    email: uniqueEmail(),
    interests: ['meditation', 'yoga'],
    intention: 'I want to find a meditation partner for daily morning practice.',
    connectionPrefs: { seeking: ['practice-partner'], availability: 'Mornings' },
    consents: { introductions: true, community_visible: true, ai_matching: true },
    ...overrides,
  };
}

// Identity: the session token arrives as an HttpOnly cookie on profile
// creation. Pass a created profile (or its `_auth` cookie string) as `auth`
// and its cookie is sent; the server derives identity from the token alone.
async function api(method, path, body, auth) {
  const headers = { 'Content-Type': 'application/json' };
  const cookie = typeof auth === 'string' ? auth : auth?._auth;
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  const out = { status: res.status, json, setCookie: res.headers.get('set-cookie') };
  // Auto-register every created profile so hideOthers() can reach profiles
  // created outside createProfile().
  if (method === 'POST' && path === '/api/profiles' && res.status === 201 && json && json.id) {
    profileRegistry.set(json.id, { ...json, _auth: sessionCookie(out.setCookie) });
  }
  return out;
}

function sessionCookie(setCookieHeader) {
  const m = /(?:^|,)\s*seren_profile=([^;]+)/.exec(String(setCookieHeader || ''));
  return m ? `seren_profile=${m[1]}` : null;
}

async function createProfile(overrides = {}) {
  const { status, json, setCookie } = await api('POST', '/api/profiles', profileBody(overrides));
  assert.equal(status, 201, 'fixture profile creation should succeed');
  const profile = { ...json, _auth: sessionCookie(setCookie) };
  profileRegistry.set(profile.id, profile);
  return profile;
}

// Every profile created in this file, for cross-test deterministic matching.
const profileRegistry = new Map();

/**
 * Hide every known profile except `keepIds` from the community, using each
 * profile's own session cookie (profiles can only edit themselves).
 * Makes auto-match results deterministic within a test.
 */
async function hideOthers(keepIds) {
  const keep = new Set(keepIds);
  for (const p of profileRegistry.values()) {
    if (keep.has(p.id)) continue;
    const r = await api('PATCH', `/api/profiles/${p.id}`, {
      consents: { introductions: true, community_visible: false, ai_matching: true },
    }, p);
    assert.equal(r.status, 200, `hiding profile ${p.id} should succeed`);
  }
}

// ---------- tests ----------

test('GET /api/health reports ok with seeding disabled', async () => {
  const { status, json } = await api('GET', '/api/health');
  assert.equal(status, 200);
  assert.equal(json.status, 'ok');
  assert.equal(json.seeded, false);
});

test('POST /api/profiles creates a profile (201, camelCase, email normalized)', async () => {
  const { status, json } = await api('POST', '/api/profiles', profileBody({
    name: '  Amara Test  ',
    email: 'CaseCheck@Example.COM',
  }));
  assert.equal(status, 201);
  assert.equal(typeof json.id, 'number');
  assert.equal(json.name, 'Amara Test');
  assert.equal(json.email, 'casecheck@example.com');
  assert.deepEqual(json.interests, ['meditation', 'yoga']);
  assert.equal(json.intention, 'I want to find a meditation partner for daily morning practice.');
  assert.deepEqual(json.connectionPrefs, { seeking: ['practice-partner'], availability: 'Mornings' });
  assert.deepEqual(json.consents, { introductions: true, community_visible: true, ai_matching: true });
  assert.equal(json.isSeed, false);
  assert.ok(json.createdAt);
  assert.ok(json.updatedAt);
});

test('POST /api/profiles rejects invalid input with 400 + details', async () => {
  const cases = [
    ['bad email', { email: 'not-an-email' }],
    ['empty interests', { interests: [] }],
    ['9 interests', {
      interests: ['meditation', 'tarot', 'astrology', 'breathwork', 'reiki', 'sound-healing', 'yoga', 'journaling', 'dreamwork'],
    }],
    ['short intention', { intention: 'too short' }],
    ['introductions:false on create', {
      consents: { introductions: false, community_visible: true, ai_matching: true },
    }],
    ['empty name', { name: '' }],
  ];
  for (const [label, overrides] of cases) {
    const { status, json } = await api('POST', '/api/profiles', profileBody(overrides));
    assert.equal(status, 400, label);
    assert.equal(json.error.code, 'validation_error', label);
    assert.ok(Array.isArray(json.error.details) && json.error.details.length > 0, label);
  }
});

test('POST /api/profiles rejects a duplicate email with 409', async () => {
  const first = await api('POST', '/api/profiles', profileBody({ email: 'dupe@example.com' }));
  assert.equal(first.status, 201);
  const { status, json } = await api('POST', '/api/profiles', profileBody({ email: 'DUPE@example.com' }));
  assert.equal(status, 409);
  assert.equal(json.error.code, 'email_taken');
});

test('GET /api/profiles requires auth; entries are privacy-filtered (no email/consents/intention)', async () => {
  const me = await createProfile();
  const noAuth = await api('GET', '/api/profiles');
  assert.equal(noAuth.status, 401);
  assert.equal(noAuth.json.error.code, 'unauthorized');

  const { status, json } = await api('GET', '/api/profiles', undefined, me);
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.profiles) && json.profiles.length > 0);
  for (const p of json.profiles) {
    if (p.id === me.id) continue; // own entry is the full profile
    assert.ok(!('email' in p), 'list entry must not include email');
    assert.ok(!('consents' in p), 'list entry must not include consents');
    assert.ok(!('intention' in p), 'list entry must not include free-text intention');
  }
});

test('GET /api/profiles/:id returns full profile to owner, privacy-filtered view to others', async () => {
  const created = await createProfile();
  // Owner view (token-authenticated as the profile): full profile including email.
  const { status, json } = await api('GET', `/api/profiles/${created.id}`, undefined, created);
  assert.equal(status, 200);
  assert.equal(json.id, created.id);
  assert.equal(json.email, created.email);
  assert.deepEqual(json.consents, created.consents);

  // Stranger view: no email, no consents — privacy by default.
  const other = await createProfile({ email: 'other-viewer@example.com', name: 'Other Viewer' });
  const stranger = await api('GET', `/api/profiles/${created.id}`, undefined, other);
  assert.equal(stranger.status, 200);
  assert.equal(stranger.json.id, created.id);
  assert.ok(!('email' in stranger.json), 'stranger view must not include email');
  assert.ok(!('consents' in stranger.json), 'stranger view must not include consents');

  // A forged viewerId query param can no longer escalate to the owner view.
  const forged = await api('GET', `/api/profiles/${created.id}?viewerId=${created.id}`, undefined, other);
  assert.equal(forged.status, 200);
  assert.ok(!('email' in forged.json), 'forged viewerId must not disclose email');

  // No token at all → 401, never data.
  const anon = await api('GET', `/api/profiles/${created.id}`);
  assert.equal(anon.status, 401);

  const missing = await api('GET', '/api/profiles/999999', undefined, created);
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, 'not_found');
});

test('PATCH /api/profiles/:id updates own profile; others → 403; invalid input → 400; unknown id → 404', async () => {
  const created = await createProfile();

  const { status, json } = await api('PATCH', `/api/profiles/${created.id}`, { name: 'Renamed Seeker' }, created);
  assert.equal(status, 200);
  assert.equal(json.name, 'Renamed Seeker');
  assert.equal(json.email, created.email);

  const bad = await api('PATCH', `/api/profiles/${created.id}`, { interests: ['not-a-real-interest'] }, created);
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, 'validation_error');
  assert.ok(bad.json.error.details.length > 0);

  // Another member's token cannot edit this profile.
  const other = await createProfile({ email: 'patch-snoop@example.com', name: 'Patch Snoop' });
  const forbidden = await api('PATCH', `/api/profiles/${created.id}`, { name: 'Hacked' }, other);
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.json.error.code, 'forbidden');

  // No token → 401.
  const anon = await api('PATCH', `/api/profiles/${created.id}`, { name: 'Hacked' });
  assert.equal(anon.status, 401);

  const missing = await api('PATCH', '/api/profiles/999999', { name: 'Ghost' }, created);
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, 'not_found');
});

test('PATCH /api/profiles/:id rejects a duplicate email with 409', async () => {
  const a = await createProfile();
  const b = await createProfile();
  const { status, json } = await api('PATCH', `/api/profiles/${b.id}`, { email: a.email }, b);
  assert.equal(status, 409);
  assert.equal(json.error.code, 'email_taken');
});

test('POST /api/introductions/request matches and returns 201 with breakdown', async () => {
  const requester = await createProfile({
    interests: ['meditation', 'tarot'],
    intention: 'I seek a tarot study buddy for weekly card pulls and dream journaling',
  });
  const candidate = await createProfile({
    interests: ['tarot', 'dreamwork'],
    intention: 'weekly tarot study and dream journaling with a buddy for card pulls',
  });

  const { status, json } = await api('POST', '/api/introductions/request', {
    intention: 'I seek a tarot study buddy for weekly card pulls and dream journaling',
  }, requester);
  assert.equal(status, 201);

  const { introduction, proposed, evidence } = json;
  assert.equal(introduction.requesterId, requester.id);
  assert.equal(introduction.proposedId, candidate.id);
  assert.equal(introduction.proposedId, proposed.id);
  assert.equal(introduction.status, 'proposed');
  assert.ok(introduction.note.length > 0);
  assert.ok(!('score' in introduction), 'no numeric score leaks on the introduction wire');
  assert.ok(!('scoreBreakdown' in json), 'scoreBreakdown renamed to evidence');

  assert.deepEqual(Object.keys(proposed).sort(), ['id', 'intention', 'interests', 'name']);
  assert.equal(proposed.name, candidate.name);
  assert.ok(!('email' in proposed), 'proposed profile must not include email');

  // Qualitative evidence only — never a numeric score in the response.
  assert.deepEqual(evidence.sharedInterests, ['tarot']);
  assert.deepEqual(
    evidence.sharedKeywords,
    ['tarot', 'study', 'buddy', 'weekly', 'card', 'pulls', 'dream', 'journaling'],
  );
  assert.ok(!('score' in evidence), 'evidence carries reasons, not a score');
});

test('POST /api/introductions/request without a session token → 401, never data', async () => {
  const { status, json } = await api('POST', '/api/introductions/request', {
    intention: 'I want to meet someone for a shared spiritual practice.',
  });
  assert.equal(status, 401);
  assert.equal(json.error.code, 'unauthorized');
});

test('POST /api/introductions/request with invalid intention → 400', async () => {
  const requester = await createProfile();
  const { status, json } = await api('POST', '/api/introductions/request', {
    intention: 'tiny',
  }, requester);
  assert.equal(status, 400);
  assert.equal(json.error.code, 'validation_error');
});

test('POST /api/introductions/request without introductions consent → 403 consent_required', async () => {
  const requester = await createProfile();
  const patched = await api('PATCH', `/api/profiles/${requester.id}`, {
    consents: { introductions: false, community_visible: true, ai_matching: true },
  }, requester);
  assert.equal(patched.status, 200);

  const { status, json } = await api('POST', '/api/introductions/request', {
    intention: 'I want to meet someone for a shared spiritual practice.',
  }, requester);
  assert.equal(status, 403);
  assert.equal(json.error.code, 'consent_required');
});

test('POST /api/introductions/request with no eligible candidates → 404 no_match', async () => {
  const requester = await createProfile();
  // Hide every other profile from the community so none are eligible.
  await hideOthers([requester.id]);

  const { status, json } = await api('POST', '/api/introductions/request', {
    intention: 'I want to meet someone for a shared spiritual practice.',
  }, requester);
  assert.equal(status, 404);
  assert.equal(json.error.code, 'no_match');
});

test('introduction transitions: accept/decline/withdraw; invalid ones → 409; role checks → 403', async () => {
  const requester = await createProfile();
  const p2 = await createProfile();
  const p3 = await createProfile();
  const p4 = await createProfile();
  // Hide every other profile so the matches below are deterministic
  // (all fixtures score identically, so the lowest visible id must win).
  await hideOthers([requester.id, p2.id, p3.id, p4.id]);

  async function requestIntro() {
    const { status, json } = await api('POST', '/api/introductions/request', {
      intention: 'I want to meet someone for a shared spiritual practice.',
    }, requester);
    assert.equal(status, 201, 'fixture intro request should succeed');
    return json.introduction;
  }

  // accept — only the proposed recipient may accept.
  const i1 = await requestIntro();
  assert.equal(i1.proposedId, p2.id);
  const wrongSide = await api('POST', `/api/introductions/${i1.id}/accept`, undefined, requester);
  assert.equal(wrongSide.status, 403);
  assert.equal(wrongSide.json.error.code, 'forbidden');
  const stranger = await createProfile({ email: 'transition-snoop@example.com', name: 'Transition Snoop' });
  const snoopAccept = await api('POST', `/api/introductions/${i1.id}/accept`, undefined, stranger);
  assert.equal(snoopAccept.status, 403);
  const accepted = await api('POST', `/api/introductions/${i1.id}/accept`, undefined, p2);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.json.status, 'accepted');

  // accept is terminal: further accept/decline → 409
  for (const action of ['accept', 'decline']) {
    const r = await api('POST', `/api/introductions/${i1.id}/${action}`, undefined, p2);
    assert.equal(r.status, 409, `re-${action} on accepted intro`);
    assert.equal(r.json.error.code, 'invalid_transition');
  }

  // decline (p2 excluded by the accepted pair; p3 wins the tie by lower id)
  const i2 = await requestIntro();
  assert.equal(i2.proposedId, p3.id);
  const declineByRequester = await api('POST', `/api/introductions/${i2.id}/decline`, undefined, requester);
  assert.equal(declineByRequester.status, 403);
  const declined = await api('POST', `/api/introductions/${i2.id}/decline`, undefined, p3);
  assert.equal(declined.status, 200);
  assert.equal(declined.json.status, 'declined');
  const reDecline = await api('POST', `/api/introductions/${i2.id}/decline`, undefined, p3);
  assert.equal(reDecline.status, 409);
  assert.equal(reDecline.json.error.code, 'invalid_transition');

  // withdraw (p2 accepted + p3 declined pairs excluded; p4 is next)
  // — only the requester may withdraw.
  const i3 = await requestIntro();
  assert.equal(i3.proposedId, p4.id);
  const withdrawByProposed = await api('POST', `/api/introductions/${i3.id}/withdraw`, undefined, p4);
  assert.equal(withdrawByProposed.status, 403);
  const withdrawn = await api('POST', `/api/introductions/${i3.id}/withdraw`, undefined, requester);
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.json.status, 'withdrawn');
  const acceptWithdrawn = await api('POST', `/api/introductions/${i3.id}/accept`, undefined, p4);
  assert.equal(acceptWithdrawn.status, 409);
  assert.equal(acceptWithdrawn.json.error.code, 'invalid_transition');

  // withdrawn pairs are re-eligible: a new request proposes p4 again
  const i4 = await requestIntro();
  assert.notEqual(i4.id, i3.id);
  assert.equal(i4.proposedId, p4.id);
  assert.equal(i4.status, 'proposed');

  // unknown introduction → 404
  const missing = await api('POST', '/api/introductions/999999/accept', undefined, requester);
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, 'not_found');

  // no token → 401
  const anon = await api('POST', `/api/introductions/${i4.id}/accept`);
  assert.equal(anon.status, 401);
});

test('GET /api/introductions lists the caller\'s intros; identity comes from the token', async () => {
  const a = await createProfile({ name: 'Lister One' });
  const b = await createProfile({ name: 'Lister Two' });
  // Leave only a and b community-visible so b is the deterministic match.
  await hideOthers([a.id, b.id]);

  const req = await api('POST', '/api/introductions/request', {
    intention: 'I want to meet someone for a shared spiritual practice.',
  }, a);
  assert.equal(req.status, 201);
  assert.equal(req.json.proposed.id, b.id);
  const introId = req.json.introduction.id;

  // Visible from both sides, with names.
  for (const p of [a, b]) {
    const r = await api('GET', '/api/introductions', undefined, p);
    assert.equal(r.status, 200, `list for profile ${p.id}`);
    const found = r.json.introductions.find((i) => i.id === introId);
    assert.ok(found, `intro present in list for profile ${p.id}`);
    assert.equal(found.requesterId, a.id);
    assert.equal(found.proposedId, b.id);
    assert.equal(found.requesterName, 'Lister One');
    assert.equal(found.proposedName, 'Lister Two');
    assert.equal(found.status, 'proposed');
    assert.ok(found.note.length > 0);
    assert.ok(!('score' in found), 'no numeric score leaks on the introduction wire');
    assert.ok(found.createdAt);
  }

  // A third member sees none of it.
  const c = await createProfile({ name: 'Lister Three' });
  const others = await api('GET', '/api/introductions', undefined, c);
  assert.equal(others.status, 200);
  assert.ok(!others.json.introductions.some((i) => i.id === introId));

  // No token → 401, never data.
  const missing = await api('GET', '/api/introductions');
  assert.equal(missing.status, 401);
  assert.equal(missing.json.error.code, 'unauthorized');

  // A forged profileId query param is ignored — the token decides.
  const forged = await api('GET', `/api/introductions?profileId=${a.id}`, undefined, c);
  assert.equal(forged.status, 200);
  assert.ok(!forged.json.introductions.some((i) => i.id === introId));
});
