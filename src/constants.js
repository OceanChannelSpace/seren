// SEREN — shared constants and product taxonomies.
// Binding wire values live in docs/API_CONTRACT.md; do not rename without updating it.

/* ------------------------------------------------------------------ */
/* Legacy MVP vocabularies (kept for backward compatibility).          */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Practices & interests — selectable chips (26 + other).              */
/* These describe interests only: never proof of belief, expertise,    */
/* credentials, or safety.                                             */
/* ------------------------------------------------------------------ */

export const PRACTICES = Object.freeze([
  { value: 'meditation', label: 'Meditation' },
  { value: 'mindfulness', label: 'Mindfulness' },
  { value: 'breathwork', label: 'Breathwork' },
  { value: 'yoga', label: 'Yoga' },
  { value: 'somatics', label: 'Somatics' },
  { value: 'ecstatic-dance', label: 'Ecstatic dance' },
  { value: 'dreamwork', label: 'Dreamwork' },
  { value: 'tarot', label: 'Tarot' },
  { value: 'oracle-cards', label: 'Oracle cards' },
  { value: 'astrology', label: 'Astrology' },
  { value: 'human-design', label: 'Human design' },
  { value: 'energy-healing', label: 'Energy healing' },
  { value: 'reiki', label: 'Reiki' },
  { value: 'psychedelic-integration', label: 'Psychedelic integration discussion' },
  { value: 'consciousness-research', label: 'Consciousness research' },
  { value: 'philosophy', label: 'Philosophy' },
  { value: 'spirituality-without-religion', label: 'Spirituality without religion' },
  { value: 'religion-contemplative-tradition', label: 'Religion & contemplative tradition' },
  { value: 'nature-connection', label: 'Nature connection' },
  { value: 'ocean-water-practices', label: 'Ocean / water practices' },
  { value: 'ritual-ceremony', label: 'Ritual & ceremony' },
  { value: 'journaling', label: 'Journaling' },
  { value: 'art-music', label: 'Art & music' },
  { value: 'ai-consciousness', label: 'AI & consciousness' },
  { value: 'quantum-frontier-science', label: 'Quantum / frontier science' },
  { value: 'community-building', label: 'Community building' },
  { value: 'service-volunteering', label: 'Service & volunteering' },
]);
export const PRACTICE_VALUES = Object.freeze(PRACTICES.map((p) => p.value));
export const PRACTICE_LABELS = Object.freeze(
  Object.fromEntries(PRACTICES.map((p) => [p.value, p.label])),
);

/* ------------------------------------------------------------------ */
/* Intentions — what the user is hoping for (multi-select + other).    */
/* Romantic exploration is intentionally excluded from the beta.       */
/* ------------------------------------------------------------------ */

export const INTENTIONS = Object.freeze([
  { value: 'meaningful-friendship', label: 'Meaningful friendship' },
  { value: 'spiritual-peer-connection', label: 'Spiritual peer connection' },
  { value: 'consciousness-exploration', label: 'Consciousness exploration' },
  { value: 'meditation-partner', label: 'Meditation or contemplative practice partner' },
  { value: 'dreamwork-symbolism', label: 'Dreamwork and symbolism' },
  { value: 'tarot-oracle-exchange', label: 'Tarot or oracle exchange' },
  { value: 'astrology-discussion', label: 'Astrology discussion' },
  { value: 'energy-work-discussion', label: 'Energy-work discussion' },
  { value: 'breathwork-somatic', label: 'Breathwork or somatic practice' },
  { value: 'creative-collaboration', label: 'Creative collaboration' },
  { value: 'study-research', label: 'Study or research connection' },
  { value: 'local-gathering', label: 'Local gathering or event companion' },
  { value: 'remote-conversation', label: 'Remote conversation' },
  { value: 'accountability-partner', label: 'Accountability partner' },
  { value: 'mentorship-learning', label: 'Mentorship or learning exchange' },
]);
export const INTENTION_VALUES = Object.freeze(INTENTIONS.map((i) => i.value));
export const INTENTION_LABELS = Object.freeze(
  Object.fromEntries(INTENTIONS.map((i) => [i.value, i.label])),
);

/* ------------------------------------------------------------------ */
/* Connection types — structured taxonomy for intentional requests.    */
/* locality: 'local' | 'remote' | 'either'                             */
/* formats:  subset of ['message','voice','video','group','in-person'] */
/* ------------------------------------------------------------------ */

