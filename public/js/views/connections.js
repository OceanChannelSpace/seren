// Connections view — mutual connections (accepted or accepted with a
// boundary), with a quiet archive of ended connections.

import * as api from '../api.js';
import {
  el, esc, pageShell, errorBanner, loading, emptyState, card,
  avatarFor, statusPill, timeAgo, confirmDialog, toast, friendlyError,
} from '../ui.js';
import { get, connectionTypeLabel } from '../state.js';

const CONNECTED = new Set(['accepted', 'accepted_with_boundary']);

/** Real-life intention block for one accepted introduction. */
function realLifeIntentionBlock(intro, meId, onDone) {
  const wrap = el(`<div class="rl-card"></div>`);
  const held = (intro.realLifeIntention || '').trim();
  const done = intro.intentionCompleted === true;

  if (held) {
    wrap.appendChild(el(`<h4>Your intention for the next 24 hours</h4>`));
    wrap.appendChild(el(`<p class="rl-text">“${esc(held)}”</p>`));
    if (done) {
      wrap.appendChild(el(`<p style="margin-bottom:0">✦ Marked complete. However it unfolded, the noticing was the practice.</p>`));
    } else {
      const row = el(`<div class="btn-row" style="margin-top:0.6rem"></div>`);
      const complete = el(`<button type="button" class="btn btn-secondary btn-small">Mark as complete</button>`);
      complete.addEventListener('click', async () => {
        complete.disabled = true;
        try {
          await api.completeRealLifeIntention(intro.id, meId);
          toast('Noted with warmth.');
          onDone();
        } catch (e) {
          toast(friendlyError(e));
          complete.disabled = false;
        }
      });
      row.appendChild(complete);
      wrap.appendChild(row);
    }
    return wrap;
  }

  wrap.appendChild(el(`<h4>What would you like to bring into your real life in the next 24 hours?</h4>`));
  wrap.appendChild(el(`<p>Not a goal to achieve — an intention to carry. Entirely optional.</p>`));
  const input = el(`<input type="text" class="input" maxlength="300" style="width:100%;margin-top:0.5rem" placeholder="e.g. a slow walk with no phone" aria-label="Your intention for the next 24 hours">`);
  wrap.appendChild(input);
  const row = el(`<div class="btn-row" style="margin-top:0.6rem"></div>`);
  const set = el(`<button type="button" class="btn btn-primary btn-small">Hold this intention</button>`);
  set.addEventListener('click', async () => {
    const text = input.value.trim();
    if (!text) { toast('Write a few words first — or leave this be. Both are fine.'); input.focus(); return; }
    set.disabled = true;
    try {
      await api.setRealLifeIntention(intro.id, meId, text);
      toast('Held with care.');
      onDone();
    } catch (e) {
      toast(friendlyError(e));
      set.disabled = false;
    }
  });
  row.appendChild(set);
  const skip = el(`<button type="button" class="btn btn-ghost btn-small">Not now</button>`);
  skip.addEventListener('click', () => { wrap.style.display = 'none'; });
  row.appendChild(skip);
  wrap.appendChild(row);
  return wrap;
}

/** Post-connection feedback nudge: felt safe? quality? notes? */
function feedbackNudgeBlock(intro, meId) {
  const wrap = el(`<div class="feedback-nudge"></div>`);
  wrap.appendChild(el(`<h4>How is this connection?</h4>`));
  wrap.appendChild(el(`<p>Only if you feel like sharing. This helps SEREN stay honest — it is never shown to the other person.</p>`));

  let feltSafe = null;
  const safeRow = el(`<div class="btn-row" style="margin-top:0" role="group" aria-label="Did you feel safe?"></div>`);
  safeRow.appendChild(el(`<span class="field-hint" style="align-self:center;margin:0">Did you feel safe?</span>`));
  for (const [value, label] of [[true, 'Yes'], [false, 'No']]) {
    const b = el(`<button type="button" class="btn btn-secondary btn-small" aria-pressed="false">${label}</button>`);
    b.addEventListener('click', () => {
      feltSafe = value;
      for (const sib of safeRow.querySelectorAll('button')) sib.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', 'true');
    });
    safeRow.appendChild(b);
  }
  wrap.appendChild(safeRow);

  let quality = null;
  const qRow = el(`<div class="scale-row" role="group" aria-label="How meaningful has it been so far? (optional)" style="margin-top:0.75rem;max-width:20rem"></div>`);
  for (let n = 1; n <= 5; n++) {
    const b = el(`<button type="button" class="scale-opt" aria-pressed="false" aria-label="${n} of 5">${n}</button>`);
    b.addEventListener('click', () => {
      quality = n;
      for (const sib of qRow.querySelectorAll('button')) sib.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', 'true');
    });
    qRow.appendChild(b);
  }
  wrap.appendChild(el(`<p class="field-hint" style="margin-bottom:0.25rem">How meaningful has it been so far? (optional)</p>`));
  wrap.appendChild(qRow);

  const notes = el(`<textarea class="input textarea" rows="2" maxlength="500" style="width:100%;margin-top:0.75rem" placeholder="Anything else? (optional)" aria-label="Anything else? (optional)"></textarea>`);
  wrap.appendChild(notes);

  const row = el(`<div class="btn-row" style="margin-top:0.75rem"></div>`);
  const share = el(`<button type="button" class="btn btn-secondary btn-small">Share feedback</button>`);
  share.addEventListener('click', async () => {
    if (feltSafe === null) { toast('Please say whether you felt safe — or skip this for now.'); return; }
    share.disabled = true;
    try {
      await api.submitIntroductionFeedback(intro.id, {
        profileId: meId,
        feltSafe,
        quality,
        notes: notes.value.trim() || undefined,
      });
      wrap.innerHTML = '';
      wrap.appendChild(el(`<p style="margin:0;font-style:italic;color:var(--mist)">Thank you — this helps SEREN stay honest.</p>`));
      toast('Feedback shared. Thank you.');
    } catch (e) {
      if (e && e.code === 'already_submitted') {
        wrap.innerHTML = '';
        wrap.appendChild(el(`<p style="margin:0;font-style:italic;color:var(--mist)">You’ve already shared feedback on this connection. Thank you.</p>`));
      } else {
        toast(friendlyError(e));
        share.disabled = false;
      }
    }
  });
  row.appendChild(share);
  const dismiss = el(`<button type="button" class="btn btn-ghost btn-small">Not now</button>`);
  dismiss.addEventListener('click', () => { wrap.style.display = 'none'; });
  row.appendChild(dismiss);
  wrap.appendChild(row);
  return wrap;
}

