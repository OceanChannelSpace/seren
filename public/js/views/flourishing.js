// Flourishing Check-In — optional, lightweight, private.
// Renders questions from GET /api/flourishing/questions generically by kind
// (yesno | scale1to5 | choice | text), saves via POST /api/flourishing/checkin,
// and shows past check-ins from GET /api/flourishing/checkins/mine.
// Framing is always "your reported pattern" — never "results" or "progress".
// Also hosts the suggestion-frequency control (recFrequency).

import * as api from '../api.js';
import {
  el, esc, pageShell, errorBanner, loading, emptyState, card,
  toast, announce, field, textArea, textInput,
} from '../ui.js';
import { get } from '../state.js';
import { navigate } from '../router.js';

const FREQ_OPTIONS = [
  { value: 'daily', label: 'More suggestions', hint: 'Daily' },
  { value: 'weekly', label: 'Same as now', hint: 'Weekly' },
  { value: 'paused', label: 'Fewer for now', hint: 'Paused' },
];

/** Render one question into a card, binding into the shared answers map. */
function questionCard(q, answers) {
  const wrap = el(`<div class="card checkin-q"></div>`);
  wrap.appendChild(el(`<h3>${esc(q.text)}</h3>`));
  const kind = q.kind || 'text';

  if (kind === 'yesno') {
    const row = el(`<div class="btn-row" style="margin-top:0" role="group" aria-label="${esc(q.text)}"></div>`);
    for (const [value, label] of [['yes', 'Yes'], ['no', 'No']]) {
      const b = el(`<button type="button" class="btn btn-secondary btn-small" aria-pressed="false">${label}</button>`);
      b.addEventListener('click', () => {
        answers[q.key] = value;
        for (const sib of row.querySelectorAll('button')) sib.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', 'true');
      });
      row.appendChild(b);
    }
    wrap.appendChild(row);
  } else if (kind === 'scale1to5') {
    const row = el(`<div class="scale-row" role="group" aria-label="${esc(q.text)}"></div>`);
    for (let n = 1; n <= 5; n++) {
      const b = el(`<button type="button" class="scale-opt" aria-pressed="false" aria-label="${n} of 5">${n}</button>`);
      b.addEventListener('click', () => {
        answers[q.key] = n;
        for (const sib of row.querySelectorAll('button')) sib.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', 'true');
      });
      row.appendChild(b);
    }
    wrap.appendChild(row);
    wrap.appendChild(el(`<div class="scale-ends"><span>Not at all</span><span>Very much</span></div>`));
  } else if (kind === 'choice' && Array.isArray(q.choices) && q.choices.length) {
    // Server-provided options; the submitted answer must be one of the
    // exact choice values (validated server-side).
    const row = el(`<div class="chip-row" role="group" aria-label="${esc(q.text)}" style="margin-top:0"></div>`);
    for (const choice of q.choices) {
      const label = String(choice).charAt(0).toUpperCase() + String(choice).slice(1);
      const b = el(`<button type="button" class="chip chip-select" aria-pressed="false">${esc(label)}</button>`);
      b.addEventListener('click', () => {
        answers[q.key] = choice;
        for (const sib of row.querySelectorAll('button')) sib.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', 'true');
      });
      row.appendChild(b);
    }
    wrap.appendChild(row);
  } else {
    // 'text' or anything unknown: a free response. Nothing here is a test.
    const ta = textArea({ placeholder: 'Whatever feels true. Optional.', maxLength: 2000, rows: 2 });
    ta.setAttribute('aria-label', q.text);
    ta.addEventListener('input', () => { answers[q.key] = ta.value; });
    wrap.appendChild(ta);
  }

  wrap.appendChild(el(`<p class="field-hint" style="margin-bottom:0">Optional — answer only what feels right.</p>`));
  return wrap;
}

