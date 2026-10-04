// SEREN conversational onboarding — the profile-creation interview.
//
// Pure conversation logic for profile-less guide sessions: no DB, no
// express, no network. The server wires these helpers to storage and the
// existing profile-creation path (validateProfileInput + createProfile).
//
// Stage machine (Flourishing by Design — intention-based, not data-extractive):
//   ob_name -> ob_email -> ob_intentions -> ob_connection_levels
//   -> ob_interests -> ob_topics_out -> ob_privacy -> ob_location
//   -> ob_intention -> ob_seeking -> ob_online_mode -> ob_frequency
//   -> ob_boundaries -> ob_sync_mode -> ob_values -> ob_consent
//   -> (profile created, handoff to guide)
//   ob_consent --"not yet"--> ob_declined --"i'm ready"--> (create)
//
// Every new question is skippable and optional; only the pre-existing
// required answers (name, email, interests, intention, seeking) and the
// introductions consent still gate profile creation. Skipped single-choice
// questions fall back to the calm defaults in FLOURISHING_DEFAULTS.
//
// Tone contract: warm and grounded; agency-first ("you are the best
// authority on your own experience"); consent-first; never clinical,
// medical, or therapeutic claims; never psychic certainty or spiritual
// authority; never numeric scores. Every bot text is <= 400 characters.

import { INTERESTS, SEEKING } from './constants.js';
import { DEPTH_VALUE_LABELS } from './guide.js';
import { questionMessage, matchOptions, isSkipText } from './chat.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ------------------------------------------------------------------ */
/* Flourishing by Design — intention-based onboarding taxonomies.      */
/* Wire values; the frontend (another workstream) renders the matching */
/* question payloads generically.                                      */
/* ------------------------------------------------------------------ */

/** Intentions (multi-select, 0–9): why the member is here. */
export const ONBOARDING_INTENTIONS = Object.freeze([
  { value: 'spiritual-alignment', label: 'Meet spiritually aligned people' },
  { value: 'local-community', label: 'Find local community or gatherings' },
  { value: 'consciousness-meaning', label: 'Explore consciousness and meaning' },
  { value: 'practice-partner', label: 'Find a meditation, ritual, dreamwork, or reflective-practice partner' },
  { value: 'research-creative', label: 'Collaborate on research or creative projects' },
  { value: 'symbolic-synchronicity', label: 'Explore symbolic experiences or synchronicity' },
  { value: 'mentor-peer', label: 'Find a mentor, peer, or accountability partner' },
  { value: 'community-service', label: 'Contribute to a community, service, or collective project' },
  { value: 'ai-guides', label: 'Connect with benevolent AI guides for reflection' },
]);
export const ONBOARDING_INTENTION_VALUES = Object.freeze(
  ONBOARDING_INTENTIONS.map((i) => i.value),
);

/** Connection levels (multi-select, 0–5): how the member wants to connect. */
export const ONBOARDING_CONNECTION_LEVELS = Object.freeze([
  { value: 'ai-conversations', label: 'Reflective AI conversations only' },
  { value: 'community-discovery', label: 'Community and event discovery' },
  { value: 'small-groups', label: 'Small group circles' },
  { value: 'one-to-one', label: 'One-to-one introductions' },
  { value: 'research-collab', label: 'Research and project collaboration' },
]);
export const ONBOARDING_CONNECTION_LEVEL_VALUES = Object.freeze(
  ONBOARDING_CONNECTION_LEVELS.map((l) => l.value),
);

/** Privacy level (single-select, default 'community'). */
export const ONBOARDING_PRIVACY_LEVELS = Object.freeze(['private', 'community', 'discoverable']);
export const ONBOARDING_PRIVACY_CHOICES = Object.freeze([
  { value: 'private', label: 'Private — hidden until I accept someone' },
  { value: 'community', label: 'Community — members can find me' },
  { value: 'discoverable', label: 'Discoverable — suggest me more widely' },
]);

