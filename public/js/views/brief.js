// Connection brief review — what SEREN understood, in the user's control.
// The user edits every field, approves two separate consents, and only then
// becomes visible for matching. Nothing is ever shown to another profile
// except the approved shared_text — never private_notes, never drafts.

import * as api from '../api.js';
import { get, set } from '../state.js';
import { proposalCard } from './home.js';
import {
  esc, el, pageShell, errorBanner, infoBanner, loading, emptyState, card,
  field, textArea, toast, announce, confirmDialog, friendlyError,
} from '../ui.js';
import { navigate } from '../router.js';

const MAX_SHARED = 600;

const FIELDS = [
  { key: 'who_text', label: 'Who you are', hint: 'A sentence or two — however you want to be known.', rows: 3 },
  { key: 'intention_text', label: 'Your present intention', hint: 'The meaningful connection you want right now, and why.', rows: 4 },
  { key: 'good_fit_text', label: 'Who might be a good fit, and why', hint: 'The kind of person SEREN should look for — not a specific individual.', rows: 4 },
  { key: 'offer_text', label: 'What you can offer', hint: 'What would make this worthwhile for the other person too?', rows: 3 },
  { key: 'logistics_text', label: 'Location, format, timing', hint: 'Local or remote, how you like to meet, and when you’re generally free.', rows: 3 },
  { key: 'boundaries_text', label: 'Boundaries', hint: 'Anything SEREN should respect when introducing you.', rows: 3 },
];

/** Status pill for brief statuses. Exported for me.js. */
export function briefPill(status) {
  const tone = status === 'active' ? 'good' : status === 'paused' ? 'pending' : 'muted';
  const label = status === 'active' ? 'Active'
    : status === 'paused' ? 'Paused'
    : status === 'withdrawn' ? 'Withdrawn' : 'Draft';
  return el(`<span class="pill pill-${tone}">${esc(label)}</span>`);
}

