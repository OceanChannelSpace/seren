// SEREN — Flourishing by Design: intention-based onboarding tests.
//
// Contract under test (unit level, no server/DB):
// - The onboarding stage machine walks the new question order:
//     ob_name -> ob_email -> ob_intentions -> ob_connection_levels ->
//     ob_interests -> ob_topics_out -> ob_privacy -> ob_location ->
//     ob_intention -> ob_seeking -> ob_online_mode -> ob_frequency ->
//     ob_boundaries -> ob_sync_mode -> ob_values -> ob_consent -> create
// - Every new question is skippable; skipped questions apply calm defaults.
// - The `create` payload carries connectionPrefs / consentSettings with the
//   new keys, so the server's creation path can persist them.
// - validateProfileInput rejects bad enums / oversized text for the new fields.
// - Required consents still gate profile creation (no consent -> no create).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  startOnboarding,
  handleOnboardingTurn,
  questionForStage,
  isOnboardingStage,
  ONBOARDING_STAGES,
  ONBOARDING_INTENTION_VALUES,
  ONBOARDING_CONNECTION_LEVEL_VALUES,
  ONBOARDING_PRIVACY_LEVELS,
  ONBOARDING_LOCATION_RADII,
  ONBOARDING_ONLINE_MODES,
  ONBOARDING_REC_FREQUENCIES,
  ONBOARDING_SYNC_MODES,
  FLOURISHING_DEFAULTS,
} from '../src/onboarding.js';
import { validateProfileInput } from '../src/validate.js';

const NEW_STAGES = [
  'ob_intentions', 'ob_connection_levels', 'ob_topics_out', 'ob_privacy',
  'ob_location', 'ob_online_mode', 'ob_frequency', 'ob_boundaries', 'ob_sync_mode',
];

const EXPECTED_ORDER = [
  'ob_name', 'ob_email', 'ob_intentions', 'ob_connection_levels',
  'ob_interests', 'ob_topics_out', 'ob_privacy', 'ob_location',
  'ob_intention', 'ob_seeking', 'ob_online_mode', 'ob_frequency',
  'ob_boundaries', 'ob_sync_mode', 'ob_values', 'ob_consent',
];

/** Drive the machine through a list of user texts; return the final result. */
function drive(texts) {
  const begun = startOnboarding();
  let stage = begun.stage;
  let answers = begun.answers;
  for (const text of texts) {
    const turn = handleOnboardingTurn(stage, answers, text);
    if (turn.create) return { create: turn.create, stage, answers: turn.answers };
    if (turn.reclaim) throw new Error('unexpected reclaim branch');
    stage = turn.stage;
    answers = turn.answers;
  }
  return { stage, answers };
}

const REQUIRED_ANSWERS = {
  name: 'Maya Chen',
  email: 'maya@example.com',
  interests: 'Meditation, Tarot',
  intention: 'I am seeking calm meditation partners and honest conversation about consciousness.',
  seeking: 'Practice partner',
  values: 'Grounded',
};

// ---------- stage order & payload shape ----------

test('the stage machine follows the intention-based order', async () => {
  const seen = [startOnboarding().stage];
  const r = drive([
    REQUIRED_ANSWERS.name, REQUIRED_ANSWERS.email,
    'skip', 'skip',
    REQUIRED_ANSWERS.interests,
    'skip', 'skip', 'skip',
    REQUIRED_ANSWERS.intention, REQUIRED_ANSWERS.seeking,
    'skip', 'skip', 'skip', 'skip',
    REQUIRED_ANSWERS.values,
    'Yes, I consent',
  ]);
  assert.ok(r.create, 'expected the interview to complete with a create payload');
  assert.deepEqual(seen.concat(EXPECTED_ORDER.slice(1)), EXPECTED_ORDER);
});

test('question payloads keep the {questionId, input, options, skippable} shape', async () => {
  for (const stage of NEW_STAGES) {
    const q = questionForStage(stage, { name: 'Maya' });
    assert.equal(q.kind, 'question', stage);
    assert.equal(q.questionId, stage, stage);
    assert.ok(['multi', 'single', 'free'].includes(q.input), `${stage} input=${q.input}`);
    if (q.input !== 'free') {
      assert.ok(Array.isArray(q.options) && q.options.length > 0, stage);
    } else {
      assert.deepEqual(q.options, [], stage);
    }
    assert.equal(q.skippable, true, `${stage} must be skippable`);
    for (const o of q.options) {
      assert.ok(typeof o.value === 'string' && o.value.length > 0, stage);
      assert.ok(typeof o.label === 'string' && o.label.length > 0, stage);
    }
  }
});

