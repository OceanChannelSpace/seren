// Saved — people and topics kept for later.

import { get, practiceLabel } from '../state.js';
import * as api from '../api.js';
import { navigate } from '../router.js';
import {
  esc, el, pageShell, errorBanner, toast, loading, emptyState,
  card, avatarFor, announce,
} from '../ui.js';
import { stashDiscoverIntention } from './discover.js';

function sectionTitle(text) {
  return el(`<h2 style="margin:2rem 0 1rem;font-size:1.25rem">${esc(text)}</h2>`);
}

export async function renderSaved(root, ctx) {
  const profileId = get('profileId');
  const { root: shell, body } = pageShell('Saved', 'Return when the time feels right');
  root.appendChild(shell);
  const banner = errorBanner();
  body.appendChild(banner.node);
  const content = el(`<div></div>`);
  body.appendChild(content);
  content.appendChild(loading('Loading saved…'));

  let items = [];
  try {
    const data = await api.listSaved(profileId);
    items = data.saved || [];
  } catch (e) {
    banner.show(api.friendlyError(e));
  }
  content.innerHTML = '';

  const people = items.filter((i) => i.kind === 'match' && i.profile);
  const topics = items.filter((i) => i.kind === 'topic' && i.topic);

  if (!items.length) {
    content.appendChild(emptyState({
      title: 'Nothing saved yet.',
      body: 'When someone or a topic resonates, save it here for later.',
      actionLabel: 'Discover people',
      actionHref: '#/discover',
    }));
    return;
  }

  async function removeItem(kind, refId, cardEl) {
    try {
      await api.unsaveItem(profileId, kind, refId);
      cardEl.remove();
      toast('Removed.');
      announce('Removed from saved.');
      if (!content.querySelector('.saved-card')) {
        content.innerHTML = '';
        content.appendChild(emptyState({
          title: 'Nothing saved yet.',
          body: 'When someone or a topic resonates, save it here for later.',
          actionLabel: 'Discover people',
          actionHref: '#/discover',
        }));
      }
    } catch (e) {
      toast(api.friendlyError(e));
    }
  }

  // --- saved people ---
  if (people.length) {
    content.appendChild(sectionTitle('Saved people'));
    const grid = el(`<div class="match-grid"></div>`);
    for (const it of people) {
      const p = it.profile;
      const c = card();
      c.classList.add('saved-card');
      const head = el(`<div class="person-head"></div>`);
      head.appendChild(avatarFor(p.name));
      const who = el(`<div class="who"></div>`);
      who.appendChild(el(`<h3>${esc(p.name)}</h3>`));
      const sub = [p.pronouns, p.region].filter(Boolean).join(' · ');
      if (sub) who.appendChild(el(`<p class="person-sub">${esc(sub)}</p>`));
      head.appendChild(who);
      c.appendChild(head);
      if (Array.isArray(p.practices) && p.practices.length) {
        const row = el(`<div class="chip-row"></div>`);
        for (const v of p.practices.slice(0, 4)) row.appendChild(el(`<span class="chip chip-static">${esc(practiceLabel(v))}</span>`));
        c.appendChild(row);
      }
      const actions = el(`<div class="match-actions"></div>`);
      const viewBtn = el(`<button type="button" class="btn btn-primary btn-small">View</button>`);
      viewBtn.addEventListener('click', () => navigate(`#/discover/match?id=${p.id}`));
      actions.appendChild(viewBtn);
      const rmBtn = el(`<button type="button" class="btn btn-ghost btn-small">Remove</button>`);
      rmBtn.addEventListener('click', () => removeItem('match', it.refId, c));
      actions.appendChild(rmBtn);
      c.appendChild(actions);
      grid.appendChild(c);
    }
    content.appendChild(grid);
  } else {
    content.appendChild(sectionTitle('Saved people'));
    content.appendChild(el(`<p style="color:var(--mist)">No saved people yet. Save someone from Discover to return later.</p>`));
  }

  // --- saved topics ---
  if (topics.length) {
    content.appendChild(sectionTitle('Saved topics'));
    const list = el(`<div class="template-list"></div>`);
    for (const it of topics) {
      const t = it.topic;
      const c = el(`<div class="card saved-card" style="padding:1.1rem 1.25rem"></div>`);
      c.appendChild(el(`<h3 style="margin:0 0 0.35rem;font-size:1.05rem">${esc(t.title)}</h3>`));
      if (Array.isArray(t.practices) && t.practices.length) {
        const row = el(`<div class="chip-row" style="margin-top:0"></div>`);
        for (const v of t.practices.slice(0, 4)) row.appendChild(el(`<span class="chip chip-static">${esc(practiceLabel(v))}</span>`));
        c.appendChild(row);
      }
      const row = el(`<div class="btn-row" style="margin-top:0.8rem"></div>`);
      const findBtn = el(`<button type="button" class="btn btn-secondary btn-small">Find people</button>`);
      findBtn.addEventListener('click', () => {
        stashDiscoverIntention(t.prompt || t.title);
        navigate('#/discover');
      });
      row.appendChild(findBtn);
      const rmBtn = el(`<button type="button" class="btn btn-ghost btn-small">Remove</button>`);
      rmBtn.addEventListener('click', () => removeItem('topic', it.refId, c));
      row.appendChild(rmBtn);
      c.appendChild(row);
      list.appendChild(c);
    }
    content.appendChild(list);
  } else {
    content.appendChild(sectionTitle('Saved topics'));
    content.appendChild(el(`<p style="color:var(--mist)">No saved topics yet. Explore a topic from Modes.</p>`));
  }
}
