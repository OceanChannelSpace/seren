// Modes — nine calm ways to begin, each leading somewhere concrete.

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
  const { root: shell, body } = pageShell('Ways to begin', 'Layers and modes');
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

  // The SEREN taxonomy: layers are WHO connects, modes are HOW a connection
  // is found. Kept brief — the cards below are ways to begin within them.
  const tax = el(`<div class="card" style="margin-bottom:1.25rem"></div>`);
  tax.appendChild(el(`<h3 style="margin-top:0">Two ideas, briefly</h3>`));
  tax.appendChild(el(`<p style="margin-bottom:0.5rem"><strong>Layers</strong> — <em>who</em> connects:</p>`));
  const layers = el(`<ul class="reason-list" style="margin-top:0"></ul>`);
  layers.appendChild(el(`<li><strong>Human to human.</strong> People meeting people, with consent at every step.</li>`));
  layers.appendChild(el(`<li><strong>Human to a vetted benevolent AI.</strong> AI participants are always labeled, and their operators attest to a benevolence checklist.</li>`));
  layers.appendChild(el(`<li><strong>Vetted AI to vetted AI.</strong> A future protocol — not built yet.</li>`));
  tax.appendChild(layers);
  tax.appendChild(el(`<p style="margin-bottom:0.5rem"><strong>Modes</strong> — <em>how</em> a connection is found:</p>`));
  const modes = el(`<ul class="reason-list" style="margin-top:0;margin-bottom:0"></ul>`);
  modes.appendChild(el(`<li><strong>Data.</strong> Matching on shared practice, intention, and needs, with clear reasons.</li>`));
  modes.appendChild(el(`<li><strong>Synchronicity.</strong> A word or theme you both carried this week becomes a conversation starter.</li>`));
  modes.appendChild(el(`<li><strong>Human.</strong> A person — not an algorithm — thoughtfully makes the introduction.</li>`));
  tax.appendChild(modes);
  content.appendChild(tax);

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

  // 8 — Human connector: a real host reads the request and suggests someone.
  const m8 = modeCard('☺', 'Human connector', 'Ask a person, not an algorithm, to help.');
  const hc = el(`<div style="margin-top:0.9rem"></div>`);
  m8.appendChild(hc);
  grid.appendChild(m8);
  await renderHumanConnector(hc, banner);

  // 9 — Synchronicity: carry a word for the week and see who else carries it.
  const m9 = modeCard('◐', 'Synchronicity', 'Carry a word that has been recurring for you this week. If someone else carries the same word, you will both be offered an introduction. Nothing is claimed about why.');
  const sc = el(`<div style="margin-top:0.9rem"></div>`);
  m9.appendChild(sc);
  grid.appendChild(m9);
  await renderSynchronicity(sc, banner);
}

/**
 * The Synchronicity card body. Two paths: "Name your own" (free text,
 * 1-60 chars) or "Draw from the deck" (curated cards, one redraw per
 * draw session). Shows the active beacon with its expiry and a withdraw
 * option; match proposals arrive as introductions in the Requests view.
 */