function connectionCard(intro, meId, onDone) {
  const other = intro.other || {};
  const c = card();

  const head = el(`
    <div class="person-head">
      <div class="who">
        <h3>${esc(other.name || 'Someone')}</h3>
        ${intro.connectionType ? `<p class="person-sub">${esc(connectionTypeLabel(intro.connectionType))}</p>` : ''}
        <p class="request-meta">Connected ${esc(timeAgo(intro.updatedAt))}</p>
      </div>
    </div>`);
  head.prepend(avatarFor(other.name));
  c.appendChild(head);
  c.appendChild(statusPill(intro.status));

  if (intro.responderNote) {
    c.appendChild(el(`<div class="boundary-note">${esc(intro.responderNote)}</div>`));
  }

  // --- real-life intention (Flourishing by Design): a declared offline
  // intent for the next 24 hours, with set/complete affordances. Never an
  // outcome claim, never a streak — just a quiet nudge toward real life.
  c.appendChild(realLifeIntentionBlock(intro, meId, onDone));

  // --- post-connection feedback nudge: felt safe? quality? Optional, one
  // per member; the server enforces the one-feedback rule (409).
  c.appendChild(feedbackNudgeBlock(intro, meId));

  const actions = el('<div class="match-actions"></div>');

  const open = el('<a class="btn btn-primary btn-small">Open conversation</a>');
  open.href = `#/connections/messages?id=${intro.id}`;
  actions.appendChild(open);

  const plan = el('<a class="btn btn-secondary btn-small">Plan your first connection</a>');
  plan.href = `#/connections/messages?id=${intro.id}`;
  actions.appendChild(plan);

  const end = el('<button type="button" class="btn btn-ghost btn-small">End connection</button>');
  end.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'End this connection?',
      body: 'This closes your conversation. You can both still see each other in Discover.',
      confirmLabel: 'End connection',
      danger: true,
    });
    if (!ok) return;
    end.disabled = true;
    try {
      await api.endIntroduction(intro.id, meId);
      toast('Connection ended. Wishing you both well.');
      onDone();
    } catch (e) {
      toast(friendlyError(e));
      end.disabled = false;
    }
  });
  actions.appendChild(end);

  c.appendChild(actions);
  return c;
}

export async function renderConnections(root, ctx) {
  const meId = get('profileId');
  const { root: page, body } = pageShell('Connections', 'Mutual, by consent');
  const banner = errorBanner();
  page.insertBefore(banner.node, body);
  root.appendChild(page);

  const loader = loading('Loading connections…');
  body.appendChild(loader);

  async function load() {
    body.innerHTML = '';
    body.appendChild(loader);
    banner.clear();
    try {
      const { introductions } = await api.listIntroductions(meId);
      body.innerHTML = '';

      const live = introductions.filter((i) => CONNECTED.has(i.status));
      const ended = introductions.filter((i) => i.status === 'ended');

      if (!live.length && !ended.length) {
        body.appendChild(emptyState({
          title: 'No connections yet.',
          body: 'When you and another person both say yes, your conversations live here.',
          actionLabel: 'Explore Discover',
          actionHref: '#/discover',
        }));
        return;
      }

      if (live.length) {
        for (const intro of live) body.appendChild(connectionCard(intro, meId, load));
      }

      if (ended.length) {
        body.appendChild(el('<h2 class="section-title">Ended</h2>'));
        body.appendChild(el('<p class="section-note">Closed with care. These stay in your history and no longer receive messages.</p>'));
        for (const intro of ended) {
          const other = intro.other || {};
          const c = card();
          const head = el(`
            <div class="person-head">
              <div class="who">
                <h3>${esc(other.name || 'Someone')}</h3>
                ${intro.connectionType ? `<p class="person-sub">${esc(connectionTypeLabel(intro.connectionType))}</p>` : ''}
              </div>
            </div>`);
          head.prepend(avatarFor(other.name));
          c.appendChild(head);
          c.appendChild(statusPill(intro.status));
          body.appendChild(c);
        }
      }
    } catch (e) {
      body.innerHTML = '';
      banner.show(friendlyError(e));
    }
  }

  await load();
}