test('new questionIds are registered onboarding stages', async () => {
  assert.deepEqual(ONBOARDING_STAGES, [...EXPECTED_ORDER, 'ob_declined']);
  for (const stage of EXPECTED_ORDER) assert.ok(isOnboardingStage(stage), stage);
});

test('every bot text stays within the 400-character tone contract', async () => {
  const answers = { name: 'Maya' };
  for (const stage of ONBOARDING_STAGES) {
    const q = questionForStage(stage, answers);
    if (!q) continue;
    const texts = Array.isArray(q) ? q : [q];
    for (const m of texts) {
      assert.ok(typeof m.text === 'string', stage);
      assert.ok(m.text.length <= 400, `${stage}: ${m.text.length} chars`);
    }
  }
});

// ---------- happy path: all questions answered ----------

const HAPPY_ANSWERS = [
  'Maya Chen',
  'maya@example.com',
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

test('happy path: answers persist into connectionPrefs and consentSettings', async () => {
  const { create } = drive(HAPPY_ANSWERS);
  assert.ok(create, 'expected a create payload');
  assert.equal(create.name, 'Maya Chen');
  assert.equal(create.email, 'maya@example.com');
  assert.deepEqual(create.interests, ['meditation', 'tarot']);
  assert.deepEqual(create.connectionPrefs, {
    seeking: ['practice-partner'],
    availability: '',
    intentions: ['spiritual-alignment', 'local-community'],
    connectionLevels: ['ai-conversations', 'one-to-one'],
    topicsOut: ['astrology'],
    privacyLevel: 'private',
    locationRadius: 'regional',
    onlineMode: 'hybrid',
    commBoundaries: 'Sunday mornings only, please',
    syncMode: 'limited',
  });
  assert.deepEqual(create.consentSettings, { recFrequency: 'weekly' });
});

// ---------- skip-everything path: defaults applied ----------

const SKIP_ALL = [
  'Maya Chen',
  'maya@example.com',
  'skip', // intentions
  'skip', // connection levels
  'Meditation',
  'skip', // topics out
  'skip', // privacy
  'skip', // location
  'I am seeking calm meditation partners and honest conversation about consciousness.',
  'Practice partner',
  'skip', // online mode
  'skip', // frequency
  'skip', // boundaries
  'skip', // sync mode
  'skip', // values
  'Yes, I consent',
];

test('skip-everything path applies calm defaults', async () => {
  const { create } = drive(SKIP_ALL);
  assert.ok(create, 'expected a create payload');
  assert.deepEqual(create.connectionPrefs, {
    seeking: ['practice-partner'],
    availability: '',
    intentions: [],
    connectionLevels: [],
    topicsOut: [],
    privacyLevel: FLOURISHING_DEFAULTS.privacyLevel,
    locationRadius: FLOURISHING_DEFAULTS.locationRadius,
    onlineMode: FLOURISHING_DEFAULTS.onlineMode,
    commBoundaries: '',
    syncMode: FLOURISHING_DEFAULTS.syncMode,
  });
  assert.deepEqual(create.consentSettings, { recFrequency: FLOURISHING_DEFAULTS.recFrequency });
  assert.equal(FLOURISHING_DEFAULTS.privacyLevel, 'community');
  assert.equal(FLOURISHING_DEFAULTS.locationRadius, 'anywhere');
  assert.equal(FLOURISHING_DEFAULTS.onlineMode, 'hybrid');
  assert.equal(FLOURISHING_DEFAULTS.recFrequency, 'weekly');
  assert.equal(FLOURISHING_DEFAULTS.syncMode, 'limited');
});

// ---------- per-stage behavior ----------

test('multi-select answers accept comma phrases and dedupe', async () => {
  let s = startOnboarding();
  let answers = s.answers;
  let turn = handleOnboardingTurn('ob_intentions', answers,
    'Meet spiritually aligned people, Meet spiritually aligned people, Explore consciousness and meaning');
  assert.equal(turn.stage, 'ob_connection_levels');
  assert.deepEqual(turn.answers.intentions, ['spiritual-alignment', 'consciousness-meaning']);
});

test('unrecognized answers re-ask without advancing', async () => {
  const same = (stage, text, answers = {}) => {
    const turn = handleOnboardingTurn(stage, answers, text);
    assert.equal(turn.stage, stage, `${stage} should not advance on ${JSON.stringify(text)}`);
    assert.ok(!turn.create);
  };
  same('ob_intentions', 'quantum banana farming');
  same('ob_connection_levels', 'quantum banana farming');
  same('ob_topics_out', 'quantum banana farming');
  same('ob_privacy', 'quantum banana farming');
  same('ob_location', 'quantum banana farming');
  same('ob_online_mode', 'quantum banana farming');
  same('ob_frequency', 'quantum banana farming');
  same('ob_sync_mode', 'quantum banana farming');
});

test('topics-out accepts "none" as an explicit empty answer', async () => {
  const turn = handleOnboardingTurn('ob_topics_out', {}, 'none');
  assert.equal(turn.stage, 'ob_privacy');
  assert.deepEqual(turn.answers.topicsOut, []);
});

test('boundaries over 200 characters re-ask', async () => {
  const turn = handleOnboardingTurn('ob_boundaries', {}, 'x'.repeat(201));
  assert.equal(turn.stage, 'ob_boundaries');
  assert.ok(!turn.create);
  const ok = handleOnboardingTurn('ob_boundaries', {}, 'Evenings are best.');
  assert.equal(ok.stage, 'ob_sync_mode');
  assert.equal(ok.answers.commBoundaries, 'Evenings are best.');
});

test('single-select answers resolve by label or value', async () => {
  const cases = [
    ['ob_privacy', 'Community — members can find me', 'community'],
    ['ob_location', 'My wider region', 'regional'],
    ['ob_online_mode', 'In person', 'offline'],
    ['ob_frequency', "Daily — I'm feeling social", 'daily'],
    ['ob_sync_mode', 'Open to synchronicity', 'on'],
  ];
  for (const [stage, text, expected] of cases) {
    const turn = handleOnboardingTurn(stage, {}, text);
    const key = {
      ob_privacy: 'privacyLevel', ob_location: 'locationRadius',
      ob_online_mode: 'onlineMode', ob_frequency: 'recFrequency',
      ob_sync_mode: 'syncMode',
    }[stage];
    assert.equal(turn.answers[key], expected, `${stage} <- ${text}`);
  }
});

// ---------- validation (validate.js, new fields only) ----------

const baseProfile = (connectionPrefs, consentSettings = undefined) => ({
  name: 'Maya Chen',
  email: 'maya@example.com',
  interests: ['meditation'],
  intention: 'I am seeking calm meditation partners and honest conversation.',
  connectionPrefs,
  consents: { introductions: true, community_visible: true, ai_matching: true },
  ...(consentSettings === undefined ? {} : { consentSettings }),
});

const validPrefs = {
  seeking: ['practice-partner'],
  availability: '',
  intentions: ['spiritual-alignment', 'local-community'],
  connectionLevels: ['ai-conversations', 'one-to-one'],
  topicsOut: ['astrology'],
  privacyLevel: 'private',
  locationRadius: 'regional',
  onlineMode: 'hybrid',
  commBoundaries: 'Sunday mornings only.',
  syncMode: 'limited',
};

test('validation accepts the full new connectionPrefs shape', async () => {
  const { ok, errors } = validateProfileInput(
    baseProfile(validPrefs, { recFrequency: 'weekly' }));
  assert.equal(ok, true, JSON.stringify(errors));
});

test('validation rejects bad enum values for the new fields', async () => {
  const cases = [
    [{ ...validPrefs, intentions: ['bogus-intention'] }, 'connectionPrefs.intentions'],
    [{ ...validPrefs, connectionLevels: ['bogus-level'] }, 'connectionPrefs.connectionLevels'],
    [{ ...validPrefs, topicsOut: ['not-a-topic'] }, 'connectionPrefs.topicsOut'],
    [{ ...validPrefs, privacyLevel: 'public' }, 'connectionPrefs.privacyLevel'],
    [{ ...validPrefs, locationRadius: 'global' }, 'connectionPrefs.locationRadius'],
    [{ ...validPrefs, onlineMode: 'telepathy' }, 'connectionPrefs.onlineMode'],
    [{ ...validPrefs, syncMode: 'always' }, 'connectionPrefs.syncMode'],
  ];
  for (const [prefs, field] of cases) {
    const { ok, errors } = validateProfileInput(baseProfile(prefs));
    assert.equal(ok, false, `expected rejection for ${field}`);
    assert.ok(errors.some((e) => e.field === field), `${field}: ${JSON.stringify(errors)}`);
  }
});

test('validation enforces array bounds and text length on new fields', async () => {
  // intentions 0–9
  let r = validateProfileInput(baseProfile({
    ...validPrefs,
    intentions: [...ONBOARDING_INTENTION_VALUES, 'extra'],
  }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'connectionPrefs.intentions'));

  // connectionLevels 0–5
  r = validateProfileInput(baseProfile({
    ...validPrefs,
    connectionLevels: [...ONBOARDING_CONNECTION_LEVEL_VALUES, 'extra'],
  }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'connectionPrefs.connectionLevels'));

  // commBoundaries ≤ 200 chars
  r = validateProfileInput(baseProfile({ ...validPrefs, commBoundaries: 'x'.repeat(201) }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'connectionPrefs.commBoundaries'));

  // commBoundaries may be empty / omitted
  r = validateProfileInput(baseProfile({ ...validPrefs, commBoundaries: '' }));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('validation rejects a bad recFrequency and accepts the enum', async () => {
  let r = validateProfileInput(baseProfile(validPrefs, { recFrequency: 'hourly' }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'consentSettings.recFrequency'));

  for (const f of ONBOARDING_REC_FREQUENCIES) {
    r = validateProfileInput(baseProfile(validPrefs, { recFrequency: f }));
    assert.equal(r.ok, true, `recFrequency=${f}: ${JSON.stringify(r.errors)}`);
  }
});

test('validation still accepts legacy payloads without the new keys', async () => {
  const { ok, errors } = validateProfileInput(baseProfile({ seeking: ['friendship'] }));
  assert.equal(ok, true, JSON.stringify(errors));
});

// ---------- consent gating ----------

test('required consents still gate profile creation', async () => {
  const prefix = [
    'Maya Chen', 'maya@example.com', 'skip', 'skip', 'Meditation',
    'skip', 'skip', 'skip',
    'I am seeking calm meditation partners and honest conversation about consciousness.',
    'Practice partner', 'skip', 'skip', 'skip', 'skip', 'skip',
  ];
  // Decline -> no create, declined stage.
  let r = drive([...prefix, 'Not yet']);
  assert.equal(r.stage, 'ob_declined');
  assert.ok(!r.create, 'declining must not produce a create payload');

  // Vague answer at consent -> re-ask, no create.
  const consentState = handleOnboardingTurn('ob_consent', {}, 'maybe');
  assert.equal(consentState.stage, 'ob_consent');
  assert.ok(!consentState.create);

  // "I'm ready" after declining -> create with defaults from kept answers.
  const declined = handleOnboardingTurn('ob_declined', {
    name: 'Maya Chen', email: 'maya@example.com',
    interests: ['meditation'], intention: 'x'.repeat(20), seeking: ['friendship'],
  }, "I'm ready");
  assert.ok(declined.create, 'saying ready after declining must create');
  assert.deepEqual(declined.create.connectionPrefs.privacyLevel, 'community');
  assert.deepEqual(declined.create.consentSettings, { recFrequency: 'weekly' });
});

test('required stages (name, email, interests, intention, seeking) are not skippable', async () => {
  assert.equal(questionForStage('ob_name').skippable, false);
  assert.equal(questionForStage('ob_email').skippable, false);
  assert.equal(questionForStage('ob_interests').skippable, false);
  assert.equal(questionForStage('ob_intention').skippable, false);
  assert.equal(questionForStage('ob_seeking').skippable, false);
  const skip = handleOnboardingTurn('ob_name', {}, 'skip');
  assert.equal(skip.stage, 'ob_name', 'skipping the required name stage must re-ask');
});
