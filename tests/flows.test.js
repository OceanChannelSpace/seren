// SEREN beta overhaul — tests for the new product flows:
// staged consent, privacy views, blocks, discover filters, messaging gates,
// circles, save/pass. Same harness as api.test.js (isolated temp DB, no seeds).

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const dir = mkdtempSync(join(tmpdir(), 'seren-flows-'));
process.env.DB_PATH = join(dir, 'flows-test.db');
process.env.SEED_DEMO = 'false';

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
const uniqueEmail = () => `flow${++emailSeq}@example.com`;

function profileBody(overrides = {}) {
  return {
    name: 'Flow Tester',
    email: uniqueEmail(),
    interests: ['meditation', 'breathwork'],
    intention: 'I am looking for a calm meditation partner for weekly practice.',
    connectionPrefs: { seeking: ['practice-partner'], availability: 'Evenings' },
    consents: { introductions: true, community_visible: true, ai_matching: true },
    practices: ['meditation', 'breathwork'],
    intentions: ['meditation-partner'],
    prefs: { localRemote: 'either', formats: ['message', 'video'], languages: ['English'] },
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
  return { status: res.status, json, setCookie: res.headers.get('set-cookie') };
}

function sessionCookie(setCookieHeader) {
  const m = /(?:^|,)\s*seren_profile=([^;]+)/.exec(String(setCookieHeader || ''));
  return m ? `seren_profile=${m[1]}` : null;
}

async function createProfile(overrides = {}) {
  const { status, json, setCookie } = await api('POST', '/api/profiles', profileBody(overrides));
  assert.equal(status, 201, `fixture profile creation should succeed: ${JSON.stringify(json)}`);
  return { ...json, _auth: sessionCookie(setCookie) };
}

async function sendRequest(requester, targetId, overrides = {}) {
  // The requester is the token-authenticated caller; no requesterId is sent.
  return api('POST', '/api/connections/request', {
    targetId,
    connectionType: 'meditation-partner',
    message: 'I would love a calm weekly meditation sit together, if that feels aligned.',
    ...overrides,
  }, requester);
}

// ---------- tests ----------

test('privacy: stranger view hides email/consents; owner view shows them', async () => {
  const a = await createProfile({ name: 'Private Pam' });
  const b = await createProfile({ name: 'Stranger Sam' });

  const stranger = await api('GET', `/api/profiles/${a.id}`, undefined, b);
  assert.equal(stranger.status, 200);
  assert.ok(!('email' in stranger.json));
  assert.ok(!('consents' in stranger.json));
  assert.equal(stranger.json.name, 'Private Pam');

  const owner = await api('GET', `/api/profiles/${a.id}`, undefined, a);
  assert.equal(owner.status, 200);
  assert.ok(owner.json.email.includes('@example.com'));
});

test('connection request validation: short message, self-request, unknown type', async () => {
  const a = await createProfile();
  const b = await createProfile();

  const short = await sendRequest(a, b.id, { message: 'hi' });
  assert.equal(short.status, 400);
  assert.equal(short.json.error.code, 'validation_error');

  const self = await sendRequest(a, a.id);
  assert.equal(self.status, 400);

  const badType = await sendRequest(a, b.id, { connectionType: 'not-a-type' });
  assert.equal(badType.status, 400);
});

test('staged consent: question → accept_with_boundary; terminal states reject further responses', async () => {
  const a = await createProfile({ name: 'Asker Ann' });
  const b = await createProfile({ name: 'Responder Ron' });

  const req = await sendRequest(a, b.id);
  assert.equal(req.status, 201);
  const id = req.json.introduction.id;
  assert.equal(req.json.introduction.status, 'proposed');

  // Non-recipient cannot respond.
  const impostor = await api('POST', `/api/introductions/${id}/respond`, { response: 'accepted',
  }, a);
  assert.equal(impostor.status, 403);

  // Recipient asks a question (stays actionable).
  const q = await api('POST', `/api/introductions/${id}/respond`, {
    response: 'question', note: 'What time of day suits you?',
  }, b);
  assert.equal(q.status, 200);
  assert.equal(q.json.status, 'question');
  assert.equal(q.json.responderNote, 'What time of day suits you?');

  // Then accepts with a boundary (terminal).
  const acc = await api('POST', `/api/introductions/${id}/respond`, {
    response: 'accepted_with_boundary', note: 'Video only to start.',
  }, b);
  assert.equal(acc.status, 200);
  assert.equal(acc.json.status, 'accepted_with_boundary');

  // Further responses are rejected.
  const again = await api('POST', `/api/introductions/${id}/respond`, {
    response: 'decline',
  }, b);
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, 'invalid_transition');
});

