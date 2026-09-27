// SEREN MVP — shared constants.
// Binding values live in docs/API_CONTRACT.md; do not rename without updating it.

export const INTERESTS = Object.freeze([
  'meditation',
  'tarot',
  'astrology',
  'breathwork',
  'reiki',
  'sound-healing',
  'yoga',
  'journaling',
  'dreamwork',
  'numerology',
  'crystals',
  'shamanism',
]);

export const SEEKING = Object.freeze([
  'friendship',
  'practice-partner',
  'collaboration',
  'guidance',
]);

// Small stopword list for intention-keyword extraction (matching rule).
export const STOPWORDS = Object.freeze([
  'about', 'after', 'again', 'against', 'being', 'between', 'both', 'could',
  'deep', 'deeper', 'doing', 'during', 'each', 'find', 'from', 'have',
  'hoping', 'into', 'just', 'journey', 'like', 'looking', 'more', 'need',
  'over', 'path', 'seek', 'seeking', 'share', 'shared', 'some', 'such',
  'than', 'that', 'their', 'them', 'these', 'they', 'this', 'those',
  'through', 'very', 'want', 'what', 'when', 'where', 'which', 'while',
  'with', 'would', 'your', 'yours', 'spiritual', 'connect', 'connection',
]);

// Introduction statuses (contract's status column values).
export const INTRO_STATUS = Object.freeze({
  PROPOSED: 'proposed',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  WITHDRAWN: 'withdrawn',
});

// Valid transitions: current status -> allowed target statuses.
export const VALID_TRANSITIONS = Object.freeze({
  proposed: ['accepted', 'declined', 'withdrawn'],
  accepted: [],
  declined: [],
  withdrawn: [],
});

// Wire error codes ({"error":{"code","message"}}).
export const ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: 'validation_error',
  EMAIL_TAKEN: 'email_taken',
  NOT_FOUND: 'not_found',
  REQUESTER_NOT_FOUND: 'requester_not_found',
  CONSENT_REQUIRED: 'consent_required',
  NO_MATCH: 'no_match',
  INVALID_TRANSITION: 'invalid_transition',
});