/** Location radius (single-select, default 'anywhere'). */
export const ONBOARDING_LOCATION_RADII = Object.freeze(['local', 'regional', 'anywhere']);
export const ONBOARDING_LOCATION_CHOICES = Object.freeze([
  { value: 'local', label: 'Near me' },
  { value: 'regional', label: 'My wider region' },
  { value: 'anywhere', label: 'Anywhere' },
]);

/** Online / offline / hybrid (single-select, default 'hybrid'). */
export const ONBOARDING_ONLINE_MODES = Object.freeze(['online', 'offline', 'hybrid']);
export const ONBOARDING_ONLINE_CHOICES = Object.freeze([
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'In person' },
  { value: 'hybrid', label: 'A mix of both' },
]);

/** Recommendation frequency (single-select, default 'weekly' — the calm default). */
export const ONBOARDING_REC_FREQUENCIES = Object.freeze(['daily', 'weekly', 'paused']);
export const ONBOARDING_REC_CHOICES = Object.freeze([
  { value: 'daily', label: "Daily — I'm feeling social" },
  { value: 'weekly', label: 'Weekly — the calm default' },
  { value: 'paused', label: 'Paused — I need quiet' },
]);

/** Synchronicity mode (single-select, default 'limited'). */
export const ONBOARDING_SYNC_MODES = Object.freeze(['on', 'off', 'limited']);
export const ONBOARDING_SYNC_CHOICES = Object.freeze([
  { value: 'on', label: 'Open to synchronicity' },
  { value: 'limited', label: 'Gently, sometimes' },
  { value: 'off', label: 'Keep things straightforward' },
]);

/** Calm defaults applied whenever a skippable question is skipped. */
export const FLOURISHING_DEFAULTS = Object.freeze({
  privacyLevel: 'community',
  locationRadius: 'anywhere',
  onlineMode: 'hybrid',
  recFrequency: 'weekly',
  syncMode: 'limited',
});

/** Stages owned by the onboarding interview (before any profile exists). */
export const ONBOARDING_STAGES = Object.freeze([
  'ob_name',
  'ob_email',
  'ob_intentions',
  'ob_connection_levels',
  'ob_interests',
  'ob_topics_out',
  'ob_privacy',
  'ob_location',
  'ob_intention',
  'ob_seeking',
  'ob_online_mode',
  'ob_frequency',
  'ob_boundaries',
  'ob_sync_mode',
  'ob_values',
  'ob_consent',
  'ob_declined',
]);

export function isOnboardingStage(stage) {
  return ONBOARDING_STAGES.includes(stage);
}

/** Binary consent choice — quick replies, never a pre-ticked default. */
export const CONSENT_QUICK_REPLIES = Object.freeze(['Yes, I consent', 'Not yet']);
export const DECLINED_QUICK_REPLIES = Object.freeze(["I'm ready"]);

const botText = (text) => ({ role: 'bot', kind: 'text', text });

const interestLabel = (v) =>
  v.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

const SEEKING_LABELS = Object.freeze({
  'friendship': 'Friendship',
  'practice-partner': 'Practice partner',
  'collaboration': 'Collaboration',
  'guidance': 'Guidance',
});

function chips(values, labelOf) {
  return values.map((v) => ({ value: v, label: labelOf(v) }));
}

const choiceChips = (choices) => choices.map((c) => ({ value: c.value, label: c.label }));

const INTEREST_OPTIONS = chips(INTERESTS, interestLabel);
const INTENTION_CHOICES = choiceChips(ONBOARDING_INTENTIONS);
const LEVEL_CHOICES = choiceChips(ONBOARDING_CONNECTION_LEVELS);
const PRIVACY_CHOICES = choiceChips(ONBOARDING_PRIVACY_CHOICES);
const LOCATION_CHOICES = choiceChips(ONBOARDING_LOCATION_CHOICES);
const ONLINE_CHOICES = choiceChips(ONBOARDING_ONLINE_CHOICES);
const REC_CHOICES = choiceChips(ONBOARDING_REC_CHOICES);
const SYNC_CHOICES = choiceChips(ONBOARDING_SYNC_CHOICES);
const SEEKING_OPTIONS = chips(SEEKING, (v) => SEEKING_LABELS[v] || v);
const VALUE_OPTIONS = chips(Object.keys(DEPTH_VALUE_LABELS), (v) => DEPTH_VALUE_LABELS[v]);