test('decline paths: decline and decline_hidden are terminal; declined pairs are blocked until the decliner allows them', async () => {
  const a = await createProfile();
  const b = await createProfile();
  const c = await createProfile();

  const r1 = await sendRequest(a, b.id);
  const d1 = await api('POST', `/api/introductions/${r1.json.introduction.id}/respond`, {
    response: 'decline', note: 'Not the right time for me.',
  }, b);
  assert.equal(d1.json.status, 'declined');

  const r2 = await sendRequest(a, c.id);
  const d2 = await api('POST', `/api/introductions/${r2.json.introduction.id}/respond`, {
    response: 'decline_hidden',
  }, c);
  assert.equal(d2.json.status, 'declined_hidden');

  // After a decline, a fresh direct request is blocked.
  const r3 = await sendRequest(a, b.id);
  assert.equal(r3.status, 403);
  assert.equal(r3.json.error.code, 'declined_previously');

  // The decliner can lift the block; then requests flow again.
  const lift = await api('DELETE', `/api/decline-blocks/${a.id}`, undefined, b);
  assert.equal(lift.status, 200);
  assert.equal(lift.json.removed, true);
  const r4 = await sendRequest(a, b.id);
  assert.equal(r4.status, 201);
});

test('messaging opens only after mutual acceptance; blocked pairs cannot message', async () => {
  const a = await createProfile({ name: 'Msg Ava' });
  const b = await createProfile({ name: 'Msg Ben' });

  const req = await sendRequest(a, b.id);
  const id = req.json.introduction.id;

  const early = await api('GET', `/api/introductions/${id}/messages`, undefined, a);
  assert.equal(early.status, 403);

  await api('POST', `/api/introductions/${id}/respond`, { response: 'accepted' }, b);

  const send = await api('POST', `/api/introductions/${id}/messages`, {
    senderId: a.id, body: 'Hello, grateful to connect.',
  }, a);
  assert.equal(send.status, 201);

  const thread = await api('GET', `/api/introductions/${id}/messages`, undefined, b);
  assert.equal(thread.status, 200);
  // The conversation header needs the other participant's privacy-aware
  // view — b should see a's name, never a "Someone" fallback.
  assert.ok(thread.json.introduction.other, 'messages endpoint attaches the other participant view');
  assert.equal(thread.json.introduction.other.name, 'Msg Ava');
  // SEREN posts a warm-intro system message on acceptance, then the user message.
  assert.equal(thread.json.messages.length, 2);
  assert.equal(thread.json.messages[0].senderId, 0);
  assert.ok(thread.json.messages[0].body.includes('A warm hello from SEREN'));
  assert.ok(thread.json.messages[0].body.includes('have both said yes'));
  assert.ok(thread.json.messages[0].body.includes('A gentle first step:'));
  assert.equal(thread.json.messages[1].body, 'Hello, grateful to connect.');

  // Block → messaging closed.
  await api('POST', '/api/blocks', { blockedId: b.id }, a);
  const blocked = await api('POST', `/api/introductions/${id}/messages`, {
    senderId: b.id, body: 'Are you there?',
  }, b);
  assert.equal(blocked.status, 403);
});