async function renderSynchronicity(sc, banner) {
  sc.innerHTML = '';
  sc.appendChild(loading('Checking your beacon…'));

  let beacons = [];
  let matches = [];
  try {
    const [bRes, mRes] = await Promise.all([api.myBeacons(), api.mySyncMatches()]);
    beacons = bRes.beacons || [];
    matches = mRes.matches || [];
  } catch (e) {
    sc.innerHTML = '';
    sc.appendChild(el(`<p class="field-hint">Could not load your beacon. Please try again later.</p>`));
    return;
  }
  sc.innerHTML = '';

  const active = beacons.find((b) => b.status === 'active');
  const proposed = matches.filter((m) => m.status === 'proposed' && m.introduction);
  if (proposed.length) {
    const box = el(`<div class="card" style="padding:1rem 1.1rem;margin-bottom:1rem;background:var(--card-tint,#1c1a24)"></div>`);
    box.appendChild(el(`<h4 style="margin:0 0 0.5rem">Someone noticed the same thing</h4>`));
    for (const m of proposed) {
      const row = el(`<div style="margin-bottom:0.6rem"></div>`);
      row.appendChild(el(`<p style="margin:0 0 0.4rem;font-size:0.92rem">You both carried '${esc(m.sharedWord)}' this week.</p>`));
      const viewBtn = el(`<button type="button" class="btn btn-secondary btn-small">View in Requests</button>`);
      viewBtn.addEventListener('click', () => navigate('#/requests'));
      row.appendChild(viewBtn);
      box.appendChild(row);
    }
    sc.appendChild(box);
  }

  if (active) {
    renderActiveBeacon(sc, banner, active);
    return;
  }

  // No active beacon: gentle close-out of the most recent expired one.
  const lastExpired = beacons.find((b) => b.status === 'expired');
  if (lastExpired) {
    const note = el(`<p style="margin:0 0 1rem;font-size:0.92rem;color:var(--mist)">No one else carried '${esc(lastExpired.text)}' that week. That is normal, and the noticing was still yours.</p>`);
    sc.appendChild(note);
    const renewBtn = actionButton(`Carry '${lastExpired.text}' another week`, async () => {
      renewBtn.disabled = true;
      try {
        const res = await api.createBeacon({ source: 'self_input', text: lastExpired.text });
        toast(matchToast(res));
        await renderSynchronicity(sc, banner);
      } catch (e) { banner.show(api.friendlyError(e)); }
      finally { renewBtn.disabled = false; }
    }, true);
    sc.appendChild(renewBtn);
    sc.appendChild(el(`<p class="field-hint" style="margin:0.75rem 0">Or start fresh:</p>`));
  } else {
    sc.appendChild(el(`<p style="margin:0 0 1rem;font-size:0.92rem;color:var(--mist)">Many weeks, nothing lines up. That is part of it. The ritual is yours either way.</p>`));
  }

  renderBeaconPaths(sc, banner, null);
}

function matchToast(res) {
  if (res && res.match) {
    return `Someone else is carrying '${res.match.sharedWord}' too. A proposal is waiting in Requests.`;
  }
  return 'Got it. We will quietly watch for someone else carrying the same.';
}

function intentionSelect() {
  const wrap = el(`<div style="margin-top:0.75rem"></div>`);
  wrap.appendChild(el(`<label class="field-label" for="sync-intention">What kind of connection are you open to? (optional)</label>`));
  const sel = el(`<select id="sync-intention" class="input" style="width:100%"></select>`);
  const opts = [
    ['open', 'Open to whatever feels right'],
    ['conversation', 'Conversation'],
    ['practice_partner', 'Practice partner'],
    ['collaborator', 'Collaborator'],
    ['local_connection', 'Local connection'],
  ];
  for (const [value, label] of opts) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    sel.appendChild(o);
  }
  wrap.appendChild(sel);
  return { wrap, sel };
}