export const CONNECTION_FORMATS = Object.freeze(['message', 'voice', 'video', 'group', 'in-person']);
export const FORMAT_LABELS = Object.freeze({
  'message': 'Text messages',
  'voice': 'Voice call',
  'video': 'Video call',
  'group': 'Group circle',
  'in-person': 'In person (public place)',
});

export const COMMITMENT_LEVELS = Object.freeze(['one-conversation', 'occasional', 'recurring']);
export const COMMITMENT_LABELS = Object.freeze({
  'one-conversation': 'One conversation',
  'occasional': 'Occasional',
  'recurring': 'Recurring',
});

export const TONES = Object.freeze(['exploratory', 'practical', 'reflective', 'playful', 'deeply-spiritual']);
export const TONE_LABELS = Object.freeze({
  'exploratory': 'Exploratory',
  'practical': 'Practical',
  'reflective': 'Reflective',
  'playful': 'Playful',
  'deeply-spiritual': 'Deeply spiritual',
});

export const CONNECTION_TYPES = Object.freeze([
  { value: 'one-to-one-conversation', label: 'One-to-one intentional conversation',
    description: 'A thoughtful one-to-one conversation with clear intent on both sides.',
    locality: 'either', formats: ['message', 'voice', 'video'],
    consent: 'Both people accept the request before any contact details are shared.' },
  { value: 'meaningful-friendship', label: 'Meaningful friendship',
    description: 'Grow a genuine friendship rooted in shared values and curiosity.',
    locality: 'either', formats: ['message', 'voice', 'video', 'in-person'],
    consent: 'Mutual acceptance; share personal details only when both are comfortable.' },
  { value: 'practice-partner', label: 'Practice partner',
    description: 'A steady partner for an ongoing personal practice.',
    locality: 'either', formats: ['message', 'voice', 'video', 'in-person'],
    consent: 'Agree on cadence and format up front; either person can pause anytime.' },
  { value: 'meditation-partner', label: 'Meditation or contemplative partner',
    description: 'Sit together — in silence or with shared reflection — on a rhythm you both choose.',
    locality: 'either', formats: ['voice', 'video', 'in-person', 'message'],
    consent: 'Agree on session length and style; no teaching credentials are implied.' },
  { value: 'dreamwork-exchange', label: 'Dreamwork / symbolism exchange',
    description: 'Share dreams and explore symbolism together with curiosity, not interpretation-as-authority.',
    locality: 'either', formats: ['message', 'voice', 'video'],
    consent: 'Share only what feels comfortable; reflections are offered, never prescribed.' },
  { value: 'tarot-oracle-exchange', label: 'Tarot or oracle exchange',
    description: 'Exchange readings or study cards together as peers.',
    locality: 'either', formats: ['message', 'voice', 'video'],
    consent: 'Readings are for reflection and conversation — not professional advice.' },
  { value: 'breathwork-somatic-partner', label: 'Breathwork / somatic practice partner',
    description: 'Practice breathwork or somatic exercises alongside someone at a similar level.',
    locality: 'either', formats: ['voice', 'video', 'in-person'],
    consent: 'Go gently; stop anytime. This is peer practice, not therapy or medical care.' },
  { value: 'astrology-discussion', label: 'Astrology / cosmology discussion',
    description: 'Talk charts, transits, and cosmology with a fellow enthusiast.',
    locality: 'either', formats: ['message', 'voice', 'video'],
    consent: 'A conversation between peers; not a substitute for professional counsel.' },
  { value: 'consciousness-research', label: 'Consciousness research discussion',
    description: 'Discuss research, philosophy of mind, and frontier science with a curious peer.',
    locality: 'either', formats: ['message', 'voice', 'video', 'group'],
    consent: 'Ideas are explored openly; no credentials claimed or required.' },
  { value: 'spiritual-study-partner', label: 'Spiritual study partner',
    description: 'Read and reflect on texts, teachings, or traditions together.',
    locality: 'either', formats: ['message', 'voice', 'video', 'group'],
    consent: 'Respect each other\u2019s traditions; disagreement stays kind.' },
  { value: 'creative-collaborator', label: 'Creative collaborator',
    description: 'Make something together — art, music, writing, or ritual craft.',
    locality: 'either', formats: ['message', 'voice', 'video', 'in-person'],
    consent: 'Agree on ownership and credit before sharing work widely.' },
  { value: 'project-collaborator', label: 'Project collaborator',
    description: 'Team up on a project, gathering, or initiative with shared purpose.',
    locality: 'either', formats: ['message', 'voice', 'video', 'group', 'in-person'],
    consent: 'Define roles and commitment level early; either person can step back.' },
  { value: 'mentor-request', label: 'Mentor / guide request',
    description: 'Learn from someone further along a path you\u2019re walking.',
    locality: 'either', formats: ['message', 'voice', 'video'],
    consent: 'Mentorship here is peer wisdom, not professional or medical guidance.' },
  { value: 'peer-learning-exchange', label: 'Peer learning exchange',
    description: 'Teach each other — trade skills, perspectives, and practices.',
    locality: 'either', formats: ['message', 'voice', 'video', 'group'],
    consent: 'Reciprocity is the spirit; keep expectations explicit and kind.' },
  { value: 'accountability-partner', label: 'Accountability partner',
    description: 'Hold each other gently to intentions — practice, study, or creative goals.',
    locality: 'either', formats: ['message', 'voice', 'video'],
    consent: 'Agree on check-in rhythm; compassion over pressure, always.' },
  { value: 'local-community', label: 'Local community connection',
    description: 'Meet kindred people near you for ongoing local connection.',
    locality: 'local', formats: ['in-person', 'group', 'message'],
    consent: 'First meetings should be in a public place. Share location details only by mutual agreement.' },
  { value: 'event-companion', label: 'Event or gathering companion',
    description: 'Attend a gathering, workshop, or ceremony with a friendly companion.',
    locality: 'local', formats: ['in-person', 'group'],
    consent: 'First meetings should be in a public place. Either person can change plans freely.' },
  { value: 'group-circle', label: 'Group circle participant',
    description: 'Join a small facilitated circle — study, meditation, dreamwork, or reflection.',
    locality: 'either', formats: ['group', 'video', 'in-person'],
    consent: 'Circles publish their agreements; joining means honoring them.' },
  { value: 'virtual-circle', label: 'Virtual circle participant',
    description: 'Join an online circle that meets over video or chat.',
    locality: 'remote', formats: ['group', 'video'],
    consent: 'Circles publish their agreements; joining means honoring them.' },
  { value: 'coworking-reflection', label: 'Co-working / reflection session',
    description: 'Work quietly alongside each other, then reflect together.',
    locality: 'either', formats: ['voice', 'video', 'in-person'],
    consent: 'Keep the container simple: shared quiet time plus honest reflection.' },
  { value: 'nature-ocean-connection', label: 'Nature or ocean connection',
    description: 'Share time outdoors — walks, water, wilderness — with a like-minded companion.',
    locality: 'local', formats: ['in-person', 'group'],
    consent: 'Meet in public, tell someone your plans, and respect the land and water.' },
  { value: 'other-intentional', label: 'Other intentional connection',
    description: 'Something purposeful that doesn\u2019t fit the list — describe it in your request.',
    locality: 'either', formats: ['message', 'voice', 'video', 'group', 'in-person'],
    consent: 'Name your intention clearly so the other person can respond with a real yes or no.' },
]);
export const CONNECTION_TYPE_VALUES = Object.freeze(CONNECTION_TYPES.map((t) => t.value));
export const CONNECTION_TYPE_MAP = Object.freeze(
  Object.fromEntries(CONNECTION_TYPES.map((t) => [t.value, t])),
);

