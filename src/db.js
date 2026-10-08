// SEREN — SQLite persistence (node:sqlite, DatabaseSync).
// Wire format is camelCase; DB columns are snake_case. Conversions happen here.
//
// Schema evolves through additive migrations guarded by PRAGMA user_version.
// v0: MVP tables (profiles, introductions).
// v1: profile extensions, staged-consent columns on introductions, and new
//     tables: circles, circle_members, circle_requests, blocks, reports,
//     saved_items, passes, messages, connection_plans.
// v12: host_assists (Human Mode) + partial unique index for one open
//      request per member.
// v13: beacons + beacon_matches (Synchronicity Mode) + partial unique index
//      for one active beacon per member.

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import { INTRO_STATUS, AGENT_VETTING_KEYS, AGENT_CERT_RANK } from './constants.js';
// v16 (Flourishing): reflective framing appended to synchronicity
// introduction notes — copy-only, no behavior change.
import { REFLECTIVE_FRAMING } from './sync-deck.js';

const DB_PATH = resolve(process.env.DB_PATH || './data/seren.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');

// ---------- base tables (v0) ----------

db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    interests TEXT NOT NULL,
    intention TEXT NOT NULL,
    connection_prefs TEXT NOT NULL,
    consents TEXT NOT NULL,
    is_seed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS introductions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER NOT NULL REFERENCES profiles(id),
    proposed_id INTEGER NOT NULL REFERENCES profiles(id),
    intention TEXT NOT NULL,
    note TEXT NOT NULL,
    score REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'proposed',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

// ---------- migration to v1 ----------

function hasColumn(table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r.name === column);
}

function addColumnIfMissing(table, column, ddl) {
  if (!hasColumn(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

function migrateToV1() {
  // Profile extensions.
  addColumnIfMissing('profiles', 'pronouns', 'TEXT NOT NULL DEFAULT \'\'');
  addColumnIfMissing('profiles', 'region', 'TEXT NOT NULL DEFAULT \'\'');
  addColumnIfMissing('profiles', 'photo_url', 'TEXT NOT NULL DEFAULT \'\'');
  addColumnIfMissing('profiles', 'about', 'TEXT NOT NULL DEFAULT \'\'');
  addColumnIfMissing('profiles', 'visual_identity', 'TEXT NOT NULL DEFAULT \'minimal\'');
  addColumnIfMissing('profiles', 'intentions', 'TEXT NOT NULL DEFAULT \'[]\'');
  addColumnIfMissing('profiles', 'intentions_other', 'TEXT NOT NULL DEFAULT \'\'');
  addColumnIfMissing('profiles', 'practices', 'TEXT NOT NULL DEFAULT \'[]\'');
  addColumnIfMissing('profiles', 'practices_other', 'TEXT NOT NULL DEFAULT \'\'');
  addColumnIfMissing('profiles', 'prefs', 'TEXT NOT NULL DEFAULT \'{}\'');
  addColumnIfMissing('profiles', 'consent_settings', 'TEXT NOT NULL DEFAULT \'{}\'');

  // Staged-consent columns on introductions.
  addColumnIfMissing('introductions', 'connection_type', 'TEXT NOT NULL DEFAULT \'\'');
  addColumnIfMissing('introductions', 'request_message', 'TEXT NOT NULL DEFAULT \'\'');
  addColumnIfMissing('introductions', 'format', 'TEXT NOT NULL DEFAULT \'\'');
  addColumnIfMissing('introductions', 'commitment', 'TEXT NOT NULL DEFAULT \'\'');
  addColumnIfMissing('introductions', 'tone', 'TEXT NOT NULL DEFAULT \'\'');
  addColumnIfMissing('introductions', 'responder_note', 'TEXT NOT NULL DEFAULT \'\'');
  addColumnIfMissing('introductions', 'response_kind', 'TEXT NOT NULL DEFAULT \'\'');

  db.exec(`
    CREATE TABLE IF NOT EXISTS circles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      purpose TEXT NOT NULL,
      privacy TEXT NOT NULL DEFAULT 'request-to-join',
      max_participants INTEGER NOT NULL DEFAULT 12,
      schedule TEXT NOT NULL DEFAULT '',
      agreements TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      created_by INTEGER NOT NULL REFERENCES profiles(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS circle_members (
      circle_id INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT NOT NULL,
      PRIMARY KEY (circle_id, profile_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS circle_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      circle_id INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      message TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'proposed',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blocker_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      blocked_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      UNIQUE (blocker_id, blocked_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      reported_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (profile_id, kind, ref_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS passes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      passed_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      UNIQUE (profile_id, passed_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      introduction_id INTEGER NOT NULL REFERENCES introductions(id) ON DELETE CASCADE,
      sender_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS connection_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      introduction_id INTEGER NOT NULL REFERENCES introductions(id) ON DELETE CASCADE,
      format TEXT NOT NULL DEFAULT '',
      time_text TEXT NOT NULL DEFAULT '',
      expectations TEXT NOT NULL DEFAULT '',
      created_by INTEGER NOT NULL REFERENCES profiles(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_intros_pair ON introductions(requester_id, proposed_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_intro ON messages(introduction_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks(blocker_id)');
}

const userVersion = db.prepare('PRAGMA user_version').get().user_version;
if (userVersion < 1) {  migrateToV1();
  // Backfill: map legacy consents into the richer consent_settings shape.
  const rows = db.prepare('SELECT id, consents FROM profiles').all();
  const upd = db.prepare('UPDATE profiles SET consent_settings = ? WHERE id = ?');
  for (const r of rows) {
    let legacy = {};
    try { legacy = JSON.parse(r.consents || '{}'); } catch { /* keep defaults */ }
    upd.run(JSON.stringify(defaultConsentSettings(legacy)), r.id);
  }
  db.exec('PRAGMA user_version = 1');
}

// v2: guide sessions for the rule-based connection guide flow + profile values.
function migrateToV2() {
  addColumnIfMissing('profiles', 'values_json', 'TEXT NOT NULL DEFAULT \'[]\'');
  db.exec(`
    CREATE TABLE IF NOT EXISTS guide_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL,
      request_text TEXT NOT NULL,
      parsed_json TEXT NOT NULL DEFAULT '{}',
      answers_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_guide_sessions_profile ON guide_sessions(profile_id)');
}
if (userVersion < 2) {
  migrateToV2();
  db.exec('PRAGMA user_version = 2');
}

// v3: connection briefs + introduction shared-text snapshots.
function migrateToV3() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS briefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      who_text TEXT NOT NULL DEFAULT '',
      intention_text TEXT NOT NULL DEFAULT '',
      good_fit_text TEXT NOT NULL DEFAULT '',
      offer_text TEXT NOT NULL DEFAULT '',
      logistics_text TEXT NOT NULL DEFAULT '',
      boundaries_text TEXT NOT NULL DEFAULT '',
      private_notes TEXT NOT NULL DEFAULT '',
      shared_text TEXT NOT NULL DEFAULT '',
      consent_save INTEGER NOT NULL DEFAULT 0,
      consent_share INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused','withdrawn')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  addColumnIfMissing('introductions', 'requester_shared_text', 'TEXT NOT NULL DEFAULT \'\'');

  // Sentinel "SEREN · connector" profile (id 0) so system messages can be
  // stored with sender_id 0 without tripping the FK on messages.sender_id.
  // It is excluded from public/candidate listings below.
  const hasSentinel = db.prepare('SELECT 1 FROM profiles WHERE id = 0').get();
  if (!hasSentinel) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO profiles
        (id, name, email, interests, intention, connection_prefs, consents, is_seed, created_at, updated_at)
      VALUES (0, 'SEREN · connector', 'system@seren.local', '[]', '', '{}', '{}', 0, ?, ?)
    `).run(now, now);
  }
}
if (userVersion < 3) {
  migrateToV3();
  db.exec('PRAGMA user_version = 3');
}

// v4: chat sessions for the conversational guide UI. Each row owns a
// transcript (JSON array of {role, kind, ...} entries) and tracks where the
// conversation is in the guide -> brief -> proposals flow via `stage`.
function migrateToV4() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL,
      guide_session_id INTEGER,
      brief_id INTEGER,
      stage TEXT NOT NULL DEFAULT 'start',
      pending_question_id TEXT,
      pending_field TEXT,
      transcript_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_chat_sessions_profile ON chat_sessions(profile_id)');
}
if (userVersion < 4) {
  migrateToV4();
  db.exec('PRAGMA user_version = 4');
}

// v5: optional website/social links on profiles + a hidden flag for QA/test
// records. The one-time cleanup hides existing QA/test records from every
// user-facing surface. 'qa'/'test' match as standalone words in names, and
// 'qa@' as a test-email convention — avoiding false positives like 'Qasim'
// or 'latest@example.com'. Hidden names are logged for audit.
function migrateToV5() {
  addColumnIfMissing('profiles', 'is_hidden', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('profiles', 'links_json', 'TEXT NOT NULL DEFAULT \'{}\'');
  const hidden = db.prepare(`
    UPDATE profiles
    SET is_hidden = 1
    WHERE id > 0 AND is_hidden = 0 AND (
      ((' ' || lower(name) || ' ') LIKE '% qa %')
      OR ((' ' || lower(name) || ' ') LIKE '% test %')
      OR lower(email) LIKE '%qa@%'
      OR lower(intention) LIKE '%qa test%'
    )
  `).run();
  if (hidden.changes > 0) {
    const names = db.prepare(`
      SELECT name FROM profiles WHERE is_hidden = 1 AND id > 0
    `).all().map((r) => r.name);
    console.log(`[migrate] v5: hid ${hidden.changes} QA/test profile(s): ${names.join(', ')}`);
  }
}
if (userVersion < 5) {
  migrateToV5();
  db.exec('PRAGMA user_version = 5');
}

// v6: profile-less (onboarding) chat sessions. The conversational onboarding
// collects profile fields before any profile exists, so chat_sessions.
// profile_id becomes nullable and a new onboarding_json column carries the
// in-progress answers ({name, email, interests, intention, seeking, values}).
// SQLite cannot alter column nullability in place, so the table is rebuilt.
function migrateToV6() {
  db.exec(`
    CREATE TABLE chat_sessions_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER,
      guide_session_id INTEGER,
      brief_id INTEGER,
      stage TEXT NOT NULL DEFAULT 'start',
      pending_question_id TEXT,
      pending_field TEXT,
      transcript_json TEXT NOT NULL DEFAULT '[]',
      onboarding_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec(`
    INSERT INTO chat_sessions_new
      (id, profile_id, guide_session_id, brief_id, stage, pending_question_id,
       pending_field, transcript_json, onboarding_json, created_at, updated_at)
    SELECT id, profile_id, guide_session_id, brief_id, stage, pending_question_id,
       pending_field, transcript_json, '{}', created_at, updated_at
    FROM chat_sessions
  `);
  db.exec('DROP TABLE chat_sessions');
  db.exec('ALTER TABLE chat_sessions_new RENAME TO chat_sessions');
  db.exec('CREATE INDEX IF NOT EXISTS idx_chat_sessions_profile ON chat_sessions(profile_id)');
}
if (userVersion < 6) {
  migrateToV6();
  db.exec('PRAGMA user_version = 6');
}

// v7: structured offers / needs / skills on profiles.
// The relationship-network thesis matches on what someone offers, needs,
// and can do — not just shared interests. Availability stays free-text in
// prefs.availability (scheduling is conversational, not a calendar).
function migrateToV7() {
  addColumnIfMissing('profiles', 'offers_json', 'TEXT NOT NULL DEFAULT \'[]\'');
  addColumnIfMissing('profiles', 'needs_json', 'TEXT NOT NULL DEFAULT \'[]\'');
  addColumnIfMissing('profiles', 'skills_json', 'TEXT NOT NULL DEFAULT \'[]\'');
}
if (userVersion < 7) {
  migrateToV7();
  db.exec('PRAGMA user_version = 7');
}

// v8: agent registry — the relationship-network thesis covers humans,
// communities, AND intelligent agents. Agents are first-class participants:
// registered by a human operator who makes an unverified declaration about
// it via trustNote, with
// declared capabilities so members can discover them by need. This is the
// foundation; agent-to-agent flows and introduction requests to agents
// are follow-ups (see PRODUCT_AUDIT.md).
function migrateToV8() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'ai',
      operator_profile_id INTEGER REFERENCES profiles(id),
      description TEXT NOT NULL DEFAULT '',
      capabilities_json TEXT NOT NULL DEFAULT '[]',
      endpoint_url TEXT NOT NULL DEFAULT '',
      trust_note TEXT NOT NULL DEFAULT '',
      verified INTEGER NOT NULL DEFAULT 0,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_agents_operator ON agents(operator_profile_id)');
}
if (userVersion < 8) {
  migrateToV8();
  db.exec('PRAGMA user_version = 8');
}

// v9: per-profile session tokens (server-issued auth). The plaintext token
// lives only in the member's HttpOnly cookie; the DB stores its SHA-256 hash.
function migrateToV9() {
  addColumnIfMissing('profiles', 'token_hash', 'TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_profiles_token_hash ON profiles(token_hash)');
  // Backfill: existing rows get an unusable random hash (no NULLs, so no
  // NULL-bypass). Owners regain access via /api/auth/relink, which rotates
  // the token and returns it over the fresh session cookie.
  const rows = db.prepare('SELECT id FROM profiles WHERE token_hash IS NULL').all();
  const upd = db.prepare('UPDATE profiles SET token_hash = ? WHERE id = ?');
  for (const r of rows) {
    upd.run(createHash('sha256').update(randomBytes(32)).digest('hex'), r.id);
  }
}
if (userVersion < 9) {
  migrateToV9();
  db.exec('PRAGMA user_version = 9');
}

// v10: durable decline blocks. A decline (either kind) records that the
// decliner does not want further direct requests from that requester, so
// "Decline & hide future requests" is actually honored server-side. The
// decliner can lift it later; lifting is their choice alone.
function migrateToV10() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS decline_blocks (
      decliner_id INTEGER NOT NULL,
      requester_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (decliner_id, requester_id)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_decline_blocks_decliner ON decline_blocks(decliner_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_decline_blocks_requester ON decline_blocks(requester_id)');
}
if (userVersion < 10) {
  migrateToV10();
  db.exec('PRAGMA user_version = 10');
}

// v11: profile deletion keeps introduction rows (marked withdrawn/ended)
// while removing the member's profile row. The participant FKs become
// nullable with ON DELETE SET NULL so the surviving participant still sees
// the connection record instead of losing it. New introductions still always
// carry both participants (enforced by request validation, not the schema).
// SQLite cannot alter FK nullability in place, so the table is rebuilt.
function migrateToV11() {
  db.exec(`
    CREATE TABLE introductions_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
      proposed_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
      intention TEXT NOT NULL,
      note TEXT NOT NULL,
      score REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      connection_type TEXT NOT NULL DEFAULT '',
      request_message TEXT NOT NULL DEFAULT '',
      format TEXT NOT NULL DEFAULT '',
      commitment TEXT NOT NULL DEFAULT '',
      tone TEXT NOT NULL DEFAULT '',
      responder_note TEXT NOT NULL DEFAULT '',
      response_kind TEXT NOT NULL DEFAULT '',
      requester_shared_text TEXT NOT NULL DEFAULT ''
    )
  `);
  db.exec(`
    INSERT INTO introductions_new
      (id, requester_id, proposed_id, intention, note, score, status,
       created_at, updated_at, connection_type, request_message, format,
       commitment, tone, responder_note, response_kind, requester_shared_text)
    SELECT id, requester_id, proposed_id, intention, note, score, status,
       created_at, updated_at, connection_type, request_message, format,
       commitment, tone, responder_note, response_kind, requester_shared_text
    FROM introductions
  `);
  db.exec('DROP TABLE introductions');
  db.exec('ALTER TABLE introductions_new RENAME TO introductions');
  db.exec('CREATE INDEX IF NOT EXISTS idx_intros_pair ON introductions(requester_id, proposed_id)');
}
if (userVersion < 11) {
  migrateToV11();
  db.exec('PRAGMA user_version = 11');
}

// v12: host assist requests (Human Mode). A member may ask a real SEREN host
// to thoughtfully suggest someone for them — the introduction itself still
// flows through the normal staged mutual-consent machinery. One open request
// per member at a time: enforced with a partial UNIQUE index on (profile_id)
// WHERE status = 'open'. The index (not just handler code) is the enforcer,
// so concurrent creates cannot double-open; the handler also checks first and
// maps the UNIQUE violation to a friendly 409.
function migrateToV12() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS host_assists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      request_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'proposed', 'withdrawn')),
      created_at TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_host_assists_open
    ON host_assists(profile_id) WHERE status = 'open'
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_host_assists_profile ON host_assists(profile_id)');
}
if (userVersion < 12) {
  migrateToV12();
  db.exec('PRAGMA user_version = 12');
}

