// SEREN MVP — Layer 3 (Benevolent AI -> Benevolent AI) tests.
// The World 3.0 handshake is bounded: both agents must be Bronze or
// above, Human Mode needs a Silver agent plus host review, both
// accountable operators must accept, and acceptance only creates an
// ordinary proposed human introduction. Declines are durable per pair.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const dir = mkdtempSync(join(tmpdir(), 'seren-layer3-'));
process.env.DB_PATH = join(dir, 'layer3-test.db');
process.env.SEED_DEMO = 'false';
process.env.BETA_CODE = 'layer3-test-beta-code';
process.env.SEREN_HOSTS = 'layer3-host@example.com';

const { app, db } = await import('../src/server.js');

const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const BASE = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try { db.close(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true });
});

let emailSeq = 0;
const uniqueEmail = () => `layer3-${++emailSeq}@example.com`;

function profileBody(name, email) {
  return {
    name,
    email,
    interests: ['meditation', 'yoga'],
    intention: 'I want to find a meditation partner for daily morning practice.',
    connectionPrefs: { seeking: ['practice-partner'], availability: 'Mornings' },
    consents: { introductions: true, community_visible: true, ai_matching: true },
  };
}

const pick = (setCookie, name) => (setCookie.match(new RegExp(name + '=[^;]+')) || [])[0] || '';

async function createMember(name, email) {
  let r = await fetch(`${BASE}/api/beta/enter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'layer3-test-beta-code' }),
  });
  assert.equal(r.status, 200);
  const beta = pick(r.headers.get('set-cookie') || '', 'seren_beta');
  r = await fetch(`${BASE}/api/profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: beta },
    body: JSON.stringify(profileBody(name, email)),
  });
  const bodyText = await r.text();
  assert.equal(r.status, 201, `profile creation failed: ${bodyText}`);
  const data = JSON.parse(bodyText);
  const cookie = [beta, pick(r.headers.get('set-cookie') || '', 'seren_profile')].filter(Boolean).join('; ');
  return { id: data.id, cookie };
}

async function api(method, path, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data };
}

const FULL_VETTING = {
  no_manipulation: true,
  no_covert_data: true,
  human_accountable: true,
  clear_purpose: true,
  respects_consent: true,
};

async function registerAgent(cookie, name) {
  const r = await api('POST', '/api/agents', {
    name,
    description: `${name} helps its operator find calm, consent-first connections.`,
    capabilities: ['meditation', 'journaling'],
    vetting: FULL_VETTING,
  }, cookie);
  assert.equal(r.status, 201, `agent registration failed: ${JSON.stringify(r.data)}`);
  return r.data;
}

const host = await createMember('Layer3 Host', 'layer3-host@example.com');
const sourceOp = await createMember('Source Operator', uniqueEmail());
const targetOp = await createMember('Target Operator', uniqueEmail());
const outsider = await createMember('Outside Member', uniqueEmail());

const sourceAgent = await registerAgent(sourceOp.cookie, 'Source Agent');
const sourceSecondAgent = await registerAgent(sourceOp.cookie, 'Source Second Agent');
const targetAgent = await registerAgent(targetOp.cookie, 'Target Agent');
const targetSecondAgent = await registerAgent(targetOp.cookie, 'Target Second Agent');

const RATIONALE = 'Our operators share a morning meditation intention and complementary offers.';

test('data mode: operators accept and an ordinary proposed introduction is created', async () => {
  const created = await api('POST', '/api/agent-connections', {
    sourceAgentId: sourceAgent.id,
    targetAgentId: targetAgent.id,
    mode: 'data',
    rationale: RATIONALE,
    dataBasis: 'Declared shared interest in meditation and daily practice.',
  }, sourceOp.cookie);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.status, 'proposed');
  assert.equal(created.data.introductionId, null);

  const mine = await api('GET', '/api/agent-connections/mine', undefined, targetOp.cookie);
  assert.equal(mine.status, 200);
  assert.ok(mine.data.connections.some((c) => c.id === created.data.id));

  const accepted = await api('POST', `/api/agent-connections/${created.data.id}/respond`, {
    action: 'accept',
  }, targetOp.cookie);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  assert.equal(accepted.data.status, 'accepted');
  assert.ok(Number.isInteger(accepted.data.introductionId));

  const intro = db.prepare('SELECT * FROM introductions WHERE id = ?').get(accepted.data.introductionId);
  assert.equal(intro.requester_id, sourceOp.id);
  assert.equal(intro.proposed_id, targetOp.id);
  assert.equal(intro.status, 'proposed');
  assert.equal(intro.connection_type, 'agent-mediated');
});

test('synchronicity mode validates its labeled signal and a decline is durable', async () => {
  const invalid = await api('POST', '/api/agent-connections', {
    sourceAgentId: sourceSecondAgent.id,
    targetAgentId: targetAgent.id,
    mode: 'synchronicity',
    rationale: RATIONALE,
  }, sourceOp.cookie);
  assert.equal(invalid.status, 400);

  const created = await api('POST', '/api/agent-connections', {
    sourceAgentId: sourceSecondAgent.id,
    targetAgentId: targetAgent.id,
    mode: 'synchronicity',
    rationale: RATIONALE,
    synchronicitySignal: 'Two operators independently carried the word "estuary" this week.',
    synchronicitySource: 'member_supplied',
  }, sourceOp.cookie);
  assert.equal(created.status, 201, JSON.stringify(created.data));

  const declined = await api('POST', `/api/agent-connections/${created.data.id}/respond`, {
    action: 'decline',
    responderNote: 'Not the right season for this connection.',
  }, targetOp.cookie);
  assert.equal(declined.status, 200);
  assert.equal(declined.data.status, 'declined');

  const resent = await api('POST', '/api/agent-connections', {
    sourceAgentId: sourceSecondAgent.id,
    targetAgentId: targetAgent.id,
    mode: 'data',
    rationale: RATIONALE,
    dataBasis: 'Trying another mode must not bypass the durable decline.',
  }, sourceOp.cookie);
  assert.equal(resent.status, 409);
});

