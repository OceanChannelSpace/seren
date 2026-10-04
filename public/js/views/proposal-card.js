// SEREN proposal card — a single shared component for introduction suggestions.
// Moved here from views/home.js so the guide chat (views/chat.js) can use it
// without a circular import: home.js statically imports chat.js, so chat.js
// dynamically importing home.js for this card was a fragile cycle. Now
// home.js, chat.js, and brief.js all import it statically from here.
import { esc, el, card, announce, toast } from '../ui.js';
import { navigate } from '../router.js';

/** A proposal card. briefId (optional) is passed through to the staged
 *  request composer so the recipient sees the requester's approved text. */
export function proposalCard(p, briefId) {
  const c = card();
  c.classList.add('proposal-card');
  const cand = p.candidate || {};
  const sub = [cand.pronouns, cand.region].filter(Boolean).join(' · ');
  const head = el(`<div class="person-head"></div>`);
  head.appendChild(el(`<h3>${esc(cand.name || 'A fellow traveler')}</h3>`));
  if (sub) head.appendChild(el(`<p class="person-sub">${esc(sub)}</p>`));
  c.appendChild(head);

  const typeLabel = p.connectionTypeLabel || p.connectionType;
  if (typeLabel) {
    c.appendChild(el(`<p class="request-meta" style="margin-top:0.5rem">${esc(typeLabel)}</p>`));
  }

  const fits = Array.isArray(p.whyItFits) ? p.whyItFits
    : typeof p.whyItFits === 'string' && p.whyItFits ? [p.whyItFits] : null;
  if (fits && fits.length) {
    c.appendChild(el(`<h4 class="proposal-label">Why this might fit</h4>`));
    const ul = el(`<ul class="reason-list"></ul>`);
    for (const r of fits.slice(0, 4)) ul.appendChild(el(`<li>${esc(r)}</li>`));
    c.appendChild(ul);
  }

  // The candidate's own approved words — shown only when they consented to share.
  if (p.candidateSharedText) {
    c.appendChild(el(`<h4 class="proposal-label">In their own words</h4>`));
    c.appendChild(el(`<p class="shared-words">${esc(p.candidateSharedText)}</p>`));
  }

  // Honest reciprocal benefit — never a score, never invented certainty.
  const serve = Array.isArray(p.forCandidate) ? p.forCandidate.join(' ')
    : (typeof p.forCandidate === 'string' ? p.forCandidate : '');
  if (serve) {
    c.appendChild(el(`<h4 class="proposal-label">Why this might serve them</h4>`));
    c.appendChild(el(`<p class="about-text">${esc(serve)}</p>`));
  }

  const first = p.suggestedFirstStep || p.suggestedFirst;
  if (first) {
    const callout = el(`<div class="first-step"></div>`);
    callout.appendChild(el(`<h4>A gentle first step</h4>`));
    callout.appendChild(el(`<p>${esc(first)}</p>`));
    c.appendChild(callout);
  }

  const actions = el(`<div class="match-actions"></div>`);
  const reqBtn = el(`<button type="button" class="btn btn-primary btn-small">Request introduction</button>`);
  reqBtn.addEventListener('click', () => {
    // Hands off to the match detail composer, which carries the full
    // staged-consent request flow. briefId lets the recipient see the
    // requester's approved brief text.
    navigate(`#/discover/match?id=${cand.id}${briefId ? `&briefId=${briefId}` : ''}`);
  });
  const notNow = el(`<button type="button" class="btn btn-ghost btn-small">Not now</button>`);
  notNow.addEventListener('click', () => {
    c.remove();
    announce('Suggestion dismissed.');
    toast('Set aside quietly. Nothing was sent.');
    const remaining = c.closest('.guide-pane')?.querySelectorAll('.proposal-card');
    if (remaining && !remaining.length) {
      const again = el(`<p class="guide-secondary">Take your time — <a href="#/">ask again</a> whenever you like, or <a href="#/discover">browse quietly</a>.</p>`);
      c.closest('.guide-pane').appendChild(again);
    }
  });
  actions.appendChild(reqBtn);
  actions.appendChild(notNow);
  c.appendChild(actions);
  return c;
}
