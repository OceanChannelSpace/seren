// SEREN Flourishing Framework — the design philosophy behind the product.
// A public strategy page: the core principle, the primary design question,
// six principles in calm cards, and the feature acceptance test summarized.
// Warm, concise, grounded copy — no jargon, no spiritual authority claims.

import { el, esc, pageShell } from '../ui.js';

const PRINCIPLES = [
  {
    name: 'Agency First',
    body: 'Every recommendation is an invitation, never an instruction. You can always say no, pause, or walk away — and SEREN treats those choices as the system working as designed.',
  },
  {
    name: 'Real-Life Completion',
    body: 'Success is not a message thread. It is something that changes in your actual life — a conversation you had, a practice you kept, a presence you brought. SEREN points outward, toward the world beyond the screen.',
  },
  {
    name: 'Consent & Deliberate Friction',
    body: 'Small pauses — a confirm step, a boundary check, a quiet hour — are features, not bugs. A moment of friction protects the dignity of both people in every introduction.',
  },
  {
    name: 'Meaning Over Engagement',
    body: 'SEREN does not optimize for time-on-app, streaks, or notifications. Fewer, deeper connections are the goal. If you spend less time here and more time in your life, that is a win.',
  },
  {
    name: 'Epistemic Humility',
    body: 'SEREN never claims to know why two people met, what the universe intends, or what your path is. It offers patterns and invitations with clear reasons — and says plainly when it does not know.',
  },
  {
    name: 'Human Stewardship',
    body: 'People, not algorithms, hold the final judgment. Hosts review reports, humans make introductions in Human Mode, and no automated system can speak for what is right between two people.',
  },
];

export async function renderFramework(root) {
  const { root: shell, body } = pageShell(
    'The SEREN Flourishing Framework',
    'Why we build the way we build',
  );
  root.appendChild(shell);

  const hero = el(`<div class="card"></div>`);
  hero.appendChild(el(`<p class="kicker">Core principle</p>`));
  hero.appendChild(el(`<h2 style="font-size:1.7rem;max-width:36rem">SEREN exists to help people become more present, discerning, connected, and capable in real life.</h2>`));
  hero.appendChild(el(`<p class="lede" style="font-size:1.05rem">Not more engaged. Not more optimized. More themselves — out in the world, among others.</p>`));
  body.appendChild(hero);

  const question = el(`<div class="card card-glow"></div>`);
  question.appendChild(el(`<p class="kicker">The primary design question</p>`));
  question.appendChild(el(`<p style="font-size:1.25rem;font-style:italic;margin:0;max-width:38rem">“Does this feature make it more likely that someone's real life — not their screen time — becomes richer, kinder, and more connected?”</p>`));
  question.appendChild(el(`<p class="field-hint" style="margin-top:0.75rem">If the answer is no, or unclear, the feature does not ship.</p>`));
  body.appendChild(question);

  body.appendChild(el(`<h2 class="section-title">Six principles</h2>`));
  const grid = el(`<div class="principle-grid"></div>`);
  PRINCIPLES.forEach((p, i) => {
    const c = el(`<div class="card principle-card" style="margin-bottom:0"></div>`);
    c.appendChild(el(`<p class="principle-num" aria-hidden="true">${i + 1}</p>`));
    c.appendChild(el(`<h3>${esc(p.name)}</h3>`));
    c.appendChild(el(`<p>${esc(p.body)}</p>`));
    grid.appendChild(c);
  });
  body.appendChild(grid);

  const test = el(`<div class="card"></div>`);
  test.appendChild(el(`<p class="kicker">The acceptance test</p>`));
  test.appendChild(el(`<h2 style="font-size:1.35rem">Before any feature ships, it must pass five questions</h2>`));
  const list = el(`<ul class="reason-list"></ul>`);
  for (const item of [
    'Does it increase a member’s real-life agency — their ability to choose well for themselves?',
    'Does it complete in real life — lead somewhere beyond the app?',
    'Does it preserve consent, with deliberate friction where dignity is at stake?',
    'Does it measure meaning rather than engagement — depth of connection, not clicks?',
    'Does it stay humble about what it knows — no fate, no certainty, no guru voice?',
  ]) {
    list.appendChild(el(`<li>${esc(item)}</li>`));
  }
  test.appendChild(list);
  test.appendChild(el(`<p class="field-hint" style="margin-top:1rem">A feature that fails any one of these does not ship, no matter how clever it is.</p>`));
  body.appendChild(test);

  const coda = el(`<div class="card"></div>`);
  coda.appendChild(el(`<h3 style="margin-top:0">The honest version</h3>`));
  coda.appendChild(el(`<p class="about-text">A connection app cannot make anyone flourish. It can only remove obstacles, offer invitations, and get out of the way. That is the whole ambition — held lightly, on purpose.</p>`));
  body.appendChild(coda);
}
