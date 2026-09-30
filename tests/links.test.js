// SEREN — tests for v5: optional profile links (consent-gated) and the
// one-time hiding of QA/test records from user-facing surfaces.
// Same harness as api.test.js (isolated temp DB, no seeds).

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const dir = mkdtempSync(join(tmpdir(), 'seren-links-'));
process.env.DB_PATH = join(dir, 'links-test.db');
process.env.SEED_DEMO = 'false';

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
const uniqueEmail = () => `link${++emailSeq}@example.com`;

function profileBody(overrides = {}) {
  return {
    name: 'Link Tester',
    email: uniqueEmail(),
    interests: ['meditation'],
    intention: 'I am looking for a calm meditation partner for weekly practice.',
    connectionPrefs: { seeking: ['practice-partner'], availability: 'Evenings' },
    consents: { introductions: true, community_visible: true, ai_matching: true },
    practices: ['meditation'],
    intentions: ['meditation-partner'],
    ...overrides,
  };
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

async function createProfile(overrides = {}) {
  const { status, json } = await api('POST', '/api/profiles', profileBody(overrides));
  assert.equal(status, 201, `profile creation failed: ${JSON.stringify(json)}`);
  return json;
}

// ---------- links validation ----------

test('links validation: bad URLs, unknown keys, and non-objects are rejected', async () => {
  const p = await createProfile();

  const badUrl = await api('PATCH', `/api/profiles/${p.id}`, { links: { website: 'not a url' } });
  assert.equal(badUrl.status, 400);

  const badScheme = await api('PATCH', `/api/profiles/${p.id}`, { links: { website: 'ftp://example.com/x' } });
  assert.equal(badScheme.status, 400);

  const unknownKey = await api('PATCH', `/api/profiles/${p.id}`, { links: { myspace: 'https://example.com' } });
  assert.equal(unknownKey.status, 400);

  const notObject = await api('PATCH', `/api/profiles/${p.id}`, { links: 'https://example.com' });
  assert.equal(notObject.status, 400);

  const tooLong = await api('PATCH', `/api/profiles/${p.id}`, { links: { website: `https://example.com/${'x'.repeat(300)}` } });
  assert.equal(tooLong.status, 400);
});

test('links are normalized to https URLs on write', async () => {
  const p = await createProfile();
  const res = await api('PATCH', `/api/profiles/${p.id}`, {
    links: { website: 'example.com', instagram: 'https://instagram.com/calm' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.links.website, 'https://example.com/');
  assert.equal(res.json.links.instagram, 'https://instagram.com/calm');
});

test('links are optional: empty object clears them', async () => {
  const p = await createProfile();
  await api('PATCH', `/api/profiles/${p.id}`, { links: { website: 'example.com' } });
  const cleared = await api('PATCH', `/api/profiles/${p.id}`, { links: {} });
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.json.links, {});
});

// ---------- consent gating ----------

test('links are hidden from strangers, visible to the owner and after mutual consent', async () => {
  const a = await createProfile({ name: 'Link Owner' });
  const b = await createProfile({ name: 'Link Viewer', email: uniqueEmail() });

  await api('PATCH', `/api/profiles/${a.id}`, { links: { website: 'https://owner.example' } });

  // Owner always sees their own links.
  const owner = await api('GET', `/api/profiles/${a.id}?viewerId=${a.id}`);
  assert.equal(owner.json.links.website, 'https://owner.example/');

  // Stranger (no mutual connection) does not.
  const stranger = await api('GET', `/api/profiles/${a.id}?viewerId=${b.id}`);
  assert.equal(stranger.status, 200);
  assert.ok(!('links' in stranger.json), 'links leaked to a stranger');

  // Build a mutual connection: A requests, B accepts.
  const req = await api('POST', '/api/connections/request', {
    requesterId: a.id,
    targetId: b.id,
    connectionType: 'practice-partner',
    message: 'I would love a calm weekly meditation sit together, if that feels aligned.',
  });
  assert.equal(req.status, 201);
  const accept = await api('POST', `/api/introductions/${req.json.introduction.id}/respond`, {
    profileId: b.id,
    response: 'accepted',
  });
  assert.equal(accept.status, 200);

  // After mutual consent, links are visible.
  const mutual = await api('GET', `/api/profiles/${a.id}?viewerId=${b.id}`);
  assert.equal(mutual.json.links.website, 'https://owner.example/');
  assert.equal(mutual.json.mutual, true);
});

// ---------- hidden QA/test records ----------

test('hidden profiles are excluded from every user-facing surface', async () => {
  const hidden = await createProfile({ name: 'Hidden Quinn' });
  const visible = await createProfile({ name: 'Visible Vera' });

  // Simulate the v5 migration outcome for a QA/test record.
  db.prepare('UPDATE profiles SET is_hidden = 1 WHERE id = ?').run(hidden.id);

  // Public list excludes it.
  const list = await api('GET', '/api/profiles');
  const ids = list.json.profiles.map((p) => p.id);
  assert.ok(!ids.includes(hidden.id), 'hidden profile in /api/profiles');
  assert.ok(ids.includes(visible.id), 'visible profile missing from /api/profiles');

  // Discover excludes it.
  const disc = await api('GET', `/api/discover?profileId=${visible.id}`);
  assert.equal(disc.status, 200);
  const discIds = (disc.json.matches || disc.json.profiles || []).map((m) => m.id ?? m.profile?.id);
  assert.ok(!discIds.includes(hidden.id), 'hidden profile in /api/discover');

  // Direct profile URL returns only the minimal hidden view.
  const direct = await api('GET', `/api/profiles/${hidden.id}?viewerId=${visible.id}`);
  assert.equal(direct.status, 200);
  assert.equal(direct.json.hidden, true);
  assert.ok(!('intention' in direct.json), 'hidden profile intention leaked');
  assert.ok(!('links' in direct.json), 'hidden profile links leaked');

  // The owner still sees their own full profile.
  const owner = await api('GET', `/api/profiles/${hidden.id}?viewerId=${hidden.id}`);
  assert.equal(owner.json.name, 'Hidden Quinn');
  assert.ok(!owner.json.hidden);
});

test('qa-named profiles are not auto-hidden at creation (hiding is a one-time migration)', async () => {
  const qa = await createProfile({ name: 'QA Tester' });
  const list = await api('GET', '/api/profiles');
  const ids = list.json.profiles.map((p) => p.id);
  assert.ok(ids.includes(qa.id), 'newly created QA-named profile should stay visible until hidden');
});
