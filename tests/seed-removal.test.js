// SEREN MVP — v18 migration: demo seed profile removal.
// The October QA pass decided the only people in the database should be
// real members. v18 deletes every profile with is_seed = 1 using the same
// related-row cleanup as deleteProfile (introductions closed out, circles,
// agents, connection plans, decline blocks, guide/chat sessions, blocks,
// reports, saved items, passes, messages, briefs, plus the ON DELETE
// CASCADE tables). Hidden QA/test records (is_hidden = 1, e.g. "QA
// Tester") must survive — that removal decision is still pending.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const dir = mkdtempSync(join(tmpdir(), 'seren-seedremoval-'));
process.env.DB_PATH = join(dir, 'seedremoval.db');
// SEED_DEMO left at its default (enabled) so the 6 demo profiles exist.
delete process.env.SEED_DEMO;

// Dynamic import so DB_PATH is honored at db-module load time.
const dbmod = await import('../src/db.js');

after(async () => {
  try { dbmod.db.close(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true });
});

let emailSeq = 0;
const uniqueEmail = () => `seedremoval${++emailSeq}@example.com`;

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

const count = (db, sql, ...params) => db.prepare(sql).get(...params).c;

test('v18 migration removes seed profiles and related rows; real and hidden profiles survive', async () => {
  // The fresh DB was seeded on first import.
  const seedRows = dbmod.db.prepare('SELECT id, name FROM profiles WHERE is_seed = 1').all();
  assert.equal(seedRows.length, 6, `expected 6 seeded demo profiles, got ${seedRows.length}`);

  const real = dbmod.createProfile(memberBody('Real Ren', uniqueEmail()));
  // QA Tester analogue: hidden, NOT a seed — must survive v18.
  const qa = dbmod.createProfile(memberBody('QA Tester', uniqueEmail()));
  dbmod.db.prepare('UPDATE profiles SET is_hidden = 1 WHERE id = ?').run(qa.id);

  const seed = seedRows.find((r) => r.name === 'Elena Vargas');
  assert.ok(seed, 'expected a seed profile named Elena Vargas');

  // Related rows mirroring the production case (a seed connected to a real
  // member): an accepted introduction, a message from the seed, guide and
  // chat sessions, a brief, and a pass recorded by the real member.
  const intro = dbmod.createIntroduction({
    requesterId: real.id, proposedId: seed.id, intention: 'test', note: '', score: 0,
  });
  dbmod.db.prepare("UPDATE introductions SET status = 'accepted' WHERE id = ?").run(intro.id);
  dbmod.createMessage({ introductionId: intro.id, senderId: seed.id, body: 'hello from seed' });
  dbmod.createGuideSession({ profileId: seed.id, requestText: 'seeking', parsed: {} });
  dbmod.createChatSession({ profileId: seed.id });
  dbmod.db.prepare(`INSERT INTO briefs
    (profile_id, who_text, intention_text, good_fit_text, offer_text, logistics_text,
     boundaries_text, private_notes, shared_text, consent_save, consent_share, status, created_at, updated_at)
    VALUES (?, 'w', 'i', 'g', 'o', 'l', 'b', '', 's', 1, 1, 'active', datetime('now'), datetime('now'))`)
    .run(seed.id);
  dbmod.db.prepare('INSERT INTO passes (profile_id, passed_id, created_at) VALUES (?, ?, datetime(\'now\'))')
    .run(real.id, seed.id);

  // Simulate a pre-v18 database, then re-run migrations on it.
  dbmod.db.exec('PRAGMA user_version = 17');
  dbmod.db.close();
  const migrated = await import('../src/db.js?seedremoval-v18');

  // All seed profiles are gone.
  assert.equal(
    count(migrated.db, 'SELECT COUNT(*) AS c FROM profiles WHERE is_seed = 1'), 0,
    'no seed profiles remain after v18',
  );
  // Their related rows are cleaned up.
  assert.equal(count(migrated.db, 'SELECT COUNT(*) AS c FROM guide_sessions WHERE profile_id = ?', seed.id), 0);
  assert.equal(count(migrated.db, 'SELECT COUNT(*) AS c FROM chat_sessions WHERE profile_id = ?', seed.id), 0);
  assert.equal(count(migrated.db, 'SELECT COUNT(*) AS c FROM briefs WHERE profile_id = ?', seed.id), 0);
  assert.equal(count(migrated.db, 'SELECT COUNT(*) AS c FROM messages WHERE sender_id = ?', seed.id), 0);
  assert.equal(count(migrated.db, 'SELECT COUNT(*) AS c FROM passes WHERE profile_id = ? OR passed_id = ?', seed.id, seed.id), 0);
  // The accepted introduction is closed out, not orphaned.
  const introAfter = migrated.db.prepare('SELECT status FROM introductions WHERE id = ?').get(intro.id);
  assert.equal(introAfter.status, 'ended', 'accepted introduction with a removed seed is ended');

  // The real member and the hidden QA record survive untouched.
  assert.equal(migrated.getProfile(real.id).name, 'Real Ren', 'real profile survives v18');
  assert.equal(migrated.getProfile(qa.id).name, 'QA Tester', 'hidden QA profile survives v18');
  assert.equal(migrated.getProfile(qa.id).isHidden, true);

  migrated.db.close();
});
