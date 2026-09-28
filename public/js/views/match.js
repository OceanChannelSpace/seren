// Match detail — a person's shared profile plus the intentional request composer.
// Only privacy-filtered fields are rendered; contact details never appear here.

import { get, metaList, practiceLabel, intentionLabel, formatLabel, connectionTypeByValue } from '../state.js';
import * as api from '../api.js';
import { navigate } from '../router.js';
import {
  esc, el, pageShell, errorBanner, toast, loading, emptyState,
  field, textArea, selectInput, wireSubmit, card, avatarFor,
  confirmDialog, announce,
} from '../ui.js';

const MESSAGE_MIN = 20;
const MESSAGE_MAX = 500; // server cap

function chipsFor(values, labelFn) {
  const row = el(`<div class="chip-row"></div>`);
  for (const v of values || []) {
    row.appendChild(el(`<span class="chip chip-static">${esc(labelFn(v))}</span>`));
  }
  return row;
}

function fillTemplate(text, person) {
  const practices = (person.practices || []).map(practiceLabel);
  const interest = practices[0] || 'our shared path';
  return text
    .replace(/\{interest\}/gi, interest)
    .replace(/\{practice\}/gi, interest)
    .replace(/\{topic\}/gi, 'this path')
    .replace(/\{circle\}/gi, 'circle')
    .replace(/\{cadence\}/gi, 'now and then');
}

