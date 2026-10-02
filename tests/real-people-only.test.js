// SEREN MVP — real-people-only matching tests.
// Demo seed members (is_seed = 1) must never appear as matching candidates
// (Discover, guide proposals, home suggestions all draw from
// listCandidateProfiles). QA/test profiles created after the v5 one-time
// sweep are caught by the v15 migration.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const dir = mkdtempSync(join(tmpdir(), 'seren-realpeople-'));
process.env.DB_PATH = join(dir, 'realpeople.db');
process.env.SEED_DEMO = 'false';

// Dynamic import so DB_PATH / SEED_DEMO are honored at db-module load time.
const dbmod = await import('../src/db.js');

after(async () => {
  try { dbmod.db.close(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true });
});

let emailSeq = 0;
const uniqueEmail = () => `realpeople${++emailSeq}@example.com`;

function memberBody(name, email, extra = {}) {
  return {
    name,
    email,
    interests: ['meditation', 'yoga'],
    intention: 'I want to find a meditation partner for daily morning practice.',
    connectionPrefs: { seeking: ['practice-partner'], availability: 'Mornings' },
    consents: { introductions: true, community_visible: true, ai_matching: true },
    ...extra,
  };
}

test('demo seed profiles are excluded from matching candidates', () => {
  const real = dbmod.createProfile(memberBody('Real Member', uniqueEmail()));
  const seed = dbmod.createProfile(memberBody('Demo Seed', uniqueEmail(), { isSeed: true }));

  const ids = dbmod.listCandidateProfiles().map((p) => p.id);
  assert.ok(ids.includes(real.id), 'real member is a candidate');
  assert.ok(!ids.includes(seed.id), 'demo seed member is not a candidate');

  // The seed still exists and is directly retrievable (host moderation, etc.).
  assert.equal(dbmod.getProfile(seed.id).name, 'Demo Seed');
  assert.equal(dbmod.getProfile(seed.id).isSeed, true);
});

test('v15 migration hides QA/test profiles created after v5 ran', async () => {
  const dir2 = mkdtempSync(join(tmpdir(), 'seren-mig15-'));
  const dbPath2 = join(dir2, 'mig15.db');
  process.env.DB_PATH = dbPath2;

  // Fresh module instance: all migrations run on an empty DB.
  const fresh = await import('../src/db.js?mig15a');
  const qa = fresh.createProfile(memberBody('QA Tester', uniqueEmail()));
  assert.ok(
    fresh.listCandidateProfiles().some((p) => p.id === qa.id),
    'QA Tester is visible before the v15 sweep (migration is one-time)',
  );

  // Simulate a pre-v15 database, then re-run migrations on it.
  fresh.db.exec('PRAGMA user_version = 14');
  fresh.db.close();
  process.env.DB_PATH = dbPath2;
  const migrated = await import('../src/db.js?mig15b');

  const ids = migrated.listCandidateProfiles().map((p) => p.id);
  assert.ok(!ids.includes(qa.id), 'QA Tester is hidden after v15 runs');
  assert.equal(migrated.getProfile(qa.id).isHidden, true);

  migrated.db.close();
  rmSync(dir2, { recursive: true, force: true });
});
