// SEREN MVP — profile deletion tests.
// DELETE /api/profiles/me permanently removes the caller's own profile and
// data. Identity comes ONLY from the session token: there is no id param,
// so a caller can only ever delete themselves.
//
// Fixtures build a full web of data between two members (A and B): an
// introduction (request + accept), messages, a decline block, a block, an
// agent registered by A, a report filed by A about B, saved items, a circle
// they both belong to, plus guide/chat sessions, a brief, and a connection
// plan. A deletes; the tests assert everything of A's is gone while B's data
// and the shared connection records survive.
//
// Spins up the real express app on an ephemeral port with an isolated temp
// SQLite DB (SEED_DEMO=false).

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const dir = mkdtempSync(join(tmpdir(), 'seren-profile-deletion-'));
process.env.DB_PATH = join(dir, 'profile-deletion-test.db');
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
const uniqueEmail = () => `deltester${++emailSeq}@example.com`;

function profileBody(overrides = {}) {
  return {
    name: 'Deletion Seeker',
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
  const cookie = typeof auth === 'string' ? auth : auth?._auth;
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json, setCookie: res.headers.get('set-cookie') };
}

function sessionCookie(setCookieHeader) {
  const m = /(?:^|,)\s*seren_profile=([^;]+)/.exec(String(setCookieHeader || ''));
  return m ? `seren_profile=${m[1]}` : null;
}

async function createProfile(overrides = {}) {
  const { status, json, setCookie } = await api('POST', '/api/profiles', profileBody(overrides));
  assert.equal(status, 201, 'fixture profile creation should succeed');
  return { ...json, _auth: sessionCookie(setCookie) };
}

const row = (sql, ...params) => db.prepare(sql).get(...params);
const count = (sql, ...params) => db.prepare(sql).get(...params).c;

// ---------- fixtures ----------

// A and B with a full web of data between them.
const a = await createProfile({ name: 'Deleter Ada' });
const b = await createProfile({ name: 'Survivor Bea' });
const c = await createProfile({ name: 'Third Party Cal' });

// B requests A; A declines via /respond → decline block (decliner A, requester B).
const declinedReq = await api('POST', '/api/connections/request', {
  targetId: a.id,
  connectionType: 'practice-partner',
  message: 'I would love a calm weekly meditation sit together, if that feels aligned.',
}, b._auth);
assert.equal(declinedReq.status, 201);
const declinedIntroId = declinedReq.json.introduction.id;
const decline = await api('POST', `/api/introductions/${declinedIntroId}/respond`, {
  response: 'decline',
}, a._auth);
assert.equal(decline.status, 200);
assert.equal(count('SELECT COUNT(*) AS c FROM decline_blocks WHERE decliner_id = ? AND requester_id = ?', a.id, b.id), 1);

// A requests B (allowed: the decline block only stops B requesting A); B accepts.
const req = await api('POST', '/api/connections/request', {
  targetId: b.id,
  connectionType: 'practice-partner',
  message: 'A gentle weekly sit together could be lovely, if you are open to it.',
}, a._auth);
assert.equal(req.status, 201);
const introId = req.json.introduction.id;
const accept = await api('POST', `/api/introductions/${introId}/accept`, undefined, b._auth);
assert.equal(accept.status, 200);

// Messages both ways.
const mA = await api('POST', `/api/introductions/${introId}/messages`, {
  senderId: a.id, body: 'Grateful to connect. Mornings work best for me.',
}, a._auth);
assert.equal(mA.status, 201);
const mB = await api('POST', `/api/introductions/${introId}/messages`, {
  senderId: b.id, body: 'Mornings suit me too. Shall we start Sunday?',
}, b._auth);
assert.equal(mB.status, 201);

// A authors a connection plan on the shared introduction.
const plan = await api('POST', `/api/introductions/${introId}/plan`, {
  format: 'message', timeText: 'Sunday 8am', expectations: 'A quiet check-in to start.',
}, a._auth);
assert.equal(plan.status, 200);

// A blocks B.
const block = await api('POST', '/api/blocks', { blockedId: b.id }, a._auth);
assert.equal(block.status, 201);

// Agents: one operated by A, one by B.
const agentA = await api('POST', '/api/agents', {
  name: 'Ada Agent',
  description: 'A gentle dream-work companion.',
  capabilities: ['dream exploration'],
  trustNote: 'I built this agent and vouch for its calm approach.',
}, a._auth);
assert.equal(agentA.status, 201);
const agentB = await api('POST', '/api/agents', {
  name: 'Bea Agent',
  description: 'A breathwork timer companion.',
  capabilities: ['breathwork timing'],
  trustNote: 'I built this agent and vouch for its steady rhythm.',
}, b._auth);
assert.equal(agentB.status, 201);

// A reports B.
const rep = await api('POST', '/api/reports', {
  reportedId: b.id, reason: 'spam', details: 'Sent me an identical pitch twice.',
}, a._auth);
assert.equal(rep.status, 201);