test('blocks remove the person from discover in both directions; unblock restores', async () => {
  const a = await createProfile({ name: 'Blocker Bea', practices: ['meditation'] });
  const b = await createProfile({ name: 'Blocked Bo', practices: ['meditation'] });

  const before = await api('GET', '/api/discover?limit=20', undefined, a);
  assert.ok(before.json.matches.map((m) => m.profile.name).includes('Blocked Bo'));

  await api('POST', '/api/blocks', { blockedId: b.id }, a);

  for (const p of [a, b]) {
    const after = await api('GET', '/api/discover?limit=20', undefined, p);
    const other = p.id === a.id ? 'Blocked Bo' : 'Blocker Bea';
    assert.ok(!after.json.matches.map((m) => m.profile.name).includes(other));
  }

  const list = await api('GET', '/api/blocks', undefined, a);
  assert.ok(list.json.blocked.some((x) => x.name === 'Blocked Bo'));

  await api('DELETE', `/api/blocks/${b.id}`, undefined, a);
  const restored = await api('GET', '/api/discover?limit=20', undefined, a);
  assert.ok(restored.json.matches.map((m) => m.profile.name).includes('Blocked Bo'));
});

test('discover: pass removes, save persists, practice filter narrows', async () => {
  const me = await createProfile({ name: 'Filter Fay', practices: ['meditation', 'yoga'] });
  const yoga = await createProfile({ name: 'Yoga Yara', practices: ['yoga'], intentions: ['meditation-partner'] });
  const breath = await createProfile({ name: 'Breath Bram', practices: ['breathwork'], intentions: ['meditation-partner'] });

  const filtered = await api('GET', '/api/discover?practice=yoga&limit=20', undefined, me);
  const fnames = filtered.json.matches.map((m) => m.profile.name);
  assert.ok(fnames.includes('Yoga Yara'));
  assert.ok(!fnames.includes('Breath Bram'));

  await api('POST', '/api/discover/pass', { targetId: yoga.id }, me);
  const afterPass = await api('GET', '/api/discover?limit=20', undefined, me);
  assert.ok(!afterPass.json.matches.map((m) => m.profile.name).includes('Yoga Yara'));

  await api('POST', '/api/discover/save', { kind: 'match', refId: breath.id }, me);
  const saved = await api('GET', '/api/saved', undefined, me);
  assert.ok(saved.json.saved.some((s) => s.kind === 'match' && s.profile && s.profile.name === 'Breath Bram'));

  await api('DELETE', `/api/discover/save?kind=match&refId=${breath.id}`, undefined, me);
  const unsaved = await api('GET', '/api/saved', undefined, me);
  assert.ok(!unsaved.json.saved.some((s) => s.kind === 'match'));
});

test('discover excludes paused profiles and existing pairs', async () => {
  const me = await createProfile({ name: 'Seeker Sol' });
  const paused = await createProfile({ name: 'Paused Pat' });
  await api('PATCH', `/api/profiles/${paused.id}`, { consentSettings: { paused: true } }, paused);

  const d = await api('GET', '/api/discover?limit=20', undefined, me);
  assert.ok(!d.json.matches.map((m) => m.profile.name).includes('Paused Pat'));

  const other = await createProfile({ name: 'Paired Pam' });
  const req = await sendRequest(me, other.id);
  assert.equal(req.status, 201);
  const d2 = await api('GET', '/api/discover?limit=20', undefined, me);
  assert.ok(!d2.json.matches.map((m) => m.profile.name).includes('Paired Pam'));
});

test('connection plans: create and read after acceptance', async () => {
  const a = await createProfile({ name: 'Plan Paul' });
  const b = await createProfile({ name: 'Plan Priya' });
  const req = await sendRequest(a, b.id);
  const id = req.json.introduction.id;
  await api('POST', `/api/introductions/${id}/respond`, { response: 'accepted' }, b);

  const saved = await api('POST', `/api/introductions/${id}/plan`, {
    format: 'video', timeText: 'Sunday 8am ET', expectations: 'Quiet sit, no fixing.',
  }, a);
  assert.equal(saved.status, 200);
  assert.equal(saved.json.plan.format, 'video');

  const read = await api('GET', `/api/introductions/${id}/plan`, undefined, b);
  assert.equal(read.json.plan.timeText, 'Sunday 8am ET');
});

