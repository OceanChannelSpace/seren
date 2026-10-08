// Agents — the intelligent-agent registry.
// AI participants registered by human members, discoverable alongside humans.
// Always labeled AI. Trust tiers: Unverified (no checklist on file),
// Operator-attested (operator affirmed the benevolence checklist), or
// Host-reviewed (a SEREN host reviewed the listing). The word "Verified" is
// never used: no tier is a platform guarantee of agent behavior.

import { get } from '../state.js';
import * as api from '../api.js';
import {
  esc, el, pageShell, errorBanner, toast, loading, emptyState,
  field, textInput, textArea, card, avatarFor, confirmDialog, announce,
} from '../ui.js';

const TIER_COPY = {
  'unverified': { label: 'Unverified', cls: 'pill-muted' },
  'operator-attested': { label: 'Operator-attested', cls: '' },
  'host-reviewed': { label: 'Host-reviewed', cls: 'pill-good' },
};

// World 3.0 ethical-maturity ladder (docs/SEREN_AI_CONSTITUTION.md §5).
// Bronze = operator attested the benevolence checklist; Silver = a human
// host reviewed the listing. Gold/Platinum are aspirational rungs that
// require a measurement programme and independent stewardship review that
// do not exist yet — they are shown only so the path is public, never
// assigned to a listing today.
const CERT_COPY = {
  'ungraded': { label: 'Ungraded', cls: 'pill-muted' },
  'bronze': { label: 'Bronze · Attested', cls: '' },
  'silver': { label: 'Silver · Host-reviewed', cls: 'pill-good' },
};

function tierPill(a) {
  const t = TIER_COPY[a.trustTier] || TIER_COPY['unverified'];
  return `<span class="pill ${t.cls}">${esc(t.label)}</span>`;
}

function certPill(a) {
  const c = CERT_COPY[a.certTier] || CERT_COPY['ungraded'];
  return `<span class="pill ${c.cls}">${esc(c.label)}</span>`;
}

function agentCardFull(a, profileId, isHost, onChanged) {
  const c = card();
  c.classList.add('match-card');
  const head = el(`<div class="person-head"></div>`);
  head.appendChild(avatarFor(a.name || 'Agent'));
  const who = el(`<div class="who"></div>`);
  who.appendChild(el(`<h3>${esc(a.name || 'Unnamed agent')} <span class="pill">AI</span> ${tierPill(a)} ${certPill(a)}</h3>`));
  if (a.operatorName) who.appendChild(el(`<p class="person-sub">Registered by ${esc(a.operatorName)}</p>`));
  head.appendChild(who);
  c.appendChild(head);

  if (a.description) c.appendChild(el(`<p>${esc(a.description)}</p>`));
  if (a.trustNote) {
    c.appendChild(el(`<p class="field-hint">Operator declaration: “${esc(a.trustNote)}”</p>`));
  }

  const caps = (a.capabilities || []).slice(0, 10);
  if (caps.length) {
    c.appendChild(el(`<p class="field-hint" style="margin-bottom:0.25rem">Operator-declared capabilities (not verified):</p>`));
    const row = el(`<div class="chip-row"></div>`);
    for (const label of caps) row.appendChild(el(`<span class="chip chip-static">${esc(label)}</span>`));
    c.appendChild(row);
  }

  if (a.endpointUrl) {
    c.appendChild(el(`<p class="field-hint">Endpoint: <a href="${esc(a.endpointUrl)}" target="_blank" rel="noopener">${esc(a.endpointUrl)}</a></p>`));
  }

  const actions = el(`<div class="row-actions" style="margin-top:0.75rem"></div>`);
  let hasActions = false;
  if (isHost && a.trustTier !== 'host-reviewed') {
    const reviewBtn = el(`<button type="button" class="btn btn-secondary btn-small">Mark reviewed</button>`);
    reviewBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Mark this listing reviewed?',
        body: `This records that a host reviewed “${a.name}”. It is not a guarantee of the agent's behavior.`,
        confirmLabel: 'Mark reviewed',
      });
      if (!ok) return;
      reviewBtn.disabled = true;
      try {
        await api.reviewAgent(a.id);
        toast('Listing marked as host-reviewed.');
        onChanged();
      } catch (e) {
        reviewBtn.disabled = false;
        toast(api.friendlyError(e));
      }
    });
    actions.appendChild(reviewBtn);
    hasActions = true;
  }
  if (Number(a.operatorProfileId) === Number(profileId)) {
    const hideBtn = el(`<button type="button" class="btn btn-ghost btn-small">Remove from registry</button>`);
    hideBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Remove this agent?',
        body: `“${a.name}” will no longer appear in the registry or in discovery. This can’t be undone from here.`,
        confirmLabel: 'Remove',
      });
      if (!ok) return;
      try {
        await api.hideAgent(a.id, profileId);
        toast('Agent removed from the registry.');
        announce('Agent removed from the registry.');
        onChanged();
      } catch (e) {
        toast(api.friendlyError(e));
      }
    });
    actions.appendChild(hideBtn);
    hasActions = true;
  }
  if (hasActions) c.appendChild(actions);
  return c;
}

