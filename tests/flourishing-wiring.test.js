// SEREN MVP — "Flourishing by Design" wiring tests.
// - realLifePrompt wired into chat (after brief approval) and introduction
//   accept paths (both /accept and /respond), via the sender-0 system
//   message mechanism; answering/skipping never gates progress.
// - src/chat.js bot copy: no banned phrasing, <= 400 chars per bot text.
// - Group-first recommendation: proposals carry firstStepSuggestion /
//   firstStepSuggestionCopy (group for grief-worded briefs, direct
//   otherwise); the legacy suggestedFirstStep string is untouched.
// - Synchronicity reflective framing: deck cards expose lens;
//   beacon/match payloads and the beacon-match introduction note carry
//   REFLECTIVE_FRAMING.
// - Onboarding completion persists the flourishing connectionPrefs +
//   consentSettings keys (round-trip create -> GET); PATCH merges
//   connectionPrefs instead of dropping keys.
// Isolated temp DB, SEED_DEMO=false, BETA_CODE set.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const dir = mkdtempSync(join(tmpdir(), 'seren-flwire-'));
process.env.DB_PATH = join(dir, 'flwire-test.db');
process.env.SEED_DEMO = 'false';
process.env.BETA_CODE = 'flwire-test-beta-code';

const { app, db } = await import('../src/server.js');
const { REAL_LIFE_PROMPT_TEXT } = await import('../src/guide.js');
const { REFLECTIVE_FRAMING } = await import('../src/sync-deck.js');
const chatCopy = await import('../src/chat.js');

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
const uniqueEmail = (base = 'flwire') => `${base}${++emailSeq}@example.com`;

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

const allMembers = [];
async function createMember(name, email) {
  let r = await fetch(`${BASE}/api/beta/enter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'flwire-test-beta-code' }),
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
  const member = { id: data.id, cookie };
  allMembers.push(member);
  return member;
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
  return { status: r.status, data, headers: r.headers };
}

const sendChat = (member, sessionId, text) =>
  api('POST', '/api/chat/message', { sessionId, text }, member.cookie);

/** Drive a guide chat to brief_review (same contract as tests/chat.test.js). */
async function driveToBriefReview(member, sessionId, firstText) {
  let r = await sendChat(member, sessionId, firstText);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  for (let i = 0; i < 12; i++) {
    const stage = r.data.session.stage;
    if (stage === 'brief_review') return r;
    assert.equal(stage, 'followup', `unexpected stage "${stage}"`);
    const qmsg = r.data.messages.find((m) => m.kind === 'question');
    assert.ok(qmsg, 'expected a kind:question message');
    const q = qmsg.question ?? qmsg;
    let answer;
    if (q.skippable) answer = 'skip';
    else if (q.input === 'free') answer = 'Something thoughtful and honest, a few words.';
    else answer = q.options[0].label;
    r = await sendChat(member, sessionId, answer);
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  assert.fail('chat session never reached brief_review');
}

function insertBrief(profileId, { intentionText, status = 'active', consent = true } = {}) {
  const now = new Date().toISOString();
  const name = db.prepare('SELECT name FROM profiles WHERE id = ?').get(profileId)?.name ?? 'Someone';
  const c = consent ? 1 : 0;
  const info = db.prepare(`INSERT INTO briefs
    (profile_id, who_text, intention_text, good_fit_text, offer_text, logistics_text,
     boundaries_text, private_notes, shared_text, consent_save, consent_share, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      profileId, name, intentionText,
      'A calm and consistent meditation peer.',
      'I can offer steady presence and weekly sits.',
      'Weekday evenings, video or in person.',
      'Keep it gentle and secular.',
      '', `${name} is open to a calm meditation practice partner.`,
      c, c, status, now, now,
    );
  return Number(info.lastInsertRowid);
}

// ---------- fixtures ----------

const alice = await createMember('Wire Alice', uniqueEmail('alice'));
const bob = await createMember('Wire Bob', uniqueEmail('bob'));
const cara = await createMember('Wire Cara', uniqueEmail('cara'));
const memberById = (id) => allMembers.find((m) => m.id === id);

let betaCookie = null;
async function ensureBeta() {
  if (betaCookie) return betaCookie;
  const r = await api('POST', '/api/beta/enter', { code: 'flwire-test-beta-code' }, null);
  assert.equal(r.status, 200);
  betaCookie = pick(r.headers.get('set-cookie') || '', 'seren_beta');
  assert.ok(betaCookie);
  return betaCookie;
}

// ---------- real-life prompt: chat approval ----------

test('real-life prompt appears after brief approval in chat and in the transcript', async () => {
  const started = await api('POST', '/api/chat/start', {}, alice.cookie);
  assert.ok([200, 201].includes(started.status));
  const sessionId = started.data.session.id;

  await driveToBriefReview(alice, sessionId,
    'I want a meditation practice partner to sit with weekly');
  const r = await sendChat(alice, sessionId, 'Looks good — find matches');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.session.stage, 'proposals');

  const prompt = r.data.messages.find((m) => m.kind === 'real_life_prompt');
  assert.ok(prompt, `expected a real_life_prompt message: ${JSON.stringify(r.data.messages)}`);
  assert.equal(prompt.role, 'bot');
  assert.equal(prompt.skippable, true);
  assert.equal(prompt.text, REAL_LIFE_PROMPT_TEXT);

  // The prompt is persisted in the transcript too.
  const sess = await api('GET', `/api/chat/session/${sessionId}?profileId=${alice.id}`, undefined, alice.cookie);
  assert.equal(sess.status, 200);
  const inTranscript = (sess.data.transcript || []).find((m) => m.kind === 'real_life_prompt');
  assert.ok(inTranscript, 'transcript should carry the real-life prompt');
  assert.equal(inTranscript.text, REAL_LIFE_PROMPT_TEXT);
});

