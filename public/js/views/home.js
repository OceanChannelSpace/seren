// SEREN guided home — the rule-based connection guide entry point.
// Authenticated users land here on a guided chat conversation: they tell
// SEREN what would feel meaningful, answer follow-ups in the chat, review a
// brief, and receive thoughtful, consent-first introduction proposals.
// No scores, no swiping.
import { get } from '../state.js';
import { renderWelcome } from './welcome.js';
import { renderChat } from './chat.js';
import {
  el, pageShell, errorBanner, announce,
} from '../ui.js';

export async function renderHome(root, ctx) {
  const profileId = get('profileId');
  if (!profileId || get('betaEntered') === false) {
    // Not signed in — or beta not entered on this device (a stored profile
    // id alone must not skip the invite gate). The welcome view owns the
    // code entry screen.
    await renderWelcome(root, ctx);
    return;
  }

  const { root: shell, body } = pageShell(
    'Who, or what kind of connection, would feel meaningful right now?',
    'Begin here',
  );
  shell.classList.add('guide-hero');
  root.appendChild(shell);
  const banner = errorBanner();
  body.appendChild(banner.node);

  await renderChat(body);

  body.appendChild(el(`<p class="guide-secondary" style="margin-top:1.25rem">A rule-based guide, not an AI model: it matches on the words you share, and every introduction still needs a yes from both people.</p>`));
  body.appendChild(secondaryLinks());
  announce('A guided conversation with SEREN.');

  function secondaryLinks() {
    const wrap = el(`<p class="guide-secondary"></p>`);
    wrap.appendChild(el(`<span>Prefer to browse? </span>`));
    wrap.appendChild(el(`<a href="#/discover">Discover</a>`));
    wrap.appendChild(el(`<span> · </span>`));
    wrap.appendChild(el(`<a href="#/modes">Explore modes</a>`));
    wrap.appendChild(el(`<span> · </span>`));
    wrap.appendChild(el(`<a href="#/circles">Your circles</a>`));
    return wrap;
  }
}
