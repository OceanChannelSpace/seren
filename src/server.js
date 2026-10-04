// SEREN — express API server.
// Endpoints, shapes, and status codes per docs/API_CONTRACT.md.

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { BRAND } from './config.js';
import {
  ERROR_CODES, VALID_TRANSITIONS, INTRO_STATUS, RESPONSE_KINDS,
  PRACTICES, PRACTICE_VALUES, INTENTIONS, CONNECTION_TYPES, CONNECTION_FORMATS, FORMAT_LABELS,
  COMMITMENT_LEVELS, COMMITMENT_LABELS, TONES, TONE_LABELS,
  CIRCLE_KINDS, CIRCLE_KIND_VALUES, CIRCLE_PRIVACY, REQUEST_TEMPLATES, EXPLORE_TOPICS,
  AGENT_VETTING_ITEMS,
} from './constants.js';
import {
  validateProfileInput, validateIntroRequest, validateConnectionRequest,
  validateRespond, validateCircleInput, validateCircleJoin,
  validateMessageInput, validateReportInput, validatePlanInput,
  validateGuideStart, validateGuideAnswer,
  validateBriefDraft, validateBriefUpdate, validateBriefApprove,
  validateChatStart, validateChatMessage, validateRelink,
  validateOnboardingStart, validateOnboardingMessage, validateAgentInput,
  validateHostAssistInput, validateHostAssistProposal, validateBeaconInput,
} from './validate.js';
import { SYNC_DECK, getSyncCard, REFLECTIVE_FRAMING, getSyncCardAnnotated } from './sync-deck.js';
import {
  startOnboarding, handleOnboardingTurn, questionForStage,
  quickRepliesForStage, isOnboardingStage,
} from './onboarding.js';
import { findBestMatch, buildIntroNote, findMatches, findAgentMatches, suggestFirstStep } from './match.js';
import {
  parseIntent, selectFollowUps, answerQuestion, buildProposals,
  remainingQuestions, getQuestionDef, buildBriefDraft, buildWarmIntroMessage,
  realLifePrompt, REAL_LIFE_PROMPT_TEXT, realLifeHandoff,
} from './guide.js';
import {
  greetingMessages, questionMessage, briefMessage, publicBrief,
  classifyReviewText, detectEditField, fieldLabel,
  matchOptions, isSkipText, STARTERS, APPROVE_QUICK_REPLIES,
  proposalsStageText, NO_SUGGESTIONS_TEXT,
} from './chat.js';
import {
  db,
  hasSeedProfiles,
  getProfile,
  getProfileByEmail,
  getProfileByTokenHash,
  hashProfileToken,
  issueProfileToken,
  getVisibleProfile,
  hasMutualConnection,
  isBlockedBetween,
  listCandidateProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  createIntroduction,
  getIntroduction,
  setIntroductionStatus,
  getNonWithdrawnPairKeys,
  listIntroductionsFor,
  recordDeclineBlock,
  hasDeclineBlock,
  removeDeclineBlock,
  addPass,
  getPassedIds,
  addSavedItem,
  removeSavedItem,
  listSavedItems,
  getSavedKeys,
  addBlock,
  removeBlock,
  listBlocks,
  createReport,
  listReports,
  getReport,
  setReportStatus,
  setProfileHidden,
  getHostAssist,
  getOpenHostAssist,
  createHostAssist,
  listHostAssistsFor,
  listOpenHostAssists,
  setHostAssistStatus,
  // synchronicity beacons (v13)
  normalizeBeaconText,
  getBeacon,
  getActiveBeacon,
  listBeaconsFor,
  withdrawActiveBeacon,
  createBeaconWithMatch,
  listBeaconMatchesFor,
  expireStaleBeacons,
  syncBeaconMatchForIntroduction,
  listMessages,
  createMessage,
  getConnectionPlan,
  upsertConnectionPlan,
  // flourishing by design (v16): check-ins, intro feedback, real-life
  // intentions, host analytics aggregates
  createFlourishingCheckins,
  listFlourishingCheckins,
  getIntroductionFeedback,
  createIntroductionFeedback,
  setIntroductionRealLifeIntention,
  completeIntroductionRealLifeIntention,
  markIntroductionMovedToRealLife,
  getFlourishingAggregates,
  // Digital Sapiens layer (v17): attention-open origins for host analytics
  recordAttentionOpen,
  getAttentionOpenAggregates,
  ATTENTION_ORIGINS,
  createCircle,
  getCircle,
  listCircles,
  listMyCircles,
  listCircleMembers,
  joinCircle,
  requestCircleJoin,
  listCircleRequests,
  setCircleRequestStatus,
  getCircleRequest,
  createGuideSession,
  getGuideSession,
  updateGuideSession,
  createChatSession,
  getChatSession,
  updateChatSession,
  getBrief,
  getBriefByProfile,
  upsertDraftBrief,
  updateBrief,
  approveBrief,
  setBriefStatus,
  getAgent,
  listAgents,
  createAgent,
  updateAgent,
  hideAgent,
  setAgentReviewed,
} from './db.js';

export const app = express();
app.use(express.json({ limit: '256kb' }));

// ---------- private beta gate ----------
// When BETA_CODE is set (non-empty), every /api/* route except the health
// check and the beta endpoints themselves requires a valid beta cookie.
// The static app shell stays servable — the frontend renders a code-entry
// gate when locked. (The repo is public, so hiding the JS buys nothing;
// the API data is the protected asset.)
const BETA_CODE = (process.env.BETA_CODE || '').trim();
const BETA_MODE = BETA_CODE.length > 0;
const BETA_COOKIE = 'seren_beta';
const betaTokens = new Set(); // issued tokens; cleared on restart (re-entry is cheap)

// Host role: a minimal, env-configured list of member emails whose profiles
// carry host (moderation) privileges. Token-bound identity still applies — a
// host is the token-authenticated profile whose email is on this list.
const SEREN_HOSTS = new Set(
  (process.env.SEREN_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
);
function isHostEmail(email) {
  return SEREN_HOSTS.has(String(email || '').trim().toLowerCase());
}

function sha256(s) {
  return createHash('sha256').update(s, 'utf8').digest();
}

function betaCodeMatches(provided) {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = sha256(provided.trim());
  const b = sha256(BETA_CODE);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readBetaCookie(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === BETA_COOKIE) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

function hasBetaAccess(req) {
  if (!BETA_MODE) return true;
  const token = readBetaCookie(req);
  return token !== null && betaTokens.has(token);
}

const BETA_OPEN_PATHS = new Set(['/api/health', '/api/beta/status', '/api/beta/enter']);

app.use((req, res, next) => {
  if (!BETA_MODE) return next();
  if (BETA_OPEN_PATHS.has(req.path)) return next();
  if (hasBetaAccess(req)) return next();
  if (req.path.startsWith('/api/')) {
    return err(res, 403, ERROR_CODES.BETA_REQUIRED,
      'SEREN is in private beta. Enter your beta invite code to continue.');
  }
  return next(); // app shell loads; frontend shows the code gate
});

app.get('/api/beta/status', (req, res) => {
  res.json({ beta: BETA_MODE, entered: hasBetaAccess(req) });
});

app.post('/api/beta/enter', (req, res) => {
  if (!BETA_MODE) return res.json({ entered: true });
  const code = req.body && req.body.code;
  if (!betaCodeMatches(code)) {
    return err(res, 403, ERROR_CODES.BETA_CODE_INVALID,
      'That beta code did not match. Check it and try again.');
  }
  const token = randomBytes(32).toString('hex');
  betaTokens.add(token);
  res.setHeader('Set-Cookie',
    `${BETA_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=31536000`);
  return res.json({ entered: true });
});

// ---------- helpers ----------

function err(res, status, code, message, extra) {
  const payload = { error: { code, message } };
  if (extra !== undefined) payload.error.details = extra;
  return res.status(status).json(payload);
}

function validationErr(res, errors) {
  return err(res, 400, ERROR_CODES.VALIDATION_ERROR, 'The request failed validation.', errors);
}

function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toWireIntroduction(intro) {
  if (!intro) return null;
  return {
    id: intro.id,
    requesterId: intro.requesterId,
    proposedId: intro.proposedId,
    intention: intro.intention,
    note: intro.note,
    score: intro.score,
    status: intro.status,
    connectionType: intro.connectionType,
    requestMessage: intro.requestMessage,
    format: intro.format,
    commitment: intro.commitment,
    tone: intro.tone,
    responderNote: intro.responderNote,
    responseKind: intro.responseKind,
    requesterSharedText: intro.requesterSharedText || '',
    // v16 ("Flourishing by Design"): member-declared offline intent.
    realLifeIntention: intro.realLifeIntention || '',
    intentionCompleted: intro.intentionCompleted === true,
    // Digital Sapiens layer: member-declared "moved to real life".
    movedToRealLife: intro.movedToRealLife === true,
    createdAt: intro.createdAt,
    updatedAt: intro.updatedAt,
  };
}

// The db helper already returns camelCase; the host queue adds askerName.
function toWireHostAssist(assist) {
  if (!assist) return null;
  const wire = {
    id: assist.id,
    profileId: assist.profileId,
    requestText: assist.requestText,
    status: assist.status,
    createdAt: assist.createdAt,
  };
  if (assist.askerName) wire.askerName = assist.askerName;
  return wire;
}

// ---------- profile session tokens ----------
// Server-issued, per-profile bearer tokens. The plaintext token lives only
// in the member's HttpOnly cookie (or an Authorization header for tooling);
// the DB stores only its SHA-256 hash. Member-endpoint identity comes
// EXCLUSIVELY from this token — a caller-supplied profileId is never trusted
// for identity (it may still appear as a *target* id, e.g. "view profile 7").
const PROFILE_COOKIE = 'seren_profile';

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      try { return decodeURIComponent(part.slice(idx + 1).trim()); }
      catch { return part.slice(idx + 1).trim(); }
    }
  }
  return null;
}

/** Bearer token from the HttpOnly cookie, else an Authorization header. */
function readAuthToken(req) {
  const fromCookie = readCookie(req, PROFILE_COOKIE);
  if (fromCookie) return fromCookie;
  const h = req.headers.authorization;
  if (typeof h === 'string') {
    const m = /^Bearer\s+(.+)$/i.exec(h.trim());
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}

function setProfileCookie(req, res, token) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie',
    `${PROFILE_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=31536000${secure ? '; Secure' : ''}`);
}

/**
 * Identity for member endpoints: resolve the caller from their session
 * token. 401 when the token is missing or invalid — never data.
 */
function requireProfile(req, res) {
  const token = readAuthToken(req);
  if (!token) {
    err(res, 401, ERROR_CODES.UNAUTHORIZED, 'Sign in to continue.');
    return null;
  }
  const profile = getProfileByTokenHash(hashProfileToken(token));
  if (!profile) {
    err(res, 401, ERROR_CODES.UNAUTHORIZED, 'Sign in to continue.');
    return null;
  }
  return profile;
}

/**
 * Guard for host-only actions: the caller must be token-authenticated AND
 * their profile email must be on the SEREN_HOSTS list.
 * Returns the profile or sends an error and returns null.
 */
function requireHost(req, res) {
  const profile = requireProfile(req, res);
  if (!profile) return null;
  if (!isHostEmail(profile.email)) {
    err(res, 403, ERROR_CODES.FORBIDDEN, 'Host access required.');
    return null;
  }
  return profile;
}

/**
 * Guard for acting on an introduction: the caller must be a participant.
 * Returns the introduction or sends an error and returns null.
 */
function requireParticipant(req, res, intro, profileId) {
  if (!intro) {
    err(res, 404, ERROR_CODES.NOT_FOUND, 'Introduction not found.');
    return null;
  }
  if (intro.requesterId !== profileId && intro.proposedId !== profileId) {
    err(res, 403, ERROR_CODES.FORBIDDEN, 'This introduction does not involve your profile.');
    return null;
  }
  return intro;
}

// ---------- v16: flourishing consent settings ----------
// `recFrequency` and `quietHours` extend consentSettings but are validated
// here, not in src/validate.js: the legacy whitelist there only accepts
// boolean keys, and this workstream may not touch that file. The keys are
// stripped from the body before validateProfileInput runs and restored
// before createProfile/updateProfile persists them, so the legacy
// "unknown consent setting" check never fires for keys we validated.

const REC_FREQUENCIES = ['daily', 'weekly', 'paused'];

function isValidQuietTime(value) {
  return typeof value === 'string' && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
}

/**
 * Validate the v16 consent-settings keys. Returns {ok, errors, stash}.
 * When ok, `stash` holds the validated keys — removed from
 * body.consentSettings so validateProfileInput doesn't reject them —
 * and must be restored with restoreFlourishingConsentSettings before
 * the profile is persisted.
 */
function extractFlourishingConsentSettings(body) {
  const stash = {};
  const errors = [];
  const push = (field, message) => errors.push({ field, message });
  const cs = body && body.consentSettings;
  if (cs === undefined || cs === null) return { ok: true, errors, stash };
  if (typeof cs !== 'object' || Array.isArray(cs)) return { ok: true, errors, stash }; // legacy validator reports this
  if (cs.recFrequency !== undefined) {
    if (!REC_FREQUENCIES.includes(cs.recFrequency)) {
      push('consentSettings.recFrequency',
        `consentSettings.recFrequency must be one of: ${REC_FREQUENCIES.join(', ')}`);
    } else {
      stash.recFrequency = cs.recFrequency;
      delete cs.recFrequency;
    }
  }
  if (cs.quietHours !== undefined) {
    if (cs.quietHours === null) {
      // null clears quiet hours.
      stash.quietHours = null;
      delete cs.quietHours;
    } else {
      const q = cs.quietHours;
      const validShape = q !== null && typeof q === 'object' && !Array.isArray(q)
        && isValidQuietTime(q.start) && isValidQuietTime(q.end);
      if (!validShape) {
        push('consentSettings.quietHours',
          'consentSettings.quietHours must be {start:"HH:MM", end:"HH:MM"} (24h)');
      } else {
        stash.quietHours = { start: q.start, end: q.end };
        delete cs.quietHours;
      }
    }
  }
  return { ok: errors.length === 0, errors, stash };
}

