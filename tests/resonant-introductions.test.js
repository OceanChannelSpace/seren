// SEREN MVP — Flourishing by Design (Workstream D): resonant introductions
// + synchronicity reflective safeguards.
//
// Covers:
//   (a) reason strings contain no banned fate/destiny/proof language;
//   (b) suggestedFirstStep is 'group' for sensitive-topic briefs, 'direct'
//       otherwise (suggest, never block);
//   (c) synchronicity outputs carry the reflective-framing label;
//   (d) all 48 deck prompts contain no predictive/fear language;
//   (e) existing matching behavior unregressed (spot-check scoring).
//
// Pure-function tests (match.js) plus deck-content tests (sync-deck.js).
// No I/O, no server.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  scoreCandidate,
  findMatches,
  scoreAgent,
  buildIntroNote,
  buildPairReasons,
  PAIR_REASON_FALLBACK,
  SENSITIVE_CONTEXT_KEYWORDS,
  detectSensitiveContext,
  suggestFirstStep,
  resonanceNote,
  GROUP_FIRST_STEP_COPY,
  DIRECT_FIRST_STEP_COPY,
} from '../src/match.js';

import {
  SYNC_DECK,
  getSyncCard,
  getSyncCardAnnotated,
  REFLECTIVE_FRAMING,
} from '../src/sync-deck.js';

// ---------- helpers ----------

function profile(id, {
  name,
  practices = [],
  interests = [],
  intentions = [],
  intention = '',
  offers = [],
  needs = [],
  skills = [],
  prefs = {},
  consents = { introductions: true, community_visible: true, ai_matching: true },
} = {}) {
  return {
    id,
    name: name ?? `Person ${id}`,
    practices,
    interests,
    intentions,
    intention,
    offers,
    needs,
    skills,
    prefs,
    consents,
    consentSettings: {},
  };
}

// ---------- (a) no fate/destiny/proof/certainty language ----------

const BANNED_REASON_PATTERNS = [
  /\bfate\b/i,
  /\bfated\b/i,
  /\bdestiny\b/i,
  /\bdestined\b/i,
  /\bproven\b/i,
  /\bproof\b/i,
  /\bobjectively\b/i,
  /\bperfect match\b/i,
  /\bsoulmate\b/i,
  /\bmeant to be\b/i,
  /\bguarantee[sd]?\b/i,
  /\bcertain\b/i,
  /\bcertainty\b/i,
  /\bdivine plan\b/i,
  /\bwritten in the stars\b/i,
  /\bwill definitely\b/i,
];

function assertNoBannedLanguage(strings, label) {
  for (const s of strings) {
    assert.equal(typeof s, 'string', `${label}: expected a string, got ${typeof s}`);
    for (const re of BANNED_REASON_PATTERNS) {
      assert.doesNotMatch(s, re, `${label}: banned language ${re} in: ${JSON.stringify(s)}`);
    }
  }
}

function richPair() {
  const requester = profile(1, {
    name: 'Aria',
    practices: ['meditation'],
    interests: ['dreamwork', 'tarot'],
    intentions: ['practice-partner'],
    intention: 'I want a dreamwork partner for weekly dream sharing and reflection',
    offers: ['I can host a monthly dream circle'],
    needs: ['guidance on lucid dreaming'],
    skills: ['facilitation'],
    prefs: { formats: ['one-to-one'], localRemote: 'remote', languages: ['english'] },
  });
  const candidate = profile(2, {
    name: 'Kai',
    practices: ['meditation'],
    interests: ['dreamwork'],
    intentions: ['practice-partner'],
    intention: 'seeking dreamwork reflection with a kind partner weekly',
    offers: ['lucid dreaming guidance'],
    needs: ['a gentle dream circle to join'],
    skills: ['facilitation'],
    prefs: { formats: ['one-to-one'], localRemote: 'remote', languages: ['english'] },
  });
  return { requester, candidate };
}