test('the real-life prompt never gates progress: skipping keeps the chat moving', async () => {
  const started = await api('POST', '/api/chat/start', {}, bob.cookie);
  const sessionId = started.data.session.id;
  await driveToBriefReview(bob, sessionId,
    'I want a meditation practice partner to sit with weekly');
  const approved = await sendChat(bob, sessionId, 'Looks good');
  assert.equal(approved.status, 200);
  assert.equal(approved.data.session.stage, 'proposals');

  // "Skip" the prompt — the proposals stage just answers normally.
  const r = await sendChat(bob, sessionId, 'skip');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.session.stage, 'proposals');

  // Any other message also flows through without a gate.
  const r2 = await sendChat(bob, sessionId, 'Thanks, that is helpful');
  assert.equal(r2.status, 200);
  assert.equal(r2.data.session.stage, 'proposals');
});

// ---------- real-life prompt: introduction accept ----------

async function requestIntro(requester) {
  const r = await api('POST', '/api/introductions/request', {
    intention: 'A calm weekly meditation sit together.',
  }, requester.cookie);
  assert.equal(r.status, 201, `intro request failed: ${JSON.stringify(r.data)}`);
  return r.data.introduction;
}

test('real-life prompt rides the legacy accept response (thread contract untouched)', async () => {
  const intro = await requestIntro(alice);
  const proposed = memberById(intro.proposedId);
  assert.ok(proposed, 'proposed side should be a fixture member');
  // Accept as the proposed side via the legacy path.
  const acc = await api('POST', `/api/introductions/${intro.id}/accept`, {}, proposed.cookie);
  assert.equal(acc.status, 200, JSON.stringify(acc.data));

  const prompt = acc.data.realLifePrompt;
  assert.ok(prompt, `expected realLifePrompt on the accept response: ${JSON.stringify(acc.data)}`);
  assert.equal(prompt.kind, 'real_life_prompt');
  assert.equal(prompt.role, 'bot');
  assert.equal(prompt.skippable, true);
  assert.equal(prompt.text, REAL_LIFE_PROMPT_TEXT);
  assert.equal(prompt.introductionId, intro.id, 'frontend keys introduction context off introductionId');

  // The thread contract is unchanged: the legacy path posts no messages.
  const msgs = await api('GET', `/api/introductions/${intro.id}/messages`, undefined, alice.cookie);
  assert.equal(msgs.status, 200);
  assert.equal(msgs.data.messages.length, 0, 'no system message posted into the thread');
});

