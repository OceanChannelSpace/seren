// SEREN MVP — SQLite persistence (node:sqlite, DatabaseSync).
// Wire format is camelCase; DB columns are snake_case. Conversions happen here.

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { INTRO_STATUS } from './constants.js';

const DB_PATH = resolve(process.env.DB_PATH || './data/seren.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');

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

// ---------- row <-> wire conversions ----------

function toProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    interests: JSON.parse(row.interests),
    intention: row.intention,
    connectionPrefs: JSON.parse(row.connection_prefs),
    consents: JSON.parse(row.consents),
    isSeed: row.is_seed === 1,
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

export function listPublicProfiles() {
  const rows = db.prepare('SELECT * FROM profiles ORDER BY id ASC').all();
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

/** Full profiles, for matching candidates (includes consents + intention). */
export function listCandidateProfiles() {
  const rows = db.prepare('SELECT * FROM profiles ORDER BY id ASC').all();
  return rows.map(toProfile);
}

export function createProfile({ name, email, interests, intention, connectionPrefs, consents, isSeed = false }) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO profiles (name, email, interests, intention, connection_prefs, consents, is_seed, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    name.trim(),
    String(email).trim().toLowerCase(),
    JSON.stringify(interests),
    intention.trim(),
    JSON.stringify({ seeking: connectionPrefs?.seeking ?? [], availability: connectionPrefs?.availability ?? '' }),
    JSON.stringify(consents),
    isSeed ? 1 : 0,
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

  if (fields.name !== undefined) {
    sets.push('name = ?');
    params.push(String(fields.name).trim());
  }
  if (fields.email !== undefined) {
    sets.push('email = ?');
    params.push(String(fields.email).trim().toLowerCase());
  }
  if (fields.interests !== undefined) {
    sets.push('interests = ?');
    params.push(JSON.stringify(fields.interests));
  }
  if (fields.intention !== undefined) {
    sets.push('intention = ?');
    params.push(String(fields.intention).trim());
  }
  if (fields.connectionPrefs !== undefined) {
    const prev = existing.connectionPrefs;
    const next = {
      seeking: fields.connectionPrefs.seeking ?? prev.seeking,
      availability: fields.connectionPrefs.availability ?? prev.availability,
    };
    sets.push('connection_prefs = ?');
    params.push(JSON.stringify(next));
  }
  if (fields.consents !== undefined) {
    sets.push('consents = ?');
    params.push(JSON.stringify(fields.consents));
  }
  sets.push('updated_at = ?');
  params.push(new Date().toISOString());

  if (sets.length > 1 || params.length > 1) {
    db.prepare(`UPDATE profiles SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  }
  return getProfile(id);
}

// ---------- introduction helpers ----------

const getIntroductionStmt = db.prepare('SELECT * FROM introductions WHERE id = ?');
export function getIntroduction(id) {
  return toIntroduction(getIntroductionStmt.get(id));
}

export function createIntroduction({ requesterId, proposedId, intention, note, score }) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO introductions (requester_id, proposed_id, intention, note, score, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    requesterId,
    proposedId,
    intention.trim(),
    note,
    score,
    INTRO_STATUS.PROPOSED,
    now,
    now,
  );
  return getIntroduction(Number(result.lastInsertRowid));
}

export function setIntroductionStatus(id, status) {
  db.prepare('UPDATE introductions SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, new Date().toISOString(), id);
  return getIntroduction(id);
}

/**
 * A non-withdrawn introduction between a and b in either direction, or null.
 */
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

/** All introductions involving a profile, with names, newest first. */
export function listIntroductionsFor(profileId) {
  const rows = db.prepare(`
    SELECT i.*, rp.name AS requester_name, pp.name AS proposed_name
    FROM introductions i
    JOIN profiles rp ON rp.id = i.requester_id
    JOIN profiles pp ON pp.id = i.proposed_id
    WHERE i.requester_id = ? OR i.proposed_id = ?
    ORDER BY i.id DESC
  `).all(profileId, profileId);
  return rows.map((r) => ({
    id: r.id,
    requesterId: r.requester_id,
    proposedId: r.proposed_id,
    requesterName: r.requester_name,
    proposedName: r.proposed_name,
    intention: r.intention,
    note: r.note,
    score: r.score,
    status: r.status,
    createdAt: r.created_at,
  }));
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
  },
  {
    name: 'Elena Vargas',
    email: 'elena.demo@seren.example',
    interests: ['tarot', 'astrology', 'dreamwork', 'numerology'],
    intention: 'I am exploring my dreams and birth chart and would love thoughtful conversation with fellow seekers of hidden patterns.',
    connectionPrefs: { seeking: ['friendship', 'collaboration'], availability: 'Evenings and weekends' },
    consents: { introductions: true, community_visible: true, ai_matching: true },
  },
  {
    name: 'Kai Nakamura',
    email: 'kai.demo@seren.example',
    interests: ['reiki', 'sound-healing', 'shamanism', 'crystals'],
    intention: 'As a reiki practitioner I hope to trade healing sessions and learn new modalities from generous-hearted healers.',
    connectionPrefs: { seeking: ['practice-partner', 'collaboration'], availability: 'Flexible afternoons' },
    consents: { introductions: true, community_visible: true, ai_matching: true },
  },
  {
    name: 'Luna Okafor',
    email: 'luna.demo@seren.example',
    interests: ['astrology', 'tarot', 'crystals', 'meditation'],
    intention: 'I am seeking guidance on a life transition and would love a mentor who reads charts and cards with kindness.',
    connectionPrefs: { seeking: ['guidance', 'friendship'], availability: 'Sunday afternoons' },
    consents: { introductions: true, community_visible: true, ai_matching: true },
  },
  {
    name: 'River Santos',
    email: 'river.demo@seren.example',
    interests: ['breathwork', 'shamanism', 'dreamwork', 'yoga'],
    intention: 'I want to build a small circle that meets monthly for breathwork journeys and dream sharing in the Boston area.',
    connectionPrefs: { seeking: ['collaboration', 'practice-partner'], availability: 'Monthly, first Saturdays' },
    consents: { introductions: true, community_visible: true, ai_matching: true },
  },
  {
    name: 'Amara Diallo',
    email: 'amara.demo@seren.example',
    interests: ['journaling', 'numerology', 'sound-healing', 'reiki'],
    intention: 'I keep a spiritual journal and track synchronicities; I would love a reflective friend to compare notes and grow with.',
    connectionPrefs: { seeking: ['friendship', 'guidance'], availability: 'Weekday evenings' },
    consents: { introductions: true, community_visible: true, ai_matching: true },
  },
];

function profileCount() {
  return db.prepare('SELECT COUNT(*) AS c FROM profiles').get().c;
}

function seedProfileCount() {
  return db.prepare('SELECT COUNT(*) AS c FROM profiles WHERE is_seed = 1').get().c;
}

// Seed once, only when the profiles table is empty and seeding is enabled.
export let seeded = false;
if (profileCount() === 0 && process.env.SEED_DEMO !== 'false') {
  const insert = db.prepare(`
    INSERT INTO profiles (name, email, interests, intention, connection_prefs, consents, is_seed, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    for (const m of SEED_MEMBERS) {
      insert.run(
        m.name,
        m.email.toLowerCase(),
        JSON.stringify(m.interests),
        m.intention,
        JSON.stringify(m.connectionPrefs),
        JSON.stringify(m.consents),
        now,
        now,
      );
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
