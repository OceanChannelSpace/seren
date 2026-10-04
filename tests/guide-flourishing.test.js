// SEREN guide — Flourishing by Design behavior tests.
//
// (a) allBotCopy() collects every bot-facing string the module can emit;
//     none may contain banned guru/oracle/destiny/psychic phrasing, and
//     every bot text must be <= 400 chars.
// (b) The real-life completion prompt is offered only at natural
//     conversation conclusions and is always skippable.
// (c) The agency-first lens offer carries the four lenses and returns
//     interpretive authority to the member.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  allBotCopy,
  realLifePrompt,
  REAL_LIFE_PROMPT_TEXT,
  REAL_LIFE_PROMPT_CONTEXTS,
  lensOffer,
  LENS_OFFER_TEXT,
  getQuestionDef,
  selectFollowUps,
  remainingQuestions,
  buildWarmIntroMessage,
} from '../src/guide.js';

// Case-insensitive banned fragments (spec §B, GUIDE_BEHAVIOR_RULES §6).
const BANNED = [
  'you must',
  'you are destined',
  'your energy proves',
  'i have detected',
  'soulmate',
  'past life',
  'diagnos',
];

// ---------- (a) bot-copy audit ----------

test('allBotCopy: returns a representative set of bot strings', () => {
  const copy = allBotCopy();
  assert.ok(Array.isArray(copy));
  assert.ok(copy.length >= 20, `expected a representative set, got ${copy.length}`);
  assert.ok(copy.includes(REAL_LIFE_PROMPT_TEXT), 'real-life prompt covered');
  assert.ok(copy.includes(LENS_OFFER_TEXT), 'lens offer covered');
  assert.ok(copy.some((t) => t.includes('A warm hello from SEREN')), 'warm-intro covered');
});

test('allBotCopy: no banned phrasing in any bot string', () => {
  const copy = allBotCopy();
  for (const text of copy) {
    const lower = String(text).toLowerCase();
    for (const phrase of BANNED) {
      assert.ok(
        !lower.includes(phrase),
        `banned phrase "${phrase}" found in: ${String(text).slice(0, 120)}`,
      );
    }
  }
});

test('allBotCopy: every bot text is <= 400 chars', () => {
  for (const text of allBotCopy()) {
    assert.ok(
      String(text).length <= 400,
      `over 400 chars (${String(text).length}): ${String(text).slice(0, 80)}…`,
    );
  }
});

test('allBotCopy: question prompts are agency-first, never commanding', () => {
  for (const id of ['offer', 'mutual', 'boundaries', 'format', 'locality', 'commitment', 'timing', 'depth']) {
    const def = getQuestionDef(id);
    assert.ok(def && def.prompt.length > 0, id);
    assert.equal(def.skippable, true, `${id} must be skippable`);
    const lower = def.prompt.toLowerCase();
    assert.ok(!lower.includes('you must'), `${id} must never command`);
    assert.ok(!lower.includes('should') || lower.includes('would'), `${id} avoids "should" pressure`);
  }
});

test('buildWarmIntroMessage: output is warm, grounded, and ban-free', () => {
  const body = buildWarmIntroMessage({
    requesterName: 'Wendy Wu',
    responderName: 'Ken Kato',
    requesterSharedText: 'Wendy hopes to find a dreamwork peer. She offers deep listening.',
    connectionType: 'dreamwork-exchange',
  });
  assert.ok(body.includes('both said yes'));
  const lower = body.toLowerCase();
  for (const phrase of BANNED) {
    assert.ok(!lower.includes(phrase), `banned phrase "${phrase}" in warm intro`);
  }
  assert.ok(body.length <= 400 * 4, 'warm intro stays bounded');
});

// ---------- (b) real-life completion prompt ----------

test('realLifePrompt: offered at natural conversation conclusions', () => {
  for (const context of ['brief_approved', 'introduction_accepted']) {
    const msg = realLifePrompt(context);
    assert.deepEqual(
      msg,
      { role: 'bot', kind: 'real_life_prompt', text: REAL_LIFE_PROMPT_TEXT, skippable: true },
      `context ${context}`,
    );
  }
});

test('realLifePrompt: never offered at other stages or unknown contexts', () => {
  const notConclusions = [
    'start', 'seeking', 'followup', 'brief_review', 'editing',
    'proposals', 'confirm_replace', 'resume_offer',
    'brief_rejected', 'introduction_declined', '', null, undefined,
  ];
  for (const context of notConclusions) {
    assert.equal(realLifePrompt(context), null, `context ${String(context)} must not prompt`);
  }
});

test('realLifePrompt: text asks the spec question, is short and skippable', () => {
  const msg = realLifePrompt('brief_approved');
  assert.ok(
    msg.text.includes('What would you like to bring into your real life in the next 24 hours?'),
    'spec question present verbatim',
  );
  assert.equal(msg.skippable, true, 'always skippable');
  assert.ok(msg.text.length <= 400, 'bot text length guardrail');
});

test('realLifePrompt: returns a fresh message object each call', () => {
  const a = realLifePrompt('brief_approved');
  const b = realLifePrompt('brief_approved');
  assert.notEqual(a, b, 'no shared mutable object');
  assert.deepEqual(a, b);
});

test('realLifePrompt: answering it never gates session completion', () => {
  // The prompt is informational only: remainingQuestions() must not know it,
  // so a session cannot stall waiting for an answer to it.
  const session = {
    answers: { offer: 'listening' },
    questions: [{ id: 'offer' }, { id: 'mutual' }],
  };
  assert.deepEqual(
    remainingQuestions(session).map((q) => q.id),
    ['mutual'],
    'only real questions block completion',
  );
});

test('REAL_LIFE_PROMPT_CONTEXTS: covers the spec stages', () => {
  assert.ok(REAL_LIFE_PROMPT_CONTEXTS.includes('brief_approved'));
  assert.ok(REAL_LIFE_PROMPT_CONTEXTS.includes('introduction_accepted'));
  assert.equal(REAL_LIFE_PROMPT_CONTEXTS.length, 2, 'no extra contexts without review');
});

// ---------- (c) lens offer ----------

test('lensOffer: offers the four lenses, agency-first', () => {
  const msg = lensOffer();
  assert.equal(msg.role, 'bot');
  assert.equal(msg.kind, 'text');
  assert.equal(msg.text, LENS_OFFER_TEXT);
  for (const lens of ['reflective', 'symbolic', 'practical', 'psychological']) {
    assert.ok(msg.text.includes(lens), `lens "${lens}" offered`);
  }
  assert.ok(
    msg.text.includes('You are the best authority on your own experience'),
    'authority stays with the member',
  );
  assert.ok(
    msg.text.includes('One possible interpretation is'),
    'framed as one possibility, never fact',
  );
  assert.ok(msg.text.length <= 400);
  const lower = msg.text.toLowerCase();
  for (const phrase of BANNED) {
    assert.ok(!lower.includes(phrase), `banned phrase "${phrase}" in lens offer`);
  }
});

// ---------- guide copy stays skippable / completable ----------

test('selectFollowUps: all questions remain skippable after the copy rewrite', () => {
  const parsed = {};
  const qs = selectFollowUps(parsed, { prefs: {}, values: [] });
  assert.ok(qs.length > 0);
  for (const q of qs) {
    assert.equal(q.skippable, true, q.id);
    assert.ok(q.prompt.length <= 400, `${q.id} prompt length`);
  }
});