export async function renderBrief(root, ctx) {
  root.innerHTML = '';
  const shell = pageShell('Your connection brief', 'Review & approve');
  shell.root.classList.add('page-narrow');
  const banner = errorBanner();
  shell.body.appendChild(banner.node);
  root.appendChild(shell.root);

  shell.body.appendChild(loading('Reading your brief…'));

  let brief = null;
  try {
    brief = (await api.getMyBrief()).brief || null;
  } catch (e) {
    shell.body.innerHTML = '';
    banner.show(friendlyError(e));
    shell.body.appendChild(banner.node);
    return;
  }
  set({ brief });
  shell.body.innerHTML = '';
  shell.body.appendChild(banner.node);

  if (!brief) {
    shell.body.appendChild(emptyState({
      title: 'No connection brief yet.',
      body: 'Tell SEREN what would feel meaningful and it will draft a brief you can review before anything is shared.',
      actionLabel: 'Start a guided conversation',
      actionHref: '#/',
    }));
    return;
  }

  const intro = el(`<div></div>`);
  intro.appendChild(el(`<p class="kicker">Review before it goes anywhere</p>`));
  intro.appendChild(el(`<p class="about-text">Here is what SEREN understood from your conversation. Edit anything — wording, emphasis, tone — until it sounds like you. <strong>Nothing here is shared with anyone until you approve it.</strong></p>`));
  const headRow = el(`<div style="display:flex;align-items:center;gap:0.75rem;margin:0.5rem 0 0"></div>`);
  headRow.appendChild(briefPill(brief.status));
  intro.appendChild(headRow);
  shell.body.appendChild(intro);

  // --- paused notice ---
  if (brief.status === 'paused') {
    const notice = infoBanner();
    shell.body.appendChild(notice.node);
    notice.show('Discovery is paused — SEREN isn’t looking for matches right now. Resume any time; your brief stays saved.');
    const resumeRow = el(`<div class="btn-row"></div>`);
    const resumeBtn = el(`<button type="button" class="btn btn-primary">Resume discovery</button>`);
    resumeBtn.addEventListener('click', () => doResume(resumeBtn));
    resumeRow.appendChild(resumeBtn);
    shell.body.appendChild(resumeRow);
  }

  // --- withdrawn notice ---
  if (brief.status === 'withdrawn') {
    const notice = infoBanner();
    shell.body.appendChild(notice.node);
    notice.show('This brief is withdrawn — it’s removed from matching and stays private to you.');
    const row = el(`<div class="btn-row"></div>`);
    const fresh = el(`<button type="button" class="btn btn-primary">Start a new brief</button>`);
    fresh.addEventListener('click', () => { set({ brief: null }); navigate('#/'); });
    row.appendChild(fresh);
    shell.body.appendChild(row);
    announce('Brief withdrawn.');
    return;
  }

  // --- editable fields ---
  const form = card();
  const inputs = {};
  for (const f of FIELDS) {
    const ta = textArea({ id: `brief-${f.key}`, value: brief[f.key] || '', rows: f.rows, maxLength: 1000 });
    inputs[f.key] = ta;
    form.appendChild(field(f.label, ta, { id: `brief-${f.key}`, hint: f.hint }));
  }
  const privTa = textArea({
    id: 'brief-private_notes', value: brief.private_notes || '', rows: 3, maxLength: 1000,
    placeholder: 'Things you want SEREN to keep in mind — never shared.',
  });
  inputs.private_notes = privTa;
  form.appendChild(field('Private — do not share', privTa, {
    id: 'brief-private_notes',
    hint: 'Only you and SEREN ever see this. It is never shown to another person.',
  }));
  shell.body.appendChild(form);

  // --- the two consents ---
  const consentCard = card();
  consentCard.appendChild(el(`<h3 style="margin-top:0">Your approval, in two parts</h3>`));

  const c1 = el(`<div class="consent-row"></div>`);
  const saveChk = el(`<input type="checkbox" class="consent-check" id="brief-consent-save"${brief.consent_save ? ' checked' : ''}>`);
  c1.appendChild(saveChk);
  c1.appendChild(el(`<label class="consent-label" for="brief-consent-save">Save this brief so SEREN can look for matching people for me.</label>`));
  consentCard.appendChild(c1);

  const c2 = el(`<div class="consent-row"></div>`);
  const shareChk = el(`<input type="checkbox" class="consent-check" id="brief-consent-share"${brief.consent_share ? ' checked' : ''}>`);
  c2.appendChild(shareChk);
  const c2body = el(`<div style="flex:1"></div>`);
  c2body.appendChild(el(`<label class="consent-label" for="brief-consent-share">It’s OK to show this exact text to another person when I request an introduction:</label>`));
  const sharedTa = textArea({
    id: 'brief-shared_text', value: brief.shared_text || '', rows: 4, maxLength: MAX_SHARED,
    placeholder: 'The exact words another person would read about you — in your voice.',
  });
  inputs.shared_text = sharedTa;
  c2body.appendChild(sharedTa);
  const countLine = el(`<p class="char-count" aria-live="polite"></p>`);
  const paintCount = () => { countLine.textContent = `${sharedTa.value.length} / ${MAX_SHARED}`; };
  sharedTa.addEventListener('input', paintCount);
  paintCount();
  c2body.appendChild(countLine);
  c2body.appendChild(el(`<p class="field-hint">Only this exact text — and your name — may ever be shown to another person. Everything else stays private.</p>`));
  c2.appendChild(c2body);
  consentCard.appendChild(c2);
  shell.body.appendChild(consentCard);

  // --- actions ---
  const btnRow = el(`<div class="btn-row"></div>`);
  const findBtn = el(`<button type="button" class="btn btn-primary">Find matches</button>`);
  const saveBtn = el(`<button type="button" class="btn btn-secondary">Save draft</button>`);
  const pauseBtn = el(`<button type="button" class="btn btn-ghost">${brief.status === 'paused' ? 'Resume' : 'Pause discovery'}</button>`);
  const withdrawBtn = el(`<button type="button" class="btn btn-ghost">Withdraw brief</button>`);
  btnRow.append(findBtn, saveBtn, pauseBtn, withdrawBtn);
  shell.body.appendChild(btnRow);

  findBtn.addEventListener('click', () => doApprove());
  saveBtn.addEventListener('click', () => doSave());
  pauseBtn.addEventListener('click', () => (brief.status === 'paused' ? doResume(pauseBtn) : doPause()));
  withdrawBtn.addEventListener('click', doWithdraw);

  // --- proposals appear here after approval ---
  const propSlot = el(`<div class="guide-pane" aria-live="polite"></div>`);
  shell.body.appendChild(propSlot);

  function collect() {
    const patch = {};
    for (const f of FIELDS) patch[f.key] = inputs[f.key].value.trim();
    patch.private_notes = inputs.private_notes.value.trim();
    patch.shared_text = inputs.shared_text.value.trim();
    return patch;
  }

  function setBusy(busy) {
    for (const b of [findBtn, saveBtn, pauseBtn, withdrawBtn]) b.disabled = busy;
  }

  async function doSave() {
    banner.clear();
    setBusy(true);
    try {
      brief = (await api.updateBrief(brief.id, collect())).brief;
      set({ brief });
      toast('Draft saved. Nothing is shared yet.');
      announce('Draft saved.');
    } catch (e) {
      banner.show(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function doApprove() {
    banner.clear();
    if (!saveChk.checked) {
      banner.show('Please check the first box so SEREN may save this brief and look for matches.');
      saveChk.focus();
      return;
    }
    const shared = inputs.shared_text.value.trim();
    if (shared.length < 1 || shared.length > MAX_SHARED) {
      banner.show(`Write the exact text (up to ${MAX_SHARED} characters) another person may see.`);
      inputs.shared_text.focus();
      return;
    }
    setBusy(true);
    findBtn.textContent = 'Saving…';
    try {
      brief = (await api.updateBrief(brief.id, collect())).brief;
      brief = (await api.approveBrief(brief.id, {
        shared_text: shared,
        consent_save: true,
        consent_share: shareChk.checked,
      })).brief;
      set({ brief });
      toast('Brief approved. Looking for gentle fits…');
      announce('Brief approved. Loading suggestions.');
      await loadProposals();
    } catch (e) {
      banner.show(friendlyError(e));
    } finally {
      setBusy(false);
      findBtn.textContent = 'Find matches';
    }
  }

  async function doPause() {
    const ok = await confirmDialog({
      title: 'Pause discovery?',
      body: 'SEREN will stop looking for matches. Your brief stays saved — you can resume any time.',
      confirmLabel: 'Pause',
    });
    if (!ok) return;
    setBusy(true);
    try {
      brief = (await api.pauseBrief(brief.id)).brief;
      set({ brief });
      toast('Discovery paused.');
      renderBrief(root, ctx); // refresh for the paused notice
    } catch (e) {
      banner.show(friendlyError(e));
      setBusy(false);
    }
  }

  async function doResume(btn) {
    btn.disabled = true;
    try {
      brief = (await api.resumeBrief(brief.id)).brief;
      set({ brief });
      toast('Discovery resumed.');
      renderBrief(root, ctx);
    } catch (e) {
      banner.show(friendlyError(e));
      btn.disabled = false;
    }
  }

  async function doWithdraw() {
    const ok = await confirmDialog({
      title: 'Withdraw your brief?',
      body: 'This removes the brief from matching. It stays private to you, and you can start a new one any time.',
      confirmLabel: 'Withdraw brief',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      brief = (await api.withdrawBrief(brief.id)).brief;
      set({ brief });
      renderBrief(root, ctx);
    } catch (e) {
      banner.show(friendlyError(e));
      setBusy(false);
    }
  }

  async function loadProposals() {
    propSlot.innerHTML = '';
    const sessionId = get('guideSessionId');
    if (!sessionId) {
      propSlot.appendChild(emptyState({
        title: 'Your brief is saved.',
        body: 'To see suggestions for this brief, start a guided conversation — SEREN looks for fits from what you share there.',
        actionLabel: 'Start a guided conversation',
        actionHref: '#/',
      }));
      return;
    }
    propSlot.appendChild(loading('Looking thoughtfully…'));
    try {
      const { proposals } = await api.getProposals(sessionId);
      propSlot.innerHTML = '';
      const head = card();
      head.appendChild(el(`<p class="kicker">Thoughtful introductions</p>`));
      head.appendChild(el(`<h3 style="margin:0.5rem 0">Here is what SEREN noticed</h3>`));
      head.appendChild(el(`<p class="about-text">These are gentle suggestions, not certainties. Request an introduction only if it feels genuinely aligned — both people opt in before anything is shared.</p>`));
      propSlot.appendChild(head);
      const list = (proposals || []).slice(0, 3);
      if (!list.length) {
        const calm = emptyState({
          title: 'We’re looking.',
          body: 'Nothing credible surfaced right now — that’s honest, not a failure. Your brief stays saved; SEREN will look again as the community grows.',
        });
        propSlot.appendChild(calm);
        const again = el(`<p class="guide-secondary">Take your time — <a href="#/">describe it differently</a>, or <a href="#/discover">browse quietly</a>.</p>`);
        propSlot.appendChild(again);
      }
      for (const p of list) propSlot.appendChild(proposalCard(p, brief.id));
      propSlot.scrollIntoView({ behavior: 'smooth', block: 'start' });
      announce(list.length ? `${list.length} introduction suggestions.` : 'No suggestions this time.');
    } catch (e) {
      propSlot.innerHTML = '';
      if (e.status === 403) {
        const notice = infoBanner();
        propSlot.appendChild(notice.node);
        notice.show('Your brief isn’t active for matching right now — review it above and approve it to see suggestions.');
      } else {
        const notice = errorBanner();
        propSlot.appendChild(notice.node);
        notice.show(friendlyError(e));
      }
    }
  }

  announce('Review your connection brief.');
}
