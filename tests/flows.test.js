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

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

async function createProfile(overrides = {}) {
  const { status, json } = await api('POST', '/api/profiles', profileBody(overrides));
  assert.equal(status, 201, `fixture profile creation should succeed: ${JSON.stringify(json)}`);
  return json;
}

async function sendRequest(requesterId, targetId, overrides = {}) {
  return api('POST', '/api/connections/request', {
    requesterId,
    targetId,
    connectionType: 'meditation-partner',
    message: 'I would love a calm weekly meditation sit together, if that feels aligned.',
    ...overrides,
  });
}

// ---------- tests ----------

test('privacy: stranger view hides email/consents; owner view shows them', async () => {
  const a = await createProfile({ name: 'Private Pam' });
  const b = await createProfile({ name: 'Stranger Sam' });

  const stranger = await api('GET', `/api/profiles/${a.id}?viewerId=${b.id}`);
  assert.equal(stranger.status, 200);
  assert.ok(!('email' in stranger.json));
  assert.ok(!('consents' in stranger.json));
  assert.equal(stranger.json.name, 'Private Pam');

  const owner = await api('GET', `/api/profiles/${a.id}?viewerId=${a.id}`);
  assert.equal(owner.status, 200);
  assert.ok(owner.json.email.includes('@example.com'));
});

test('connection request validation: short message, self-request, unknown type', async () => {
  const a = await createProfile();
  const b = await createProfile();

  const short = await sendRequest(a.id, b.id, { message: 'hi' });
  assert.equal(short.status, 400);
  assert.equal(short.json.error.code, 'validation_error');

  const self = await sendRequest(a.id, a.id);
  assert.equal(self.status, 400);

  const badType = await sendRequest(a.id, b.id, { connectionType: 'not-a-type' });
  assert.equal(badType.status, 400);
});

test('staged consent: question → accept_with_boundary; terminal states reject further responses', async () => {
  const a = await createProfile({ name: 'Asker Ann' });
  const b = await createProfile({ name: 'Responder Ron' });

  const req = await sendRequest(a.id, b.id);
  assert.equal(req.status, 201);
  const id = req.json.introduction.id;
  assert.equal(req.json.introduction.status, 'proposed');

  // Non-recipient cannot respond.
  const impostor = await api('POST', `/api/introductions/${id}/respond`, {
    profileId: a.id, response: 'accepted',
  });
  assert.equal(impostor.status, 403);

  // Recipient asks a question (stays actionable).
  const q = await api('POST', `/api/introductions/${id}/respond`, {
    profileId: b.id, response: 'question', note: 'What time of day suits you?',
  });
  assert.equal(q.status, 200);
  assert.equal(q.json.status, 'question');
  assert.equal(q.json.responderNote, 'What time of day suits you?');

  // Then accepts with a boundary (terminal).
  const acc = await api('POST', `/api/introductions/${id}/respond`, {
    profileId: b.id, response: 'accepted_with_boundary', note: 'Video only to start.',
  });
  assert.equal(acc.status, 200);
  assert.equal(acc.json.status, 'accepted_with_boundary');

  // Further responses are rejected.
  const again = await api('POST', `/api/introductions/${id}/respond`, {
    profileId: b.id, response: 'decline',
  });
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, 'invalid_transition');
});

test('decline paths: decline and decline_hidden are terminal; declined pairs are re-eligible', async () => {
  const a = await createProfile();
  const b = await createProfile();
  const c = await createProfile();

  const r1 = await sendRequest(a.id, b.id);
  const d1 = await api('POST', `/api/introductions/${r1.json.introduction.id}/respond`, {
    profileId: b.id, response: 'decline', note: 'Not the right time for me.',
  });
  assert.equal(d1.json.status, 'declined');

  const r2 = await sendRequest(a.id, c.id);
  const d2 = await api('POST', `/api/introductions/${r2.json.introduction.id}/respond`, {
    profileId: c.id, response: 'decline_hidden',
  });
  assert.equal(d2.json.status, 'declined_hidden');

  // After a decline, a fresh request is allowed.
  const r3 = await sendRequest(a.id, b.id);
  assert.equal(r3.status, 201);
});

