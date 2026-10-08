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
  field, textInput, textArea, selectInput, card, avatarFor, confirmDialog, announce,
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

const CONNECTION_MODE_COPY = {
  data: 'Data Mode',
  synchronicity: 'Synchronicity Mode',
  human: 'Human Mode',
};

const CONNECTION_STATUS_COPY = {
  proposed: 'Proposed',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  blocked: 'Blocked',
};

function connectionPair(conn, agentId) {
  return Number(conn.sourceAgentId) === Number(agentId)
    || Number(conn.targetAgentId) === Number(agentId);
}

function connectionBasis(conn) {
  if (conn.mode === 'data') return conn.dataBasis || 'Declared capabilities, needs, and intentions.';
  if (conn.mode === 'synchronicity') {
    const source = conn.synchronicitySource === 'seren_generated'
      ? 'SEREN-generated, labeled as generated'
      : 'supplied by a member';
    return `Synchronicity signal (${source}): ${conn.synchronicitySignal || ''}`;
  }
  return conn.hostApproved
    ? 'Reviewed by a SEREN host for human facilitation.'
    : 'Waiting for SEREN host review before the receiving operator can accept.';
}

function connectionActions(conn, profileId, onChanged) {
  const actions = el(`<div class="row-actions" style="margin-top:0.65rem"></div>`);
  let hasActions = false;
  const isSourceOperator = Number(conn.sourceAgent?.operatorProfileId) === Number(profileId);
  const isTargetOperator = Number(conn.targetAgent?.operatorProfileId) === Number(profileId);

  if (conn.status === 'proposed' && isTargetOperator) {
    if (conn.mode === 'human' && !conn.hostApproved) {
      actions.appendChild(el(`<span class="field-hint">Waiting for a SEREN host review.</span>`));
      hasActions = true;
    } else {
      const acceptBtn = el(`<button type="button" class="btn btn-primary btn-small">Accept agent connection</button>`);
      acceptBtn.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Accept this agent connection?',
          body: 'This creates a normal proposed introduction between the two operators. It does not share contact details or open messaging; the introduction still follows SEREN’s human consent flow.',
          confirmLabel: 'Accept connection',
        });
        if (!ok) return;
        acceptBtn.disabled = true;
        try {
          await api.respondAgentConnection(conn.id, { action: 'accept' });
          toast('Agent connection accepted. Review the human introduction in Connections.');
          onChanged();
        } catch (e) {
          acceptBtn.disabled = false;
          toast(api.friendlyError(e));
        }
      });
      actions.appendChild(acceptBtn);

      const declineBtn = el(`<button type="button" class="btn btn-ghost btn-small">Decline</button>`);
      declineBtn.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Decline this agent connection?',
          body: 'A decline is durable for this pair of agents, so the proposal cannot simply be sent again.',
          confirmLabel: 'Decline',
        });
        if (!ok) return;
        declineBtn.disabled = true;
        try {
          await api.respondAgentConnection(conn.id, { action: 'decline' });
          toast('Agent connection declined.');
          onChanged();
        } catch (e) {
          declineBtn.disabled = false;
          toast(api.friendlyError(e));
        }
      });
      actions.appendChild(declineBtn);
      hasActions = true;
    }
  }

  if (conn.status === 'proposed' && isSourceOperator) {
    const withdrawBtn = el(`<button type="button" class="btn btn-ghost btn-small">Withdraw proposal</button>`);
    withdrawBtn.addEventListener('click', async () => {
      try {
        await api.respondAgentConnection(conn.id, { action: 'withdraw' });
        toast('Agent connection proposal withdrawn.');
        onChanged();
      } catch (e) {
        toast(api.friendlyError(e));
      }
    });
    actions.appendChild(withdrawBtn);
    hasActions = true;
  }

  if (conn.status === 'accepted' && conn.introductionId) {
    const link = el(`<a class="btn btn-secondary btn-small" href="#/connections">Review human introduction</a>`);
    actions.appendChild(link);
    hasActions = true;
  }

  return hasActions ? actions : null;
}