test('circles: create, request-to-join, host approve; invite-only is closed', async () => {
  const host = await createProfile({ name: 'Host Hal' });
  const guest = await createProfile({ name: 'Guest Gus' });

  const created = await api('POST', '/api/circles', {
    name: 'Dawn Sitters',
    kind: 'meditation',
    purpose: 'A small weekly morning meditation circle for returning sitters.',
    privacy: 'request-to-join',
    maxParticipants: 8,
  }, host);
  assert.equal(created.status, 201);
  const cid = created.json.circle.id;

  const dir = await api('GET', '/api/circles', undefined, guest);
  assert.ok(dir.json.circles.some((c) => c.id === cid));

  const jr = await api('POST', `/api/circles/${cid}/request`, {
    message: 'I would love to join.',
  }, guest);
  assert.equal(jr.status, 201);

  const detail = await api('GET', `/api/circles/${cid}`, undefined, host);
  assert.equal(detail.json.pendingRequests.length, 1);

  const approved = await api('POST', `/api/circle-requests/${detail.json.pendingRequests[0].id}/approve`, {}, host);
  assert.equal(approved.status, 200);

  const detail2 = await api('GET', `/api/circles/${cid}`, undefined, guest);
  assert.ok(detail2.json.circle.isMember);
  assert.ok(detail2.json.members.some((m) => m.name === 'Guest Gus'));

  const secret = await api('POST', '/api/circles', {
    name: 'Quiet Council',
    kind: 'consciousness-salon',
    purpose: 'A closed council for deep dialogue among trusted members.',
    privacy: 'invite-only',
  }, host);
  const scid = secret.json.circle.id;
  const joinAttempt = await api('POST', `/api/circles/${scid}/join`, {}, guest);
  assert.equal(joinAttempt.status, 403);
  const hidden = await api('GET', `/api/circles/${scid}`, undefined, guest);
  assert.equal(hidden.status, 403);
});

test('reports are accepted', async () => {
  const reporter = await createProfile({ name: 'Reporter Rae' });
  const reported = await createProfile({ name: 'Reported Reg' });
  const r = await api('POST', '/api/reports', {
    reportedId: reported.id,
    reason: 'harassment',
    details: 'Sent unkind messages.',
  }, reporter);
  assert.equal(r.status, 201);
  assert.equal(r.json.report.status, 'open');
  assert.ok(r.json.report.id > 0);
});

test('ending a connection closes messaging', async () => {
  const a = await createProfile({ name: 'Ender Eva' });
  const b = await createProfile({ name: 'Ender Eli' });
  const req = await sendRequest(a, b.id);
  const id = req.json.introduction.id;
  await api('POST', `/api/introductions/${id}/respond`, { response: 'accepted' }, b);

  const ended = await api('POST', `/api/introductions/${id}/end`, {}, a);
  assert.equal(ended.status, 200);
  assert.equal(ended.json.status, 'ended');

  const msgs = await api('GET', `/api/introductions/${id}/messages`, undefined, a);
  assert.equal(msgs.status, 403);
});

test('meta endpoint exposes the product taxonomy without romantic exploration', async () => {
  const { status, json } = await api('GET', '/api/meta');
  assert.equal(status, 200);
  assert.ok(json.connectionTypes.length >= 20);
  assert.ok(!json.connectionTypes.some((t) => t.value === 'romantic-exploration'));
  assert.ok(json.practices.length >= 20);
  assert.ok(json.intentions.length >= 10);
  assert.ok(json.requestTemplates.length >= 3);
  assert.ok(json.exploreTopics.length >= 5);
});