// v13: synchronicity beacons (Synchronicity Mode, layer 2). A beacon is a
// short, time-bound signal a member chooses to be matched on: self-input
// (they name their own recurring synchronicity) or a draw from the curated
// deck (card_id set). One active beacon per member at a time, enforced by a
// partial UNIQUE index — the same pattern as host_assists (v12), so the
// index (not just handler code) enforces the anti-spray rule under races.
// 7-day default expiry. Beacons are private: never on profiles, never
// searchable, revealed only to a matched counterpart at proposal stage.
// beacon_matches records exact-normalized-text matches; each match creates
// an introduction through the normal staged-consent flow (introduction_id).
// FK cascades: deleting a profile removes its beacons and their matches,
// honoring the "raw beacon text does not survive the member" rule.
function migrateToV13() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS beacons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      source TEXT NOT NULL CHECK(source IN ('self_input', 'deck_draw')),
      raw_text TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      card_id TEXT,
      intention_type TEXT CHECK(intention_type IN ('conversation', 'practice_partner', 'collaborator', 'local_connection', 'open')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'matched', 'expired', 'withdrawn')),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS beacon_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      beacon_a_id INTEGER NOT NULL REFERENCES beacons(id) ON DELETE CASCADE,
      beacon_b_id INTEGER NOT NULL REFERENCES beacons(id) ON DELETE CASCADE,
      match_type TEXT NOT NULL DEFAULT 'exact' CHECK(match_type IN ('exact', 'resonance')),
      status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed', 'accepted', 'declined', 'expired')),
      proposed_at TEXT NOT NULL,
      introduction_id INTEGER REFERENCES introductions(id) ON DELETE SET NULL
    )
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_beacons_active
    ON beacons(profile_id) WHERE status = 'active'
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_beacons_normalized ON beacons(normalized_text)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_beacons_profile ON beacons(profile_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_beacon_matches_intro ON beacon_matches(introduction_id)');
}
if (userVersion < 13) {
  migrateToV13();
  db.exec('PRAGMA user_version = 13');
}

// v14: agent vetting checklist + host review tier. The registry previously
// carried only a free-text operator declaration ("unverified"). Operators now
// attest to five concrete benevolence criteria at registration (stored as
// JSON); a host can additionally mark a listing reviewed. Existing agents
// keep empty vetting and display as "Unverified". The legacy `verified`
// column is left untouched (deprecated, never displayed as "Verified").
function migrateToV14() {
  addColumnIfMissing('agents', 'vetting_json', `TEXT NOT NULL DEFAULT '{}'`);
  addColumnIfMissing('agents', 'reviewed', 'INTEGER NOT NULL DEFAULT 0');
}
if (userVersion < 14) {
  migrateToV14();
  db.exec('PRAGMA user_version = 14');
}

// v15: re-run the v5 QA/test hide sweep for profiles created after v5 ran.
// v5 was one-time, so test records created later (e.g. "QA Tester") stayed
// visible in matching. Same patterns, same audit logging. Matching is real
// people only; demo seed members are excluded separately in
// listCandidateProfiles().
function migrateToV15() {
  const hidden = db.prepare(`
    UPDATE profiles
    SET is_hidden = 1
    WHERE id > 0 AND is_hidden = 0 AND (
      ((' ' || lower(name) || ' ') LIKE '% qa %')
      OR ((' ' || lower(name) || ' ') LIKE '% test %')
      OR lower(email) LIKE '%qa@%'
      OR lower(intention) LIKE '%qa test%'
    )
  `).run();
  if (hidden.changes > 0) {
    const names = db.prepare(`
      SELECT name FROM profiles WHERE is_hidden = 1 AND id > 0
    `).all().map((r) => r.name);
    console.log(`[migrate] v15: hid ${hidden.changes} QA/test profile(s): ${names.join(', ')}`);
  }
}
if (userVersion < 15) {
  migrateToV15();
  db.exec('PRAGMA user_version = 15');
}

// v16: "Flourishing by Design" — outcome tracking, not engagement.
// flourishing_checkins: one row per answered question per check-in (all rows
// in a submission share one created_at). question_key values are fixed in
// server.js (FLOURISHING_QUESTIONS); answers are normalized text.
// introduction_feedback: one feedback row per participant per introduction
// (unique index is the race-proof enforcer for the one-feedback rule).
// introductions gains real-life intention fields: a member-declared offline
// action plus a completion flag (never a claim about outcomes, just intent).
// reports gains updated_at so host safety analytics can measure resolution
// latency (created -> status change); backfilled to created_at on upgrade.
function migrateToV16() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS flourishing_checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      question_key TEXT NOT NULL,
      answer_text TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_flourishing_checkins_profile ON flourishing_checkins(profile_id)');
  db.exec(`
    CREATE TABLE IF NOT EXISTS introduction_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      introduction_id INTEGER NOT NULL REFERENCES introductions(id) ON DELETE CASCADE,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      felt_safe INTEGER NOT NULL CHECK(felt_safe IN (0, 1)),
      quality INTEGER CHECK(quality IS NULL OR (quality >= 1 AND quality <= 5)),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_introduction_feedback_intro_profile
    ON introduction_feedback(introduction_id, profile_id)
  `);
  addColumnIfMissing('introductions', 'real_life_intention', `TEXT NOT NULL DEFAULT ''`);
  addColumnIfMissing('introductions', 'intention_completed', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('reports', 'updated_at', `TEXT NOT NULL DEFAULT ''`);
  db.prepare(`UPDATE reports SET updated_at = created_at WHERE updated_at = ''`).run();
}
if (userVersion < 16) {
  migrateToV16();
  db.exec('PRAGMA user_version = 16');
}

// v17: "Digital Sapiens" layer — attention integrity, grounded in Jack
// Probert's Digital Sapiens Experiment 2 (20 Harvard students, 3 days
// without instant messaging, Sep 2026). introductions gains a
// moved_to_real_life flag: a member-declared "we took this beyond the
// app" state, after which SEREN stops nudging about that connection.
// attention_opens records coarse app-open origins so host analytics can
// distinguish intentional opens from notification-driven ones (SEREN
// sends no engagement notifications by design, so 'intentional' is the
// honest default; the column exists so any future entry point is
// measured separately rather than silently blended in).
function migrateToV17() {
  addColumnIfMissing('introductions', 'moved_to_real_life', 'INTEGER NOT NULL DEFAULT 0');
  db.exec(`
    CREATE TABLE IF NOT EXISTS attention_opens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      origin TEXT NOT NULL DEFAULT 'unknown',
      created_at TEXT NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_attention_opens_profile ON attention_opens(profile_id)');
}
if (userVersion < 17) {
  migrateToV17();
  db.exec('PRAGMA user_version = 17');
}

// v18: remove demo seed profiles. The October QA pass confirmed the only
// people who should exist in the database are real members, so every
// profile with is_seed = 1 is deleted with the same related-row cleanup as
// deleteProfile (introductions closed out, circles, agents, connection
// plans, decline blocks, guide/chat sessions, blocks, reports, saved items,
// passes, messages, briefs, plus the ON DELETE CASCADE tables). Hidden
// QA/test records (is_hidden = 1, e.g. "QA Tester") are NOT touched — that
// removal decision is still pending.
function migrateToV18() {
  const seeds = db.prepare('SELECT id, name FROM profiles WHERE is_seed = 1 AND id > 0').all();
  if (!seeds.length) return;
  const removed = [];
  for (const s of seeds) {
    if (deleteProfile(s.id)) removed.push(s.name);
  }
  if (removed.length) {
    console.log(`[migrate] v18: removed ${removed.length} demo seed profile(s): ${removed.join(', ')}`);
  }
}
if (userVersion < 18) {
  migrateToV18();
  db.exec('PRAGMA user_version = 18');
}

// v19: Layer 3 (Benevolent AI -> Benevolent AI), governed by
// docs/SEREN_AI_CONSTITUTION.md §7. An agent connection is a bounded
// protocol handshake between two registered agents — never an open-ended
// agent chat. The pair key makes each pair durable: a decline or a safety
// block cannot be bypassed by deleting and recreating the proposal. A
// human introduction is created only after both accountable operators
// accept, and it still passes through SEREN's ordinary mutual-consent
// introduction flow before any contact details are visible.
function migrateToV19() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pair_key TEXT NOT NULL UNIQUE,
      source_agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      target_agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      proposed_by_profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      mode TEXT NOT NULL DEFAULT 'data'
        CHECK(mode IN ('data', 'synchronicity', 'human')),
      rationale TEXT NOT NULL DEFAULT '',
      data_basis TEXT NOT NULL DEFAULT '',
      synchronicity_signal TEXT NOT NULL DEFAULT '',
      synchronicity_source TEXT NOT NULL DEFAULT ''
        CHECK(synchronicity_source IN ('', 'member_supplied', 'seren_generated')),
      status TEXT NOT NULL DEFAULT 'proposed'
        CHECK(status IN ('proposed', 'accepted', 'declined', 'withdrawn', 'blocked')),
      host_profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
      host_approved INTEGER NOT NULL DEFAULT 0,
      host_reviewed_at TEXT NOT NULL DEFAULT '',
      responder_note TEXT NOT NULL DEFAULT '',
      introduction_id INTEGER REFERENCES introductions(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_agent_connections_source ON agent_connections(source_agent_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_agent_connections_target ON agent_connections(target_agent_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_agent_connections_status_mode ON agent_connections(status, mode)');
}
if (userVersion < 19) {
  migrateToV19();
  db.exec('PRAGMA user_version = 19');
}

// ---------- defaults ----------

export function defaultPrefs() {
  return {
    localRemote: 'either', // 'local' | 'remote' | 'either'
    formats: ['message'],
    availability: '',
    languages: ['English'],
    seeking: [],
  };
}

export function defaultConsentSettings(legacy = {}) {
  return {
    messagesAfterMutual: true,
    intentionalRequests: true,
    groupInvites: true,
    eventInvites: true,
    collaborationRequests: true,
    showPractices: true,
    showRegion: true,
    showPhoto: false,
    discoveryEnabled: legacy.community_visible !== false,
    paused: false,
    notifications: true,
    // v7: controlled serendipity — one labeled wild card in Discover.
    // Default on; the member can turn it off in settings.
    serendipity: true,
    // Review follow-up: needs are the most sensitive matching surface. When
    // off, the member's needs are not used for matching in either direction
    // (human or agent matching).
    needsMatching: true,
    // v16: "Flourishing by Design" — suggestion cadence consent. Default
    // weekly: the member is not notified more often than once a week unless
    // they opt into daily; paused stops suggestions entirely.
    recFrequency: 'weekly',
  };
}

function parseJson(text, fallback) {
  try {
    const v = JSON.parse(text);
    return v === null || v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

// ---------- row <-> wire conversions ----------

function toProfile(row) {
  if (!row) return null;
  const prefs = { ...defaultPrefs(), ...parseJson(row.prefs, {}) };
  const consentSettings = { ...defaultConsentSettings(), ...parseJson(row.consent_settings, {}) };
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    interests: parseJson(row.interests, []),
    intention: row.intention,
    connectionPrefs: parseJson(row.connection_prefs, {}),
    consents: parseJson(row.consents, {}),
    // v1 extensions
    pronouns: row.pronouns || '',
    region: row.region || '',
    photoUrl: row.photo_url || '',
    about: row.about || '',
    visualIdentity: row.visual_identity || 'minimal',
    intentions: parseJson(row.intentions, []),
    intentionsOther: parseJson(row.intentions_other ?? '""', ''),
    practices: parseJson(row.practices, []),
    practicesOther: row.practices_other || '',
    values: parseJson(row.values_json, []),
    links: parseJson(row.links_json, {}),
    // v7: structured offers / needs / skills.
    offers: parseJson(row.offers_json, []),
    needs: parseJson(row.needs_json, []),
    skills: parseJson(row.skills_json, []),
    prefs,
    consentSettings,
    isSeed: row.is_seed === 1,
    isHidden: row.is_hidden === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toIntroduction(row) {
  if (!row) return null;
  return {
    id: row.id,
    requesterId: row.requester_id,
    proposedId: row.proposed_id,
    intention: row.intention,
    note: row.note,
    score: row.score,
    status: row.status,
    connectionType: row.connection_type || '',
    requestMessage: row.request_message || '',
    format: row.format || '',
    commitment: row.commitment || '',
    tone: row.tone || '',
    responderNote: row.responder_note || '',
    responseKind: row.response_kind || '',
    requesterSharedText: row.requester_shared_text || '',
    // v16: real-life intention — a member-declared offline action (intent,
    // never an outcome claim) plus whether they marked it done.
    realLifeIntention: row.real_life_intention || '',
    intentionCompleted: row.intention_completed === 1,
    // v17 (Digital Sapiens): member-declared "moved to real life" — the
    // app steps back and stops nudging about this connection.
    movedToRealLife: row.moved_to_real_life === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Connection-brief wire object (snake_case per the brief API contract). */
function toBrief(row) {
  if (!row) return null;
  return {
    id: row.id,
    profile_id: row.profile_id,
    who_text: row.who_text || '',
    intention_text: row.intention_text || '',
    good_fit_text: row.good_fit_text || '',
    offer_text: row.offer_text || '',
    logistics_text: row.logistics_text || '',
    boundaries_text: row.boundaries_text || '',
    private_notes: row.private_notes || '',
    shared_text: row.shared_text || '',
    consent_save: row.consent_save === 1,
    consent_share: row.consent_share === 1,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toCircle(row, memberCount = 0, isMember = false, hostName = '') {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    purpose: row.purpose,
    privacy: row.privacy,
    maxParticipants: row.max_participants,
    schedule: row.schedule || '',
    agreements: row.agreements || '',
    region: row.region || '',
    createdBy: row.created_by,
    hostName,
    memberCount,
    isMember,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------- profile helpers ----------

const getProfileStmt = db.prepare('SELECT * FROM profiles WHERE id = ?');
export function getProfile(id) {
  return toProfile(getProfileStmt.get(id));
}

const getProfileByEmailStmt = db.prepare('SELECT * FROM profiles WHERE email = ?');
export function getProfileByEmail(email) {
  return toProfile(getProfileByEmailStmt.get(String(email).toLowerCase()));
}

// ---------- profile session tokens ----------
// Server-issued bearer tokens. The plaintext token is handed to the member
// once (HttpOnly cookie on issuance); only its SHA-256 hash is stored.

export function hashProfileToken(token) {
  return createHash('sha256').update(String(token), 'utf8').digest('hex');
}

/**
 * Issue (or rotate) a profile's session token. Stores only the hash;
 * returns the plaintext token for the Set-Cookie response.
 */
export function issueProfileToken(profileId) {
  const token = randomBytes(32).toString('hex');
  db.prepare('UPDATE profiles SET token_hash = ? WHERE id = ?')
    .run(hashProfileToken(token), profileId);
  return token;
}

const getProfileByTokenHashStmt = db.prepare('SELECT * FROM profiles WHERE token_hash = ?');
export function getProfileByTokenHash(hash) {
  if (!hash || typeof hash !== 'string' || hash.length === 0) return null;
  return toProfile(getProfileByTokenHashStmt.get(hash));
}

/**
 * Normalize a free-text string list (offers / needs / skills):
 * trim, drop empties and overlong items, dedupe case-insensitively, cap count.
 * Validation runs first; this is the write-time canonical form.
 */
export function normalizeStringList(value, max = 10, itemMax = 80) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const v of value) {
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (!t || t.length > itemMax) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Normalize the optional profile links object: keep only supported keys,
 * trim, drop empties, prefix a scheme when missing, and serialize valid
 * http(s) URLs. Anything invalid is dropped (validation runs first).
 */
function normalizeLinks(links) {
  const allowed = ['website', 'instagram', 'x', 'linkedin'];
  const out = {};
  if (!links || typeof links !== 'object' || Array.isArray(links)) return out;
  for (const key of allowed) {
    const raw = typeof links[key] === 'string' ? links[key].trim() : '';
    if (!raw || raw.length > 200) continue;
    const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`;
    try {
      const url = new URL(candidate);
      if (url.protocol === 'http:' || url.protocol === 'https:') out[key] = url.toString();
    } catch { /* drop invalid */ }
  }
  return out;
}

