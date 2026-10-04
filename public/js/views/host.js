// Host dashboard — facilitator stewardship for circles, gatherings, and
// events. Host-gated by the router like #/moderation. Sections:
//   1. Pending circle join requests (aggregated across circles the host can
//      see; approve/decline only where the host is the circle creator — the
//      server enforces this too).
//   2. Member safety notes — recent reports surfaced as entry points, with
//      actions living in #/moderation.
//   3. Event safety checklist — the standard every SEREN gathering is held to.
// Links to #/moderation and #/analytics. Follows moderation.js patterns.

import * as api from '../api.js';
import {
  el, esc, pageShell, errorBanner, loading, emptyState, card,
  confirmDialog, toast, timeAgo,
} from '../ui.js';
import { get } from '../state.js';
import { navigate } from '../router.js';

function requestRow(req, circleName, canDecide, onDone) {
  const c = el(`<div class="card" style="margin-bottom:1rem"></div>`);
  c.appendChild(el(`<h3 style="margin:0">${esc(req.profileName || `Member ${req.profileId}`)}</h3>`));
  c.appendChild(el(`<p class="person-sub">Wants to join “${esc(circleName)}” · ${esc(timeAgo(req.createdAt))}</p>`));
  if (req.message) {
    c.appendChild(el(`<div style="border-left:3px solid var(--mist-dim);padding:0.25rem 0.8rem;margin-bottom:0.9rem;font-style:italic">${esc(req.message)}</div>`));
  }
  if (canDecide) {
    const row = el(`<div class="btn-row" style="margin-top:0.5rem"></div>`);
    const approve = el(`<button type="button" class="btn btn-primary btn-small">Welcome in</button>`);
    approve.addEventListener('click', async () => {
      approve.disabled = true;
      try {
        await api.approveCircleRequest(req.id, get('profileId'));
        toast(`${req.profileName || 'They'} are in.`);
        onDone();
      } catch (e) {
        toast(api.friendlyError(e), 'error');
        approve.disabled = false;
      }
    });
    const decline = el(`<button type="button" class="btn btn-secondary btn-small">Decline kindly</button>`);
    decline.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Decline this request?',
        body: 'The requester is not notified with a reason — a quiet, dignified no. They can request again later.',
        confirmLabel: 'Decline request',
      });
      if (!ok) return;
      decline.disabled = true;
      try {
        await api.declineCircleRequest(req.id, get('profileId'));
        toast('Request declined.');
        onDone();
      } catch (e) {
        toast(api.friendlyError(e), 'error');
        decline.disabled = false;
      }
    });
    row.appendChild(approve);
    row.appendChild(decline);
    c.appendChild(row);
  } else {
    c.appendChild(el(`<p class="field-hint" style="margin:0">The circle’s own host decides on requests — shown here so nothing waits unnoticed.</p>`));
  }
  return c;
}

async function renderPendingRequests(wrap, banner) {
  wrap.innerHTML = '';
  wrap.appendChild(loading('Checking circles…'));
  let circles = [];
  try {
    circles = (await api.listCircles(get('profileId'))).circles || [];
  } catch (e) {
    wrap.innerHTML = '';
    banner.show(api.friendlyError(e));
    return;
  }
  const meId = get('profileId');
  const pending = [];
  for (const c of circles) {
    try {
      const detail = await api.getCircle(c.id, meId);
      for (const r of (detail.pendingRequests || [])) {
        pending.push({ req: r, circleName: detail.circle.name, canDecide: detail.circle.createdBy === meId });
      }
    } catch { /* a circle the host can't see — skip quietly */ }
  }
  wrap.innerHTML = '';
  if (!pending.length) {
    wrap.appendChild(el(`<p class="field-hint">No one waiting. Every request has an answer.</p>`));
    return;
  }
  const reload = () => navigate('#/host');
  for (const p of pending) wrap.appendChild(requestRow(p.req, p.circleName, p.canDecide, reload));
}

