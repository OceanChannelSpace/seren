// Modes — seven calm ways to begin, each leading somewhere concrete.

import { get, metaList, practiceLabel } from '../state.js';
import * as api from '../api.js';
import { navigate } from '../router.js';
import {
  esc, el, pageShell, errorBanner, toast, loading, card, confirmDialog, announce,
} from '../ui.js';
import { stashDiscoverIntention } from './discover.js';

function modeCard(icon, title, description) {
  const c = card();
  c.classList.add('mode-card');
  c.appendChild(el(`<div class="mode-icon" aria-hidden="true">${icon}</div>`));
  c.appendChild(el(`<h3>${esc(title)}</h3>`));
  c.appendChild(el(`<p>${esc(description)}</p>`));
  return c;
}

function actionButton(label, onClick, secondary = false) {
  const b = el(`<button type="button" class="btn ${secondary ? 'btn-secondary' : 'btn-primary'} btn-small" style="margin-top:0.9rem">${esc(label)}</button>`);
  b.addEventListener('click', onClick);
  return b;
}

export async function renderModes(root, ctx) {
  const profileId = get('profileId');
  const { root: shell, body } = pageShell('Ways to begin', 'Seven modes');
  root.appendChild(shell);
  const banner = errorBanner();
  body.appendChild(banner.node);
  const content = el(`<div></div>`);
  body.appendChild(content);
  content.appendChild(loading('Loading…'));

  let paused = false;
  try {
    const me = await api.getProfile(profileId);
    paused = !!(me.consentSettings && me.consentSettings.paused);
  } catch (e) {
    banner.show(api.friendlyError(e));
  }
  content.innerHTML = '';

  const grid = el(`<div class="mode-grid"></div>`);
  content.appendChild(grid);

  // 1 — Guided matching
  const m1 = modeCard('◈', 'Guided matching', 'A few curated people, chosen for shared practice and intention.');
  m1.appendChild(actionButton('Open Discover', () => navigate('#/discover')));
  grid.appendChild(m1);

  // 2 — Explore a topic
  const m2 = modeCard('✦', 'Explore a topic', 'Follow a thread — grief, creativity, practice — and find people walking it too.');
  const topicList = el(`<div class="template-list" hidden style="margin-top:1rem"></div>`);
  const topicToggle = actionButton('Browse topics', () => {
    topicList.hidden = !topicList.hidden;
    topicToggle.textContent = topicList.hidden ? 'Browse topics' : 'Hide topics';
  }, true);
  m2.appendChild(topicToggle);
  m2.appendChild(topicList);
  const topics = metaList('exploreTopics');
  const savedTopics = new Set();
  try {
    const saved = await api.listSaved(profileId);
    for (const it of (saved.saved || []).filter((s) => s.kind === 'topic')) savedTopics.add(String(it.refId));
  } catch { /* non-fatal */ }
  for (const t of topics) {
    const tc = el(`<div class="card topic-card" style="padding:1rem 1.1rem"></div>`);
    tc.appendChild(el(`<h3 style="margin:0 0 0.35rem;font-size:1rem">${esc(t.title)}</h3>`));
    if (Array.isArray(t.practices) && t.practices.length) {
      const row = el(`<div class="chip-row" style="margin-top:0"></div>`);
      for (const p of t.practices.slice(0, 4)) row.appendChild(el(`<span class="chip chip-static">${esc(practiceLabel(p))}</span>`));
      tc.appendChild(row);
    }
    const row = el(`<div class="btn-row" style="margin-top:0.8rem"></div>`);
    let isSaved = savedTopics.has(String(t.id));
    const saveBtn = el(`<button type="button" class="btn btn-ghost btn-small" aria-pressed="${isSaved}">${isSaved ? 'Saved' : 'Save'}</button>`);
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      try {
        if (isSaved) { await api.unsaveItem(profileId, 'topic', t.id); isSaved = false; }
        else { await api.saveItem(profileId, 'topic', t.id); isSaved = true; toast('Topic saved.'); }
        saveBtn.textContent = isSaved ? 'Saved' : 'Save';
        saveBtn.setAttribute('aria-pressed', String(isSaved));
      } catch (e) { toast(api.friendlyError(e)); }
      finally { saveBtn.disabled = false; }
    });
    row.appendChild(saveBtn);
    const findBtn = el(`<button type="button" class="btn btn-secondary btn-small">Find people</button>`);
    findBtn.addEventListener('click', () => {
      stashDiscoverIntention(t.prompt || t.title);
      navigate('#/discover');
    });
    row.appendChild(findBtn);
    tc.appendChild(row);
    topicList.appendChild(tc);
  }
  grid.appendChild(m2);

  // 3 — Send an intentional request
  const m3 = modeCard('✉', 'Send an intentional request', 'Choose someone and write a thoughtful request. Specific and kind beats clever.');
  m3.appendChild(actionButton('Choose someone', () => navigate('#/discover'), true));
  grid.appendChild(m3);

  // 4 — Receive with care
  const m4 = modeCard('❋', 'Receive with care', 'Requests arrive here. Accept, accept with a boundary, ask a question, or decline — all with dignity.');
  m4.appendChild(actionButton('View requests', () => navigate('#/requests'), true));
  grid.appendChild(m4);

  // 5 — Join a circle
  const m5 = modeCard('◉', 'Join a circle', 'Small groups with a shared purpose. Sit with others walking a similar path.');
  m5.appendChild(actionButton('Browse circles', () => navigate('#/circles'), true));
  grid.appendChild(m5);

  // 6 — Pause & reflect
  const m6 = modeCard('☾', 'Pause & reflect', 'Step back any time. Pausing hides you from suggestions and new requests. Pausing is part of the practice.');
  const pauseBtn = actionButton(paused ? 'Resume discovery' : 'Pause discovery', async () => {
    const toPaused = !paused;
    const ok = await confirmDialog({
      title: toPaused ? 'Pause discovery?' : 'Resume discovery?',
      body: toPaused
        ? 'You will be hidden from suggestions and cannot send new requests. Your connections and circles stay as they are. You can resume any time.'
        : 'You will appear in suggestions again and can send new requests.',
      confirmLabel: toPaused ? 'Pause' : 'Resume',
    });
    if (!ok) return;
    pauseBtn.disabled = true;
    try {
      await api.updateProfile(profileId, { consentSettings: { paused: toPaused } });
      paused = toPaused;
      pauseBtn.textContent = paused ? 'Resume discovery' : 'Pause discovery';
      toast(paused ? 'Discovery paused. Take all the time you need.' : 'Discovery resumed. Welcome back.');
      announce(paused ? 'Discovery paused.' : 'Discovery resumed.');
    } catch (e) {
      toast(api.friendlyError(e));
    } finally {
      pauseBtn.disabled = false;
    }
  }, true);
  m6.appendChild(pauseBtn);
  grid.appendChild(m6);

  // 7 — Saved & returning
  const m7 = modeCard('✧', 'Saved & returning', 'People and topics you saved for later. Return when the time feels right.');
  m7.appendChild(actionButton('View saved', () => navigate('#/saved'), true));
  grid.appendChild(m7);
}