test('real-life prompt rides the respond-accepted response (warm-intro thread untouched)', async () => {
  const intro = await requestIntro(cara);
  const proposed = memberById(intro.proposedId);
  assert.ok(proposed, 'proposed side should be a fixture member');
  const acc = await api('POST', `/api/introductions/${intro.id}/respond`, {
    response: 'accepted',
  }, proposed.cookie);
  assert.equal(acc.status, 200, JSON.stringify(acc.data));

  const prompt = acc.data.realLifePrompt;
  assert.ok(prompt, `expected realLifePrompt on the respond response: ${JSON.stringify(acc.data)}`);
  assert.equal(prompt.kind, 'real_life_prompt');
  assert.equal(prompt.text, REAL_LIFE_PROMPT_TEXT);
  assert.equal(prompt.introductionId, intro.id);

  // The thread keeps its exact-count contract: exactly the warm-intro message.
  const msgs = await api('GET', `/api/introductions/${intro.id}/messages`, undefined, cara.cookie);
  assert.equal(msgs.status, 200);
  assert.equal(msgs.data.messages.length, 1, 'only the warm-intro system message');
  assert.equal(msgs.data.messages[0].senderId, 0);
});

test('no real-life prompt on decline responses', async () => {
  const intro = await requestIntro(bob);
  const proposed = memberById(intro.proposedId);
  const dec = await api('POST', `/api/introductions/${intro.id}/respond`, {
    response: 'decline',
  }, proposed.cookie);
  assert.equal(dec.status, 200);
  assert.ok(!('realLifePrompt' in dec.data), 'decline responses carry no prompt');
});

// ---------- chat.js copy sweep ----------

test('chat.js bot copy: no banned phrasing, every bot text <= 400 chars', async () => {
  const banned = [
    /you must/i,
    /you are destined/i,
    /your energy proves/i,
    /i have detected/i,
    /soulmate/i,
    /past life/i,
    /diagnos/i,
  ];
  const texts = [
    ...chatCopy.STARTERS,
    ...chatCopy.APPROVE_QUICK_REPLIES,
    ...Object.values(chatCopy.FIELD_LABELS),
    ...chatCopy.greetingMessages({ name: 'Test Person' }).map((m) => m.text),
    chatCopy.briefMessage({
      id: 1, status: 'draft', who_text: 'w', intention_text: 'i',
      good_fit_text: 'g', offer_text: 'o', logistics_text: 'l',
      boundaries_text: 'b', shared_text: 's',
    }).text,
    chatCopy.NO_SUGGESTIONS_TEXT,
    chatCopy.proposalsStageText(true),
    chatCopy.proposalsStageText(false),
  ];
  assert.ok(texts.length > 10, 'collected a meaningful set of bot strings');
  for (const t of texts) {
    assert.ok(typeof t === 'string' && t.length > 0, 'bot string must be non-empty');
    assert.ok(t.length <= 400, `bot text exceeds 400 chars (${t.length}): ${t.slice(0, 80)}`);
    for (const re of banned) {
      assert.ok(!re.test(t), `banned phrasing ${re} in: ${t.slice(0, 120)}`);
    }
  }
  // Message shapes unchanged.
  const [g1, g2] = chatCopy.greetingMessages({ name: 'Ava Alvarez' });
  assert.deepEqual(Object.keys(g1).sort(), ['kind', 'role', 'text']);
  assert.equal(g1.kind, 'text');
  assert.ok(g1.text.includes('Ava'), 'greeting still personalizes the first name');
  assert.equal(g2.kind, 'text');
});

// ---------- group-first recommendation on proposals ----------

