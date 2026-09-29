// SEREN guide chat — the conversational front door of the superconnector.
// Mounted by home.js for signed-in users. Talks to the chat backend via
// api.js (see the contract note on chatStart/chatMessage/chatResume there).
//
// Bot message kinds: 'text', 'question' {input:'free'|'single'|'multi'},
// 'brief' (read-only summary — never private_notes), 'proposals'.
// Nothing is ever auto-sent: every message to the backend is a user action
// (Send, a chip click, or an explicit selection send).

import { get } from '../state.js';
import * as api from '../api.js';
import { esc, el, card, announce, toast } from '../ui.js';

const SESSION_KEY = 'seren.chatSessionId';
const MAX_SEND = 2000;

// Defaults used when the resume payload carries state (brief/proposals)
// without accompanying bot text.
const BRIEF_DEFAULT_TEXT = 'Here is what SEREN understood from your conversation so far — review it before anything is shared.';
const PROPOSALS_DEFAULT_TEXT = 'A few thoughtful suggestions, based on your brief. Take your time — both people opt in before anything is shared.';

export async function renderChat(mount) {
  const profileId = get('profileId');

  const wrap = el(`
    <div class="chat-wrap">
      <header class="chat-head">
        <p class="chat-title"><span aria-hidden="true">✦</span> SEREN guide</p>
        <p class="chat-sub">A guided conversation — nothing is shared until you approve it.</p>
      </header>
      <div class="chat-thread" role="log" aria-live="polite" aria-label="Conversation with SEREN"></div>
      <div class="chat-error" role="alert" hidden></div>
      <div class="chat-quick" aria-label="Suggested replies"></div>
      <form class="chat-composer">
        <label class="sr-only" for="chat-input">Message SEREN</label>
        <textarea id="chat-input" class="input" rows="2" maxlength="${MAX_SEND}"
          placeholder="Share what feels meaningful…" autocomplete="off"></textarea>
        <button type="submit" class="btn btn-primary">Send</button>
      </form>
    </div>`);
  mount.appendChild(wrap);

  const thread = wrap.querySelector('.chat-thread');
  const err = wrap.querySelector('.chat-error');
  const quick = wrap.querySelector('.chat-quick');
  const form = wrap.querySelector('.chat-composer');
  const input = wrap.querySelector('#chat-input');
  const sendBtn = form.querySelector('button[type="submit"]');

  let sessionId = null;
  let busy = false;

  const scroll = () => thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });

  function showError(msg) {
    err.textContent = msg;
    err.hidden = false;
    toast(msg);
  }
  function hideError() {
    err.textContent = '';
    err.hidden = true;
  }

  /** Store a (possibly rotated) session id from a chat response. */
  function rememberSession(data) {
    const id = data && data.session && data.session.id;
    if (id && id !== sessionId) {
      sessionId = id;
      try { localStorage.setItem(SESSION_KEY, String(id)); } catch { /* private mode */ }
    }
  }

  function appendBubble(role, text) {
    const b = el(`<div class="${role === 'user' ? 'bubble-user' : 'bubble-bot'}"><p class="chat-text">${esc(text)}</p></div>`);
    thread.appendChild(b);
    scroll();
  }

  function typingIndicator() {
    const t = el(`<div class="typing" aria-hidden="true"><span class="sr-only">SEREN is listening…</span><i></i><i></i><i></i></div>`);
    thread.appendChild(t);
    scroll();
    return t;
  }

  /** Suggested-reply chips under the composer; each click sends as user text. */
  function renderQuickReplies(replies) {
    quick.innerHTML = '';
    const list = (replies || []).filter(Boolean);
    if (!list.length) return;
    for (const r of list) {
      const label = typeof r === 'string' ? r : (r.label || r.value || '');
      const value = typeof r === 'string' ? r : (r.value || r.label || '');
      if (!label) continue;
      const b = el(`<button type="button" class="chip">${esc(label)}</button>`);
      b.addEventListener('click', () => sendUserText(value));
      quick.appendChild(b);
    }
  }

  function renderQuestion(msg) {
    const bubble = el(`<div class="bubble-bot"></div>`);
    if (msg.text) bubble.appendChild(el(`<p class="chat-text">${esc(msg.text)}</p>`));

    const opts = Array.isArray(msg.options) ? msg.options : [];
    const inputKind = msg.input || (opts.length ? 'single' : 'free');

    if (opts.length) {
      const row = el(`<div class="chip-row" role="group" aria-label="Suggested answers"></div>`);
      const selected = new Set();
      for (const o of opts) {
        const label = o.label || o.value || '';
        const b = el(`<button type="button" class="chip">${esc(label)}</button>`);
        if (inputKind === 'single') {
          // One tap → sent as the user's answer.
          b.addEventListener('click', () => sendUserText(label));
        } else if (inputKind === 'multi') {
          b.setAttribute('aria-pressed', 'false');
          b.addEventListener('click', () => {
            if (selected.has(label)) { selected.delete(label); b.setAttribute('aria-pressed', 'false'); }
            else { selected.add(label); b.setAttribute('aria-pressed', 'true'); }
          });
        } else {
          // Free text with suggestions: fill the composer so the user can
          // edit before sending.
          b.addEventListener('click', () => { input.value = label; input.focus(); });
        }
        row.appendChild(b);
      }
      bubble.appendChild(row);

      if (inputKind === 'multi') {
        const sendRow = el(`<div class="chat-send-row"></div>`);
        const done = el(`<button type="button" class="btn btn-primary btn-small">Send my choices</button>`);
        done.addEventListener('click', () => {
          if (!selected.size) { toast('Pick one or more above — or write your own below.'); return; }
          sendUserText([...selected].join(', '));
        });
        sendRow.appendChild(done);
        bubble.appendChild(sendRow);
      }
    }

    if (msg.skippable) {
      const skipRow = el(`<div class="chip-row"></div>`);
      const skip = el(`<button type="button" class="chip chip-skip">Skip for now</button>`);
      skip.addEventListener('click', () => sendUserText('Skip for now'));
      skipRow.appendChild(skip);
      bubble.appendChild(skipRow);
    }

    thread.appendChild(bubble);
    scroll();
    announce(msg.text || 'SEREN asked a question.');
  }

  /** Read-only brief summary. private_notes are never sent by the API and
   *  are never rendered here — this lists only shareable fields. */
  function renderBriefCard(brief) {
    if (!brief) return;
    const c = card();
    c.classList.add('brief-card');
    c.appendChild(el(`<p class="kicker">Your connection brief — review it</p>`));
    const fields = [
      ['Who you are', brief.who_text],
      ['Your present intention', brief.intention_text],
      ['Who might be a good fit', brief.good_fit_text],
      ['What you can offer', brief.offer_text],
      ['Location, format, timing', brief.logistics_text],
      ['Boundaries', brief.boundaries_text],
    ];
    for (const [label, value] of fields) {
      if (!value) continue;
      c.appendChild(el(`<h4 class="proposal-label">${esc(label)}</h4>`));
      c.appendChild(el(`<p class="about-text">${esc(value)}</p>`));
    }
    if (brief.shared_text) {
      c.appendChild(el(`<h4 class="proposal-label">In their words — what another person would see</h4>`));
      c.appendChild(el(`<p class="shared-words">${esc(brief.shared_text)}</p>`));
    }
    thread.appendChild(c);
    scroll();
  }

  async function renderProposals(proposals, briefId) {
    const list = (proposals || []).slice(0, 3);
    if (!list.length) return;
    // Dynamic import: home.js statically imports this module (renderChat),
    // so a static import here would create a cycle.
    const { proposalCard } = await import('./home.js');
    for (const p of list) thread.appendChild(proposalCard(p, briefId));
    scroll();
    announce(list.length === 1 ? 'One introduction suggestion.' : `${list.length} introduction suggestions.`);
  }

  async function renderBotMessage(msg, payload) {
    if (!msg) return;
    const kind = msg.kind || 'text';
    if (kind === 'question') {
      renderQuestion(msg);
    } else if (kind === 'brief') {
      if (msg.text) appendBubble('bot', msg.text);
      renderBriefCard(msg.brief || (payload && payload.brief));
    } else if (kind === 'proposals') {
      if (msg.text) appendBubble('bot', msg.text);
      const briefId = (msg.brief && msg.brief.id) || (payload && payload.brief && payload.brief.id);
      await renderProposals(msg.proposals || (payload && payload.proposals), briefId);
    } else {
      // 'text' and anything unknown → plain bot bubble; never drop content.
      appendBubble('bot', msg.text || '');
    }
  }

  /** Every send is a user action. Renders optimistically, then appends the
   *  backend's reply messages, quick replies, and contextual payload. */
  async function sendUserText(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed || busy) return;
    hideError();
    appendBubble('user', trimmed);
    input.value = '';
    renderQuickReplies(null);
    busy = true;
    sendBtn.disabled = true;
    input.disabled = true;
    const typing = typingIndicator();
    try {
      const data = await api.chatMessage(profileId, sessionId, trimmed);
      typing.remove();
      rememberSession(data);
      const msgs = Array.isArray(data.messages) ? data.messages : [];
      for (const m of msgs) await renderBotMessage(m, data);
      renderQuickReplies(data.quickReplies);
      if (msgs.length) announce('SEREN replied.');
    } catch (e) {
      typing.remove();
      showError(api.friendlyError(e));
      announce('Sending failed. Please try again.');
    } finally {
      busy = false;
      sendBtn.disabled = false;
      input.disabled = false;
      input.focus();
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    sendUserText(input.value);
  });
  // Desktop nicety: Enter sends, Shift+Enter keeps a newline.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  /** Resume a prior session's transcript, then render the current
   *  contextual state (question / brief / proposals) the payload carries. */
  async function resume() {
    let stored = null;
    try { stored = localStorage.getItem(SESSION_KEY); } catch { /* private mode */ }
    if (!stored) { await startFresh(); return; }

    const typing = typingIndicator();
    try {
      const data = await api.chatResume(profileId, stored);
      typing.remove();
      sessionId = (data.session && data.session.id) || stored;
      const transcript = Array.isArray(data.transcript) ? data.transcript : [];
      for (const t of transcript) {
        if (t.role === 'user') appendBubble('user', t.text || '');
        else appendBubble('bot', t.text || ''); // plain replay — non-interactive
      }
      if (data.question) {
        await renderBotMessage({ kind: 'question', ...data.question }, data);
      }
      if (data.brief) {
        await renderBotMessage({ kind: 'brief', text: data.briefText || BRIEF_DEFAULT_TEXT, brief: data.brief }, data);
      }
      if (data.proposals) {
        await renderBotMessage({ kind: 'proposals', text: data.proposalsText || PROPOSALS_DEFAULT_TEXT, proposals: data.proposals }, data);
      }
      renderQuickReplies(data.quickReplies);
    } catch (e) {
      typing.remove();
      if (e instanceof api.ApiError && (e.status === 404 || e.status === 403)) {
        // Session gone or not ours — start clean.
        try { localStorage.removeItem(SESSION_KEY); } catch { /* private mode */ }
        await startFresh();
      } else {
        showError(api.friendlyError(e));
      }
    }
  }

  async function startFresh() {
    const typing = typingIndicator();
    try {
      const data = await api.chatStart(profileId);
      typing.remove();
      rememberSession(data);
      const msgs = Array.isArray(data.messages) ? data.messages : [];
      for (const m of msgs) await renderBotMessage(m, data);
      renderQuickReplies(data.quickReplies);
    } catch (e) {
      typing.remove();
      showError(api.friendlyError(e));
    }
  }

  hideError();
  await resume();
  announce('Guided conversation with SEREN.');
}
