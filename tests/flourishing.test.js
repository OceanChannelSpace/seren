// SEREN MVP — "Flourishing by Design" backend tests (v16).
// Outcome tracking, not engagement: weekly check-ins, per-introduction
// feedback, real-life intentions, host-only analytics, extended report
// categories, and the new consentSettings keys (recFrequency, quietHours).
// Spins up the real express app on an ephemeral port with an isolated temp
// SQLite DB (SEED_DEMO=false), BETA_CODE and SEREN_HOSTS set.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const dir = mkdtempSync(join(tmpdir(), 'seren-flourish-'));
process.env.DB_PATH = join(dir, 'flourish-test.db');
process.env.SEED_DEMO = 'false';
process.env.BETA_CODE = 'flourish-test-beta-code';
process.env.SEREN_HOSTS = 'host@example.com';

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
const uniqueEmail = (base = 'flourish') => `${base}${++emailSeq}@example.com`;

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
    body: JSON.stringify({ code: 'flourish-test-beta-code' }),
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
  return { id: data.id, cookie, beta };
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

const checkin = (member, payload) => api('POST', '/api/flourishing/checkin', payload, member.cookie);
const myCheckins = (member, profileId) =>
  api('GET', `/api/flourishing/checkins/mine?profileId=${profileId ?? member.id}`, undefined, member.cookie);

// ---------- fixtures ----------

const host = await createMember('Flourish Host', 'host@example.com');
const alice = await createMember('Flourish Alice', uniqueEmail('alice'));
const bob = await createMember('Flourish Bob', uniqueEmail('bob'));
const cara = await createMember('Flourish Cara', uniqueEmail('cara'));
const members = [host, alice, bob, cara];
const byId = new Map(members.map((m) => [m.id, m]));
/** A fixture member who is not a participant in the introduction. */
function outsiderFor(intro) {
  return members.find((m) => m.id !== intro.requesterId && m.id !== intro.proposedId);
}

// ---------- question set ----------

test('GET /api/flourishing/questions returns the exact question set', async () => {
  const r = await api('GET', '/api/flourishing/questions', undefined, alice.cookie);
  assert.equal(r.status, 200);
  const qs = r.data.questions;
  assert.equal(qs.length, 14);
  assert.deepEqual(qs.map((q) => q.key), [
    'real_world_action',
    // Gemini Advisor #5 (2026-10-10): 24-hour real-life completion metric.
    'next_24_hours',
    'connected', 'clarity_agency', 'pressure',
    'suggestion_volume', 'supportive_now', 'offline_time', 'ai_humility',
    'pause_autonomy',
    // Digital Sapiens layer: attention integrity questions.
    'net_attention', 'intentional_use', 'real_life_pull', 'pathways_reflection',
  ]);
  const kinds = Object.fromEntries(qs.map((q) => [q.key, q.kind]));
  assert.deepEqual(kinds, {
    real_world_action: 'yesno',
    next_24_hours: 'text',
    connected: 'scale1to5',
    clarity_agency: 'scale1to5',
    pressure: 'yesno',
    suggestion_volume: 'choice',
    supportive_now: 'text',
    offline_time: 'yesno',
    ai_humility: 'yesno',
    pause_autonomy: 'yesno',
    net_attention: 'choice',
    intentional_use: 'yesno',
    real_life_pull: 'yesno',
    pathways_reflection: 'text',
  });
  for (const q of qs) {
    assert.ok(typeof q.text === 'string' && q.text.length > 0, `question ${q.key} needs text`);
  }
  assert.equal(
    qs.find((q) => q.key === 'real_world_action').text,
    'Did SEREN help you take a meaningful action in the real world this week?',
  );
  const volume = qs.find((q) => q.key === 'suggestion_volume');
  assert.deepEqual(volume.choices, ['fewer', 'same', 'more']);
});

// ---------- check-in create / list ----------