/* ------------------------------------------------------------------ */
/* Circle kinds and privacy.                                           */
/* ------------------------------------------------------------------ */

export const CIRCLE_KINDS = Object.freeze([
  { value: 'study', label: 'Study circle' },
  { value: 'meditation', label: 'Meditation circle' },
  { value: 'dreamwork', label: 'Dreamwork circle' },
  { value: 'tarot-oracle', label: 'Tarot / oracle circle' },
  { value: 'consciousness-salon', label: 'Consciousness salon' },
  { value: 'creative-reflection', label: 'Creative reflection circle' },
  { value: 'local-meetup', label: 'Local meetup' },
  { value: 'virtual-gathering', label: 'Virtual gathering' },
]);
export const CIRCLE_KIND_VALUES = Object.freeze(CIRCLE_KINDS.map((c) => c.value));
export const CIRCLE_KIND_LABELS = Object.freeze(
  Object.fromEntries(CIRCLE_KINDS.map((c) => [c.value, c.label])),
);

export const CIRCLE_PRIVACY = Object.freeze(['public', 'request-to-join', 'invite-only']);
export const CIRCLE_PRIVACY_LABELS = Object.freeze({
  'public': 'Public — anyone can join',
  'request-to-join': 'Request to join — host approves',
  'invite-only': 'Invite only — hidden from directory',
});

