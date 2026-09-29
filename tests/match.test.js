// SEREN MVP — unit tests for src/match.js (pure matching engine, no I/O).

import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, findBestMatch, buildIntroNote } from '../src/match.js';

// ---------- tokenize ----------

test('tokenize lowercases and keeps alphanumeric tokens >= 4 chars', () => {
  assert.deepEqual(tokenize('Daily MEDITATION practice'), ['daily', 'meditation', 'practice']);
});

test('tokenize drops tokens shorter than 4 chars', () => {
  assert.deepEqual(tokenize('to be or not to be'), []);
  assert.deepEqual(tokenize('a sea of dreams'), ['dreams']);
});

test('tokenize removes stopwords', () => {
  assert.deepEqual(tokenize('seeking deeper breathwork guidance'), ['breathwork', 'guidance']);
});

test('tokenize deduplicates tokens', () => {
  assert.deepEqual(tokenize('yoga yoga YOGA, yoga!'), ['yoga']);
});

test('tokenize strips punctuation and keeps alphanumeric runs', () => {
  assert.deepEqual(tokenize('dream-work: 2024 visions!'), ['dream', 'work', '2024', 'visions']);
});

test('tokenize returns [] for non-string input', () => {
  assert.deepEqual(tokenize(null), []);
  assert.deepEqual(tokenize(undefined), []);
  assert.deepEqual(tokenize(42), []);
});

// ---------- findBestMatch ----------

function profile(id, { name, interests = [], intention = '', visible = true } = {}) {
  return {
    id,
    name: name ?? `Person ${id}`,
    interests,
    intention,
    consents: { introductions: true, community_visible: visible, ai_matching: true },
  };
}

test('findBestMatch scores 2x shared interests + 1x shared keywords and picks the best', () => {
  const intention = 'I want a daily meditation partner for shared practice and accountability';
  const requester = profile(1, { name: 'Rae', interests: ['meditation', 'tarot'], intention });
  const candidates = [
    profile(2, {
      name: 'Sam',
      interests: ['meditation', 'yoga'],
      intention: 'daily meditation practice with breathwork and stillness',
    }),
    profile(3, {
      name: 'Jo',
      interests: ['tarot'],
      intention: 'reading cards for friends on weekends',
    }),
  ];
  const best = findBestMatch(requester, candidates, intention, new Set());
  // Sam: 1 shared interest (2 pts) + shared keywords daily/meditation/practice (3 pts) = 5.
  // Jo:  1 shared interest (2 pts) + 0 shared keywords = 2.
  assert.equal(best.candidate.id, 2);
  assert.deepEqual(best.sharedInterests, ['meditation']);
  assert.deepEqual(best.sharedKeywords, ['daily', 'meditation', 'practice']);
  assert.equal(best.score, 5);
  assert.equal(best.score, 2 * best.sharedInterests.length + best.sharedKeywords.length);
});

test('findBestMatch excludes the requester even when listed as a candidate', () => {
  const intention = 'daily meditation practice together';
  const requester = profile(1, { interests: ['meditation'], intention });
  const clone = profile(1, { interests: ['meditation'], intention }); // perfect self-match
  const other = profile(2, { interests: ['yoga'], intention: 'evening yoga flows for calm' });
  const best = findBestMatch(requester, [clone, other], intention, new Set());
  assert.equal(best.candidate.id, 2);
});

test('findBestMatch excludes candidates without community_visible consent', () => {
  const intention = 'daily meditation practice together';
  const requester = profile(1, { interests: ['meditation'], intention });
  const hidden = profile(2, {
    interests: ['meditation'],
    intention,
    visible: false,
  });
  assert.equal(findBestMatch(requester, [hidden], intention, new Set()), null);
});

test('findBestMatch skips pairs with an existing non-withdrawn introduction', () => {
  const intention = 'daily meditation practice together';
  const requester = profile(1, { interests: ['meditation'], intention });
  const paired = profile(2, { interests: ['meditation'], intention });
  const fresh = profile(3, { interests: ['yoga'], intention: 'gentle yoga at sunrise daily' });
  // Pair key is min:max regardless of which side requested the introduction.
  const best = findBestMatch(requester, [paired, fresh], intention, new Set(['1:2']));
  assert.equal(best.candidate.id, 3);
});

test('findBestMatch skips the pair when the requester was the proposed side', () => {
  const intention = 'daily meditation practice together';
  const requester = profile(2, { interests: ['meditation'], intention });
  const paired = profile(1, { interests: ['meditation'], intention });
  assert.equal(findBestMatch(requester, [paired], intention, new Set(['1:2'])), null);
});

test('findBestMatch treats withdrawn pairs as re-eligible', () => {
  const intention = 'daily meditation practice together';
  const requester = profile(1, { interests: ['meditation'], intention });
  const candidate = profile(2, { interests: ['meditation'], intention });
  // Withdrawn introductions are omitted from the pair-key set by the caller,
  // so the candidate is eligible again.
  const best = findBestMatch(requester, [candidate], intention, new Set());
  assert.equal(best.candidate.id, 2);
});

test('findBestMatch breaks score ties by lowest profile id', () => {
  const intention = 'daily meditation practice together always';
  const requester = profile(1, { interests: ['meditation'], intention });
  // Identical scores; higher id listed first to prove the tiebreak is by id, not order.
  const b = profile(8, { interests: ['meditation'], intention });
  const a = profile(7, { interests: ['meditation'], intention });
  const best = findBestMatch(requester, [b, a], intention, new Set());
  assert.equal(best.score, 7);
  assert.equal(best.candidate.id, 7);
});

