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
} from './constants.js';
import {
  validateProfileInput, validateIntroRequest, validateConnectionRequest,
  validateRespond, validateCircleInput, validateCircleJoin,
  validateMessageInput, validateReportInput, validatePlanInput,
  validateGuideStart, validateGuideAnswer,
  validateBriefDraft, validateBriefUpdate, validateBriefApprove,
  validateChatStart, validateChatMessage, validateRelink,
  validateOnboardingStart, validateOnboardingMessage, validateAgentInput,
} from './validate.js';
import {
  startOnboarding, handleOnboardingTurn, questionForStage,
  quickRepliesForStage, isOnboardingStage,
} from './onboarding.js';
import { findBestMatch, buildIntroNote, findMatches, findAgentMatches } from './match.js';
import {
  parseIntent, selectFollowUps, answerQuestion, buildProposals,
  remainingQuestions, getQuestionDef, buildBriefDraft, buildWarmIntroMessage,
} from './guide.js';
import {
  greetingMessages, questionMessage, briefMessage, publicBrief,
  classifyReviewText, detectEditField, fieldLabel,
  matchOptions, isSkipText, STARTERS, APPROVE_QUICK_REPLIES,
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
  listMessages,
  createMessage,
  getConnectionPlan,
  upsertConnectionPlan,
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
    createdAt: intro.createdAt,
    updatedAt: intro.updatedAt,
  };
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
  });
});

// --- profiles ---

app.post('/api/profiles', (req, res) => {
  const { ok, errors } = validateProfileInput(req.body, { isUpdate: false });
  if (!ok) return validationErr(res, errors);

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

  const { ok, errors } = validateProfileInput(req.body, { isUpdate: true });
  if (!ok) return validationErr(res, errors);

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
  }

  res.json(toWireIntroduction(updated));
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
    // A decline is durable: the recipient will not receive further direct
    // requests from this requester unless they later choose to allow them.
    if (targetStatus === 'declined') {
      recordDeclineBlock(intro.proposedId, intro.requesterId);
    }
    res.json(toWireIntroduction(updated));
  };
}

app.post('/api/introductions/:id/accept', transition('accepted', 'proposed'));
app.post('/api/introductions/:id/decline', transition('declined', 'proposed'));
app.post('/api/introductions/:id/withdraw', transition('withdrawn', 'requester'));

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

// ---------- guide (AI-superconnector flow) ----------

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

function guideProposals(profile, session) {
  const parsed = { ...session.parsed, requestText: session.requestText };
  const myBrief = getBriefByProfile(profile.id);
  return buildProposals(profile, parsed, session.answers, {
    ...proposalDeps(profile),
    // The requester's stated offer grounds the candidate-side reason.
    requesterOffer: (myBrief && myBrief.offer_text) || session.answers.offer || '',
  });
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
  return buildProposals(profile, parsed, {}, {
    ...proposalDeps(profile),
    requesterOffer: brief.offer_text || '',
  });
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

/** Materialized follow-up questions for a chat session's guide session. */
function chatGuideQuestions(profile, gs) {
  return selectFollowUps({ ...(gs.parsed || {}), requestText: gs.requestText }, profile);
}

/** Quick-reply chips for single/multi questions (label taps), or undefined. */
function questionQuickReplies(q) {
  if (!q || (q.type !== 'single' && q.type !== 'multi')) return undefined;
  return (q.options || []).map((o) => o.label);
}

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
      messages: [botText('Share a little more — a sentence or two — so I can guide you well.')],
    };
  }
  const parsed = parseIntent(text);
  const gs = createGuideSession({ profileId: profile.id, requestText: text, parsed });
  const qs = chatGuideQuestions(profile, gs);
  if (qs.length === 0) return finishGuideChat(profile, session, gs);
  return {
    patch: { guideSessionId: gs.id, stage: 'followup', pendingQuestionId: qs[0].id },
    messages: [botText('Thank you — I hear you.'), questionMessage(qs[0])],
    quickReplies: questionQuickReplies(qs[0]),
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
    quickReplies: questionQuickReplies(remaining[0]),
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
            botText('This one needs an answer — pick whatever feels closest.'),
            questionMessage(q),
          ],
          quickReplies: questionQuickReplies(q) || [],
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
            botText("I didn't quite catch that — which of these fits best?"),
            questionMessage(q),
          ],
          quickReplies: questionQuickReplies(q) || [],
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
          'Your brief needs the "exact text" section filled in — you can add it on the brief page, or tell me here and I\'ll add it.',
        )],
      };
    }
    // Consent-first: approval sets consent_save + consent_share explicitly.
    const approved = approveBrief(b.id, { sharedText: b.shared_text, consentShare: true });
    return {
      patch: { stage: 'proposals', pendingQuestionId: null, pendingField: null },
      messages: [botText(
        'Your brief is approved. Only your exact approved text will ever be shown to another person. Let me look for gentle fits…',
      )],
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
        botText('Who — or what kind of connection — would feel meaningful right now?'),
      ],
      quickReplies: STARTERS,
    };
  }
  return {
    messages: [botText(
      'I can help you finish your brief — say "looks good" when it\'s ready, or tell me what to change.',
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

/** 'proposals' stage: proposals are already shown; offer a fresh start. */
function chatHandleProposals(profile, session, text) {
  if (/start a new brief|start over|new brief/i.test(text)) {
    return {
      patch: { stage: 'confirm_replace' },
      messages: [botText('Starting fresh will replace your current brief. Are you sure?')],
      quickReplies: ['Yes, start fresh', 'Keep my brief'],
    };
  }
  return {
    messages: [botText(
      'Your suggestions are just above — tap "Request introduction" on any card that feels aligned, or "Not now" to set it aside. I can also start a new brief whenever you like.',
    )],
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
        botText('Who — or what kind of connection — would feel meaningful right now?'),
      ],
      quickReplies: STARTERS,
    };
  }
  return {
    patch: { stage: 'proposals' },
    messages: [botText('Keeping your brief as it is — your suggestions are just above.')],
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
    const messages = [botText(
      `Welcome back${firstName.toLowerCase() === 'friend' ? '' : `, ${firstName}`}. Your brief is active — here are your current suggestions.`,
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
      'Welcome back. You have a draft brief we haven\'t finished — want to review it, or start fresh?',
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
    quickReplies: STARTERS,
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
    quickReplies: questionQuickReplies(qs[0]),
  };
}

/**
 * Consent was given: validate, create the profile through the standard
 * path, attach it to the session, and hand the SAME session to the guide.
 */
function completeOnboardingChat(req, res, session, userEntry, turn) {
  const c = turn.create;
  const payload = {
    name: c.name,
    email: c.email,
    interests: c.interests,
    intention: c.intention,
    connectionPrefs: { seeking: c.seeking, availability: '' },
    consents: { introductions: true, community_visible: true, ai_matching: true },
    // Practices ride along where the legacy interest overlaps the taxonomy;
    // anything outside it stays on the legacy interests field only.
    practices: (c.interests || []).filter((i) => PRACTICE_VALUE_SET.has(i)),
    values: c.values || [],
  };
  const { ok, errors } = validateProfileInput(payload, { isUpdate: false });
  if (!ok) return validationErr(res, errors);
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
        `Your space is ready, ${first} ✦ Based on what you shared, I'll ask a few thoughtful questions, then suggest members with shared interests — nothing is shared until you approve it.`,
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
  const body = { session: chatSessionView(session), transcript: session.transcript || [] };
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
