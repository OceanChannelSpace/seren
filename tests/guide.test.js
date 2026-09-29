// SEREN guide engine tests: intent parsing, follow-up selection,
// session flow over HTTP, proposal privacy, and validation errors.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

import {
  parseIntent, selectFollowUps, answerQuestion, buildProposals,
  suggestedFirstStep, getQuestionDef,
} from '../src/guide.js';

const dir = mkdtempSync(join(tmpdir(), 'seren-guide-'));
process.env.DB_PATH = join(dir, 'guide-test.db');
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
const uniqueEmail = () => `guide${++emailSeq}@example.com`;

function profileBody(overrides = {}) {
  return {
    name: 'Guide Tester',
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
  assert.equal(status, 201, `profile create failed: ${JSON.stringify(json)}`);
  return json;
}

// ---------- parseIntent ----------

test('parseIntent: meditation text maps to the meditation practice', () => {
  const p = parseIntent('I am looking for someone to meditate with every morning, a grounded sitting practice.');
  assert.ok(p.practices.includes('meditation'), `practices: ${p.practices}`);
  assert.ok(p.intentions.includes('meditation-partner'), `intentions: ${p.intentions}`);
});

test('parseIntent: "local circle" gives localityHint local and a circle type', () => {
  const p = parseIntent('I would love to find a local circle for dreamwork near me.');
  assert.equal(p.localityHint, 'local');
  assert.ok(p.connectionTypes.includes('group-circle'), `types: ${p.connectionTypes}`);
  assert.ok(p.practices.includes('dreamwork'), `practices: ${p.practices}`);
});

test('parseIntent: dreamwork text maps to dreamwork practice and intention', () => {
  const p = parseIntent('I want to explore dreamwork and symbolism with someone thoughtful.');
  assert.ok(p.practices.includes('dreamwork'));
  assert.ok(p.intentions.includes('dreamwork-symbolism'));
  assert.ok(p.connectionTypes.includes('dreamwork-exchange'));
});

test('parseIntent: hints for format, commitment, and remote', () => {
  const p = parseIntent('Video chat please — I want a regular AI and consciousness discussion partner, online.');
  assert.equal(p.formatHint, 'video');
  assert.equal(p.commitmentHint, 'recurring');
  assert.equal(p.localityHint, 'remote');
  assert.ok(p.practices.includes('ai-consciousness'));
});

test('parseIntent: mentor/teacher maps to mentorship', () => {
  const p = parseIntent('I am looking for a mentor or teacher to learn from on the contemplative path.');
  assert.ok(p.intentions.includes('mentorship-learning'));
  assert.ok(p.connectionTypes.includes('mentor-request'));
});

test('parseIntent: collaborator/project maps to collaboration types', () => {
  const p = parseIntent('I am building a project and need aligned collaborators to create something meaningful.');
  assert.ok(p.intentions.includes('creative-collaboration'));
  assert.ok(p.connectionTypes.includes('project-collaborator'));
});

test('parseIntent: empty or empty-ish text returns empty structure', () => {
  const p = parseIntent('');
  assert.deepEqual(p.practices, []);
  assert.equal(p.localityHint, null);
});

// ---------- selectFollowUps ----------

test('selectFollowUps: infers format from "video chat please" — no format question', () => {
  const parsed = parseIntent('Video chat please — I want a meditation partner.');
  const profile = { prefs: { formats: [], localRemote: 'either' }, values: [] };
  const qs = selectFollowUps(parsed, profile);
  assert.ok(!qs.some((q) => q.id === 'format'), `questions: ${qs.map((q) => q.id)}`);
});

test('selectFollowUps: skips locality when profile already set it', () => {
  const parsed = parseIntent('I want a meditation partner.');
  const profile = { prefs: { formats: [], localRemote: 'local' }, values: [] };
  const qs = selectFollowUps(parsed, profile);
  assert.ok(!qs.some((q) => q.id === 'locality'), `questions: ${qs.map((q) => q.id)}`);
});

test('selectFollowUps: skips depth when profile already has values', () => {
  const parsed = parseIntent('I want a meditation partner.');
  const profile = { prefs: { formats: [], localRemote: 'either' }, values: ['grounded'] };
  const qs = selectFollowUps(parsed, profile);
  assert.ok(!qs.some((q) => q.id === 'depth'));
});

test('selectFollowUps: never returns more than 3 questions', () => {
  const parsed = parseIntent('I am curious and open.');
  const profile = { prefs: { formats: [], localRemote: 'either' }, values: [] };
  const qs = selectFollowUps(parsed, profile);
  assert.ok(qs.length <= 3, `got ${qs.length}`);
  assert.ok(qs.length > 0);
  for (const q of qs) {
    assert.ok(['offer', 'mutual', 'boundaries', 'format', 'locality', 'commitment', 'timing', 'depth'].includes(q.id));
    assert.equal(q.skippable, true);
    if (q.type === 'free') {
      assert.ok(!('options' in q), 'free-text questions carry no options');
    } else {
      assert.ok(Array.isArray(q.options) && q.options.length > 0);
    }
  }
});

test('selectFollowUps: free-text questions lead the priority order', () => {
  const parsed = parseIntent('I am curious and open.');
  const profile = { prefs: { formats: [], localRemote: 'either' }, values: [] };
  const qs = selectFollowUps(parsed, profile);
  assert.deepEqual(qs.map((q) => q.id), ['offer', 'mutual', 'boundaries']);
  assert.ok(qs.every((q) => q.type === 'free'));
});

test('getQuestionDef: depth is multi with max 3', () => {
  const d = getQuestionDef('depth');
  assert.equal(d.type, 'multi');
  assert.equal(d.max, 3);
  assert.deepEqual(d.options().map((o) => o.value),
    ['grounded', 'curious', 'reflective', 'playful', 'structured', 'open-hearted']);
});

// ---------- answerQuestion ----------

function openSession(questions) {
  return { answers: {}, questions };
}

test('answerQuestion: accepts a valid single answer', () => {
  const s = openSession([{ id: 'format' }]);
  const answers = answerQuestion(s, 'format', 'video');
  assert.deepEqual(answers, { format: 'video' });
});

test('answerQuestion: null means skip', () => {
  const s = openSession([{ id: 'locality' }]);
  const answers = answerQuestion(s, 'locality', null);
  assert.deepEqual(answers, { locality: null });
});

test('answerQuestion: rejects an invalid option', () => {
  const s = openSession([{ id: 'format' }]);
  assert.throws(() => answerQuestion(s, 'format', 'telepathy'), /not a valid option/);
});

test('answerQuestion: rejects a question not open in the session', () => {
  const s = openSession([{ id: 'format' }]);
  assert.throws(() => answerQuestion(s, 'locality', 'remote'), /not open/);
});

test('answerQuestion: depth accepts up to 3 values, rejects 4', () => {
  const s = openSession([{ id: 'depth' }]);
  const ok = answerQuestion(s, 'depth', ['grounded', 'curious']);
  assert.deepEqual(ok, { depth: ['grounded', 'curious'] });
  assert.throws(
    () => answerQuestion(s, 'depth', ['grounded', 'curious', 'reflective', 'playful']),
    /at most 3/,
  );
});

test('answerQuestion: free-text answers trim, cap at 500, empty skips', () => {
  const s = openSession([{ id: 'offer' }]);
  const ok = answerQuestion(s, 'offer', '  I can offer a listening ear.  ');
  assert.deepEqual(ok, { offer: 'I can offer a listening ear.' });
  const skipped = answerQuestion(s, 'offer', '   ');
  assert.deepEqual(skipped, { offer: null });
  assert.throws(() => answerQuestion(s, 'offer', 'x'.repeat(501)), /at most 500/);
  assert.throws(() => answerQuestion(s, 'offer', 42), /must be a string/);
});

test('getQuestionDef: new free-text questions exist and are skippable', () => {
  for (const id of ['offer', 'mutual', 'boundaries', 'timing']) {
    const d = getQuestionDef(id);
    assert.ok(d, id);
    assert.equal(d.type, 'free');
    assert.equal(d.skippable, true);
  }
});

// ---------- suggestedFirstStep ----------

test('suggestedFirstStep: templates per type, generic fallback', () => {
  assert.ok(suggestedFirstStep('meditation-partner').includes('20-minute'));
  assert.ok(suggestedFirstStep('dreamwork-exchange').includes('dream'));
  assert.ok(suggestedFirstStep('nope-not-a-type').length > 20);
});

// ---------- buildProposals (pure) ----------

test('buildProposals: shape and privacy via visibleProfile', async () => {
  const { getVisibleProfile } = await import('../src/db.js');
  const requester = {
    id: 1001, practices: ['meditation'], interests: ['meditation'],
    intention: 'calm meditation partner', intentions: ['meditation-partner'],
    prefs: { formats: ['video'], localRemote: 'either', languages: ['English'] },
    consents: { community_visible: true, introductions: true }, consentSettings: {},
  };
  const candidate = {
    id: 1002, name: 'Candace', email: 'candace@example.com',
    practices: ['meditation'], interests: ['meditation'],
    intention: 'seeking a meditation partner for morning sits',
    intentions: ['meditation-partner'],
    prefs: { formats: ['video'], localRemote: 'either', languages: ['English'] },
    consents: { community_visible: true, introductions: true }, consentSettings: {},
  };
  const parsed = parseIntent('I want a meditation partner for morning sits over video.');
  const proposals = buildProposals(requester, parsed, {}, {
    candidates: [candidate],
    visibleProfile: () => ({ id: candidate.id, name: 'Candace' }),
    requesterOffer: 'I can offer a steady morning sitting practice.',
  });
  assert.equal(proposals.length, 1);
  const [p] = proposals;
  assert.equal(p.connectionType, 'meditation-partner');
  assert.equal(p.connectionTypeLabel, 'Meditation or contemplative partner');
  assert.ok(Array.isArray(p.whyItFits) && p.whyItFits.length > 0);
  assert.ok(p.suggestedFirst.length > 20);
  assert.equal(p.suggestedFirstStep, p.suggestedFirst);
  assert.ok(typeof p.forCandidate === 'string' && p.forCandidate.length > 0);
  assert.ok(p.forCandidate.includes('meditation'), 'concrete link to candidate intent is named');
  assert.equal(p.candidateSharedText, '');
  assert.ok(!('email' in p.candidate), 'candidate must not leak email');
});

test('buildProposals: candidate without introductions consent is excluded', () => {
  const requester = {
    id: 1001, practices: ['meditation'], interests: ['meditation'],
    intention: 'calm meditation partner', intentions: ['meditation-partner'],
    prefs: { formats: ['video'], localRemote: 'either', languages: ['English'] },
    consents: { community_visible: true, introductions: true }, consentSettings: {},
  };
  const candidate = {
    id: 1002, name: 'NoConsent', practices: ['meditation'], interests: ['meditation'],
    intention: 'seeking a meditation partner for morning sits', intentions: ['meditation-partner'],
    prefs: { formats: ['video'], localRemote: 'either', languages: ['English'] },
    consents: { community_visible: true, introductions: false }, consentSettings: {},
  };
  const parsed = parseIntent('I want a meditation partner for morning sits.');
  const proposals = buildProposals(requester, parsed, {}, { candidates: [candidate] });
  assert.equal(proposals.length, 0);
});

// ---------- HTTP: session flow ----------

test('guide HTTP: start validates text length', async () => {
  const me = await createProfile();
  const short = await api('POST', '/api/guide/sessions', { profileId: me.id, text: 'hi' });
  assert.equal(short.status, 400);
  const missing = await api('POST', '/api/guide/sessions', { profileId: me.id });
  assert.equal(missing.status, 400);
});

test('guide HTTP: full session flow start → answer all → proposals', async () => {
  const me = await createProfile({ name: 'Seeker', practices: ['meditation', 'dreamwork'] });
  // A candidate with shared ground.
  await createProfile({
    name: 'Dream Friend',
    intention: 'I want to explore dreamwork and symbolism with a thoughtful peer.',
    practices: ['dreamwork', 'journaling'],
    intentions: ['dreamwork-symbolism'],
  });

  const start = await api('POST', '/api/guide/sessions', {
    profileId: me.id,
    text: 'I want to explore dreamwork and symbolism with someone thoughtful, over video chat.',
  });
  assert.equal(start.status, 201, JSON.stringify(start.json));
  const s0 = start.json.session;
  assert.ok(s0.id);
  assert.ok(s0.parsed.practices.includes('dreamwork'));
  assert.ok(!s0.questions.some((q) => q.id === 'format'), 'format inferred from "video chat"');
  assert.ok(s0.questions.length <= 3);

  // Answer every open question (free text gets honest words, choices get the first option).
  let last = null;
  for (const q of s0.questions) {
    const value = q.type === 'multi' ? [q.options[0].value]
      : q.type === 'free' ? `A few honest words about ${q.id}.`
      : q.options[0].value;
    const r = await api('POST', `/api/guide/sessions/${s0.id}/answer`, {
      profileId: me.id, questionId: q.id, value,
    });
    assert.equal(r.status, 200, `answer ${q.id}: ${JSON.stringify(r.json)}`);
    last = r.json;
  }
  assert.equal(last.complete, true, 'session should complete after all questions answered');
  // Consent-first: completion no longer returns proposals until the brief is approved.
  assert.ok(Array.isArray(last.proposals));
  assert.equal(last.proposals.length, 0, 'no proposals before brief approval');

  // The consent-first path: draft brief → approve → gated proposals unlock.
  const created = await api('POST', '/api/briefs', { profileId: me.id, sessionId: s0.id });
  assert.ok([200, 201].includes(created.status), JSON.stringify(created.json));
  const approved = await api('POST', `/api/briefs/${created.json.brief.id}/approve`, {
    profileId: me.id,
    shared_text: 'Seeker is hoping to find a thoughtful dreamwork peer. They offer steady listening.',
    consent_save: true,
    consent_share: true,
  });
  assert.equal(approved.status, 200);
  const gated = await api('GET', `/api/guide/proposals?profileId=${me.id}&sessionId=${s0.id}`);
  assert.equal(gated.status, 200, JSON.stringify(gated.json));
  const props = gated.json.proposals;
  assert.ok(props.length >= 1, 'expected at least one proposal after approval');
  assert.ok(props.length <= 3);
  const prop = props[0];
  assert.ok(prop.candidate && prop.candidate.id);
  assert.ok(!('email' in prop.candidate), 'proposal candidate must not include email');
  assert.ok(!('consents' in prop.candidate), 'proposal candidate must not include consents');
  assert.ok(typeof prop.connectionType === 'string' && prop.connectionType.length > 0);
  assert.ok(typeof prop.connectionTypeLabel === 'string' && prop.connectionTypeLabel.length > 0);
  assert.ok(Array.isArray(prop.whyItFits) && prop.whyItFits.length > 0);
  assert.ok(typeof prop.suggestedFirst === 'string' && prop.suggestedFirst.length > 20);
  assert.ok(typeof prop.suggestedFirstStep === 'string' && prop.suggestedFirstStep.length > 20);
  assert.ok(typeof prop.forCandidate === 'string' && prop.forCandidate.length > 0);
  assert.ok(typeof prop.candidateSharedText === 'string');
  assert.ok(props.length <= 3);

  // Session is complete — further answers rejected.
  const again = await api('POST', `/api/guide/sessions/${s0.id}/answer`, {
    profileId: me.id, questionId: s0.questions[0].id, value: 'a few more honest words',
  });
  assert.equal(again.status, 409);

  // GET the session.
  const got = await api('GET', `/api/guide/sessions/${s0.id}?profileId=${me.id}`);
  assert.equal(got.status, 200);
  assert.equal(got.json.session.status, 'complete');
});

test('guide HTTP: skip is allowed and still completes', async () => {
  const me = await createProfile({ name: 'Skipper' });
  const start = await api('POST', '/api/guide/sessions', {
    profileId: me.id, text: 'I am curious and open, but not sure exactly what I need right now.',
  });
  assert.equal(start.status, 201);
  const s0 = start.json.session;
  let last = null;
  for (const q of s0.questions) {
    const r = await api('POST', `/api/guide/sessions/${s0.id}/answer`, {
      profileId: me.id, questionId: q.id, value: null,
    });
    assert.equal(r.status, 200, `skip ${q.id}: ${JSON.stringify(r.json)}`);
    last = r.json;
  }
  assert.equal(last.complete, true);
  assert.ok(Array.isArray(last.proposals));
});

test('guide HTTP: bad questionId rejected', async () => {
  const me = await createProfile({ name: 'BadQ' });
  const start = await api('POST', '/api/guide/sessions', {
    profileId: me.id, text: 'I want a meditation partner for weekly practice and reflection.',
  });
  assert.equal(start.status, 201);
  const bad = await api('POST', `/api/guide/sessions/${start.json.session.id}/answer`, {
    profileId: me.id, questionId: 'telepathy', value: 'x',
  });
  assert.ok([400].includes(bad.status), `got ${bad.status}`);
});

test('guide HTTP: free-text answers cap at 500 chars', async () => {
  const me = await createProfile({ name: 'BadV' });
  const start = await api('POST', '/api/guide/sessions', {
    profileId: me.id, text: 'I want a meditation partner for weekly practice and reflection.',
  });
  const s0 = start.json.session;
  const free = s0.questions.find((x) => x.type === 'free');
  assert.ok(free, 'a free-text question should be open');
  const tooLong = await api('POST', `/api/guide/sessions/${s0.id}/answer`, {
    profileId: me.id, questionId: free.id, value: 'x'.repeat(501),
  });
  assert.equal(tooLong.status, 400);
  const ok = await api('POST', `/api/guide/sessions/${s0.id}/answer`, {
    profileId: me.id, questionId: free.id, value: 'a few honest words',
  });
  assert.equal(ok.status, 200);
});

test('guide HTTP: wrong profileId is forbidden', async () => {
  const me = await createProfile({ name: 'Owner' });
  const other = await createProfile({ name: 'Stranger' });
  const start = await api('POST', '/api/guide/sessions', {
    profileId: me.id, text: 'I want a meditation partner for weekly practice and reflection.',
  });
  const sid = start.json.session.id;
  const get = await api('GET', `/api/guide/sessions/${sid}?profileId=${other.id}`);
  assert.equal(get.status, 403);
  const ans = await api('POST', `/api/guide/sessions/${sid}/answer`, {
    profileId: other.id, questionId: 'format', value: 'video',
  });
  assert.equal(ans.status, 403);
});

test('guide HTTP: unknown session is 404', async () => {
  const me = await createProfile({ name: 'Lost' });
  const r = await api('GET', '/api/guide/sessions/999999?profileId=' + me.id);
  assert.equal(r.status, 404);
});

// ---------- values on profile PATCH ----------

test('profile PATCH: values validated and persisted', async () => {
  const me = await createProfile({ name: 'Valued' });
  const bad = await api('PATCH', `/api/profiles/${me.id}`, { values: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
  assert.equal(bad.status, 400, 'more than 6 values rejected');
  const bad2 = await api('PATCH', `/api/profiles/${me.id}`, { values: 'grounded' });
  assert.equal(bad2.status, 400, 'non-array rejected');
  const good = await api('PATCH', `/api/profiles/${me.id}`, { values: ['grounded', 'curious'] });
  assert.equal(good.status, 200, JSON.stringify(good.json));
  const got = await api('GET', `/api/profiles/${me.id}?viewerId=${me.id}`);
  assert.deepEqual(got.json.values, ['grounded', 'curious']);
});

// ---------- buildBriefDraft ----------

test('buildBriefDraft: prefills from session, never invents', async () => {
  const { buildBriefDraft } = await import('../src/guide.js');
  const profile = { name: 'Maya Chen', practices: ['meditation', 'dreamwork'] };
  const session = {
    requestText: 'I want a meditation partner for quiet morning sits.',
    parsed: { practices: ['meditation'], intentions: [], connectionTypes: [], requestText: '' },
    answers: {
      offer: 'I can offer steady morning presence.',
      boundaries: 'Please keep my family situation private.',
      timing: 'Weekday mornings only.',
      format: 'video',
      locality: 'remote',
      commitment: 'recurring',
    },
  };
  const d = buildBriefDraft(profile, session);
  assert.ok(d.who_text.startsWith('Maya Chen'), d.who_text);
  assert.ok(d.who_text.includes('meditation'), 'practices named in who_text');
  assert.equal(d.intention_text, 'I want a meditation partner for quiet morning sits.');
  assert.ok(d.good_fit_text.includes('meditation'), 'good_fit grounded in parsed intent');
  assert.ok(!/perfect|soulmate|guaranteed/i.test(d.good_fit_text));
  assert.equal(d.offer_text, 'I can offer steady morning presence.');
  assert.ok(d.logistics_text.includes('video') || d.logistics_text.includes('Video'));
  assert.ok(d.logistics_text.includes('Weekday mornings only.'));
  assert.equal(d.boundaries_text, 'Please keep my family situation private.');
  assert.equal(d.private_notes, '');
  assert.ok(d.shared_text.length > 0 && d.shared_text.length <= 400);
  assert.ok(d.shared_text.includes('Maya'), 'shared text names who');
});

test('buildBriefDraft: empty answers give empty optional fields', async () => {
  const { buildBriefDraft } = await import('../src/guide.js');
  const d = buildBriefDraft(
    { name: 'No Answers' },
    { requestText: 'I am curious and open.', parsed: {}, answers: {} },
  );
  assert.equal(d.offer_text, '');
  assert.equal(d.logistics_text, '');
  assert.equal(d.boundaries_text, '');
  assert.ok(d.shared_text.length <= 400);
});

// ---------- buildWarmIntroMessage ----------

test('buildWarmIntroMessage: names + approved text + first step, nothing invented', async () => {
  const { buildWarmIntroMessage } = await import('../src/guide.js');
  const body = buildWarmIntroMessage({
    requesterName: 'Wendy Wu',
    responderName: 'Ken Kato',
    requesterSharedText: 'Wendy is hoping to find a dreamwork peer. She offers deep listening.',
    responderSharedText: '',
    connectionType: 'one-to-one-conversation',
  });
  assert.ok(body.includes('Wendy') && body.includes('Ken'));
  assert.ok(body.includes('both said yes'), 'acceptance stated plainly');
  assert.ok(body.includes('Wendy is hoping to find a dreamwork peer'));
  assert.ok(!body.includes('Ken shared:'), 'no line invented for the side with no text');
  assert.ok(body.includes('A gentle first step:'));
  assert.ok(!/perfect match|soulmate|meant to be|mutual interest/i.test(body));
});

test('buildWarmIntroMessage: truncates long shared text near 140 chars', async () => {
  const { buildWarmIntroMessage } = await import('../src/guide.js');
  const body = buildWarmIntroMessage({
    requesterName: 'A', responderName: 'B',
    requesterSharedText: 'x'.repeat(300),
    connectionType: 'nope',
  });
  const line = body.split('\n').find((l) => l.includes('A shared:'));
  assert.ok(line.length < 170, `truncated: ${line.length}`);
});
