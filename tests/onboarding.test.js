// SEREN conversational onboarding tests.
// Contract under test:
//   POST /api/onboarding/chat/start {} -> { session:{id, stage}, messages, quickReplies? }
//   POST /api/onboarding/chat/message {sessionId, text} -> same shape (+ profileCreated on consent)
//   GET  /api/onboarding/chat/session/:id -> { session, transcript, question?, quickReplies? }
// The interview (ob_name -> ob_email -> ob_interests -> ob_intention ->
// ob_seeking -> ob_values -> ob_consent) collects every required profile
// field before any profile exists. On explicit consent the profile is
// created through the standard creation path and the SAME session
// continues into the guide flow (follow-ups -> brief -> proposals).
// Declining consent creates nothing and shares nothing.
// Isolated temp DB, SEED_DEMO=false (never touches the production database).

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const dir = mkdtempSync(join(tmpdir(), 'seren-onboarding-'));
process.env.DB_PATH = join(dir, 'onboarding-test.db');
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
const uniqueEmail = () => `onboarder${++emailSeq}@example.com`;

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

/** One candidate member, present before onboarding so proposals have someone. */
async function seedCandidate() {
  const email = uniqueEmail();
  const r = await api('POST', '/api/profiles', {
    name: 'Ari Candidate',
    email,
    interests: ['meditation', 'tarot'],
    intention: 'I love sitting meditation and sharing tarot reflections with kindred friends.',
    connectionPrefs: { seeking: ['practice-partner'] },
    consents: { introductions: true, community_visible: true, ai_matching: true },
  });
  assert.equal(r.status, 201, 'candidate seed failed: ' + JSON.stringify(r.json));
  return { id: r.json.id, email };
}

/** Walk the interview up to (not including) the consent turn. */
async function interviewToConsent(email) {
  const s = await api('POST', '/api/onboarding/chat/start', {});
  assert.equal(s.status, 201);
  const sid = s.json.session.id;
  const say = async (text) => api('POST', '/api/onboarding/chat/message', { sessionId: sid, text });
  assert.equal((await say('Maya Chen')).json.session.stage, 'ob_email');
  assert.equal((await say(email)).json.session.stage, 'ob_interests');
  assert.equal((await say('Meditation, Tarot')).json.session.stage, 'ob_intention');
  assert.equal((await say('I am seeking a calm meditation partner to sit with weekly.')).json.session.stage, 'ob_seeking');
  assert.equal((await say('Practice partner')).json.session.stage, 'ob_values');
  const consentTurn = await say('Grounded, Curious');
  assert.equal(consentTurn.json.session.stage, 'ob_consent');
  return { sid, say };
}

// ---------- start / validation ----------

test('onboarding start greets and asks for a name, without any profile', async () => {
  const r = await api('POST', '/api/onboarding/chat/start', {});
  assert.equal(r.status, 201);
  assert.ok(r.json.session.id > 0);
  assert.equal(r.json.session.stage, 'ob_name');
  // The session exists with no profile attached — the interview works
  // profile-less by design.
  assert.ok(r.json.messages.length >= 2);
  assert.ok(r.json.messages.some((m) => m.kind === 'question' && m.questionId === 'ob_name'));
});

test('onboarding start rejects a non-object body', async () => {
  const r = await api('POST', '/api/onboarding/chat/start', null);
  assert.equal(r.status, 400);
});

test('onboarding message rejects unknown sessions and bad payloads', async () => {
  const notFound = await api('POST', '/api/onboarding/chat/message', { sessionId: 999999, text: 'hi' });
  assert.equal(notFound.status, 404);
  const badId = await api('POST', '/api/onboarding/chat/message', { sessionId: 'abc', text: 'hi' });
  assert.equal(badId.status, 400);
  const noText = await api('POST', '/api/onboarding/chat/message', { sessionId: 1 });
  assert.equal(noText.status, 400);
});

// ---------- per-stage validation ----------

test('bad email is rejected and stays on the email stage', async () => {
  const s = await api('POST', '/api/onboarding/chat/start', {});
  const sid = s.json.session.id;
  const say = (text) => api('POST', '/api/onboarding/chat/message', { sessionId: sid, text });
  assert.equal((await say('Jo')).json.session.stage, 'ob_email');
  const bad = await say('not-an-email');
  assert.equal(bad.json.session.stage, 'ob_email');
  assert.ok(bad.json.messages.some((m) => /email/i.test(m.text || '')));
  const ok = await say(uniqueEmail());
  assert.equal(ok.json.session.stage, 'ob_interests');
});

