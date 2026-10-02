// SEREN — Synchronicity deck (curated, human-reviewed starter set).
//
// The draw does not use an LLM. Every card is a single word plus one open,
// non-directive reflective line: a conversation starter, never an
// interpretation, prediction, or claim. Deck rules (enforced by editorial
// review and by tests/synchronicity.test.js):
//   - No claims ("new love is coming", "a message from beyond").
//   - No medical, mental-health, or financial directives.
//   - No entity, afterlife, or telepathy assertions.
//   - No second-person predictions. No fate language. No em dashes.
// This is a starter set of 48 cards; the spec targets 100-150 once reviewed.
// The deck is curated content and is safe to expose to members verbatim.

export const SYNC_DECK = Object.freeze([
  { id: 'river', word: 'river', prompt: 'What has been moving through your life lately?' },
  { id: 'tide', word: 'tide', prompt: 'What is pulling you in, and what is pulling you out?' },
  { id: 'threshold', word: 'threshold', prompt: 'Where in your life are you between two things?' },
  { id: 'lighthouse', word: 'lighthouse', prompt: 'What has been guiding you when things feel foggy?' },
  { id: 'garden', word: 'garden', prompt: 'What are you tending, and what are you letting grow wild?' },
  { id: 'ember', word: 'ember', prompt: 'What small warmth are you keeping alive?' },
  { id: 'bridge', word: 'bridge', prompt: 'What are you crossing toward right now?' },
  { id: 'mirror', word: 'mirror', prompt: 'What has been reflecting back to you this week?' },
  { id: 'root', word: 'root', prompt: 'What is keeping you steady these days?' },
  { id: 'stone', word: 'stone', prompt: 'What feels solid and dependable in your life?' },
  { id: 'rain', word: 'rain', prompt: 'What has been washing clean for you?' },
  { id: 'wind', word: 'wind', prompt: 'What direction are you leaning into?' },
  { id: 'fog', word: 'fog', prompt: 'What is unclear for you, and are you at peace with that?' },
  { id: 'dawn', word: 'dawn', prompt: 'What is beginning for you?' },
  { id: 'dusk', word: 'dusk', prompt: 'What is gently ending for you?' },
  { id: 'moon', word: 'moon', prompt: 'What do you notice when the day goes quiet?' },
  { id: 'star', word: 'star', prompt: 'What are you looking toward?' },
  { id: 'forest', word: 'forest', prompt: 'Where do you feel most yourself?' },
  { id: 'meadow', word: 'meadow', prompt: 'What would rest look like for you right now?' },
  { id: 'wave', word: 'wave', prompt: 'What keeps returning to you?' },
  { id: 'leaf', word: 'leaf', prompt: 'What are you letting go of?' },
  { id: 'seed', word: 'seed', prompt: 'What small thing are you hoping grows?' },
  { id: 'flame', word: 'flame', prompt: 'What lights you up when you talk about it?' },
  { id: 'well', word: 'well', prompt: 'What do you draw on when you need strength?' },
  { id: 'path', word: 'path', prompt: 'What road are you on, and how does it feel?' },
  { id: 'door', word: 'door', prompt: 'What would you like to open?' },
  { id: 'window', word: 'window', prompt: 'What are you looking out at these days?' },
  { id: 'key', word: 'key', prompt: 'What would unlock something for you?' },
  { id: 'lantern', word: 'lantern', prompt: 'What helps you see clearly?' },
  { id: 'compass', word: 'compass', prompt: 'How do you know you are heading the right way?' },
  { id: 'map', word: 'map', prompt: 'What territory are you exploring in your life?' },
  { id: 'nest', word: 'nest', prompt: 'Where do you feel most held?' },
  { id: 'thread', word: 'thread', prompt: 'What connects the parts of your life right now?' },
  { id: 'feather', word: 'feather', prompt: 'What feels light in your life?' },
  { id: 'shell', word: 'shell', prompt: 'What are you protecting, and what are you ready to share?' },
  { id: 'drum', word: 'drum', prompt: 'What rhythm are you living by?' },
  { id: 'bowl', word: 'bowl', prompt: 'What are you holding space for?' },
  { id: 'cup', word: 'cup', prompt: 'What fills you up?' },
  { id: 'song', word: 'song', prompt: 'What melody keeps coming back to you?' },
  { id: 'letter', word: 'letter', prompt: 'What would you say if you wrote it down?' },
  { id: 'hearth', word: 'hearth', prompt: 'What feels like home to you?' },
  { id: 'horizon', word: 'horizon', prompt: 'What is on the edge of your vision?' },
  { id: 'clearing', word: 'clearing', prompt: 'What has opened up for you recently?' },
  { id: 'orchard', word: 'orchard', prompt: 'What are you harvesting from this season of life?' },
  { id: 'ash', word: 'ash', prompt: 'What remains after something ended?' },
  { id: 'pebble', word: 'pebble', prompt: 'What small thing made a big ripple?' },
  { id: 'mist', word: 'mist', prompt: 'What is soft and hard to name right now?' },
  { id: 'candle', word: 'candle', prompt: 'What are you keeping lit, for yourself or others?' },
]);

const byId = new Map(SYNC_DECK.map((c) => [c.id, c]));

/** Look up a deck card by id, or null. */
export function getSyncCard(id) {
  if (typeof id !== 'string') return null;
  return byId.get(id) || null;
}