export function listPublicProfiles() {
  const rows = db.prepare('SELECT * FROM profiles WHERE id > 0 AND is_hidden = 0 ORDER BY id ASC').all();
  return rows.map((r) => {
    const p = toProfile(r);
    return {
      id: p.id,
      name: p.name,
      interests: p.interests,
      intention: p.intention,
      isSeed: p.isSeed,
    };
  });
}

/** Full profiles, for matching candidates (includes consents + intention).
 *  Hidden QA/test records excluded. Demo seed members (is_seed = 1) are also
 *  excluded: matching is real people only — seeds are never suggested,
 *  proposed, or discovered as candidates. */
export function listCandidateProfiles() {
  const rows = db.prepare('SELECT * FROM profiles WHERE id > 0 AND is_hidden = 0 AND is_seed = 0 ORDER BY id ASC').all();
  return rows.map(toProfile);
}

export function createProfile({
  name, email, interests, intention, connectionPrefs, consents, isSeed = false,
  pronouns = '', region = '', photoUrl = '', about = '', visualIdentity = 'minimal',
  intentions = [], intentionsOther = '', practices = [], practicesOther = '', values = [],
  prefs = {}, consentSettings = {}, links = {}, offers = [], needs = [], skills = [],
}) {
  const now = new Date().toISOString();
  const mergedPrefs = { ...defaultPrefs(), ...prefs };
  if (connectionPrefs && typeof connectionPrefs.availability === 'string' && !mergedPrefs.availability) {
    mergedPrefs.availability = connectionPrefs.availability;
  }
  if (connectionPrefs && Array.isArray(connectionPrefs.seeking)) {
    mergedPrefs.seeking = connectionPrefs.seeking;
  }
  // Practices default to the legacy interests list so old seeds keep working.
  const mergedPractices = Array.isArray(practices) && practices.length ? practices : (interests || []);
  const stmt = db.prepare(`
    INSERT INTO profiles
      (name, email, interests, intention, connection_prefs, consents, is_seed,
       pronouns, region, photo_url, about, visual_identity, intentions, intentions_other,
       practices, practices_other, prefs, consent_settings, links_json, values_json,
       offers_json, needs_json, skills_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    name.trim(),
    String(email).trim().toLowerCase(),
    JSON.stringify(interests),
    intention.trim(),
    // v16 (Flourishing): persist the whole connectionPrefs object — seeking
    // and availability keep their defaults, and the onboarding keys
    // (intentions, connectionLevels, topicsOut, privacyLevel,
    // locationRadius, onlineMode, commBoundaries, syncMode) ride along
    // instead of being dropped.
    JSON.stringify({ seeking: [], availability: '', ...(connectionPrefs || {}) }),
    JSON.stringify(consents),
    isSeed ? 1 : 0,
    String(pronouns || '').trim(),
    String(region || '').trim(),
    String(photoUrl || '').trim(),
    String(about || '').trim(),
    String(visualIdentity || 'minimal').trim() || 'minimal',
    JSON.stringify(intentions || []),
    String(intentionsOther || '').trim(),
    JSON.stringify(mergedPractices),
    String(practicesOther || '').trim(),
    JSON.stringify(mergedPrefs),
    JSON.stringify({ ...defaultConsentSettings(consents), ...consentSettings }),
    JSON.stringify(normalizeLinks(links)),
    JSON.stringify(Array.isArray(values) ? values : []),
    JSON.stringify(normalizeStringList(offers)),
    JSON.stringify(normalizeStringList(needs)),
    JSON.stringify(normalizeStringList(skills)),
    now,
    now,
  );
  return getProfile(Number(result.lastInsertRowid));
}

export function updateProfile(id, fields) {
  const existing = getProfile(id);
  if (!existing) return null;

  const sets = [];
  const params = [];
  const str = (v) => String(v).trim();

  if (fields.name !== undefined) { sets.push('name = ?'); params.push(str(fields.name)); }
  if (fields.email !== undefined) { sets.push('email = ?'); params.push(str(fields.email).toLowerCase()); }
  if (fields.interests !== undefined) { sets.push('interests = ?'); params.push(JSON.stringify(fields.interests)); }
  if (fields.intention !== undefined) { sets.push('intention = ?'); params.push(str(fields.intention)); }
  if (fields.connectionPrefs !== undefined) {
    const prev = existing.connectionPrefs || {};
    // v16 (Flourishing): merge rather than picking two keys, so PATCHing
    // one connection preference never drops the others (e.g. onboarding
    // keys like privacyLevel or connectionLevels).
    const next = { seeking: [], availability: '', ...prev, ...fields.connectionPrefs };
    sets.push('connection_prefs = ?'); params.push(JSON.stringify(next));
    // Mirror availability into prefs for the new model.
    const prefsNext = { ...existing.prefs, availability: next.availability, seeking: next.seeking };
    sets.push('prefs = ?'); params.push(JSON.stringify(prefsNext));
  }
  if (fields.consents !== undefined) {
    sets.push('consents = ?'); params.push(JSON.stringify(fields.consents));
    const csNext = { ...existing.consentSettings, ...consentSettingsFromLegacy(fields.consents, existing.consentSettings) };
    sets.push('consent_settings = ?'); params.push(JSON.stringify(csNext));
  }
  if (fields.pronouns !== undefined) { sets.push('pronouns = ?'); params.push(str(fields.pronouns)); }
  if (fields.region !== undefined) { sets.push('region = ?'); params.push(str(fields.region)); }
  if (fields.photoUrl !== undefined) { sets.push('photo_url = ?'); params.push(str(fields.photoUrl)); }
  if (fields.about !== undefined) { sets.push('about = ?'); params.push(str(fields.about)); }
  if (fields.visualIdentity !== undefined) { sets.push('visual_identity = ?'); params.push(str(fields.visualIdentity) || 'minimal'); }
  if (fields.intentions !== undefined) { sets.push('intentions = ?'); params.push(JSON.stringify(fields.intentions)); }
  if (fields.intentionsOther !== undefined) { sets.push('intentions_other = ?'); params.push(str(fields.intentionsOther)); }
  if (fields.practices !== undefined) { sets.push('practices = ?'); params.push(JSON.stringify(fields.practices)); }
  if (fields.practicesOther !== undefined) { sets.push('practices_other = ?'); params.push(str(fields.practicesOther)); }
  if (fields.values !== undefined) { sets.push('values_json = ?'); params.push(JSON.stringify(fields.values)); }
  if (fields.links !== undefined) { sets.push('links_json = ?'); params.push(JSON.stringify(normalizeLinks(fields.links))); }
  // v7: structured offers / needs / skills (normalized at write time).
  if (fields.offers !== undefined) { sets.push('offers_json = ?'); params.push(JSON.stringify(normalizeStringList(fields.offers))); }
  if (fields.needs !== undefined) { sets.push('needs_json = ?'); params.push(JSON.stringify(normalizeStringList(fields.needs))); }
  if (fields.skills !== undefined) { sets.push('skills_json = ?'); params.push(JSON.stringify(normalizeStringList(fields.skills))); }
  if (fields.prefs !== undefined) {
    sets.push('prefs = ?'); params.push(JSON.stringify({ ...existing.prefs, ...fields.prefs }));
  }
  if (fields.consentSettings !== undefined) {
    sets.push('consent_settings = ?'); params.push(JSON.stringify({ ...existing.consentSettings, ...fields.consentSettings }));
  }
  sets.push('updated_at = ?');
  params.push(new Date().toISOString());

  db.prepare(`UPDATE profiles SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  return getProfile(id);
}

/**
 * Permanently delete a member's profile and all of their data, in a single
 * transaction. Called only with the token-authenticated caller's own id.
 *
 * What happens to each table:
 * - profiles: the row is removed. The session token hash lives on the row,
 *   so the member's session ends the moment this lands.
 * - introductions: never orphaned or deleted. Open ones ('proposed',
 *   'question') become 'withdrawn'; active ones ('accepted',
 *   'accepted_with_boundary') become 'ended' — the existing status
 *   conventions, so the other participant still sees the connection record.
 *   Terminal statuses ('declined', 'declined_hidden', 'withdrawn', 'ended')
 *   are left alone. (v11: the participant FKs are ON DELETE SET NULL, so
 *   the row survives with the survivor's side still queryable.)
 * - circles: circles created by the member are deleted entirely (the
 *   creator is who approves join requests, so a headless circle would
 *   silently break). Memberships in other circles are removed.
 * - agents: agent registrations where they are the operator are deleted.
 *   (An agent is the operator's declaration about their own agent; it goes
 *   with them.)
 * - Reports/blocks/saved items/passes/messages/briefs/circle members and
 *   requests: removed. Reports rely on their ON DELETE CASCADE FKs; the
 *   rest are deleted explicitly for readability.
 * - decline_blocks, guide_sessions, chat_sessions (no FK to profiles):
 *   deleted explicitly. Profile-less onboarding chat sessions
 *   (profile_id NULL) are untouched.
 * - beacons and beacon_matches: removed by their ON DELETE CASCADE FKs,
 *   so no private beacon text survives the member (per the spec's data
 *   retention rule).
 * Returns true when a profile row was actually removed.
 */
export function deleteProfile(id) {
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    // Close out introductions without orphaning them.
    db.prepare(`
      UPDATE introductions
      SET status = 'withdrawn', updated_at = ?
      WHERE (requester_id = ? OR proposed_id = ?)
        AND status IN ('proposed', 'question')
    `).run(now, id, id);
    db.prepare(`
      UPDATE introductions
      SET status = 'ended', updated_at = ?
      WHERE (requester_id = ? OR proposed_id = ?)
        AND status IN ('accepted', 'accepted_with_boundary')
    `).run(now, id, id);

    // Circles created by this member are removed with them (created_by is
    // NOT NULL with no cascade; remaining members' rows cascade with the
    // circle). Their memberships in other circles go too.
    db.prepare('DELETE FROM circles WHERE created_by = ?').run(id);
    db.prepare('DELETE FROM circle_members WHERE profile_id = ?').run(id);
    db.prepare('DELETE FROM circle_requests WHERE profile_id = ?').run(id);

    // Agent registrations operated by this member.
    db.prepare('DELETE FROM agents WHERE operator_profile_id = ?').run(id);

    // Connection plans they authored.
    db.prepare('DELETE FROM connection_plans WHERE created_by = ?').run(id);

    // Tables with no FK reference to profiles.
    db.prepare('DELETE FROM decline_blocks WHERE decliner_id = ? OR requester_id = ?').run(id, id);
    db.prepare('DELETE FROM guide_sessions WHERE profile_id = ?').run(id);
    db.prepare('DELETE FROM chat_sessions WHERE profile_id = ?').run(id);

    // Tables with ON DELETE CASCADE FKs to profiles — explicit for clarity
    // (the cascade is verified in tests/profile-deletion.test.js).
    db.prepare('DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?').run(id, id);
    db.prepare('DELETE FROM reports WHERE reporter_id = ? OR reported_id = ?').run(id, id);
    db.prepare('DELETE FROM saved_items WHERE profile_id = ?').run(id);
    db.prepare('DELETE FROM passes WHERE profile_id = ? OR passed_id = ?').run(id, id);
    db.prepare('DELETE FROM messages WHERE sender_id = ?').run(id);
    db.prepare('DELETE FROM briefs WHERE profile_id = ?').run(id);

    // The profile row itself. Guarded against the system sentinel (id 0),
    // which no session token can ever resolve to.
    const out = db.prepare('DELETE FROM profiles WHERE id = ? AND id <> 0').run(id);
    db.exec('COMMIT');
    return out.changes > 0;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Map legacy 3-boolean consents onto the richer settings (discovery toggle only). */
function consentSettingsFromLegacy(consents, current) {
  const next = { ...current };
  if (consents && typeof consents.community_visible === 'boolean') {
    next.discoveryEnabled = consents.community_visible;
  }
  return next;
}

/* ---------------- privacy-aware profile views ---------------- */

/** True when a and b share an accepted (or boundary-accepted) connection. */
export function hasMutualConnection(a, b) {
  const row = db.prepare(`
    SELECT 1 FROM introductions
    WHERE status IN ('accepted', 'accepted_with_boundary')
      AND ((requester_id = ? AND proposed_id = ?) OR (requester_id = ? AND proposed_id = ?))
    LIMIT 1
  `).get(a, b, b, a);
  return !!row;
}

export function isBlockedBetween(a, b) {
  const row = db.prepare(`
    SELECT 1 FROM blocks
    WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
    LIMIT 1
  `).get(a, b, b, a);
  return !!row;
}

/**
 * Privacy-filtered view of a profile for a viewer.
 * - Own profile (viewerId === id): full.
 * - Hidden QA/test records: minimal (id, name) for everyone else.
 * - Paused / discovery disabled and no mutual connection: minimal (id, name).
 * - Otherwise: fields gated by the target's consent_settings.
 * Email is never exposed to other members. Social/website links are treated
 * as contact details and shown only after mutual consent.
 */
export function getVisibleProfile(id, viewerId) {
  const p = getProfile(id);
  if (!p) return null;
  const vid = Number(viewerId);
  if (vid === p.id) return p; // own profile: everything

  // QA/test records are never shown to other members.
  if (p.isHidden) {
    return { id: p.id, name: p.name, visualIdentity: p.visualIdentity, hidden: true };
  }

  const mutual = Number.isInteger(vid) && vid > 0 ? hasMutualConnection(vid, p.id) : false;
  const cs = p.consentSettings || {};

  if ((!cs.discoveryEnabled || cs.paused) && !mutual) {
    return { id: p.id, name: p.name, visualIdentity: p.visualIdentity, hidden: true };
  }

  const view = {
    id: p.id,
    name: p.name,
    pronouns: p.pronouns,
    visualIdentity: p.visualIdentity,
    isSeed: p.isSeed,
  };
  if (cs.showPractices || mutual) {
    view.practices = p.practices;
    view.practicesOther = p.practicesOther;
    view.intentions = p.intentions;
    view.intentionsOther = p.intentionsOther;
    view.interests = p.interests;
    view.about = p.about;
    // v7: offers / needs / skills are matching surface, same visibility rule.
    view.offers = p.offers;
    view.needs = p.needs;
    view.skills = p.skills;
  }
  if (cs.showRegion || mutual) view.region = p.region;
  if (cs.showPhoto || mutual) view.photoUrl = p.photoUrl;
  if (mutual) {
    view.intention = p.intention;
    // Social/website links are contact details: only after mutual consent.
    if (p.links && Object.keys(p.links).length) view.links = p.links;
    view.prefs = { localRemote: p.prefs.localRemote, formats: p.prefs.formats, languages: p.prefs.languages, availability: p.prefs.availability || '' };
  }
  view.mutual = mutual;
  // Tasteful availability signal: when the viewer was previously declined by
  // this person, the request composer disables itself instead of letting the
  // viewer send a request the server would reject. The viewer already knows
  // about the decline, so this reveals nothing new.
  if (Number.isInteger(vid) && vid > 0 && vid !== p.id) {
    view.requestBlocked = hasDeclineBlock(p.id, vid);
  }
  return view;
}

// ---------- introduction helpers ----------

// ---------- agent registry ----------

/** Agent wire object (camelCase). Agents are AI participants registered by a human operator. */
function toAgent(row) {
  if (!row) return null;
  const vetting = parseJson(row.vetting_json, {});
  const vettingComplete = AGENT_VETTING_KEYS.every((k) => vetting[k] === true);
  const reviewed = row.reviewed === 1;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind || 'ai',
    operatorProfileId: row.operator_profile_id,
    operatorName: row.operator_name || '',
    description: row.description || '',
    capabilities: parseJson(row.capabilities_json, []),
    endpointUrl: row.endpoint_url || '',
    trustNote: row.trust_note || '',
    verified: row.verified === 1,
    vetting,
    vettingComplete,
    reviewed,
    // Honest display tier. "Verified" is never used: only a host review
    // marks "Host-reviewed", and even that is not a platform guarantee.
    trustTier: reviewed ? 'host-reviewed' : (vettingComplete ? 'operator-attested' : 'unverified'),
    // World 3.0 ethical maturity (docs/SEREN_AI_CONSTITUTION.md §5).
    // Derived from vetting + host review only; gold/platinum are not
    // derivable (they require a measurement programme and independent
    // stewardship review that do not exist yet) and are never assigned.
    certTier: reviewed ? 'silver' : (vettingComplete ? 'bronze' : 'ungraded'),
    isHidden: row.is_hidden === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const AGENT_SELECT = `
  SELECT a.*, p.name AS operator_name
  FROM agents a
  LEFT JOIN profiles p ON p.id = a.operator_profile_id
`;

export function getAgent(id) {
  return toAgent(db.prepare(`${AGENT_SELECT} WHERE a.id = ?`).get(id));
}

export function listAgents({ includeHidden = false } = {}) {
  const rows = db.prepare(
    `${AGENT_SELECT} ${includeHidden ? '' : 'WHERE a.is_hidden = 0'} ORDER BY a.id ASC`,
  ).all();
  return rows.map(toAgent);
}

export function createAgent({ name, operatorProfileId, description = '', capabilities = [], endpointUrl = '', trustNote = '', vetting = {} }) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO agents
      (name, kind, operator_profile_id, description, capabilities_json, endpoint_url, trust_note, vetting_json, verified, is_hidden, created_at, updated_at)
    VALUES (?, 'ai', ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
  `).run(
    String(name).trim(),
    Number(operatorProfileId) || null,
    String(description || '').trim(),
    JSON.stringify(normalizeStringList(capabilities)),
    String(endpointUrl || '').trim(),
    String(trustNote || '').trim(),
    JSON.stringify(normalizeVetting(vetting)),
    now,
    now,
  );
  return getAgent(Number(result.lastInsertRowid));
}

/** Normalize a vetting payload to the known checklist keys (booleans). */
export function normalizeVetting(vetting) {
  const out = {};
  for (const k of AGENT_VETTING_KEYS) out[k] = (vetting && vetting[k]) === true;
  return out;
}

/** Host-only: mark an agent listing as host-reviewed (or clear it). */
export function setAgentReviewed(id, reviewed) {
  db.prepare('UPDATE agents SET reviewed = ?, updated_at = ? WHERE id = ?')
    .run(reviewed ? 1 : 0, new Date().toISOString(), id);
  return getAgent(id);
}

/**
 * Update an agent. Only the registering operator may edit.
 * @returns the updated agent, null when not found, or 'forbidden'.
 */
export function updateAgent(id, fields, operatorProfileId) {
  const existing = getAgent(id);
  if (!existing) return null;
  if (Number(existing.operatorProfileId) !== Number(operatorProfileId)) return 'forbidden';
  const sets = [];
  const params = [];
  const str = (v) => String(v).trim();
  if (fields.name !== undefined) { sets.push('name = ?'); params.push(str(fields.name)); }
  if (fields.description !== undefined) { sets.push('description = ?'); params.push(str(fields.description)); }
  if (fields.capabilities !== undefined) { sets.push('capabilities_json = ?'); params.push(JSON.stringify(normalizeStringList(fields.capabilities))); }
  if (fields.endpointUrl !== undefined) { sets.push('endpoint_url = ?'); params.push(str(fields.endpointUrl)); }
  if (fields.trustNote !== undefined) { sets.push('trust_note = ?'); params.push(str(fields.trustNote)); }
  if (fields.vetting !== undefined) { sets.push('vetting_json = ?'); params.push(JSON.stringify(normalizeVetting(fields.vetting))); }
  sets.push('updated_at = ?');
  params.push(new Date().toISOString());
  db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  return getAgent(id);
}

/**
 * Soft-hide an agent from discovery. Only the operator may hide.
 * @returns true when hidden, false when not found, 'forbidden' otherwise.
 */
export function hideAgent(id, operatorProfileId) {
  const existing = getAgent(id);
  if (!existing) return false;
  if (Number(existing.operatorProfileId) !== Number(operatorProfileId)) return 'forbidden';
  db.prepare('UPDATE agents SET is_hidden = 1, updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id);
  return true;
}

// ---------- Layer 3: Benevolent AI -> Benevolent AI ----------
// A connection here is a bounded handshake, not an open-ended agent chat.
// Both agents must be Bronze or above (all five benevolence criteria
// affirmed); Human Mode also requires review by a named SEREN host. The
// accountable operators then make the final decision. Acceptance creates
// an ordinary proposed introduction between the operators, so no contact
// details or messaging unlock until SEREN's normal human consent flow
// has run. A decline is durable for that agent pair.

function agentConnectionPairKey(a, b) {
  const lo = Math.min(Number(a), Number(b));
  const hi = Math.max(Number(a), Number(b));
  return `${lo}:${hi}`;
}

function toAgentConnection(row) {
  if (!row) return null;
  return {
    id: row.id,
    pairKey: row.pair_key,
    sourceAgentId: row.source_agent_id,
    targetAgentId: row.target_agent_id,
    sourceAgent: getAgent(row.source_agent_id),
    targetAgent: getAgent(row.target_agent_id),
    proposedByProfileId: row.proposed_by_profile_id,
    mode: row.mode,
    rationale: row.rationale || '',
    dataBasis: row.data_basis || '',
    synchronicitySignal: row.synchronicity_signal || '',
    synchronicitySource: row.synchronicity_source || '',
    status: row.status,
    hostProfileId: row.host_profile_id,
    hostApproved: row.host_approved === 1,
    hostReviewedAt: row.host_reviewed_at || '',
    responderNote: row.responder_note || '',
    introductionId: row.introduction_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getAgentConnection(id) {
  return toAgentConnection(db.prepare('SELECT * FROM agent_connections WHERE id = ?').get(id));
}

export function getAgentConnectionByPair(sourceAgentId, targetAgentId) {
  return toAgentConnection(db.prepare(
    'SELECT * FROM agent_connections WHERE pair_key = ?',
  ).get(agentConnectionPairKey(sourceAgentId, targetAgentId)));
}

export function evaluateAgentConnectionHandshake(source, target, mode, { hostApproved = false } = {}) {
  const issues = [];
  if (!source || !target) {
    issues.push('Both agents must exist.');
    return { eligible: false, issues, requiresHostReview: mode === 'human', hostApproved };
  }
  if (Number(source.id) === Number(target.id)) issues.push('An agent cannot connect to itself.');
  if (source.isHidden || target.isHidden) issues.push('Hidden agents cannot connect.');
  if (!source.operatorProfileId || !target.operatorProfileId) {
    issues.push('Both agents need an accountable human operator.');
  }
  if (source.operatorProfileId && target.operatorProfileId
    && Number(source.operatorProfileId) === Number(target.operatorProfileId)) {
    issues.push('Agents operated by the same person cannot connect to each other.');
  }
  if ((AGENT_CERT_RANK[source.certTier] ?? 0) < AGENT_CERT_RANK.bronze) {
    issues.push('The proposing agent must complete the benevolence checklist (Bronze) before connecting.');
  }
  if ((AGENT_CERT_RANK[target.certTier] ?? 0) < AGENT_CERT_RANK.bronze) {
    issues.push('The receiving agent must complete the benevolence checklist (Bronze) before connecting.');
  }
  if (!['data', 'synchronicity', 'human'].includes(mode)) {
    issues.push('Connection mode must be data, synchronicity, or human.');
  }
  if (mode === 'human' && source.certTier !== 'silver' && target.certTier !== 'silver') {
    issues.push('Human Mode requires at least one Silver (host-reviewed) agent.');
  }

  // The endpoint of this handshake is a human introduction, so the two
  // operators must still be eligible for one: opted in, not paused, and
  // not separated by a durable decline.
  if (source.operatorProfileId && target.operatorProfileId
    && Number(source.operatorProfileId) !== Number(target.operatorProfileId)) {
    const sourceProfile = getProfile(source.operatorProfileId);
    const targetProfile = getProfile(target.operatorProfileId);
    if (!sourceProfile || !targetProfile) {
      issues.push('Both accountable operators must still be SEREN members.');
    } else {
      if (!sourceProfile.consents?.introductions || !targetProfile.consents?.introductions) {
        issues.push('Both operators must be opted into introductions.');
      }
      if (sourceProfile.consentSettings?.paused || targetProfile.consentSettings?.paused) {
        issues.push('An operator has paused connection activity.');
      }
      if (hasDeclineBlock(targetProfile.id, sourceProfile.id)) {
        issues.push('The receiving operator has declined repeat requests from the proposing operator.');
      }
      const existing = findExistingPair(sourceProfile.id, targetProfile.id);
      if (existing && ['declined', 'declined_hidden'].includes(existing.status)) {
        issues.push('These operators have already declined an introduction.');
      }
    }
  }

  return {
    eligible: issues.length === 0,
    issues,
    requiresHostReview: mode === 'human',
    hostApproved,
  };
}

export function createAgentConnection({
  sourceAgentId, targetAgentId, proposedByProfileId, mode,
  rationale = '', dataBasis = '', synchronicitySignal = '', synchronicitySource = '',
}) {
  const source = getAgent(sourceAgentId);
  const target = getAgent(targetAgentId);
  const handshake = evaluateAgentConnectionHandshake(source, target, mode);
  if (!handshake.eligible) return { error: 'ineligible', issues: handshake.issues, handshake };
  if (Number(source.operatorProfileId) !== Number(proposedByProfileId)) return 'forbidden';

  const existing = getAgentConnectionByPair(sourceAgentId, targetAgentId);
  if (existing) {
    // Proposed/accepted/declined/blocked are all durable states. Only a
    // withdrawn proposal may be reopened, and only as the same pair row.
    if (existing.status !== 'withdrawn') return existing;
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE agent_connections
      SET source_agent_id = ?, target_agent_id = ?, proposed_by_profile_id = ?,
          mode = ?, rationale = ?, data_basis = ?, synchronicity_signal = ?,
          synchronicity_source = ?, status = 'proposed', host_profile_id = NULL,
          host_approved = 0, host_reviewed_at = '', responder_note = '',
          introduction_id = NULL, updated_at = ?
      WHERE id = ?
    `).run(
      sourceAgentId, targetAgentId, proposedByProfileId, mode,
      String(rationale || '').trim(), String(dataBasis || '').trim(),
      String(synchronicitySignal || '').trim(), String(synchronicitySource || '').trim(),
      now, existing.id,
    );
    return getAgentConnection(existing.id);
  }

  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO agent_connections
      (pair_key, source_agent_id, target_agent_id, proposed_by_profile_id,
       mode, rationale, data_basis, synchronicity_signal, synchronicity_source,
       status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)
  `).run(
    agentConnectionPairKey(sourceAgentId, targetAgentId),
    sourceAgentId, targetAgentId, proposedByProfileId, mode,
    String(rationale || '').trim(), String(dataBasis || '').trim(),
    String(synchronicitySignal || '').trim(), String(synchronicitySource || '').trim(),
    now, now,
  );
  return getAgentConnection(Number(result.lastInsertRowid));
}

export function listAgentConnectionsForOperator(profileId) {
  const rows = db.prepare(`
    SELECT ac.*
    FROM agent_connections ac
    JOIN agents sa ON sa.id = ac.source_agent_id
    JOIN agents ta ON ta.id = ac.target_agent_id
    WHERE sa.operator_profile_id = ? OR ta.operator_profile_id = ?
    ORDER BY ac.id DESC
  `).all(profileId, profileId);
  return rows.map(toAgentConnection);
}

export function listAgentConnectionsForHost() {
  const rows = db.prepare(`
    SELECT * FROM agent_connections
    WHERE mode = 'human'
    ORDER BY (status = 'proposed' AND host_approved = 0) DESC, id DESC
  `).all();
  return rows.map(toAgentConnection);
}

export function hostReviewAgentConnection(id, hostProfileId) {
  const conn = getAgentConnection(id);
  if (!conn) return null;
  if (conn.mode !== 'human') return 'not_human_mode';
  if (conn.status !== 'proposed') return 'invalid';
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE agent_connections
    SET host_profile_id = ?, host_approved = 1, host_reviewed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(hostProfileId, now, now, id);
  return getAgentConnection(id);
}

export function respondToAgentConnection(id, profileId, action, responderNote = '') {
  const conn = getAgentConnection(id);
  if (!conn) return null;
  const source = conn.sourceAgent;
  const target = conn.targetAgent;
  if (!source || !target) return 'invalid';

  if (action === 'withdraw') {
    if (Number(source.operatorProfileId) !== Number(profileId)) return 'forbidden';
    if (conn.status !== 'proposed') return 'invalid';
    db.prepare(`
      UPDATE agent_connections
      SET status = 'withdrawn', responder_note = ?, updated_at = ?
      WHERE id = ?
    `).run(String(responderNote || '').trim(), new Date().toISOString(), id);
    return getAgentConnection(id);
  }

  if (!['accept', 'decline'].includes(action)) return 'invalid';
  if (Number(target.operatorProfileId) !== Number(profileId)) return 'forbidden';
  if (conn.status !== 'proposed') return 'invalid';

  const now = new Date().toISOString();
  if (action === 'decline') {
    db.prepare(`
      UPDATE agent_connections
      SET status = 'declined', responder_note = ?, updated_at = ?
      WHERE id = ?
    `).run(String(responderNote || '').trim(), now, id);
    return getAgentConnection(id);
  }

  const handshake = evaluateAgentConnectionHandshake(source, target, conn.mode, {
    hostApproved: conn.hostApproved,
  });
  if (!handshake.eligible) return { error: 'ineligible', issues: handshake.issues, handshake };
  if (handshake.requiresHostReview && !conn.hostApproved) return 'host_review_required';

  // Both operators have now consented to the agent handshake. Create (or
  // reuse) the ordinary human introduction in its proposed state: contact
  // details and messaging still unlock only through that flow.
  const sourceProfile = getProfile(source.operatorProfileId);
  const targetProfile = getProfile(target.operatorProfileId);
  let intro = findExistingPair(sourceProfile.id, targetProfile.id);
  if (!intro) {
    const basis = conn.mode === 'data'
      ? (conn.dataBasis || 'Declared capabilities, needs, and intentions supplied by the operators.')
      : conn.mode === 'synchronicity'
        ? `Synchronicity signal (${conn.synchronicitySource === 'seren_generated' ? 'SEREN-generated and labeled as such' : 'supplied by a member'}): ${conn.synchronicitySignal}`
        : 'Facilitated in Human Mode after SEREN host review.';
    intro = createIntroduction({
      requesterId: sourceProfile.id,
      proposedId: targetProfile.id,
      intention: `Agent-mediated connection (${conn.mode} mode)`,
      note: `${source.name} and ${target.name} completed SEREN's agent handshake. Basis: ${basis} Operator rationale: ${conn.rationale || 'No rationale supplied.'} No contact details are shared by the agent connection itself.`,
      score: 0,
      connectionType: 'agent-mediated',
      requestMessage: conn.rationale || '',
    });
  }

  db.prepare(`
    UPDATE agent_connections
    SET status = 'accepted', responder_note = ?, introduction_id = ?, updated_at = ?
    WHERE id = ?
  `).run(String(responderNote || '').trim(), intro.id, now, id);
  return getAgentConnection(id);
}

