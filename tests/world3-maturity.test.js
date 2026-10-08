// SEREN MVP — World 3.0 ethical-maturity tests.
// Agent standing is derived from evidence only: unverified agents are
// "ungraded", a complete benevolence checklist yields "bronze", and a
// host review yields "silver" (docs/SEREN_AI_CONSTITUTION.md §5).
// Gold/platinum are aspirational rungs and must never be assigned.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const dir = mkdtempSync(join(tmpdir(), 'seren-w3-'));
process.env.DB_PATH = join(dir, 'w3-test.db');
process.env.SEED_DEMO = 'false';
process.env.BETA_CODE = 'w3-test-beta-code';
process.env.SEREN_HOSTS = 'w3-host@example.com';

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
const uniqueEmail = () => `w3-${++emailSeq}@example.com`;

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
    body: JSON.stringify({ code: 'w3-test-beta-code' }),
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

const host = await createMember('W3 Host', 'w3-host@example.com');
const op = await createMember('W3 Operator', uniqueEmail());

// ---------- tests ----------

test('unverified agent is ungraded', async () => {
  const row = db.prepare(`
    INSERT INTO agents (name, kind, operator_profile_id, description, capabilities_json, endpoint_url, trust_note, vetting_json, verified, is_hidden, created_at, updated_at)
    VALUES ('Ungraded Agent', 'ai', ?, 'Legacy listing.', '[]', '', '', '{}', 0, 0, ?, ?)
  `).run(op.id, new Date().toISOString(), new Date().toISOString());
  const r = await api('GET', `/api/agents/${row.lastInsertRowid}`, undefined, op.cookie);
  assert.equal(r.status, 200);
  assert.equal(r.data.trustTier, 'unverified');
  assert.equal(r.data.certTier, 'ungraded');
});

test('complete checklist yields bronze', async () => {
  const r = await api('POST', '/api/agents', {
    name: 'Bronze Agent',
    description: 'A calm journaling companion.',
    vetting: FULL_VETTING,
  }, op.cookie);
  assert.equal(r.status, 201);
  assert.equal(r.data.trustTier, 'operator-attested');
  assert.equal(r.data.certTier, 'bronze');
});

test('host review yields silver', async () => {
  const created = await api('POST', '/api/agents', {
    name: 'Silver Agent', vetting: FULL_VETTING,
  }, op.cookie);
  assert.equal(created.status, 201);
  assert.equal(created.data.certTier, 'bronze');
  const reviewed = await api('POST', `/api/agents/${created.data.id}/review`, {}, host.cookie);
  assert.equal(reviewed.status, 200);
  const check = await api('GET', `/api/agents/${created.data.id}`, undefined, op.cookie);
  assert.equal(check.data.trustTier, 'host-reviewed');
  assert.equal(check.data.certTier, 'silver');
});

test('gold and platinum are never assigned', async () => {
  const r = await api('GET', '/api/agents', undefined, op.cookie);
  assert.equal(r.status, 200);
  for (const a of r.data.agents) {
    assert.ok(['ungraded', 'bronze', 'silver'].includes(a.certTier),
      `unexpected certTier ${a.certTier} on agent ${a.id}`);
  }
});