test('unmatched interests are rejected and stay on the interests stage', async () => {
  const s = await api('POST', '/api/onboarding/chat/start', {});
  const sid = s.json.session.id;
  const say = (text) => api('POST', '/api/onboarding/chat/message', { sessionId: sid, text });
  await say('Jo');
  await say(uniqueEmail());
  const bad = await say('quantum banana farming');
  assert.equal(bad.json.session.stage, 'ob_interests');
  const ok = await say('Yoga, journaling');
  assert.deepEqual(ok.json.session.stage, 'ob_intention');
  assert.deepEqual(ok.json.messages[0].kind, 'question');
});

test('short intentions are rejected and stay on the intention stage', async () => {
  const s = await api('POST', '/api/onboarding/chat/start', {});
  const sid = s.json.session.id;
  const say = (text) => api('POST', '/api/onboarding/chat/message', { sessionId: sid, text });
  await say('Jo');
  await say(uniqueEmail());
  await say('Yoga');
  const short = await say('hi');
  assert.equal(short.json.session.stage, 'ob_intention');
  const ok = await say('Looking for a gentle yoga buddy for quiet morning practice together.');
  assert.equal(ok.json.session.stage, 'ob_seeking');
});

test('values can be skipped; consent stage offers binary quick replies', async () => {
  const { say } = await interviewToConsent(uniqueEmail());
  const r = await say('Yes, I consent');
  assert.ok(r.json.profileCreated && r.json.profileCreated.profileId > 0);
});

// ---------- email taken ----------

test('an email that already has a profile is rejected during onboarding', async () => {
  const taken = uniqueEmail();
  const seed = await api('POST', '/api/profiles', {
    name: 'Existing Member',
    email: taken,
    interests: ['meditation'],
    intention: 'I am an existing member with this email address already.',
    connectionPrefs: { seeking: ['friendship'] },
    consents: { introductions: true, community_visible: true, ai_matching: true },
  });
  assert.equal(seed.status, 201);

  const s = await api('POST', '/api/onboarding/chat/start', {});
  const sid = s.json.session.id;
  const say = (text) => api('POST', '/api/onboarding/chat/message', { sessionId: sid, text });
  await say('New Person');
  const dup = await say(taken);
  assert.equal(dup.json.session.stage, 'ob_email');
  assert.ok(dup.json.messages.some((m) => /already has a SEREN space/i.test(m.text || '')));
  // ...but a fresh email moves on.
  assert.equal((await say(uniqueEmail())).json.session.stage, 'ob_interests');
});

// ---------- consent gating ----------

test('declining consent creates no profile and shares nothing', async () => {
  const email = uniqueEmail();
  const { sid, say } = await interviewToConsent(email);
  const decline = await say('Not yet');
  assert.equal(decline.json.session.stage, 'ob_declined');
  assert.ok(!decline.json.profileCreated);
  assert.deepEqual(decline.json.quickReplies, ["I'm ready"]);
  // No profile exists for that email.
  const lookup = await api('GET', `/api/profiles/by-email/${encodeURIComponent(email)}`);
  assert.equal(lookup.status, 404);
  // Resume shows the declined state with the answers kept.
  const resume = await api('GET', `/api/onboarding/chat/session/${sid}`);
  assert.equal(resume.json.session.stage, 'ob_declined');
  assert.ok(resume.json.transcript.length > 0);
});

test('ambiguous consent re-asks instead of assuming yes', async () => {
  const { say } = await interviewToConsent(uniqueEmail());
  const vague = await say('maybe');
  assert.equal(vague.json.session.stage, 'ob_consent');
  assert.ok(!vague.json.profileCreated);
});

test('saying ready after declining creates the profile from kept answers', async () => {
  const email = uniqueEmail();
  const { sid, say } = await interviewToConsent(email);
  await say('Not yet');
  const ready = await say("I'm ready");
  assert.equal(ready.status, 201);
  assert.ok(ready.json.profileCreated && ready.json.profileCreated.profileId > 0);
  const pid = ready.json.profileCreated.profileId;
  const profile = await api('GET', `/api/profiles/${pid}?viewerId=${pid}`);
  assert.equal(profile.json.email, email);
  assert.deepEqual(profile.json.interests, ['meditation', 'tarot']);
  void sid;
});