function firstNameOf(answers) {
  const name = String(answers?.name || '').trim();
  return name ? name.split(/\s+/)[0] : 'friend';
}

/**
 * Opening of the interview: greeting + the name question.
 * @returns {{stage, answers, messages}}
 */
export function startOnboarding() {
  return {
    stage: 'ob_name',
    answers: {},
    messages: [
      botText(
        "Hello ✦ I'm SEREN, a guide for meaningful connection. I'll ask a few gentle questions to create your space here. Nothing is shared with anyone until you say so.",
      ),
      questionMessage({
        id: 'ob_name',
        prompt: 'What should I call you? A first name is plenty.',
        type: 'free',
        skippable: false,
      }),
    ],
  };
}

/**
 * The current question (or statement) for an onboarding stage, used when
 * advancing and when resuming a session. Consent uses quick replies rather
 * than a question message. Single-select questions use input: 'single' —
 * same payload shape, one new input value the frontend renders generically.
 */
export function questionForStage(stage, answers = {}) {
  const first = firstNameOf(answers);
  switch (stage) {
    case 'ob_name':
      return questionMessage({
        id: 'ob_name',
        prompt: 'What should I call you? A first name is plenty.',
        type: 'free',
        skippable: false,
      });
    case 'ob_email':
      return questionMessage({
        id: 'ob_email',
        prompt: `Thanks, ${first}. What's your email? It's how you find your space again on another device. It's never shown to other members.`,
        type: 'free',
        skippable: false,
      });
    case 'ob_intentions':
      return questionMessage({
        id: 'ob_intentions',
        prompt: "What draws you here? Choose any that feel true — or skip, and follow your own thread. You're the best authority on your own experience.",
        type: 'multi',
        options: INTENTION_CHOICES,
        skippable: true,
      });
    case 'ob_connection_levels':
      return questionMessage({
        id: 'ob_connection_levels',
        prompt: "How would you like connection to happen here? Pick any that sound good — or skip, and we'll keep every door open.",
        type: 'multi',
        options: LEVEL_CHOICES,
        skippable: true,
      });
    case 'ob_interests':
      return questionMessage({
        id: 'ob_interests',
        prompt: 'Which of these are part of your life? Choose up to 8. They describe interests only, never expertise.',
        type: 'multi',
        options: INTEREST_OPTIONS,
        skippable: false,
      });
    case 'ob_topics_out':
      return questionMessage({
        id: 'ob_topics_out',
        prompt: "Are there topics you'd rather not see in your suggestions? Choose any, or skip — this simply keeps your space clear.",
        type: 'multi',
        options: INTEREST_OPTIONS,
        skippable: true,
      });
    case 'ob_privacy':
      return questionMessage({
        id: 'ob_privacy',
        prompt: 'How visible should your space be? Community is the gentle default — members can find you, but nothing is shared until you approve it. You can change this anytime.',
        type: 'single',
        options: PRIVACY_CHOICES,
        skippable: true,
      });
    case 'ob_location':
      return questionMessage({
        id: 'ob_location',
        prompt: "Where should connection live for you? Near you, your wider region, or anywhere. There's no wrong answer — choose what feels right, or skip.",
        type: 'single',
        options: LOCATION_CHOICES,
        skippable: true,
      });
    case 'ob_intention':
      return questionMessage({
        id: 'ob_intention',
        prompt: 'In a sentence or two: what brings you here? What kind of connection would feel meaningful right now?',
        type: 'free',
        skippable: false,
      });
    case 'ob_seeking':
      return questionMessage({
        id: 'ob_seeking',
        prompt: 'What are you hoping to find here? Choose all that resonate.',
        type: 'multi',
        options: SEEKING_OPTIONS,
        skippable: false,
      });
    case 'ob_online_mode':
      return questionMessage({
        id: 'ob_online_mode',
        prompt: 'How do you like to connect — online, in person, or a mix of both? Skipping keeps it open.',
        type: 'single',
        options: ONLINE_CHOICES,
        skippable: true,
      });
    case 'ob_frequency':
      return questionMessage({
        id: 'ob_frequency',
        prompt: "How often would you like gentle suggestions? Weekly is the calm default — daily if you're feeling social, paused if you need quiet. You can change this anytime.",
        type: 'single',
        options: REC_CHOICES,
        skippable: true,
      });
    case 'ob_boundaries':
      return questionMessage({
        id: 'ob_boundaries',
        prompt: "Anything you'd like others to know about how you connect? A rhythm, a boundary, a note — 200 characters or fewer. Skip if nothing comes to mind; you can add it later.",
        type: 'free',
        skippable: true,
      });
    case 'ob_sync_mode':
      return questionMessage({
        id: 'ob_sync_mode',
        prompt: 'SEREN sometimes notices meaningful coincidences — a symbol appearing twice, a theme arriving from two directions. Would you like that gentle kind of synchronicity woven in, or keep things straightforward?',
        type: 'single',
        options: SYNC_CHOICES,
        skippable: true,
      });
    case 'ob_values':
      return questionMessage({
        id: 'ob_values',
        prompt: 'What matters most in a connection right now? Pick up to 3, or skip.',
        type: 'multi',
        options: VALUE_OPTIONS,
        skippable: true,
      });
    case 'ob_consent':
      return botText(
        'One last thing, entirely your call: may SEREN introduce you to other members? That means using what you shared to suggest members with shared interests, and letting you appear in suggestions for others. Every introduction needs a yes from both people, and you can pause or leave anytime.',
      );
    case 'ob_declined':
      return botText(
        "That's completely okay — nothing has been created or shared. Take all the time you need; if you change your mind, just say the word.",
      );
    default:
      return null;
  }
}

