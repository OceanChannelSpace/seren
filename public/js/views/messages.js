// Messages view — private conversation for one mutual connection.
// Messages open only after both people accept. Includes the optional
// first-connection plan, plus block/report controls.

import * as api from '../api.js';
import {
  el, esc, pageShell, errorBanner, infoBanner, loading, emptyState, card,
  avatarFor, statusPill, timeAgo, textArea, field, selectInput, textInput,
  confirmDialog, toast, announce, friendlyError,
} from '../ui.js';
import { get, metaList, connectionTypeLabel, formatLabel } from '../state.js';
import { navigate } from '../router.js';

const REPORT_OPTIONS = [
  { value: 'spam', label: 'Spam or solicitation' },
  { value: 'harassment', label: 'Harassment or unwanted contact' },
  { value: 'inappropriate-content', label: 'Inappropriate content' },
  { value: 'dishonest-profile', label: 'Dishonest or misleading profile' },
  { value: 'safety-concern', label: 'Safety concern' },
  { value: 'other', label: 'Something else' },
];

function messageNode(msg, meId) {
  const mine = msg.senderId === meId;
  return el(`
    <div class="message${mine ? ' message-mine' : ''}">
      <p class="msg-body">${esc(msg.body)}</p>
      <p class="msg-meta">${mine ? 'You' : 'Them'} · ${esc(timeAgo(msg.createdAt))}</p>
    </div>`);
}

function scrollThread(thread) {
  thread.scrollTop = thread.scrollHeight;
}

