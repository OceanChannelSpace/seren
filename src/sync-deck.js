// SEREN — Synchronicity deck (curated, human-reviewed starter set).
//
// The draw does not use an LLM. Every card is a single word plus one open,
// non-directive reflective line: a conversation starter, never an
// interpretation, prediction, or claim. Deck rules (enforced by editorial
// review and by tests/synchronicity.test.js and
// tests/resonant-introductions.test.js):
//   - No claims ("new love is coming", "a message from beyond").
//   - No medical, mental-health, or financial directives.
//   - No entity, afterlife, or telepathy assertions.
//   - No second-person predictions. No fate language. No em dashes.
//   - No predictive or fear-based language ("warning", "will happen",
//     ominous tones) — copy stays curious and invitational.
// This is a starter set of 48 cards; the spec targets 100-150 once reviewed.
// The deck is curated content and is safe to expose to members verbatim.
//
// Every card carries a `lens` (symbolic | psychological | spiritual |
// practical) so the person drawing chooses their interpretive frame, and a
// reflective-framing label is attached on every beacon/match output via
// REFLECTIVE_FRAMING: a creative reflection prompt, never a prediction,
// diagnosis, or verified external message.

export const SYNC_DECK = Object.freeze([
  { id: 'river', word: 'river', prompt: 'What has been moving through your life lately?', lens: 'symbolic' },
  { id: 'tide', word: 'tide', prompt: 'What is pulling you in, and what is pulling you out?', lens: 'symbolic' },
  { id: 'threshold', word: 'threshold', prompt: 'Where in your life are you between two things?', lens: 'symbolic' },
  { id: 'lighthouse', word: 'lighthouse', prompt: 'What has been guiding you when things feel foggy?', lens: 'spiritual' },
  { id: 'garden', word: 'garden', prompt: 'What are you tending, and what are you letting grow wild?', lens: 'practical' },
  { id: 'ember', word: 'ember', prompt: 'What small warmth are you keeping alive?', lens: 'psychological' },
  { id: 'bridge', word: 'bridge', prompt: 'What are you crossing toward right now?', lens: 'symbolic' },
  { id: 'mirror', word: 'mirror', prompt: 'What has been reflecting back to you this week?', lens: 'psychological' },
  { id: 'root', word: 'root', prompt: 'What is keeping you steady these days?', lens: 'psychological' },
  { id: 'stone', word: 'stone', prompt: 'What feels solid and dependable in your life?', lens: 'symbolic' },
  { id: 'rain', word: 'rain', prompt: 'What has been washing clean for you?', lens: 'symbolic' },
  { id: 'wind', word: 'wind', prompt: 'What direction are you leaning into?', lens: 'symbolic' },
  { id: 'fog', word: 'fog', prompt: 'What is unclear for you, and are you at peace with that?', lens: 'psychological' },
  { id: 'dawn', word: 'dawn', prompt: 'What is beginning for you?', lens: 'spiritual' },
  { id: 'dusk', word: 'dusk', prompt: 'What is gently ending for you?', lens: 'spiritual' },
  { id: 'moon', word: 'moon', prompt: 'What do you notice when the day goes quiet?', lens: 'spiritual' },
  { id: 'star', word: 'star', prompt: 'What are you looking toward?', lens: 'spiritual' },
  { id: 'forest', word: 'forest', prompt: 'Where do you feel most yourself?', lens: 'psychological' },
  { id: 'meadow', word: 'meadow', prompt: 'What would rest look like for you right now?', lens: 'practical' },
  { id: 'wave', word: 'wave', prompt: 'What keeps returning to you?', lens: 'symbolic' },
  { id: 'leaf', word: 'leaf', prompt: 'What are you letting go of?', lens: 'symbolic' },
  { id: 'seed', word: 'seed', prompt: 'What small thing are you hoping grows?', lens: 'practical' },
  { id: 'flame', word: 'flame', prompt: 'What lights you up when you talk about it?', lens: 'spiritual' },
  { id: 'well', word: 'well', prompt: 'What do you draw on when you need strength?', lens: 'practical' },
  { id: 'path', word: 'path', prompt: 'What road are you on, and how does it feel?', lens: 'symbolic' },
  { id: 'door', word: 'door', prompt: 'What would you like to open?', lens: 'symbolic' },
  { id: 'window', word: 'window', prompt: 'What are you looking out at these days?', lens: 'psychological' },
  { id: 'key', word: 'key', prompt: 'What would unlock something for you?', lens: 'symbolic' },
  { id: 'lantern', word: 'lantern', prompt: 'What helps you see clearly?', lens: 'spiritual' },
  { id: 'compass', word: 'compass', prompt: 'How do you know you are heading the right way?', lens: 'practical' },
  { id: 'map', word: 'map', prompt: 'What territory are you exploring in your life?', lens: 'practical' },
  { id: 'nest', word: 'nest', prompt: 'Where do you feel most held?', lens: 'psychological' },
  { id: 'thread', word: 'thread', prompt: 'What connects the parts of your life right now?', lens: 'symbolic' },
  { id: 'feather', word: 'feather', prompt: 'What feels light in your life?', lens: 'psychological' },
  { id: 'shell', word: 'shell', prompt: 'What are you protecting, and what are you ready to share?', lens: 'psychological' },
  { id: 'drum', word: 'drum', prompt: 'What rhythm are you living by?', lens: 'spiritual' },
  { id: 'bowl', word: 'bowl', prompt: 'What are you holding space for?', lens: 'spiritual' },
  { id: 'cup', word: 'cup', prompt: 'What fills you up?', lens: 'practical' },
  { id: 'song', word: 'song', prompt: 'What melody keeps coming back to you?', lens: 'spiritual' },
  { id: 'letter', word: 'letter', prompt: 'What would you say if you wrote it down?', lens: 'practical' },
  { id: 'hearth', word: 'hearth', prompt: 'What feels like home to you?', lens: 'spiritual' },
  { id: 'horizon', word: 'horizon', prompt: 'What is on the edge of your vision?', lens: 'symbolic' },
  { id: 'clearing', word: 'clearing', prompt: 'What has opened up for you recently?', lens: 'psychological' },
  { id: 'orchard', word: 'orchard', prompt: 'What are you harvesting from this season of life?', lens: 'practical' },
  { id: 'ash', word: 'ash', prompt: 'What remains after something ended?', lens: 'symbolic' },
  { id: 'pebble', word: 'pebble', prompt: 'What small thing made a big ripple?', lens: 'symbolic' },
  { id: 'mist', word: 'mist', prompt: 'What is soft and hard to name right now?', lens: 'psychological' },
  { id: 'candle', word: 'candle', prompt: 'What are you keeping lit, for yourself or others?', lens: 'spiritual' },
]);

const byId = new Map(SYNC_DECK.map((c) => [c.id, c]));

/** Look up a deck card by id, or null. */
export function getSyncCard(id) {
  if (typeof id !== 'string') return null;
  return byId.get(id) || null;
}

/** Reflective-framing label carried on every beacon/match output. */
export const REFLECTIVE_FRAMING =
  'This is a creative reflection prompt, not a prediction, diagnosis, or verified external message.';

/**
 * Card annotated for display: word, prompt, lens, plus the framing label.
 * The backend attaches `framing` to beacon and beacon-match outputs so the
 * label is visible wherever the deck is surfaced.
 */
export function getSyncCardAnnotated(id) {
  const card = getSyncCard(id);
  if (!card) return null;
  return {
    id: card.id,
    word: card.word,
    prompt: card.prompt,
    lens: card.lens,
    framing: REFLECTIVE_FRAMING,
  };
}