test('(a) reason strings contain no fate/destiny/proof language', () => {
  const { requester, candidate } = richPair();

  const scoredVisible = scoreCandidate(requester, candidate, requester.intention, {
    quoteCandidateFields: true,
  });
  const scoredHidden = scoreCandidate(requester, candidate, requester.intention, {
    quoteCandidateFields: false,
  });
  const scoredNeedsOff = scoreCandidate(requester, candidate, requester.intention, {
    matchRequesterNeeds: false,
    matchCandidateNeeds: false,
  });
  const fallback = scoreCandidate(
    profile(9, { intention: 'something else entirely' }),
    profile(10, { intention: 'unrelated words here' }),
  );

  assertNoBannedLanguage(scoredVisible.reasons, 'scoreCandidate visible');
  assertNoBannedLanguage(scoredHidden.reasons, 'scoreCandidate hidden');
  assertNoBannedLanguage(scoredNeedsOff.reasons, 'scoreCandidate needs off');
  assertNoBannedLanguage(fallback.reasons, 'scoreCandidate fallback');

  const matches = findMatches(requester, [candidate], {
    intentionText: requester.intention,
  });
  assert.ok(matches.length > 0, 'expected a match');
  assertNoBannedLanguage(
    matches.flatMap((m) => [...m.reasons, m.resonanceNote, m.firstStepCopy]),
    'findMatches outputs',
  );

  const agent = { id: 1, name: 'Aria AI', description: 'dream reflection guide', capabilities: ['lucid dreaming guidance'] };
  const agentScored = scoreAgent(requester, agent, requester.intention);
  assertNoBannedLanguage(agentScored.reasons, 'scoreAgent');

  const { forRequester, forCandidate } = buildPairReasons(
    requester,
    candidate,
    scoredVisible,
    'I can offer a calm listening space.',
  );
  assertNoBannedLanguage(forRequester, 'buildPairReasons forRequester');
  assertNoBannedLanguage([forCandidate], 'buildPairReasons forCandidate');
  assertNoBannedLanguage([PAIR_REASON_FALLBACK], 'PAIR_REASON_FALLBACK');

  assertNoBannedLanguage(
    [
      buildIntroNote(requester, candidate, ['dreamwork'], ['dream']),
      buildIntroNote(requester, candidate, [], []),
      buildIntroNote({ name: 'Aria' }, { name: 'Kai' }, [], []),
      GROUP_FIRST_STEP_COPY,
      DIRECT_FIRST_STEP_COPY,
      resonanceNote({ sharedPractices: ['meditation'], sharedInterests: ['dreamwork'] }),
    ],
    'intro notes and framing copy',
  );
});

// ---------- (b) group-first default for sensitive contexts ----------

test('(b) detectSensitiveContext flags tender topics', () => {
  for (const t of [
    'I am grieving the loss of my mother.',
    'Support after a recent divorce would help.',
    'Working through trauma from childhood.',
    'I lost my husband last year and feel lonely.',
    'In recovery and looking for steady company.',
  ]) {
    assert.equal(detectSensitiveContext(t), true, `expected sensitive: ${t}`);
  }
  for (const t of [
    'I want a dreamwork partner for weekly practice.',
    'Looking for a meditation buddy in Boston.',
    'Seeking collaborators for a consciousness research project.',
    '',
    null,
    undefined,
  ]) {
    assert.equal(detectSensitiveContext(t), false, `expected not sensitive: ${t}`);
  }
});

test('(b) SENSITIVE_CONTEXT_KEYWORDS is a small, documented, frozen set', () => {
  assert.ok(Object.isFrozen(SENSITIVE_CONTEXT_KEYWORDS), 'keyword set should be frozen');
  assert.ok(SENSITIVE_CONTEXT_KEYWORDS.length <= 30, 'keyword set should stay small and reviewable');
  assert.ok(SENSITIVE_CONTEXT_KEYWORDS.includes('grief'), 'grief must be detected');
  assert.ok(SENSITIVE_CONTEXT_KEYWORDS.includes('trauma'), 'trauma must be detected');
});

