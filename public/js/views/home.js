// SEREN guided home — the AI superconnector entry point.
// Authenticated users land here instead of a profile grid: they tell SEREN
// what would feel meaningful, answer a few follow-up questions, and receive
// thoughtful, consent-first introduction proposals. No scores, no swiping.
import { get, set } from '../state.js';
import { ApiError, friendlyError, createBriefFromSession } from '../api.js';
import { navigate } from '../router.js';
import { renderWelcome } from './welcome.js';
import {
  esc, el, pageShell, errorBanner, toast, loading, emptyState, card,
  field, textArea, chipGroup, chipSingle, announce, pluralize,
} from '../ui.js';

/** Thin local fetch wrapper mirroring api.js semantics (guide endpoints are new). */
async function guideRequest(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const e = (json && json.error) || {};
    throw new ApiError(res.status, e.code || 'request_failed', e.message || `Request failed (${res.status})`, e.details);
  }
  return json;
}

const STARTERS = [
  'I’m looking for a grounded spiritual friend.',
  'I want to meet someone to discuss consciousness and AI.',
  'I’m looking for a meditation or breathwork practice partner.',
  'I want to explore dreamwork or symbolism with someone thoughtful.',
  'I’d like to find a local conscious community.',
  'I’m building a project and need aligned collaborators.',
  'I want a small discussion circle around a spiritual or esoteric topic.',
  'I’m looking for a mentor, teacher, or learning exchange.',
  'I’m curious and open, but I’m not sure exactly what I need.',
];

const MIN_TEXT = 10;