function connectionSummary(conn, profileId, onChanged, { hostReview = false, onHostReview = null } = {}) {
  const wrap = el(`<div style="border-top:1px solid var(--line);margin-top:0.9rem;padding-top:0.8rem"></div>`);
  const sourceName = conn.sourceAgent?.name || 'Agent';
  const targetName = conn.targetAgent?.name || 'Agent';
  wrap.appendChild(el(`<p style="margin:0 0 0.35rem"><strong>${esc(sourceName)} → ${esc(targetName)}</strong> <span class="pill">${esc(CONNECTION_MODE_COPY[conn.mode] || conn.mode)}</span> <span class="pill pill-muted">${esc(CONNECTION_STATUS_COPY[conn.status] || conn.status)}</span></p>`));
  wrap.appendChild(el(`<p class="field-hint" style="margin:0 0 0.35rem">${esc(connectionBasis(conn))}</p>`));
  if (conn.rationale) wrap.appendChild(el(`<p style="margin:0">Operator rationale: “${esc(conn.rationale)}”</p>`));
  if (conn.responderNote) wrap.appendChild(el(`<p class="field-hint">Response note: ${esc(conn.responderNote)}</p>`));
  if (conn.status === 'accepted') {
    wrap.appendChild(el(`<p class="field-hint">The agents completed the handshake. The people still decide through the ordinary introduction.</p>`));
  }
  if (conn.status === 'declined') {
    wrap.appendChild(el(`<p class="field-hint">This pair is closed. A decline is durable and cannot be bypassed by resending.</p>`));
  }
  const actions = connectionActions(conn, profileId, onChanged);
  if (actions) wrap.appendChild(actions);
  if (hostReview && conn.mode === 'human' && conn.status === 'proposed' && !conn.hostApproved) {
    const reviewBtn = el(`<button type="button" class="btn btn-primary btn-small" style="margin-top:0.65rem">Review for Human Mode</button>`);
    reviewBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Review this Human Mode connection?',
        body: 'Your review records that a person checked the stated basis. It does not guarantee either agent’s behavior, and both operators still decide for themselves.',
        confirmLabel: 'Mark reviewed',
      });
      if (!ok) return;
      reviewBtn.disabled = true;
      try {
        await api.hostReviewAgentConnection(conn.id);
        toast('Human Mode agent connection reviewed.');
        if (onHostReview) onHostReview();
        else onChanged();
      } catch (e) {
        reviewBtn.disabled = false;
        toast(api.friendlyError(e));
      }
    });
    wrap.appendChild(reviewBtn);
  }
  return wrap;
}

function connectionsPanel(connections, hostConnections, profileId, isHost, onChanged) {
  const c = card();
  c.appendChild(el(`<h3 style="margin-top:0">Agent connections</h3>`));
  c.appendChild(el(`<p class="field-hint" style="margin-top:0">Layer 3 is a bounded handshake between benevolent agents, guided by the SEREN AI Constitution, Jack Probert’s attention-integrity research, and Flourishing by Design. Agents state a declared basis; their human operators decide. Success is a safe, meaningful human connection, not agent activity for its own sake.</p>`));
  if (!connections.length) {
    c.appendChild(el(`<p class="field-hint">No agent connections yet. Propose one from another agent’s card below.</p>`));
  } else {
    for (const conn of connections) c.appendChild(connectionSummary(conn, profileId, onChanged));
  }

  if (isHost) {
    const queue = (hostConnections || []).filter((conn) => conn.mode === 'human' && conn.status === 'proposed');
    if (queue.length) {
      c.appendChild(el(`<h4 style="margin:1.1rem 0 0.25rem">Human Mode host queue</h4>`));
      c.appendChild(el(`<p class="field-hint" style="margin-top:0">People hold the final judgment. Review only records that a host checked the stated basis.</p>`));
      for (const conn of queue) {
        c.appendChild(connectionSummary(conn, profileId, onChanged, { hostReview: true }));
      }
    }
  }
  return c;
}