function restoreFlourishingConsentSettings(body, stash) {
  if (!body || Object.keys(stash).length === 0) return;
  if (body.consentSettings === undefined || body.consentSettings === null) {
    body.consentSettings = {};
  }
  Object.assign(body.consentSettings, stash);
}

// ---------- routes ----------

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', seeded: hasSeedProfiles() });
});

// --- product metadata (taxonomies for the frontend) ---

app.get('/api/meta', (req, res) => {
  res.json({
    brand: { name: BRAND.name, tagline: BRAND.tagline },
    practices: PRACTICES,
    intentions: INTENTIONS,
    connectionTypes: CONNECTION_TYPES,
    connectionFormats: CONNECTION_FORMATS.map((v) => ({ value: v, label: FORMAT_LABELS[v] })),
    commitmentLevels: COMMITMENT_LEVELS.map((v) => ({ value: v, label: COMMITMENT_LABELS[v] })),
    tones: TONES.map((v) => ({ value: v, label: TONE_LABELS[v] })),
    circleKinds: CIRCLE_KINDS,
    circlePrivacy: CIRCLE_PRIVACY,
    requestTemplates: REQUEST_TEMPLATES,
    exploreTopics: EXPLORE_TOPICS,
    responseKinds: RESPONSE_KINDS,
    supportNote: BRAND.supportNote,
    agentVetting: AGENT_VETTING_ITEMS,
  });
});

// --- session ---

// The caller's own session: full owner-view profile plus whether this
// profile is a host. The host list itself is never exposed; non-hosts just
// see isHost: false.
app.get('/api/me', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const view = getVisibleProfile(profile.id, profile.id) || {};
  res.json({ ...view, isHost: isHostEmail(profile.email) });
});

// --- profiles ---

app.post('/api/profiles', (req, res) => {
  const flourishing = extractFlourishingConsentSettings(req.body);
  if (!flourishing.ok) return validationErr(res, flourishing.errors);
  const { ok, errors } = validateProfileInput(req.body, { isUpdate: false });
  if (!ok) return validationErr(res, errors);
  restoreFlourishingConsentSettings(req.body, flourishing.stash);

  const email = String(req.body.email).trim().toLowerCase();
  if (getProfileByEmail(email)) {
    return err(res, 409, ERROR_CODES.EMAIL_TAKEN, 'A profile with this email already exists.');
  }

  try {
    const profile = createProfile(req.body);
    // Issue the member's session token: plaintext goes out only in the
    // HttpOnly cookie; only its hash is stored.
    setProfileCookie(req, res, issueProfileToken(profile.id));
    return res.status(201).json(profile);
  } catch (e) {
    // Belt-and-suspenders: UNIQUE constraint race on email.
    if (String(e?.message).includes('UNIQUE')) {
      return err(res, 409, ERROR_CODES.EMAIL_TAKEN, 'A profile with this email already exists.');
    }
    throw e;
  }
});

app.get('/api/profiles', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  // Every entry goes through the same privacy filter as the detail
  // endpoint — notably, free-text intention is gated to mutual connections.
  const ids = db.prepare('SELECT id FROM profiles WHERE id > 0 AND is_hidden = 0 ORDER BY id ASC')
    .all().map((r) => r.id);
  res.json({ profiles: ids.map((id) => getVisibleProfile(id, profile.id)) });
});

app.get('/api/profiles/:id', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const id = parseId(req.params.id);
  const target = id === null ? null : getProfile(id);
  if (!target) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Profile not found.');
  // The viewer is the token-authenticated caller — never a query param.
  // Owner view (full row incl. email) applies only when the token says so.
  res.json(getVisibleProfile(id, profile.id));
});

app.patch('/api/profiles/:id', (req, res) => {
  const authed = requireProfile(req, res);
  if (!authed) return;
  const id = parseId(req.params.id);
  if (id === null) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Profile not found.');
  const existing = getProfile(id);
  if (!existing) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Profile not found.');
  if (authed.id !== id) {
    return err(res, 403, ERROR_CODES.FORBIDDEN, 'You can only edit your own profile.');
  }

  // v16: strip recFrequency/quietHours before the legacy whitelist check.
  const flourishing = extractFlourishingConsentSettings(req.body);
  if (!flourishing.ok) return validationErr(res, flourishing.errors);
  const { ok, errors } = validateProfileInput(req.body, { isUpdate: true });
  if (!ok) return validationErr(res, errors);
  restoreFlourishingConsentSettings(req.body, flourishing.stash);

  if (req.body.email !== undefined) {
    const email = String(req.body.email).trim().toLowerCase();
    const other = getProfileByEmail(email);
    if (other && other.id !== id) {
      return err(res, 409, ERROR_CODES.EMAIL_TAKEN, 'A profile with this email already exists.');
    }
  }

  try {
    const updated = updateProfile(id, req.body);
    return res.json(updated);
  } catch (e) {
    if (String(e?.message).includes('UNIQUE')) {
      return err(res, 409, ERROR_CODES.EMAIL_TAKEN, 'A profile with this email already exists.');
    }
    throw e;
  }
});

// --- profile deletion ---
// DELETE /api/profiles/me — permanently removes the caller's own profile
// and data. Identity comes only from the session token; there is no id
// param, so a caller can only ever delete themselves. The token dies with
// the profile row, and the session cookie is cleared on the way out.
app.delete('/api/profiles/me', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const deleted = deleteProfile(profile.id);
  if (!deleted) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Profile not found.');
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie',
    `${PROFILE_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`);
  res.json({ deleted: true });
});

// --- discover (curated matches with qualitative reasons) ---

app.get('/api/discover', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;

  const filters = {
    practice: typeof req.query.practice === 'string' && req.query.practice ? req.query.practice : null,
    locality: ['local', 'remote', 'either'].includes(req.query.locality) ? req.query.locality : null,
    format: CONNECTION_FORMATS.includes(req.query.format) ? req.query.format : null,
  };
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 6, 1), 12);
  const intentionText = typeof req.query.intention === 'string' ? req.query.intention : '';

  const passed = getPassedIds(profile.id);
  const excludeIds = new Set(passed);
  const blockedIds = new Set(
    db.prepare('SELECT blocked_id AS id FROM blocks WHERE blocker_id = ? UNION SELECT blocker_id AS id FROM blocks WHERE blocked_id = ?')
      .all(profile.id, profile.id).map((r) => r.id),
  );

  const matches = findMatches(profile, listCandidateProfiles(), {
    intentionText,
    limit,
    excludeIds,
    existingPairKeys: getNonWithdrawnPairKeys(),
    blockedIds,
    filters,
    // Privacy: never quote a candidate's raw offers/needs/skills wording in
    // reasons when those fields are hidden from the requester. Generic
    // reasons are used instead (see match.js).
    quoteCandidateFieldsFor: (cand) => {
      const cs = cand.consentSettings || {};
      return cs.showPractices !== false || hasMutualConnection(profile.id, cand.id);
    },
  });

  const savedKeys = getSavedKeys(profile.id);

  // v8: optional agent suggestions alongside human matches. Gated on the
  // member's ai_matching consent — AI discovery is opt-in, like all matching.
  let agentMatches = [];
  if (req.query.agents === 'true' && profile.consents?.ai_matching !== false) {
    agentMatches = findAgentMatches(profile, listAgents(), {
      intentionText,
      limit: 3,
      matchRequesterNeeds: profile.consentSettings?.needsMatching !== false,
    })
      .map((m) => ({ agent: m.agent, reasons: m.reasons }));
  }

  res.json({
    matches: matches.map((m) => ({
      profile: getVisibleProfile(m.candidate.id, profile.id),
      reasons: m.reasons,
      sharedPractices: m.sharedPractices,
      sharedIntentions: m.sharedIntentions,
      sharedFormats: m.sharedFormats,
      serendipity: m.serendipity === true,
      saved: savedKeys.has(`match:${m.candidate.id}`),
    })),
    agents: agentMatches,
  });
});

// --- agent registry (intelligent agents as discoverable participants) ---

// Register an agent. The operator is always the token-authenticated caller;
// their declaration is unverified by the platform (see PRODUCT_AUDIT.md A3).
app.post('/api/agents', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const { ok, errors } = validateAgentInput(req.body, { isUpdate: false });
  if (!ok) return validationErr(res, errors);
  const agent = createAgent({ ...req.body, operatorProfileId: profile.id });
  res.status(201).json(agent);
});

app.get('/api/agents', (req, res) => {
  res.json({ agents: listAgents() });
});

app.get('/api/agents/:id', (req, res) => {
  const id = parseId(req.params.id);
  const agent = id === null ? null : getAgent(id);
  if (!agent || agent.isHidden) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Agent not found.');
  res.json(agent);
});

// Only the registering operator may edit or hide an agent. The operator is
// the token-authenticated caller — never a self-asserted body field.
app.patch('/api/agents/:id', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const id = parseId(req.params.id);
  if (id === null) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Agent not found.');
  const { ok, errors } = validateAgentInput(req.body, { isUpdate: true });
  if (!ok) return validationErr(res, errors);
  const result = updateAgent(id, req.body, profile.id);
  if (result === null) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Agent not found.');
  if (result === 'forbidden') return err(res, 403, ERROR_CODES.FORBIDDEN, 'Only the registering operator can edit this agent.');
  res.json(result);
});

app.post('/api/agents/:id/hide', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const id = parseId(req.params.id);
  if (id === null) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Agent not found.');
  const result = hideAgent(id, profile.id);
  if (result === false) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Agent not found.');
  if (result === 'forbidden') return err(res, 403, ERROR_CODES.FORBIDDEN, 'Only the registering operator can hide this agent.');
  res.json({ ok: true });
});

// Host-only: mark an agent listing as host-reviewed. This records that a
// human host looked at the listing — it is not a platform guarantee of the
// agent's behavior. Display tier becomes "Host-reviewed".
app.post('/api/agents/:id/review', (req, res) => {
  if (!requireHost(req, res)) return;
  const id = parseId(req.params.id);
  if (id === null) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Agent not found.');
  const agent = setAgentReviewed(id, true);
  if (!agent || agent.isHidden) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Agent not found.');
  res.json(agent);
});

app.post('/api/discover/pass', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const targetId = parseId(req.body?.targetId);
  if (targetId === null || targetId === profile.id) {
    return validationErr(res, [{ field: 'targetId', message: 'targetId must be another profile id' }]);
  }
  addPass(profile.id, targetId);
  res.json({ ok: true });
});

app.post('/api/discover/save', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const { kind, refId } = req.body || {};
  if (!['match', 'topic'].includes(kind) || refId === undefined || refId === null || String(refId) === '') {
    return validationErr(res, [{ field: 'kind', message: 'kind must be "match" or "topic" with a refId' }]);
  }
  addSavedItem(profile.id, kind, refId);
  res.json({ ok: true });
});

app.delete('/api/discover/save', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const { kind, refId } = req.query;
  if (!['match', 'topic'].includes(kind) || !refId) {
    return validationErr(res, [{ field: 'kind', message: 'kind must be "match" or "topic" with a refId' }]);
  }
  removeSavedItem(profile.id, kind, String(refId));
  res.json({ ok: true });
});

app.get('/api/saved', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const items = listSavedItems(profile.id);
  const enriched = items.map((it) => {
    if (it.kind === 'match') {
      const pid = parseId(it.refId);
      return { ...it, profile: pid ? getVisibleProfile(pid, profile.id) : null };
    }
    if (it.kind === 'topic') {
      return { ...it, topic: EXPLORE_TOPICS.find((t) => t.id === it.refId) || null };
    }
    return it;
  });
  res.json({ saved: enriched });
});

// --- introductions (legacy auto-match + staged consent flow) ---

app.post('/api/introductions/request', (req, res) => {
  const { ok, errors } = validateIntroRequest(req.body);
  if (!ok) return validationErr(res, errors);

  // The requester is always the token-authenticated caller — a body
  // requesterId is never trusted for identity.
  const requester = requireProfile(req, res);
  if (!requester) return;
  if (!requester.consents || requester.consents.introductions !== true) {
    return err(res, 403, ERROR_CODES.CONSENT_REQUIRED,
      'This profile has not opted into introductions.');
  }

  const candidates = listCandidateProfiles()
    // A prior decline is durable: never auto-match the requester with someone
    // who declined them (unless the decliner later allows requests again).
    .filter((c) => c && !hasDeclineBlock(c.id, requester.id));
  const best = findBestMatch(
    requester,
    candidates,
    req.body.intention,
    getNonWithdrawnPairKeys(),
  );

  if (!best) {
    return err(res, 404, ERROR_CODES.NO_MATCH,
      'No eligible community members to introduce right now.');
  }

  const note = buildIntroNote(requester, best.candidate, best.sharedInterests, best.sharedKeywords);
  const intro = createIntroduction({
    requesterId: requester.id,
    proposedId: best.candidate.id,
    intention: req.body.intention,
    note,
    score: best.score,
  });

  return res.status(201).json({
    introduction: toWireIntroduction(intro),
    proposed: {
      id: best.candidate.id,
      name: best.candidate.name,
      interests: best.candidate.interests,
      intention: best.candidate.intention,
    },
    scoreBreakdown: {
      sharedInterests: best.sharedInterests,
      sharedKeywords: best.sharedKeywords,
      score: best.score,
    },
  });
});

/**
 * Targeted intentional request — the sender chooses the person, the
 * connection type, and a message. Staged consent: the recipient responds
 * with accept / accept-with-boundary / question / decline / decline-hidden.
 */