export async function renderHome(root, ctx) {
  const profileId = get('profileId');
  if (!profileId) {
    // Not signed in — the classic welcome landing still owns this route.
    await renderWelcome(root, ctx);
    return;
  }

  const { root: shell, body } = pageShell(
    'Who — or what kind of connection — would feel meaningful right now?',
    'Begin here',
  );
  shell.classList.add('guide-hero');
  root.appendChild(shell);
  const banner = errorBanner();
  body.appendChild(banner.node);

  renderAsk();

  function renderAsk(prefill = '') {
    body.querySelectorAll('.guide-pane').forEach((n) => n.remove());
    banner.clear();
    const pane = el(`<div class="guide-pane"></div>`);
    body.appendChild(pane);

    const askCard = card();
    const area = textArea({
      id: 'guide-text',
      value: prefill,
      placeholder: 'Tell SEREN in your own words…',
      maxLength: 600,
      rows: 4,
    });
    askCard.appendChild(field(
      'What are you seeking?',
      area,
      { id: 'guide-text', hint: 'A sentence or two is plenty. Nothing here is shared with anyone.' },
    ));
    const submit = el(`<button type="button" class="btn btn-primary">Guide me</button>`);
    const row = el(`<div class="btn-row" style="margin-top:1rem"></div>`);
    row.appendChild(submit);
    askCard.appendChild(row);
    pane.appendChild(askCard);

    const starterCard = card();
    starterCard.classList.add('guide-starters');
    starterCard.appendChild(el(`<h3>Or start with one of these</h3>`));
    const chips = el(`<div class="chip-group" role="group" aria-label="Intention starters"></div>`);
    for (const s of STARTERS) {
      const b = el(`<button type="button" class="chip">${esc(s)}</button>`);
      b.addEventListener('click', () => startGuide(s));
      chips.appendChild(b);
    }
    starterCard.appendChild(chips);
    pane.appendChild(starterCard);

    pane.appendChild(secondaryLinks());
    announce('What kind of connection would feel meaningful right now?');

    async function startGuide(text) {
      const trimmed = (text || '').trim();
      if (trimmed.length < MIN_TEXT) {
        banner.show(`Share a little more — at least ${MIN_TEXT} characters — so SEREN can guide you well.`);
        area.focus();
        return;
      }
      submit.disabled = true;
      pane.appendChild(loading('Listening…'));
      banner.clear();
      try {
        const data = await guideRequest('POST', '/api/guide/sessions', { profileId, text: trimmed });
        const session = data.session || data;
        renderQuestions(session, session.questions || []);
      } catch (e) {
        pane.querySelector('.loading-block')?.remove();
        banner.show(friendlyError(e));
        const retry = el(`<p style="margin-top:1rem"><a href="#/discover">Prefer to browse? Open Discover instead.</a></p>`);
        pane.appendChild(retry);
      } finally {
        submit.disabled = false;
      }
    }

    submit.addEventListener('click', () => startGuide(area.value));
  }

  function renderQuestions(session, questions) {
    body.querySelectorAll('.guide-pane').forEach((n) => n.remove());
    banner.clear();
    if (!questions.length) { finishGuide(); return; }

    const pane = el(`<div class="guide-pane"></div>`);
    body.appendChild(pane);
    let index = 0;

    function showQuestion() {
      pane.innerHTML = '';
      const q = questions[index];
      if (!q) { finishGuide(); return; }

      const qc = card();
      qc.appendChild(el(`<p class="kicker">A couple of quick questions</p>`));
      qc.appendChild(el(`<p class="request-meta">Question ${index + 1} of ${questions.length} · take your time</p>`));
      qc.appendChild(el(`<h3 style="margin:0.75rem 0 1rem">${esc(q.prompt)}</h3>`));

      let getValue;
      if (q.type === 'multi') {
        const g = chipGroup({
          name: `q-${q.id}`,
          options: (q.options || []).map((o) => ({ value: o.value, label: o.label })),
          ariaLabel: q.prompt,
        });
        qc.appendChild(g.node);
        getValue = () => g.get();
      } else if (q.type === 'single' && Array.isArray(q.options) && q.options.length) {
        const g = chipSingle({
          name: `q-${q.id}`,
          options: (q.options || []).map((o) => ({ value: o.value, label: o.label })),
          ariaLabel: q.prompt,
        });
        qc.appendChild(g.node);
        getValue = () => g.get();
      } else {
        const t = textArea({ id: `q-${q.id}`, placeholder: 'Share what feels right…', maxLength: 600, rows: 3 });
        qc.appendChild(field('Your answer', t, { id: `q-${q.id}` }));
        getValue = () => t.value.trim();
      }

      const row = el(`<div class="btn-row" style="margin-top:1.25rem"></div>`);
      if (q.skippable !== false) {
        const skip = el(`<button type="button" class="btn btn-ghost">Skip for now</button>`);
        skip.addEventListener('click', () => answerQuestion(q, null, true));
        row.appendChild(skip);
      }
      const next = el(`<button type="button" class="btn btn-primary">${index + 1 < questions.length ? 'Continue' : 'See suggestions'}</button>`);
      next.addEventListener('click', () => {
        const v = getValue();
        const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
        if (empty && q.skippable === false) {
          banner.show('Please choose an answer, or pick one that feels closest.');
          return;
        }
        answerQuestion(q, empty ? null : v, empty);
      });
      row.appendChild(next);
      qc.appendChild(row);
      pane.appendChild(qc);
      pane.appendChild(secondaryLinks());
      announce(q.prompt);

      async function answerQuestion(question, value, skipped) {
        next.disabled = true;
        banner.clear();
        try {
          const payload = skipped
            ? { profileId, questionId: question.id, value: null, skipped: true }
            : { profileId, questionId: question.id, value };
          const data = await guideRequest('POST', `/api/guide/sessions/${session.id}/answer`, payload);
          if (data.complete) {
            finishGuide();
            return;
          }
          const rest = data.questions || [];
          if (rest.length) {
            questions.splice(index + 1, questions.length, ...rest);
          }
          index += 1;
          if (index >= questions.length) finishGuide();
          else showQuestion();
        } catch (e) {
          banner.show(friendlyError(e));
        } finally {
          next.disabled = false;
        }
      }
    }

    /** Guide complete → turn the session into a connection brief for review.
     *  The brief review screen (views/brief.js) owns approvals + proposals.
     *  Falls back to legacy inline proposals if the briefs API isn't there. */
    async function finishGuide() {
      try {
        const { brief } = await createBriefFromSession(session.id);
        set({ brief, guideSessionId: session.id });
        navigate('#/brief');
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          renderProposals([]);
          return;
        }
        banner.show(friendlyError(e));
      }
    }

    showQuestion();
  }

  function renderProposals(proposals) {
    body.querySelectorAll('.guide-pane').forEach((n) => n.remove());
    banner.clear();
    const pane = el(`<div class="guide-pane"></div>`);
    body.appendChild(pane);

    const head = card();
    head.appendChild(el(`<p class="kicker">Thoughtful introductions</p>`));
    head.appendChild(el(`<h3 style="margin:0.5rem 0">Here is what SEREN noticed</h3>`));
    head.appendChild(el(`<p class="about-text">These are gentle suggestions, not certainties. Request an introduction only if it feels genuinely aligned — both people opt in before anything is shared.</p>`));
    pane.appendChild(head);

    const list = (proposals || []).slice(0, 3);
    if (!list.length) {
      pane.appendChild(emptyState({
        title: 'Nothing surfaced this time.',
        body: 'That is okay — not every moment has a match. Try different words, or browse quietly for a while.',
        actionLabel: 'Start over',
        actionHref: '#/',
      }));
    }
    for (const p of list) {
      pane.appendChild(proposalCard(p));
    }
    pane.appendChild(secondaryLinks());
    announce(list.length ? `${pluralize(list.length, 'introduction suggestion')}.` : 'No suggestions this time.');
  }


  function secondaryLinks() {
    const wrap = el(`<p class="guide-secondary"></p>`);
    wrap.appendChild(el(`<span>Prefer to browse? </span>`));
    wrap.appendChild(el(`<a href="#/discover">Discover</a>`));
    wrap.appendChild(el(`<span> · </span>`));
    wrap.appendChild(el(`<a href="#/modes">Explore modes</a>`));
    wrap.appendChild(el(`<span> · </span>`));
    wrap.appendChild(el(`<a href="#/circles">Your circles</a>`));
    return wrap;
  }
}

