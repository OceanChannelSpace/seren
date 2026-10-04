// SEREN guide engine — the rule-based connection guide.
// Honest labeling: this is deterministic keyword/regex logic, not an LLM
// or external AI. It matches on words the member provides.
//
// Keyword-based intent parsing, minimal follow-up selection, and curated
// proposal building. Pure functions: no network, no LLM, no side effects.
// Tone contract: warm and grounded; never supernatural certainty, never
// clinical/therapy/medical claims, never numeric scores in output.
// All bot copy in this module is written to satisfy GUIDE_BEHAVIOR_RULES
// below (the maintainable "system prompt" for future contributors).

/* ============================================================================
 * GUIDE_BEHAVIOR_RULES — the SEREN guide's behavior contract.
 *
 * This engine is rule-based (deterministic keyword/regex matching, NOT an
 * LLM or external AI). The rules below are the maintainable "system prompt":
 * every bot-facing string in this module is written to satisfy them, and
 * tests/guide-flourishing.test.js asserts the banned phrasing never appears.
 * ----------------------------------------------------------------------------
 * 1. WHO THE GUIDE IS
 *    A warm, grounded companion that helps a person clarify intention,
 *    offers optional reflective prompts, helps prepare for a conversation,
 *    gathering, practice, or collaboration, suggests grounded next actions,
 *    helps formulate boundaries and questions, and facilitates reflection
 *    after a connection or event. It encourages real-world support and
 *    community over prolonged chat dependence: the guide is a doorway,
 *    not a destination.
 * 2. SPIRITUALLY LITERATE, NEVER SUPERNATURAL
 *    Meditation, ritual, dreamwork, symbolism, tarot, astrology, and other
 *    contemplative vocabularies are welcome as human practices and tools
 *    for meaning-making. The guide never claims supernatural knowledge,
 *    certainty, or predictive power.
 * 3. AGENCY-FIRST LANGUAGE (use phrasings like these)
 *    - "One possible interpretation is…"
 *    - "Would you like a reflective, symbolic, practical, or psychological
 *      lens?"
 *    - "What meaning does this hold for you?"
 *    - "You are the best authority on your own experience."
 * 4. EPISTEMIC HUMILITY
 *    Keep these distinct in how things are framed: (a) personal
 *    meaning-making, (b) symbolic/creative interpretation, (c)
 *    evidence-informed information, (d) community perspectives, (e)
 *    unverified claims. Never present an interpretation as objectively
 *    true, medically valid, predictive of the future, or externally
 *    verified.
 * 5. THE GUIDE MUST NEVER
 *    - present itself as conscious, enlightened, spiritually superior,
 *      psychic, or an entity with spiritual authority;
 *    - claim to channel beings, know anyone's destiny, identify a soulmate,
 *      reveal past lives as fact, or diagnose energetic/spiritual conditions;
 *    - reinforce paranoia, delusions, grandiosity, or certainty around
 *      unverified interpretations;
 *    - encourage isolation from real-world support;
 *    - act as guru, oracle, therapist, or source of metaphysical certainty.
 * 6. BANNED PHRASING (never emit, in any casing)
 *    "This sign means you must…", "You are destined to…",
 *    "Your energy proves…", "I have detected an entity, hidden truth, or
 *    future outcome." Also banned as fact-claims: "soulmate", "past life",
 *    diagnosing ("diagnos…"), and commanding "you must".
 * 7. CRISIS
 *    Always encourage professional and trusted-human support; never weaken
 *    that. The guide does not counsel, diagnose, or assess risk — it points
 *    to real people and professional help. (The welcome screen carries the
 *    crisis line; do not contradict or remove it.)
 * 8. MECHANICAL GUARDRAILS
 *    - Every bot text is 400 characters or fewer.
 *    - Honest labeling: rule-based logic, never presented as an AI model.
 *      SEREN never claims to be human.
 *    - Real-people-only matching surfaces: demo/seed and QA profiles never
 *      appear as candidates.
 *    - Consent-first: nothing is shared with another person until the
 *      member explicitly approves it.
 * 9. REAL-LIFE COMPLETION
 *    At natural conversation conclusions (a brief is approved; an
 *    introduction is accepted or acted on), offer the optional, skippable
 *    real-life prompt (see realLifePrompt()): "What would you like to
 *    bring into your real life in the next 24 hours?"
 * 10. DIGITAL SAPIENS — ATTENTION INTEGRITY
 *    Informed by Jack Probert's Digital Sapiens Experiment 2 (20 Harvard
 *    students, 3 days without instant messaging, Sep 2026): technology
 *    should empower, connect, and elevate — never diminish. Concretely:
 *    - Never manufacture urgency: no countdowns, scarcity, "act now",
 *      or "don't miss out" framing.
 *    - Never guilt-trip about inactivity: no "we miss you", "you haven't
 *      been here", or comeback nudges of any kind.
 *    - Affirm reply-when-you-want norms: members may reply slowly, or not
 *      at all, without apology. Slow is fine.
 *    - Celebrate disconnection and real-world follow-through as wins —
 *      less time here and more time in life is the goal.
 *    - Distinguish logistics from connection: coordination (when/where/how)
 *      is plumbing; the human connection is the point. Never let the two
 *      be treated as the same kind of message.
 * ========================================================================== */