/* ------------------------------------------------------------------ */
/* Request message templates.                                          */
/* ------------------------------------------------------------------ */

export const REQUEST_TEMPLATES = Object.freeze([
  {
    id: 'shared-interest',
    label: 'Shared interest',
    text: 'I noticed we both care about {interest}. I\u2019d be open to a low-pressure conversation about {topic}, if that feels aligned.',
  },
  {
    id: 'circle-invite',
    label: 'Circle invitation',
    text: 'I\u2019m gathering a small {circle} and your profile suggests a possible fit. No pressure — would you like the details?',
  },
  {
    id: 'practice-partner',
    label: 'Practice partner',
    text: 'I\u2019m looking for a {practice} partner, {cadence}. Would you be open to a brief introductory chat first?',
  },
]);

/* ------------------------------------------------------------------ */
/* Explore-mode topic cards.                                           */
/* ------------------------------------------------------------------ */

export const EXPLORE_TOPICS = Object.freeze([
  { id: 'consciousness-ai', title: 'Consciousness & AI', prompt: 'I want to discuss consciousness and AI.', practices: ['ai-consciousness', 'consciousness-research', 'philosophy'] },
  { id: 'dream-symbolism', title: 'Dream symbolism', prompt: 'I am curious about dream symbolism.', practices: ['dreamwork'] },
  { id: 'meditation-start', title: 'Beginning meditation', prompt: 'I want a grounded introduction to meditation.', practices: ['meditation', 'mindfulness'] },
  { id: 'spirituality-without-dogma', title: 'Spirituality without dogma', prompt: 'I want to meet people exploring spirituality without dogma.', practices: ['spirituality-without-religion', 'philosophy'] },
  { id: 'ocean-practice', title: 'Ocean & water practices', prompt: 'I feel most at home near water and want to share that.', practices: ['ocean-water-practices', 'nature-connection'] },
  { id: 'grief-ritual', title: 'Ritual for life transitions', prompt: 'I\u2019m moving through a life transition and curious about ritual.', practices: ['ritual-ceremony'] },
]);

/* ------------------------------------------------------------------ */
/* Introduction statuses (superset of the MVP contract).                */
/* Old values keep working; new staged-consent values extend them.     */
/* ------------------------------------------------------------------ */

export const INTRO_STATUS = Object.freeze({
  PROPOSED: 'proposed',
  ACCEPTED: 'accepted',
  ACCEPTED_WITH_BOUNDARY: 'accepted_with_boundary',
  QUESTION: 'question',
  DECLINED: 'declined',
  DECLINED_HIDDEN: 'declined_hidden',
  WITHDRAWN: 'withdrawn',
  ENDED: 'ended',
});

// Valid transitions: current status -> allowed target statuses.
export const VALID_TRANSITIONS = Object.freeze({
  proposed: ['accepted', 'accepted_with_boundary', 'question', 'declined', 'declined_hidden', 'withdrawn'],
  accepted: ['ended'],
  accepted_with_boundary: ['ended'],
  question: ['accepted', 'accepted_with_boundary', 'declined', 'declined_hidden', 'withdrawn'],
  declined: [],
  declined_hidden: [],
  withdrawn: [],
  ended: [],
});

// Recipient response kinds for the staged consent flow.
export const RESPONSE_KINDS = Object.freeze([
  'accepted', 'accepted_with_boundary', 'question', 'decline', 'decline_hidden',
]);
export const RESPONSE_LABELS = Object.freeze({
  accepted: 'Accept',
  accepted_with_boundary: 'Accept with a boundary or change',
  question: 'Ask a question',
  decline: 'Decline',
  decline_hidden: 'Decline & hide future requests',
});

export const REPORT_REASONS = Object.freeze([
  'spam', 'harassment', 'inappropriate-content', 'dishonest-profile', 'safety-concern', 'other',
]);
export const REPORT_REASON_LABELS = Object.freeze({
  'spam': 'Spam or solicitation',
  'harassment': 'Harassment or unwanted contact',
  'inappropriate-content': 'Inappropriate content',
  'dishonest-profile': 'Dishonest or misleading profile',
  'safety-concern': 'Safety concern',
  'other': 'Something else',
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
  BETA_REQUIRED: 'beta_required',
  BETA_CODE_INVALID: 'beta_code_invalid',
  FORBIDDEN: 'forbidden',
  CONFLICT_STATE: 'conflict_state',
});