/** A proposal card. briefId (optional) is passed through to the staged
 *  request composer so the recipient sees the requester's approved text.
 *  Exported for reuse by the brief review screen (views/brief.js). */
export function proposalCard(p, briefId) {
  const c = card();
  c.classList.add('proposal-card');
  const cand = p.candidate || {};
  const sub = [cand.pronouns, cand.region].filter(Boolean).join(' · ');
  const head = el(`<div class="person-head"></div>`);
  head.appendChild(el(`<h3>${esc(cand.name || 'A fellow traveler')}${cand.isSeed ? ' <span class="pill pill-muted">demo</span>' : ''}</h3>`));
  if (sub) head.appendChild(el(`<p class="person-sub">${esc(sub)}</p>`));
  c.appendChild(head);

  const typeLabel = p.connectionTypeLabel || p.connectionType;
  if (typeLabel) {
    c.appendChild(el(`<p class="request-meta" style="margin-top:0.5rem">${esc(typeLabel)}</p>`));
  }

  const fits = Array.isArray(p.whyItFits) ? p.whyItFits
    : typeof p.whyItFits === 'string' && p.whyItFits ? [p.whyItFits] : null;
  if (fits && fits.length) {
    c.appendChild(el(`<h4 class="proposal-label">Why this might fit</h4>`));
    const ul = el(`<ul class="reason-list"></ul>`);
    for (const r of fits.slice(0, 4)) ul.appendChild(el(`<li>${esc(r)}</li>`));
    c.appendChild(ul);
  }

  // The candidate's own approved words — shown only when they consented to share.
  if (p.candidateSharedText) {
    c.appendChild(el(`<h4 class="proposal-label">In their own words</h4>`));
    c.appendChild(el(`<p class="shared-words">${esc(p.candidateSharedText)}</p>`));
  }

  // Honest reciprocal benefit — never a score, never invented certainty.
  const serve = Array.isArray(p.forCandidate) ? p.forCandidate.join(' ')
    : (typeof p.forCandidate === 'string' ? p.forCandidate : '');
  if (serve) {
    c.appendChild(el(`<h4 class="proposal-label">Why this might serve them</h4>`));
    c.appendChild(el(`<p class="about-text">${esc(serve)}</p>`));
  }

  const first = p.suggestedFirstStep || p.suggestedFirst;
  if (first) {
    const callout = el(`<div class="first-step"></div>`);
    callout.appendChild(el(`<h4>A gentle first step</h4>`));
    callout.appendChild(el(`<p>${esc(first)}</p>`));
    c.appendChild(callout);
  }

  const actions = el(`<div class="match-actions"></div>`);
  const reqBtn = el(`<button type="button" class="btn btn-primary btn-small">Request introduction</button>`);
  reqBtn.addEventListener('click', () => {
    // Hands off to the match detail composer, which carries the full
    // staged-consent request flow. briefId lets the recipient see the
    // requester's approved brief text.
    navigate(`#/discover/match?id=${cand.id}${briefId ? `&briefId=${briefId}` : ''}`);
  });
  const notNow = el(`<button type="button" class="btn btn-ghost btn-small">Not now</button>`);
  notNow.addEventListener('click', () => {
    c.remove();
    announce('Suggestion dismissed.');
    toast('Set aside quietly. Nothing was sent.');
    const remaining = c.closest('.guide-pane')?.querySelectorAll('.proposal-card');
    if (remaining && !remaining.length) {
      const again = el(`<p class="guide-secondary">Take your time — <a href="#/">ask again</a> whenever you like, or <a href="#/discover">browse quietly</a>.</p>`);
      c.closest('.guide-pane').appendChild(again);
    }
  });
  actions.appendChild(reqBtn);
  actions.appendChild(notNow);
  c.appendChild(actions);
  return c;
}