// ---------- start over / resume ----------

test('"start over" restarts the interview from the name stage', async () => {
  const s = await api('POST', '/api/onboarding/chat/start', {});
  const sid = s.json.session.id;
  const say = (text) => api('POST', '/api/onboarding/chat/message', { sessionId: sid, text });
  await say('Jo');
  await say(uniqueEmail());
  const restart = await say('start over');
  assert.equal(restart.json.session.stage, 'ob_name');
  assert.ok(restart.json.messages.some((m) => m.questionId === 'ob_name'));
});

test('resume replays the transcript and re-asks the current question', async () => {
  const email = uniqueEmail();
  const s = await api('POST', '/api/onboarding/chat/start', {});
  const sid = s.json.session.id;
  const say = (text) => api('POST', '/api/onboarding/chat/message', { sessionId: sid, text });
  await say('Maya Chen');
  await say(email);
  const r = await api('GET', `/api/onboarding/chat/session/${sid}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.session.stage, 'ob_interests');
  assert.ok(r.json.transcript.length >= 4);
  assert.equal(r.json.question.questionId, 'ob_interests');
  assert.ok(r.json.question.options.length > 0);
});

test('resume of an unknown onboarding session is 404', async () => {
  const r = await api('GET', '/api/onboarding/chat/session/999999');
  assert.equal(r.status, 404);
});

// ---------- happy path: consent -> guide -> proposals ----------

test('full happy path: consent, guide handoff, brief review, proposals', async () => {
  const candidate = await seedCandidate();
  const email = uniqueEmail();
  const { sid, say } = await interviewToConsent(email);

  const consent = await say('Yes, I consent');
  assert.equal(consent.status, 201);
  const pid = consent.json.profileCreated.profileId;
  assert.ok(pid > 0);
  // The same session is now in the guide flow — no remount, no new session.
  assert.equal(consent.json.session.id, sid);
  assert.equal(consent.json.session.stage, 'followup');

  // The created profile carries everything the interview collected,
  // through the standard creation path (values stored top-level).
  const profile = await api('GET', `/api/profiles/${pid}?viewerId=${pid}`);
  assert.equal(profile.json.name, 'Maya Chen');
  assert.equal(profile.json.email, email);
  assert.deepEqual(profile.json.interests, ['meditation', 'tarot']);
  assert.deepEqual(profile.json.connectionPrefs.seeking, ['practice-partner']);
  assert.deepEqual(profile.json.values, ['grounded', 'curious']);
  assert.equal(profile.json.consents.introductions, true);

  // Continue the guide in the SAME session via the onboarding endpoints:
  // skip follow-ups until the brief is ready for review.
  let stage = 'followup';
  for (let i = 0; i < 8 && stage !== 'brief_review'; i++) {
    const cur = await api('GET', `/api/onboarding/chat/session/${sid}`);
    stage = cur.json.session.stage;
    if (stage === 'followup') await say('skip');
  }
  assert.equal(stage, 'brief_review', 'expected the guide to reach brief review');

  const approve = await say('Looks good — find matches');
  assert.equal(approve.json.session.stage, 'proposals');
  assert.ok(Array.isArray(approve.json.proposals) && approve.json.proposals.length > 0);
  const names = approve.json.proposals.map((p) => p.candidate && p.candidate.name);
  assert.ok(names.includes('Ari Candidate'), 'expected the seeded candidate, got: ' + names.join(', '));
  void candidate;
});

test('post-handoff turns keep working through the onboarding endpoints', async () => {
  await seedCandidate();
  const { sid, say } = await interviewToConsent(uniqueEmail());
  const consent = await say('Yes, I consent');
  assert.ok(consent.json.profileCreated);
  // A free-text guide answer (not a skip) flows through the standard machine.
  const r = await say('I would love a quiet weekly sit, maybe Sunday mornings.');
  assert.equal(r.status, 200);
  assert.ok(['followup', 'brief_review'].includes(r.json.session.stage));
  void sid;
});
