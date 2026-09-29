// Requests view — staged consent inbox for intentional connection requests.
// Incoming: the recipient answers with accept / accept-with-boundary /
// question / decline / decline-hidden. Sent: the requester may withdraw.

import * as api from '../api.js';
import {
  el, esc, pageShell, errorBanner, loading, emptyState, card,
  avatarFor, statusPill, timeAgo, textArea, field, confirmDialog,
  toast, announce, friendlyError,
} from '../ui.js';
import { get, connectionTypeLabel, formatLabel, commitmentLabel, toneLabel } from '../state.js';
import { navigate } from '../router.js';

const ACTIONABLE = new Set(['proposed', 'question']);

const RESPOND_CONFIG = {
  accepted: {
    button: 'Accept', confirmLabel: 'Accept',
    title: 'Accept this request?',
    body: 'They will be notified, and your conversation can begin. You can end it any time.',
    noteLabel: null, notePlaceholder: null,
  },
  accepted_with_boundary: {
    button: 'Accept with a boundary', confirmLabel: 'Accept with boundary',
    title: 'Accept with a boundary',
    body: 'Name what helps you feel at ease. Your boundary is shared with them.',
    noteLabel: 'Your boundary (optional, max 500 characters)',
    notePlaceholder: 'e.g. Video only to start, and 30 minutes is plenty for me.',
  },
  question: {
    button: 'Ask a question', confirmLabel: 'Send question',
    title: 'Ask a question',
    body: 'Ask what you need before you decide. They can answer, and you can still accept or decline after.',
    noteLabel: 'Your question (required, max 500 characters)',
    notePlaceholder: 'e.g. What does your practice usually look like?',
    required: true,
  },
  decline: {
    button: 'Decline', confirmLabel: 'Decline with a note',
    title: 'Decline this request?',
    body: 'A kind, brief note is optional. They will see that you declined.',
    noteLabel: 'A kind note (optional, max 500 characters)',
    notePlaceholder: 'e.g. Thank you for reaching out — this isn’t the right fit for me right now.',
  },
  decline_hidden: {
    button: 'Decline quietly', confirmLabel: 'Decline quietly',
    title: 'Decline quietly?',
    body: 'They won’t be notified of a reason. This simply closes the request.',
    noteLabel: null, notePlaceholder: null,
  },
};

function metaLine(intro) {
  const parts = [];
  if (intro.format) parts.push(formatLabel(intro.format));
  if (intro.commitment) parts.push(commitmentLabel(intro.commitment));
  if (intro.tone) parts.push(toneLabel(intro.tone));
  parts.push(timeAgo(intro.createdAt));
  return parts.filter(Boolean).join(' · ');
}

function messageBlock(intro) {
  const text = intro.requestMessage || intro.note || '';
  if (!text) return null;
  return el(`<div class="request-message">${esc(text)}</div>`);
}

function boundaryBlock(intro) {
  if (!intro.responderNote) return null;
  return el(`<div class="boundary-note">${esc(intro.responderNote)}</div>`);
}

async function doRespond(intro, response, note, onDone) {
  const cfg = RESPOND_CONFIG[response];
  try {
    await api.respondToIntroduction(intro.id, get('profileId'), response, note || '');
    toast(response === 'accepted' || response === 'accepted_with_boundary'
      ? 'Request accepted. Your conversation is open.'
      : response === 'question' ? 'Your question was sent.'
      : 'Request closed with care.');
    announce(cfg.confirmLabel + ' — done.');
    onDone();
  } catch (e) {
    toast(friendlyError(e));
    throw e;
  }
}

function requestCard(intro, meId, direction, onDone) {
  const other = intro.other || {};
  const c = card();
  c.classList.add('request-card');

  const head = el(`
    <div class="person-head">
      <div class="who">
        <h3>${esc(other.name || (direction === 'incoming' ? intro.requesterName : intro.proposedName) || 'Someone')}</h3>
        ${intro.connectionType ? `<p class="person-sub">${esc(connectionTypeLabel(intro.connectionType))}</p>` : ''}
        <p class="request-meta">${esc(metaLine(intro))}</p>
      </div>
    </div>`);
  head.prepend(avatarFor(other.name));
  c.appendChild(head);
  c.appendChild(statusPill(intro.status));

  // Recipient sees ONLY the requester's approved brief text + name + reason —
  // never private notes, never unapproved fields.
  if (direction === 'incoming' && intro.requesterSharedText) {
    c.appendChild(el(`<h4 class="proposal-label">In their own words</h4>`));
    c.appendChild(el(`<p class="shared-words">${esc(intro.requesterSharedText)}</p>`));
  }
  if (direction === 'incoming' && intro.forCandidate) {
    const serve = Array.isArray(intro.forCandidate) ? intro.forCandidate.join(' ') : String(intro.forCandidate);
    if (serve) {
      c.appendChild(el(`<h4 class="proposal-label">Why this might serve you</h4>`));
      c.appendChild(el(`<p class="about-text">${esc(serve)}</p>`));
    }
  }

  const msg = messageBlock(intro);
  if (msg) c.appendChild(msg);
  const bnd = boundaryBlock(intro);
  if (bnd) c.appendChild(bnd);

  // Inline respond form placeholder.
  const formSlot = el('<div class="respond-slot"></div>');
  c.appendChild(formSlot);

  const actions = el('<div class="match-actions"></div>');
  c.appendChild(actions);

  const actionable = ACTIONABLE.has(intro.status);

  if (direction === 'incoming' && actionable) {
    const order = ['accepted', 'accepted_with_boundary', 'question', 'decline', 'decline_hidden'];
    for (const r of order) {
      const cfg = RESPOND_CONFIG[r];
      const btn = el(`<button type="button" class="btn ${r === 'accepted' ? 'btn-primary' : r.startsWith('decline') ? 'btn-ghost' : 'btn-secondary'} btn-small">${esc(cfg.button)}</button>`);
      btn.addEventListener('click', () => openRespondForm(intro, r, formSlot, onDone));
      actions.appendChild(btn);
    }
  } else if (direction === 'sent' && actionable) {
    const btn = el('<button type="button" class="btn btn-ghost btn-small">Withdraw</button>');
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Withdraw this request?',
        body: 'They won’t be able to respond to it anymore. You can reach out again later if it feels right.',
        confirmLabel: 'Withdraw',
      });
      if (!ok) return;
      btn.disabled = true;
      try {
        await api.withdrawIntroduction(intro.id);
        toast('Request withdrawn.');
        onDone();
      } catch (e) {
        toast(friendlyError(e));
        btn.disabled = false;
      }
    });
    actions.appendChild(btn);
  } else if (intro.status === 'declined_hidden' && direction === 'incoming') {
    actions.appendChild(el('<p class="request-meta">You passed quietly. Nothing was sent.</p>'));
  }

  return c;
}

