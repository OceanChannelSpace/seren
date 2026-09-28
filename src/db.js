// SEREN — SQLite persistence (node:sqlite, DatabaseSync).
// Wire format is camelCase; DB columns are snake_case. Conversions happen here.
//
// Schema evolves through additive migrations guarded by PRAGMA user_version.
// v0: MVP tables (profiles, introductions).
// v1: profile extensions, staged-consent columns on introductions, and new
//     tables: circles, circle_members, circle_requests, blocks, reports,
//     saved_items, passes, messages, connection_plans.

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { INTRO_STATUS } from './constants.js';

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

// v2: guide sessions for the AI-superconnector flow + profile values.
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
    prefs,
    consentSettings,
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
    connectionType: row.connection_type || '',
    requestMessage: row.request_message || '',
    format: row.format || '',
    commitment: row.commitment || '',
    tone: row.tone || '',
    responderNote: row.responder_note || '',
    responseKind: row.response_kind || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

export function createProfile({
  name, email, interests, intention, connectionPrefs, consents, isSeed = false,
  pronouns = '', region = '', photoUrl = '', about = '', visualIdentity = 'minimal',
  intentions = [], intentionsOther = '', practices = [], practicesOther = '',
  prefs = {}, consentSettings = {},
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
       practices, practices_other, prefs, consent_settings, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    name.trim(),
    String(email).trim().toLowerCase(),
    JSON.stringify(interests),
    intention.trim(),
    JSON.stringify({ seeking: connectionPrefs?.seeking ?? [], availability: connectionPrefs?.availability ?? '' }),
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
    const next = {
      seeking: fields.connectionPrefs.seeking ?? prev.seeking ?? [],
      availability: fields.connectionPrefs.availability ?? prev.availability ?? '',
    };
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
 * - Paused / discovery disabled and no mutual connection: minimal (id, name).
 * - Otherwise: fields gated by the target's consent_settings.
 * Email is never exposed to other members.
 */
export function getVisibleProfile(id, viewerId) {
  const p = getProfile(id);
  if (!p) return null;
  const vid = Number(viewerId);
  if (vid === p.id) return p; // own profile: everything

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
  }
  if (cs.showRegion || mutual) view.region = p.region;
  if (cs.showPhoto || mutual) view.photoUrl = p.photoUrl;
  if (mutual) {
    view.intention = p.intention;
    view.prefs = { localRemote: p.prefs.localRemote, formats: p.prefs.formats, languages: p.prefs.languages };
  }
  view.mutual = mutual;
  return view;
}

// ---------- introduction helpers ----------

const getIntroductionStmt = db.prepare('SELECT * FROM introductions WHERE id = ?');
export function getIntroduction(id) {
  return toIntroduction(getIntroductionStmt.get(id));
}

export function createIntroduction({ requesterId, proposedId, intention, note, score,
  connectionType = '', requestMessage = '', format = '', commitment = '', tone = '' }) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO introductions
      (requester_id, proposed_id, intention, note, score, status,
       connection_type, request_message, format, commitment, tone,
       created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  return db.prepare('SELECT COUNT(*) AS c FROM profiles').get().c;
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