// Saved items for both.
const saveA = await api('POST', '/api/discover/save', { kind: 'match', refId: String(b.id) }, a._auth);
assert.equal(saveA.status, 200);
const saveB = await api('POST', '/api/discover/save', { kind: 'match', refId: String(a.id) }, b._auth);
assert.equal(saveB.status, 200);

// Circles: one created by A (B joins), one created by B (A joins).
const circleA = await api('POST', '/api/circles', {
  name: 'Ada Circle', kind: 'meditation',
  purpose: 'A small weekly morning meditation circle for returning sitters.',
  privacy: 'request-to-join', maxParticipants: 8,
}, a._auth);
assert.equal(circleA.status, 201);
const circleAId = circleA.json.circle.id;
const joinA = await api('POST', `/api/circles/${circleAId}/request`, {
  message: 'I would love to join.',
}, b._auth);
assert.equal(joinA.status, 201);
const pendingA = row('SELECT id FROM circle_requests WHERE circle_id = ? AND profile_id = ?', circleAId, b.id);
const approveA = await api('POST', `/api/circle-requests/${pendingA.id}/approve`, {}, a._auth);
assert.equal(approveA.status, 200);

const circleB = await api('POST', '/api/circles', {
  name: 'Bea Circle', kind: 'meditation',
  purpose: 'An evening breathwork circle for winding down together.',
  privacy: 'request-to-join', maxParticipants: 8,
}, b._auth);
assert.equal(circleB.status, 201);
const circleBId = circleB.json.circle.id;
const joinB = await api('POST', `/api/circles/${circleBId}/request`, {
  message: 'I would love to join your circle.',
}, a._auth);
assert.equal(joinB.status, 201);
const pendingB = row('SELECT id FROM circle_requests WHERE circle_id = ? AND profile_id = ?', circleBId, a.id);
const approveB = await api('POST', `/api/circle-requests/${pendingB.id}/approve`, {}, b._auth);
assert.equal(approveB.status, 200);

// Guide session + chat session owned by A.
const gs = await api('POST', '/api/guide/sessions', {
  text: 'I am hoping to find a calm meditation partner for weekday mornings.',
}, a._auth);
assert.equal(gs.status, 201);
const chat = await api('POST', '/api/chat/start', {}, a._auth);
assert.equal(chat.status, 201);

// A connection brief for A (inserted directly; deletion is what is tested).
db.prepare(`
  INSERT INTO briefs (profile_id, status, created_at, updated_at)
  VALUES (?, 'active', ?, ?)
`).run(a.id, new Date().toISOString(), new Date().toISOString());

// Sanity: the fixture web is in place before deletion.
assert.equal(count('SELECT COUNT(*) AS c FROM guide_sessions WHERE profile_id = ?', a.id), 1);
assert.equal(count('SELECT COUNT(*) AS c FROM chat_sessions WHERE profile_id = ?', a.id), 1);
assert.equal(count('SELECT COUNT(*) AS c FROM briefs WHERE profile_id = ?', a.id), 1);
assert.equal(count('SELECT COUNT(*) AS c FROM connection_plans WHERE created_by = ?', a.id), 1);
assert.equal(count('SELECT COUNT(*) AS c FROM messages WHERE sender_id = ?', a.id), 1);
assert.equal(count('SELECT COUNT(*) AS c FROM reports WHERE reporter_id = ?', a.id), 1);

// ---------- tests ----------

test('unauthenticated DELETE /api/profiles/me → 401', async () => {
  const r = await api('DELETE', '/api/profiles/me');
  assert.equal(r.status, 401);
  assert.equal(r.json.error.code, 'unauthorized');
});

test("C's token deletes C, never A (identity is token-bound)", async () => {
  const r = await api('DELETE', '/api/profiles/me', undefined, c._auth);
  assert.equal(r.status, 200);
  assert.equal(r.json.deleted, true);
  assert.equal(row('SELECT 1 AS one FROM profiles WHERE id = ?', c.id), undefined, 'C is gone');
  // A's session is untouched.
  const me = await api('GET', '/api/me', undefined, a._auth);
  assert.equal(me.status, 200);
  assert.equal(me.json.id, a.id);
});