test('messaging opens only after mutual acceptance; blocked pairs cannot message', async () => {
  const a = await createProfile({ name: 'Msg Ava' });
  const b = await createProfile({ name: 'Msg Ben' });

  const req = await sendRequest(a.id, b.id);
  const id = req.json.introduction.id;

  const early = await api('GET', `/api/introductions/${id}/messages?profileId=${a.id}`);
  assert.equal(early.status, 403);

  await api('POST', `/api/introductions/${id}/respond`, { profileId: b.id, response: 'accepted' });

  const send = await api('POST', `/api/introductions/${id}/messages`, {
    profileId: a.id, senderId: a.id, body: 'Hello, grateful to connect.',
  });
  assert.equal(send.status, 201);

  const thread = await api('GET', `/api/introductions/${id}/messages?profileId=${b.id}`);
  assert.equal(thread.status, 200);
  assert.equal(thread.json.messages.length, 1);
  assert.equal(thread.json.messages[0].body, 'Hello, grateful to connect.');

  // Block → messaging closed.
  await api('POST', '/api/blocks', { profileId: a.id, blockedId: b.id });
  const blocked = await api('POST', `/api/introductions/${id}/messages`, {
    profileId: b.id, senderId: b.id, body: 'Are you there?',
  });
  assert.equal(blocked.status, 403);
});

test('blocks remove the person from discover in both directions; unblock restores', async () => {
  const a = await createProfile({ name: 'Blocker Bea', practices: ['meditation'] });
  const b = await createProfile({ name: 'Blocked Bo', practices: ['meditation'] });

  const before = await api('GET', `/api/discover?profileId=${a.id}&limit=20`);
  assert.ok(before.json.matches.map((m) => m.profile.name).includes('Blocked Bo'));

  await api('POST', '/api/blocks', { profileId: a.id, blockedId: b.id });

  for (const pid of [a.id, b.id]) {
    const after = await api('GET', `/api/discover?profileId=${pid}&limit=20`);
    const other = pid === a.id ? 'Blocked Bo' : 'Blocker Bea';
    assert.ok(!after.json.matches.map((m) => m.profile.name).includes(other));
  }

  const list = await api('GET', `/api/blocks?profileId=${a.id}`);
  assert.ok(list.json.blocked.some((x) => x.name === 'Blocked Bo'));

  await api('DELETE', `/api/blocks/${b.id}?profileId=${a.id}`);
  const restored = await api('GET', `/api/discover?profileId=${a.id}&limit=20`);
  assert.ok(restored.json.matches.map((m) => m.profile.name).includes('Blocked Bo'));
});

test('discover: pass removes, save persists, practice filter narrows', async () => {
  const me = await createProfile({ name: 'Filter Fay', practices: ['meditation', 'yoga'] });
  const yoga = await createProfile({ name: 'Yoga Yara', practices: ['yoga'], intentions: ['meditation-partner'] });
  const breath = await createProfile({ name: 'Breath Bram', practices: ['breathwork'], intentions: ['meditation-partner'] });

  const filtered = await api('GET', `/api/discover?profileId=${me.id}&practice=yoga&limit=20`);
  const fnames = filtered.json.matches.map((m) => m.profile.name);
  assert.ok(fnames.includes('Yoga Yara'));
  assert.ok(!fnames.includes('Breath Bram'));

  await api('POST', '/api/discover/pass', { profileId: me.id, targetId: yoga.id });
  const afterPass = await api('GET', `/api/discover?profileId=${me.id}&limit=20`);
  assert.ok(!afterPass.json.matches.map((m) => m.profile.name).includes('Yoga Yara'));

  await api('POST', '/api/discover/save', { profileId: me.id, kind: 'match', refId: breath.id });
  const saved = await api('GET', `/api/saved?profileId=${me.id}`);
  assert.ok(saved.json.saved.some((s) => s.kind === 'match' && s.profile && s.profile.name === 'Breath Bram'));

  await api('DELETE', `/api/discover/save?profileId=${me.id}&kind=match&refId=${breath.id}`);
  const unsaved = await api('GET', `/api/saved?profileId=${me.id}`);
  assert.ok(!unsaved.json.saved.some((s) => s.kind === 'match'));
});

