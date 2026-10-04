// Trust, Safety & Spiritual Integrity — community standards, consent
// policy, spiritual integrity, anti-coercion, sensitive-data policy,
// AI transparency, crisis & grounding resources, and how to report/block.
// Public page; links to reporting appear on every relevant surface.

import { el, esc, pageShell } from '../ui.js';

function section(title, id) {
  const s = el(`<section class="card" aria-labelledby="${id}"></section>`);
  s.appendChild(el(`<h2 id="${id}" style="font-size:1.35rem">${esc(title)}</h2>`));
  return s;
}

export async function renderTrust(root) {
  const { root: shell, body } = pageShell(
    'Trust, Safety & Spiritual Integrity',
    'What we ask of each other — and what you can ask of us',
  );
  root.appendChild(shell);

  // --- community standards ---
  const standards = section('Community standards', 't-standards');
  standards.appendChild(el(`<p class="about-text">SEREN is a consent-first space for intentional spiritual, metaphysical, and consciousness-centered connection. That only works if people feel safe enough to be sincere. These standards apply to every member, everywhere in SEREN.</p>`));
  const list = el(`<ul class="reason-list"></ul>`);
  for (const item of [
    'Consent at every step. No one owes anyone a reply, a meeting, or a second conversation. A decline is a complete answer.',
    'No harassment, coercion, pressure, or exploitation — of any kind, for any reason.',
    'No unwanted contact. If someone has not said yes, the answer is no.',
    'Be who you say you are. Misleading profiles and false identities are not welcome.',
    'Keep gatherings safe. Anyone organizing an in-person meeting through SEREN is expected to choose public, accessible settings and to respect boundaries without question.',
  ]) list.appendChild(el(`<li>${esc(item)}</li>`));
  standards.appendChild(list);
  body.appendChild(standards);

  // --- consent policy ---
  const consent = section('Consent policy', 't-consent');
  consent.appendChild(el(`<p class="about-text">Consent here is staged and ongoing, not a one-time checkbox:</p>`));
  const cl = el(`<ul class="reason-list"></ul>`);
  for (const item of [
    'Introductions need a yes from both people before any contact details are shared.',
    'You can pause discovery, withdraw a request, or end a connection at any time — quietly, without having to explain.',
    'Blocking stops all contact immediately. The other person is not notified.',
    'Your email, exact location, and contact details are never shown to other members. Sensitive details are only ever shared by you, deliberately.',
  ]) cl.appendChild(el(`<li>${esc(item)}</li>`));
  consent.appendChild(cl);
  consent.appendChild(el(`<p class="field-hint">Manage your consent anytime in <a href="#/me">Me → your settings</a>.</p>`));
  body.appendChild(consent);

  // --- spiritual integrity ---
  const integrity = section('Spiritual integrity', 't-integrity');
  integrity.appendChild(el(`<p class="about-text">Spiritual language carries power, and power can be misused. In SEREN:</p>`));
  const il = el(`<ul class="reason-list"></ul>`);
  for (const item of [
    'No guru or oracle claims. No one here speaks with special authority over your path — not members, not hosts, and not the SEREN guide.',
    'No fate or destiny guarantees. A meaningful coincidence is just that: meaningful to you. No one may claim the universe demands a particular outcome.',
    'No manipulative spiritual claims — pressure, fear, or “spiritual” justification for controlling someone else is a reportable violation.',
    'No clinical, medical, or mental-health-treatment claims. SEREN is peer connection, not care.',
  ]) il.appendChild(el(`<li>${esc(item)}</li>`));
  integrity.appendChild(il);
  body.appendChild(integrity);

  // --- anti-coercion ---
  const coercion = section('Against coercion', 't-coercion');
  coercion.appendChild(el(`<p class="about-text">Persuasion dressed as spirituality is still coercion. Watch for: being told you “must” act to avoid spiritual harm, being isolated from other perspectives, being asked for money, secrecy, or intimacy as a condition of guidance. If any of this happens — from a member, a host, or anyone — report it. You will be believed, and you will not be asked to keep engaging.</p>`));
  body.appendChild(coercion);

  // --- sensitive data ---
  const data = section('Sensitive information', 't-data');
  data.appendChild(el(`<p class="about-text">Keep private spiritual information, exact location, contact details, financial details, and health information to yourself until — and unless — you deliberately choose to share them with someone you trust. SEREN will never ask for them on anyone else’s behalf, and no one here needs them to connect with you.</p>`));
  body.appendChild(data);

  // --- AI transparency ---
  const ai = section('About the SEREN guide (AI transparency)', 't-ai');
  ai.appendChild(el(`<p class="about-text">The SEREN guide is a rule-based assistant — it follows fixed, human-written rules; it does not improvise, channel, or intuit. It is always labeled as SEREN, never presented as a person. AI participants in the network are always labeled with their tier (Unverified, Operator-attested, or Host-reviewed). If anything ever feels like it is pretending to be human, report it.</p>`));
  body.appendChild(ai);

  // --- crisis & grounding ---
  const crisis = section('Crisis & grounding resources', 't-crisis');
  const box = el(`<div class="crisis-box" role="note" aria-label="Crisis resources"></div>`);
  box.appendChild(el(`<h3>If you are struggling, please reach a human</h3>`));
  box.appendChild(el(`<p>SEREN is a connection platform — not medical, mental-health, or emergency support. If you are in crisis or thinking about harming yourself, please contact your local emergency number (in the US, 911) or a trusted support line right away.</p>`));
  box.appendChild(el(`<p><strong>United States:</strong> call or text <strong>988</strong> — the Suicide and Crisis Lifeline, available 24/7. You can also text <strong>HOME</strong> to <strong>741741</strong> to reach the Crisis Text Line.</p>`));
  box.appendChild(el(`<p class="field-hint">Outside the US, find your local helpline through findahelpline.org or your country’s emergency services. A trusted friend, counselor, or faith leader can also help you ground.</p>`));
  crisis.appendChild(box);
  crisis.appendChild(el(`<p class="about-text">Grounding, if a conversation ever feels overwhelming: pause, feel your feet on the floor, name five things you can see, and step away from the screen. You can end any connection or pause discovery at any time — no explanation needed.</p>`));
  body.appendChild(crisis);

  // --- report / block ---
  const report = section('How to report or block', 't-report');
  report.appendChild(el(`<p class="about-text">Every conversation has a <strong>Report</strong> button, and you can <strong>Block</strong> anyone at any time from their profile or conversation. Reports are reviewed by a human host — never by an algorithm alone.</p>`));
  const rl = el(`<ul class="reason-list"></ul>`);
  for (const item of [
    'Choose the reason that fits best — including unwanted contact, manipulative spiritual claims, coercion, exploitation, harassment, unsafe events, or harmful AI output — and add details if you can.',
    'Blocking takes effect immediately and quietly; the other person is not notified.',
    'Hosts can dismiss a report, hide a profile from the community, and follow up with the people involved.',
    'If you ever feel unsafe right now, prioritize your safety first and report when you are able.',
  ]) rl.appendChild(el(`<li>${esc(item)}</li>`));
  report.appendChild(rl);
  body.appendChild(report);
}