test('POST /api/flourishing/checkin normalizes answers and lists newest first', async () => {
  const r = await checkin(alice, {
    profileId: alice.id,
    responses: [
      { questionKey: 'real_world_action', answer: 'Yes' },
      { questionKey: 'connected', answer: '4' },
      { questionKey: 'suggestion_volume', answer: 'More' },
      { questionKey: 'supportive_now', answer: 'A calm walking partner.' },
    ],
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.ok(r.data.checkin.id, 'checkin id present');
  assert.ok(r.data.checkin.createdAt, 'createdAt present');

  const list = await myCheckins(alice);
  assert.equal(list.status, 200);
  assert.equal(list.data.checkins.length, 4);
  const byKey = Object.fromEntries(list.data.checkins.map((c) => [c.questionKey, c.answer]));
  assert.equal(byKey.real_world_action, 'yes', 'yesno normalized to yes/no');
  assert.equal(byKey.connected, '4');
  assert.equal(byKey.suggestion_volume, 'more', 'choice normalized to lowercase');
  assert.equal(byKey.supportive_now, 'A calm walking partner.');
  // Newest first: ids descending.
  const ids = list.data.checkins.map((c) => c.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => b - a));
  for (const c of list.data.checkins) {
    assert.ok(c.createdAt, 'each row carries createdAt');
  }
});

test('check-in answers are isolated between profiles', async () => {
  const before = await myCheckins(bob);
  assert.equal(before.status, 200);
  assert.equal(before.data.checkins.length, 0, 'bob starts with no check-ins');

  await checkin(bob, {
    profileId: bob.id,
    responses: [{ questionKey: 'pressure', answer: 'no' }],
  });
  const bobList = await myCheckins(bob);
  assert.equal(bobList.data.checkins.length, 1);

  const aliceList = await myCheckins(alice);
  assert.equal(
    aliceList.data.checkins.filter((c) => c.questionKey === 'pressure').length,
    0,
    "bob's pressure answer is not visible to alice",
  );
});

test('check-in validation: shape, keys, answers, identity', async () => {
  // Empty responses.
  let r = await checkin(alice, { profileId: alice.id, responses: [] });
  assert.equal(r.status, 400);
  assert.equal(r.data.error.code, 'validation_error');

  // Unknown question key.
  r = await checkin(alice, {
    profileId: alice.id,
    responses: [{ questionKey: 'vibes', answer: 'yes' }],
  });
  assert.equal(r.status, 400);

  // Duplicate key in one submission.
  r = await checkin(alice, {
    profileId: alice.id,
    responses: [
      { questionKey: 'connected', answer: '3' },
      { questionKey: 'connected', answer: '4' },
    ],
  });
  assert.equal(r.status, 400);

  // Bad yesno / scale / choice answers.
  for (const bad of [
    { questionKey: 'real_world_action', answer: 'maybe' },
    { questionKey: 'connected', answer: '6' },
    { questionKey: 'connected', answer: 'high' },
    { questionKey: 'suggestion_volume', answer: 'lots' },
    { questionKey: 'supportive_now', answer: 'x'.repeat(2001) },
  ]) {
    r = await checkin(alice, { profileId: alice.id, responses: [bad] });
    assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
  }

  // Missing profileId.
  r = await checkin(alice, { responses: [{ questionKey: 'connected', answer: '3' }] });
  assert.equal(r.status, 400);

  // profileId belonging to someone else → 403.
  r = await checkin(alice, {
    profileId: bob.id,
    responses: [{ questionKey: 'connected', answer: '3' }],
  });
  assert.equal(r.status, 403);

  // No session at all (beta cookie only, no profile token) → 401.
  r = await api('POST', '/api/flourishing/checkin', {
    profileId: alice.id,
    responses: [{ questionKey: 'connected', answer: '3' }],
  }, alice.beta);
  assert.equal(r.status, 401);
});

test('GET /api/flourishing/checkins/mine rejects other profiles', async () => {
  const r = await myCheckins(alice, bob.id);
  assert.equal(r.status, 403);
  const missing = await api('GET', '/api/flourishing/checkins/mine', undefined, alice.cookie);
  assert.equal(missing.status, 400);
});

// ---------- introduction feedback ----------

async function makeIntroduction(requester, proposed) {
  const r = await api('POST', '/api/introductions/request', {
    intention: 'A calm weekly meditation sit together.',
  }, requester.cookie);
  assert.equal(r.status, 201, `intro request failed: ${JSON.stringify(r.data)}`);
  return r.data.introduction;
}

test('feedback: participant posts, duplicate 409s, outsider gets 403', async () => {
  const intro = await makeIntroduction(alice, bob);
  const requester = byId.get(intro.requesterId);
  const proposed = byId.get(intro.proposedId);
  const outsider = outsiderFor(intro);
  assert.ok(requester && proposed && outsider, 'need two participants and an outsider');

  // Requester posts feedback.
  let r = await api('POST', `/api/introductions/${intro.id}/feedback`, {
    profileId: requester.id, feltSafe: true, quality: 5, notes: 'Felt warm and unhurried.',
  }, requester.cookie);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.feedback.introductionId, intro.id);
  assert.equal(r.data.feedback.profileId, requester.id);
  assert.equal(r.data.feedback.feltSafe, true);
  assert.equal(r.data.feedback.quality, 5);
  assert.equal(r.data.feedback.notes, 'Felt warm and unhurried.');
  assert.ok(r.data.feedback.createdAt);

  // Duplicate by the same profile → 409 already_submitted.
  r = await api('POST', `/api/introductions/${intro.id}/feedback`, {
    profileId: requester.id, feltSafe: true,
  }, requester.cookie);
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'already_submitted');

  // The proposed side can still leave their own feedback (no quality).
  r = await api('POST', `/api/introductions/${intro.id}/feedback`, {
    profileId: proposed.id, feltSafe: false,
  }, proposed.cookie);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.feedback.feltSafe, false);
  assert.equal(r.data.feedback.quality, null);

  // An outsider is not a participant → 403.
  r = await api('POST', `/api/introductions/${intro.id}/feedback`, {
    profileId: outsider.id, feltSafe: true,
  }, outsider.cookie);
  assert.equal(r.status, 403);

  // Missing introduction → 404.
  r = await api('POST', '/api/introductions/999999/feedback', {
    profileId: requester.id, feltSafe: true,
  }, requester.cookie);
  assert.equal(r.status, 404);
});

