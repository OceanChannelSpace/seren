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
  if (!reports.length) {
    content.appendChild(emptyState({
      title: 'No reports',
      body: 'Nothing waiting for review. The queue is clear.',
    }));
    return;
  }
  content.appendChild(el(`<p class="field-hint" style="margin-top:0">${reports.length} report${reports.length === 1 ? '' : 's'} total.</p>`));
  for (const r of reports) content.appendChild(reportCard(r));
}