const getIntroductionStmt = db.prepare('SELECT * FROM introductions WHERE id = ?');
export function getIntroduction(id) {
  return toIntroduction(getIntroductionStmt.get(id));
}

export function createIntroduction({ requesterId, proposedId, intention, note, score,
  connectionType = '', requestMessage = '', format = '', commitment = '', tone = '',
  requesterSharedText = '' }) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO introductions
      (requester_id, proposed_id, intention, note, score, status,
       connection_type, request_message, format, commitment, tone,
       requester_shared_text,
       created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    requesterId,
    proposedId,
    intention.trim(),
    note,
    score,
    INTRO_STATUS.PROPOSED,
    connectionType,
    (requestMessage || '').trim(),
    format,
    commitment,
    tone,
    (requesterSharedText || '').trim(),
    now,
    now,
  );
  return getIntroduction(Number(result.lastInsertRowid));
}

export function setIntroductionStatus(id, status, { responseKind = '', responderNote = '' } = {}) {
  db.prepare(`
    UPDATE introductions
    SET status = ?, response_kind = ?, responder_note = ?, updated_at = ?
    WHERE id = ?
  `).run(status, responseKind, responderNote, new Date().toISOString(), id);
  return getIntroduction(id);
}

/** A non-withdrawn introduction between a and b in either direction, or null. */
export function findExistingPair(a, b) {
  const row = db.prepare(`
    SELECT * FROM introductions
    WHERE status != ?
      AND ((requester_id = ? AND proposed_id = ?) OR (requester_id = ? AND proposed_id = ?))
    LIMIT 1
  `).get(INTRO_STATUS.WITHDRAWN, a, b, b, a);
  return toIntroduction(row);
}