test('feedback validation: feltSafe boolean, quality 1-5, notes ≤500', async () => {
  const intro = await makeIntroduction(bob, alice);
  const requester = byId.get(intro.requesterId);
  const proposed = byId.get(intro.proposedId);

  let r = await api('POST', `/api/introductions/${intro.id}/feedback`, {
    profileId: requester.id, feltSafe: 'yes',
  }, requester.cookie);
  assert.equal(r.status, 400);

  r = await api('POST', `/api/introductions/${intro.id}/feedback`, {
    profileId: requester.id, feltSafe: true, quality: 6,
  }, requester.cookie);
  assert.equal(r.status, 400);

  r = await api('POST', `/api/introductions/${intro.id}/feedback`, {
    profileId: requester.id, feltSafe: true, notes: 'x'.repeat(501),
  }, requester.cookie);
  assert.equal(r.status, 400);

  // profileId mismatch (proposed's cookie, requester's id) → 403.
  r = await api('POST', `/api/introductions/${intro.id}/feedback`, {
    profileId: requester.id, feltSafe: true,
  }, proposed.cookie);
  assert.equal(r.status, 403);
});

// ---------- real-life intention ----------

test('real-life intention: set and complete, participant-only', async () => {
  const intro = await makeIntroduction(cara, alice);
  const requester = byId.get(intro.requesterId);
  const proposed = byId.get(intro.proposedId);
  const outsider = outsiderFor(intro);
  assert.ok(requester && proposed && outsider);

  // Outsider cannot set.
  let r = await api('POST', `/api/introductions/${intro.id}/real-life-intention`, {
    profileId: outsider.id, intention: 'Meet for tea.',
  }, outsider.cookie);
  assert.equal(r.status, 403);

  // Participant sets.
  r = await api('POST', `/api/introductions/${intro.id}/real-life-intention`, {
    profileId: requester.id, intention: 'Take a silent walk together this weekend.',
  }, requester.cookie);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.introduction.realLifeIntention, 'Take a silent walk together this weekend.');
  assert.equal(r.data.introduction.intentionCompleted, false);

  // Validation: empty / too long.
  r = await api('POST', `/api/introductions/${intro.id}/real-life-intention`, {
    profileId: requester.id, intention: '   ',
  }, requester.cookie);
  assert.equal(r.status, 400);
  r = await api('POST', `/api/introductions/${intro.id}/real-life-intention`, {
    profileId: requester.id, intention: 'x'.repeat(301),
  }, requester.cookie);
  assert.equal(r.status, 400);

  // The other participant can complete it.
  r = await api('POST', `/api/introductions/${intro.id}/real-life-intention/complete`, {
    profileId: proposed.id,
  }, proposed.cookie);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.introduction.intentionCompleted, true);
  assert.equal(r.data.introduction.realLifeIntention, 'Take a silent walk together this weekend.');

  // Outsider cannot complete.
  r = await api('POST', `/api/introductions/${intro.id}/real-life-intention/complete`, {
    profileId: outsider.id,
  }, outsider.cookie);
  assert.equal(r.status, 403);
});