app.post('/api/connections/request', (req, res) => {
  const { ok, errors } = validateConnectionRequest(req.body);
  if (!ok) return validationErr(res, errors);

  // The requester is always the token-authenticated caller.
  const requester = requireProfile(req, res);
  if (!requester) return;
  if (!requester.consents || requester.consents.introductions !== true) {
    return err(res, 403, ERROR_CODES.CONSENT_REQUIRED,
      'This profile has not opted into introductions.');
  }
  if (requester.consentSettings?.paused) {
    return err(res, 403, ERROR_CODES.CONSENT_REQUIRED,
      'Discovery is paused on this profile. Unpause to send requests.');
  }

  const target = getProfile(req.body.targetId);
  if (!target) return err(res, 404, ERROR_CODES.NOT_FOUND, 'The person you chose was not found.');
  if (target.id === requester.id) {
    return validationErr(res, [{ field: 'targetId', message: 'you cannot request a connection with yourself' }]);
  }
  if (isBlockedBetween(requester.id, target.id)) {
    return err(res, 403, ERROR_CODES.FORBIDDEN, 'You cannot connect with this profile.');
  }
  if (target.consentSettings?.paused || target.consentSettings?.discoveryEnabled === false) {
    return err(res, 403, ERROR_CODES.CONSENT_REQUIRED,
      'This person is not open to new connection requests right now.');
  }
  if (target.consentSettings?.intentionalRequests === false) {
    return err(res, 403, ERROR_CODES.CONSENT_REQUIRED,
      'This person is not open to intentional requests right now.');
  }

  const existing = db.prepare(`
    SELECT * FROM introductions
    WHERE status NOT IN ('withdrawn', 'declined', 'declined_hidden', 'ended')
      AND ((requester_id = ? AND proposed_id = ?) OR (requester_id = ? AND proposed_id = ?))
    LIMIT 1
  `).get(requester.id, target.id, target.id, requester.id);
  if (existing) {
    return err(res, 409, ERROR_CODES.CONFLICT_STATE,
      'There is already an active connection request between you two.');
  }
  // A prior decline is durable: the recipient chose not to receive further
  // direct requests from this requester. Neutral wording, no shaming.
  if (hasDeclineBlock(target.id, requester.id)) {
    return err(res, 403, ERROR_CODES.DECLINED_PREVIOUSLY,
      'This person is not available for new requests right now.');
  }

  // Optional connection brief: must belong to the requester, be active, and
  // be approved for sharing. Its approved shared_text is snapshotted onto the
  // introduction so the recipient sees exactly what was approved.
  let requesterSharedText = '';
  if (req.body.briefId !== undefined && req.body.briefId !== null) {
    const brief = getBrief(parseId(req.body.briefId));
    if (!brief || brief.profile_id !== requester.id || brief.status !== 'active' || !brief.consent_share) {
      return err(res, 403, ERROR_CODES.FORBIDDEN,
        'The selected brief is not available for sharing.');
    }
    requesterSharedText = brief.shared_text || '';
  }

  const intro = createIntroduction({
    requesterId: requester.id,
    proposedId: target.id,
    intention: req.body.message,
    note: '',
    score: 0,
    connectionType: req.body.connectionType,
    requestMessage: req.body.message,
    format: req.body.format || '',
    commitment: req.body.commitment || '',
    tone: req.body.tone || '',
    requesterSharedText,
  });

  return res.status(201).json({ introduction: toWireIntroduction(intro) });
});

app.get('/api/introductions', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const profileId = profile.id;
  const intros = listIntroductionsFor(profileId);
  // Attach a privacy-aware view of the other participant.
  const enriched = intros.map((x) => {
    const otherId = x.requesterId === profileId ? x.proposedId : x.requesterId;
    return {
      ...toWireIntroduction(x),
      requesterName: x.requesterName,
      proposedName: x.proposedName,
      other: getVisibleProfile(otherId, profileId),
    };
  });
  res.json({ introductions: enriched });
});

/** Staged recipient response. Only the proposed (recipient) side may respond. */
app.post('/api/introductions/:id/respond', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const { ok, errors } = validateRespond(req.body);
  if (!ok) return validationErr(res, errors);

  const intro = getIntroduction(parseId(req.params.id));
  if (!intro) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Introduction not found.');
  if (intro.proposedId !== profile.id) {
    return err(res, 403, ERROR_CODES.FORBIDDEN, 'Only the recipient can respond to this request.');
  }

  const allowed = VALID_TRANSITIONS[intro.status] || [];
  // Response kinds ('decline') map onto their stored statuses ('declined').
  const RESPONSE_TO_STATUS = {
    accepted: 'accepted',
    accepted_with_boundary: 'accepted_with_boundary',
    question: 'question',
    decline: 'declined',
    decline_hidden: 'declined_hidden',
  };
  const targetStatus = RESPONSE_TO_STATUS[req.body.response];
  if (!targetStatus || !allowed.includes(targetStatus)) {
    return err(res, 409, ERROR_CODES.INVALID_TRANSITION,
      `Cannot respond "${req.body.response}" to a request with status "${intro.status}".`);
  }

  const updated = setIntroductionStatus(intro.id, targetStatus, {
    responseKind: req.body.response,
    responderNote: (req.body.note || '').trim(),
  });

  // Extra top-level response fields (the real-life prompt on accept).
  const responseExtras = {};

  // Keep a synchronicity match in step with its introduction (if any).
  syncBeaconMatchForIntroduction(intro.id, targetStatus);

  // A decline is durable: the recipient will not receive further direct
  // requests from this requester unless they later choose to allow them.
  if (targetStatus === 'declined' || targetStatus === 'declined_hidden') {
    recordDeclineBlock(profile.id, intro.requesterId);
  }

  // On acceptance, SEREN posts a warm-intro system message into the thread.
  // Deterministic template: names + each side's approved shared_text only.
  if (targetStatus === 'accepted' || targetStatus === 'accepted_with_boundary') {
    const requester = getProfile(intro.requesterId);
    const requesterBrief = getBriefByProfile(intro.requesterId);
    const requesterShared = updated.requesterSharedText
      || ((requesterBrief && requesterBrief.status === 'active' && requesterBrief.consent_share)
        ? requesterBrief.shared_text : '');
    const responderBrief = getBriefByProfile(profile.id);
    const responderShared = (responderBrief && responderBrief.status === 'active' && responderBrief.consent_share)
      ? responderBrief.shared_text
      : '';
    createMessage({
      introductionId: intro.id,
      senderId: 0,
      body: buildWarmIntroMessage({
        requesterName: requester?.name,
        responderName: profile.name,
        requesterSharedText: requesterShared,
        responderSharedText: responderShared,
        connectionType: updated.connectionType || '',
      }),
    });
    // Real-life completion (GUIDE_BEHAVIOR_RULES §9): the optional,
    // skippable prompt rides the accept response (see realLifePromptField).
    Object.assign(responseExtras, realLifePromptField(intro.id));
  }

  res.json({ ...toWireIntroduction(updated), ...responseExtras });
});

/** End a mutual connection cleanly (either side). */
app.post('/api/introductions/:id/end', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const intro = getIntroduction(parseId(req.params.id));
  if (!requireParticipant(req, res, intro, profile.id)) return;
  const allowed = VALID_TRANSITIONS[intro.status] || [];
  if (!allowed.includes(INTRO_STATUS.ENDED)) {
    return err(res, 409, ERROR_CODES.INVALID_TRANSITION,
      `Cannot end a connection with status "${intro.status}".`);
  }
  res.json(toWireIntroduction(setIntroductionStatus(intro.id, INTRO_STATUS.ENDED)));
  syncBeaconMatchForIntroduction(intro.id, INTRO_STATUS.ENDED);
});

/**
 * Guarded status transition for introductions. Identity comes from the
 * session token, and the caller's role is enforced: only the recipient
 * (proposed side) may accept/decline; only the requester may withdraw.
 */
function transition(targetStatus, role) {
  return (req, res) => {
    const profile = requireProfile(req, res);
    if (!profile) return;
    const id = parseId(req.params.id);
    const intro = id === null ? null : getIntroduction(id);
    if (!intro) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Introduction not found.');

    if (role === 'proposed' && intro.proposedId !== profile.id) {
      return err(res, 403, ERROR_CODES.FORBIDDEN,
        'Only the recipient can respond to this request.');
    }
    if (role === 'requester' && intro.requesterId !== profile.id) {
      return err(res, 403, ERROR_CODES.FORBIDDEN,
        'Only the requester can withdraw this request.');
    }

    const allowed = VALID_TRANSITIONS[intro.status] || [];
    if (!allowed.includes(targetStatus)) {
      return err(res, 409, ERROR_CODES.INVALID_TRANSITION,
        `Cannot move introduction from "${intro.status}" to "${targetStatus}".`);
    }

    const updated = setIntroductionStatus(id, targetStatus);
    // Keep a synchronicity match in step with its introduction (if any).
    syncBeaconMatchForIntroduction(id, targetStatus);
    // A decline is durable: the recipient will not receive further direct
    // requests from this requester unless they later choose to allow them.
    if (targetStatus === 'declined') {
      recordDeclineBlock(intro.proposedId, intro.requesterId);
    }
    // Real-life completion (GUIDE_BEHAVIOR_RULES §9) on the legacy accept
    // path too: the optional, skippable prompt rides the accept response.
    const extras = targetStatus === 'accepted' ? realLifePromptField(id) : {};
    res.json({ ...toWireIntroduction(updated), ...extras });
  };
}

app.post('/api/introductions/:id/accept', transition('accepted', 'proposed'));
app.post('/api/introductions/:id/decline', transition('declined', 'proposed'));
app.post('/api/introductions/:id/withdraw', transition('withdrawn', 'requester'));

// ---------- flourishing by design (v16) ----------
// Outcome tracking, not engagement. Weekly member check-ins, per-introduction
// feedback, and real-life intentions (member-declared offline intent — never
// an outcome claim). Identity always comes from the session token; a
// caller-supplied profileId is verified against it, never trusted for
// identity. Copy stays honest: no medical/diagnosis/treatment claims, no
// psychic certainty, no engagement-maximizing language.

const FLOURISHING_QUESTIONS = [
  { key: 'real_world_action', text: 'Did SEREN help you take a meaningful action in the real world this week?', kind: 'yesno' },
  { key: 'connected', text: 'Did you feel more connected to others this week?', kind: 'scale1to5' },
  { key: 'clarity_agency', text: 'Did this experience increase your clarity or sense of agency?', kind: 'scale1to5' },
  { key: 'pressure', text: 'Did you feel pressured, confused, anxious, or dependent on the app?', kind: 'yesno' },
  { key: 'suggestion_volume', text: 'Would you like fewer, the same, or more suggestions?', kind: 'choice', choices: ['fewer', 'same', 'more'] },
  { key: 'supportive_now', text: 'What type of connection or practice would feel genuinely supportive right now?', kind: 'text', optional: true },
  { key: 'offline_time', text: 'Did SEREN help you spend more meaningful time offline?', kind: 'yesno' },
  { key: 'ai_humility', text: 'Did the SEREN guide feel appropriately humble and non-authoritative?', kind: 'yesno' },
  { key: 'pause_autonomy', text: 'Do you feel you could pause or leave SEREN without losing autonomy?', kind: 'yesno' },
  // Digital Sapiens layer (Jack Probert, Experiment 2): attention
  // integrity — does SEREN itself leave people more present, intentional,
  // and pulled toward real life, or more scattered and screen-bound?
  { key: 'net_attention', text: 'After using SEREN today, do you feel more present and focused, or more scattered?', kind: 'choice', choices: ['more_present', 'about_same', 'more_scattered'] },
  { key: 'intentional_use', text: 'Did you open SEREN with a clear purpose today, and leave when you were done?', kind: 'yesno' },
  { key: 'real_life_pull', text: 'Did SEREN nudge you toward a real-world connection or action today?', kind: 'yesno' },
  { key: 'pathways_reflection', text: 'Which did you touch today — serving someone, time with community, making something, a small ritual, or a moment of awe? (optional)', kind: 'text', optional: true },
];
const FLOURISHING_QUESTION_BY_KEY = Object.fromEntries(
  FLOURISHING_QUESTIONS.map((q) => [q.key, q]));

/**
 * A self-asserted profileId (body or query) must match the token-
 * authenticated caller. 401 when no session, 400 when profileId is missing
 * or malformed, 403 when it belongs to someone else.
 */
function requireSelfProfile(req, res, profileId) {
  const profile = requireProfile(req, res);
  if (!profile) return null;
  const claimed = parseId(profileId);
  if (claimed === null) {
    validationErr(res, [{ field: 'profileId', message: 'profileId is required' }]);
    return null;
  }
  if (claimed !== profile.id) {
    err(res, 403, ERROR_CODES.FORBIDDEN, 'You can only act on your own profile.');
    return null;
  }
  return profile;
}

/** Normalize a check-in answer to canonical text, or return an error. */
function normalizeFlourishingAnswer(question, raw) {
  const str = raw === null || raw === undefined ? '' : String(raw);
  const trimmed = str.trim();
  if (question.kind === 'yesno') {
    const v = trimmed.toLowerCase();
    if (['yes', 'y', 'true', '1'].includes(v)) return { ok: true, answer: 'yes' };
    if (['no', 'n', 'false', '0'].includes(v)) return { ok: true, answer: 'no' };
    return { ok: false, error: 'answer must be yes or no' };
  }
  if (question.kind === 'scale1to5') {
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      return { ok: false, error: 'answer must be an integer from 1 to 5' };
    }
    return { ok: true, answer: String(n) };
  }
  if (question.kind === 'choice') {
    const v = trimmed.toLowerCase();
    if (question.choices.includes(v)) return { ok: true, answer: v };
    return { ok: false, error: `answer must be one of: ${question.choices.join(', ')}` };
  }
  // kind === 'text': free text, capped like every other answer.
  if (trimmed.length > 2000) return { ok: false, error: 'answer must be at most 2000 characters' };
  if (trimmed.length === 0 && !question.optional) return { ok: false, error: 'answer is required' };
  return { ok: true, answer: trimmed };
}

app.get('/api/flourishing/questions', (req, res) => {
  // Static product copy; safe to expose to anyone with beta access.
  res.json({ questions: FLOURISHING_QUESTIONS });
});