function openRespondForm(intro, response, slot, onDone) {
  const cfg = RESPOND_CONFIG[response];
  slot.innerHTML = '';

  // No-note responses confirm immediately.
  if (!cfg.noteLabel) {
    confirmDialog({ title: cfg.title, body: cfg.body, confirmLabel: cfg.confirmLabel, danger: response === 'decline_hidden' })
      .then(async (ok) => {
        if (!ok) return;
        await doRespond(intro, response, '', onDone);
      })
      .catch((e) => toast(friendlyError(e)));
    return;
  }

  const note = textArea({
    placeholder: cfg.notePlaceholder,
    maxLength: 500,
    rows: 3,
    required: !!cfg.required,
  });
  const form = el('<div class="inline-form"></div>');
  form.appendChild(field(cfg.noteLabel, note));
  const row = el('<div class="btn-row"></div>');
  const cancel = el('<button type="button" class="btn btn-ghost btn-small">Cancel</button>');
  const confirm = el(`<button type="button" class="btn btn-primary btn-small">${esc(cfg.confirmLabel)}</button>`);
  cancel.addEventListener('click', () => { slot.innerHTML = ''; });
  confirm.addEventListener('click', async () => {
    const value = note.value.trim();
    if (cfg.required && !value) {
      toast('Please write your question first.');
      note.focus();
      return;
    }
    confirm.disabled = true;
    confirm.textContent = 'Sending…';
    try {
      await doRespond(intro, response, value, onDone);
    } catch {
      confirm.disabled = false;
      confirm.textContent = cfg.confirmLabel;
    }
  });
  row.appendChild(cancel);
  row.appendChild(confirm);
  form.appendChild(row);
  slot.appendChild(form);
  note.focus();
}

export async function renderRequests(root, ctx) {
  const meId = get('profileId');
  const { root: page, body } = pageShell('Requests', 'Staged consent');
  const banner = errorBanner();
  page.insertBefore(banner.node, body);
  root.appendChild(page);

  const loader = loading('Loading requests…');
  body.appendChild(loader);

  async function load() {
    body.innerHTML = '';
    body.appendChild(loader);
    banner.clear();
    try {
      const { introductions } = await api.listIntroductions(meId);
      body.innerHTML = '';

      const incoming = introductions.filter((i) => i.proposedId === meId);
      const sent = introductions.filter((i) => i.requesterId === meId);
      const activeIncoming = incoming.filter((i) => ACTIONABLE.has(i.status));
      const pastIncoming = incoming.filter((i) => !ACTIONABLE.has(i.status));
      const activeSent = sent.filter((i) => ACTIONABLE.has(i.status));
      const pastSent = sent.filter((i) => !ACTIONABLE.has(i.status));

      const sec = (title, list, emptyTitle, emptyBody, emptyAction) => {
        const h = el(`<h2 class="section-title">${esc(title)}</h2>`);
        body.appendChild(h);
        if (!list.length) {
          body.appendChild(emptyState({
            title: emptyTitle, body: emptyBody,
            actionLabel: emptyAction ? 'Explore Discover' : undefined,
            actionHref: emptyAction ? '#/discover' : undefined,
          }));
        } else {
          for (const intro of list) body.appendChild(requestCard(intro, meId, title.startsWith('Incoming') ? 'incoming' : 'sent', load));
        }
      };

      sec('Incoming requests', activeIncoming,
        'No requests waiting.',
        'When someone reaches out with intention, you’ll find them here. Take your time — there’s no rush to answer.',
        false);
      if (pastIncoming.length) {
        body.appendChild(el('<h2 class="section-title">Past requests</h2>'));
        for (const intro of pastIncoming) body.appendChild(requestCard(intro, meId, 'incoming', load));
      }

      sec('Sent requests', activeSent,
        'No sent requests.',
        'When you reach out to someone with intention, you can follow along here.',
        true);
      if (pastSent.length) {
        body.appendChild(el('<h2 class="section-title">Past sent</h2>'));
        for (const intro of pastSent) body.appendChild(requestCard(intro, meId, 'sent', load));
      }
    } catch (e) {
      body.innerHTML = '';
      banner.show(friendlyError(e));
    }
  }

  await load();
}