/** "minId:maxId" keys for every non-withdrawn introduction (pair matching). */
export function getNonWithdrawnPairKeys() {
  const rows = db.prepare(`
    SELECT requester_id, proposed_id FROM introductions WHERE status != ?
  `).all(INTRO_STATUS.WITHDRAWN);
  const keys = new Set();
  for (const r of rows) {
    const lo = Math.min(r.requester_id, r.proposed_id);
    const hi = Math.max(r.requester_id, r.proposed_id);
    keys.add(`${lo}:${hi}`);
  }
  return keys;
}

// ---------- decline blocks ----------
// A decline (either kind) durably records that the decliner does not want
// further direct requests from that requester. Directional: only requests
// FROM requester TO decliner are blocked. The decliner can lift it.

/** Record that decliner does not want direct requests from requester. */
export function recordDeclineBlock(declinerId, requesterId) {
  db.prepare(`
    INSERT OR IGNORE INTO decline_blocks (decliner_id, requester_id, created_at)
    VALUES (?, ?, ?)
  `).run(declinerId, requesterId, new Date().toISOString());
}

/** True when requester may not send direct requests to decliner. */
export function hasDeclineBlock(declinerId, requesterId) {
  return !!db.prepare(`
    SELECT 1 FROM decline_blocks WHERE decliner_id = ? AND requester_id = ?
  `).get(declinerId, requesterId);
}

/** Lift a block the decliner placed. Returns true when a row was removed. */
export function removeDeclineBlock(declinerId, requesterId) {
  return db.prepare(`
    DELETE FROM decline_blocks WHERE decliner_id = ? AND requester_id = ?
  `).run(declinerId, requesterId).changes > 0;
}

/** All requester ids the decliner has blocked, newest first. */
export function listDeclineBlocks(declinerId) {
  return db.prepare(`
    SELECT requester_id, created_at FROM decline_blocks
    WHERE decliner_id = ? ORDER BY id DESC
  `).all(declinerId);
}

/** All introductions involving a profile, with names, newest first. */
export function listIntroductionsFor(profileId) {  const rows = db.prepare(`
    SELECT i.*, rp.name AS requester_name, pp.name AS proposed_name
    FROM introductions i
    LEFT JOIN profiles rp ON rp.id = i.requester_id
    LEFT JOIN profiles pp ON pp.id = i.proposed_id
    WHERE i.requester_id = ? OR i.proposed_id = ?
    ORDER BY i.id DESC
  `).all(profileId, profileId);
  return rows.map((r) => ({
    ...toIntroduction(r),
    requesterName: r.requester_name,
    proposedName: r.proposed_name,
  }));
}

// ---------- passes & saved items ----------

export function addPass(profileId, passedId) {
  db.prepare('INSERT OR IGNORE INTO passes (profile_id, passed_id, created_at) VALUES (?, ?, ?)')
    .run(profileId, passedId, new Date().toISOString());
}

export function getPassedIds(profileId) {
  return new Set(
    db.prepare('SELECT passed_id AS id FROM passes WHERE profile_id = ?').all(profileId).map((r) => r.id),
  );
}

export function addSavedItem(profileId, kind, refId) {
  db.prepare('INSERT OR IGNORE INTO saved_items (profile_id, kind, ref_id, created_at) VALUES (?, ?, ?, ?)')
    .run(profileId, kind, String(refId), new Date().toISOString());
}

export function removeSavedItem(profileId, kind, refId) {
  db.prepare('DELETE FROM saved_items WHERE profile_id = ? AND kind = ? AND ref_id = ?')
    .run(profileId, kind, String(refId));
}

export function listSavedItems(profileId) {
  return db.prepare('SELECT kind, ref_id AS refId, created_at AS createdAt FROM saved_items WHERE profile_id = ? ORDER BY id DESC')
    .all(profileId);
}

export function getSavedKeys(profileId) {
  const rows = db.prepare('SELECT kind, ref_id FROM saved_items WHERE profile_id = ?').all(profileId);
  return new Set(rows.map((r) => `${r.kind}:${r.ref_id}`));
}