function vettingCheckboxes(items) {
  const wrap = el(`<div style="margin:0.5rem 0 1rem"></div>`);
  const boxes = [];
  for (const item of items) {
    const id = `vet-${item.key}`;
    const label = el(`<label for="${id}" style="display:flex;gap:0.6rem;align-items:flex-start;margin-bottom:0.55rem;cursor:pointer"></label>`);
    const box = el(`<input type="checkbox" id="${id}" style="margin-top:0.25rem">`);
    const text = el(`<span><strong>${esc(item.label)}</strong><br><span class="field-hint">${esc(item.description)}</span></span>`);
    label.appendChild(box);
    label.appendChild(text);
    wrap.appendChild(label);
    boxes.push({ key: item.key, box });
  }
  return { wrap, boxes };
}

function registerForm(profileId, vettingItems, onRegistered) {
  const c = card();
  c.appendChild(el(`<h3>Register an agent</h3>`));
  c.appendChild(el(`<p class="field-hint" style="margin-top:0">Register an AI you operate. Your name appears as the declaring operator. Complete the benevolence checklist below: your answers are shown to members as your declaration. The platform does not independently verify agent behavior, capabilities, or safety.</p>`));

  const nameInput = textInput({ maxlength: 80, placeholder: 'Agent name' });
  const descInput = textArea({ maxlength: 500, placeholder: 'What does this agent do? A sentence or two.' });
  const capsInput = textInput({ maxlength: 600, placeholder: 'dream work, journaling prompts, scheduling' });
  const urlInput = textInput({ maxlength: 500, placeholder: 'https://… (optional)' });
  const trustInput = textArea({ maxlength: 500, placeholder: 'Why do you vouch for this agent? (optional)' });

  c.appendChild(field('Name', nameInput, '2–80 characters.'));
  c.appendChild(field('Description', descInput, 'What members should expect.'));
  c.appendChild(field('Capabilities', capsInput, 'Comma-separated — used for matching against members’ needs.'));
  c.appendChild(field('Endpoint URL', urlInput, 'Optional. Must be http(s).'));
  c.appendChild(field('Your declaration', trustInput, 'Optional. Your personal statement, shown to every member as your declaration — not a platform verification.'));

  c.appendChild(el(`<h4 style="margin:1.25rem 0 0.25rem">Benevolence checklist</h4>`));
  c.appendChild(el(`<p class="field-hint" style="margin-top:0">Affirm each item to register. These are your declarations as the operator.</p>`));
  const { wrap, boxes } = vettingCheckboxes(vettingItems);
  c.appendChild(wrap);

  const banner = errorBanner();
  c.appendChild(banner.node);
  const submit = el(`<button type="button" class="btn btn-primary">Register agent</button>`);
  submit.addEventListener('click', async () => {
    banner.clear();
    const vetting = {};
    let allAffirmed = true;
    for (const { key, box } of boxes) {
      vetting[key] = box.checked;
      if (!box.checked) allAffirmed = false;
    }
    if (!allAffirmed) {
      banner.show('Please affirm every item in the benevolence checklist to register an agent.');
      return;
    }
    const capabilities = capsInput.value.split(',').map((s) => s.trim()).filter(Boolean);
    // The operator is bound server-side from the session token — never sent.
    const payload = {
      name: nameInput.value.trim(),
      description: descInput.value.trim(),
      capabilities,
      endpointUrl: urlInput.value.trim(),
      trustNote: trustInput.value.trim(),
      vetting,
    };
    submit.disabled = true;
    try {
      await api.registerAgent(payload);
      toast('Agent registered.');
      announce('Agent registered.');
      onRegistered();
    } catch (e) {
      banner.show(api.friendlyError(e));
      submit.disabled = false;
    }
  });
  c.appendChild(el(`<div style="margin-top:1rem"></div>`)).appendChild(submit);
  return c;
}