import {
  PRACTICES, INTENTIONS,
  CONNECTION_FORMATS, FORMAT_LABELS,
  COMMITMENT_LEVELS, COMMITMENT_LABELS,
  CONNECTION_TYPE_MAP,
  EXPLORE_TOPICS,
} from './constants.js';
import { findMatches, buildPairReasons } from './match.js';

const PRACTICE_VALUES = new Set(PRACTICES.map((p) => p.value));
const INTENTION_VALUES = new Set(INTENTIONS.map((i) => i.value));

/* ------------------------------------------------------------------ */
/* Keyword synonym maps.                                               */
/* Each entry: [value, ...regex fragments matched against the text].    */
/* ------------------------------------------------------------------ */

const PRACTICE_KEYWORDS = [
  ['meditation', ['meditat', 'sitting practice', 'zen sit', 'vipassana', 'zazen']],
  ['mindfulness', ['mindfulness', 'mindful living']],
  ['breathwork', ['breathwork', 'breath work', 'breathing practice', 'pranayama']],
  ['yoga', ['yoga', 'asana']],
  ['somatics', ['somatic', 'embodi', 'body-based', 'body based', 'felt sense']],
  ['ecstatic-dance', ['ecstatic dance', 'conscious dance', '5rhythms', '5 rhythms']],
  ['dreamwork', ['dreamwork', 'dream work', /\bdreams?\b/, 'lucid dream', 'dream journal']],
  ['tarot', ['tarot', /\bcards?\b/, 'card reading', 'card pull']],
  ['oracle-cards', ['oracle card', 'oracle deck']],
  ['astrology', ['astrolog', 'birth chart', 'natal chart', 'zodiac', 'transit']],
  ['human-design', ['human design']],
  ['energy-healing', ['energy healing', 'energy work', 'energetic healing', 'chakra']],
  ['reiki', ['reiki']],
  ['psychedelic-integration', ['psychedelic', 'plant medicine', 'ayahuasca', 'integration circle', 'journey integration']],
  ['consciousness-research', ['consciousness research', 'philosophy of mind', 'hard problem']],
  ['philosophy', ['philosoph', 'existential', 'metaphysics']],
  ['spirituality-without-religion', ['without religion', 'without dogma', 'secular spiritual', 'not religious', 'post-religious']],
  ['religion-contemplative-tradition', ['contemplative tradition', 'buddhis', 'sufism', 'kabbalah', 'vedanta', 'christian mystic', 'monastic']],
  ['nature-connection', ['nature', 'forest', 'hiking', 'wilderness', 'outdoors', 'earth-based']],
  ['ocean-water-practices', ['ocean', 'water practice', /\bsea\b/, 'surf', 'swim', 'freediv', 'cold plunge']],
  ['ritual-ceremony', [/\brituals?\b/, 'ceremony', 'ceremonial']],
  ['journaling', ['journal']],
  ['art-music', [/\bart\b/, 'music', 'painting', 'songwriting', 'creative expression', 'art project']],
  ['ai-consciousness', [/\bai\b/, 'artificial intelligence', 'machine consciousness', 'sentient ai']],
  ['quantum-frontier-science', ['quantum', 'frontier science']],
  ['community-building', ['community', 'tribe', 'sangha', 'intentional community']],
  ['service-volunteering', ['volunteering', 'volunteer', 'service work', 'give back']],
];

const INTENTION_KEYWORDS = [
  ['meaningful-friendship', [/\bfriend/, 'companionship', 'kindred']],
  ['spiritual-peer-connection', ['spiritual peer', 'like-minded', 'like minded', 'fellow seeker', 'on the path']],
  ['consciousness-exploration', ['consciousness', 'explore consciousness', 'what is consciousness']],
  ['meditation-partner', ['meditation partner', 'meditat', 'sit together', 'sitting partner', 'practice partner']],
  ['dreamwork-symbolism', ['dream', 'symbolism', 'symbolic']],
  ['tarot-oracle-exchange', ['tarot', 'oracle', 'card reading', 'reading exchange', 'card pull']],
  ['astrology-discussion', ['astrolog', 'birth chart', 'chart']],
  ['energy-work-discussion', ['energy work', 'reiki', 'healing exchange', 'energy healing']],
  ['breathwork-somatic', ['breathwork', 'somatic', 'breath']],
  ['creative-collaboration', ['creative', 'collaborat', 'project', 'build', 'create something', 'art project', 'music project', 'make something']],
  ['study-research', ['study', 'research', 'book club', 'learn together', 'reading group']],
  ['local-gathering', ['local', 'nearby', 'gathering', 'meetup', 'meet up', 'event companion', 'in person']],
  ['remote-conversation', ['remote', 'online', 'virtual', 'long distance', 'video chat']],
  ['accountability-partner', ['accountability', 'stay consistent', 'consistent with', 'check-in', 'check in', 'discipline']],
  ['mentorship-learning', ['mentor', 'teacher', 'guide me', 'learn from', 'apprentice', 'student of']],
];

