// Agents — the intelligent-agent registry.
// AI participants registered by human members, discoverable alongside humans.
// Always labeled AI; operator attestation shown on every card.

import { get } from '../state.js';
import * as api from '../api.js';
import {
  esc, el, pageShell, errorBanner, toast, loading, emptyState,
  field, textInput, textArea, card, avatarFor, confirmDialog, announce,
} from '../ui.js';

function agentCardFull(a, profileId, onChanged) {
  const c = card();
  c.classList.add('match-card');
  const head = el(`<div class="person-head"></div>`);
  head.appendChild(avatarFor(a.name || 'Agent'));
  const who = el(`<div class="who"></div>`);
  who.appendChild(el(`<h3>${esc(a.name || 'Unnamed agent')} <span class="pill">AI</span></h3>`));
  if (a.operatorName) who.appendChild(el(`<p class="person-sub">Registered by ${esc(a.operatorName)}</p>`));
  head.appendChild(who);
  c.appendChild(head);

  if (a.description) c.appendChild(el(`<p>${esc(a.description)}</p>`));
  if (a.trustNote) {
    c.appendChild(el(`<p class="field-hint">Operator attests: “${esc(a.trustNote)}”</p>`));
  }

  const caps = (a.capabilities || []).slice(0, 10);
  if (caps.length) {
    const row = el(`<div class="chip-row"></div>`);
    for (const label of caps) row.appendChild(el(`<span class="chip chip-static">${esc(label)}</span>`));
    c.appendChild(row);
  }

  if (a.endpointUrl) {
    c.appendChild(el(`<p class="field-hint">Endpoint: <a href="${esc(a.endpointUrl)}" target="_blank" rel="noopener">${esc(a.endpointUrl)}</a></p>`));
  }

  if (Number(a.operatorProfileId) === Number(profileId)) {
    const row = el(`<div class="row-actions" style="margin-top:0.75rem"></div>`);
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
    row.appendChild(hideBtn);
    c.appendChild(row);
  }
  return c;
}

function registerForm(profileId, onRegistered) {
  const c = card();
  c.appendChild(el(`<h3>Register an agent</h3>`));
  c.appendChild(el(`<p class="field-hint" style="margin-top:0">Vouch for an AI you operate or trust. Your name appears as the attesting operator — the platform does not independently verify agent behavior.</p>`));

  const nameInput = textInput({ maxlength: 80, placeholder: 'Agent name' });
  const descInput = textArea({ maxlength: 500, placeholder: 'What does this agent do? A sentence or two.' });
  const capsInput = textInput({ maxlength: 600, placeholder: 'dream work, journaling prompts, scheduling' });
  const urlInput = textInput({ maxlength: 500, placeholder: 'https://… (optional)' });
  const trustInput = textArea({ maxlength: 500, placeholder: 'Why do you vouch for this agent? (optional)' });

  c.appendChild(field('Name', nameInput, '2–80 characters.'));
  c.appendChild(field('Description', descInput, 'What members should expect.'));
  c.appendChild(field('Capabilities', capsInput, 'Comma-separated — used for matching against members’ needs.'));
  c.appendChild(field('Endpoint URL', urlInput, 'Optional. Must be http(s).'));
  c.appendChild(field('Your attestation', trustInput, 'Optional. Your words, shown to every member who sees this agent.'));

  const banner = errorBanner();
  c.appendChild(banner.node);
  const submit = el(`<button type="button" class="btn btn-primary">Register agent</button>`);
  submit.addEventListener('click', async () => {
    banner.clear();
    const capabilities = capsInput.value.split(',').map((s) => s.trim()).filter(Boolean);
    const payload = {
      operatorProfileId: profileId,
      name: nameInput.value.trim(),
      description: descInput.value.trim(),
      capabilities,
      endpointUrl: urlInput.value.trim(),
      trustNote: trustInput.value.trim(),
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

export async function renderAgents(root, ctx) {
  const profileId = get('profileId');
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
      const data = await api.listAgents();
      const agents = data.agents || [];
      content.innerHTML = '';
      content.appendChild(el(`<p class="field-hint" style="margin-top:0">Agents are AI participants — always labeled, never presented as human. Members discover them by need and capability.</p>`));
      if (!agents.length) {
        content.appendChild(emptyState({
          title: 'No agents registered yet.',
          body: 'The registry is brand new. Register the first one below.',
        }));
      } else {
        const grid = el(`<div class="match-grid"></div>`);
        for (const a of agents) grid.appendChild(agentCardFull(a, profileId, load));
        content.appendChild(grid);
      }
      content.appendChild(registerForm(profileId, load));
    } catch (e) {
      content.innerHTML = '';
      banner.show(api.friendlyError(e));
    }
  }

  await load();
}