export async function renderMessages(root, ctx) {
  const meId = get('profileId');
  const introId = Number(ctx.params.id);
  const { root: page, body } = pageShell('Conversation', 'Private, by mutual consent');
  const banner = errorBanner();
  page.insertBefore(banner.node, body);
  root.appendChild(page);
  body.appendChild(loading('Opening conversation…'));

  let cleanup = () => {};
  window.addEventListener('hashchange', function onNav() {
    window.removeEventListener('hashchange', onNav);
    cleanup();
  });

  if (!Number.isInteger(introId) || introId <= 0) {
    body.innerHTML = '';
    body.appendChild(emptyState({
      title: 'No conversation selected.',
      body: 'Choose a connection to open its conversation.',
      actionLabel: 'Back to Connections',
      actionHref: '#/connections',
    }));
    return;
  }

  let data;
  try {
    data = await api.listMessages(introId, meId);
  } catch (e) {
    body.innerHTML = '';
    body.appendChild(emptyState({
      title: 'This conversation isn’t open.',
      body: e.status === 403
        ? 'Conversations open only after both people accept the connection.'
        : friendlyError(e),
      actionLabel: 'Back to Connections',
      actionHref: '#/connections',
    }));
    return;
  }

  const { introduction: intro, plan: initialPlan, messages: initialMessages } = data;
  const other = intro.other || {};
  const otherId = intro.requesterId === meId ? intro.proposedId : intro.requesterId;
  body.innerHTML = '';

  // --- header ---
  const head = card();
  const headTop = el(`
    <div class="person-head">
      <div class="who">
        <h3>${esc(other.name || 'Someone')}</h3>
        ${intro.connectionType ? `<p class="person-sub">${esc(connectionTypeLabel(intro.connectionType))}</p>` : ''}
      </div>
    </div>`);
  headTop.prepend(avatarFor(other.name));
  head.appendChild(headTop);
  head.appendChild(statusPill(intro.status));

  const headActions = el('<div class="match-actions"></div>');
  const endBtn = el('<button type="button" class="btn btn-ghost btn-small">End connection</button>');
  endBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'End this connection?',
      body: 'This closes your conversation. You can both still see each other in Discover.',
      confirmLabel: 'End connection',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.endIntroduction(intro.id, meId);
      toast('Connection ended. Wishing you both well.');
      navigate('#/connections');
    } catch (e) {
      toast(friendlyError(e));
    }
  });
  headActions.appendChild(endBtn);
  head.appendChild(headActions);
  body.appendChild(head);

  // --- block / report row ---
  const safetyRow = el('<div class="match-actions safety-row"></div>');
  const blockBtn = el('<button type="button" class="btn btn-ghost btn-small">Block</button>');
  const reportBtn = el('<button type="button" class="btn btn-ghost btn-small">Report</button>');
  blockBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: `Block ${other.name || 'this person'}?`,
      body: 'They won’t see you in Discover, and this conversation will close. You can unblock them later from Settings.',
      confirmLabel: 'Block',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.blockProfile(meId, otherId);
      toast('Blocked. You won’t see each other anymore.');
      navigate('#/connections');
    } catch (e) {
      toast(friendlyError(e));
    }
  });
  const reportSlot = el('<div class="report-slot"></div>');
  reportBtn.addEventListener('click', () => openReportForm(otherId, reportSlot));
  safetyRow.appendChild(blockBtn);
  safetyRow.appendChild(reportBtn);
  body.appendChild(safetyRow);
  body.appendChild(reportSlot);

  // --- first-connection plan ---
  const planCard = card();
  planCard.classList.add('plan-card');
  body.appendChild(planCard);
  let plan = initialPlan;

  function renderPlan() {
    planCard.innerHTML = '';
    const box = el('<div class="plan-box"></div>');
    if (plan) {
      box.appendChild(el('<h3>Your first-connection plan</h3>'));
      const lines = [];
      if (plan.format) lines.push(`<p><strong>Format:</strong> ${esc(formatLabel(plan.format))}</p>`);
      if (plan.timeText) lines.push(`<p><strong>When:</strong> ${esc(plan.timeText)}</p>`);
      if (plan.expectations) lines.push(`<p><strong>Expectations:</strong> ${esc(plan.expectations)}</p>`);
      box.innerHTML += lines.join('') || '<p>Plan saved.</p>';
      const edit = el('<button type="button" class="btn btn-secondary btn-small">Edit plan</button>');
      edit.addEventListener('click', () => renderPlanForm(plan));
      box.appendChild(edit);
    } else {
      box.appendChild(el('<h3>Plan your first connection</h3>'));
      box.appendChild(el('<p>Format, timing, and expectations — so you both arrive at ease. Optional, and editable any time.</p>'));
      const create = el('<button type="button" class="btn btn-secondary btn-small">Create a plan</button>');
      create.addEventListener('click', () => renderPlanForm(null));
      box.appendChild(create);
    }
    planCard.appendChild(box);
  }

  function renderPlanForm(existing) {
    planCard.innerHTML = '';
    const form = el('<div class="plan-form"></div>');
    form.appendChild(el('<h3>First-connection plan</h3>'));
    const formatSel = selectInput({
      ariaLabel: 'Format',
      options: [{ value: '', label: 'Choose a format (optional)' }]
        .concat(metaList('connectionFormats').map((f) => ({ value: f.value, label: f.label }))),
      value: (existing && existing.format) || '',
    });
    const timeIn = textInput({ placeholder: 'e.g. Sunday morning, sometime next week', value: (existing && existing.timeText) || '', maxLength: 120 });
    const expIn = textArea({ placeholder: 'e.g. A quiet 20-minute sit, cameras on, no need to prepare anything.', value: (existing && existing.expectations) || '', maxLength: 500, rows: 3 });
    form.appendChild(field('Format', formatSel));
    form.appendChild(field('Timing', timeIn, { hint: 'Keep it loose — a window, not a commitment.' }));
    form.appendChild(field('Expectations', expIn, { hint: 'What would help you both feel at ease?' }));
    const row = el('<div class="btn-row"></div>');
    const cancel = el('<button type="button" class="btn btn-ghost btn-small">Cancel</button>');
    const save = el('<button type="button" class="btn btn-primary btn-small">Save plan</button>');
    cancel.addEventListener('click', renderPlan);
    save.addEventListener('click', async () => {
      save.disabled = true;
      save.textContent = 'Saving…';
      try {
        const res = await api.savePlan(intro.id, meId, {
          format: formatSel.value || '',
          timeText: timeIn.value.trim(),
          expectations: expIn.value.trim(),
        });
        plan = res.plan;
        toast('Plan saved.');
        renderPlan();
      } catch (e) {
        toast(friendlyError(e));
        save.disabled = false;
        save.textContent = 'Save plan';
      }
    });
    row.appendChild(cancel);
    row.appendChild(save);
    form.appendChild(row);
    planCard.appendChild(form);
    formatSel.focus();
  }

  renderPlan();

  // --- thread ---
  const threadCard = card();
  const thread = el('<div class="message-thread" role="log" aria-label="Messages" aria-live="polite"></div>');
  threadCard.appendChild(thread);
  body.appendChild(threadCard);

  let lastSeenId = 0;
  function renderMessagesList(msgs) {
    thread.innerHTML = '';
    if (!msgs.length) {
      thread.appendChild(el('<p class="request-meta">No messages yet. Say hello when it feels right — there’s no rush.</p>'));
    } else {
      for (const m of msgs) thread.appendChild(messageNode(m, meId));
      lastSeenId = Math.max(...msgs.map((m) => m.id));
    }
    scrollThread(thread);
  }
  renderMessagesList(initialMessages || []);

  // --- composer ---
  const composer = el('<div class="composer"></div>');
  const input = textArea({ rows: 2, maxLength: 2000 });
  input.setAttribute('aria-label', 'Write a message');
  input.setAttribute('placeholder', 'Write a message…');
  const send = el('<button type="button" class="btn btn-primary">Send</button>');
  composer.appendChild(input);
  composer.appendChild(send);
  threadCard.appendChild(composer);
  threadCard.appendChild(el('<p class="field-hint">Messages are private between you two. Kindness is the only rule that matters.</p>'));

  async function doSend() {
    const value = input.value.trim();
    if (!value || send.disabled) return;
    send.disabled = true;
    const original = send.textContent;
    send.textContent = 'Sending…';
    try {
      const msg = await api.sendMessage(intro.id, meId, value);
      input.value = '';
      if (thread.querySelector('.request-meta')) thread.innerHTML = '';
      thread.appendChild(messageNode(msg, meId));
      lastSeenId = Math.max(lastSeenId, msg.id);
      scrollThread(thread);
      announce('Message sent.');
    } catch (e) {
      toast(friendlyError(e));
    } finally {
      send.disabled = false;
      send.textContent = original;
      input.focus();
    }
  }
  send.addEventListener('click', doSend);
  input.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); doSend(); }
  });

  // --- polling ---
  const poll = setInterval(async () => {
    try {
      const fresh = await api.listMessages(intro.id, meId);
      const msgs = fresh.messages || [];
      const unseen = msgs.filter((m) => m.id > lastSeenId);
      if (unseen.length) {
        if (thread.querySelector('.request-meta')) thread.innerHTML = '';
        for (const m of unseen) thread.appendChild(messageNode(m, meId));
        lastSeenId = Math.max(...msgs.map((m) => m.id));
        scrollThread(thread);
        announce(`${unseen.length} new message${unseen.length > 1 ? 's' : ''}.`);
      }
      if (fresh.plan && JSON.stringify(fresh.plan) !== JSON.stringify(plan)) {
        plan = fresh.plan;
        renderPlan();
      }
    } catch { /* transient — the next poll retries */ }
  }, 15000);
  cleanup = () => clearInterval(poll);
}

