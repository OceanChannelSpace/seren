// SEREN MVP — agent vetting tests.
// Registration requires the five-item benevolence checklist; display tiers
// are Unverified / Operator-attested / Host-reviewed ("Verified" is never
// used). Host review is host-only.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const dir = mkdtempSync(join(tmpdir(), 'seren-vet-'));
process.env.DB_PATH = join(dir, 'vet-test.db');
process.env.SEED_DEMO = 'false';
process.env.BETA_CODE = 'vet-test-beta-code';
process.env.SEREN_HOSTS = 'vet-host@example.com';

const { app, db } = await import('../src/server.js');

const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const BASE = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try { db.close(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true });
});

// ---------- helpers ----------

let emailSeq = 0;
const uniqueEmail = () => `vetter${++emailSeq}@example.com`;

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
    body: JSON.stringify({ code: 'vet-test-beta-code' }),
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

const host = await createMember('Vet Host', 'vet-host@example.com');
const op = await createMember('Vet Operator', uniqueEmail());

// ---------- tests ----------

test('registration without vetting is rejected', async () => {
  const r = await api('POST', '/api/agents', { name: 'No Checklist' }, op.cookie);
  assert.equal(r.status, 400);
  assert.ok(r.data.error.details.some((d) => d.field === 'vetting'));
});

test('registration with a partial checklist is rejected', async () => {
  const r = await api('POST', '/api/agents', {
    name: 'Partial Checklist',
    vetting: { ...FULL_VETTING, respects_consent: false },
  }, op.cookie);
  assert.equal(r.status, 400);
  assert.ok(r.data.error.details.some((d) => d.field === 'vetting.respects_consent'));
});

test('registration with the full checklist yields operator-attested', async () => {
  const r = await api('POST', '/api/agents', {
    name: 'Attested Agent',
    description: 'A calm journaling companion.',
    vetting: FULL_VETTING,
  }, op.cookie);
  assert.equal(r.status, 201);
  assert.equal(r.data.trustTier, 'operator-attested');
  assert.equal(r.data.vettingComplete, true);
  assert.equal(r.data.reviewed, false);
});

test('pre-checklist agents display as unverified', async () => {
  // Insert directly, bypassing validation — the legacy state.
  const row = db.prepare(`
    INSERT INTO agents (name, kind, operator_profile_id, description, capabilities_json, endpoint_url, trust_note, vetting_json, verified, is_hidden, created_at, updated_at)
    VALUES ('Legacy Agent', 'ai', ?, 'Old listing.', '[]', '', '', '{}', 0, 0, ?, ?)
  `).run(op.id, new Date().toISOString(), new Date().toISOString());
  const r = await api('GET', `/api/agents/${row.lastInsertRowid}`, undefined, op.cookie);
  assert.equal(r.status, 200);
  assert.equal(r.data.trustTier, 'unverified');
  assert.equal(r.data.vettingComplete, false);
});

test('operator can complete the checklist later via update', async () => {
  const created = await api('POST', '/api/agents', {
    name: 'Late Bloomer',
    vetting: FULL_VETTING,
  }, op.cookie);
  assert.equal(created.status, 201);
  // Simulate an agent whose vetting was cleared, then re-completed.
  db.prepare('UPDATE agents SET vetting_json = ? WHERE id = ?').run('{}', created.data.id);
  const before = await api('GET', `/api/agents/${created.data.id}`, undefined, op.cookie);
  assert.equal(before.data.trustTier, 'unverified');
  const upd = await api('PATCH', `/api/agents/${created.data.id}`, { vetting: FULL_VETTING }, op.cookie);
  assert.equal(upd.status, 200);
  assert.equal(upd.data.trustTier, 'operator-attested');
});

test('non-host cannot mark an agent reviewed', async () => {
  const created = await api('POST', '/api/agents', {
    name: 'Review Target', vetting: FULL_VETTING,
  }, op.cookie);
  const r = await api('POST', `/api/agents/${created.data.id}/review`, {}, op.cookie);
  assert.equal(r.status, 403);
  const check = await api('GET', `/api/agents/${created.data.id}`, undefined, op.cookie);
  assert.equal(check.data.trustTier, 'operator-attested');
});

test('host can mark an agent reviewed', async () => {
  const created = await api('POST', '/api/agents', {
    name: 'Reviewed Agent', vetting: FULL_VETTING,
  }, op.cookie);
  const r = await api('POST', `/api/agents/${created.data.id}/review`, {}, host.cookie);
  assert.equal(r.status, 200);
  assert.equal(r.data.trustTier, 'host-reviewed');
  assert.equal(r.data.reviewed, true);
  const listed = await api('GET', '/api/agents', undefined, op.cookie);
  const found = listed.data.agents.find((a) => a.id === created.data.id);
  assert.equal(found.trustTier, 'host-reviewed');
});

test('review of an unknown agent is 404', async () => {
  const r = await api('POST', '/api/agents/99999/review', {}, host.cookie);
  assert.equal(r.status, 404);
});

test('unauthenticated review attempt is rejected', async () => {
  const r = await api('POST', '/api/agents/1/review', {});
  assert.ok([401, 403].includes(r.status));
});

test('/api/meta exposes the vetting checklist publicly', async () => {
  const r = await api('GET', '/api/meta', undefined, op.cookie);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.agentVetting));
  assert.equal(r.data.agentVetting.length, 5);
  assert.ok(r.data.agentVetting.every((i) => i.key && i.label && i.description));
});
