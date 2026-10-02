// Discover — curated matches with qualitative reasons.
// Small, intentional suggestions: limit 6, "Show more" refetches.

import { get, metaList, practiceLabel, intentionLabel, STORAGE_PREFIX } from '../state.js';
import * as api from '../api.js';
import { navigate } from '../router.js';
import {
  esc, el, pageShell, errorBanner, toast, loading, emptyState,
  chipSingle, field, textInput, selectInput, card, avatarFor, confirmDialog, announce,
} from '../ui.js';

const INTENTION_KEY = `${STORAGE_PREFIX}.discoverIntention`;

export function stashDiscoverIntention(text) {
  try { sessionStorage.setItem(INTENTION_KEY, text || ''); } catch { /* noop */ }
}

function takeStashedIntention() {
  try {
    const v = sessionStorage.getItem(INTENTION_KEY);
    sessionStorage.removeItem(INTENTION_KEY);
    return v || '';
  } catch { return ''; }
}

function profileLine(p) {
  const bits = [];
  if (p.pronouns) bits.push(p.pronouns);
  return bits.join(' · ');
}

/** Card for an intelligent-agent suggestion — always labeled AI, never human. */
function agentCard(entry) {
  const a = entry.agent || {};
  const c = card();
  c.classList.add('match-card');

  const head = el(`<div class="person-head"></div>`);
  head.appendChild(avatarFor(a.name || 'Agent'));
  const who = el(`<div class="who"></div>`);
  who.appendChild(el(`<h3>${esc(a.name || 'Unnamed agent')} <span class="pill">AI</span> <span class="pill pill-muted">unverified</span></h3>`));
  if (a.operatorName) who.appendChild(el(`<p class="person-sub">Registered by ${esc(a.operatorName)}</p>`));
  head.appendChild(who);
  c.appendChild(head);

  if (a.description) c.appendChild(el(`<p>${esc(a.description)}</p>`));
  if (a.trustNote) c.appendChild(el(`<p class="field-hint">Unverified operator declaration: “${esc(a.trustNote)}”</p>`));

  if (Array.isArray(entry.reasons) && entry.reasons.length) {
    const ul = el(`<ul class="reason-list"></ul>`);
    for (const r of entry.reasons.slice(0, 4)) {
      ul.appendChild(el(`<li>${esc(r)}</li>`));
    }
    c.appendChild(ul);
  }

  const caps = (a.capabilities || []).slice(0, 4);
  if (caps.length) {
    c.appendChild(el(`<p class="field-hint" style="margin-bottom:0.25rem">Operator-declared capabilities (not verified):</p>`));
    const row = el(`<div class="chip-row"></div>`);
    for (const label of caps) row.appendChild(el(`<span class="chip chip-static">${esc(label)}</span>`));
    c.appendChild(row);
  }
  return c;
}

function matchCard(match, profileId, onPassed) {
  const p = match.profile;
  const c = card();
  c.classList.add('match-card');

  const head = el(`<div class="person-head"></div>`);
  head.appendChild(avatarFor(p.name));
  const who = el(`<div class="who"></div>`);
  const sub = [profileLine(p), p.region].filter(Boolean).join(' · ');
  who.appendChild(el(`<h3>${esc(p.name)}${match.serendipity ? ' <span class="pill">wild card</span>' : ''}</h3>`));
  if (sub) who.appendChild(el(`<p class="person-sub">${esc(sub)}</p>`));
  head.appendChild(who);
  c.appendChild(head);

  if (Array.isArray(match.reasons) && match.reasons.length) {
    const ul = el(`<ul class="reason-list"></ul>`);
    for (const r of match.reasons.slice(0, 4)) {
      ul.appendChild(el(`<li>${esc(r)}</li>`));
    }
    c.appendChild(ul);
  }

  const chips = [];
  for (const v of (match.sharedPractices || []).slice(0, 4)) chips.push(practiceLabel(v));
  for (const v of (match.sharedIntentions || []).slice(0, 3)) chips.push(intentionLabel(v));
  if (chips.length) {
    const row = el(`<div class="chip-row"></div>`);
    for (const label of chips) row.appendChild(el(`<span class="chip chip-static">${esc(label)}</span>`));
    c.appendChild(row);
  }

  const actions = el(`<div class="match-actions"></div>`);

  const viewBtn = el(`<button type="button" class="btn btn-primary btn-small">View</button>`);
  viewBtn.addEventListener('click', () => navigate(`#/discover/match?id=${p.id}`));
  actions.appendChild(viewBtn);

  let saved = !!match.saved;
  const saveBtn = el(`<button type="button" class="btn btn-secondary btn-small" aria-pressed="${saved}">${saved ? 'Saved' : 'Save'}</button>`);
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      if (saved) {
        await api.unsaveItem(profileId, 'match', p.id);
        saved = false;
        toast('Removed from saved.');
      } else {
        await api.saveItem(profileId, 'match', p.id);
        saved = true;
        toast('Saved. Find them anytime under Modes → Saved.');
      }
      saveBtn.textContent = saved ? 'Saved' : 'Save';
      saveBtn.setAttribute('aria-pressed', String(saved));
    } catch (e) {
      toast(api.friendlyError(e));
    } finally {
      saveBtn.disabled = false;
    }
  });
  actions.appendChild(saveBtn);

  const passBtn = el(`<button type="button" class="btn btn-ghost btn-small">Pass</button>`);
  passBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Pass on this person?',
      body: 'They will not appear in Discover again. This is private — they are not notified.',
      confirmLabel: 'Pass',
    });
    if (!ok) return;
    passBtn.disabled = true;
    try {
      await api.passProfile(profileId, p.id);
      c.remove();
      toast('Passed. They will not be suggested again.');
      announce(`${p.name} passed.`);
      if (onPassed) onPassed();
    } catch (e) {
      toast(api.friendlyError(e));
      passBtn.disabled = false;
    }
  });
  actions.appendChild(passBtn);

  c.appendChild(actions);
  return c;
}