function tierExplainer() {
  const c = el(`<div class="card" style="margin-bottom:1.25rem"></div>`);
  c.appendChild(el(`<h3 style="margin-top:0">What the labels mean</h3>`));
  const list = el(`<div></div>`);
  list.appendChild(el(`<p style="margin-bottom:0.5rem"><span class="pill pill-muted">Unverified</span> <span class="field-hint">Listed without the benevolence checklist. No attestations on file.</span></p>`));
  list.appendChild(el(`<p style="margin-bottom:0.5rem"><span class="pill">Operator-attested</span> <span class="field-hint">The operator affirmed five benevolence criteria: no manipulation, no covert data harvesting, an accountable human operator, a clear purpose, and respect for consent. Their declaration, not a platform verification.</span></p>`));
  list.appendChild(el(`<p style="margin-bottom:1rem"><span class="pill pill-good">Host-reviewed</span> <span class="field-hint">A SEREN host reviewed this listing. Still the operator's declaration, not a guarantee.</span></p>`));
  list.appendChild(el(`<h3 style="margin-top:0">Ethical maturity (World 3.0 ladder)</h3>`));
  list.appendChild(el(`<p class="field-hint" style="margin-bottom:0.5rem">Each listing also carries a maturity level, adapted from the Ethical AI Certification and Maturity Model™ (Matthew James Bailey, Inventing World 3.0) and measured against SEREN's AI Constitution. It tracks evidence, not promises:</p>`));
  list.appendChild(el(`<p style="margin-bottom:0.5rem"><span class="pill pill-muted">Ungraded</span> <span class="field-hint">Nothing codified or attested yet.</span></p>`));
  list.appendChild(el(`<p style="margin-bottom:0.5rem"><span class="pill">Bronze · Attested</span> <span class="field-hint">The operator affirmed the five benevolence criteria. A declaration, not a verification.</span></p>`));
  list.appendChild(el(`<p style="margin-bottom:0.5rem"><span class="pill pill-good">Silver · Host-reviewed</span> <span class="field-hint">A human SEREN host reviewed the listing. Still the operator's declaration, never a platform guarantee.</span></p>`));
  list.appendChild(el(`<p style="margin-bottom:0.5rem"><span class="pill pill-muted">Gold · Measured</span> <span class="field-hint">Aspirational: sustained measured compliance against the Constitution over time. Not yet awarded to any listing.</span></p>`));
  list.appendChild(el(`<p style="margin:0"><span class="pill pill-muted">Platinum · Stewarded</span> <span class="field-hint">Aspirational: independent stewardship review. Not yet awarded to any listing.</span></p>`));
  c.appendChild(list);
  return c;
}

export async function renderAgents(root, ctx) {
  const profileId = get('profileId');
  const isHost = get('isHost') === true;
  const { root: shell, body } = pageShell('Intelligent agents', 'AI participants in the network');
  root.appendChild(shell);
  const banner = errorBanner();
  body.appendChild(banner.node);
  const content = el(`<div></div>`);
  body.appendChild(content);

  async function load() {
    content.innerHTML = '';
    content.appendChild(loading('Loading the registry…'));
    banner.clear();
    try {
      const [data, meta] = await Promise.all([api.listAgents(), api.fetchMeta()]);
      const agents = data.agents || [];
      const vettingItems = (meta && meta.agentVetting) || [];
      content.innerHTML = '';
      content.appendChild(el(`<p class="field-hint" style="margin-top:0">Agents are AI participants — always labeled, never presented as human. Names, capabilities, and declarations come from the registering operator. Members discover them by need and capability.</p>`));
      content.appendChild(tierExplainer());
      if (!agents.length) {
        content.appendChild(emptyState({
          title: 'No agents registered yet.',
          body: 'The registry is brand new. Register the first one below.',
        }));
      } else {
        const grid = el(`<div class="match-grid"></div>`);
        for (const a of agents) grid.appendChild(agentCardFull(a, profileId, isHost, load));
        content.appendChild(grid);
      }
      content.appendChild(registerForm(profileId, vettingItems, load));
    } catch (e) {
      content.innerHTML = '';
      banner.show(api.friendlyError(e));
    }
  }

  await load();
}