test('(b) suggestFirstStep: group for sensitive briefs, direct otherwise', () => {
  const g = suggestFirstStep('I am grieving and looking for gentle company.');
  assert.equal(g.firstStep, 'group');
  assert.equal(g.copy, GROUP_FIRST_STEP_COPY);
  assert.match(g.copy, /small facilitated circle/i);

  const d = suggestFirstStep('I want a practice partner for breathwork.');
  assert.equal(d.firstStep, 'direct');
  assert.equal(d.copy, DIRECT_FIRST_STEP_COPY);

  const empty = suggestFirstStep('');
  assert.equal(empty.firstStep, 'direct', 'empty brief defaults to direct, never blocks');
});

test('(b) findMatches carries suggestedFirstStep on every match', () => {
  const requester = profile(1, {
    practices: ['meditation'],
    interests: ['dreamwork'],
    intention: 'dreamwork partner wanted',
  });
  const candidate = profile(2, {
    practices: ['meditation'],
    interests: ['dreamwork'],
    intention: 'dreamwork reflection weekly',
  });

  const sensitive = findMatches(requester, [candidate], {
    intentionText: 'I am grieving the loss of my father and want gentle company.',
  });
  assert.ok(sensitive.length > 0, 'sensitive briefs are never blocked from direct matches');
  for (const m of sensitive) {
    assert.equal(m.suggestedFirstStep, 'group');
    assert.equal(m.firstStepCopy, GROUP_FIRST_STEP_COPY);
  }

  const ordinary = findMatches(requester, [candidate], {
    intentionText: 'I want a dreamwork partner for weekly practice.',
  });
  assert.ok(ordinary.length > 0, 'ordinary briefs match too');
  for (const m of ordinary) {
    assert.equal(m.suggestedFirstStep, 'direct');
    assert.equal(m.firstStepCopy, DIRECT_FIRST_STEP_COPY);
  }
});

// ---------- (c) synchronicity reflective framing ----------

test('(c) reflective framing label is the exact required copy', () => {
  assert.equal(
    REFLECTIVE_FRAMING,
    'This is a creative reflection prompt, not a prediction, diagnosis, or verified external message.',
  );
});

test('(c) every annotated card carries word, prompt, lens, and framing', () => {
  const annotated = getSyncCardAnnotated('river');
  assert.ok(annotated, 'annotated card should exist');
  assert.equal(annotated.id, 'river');
  assert.equal(annotated.word, 'river');
  assert.ok(typeof annotated.prompt === 'string' && annotated.prompt.length > 0);
  assert.ok(
    ['symbolic', 'psychological', 'spiritual', 'practical'].includes(annotated.lens),
    'lens must be one of the four',
  );
  assert.equal(annotated.framing, REFLECTIVE_FRAMING);
  assert.equal(getSyncCardAnnotated('nope-not-a-card'), null, 'unknown id returns null');
});

// ---------- (d) deck prompts: no predictive/fear language ----------

const BANNED_PROMPT_PATTERNS = [
  /\bwarning\b/i,
  /\bbeware\b/i,
  /\bfate\b/i,
  /\bdestiny\b/i,
  /\bwill happen\b/i,
  /\bwill come\b/i,
  /\bcoming for you\b/i,
  /\bdoomed?\b/i,
  /\bdanger\b/i,
  /\bthreat\b/i,
  /\bomen\b/i,
  /\bcursed?\b/i,
  /\bpunish/i,
  /\bmiss (?:this|the) sign\b/i,
  /\bsign you (?:must|should)\b/i,
  /\ba message from beyond\b/i,
  /\bdiagnos[ie]/i,
];

test('(d) deck has exactly 48 unique, well-formed cards with valid lenses', () => {
  assert.equal(SYNC_DECK.length, 48, 'deck must hold 48 starter cards');
  const ids = new Set(SYNC_DECK.map((c) => c.id));
  assert.equal(ids.size, 48, 'card ids must be unique');
  const lensCounts = { symbolic: 0, psychological: 0, spiritual: 0, practical: 0 };
  for (const c of SYNC_DECK) {
    assert.ok(typeof c.id === 'string' && c.id.length > 0, 'card needs an id');
    assert.ok(typeof c.word === 'string' && c.word.length > 0, 'card needs a word');
    assert.ok(typeof c.prompt === 'string' && c.prompt.length > 0, 'card needs a prompt');
    assert.ok(
      Object.prototype.hasOwnProperty.call(lensCounts, c.lens),
      `card ${c.id} has an invalid lens: ${c.lens}`,
    );
    lensCounts[c.lens] += 1;
  }
  for (const [lens, count] of Object.entries(lensCounts)) {
    assert.ok(count > 0, `lens "${lens}" should appear on at least one card`);
  }
});

