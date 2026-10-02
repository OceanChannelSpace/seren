// Moderation — host-only report triage queue.
// Lists member reports; the host can dismiss a report or hide the reported
// profile (removing them from discovery). All enforcement is server-side via
// requireHost; this view is additionally gated by the router.

import * as api from '../api.js';
import {
  el, esc, pageShell, errorBanner, loading, emptyState,
  confirmDialog, toast, timeAgo, statusPill,
} from '../ui.js';
import { get } from '../state.js';
import { navigate } from '../router.js';

function reportCard(r) {
  const c = el(`<div class="card" style="margin-bottom:1rem"></div>`);
  const header = el(`<div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem"></div>`);
  header.appendChild(el(`<h3 style="margin:0">${esc(r.reason || 'Report')}</h3>`));
  header.appendChild(statusPill(r.status || 'open'));
  c.appendChild(header);
  c.appendChild(el(`<p class="person-sub">${esc(r.reporterName || `Member ${r.reporterId}`)} reported ${esc(r.reportedName || `Member ${r.reportedId}`)} · ${esc(timeAgo(r.createdAt))}</p>`));
  if (r.details) c.appendChild(el(`<p>${esc(r.details)}</p>`));

  const row = el(`<div class="btn-row" style="margin-top:0.75rem"></div>`);
  if ((r.status || 'open') === 'open') {
    const dismissBtn = el(`<button type="button" class="btn btn-secondary btn-small">Dismiss</button>`);
    dismissBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Dismiss this report?',
        body: 'The report will be marked dismissed. The reported profile stays visible.',
        confirmLabel: 'Dismiss report',
      });
      if (!ok) return;
      dismissBtn.disabled = true;
      try {
        await api.dismissReport(r.id);
        toast('Report dismissed.');
        navigate('#/moderation');
      } catch (e) {
        dismissBtn.disabled = false;
        toast('Could not dismiss the report. Please try again.', 'error');
      }
    });
    const hideBtn = el(`<button type="button" class="btn btn-small" style="background:var(--danger,#a33);color:#fff">Hide profile</button>`);
    hideBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Hide this profile?',
        body: `${r.reportedName || 'This member'} will be removed from discovery and member views until a host restores them. Use this for clear safety concerns.`,
        confirmLabel: 'Hide profile',
        danger: true,
      });
      if (!ok) return;
      hideBtn.disabled = true;
      try {
        await api.hideReportedProfile(r.id);
        toast('Profile hidden and report actioned.');
        navigate('#/moderation');
      } catch (e) {
        hideBtn.disabled = false;
        toast('Could not hide the profile. Please try again.', 'error');
      }
    });
    row.appendChild(dismissBtn);
    row.appendChild(hideBtn);
  } else {
    row.appendChild(el(`<p class="field-hint" style="margin:0">Handled (${esc(r.status)}).</p>`));
  }
  c.appendChild(row);
  return c;
}

export async function renderModeration(root) {
  const { root: shell, body } = pageShell('Moderation', 'Host report queue');
  root.appendChild(shell);
  const banner = errorBanner();
  body.appendChild(banner.node);
  const content = el(`<div></div>`);
  body.appendChild(content);
  content.appendChild(loading('Loading reports…'));

  if (get('isHost') !== true) {
    content.innerHTML = '';
    content.appendChild(emptyState({
      title: 'Host access required',
      body: 'The moderation queue is only visible to SEREN hosts.',
      actionLabel: 'Back home',
      actionHref: '#/',
    }));
    return;
  }

  let reports = [];
  try {
    const res = await api.listReports();
    reports = res.reports || [];
  } catch (e) {
    content.innerHTML = '';
    banner.show('Could not load reports. Please try again.');
    return;
  }
  content.innerHTML = '';
  content.appendChild(el(`<h2 style="margin:0 0 0.5rem">Reports</h2>`));
  if (!reports.length) {
    content.appendChild(emptyState({
      title: 'No reports',
      body: 'Nothing waiting for review. The queue is clear.',
    }));
  } else {
    content.appendChild(el(`<p class="field-hint" style="margin-top:0">${reports.length} report${reports.length === 1 ? '' : 's'} total.</p>`));
    for (const r of reports) content.appendChild(reportCard(r));
  }

  // --- Assist requests (Human Mode) ---
  content.appendChild(el(`<h2 style="margin:2rem 0 0.5rem">Assist requests</h2>`));
  content.appendChild(el(`<p class="field-hint" style="margin-top:0">Members who asked a person, not an algorithm, for help. Suggest someone thoughtful; the introduction then follows normal mutual consent, and both members still choose.</p>`));
  const assistWrap = el(`<div></div>`);
  content.appendChild(assistWrap);
  await renderAssistRequests(assistWrap);
}