app.post('/api/flourishing/checkin', (req, res) => {
  const profile = requireSelfProfile(req, res, req.body?.profileId);
  if (!profile) return;
  const errors = [];
  const responses = req.body?.responses;
  if (!Array.isArray(responses) || responses.length === 0) {
    errors.push({ field: 'responses', message: 'responses must be a non-empty array' });
  }
  const normalized = [];
  const seen = new Set();
  if (Array.isArray(responses)) {
    responses.forEach((r, i) => {
      const question = FLOURISHING_QUESTION_BY_KEY[r?.questionKey];
      if (!question) {
        errors.push({
          field: `responses[${i}].questionKey`,
          message: `unknown question key "${r?.questionKey}"`,
        });
        return;
      }
      if (seen.has(question.key)) {
        errors.push({
          field: `responses[${i}].questionKey`,
          message: `duplicate answer for "${question.key}"`,
        });
        return;
      }
      seen.add(question.key);
      const n = normalizeFlourishingAnswer(question, r?.answer);
      if (!n.ok) {
        errors.push({ field: `responses[${i}].answer`, message: n.error });
        return;
      }
      normalized.push({ questionKey: question.key, answer: n.answer });
    });
  }
  if (errors.length > 0) return validationErr(res, errors);
  const { ids, createdAt } = createFlourishingCheckins(profile.id, normalized);
  res.status(201).json({ checkin: { id: ids[0], createdAt } });
});

app.get('/api/flourishing/checkins/mine', (req, res) => {
  const profile = requireSelfProfile(req, res, req.query.profileId);
  if (!profile) return;
  res.json({ checkins: listFlourishingCheckins(profile.id) });
});

app.post('/api/introductions/:id/feedback', (req, res) => {
  const profile = requireSelfProfile(req, res, req.body?.profileId);
  if (!profile) return;
  const intro = getIntroduction(parseId(req.params.id));
  if (!requireParticipant(req, res, intro, profile.id)) return;

  const errors = [];
  const { feltSafe, quality, notes } = req.body || {};
  if (typeof feltSafe !== 'boolean') {
    errors.push({ field: 'feltSafe', message: 'feltSafe must be a boolean' });
  }
  if (quality !== undefined && quality !== null) {
    const q = Number(quality);
    if (!Number.isInteger(q) || q < 1 || q > 5) {
      errors.push({ field: 'quality', message: 'quality must be an integer from 1 to 5' });
    }
  }
  if (notes !== undefined && notes !== null && notes !== '') {
    if (typeof notes !== 'string' || notes.trim().length > 500) {
      errors.push({ field: 'notes', message: 'notes must be at most 500 characters' });
    }
  }
  if (errors.length > 0) return validationErr(res, errors);

  if (getIntroductionFeedback(intro.id, profile.id)) {
    return err(res, 409, ERROR_CODES.ALREADY_SUBMITTED,
      'You have already left feedback on this introduction.');
  }
  try {
    const feedback = createIntroductionFeedback({
      introductionId: intro.id,
      profileId: profile.id,
      feltSafe,
      quality: quality === undefined || quality === null ? null : Number(quality),
      notes: typeof notes === 'string' ? notes : '',
    });
    res.status(201).json({ feedback });
  } catch (e) {
    // Race between the pre-check and the insert: the unique index is the
    // real one-feedback enforcer.
    if (String(e?.message).includes('UNIQUE')) {
      return err(res, 409, ERROR_CODES.ALREADY_SUBMITTED,
        'You have already left feedback on this introduction.');
    }
    throw e;
  }
});

// Set the real-life intention on an introduction: a member-declared offline
// intent (e.g. "meet for a walk"), never a claim about outcomes.
app.post('/api/introductions/:id/real-life-intention', (req, res) => {
  const profile = requireSelfProfile(req, res, req.body?.profileId);
  if (!profile) return;
  const intro = getIntroduction(parseId(req.params.id));
  if (!requireParticipant(req, res, intro, profile.id)) return;
  const intention = typeof req.body?.intention === 'string' ? req.body.intention.trim() : '';
  if (intention.length === 0 || intention.length > 300) {
    return validationErr(res, [{ field: 'intention', message: 'intention must be 1-300 characters' }]);
  }
  const updated = setIntroductionRealLifeIntention(intro.id, intention);
  res.json({ introduction: toWireIntroduction(updated) });
});

app.post('/api/introductions/:id/real-life-intention/complete', (req, res) => {
  const profile = requireSelfProfile(req, res, req.body?.profileId);
  if (!profile) return;
  const intro = getIntroduction(parseId(req.params.id));
  if (!requireParticipant(req, res, intro, profile.id)) return;
  const updated = completeIntroductionRealLifeIntention(intro.id);
  res.json({ introduction: toWireIntroduction(updated) });
});

// Digital Sapiens (P6): move an accepted introduction to real life. The
// member declares the connection now lives beyond the app; SEREN steps
// back and stops nudging about it. Consent-first, optional, participant-
// only, and only from a mutually accepted connection.
app.post('/api/introductions/:id/move-to-real-life', (req, res) => {
  const profile = requireSelfProfile(req, res, req.body?.profileId);
  if (!profile) return;
  const intro = getIntroduction(parseId(req.params.id));
  if (!requireParticipant(req, res, intro, profile.id)) return;
  if (!['accepted', 'accepted_with_boundary'].includes(intro.status)) {
    return err(res, 409, ERROR_CODES.INVALID_TRANSITION,
      'Only a mutually accepted connection can move to real life.');
  }
  const updated = markIntroductionMovedToRealLife(intro.id);
  res.json({ introduction: toWireIntroduction(updated), handoff: realLifeHandoff() });
});

// Digital Sapiens attention analytics: record one app open with its coarse
// origin. SEREN sends no engagement notifications by design, so opens the
// client reports as 'intentional' are the honest default; the endpoint
// exists so any future entry point is measured separately, never blended.
app.post('/api/attention/open', (req, res) => {
  const profile = requireSelfProfile(req, res, req.body?.profileId);
  if (!profile) return;
  const origin = typeof req.body?.origin === 'string' ? req.body.origin.trim() : '';
  if (!ATTENTION_ORIGINS.includes(origin)) {
    return validationErr(res, [{ field: 'origin', message: `origin must be one of: ${ATTENTION_ORIGINS.join(', ')}` }]);
  }
  const id = recordAttentionOpen(profile.id, origin);
  res.json({ recorded: true, id });
});

// Host-only outcome analytics. Deliberately no engagement metrics (no DAU,
// session time, message volume, streaks): every number here is a
// member-reported outcome. Windows: check-in metrics trail 30 days;
// introduction feedback aggregates all feedback on record.
app.get('/api/host/analytics', (req, res) => {
  if (!requireHost(req, res)) return;
  const agg = getFlourishingAggregates();
  const pct = (num, den) => (den > 0 ? Math.round((100 * num) / den) : 0);
  const answered = Object.fromEntries(agg.answeredByKey.map((r) => [r.questionKey, r.n]));
  const yes = Object.fromEntries(agg.yesByKey.map((r) => [r.questionKey, r.yesN]));
  const pctYes = (key) => pct(yes[key] || 0, answered[key] || 0);
  // Digital Sapiens attention impact: net_attention choice distribution +
  // intentional-use / real-life-pull yes-rates + app-open origins. All
  // member-reported or client-reported; still no engagement-maximizing
  // metrics (no DAU targets, no session-time goals, no streaks).
  const netAtt = { more_present: 0, about_same: 0, more_scattered: 0 };
  for (const r of agg.choiceDist || []) {
    if (r.answer in netAtt) netAtt[r.answer] = r.n;
  }
  const netAttN = netAtt.more_present + netAtt.about_same + netAtt.more_scattered;
  res.json({
    realWorldAction30d: { pct: pctYes('real_world_action'), n: answered['real_world_action'] || 0 },
    introductionQuality: {
      avgQuality: agg.feedback.avgQuality === null
        ? null : Math.round(agg.feedback.avgQuality * 100) / 100,
      pctFeltSafe: pct(agg.feedback.safeN || 0, agg.feedback.n || 0),
      n: agg.feedback.n || 0,
    },
    connectionGains: { pct: pct(agg.connectedHigh.n || 0, answered['connected'] || 0) },
    offlineTime: { pct: pctYes('offline_time') },
    safety: {
      incidents30d: agg.incidents.n || 0,
      avgResolutionHrs: agg.resolution.avgHours === null
        ? null : Math.round(agg.resolution.avgHours * 10) / 10,
    },
    autonomy: { pctPauseConfident: pctYes('pause_autonomy') },
    aiHumility: { pct: pctYes('ai_humility') },
    attentionImpact: {
      opens30d: getAttentionOpenAggregates(),
      netAttention: {
        pctMorePresent: pct(netAtt.more_present, netAttN),
        n: netAttN,
        distribution: netAtt,
      },
      intentionalUse: { pct: pctYes('intentional_use') },
      realLifePull: { pct: pctYes('real_life_pull') },
    },
    computedAt: new Date().toISOString(),
  });
});

// Lift a decline block the caller placed: allow future direct requests from
// the given requester again. Only the decliner (token identity) can lift a
// block they placed; lifting is the decliner's choice alone.
app.delete('/api/decline-blocks/:requesterId', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const requesterId = parseId(req.params.requesterId);
  if (requesterId === null) {
    return err(res, 404, ERROR_CODES.NOT_FOUND, 'Profile not found.');
  }
  const removed = removeDeclineBlock(profile.id, requesterId);
  res.json({ removed });
});

// --- private messages (only after mutual acceptance) ---

function requireMessagingOpen(req, res, profile) {
  const intro = getIntroduction(parseId(req.params.id));
  if (!requireParticipant(req, res, intro, profile.id)) return null;
  if (!['accepted', 'accepted_with_boundary'].includes(intro.status)) {
    err(res, 403, ERROR_CODES.FORBIDDEN,
      'Messages open only after both people accept the connection.');
    return null;
  }
  if (isBlockedBetween(intro.requesterId, intro.proposedId)) {
    err(res, 403, ERROR_CODES.FORBIDDEN, 'Messaging is unavailable for this connection.');
    return null;
  }
  return intro;
}

app.get('/api/introductions/:id/messages', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const intro = requireMessagingOpen(req, res, profile);
  if (!intro) return;
  res.json({
    introduction: toWireIntroduction(intro),
    plan: getConnectionPlan(intro.id),
    messages: listMessages(intro.id),
  });
});

app.post('/api/introductions/:id/messages', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const intro = requireMessagingOpen(req, res, profile);
  if (!intro) return;
  const { ok, errors } = validateMessageInput(req.body);
  if (!ok) return validationErr(res, errors);
  if (req.body.senderId !== profile.id) {
    return err(res, 403, ERROR_CODES.FORBIDDEN, 'You can only send messages as yourself.');
  }
  const msg = createMessage({ introductionId: intro.id, senderId: profile.id, body: req.body.body });
  res.status(201).json(msg);
});

// --- first-connection plan ---

app.get('/api/introductions/:id/plan', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const intro = getIntroduction(parseId(req.params.id));
  if (!requireParticipant(req, res, intro, profile.id)) return;
  res.json({ plan: getConnectionPlan(intro.id) });
});

app.post('/api/introductions/:id/plan', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const intro = getIntroduction(parseId(req.params.id));
  if (!requireParticipant(req, res, intro, profile.id)) return;
  if (!['accepted', 'accepted_with_boundary'].includes(intro.status)) {
    return err(res, 403, ERROR_CODES.FORBIDDEN, 'Plans can only be set for mutual connections.');
  }
  const { ok, errors } = validatePlanInput(req.body);
  if (!ok) return validationErr(res, errors);
  const plan = upsertConnectionPlan({
    introductionId: intro.id,
    format: req.body.format || '',
    timeText: (req.body.timeText || '').trim(),
    expectations: (req.body.expectations || '').trim(),
    createdBy: profile.id,
  });
  res.json({ plan });
});

// --- circles ---

app.get('/api/circles', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const kind = CIRCLE_KIND_VALUES.includes(req.query.kind) ? req.query.kind : null;
  res.json({ circles: listCircles({ kind, viewerId: profile.id }) });
});

app.get('/api/circles/mine', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  res.json({ circles: listMyCircles(profile.id) });
});

app.post('/api/circles', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const { ok, errors } = validateCircleInput(req.body);
  if (!ok) return validationErr(res, errors);
  const circle = createCircle({
    name: req.body.name,
    kind: req.body.kind,
    purpose: req.body.purpose,
    privacy: req.body.privacy || 'request-to-join',
    maxParticipants: req.body.maxParticipants || 12,
    schedule: req.body.schedule || '',
    agreements: req.body.agreements || '',
    region: req.body.region || '',
    createdBy: profile.id,
  });
  res.status(201).json({ circle });
});

app.get('/api/circles/:id', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const circle = getCircle(parseId(req.params.id), profile.id);
  if (!circle) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Circle not found.');
  if (circle.privacy === 'invite-only' && !circle.isMember) {
    return err(res, 403, ERROR_CODES.FORBIDDEN, 'This circle is invite-only.');
  }
  const requests = circle.isMember
    ? listCircleRequests(circle.id).filter((r) => r.status === 'proposed')
    : [];
  res.json({ circle, members: listCircleMembers(circle.id), pendingRequests: requests });
});

app.post('/api/circles/:id/join', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const circleId = parseId(req.params.id);
  const circle = getCircle(circleId);
  if (!circle) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Circle not found.');
  const { ok: joined, reason } = joinCircle(circleId, profile.id);
  if (joined) return res.json({ joined: true, circle: getCircle(circleId, profile.id) });
  if (reason === 'needs_request') {
    return err(res, 409, ERROR_CODES.CONFLICT_STATE, 'This circle asks you to request to join first.');
  }
  if (reason === 'full') {
    return err(res, 409, ERROR_CODES.CONFLICT_STATE, 'This circle is full.');
  }
  return err(res, 403, ERROR_CODES.FORBIDDEN, 'You cannot join this circle.');
});