// ---------- host analytics ----------

test('GET /api/host/analytics: 403 for non-hosts, shaped metrics for hosts', async () => {
  const denied = await api('GET', '/api/host/analytics', undefined, alice.cookie);
  assert.equal(denied.status, 403);

  const anon = await api('GET', '/api/host/analytics', undefined, alice.beta);
  assert.equal(anon.status, 401);

  const r = await api('GET', '/api/host/analytics', undefined, host.cookie);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const a = r.data;
  for (const key of [
    'realWorldAction30d', 'introductionQuality', 'connectionGains',
    'offlineTime', 'safety', 'autonomy', 'aiHumility', 'computedAt',
  ]) {
    assert.ok(key in a, `analytics missing ${key}`);
  }
  assert.ok(typeof a.realWorldAction30d.pct === 'number');
  assert.ok(typeof a.realWorldAction30d.n === 'number');
  assert.ok('avgQuality' in a.introductionQuality);
  assert.ok(typeof a.introductionQuality.pctFeltSafe === 'number');
  assert.ok(typeof a.introductionQuality.n === 'number');
  assert.ok(typeof a.connectionGains.pct === 'number');
  assert.ok(typeof a.offlineTime.pct === 'number');
  assert.ok(typeof a.safety.incidents30d === 'number');
  assert.ok('avgResolutionHrs' in a.safety);
  assert.ok(typeof a.autonomy.pctPauseConfident === 'number');
  assert.ok(typeof a.aiHumility.pct === 'number');
  assert.ok(typeof a.computedAt === 'string');
  // Explicitly no engagement metrics.
  const blob = JSON.stringify(a).toLowerCase();
  for (const banned of ['dau', 'session time', 'message volume', 'streak']) {
    assert.ok(!blob.includes(banned), `analytics must not include engagement metric "${banned}"`);
  }
});

test('analytics reflect check-ins and feedback', async () => {
  // Self-contained: two fresh members answer, so the math below holds
  // regardless of what earlier tests recorded.
  const dave = await createMember('Flourish Dave', uniqueEmail('dave'));
  const erin = await createMember('Flourish Erin', uniqueEmail('erin'));
  byId.set(dave.id, dave);
  byId.set(erin.id, erin);
  for (const m of [dave, erin]) {
    const r = await checkin(m, {
      profileId: m.id,
      responses: [
        { questionKey: 'real_world_action', answer: 'yes' },
        { questionKey: 'connected', answer: '5' },
        { questionKey: 'offline_time', answer: 'yes' },
        { questionKey: 'pause_autonomy', answer: 'yes' },
        { questionKey: 'ai_humility', answer: 'no' },
      ],
    });
    assert.equal(r.status, 201, `checkin failed for ${m.id}: ${JSON.stringify(r.data)}`);
  }

  const r = await api('GET', '/api/host/analytics', undefined, host.cookie);
  assert.equal(r.status, 200);
  const a = r.data;
  assert.ok(a.realWorldAction30d.n >= 2, JSON.stringify(a.realWorldAction30d));
  assert.equal(a.realWorldAction30d.pct, 100, 'both answered yes');
  assert.equal(a.connectionGains.pct, 100, 'both answered connected=5 (>=4)');
  assert.equal(a.offlineTime.pct, 100);
  assert.equal(a.autonomy.pctPauseConfident, 100);
  assert.equal(a.aiHumility.pct, 0, 'both answered no');

  // Feedback math: quality 5 + quality 1 → avg 3; one felt safe of two.
  const intro = await makeIntroduction(erin, dave);
  const req = byId.get(intro.requesterId);
  const prop = byId.get(intro.proposedId);
  let f = await api('POST', `/api/introductions/${intro.id}/feedback`, {
    profileId: req.id, feltSafe: true, quality: 5,
  }, req.cookie);
  assert.equal(f.status, 201);
  f = await api('POST', `/api/introductions/${intro.id}/feedback`, {
    profileId: prop.id, feltSafe: false, quality: 1,
  }, prop.cookie);
  assert.equal(f.status, 201);

  const r2 = await api('GET', '/api/host/analytics', undefined, host.cookie);
  const q = r2.data.introductionQuality;
  assert.ok(q.n >= 2, JSON.stringify(q));
  assert.ok(q.avgQuality >= 1 && q.avgQuality <= 5, JSON.stringify(q));
  assert.ok(q.pctFeltSafe >= 0 && q.pctFeltSafe <= 100);
});