function assistCard(a, candidates) {
  const c = el(`<div class="card" style="margin-bottom:1rem"></div>`);
  c.appendChild(el(`<h3 style="margin:0">${esc(a.askerName || `Member ${a.profileId}`)}</h3>`));
  c.appendChild(el(`<p class="person-sub">${esc(timeAgo(a.createdAt))}</p>`));
  c.appendChild(el(`<div style="border-left:3px solid var(--mist-dim);padding:0.25rem 0.8rem;margin-bottom:0.9rem">${esc(a.requestText)}</div>`));

  const picker = el(`<select class="input" style="width:100%;margin-bottom:0.6rem" aria-label="Suggested member"></select>`);
  picker.appendChild(el(`<option value="">Choose a member to suggest…</option>`));
  for (const m of candidates) {
    const opt = el(`<option value="${Number(m.id)}">${esc(m.name)}</option>`);
    picker.appendChild(opt);
  }
  c.appendChild(picker);

  const note = el(`<textarea class="input" rows="2" maxlength="500" style="width:100%;margin-bottom:0.6rem" placeholder="Optional note, shown to both members with the introduction"></textarea>`);
  note.setAttribute('aria-label', 'Optional host note');
  c.appendChild(note);

  const row = el(`<div class="btn-row" style="margin-top:0.25rem"></div>`);
  const proposeBtn = el(`<button type="button" class="btn btn-primary btn-small">Propose introduction</button>`);
  proposeBtn.addEventListener('click', async () => {
    const suggestedId = Number(picker.value);
    if (!suggestedId) { toast('Choose a member to suggest first.'); picker.focus(); return; }
    const chosen = candidates.find((m) => m.id === suggestedId);
    const ok = await confirmDialog({
      title: 'Propose this introduction?',
      body: `${a.askerName || 'The member'} and ${chosen ? chosen.name : 'the suggested member'} will each be asked in the normal way. Either can decline, just like any other request. This is a thoughtful human suggestion, not a certain match.`,
      confirmLabel: 'Propose introduction',
    });
    if (!ok) return;
    proposeBtn.disabled = true;
    try {
      const noteText = note.value.trim();
      await api.proposeHostAssist(a.id, { suggestedId, hostNote: noteText || undefined });
      toast('Introduction proposed. Both members choose as usual.');
      navigate('#/moderation');
    } catch (e) {
      proposeBtn.disabled = false;
      toast(api.friendlyError(e), 'error');
    }
  });
  row.appendChild(proposeBtn);
  c.appendChild(row);
  return c;
}

/** Host queue of open assist requests, each with a member picker + propose. */
async function renderAssistRequests(wrap) {
  wrap.innerHTML = '';
  wrap.appendChild(loading('Loading assist requests…'));
  let assists = [];
  let members = [];
  try {
    const [a, m] = await Promise.all([api.listHostAssists(), api.listProfiles()]);
    assists = a.assists || [];
    // Discoverable members only: skip minimal (hidden/paused/undiscoverable) views.
    members = (m.profiles || []).filter((p) => p && !p.hidden);
  } catch (e) {
    wrap.innerHTML = '';
    wrap.appendChild(el(`<p class="field-hint">Could not load assist requests. Please try again later.</p>`));
    return;
  }
  wrap.innerHTML = '';
  if (!assists.length) {
    wrap.appendChild(el(`<p class="field-hint">No open requests. Nothing waiting for a human touch.</p>`));
    return;
  }
  for (const a of assists) {
    const candidates = members.filter((m) => m.id !== a.profileId);
    wrap.appendChild(assistCard(a, candidates));
  }
}