app.post('/api/circles/:id/request', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const circleId = parseId(req.params.id);
  const circle = getCircle(circleId);
  if (!circle) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Circle not found.');
  if (circle.privacy === 'invite-only') {
    return err(res, 403, ERROR_CODES.FORBIDDEN, 'This circle is invite-only.');
  }
  const { ok, errors } = validateCircleJoin(req.body);
  if (!ok) return validationErr(res, errors);
  // Join requests are always for the authenticated caller.
  const result = requestCircleJoin(circleId, profile.id, req.body.message || '');
  if (!result.ok) {
    return err(res, 409, ERROR_CODES.CONFLICT_STATE, 'You have already requested to join this circle.');
  }
  res.status(201).json({ requested: true, requestId: result.id });
});

app.post('/api/circle-requests/:id/approve', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const requestId = parseId(req.params.id);
  const joinReq = getCircleRequest(requestId);
  if (!joinReq) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Join request not found.');
  const circle = getCircle(joinReq.circle_id);
  if (!circle || circle.createdBy !== profile.id) {
    return err(res, 403, ERROR_CODES.FORBIDDEN, 'Only the circle host can approve requests.');
  }
  const updated = setCircleRequestStatus(requestId, 'approved');
  if (!updated) return err(res, 409, ERROR_CODES.CONFLICT_STATE, 'This request was already handled.');
  res.json({ ok: true });
});

app.post('/api/circle-requests/:id/decline', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const requestId = parseId(req.params.id);
  const joinReq = getCircleRequest(requestId);
  if (!joinReq) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Join request not found.');
  const circle = getCircle(joinReq.circle_id);
  if (!circle || circle.createdBy !== profile.id) {
    return err(res, 403, ERROR_CODES.FORBIDDEN, 'Only the circle host can decline requests.');
  }
  const updated = setCircleRequestStatus(requestId, 'declined');
  if (!updated) return err(res, 409, ERROR_CODES.CONFLICT_STATE, 'This request was already handled.');
  res.json({ ok: true });
});

// --- blocks & reports ---

app.get('/api/blocks', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  res.json({ blocked: listBlocks(profile.id) });
});

app.post('/api/blocks', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const blockedId = parseId(req.body?.blockedId);
  if (blockedId === null || blockedId === profile.id) {
    return validationErr(res, [{ field: 'blockedId', message: 'blockedId must be another profile id' }]);
  }
  if (!getProfile(blockedId)) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Profile not found.');
  addBlock(profile.id, blockedId);
  res.status(201).json({ ok: true });
});

app.delete('/api/blocks/:blockedId', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const blockedId = parseId(req.params.blockedId);
  if (blockedId === null) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Profile not found.');
  removeBlock(profile.id, blockedId);
  res.json({ ok: true });
});

app.post('/api/reports', (req, res) => {
  const { ok, errors } = validateReportInput(req.body);
  if (!ok) return validationErr(res, errors);
  // The reporter is always the token-authenticated caller.
  const reporter = requireProfile(req, res);
  if (!reporter) return;
  if (!getProfile(req.body.reportedId)) {
    return err(res, 404, ERROR_CODES.NOT_FOUND, 'Reported profile not found.');
  }
  const report = createReport({
    reporterId: reporter.id,
    reportedId: req.body.reportedId,
    reason: req.body.reason,
    details: req.body.details || '',
  });
  res.status(201).json({ report });
});

// --- host moderation ---

app.get('/api/reports', (req, res) => {
  if (!requireHost(req, res)) return;
  res.json({ reports: listReports() });
});

app.post('/api/reports/:id/dismiss', (req, res) => {
  if (!requireHost(req, res)) return;
  const id = parseId(req.params.id);
  const report = id === null ? null : getReport(id);
  if (!report) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Report not found.');
  setReportStatus(id, 'dismissed');
  res.json({ ok: true, status: 'dismissed' });
});

app.post('/api/reports/:id/hide-profile', (req, res) => {
  if (!requireHost(req, res)) return;
  const id = parseId(req.params.id);
  const report = id === null ? null : getReport(id);
  if (!report) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Report not found.');
  setProfileHidden(report.reportedId, true);
  setReportStatus(id, 'actioned');
  res.json({ ok: true, status: 'actioned' });
});

// --- host assists (Human Mode: host-facilitated introductions) ---
// A member asks a real person (a SEREN host) to thoughtfully suggest someone
// for them. The host's proposal creates an introduction through the SAME
// staged mutual-consent machinery as intentional requests: both people still
// choose. The host never sees algorithmic match output, and nothing here
// implies certainty about the suggestion.

app.post('/api/host-assists', (req, res) => {
  const { ok, errors } = validateHostAssistInput(req.body);
  if (!ok) return validationErr(res, errors);
  // The asker is always the token-authenticated caller.
  const asker = requireProfile(req, res);
  if (!asker) return;
  if (!asker.consents || asker.consents.introductions !== true) {
    return err(res, 403, ERROR_CODES.CONSENT_REQUIRED,
      'This profile has not opted into introductions.');
  }
  // One open request per member at a time. The partial unique index is the
  // real enforcer (races included); the pre-check gives the friendly 409.
  if (getOpenHostAssist(asker.id)) {
    return err(res, 409, ERROR_CODES.CONFLICT_STATE,
      'You already have an open request. Withdraw it before asking again.');
  }
  try {
    const assist = createHostAssist({ profileId: asker.id, requestText: req.body.requestText });
    return res.status(201).json({ assist: toWireHostAssist(assist) });
  } catch (e) {
    if (String(e && e.message).includes('UNIQUE')) {
      return err(res, 409, ERROR_CODES.CONFLICT_STATE,
        'You already have an open request. Withdraw it before asking again.');
    }
    throw e;
  }
});

app.get('/api/host-assists/mine', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  res.json({ assists: listHostAssistsFor(profile.id).map(toWireHostAssist) });
});

app.post('/api/host-assists/mine/:id/withdraw', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const id = parseId(req.params.id);
  const assist = id === null ? null : getHostAssist(id);
  // Not found covers "someone else's request" too — withdrawing is the
  // asker's choice alone, and other members' request ids stay private.
  if (!assist || assist.profileId !== profile.id) {
    return err(res, 404, ERROR_CODES.NOT_FOUND, 'Request not found.');
  }
  if (assist.status !== 'open') {
    return err(res, 409, ERROR_CODES.INVALID_TRANSITION,
      `A request with status "${assist.status}" cannot be withdrawn.`);
  }
  res.json({ assist: toWireHostAssist(setHostAssistStatus(id, 'withdrawn')) });
});

app.get('/api/host-assists', (req, res) => {
  if (!requireHost(req, res)) return;
  res.json({ assists: listOpenHostAssists().map(toWireHostAssist) });
});

app.post('/api/host-assists/:id/propose', (req, res) => {
  if (!requireHost(req, res)) return;
  const { ok, errors } = validateHostAssistProposal(req.body);
  if (!ok) return validationErr(res, errors);

  const id = parseId(req.params.id);
  const assist = id === null ? null : getHostAssist(id);
  if (!assist) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Assist request not found.');
  if (assist.status !== 'open') {
    return err(res, 409, ERROR_CODES.CONFLICT_STATE,
      `This request is no longer open (status: "${assist.status}").`);
  }

  const asker = getProfile(assist.profileId);
  if (!asker) return err(res, 404, ERROR_CODES.NOT_FOUND, 'The requesting member was not found.');
  if (!asker.consents || asker.consents.introductions !== true) {
    return err(res, 403, ERROR_CODES.CONSENT_REQUIRED,
      'The requesting member has not opted into introductions.');
  }
  if (asker.consentSettings && asker.consentSettings.paused) {
    return err(res, 403, ERROR_CODES.CONSENT_REQUIRED,
      'The requesting member has paused discovery.');
  }

  // The same eligibility guards as POST /api/connections/request.
  const suggested = getProfile(Number(req.body.suggestedId));
  if (!suggested) return err(res, 404, ERROR_CODES.NOT_FOUND, 'The suggested member was not found.');
  if (suggested.id === asker.id) {
    return validationErr(res, [{ field: 'suggestedId', message: 'the suggested member must be someone else' }]);
  }
  if (isBlockedBetween(asker.id, suggested.id)) {
    return err(res, 403, ERROR_CODES.FORBIDDEN, 'These members cannot connect.');
  }
  if (suggested.consentSettings && (suggested.consentSettings.paused || suggested.consentSettings.discoveryEnabled === false)) {
    return err(res, 403, ERROR_CODES.CONSENT_REQUIRED,
      'The suggested member is not open to new connection requests right now.');
  }
  if (suggested.consentSettings && suggested.consentSettings.intentionalRequests === false) {
    return err(res, 403, ERROR_CODES.CONSENT_REQUIRED,
      'The suggested member is not open to intentional requests right now.');
  }
  // A prior decline is durable: the suggested member chose not to receive
  // further direct requests from this asker. Same neutral 403 as the
  // intentional-request path.
  if (hasDeclineBlock(suggested.id, asker.id)) {
    return err(res, 403, ERROR_CODES.DECLINED_PREVIOUSLY,
      'This person is not available for new requests right now.');
  }
  const existingPair = db.prepare(`
    SELECT 1 FROM introductions
    WHERE status NOT IN ('withdrawn', 'declined', 'declined_hidden', 'ended')
      AND ((requester_id = ? AND proposed_id = ?) OR (requester_id = ? AND proposed_id = ?))
    LIMIT 1
  `).get(asker.id, suggested.id, suggested.id, asker.id);
  if (existingPair) {
    return err(res, 409, ERROR_CODES.CONFLICT_STATE,
      'There is already an active connection request between these members.');
  }

  // The host's proposal enters the normal staged mutual-consent flow: the
  // suggested member responds (accept / question / decline) like any other
  // request. The note is honest about provenance: a person suggested this.
  const hostNote = String(req.body.hostNote || '').trim();
  const note = [
    `${asker.name} asked a person, not an algorithm, to help them find a meaningful connection. A SEREN host read their request and thought of you. Both of you still choose.`,
    hostNote ? `Host note: ${hostNote}` : '',
  ].filter(Boolean).join('\n\n');

  const intro = createIntroduction({
    requesterId: asker.id,
    proposedId: suggested.id,
    intention: 'A SEREN host thought you two might connect',
    note,
    score: 0,
  });
  const updated = setHostAssistStatus(id, 'proposed');
  return res.status(201).json({
    assist: toWireHostAssist(updated),
    introduction: toWireIntroduction(intro),
  });
});

// ---------- synchronicity mode ----------
// A beacon is a short, time-bound signal a member chooses to be matched on
// (self-input or a draw from the curated deck). Matching is exact-
// normalized-text only in the MVP and runs synchronously at beacon
// creation (see trySynchronicityMatch in src/db.js): deterministic and
// testable, no background machinery. A match creates an introduction through
// the existing staged mutual-consent flow; the introduction note carries
// the shared-beacon reason. Beacons are private: no endpoint exposes one
// member's beacon text to another except the matched counterpart, via the
// introduction note, at proposal stage.

function toWireBeacon(beacon) {
  if (!beacon) return null;
  return {
    id: beacon.id,
    source: beacon.source,
    text: beacon.rawText,
    word: beacon.normalizedText,
    cardId: beacon.cardId,
    intentionType: beacon.intentionType,
    status: beacon.status,
    createdAt: beacon.createdAt,
    expiresAt: beacon.expiresAt,
    // Reflective framing (Flourishing): a beacon is a creative reflection
    // prompt, never a prediction, diagnosis, or verified external message.
    framing: REFLECTIVE_FRAMING,
  };
}

/** The curated deck: words, open reflective prompts, and per-card lenses. Curated content, safe to expose. */
app.get('/api/sync/deck', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  res.json({ cards: SYNC_DECK.map((c) => getSyncCardAnnotated(c.id)) });
});

/**
 * Carry a beacon. On creation, SEREN quietly checks for someone else
 * carrying the same word; when an eligible match exists, both members get
 * the proposal through the normal introduction flow (visible in Requests).
 */
app.post('/api/sync/beacons', (req, res) => {
  const { ok, errors } = validateBeaconInput(req.body);
  if (!ok) return validationErr(res, errors);

  // Identity always comes from the token; a body profileId is never trusted.
  const profile = requireProfile(req, res);
  if (!profile) return;
  if (!profile.consents || profile.consents.introductions !== true) {
    return err(res, 403, ERROR_CODES.CONSENT_REQUIRED,
      'This profile has not opted into introductions.');
  }
  if (profile.consentSettings?.paused) {
    return err(res, 403, ERROR_CODES.CONSENT_REQUIRED,
      'Discovery is paused on this profile. Unpause to carry a beacon.');
  }

  // One active beacon per member at a time. The partial unique index is the
  // real enforcer (races included); the pre-check gives the friendly 409.
  if (getActiveBeacon(profile.id)) {
    return err(res, 409, ERROR_CODES.CONFLICT_STATE,
      'You already have an active beacon. Withdraw it before carrying a new one.');
  }

  let rawText;
  let cardId = null;
  if (req.body.source === 'deck_draw') {
    const card = getSyncCard(String(req.body.cardId).trim());
    if (!card) {
      return validationErr(res, [{ field: 'cardId', message: 'cardId does not match a deck card' }]);
    }
    rawText = card.word;
    cardId = card.id;
  } else {
    rawText = String(req.body.text).trim();
  }
  const normalizedText = normalizeBeaconText(rawText);
  if (!normalizedText) {
    return validationErr(res, [{ field: 'text', message: 'text must contain at least one letter or number' }]);
  }

  try {
    const { beacon, match, introduction } = createBeaconWithMatch({
      profileId: profile.id,
      source: req.body.source,
      rawText,
      normalizedText,
      cardId,
      intentionType: req.body.intentionType || null,
    });
    return res.status(201).json({
      beacon: toWireBeacon(beacon),
      // Null when nobody else is carrying the same word right now.
      match: match ? {
        id: match.id,
        status: match.status,
        sharedWord: normalizedText,
        introductionId: match.introductionId,
        introduction: toWireIntroduction(introduction),
        framing: REFLECTIVE_FRAMING,
      } : null,
    });
  } catch (e) {
    // Belt-and-suspenders: UNIQUE race on the active-beacon index.
    if (String(e && e.message).includes('UNIQUE')) {
      return err(res, 409, ERROR_CODES.CONFLICT_STATE,
        'You already have an active beacon. Withdraw it before carrying a new one.');
    }
    throw e;
  }
});