export async function renderMatchDetail(root, ctx) {
  const profileId = get('profileId');
  const targetId = Number(ctx.params.id);

  if (!targetId) {
    root.appendChild(emptyState({ title: 'No one selected.', actionLabel: 'Back to Discover', actionHref: '#/discover' }));
    return;
  }
  if (targetId === profileId) {
    navigate('#/me');
    return;
  }

  const { root: shell, body } = pageShell('Profile', 'Shared with consent');
  root.appendChild(shell);
  const banner = errorBanner();
  body.appendChild(banner.node);
  const content = el(`<div></div>`);
  body.appendChild(content);
  content.appendChild(loading('Loading profile…'));

  let person;
  try {
    person = await api.getProfile(targetId);
  } catch (e) {
    content.innerHTML = '';
    content.appendChild(emptyState({
      title: "This person isn't available.",
      body: e instanceof api.ApiError && e.status === 404
        ? 'They may have paused discovery or left the community.'
        : api.friendlyError(e),
      actionLabel: 'Back to Discover',
      actionHref: '#/discover',
    }));
    return;
  }
  content.innerHTML = '';

  // --- shared profile ---
  const profileCard = card();
  const head = el(`<div class="detail-head"></div>`);
  const av = avatarFor(person.name);
  av.classList.add('avatar-lg');
  head.appendChild(av);
  const who = el(`<div></div>`);
  const sub = [person.pronouns, person.region].filter(Boolean).join(' · ');
  who.appendChild(el(`<h2>${esc(person.name)}${person.isSeed ? ' <span class="pill pill-muted">demo</span>' : ''}</h2>`));
  if (sub) who.appendChild(el(`<p class="person-sub">${esc(sub)}</p>`));
  head.appendChild(who);
  profileCard.appendChild(head);

  if (person.about) {
    profileCard.appendChild(el(`<div class="detail-section"><h3>About</h3></div>`));
    profileCard.appendChild(el(`<p class="about-text">${esc(person.about)}</p>`));
  }

  const practices = person.practices || [];
  if (practices.length) {
    const s = el(`<div class="detail-section"><h3>Practices</h3></div>`);
    s.appendChild(chipsFor(practices, practiceLabel));
    if (person.practicesOther) s.appendChild(el(`<p class="about-text">${esc(person.practicesOther)}</p>`));
    profileCard.appendChild(s);
  }

  const intentions = person.intentions || [];
  if (intentions.length || person.intentionsOther) {
    const s = el(`<div class="detail-section"><h3>Intentions</h3></div>`);
    if (intentions.length) s.appendChild(chipsFor(intentions, intentionLabel));
    if (person.intentionsOther) s.appendChild(el(`<p class="about-text">${esc(person.intentionsOther)}</p>`));
    profileCard.appendChild(s);
  }

  // Ways to connect — from prefs + connectionPrefs, whatever is shared.
  const prefs = person.prefs || {};
  const cp = person.connectionPrefs || {};
  const ways = [];
  if (Array.isArray(prefs.formats) && prefs.formats.length) ways.push(['Format', prefs.formats.map(formatLabel).join(', ')]);
  if (prefs.localRemote) ways.push(['Local or remote', prefs.localRemote === 'local' ? 'Local' : prefs.localRemote === 'remote' ? 'Remote' : 'Either']);
  if (Array.isArray(prefs.languages) && prefs.languages.length) ways.push(['Languages', prefs.languages.join(', ')]);
  if (cp.availability) ways.push(['Availability', cp.availability]);
  if (ways.length) {
    const s = el(`<div class="detail-section"><h3>Ways to connect</h3></div>`);
    const dl = el(`<dl style="margin:0.5rem 0 0;display:grid;gap:0.4rem"></dl>`);
    for (const [k, v] of ways) {
      dl.appendChild(el(`<div style="display:flex;gap:0.75rem"><dt style="color:var(--mist-dim);min-width:8rem">${esc(k)}</dt><dd style="margin:0">${esc(v)}</dd></div>`));
    }
    s.appendChild(dl);
    profileCard.appendChild(s);
  }

  profileCard.appendChild(el(`
    <div class="privacy-note">
      Only what is shared here is visible. Contact details are never shown before mutual consent.
    </div>`));
  content.appendChild(profileCard);

  // --- request composer ---
  const composerCard = card();
  composerCard.appendChild(el(`<h2 style="margin-top:0">Send an intentional request</h2>`));
  composerCard.appendChild(el(`<p style="color:var(--mist)">Choose the kind of connection, then write a thoughtful note. They can accept, accept with a boundary, ask a question, or decline — all with dignity.</p>`));

  const form = el(`<form novalidate></form>`);
  const formBanner = errorBanner();
  form.appendChild(formBanner.node);

  const connTypes = metaList('connectionTypes');
  const typeSelect = selectInput({
    id: 'req-type',
    required: true,
    ariaLabel: 'Kind of connection',
    options: [{ value: '', label: 'Choose a kind of connection…' }]
      .concat(connTypes.map((t) => ({ value: t.value, label: t.label }))),
  });
  const typeHelp = el(`<p class="field-hint" id="req-type-help"></p>`);
  const typeField = field('Kind of connection', typeSelect, { id: 'req-type' });
  typeField.appendChild(typeHelp);
  form.appendChild(typeField);

  function updateTypeHelp() {
    const t = connectionTypeByValue(typeSelect.value);
    typeHelp.textContent = t
      ? `${t.description || ''}${t.consent ? ` ${t.consent}` : ''}`.trim()
      : '';
  }
  typeSelect.addEventListener('change', updateTypeHelp);

  // Template shortcut.
  const templates = metaList('requestTemplates');
  if (templates.length) {
    const tplWrap = el(`<div class="template-shortcut"></div>`);
    const tplToggle = el(`<button type="button" class="btn btn-ghost btn-small">Use a template</button>`);
    const tplList = el(`<div class="template-list" hidden></div>`);
    tplToggle.addEventListener('click', () => {
      tplList.hidden = !tplList.hidden;
      tplToggle.textContent = tplList.hidden ? 'Use a template' : 'Hide templates';
    });
    for (const tpl of templates) {
      const b = el(`<button type="button" class="template-card card">
        <h3>${esc(tpl.label)}</h3>
        <p>${esc(tpl.text.length > 140 ? tpl.text.slice(0, 140) + '…' : tpl.text)}</p>
      </button>`);
      b.addEventListener('click', () => {
        messageInput.value = fillTemplate(tpl.text, person);
        updateCount();
        messageInput.focus();
        toast('Template added — make it your own.');
      });
      tplList.appendChild(b);
    }
    tplWrap.appendChild(tplToggle);
    tplWrap.appendChild(tplList);
    form.appendChild(tplWrap);
  }

  const messageInput = textArea({
    id: 'req-message',
    placeholder: 'Write from the heart — what draws you to connect?',
    maxLength: MESSAGE_MAX,
    rows: 5,
    required: true,
  });
  const countLine = el(`<p class="char-count" aria-live="polite"></p>`);
  function updateCount() {
    const n = messageInput.value.trim().length;
    countLine.textContent = n < MESSAGE_MIN
      ? `${n} / ${MESSAGE_MIN} minimum characters`
      : `${n} / ${MESSAGE_MAX} characters`;
  }
  messageInput.addEventListener('input', updateCount);
  updateCount();
  const msgField = field('Your message', messageInput, {
    id: 'req-message',
    hint: `At least ${MESSAGE_MIN} characters. Be specific and kind — this is the first thing they will read.`,
  });
  msgField.appendChild(countLine);
  form.appendChild(msgField);

  const optRow = el(`<div style="display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(10rem,1fr))"></div>`);
  const formats = metaList('connectionFormats');
  const formatSelect = selectInput({
    id: 'req-format', ariaLabel: 'Preferred format',
    options: [{ value: '', label: 'No preference' }].concat(formats.map((f) => ({ value: f.value, label: f.label }))),
  });
  optRow.appendChild(field('Format', formatSelect, { id: 'req-format' }));
  const commitments = metaList('commitmentLevels');
  const commitmentSelect = selectInput({
    id: 'req-commitment', ariaLabel: 'Commitment',
    options: [{ value: '', label: 'No preference' }].concat(commitments.map((c) => ({ value: c.value, label: c.label }))),
  });
  optRow.appendChild(field('Commitment', commitmentSelect, { id: 'req-commitment' }));
  const tones = metaList('tones');
  const toneSelect = selectInput({
    id: 'req-tone', ariaLabel: 'Tone',
    options: [{ value: '', label: 'No preference' }].concat(tones.map((t) => ({ value: t.value, label: t.label }))),
  });
  optRow.appendChild(field('Tone', toneSelect, { id: 'req-tone' }));
  form.appendChild(optRow);

  const sendBtn = el(`<button type="submit" class="btn btn-primary">Send request</button>`);
  const btnRow = el(`<div class="btn-row"></div>`);
  btnRow.appendChild(sendBtn);
  form.appendChild(btnRow);

  wireSubmit(form, sendBtn, async () => {
    formBanner.clear();
    const connectionType = typeSelect.value;
    const message = messageInput.value.trim();
    if (!connectionType) {
      formBanner.show('Please choose the kind of connection you are seeking.');
      return;
    }
    if (message.length < MESSAGE_MIN) {
      formBanner.show(`Your message needs at least ${MESSAGE_MIN} characters so they can feel your intent.`);
      return;
    }
    try {
      await api.requestConnection({
        requesterId: profileId,
        targetId,
        connectionType,
        message,
        format: formatSelect.value || undefined,
        commitment: commitmentSelect.value || undefined,
        tone: toneSelect.value || undefined,
      });
      toast('Request sent. They can respond in their own time.');
      announce('Request sent.');
      navigate('#/requests');
    } catch (e) {
      formBanner.show(api.friendlyError(e));
    }
  });
  composerCard.appendChild(form);
  content.appendChild(composerCard);

  // --- secondary actions ---
  const actionsCard = card();
  actionsCard.appendChild(el(`<h2 style="margin-top:0">Other options</h2>`));
  const row = el(`<div class="btn-row"></div>`);

  let saved = false;
  const saveBtn = el(`<button type="button" class="btn btn-secondary btn-small" aria-pressed="false">Save</button>`);
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      if (saved) { await api.unsaveItem(profileId, 'match', targetId); saved = false; toast('Removed from saved.'); }
      else { await api.saveItem(profileId, 'match', targetId); saved = true; toast('Saved for later.'); }
      saveBtn.textContent = saved ? 'Saved' : 'Save';
      saveBtn.setAttribute('aria-pressed', String(saved));
    } catch (e) { toast(api.friendlyError(e)); }
    finally { saveBtn.disabled = false; }
  });
  row.appendChild(saveBtn);

  const passBtn = el(`<button type="button" class="btn btn-ghost btn-small">Pass</button>`);
  passBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Pass on this person?',
      body: 'They will not appear in Discover again. This is private — they are not notified.',
      confirmLabel: 'Pass',
    });
    if (!ok) return;
    try {
      await api.passProfile(profileId, targetId);
      toast('Passed.');
      navigate('#/discover');
    } catch (e) { toast(api.friendlyError(e)); }
  });
  row.appendChild(passBtn);

  const blockBtn = el(`<button type="button" class="btn btn-ghost btn-small">Block</button>`);
  blockBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Block this person?',
      body: 'They will not see you in Discover and cannot message you. Blocking is private — they are not notified.',
      confirmLabel: 'Block',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.blockProfile(profileId, targetId);
      toast('Blocked. You will not see each other.');
      navigate('#/discover');
    } catch (e) { toast(api.friendlyError(e)); }
  });
  row.appendChild(blockBtn);
  actionsCard.appendChild(row);
  content.appendChild(actionsCard);
}