export async function renderDiscover(root, ctx) {
  const profileId = get('profileId');
  const { root: shell, body } = pageShell('Discover', 'Curated for you');
  root.appendChild(shell);

  const banner = errorBanner();
  body.appendChild(banner.node);

  // --- pause state ---
  const pauseWrap = el(`<div></div>`);
  body.appendChild(pauseWrap);

  // --- filters ---
  const filtersCard = card();
  filtersCard.classList.add('filters-card');
  body.appendChild(filtersCard);

  const stashed = takeStashedIntention();
  const intentionInput = textInput({
    id: 'discover-intention',
    value: stashed,
    placeholder: 'e.g. a calm meditation partner for weekly practice',
    maxLength: 200,
  });
  filtersCard.appendChild(field(
    'What are you hoping for right now?',
    intentionInput,
    { id: 'discover-intention', hint: 'Optional. Shapes your suggestions; never shown to others.' },
  ));

  const filterRow = el(`<div class="filter-row" style="display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));margin-top:0.5rem"></div>`);
  const practices = metaList('practices');
  const practiceSelect = selectInput({
    id: 'discover-practice',
    ariaLabel: 'Filter by practice',
    options: [{ value: '', label: 'Any practice' }].concat(practices.map((p) => ({ value: p.value, label: p.label }))),
  });
  filterRow.appendChild(field('Practice', practiceSelect, { id: 'discover-practice' }));

  const locality = chipSingle({
    name: 'locality',
    ariaLabel: 'Locality',
    value: null,
    options: [
      { value: null, label: 'Anywhere' },
      { value: 'local', label: 'Local' },
      { value: 'remote', label: 'Remote' },
    ],
  });
  filterRow.appendChild(field('Locality', locality.node));

  const formats = metaList('connectionFormats');
  const formatSelect = selectInput({
    id: 'discover-format',
    ariaLabel: 'Filter by format',
    options: [{ value: '', label: 'Any format' }].concat(formats.map((f) => ({ value: f.value, label: f.label }))),
  });
  filterRow.appendChild(field('Format', formatSelect, { id: 'discover-format' }));
  filtersCard.appendChild(filterRow);

  const refreshBtn = el(`<button type="button" class="btn btn-secondary" style="margin-top:1rem">Refresh suggestions</button>`);
  filtersCard.appendChild(refreshBtn);

  // --- results ---
  const resultsWrap = el(`<div class="discover-results"></div>`);
  body.appendChild(resultsWrap);

  let limit = 6;

  async function loadMatches() {
    resultsWrap.innerHTML = '';
    const loader = loading('Gathering suggestions…');
    resultsWrap.appendChild(loader);
    banner.clear();
    try {
      const opts = {
        limit,
        intention: intentionInput.value.trim(),
        practice: practiceSelect.value || undefined,
        locality: locality.get() || undefined,
        format: formatSelect.value || undefined,
        agents: true,
      };
      const data = await api.discover(profileId, opts);
      loader.remove();
      const matches = data.matches || [];
      const agentEntries = data.agents || [];
      if (!matches.length && !agentEntries.length) {
        resultsWrap.appendChild(emptyState({
          title: 'No new people to meet right now.',
          body: 'SEREN is a small private beta, and every introduction needs a yes from both people. As more members join and share what they are looking for, matches will appear here.',
          actionLabel: 'Explore modes',
          actionHref: '#/modes',
        }));
        return;
      }
      const grid = el(`<div class="match-grid"></div>`);
      const onPassed = () => {
        if (!grid.querySelector('.match-card')) {
          resultsWrap.innerHTML = '';
          resultsWrap.appendChild(emptyState({
            title: 'No new people to meet right now.',
            body: 'SEREN is a small private beta, and every introduction needs a yes from both people. As more members join and share what they are looking for, matches will appear here.',
            actionLabel: 'Explore modes',
            actionHref: '#/modes',
          }));
        }
      };
      for (const m of matches) grid.appendChild(matchCard(m, profileId, onPassed));
      resultsWrap.appendChild(grid);

      if (agentEntries.length) {
        resultsWrap.appendChild(el(`<h2 style="margin-top:2.25rem">Intelligent agents</h2>`));
        resultsWrap.appendChild(el(`<p class="field-hint">AI participants registered by members — always labeled, never presented as human, and never verified by the platform. <a href="#/agents">Browse the registry</a></p>`));
        const agentGrid = el(`<div class="match-grid"></div>`);
        for (const entry of agentEntries) agentGrid.appendChild(agentCard(entry));
        resultsWrap.appendChild(agentGrid);
      }

      const moreWrap = el(`<div class="center" style="margin-top:1.5rem"></div>`);
      const moreBtn = el(`<button type="button" class="btn btn-ghost">Show more</button>`);
      moreBtn.addEventListener('click', () => { limit += 6; loadMatches(); });
      moreWrap.appendChild(moreBtn);
      resultsWrap.appendChild(moreWrap);
    } catch (e) {
      loader.remove();
      banner.show(api.friendlyError(e));
    }
  }

  refreshBtn.addEventListener('click', () => { limit = 6; loadMatches(); });

  // Filters apply immediately on change — no dead-end dropdowns.
  const applyFilters = () => { limit = 6; loadMatches(); };
  practiceSelect.addEventListener('change', applyFilters);
  formatSelect.addEventListener('change', applyFilters);
  locality.node.addEventListener('click', () => { setTimeout(applyFilters, 0); });
  let intentionTimer = null;
  intentionInput.addEventListener('input', () => {
    clearTimeout(intentionTimer);
    intentionTimer = setTimeout(applyFilters, 700);
  });

  // --- pause banner + initial data ---
  body.insertBefore(loading('Loading…'), pauseWrap);
  try {
    const me = await api.getProfile(profileId);
    body.querySelector('.loading-block')?.remove();
    if (me.consentSettings && me.consentSettings.paused) {
      const pb = el(`
        <div class="pause-banner" role="status">
          <p><strong>Discovery is paused.</strong> You are hidden from suggestions and cannot send new requests. Pausing is part of the practice.</p>
        </div>`);
      const resumeBtn = el(`<button type="button" class="btn btn-secondary btn-small">Resume discovery</button>`);
      resumeBtn.addEventListener('click', async () => {
        resumeBtn.disabled = true;
        try {
          await api.updateProfile(profileId, { consentSettings: { paused: false } });
          toast('Discovery resumed. Welcome back.');
          pb.remove();
          loadMatches();
        } catch (e) {
          toast(api.friendlyError(e));
          resumeBtn.disabled = false;
        }
      });
      pb.appendChild(resumeBtn);
      pauseWrap.appendChild(pb);
    }
    // First-run serendipity disclosure: the wild card is permissioned, so the
    // permission has to be understandable — not a buried toggle. Shown once.
    const cs = me.consentSettings || {};
    let noticeSeen = true;
    try { noticeSeen = localStorage.getItem(`${STORAGE_PREFIX}.serendipityNoticeSeen`) === '1'; } catch { /* noop */ }
    if (cs.serendipity !== false && !noticeSeen) {
      const nb = el(`
        <div class="notice-banner" role="status">
          <p><strong>A note on wild cards.</strong> Discover sometimes includes one clearly-labeled wild card — a genuine member outside your obvious overlaps, offered to widen the circle. You can turn this off any time in <a href="#/me">Me → Discovery</a>.</p>
        </div>`);
      const okBtn = el(`<button type="button" class="btn btn-secondary btn-small">Got it</button>`);
      okBtn.addEventListener('click', () => {
        try { localStorage.setItem(`${STORAGE_PREFIX}.serendipityNoticeSeen`, '1'); } catch { /* noop */ }
        nb.remove();
        announce('Notice dismissed.');
      });
      nb.appendChild(okBtn);
      pauseWrap.appendChild(nb);
    }
  } catch (e) {
    body.querySelector('.loading-block')?.remove();
    banner.show(api.friendlyError(e));
  }

  await loadMatches();
}
