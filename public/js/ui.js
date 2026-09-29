// SEREN UI helpers — shared components and view plumbing.
// Views are functions: render(root, ctx) where ctx = { params, profile, meta, ... }.
// Helpers here keep styling, accessibility, and error/loading patterns consistent.

import { friendlyError, ApiError } from './api.js';
import { get, set } from './state.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** Page scaffold: hero heading + body. Returns { root, body }. */
export function pageShell(title, kicker) {
  const root = el(`
    <section class="page" aria-label="${esc(title)}">
      ${kicker ? `<p class="kicker">${esc(kicker)}</p>` : ''}
      <h1 class="page-title">${esc(title)}</h1>
      <div class="page-body"></div>
    </section>`);
  return { root, body: root.querySelector('.page-body') };
}

/** Inline error banner. Call banner(msg) to set text and show. */
export function errorBanner() {
  const node = el(`<div class="banner banner-error" role="alert" hidden></div>`);
  return {
    node,
    show(msg) { node.textContent = msg; node.hidden = false; node.scrollIntoView({ block: 'nearest' }); },
    clear() { node.textContent = ''; node.hidden = true; },
  };
}

export function infoBanner() {
  const node = el(`<div class="banner banner-info" hidden></div>`);
  return {
    node,
    show(msg) { node.textContent = msg; node.hidden = false; },
    clear() { node.textContent = ''; node.hidden = true; },
  };
}

/** Screen-reader + toast status updates. */
export function announce(msg) {
  const region = document.getElementById('status-region');
  if (region) region.textContent = msg;
}

/** "1 introduction suggestion" / "3 introduction suggestions". */
export function pluralize(count, singular, plural = `${singular}s`) {
  return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
}

export function toast(msg, kind = 'info') {
  const region = document.getElementById('toast-region');
  if (!region) { announce(msg); return; }
  const t = el(`<div class="toast toast-${kind}" role="status">${esc(msg)}</div>`);
  region.appendChild(t);
  setTimeout(() => t.classList.add('toast-out'), 3600);
  setTimeout(() => t.remove(), 4200);
}

/** Loading skeleton block. */
export function loading(text = 'Loading…') {
  return el(`<div class="loading-block" aria-busy="true"><span class="spinner" aria-hidden="true"></span><span>${esc(text)}</span></div>`);
}

/** Empty state with an optional action. */
export function emptyState({ title, body, actionLabel, actionHref }) {
  const node = el(`
    <div class="empty-state">
      <div class="empty-mark" aria-hidden="true">✦</div>
      <h2>${esc(title)}</h2>
      ${body ? `<p>${esc(body)}</p>` : ''}
      ${actionLabel ? `<a class="btn btn-primary" href="${esc(actionHref || '#/')}">${esc(actionLabel)}</a>` : ''}
    </div>`);
  return node;
}

/**
 * Chip multi-select group (checkbox-style). Returns { node, get(), set(values) }.
 * options: [{ value, label, hint? }]
 */
export function chipGroup({ name, options, values = [], max = Infinity, ariaLabel }) {
  const node = el(`<div class="chip-group" role="group" aria-label="${esc(ariaLabel || name)}"></div>`);
  const selected = new Set(values);
  const buttons = new Map();
  for (const opt of options) {
    const b = el(`<button type="button" class="chip" aria-pressed="${selected.has(opt.value)}"
      title="${esc(opt.hint || '')}">${esc(opt.label)}</button>`);
    b.addEventListener('click', () => {
      if (selected.has(opt.value)) { selected.delete(opt.value); }
      else {
        if (selected.size >= max) { toast(`You can choose up to ${max}.`); return; }
        selected.add(opt.value);
      }
      b.setAttribute('aria-pressed', String(selected.has(opt.value)));
    });
    buttons.set(opt.value, b);
    node.appendChild(b);
  }
  return {
    node,
    get: () => [...selected],
    set(vals) {
      selected.clear();
      for (const v of vals || []) selected.add(v);
      for (const [v, b] of buttons) b.setAttribute('aria-pressed', String(selected.has(v)));
    },
  };
}

/** Single-select chip group (radio-style). Returns { node, get(), set(value) }. */
export function chipSingle({ name, options, value = null, ariaLabel }) {
  const node = el(`<div class="chip-group" role="radiogroup" aria-label="${esc(ariaLabel || name)}"></div>`);
  let current = value;
  const buttons = new Map();
  for (const opt of options) {
    const b = el(`<button type="button" role="radio" class="chip" aria-checked="${current === opt.value}"
      title="${esc(opt.hint || '')}">${esc(opt.label)}</button>`);
    b.addEventListener('click', () => {
      current = opt.value;
      for (const [v, btn] of buttons) btn.setAttribute('aria-checked', String(v === current));
    });
    buttons.set(opt.value, b);
    node.appendChild(b);
  }
  return {
    node,
    get: () => current,
    set(v) {
      current = v;
      for (const [val, btn] of buttons) btn.setAttribute('aria-checked', String(val === current));
    },
  };
}