async function renderSafetyNotes(wrap, banner) {
  wrap.innerHTML = '';
  wrap.appendChild(loading('Loading safety notes…'));
  let reports = [];
  try {
    reports = (await api.listReports()).reports || [];
  } catch (e) {
    wrap.innerHTML = '';
    wrap.appendChild(el(`<p class="field-hint">Could not load safety notes. Please try again later.</p>`));
    return;
  }
  wrap.innerHTML = '';
  const open = reports.filter((r) => (r.status || 'open') === 'open');
  if (!open.length) {
    wrap.appendChild(el(`<p class="field-hint">Nothing open. The community is holding steady.</p>`));
  } else {
    const list = el(`<ul class="member-list"></ul>`);
    for (const r of open.slice(0, 5)) {
      const li = el(`<li></li>`);
      li.appendChild(el(`<span><strong>${esc(r.reason || 'Report')}</strong> — ${esc(r.reportedName || `Member ${r.reportedId}`)} <span class="field-hint">· ${esc(timeAgo(r.createdAt))}</span></span>`));
      const go = el(`<a class="btn btn-ghost btn-small" style="margin-left:auto" href="#/moderation">Review</a>`);
      li.appendChild(go);
      list.appendChild(li);
    }
    wrap.appendChild(list);
  }
  const row = el(`<div class="btn-row"></div>`);
  row.appendChild(el(`<a class="btn btn-secondary btn-small" href="#/moderation">Open moderation queue</a>`));
  wrap.appendChild(row);
}

function eventSafetyChecklist(body) {
  const c = el(`<div class="card"></div>`);
  c.appendChild(el(`<h3 style="margin-top:0">Event safety checklist</h3>`));
  c.appendChild(el(`<p class="field-hint" style="margin-top:0">The standard every SEREN gathering is held to — display it wherever members gather.</p>`));
  const list = el(`<ul class="reason-list"></ul>`);
  for (const item of [
    'Public, accessible setting — never a private residence for a first gathering.',
    'A named host is present for the whole event, and members know who they are.',
    'Consent is stated out loud at the start: anyone may leave at any time, no explanation needed.',
    'No pressure to share personal, spiritual, or contact details.',
    'A clear way to reach the host afterwards — and the Trust & Safety page linked in every invitation.',
    'After the event, the host checks in: did everyone feel safe? Anything to note for next time?',
  ]) list.appendChild(el(`<li>${esc(item)}</li>`));
  c.appendChild(list);
  body.appendChild(c);
}

export async function renderHost(root) {
  const { root: shell, body } = pageShell('Facilitator', 'Stewardship, held lightly');
  root.appendChild(shell);
  const banner = errorBanner();
  body.appendChild(banner.node);
  const content = el(`<div></div>`);
  body.appendChild(content);

  if (get('isHost') !== true) {
    content.appendChild(emptyState({
      title: 'Host access required',
      body: 'The facilitator dashboard is only visible to SEREN hosts.',
      actionLabel: 'Back home',
      actionHref: '#/',
    }));
    return;
  }

  const intro = el(`<div class="card"></div>`);
  intro.appendChild(el(`<p style="margin:0;max-width:38rem">Hosts hold the space others connect in. That means watching the queues, keeping gatherings safe, and acting with restraint — a hidden profile is a last resort, never a first instinct.</p>`));
  const row = el(`<div class="btn-row"></div>`);
  row.appendChild(el(`<a class="btn btn-secondary btn-small" href="#/moderation">Moderation queue</a>`));
  row.appendChild(el(`<a class="btn btn-secondary btn-small" href="#/analytics">Community flourishing</a>`));
  row.appendChild(el(`<a class="btn btn-ghost btn-small" href="#/trust">Trust & Safety</a>`));
  intro.appendChild(row);
  content.appendChild(intro);

  content.appendChild(el(`<h2 class="section-title">Pending circle requests</h2>`));
  const reqWrap = el(`<div></div>`);
  content.appendChild(reqWrap);
  await renderPendingRequests(reqWrap, banner);

  content.appendChild(el(`<h2 class="section-title">Member safety notes</h2>`));
  content.appendChild(el(`<p class="section-note">Open reports, as entry points. Review and action happen in the moderation queue.</p>`));
  const safetyWrap = el(`<div></div>`);
  content.appendChild(safetyWrap);
  await renderSafetyNotes(safetyWrap, banner);

  content.appendChild(el(`<h2 class="section-title">Gatherings & events</h2>`));
  eventSafetyChecklist(content);
}