function connectionComposer(targetAgent, myAgents, onChanged) {
  const wrap = el(`<div style="border-top:1px solid var(--line);margin-top:0.9rem;padding-top:0.8rem"></div>`);
  const eligibleMine = (myAgents || []).filter((a) => ['bronze', 'silver'].includes(a.certTier));
  if (!eligibleMine.length) {
    wrap.appendChild(el(`<p class="field-hint" style="margin:0">To propose an agent connection, first register your own agent and complete its benevolence checklist.</p>`));
    return wrap;
  }
  if (!['bronze', 'silver'].includes(targetAgent.certTier)) {
    wrap.appendChild(el(`<p class="field-hint" style="margin:0">This agent cannot connect yet: its operator has not completed the benevolence checklist.</p>`));
    return wrap;
  }

  wrap.appendChild(el(`<h4 style="margin:0 0 0.5rem">Propose an agent connection</h4>`));
  wrap.appendChild(el(`<p class="field-hint" style="margin-top:0">The agents exchange only the declared basis below. They do not chat freely, and neither person’s contact details move.</p>`));
  const sourceSelect = selectInput({
    ariaLabel: 'Your agent',
    options: eligibleMine.map((a) => ({ value: String(a.id), label: `${a.name} (${CERT_COPY[a.certTier]?.label || a.certTier})` })),
  });
  const modeSelect = selectInput({
    ariaLabel: 'Connection mode',
    options: [
      { value: 'data', label: 'Data Mode — declared needs, offers, and capabilities' },
      { value: 'synchronicity', label: 'Synchronicity Mode — a labeled synchronicity signal' },
      { value: 'human', label: 'Human Mode — host-reviewed facilitation' },
    ],
  });
  const rationale = textArea({ maxlength: 500, placeholder: 'Why might these agents’ people meaningfully connect?' });
  const dataBasis = textInput({ maxlength: 500, placeholder: 'Declared needs, offers, skills, or capabilities being compared' });
  const syncSignal = textInput({ maxlength: 300, placeholder: 'A word, image, number, phrase, or other member-supplied signal' });
  const syncSource = selectInput({
    ariaLabel: 'Synchronicity source',
    options: [
      { value: 'member_supplied', label: 'Supplied by a member' },
      { value: 'seren_generated', label: 'Generated by SEREN (labeled as generated)' },
    ],
  });
  const dataField = field('Declared data basis', dataBasis, 'Only information the operators declared for matching. Nothing inferred about anyone’s soul.');
  const syncFields = el(`<div></div>`);
  syncFields.appendChild(field('Synchronicity signal', syncSignal, 'A reflective signal, never a revelation or prediction.'));
  syncFields.appendChild(field('Signal source', syncSource));
  const humanHint = el(`<p class="field-hint">Human Mode requires at least one Silver agent and a SEREN host review. The host checks the basis; both operators still decide.</p>`);
  const banner = errorBanner();
  const submit = el(`<button type="button" class="btn btn-secondary btn-small">Propose connection</button>`);

  function refreshMode() {
    const mode = modeSelect.value;
    dataField.style.display = mode === 'data' ? '' : 'none';
    syncFields.style.display = mode === 'synchronicity' ? '' : 'none';
    humanHint.style.display = mode === 'human' ? '' : 'none';
  }
  modeSelect.addEventListener('change', refreshMode);

  submit.addEventListener('click', async () => {
    banner.clear();
    const source = eligibleMine.find((a) => Number(a.id) === Number(sourceSelect.value));
    const mode = modeSelect.value;
    if (mode === 'human' && source?.certTier !== 'silver' && targetAgent.certTier !== 'silver') {
      banner.show('Human Mode requires at least one Silver (host-reviewed) agent.');
      return;
    }
    const payload = {
      sourceAgentId: Number(sourceSelect.value),
      targetAgentId: targetAgent.id,
      mode,
      rationale: rationale.value.trim(),
      dataBasis: mode === 'data' ? dataBasis.value.trim() : '',
      synchronicitySignal: mode === 'synchronicity' ? syncSignal.value.trim() : '',
      synchronicitySource: mode === 'synchronicity' ? syncSource.value : '',
    };
    submit.disabled = true;
    try {
      await api.createAgentConnection(payload);
      toast('Agent connection proposed. The other operator decides next.');
      onChanged();
    } catch (e) {
      banner.show(api.friendlyError(e));
      submit.disabled = false;
    }
  });

  wrap.appendChild(field('Your agent', sourceSelect));
  wrap.appendChild(field('How should the connection be found?', modeSelect));
  wrap.appendChild(field('Operator rationale', rationale, 'Written by the accountable human operator, in plain language.'));
  wrap.appendChild(dataField);
  wrap.appendChild(syncFields);
  wrap.appendChild(humanHint);
  wrap.appendChild(banner.node);
  const actions = el(`<div class="row-actions" style="margin-top:0.65rem"></div>`);
  actions.appendChild(submit);
  wrap.appendChild(actions);
  refreshMode();
  return wrap;
}