/** Labeled field wrapper. */
export function field(labelText, inputNode, { hint, id } = {}) {
  const wrap = el(`<div class="field"></div>`);
  if (labelText) {
    const label = el(`<label class="field-label"${id ? ` for="${esc(id)}"` : ''}>${esc(labelText)}</label>`);
    wrap.appendChild(label);
  }
  wrap.appendChild(inputNode);
  if (hint) wrap.appendChild(el(`<p class="field-hint">${esc(hint)}</p>`));
  return wrap;
}

export function textInput({ id, value = '', placeholder = '', maxLength, required = false, type = 'text', autocomplete }) {
  const attrs = [
    `type="${type}"`, id ? `id="${esc(id)}"` : '', value !== undefined ? `value="${esc(value)}"` : '',
    placeholder ? `placeholder="${esc(placeholder)}"` : '', maxLength ? `maxlength="${maxLength}"` : '',
    required ? 'required' : '', autocomplete ? `autocomplete="${esc(autocomplete)}"` : '',
  ].filter(Boolean).join(' ');
  return el(`<input class="input" ${attrs}>`);
}

export function textArea({ id, value = '', placeholder = '', maxLength, rows = 4, required = false }) {
  const n = el(`<textarea class="input textarea"${id ? ` id="${esc(id)}"` : ''}${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}${maxLength ? ` maxlength="${maxLength}"` : ''} rows="${rows}"${required ? ' required' : ''}></textarea>`);
  n.value = value || '';
  return n;
}

export function selectInput({ id, options, value = '', required = false, ariaLabel }) {
  const n = el(`<select class="input select"${id ? ` id="${esc(id)}"` : ''}${required ? ' required' : ''}${ariaLabel ? ` aria-label="${esc(ariaLabel)}"` : ''}></select>`);
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.value === value) opt.selected = true;
    n.appendChild(opt);
  }
  return n;
}

/** Runs an async submit handler with button loading/disabled semantics. */
export function wireSubmit(form, button, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (button.disabled) return;
    const original = button.textContent;
    button.disabled = true;
    button.classList.add('btn-loading');
    button.textContent = 'Working…';
    try {
      await handler();
    } finally {
      button.disabled = false;
      button.classList.remove('btn-loading');
      button.textContent = original;
    }
  });
}

/** Confirm dialog via native <dialog>. Resolves true/false. */
export function confirmDialog({ title, body, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const dlg = el(`
      <dialog class="confirm-dialog">
        <h2>${esc(title)}</h2>
        ${body ? `<p>${esc(body)}</p>` : ''}
        <div class="dialog-actions">
          <button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${esc(confirmLabel)}</button>
        </div>
      </dialog>`);
    const close = (val) => { dlg.close(); dlg.remove(); resolve(val); };
    dlg.querySelector('[data-act="cancel"]').addEventListener('click', () => close(false));
    dlg.querySelector('[data-act="ok"]').addEventListener('click', () => close(true));
    dlg.addEventListener('cancel', () => close(false));
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}

/** Card wrapper. */
export function card(children) {
  const c = el(`<article class="card"></article>`);
  if (children) for (const ch of [].concat(children)) c.appendChild(ch);
  return c;
}

/** Relative "x time ago" for ISO timestamps. */
export function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function avatarFor(name) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return el(`<span class="avatar" aria-hidden="true">${esc(initial)}</span>`);
}

/** Status pill for introduction statuses. */
const STATUS_COPY = {
  proposed: 'Awaiting response',
  question: 'Question for you',
  accepted: 'Connected',
  accepted_with_boundary: 'Connected · with a boundary',
  declined: 'Declined',
  declined_hidden: 'Passed',
  withdrawn: 'Withdrawn',
  ended: 'Ended',
};

export function statusPill(status) {
  const tone = status === 'accepted' || status === 'accepted_with_boundary' ? 'good'
    : status === 'declined' || status === 'declined_hidden' ? 'muted'
    : status === 'proposed' || status === 'question' ? 'pending' : 'muted';
  return el(`<span class="pill pill-${tone}">${esc(STATUS_COPY[status] || status)}</span>`);
}

/** Standard "run with loading + banner" wrapper for view data fetching. */
export async function withView(root, body, banner, fn) {
  const loader = loading();
  body.appendChild(loader);
  banner.clear();
  try {
    await fn();
  } catch (e) {
    banner.show(friendlyError(e));
  } finally {
    loader.remove();
  }
}

// Re-exported from api.js so views can import all UI helpers from one place.
export { friendlyError };