test('proposals carry firstStepSuggestion: group for grief-worded briefs, direct otherwise', async () => {
  const candidate = await createMember('Wire Candidate', uniqueEmail('cand'));
  insertBrief(candidate.id, {
    intentionText: 'I want a calm meditation practice partner for weekly sits.',
  });

  const griever = await createMember('Wire Griever', uniqueEmail('griever'));
  const griefBriefId = insertBrief(griever.id, {
    intentionText: 'I am grieving the loss of my mother and hoping to find a calm meditation practice partner for weekly sits.',
  });
  const r = await api('GET', `/api/briefs/${griefBriefId}/proposals`, undefined, griever.cookie);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.proposals.length > 0, 'expected at least one proposal for the grief-worded brief');
  for (const p of r.data.proposals) {
    assert.equal(p.firstStepSuggestion, 'group', JSON.stringify(p));
    assert.ok(typeof p.firstStepSuggestionCopy === 'string' && p.firstStepSuggestionCopy.length > 0);
    // The legacy first-step string is untouched.
    assert.ok(typeof p.suggestedFirstStep === 'string' && p.suggestedFirstStep.length > 0);
  }

  const neutral = await createMember('Wire Neutral', uniqueEmail('neutral'));
  const neutralBriefId = insertBrief(neutral.id, {
    intentionText: 'I want a calm meditation practice partner for weekly sits.',
  });
  const r2 = await api('GET', `/api/briefs/${neutralBriefId}/proposals`, undefined, neutral.cookie);
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  assert.ok(r2.data.proposals.length > 0, 'expected at least one proposal for the neutral brief');
  for (const p of r2.data.proposals) {
    assert.equal(p.firstStepSuggestion, 'direct', JSON.stringify(p));
    assert.ok(typeof p.firstStepSuggestionCopy === 'string' && p.firstStepSuggestionCopy.length > 0);
    assert.ok(typeof p.suggestedFirstStep === 'string' && p.suggestedFirstStep.length > 0);
  }
});

// ---------- synchronicity reflective framing ----------

test('deck cards expose lens; beacons and matches carry framing', async () => {
  const deck = await api('GET', '/api/sync/deck', undefined, alice.cookie);
  assert.equal(deck.status, 200);
  assert.ok(deck.data.cards.length > 0);
  for (const c of deck.data.cards) {
    assert.ok(['symbolic', 'psychological', 'spiritual', 'practical'].includes(c.lens),
      `card ${c.id} missing lens: ${JSON.stringify(c)}`);
    assert.ok(c.word && c.prompt, 'deck card keeps word and prompt');
  }

  // Fresh members: earlier accept tests already paired the fixtures, which
  // would make them ineligible for a beacon match.
  const dana = await createMember('Wire Dana', uniqueEmail('dana'));
  const evan = await createMember('Wire Evan', uniqueEmail('evan'));

  const word = 'riverstone';
  const b1 = await api('POST', '/api/sync/beacons', { source: 'self_input', text: word }, dana.cookie);
  assert.equal(b1.status, 201, JSON.stringify(b1.data));
  assert.equal(b1.data.beacon.framing, REFLECTIVE_FRAMING);
  assert.equal(b1.data.match, null);

  const mine = await api('GET', '/api/sync/beacons/mine', undefined, dana.cookie);
  assert.equal(mine.status, 200);
  assert.ok(mine.data.beacons.length > 0);
  assert.equal(mine.data.beacons[0].framing, REFLECTIVE_FRAMING);

  // A second member carrying the same word triggers the match path.
  const b2 = await api('POST', '/api/sync/beacons', { source: 'self_input', text: word }, evan.cookie);
  assert.equal(b2.status, 201, JSON.stringify(b2.data));
  assert.ok(b2.data.match, 'expected a beacon match');
  assert.equal(b2.data.match.framing, REFLECTIVE_FRAMING);
  assert.ok(
    String(b2.data.match.introduction.note).includes(REFLECTIVE_FRAMING),
    'beacon-match introduction note carries the reflective framing',
  );
  assert.ok(
    String(b2.data.match.introduction.note).includes(`You both carried '${word}' this week.`),
    'introduction note keeps the shared-beacon reason',
  );

  const matches = await api('GET', '/api/sync/matches/mine', undefined, evan.cookie);
  assert.equal(matches.status, 200);
  assert.ok(matches.data.matches.length > 0);
  assert.equal(matches.data.matches[0].framing, REFLECTIVE_FRAMING);
});