// ---------- blocks & reports ----------

export function addBlock(blockerId, blockedId) {
  db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)')
    .run(blockerId, blockedId, new Date().toISOString());
}

export function removeBlock(blockerId, blockedId) {
  db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(blockerId, blockedId);
}

export function listBlocks(blockerId) {
  return db.prepare(`
    SELECT p.id, p.name FROM blocks b JOIN profiles p ON p.id = b.blocked_id
    WHERE b.blocker_id = ? ORDER BY b.id DESC
  `).all(blockerId);
}

export function createReport({ reporterId, reportedId, reason, details }) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO reports (reporter_id, reported_id, reason, details, status, created_at)
    VALUES (?, ?, ?, ?, 'open', ?)
  `).run(reporterId, reportedId, reason, (details || '').trim(), now);
  return { id: Number(result.lastInsertRowid), status: 'open', createdAt: now };
}

// ---------- host moderation ----------

export function listReports() {
  return db.prepare(`
    SELECT r.id, r.reporter_id AS reporterId, r.reported_id AS reportedId,
           p1.name AS reporterName, p2.name AS reportedName,
           r.reason, r.details, r.status, r.created_at AS createdAt
    FROM reports r
    LEFT JOIN profiles p1 ON p1.id = r.reporter_id
    LEFT JOIN profiles p2 ON p2.id = r.reported_id
    ORDER BY r.created_at DESC, r.id DESC
  `).all();
}

export function getReport(id) {
  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
  if (!row) return null;
  return {
    id: row.id,
    reporterId: row.reporter_id,
    reportedId: row.reported_id,
    reason: row.reason,
    details: row.details,
    status: row.status,
    createdAt: row.created_at,
  };
}

export function setReportStatus(id, status) {
  // v16: updated_at marks the moment the status moved, so host safety
  // analytics can measure resolution latency (created -> resolved).
  db.prepare('UPDATE reports SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, new Date().toISOString(), id);
}

export function setProfileHidden(id, hidden) {
  db.prepare('UPDATE profiles SET is_hidden = ? WHERE id = ?').run(hidden ? 1 : 0, id);
}

// ---------- flourishing by design (v16) ----------
// Outcome tracking: weekly check-ins, per-introduction feedback, and
// real-life intentions. No engagement metrics (no DAU, session time,
// message volume, streaks) — the host analytics below deliberately measure
// member-reported outcomes only.

/**
 * Record a check-in submission: one row per answered question. All rows in
 * the batch share one created_at. Answers are already normalized text.
 * @returns {{ids: number[], createdAt: string}}
 */
export function createFlourishingCheckins(profileId, responses) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO flourishing_checkins (profile_id, question_key, answer_text, created_at)
    VALUES (?, ?, ?, ?)
  `);
  // node:sqlite is synchronous; a plain loop is atomic enough here (one
  // statement per answer, no interleaving within a single tick).
  const ids = responses.map((r) =>
    Number(stmt.run(profileId, r.questionKey, r.answer, now).lastInsertRowid));
  return { ids, createdAt: now };
}

/** The caller's own check-in answers, newest first. */
export function listFlourishingCheckins(profileId) {
  return db.prepare(`
    SELECT id,
           question_key AS questionKey,
           answer_text AS answer,
           created_at AS createdAt
    FROM flourishing_checkins
    WHERE profile_id = ?
    ORDER BY id DESC
  `).all(profileId);
}

function toFeedback(row) {
  if (!row) return null;
  return {
    id: row.id,
    introductionId: row.introduction_id,
    profileId: row.profile_id,
    feltSafe: row.felt_safe === 1,
    quality: row.quality,
    notes: row.notes || '',
    createdAt: row.created_at,
  };
}

/** Feedback this profile already left on the introduction, or null. */
export function getIntroductionFeedback(introductionId, profileId) {
  return toFeedback(db.prepare(`
    SELECT * FROM introduction_feedback
    WHERE introduction_id = ? AND profile_id = ?
  `).get(introductionId, profileId));
}

/** Leave feedback. The unique index is the race-proof one-feedback enforcer. */
export function createIntroductionFeedback({ introductionId, profileId, feltSafe, quality, notes }) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO introduction_feedback
      (introduction_id, profile_id, felt_safe, quality, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(introductionId, profileId, feltSafe ? 1 : 0, quality ?? null, (notes || '').trim(), now);
  return toFeedback(db.prepare('SELECT * FROM introduction_feedback WHERE id = ?')
    .get(Number(result.lastInsertRowid)));
}

/** Set the real-life intention text (a declared intent, not an outcome). */
export function setIntroductionRealLifeIntention(id, intention) {
  db.prepare(`
    UPDATE introductions SET real_life_intention = ?, updated_at = ? WHERE id = ?
  `).run(intention, new Date().toISOString(), id);
  return getIntroduction(id);
}

/** Mark the real-life intention complete. */
export function completeIntroductionRealLifeIntention(id) {
  db.prepare(`
    UPDATE introductions SET intention_completed = 1, updated_at = ? WHERE id = ?
  `).run(new Date().toISOString(), id);
  return getIntroduction(id);
}

/**
 * Mark an introduction as moved to real life (Digital Sapiens P6): the
 * member declares the connection now lives beyond the app, and SEREN
 * steps back — no further nudges about this connection. Consent-first
 * and reversible only by ending the connection; the flag itself is a
 * quiet state, never a claim about outcomes.
 */
export function markIntroductionMovedToRealLife(id) {
  db.prepare(`
    UPDATE introductions SET moved_to_real_life = 1, updated_at = ? WHERE id = ?
  `).run(new Date().toISOString(), id);
  return getIntroduction(id);
}

/** Valid coarse origins for an app open (Digital Sapiens attention analytics). */
export const ATTENTION_ORIGINS = Object.freeze([
  'intentional',   // member opened the app on purpose
  'notification',  // arrived via a notification tap
  'reengagement', // arrived via a re-engagement prompt
  'unknown',      // origin not determined
]);

/** Record one app open with its coarse origin. */
export function recordAttentionOpen(profileId, origin) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO attention_opens (profile_id, origin, created_at)
    VALUES (?, ?, ?)
  `).run(profileId, origin, now);
  return Number(result.lastInsertRowid);
}

/** 30-day app-open counts by origin for host attention analytics. */
export function getAttentionOpenAggregates() {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT origin, COUNT(*) AS n
    FROM attention_opens
    WHERE created_at >= ?
    GROUP BY origin
  `).all(since);
  const byOrigin = { intentional: 0, notification: 0, reengagement: 0, unknown: 0 };
  for (const r of rows) {
    if (r.origin in byOrigin) byOrigin[r.origin] = r.n;
  }
  return byOrigin;
}

/**
 * Raw aggregates for the host analytics view. All check-in metrics use a
 * trailing-30-day window; introduction feedback aggregates all feedback on
 * record (n is small and quality answers stay relevant).
 * @returns aggregate rows; the caller shapes percentages.
 */
export function getFlourishingAggregates() {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const yesByKey = db.prepare(`
    SELECT question_key AS questionKey, COUNT(DISTINCT profile_id) AS yesN
    FROM flourishing_checkins
    WHERE created_at >= ? AND answer_text = 'yes'
    GROUP BY question_key
  `).all(since);
  const answeredByKey = db.prepare(`
    SELECT question_key AS questionKey, COUNT(DISTINCT profile_id) AS n
    FROM flourishing_checkins
    WHERE created_at >= ?
    GROUP BY question_key
  `).all(since);
  const connectedHigh = db.prepare(`
    SELECT COUNT(DISTINCT profile_id) AS n
    FROM flourishing_checkins
    WHERE question_key = 'connected' AND created_at >= ?
      AND CAST(answer_text AS INTEGER) >= 4
  `).get(since);
  const feedback = db.prepare(`
    SELECT COUNT(*) AS n,
           AVG(quality) AS avgQuality,
           SUM(CASE WHEN felt_safe = 1 THEN 1 ELSE 0 END) AS safeN
    FROM introduction_feedback
  `).get();
  const incidents = db.prepare(`
    SELECT COUNT(*) AS n FROM reports WHERE created_at >= ?
  `).get(since);
  const resolution = db.prepare(`
    SELECT AVG((julianday(updated_at) - julianday(created_at)) * 24.0) AS avgHours
    FROM reports
    WHERE created_at >= ?
      AND status != 'open'
      AND updated_at IS NOT NULL AND updated_at != ''
  `).get(since);
  // Digital Sapiens: distribution of the net_attention choice answers
  // ('more_present' | 'about_same' | 'more_scattered') for attention
  // analytics. Distinct profiles per answer, trailing 30 days like the
  // other check-in metrics.
  const choiceDist = db.prepare(`
    SELECT question_key AS questionKey, answer_text AS answer,
           COUNT(DISTINCT profile_id) AS n
    FROM flourishing_checkins
    WHERE created_at >= ? AND question_key = 'net_attention'
    GROUP BY question_key, answer_text
  `).all(since);
  return { yesByKey, answeredByKey, connectedHigh, feedback, incidents, resolution, choiceDist };
}

// ---------- host assists (Human Mode) ----------
// A member asks a real host to suggest a connection; the host's proposal
// creates an introduction through the normal staged-consent flow. Deleting
// a profile removes its assist requests via the ON DELETE CASCADE FK.

function toHostAssist(row) {
  if (!row) return null;
  return {
    id: row.id,
    profileId: row.profile_id,
    askerName: row.asker_name || '',
    requestText: row.request_text || '',
    status: row.status,
    createdAt: row.created_at,
  };
}

const getHostAssistStmt = db.prepare('SELECT * FROM host_assists WHERE id = ?');
export function getHostAssist(id) {
  return toHostAssist(getHostAssistStmt.get(id));
}

/** The member's single open assist request, or null. */
export function getOpenHostAssist(profileId) {
  return toHostAssist(db.prepare(
    'SELECT * FROM host_assists WHERE profile_id = ? AND status = \'open\' LIMIT 1',
  ).get(profileId));
}