/** The caller's own beacons: active plus history. Nobody else's. */
app.get('/api/sync/beacons/mine', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  res.json({ beacons: listBeaconsFor(profile.id).map(toWireBeacon) });
});

/** Withdraw the caller's active beacon. Withdrawing is consequence-free. */
app.post('/api/sync/beacons/mine/withdraw', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const beacon = withdrawActiveBeacon(profile.id);
  if (!beacon) {
    return err(res, 404, ERROR_CODES.NOT_FOUND,
      'You do not have an active beacon to withdraw.');
  }
  res.json({ beacon: toWireBeacon(beacon) });
});

/**
 * The caller's beacon matches. The counterpart's beacon text appears only
 * inside the shared introduction's note (proposal stage), never as a raw
 * beacon row; otherBeacon exposes just the profile id and the shared word.
 */
app.get('/api/sync/matches/mine', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const matches = listBeaconMatchesFor(profile.id).map((m) => {
    const a = getBeacon(m.beaconAId);
    const b = getBeacon(m.beaconBId);
    const mine = a && a.profileId === profile.id ? a : b;
    const other = mine === a ? b : a;
    const intro = m.introductionId ? getIntroduction(m.introductionId) : null;
    return {
      id: m.id,
      status: m.status,
      sharedWord: (other || mine)?.normalizedText || '',
      otherProfileId: other ? other.profileId : null,
      introductionId: m.introductionId,
      introduction: toWireIntroduction(intro),
      proposedAt: m.proposedAt,
      framing: REFLECTIVE_FRAMING,
    };
  });
  res.json({ matches });
});

/**
 * Host-only expiry sweep: marks past-expiry beacons 'expired' and closes
 * proposed matches whose beacons expired. There is no cron; expiry is also
 * handled lazily on every beacon read (see expireStaleBeacons), so this is
 * a tidy-up pass a host can run, not a correctness dependency.
 */
app.post('/api/sync/sweep', (req, res) => {
  if (!requireHost(req, res)) return;
  res.json({ swept: expireStaleBeacons(null) });
});

// ---------- guide (rule-based connection guide) ----------

function guideSessionView(session, profile) {
  const parsed = { ...session.parsed, requestText: session.requestText };
  const questions = selectFollowUps(parsed, profile)
    .filter((q) => !(q.id in session.answers));
  return {
    id: session.id,
    requestText: session.requestText,
    parsed,
    answers: session.answers,
    questions,
    status: session.status,
    createdAt: session.createdAt,
  };
}

/** Shared proposal deps: candidate pool, gates, and privacy-safe views. */
function proposalDeps(profile) {
  const passed = getPassedIds(profile.id);
  const blockedIds = new Set(
    db.prepare('SELECT blocked_id AS id FROM blocks WHERE blocker_id = ? UNION SELECT blocker_id AS id FROM blocks WHERE blocked_id = ?')
      .all(profile.id, profile.id).map((r) => r.id),
  );
  return {
    candidates: listCandidateProfiles(),
    blockedIds,
    passedIds: new Set(passed),
    existingPairKeys: getNonWithdrawnPairKeys(),
    visibleProfile: (id, viewerId) => getVisibleProfile(id, viewerId),
    // Bilateral reasons: candidate shared text comes only from their
    // active, share-approved brief — never private notes, never drafts.
    getCandidateSharedText: (candidateId) => {
      const b = getBriefByProfile(candidateId);
      return (b && b.status === 'active' && b.consent_share) ? b.shared_text : '';
    },
  };
}

/**
 * Group-first recommendation (Flourishing). Sensitive contexts (grief,
 * trauma, vulnerability keywords) nudge toward a group first; otherwise a
 * direct introduction. Adds two NEW fields per proposal —
 * firstStepSuggestion ('group'|'direct') and firstStepSuggestionCopy — from
 * match.js's suggestFirstStep(). The existing suggestedFirstStep string
 * (built by guide.js's buildProposals) is left untouched.
 */
function withFirstStepSuggestion(proposals, intentionText) {
  const rec = suggestFirstStep(intentionText || '');
  return proposals.map((p) => ({
    ...p,
    firstStepSuggestion: rec.firstStep,
    firstStepSuggestionCopy: rec.copy,
  }));
}

function guideProposals(profile, session) {
  const parsed = { ...session.parsed, requestText: session.requestText };
  const myBrief = getBriefByProfile(profile.id);
  const proposals = buildProposals(profile, parsed, session.answers, {
    ...proposalDeps(profile),
    // The requester's stated offer grounds the candidate-side reason.
    requesterOffer: (myBrief && myBrief.offer_text) || session.answers.offer || '',
  });
  const intentionText = (myBrief && myBrief.intention_text) || session.requestText || '';
  return withFirstStepSuggestion(proposals, intentionText);
}

/**
 * Proposals for an approved brief, regenerated on demand from the brief's
 * own words — no guide session needed, so the brief review screen can
 * restore suggestions after a reload. The engine is deterministic, so
 * results are stable across loads.
 */
function briefProposals(profile, brief) {
  const parsed = parseIntent(
    [brief.intention_text, brief.good_fit_text].filter(Boolean).join('\n'),
  );
  const proposals = buildProposals(profile, parsed, {}, {
    ...proposalDeps(profile),
    requesterOffer: brief.offer_text || '',
  });
  return withFirstStepSuggestion(proposals, brief.intention_text || '');
}

app.post('/api/guide/sessions', (req, res) => {
  const { ok, errors } = validateGuideStart(req.body);
  if (!ok) return validationErr(res, errors);
  const profile = requireProfile(req, res);
  if (!profile) return null;

  const text = String(req.body.text).trim();
  const parsed = parseIntent(text);
  const session = createGuideSession({ profileId: profile.id, requestText: text, parsed });
  res.status(201).json({ session: guideSessionView(session, profile) });
});

app.post('/api/guide/sessions/:id/answer', (req, res) => {
  const { ok, errors } = validateGuideAnswer(req.body);
  if (!ok) return validationErr(res, errors);
  const profile = requireProfile(req, res);
  if (!profile) return null;

  const sessionId = parseId(req.params.id);
  const session = sessionId === null ? null : getGuideSession(sessionId);
  if (!session) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Guide session not found.');
  if (session.profileId !== profile.id) {
    return err(res, 403, ERROR_CODES.FORBIDDEN, 'This guide session belongs to another profile.');
  }
  if (session.status === 'complete') {
    return err(res, 409, ERROR_CODES.CONFLICT_STATE, 'This guide session is already complete.');
  }

  const questionId = String(req.body.questionId).trim();
  const def = getQuestionDef(questionId);
  if (!def) return err(res, 400, ERROR_CODES.VALIDATION_ERROR, `Unknown question: ${questionId}.`);

  const view = guideSessionView(session, profile);
  let answers;
  try {
    answers = answerQuestion({ answers: session.answers, questions: view.questions }, questionId, req.body.value);
  } catch (e) {
    return err(res, 400, ERROR_CODES.VALIDATION_ERROR, e.message);
  }
  const updated = updateGuideSession(session.id, { answers });

  const remaining = remainingQuestions({ answers, questions: view.questions });
  if (remaining.length === 0) {
    const done = updateGuideSession(session.id, { status: 'complete' });
    // Consent-first: proposals only unlock after the requester has an active,
    // consent-saved connection brief. Before approval the array stays empty
    // (the dedicated GET /api/guide/proposals enforces the same gate).
    const brief = getBriefByProfile(profile.id);
    const briefActive = !!(brief && brief.status === 'active' && brief.consent_save);
    const proposals = briefActive ? guideProposals(profile, done) : [];
    return res.json({
      complete: true,
      session: guideSessionView(done, profile),
      proposals,
    });
  }
  res.json({ complete: false, session: guideSessionView(updated, profile) });
});

app.get('/api/guide/sessions/:id', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return null;
  const sessionId = parseId(req.params.id);
  const session = sessionId === null ? null : getGuideSession(sessionId);
  if (!session) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Guide session not found.');
  if (session.profileId !== profile.id) {
    return err(res, 403, ERROR_CODES.FORBIDDEN, 'This guide session belongs to another profile.');
  }
  res.json({ session: guideSessionView(session, profile) });
});

// --- connection briefs (consent-first, one per profile) ---

function requireBrief(req, res) {
  const profile = requireProfile(req, res);
  if (!profile) return null;
  const brief = getBrief(parseId(req.params.id));
  if (!brief) {
    err(res, 404, ERROR_CODES.NOT_FOUND, 'Brief not found.');
    return null;
  }
  if (brief.profile_id !== profile.id) {
    err(res, 403, ERROR_CODES.FORBIDDEN, 'This brief belongs to another profile.');
    return null;
  }
  return { profile, brief };
}

/** Create (or replace) the profile's draft brief from a completed guide session. */
app.post('/api/briefs', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const sessionId = parseId(req.body?.sessionId);
  const session = sessionId === null ? null : getGuideSession(sessionId);
  if (!session || session.profileId !== profile.id || session.status !== 'complete') {
    return err(res, 404, ERROR_CODES.NOT_FOUND,
      'Guide session not found, not yours, or not complete.');
  }
  const { ok, errors } = validateBriefDraft(buildBriefDraft(profile, session));
  if (!ok) return validationErr(res, errors); // defensive: drafts are server-generated
  const replaced = !!getBriefByProfile(profile.id);
  const brief = upsertDraftBrief(profile.id, buildBriefDraft(profile, session));
  res.status(replaced ? 200 : 201).json({ brief });
});

app.get('/api/briefs/mine', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  res.json({ brief: getBriefByProfile(profile.id) });
});

app.patch('/api/briefs/:id', (req, res) => {
  const found = requireBrief(req, res);
  if (!found) return;
  const { brief } = found;
  if (brief.status !== 'draft' && brief.status !== 'active') {
    return err(res, 409, ERROR_CODES.CONFLICT_STATE,
      `A ${brief.status} brief cannot be edited. Resume it first.`);
  }
  const { ok, errors } = validateBriefUpdate(req.body);
  if (!ok) return validationErr(res, errors);
  // Editing an active brief keeps it active.
  res.json({ brief: updateBrief(brief.id, req.body) });
});

app.post('/api/briefs/:id/approve', (req, res) => {
  const found = requireBrief(req, res);
  if (!found) return;
  const { brief } = found;
  if (brief.status === 'withdrawn') {
    return err(res, 409, ERROR_CODES.CONFLICT_STATE,
      'A withdrawn brief cannot be approved.');
  }
  const { ok, errors } = validateBriefApprove(req.body);
  if (!ok) return validationErr(res, errors);
  res.json({
    brief: approveBrief(brief.id, {
      sharedText: req.body.shared_text,
      consentShare: req.body.consent_share === true,
    }),
  });
});

function briefStatusTransition(to, fromStatuses, conflictMessage) {
  return (req, res) => {
    const found = requireBrief(req, res);
    if (!found) return;
    const { brief } = found;
    if (brief.status === to) return res.json({ brief });
    if (!fromStatuses.includes(brief.status)) {
      return err(res, 409, ERROR_CODES.CONFLICT_STATE, conflictMessage);
    }
    let next = to;
    if (to === 'resume-target') {
      // resume: back to active only when the brief was approved for saving.
      next = brief.consent_save ? 'active' : 'draft';
    }
    res.json({ brief: setBriefStatus(brief.id, next) });
  };
}

app.post('/api/briefs/:id/pause',
  briefStatusTransition('paused', ['draft', 'active'],
    'Only a draft or active brief can be paused.'));
app.post('/api/briefs/:id/resume',
  briefStatusTransition('resume-target', ['paused'],
    'Only a paused brief can be resumed.'));
app.post('/api/briefs/:id/withdraw',
  briefStatusTransition('withdrawn', ['draft', 'active', 'paused'],
    'This brief is already withdrawn.'));

/**
 * Bilateral proposals for a completed guide session. Gated: the profile must
 * hold an ACTIVE brief with consent_save, otherwise 403 — proposals are only
 * computed for people who have opted into being matched right now.
 */
app.get('/api/guide/proposals', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const sessionId = parseId(req.query.sessionId);
  const session = sessionId === null ? null : getGuideSession(sessionId);
  if (!session || session.profileId !== profile.id) {
    return err(res, 404, ERROR_CODES.NOT_FOUND, 'Guide session not found.');
  }
  const brief = getBriefByProfile(profile.id);
  if (!brief || brief.status !== 'active' || !brief.consent_save) {
    return err(res, 403, ERROR_CODES.CONSENT_REQUIRED,
      'An active connection brief with saved consent is required to see proposals.');
  }
  res.json({ proposals: guideProposals(profile, session) });
});

/**
 * Proposals for an approved connection brief. Gated: the brief must belong
 * to the requester, be ACTIVE, and hold consent_save. Regenerated from the
 * brief's own words on every call — no guide session required, so the
 * brief review screen restores suggestions after a reload.
 */
app.get('/api/briefs/:id/proposals', (req, res) => {
  const found = requireBrief(req, res);
  if (!found) return;
  const { profile, brief } = found;
  if (brief.status !== 'active' || !brief.consent_save) {
    return err(res, 403, ERROR_CODES.CONSENT_REQUIRED,
      'An active connection brief with saved consent is required to see proposals.');
  }
  res.json({ proposals: briefProposals(profile, brief) });
});

// ---------- conversational guide chat ----------
//
// The same scripted guide engine (src/guide.js) as a chat thread. Bot
// messages are built by pure helpers in src/chat.js; this layer owns the
// transcript, stage machine, and brief/proposal gating.
//
// Consent rule, same as GET /api/briefs/:id/proposals: proposals are only
// computed for an ACTIVE brief with consent_save. The brief-review stage
// never computes proposals.

const TRANSCRIPT_CAP = 60;

function chatSessionView(session) {
  return { id: session.id, stage: session.stage };
}

const botText = (text) => ({ role: 'bot', kind: 'text', text });