function checkinEntry(questionTexts, createdAt, rows) {
  const wrap = el(`<div class="checkin-entry"></div>`);
  const when = createdAt ? new Date(createdAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : 'A past check-in';
  wrap.appendChild(el(`<p class="checkin-date">${esc(when)}</p>`));
  const dl = el(`<dl></dl>`);
  for (const r of rows) {
    const label = questionTexts.get(r.questionKey) || r.questionKey || 'Reflection';
    const value = String(r.answer ?? '').trim();
    if (!value) continue;
    dl.appendChild(el(`<dt>${esc(label)}</dt>`));
    dl.appendChild(el(`<dd>${esc(value)}</dd>`));
  }
  if (!dl.children.length) {
    wrap.appendChild(el(`<p class="field-hint" style="margin:0">Nothing recorded.</p>`));
  } else {
    wrap.appendChild(dl);
  }
  return wrap;
}

export async function renderFlourishing(root) {
  const profileId = get('profileId');
  const { root: shell, body } = pageShell('Flourishing check-in', 'Optional, lightweight, private');
  root.appendChild(shell);
  const banner = errorBanner();
  body.appendChild(banner.node);
  const content = el(`<div></div>`);
  body.appendChild(content);
  content.appendChild(loading('Loading…'));

  let questions = [];
  let checkins = [];
  try {
    const [qRes, cRes] = await Promise.all([
      api.getFlourishingQuestions(),
      api.getMyCheckins(profileId).catch(() => ({ checkins: [] })),
    ]);
    questions = qRes.questions || [];
    checkins = cRes.checkins || [];
  } catch (e) {
    content.innerHTML = '';
    banner.show(api.friendlyError(e));
    return;
  }
  content.innerHTML = '';

  const intro = el(`<div class="card"></div>`);
  intro.appendChild(el(`<p style="margin:0;max-width:38rem">A few gentle questions, whenever you like. Your answers are private to you — they shape nothing public, unlock nothing, and are never scored. This is simply a way to notice your own reported pattern over time.</p>`));
  content.appendChild(intro);

  // --- the questions ---
  const answers = {};
  if (questions.length) {
    const form = el(`<div></div>`);
    for (const q of questions) form.appendChild(questionCard(q, answers));
    const row = el(`<div class="btn-row"></div>`);
    const save = el(`<button type="button" class="btn btn-primary">Save this check-in</button>`);
    save.addEventListener('click', async () => {
      const responses = Object.entries(answers)
        .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
        .map(([questionKey, answer]) => ({ questionKey, answer }));
      if (!responses.length) {
        toast('Answer at least one question to save a check-in — or skip it entirely. Both are fine.');
        return;
      }
      save.disabled = true;
      try {
        await api.submitCheckin(profileId, responses);
        // The "fewer / same / more suggestions" answer is a live preference,
        // not just a record: wire it to recFrequency so SEREN honors it.
        const volume = responses.find((r) => r.questionKey === 'suggestion_volume');
        if (volume) {
          const freq = { more: 'daily', same: 'weekly', fewer: 'paused' }[String(volume.answer)];
          if (freq) {
            try {
              await api.updateProfile(profileId, { consentSettings: { recFrequency: freq } });
            } catch { /* the check-in itself saved; the pace update is best-effort */ }
          }
        }
        toast('Saved. Thank you for noticing.');
        announce('Check-in saved.');
        navigate('#/flourishing'); // re-render to show the new entry
      } catch (e) {
        banner.show(api.friendlyError(e));
      } finally {
        save.disabled = false;
      }
    });
    row.appendChild(save);
    form.appendChild(row);
    content.appendChild(form);
  } else {
    content.appendChild(el(`<p class="field-hint">No questions are available right now. Please check back later.</p>`));
  }

  // --- suggestion frequency ("fewer / same / more") ---
  const freqCard = el(`<div class="card"></div>`);
  freqCard.appendChild(el(`<h3 style="margin-top:0">Suggestions, at your pace</h3>`));
  freqCard.appendChild(el(`<p class="field-hint" style="margin-top:0">How often should SEREN offer you new suggestions? Fewer is a complete and respected choice.</p>`));
  const seg = el(`<div class="seg" role="group" aria-label="Suggestion frequency"></div>`);
  let current = 'weekly';
  try {
    const me = await api.getProfile(profileId);
    current = (me.consentSettings && me.consentSettings.recFrequency) || 'weekly';
  } catch { /* non-fatal */ }
  for (const opt of FREQ_OPTIONS) {
    const b = el(`<button type="button" aria-pressed="${opt.value === current}">${esc(opt.label)}</button>`);
    b.title = opt.hint;
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await api.updateProfile(profileId, { consentSettings: { recFrequency: opt.value } });
        for (const sib of seg.querySelectorAll('button')) sib.setAttribute('aria-pressed', String(sib === b));
        current = opt.value;
        toast(opt.value === 'paused'
          ? 'Suggestions paused. Take all the time you need.'
          : 'Suggestion pace updated.');
        announce('Suggestion pace updated.');
      } catch (e) {
        toast(api.friendlyError(e));
      } finally {
        b.disabled = false;
      }
    });
    seg.appendChild(b);
  }
  freqCard.appendChild(seg);
  freqCard.appendChild(el(`<p class="field-hint">Pausing stops new suggestions. Your connections and circles stay exactly as they are.</p>`));
  content.appendChild(freqCard);

  // --- past check-ins: "your reported pattern" ---
  content.appendChild(el(`<h2 class="section-title">Your reported pattern</h2>`));
  content.appendChild(el(`<p class="section-note">What you shared, in your own words. Not results, not progress — just a record of noticing.</p>`));
  if (!checkins.length) {
    content.appendChild(emptyState({
      title: 'No check-ins yet',
      body: 'When you save one, it will appear here — quietly, for your eyes only.',
    }));
  } else {
    // The server stores one row per answered question; rows sharing a
    // createdAt timestamp are one check-in submission.
    const questionTexts = new Map(questions.map((q) => [q.key, q.text]));
    const batches = new Map();
    for (const r of checkins) {
      const key = r.createdAt || String(r.id);
      if (!batches.has(key)) batches.set(key, []);
      batches.get(key).push(r);
    }
    const hist = el(`<div class="checkin-history"></div>`);
    for (const [createdAt, rows] of batches) hist.appendChild(checkinEntry(questionTexts, createdAt, rows));
    content.appendChild(hist);
  }
}