test('findBestMatch returns a score-0 candidate when nothing better exists', () => {
  const requester = profile(1, {
    interests: ['meditation'],
    intention: 'seeking stillness in morning light',
  });
  const candidate = profile(2, {
    interests: ['tarot'],
    intention: 'reading cards under moonlight',
  });
  const best = findBestMatch(requester, [candidate], 'seeking stillness in morning light', new Set());
  assert.ok(best);
  assert.equal(best.candidate.id, 2);
  assert.equal(best.score, 0);
  assert.deepEqual(best.sharedInterests, []);
  assert.deepEqual(best.sharedKeywords, []);
});

test('findBestMatch returns null when no candidates are eligible', () => {
  const requester = profile(1, { interests: ['meditation'], intention: 'daily meditation practice' });
  assert.equal(findBestMatch(requester, [], 'daily meditation practice', new Set()), null);
  assert.equal(findBestMatch(requester, null, 'daily meditation practice', new Set()), null);
});

// ---------- buildIntroNote ----------

test('buildIntroNote contains both names and the shared interests', () => {
  const note = buildIntroNote(
    { name: 'Aria Moon', intention: 'I want a daily meditation partner for morning practice.' },
    { name: 'Kai Sun' },
    ['meditation', 'yoga'],
    ['breathwork'],
  );
  assert.match(note, /Kai Sun/);
  assert.match(note, /Aria/);
  assert.match(note, /2 spiritual interests \(meditation, yoga\)/);
  assert.match(note, /breathwork/);
});

test('buildIntroNote uses singular "interest" for one shared interest', () => {
  const note = buildIntroNote(
    { name: 'Aria Moon', intention: 'I want a daily meditation partner for morning practice.' },
    { name: 'Kai Sun' },
    ['meditation'],
    [],
  );
  assert.match(note, /share 1 spiritual interest \(meditation\)\./);
});

test('buildIntroNote is honest when there are zero shared interests', () => {
  const note = buildIntroNote(
    { name: 'Aria Moon', intention: 'I want a daily meditation partner for morning practice.' },
    { name: 'Kai Sun' },
    [],
    ['breathwork'],
  );
  assert.match(note, /Kai Sun/);
  assert.match(note, /Aria/);
  assert.match(note, /don't share listed spiritual interests yet/i);
  assert.doesNotMatch(note, /share 0 spiritual/);
  assert.match(note, /breathwork/);
});

test('buildIntroNote truncates a very long intention echo', () => {
  const long = `I want ${'a'.repeat(300)} partner.`;
  const note = buildIntroNote({ name: 'Aria', intention: long }, { name: 'Kai' }, [], []);
  assert.ok(note.includes('…'), 'long intention is truncated with an ellipsis');
  assert.ok(!note.includes(long), 'full long intention is not echoed verbatim');
});

test('buildIntroNote handles a missing intention gracefully', () => {
  const note = buildIntroNote({ name: 'Aria Moon' }, { name: 'Kai Sun' }, ['yoga'], []);
  assert.match(note, /^You and Kai Sun share 1 spiritual interest \(yoga\)\./);
  assert.match(note, /Aria, may this connection serve your path\./);
});

// ---------- findMatches: introductions-consent gate ----------

test('findMatches excludes candidates who have not opted into introductions', async () => {
  const { findMatches } = await import('../src/match.js');
  const requester = profile(1, { interests: ['meditation'], intention: 'daily meditation partner wanted' });
  const yes = profile(2, { interests: ['meditation'], intention: 'daily meditation partner wanted' });
  const no = profile(3, { interests: ['meditation'], intention: 'daily meditation partner wanted' });
  no.consents = { introductions: false, community_visible: true, ai_matching: true };
  const matches = findMatches(requester, [yes, no], { intentionText: 'meditation partner' });
  assert.deepEqual(matches.map((m) => m.candidate.id), [2]);
});

// ---------- buildPairReasons ----------

test('buildPairReasons: forRequester keeps scored reasons; forCandidate names a concrete link', async () => {
  const { buildPairReasons } = await import('../src/match.js');
  const requester = profile(1, {
    intention: 'I want to support someone moving through grief with steady presence.',
  });
  const candidate = profile(2, {
    intention: 'I am moving through grief and looking for gentle company.',
    practices: ['meditation'],
  });
  const scored = { reasons: ['You both care about Meditation.'] };
  const { forRequester, forCandidate } = buildPairReasons(
    requester, candidate, scored, 'I can offer a calm listening space around grief each week.',
  );
  assert.deepEqual(forRequester, ['You both care about Meditation.']);
  assert.ok(forCandidate.includes('grief'), `concrete link named: ${forCandidate}`);
  assert.ok(!/mutual interest|shared history|perfect match/i.test(forCandidate));
});

test('buildPairReasons: honest fallback when no concrete link can be derived', async () => {
  const { buildPairReasons, PAIR_REASON_FALLBACK } = await import('../src/match.js');
  const requester = profile(1, { intention: 'I want to talk about ocean swimming.' });
  const candidate = profile(2, { intention: 'I am studying ancient philosophy texts.' });
  const { forCandidate } = buildPairReasons(requester, candidate, { reasons: [] }, 'I can offer swim tips.');
  assert.equal(forCandidate, PAIR_REASON_FALLBACK);
  assert.ok(!/definitely|perfect|soulmate|meant to/i.test(forCandidate));
});