test('a withdrawn proposal can be reopened as the same durable pair', async () => {
  const created = await api('POST', '/api/agent-connections', {
    sourceAgentId: sourceAgent.id,
    targetAgentId: targetSecondAgent.id,
    mode: 'data',
    rationale: RATIONALE,
    dataBasis: 'Declared shared interest in meditation and journaling.',
  }, sourceOp.cookie);
  assert.equal(created.status, 201, JSON.stringify(created.data));

  const withdrawn = await api('POST', `/api/agent-connections/${created.data.id}/respond`, {
    action: 'withdraw',
  }, sourceOp.cookie);
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.data.status, 'withdrawn');

  const reopened = await api('POST', '/api/agent-connections', {
    sourceAgentId: sourceAgent.id,
    targetAgentId: targetSecondAgent.id,
    mode: 'synchronicity',
    rationale: RATIONALE,
    synchronicitySignal: 'Both operators named "first light" as a meaningful phrase.',
    synchronicitySource: 'seren_generated',
  }, sourceOp.cookie);
  assert.equal(reopened.status, 201, JSON.stringify(reopened.data));
  assert.equal(reopened.data.id, created.data.id);
  assert.equal(reopened.data.status, 'proposed');
  assert.equal(reopened.data.mode, 'synchronicity');
});

test('human mode requires Silver plus host review before target acceptance', async () => {
  const premature = await api('POST', '/api/agent-connections', {
    sourceAgentId: sourceSecondAgent.id,
    targetAgentId: targetSecondAgent.id,
    mode: 'human',
    rationale: 'A person should review this basis before anyone is introduced.',
  }, sourceOp.cookie);
  assert.equal(premature.status, 409, 'two Bronze agents must not clear the Human Mode handshake');

  const reviewedAgent = await api('POST', `/api/agents/${targetSecondAgent.id}/review`, {}, host.cookie);
  assert.equal(reviewedAgent.status, 200);
  assert.equal(reviewedAgent.data.certTier, 'silver');

  const created = await api('POST', '/api/agent-connections', {
    sourceAgentId: sourceSecondAgent.id,
    targetAgentId: targetSecondAgent.id,
    mode: 'human',
    rationale: 'A person should review this basis before anyone is introduced.',
  }, sourceOp.cookie);
  assert.equal(created.status, 201, JSON.stringify(created.data));

  const tooEarly = await api('POST', `/api/agent-connections/${created.data.id}/respond`, {
    action: 'accept',
  }, targetOp.cookie);
  assert.equal(tooEarly.status, 409);

  const queue = await api('GET', '/api/agent-connections/host', undefined, host.cookie);
  assert.equal(queue.status, 200);
  assert.ok(queue.data.connections.some((c) => c.id === created.data.id));

  const hostReviewed = await api('POST', `/api/agent-connections/${created.data.id}/host-review`, {}, host.cookie);
  assert.equal(hostReviewed.status, 200, JSON.stringify(hostReviewed.data));
  assert.equal(hostReviewed.data.hostApproved, true);

  const accepted = await api('POST', `/api/agent-connections/${created.data.id}/respond`, {
    action: 'accept',
  }, targetOp.cookie);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  assert.equal(accepted.data.status, 'accepted');
  assert.ok(Number.isInteger(accepted.data.introductionId));
});

test('ungraded agents and same-operator pairs cannot connect', async () => {
  const now = new Date().toISOString();
  const row = db.prepare(`
    INSERT INTO agents (name, kind, operator_profile_id, description, capabilities_json, endpoint_url, trust_note, vetting_json, verified, is_hidden, created_at, updated_at)
    VALUES ('Ungraded Agent', 'ai', ?, 'Legacy listing without a checklist.', '[]', '', '', '{}', 0, 0, ?, ?)
  `).run(targetOp.id, now, now);

  const ungraded = await api('POST', '/api/agent-connections', {
    sourceAgentId: sourceAgent.id,
    targetAgentId: Number(row.lastInsertRowid),
    mode: 'data',
    rationale: RATIONALE,
    dataBasis: 'This must fail until the receiving operator completes the checklist.',
  }, sourceOp.cookie);
  assert.equal(ungraded.status, 409);

  const sameOperator = await api('POST', '/api/agent-connections', {
    sourceAgentId: sourceAgent.id,
    targetAgentId: sourceSecondAgent.id,
    mode: 'data',
    rationale: RATIONALE,
    dataBasis: 'The same accountable operator owns both agents.',
  }, sourceOp.cookie);
  assert.equal(sameOperator.status, 409);
});

test('only accountable operators can propose or inspect a connection', async () => {
  const forbiddenCreate = await api('POST', '/api/agent-connections', {
    sourceAgentId: sourceAgent.id,
    targetAgentId: targetAgent.id,
    mode: 'data',
    rationale: RATIONALE,
    dataBasis: 'An outsider must not act for the source operator.',
  }, outsider.cookie);
  assert.equal(forbiddenCreate.status, 403);

  const mine = await api('GET', '/api/agent-connections/mine', undefined, sourceOp.cookie);
  assert.equal(mine.status, 200);
  assert.ok(mine.data.connections.length > 0);
  const first = mine.data.connections[0];

  const forbiddenRead = await api('GET', `/api/agent-connections/${first.id}`, undefined, outsider.cookie);
  assert.equal(forbiddenRead.status, 403);
});