// ---------- report categories ----------

test('POST /api/reports accepts the new categories; old ones still work', async () => {
  for (const reason of ['unwanted_contact', 'manipulative_spiritual_claims', 'coercion',
    'exploitation', 'unsafe_event', 'harmful_ai_output']) {
    const r = await api('POST', '/api/reports', {
      reportedId: bob.id, reason, details: 'test report',
    }, alice.cookie);
    assert.equal(r.status, 201, `reason ${reason} failed: ${JSON.stringify(r.data)}`);
  }
  // Legacy categories keep working.
  const legacy = await api('POST', '/api/reports', {
    reportedId: bob.id, reason: 'spam',
  }, alice.cookie);
  assert.equal(legacy.status, 201);
  // Unknown reason still rejected.
  const bad = await api('POST', '/api/reports', {
    reportedId: bob.id, reason: 'not-a-reason',
  }, alice.cookie);
  assert.equal(bad.status, 400);
});

// ---------- consentSettings: recFrequency + quietHours ----------

test('PATCH consentSettings accepts recFrequency and quietHours', async () => {
  // Default is weekly when absent.
  const fresh = await api('GET', `/api/profiles/${alice.id}`, undefined, alice.cookie);
  assert.equal(fresh.status, 200);
  assert.equal(fresh.data.consentSettings.recFrequency, 'weekly');

  let r = await api('PATCH', `/api/profiles/${alice.id}`, {
    consentSettings: { recFrequency: 'daily', quietHours: { start: '22:00', end: '07:00' } },
  }, alice.cookie);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.consentSettings.recFrequency, 'daily');
  assert.deepEqual(r.data.consentSettings.quietHours, { start: '22:00', end: '07:00' });

  // Round-trips through GET.
  const again = await api('GET', `/api/profiles/${alice.id}`, undefined, alice.cookie);
  assert.equal(again.data.consentSettings.recFrequency, 'daily');
  assert.deepEqual(again.data.consentSettings.quietHours, { start: '22:00', end: '07:00' });

  // Other consent settings are untouched by the merge.
  assert.equal(again.data.consentSettings.paused, false);

  // quietHours can be cleared with null.
  r = await api('PATCH', `/api/profiles/${alice.id}`, {
    consentSettings: { quietHours: null },
  }, alice.cookie);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.consentSettings.quietHours, null);
  assert.equal(r.data.consentSettings.recFrequency, 'daily', 'recFrequency survives the merge');

  // Invalid values rejected.
  for (const bad of [
    { recFrequency: 'hourly' },
    { quietHours: { start: '25:00', end: '07:00' } },
    { quietHours: { start: '22:00' } },
    { quietHours: 'night' },
  ]) {
    r = await api('PATCH', `/api/profiles/${alice.id}`, { consentSettings: bad }, alice.cookie);
    assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(bad)}: ${r.status}`);
    assert.equal(r.data.error.code, 'validation_error');
  }
});