function openReportForm(reportedId, slot) {
  slot.innerHTML = '';
  const form = el('<div class="inline-form"></div>');
  form.appendChild(el('<h3>Report this person</h3>'));
  form.appendChild(el('<p class="field-hint">Reports are reviewed by our team. Blocking also stops all contact immediately.</p>'));
  const reasonSel = selectInput({ ariaLabel: 'Reason', options: REPORT_OPTIONS });
  const details = textArea({ placeholder: 'What happened? (optional)', maxLength: 1000, rows: 3 });
  form.appendChild(field('Reason', reasonSel));
  form.appendChild(field('Details', details));
  const row = el('<div class="btn-row"></div>');
  const cancel = el('<button type="button" class="btn btn-ghost btn-small">Cancel</button>');
  const submit = el('<button type="button" class="btn btn-primary btn-small">Submit report</button>');
  cancel.addEventListener('click', () => { slot.innerHTML = ''; });
  submit.addEventListener('click', async () => {
    submit.disabled = true;
    submit.textContent = 'Submitting…';
    try {
      await api.reportProfile({ reportedId, reason: reasonSel.value, details: details.value.trim() });
      slot.innerHTML = '';
      toast('Thank you. Our team will review.');
    } catch (e) {
      toast(friendlyError(e));
      submit.disabled = false;
      submit.textContent = 'Submit report';
    }
  });
  row.appendChild(cancel);
  row.appendChild(submit);
  form.appendChild(row);
  slot.appendChild(form);
  reasonSel.focus();
}