/** Quick replies for stages that use them (consent / declined). */
export function quickRepliesForStage(stage) {
  if (stage === 'ob_consent') return [...CONSENT_QUICK_REPLIES];
  if (stage === 'ob_declined') return [...DECLINED_QUICK_REPLIES];
  return undefined;
}

// Consent classification: a "no" pattern always wins (consent-first —
// ambiguity never reads as yes).
const NO_RE = /\b(no|not yet|nope|nah|don't|do not|stop|cancel|never mind)\b/i;
const YES_RE = /\b(yes|yeah|yep|i consent|consent|ok|okay|sure|absolutely|do it|let's do it|sounds good|i'm ready|im ready|ready)\b/i;
const START_OVER_RE = /^\s*(start over|restart|begin again)\s*$/i;

// Reclaim intents offered when an onboarding email is already taken. The
// quick replies send these exact phrases as the user's next message.
const RECLAIM_YES_RE = /reconnect this device/i;
const RECLAIM_DIFFERENT_RE = /different email/i;

// "none" is an explicit empty answer for topics-out.
const NO_TOPICS_RE = /^\s*(none|nothing|no topics)\s*$/i;

function askAgain(stage, answers, note) {
  const q = questionForStage(stage, answers);
  const messages = note ? [botText(note), q] : [q];
  return {
    stage, answers, messages, quickReplies: quickRepliesForStage(stage),
  };
}

/**
 * Advance to the next stage after storing one answered value. Used by the
 * Flourishing stages; the legacy stages keep their explicit `next` calls.
 */
function advance(nextStage, answers, key, value) {
  const a = { ...answers, [key]: value };
  return {
    stage: nextStage,
    answers: a,
    messages: [questionForStage(nextStage, a)],
    quickReplies: quickRepliesForStage(nextStage),
  };
}

/** Resolve a single-select answer: first matched option, or null. */
function resolveSingle(t, options) {
  const matched = matchOptions(t, { type: 'single', options }) || [];
  return matched.length ? matched[0] : null;
}

/**
 * Assemble the profile-creation payload from collected answers, applying
 * the calm defaults for anything the member skipped. The new fields ride
 * in connectionPrefs / consentSettings JSON (no DB column changes):
 * - connectionPrefs: intentions[], connectionLevels[], topicsOut[],
 *   privacyLevel, locationRadius, onlineMode, commBoundaries, syncMode
 * - consentSettings: recFrequency
 */
function buildCreate(answers) {
  return {
    name: answers.name,
    email: answers.email,
    interests: answers.interests || [],
    intention: answers.intention,
    seeking: answers.seeking || [],
    values: answers.values || [],
    connectionPrefs: {
      seeking: answers.seeking || [],
      availability: '',
      intentions: answers.intentions || [],
      connectionLevels: answers.connectionLevels || [],
      topicsOut: answers.topicsOut || [],
      privacyLevel: answers.privacyLevel || FLOURISHING_DEFAULTS.privacyLevel,
      locationRadius: answers.locationRadius || FLOURISHING_DEFAULTS.locationRadius,
      onlineMode: answers.onlineMode || FLOURISHING_DEFAULTS.onlineMode,
      commBoundaries: answers.commBoundaries || '',
      syncMode: answers.syncMode || FLOURISHING_DEFAULTS.syncMode,
    },
    consentSettings: {
      recFrequency: answers.recFrequency || FLOURISHING_DEFAULTS.recFrequency,
    },
  };
}

/**
 * Advance the interview one user turn.
 * @param {string} stage current onboarding stage
 * @param {object} answers collected answers so far
 * @param {string} text trimmed user text
 * @param {{emailTaken(email:string):boolean}} ctx
 * @returns {{stage, answers, messages, quickReplies?} |
 *           {stage, answers, messages, quickReplies?, create:{name,email,interests,intention,seeking,values,connectionPrefs,consentSettings}}}
 *   When `create` is present the interview is complete and the server
 *   should create the profile through the existing creation path, passing
 *   create.connectionPrefs and create.consentSettings through.
 */
export function handleOnboardingTurn(stage, answers, text, ctx = {}) {
  const t = String(text || '').trim();
  const next = (s, a, messages, quickReplies) => ({
    stage: s, answers: a, messages, quickReplies: quickReplies ?? quickRepliesForStage(s),
  });

  if (START_OVER_RE.test(t)) return startOnboarding();

  switch (stage) {
    case 'ob_name': {
      if (!t || t.length > 80) {
        return askAgain(stage, answers,
          'I need a name to create your space. What should I call you? (80 characters or fewer)');
      }
      if (isSkipText(t)) {
        return askAgain(stage, answers,
          'This one needs an answer — even a nickname works. What should I call you?');
      }
      const a = { ...answers, name: t };
      return next('ob_email', a, [questionForStage('ob_email', a)]);
    }

    case 'ob_email': {
      // Reclaim intents from the taken-email branch below. The interview
      // already collected the name (ob_name) and the taken email, so the
      // member can reconnect this device right here in the conversation.
      if (RECLAIM_YES_RE.test(t) && answers.pendingEmail) {
        return { stage, answers, reclaim: { email: answers.pendingEmail, name: answers.name || '' } };
      }
      if (RECLAIM_DIFFERENT_RE.test(t)) {
        const a = { ...answers };
        delete a.pendingEmail;
        return next('ob_email', a, [botText('No problem. What email should I use for your new space?')]);
      }
      if (!EMAIL_RE.test(t)) {
        return askAgain(stage, answers,
          "That doesn't look like an email address. Mind checking it?");
      }
      const email = t.toLowerCase();
      if (ctx.emailTaken && ctx.emailTaken(email)) {
        const a = { ...answers, pendingEmail: email };
        return {
          stage: 'ob_email',
          answers: a,
          messages: [botText(
            `It looks like ${email} already has a SEREN space. If it is yours, I can reconnect this device to it right now.`)],
          quickReplies: ['Yes, reconnect this device', 'Use a different email'],
        };
      }
      const a = { ...answers, email: t };
      delete a.pendingEmail;
      return next('ob_intentions', a, [questionForStage('ob_intentions', a)]);
    }

    case 'ob_intentions': {
      if (isSkipText(t)) return advance('ob_connection_levels', answers, 'intentions', []);
      const matched = matchOptions(t, { type: 'multi', options: INTENTION_CHOICES }) || [];
      if (!matched.length) {
        return askAgain(stage, answers,
          "I didn't catch that — tap any that feel true above, or skip.");
      }
      if (matched.length > 9) {
        return askAgain(stage, answers,
          'Pick up to 9 — which feel most true right now?');
      }
      return advance('ob_connection_levels', answers, 'intentions', [...new Set(matched)]);
    }

    case 'ob_connection_levels': {
      if (isSkipText(t)) return advance('ob_interests', answers, 'connectionLevels', []);
      const matched = matchOptions(t, { type: 'multi', options: LEVEL_CHOICES }) || [];
      if (!matched.length) {
        return askAgain(stage, answers,
          "I didn't catch that — tap any that sound good above, or skip.");
      }
      return advance('ob_interests', answers, 'connectionLevels', [...new Set(matched)]);
    }

    case 'ob_interests': {
      if (isSkipText(t)) {
        return askAgain(stage, answers,
          'Pick at least one — it\u2019s how I describe you when suggesting introductions.');
      }
      const matched = matchOptions(t, { type: 'multi', options: INTEREST_OPTIONS }) || [];
      if (!matched.length) {
        return askAgain(stage, answers,
          "I didn't catch any of those — tap a few above, or name them in your own words.");
      }
      if (matched.length > 8) {
        return askAgain(stage, answers,
          'Up to 8 — which matter most? Tap your top picks above.');
      }
      const a = { ...answers, interests: [...new Set(matched)] };
      return next('ob_topics_out', a, [questionForStage('ob_topics_out', a)]);
    }

    case 'ob_topics_out': {
      if (isSkipText(t) || NO_TOPICS_RE.test(t)) {
        return advance('ob_privacy', answers, 'topicsOut', []);
      }
      const matched = matchOptions(t, { type: 'multi', options: INTEREST_OPTIONS }) || [];
      if (!matched.length) {
        return askAgain(stage, answers,
          "I didn't catch that — tap any above, say none, or skip.");
      }
      return advance('ob_privacy', answers, 'topicsOut', [...new Set(matched)]);
    }

    case 'ob_privacy': {
      if (isSkipText(t)) {
        return advance('ob_location', answers, 'privacyLevel', FLOURISHING_DEFAULTS.privacyLevel);
      }
      const picked = resolveSingle(t, PRIVACY_CHOICES);
      if (!picked) {
        return askAgain(stage, answers,
          "I didn't catch that — tap one above, or skip for the gentle default.");
      }
      return advance('ob_location', answers, 'privacyLevel', picked);
    }

    case 'ob_location': {
      if (isSkipText(t)) {
        return advance('ob_intention', answers, 'locationRadius', FLOURISHING_DEFAULTS.locationRadius);
      }
      const picked = resolveSingle(t, LOCATION_CHOICES);
      if (!picked) {
        return askAgain(stage, answers,
          "I didn't catch that — tap one above, or skip.");
      }
      return advance('ob_intention', answers, 'locationRadius', picked);
    }

    case 'ob_intention': {
      if (t.length < 10) {
        return askAgain(stage, answers,
          'Share a little more — a sentence or two helps me guide you well.');
      }
      if (t.length > 500) {
        return askAgain(stage, answers,
          'Could you shorten that a little? (500 characters or fewer)');
      }
      const a = { ...answers, intention: t };
      return next('ob_seeking', a, [questionForStage('ob_seeking', a)]);
    }

    case 'ob_seeking': {
      if (isSkipText(t)) {
        return askAgain(stage, answers,
          'Choose at least one — it helps me understand what you\u2019re hoping for.');
      }
      const matched = matchOptions(t, { type: 'multi', options: SEEKING_OPTIONS }) || [];
      if (!matched.length) {
        return askAgain(stage, answers,
          "I didn't catch that — which of these fits best? Tap above, or name it.");
      }
      const a = { ...answers, seeking: [...new Set(matched)] };
      return next('ob_online_mode', a, [questionForStage('ob_online_mode', a)]);
    }

    case 'ob_online_mode': {
      if (isSkipText(t)) {
        return advance('ob_frequency', answers, 'onlineMode', FLOURISHING_DEFAULTS.onlineMode);
      }
      const picked = resolveSingle(t, ONLINE_CHOICES);
      if (!picked) {
        return askAgain(stage, answers,
          "I didn't catch that — tap one above, or skip to keep it open.");
      }
      return advance('ob_frequency', answers, 'onlineMode', picked);
    }

    case 'ob_frequency': {
      if (isSkipText(t)) {
        return advance('ob_boundaries', answers, 'recFrequency', FLOURISHING_DEFAULTS.recFrequency);
      }
      const picked = resolveSingle(t, REC_CHOICES);
      if (!picked) {
        return askAgain(stage, answers,
          "I didn't catch that — tap one above, or skip for the weekly calm default.");
      }
      return advance('ob_boundaries', answers, 'recFrequency', picked);
    }

    case 'ob_boundaries': {
      if (isSkipText(t)) return advance('ob_sync_mode', answers, 'commBoundaries', '');
      if (t.length > 200) {
        return askAgain(stage, answers,
          'Could you keep it to 200 characters or fewer?');
      }
      return advance('ob_sync_mode', answers, 'commBoundaries', t);
    }

    case 'ob_sync_mode': {
      if (isSkipText(t)) {
        return advance('ob_values', answers, 'syncMode', FLOURISHING_DEFAULTS.syncMode);
      }
      const picked = resolveSingle(t, SYNC_CHOICES);
      if (!picked) {
        return askAgain(stage, answers,
          "I didn't catch that — tap one above, or skip.");
      }
      return advance('ob_values', answers, 'syncMode', picked);
    }

    case 'ob_values': {
      if (isSkipText(t)) {
        const a = { ...answers, values: [] };
        return next('ob_consent', a, [questionForStage('ob_consent', a)], [...CONSENT_QUICK_REPLIES]);
      }
      const matched = matchOptions(t, { type: 'multi', options: VALUE_OPTIONS }) || [];
      if (!matched.length) {
        return askAgain(stage, answers,
          "I didn't catch that — tap up to 3 above, or skip for now.");
      }
      if (matched.length > 3) {
        return askAgain(stage, answers,
          'Pick up to 3 that matter most right now.');
      }
      const a = { ...answers, values: [...new Set(matched)] };
      return next('ob_consent', a, [questionForStage('ob_consent', a)], [...CONSENT_QUICK_REPLIES]);
    }

    case 'ob_consent': {
      if (NO_RE.test(t)) {
        return next('ob_declined', answers,
          [questionForStage('ob_declined', answers)], [...DECLINED_QUICK_REPLIES]);
      }
      if (YES_RE.test(t)) {
        return {
          ...next('ob_consent', answers, []),
          create: buildCreate(answers),
        };
      }
      return askAgain(stage, answers,
        'Just to be clear — may SEREN introduce you to other members? A yes or not-yet is all I need.');
    }

    case 'ob_declined': {
      if (YES_RE.test(t) && !NO_RE.test(t)) {
        return {
          ...next('ob_declined', answers, []),
          create: buildCreate(answers),
        };
      }
      return next('ob_declined', answers,
        [botText('No rush at all. Your answers are kept here — whenever you\u2019re ready, just say the word.')],
        [...DECLINED_QUICK_REPLIES]);
    }

    default:
      return startOnboarding();
  }
}
