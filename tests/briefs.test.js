// SEREN — connection briefs, bilateral proposals, warm introductions.
// API tests with an isolated temp DB (SEED_DEMO=false).

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const dir = mkdtempSync(join(tmpdir(), 'seren-briefs-'));
process.env.DB_PATH = join(dir, 'briefs-test.db');
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
const uniqueEmail = () => `briefer${++emailSeq}@example.com`;

function profileBody(overrides = {}) {
  return {
    name: 'Brief Tester',
    email: uniqueEmail(),
    interests: ['meditation', 'dreamwork'],
    intention: 'I want to explore dreamwork and symbolism with a thoughtful peer.',
    connectionPrefs: { seeking: ['practice-partner'], availability: 'Evenings' },
    consents: { introductions: true, community_visible: true, ai_matching: true },
    practices: ['dreamwork', 'journaling'],
    intentions: ['dreamwork-symbolism'],
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
  assert.equal(status, 201, 'fixture profile creation should succeed');
  return json;
}

/** Start a guide session and answer/skip every open question; returns the session id. */
async function completeSession(profileId, text = 'I want to explore dreamwork and symbolism with a thoughtful peer.') {
  const start = await api('POST', '/api/guide/sessions', { profileId, text });
  assert.equal(start.status, 201);
  const sid = start.json.session.id;
  let last = null;
  for (const q of start.json.session.questions) {
    const r = await api('POST', `/api/guide/sessions/${sid}/answer`, {
      profileId, questionId: q.id, value: 'A few honest words.',
    });
    assert.equal(r.status, 200);
    last = r.json;
  }
  assert.equal(last.complete, true);
  return sid;
}

async function makeActiveBrief(profileId, overrides = {}) {
  const sid = await completeSession(profileId);
  const created = await api('POST', '/api/briefs', { profileId, sessionId: sid });
  assert.ok([200, 201].includes(created.status), JSON.stringify(created.json));
  const approved = await api('POST', `/api/briefs/${created.json.brief.id}/approve`, {
    profileId,
    shared_text: 'Test Seeker is hoping to find a thoughtful dreamwork peer. They can offer deep listening.',
    consent_save: true,
    consent_share: true,
    ...overrides,
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.json));
  return approved.json.brief;
}

// ---------- migration v4 ----------

test('migration v5: briefs table, shared-text column, chat_sessions, user_version, sentinel', () => {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  assert.equal(version, 5);
  const briefCols = db.prepare('PRAGMA table_info(briefs)').all().map((r) => r.name);
  for (const c of ['id', 'profile_id', 'who_text', 'shared_text', 'consent_save', 'consent_share', 'status']) {
    assert.ok(briefCols.includes(c), `briefs missing column ${c}`);
  }
  const chatCols = db.prepare('PRAGMA table_info(chat_sessions)').all().map((r) => r.name);
  for (const c of ['id', 'profile_id', 'stage', 'transcript_json']) {
    assert.ok(chatCols.includes(c), `chat_sessions missing column ${c}`);
  }
  const introCols = db.prepare('PRAGMA table_info(introductions)').all().map((r) => r.name);
  assert.ok(introCols.includes('requester_shared_text'));
  const profileCols = db.prepare('PRAGMA table_info(profiles)').all().map((r) => r.name);
  assert.ok(profileCols.includes('is_hidden'), 'profiles missing is_hidden');
  assert.ok(profileCols.includes('links_json'), 'profiles missing links_json');
  const sentinel = db.prepare('SELECT id, name FROM profiles WHERE id = 0').get();
  assert.ok(sentinel, 'SEREN connector sentinel profile should exist');
  // The sentinel is not a member and never appears in listings.
  const listed = db.prepare('SELECT COUNT(*) AS c FROM profiles WHERE id > 0').get().c;
  assert.equal(listed, db.prepare('SELECT COUNT(*) AS c FROM profiles').get().c - 1);
});

// ---------- brief lifecycle ----------

test('POST /api/briefs: creates a draft from a completed session', async () => {
  const me = await createProfile({ name: 'Drafter Dan' });
  const sid = await completeSession(me.id);
  const { status, json } = await api('POST', '/api/briefs', { profileId: me.id, sessionId: sid });
  assert.equal(status, 201);
  const b = json.brief;
  assert.equal(b.profile_id, me.id);
  assert.equal(b.status, 'draft');
  assert.equal(b.consent_save, false);
  assert.equal(b.consent_share, false);
  assert.ok(b.who_text.includes('Drafter Dan'));
  assert.ok(b.intention_text.length > 10);
  assert.ok(b.offer_text.includes('A few honest words'));
  assert.ok(b.shared_text.length > 0 && b.shared_text.length <= 400);
  assert.equal(b.private_notes, '');

  // Replacing the draft returns 200 and resets consent.
  const sid2 = await completeSession(me.id, 'I want a meditation partner for quiet morning sits.');
  const again = await api('POST', '/api/briefs', { profileId: me.id, sessionId: sid2 });
  assert.equal(again.status, 200);
  assert.equal(again.json.brief.id, b.id);
});

test('POST /api/briefs: 404 for missing, foreign, or incomplete sessions', async () => {
  const me = await createProfile({ name: 'NoBrief' });
  const other = await createProfile({ name: 'OtherOwner' });
  const missing = await api('POST', '/api/briefs', { profileId: me.id, sessionId: 999999 });
  assert.equal(missing.status, 404);
  const otherSid = await completeSession(other.id);
  const foreign = await api('POST', '/api/briefs', { profileId: me.id, sessionId: otherSid });
  assert.equal(foreign.status, 404);
  const start = await api('POST', '/api/guide/sessions', {
    profileId: me.id, text: 'I want a meditation partner for quiet morning sits.',
  });
  const incomplete = await api('POST', '/api/briefs', { profileId: me.id, sessionId: start.json.session.id });
  assert.equal(incomplete.status, 404);
});

test('GET /api/briefs/mine: returns the brief or null', async () => {
  const me = await createProfile({ name: 'Mine Mia' });
  const empty = await api('GET', `/api/briefs/mine?profileId=${me.id}`);
  assert.equal(empty.status, 200);
  assert.equal(empty.json.brief, null);
  await makeActiveBrief(me.id);
  const got = await api('GET', `/api/briefs/mine?profileId=${me.id}`);
  assert.equal(got.json.brief.status, 'active');
  assert.equal(got.json.brief.consent_save, true);
});

test('PATCH /api/briefs/:id: owner edits; non-owner gets 403', async () => {
  const me = await createProfile({ name: 'Editor Ed' });
  const other = await createProfile({ name: 'Snoop Sue' });
  const sid = await completeSession(me.id);
  const created = await api('POST', '/api/briefs', { profileId: me.id, sessionId: sid });
  const id = created.json.brief.id;

  const patched = await api('PATCH', `/api/briefs/${id}`, {
    profileId: me.id, offer_text: 'I can offer dream-listening and tea.', private_notes: 'shy at first',
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.brief.offer_text, 'I can offer dream-listening and tea.');

  const snoop = await api('PATCH', `/api/briefs/${id}`, { profileId: other.id, offer_text: 'x' });
  assert.equal(snoop.status, 403);

  const badField = await api('PATCH', `/api/briefs/${id}`, { profileId: me.id, offer_text: 'x'.repeat(2001) });
  assert.equal(badField.status, 400);

  // Editing an active brief keeps it active.
  await api('POST', `/api/briefs/${id}/approve`, {
    profileId: me.id, shared_text: 'Editor Ed seeks a dreamwork peer.', consent_save: true,
  });
  const after = await api('PATCH', `/api/briefs/${id}`, { profileId: me.id, logistics_text: 'evenings' });
  assert.equal(after.json.brief.status, 'active');

  // A paused brief cannot be edited.
  await api('POST', `/api/briefs/${id}/pause`, { profileId: me.id });
  const pausedEdit = await api('PATCH', `/api/briefs/${id}`, { profileId: me.id, offer_text: 'y' });
  assert.equal(pausedEdit.status, 409);
});

test('approve: requires consent_save=true and 1–600 char shared_text', async () => {
  const me = await createProfile({ name: 'Approver Al' });
  const sid = await completeSession(me.id);
  const created = await api('POST', '/api/briefs', { profileId: me.id, sessionId: sid });
  const id = created.json.brief.id;

  const noConsent = await api('POST', `/api/briefs/${id}/approve`, {
    profileId: me.id, shared_text: 'Fine text.', consent_save: false,
  });
  assert.equal(noConsent.status, 400);

  const emptyShared = await api('POST', `/api/briefs/${id}/approve`, {
    profileId: me.id, shared_text: '   ', consent_save: true,
  });
  assert.equal(emptyShared.status, 400);

  const tooLong = await api('POST', `/api/briefs/${id}/approve`, {
    profileId: me.id, shared_text: 'x'.repeat(601), consent_save: true,
  });
  assert.equal(tooLong.status, 400);

  const ok = await api('POST', `/api/briefs/${id}/approve`, {
    profileId: me.id, shared_text: 'Approver Al seeks a dreamwork peer.', consent_save: true, consent_share: true,
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.brief.status, 'active');
  assert.equal(ok.json.brief.consent_share, true);

  const other = await createProfile({ name: 'Stranger Sam' });
  const snoop = await api('POST', `/api/briefs/${id}/approve`, {
    profileId: other.id, shared_text: 'Hijacked.', consent_save: true,
  });
  assert.equal(snoop.status, 403);
});

test('pause / resume / withdraw lifecycle', async () => {
  const me = await createProfile({ name: 'Cycler Cy' });
  const brief = await makeActiveBrief(me.id);

  const paused = await api('POST', `/api/briefs/${brief.id}/pause`, { profileId: me.id });
  assert.equal(paused.json.brief.status, 'paused');

  const resumed = await api('POST', `/api/briefs/${brief.id}/resume`, { profileId: me.id });
  assert.equal(resumed.json.brief.status, 'active', 'approved brief resumes to active');

  const withdrawn = await api('POST', `/api/briefs/${brief.id}/withdraw`, { profileId: me.id });
  assert.equal(withdrawn.json.brief.status, 'withdrawn');

  const resumeWithdrawn = await api('POST', `/api/briefs/${brief.id}/resume`, { profileId: me.id });
  assert.equal(resumeWithdrawn.status, 409);

  const approveWithdrawn = await api('POST', `/api/briefs/${brief.id}/approve`, {
    profileId: me.id, shared_text: 'Back again.', consent_save: true,
  });
  assert.equal(approveWithdrawn.status, 409);
});

test('resume of an unapproved (draft) brief returns to draft, never active', async () => {
  const me = await createProfile({ name: 'Drafty Dan' });
  const sid = await completeSession(me.id);
  const created = await api('POST', '/api/briefs', { profileId: me.id, sessionId: sid });
  const id = created.json.brief.id;
  await api('POST', `/api/briefs/${id}/pause`, { profileId: me.id });
  const resumed = await api('POST', `/api/briefs/${id}/resume`, { profileId: me.id });
  assert.equal(resumed.json.brief.status, 'draft');
  const gated = await api('GET', `/api/guide/proposals?profileId=${me.id}&sessionId=${sid}`);
  assert.equal(gated.status, 403, 'draft brief must not unlock proposals');
});

// ---------- proposals gating ----------

test('GET /api/guide/proposals: 403 without an active consent-saved brief', async () => {
  const me = await createProfile({ name: 'Gated Gus' });
  const sid = await completeSession(me.id);
  const gated = await api('GET', `/api/guide/proposals?profileId=${me.id}&sessionId=${sid}`);
  assert.equal(gated.status, 403);
  assert.equal(gated.json.error.code, 'consent_required');
});

test('GET /api/guide/proposals: active brief unlocks bilateral proposals', async () => {
  const me = await createProfile({
    name: 'Open Olive',
    interests: ['astrology'],
    intention: 'I want to discuss astrology and birth charts with a thoughtful peer.',
    practices: ['astrology'],
    intentions: ['astrology-discussion'],
  });
  const cand = await createProfile({
    name: 'Kind Kai',
    interests: ['astrology'],
    intention: 'I love discussing astrology and birth charts with thoughtful peers.',
    practices: ['astrology'],
    intentions: ['astrology-discussion'],
  });
  await makeActiveBrief(cand.id, {
    shared_text: 'Kind Kai is hoping to find an astrology peer for chart-rich conversation.',
  });
  const brief = await makeActiveBrief(me.id);
  const sid = await completeSession(me.id, 'I want to discuss astrology and birth charts with a thoughtful peer.');

  const { status, json } = await api('GET', `/api/guide/proposals?profileId=${me.id}&sessionId=${sid}`);
  assert.equal(status, 200, JSON.stringify(json));
  assert.ok(json.proposals.length >= 1);
  const p = json.proposals.find((x) => x.candidate.id === cand.id);
  assert.ok(p, 'candidate should be proposed');
  assert.ok(typeof p.whyItFits !== 'undefined' && p.whyItFits.length > 0);
  assert.ok(typeof p.forCandidate === 'string' && p.forCandidate.length > 0);
  assert.equal(p.candidateSharedText, 'Kind Kai is hoping to find an astrology peer for chart-rich conversation.');
  assert.ok(typeof p.suggestedFirstStep === 'string' && p.suggestedFirstStep.length > 20);
  assert.ok(typeof p.connectionType === 'string');
  assert.ok(!('email' in p.candidate));
  // pausing the brief re-locks proposals
  await api('POST', `/api/briefs/${brief.id}/pause`, { profileId: me.id });
  const relocked = await api('GET', `/api/guide/proposals?profileId=${me.id}&sessionId=${sid}`);
  assert.equal(relocked.status, 403);
});

// ---------- connections/request briefId ----------

test('POST /api/connections/request: briefId snapshots approved shared_text', async () => {
  const a = await createProfile({ name: 'Requester Rae' });
  const b = await createProfile({ name: 'Target Tom' });
  const brief = await makeActiveBrief(a.id, {
    shared_text: 'Requester Rae is hoping to find a dreamwork peer. They offer deep listening.',
  });

  const { status, json } = await api('POST', '/api/connections/request', {
    requesterId: a.id,
    targetId: b.id,
    connectionType: 'one-to-one-conversation',
    message: 'I would love a thoughtful first conversation about dreams.',
    briefId: brief.id,
  });
  assert.equal(status, 201, JSON.stringify(json));
  assert.equal(json.introduction.requesterSharedText, brief.shared_text);

  // The snapshot is visible on the introductions list; private notes never leak.
  const list = await api('GET', `/api/introductions?profileId=${b.id}`);
  const found = list.json.introductions.find((x) => x.id === json.introduction.id);
  assert.equal(found.requesterSharedText, brief.shared_text);
  assert.ok(!('private_notes' in found), 'private notes must not leak');
  assert.ok(!('privateNotes' in found), 'private notes must not leak');
});

test('POST /api/connections/request: briefId rejected when invalid or not shareable', async () => {
  const a = await createProfile({ name: 'BadBrief Bea' });
  const b = await createProfile({ name: 'Target2 Tim' });
  const c = await createProfile({ name: 'OtherOwner2' });

  const missing = await api('POST', '/api/connections/request', {
    requesterId: a.id, targetId: b.id, connectionType: 'one-to-one-conversation',
    message: 'I would love a thoughtful first conversation about dreams.', briefId: 999999,
  });
  assert.equal(missing.status, 403);

  const otherBrief = await makeActiveBrief(c.id);
  const foreign = await api('POST', '/api/connections/request', {
    requesterId: a.id, targetId: b.id, connectionType: 'one-to-one-conversation',
    message: 'I would love a thoughtful first conversation about dreams.', briefId: otherBrief.id,
  });
  assert.equal(foreign.status, 403);

  // Active but not approved for sharing → 403.
  const sid = await completeSession(a.id);
  const created = await api('POST', '/api/briefs', { profileId: a.id, sessionId: sid });
  await api('POST', `/api/briefs/${created.json.brief.id}/approve`, {
    profileId: a.id, shared_text: 'Not for sharing.', consent_save: true, consent_share: false,
  });
  const unshared = await api('POST', '/api/connections/request', {
    requesterId: a.id, targetId: b.id, connectionType: 'one-to-one-conversation',
    message: 'I would love a thoughtful first conversation about dreams.', briefId: created.json.brief.id,
  });
  assert.equal(unshared.status, 403);

  // Omitting briefId still works as before.
  const plain = await api('POST', '/api/connections/request', {
    requesterId: a.id, targetId: b.id, connectionType: 'one-to-one-conversation',
    message: 'I would love a thoughtful first conversation about dreams.',
  });
  assert.equal(plain.status, 201);
  assert.equal(plain.json.introduction.requesterSharedText, '');
});

// ---------- warm intro on accept ----------

test('respond accept posts a warm-intro system message; decline posts none', async () => {
  const a = await createProfile({ name: 'Warm Wendy' });
  const b = await createProfile({ name: 'KindKen Ken' });
  await makeActiveBrief(a.id, { shared_text: 'Warm Wendy is hoping to find a dreamwork peer. She offers deep listening.' });

  const req = await api('POST', '/api/connections/request', {
    requesterId: a.id, targetId: b.id, connectionType: 'one-to-one-conversation',
    message: 'I would love a thoughtful first conversation about dreams.',
  });
  const id = req.json.introduction.id;

  const acc = await api('POST', `/api/introductions/${id}/respond`, {
    profileId: b.id, response: 'accepted',
  });
  assert.equal(acc.status, 200);

  const thread = await api('GET', `/api/introductions/${id}/messages?profileId=${a.id}`);
  assert.equal(thread.status, 200);
  assert.equal(thread.json.messages.length, 1);
  const sys = thread.json.messages[0];
  assert.equal(sys.senderId, 0);
  assert.ok(sys.senderName.includes('SEREN'), `sender labeled as SEREN: ${sys.senderName}`);
  assert.ok(sys.body.includes('Warm') && sys.body.includes('KindKen'));
  assert.ok(sys.body.includes('Warm Wendy is hoping to find a dreamwork peer'));
  assert.ok(sys.body.includes('A gentle first step:'));
  assert.ok(!/perfect match|soulmate|meant to be/i.test(sys.body), 'no invented certainty');

  // A declined request leaves the thread untouched.
  const c = await createProfile({ name: 'Cooler Cole' });
  const req2 = await api('POST', '/api/connections/request', {
    requesterId: a.id, targetId: c.id, connectionType: 'one-to-one-conversation',
    message: 'I would love a thoughtful first conversation about dreams.',
  });
  const id2 = req2.json.introduction.id;
  await api('POST', `/api/introductions/${id2}/respond`, { profileId: c.id, response: 'decline' });
  const msgs = db.prepare('SELECT COUNT(*) AS c FROM messages WHERE introduction_id = ?').get(id2).c;
  assert.equal(msgs, 0, 'decline must not post a system message');
});

test('respond accepted_with_boundary also posts the warm-intro message', async () => {
  const a = await createProfile({ name: 'Steady Sue' });
  const b = await createProfile({ name: 'Gentle Gus' });
  const brief = await makeActiveBrief(a.id, { shared_text: 'Steady Sue seeks a dreamwork peer.' });
  const req = await api('POST', '/api/connections/request', {
    requesterId: a.id, targetId: b.id, connectionType: 'one-to-one-conversation',
    message: 'I would love a thoughtful first conversation about dreams.',
    briefId: brief.id,
  });
  const id = req.json.introduction.id;
  const r = await api('POST', `/api/introductions/${id}/respond`, {
    profileId: b.id, response: 'accepted_with_boundary', boundary: 'Text-only for the first chat.',
  });
  assert.equal(r.status, 200);
  const thread = await api('GET', `/api/introductions/${id}/messages?profileId=${a.id}`);
  assert.equal(thread.json.messages.length, 1);
  assert.equal(thread.json.messages[0].senderId, 0);
  assert.ok(thread.json.messages[0].body.includes('Steady Sue seeks a dreamwork peer.'));
});

// ---------- GET /api/briefs/:id/proposals (session-free, survives reload) ----------

test('GET /api/briefs/:id/proposals: 403 for a draft brief', async () => {
  const me = await createProfile({ name: 'Drafty Proposer' });
  const sid = await completeSession(me.id);
  const created = await api('POST', '/api/briefs', { profileId: me.id, sessionId: sid });
  const id = created.json.brief.id;
  const gated = await api('GET', `/api/briefs/${id}/proposals?profileId=${me.id}`);
  assert.equal(gated.status, 403);
  assert.equal(gated.json.error.code, 'consent_required');
});

test('GET /api/briefs/:id/proposals: active brief regenerates proposals without a session', async () => {
  const me = await createProfile({
    name: 'Reload Rita',
    interests: ['astrology'],
    intention: 'I want to discuss astrology and birth charts with a thoughtful peer.',
    practices: ['astrology'],
    intentions: ['astrology-discussion'],
  });
  const cand = await createProfile({
    name: 'Steady Sam',
    interests: ['astrology'],
    intention: 'I love discussing astrology and birth charts with thoughtful peers.',
    practices: ['astrology'],
    intentions: ['astrology-discussion'],
  });
  await makeActiveBrief(cand.id, {
    shared_text: 'Steady Sam is hoping to find an astrology peer for chart-rich conversation.',
  });
  const brief = await makeActiveBrief(me.id, {
    shared_text: 'Reload Rita is hoping to find an astrology peer.',
  });

  // No guide session involved — this is the post-reload path.
  const first = await api('GET', `/api/briefs/${brief.id}/proposals?profileId=${me.id}`);
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.ok(Array.isArray(first.json.proposals));
  const p = first.json.proposals.find((x) => x.candidate.id === cand.id);
  assert.ok(p, 'candidate should be proposed from the brief alone');
  assert.ok(p.whyItFits.length > 0);
  assert.ok(typeof p.forCandidate === 'string' && p.forCandidate.length > 0);
  assert.ok(!('email' in p.candidate), 'candidate email must not leak');
  assert.ok(!('private_notes' in p.candidate), 'private notes must not leak');

  // Regeneration is deterministic — a second load returns the same candidates.
  const second = await api('GET', `/api/briefs/${brief.id}/proposals?profileId=${me.id}`);
  assert.deepEqual(
    second.json.proposals.map((x) => x.candidate.id),
    first.json.proposals.map((x) => x.candidate.id),
  );

  // Pausing the brief re-locks the endpoint.
  await api('POST', `/api/briefs/${brief.id}/pause`, { profileId: me.id });
  const relocked = await api('GET', `/api/briefs/${brief.id}/proposals?profileId=${me.id}`);
  assert.equal(relocked.status, 403);
});

test('GET /api/briefs/:id/proposals: 403 for another profile\u2019s brief, 404 for missing', async () => {
  const me = await createProfile({ name: 'Owner Olga' });
  const other = await createProfile({ name: 'Stranger Sven' });
  const brief = await makeActiveBrief(me.id);
  const foreign = await api('GET', `/api/briefs/${brief.id}/proposals?profileId=${other.id}`);
  assert.equal(foreign.status, 403);
  const missing = await api('GET', `/api/briefs/999999/proposals?profileId=${me.id}`);
  assert.equal(missing.status, 404);
});