/**
 * The optional real-life completion prompt (GUIDE_BEHAVIOR_RULES §9) as a
 * message array — empty when the context is not a natural conversation
 * conclusion. Answering or skipping it never gates progress: it is purely
 * informational. realLifePrompt() returns a fresh object per call.
 */
function maybeRealLifePrompt(context) {
  const prompt = realLifePrompt(context);
  return prompt ? [prompt] : [];
}

/**
 * The real-life completion prompt as a response field for introduction
 * accept payloads. Empty object when the context does not apply (skip
 * silently). Exposed on the response rather than posted into the message
 * thread: the thread has an exact-count contract (warm-intro on accept,
 * nothing on decline) asserted by existing tests, so the prompt rides the
 * accept response instead — the frontend renders it from there. The guide's
 * real_life_prompt card keys "introduction in context" off
 * msg.introductionId, so the id is attached when known.
 */
function realLifePromptField(introductionId = null) {
  const prompt = realLifePrompt('introduction_accepted');
  if (!prompt) return {};
  return { realLifePrompt: { ...prompt, ...(introductionId === null ? {} : { introductionId }) } };
}

/** Materialized follow-up questions for a chat session's guide session. */
function chatGuideQuestions(profile, gs) {
  return selectFollowUps({ ...(gs.parsed || {}), requestText: gs.requestText }, profile);
}

/** Quick-reply chips for single/multi questions (label taps), or undefined. */
// Suggestions are writing prompts, never multiple choice: the question's
// options render as tappable prompts that fill the composer, so there are
// no auto-send option quick replies.

function chatTurnError(status, code, message) {
  return { error: { status, code, message } };
}

/**
 * Finish the guide flow: mark the guide session complete, build/replace the
 * draft brief, and move the chat to brief_review.
 */
function finishGuideChat(profile, session, gs) {
  const done = updateGuideSession(gs.id, { status: 'complete' });
  const draft = buildBriefDraft(profile, {
    ...gs,
    requestText: gs.requestText,
    parsed: gs.parsed,
    answers: done.answers,
  });
  const brief = upsertDraftBrief(profile.id, draft);
  return {
    patch: { stage: 'brief_review', briefId: brief.id, pendingQuestionId: null, pendingField: null },
    messages: [briefMessage(brief)],
    quickReplies: APPROVE_QUICK_REPLIES,
    brief: publicBrief(brief),
  };
}

/** 'seeking' stage: turn the request into a guide session + first question. */
function chatHandleSeeking(profile, session, text) {
  if (text.length < 10) {
    return {
      messages: [botText('Share a little more, a sentence or two, so I can guide you well.')],
    };
  }
  const parsed = parseIntent(text);
  const gs = createGuideSession({ profileId: profile.id, requestText: text, parsed });
  const qs = chatGuideQuestions(profile, gs);
  if (qs.length === 0) return finishGuideChat(profile, session, gs);
  return {
    patch: { guideSessionId: gs.id, stage: 'followup', pendingQuestionId: qs[0].id },
    messages: [botText('Thank you. I hear you.'), questionMessage(qs[0])],
  };
}

/** Advance after an answer was recorded; ask the next question or finish. */
function chatAdvanceFollowup(profile, session, gs, answers) {
  const updated = updateGuideSession(gs.id, { answers });
  const remaining = chatGuideQuestions(profile, updated).filter((q) => !(q.id in answers));
  if (remaining.length === 0) return finishGuideChat(profile, session, updated);
  return {
    patch: { pendingQuestionId: remaining[0].id },
    messages: [questionMessage(remaining[0])],
  };
}

/** 'followup' stage: answer (or skip) the pending question. */
function chatHandleFollowup(profile, session, text) {
  const gs = session.guideSessionId ? getGuideSession(session.guideSessionId) : null;
  if (!gs) return chatTurnError(404, ERROR_CODES.NOT_FOUND, 'Guide session not found.');
  const questions = chatGuideQuestions(profile, gs);
  const q = questions.find((qq) => qq.id === session.pendingQuestionId);
  if (!q) {
    return chatTurnError(400, ERROR_CODES.VALIDATION_ERROR,
      'This question is no longer open.');
  }
  let answers;
  try {
    if (isSkipText(text)) {
      if (q.skippable === false) {
        return {
          messages: [
            botText('This one needs an answer. Write whatever feels closest, or tap a suggestion below.'),
            questionMessage(q),
          ],

        };
      }
      answers = answerQuestion({ answers: gs.answers, questions }, q.id, null);
    } else if (q.type === 'free') {
      answers = answerQuestion({ answers: gs.answers, questions }, q.id, text);
    } else {
      const matched = matchOptions(text, q);
      if (!matched || matched.length === 0) {
        return {
          messages: [
            botText("I didn't quite catch that. Try tapping a suggestion, or write it in your own words."),
            questionMessage(q),
          ],

        };
      }
      const value = q.type === 'single' ? matched[0] : matched;
      answers = answerQuestion({ answers: gs.answers, questions }, q.id, value);
    }
  } catch (e) {
    return chatTurnError(400, ERROR_CODES.VALIDATION_ERROR, e.message);
  }
  return chatAdvanceFollowup(profile, session, gs, answers);
}

/** 'brief_review' stage: approve, edit, or start over. */
function chatHandleBriefReview(profile, session, text) {
  const kind = classifyReviewText(text);
  if (kind === 'approve') {
    const b = session.briefId ? getBrief(session.briefId) : null;
    if (!b) return chatTurnError(404, ERROR_CODES.NOT_FOUND, 'Brief not found.');
    if (!(b.shared_text || '').trim()) {
      return {
        messages: [botText(
          'Your brief needs the "exact text" section filled in. You can add it on the brief page, or tell me here and I\'ll add it.',
        )],
      };
    }
    // Consent-first: approval sets consent_save + consent_share explicitly.
    const approved = approveBrief(b.id, { sharedText: b.shared_text, consentShare: true });
    return {
      patch: { stage: 'proposals', pendingQuestionId: null, pendingField: null },
      messages: [
        botText(
          'Your brief is approved. Only your exact approved text will ever be shown to another person. Let me look for gentle fits…',
        ),
        // Real-life completion (GUIDE_BEHAVIOR_RULES §9): optional and
        // skippable — answering or ignoring it never gates progress.
        ...maybeRealLifePrompt('brief_approved'),
      ],
      proposals: briefProposals(profile, approved),
      brief: publicBrief(approved),
      quickReplies: ['Start a new brief'],
    };
  }
  if (kind === 'edit') {
    const field = detectEditField(text);
    if (!field) {
      return {
        messages: [botText('Which part would you like to change?')],
        quickReplies: ['Intention', 'What I offer', 'Boundaries', 'Who I am', 'Logistics'],
      };
    }
    return {
      patch: { stage: 'editing', pendingField: field },
      messages: [botText(`How would you like "${fieldLabel(field)}" to read?`)],
    };
  }
  if (kind === 'startover') {
    return {
      patch: {
        stage: 'seeking', guideSessionId: null, briefId: null,
        pendingQuestionId: null, pendingField: null,
      },
      messages: [
        botText('Let\'s begin again, fresh.'),
        botText('Who, or what kind of connection, would feel meaningful right now?'),
      ],
      quickReplies: STARTERS.map((label) => ({ label, fill: true })),
    };
  }
  return {
    messages: [botText(
      'I can help you finish your brief. Say "looks good" when it\'s ready, or tell me what to change.',
    )],
    quickReplies: APPROVE_QUICK_REPLIES,
  };
}

/** 'editing' stage: apply a rewrite to one brief field, or cancel. */
function chatHandleEditing(profile, session, text) {
  if (/cancel|never mind/i.test(text)) {
    const b = session.briefId ? getBrief(session.briefId) : null;
    if (!b) return chatTurnError(404, ERROR_CODES.NOT_FOUND, 'Brief not found.');
    return {
      patch: { stage: 'brief_review', pendingField: null },
      messages: [briefMessage(b)],
      quickReplies: APPROVE_QUICK_REPLIES,
    };
  }
  if (!session.pendingField) {
    return chatTurnError(400, ERROR_CODES.VALIDATION_ERROR,
      'There is nothing to edit right now.');
  }
  const b = session.briefId ? getBrief(session.briefId) : null;
  if (!b) return chatTurnError(404, ERROR_CODES.NOT_FOUND, 'Brief not found.');
  const brief = updateBrief(b.id, { [session.pendingField]: text });
  if (!brief) {
    return chatTurnError(400, ERROR_CODES.VALIDATION_ERROR,
      'That change could not be saved.');
  }
  return {
    patch: { stage: 'brief_review', pendingField: null },
    messages: [botText('Updated. Here is your brief now:'), briefMessage(brief)],
    quickReplies: APPROVE_QUICK_REPLIES,
  };
}

/** Whether an active brief currently yields any proposal cards. Never throws:
 *  a failure to compute proposals is treated as "none", never as cards. */
function hasActiveProposals(profile, brief) {
  try {
    return !!(brief && brief.status === 'active' && briefProposals(profile, brief).length);
  } catch {
    return false;
  }
}

/** 'proposals' stage: proposals are already shown; offer a fresh start. */
function chatHandleProposals(profile, session, text) {
  if (/start a new brief|start over|new brief/i.test(text)) {
    return {
      patch: { stage: 'confirm_replace' },
      messages: [botText('Starting fresh will replace your current brief. Are you sure?')],
      quickReplies: ['Yes, start fresh', 'Keep my brief'],
    };
  }
  const brief = session.briefId ? getBrief(session.briefId) : getBriefByProfile(profile.id);
  return {
    messages: [botText(proposalsStageText(hasActiveProposals(profile, brief)))],
    quickReplies: ['Start a new brief'],
  };
}

/** 'confirm_replace' stage: confirm dropping the current brief. */
function chatHandleConfirmReplace(profile, session, text) {
  if (/yes|start fresh/i.test(text)) {
    return {
      patch: {
        stage: 'seeking', guideSessionId: null, briefId: null,
        pendingQuestionId: null, pendingField: null,
      },
      messages: [
        botText('Fresh start it is.'),
        botText('Who, or what kind of connection, would feel meaningful right now?'),
      ],
      quickReplies: STARTERS.map((label) => ({ label, fill: true })),
    };
  }
  const keepBrief = session.briefId ? getBrief(session.briefId) : getBriefByProfile(profile.id);
  const keepHas = hasActiveProposals(profile, keepBrief);
  return {
    patch: { stage: 'proposals' },
    messages: [botText(
      keepHas
        ? 'Keeping your brief as it is. Your suggestions are just above.'
        : `Keeping your brief as it is. ${NO_SUGGESTIONS_TEXT}`,
    )],
  };
}

/** 'resume_offer' stage: review the existing draft, or start fresh. */
function chatHandleResumeOffer(profile, session, text) {
  if (/review|draft/i.test(text)) {
    const brief = getBriefByProfile(profile.id);
    if (!brief) return chatTurnError(404, ERROR_CODES.NOT_FOUND, 'Brief not found.');
    return {
      patch: { stage: 'brief_review', briefId: brief.id },
      messages: [briefMessage(brief)],
      quickReplies: APPROVE_QUICK_REPLIES,
    };
  }
  // Treat as fresh seeking text; the stored draft is replaced when the
  // guide flow completes.
  return chatHandleSeeking(profile, session, text);
}

/**
 * Append a chat turn to the transcript (capped), persist the stage patch,
 * and shape the response.
 */
function commitChatTurn(session, userEntry, turn) {
  const transcript = [...(session.transcript || []), userEntry, ...turn.messages].slice(-TRANSCRIPT_CAP);
  const updated = updateChatSession(session.id, { ...(turn.patch || {}), transcript });
  const body = { session: chatSessionView(updated), messages: turn.messages };
  if (turn.quickReplies !== undefined) body.quickReplies = turn.quickReplies;
  if (turn.proposals !== undefined) body.proposals = turn.proposals;
  if (turn.brief !== undefined) body.brief = turn.brief;
  return body;
}

/**
 * Start a chat. Resumes the right place: an ACTIVE brief jumps to proposals,
 * a DRAFT brief offers review-or-fresh, otherwise a fresh greeting.
 */
app.post('/api/chat/start', (req, res) => {
  const { ok, errors } = validateChatStart(req.body);
  if (!ok) return validationErr(res, errors);
  const profile = requireProfile(req, res);
  if (!profile) return;

  const brief = getBriefByProfile(profile.id);
  if (brief && brief.status === 'active') {
    const gated = brief.status === 'active' && brief.consent_save;
    const proposals = gated ? briefProposals(profile, brief) : [];
    const firstName = String(profile.name || 'friend').trim().split(/\s+/)[0] || 'friend';
    const welcomeName = firstName.toLowerCase() === 'friend' ? '' : `, ${firstName}`;
    const messages = [botText(
      proposals.length > 0
        ? `Welcome back${welcomeName}. Your brief is active. Here are your current suggestions.`
        : `Welcome back${welcomeName}. Your brief is active. ${NO_SUGGESTIONS_TEXT}`,
    )];
    const session = createChatSession({
      profileId: profile.id, stage: 'proposals', briefId: brief.id, transcript: messages,
    });
    return res.status(201).json({
      session: chatSessionView(session),
      messages,
      quickReplies: ['Start a new brief'],
      proposals,
      brief: publicBrief(brief),
    });
  }
  if (brief && brief.status === 'draft') {
    const messages = [botText(
      'Welcome back. You have a draft brief we haven\'t finished. Want to review it, or start fresh?',
    )];
    const session = createChatSession({
      profileId: profile.id, stage: 'resume_offer', briefId: brief.id, transcript: messages,
    });
    return res.status(201).json({
      session: chatSessionView(session),
      messages,
      quickReplies: ['Review my draft', 'Start fresh'],
    });
  }
  const messages = greetingMessages(profile);
  const session = createChatSession({
    profileId: profile.id, stage: 'seeking', transcript: messages,
  });
  return res.status(201).json({
    session: chatSessionView(session),
    messages,
    quickReplies: STARTERS.map((label) => ({ label, fill: true })),
  });
});