test('A deletes their own profile and data', async () => {
  const r = await api('DELETE', '/api/profiles/me', undefined, a._auth);
  assert.equal(r.status, 200);
  assert.equal(r.json.deleted, true);
  // The dead session cookie is cleared on the way out.
  assert.ok(/seren_profile=;/.test(String(r.setCookie || '')), 'session cookie should be cleared');

  // A's profile row is gone; the token now 401s.
  assert.equal(row('SELECT 1 AS one FROM profiles WHERE id = ?', a.id), undefined);
  const me = await api('GET', '/api/me', undefined, a._auth);
  assert.equal(me.status, 401);
  const peek = await api('GET', `/api/profiles/${b.id}`, undefined, a._auth);
  assert.equal(peek.status, 401);

  // Introductions are closed out, never orphaned: accepted → ended.
  const intro = row('SELECT status FROM introductions WHERE id = ?', introId);
  assert.ok(intro, 'the introduction row must survive');
  assert.equal(intro.status, 'ended');
  // The earlier declined request keeps its terminal status.
  const declined = row('SELECT status FROM introductions WHERE id = ?', declinedIntroId);
  assert.ok(declined, 'the declined introduction row must survive');
  assert.equal(declined.status, 'declined');

  // B can still read the shared connection record.
  const list = await api('GET', '/api/introductions', undefined, b._auth);
  assert.equal(list.status, 200);
  const seen = (list.json.introductions || []).find((i) => i.id === introId);
  assert.ok(seen, 'B can still list the introduction');
  assert.equal(seen.status, 'ended');
  assert.equal(seen.other, null, 'the deleted side resolves to no profile view');

  // A's messages are gone at the row level; B's remain.
  assert.equal(count('SELECT COUNT(*) AS c FROM messages WHERE introduction_id = ? AND sender_id = ?', introId, a.id), 0);
  const bMsg = row('SELECT body FROM messages WHERE introduction_id = ? AND sender_id = ?', introId, b.id);
  assert.ok(bMsg && bMsg.body.includes('Mornings suit me too'), "B's own message survives");
  assert.equal(count('SELECT COUNT(*) AS c FROM messages WHERE sender_id = ?', a.id), 0);
  assert.equal(count('SELECT COUNT(*) AS c FROM messages WHERE sender_id = ?', b.id), 1);

  // Decline blocks, blocks, saved items, passes involving A are gone.
  assert.equal(count('SELECT COUNT(*) AS c FROM decline_blocks WHERE decliner_id = ? OR requester_id = ?', a.id, a.id), 0);
  assert.equal(count('SELECT COUNT(*) AS c FROM blocks WHERE blocker_id = ? OR blocked_id = ?', a.id, a.id), 0);
  assert.equal(count('SELECT COUNT(*) AS c FROM saved_items WHERE profile_id = ?', a.id), 0);
  assert.equal(count('SELECT COUNT(*) AS c FROM passes WHERE profile_id = ? OR passed_id = ?', a.id, a.id), 0);

  // A's agent registration is deleted; B's agent is intact.
  assert.equal(row('SELECT 1 AS one FROM agents WHERE id = ?', agentA.json.id), undefined);
  const agentBRow = row('SELECT * FROM agents WHERE id = ?', agentB.json.id);
  assert.ok(agentBRow, "B's agent survives");
  assert.equal(agentBRow.name, 'Bea Agent');

  // Reports involving A are gone (FK cascade fires on profile delete).
  assert.equal(count('SELECT COUNT(*) AS c FROM reports WHERE reporter_id = ? OR reported_id = ?', a.id, a.id), 0);

  // Guide/chat sessions, brief, and authored connection plan are gone.
  assert.equal(count('SELECT COUNT(*) AS c FROM guide_sessions WHERE profile_id = ?', a.id), 0);
  assert.equal(count('SELECT COUNT(*) AS c FROM chat_sessions WHERE profile_id = ?', a.id), 0);
  assert.equal(count('SELECT COUNT(*) AS c FROM briefs WHERE profile_id = ?', a.id), 0);
  assert.equal(count('SELECT COUNT(*) AS c FROM connection_plans WHERE created_by = ?', a.id), 0);

  // Circles: the circle A created is removed with them; B's circle keeps
  // B but loses A's membership and request rows.
  assert.equal(row('SELECT 1 AS one FROM circles WHERE id = ?', circleAId), undefined);
  assert.ok(row('SELECT 1 AS one FROM circles WHERE id = ?', circleBId), "B's circle survives");
  assert.equal(count('SELECT COUNT(*) AS c FROM circle_members WHERE profile_id = ?', a.id), 0);
  assert.equal(count('SELECT COUNT(*) AS c FROM circle_requests WHERE profile_id = ?', a.id), 0);
  assert.equal(count('SELECT COUNT(*) AS c FROM circle_members WHERE circle_id = ? AND profile_id = ?', circleBId, b.id), 1);

  // B's own data is intact: profile, saved item, agent, membership.
  assert.ok(row('SELECT 1 AS one FROM profiles WHERE id = ?', b.id));
  assert.equal(count('SELECT COUNT(*) AS c FROM saved_items WHERE profile_id = ?', b.id), 1);
  const meB = await api('GET', '/api/me', undefined, b._auth);
  assert.equal(meB.status, 200);
  assert.equal(meB.json.id, b.id);
});

test('a dead token just 401s on a second delete (no id to target)', async () => {
  // A's token is already dead: the second delete is just unauthorized.
  const r = await api('DELETE', '/api/profiles/me', undefined, a._auth);
  assert.equal(r.status, 401);
});