export function createHostAssist({ profileId, requestText }) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO host_assists (profile_id, request_text, status, created_at)
    VALUES (?, ?, 'open', ?)
  `).run(profileId, requestText.trim(), now);
  return getHostAssist(Number(result.lastInsertRowid));
}

/** All of one member's requests, newest first (for their own view). */
export function listHostAssistsFor(profileId) {
  return db.prepare('SELECT * FROM host_assists WHERE profile_id = ? ORDER BY id DESC')
    .all(profileId).map(toHostAssist);
}

/** Every open request, oldest first, with the asker's name (host queue). */
export function listOpenHostAssists() {
  return db.prepare(`
    SELECT h.*, p.name AS asker_name
    FROM host_assists h
    JOIN profiles p ON p.id = h.profile_id
    WHERE h.status = 'open'
    ORDER BY h.created_at ASC, h.id ASC
  `).all().map(toHostAssist);
}

/** Transition an assist: 'open' -> 'proposed' (host) or 'withdrawn' (asker). */
export function setHostAssistStatus(id, status) {
  db.prepare('UPDATE host_assists SET status = ? WHERE id = ?').run(status, id);
  return getHostAssist(id);
}

// ---------- synchronicity beacons ----------
// A beacon is a short, time-bound signal a member chooses to be matched on.
// Matching is exact-normalized-text only in the MVP (no resonance/cluster
// matching — that is phase 2 per the spec). Beacons are private by default:
// no endpoint reveals one member's beacon text to another member except the
// matched counterpart at proposal stage, via the introduction note.
//
// The match check runs synchronously at beacon creation (simple,
// deterministic, testable): after inserting a beacon, scan for an eligible
// exact match and propose. See trySynchronicityMatch.

/** Default beacon lifetime: 7 days (spec Flow A/B). */
export const BEACON_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Normalize beacon text for exact matching: lowercase, trim, collapse
 * internal whitespace, strip surrounding punctuation, and light
 * singularization ("rivers" -> "river"). Deterministic and explainable.
 */
export function normalizeBeaconText(text) {
  let t = String(text || '').toLowerCase().trim();
  t = t.replace(/[\s\u00a0]+/g, ' '); // collapse whitespace
  t = t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''); // strip edge punctuation
  // Light singularization on the whole string (covers single-word beacons).
  if (t.length > 4 && t.endsWith('ies')) t = t.slice(0, -3) + 'y';
  else if (t.length > 4 && /(s|sh|ch|x|z)es$/.test(t)) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) t = t.slice(0, -1);
  return t;
}

function toBeacon(row) {
  if (!row) return null;
  return {
    id: row.id,
    profileId: row.profile_id,
    source: row.source,
    rawText: row.raw_text,
    normalizedText: row.normalized_text,
    cardId: row.card_id || null,
    intentionType: row.intention_type || null,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

const getBeaconStmt = db.prepare('SELECT * FROM beacons WHERE id = ?');
export function getBeacon(id) {
  return toBeacon(getBeaconStmt.get(id));
}

/** Mark active-but-past-expiry beacons 'expired' (for one profile, or all). */
export function expireStaleBeacons(profileId = null) {
  const now = new Date().toISOString();
  let beaconsExpired;
  if (profileId === null) {
    beaconsExpired = db.prepare(
      `UPDATE beacons SET status = 'expired' WHERE status = 'active' AND expires_at <= ?`,
    ).run(now).changes;
  } else {
    beaconsExpired = db.prepare(
      `UPDATE beacons SET status = 'expired' WHERE profile_id = ? AND status = 'active' AND expires_at <= ?`,
    ).run(profileId, now).changes;
  }
  // A proposed match cannot outlive its beacons: once either side expired,
  // the proposal window is over. Gently closed, never shaming.
  const matchesExpired = db.prepare(`
    UPDATE beacon_matches SET status = 'expired'
    WHERE status = 'proposed'
      AND (beacon_a_id IN (SELECT id FROM beacons WHERE status = 'expired')
        OR beacon_b_id IN (SELECT id FROM beacons WHERE status = 'expired'))
  `).run().changes;
  return { beaconsExpired, matchesExpired };
}

/**
 * The member's currently active beacon, or null. Lazily expires stale rows
 * first so an expired beacon never blocks a new one (belt and braces
 * alongside the host sweep endpoint).
 */
export function getActiveBeacon(profileId) {
  expireStaleBeacons(profileId);
  return toBeacon(db.prepare(
    `SELECT * FROM beacons WHERE profile_id = ? AND status = 'active' LIMIT 1`,
  ).get(profileId));
}

/** All of one member's beacons, newest first (active + history). Private: caller's own rows only. */
export function listBeaconsFor(profileId) {
  expireStaleBeacons(profileId);
  return db.prepare('SELECT * FROM beacons WHERE profile_id = ? ORDER BY id DESC')
    .all(profileId).map(toBeacon);
}

/**
 * Withdraw the member's active beacon. Returns the updated beacon, or null
 * when there is no active beacon.
 */
export function withdrawActiveBeacon(profileId) {
  const active = getActiveBeacon(profileId);
  if (!active) return null;
  db.prepare(`UPDATE beacons SET status = 'withdrawn' WHERE id = ?`).run(active.id);
  return getBeacon(active.id);
}

function toBeaconMatch(row) {
  if (!row) return null;
  return {
    id: row.id,
    beaconAId: row.beacon_a_id,
    beaconBId: row.beacon_b_id,
    matchType: row.match_type,
    status: row.status,
    proposedAt: row.proposed_at,
    introductionId: row.introduction_id ?? null,
  };
}

/**
 * All beacon matches touching one member's beacons, newest first. Privacy:
 * only the match row itself — the counterpart's beacon text is revealed to
 * the caller only through the matched introduction's note (proposal stage),
 * never as a raw beacon row.
 */
export function listBeaconMatchesFor(profileId) {
  return db.prepare(`
    SELECT m.* FROM beacon_matches m
    JOIN beacons ba ON ba.id = m.beacon_a_id
    JOIN beacons bb ON bb.id = m.beacon_b_id
    WHERE ba.profile_id = ? OR bb.profile_id = ?
    ORDER BY m.id DESC
  `).all(profileId, profileId).map(toBeaconMatch);
}

/**
 * Keep beacon matches in step with the introduction lifecycle (called by
 * the introduction respond/withdraw/end handlers):
 * accepted/accepted_with_boundary -> 'accepted'; declined/declined_hidden ->
 * 'declined'; withdrawn/ended -> 'expired'.
 */
export function syncBeaconMatchForIntroduction(introductionId, introStatus) {
  const map = {
    accepted: 'accepted',
    accepted_with_boundary: 'accepted',
    declined: 'declined',
    declined_hidden: 'declined',
    withdrawn: 'expired',
    ended: 'expired',
  };
  const next = map[introStatus];
  if (!next) return;
  db.prepare(`
    UPDATE beacon_matches SET status = ? WHERE introduction_id = ? AND status = 'proposed'
  `).run(next, introductionId);
}

function insertBeacon({ profileId, source, rawText, normalizedText, cardId, intentionType }) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO beacons
      (profile_id, source, raw_text, normalized_text, card_id, intention_type,
       status, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(
    profileId, source, rawText, normalizedText, cardId || null, intentionType || null,
    now, new Date(Date.now() + BEACON_TTL_MS).toISOString(),
  );
  return getBeacon(Number(result.lastInsertRowid));
}

/**
 * Eligibility guard for a synchronicity match between two beacon holders.
 * Mirrors POST /api/connections/request: both must have opted into
 * introductions, be discoverable and unpaused, not block each other, not be
 * decline-blocked in either direction, and have no live introduction pair
 * already (the pair guard: anything not withdrawn/declined/declined_hidden/
 * ended counts as live).
 */
function beaconPairEligible(profileA, profileB) {
  if (!profileA || !profileB) return false;
  if (profileA.id === profileB.id) return false;
  if (!profileA.consents?.introductions || !profileB.consents?.introductions) return false;
  if (profileA.consentSettings?.paused || profileB.consentSettings?.paused) return false;
  if (profileA.consentSettings?.discoveryEnabled === false
    || profileB.consentSettings?.discoveryEnabled === false) return false;
  if (isBlockedBetween(profileA.id, profileB.id)) return false;
  if (hasDeclineBlock(profileA.id, profileB.id) || hasDeclineBlock(profileB.id, profileA.id)) return false;
  const live = db.prepare(`
    SELECT 1 FROM introductions
    WHERE status NOT IN ('withdrawn', 'declined', 'declined_hidden', 'ended')
      AND ((requester_id = ? AND proposed_id = ?) OR (requester_id = ? AND proposed_id = ?))
    LIMIT 1
  `).get(profileA.id, profileB.id, profileB.id, profileA.id);
  return !live;
}

/**
 * Scan for an eligible exact match for `beacon` and propose it. Called
 * synchronously at beacon creation (documented choice: deterministic,
 * testable, no background machinery in the MVP).
 *
 * On a match: both beacons -> 'matched', a beacon_matches row is created in
 * 'proposed' status, and an introduction is created through the existing
 * staged mutual-consent flow. The requester is the LATER beacon holder (the
 * member whose creation triggered this scan); the proposed side is the
 * earlier holder. The introduction note carries the shared-beacon reason in
 * calm, low-claim copy: the system asserts only that both people carried
 * the same word, never why.
 *
 * Returns { match, introduction } or { match: null, introduction: null }.
 */
export function trySynchronicityMatch(beacon) {
  const now = new Date().toISOString();
  const candidates = db.prepare(`
    SELECT * FROM beacons
    WHERE status = 'active'
      AND expires_at > ?
      AND normalized_text = ?
      AND profile_id != ?
    ORDER BY created_at ASC, id ASC
  `).all(now, beacon.normalizedText, beacon.profileId);

  const mine = getProfile(beacon.profileId);
  for (const row of candidates) {
    const other = toBeacon(row);
    const otherProfile = getProfile(other.profileId);
    if (!beaconPairEligible(mine, otherProfile)) continue;

    const word = other.normalizedText;
    const intro = createIntroduction({
      requesterId: mine.id,
      proposedId: otherProfile.id,
      intention: 'A shared synchronicity',
      note: `You both carried '${word}' this week.\n\nIf you want, share what it has been bringing up for you. Only as much as feels good. Passing is always fine, and says nothing about what you noticed.\n\n${REFLECTIVE_FRAMING}`,
      score: 0,
    });

    db.prepare(`UPDATE beacons SET status = 'matched' WHERE id = ?`).run(beacon.id);
    db.prepare(`UPDATE beacons SET status = 'matched' WHERE id = ?`).run(other.id);
    const mr = db.prepare(`
      INSERT INTO beacon_matches
        (beacon_a_id, beacon_b_id, match_type, status, proposed_at, introduction_id)
      VALUES (?, ?, 'exact', 'proposed', ?, ?)
    `).run(beacon.id, other.id, now, intro.id);
    return { match: toBeaconMatch(db.prepare('SELECT * FROM beacon_matches WHERE id = ?').get(Number(mr.lastInsertRowid))), introduction: intro };
  }
  return { match: null, introduction: null };
}

/**
 * Create a beacon and run the synchronous match check, atomically.
 * Throws the UNIQUE-violation error when the member already has an active
 * beacon (the partial index is the enforcer); the handler maps it to 409.
 * @returns { beacon, match, introduction } — match/introduction are null when no eligible match was found.
 */
export function createBeaconWithMatch({ profileId, source, rawText, normalizedText, cardId = null, intentionType = null }) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const beacon = insertBeacon({ profileId, source, rawText, normalizedText, cardId, intentionType });
    const { match, introduction } = trySynchronicityMatch(beacon);
    db.exec('COMMIT');
    return { beacon: getBeacon(beacon.id), match, introduction };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---------- guide sessions ----------

function toGuideSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    profileId: row.profile_id,
    requestText: row.request_text,
    parsed: parseJson(row.parsed_json, {}),
    answers: parseJson(row.answers_json, {}),
    status: row.status,
    createdAt: row.created_at,
  };
}

export function createGuideSession({ profileId, requestText, parsed }) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO guide_sessions (profile_id, request_text, parsed_json, answers_json, status, created_at)
    VALUES (?, ?, ?, '{}', 'open', ?)
  `).run(profileId, requestText, JSON.stringify(parsed || {}), now);
  return getGuideSession(Number(result.lastInsertRowid));
}

export function getGuideSession(id) {
  return toGuideSession(db.prepare('SELECT * FROM guide_sessions WHERE id = ?').get(id));
}

export function updateGuideSession(id, { answers, status }) {
  const existing = getGuideSession(id);
  if (!existing) return null;
  const next = {
    answers: answers !== undefined ? answers : existing.answers,
    status: status !== undefined ? status : existing.status,
  };
  db.prepare('UPDATE guide_sessions SET answers_json = ?, status = ? WHERE id = ?')
    .run(JSON.stringify(next.answers), next.status, id);
  return getGuideSession(id);
}

// ---------- chat sessions (conversational guide UI) ----------

function toChatSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    profileId: row.profile_id ?? null,
    guideSessionId: row.guide_session_id ?? null,
    briefId: row.brief_id ?? null,
    stage: row.stage || 'start',
    pendingQuestionId: row.pending_question_id || null,
    pendingField: row.pending_field || null,
    transcript: parseJson(row.transcript_json, []),
    onboarding: parseJson(row.onboarding_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const getChatSessionStmt = db.prepare('SELECT * FROM chat_sessions WHERE id = ?');
export function getChatSession(id) {
  return toChatSession(getChatSessionStmt.get(id));
}

/**
 * Create a chat session. Optional extras: guideSessionId, briefId,
 * pendingQuestionId, pendingField, an initial transcript array, and the
 * in-progress onboarding answers. profileId may be null for onboarding
 * sessions that have not created a profile yet.
 */
export function createChatSession({ profileId = null, stage = 'start', guideSessionId = null,
  briefId = null, pendingQuestionId = null, pendingField = null, transcript = [],
  onboarding = {} }) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO chat_sessions
      (profile_id, guide_session_id, brief_id, stage, pending_question_id,
       pending_field, transcript_json, onboarding_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(profileId, guideSessionId, briefId, stage, pendingQuestionId, pendingField,
    JSON.stringify(transcript), JSON.stringify(onboarding || {}), now, now);
  return getChatSession(Number(result.lastInsertRowid));
}

/**
 * Partial update. patch keys: profileId, guideSessionId, briefId, stage,
 * pendingQuestionId, pendingField, transcript (array -> stored as JSON),
 * onboarding (object -> stored as JSON). updated_at always moves.
 */
export function updateChatSession(id, patch = {}) {
  const existing = getChatSession(id);
  if (!existing) return null;
  const cols = [];
  const params = [];
  if (patch.profileId !== undefined) { cols.push('profile_id = ?'); params.push(patch.profileId); }
  if (patch.guideSessionId !== undefined) { cols.push('guide_session_id = ?'); params.push(patch.guideSessionId); }
  if (patch.briefId !== undefined) { cols.push('brief_id = ?'); params.push(patch.briefId); }
  if (patch.stage !== undefined) { cols.push('stage = ?'); params.push(patch.stage); }
  if (patch.pendingQuestionId !== undefined) { cols.push('pending_question_id = ?'); params.push(patch.pendingQuestionId); }
  if (patch.pendingField !== undefined) { cols.push('pending_field = ?'); params.push(patch.pendingField); }
  if (patch.transcript !== undefined) { cols.push('transcript_json = ?'); params.push(JSON.stringify(patch.transcript)); }
  if (patch.onboarding !== undefined) { cols.push('onboarding_json = ?'); params.push(JSON.stringify(patch.onboarding || {})); }
  cols.push('updated_at = ?');
  params.push(new Date().toISOString());
  db.prepare(`UPDATE chat_sessions SET ${cols.join(', ')} WHERE id = ?`).run(...params, id);
  return getChatSession(id);
}

// ---------- connection briefs ----------

const BRIEF_FIELDS = [
  'who_text', 'intention_text', 'good_fit_text', 'offer_text',
  'logistics_text', 'boundaries_text', 'private_notes', 'shared_text',
];

const getBriefByIdStmt = db.prepare('SELECT * FROM briefs WHERE id = ?');
export function getBrief(id) {
  return toBrief(getBriefByIdStmt.get(id));
}

const getBriefByProfileStmt = db.prepare('SELECT * FROM briefs WHERE profile_id = ?');
export function getBriefByProfile(profileId) {
  return toBrief(getBriefByProfileStmt.get(profileId));
}

/** Create or replace the profile's draft brief from generated draft fields. */
export function upsertDraftBrief(profileId, draft) {
  const now = new Date().toISOString();
  const existing = getBriefByProfile(profileId);
  const cols = BRIEF_FIELDS.map((f) => String(draft[f] ?? '').trim());
  if (existing) {
    db.prepare(`
      UPDATE briefs
      SET ${BRIEF_FIELDS.map((f) => `${f} = ?`).join(', ')},
          consent_save = 0, consent_share = 0, status = 'draft', updated_at = ?
      WHERE id = ?
    `).run(...cols, now, existing.id);
    return getBrief(existing.id);
  }
  const result = db.prepare(`
    INSERT INTO briefs
      (profile_id, ${BRIEF_FIELDS.join(', ')}, consent_save, consent_share, status, created_at, updated_at)
    VALUES (?, ${BRIEF_FIELDS.map(() => '?').join(', ')}, 0, 0, 'draft', ?, ?)
  `).run(profileId, ...cols, now, now);
  return getBrief(Number(result.lastInsertRowid));
}

/** Owner edits to a draft/active brief. Returns the updated brief or null. */
export function updateBrief(id, fields) {
  const existing = getBrief(id);
  if (!existing) return null;
  const sets = [];
  const params = [];
  for (const f of BRIEF_FIELDS) {
    if (fields[f] !== undefined) {
      if (typeof fields[f] !== 'string') return null;
      sets.push(`${f} = ?`);
      params.push(fields[f].trim());
    }
  }
  if (sets.length === 0) return existing;
  sets.push('updated_at = ?');
  params.push(new Date().toISOString());
  db.prepare(`UPDATE briefs SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  return getBrief(id);
}

/** Approve a brief: sets it active with explicit consent flags. */
export function approveBrief(id, { sharedText, consentShare }) {
  db.prepare(`
    UPDATE briefs
    SET shared_text = ?, consent_save = 1, consent_share = ?, status = 'active', updated_at = ?
    WHERE id = ?
  `).run(sharedText.trim(), consentShare ? 1 : 0, new Date().toISOString(), id);
  return getBrief(id);
}

export function setBriefStatus(id, status) {
  db.prepare('UPDATE briefs SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, new Date().toISOString(), id);
  return getBrief(id);
}

// ---------- messages ----------

export function listMessages(introductionId) {
  const rows = db.prepare(`
    SELECT m.*, p.name AS sender_name FROM messages m
    JOIN profiles p ON p.id = m.sender_id
    WHERE m.introduction_id = ? ORDER BY m.id ASC
  `).all(introductionId);
  return rows.map((r) => ({
    id: r.id,
    introductionId: r.introduction_id,
    senderId: r.sender_id,
    senderName: r.sender_name,
    body: r.body,
    createdAt: r.created_at,
  }));
}

export function createMessage({ introductionId, senderId, body }) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO messages (introduction_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)
  `).run(introductionId, senderId, body.trim(), now);
  return {
    id: Number(result.lastInsertRowid),
    introductionId,
    senderId,
    body: body.trim(),
    createdAt: now,
  };
}

// ---------- connection plans ----------

export function getConnectionPlan(introductionId) {
  const row = db.prepare('SELECT * FROM connection_plans WHERE introduction_id = ? ORDER BY id DESC LIMIT 1')
    .get(introductionId);
  if (!row) return null;
  return {
    id: row.id,
    introductionId: row.introduction_id,
    format: row.format,
    timeText: row.time_text,
    expectations: row.expectations,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function upsertConnectionPlan({ introductionId, format, timeText, expectations, createdBy }) {
  const now = new Date().toISOString();
  const existing = getConnectionPlan(introductionId);
  if (existing) {
    db.prepare(`
      UPDATE connection_plans SET format = ?, time_text = ?, expectations = ?, created_by = ?, updated_at = ?
      WHERE id = ?
    `).run(format, timeText, expectations, createdBy, now, existing.id);
    return getConnectionPlan(introductionId);
  }
  const result = db.prepare(`
    INSERT INTO connection_plans (introduction_id, format, time_text, expectations, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(introductionId, format, timeText, expectations, createdBy, now, now);
  return getConnectionPlan(introductionId);
}

// ---------- circles ----------

export function createCircle({ name, kind, purpose, privacy, maxParticipants, schedule, agreements, region, createdBy }) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO circles (name, kind, purpose, privacy, max_participants, schedule, agreements, region, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name.trim(), kind, purpose.trim(), privacy, maxParticipants, (schedule || '').trim(),
    (agreements || '').trim(), (region || '').trim(), createdBy, now, now);
  const circleId = Number(result.lastInsertRowid);
  db.prepare('INSERT INTO circle_members (circle_id, profile_id, role, joined_at) VALUES (?, ?, ?, ?)')
    .run(circleId, createdBy, 'host', now);
  return getCircle(circleId, createdBy);
}

export function getCircle(id, viewerId = null) {
  const row = db.prepare('SELECT * FROM circles WHERE id = ?').get(id);
  if (!row) return null;
  const memberCount = db.prepare('SELECT COUNT(*) AS c FROM circle_members WHERE circle_id = ?').get(id).c;
  const hostName = db.prepare('SELECT name FROM profiles WHERE id = ?').get(row.created_by)?.name || '';
  const isMember = viewerId
    ? !!db.prepare('SELECT 1 FROM circle_members WHERE circle_id = ? AND profile_id = ?').get(id, viewerId)
    : false;
  return toCircle(row, memberCount, isMember, hostName);
}

export function listCircles({ kind = null, viewerId = null } = {}) {
  let rows;
  if (kind) {
    rows = db.prepare(`SELECT * FROM circles WHERE kind = ? AND privacy != 'invite-only' ORDER BY id DESC`).all(kind);
  } else {
    rows = db.prepare(`SELECT * FROM circles WHERE privacy != 'invite-only' ORDER BY id DESC`).all();
  }
  return rows.map((r) => getCircle(r.id, viewerId));
}

export function listMyCircles(profileId) {
  const rows = db.prepare(`
    SELECT c.* FROM circles c JOIN circle_members m ON m.circle_id = c.id
    WHERE m.profile_id = ? ORDER BY c.id DESC
  `).all(profileId);
  return rows.map((r) => getCircle(r.id, profileId));
}

export function listCircleMembers(circleId) {
  return db.prepare(`
    SELECT p.id, p.name, m.role FROM circle_members m
    JOIN profiles p ON p.id = m.profile_id
    WHERE m.circle_id = ? ORDER BY m.role DESC, m.joined_at ASC
  `).all(circleId);
}

export function joinCircle(circleId, profileId) {
  const circle = getCircle(circleId);
  if (!circle) return { ok: false, reason: 'not_found' };
  const count = db.prepare('SELECT COUNT(*) AS c FROM circle_members WHERE circle_id = ?').get(circleId).c;
  if (count >= circle.maxParticipants) return { ok: false, reason: 'full' };
  if (circle.privacy === 'invite-only') return { ok: false, reason: 'invite_only' };
  if (circle.privacy === 'request-to-join') return { ok: false, reason: 'needs_request' };
  db.prepare('INSERT OR IGNORE INTO circle_members (circle_id, profile_id, role, joined_at) VALUES (?, ?, ?, ?)')
    .run(circleId, profileId, 'member', new Date().toISOString());
  return { ok: true };
}

export function requestCircleJoin(circleId, profileId, message = '') {
  const existing = db.prepare(`
    SELECT * FROM circle_requests WHERE circle_id = ? AND profile_id = ? AND status = 'proposed' LIMIT 1
  `).get(circleId, profileId);
  if (existing) return { ok: false, reason: 'already_requested' };
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO circle_requests (circle_id, profile_id, message, status, created_at, updated_at)
    VALUES (?, ?, ?, 'proposed', ?, ?)
  `).run(circleId, profileId, message.trim(), now, now);
  return { ok: true, id: Number(result.lastInsertRowid) };
}

export function listCircleRequests(circleId) {
  return db.prepare(`
    SELECT r.*, p.name AS profile_name FROM circle_requests r
    JOIN profiles p ON p.id = r.profile_id
    WHERE r.circle_id = ? ORDER BY r.id DESC
  `).all(circleId).map((r) => ({
    id: r.id,
    circleId: r.circle_id,
    profileId: r.profile_id,
    profileName: r.profile_name,
    message: r.message,
    status: r.status,
    createdAt: r.created_at,
  }));
}

export function setCircleRequestStatus(requestId, status) {
  const req = db.prepare('SELECT * FROM circle_requests WHERE id = ?').get(requestId);
  if (!req || req.status !== 'proposed') return null;
  db.prepare('UPDATE circle_requests SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, new Date().toISOString(), requestId);
  if (status === 'approved') {
    db.prepare('INSERT OR IGNORE INTO circle_members (circle_id, profile_id, role, joined_at) VALUES (?, ?, ?, ?)')
      .run(req.circle_id, req.profile_id, 'member', new Date().toISOString());
  }
  return { ...req, status };
}

export function getCircleRequest(requestId) {
  return db.prepare('SELECT * FROM circle_requests WHERE id = ?').get(requestId);
}

// ---------- seeding ----------

const SEED_MEMBERS = [
  {
    name: 'Maya Chen',
    email: 'maya.demo@seren.example',
    interests: ['meditation', 'breathwork', 'yoga', 'journaling'],
    intention: 'I want to find a daily meditation partner so we can hold each other accountable and deepen our practice together.',
    connectionPrefs: { seeking: ['practice-partner', 'friendship'], availability: 'Mornings before work' },
    consents: { introductions: true, community_visible: true, ai_matching: true },
    pronouns: 'she/her', region: 'Boston, MA',
    about: 'Morning meditator, tea lover, and firm believer in small daily rituals.',
    visualIdentity: 'grounded',
    intentions: ['meditation-partner', 'accountability-partner', 'meaningful-friendship'],
    practices: ['meditation', 'breathwork', 'yoga', 'journaling'],
    prefs: { localRemote: 'either', formats: ['message', 'video'], availability: 'Mornings before work', languages: ['English'] },
  },
  {
    name: 'Elena Vargas',
    email: 'elena.demo@seren.example',
    interests: ['tarot', 'astrology', 'dreamwork', 'numerology'],
    intention: 'I am exploring my dreams and birth chart and would love thoughtful conversation with fellow seekers of hidden patterns.',
    connectionPrefs: { seeking: ['friendship', 'collaboration'], availability: 'Evenings and weekends' },
    consents: { introductions: true, community_visible: true, ai_matching: true },
    pronouns: 'she/her', region: 'Providence, RI',
    about: 'Dream journal keeper and chart enthusiast. I love slow, symbolic conversations.',
    visualIdentity: 'celestial',
    intentions: ['dreamwork-symbolism', 'astrology-discussion', 'meaningful-friendship'],
    practices: ['dreamwork', 'tarot', 'astrology'],
    prefs: { localRemote: 'remote', formats: ['message', 'voice'], availability: 'Evenings and weekends', languages: ['English', 'Spanish'] },
  },
  {
    name: 'Kai Nakamura',
    email: 'kai.demo@seren.example',
    interests: ['reiki', 'sound-healing', 'shamanism', 'crystals'],
    intention: 'As a reiki practitioner I hope to trade healing sessions and learn new modalities from generous-hearted healers.',
    connectionPrefs: { seeking: ['practice-partner', 'collaboration'], availability: 'Flexible afternoons' },
    consents: { introductions: true, community_visible: true, ai_matching: true },
    pronouns: 'he/him', region: 'Portland, OR',
    about: 'Reiki practitioner and sound bath host. I trade sessions and love learning.',
    visualIdentity: 'warm',
    intentions: ['energy-work-discussion', 'creative-collaboration'],
    practices: ['reiki', 'energy-healing', 'ritual-ceremony'],
    prefs: { localRemote: 'either', formats: ['video', 'in-person'], availability: 'Flexible afternoons', languages: ['English'] },
  },
  {
    name: 'Luna Okafor',
    email: 'luna.demo@seren.example',
    interests: ['astrology', 'tarot', 'crystals', 'meditation'],
    intention: 'I am seeking guidance on a life transition and would love a mentor who reads charts and cards with kindness.',
    connectionPrefs: { seeking: ['guidance', 'friendship'], availability: 'Sunday afternoons' },
    consents: { introductions: true, community_visible: true, ai_matching: true },
    pronouns: 'she/they', region: 'Brooklyn, NY',
    about: 'In a season of change. I read cards for friends and love honest reflection.',
    visualIdentity: 'celestial',
    intentions: ['mentorship-learning', 'tarot-oracle-exchange', 'astrology-discussion'],
    practices: ['astrology', 'tarot', 'meditation', 'journaling'],
    prefs: { localRemote: 'remote', formats: ['message', 'video'], availability: 'Sunday afternoons', languages: ['English'] },
  },
  {
    name: 'River Santos',
    email: 'river.demo@seren.example',
    interests: ['breathwork', 'shamanism', 'dreamwork', 'yoga'],
    intention: 'I want to build a small circle that meets monthly for breathwork journeys and dream sharing in the Boston area.',
    connectionPrefs: { seeking: ['collaboration', 'practice-partner'], availability: 'Monthly, first Saturdays' },
    consents: { introductions: true, community_visible: true, ai_matching: true },
    pronouns: 'they/them', region: 'Boston, MA',
    about: 'Breathwork facilitator in training. I hold monthly journeys and love the ocean.',
    visualIdentity: 'oceanic',
    intentions: ['breathwork-somatic', 'local-gathering', 'dreamwork-symbolism'],
    practices: ['breathwork', 'dreamwork', 'yoga', 'ocean-water-practices'],
    prefs: { localRemote: 'local', formats: ['in-person', 'group'], availability: 'Monthly, first Saturdays', languages: ['English', 'Portuguese'] },
  },
  {
    name: 'Amara Diallo',
    email: 'amara.demo@seren.example',
    interests: ['journaling', 'numerology', 'sound-healing', 'reiki'],
    intention: 'I keep a spiritual journal and track synchronicities; I would love a reflective friend to compare notes and grow with.',
    connectionPrefs: { seeking: ['friendship', 'guidance'], availability: 'Weekday evenings' },
    consents: { introductions: true, community_visible: true, ai_matching: true },
    pronouns: 'she/her', region: 'Cambridge, MA',
    about: 'Synchronicity tracker and reflective writer. Slow conversations are my favorite.',
    visualIdentity: 'minimal',
    intentions: ['meaningful-friendship', 'spiritual-peer-connection'],
    practices: ['journaling', 'meditation', 'philosophy'],
    prefs: { localRemote: 'either', formats: ['message'], availability: 'Weekday evenings', languages: ['English', 'French'] },
  },
];

function profileCount() {
  // The id-0 SEREN connector sentinel is not a member.
  return db.prepare('SELECT COUNT(*) AS c FROM profiles WHERE id > 0').get().c;
}

function seedProfileCount() {
  return db.prepare('SELECT COUNT(*) AS c FROM profiles WHERE is_seed = 1').get().c;
}

// Seed once, only when the profiles table is empty and seeding is enabled.
export let seeded = false;
if (profileCount() === 0 && process.env.SEED_DEMO !== 'false') {
  db.exec('BEGIN');
  try {
    for (const m of SEED_MEMBERS) {
      createProfile({ ...m, isSeed: true });
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  seeded = true;
}

/** True when the DB currently holds any demo seed members (for /api/health). */
export function hasSeedProfiles() {
  return seedProfileCount() > 0;
}