function renderActiveBeacon(sc, banner, active) {
  const until = new Date(active.expiresAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  sc.appendChild(el(`<p style="margin:0 0 0.4rem;font-size:0.95rem">You are carrying <strong>'${esc(active.text)}'</strong> this week.</p>`));
  sc.appendChild(el(`<p class="field-hint" style="margin:0 0 0.9rem">Carried until ${esc(until)}. If someone else carries the same word, you will both see a proposal in Requests.</p>`));
  const withdrawBtn = actionButton('Withdraw beacon', async () => {
    const ok = await confirmDialog({
      title: 'Withdraw your beacon?',
      body: 'Your beacon will be withdrawn. No one will be notified, and you can carry a new one any time.',
      confirmLabel: 'Withdraw beacon',
    });
    if (!ok) return;
    withdrawBtn.disabled = true;
    try {
      await api.withdrawMyBeacon();
      toast('Beacon withdrawn.');
      announce('Beacon withdrawn.');
      await renderSynchronicity(sc, banner);
    } catch (e) { banner.show(api.friendlyError(e)); }
    finally { withdrawBtn.disabled = false; }
  }, true);
  sc.appendChild(withdrawBtn);
}

function renderBeaconPaths(sc, banner, presetText) {
  const { wrap: intWrap, sel: intSel } = intentionSelect();
  const intentionType = () => (intSel.value === 'open' ? 'open' : intSel.value);

  // Path 1: name your own.
  const h1 = el(`<h4 style="margin:0 0 0.35rem">Name your own</h4>`);
  sc.appendChild(h1);
  sc.appendChild(el(`<p class="field-hint" style="margin:0 0 0.5rem">What has been recurring for you lately? A word, image, place, dream, or theme. One to three words is perfect.</p>`));
  const input = el(`<input type="text" class="input" maxlength="60" style="width:100%" placeholder="e.g. river" aria-label="Your beacon word">`);
  if (presetText) input.value = presetText;
  sc.appendChild(input);
  sc.appendChild(intWrap);
  const carryBtn = actionButton('Carry this word', async () => {
    const text = input.value.trim();
    if (!text) { banner.show('Please enter a word, or draw one from the deck.'); input.focus(); return; }
    carryBtn.disabled = true;
    try {
      const res = await api.createBeacon({ source: 'self_input', text, intentionType: intentionType() });
      toast(matchToast(res));
      announce('Beacon created.');
      await renderSynchronicity(sc, banner);
    } catch (e) { banner.show(api.friendlyError(e)); }
    finally { carryBtn.disabled = false; }
  });
  sc.appendChild(carryBtn);

  sc.appendChild(el(`<p class="field-hint" style="margin:1rem 0 0.35rem">Or, if nothing comes to mind:</p>`));

  // Path 2: draw from the deck. One redraw per draw session (UI-enforced);
  // no beacon exists until the member accepts a card.
  const h2 = el(`<h4 style="margin:0 0 0.35rem">Draw from the deck</h4>`);
  sc.appendChild(h2);
  const drawArea = el(`<div></div>`);
  sc.appendChild(drawArea);
  let deck = null;
  let redrawsUsed = 0;
  let drawnCard = null;

  const drawBtn = actionButton('Draw a card', async () => {
    drawBtn.disabled = true;
    try {
      if (!deck) deck = (await api.getSyncDeck()).cards || [];
      if (!deck.length) { banner.show('The deck is unavailable right now. Please try again later.'); return; }
      drawArea.innerHTML = '';
      drawArea.appendChild(el(`<p class="field-hint" style="margin:0.75rem 0">Shuffling the deck…</p>`));
      // A calm pause, not a slot machine.
      await new Promise((r) => setTimeout(r, 900));
      drawnCard = deck[Math.floor(Math.random() * deck.length)];
      showReveal();
    } catch (e) { banner.show(api.friendlyError(e)); }
    finally { drawBtn.disabled = false; }
  }, true);
  sc.appendChild(drawBtn);

  function showReveal() {
    drawArea.innerHTML = '';
    drawArea.appendChild(el(`<p class="field-hint" style="margin:0.75rem 0 0.25rem">Here is what came up.</p>`));
    drawArea.appendChild(el(`<p style="font-size:1.5rem;margin:0.25rem 0 0.35rem"><strong>'${esc(drawnCard.word)}'</strong></p>`));
    drawArea.appendChild(el(`<p style="margin:0 0 0.9rem;font-size:0.92rem;color:var(--mist)">${esc(drawnCard.prompt)}</p>`));
    const row = el(`<div class="btn-row" style="margin-top:0"></div>`);
    const acceptBtn = el(`<button type="button" class="btn btn-primary btn-small">Carry this</button>`);
    acceptBtn.addEventListener('click', async () => {
      acceptBtn.disabled = true;
      try {
        const res = await api.createBeacon({ source: 'deck_draw', cardId: drawnCard.id, intentionType: intentionType() });
        toast(matchToast(res));
        announce('Beacon created.');
        await renderSynchronicity(sc, banner);
      } catch (e) { banner.show(api.friendlyError(e)); }
      finally { acceptBtn.disabled = false; }
    });
    row.appendChild(acceptBtn);
    if (redrawsUsed < 1) {
      const redrawBtn = el(`<button type="button" class="btn btn-secondary btn-small">Redraw once</button>`);
      redrawBtn.addEventListener('click', () => {
        redrawsUsed += 1;
        drawnCard = deck[Math.floor(Math.random() * deck.length)];
        showReveal();
      });
      row.appendChild(redrawBtn);
    }
    const ownBtn = el(`<button type="button" class="btn btn-ghost btn-small">Use my own instead</button>`);
    ownBtn.addEventListener('click', () => { drawArea.innerHTML = ''; input.focus(); });
    row.appendChild(ownBtn);
    drawArea.appendChild(row);
  }
}

/** The Human connector card body: request form, or the open request + withdraw. */
async function renderHumanConnector(hc, banner) {
  hc.innerHTML = '';
  hc.appendChild(loading('Checking your requests…'));
  let assists = [];
  try {
    const res = await api.listMyHostAssists();
    assists = res.assists || [];
  } catch (e) {
    hc.innerHTML = '';
    hc.appendChild(el(`<p class="field-hint">Could not load your request status. Please try again later.</p>`));
    return;
  }
  hc.innerHTML = '';

  const open = assists.find((a) => a.status === 'open');
  if (open) {
    hc.appendChild(el(`<p style="margin:0 0 0.6rem;font-size:0.92rem;color:var(--mist)">Your request is with a host. They will read it and, if someone thoughtful comes to mind, suggest an introduction. Both people still choose whether to connect.</p>`));
    hc.appendChild(el(`<div style="border-left:3px solid var(--mist-dim);padding:0.25rem 0.8rem;margin-bottom:0.9rem;font-size:0.92rem">${esc(open.requestText)}</div>`));
    const withdrawBtn = actionButton('Withdraw request', async () => {
      const ok = await confirmDialog({
        title: 'Withdraw your request?',
        body: 'The host will no longer see your request. You can ask again any time.',
        confirmLabel: 'Withdraw request',
      });
      if (!ok) return;
      withdrawBtn.disabled = true;
      try {
        await api.withdrawHostAssist(open.id);
        toast('Request withdrawn.');
        announce('Request withdrawn.');
        await renderHumanConnector(hc, banner);
      } catch (e) {
        banner.show(api.friendlyError(e));
      } finally {
        withdrawBtn.disabled = false;
      }
    }, true);
    hc.appendChild(withdrawBtn);
    return;
  }

  hc.appendChild(el(`<p style="margin:0 0 0.6rem;font-size:0.92rem;color:var(--mist)">Write what kind of connection would feel meaningful right now, and a few words on why. A real host reads your request and suggests someone if a good fit comes to mind. No algorithms, no promises. Both people still choose.</p>`));
  const ta = el(`<textarea class="input" rows="4" maxlength="1000" style="width:100%" placeholder="What kind of connection would feel meaningful right now, and why?"></textarea>`);
  ta.setAttribute('aria-label', 'What kind of connection would feel meaningful right now, and why?');
  hc.appendChild(ta);
  hc.appendChild(el(`<p class="field-hint" style="margin:0.35rem 0 0.75rem">Up to 1000 characters. A person reads this, not software.</p>`));
  const sendBtn = actionButton('Ask a host', async () => {
    const text = ta.value.trim();
    if (!text) {
      banner.show('Please write a little about what kind of connection you are hoping for.');
      ta.focus();
      return;
    }
    sendBtn.disabled = true;
    try {
      await api.createHostAssist({ requestText: text });
      toast('Your request is with a host. Take your time.');
      announce('Request sent to a host.');
      await renderHumanConnector(hc, banner);
    } catch (e) {
      banner.show(api.friendlyError(e));
    } finally {
      sendBtn.disabled = false;
    }
  });
  hc.appendChild(sendBtn);
}