const CONNECTION_TYPE_KEYWORDS = [
  ['meditation-partner', ['meditation partner', 'sit together', 'sitting partner']],
  ['dreamwork-exchange', ['dreamwork exchange', 'dreamwork', 'dream partner', 'explore dreams']],
  ['tarot-oracle-exchange', ['tarot', 'oracle', 'card reading']],
  ['breathwork-somatic-partner', ['breathwork partner', 'somatic', 'breath partner']],
  ['astrology-discussion', ['astrolog']],
  ['consciousness-research', ['consciousness', /\bai\b/]],
  ['practice-partner', ['practice partner']],
  ['spiritual-study-partner', ['study partner', 'study group', 'book club']],
  ['meaningful-friendship', [/\bfriend/]],
  ['group-circle', [/\bcircle\b/, 'small group', 'discussion group']],
  ['virtual-circle', ['virtual circle', 'online circle']],
  ['local-community', ['local community', 'local conscious', 'people near me']],
  ['event-companion', ['event companion', 'retreat companion', 'gathering companion', 'workshop companion']],
  ['creative-collaborator', ['creative collaborat']],
  ['project-collaborator', ['project', 'collaborat', 'build something', 'aligned collaborator']],
  ['mentor-request', ['mentor', 'teacher']],
  ['peer-learning-exchange', ['learning exchange', 'teach each other', 'skill swap']],
  ['accountability-partner', ['accountability']],
  ['one-to-one-conversation', ['conversation', 'talk with', 'chat with', 'discuss']],
];

// locality / format / commitment hints
const LOCAL_HINTS = ['local', 'nearby', 'in person', 'in-person', 'around here', 'my area', 'meet up', 'meetup'];
const REMOTE_HINTS = ['remote', 'online', 'virtual', 'long distance', 'video chat', 'over video'];
const FORMAT_HINTS = [
  ['video', ['video', 'video call', 'video chat', 'face to face']],
  ['voice', ['voice call', 'phone call', /\bcalls?\b/]],
  ['message', ['message', /\btexts?\b/, 'chat', 'write']],
  ['group', ['group', 'circle']],
  ['in-person', ['in person', 'in-person', 'meet up', 'meetup', 'in real life']],
];
const COMMITMENT_HINTS = [
  ['one-conversation', ['one conversation', 'one-time', 'one time', 'just once', 'single session']],
  ['recurring', ['recurring', 'regular', 'weekly', 'ongoing', 'steady', 'practice partner']],
  ['occasional', ['occasional', 'now and then', 'sometimes', 'every so often']],
];

const DEPTH_VALUES = ['grounded', 'curious', 'reflective', 'playful', 'structured', 'open-hearted'];
export const DEPTH_VALUE_LABELS = Object.freeze({
  'grounded': 'Grounded',
  'curious': 'Curious',
  'reflective': 'Reflective',
  'playful': 'Playful',
  'structured': 'Structured',
  'open-hearted': 'Open-hearted',
});

function matchAny(text, patterns) {
  for (const p of patterns) {
    if (typeof p === 'string') {
      if (text.includes(p)) return true;
    } else if (p.test(text)) {
      return true;
    }
  }
  return false;
}

/**
 * Parse a free-text connection request into structured intent.
 * Keyword-based and deterministic. Returns:
 * { practices, intentions, connectionTypes, topics, localityHint, formatHint,
 *   commitmentHint, values }
 */