test('discover excludes paused profiles and existing pairs', async () => {
  const me = await createProfile({ name: 'Seeker Sol' });
  const paused = await createProfile({ name: 'Paused Pat' });
  await api('PATCH', `/api/profiles/${paused.id}`, { consentSettings: { paused: true } });

  const d = await api('GET', `/api/discover?profileId=${me.id}&limit=20`);
  assert.ok(!d.json.matches.map((m) => m.profile.name).includes('Paused Pat'));

  const other = await createProfile({ name: 'Paired Pam' });
  const req = await sendRequest(me.id, other.id);
  assert.equal(req.status, 201);
  const d2 = await api('GET', `/api/discover?profileId=${me.id}&limit=20`);
  assert.ok(!d2.json.matches.map((m) => m.profile.name).includes('Paired Pam'));
});

test('connection plans: create and read after acceptance', async () => {
  const a = await createProfile({ name: 'Plan Paul' });
  const b = await createProfile({ name: 'Plan Priya' });
  const req = await sendRequest(a.id, b.id);
  const id = req.json.introduction.id;
  await api('POST', `/api/introductions/${id}/respond`, { profileId: b.id, response: 'accepted' });

  const saved = await api('POST', `/api/introductions/${id}/plan`, {
    profileId: a.id, format: 'video', timeText: 'Sunday 8am ET', expectations: 'Quiet sit, no fixing.',
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.plan.format, 'video');

  const read = await api('GET', `/api/introductions/${id}/plan?profileId=${b.id}`);
  assert.equal(read.json.plan.timeText, 'Sunday 8am ET');
});

test('circles: create, request-to-join, host approve; invite-only is closed', async () => {
  const host = await createProfile({ name: 'Host Hal' });
  const guest = await createProfile({ name: 'Guest Gus' });

  const created = await api('POST', '/api/circles', {
    profileId: host.id,
    name: 'Dawn Sitters',
    kind: 'meditation',
    purpose: 'A small weekly morning meditation circle for returning sitters.',
    privacy: 'request-to-join',
    maxParticipants: 8,
  });
  assert.equal(created.status, 201);
  const cid = created.json.circle.id;

  const dir = await api('GET', `/api/circles?viewerId=${guest.id}`);
  assert.ok(dir.json.circles.some((c) => c.id === cid));

  const jr = await api('POST', `/api/circles/${cid}/request`, {
    profileId: guest.id, message: 'I would love to join.',
  });
  assert.equal(jr.status, 201);

  const detail = await api('GET', `/api/circles/${cid}?viewerId=${host.id}`);
  assert.equal(detail.json.pendingRequests.length, 1);

  const approved = await api('POST', `/api/circle-requests/${detail.json.pendingRequests[0].id}/approve`, {
    profileId: host.id,
  });
  assert.equal(approved.status, 200);

  const detail2 = await api('GET', `/api/circles/${cid}?viewerId=${guest.id}`);
  assert.ok(detail2.json.circle.isMember);
  assert.ok(detail2.json.members.some((m) => m.name === 'Guest Gus'));

  const secret = await api('POST', '/api/circles', {
    profileId: host.id,
    name: 'Quiet Council',
    kind: 'consciousness-salon',
    purpose: 'A closed council for deep dialogue among trusted members.',
    privacy: 'invite-only',
  });
  const scid = secret.json.circle.id;
  const joinAttempt = await api('POST', `/api/circles/${scid}/join`, { profileId: guest.id });
  assert.equal(joinAttempt.status, 403);
  const hidden = await api('GET', `/api/circles/${scid}?viewerId=${guest.id}`);
  assert.equal(hidden.status, 403);
});

test('reports are accepted', async () => {
  const reporter = await createProfile({ name: 'Reporter Rae' });
  const reported = await createProfile({ name: 'Reported Reg' });
  const r = await api('POST', '/api/reports', {
    reporterId: reporter.id,
    reportedId: reported.id,
    reason: 'harassment',
    details: 'Sent unkind messages.',
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.report.status, 'open');
  assert.ok(r.json.report.id > 0);
});

test('ending a connection closes messaging', async () => {
  const a = await createProfile({ name: 'Ender Eva' });
  const b = await createProfile({ name: 'Ender Eli' });
  const req = await sendRequest(a.id, b.id);
  const id = req.json.introduction.id;
  await api('POST', `/api/introductions/${id}/respond`, { profileId: b.id, response: 'accepted' });

  const ended = await api('POST', `/api/introductions/${id}/end`, { profileId: a.id });
  assert.equal(ended.status, 200);
  assert.equal(ended.json.status, 'ended');

  const msgs = await api('GET', `/api/introductions/${id}/messages?profileId=${a.id}`);
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
