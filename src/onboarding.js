// SEREN conversational onboarding — the profile-creation interview.
//
// Pure conversation logic for profile-less guide sessions: no DB, no
// express, no network. The server wires these helpers to storage and the
// existing profile-creation path (validateProfileInput + createProfile).
//
// Stage machine:
//   ob_name -> ob_email -> ob_interests -> ob_intention -> ob_seeking
//   -> ob_values -> ob_consent -> (profile created, handoff to guide)
//   ob_consent --"not yet"--> ob_declined --"i'm ready"--> (create)
//
// Tone contract: warm and grounded; consent-first; never clinical,
// medical, or therapeutic claims; never psychic certainty or spiritual
// authority; never numeric scores. Every bot text is <= 400 characters.

import { INTERESTS, SEEKING } from './constants.js';
import { DEPTH_VALUE_LABELS } from './guide.js';
import { questionMessage, matchOptions, isSkipText } from './chat.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Stages owned by the onboarding interview (before any profile exists). */
export const ONBOARDING_STAGES = Object.freeze([
  'ob_name',
  'ob_email',
  'ob_interests',
  'ob_intention',
  'ob_seeking',
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

const INTEREST_OPTIONS = chips(INTERESTS, interestLabel);
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
        "Hello ✦ I'm SEREN, a guide for meaningful connection. I'll ask a few gentle questions to create your space here — nothing is shared with anyone until you say so.",
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
 * than a question message.
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
        prompt: `Thanks, ${first}. What's your email? It's how you find your space again on another device — it's never shown to other members.`,
        type: 'free',
        skippable: false,
      });
    case 'ob_interests':
      return questionMessage({
        id: 'ob_interests',
        prompt: 'Which of these are part of your life? Choose up to 8 — they describe interests only, never expertise.',
        type: 'multi',
        options: INTEREST_OPTIONS,
        skippable: false,
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
    case 'ob_values':
      return questionMessage({
        id: 'ob_values',
        prompt: 'What matters most in a connection right now? Pick up to 3 — or skip.',
        type: 'multi',
        options: VALUE_OPTIONS,
        skippable: true,
      });
    case 'ob_consent':
      return botText(
        'One last thing, entirely your call: may SEREN introduce you to other members? That means using what you shared to suggest members with shared interests — and letting you appear in suggestions for others. Every introduction needs a yes from both people, and you can pause or leave anytime.',
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

function askAgain(stage, answers, note) {
  const q = questionForStage(stage, answers);
  const messages = note ? [botText(note), q] : [q];
  return {
    stage, answers, messages, quickReplies: quickRepliesForStage(stage),
  };
}

/**
 * Advance the interview one user turn.
 * @param {string} stage current onboarding stage
 * @param {object} answers collected answers so far
 * @param {string} text trimmed user text
 * @param {{emailTaken(email:string):boolean}} ctx
 * @returns {{stage, answers, messages, quickReplies?} |
 *           {stage, answers, messages, quickReplies?, create:{name,email,interests,intention,seeking,values}}}
 *   When `create` is present the interview is complete and the server
 *   should create the profile through the existing creation path.
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
          'I need a name to create your space — what should I call you? (80 characters or fewer)');
      }
      if (isSkipText(t)) {
        return askAgain(stage, answers,
          'This one needs an answer — even a nickname works. What should I call you?');
      }
      const a = { ...answers, name: t };
      return next('ob_email', a, [questionForStage('ob_email', a)]);
    }

    case 'ob_email': {
      if (!EMAIL_RE.test(t)) {
        return askAgain(stage, answers,
          "That doesn't look like an email address — mind checking it?");
      }
      const email = t.toLowerCase();
      if (ctx.emailTaken && ctx.emailTaken(email)) {
        return askAgain(stage, answers,
          'It looks like that email already has a SEREN space. If it\u2019s yours, you can reclaim it from the welcome screen — or share a different email.');
      }
      const a = { ...answers, email: t };
      return next('ob_interests', a, [questionForStage('ob_interests', a)]);
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
      return next('ob_intention', a, [questionForStage('ob_intention', a)]);
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
      return next('ob_values', a, [questionForStage('ob_values', a)]);
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
          create: {
            name: answers.name,
            email: answers.email,
            interests: answers.interests || [],
            intention: answers.intention,
            seeking: answers.seeking || [],
            values: answers.values || [],
          },
        };
      }
      return askAgain(stage, answers,
        'Just to be clear — may SEREN introduce you to other members? A yes or not-yet is all I need.');
    }

    case 'ob_declined': {
      if (YES_RE.test(t) && !NO_RE.test(t)) {
        return {
          ...next('ob_declined', answers, []),
          create: {
            name: answers.name,
            email: answers.email,
            interests: answers.interests || [],
            intention: answers.intention,
            seeking: answers.seeking || [],
            values: answers.values || [],
          },
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
