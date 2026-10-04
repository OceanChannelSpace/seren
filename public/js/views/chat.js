// SEREN guide chat — the conversational front door of the rule-based connection guide.
// Mounted by home.js for signed-in users. Talks to the chat backend via
// api.js (see the contract note on chatStart/chatMessage/chatResume there).
//
// Bot message kinds: 'text', 'question' {input:'free'|'single'|'multi'},
// 'brief' (read-only summary — never private_notes), 'proposals'.
// Nothing is ever auto-sent: every message to the backend is a user action
// (Send, a chip click, or an explicit selection send).

import { get } from '../state.js';
import { STORAGE_PREFIX } from '../state.js';
import * as api from '../api.js';
import { esc, el, card, announce, toast } from '../ui.js';

const SESSION_KEY = `${STORAGE_PREFIX}.chatSessionId`;
const MAX_SEND = 2000;

// Defaults used when the resume payload carries state (brief/proposals)
// without accompanying bot text.
const BRIEF_DEFAULT_TEXT = 'Here is what SEREN understood from your conversation so far — review it before anything is shared.';
const PROPOSALS_DEFAULT_TEXT = 'A few thoughtful suggestions, based on your brief. Take your time — both people opt in before anything is shared.';

export async function renderChat(mount, opts = {}) {
  // opts makes the view reusable for profile-less flows (e.g. the
  // conversational onboarding interview). Defaults preserve the member
  // guide behavior exactly.
  const {
    profileId = get('profileId'),
    sessionKey = SESSION_KEY,
    startFn = (pid) => api.chatStart(pid),
    sendFn = (pid, sid, text) => api.chatMessage(pid, sid, text),
    resumeFn = (pid, sid) => api.chatResume(pid, sid),
    title = 'SEREN guide',
    subtitle = 'A guided conversation — nothing is shared until you approve it.',
    placeholder = 'Share what feels meaningful…',
    onTurn = null,
  } = opts;

  const wrap = el(`
    <div class="chat-wrap">
      <header class="chat-head">
        <p class="chat-title"><span aria-hidden="true">✦</span> ${esc(title)}</p>
        <p class="chat-sub">${esc(subtitle)}</p>
      </header>
      <div class="chat-thread" role="log" aria-live="polite" aria-label="Conversation with SEREN"></div>
      <div class="chat-error" role="alert" hidden></div>
      <div class="chat-foot">
        <div class="chat-quick" aria-label="Suggested replies"></div>
        <form class="chat-composer">
          <label class="sr-only" for="chat-input">Message SEREN</label>
          <textarea id="chat-input" class="input" rows="2" maxlength="${MAX_SEND}"
            placeholder="${esc(placeholder)}" autocomplete="off"></textarea>
          <button type="submit" class="btn btn-primary">Send</button>
        </form>
      </div>
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
      try { localStorage.setItem(sessionKey, String(id)); } catch { /* private mode */ }
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

  /** Suggested-reply chips under the composer. A reply marked {fill:true}
   *  is a writing prompt: tapping drops its text into the composer for
   *  editing instead of sending it. Plain replies send on tap. */
  function renderQuickReplies(replies) {
    quick.innerHTML = '';
    const list = (replies || []).filter(Boolean);
    if (!list.length) return;
    for (const r of list) {
      const label = typeof r === 'string' ? r : (r.label || r.value || '');
      const value = typeof r === 'string' ? r : (r.value || r.label || '');
      const fill = typeof r === 'object' && r.fill === true;
      if (!label) continue;
      const b = el(`<button type="button" class="chip">${esc(label)}</button>`);
      b.addEventListener('click', () => {
        if (fill) { input.value = value; input.focus(); }
        else sendUserText(value);
      });
      quick.appendChild(b);
    }
  }

  // Rendered generically from the message shape
  // ({text, questionId, input, options, skippable, max}) — never keyed on a
  // specific questionId, so unknown future questions fall through the same
  // path. 'free' questions show chips as writing prompts (tap fills the
  // composer for editing). 'single' questions render tap-to-select choices
  // that send on tap. 'multi' questions toggle chips and send the chosen
  // labels as a comma-joined answer (the backend parses that format).
  function renderQuestion(msg) {
    const bubble = el(`<div class="bubble-bot"></div>`);
    if (msg.text) bubble.appendChild(el(`<p class="chat-text">${esc(msg.text)}</p>`));

    const opts = (Array.isArray(msg.options) ? msg.options : [])
      .map((o) => ({ label: o.label || o.value || '', value: o.value || o.label || '' }))
      .filter((o) => o.label);
    const inputKind = ['single', 'multi'].includes(msg.input) ? msg.input : 'free';
    const max = Number.isFinite(Number(msg.max)) && Number(msg.max) > 0 ? Number(msg.max) : Infinity;

    if (opts.length && inputKind === 'single') {
      const wrap = el(`<div class="suggest-block"></div>`);
      wrap.appendChild(el(`<p class="suggest-hint">Tap your choice — or write your own in the box below.</p>`));
      const row = el(`<div class="chip-row" role="group" aria-label="Choices"></div>`);
      for (const o of opts) {
        const b = el(`<button type="button" class="chip chip-select">${esc(o.label)}</button>`);
        b.addEventListener('click', () => sendUserText(o.label));
        row.appendChild(b);
      }
      wrap.appendChild(row);
      bubble.appendChild(wrap);
    } else if (opts.length && inputKind === 'multi') {
      const wrap = el(`<div class="suggest-block"></div>`);
      wrap.appendChild(el(`<p class="suggest-hint">${max === Infinity ? 'Tap all that fit —' : `Tap up to ${max} —`} then send your choices, or write your own below.</p>`));
      const row = el(`<div class="chip-row" role="group" aria-label="Choices"></div>`);
      const selected = new Set();
      const sendRow = el(`<div class="chat-send-row"></div>`);
      const sendBtn = el(`<button type="button" class="btn btn-primary btn-small" disabled>Send my choices</button>`);
      sendRow.appendChild(sendBtn);
      const refresh = () => {
        sendBtn.disabled = selected.size === 0;
        sendBtn.textContent = selected.size
          ? `Send my choice${selected.size === 1 ? '' : 's'} (${selected.size})`
          : 'Send my choices';
      };
      for (const o of opts) {
        const b = el(`<button type="button" class="chip chip-select" aria-pressed="false">${esc(o.label)}</button>`);
        b.addEventListener('click', () => {
          if (selected.has(o.label)) {
            selected.delete(o.label);
            b.setAttribute('aria-pressed', 'false');
          } else {
            if (selected.size >= max) { toast(`You can choose up to ${max}.`); return; }
            selected.add(o.label);
            b.setAttribute('aria-pressed', 'true');
          }
          refresh();
        });
        row.appendChild(b);
      }
      sendBtn.addEventListener('click', () => sendUserText([...selected].join(', ')));
      wrap.appendChild(row);
      wrap.appendChild(sendRow);
      bubble.appendChild(wrap);
    } else if (opts.length) {
      // 'free' (or unknown input kind): suggestions are writing prompts, not
      // multiple choice — tapping drops text into the composer for editing.
      const wrap = el(`<div class="suggest-block"></div>`);
      wrap.appendChild(el(`<p class="suggest-hint">Not sure where to start? Tap one to begin writing, or use your own words.</p>`));
      const row = el(`<div class="chip-row" role="group" aria-label="Writing prompts"></div>`);
      for (const o of opts) {
        const b = el(`<button type="button" class="chip">${esc(o.label)}</button>`);
        b.addEventListener('click', () => {
          input.value = o.label;
          input.focus();
        });
        row.appendChild(b);
      }
      wrap.appendChild(row);
      bubble.appendChild(wrap);
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

  /** A real-life prompt from the guide: "What would you like to bring into
   *  your real life in the next 24 hours?" Rendered as a calm card with an
   *  optional text input and Skip — never a demand. If the message carries
   *  an introductionId (an introduction in context), submitting saves the
   *  intention on that introduction; otherwise the answer is simply
   *  acknowledged warmly and nothing is stored anywhere. */
  async function renderRealLifePrompt(msg) {
    const wrap = el(`<div class="bubble-bot"></div>`);
    wrap.appendChild(el(`<p class="kicker">A gentle nudge</p>`));
    wrap.appendChild(el(`<p class="chat-text">${esc(msg.text || 'What would you like to bring into your real life in the next 24 hours?')}</p>`));
    const area = el(`<div class="suggest-block"></div>`);
    const ta = el(`<textarea class="input textarea" rows="2" maxlength="500" style="width:100%" aria-label="Your intention for the next 24 hours (optional)"></textarea>`);
    area.appendChild(ta);
    const row = el(`<div class="btn-row" style="margin-top:0.6rem"></div>`);
    const share = el(`<button type="button" class="btn btn-primary btn-small">Hold this intention</button>`);
    const skip = el(`<button type="button" class="btn btn-ghost btn-small">Skip</button>`);
    row.appendChild(share);
    row.appendChild(skip);
    area.appendChild(row);
    wrap.appendChild(area);
    thread.appendChild(wrap);
    scroll();
    announce(msg.text || 'A gentle question about the next 24 hours.');

    const done = (ack) => {
      area.innerHTML = '';
      area.appendChild(el(`<p class="chat-text" style="font-style:italic;color:var(--mist)">${esc(ack)}</p>`));
      scroll();
      announce(ack);
    };

    share.addEventListener('click', async () => {
      const text = ta.value.trim();
      share.disabled = true; skip.disabled = true;
      const introId = Number(msg.introductionId);
      try {
        if (introId && profileId) {
          await api.setRealLifeIntention(introId, profileId, text || 'Held quietly, in my own words.');
          done('Held with care. May it unfold gently in the next day.');
        } else {
          // No introduction in context — nothing to save to; acknowledge warmly.
          done(text
            ? 'Beautiful. Hold it gently — no need to announce it anywhere.'
            : 'No words needed. May the next 24 hours be kind to you.');
        }
      } catch (e) {
        share.disabled = false; skip.disabled = false;
        toast(api.friendlyError(e));
      }
    });
    skip.addEventListener('click', () => done('No pressure at all. These nudges come and go.'));
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
    } else if (kind === 'real_life_prompt') {
      await renderRealLifePrompt(msg);
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
      const data = await sendFn(profileId, sessionId, trimmed);
      typing.remove();
      rememberSession(data);
      const msgs = Array.isArray(data.messages) ? data.messages : [];
      for (const m of msgs) await renderBotMessage(m, data);
      // Proposals can also arrive top-level (not nested in a message).
      if (Array.isArray(data.proposals) && data.proposals.length) {
        await renderProposals(data.proposals, data.brief && data.brief.id);
      }
      renderQuickReplies(data.quickReplies);
      if (onTurn) await onTurn(data);
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
    try { stored = localStorage.getItem(sessionKey); } catch { /* private mode */ }
    if (!stored) { await startFresh(); return; }

    const typing = typingIndicator();
    try {
      const data = await resumeFn(profileId, stored);
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
      if (data.proposals && data.proposals.length) {
        await renderBotMessage({ kind: 'proposals', text: data.proposalsText || PROPOSALS_DEFAULT_TEXT, proposals: data.proposals }, data);
      }
      renderQuickReplies(data.quickReplies);
    } catch (e) {
      typing.remove();
      if (e instanceof api.ApiError && (e.status === 404 || e.status === 403)) {
        // Session gone or not ours — start clean.
        try { localStorage.removeItem(sessionKey); } catch { /* private mode */ }
        await startFresh();
      } else {
        showError(api.friendlyError(e));
      }
    }
  }

  async function startFresh() {
    const typing = typingIndicator();
    try {
      const data = await startFn(profileId);
      typing.remove();
      rememberSession(data);
      const msgs = Array.isArray(data.messages) ? data.messages : [];
      for (const m of msgs) await renderBotMessage(m, data);
      if (Array.isArray(data.proposals) && data.proposals.length) {
        await renderProposals(data.proposals, data.brief && data.brief.id);
      }
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