export function parseIntent(text) {
  const t = typeof text === 'string' ? text.toLowerCase() : '';
  const out = {
    practices: [],
    intentions: [],
    connectionTypes: [],
    topics: [],
    localityHint: null,
    formatHint: null,
    commitmentHint: null,
    values: [],
  };
  if (!t) return out;

  for (const [value, patterns] of PRACTICE_KEYWORDS) {
    if (matchAny(t, patterns)) out.practices.push(value);
  }
  for (const [value, patterns] of INTENTION_KEYWORDS) {
    if (matchAny(t, patterns)) out.intentions.push(value);
  }
  for (const [value, patterns] of CONNECTION_TYPE_KEYWORDS) {
    if (CONNECTION_TYPE_MAP[value] && matchAny(t, patterns)) out.connectionTypes.push(value);
  }

  // Explore topics whose practice domains appear in the text.
  for (const topic of EXPLORE_TOPICS) {
    if (topic.practices.some((p) => out.practices.includes(p))) out.topics.push(topic.id);
  }

  const local = matchAny(t, LOCAL_HINTS);
  const remote = matchAny(t, REMOTE_HINTS);
  if (local) out.localityHint = 'local';
  else if (remote) out.localityHint = 'remote';

  for (const [format, patterns] of FORMAT_HINTS) {
    if (matchAny(t, patterns)) { out.formatHint = format; break; }
  }
  for (const [commitment, patterns] of COMMITMENT_HINTS) {
    if (matchAny(t, patterns)) { out.commitmentHint = commitment; break; }
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Follow-up questions — only what can't be inferred, max 3.           */
/* ------------------------------------------------------------------ */

function optionList(pairs) {
  return pairs.map(([value, label]) => ({ value, label }));
}

const QUESTION_DEFS = {
  // Free-text questions — never inferable, always asked (until answered/skipped).
  offer: {
    id: 'offer',
    prompt: 'What could you offer the other person? For example: listening, experience, a practice, collaboration. Skip freely — "nothing yet" is an honest answer.',
    type: 'free',
    skippable: true,
  },
  mutual: {
    id: 'mutual',
    prompt: 'What would make this meeting worthwhile for both of you? There is no wrong answer — you know what a good conversation feels like.',
    type: 'free',
    skippable: true,
  },
  boundaries: {
    id: 'boundaries',
    prompt: 'Anything you would like kept private, or handled gently? You set the boundaries here — I only keep the ones you name.',
    type: 'free',
    skippable: true,
  },
  format: {
    id: 'format',
    prompt: 'How would you like to connect at first?',
    type: 'single',
    skippable: true,
    options: () => optionList(CONNECTION_FORMATS.map((f) => [f, FORMAT_LABELS[f]])),
  },
  locality: {
    id: 'locality',
    prompt: 'Does place matter for this connection?',
    type: 'single',
    skippable: true,
    options: () => optionList([
      ['local', 'Nearby, in my area'],
      ['remote', 'Anywhere, online is fine'],
      ['either', 'Either works'],
    ]),
  },
  commitment: {
    id: 'commitment',
    prompt: 'What kind of rhythm are you imagining? One conversation, occasional, or something steady — all are welcome.',
    type: 'single',
    skippable: true,
    options: () => optionList(COMMITMENT_LEVELS.map((c) => [c, COMMITMENT_LABELS[c]])),
  },
  timing: {
    id: 'timing',
    prompt: 'Any timing or availability you would like honored?',
    type: 'free',
    skippable: true,
  },
  depth: {
    id: 'depth',
    prompt: 'What matters most in a connection right now? Pick up to 3 — or skip and trust your own read.',
    type: 'multi',
    max: 3,
    skippable: true,
    options: () => optionList(DEPTH_VALUES.map((v) => [v, DEPTH_VALUE_LABELS[v]])),
  },
};

export function getQuestionDef(id) {
  return QUESTION_DEFS[id] || null;
}

/**
 * Choose follow-up questions for a guide session.
 * Free-text questions (offer, mutual, boundaries, timing) are never inferable
 * and are always asked until answered or skipped. format / locality /
 * commitment keep the existing inference skips from the parsed intent or the
 * profile. Priority order: offer, mutual, boundaries, format, locality,
 * commitment, timing, depth. Max 3 total.
 * @param {object} parsed parseIntent output
 * @param {object} profile camelCase profile (may be null)
 * @returns {Array} up to 3 question objects
 */
export function selectFollowUps(parsed, profile = null) {
  const p = parsed || {};
  const prefs = profile?.prefs || {};
  const profileFormats = Array.isArray(prefs.formats) ? prefs.formats : [];
  const profileLocalRemote = prefs.localRemote || 'either';
  const profileValues = Array.isArray(profile?.values) ? profile.values : [];

  const want = [];
  // Free text is never inferable.
  want.push(QUESTION_DEFS.offer);
  want.push(QUESTION_DEFS.mutual);
  want.push(QUESTION_DEFS.boundaries);
  if (!p.formatHint && profileFormats.length === 0) {
    want.push(QUESTION_DEFS.format);
  }
  if (!p.localityHint && (!profileLocalRemote || profileLocalRemote === 'either')) {
    want.push(QUESTION_DEFS.locality);
  }
  if (!p.commitmentHint) {
    want.push(QUESTION_DEFS.commitment);
  }
  want.push(QUESTION_DEFS.timing);
  if (profileValues.length === 0) {
    want.push(QUESTION_DEFS.depth);
  }

  return want.slice(0, 3).map((q) => ({
    id: q.id,
    prompt: q.prompt,
    type: q.type,
    skippable: q.skippable,
    ...(q.max ? { max: q.max } : {}),
    ...(q.type === 'free' ? {} : { options: q.options() }),
  }));
}

/**
 * Validate and record an answer to a follow-up question.
 * @param {object} session { answers: {}, questions: [...] }
 * @param {string} questionId
 * @param {*} value null/undefined/'' = skip
 * @returns {object} updated answers map
 * @throws {Error} with .code = 'invalid_answer' on bad input
 */
export function answerQuestion(session, questionId, value) {
  const def = getQuestionDef(questionId);
  const err = (message) => {
    const e = new Error(message);
    e.code = 'invalid_answer';
    return e;
  };
  if (!def) throw err(`Unknown question: ${questionId}`);
  const questions = Array.isArray(session?.questions) ? session.questions : [];
  if (!questions.some((q) => q.id === questionId)) {
    throw err(`Question "${questionId}" is not open in this session`);
  }
  const answers = { ...(session.answers || {}) };

  if (value === null || value === undefined || value === '') {
    answers[questionId] = null; // explicit skip
    return answers;
  }

  const allowed = def.type === 'free' ? null : def.options().map((o) => o.value);
  if (def.type === 'free') {
    if (typeof value !== 'string') {
      throw err(`"${questionId}" must be a string (or empty to skip)`);
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      answers[questionId] = null; // empty = skip
      return answers;
    }
    if (trimmed.length > 500) {
      throw err(`"${questionId}" must be at most 500 characters`);
    }
    answers[questionId] = trimmed;
    return answers;
  }
  if (def.type === 'single') {
    if (typeof value !== 'string' || !allowed.includes(value)) {
      throw err(`"${value}" is not a valid option for "${questionId}"`);
    }
    answers[questionId] = value;
  } else {
    if (!Array.isArray(value) || value.length === 0) {
      throw err(`"${questionId}" needs a non-empty array of options`);
    }
    if (value.length > (def.max || allowed.length)) {
      throw err(`Pick at most ${def.max} for "${questionId}"`);
    }
    for (const v of value) {
      if (typeof v !== 'string' || !allowed.includes(v)) {
        throw err(`"${v}" is not a valid option for "${questionId}"`);
      }
    }
    answers[questionId] = [...new Set(value)];
  }
  return answers;
}

/* ------------------------------------------------------------------ */
/* Proposals — curated introductions with a suggested first step.      */
/* ------------------------------------------------------------------ */

// Practice -> most natural connection type when the user didn't name one.
const PRACTICE_TO_TYPE = {
  'meditation': 'meditation-partner',
  'dreamwork': 'dreamwork-exchange',
  'tarot': 'tarot-oracle-exchange',
  'oracle-cards': 'tarot-oracle-exchange',
  'breathwork': 'breathwork-somatic-partner',
  'somatics': 'breathwork-somatic-partner',
  'astrology': 'astrology-discussion',
  'consciousness-research': 'consciousness-research',
  'ai-consciousness': 'consciousness-research',
  'philosophy': 'consciousness-research',
  'community-building': 'group-circle',
  'art-music': 'creative-collaborator',
  'journaling': 'peer-learning-exchange',
};

const PRACTICE_LABELS = new Map(PRACTICES.map((p) => [p.value, p.label]));

// Concrete, gentle first-interaction suggestions per connection type.
// No outcome promises, no clinical or therapeutic language.
const FIRST_STEPS = {
  'meditation-partner': 'A 20-minute introductory sit over video — no fixing, just practice side by side, then share one reflection.',
  'dreamwork-exchange': 'Exchange one recent dream (or image) by message and share what it stirred — no interpretation unless invited.',
  'tarot-oracle-exchange': 'Pull one card each for a shared question and compare notes by message — curiosity over certainty.',
  'breathwork-somatic-partner': 'Try a short, gentle breath practice together on video, then check in on how it landed. Go easy; stop anytime.',
  'astrology-discussion': 'Share one current transit or chart theme you are sitting with and trade reflections — conversation, not counsel.',
  'consciousness-research': 'Pick one short article or question about consciousness and trade thoughts over a 30-minute call.',
  'meaningful-friendship': 'A relaxed 30-minute video hello — share what is alive in your practice lately, no agenda.',
  'group-circle': 'Join an upcoming circle session together, or gather a few people for a simple opening round.',
  'virtual-circle': 'Join an online circle together — or gather three people for a 45-minute video round on a shared question.',
  'local-community': 'Meet at a public gathering or café in your area for an easy first hello.',
  'event-companion': 'Pick a local gathering you would both enjoy and go together — no pressure to stay the whole time.',
  'creative-collaborator': 'Share one small piece of work-in-progress and trade honest, kind reflections.',
  'project-collaborator': 'A 30-minute call to name the project, what each of you can offer, and one small first step.',
  'mentor-request': 'One 30-minute conversation about where you are on the path, and one question you would love perspective on.',
  'peer-learning-exchange': 'Choose one short text or topic and trade reflections — two messages each to start.',
  'spiritual-study-partner': 'Read the same short passage and share one line that stayed with you.',
  'practice-partner': 'Agree on a simple rhythm — for example a brief weekly check-in — and start with one low-pressure session.',
  'accountability-partner': 'Name one intention each and agree on a gentle weekly check-in.',
  'nature-ocean-connection': 'A walk or shoreline visit together in a public place — bring one observation to share.',
  'one-to-one-conversation': 'Start with one honest message about what you are hoping for, and one question for them.',
};
const GENERIC_FIRST_STEP = 'Start with one honest message about what you are hoping for, and one question for them — then see what unfolds.';

export function suggestedFirstStep(connectionType, sharedPractices = []) {
  const base = FIRST_STEPS[connectionType] || GENERIC_FIRST_STEP;
  const practiceValue = (sharedPractices || [])[0];
  const practiceLabel = practiceValue ? PRACTICE_LABELS.get(practiceValue) : null;
  if (practiceLabel) {
    return `${base} Begin from what you already share — ${practiceLabel.toLowerCase()} — and see where the conversation goes.`;
  }
  return base;
}

export function chooseConnectionType(parsed, sharedPractices) {
  const p = parsed || {};
  for (const t of p.connectionTypes || []) {
    if (CONNECTION_TYPE_MAP[t]) return t;
  }
  for (const sp of sharedPractices || []) {
    const t = PRACTICE_TO_TYPE[sp];
    if (t && CONNECTION_TYPE_MAP[t]) return t;
  }
  for (const sp of p.practices || []) {
    const t = PRACTICE_TO_TYPE[sp];
    if (t && CONNECTION_TYPE_MAP[t]) return t;
  }
  return 'one-to-one-conversation';
}

function keywordText(parsed, profile) {
  const bits = [];
  if (parsed?.practices) bits.push(...parsed.practices);
  if (parsed?.intentions) bits.push(...parsed.intentions);
  return [profile?.intention || '', bits.join(' ')].join(' ').trim();
}

/**
 * Build up to 3 curated proposals for a guide session.
 * @param {object} profile requester (camelCase, full owner view)
 * @param {object} parsed parseIntent output
 * @param {object} answers { format?, locality?, commitment?, depth? }
 * @param {object} deps { candidates, blockedIds, passedIds, existingPairKeys,
 *                        excludeIds, visibleProfile(id, viewerId) }
 * @returns {Array} proposals
 */
export function buildProposals(profile, parsed, answers = {}, deps = {}) {
  const {
    candidates = [],
    blockedIds = new Set(),
    passedIds = new Set(),
    existingPairKeys = new Set(),
    excludeIds = new Set(),
    visibleProfile = null,
  } = deps;

  const locality = answers.locality || parsed?.localityHint || null;
  const format = answers.format || parsed?.formatHint || null;
  const filters = {};
  if (locality && locality !== 'either') filters.locality = locality;
  if (format) filters.format = format;

  const intentionText = [
    parsed?.requestText || '',
    keywordText(parsed, profile),
  ].join(' ').trim();

  const matches = findMatches(profile, candidates, {
    intentionText,
    limit: 3,
    excludeIds: new Set([...excludeIds, ...passedIds]),
    existingPairKeys,
    blockedIds,
    filters,
  });

  return matches.map((m) => {
    const connectionType = chooseConnectionType(parsed, m.sharedPractices);
    const typeMeta = CONNECTION_TYPE_MAP[connectionType];
    const { forCandidate } = buildPairReasons(profile, m.candidate, m, deps.requesterOffer || '');
    const first = suggestedFirstStep(connectionType, m.sharedPractices);
    return {
      candidate: visibleProfile
        ? visibleProfile(m.candidate.id, profile.id)
        : m.candidate,
      connectionType,
      connectionTypeLabel: typeMeta ? typeMeta.label : connectionType,
      whyItFits: m.reasons,
      forCandidate,
      candidateSharedText: deps.getCandidateSharedText
        ? deps.getCandidateSharedText(m.candidate.id)
        : '',
      sharedPractices: m.sharedPractices,
      sharedIntentions: m.sharedIntentions,
      suggestedFirst: first,
      suggestedFirstStep: first,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Connection brief — prefilled draft from a completed guide session.  */
/* ------------------------------------------------------------------ */

function truncate(text, max = 140) {
  const t = typeof text === 'string' ? text.trim() : '';
  return t.length > max ? t.slice(0, max).trimEnd() + '…' : t;
}

function practiceWords(practices) {
  return (practices || [])
    .map((p) => PRACTICE_LABELS.get(p))
    .filter(Boolean)
    .map((l) => l.toLowerCase());
}

/**
 * Prefill a connection-brief draft from a completed guide session.
 * Every field is the user's own words or a plain restatement of the parsed
 * intent — nothing is invented. The user reviews and edits before approving.
 * @param {object} profile camelCase profile
 * @param {object} session { requestText, parsed, answers }
 * @returns {object} snake_case draft fields
 */
export function buildBriefDraft(profile, session) {
  const s = session || {};
  const parsed = s.parsed || {};
  const answers = s.answers || {};
  const name = String(profile?.name || 'A seeker').trim();
  const firstName = name.split(/\s+/)[0] || 'A seeker';
  const practiceList = practiceWords(parsed.practices?.length ? parsed.practices : profile?.practices);

  const who_text = practiceList.length
    ? `${name} — ${practiceList.slice(0, 4).join(', ')}`
    : name;

  const intention_text = String(s.requestText || '').trim();

  const typeValue = chooseConnectionType(parsed, parsed.practices || []);
  const typeLabel = (CONNECTION_TYPE_MAP[typeValue]?.label || 'one-to-one conversation').toLowerCase();
  const hints = practiceList.slice(0, 3);
  const good_fit_text = hints.length
    ? `A ${typeLabel} around ${hints.join(' and ')} — someone open to a thoughtful, mutual exchange.`
    : `A ${typeLabel} — someone open to a thoughtful, mutual exchange.`;

  const offer_text = String(answers.offer || '').trim();

  const logisticsBits = [];
  const formatLabel = FORMAT_LABELS[answers.format];
  if (formatLabel) logisticsBits.push(`open to ${formatLabel.toLowerCase()}`);
  if (answers.locality === 'local') logisticsBits.push('prefers meeting nearby');
  else if (answers.locality === 'remote') logisticsBits.push('happy to connect online from anywhere');
  else if (answers.locality === 'either') logisticsBits.push('open to nearby or online');
  const commitmentLabel = COMMITMENT_LABELS[answers.commitment];
  if (commitmentLabel) logisticsBits.push(commitmentLabel.toLowerCase());
  if (answers.timing && String(answers.timing).trim()) {
    logisticsBits.push(`timing: ${String(answers.timing).trim()}`);
  }
  const logistics_text = logisticsBits.join('; ');

  const boundaries_text = String(answers.boundaries || '').trim();

  const sharedParts = [];
  if (intention_text) sharedParts.push(`${firstName} is hoping to find: ${truncate(intention_text, 180)}`);
  if (offer_text) sharedParts.push(`${firstName} can offer: ${truncate(offer_text, 160)}`);
  const shared_text = truncate(
    sharedParts.join(' ') || `${firstName} is open to a meaningful new connection.`,
    400,
  );

  return {
    who_text: truncate(who_text, 200),
    intention_text: truncate(intention_text, 2000),
    good_fit_text: truncate(good_fit_text, 2000),
    offer_text: truncate(offer_text, 2000),
    logistics_text: truncate(logistics_text, 2000),
    boundaries_text: truncate(boundaries_text, 2000),
    private_notes: '',
    shared_text,
  };
}

/**
 * Deterministic warm-intro message posted by SEREN (senderId 0) when a
 * recipient accepts an introduction. Uses only names, each side's approved
 * shared_text, and a gentle first step — never invented history or certainty.
 * Fixed fragments are exported so allBotCopy() (and tests) can collect them.
 */
export const WARM_INTRO_OPENING = 'A warm hello from SEREN:';
export const WARM_INTRO_ACCEPTED = 'have both said yes to this introduction.';
export const WARM_INTRO_FIRST_STEP_LABEL = 'A gentle first step:';

export function buildWarmIntroMessage({
  requesterName, responderName, requesterSharedText = '',
  responderSharedText = '', connectionType = '',
} = {}) {
  const first = (n) => String(n || 'a friend').trim().split(/\s+/)[0] || 'a friend';
  const a = first(requesterName);
  const b = first(responderName);
  const lines = [
    `${WARM_INTRO_OPENING} ${a} and ${b} ${WARM_INTRO_ACCEPTED}`,
  ];
  const reqShared = String(requesterSharedText || '').trim();
  const respShared = String(responderSharedText || '').trim();
  if (reqShared) lines.push(`${a} shared: “${truncate(reqShared, 140)}”`);
  if (respShared) lines.push(`${b} shared: “${truncate(respShared, 140)}”`);
  lines.push(`${WARM_INTRO_FIRST_STEP_LABEL} ${suggestedFirstStep(connectionType || 'one-to-one-conversation')}`);
  return lines.join('\n\n');
}

/* ------------------------------------------------------------------ */
/* Flourishing by Design — optional reflective offers.                 */
/* These are informational bot messages: skippable, never required for */
/* session completion, and never presented as answers or authority.     */
/* ------------------------------------------------------------------ */

/**
 * The real-life completion question the guide asks at natural conversation
 * conclusions: "What would you like to bring into your real life in the
 * next 24 hours?" Kept as a single exported constant so copy stays exact
 * everywhere it is used (chat UI, tests, docs).
 */
export const REAL_LIFE_PROMPT_TEXT =
  'Before you go — What would you like to bring into your real life in the next 24 hours? ' +
  'No pressure; skip anytime. The wondering itself counts.';

/**
 * Contexts at which the real-life completion prompt is appropriate
 * (GUIDE_BEHAVIOR_RULES §9):
 * - 'brief_approved': the guide chat reaches the proposals stage after the
 *   member approves their connection brief.
 * - 'introduction_accepted': an introduction request was accepted (or acted
 *   on) by either side.
 */
export const REAL_LIFE_PROMPT_CONTEXTS = Object.freeze([
  'brief_approved',
  'introduction_accepted',
]);

/**
 * Build the real-life completion prompt message, or null when the context
 * is not a natural conversation conclusion.
 *
 * Message shape (for the frontend/chat workstream):
 *   { role: 'bot', kind: 'real_life_prompt', text, skippable: true }
 * Render like a normal bot text with a Skip affordance. It is informational
 * only: answering or skipping must never gate session progress, brief
 * approval, or introduction flow, and the transcript cap logic can count it
 * as a regular bot text entry.
 *
 * @param {string} context one of REAL_LIFE_PROMPT_CONTEXTS, else null
 * @returns {object|null} the bot message, or null
 */
export function realLifePrompt(context) {
  if (!REAL_LIFE_PROMPT_CONTEXTS.includes(context)) return null;
  return {
    role: 'bot',
    kind: 'real_life_prompt',
    text: REAL_LIFE_PROMPT_TEXT,
    skippable: true,
  };
}

/**
 * Digital Sapiens attention-integrity rules (GUIDE_BEHAVIOR_RULES §10),
 * exported so tests and future contributors can assert on them. Grounded
 * in Jack Probert's Digital Sapiens Experiment 2: technology should
 * empower, connect, and elevate — never diminish attention or connection.
 */
export const ATTENTION_INTEGRITY_RULES = Object.freeze([
  'Never manufacture urgency: no countdowns, scarcity, "act now", or "don\'t miss out" framing.',
  'Never guilt-trip about inactivity: no "we miss you" or comeback nudges of any kind.',
  'Affirm reply-when-you-want norms: members may reply slowly, or not at all, without apology.',
  'Celebrate disconnection and real-world follow-through as wins.',
  'Distinguish logistics from connection: coordination is plumbing; the human connection is the point.',
]);

/**
 * Re-engagement phrasing the guide must never emit (GUIDE_BEHAVIOR_RULES
 * §10). Tested case-insensitively against all bot copy.
 */
export const REENGAGEMENT_BANNED = Object.freeze([
  'we miss you',
  'we\'ve missed you',
  'you haven\'t been here',
  'come back soon',
  'don\'t miss out',
  'last chance',
  'act now',
  'hurry',
]);

/**
 * The real-life handoff message (GUIDE_BEHAVIOR_RULES §9–§10): offered when
 * a member marks an accepted introduction as moved to real life. The app
 * steps back: no more nudges about this connection. Celebrates leaving.
 * Kept as an exported constant so copy stays exact everywhere.
 */
export const REAL_LIFE_HANDOFF_TEXT =
  'Beautiful — take this one beyond the screen. If you like, swap a preferred way to reach each other, or plan something in real life. ' +
  'SEREN will step back now and won\'t nudge you about this connection again. The good stuff happens out there.';

export function realLifeHandoff() {
  return { role: 'bot', kind: 'real_life_handoff', text: REAL_LIFE_HANDOFF_TEXT, skippable: true };
}

/**
 * Agency-first lens offer (GUIDE_BEHAVIOR_RULES §3–§4). An optional bot
 * message the chat can emit when the member shares something they are
 * sitting with (a dream, a symbol, a life question): it offers
 * reflective / symbolic / practical / psychological lenses and returns
 * interpretive authority to the member. Never asserts a meaning as true.
 */
export const LENS_OFFER_TEXT =
  'Would you like a reflective, symbolic, practical, or psychological lens on this? ' +
  'One possible interpretation is only one possibility. ' +
  'You are the best authority on your own experience — what meaning does this hold for you?';

export function lensOffer() {
  return { role: 'bot', kind: 'text', text: LENS_OFFER_TEXT };
}

/* ------------------------------------------------------------------ */
/* Bot-copy audit helper.                                              */
/* ------------------------------------------------------------------ */

/**
 * Every bot-facing string this module can emit (question prompts and option
 * labels, first-step suggestions, warm-intro fixed fragments, brief-draft
 * template samples, reflective offers, and validation error fragments).
 * Tests assert no banned phrasing appears and every text is ≤ 400 chars.
 * @returns {Array<string>}
 */
export function allBotCopy() {
  const out = [];
  for (const def of Object.values(QUESTION_DEFS)) {
    out.push(def.prompt);
    if (def.options) for (const o of def.options()) out.push(o.label);
  }
  out.push(...Object.values(DEPTH_VALUE_LABELS));
  out.push(...Object.values(FIRST_STEPS), GENERIC_FIRST_STEP);
  // Sample with the practice suffix appended.
  out.push(suggestedFirstStep('meditation-partner', ['meditation']));
  out.push(REAL_LIFE_PROMPT_TEXT, REAL_LIFE_HANDOFF_TEXT, LENS_OFFER_TEXT);
  out.push(
    `${WARM_INTRO_OPENING} Amara and Jon ${WARM_INTRO_ACCEPTED}`,
    `${WARM_INTRO_FIRST_STEP_LABEL} ${suggestedFirstStep('one-to-one-conversation')}`,
  );
  // Brief-draft template samples (fixed fragments around member text).
  out.push(
    'A meditation or contemplative partner around meditation — someone open to a thoughtful, mutual exchange.',
    'Amara is hoping to find: a calm practice partner. Amara can offer: steady listening.',
    'Amara is open to a meaningful new connection.',
  );
  // Validation error fragments (surfaced in 400 API error payloads).
  out.push(
    'Unknown question:',
    'is not open in this session',
    'is not a valid option for',
    'must be a string (or empty to skip)',
    'must be at most 500 characters',
    'needs a non-empty array of options',
    'Pick at most 3 for',
  );
  return out;
}

/* ------------------------------------------------------------------ */
/* Session completion: all questions answered or skipped?              */
/* ------------------------------------------------------------------ */

export function remainingQuestions(session) {
  const answers = session?.answers || {};
  const questions = Array.isArray(session?.questions) ? session.questions : [];
  return questions.filter((q) => !(q.id in answers));
}
