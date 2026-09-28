// SEREN guide engine — the "spiritual superconnector" brain.
//
// Keyword-based intent parsing, minimal follow-up selection, and curated
// proposal building. Pure functions: no network, no LLM, no side effects.
// Tone contract: warm and grounded; never supernatural certainty, never
// clinical/therapy/medical claims, never numeric scores in output.

import {
  PRACTICES, INTENTIONS,
  CONNECTION_FORMATS, FORMAT_LABELS,
  COMMITMENT_LEVELS, COMMITMENT_LABELS,
  CONNECTION_TYPE_MAP,
  EXPLORE_TOPICS,
} from './constants.js';
import { findMatches } from './match.js';

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
      ['local', 'Nearby — in my area'],
      ['remote', 'Anywhere — online is fine'],
      ['either', 'Either works'],
    ]),
  },
  commitment: {
    id: 'commitment',
    prompt: 'What kind of rhythm are you imagining?',
    type: 'single',
    skippable: true,
    options: () => optionList(COMMITMENT_LEVELS.map((c) => [c, COMMITMENT_LABELS[c]])),
  },
  depth: {
    id: 'depth',
    prompt: 'What matters most in a connection right now? (pick up to 3)',
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
 * Skips anything already inferable from the parsed intent or the profile.
 * @param {object} parsed parseIntent output
 * @param {object} profile camelCase profile (may be null)
 * @returns {Array} up to 3 question objects
 */
export function selectFollowUps(parsed, profile = null) {
  const questions = [];
  const p = parsed || {};
  const prefs = profile?.prefs || {};
  const profileFormats = Array.isArray(prefs.formats) ? prefs.formats : [];
  const profileLocalRemote = prefs.localRemote || 'either';
  const profileValues = Array.isArray(profile?.values) ? profile.values : [];

  if (!p.formatHint && profileFormats.length === 0) {
    questions.push(QUESTION_DEFS.format);
  }
  if (!p.localityHint && (!profileLocalRemote || profileLocalRemote === 'either')) {
    questions.push(QUESTION_DEFS.locality);
  }
  if (!p.commitmentHint) {
    questions.push(QUESTION_DEFS.commitment);
  }
  if (profileValues.length === 0) {
    questions.push(QUESTION_DEFS.depth);
  }

  return questions.slice(0, 3).map((q) => ({
    id: q.id,
    prompt: q.prompt,
    type: q.type,
    skippable: q.skippable,
    ...(q.max ? { max: q.max } : {}),
    options: q.options(),
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

  const allowed = def.options().map((o) => o.value);
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

function chooseConnectionType(parsed, sharedPractices) {
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
    return {
      candidate: visibleProfile
        ? visibleProfile(m.candidate.id, profile.id)
        : m.candidate,
      connectionType,
      connectionTypeLabel: typeMeta ? typeMeta.label : connectionType,
      whyItFits: m.reasons,
      sharedPractices: m.sharedPractices,
      sharedIntentions: m.sharedIntentions,
      suggestedFirst: suggestedFirstStep(connectionType, m.sharedPractices),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Session completion: all questions answered or skipped?              */
/* ------------------------------------------------------------------ */

export function remainingQuestions(session) {
  const answers = session?.answers || {};
  const questions = Array.isArray(session?.questions) ? session.questions : [];
  return questions.filter((q) => !(q.id in answers));
}