test('(d) deck prompts contain no predictive or fear-based language', () => {
  for (const c of SYNC_DECK) {
    for (const re of BANNED_PROMPT_PATTERNS) {
      assert.doesNotMatch(c.prompt, re, `card "${c.id}": banned pattern ${re} in ${JSON.stringify(c.prompt)}`);
    }
    // Deck editorial rules: open questions, curious tone, no em dashes.
    assert.match(c.prompt, /\?$/, `card "${c.id}" prompt should be an open question`);
    assert.ok(!c.prompt.includes('—'), `card "${c.id}" prompt must not use an em dash`);
    assert.ok(!c.prompt.includes('you will'), `card "${c.id}" must not make second-person predictions`);
  }
});

test('(d) getSyncCard round-trips every card', () => {
  for (const c of SYNC_DECK) {
    assert.deepEqual(getSyncCard(c.id), c);
  }
  assert.equal(getSyncCard(42), null);
});

// ---------- (e) matching behavior unregressed ----------

test('(e) findMatches still ranks the clearly-best candidate first', () => {
  const requester = profile(1, {
    practices: ['meditation'],
    interests: ['dreamwork'],
    intention: 'daily meditation and dreamwork practice together',
  });
  const best = profile(2, {
    practices: ['meditation'],
    interests: ['dreamwork'],
    intention: 'daily meditation practice with dreamwork reflection',
  });
  const okay = profile(3, {
    practices: ['yoga'],
    interests: ['dreamwork'],
    intention: 'evening yoga flows for calm',
  });
  const matches = findMatches(requester, [okay, best], {
    intentionText: 'daily meditation and dreamwork practice together',
  });
  assert.deepEqual(
    matches.map((m) => m.candidate.id),
    [2, 3],
    'rank order must not regress',
  );
  assert.ok(matches[0].score > matches[1].score, 'scores must still separate');
  assert.ok(matches[0].reasons.length > 0, 'top match still explains itself');
  assert.ok(
    typeof matches[0].resonanceNote === 'string' && matches[0].resonanceNote.length > 0,
    'new resonanceNote must not crowd out reasons',
  );
});

test('(e) scoring weights intact: shared practices outrank shared interests', () => {
  const requester = profile(1, { practices: ['meditation'], interests: [], intention: '' });
  const withPractice = profile(2, { practices: ['meditation'], interests: [], intention: '' });
  const withInterests = profile(3, { practices: [], interests: ['dreamwork'], intention: '' });
  const a = scoreCandidate(requester, withPractice);
  const b = scoreCandidate(profile(1, { interests: ['dreamwork'] }), withInterests);
  assert.equal(a.score, 3, 'one shared practice scores 3');
  assert.equal(b.score, 2, 'one shared interest scores 2');
});

test('(e) consent gates still hold: non-opted-in candidates stay out', () => {
  const requester = profile(1, { practices: ['meditation'], intention: 'meditation partner' });
  const optedOut = profile(2, { practices: ['meditation'], intention: 'meditation partner' });
  optedOut.consents = { introductions: false, community_visible: true, ai_matching: true };
  const matches = findMatches(requester, [optedOut], { intentionText: 'meditation partner' });
  assert.deepEqual(matches, [], 'introductions opt-in gate must not regress');
});

test('(e) resonanceNote follows the adopted pattern without certainty claims', () => {
  const note = resonanceNote({
    sharedPractices: ['dreamwork'],
    sharedInterests: ['consciousness research'],
  });
  assert.match(note, /noticed a possible point of resonance/i);
  assert.match(note, /only an optional introduction/i);
  assert.match(note, /not a prediction or judgment about compatibility/i);
  assertNoBannedLanguage([note], 'resonanceNote');
});
