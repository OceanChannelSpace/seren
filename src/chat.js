// SEREN chat — pure conversation helpers for the guide chat interface.
//
// No DB, no express, no network: building bot messages and classifying
// user replies. Tone contract: warm and grounded; never supernatural
// certainty, never clinical/therapy/medical claims, never claims to be
// human. Every bot text is <= 400 characters.

/** Starter chips shown when a new conversation begins. */
export const STARTERS = Object.freeze([
  'A grounded spiritual friend',
  'A meditation or breathwork practice partner',
  'Someone to explore dreamwork with',
  'A local conscious community',
  'A creative collaborator',
  'Curious and open — not sure yet',
]);

/** Quick replies shown under a connection-brief card. */
export const APPROVE_QUICK_REPLIES = Object.freeze([
  'Looks good — find matches',
  'Edit intention',
  'Edit what I offer',
  'Edit boundaries',
  'Start over',
]);

/** Human labels for the brief fields a user can ask the guide to edit. */
export const FIELD_LABELS = Object.freeze({
  intention_text: 'intention',
  offer_text: 'what you offer',
  boundaries_text: 'boundaries',
  who_text: 'how you introduce yourself',
  logistics_text: 'logistics',
});

export function fieldLabel(field) {
  return FIELD_LABELS[field] || field;
}

function firstNameOf(profile) {
  const name = String(profile?.name || '').trim();
  return name ? name.split(/\s+/)[0] : 'friend';
}

/**
 * Opening messages for a brand-new guide conversation.
 * @returns {Array} two bot messages
 */
export function greetingMessages(profile) {
  const firstName = firstNameOf(profile);
  return [
    {
      role: 'bot',
      kind: 'text',
      text: `Hello ${firstName} ✦ I'm the SEREN guide. I ask a few thoughtful questions and draft a connection brief for your review — nothing is shared with anyone until you approve it.`,
    },
    {
      role: 'bot',
      kind: 'text',
      text: 'Who — or what kind of connection — would feel meaningful right now?',
    },
  ];
}

/**
 * Turn a guide question (as returned by selectFollowUps) into a bot message.
 */
export function questionMessage(q) {
  return {
    role: 'bot',
    kind: 'question',
    text: q.prompt,
    questionId: q.id,
    input: q.type,
    options: q.options || [],
    skippable: q.skippable !== false,
  };
}

/**
 * Owner-safe view of a brief: the fields the other person will never see
 * are stripped (private_notes), and contact identity is never attached.
 * @param {object} brief snake_case brief row (as from toBrief)
 */
export function publicBrief(brief) {
  if (!brief) return null;
  return {
    id: brief.id,
    status: brief.status,
    who_text: brief.who_text || '',
    intention_text: brief.intention_text || '',
    good_fit_text: brief.good_fit_text || '',
    offer_text: brief.offer_text || '',
    logistics_text: brief.logistics_text || '',
    boundaries_text: brief.boundaries_text || '',
    shared_text: brief.shared_text || '',
  };
}

/** Present a draft/active brief for review. Never includes private_notes. */
export function briefMessage(brief) {
  return {
    role: 'bot',
    kind: 'brief',
    text: 'Here is what I understood — your connection brief. Read it over; nothing is shared until you approve it.',
    brief: publicBrief(brief),
  };
}

const APPROVE_RE = /\b(looks good|find matches|approve|approved|yes|go ahead|let's do it|do it)\b/i;
const STARTOVER_RE = /start over|new brief|from scratch/i;
const EDIT_RE = /edit|change|rewrite|update/i;

/**
 * Classify free text at the brief-review step.
 * @returns {'approve'|'edit'|'startover'|'unknown'}
 */
export function classifyReviewText(text) {
  const t = String(text || '');
  if (APPROVE_RE.test(t)) return 'approve';
  if (STARTOVER_RE.test(t)) return 'startover';
  if (EDIT_RE.test(t)) return 'edit';
  return 'unknown';
}

const EDIT_FIELD_RE = [
  ['intention_text', /intention|want|seeking/],
  ['offer_text', /offer|give|provide/],
  ['boundaries_text', /boundar/],
  ['who_text', /who i am|about me|name/],
  ['logistics_text', /logistics|format|timing|when|where/],
];

/**
 * Map edit-request text to a brief field.
 * @returns {'intention_text'|'offer_text'|'boundaries_text'|'who_text'|'logistics_text'|null}
 */
export function detectEditField(text) {
  const t = String(text || '').toLowerCase();
  for (const [field, re] of EDIT_FIELD_RE) {
    if (re.test(t)) return field;
  }
  return null;
}

/**
 * Match free text against a single/multi question's options.
 * Case-insensitive substring match of the option label OR value.
 * @returns {Array<string>} matched values (deduped), or null for 'free' questions
 */
export function matchOptions(text, question) {
  if (!question || question.type === 'free') return null;
  const t = String(text || '').toLowerCase();
  const out = [];
  for (const o of question.options || []) {
    const label = String(o?.label || '').toLowerCase();
    const value = String(o?.value || '').toLowerCase();
    if ((label && t.includes(label)) || (value && t.includes(value))) {
      if (!out.includes(o.value)) out.push(o.value);
    }
  }
  return out;
}

/** "skip", "skip for now", "pass" (whole message, nothing else). */
export function isSkipText(text) {
  return /^\s*(skip|skip for now|pass)\s*$/i.test(String(text || ''));
}