// ---------- onboarding persistence ----------

const ONBOARDING_ANSWERS = [
  'Maya Chen',
  null, // email filled per-test (must be unique)
  'Meet spiritually aligned people, Find local community or gatherings',
  'Reflective AI conversations only, One-to-one introductions',
  'Meditation, Tarot',
  'Astrology',
  'private',
  'regional',
  'I am seeking calm meditation partners and honest conversation about consciousness.',
  'Practice partner',
  'hybrid',
  'weekly',
  'Sunday mornings only, please',
  'Gently, sometimes',
  'Grounded',
  'Yes, I consent',
];

test('onboarding chat completion persists flourishing keys (create -> GET round-trip)', async () => {
  const beta = await ensureBeta();
  const email = uniqueEmail('onboard');
  const start = await api('POST', '/api/onboarding/chat/start', {}, beta);
  assert.equal(start.status, 201, JSON.stringify(start.data));
  const sessionId = start.data.session.id;

  let r = null;
  const answers = ONBOARDING_ANSWERS.map((a) => (a === null ? email : a));
  for (const text of answers) {
    r = await api('POST', '/api/onboarding/chat/message', { sessionId, text }, beta);
    assert.ok([200, 201].includes(r.status), `onboarding step failed: ${JSON.stringify(r.data)}`);
  }
  assert.equal(r.status, 201, 'completion should return 201');
  assert.ok(r.data.profileCreated, `expected profileCreated: ${JSON.stringify(r.data)}`);
  const profileId = r.data.profileCreated.profileId;
  const sessionCookie = pick(r.headers.get('set-cookie') || '', 'seren_profile');
  assert.ok(sessionCookie, 'completion should set the session cookie');
  const authed = [beta, sessionCookie].filter(Boolean).join('; ');

  const got = await api('GET', `/api/profiles/${profileId}`, undefined, authed);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const cp = got.data.connectionPrefs;
  assert.deepEqual(cp.intentions, ['spiritual-alignment', 'local-community']);
  assert.deepEqual(cp.connectionLevels, ['ai-conversations', 'one-to-one']);
  assert.deepEqual(cp.topicsOut, ['astrology']);
  assert.equal(cp.privacyLevel, 'private');
  assert.equal(cp.locationRadius, 'regional');
  assert.equal(cp.onlineMode, 'hybrid');
  assert.equal(cp.commBoundaries, 'Sunday mornings only, please');
  assert.equal(cp.syncMode, 'limited');
  assert.deepEqual(cp.seeking, ['practice-partner']);
  assert.equal(got.data.consentSettings.recFrequency, 'weekly');
});

test('PATCH connectionPrefs merges instead of dropping existing keys', async () => {
  const dave = await createMember('Wire Dave', uniqueEmail('dave'));
  let r = await api('PATCH', `/api/profiles/${dave.id}`, {
    connectionPrefs: { privacyLevel: 'private', onlineMode: 'online' },
  }, dave.cookie);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.connectionPrefs.privacyLevel, 'private');
  assert.equal(r.data.connectionPrefs.onlineMode, 'online');

  // A second PATCH touching one key preserves the others.
  r = await api('PATCH', `/api/profiles/${dave.id}`, {
    connectionPrefs: { commBoundaries: 'Evenings only' },
  }, dave.cookie);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.connectionPrefs.privacyLevel, 'private', 'privacyLevel survives the merge');
  assert.equal(r.data.connectionPrefs.onlineMode, 'online', 'onlineMode survives the merge');
  assert.equal(r.data.connectionPrefs.commBoundaries, 'Evenings only');
  assert.deepEqual(r.data.connectionPrefs.seeking, ['practice-partner'], 'seeking default preserved');

  const got = await api('GET', `/api/profiles/${dave.id}`, undefined, dave.cookie);
  assert.equal(got.data.connectionPrefs.privacyLevel, 'private');
});