function agentCardFull(a, profileId, isHost, onChanged, connectionCtx = {}) {
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

  // Layer 3 lives on the agent card: one bounded proposal, its current
  // handshake state, and the accountable operators' next decision.
  if (Number(a.operatorProfileId) !== Number(profileId)) {
    const existing = (connectionCtx.connections || []).find((conn) => connectionPair(conn, a.id));
    if (existing && existing.status !== 'withdrawn') {
      c.appendChild(connectionSummary(existing, profileId, onChanged));
    } else {
      c.appendChild(connectionComposer(a, connectionCtx.myAgents || [], onChanged));
    }
  }
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
  list.appendChild(el(`<p style="margin-bottom:0.5rem"><span class="pill pill-muted">Platinum · Stewarded</span> <span class="field-hint">Aspirational: independent stewardship review. Not yet awarded to any listing.</span></p>`));
  list.appendChild(el(`<p style="margin:0"><span class="field-hint"><strong>Layer 3 is live:</strong> Bronze and Silver agents may propose bounded connections in Data, Synchronicity, or Human Mode. The handshake is guided by the Constitution, attention integrity, and flourishing — agents never chat freely or share contact details.</span></p>`));
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
      const [data, meta, mineData, hostData] = await Promise.all([
        api.listAgents(),
        api.fetchMeta(),
        api.listMyAgentConnections(),
        isHost ? api.listHostAgentConnections() : Promise.resolve({ connections: [] }),
      ]);
      const agents = data.agents || [];
      const connections = mineData.connections || [];
      const hostConnections = hostData.connections || [];
      const myAgents = agents.filter((a) => Number(a.operatorProfileId) === Number(profileId));
      const vettingItems = (meta && meta.agentVetting) || [];
      content.innerHTML = '';
      content.appendChild(el(`<p class="field-hint" style="margin-top:0">Agents are AI participants — always labeled, never presented as human. Names, capabilities, and declarations come from the registering operator. Members discover them by need and capability; agents may also connect with one another through the bounded Layer 3 handshake below.</p>`));
      content.appendChild(tierExplainer());
      content.appendChild(connectionsPanel(connections, hostConnections, profileId, isHost, load));
      if (!agents.length) {
        content.appendChild(emptyState({
          title: 'No agents registered yet.',
          body: 'The registry is brand new. Register the first one below.',
        }));
      } else {
        const grid = el(`<div class="match-grid"></div>`);
        for (const a of agents) {
          grid.appendChild(agentCardFull(a, profileId, isHost, load, { connections, myAgents }));
        }
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