/**
 * Run one turn of the standard guide stage machine
 * (seeking -> follow-ups -> brief review -> proposals).
 * @returns {object} turn result, or {error:{status,code,message}}
 */
function runChatTurn(profile, session, text) {
  switch (session.stage) {
    case 'seeking': return chatHandleSeeking(profile, session, text);
    case 'followup': return chatHandleFollowup(profile, session, text);
    case 'brief_review': return chatHandleBriefReview(profile, session, text);
    case 'editing': return chatHandleEditing(profile, session, text);
    case 'proposals': return chatHandleProposals(profile, session, text);
    case 'confirm_replace': return chatHandleConfirmReplace(profile, session, text);
    case 'resume_offer': return chatHandleResumeOffer(profile, session, text);
    default:
      return chatTurnError(400, ERROR_CODES.VALIDATION_ERROR,
        'This chat session is in an unknown state.');
  }
}

/**
 * Stage context for resuming a chat that already has a profile: the pending
 * question, the brief under review, and/or the current proposals, so the
 * frontend can rebuild the thread after a reload.
 */
function chatResumeContext(profile, session) {
  const body = {};
  if (session.stage === 'followup' && session.pendingQuestionId && session.guideSessionId) {
    const gs = getGuideSession(session.guideSessionId);
    if (gs) {
      const q = chatGuideQuestions(profile, gs).find((qq) => qq.id === session.pendingQuestionId);
      if (q) body.question = questionMessage(q);
    }
  }
  if ((session.stage === 'brief_review' || session.stage === 'editing') && session.briefId) {
    const brief = getBrief(session.briefId);
    if (brief) body.brief = publicBrief(brief);
  }
  if (session.stage === 'proposals') {
    const brief = session.briefId ? getBrief(session.briefId) : getBriefByProfile(profile.id);
    if (brief) {
      if (brief.status === 'active' && brief.consent_save) {
        body.proposals = briefProposals(profile, brief);
      }
      body.brief = publicBrief(brief);
    }
  }
  return body;
}

app.post('/api/chat/message', (req, res) => {
  const { ok, errors } = validateChatMessage(req.body);
  if (!ok) return validationErr(res, errors);
  const profile = requireProfile(req, res);
  if (!profile) return;

  const sessionId = parseId(req.body.sessionId);
  const session = sessionId === null ? null : getChatSession(sessionId);
  if (!session) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Chat session not found.');
  if (session.profileId !== profile.id) {
    return err(res, 403, ERROR_CODES.FORBIDDEN,
      'This chat session belongs to another profile.');
  }

  const text = String(req.body.text).trim();
  const userEntry = { role: 'user', kind: 'text', text, ts: Date.now() };

  const turn = runChatTurn(profile, session, text);
  if (turn.error) {
    return err(res, turn.error.status, turn.error.code, turn.error.message);
  }
  res.json(commitChatTurn(session, userEntry, turn));
});

/**
 * Restore a chat: the full transcript plus stage-context (the pending
 * question, the brief under review, or current proposals) so the frontend
 * can rebuild the thread after a reload.
 */
/**
 * The frontend replays the resume transcript as plain bubbles and then
 * renders the current question interactively (suggestion prompts, inputs).
 * If the transcript already ends with that same question, drop the trailing
 * copy from the payload (storage keeps it) so the question never renders
 * twice. Returns the transcript to send.
 */
function trimTrailingResumeQuestion(transcript, questionId) {
  if (!questionId || !Array.isArray(transcript) || transcript.length === 0) return transcript;
  const last = transcript[transcript.length - 1];
  if (last && last.role === 'bot' && last.questionId === questionId) {
    return transcript.slice(0, -1);
  }
  return transcript;
}

app.get('/api/chat/session/:id', (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const sessionId = parseId(req.params.id);
  const session = sessionId === null ? null : getChatSession(sessionId);
  if (!session) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Chat session not found.');
  if (session.profileId !== profile.id) {
    return err(res, 403, ERROR_CODES.FORBIDDEN,
      'This chat session belongs to another profile.');
  }

  const body = { session: chatSessionView(session), transcript: session.transcript || [] };
  Object.assign(body, chatResumeContext(profile, session));
  if (body.question && body.question.questionId) {
    body.transcript = trimTrailingResumeQuestion(body.transcript, body.question.questionId);
  }
  res.json(body);
});

// ---------- conversational onboarding chat ----------
//
// Profile-less sessions: the interview collects every required profile
// field (name, email, interests, intention, seeking, values, explicit
// introductions consent) before any profile exists. On explicit consent the
// profile is created through the standard creation path and the SAME
// session continues into the guide flow (follow-ups -> brief -> proposals).
// Declining consent creates nothing and shares nothing.

const PRACTICE_VALUE_SET = new Set(PRACTICE_VALUES);

/**
 * Seed the guide flow from the intention collected during onboarding and
 * ask the first follow-up question (or finish straight to brief review).
 */
function beginGuideFromIntention(profile, session, intentionText) {
  const parsed = parseIntent(intentionText);
  const gs = createGuideSession({ profileId: profile.id, requestText: intentionText, parsed });
  const qs = chatGuideQuestions(profile, gs);
  if (qs.length === 0) return finishGuideChat(profile, session, gs);
  return {
    patch: { guideSessionId: gs.id, stage: 'followup', pendingQuestionId: qs[0].id },
    messages: [questionMessage(qs[0])],
  };
}

/**
 * Consent was given: validate, create the profile through the standard
 * path, attach it to the session, and hand the SAME session to the guide.
 */
/**
 * Reconnect this device to an existing profile from inside the onboarding
 * chat. The email matched an existing space and the member confirmed it is
 * theirs; the name they gave in the interview must match the profile's name
 * (case-insensitive), exactly like /api/auth/relink. Rotates the session
 * token and sets the HttpOnly cookie, so this device becomes authenticated.
 */
function reclaimOnboardingChat(req, res, session, userEntry, turn) {
  const email = String(turn.reclaim.email || '').trim().toLowerCase();
  const name = String(turn.reclaim.name || '').trim();
  const lookup = getProfileByEmail(email);
  const match = lookup
    && String(lookup.name).trim().toLowerCase() === name.toLowerCase();
  if (!match) {
    const body = commitChatTurn(session, userEntry, {
      messages: [botText(
        `Hmm, "${name}" doesn't match the space under that email. You can try a different email, or start over to begin fresh.`)],
      quickReplies: ['Use a different email', 'Start over'],
    });
    return res.json(body);
  }
  setProfileCookie(req, res, issueProfileToken(lookup.id));
  const first = String(lookup.name).trim().split(/\s+/)[0] || 'friend';
  const body = commitChatTurn(session, userEntry, {
    patch: { profileId: lookup.id },
    messages: [botText(`Welcome back, ${first}. This device is reconnected to your space.`)],
  });
  body.profileCreated = { profileId: lookup.id };
  body.reclaimed = true;
  return res.json(body);
}

function completeOnboardingChat(req, res, session, userEntry, turn) {
  const c = turn.create;
  const payload = {
    name: c.name,
    email: c.email,
    interests: c.interests,
    intention: c.intention,
    // The onboarding interview emits the full flourishing connectionPrefs
    // (intentions, connectionLevels, topicsOut, privacyLevel, locationRadius,
    // onlineMode, commBoundaries, syncMode); pass them through instead of
    // dropping everything but seeking/availability.
    connectionPrefs: { seeking: c.seeking, availability: '', ...c.connectionPrefs },
    consents: { introductions: true, community_visible: true, ai_matching: true },
    // Practices ride along where the legacy interest overlaps the taxonomy;
    // anything outside it stays on the legacy interests field only.
    practices: (c.interests || []).filter((i) => PRACTICE_VALUE_SET.has(i)),
    values: c.values || [],
    // Calm defaults from the interview (recFrequency etc.); validated below
    // by the v16 extractor before the legacy whitelist sees it.
    consentSettings: c.consentSettings || {},
  };
  const flourishing = extractFlourishingConsentSettings(payload);
  if (!flourishing.ok) return validationErr(res, flourishing.errors);
  const { ok, errors } = validateProfileInput(payload, { isUpdate: false });
  if (!ok) return validationErr(res, errors);
  restoreFlourishingConsentSettings(payload, flourishing.stash);
  const email = String(c.email).trim().toLowerCase();
  if (getProfileByEmail(email)) {
    return err(res, 409, ERROR_CODES.EMAIL_TAKEN,
      'That email already has a SEREN space. Please share a different email.');
  }
  const profile = createProfile(payload);
  // The new member's session starts here: issue their token cookie now so
  // every later call is bound to this profile.
  setProfileCookie(req, res, issueProfileToken(profile.id));
  const first = String(profile.name).trim().split(/\s+/)[0] || 'friend';
  const guide = beginGuideFromIntention(profile, session, c.intention);
  const body = commitChatTurn(session, userEntry, {
    patch: { profileId: profile.id, ...guide.patch },
    messages: [
      botText(
        `Your space is ready, ${first} ✦ Based on what you shared, I'll ask a few thoughtful questions, then suggest members with shared interests. Nothing is shared until you approve it.`,
      ),
      ...guide.messages,
    ],
    ...(guide.quickReplies !== undefined ? { quickReplies: guide.quickReplies } : {}),
    ...(guide.brief !== undefined ? { brief: guide.brief } : {}),
  });
  body.profileCreated = { profileId: profile.id };
  return res.status(201).json(body);
}

app.post('/api/onboarding/chat/start', (req, res) => {
  const { ok, errors } = validateOnboardingStart(req.body);
  if (!ok) return validationErr(res, errors);
  const begun = startOnboarding();
  const session = createChatSession({
    profileId: null, stage: begun.stage, onboarding: begun.answers, transcript: begun.messages,
  });
  const body = { session: chatSessionView(session), messages: begun.messages };
  const qr = quickRepliesForStage(begun.stage);
  if (qr) body.quickReplies = qr;
  return res.status(201).json(body);
});

app.post('/api/onboarding/chat/message', (req, res) => {
  const { ok, errors } = validateOnboardingMessage(req.body);
  if (!ok) return validationErr(res, errors);
  const sessionId = parseId(req.body.sessionId);
  const session = sessionId === null ? null : getChatSession(sessionId);
  if (!session) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Chat session not found.');

  const text = String(req.body.text).trim();
  const userEntry = { role: 'user', kind: 'text', text, ts: Date.now() };

  // Post-handoff: the session now belongs to a real profile — run the
  // standard guide machine so the conversation continues uninterrupted.
  if (session.profileId) {
    const profile = getProfile(session.profileId);
    if (!profile) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Profile not found.');
    const turn = runChatTurn(profile, session, text);
    if (turn.error) return err(res, turn.error.status, turn.error.code, turn.error.message);
    return res.json(commitChatTurn(session, userEntry, turn));
  }

  if (!isOnboardingStage(session.stage)) {
    return err(res, 400, ERROR_CODES.VALIDATION_ERROR,
      'This chat session is in an unknown state.');
  }
  const turn = handleOnboardingTurn(session.stage, session.onboarding || {}, text, {
    emailTaken: (email) => !!getProfileByEmail(String(email).trim().toLowerCase()),
  });
  // Inline reclaim: the interview already knows the name and the taken
  // email, so the member reconnects this device without leaving the chat.
  if (turn.reclaim) {
    return reclaimOnboardingChat(req, res, session, userEntry, turn);
  }
  if (turn.create) {
    return completeOnboardingChat(req, res, session, userEntry, turn);
  }
  return res.json(commitChatTurn(session, userEntry, {
    patch: { stage: turn.stage, onboarding: turn.answers },
    messages: turn.messages,
    ...(turn.quickReplies !== undefined ? { quickReplies: turn.quickReplies } : {}),
  }));
});

/**
 * Resume an onboarding chat: the transcript plus the current question (or
 * quick replies), or — once the profile exists — the standard stage context.
 */
app.get('/api/onboarding/chat/session/:id', (req, res) => {
  const sessionId = parseId(req.params.id);
  const session = sessionId === null ? null : getChatSession(sessionId);
  if (!session) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Chat session not found.');
  const storedTranscript = session.transcript || [];
  const resumeQ = isOnboardingStage(session.stage)
    ? questionForStage(session.stage, session.onboarding || {})
    : null;
  const transcript = resumeQ && resumeQ.kind === 'question'
    ? trimTrailingResumeQuestion(storedTranscript, resumeQ.questionId)
    : storedTranscript;
  const body = { session: chatSessionView(session), transcript };
  if (session.profileId) {
    const profile = getProfile(session.profileId);
    if (!profile) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Profile not found.');
    Object.assign(body, chatResumeContext(profile, session));
  } else if (isOnboardingStage(session.stage)) {
    const q = questionForStage(session.stage, session.onboarding || {});
    if (q && q.kind === 'question') body.question = q;
    const qr = quickRepliesForStage(session.stage);
    if (qr) body.quickReplies = qr;
  }
  return res.json(body);
});

/**
 * Reclaim a profile when the frontend loses its stored profile id.
 * Returns only the id + name on an exact (case-insensitive) email+name
 * match — never the email or any other profile field. Rotates the profile's
 * session token and sets it as an HttpOnly cookie, so the relinked device
 * becomes the authenticated session.
 */
app.post('/api/auth/relink', (req, res) => {
  const { ok, errors } = validateRelink(req.body);
  if (!ok) return validationErr(res, errors);
  const lookup = getProfileByEmail(String(req.body.email).trim().toLowerCase());
  const match = lookup
    && String(lookup.name).trim().toLowerCase() === String(req.body.name).trim().toLowerCase();
  if (match) {
    setProfileCookie(req, res, issueProfileToken(lookup.id));
    return res.json({ profileId: lookup.id, name: lookup.name });
  }
  return err(res, 404, ERROR_CODES.NOT_FOUND,
    'No profile matches that email and name.');
});

// ---------- static frontend ----------

const here = dirname(fileURLToPath(import.meta.url));
app.use(express.static(join(here, '..', 'public')));

// ---------- boot ----------

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`SEREN listening on port ${port} (db: ${process.env.DB_PATH || './data/seren.db'})`);
  });
}

export { db };
