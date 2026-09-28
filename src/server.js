// SEREN — express API server.
// Endpoints, shapes, and status codes per docs/API_CONTRACT.md.

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import express from 'express';
import {
  ERROR_CODES, VALID_TRANSITIONS, INTRO_STATUS, RESPONSE_KINDS,
  PRACTICES, INTENTIONS, CONNECTION_TYPES, CONNECTION_FORMATS, FORMAT_LABELS,
  COMMITMENT_LEVELS, COMMITMENT_LABELS, TONES, TONE_LABELS,
  CIRCLE_KINDS, CIRCLE_KIND_VALUES, CIRCLE_PRIVACY, REQUEST_TEMPLATES, EXPLORE_TOPICS,
} from './constants.js';
import {
  validateProfileInput, validateIntroRequest, validateConnectionRequest,
  validateRespond, validateCircleInput, validateCircleJoin,
  validateMessageInput, validateReportInput, validatePlanInput,
} from './validate.js';
import { findBestMatch, buildIntroNote, findMatches } from './match.js';
import {
  db,
  hasSeedProfiles,
  getProfile,
  getProfileByEmail,
  getVisibleProfile,
  hasMutualConnection,
  isBlockedBetween,
  listPublicProfiles,
  listCandidateProfiles,
  createProfile,
  updateProfile,
  createIntroduction,
  getIntroduction,
  setIntroductionStatus,
  getNonWithdrawnPairKeys,
  listIntroductionsFor,
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
    createdAt: intro.createdAt,
    updatedAt: intro.updatedAt,
  };
}

/** profileId required by most member endpoints; validates existence. */
function requireProfile(req, res) {
  const id = parseId(req.query.profileId ?? req.body?.profileId);
  if (id === null) {
    validationErr(res, [{ field: 'profileId', message: 'profileId is required and must be a positive integer' }]);
    return null;
  }
  const profile = getProfile(id);
  if (!profile) {
    err(res, 404, ERROR_CODES.NOT_FOUND, 'Profile not found.');
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
    supportNote: 'SEREN is a connection platform, not medical, mental-health, legal, or emergency support.',
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
  res.json({ profiles: listPublicProfiles() });
});

app.get('/api/profiles/:id', (req, res) => {
  const id = parseId(req.params.id);
  const viewerId = parseId(req.query.viewerId);
  const profile = id === null ? null : getProfile(id);
  if (!profile) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Profile not found.');
  // Privacy: filter fields by the target's consent settings unless the
  // viewer is the profile owner. Email is never exposed to other members.
  res.json(getVisibleProfile(id, viewerId));
});

app.patch('/api/profiles/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Profile not found.');
  const existing = getProfile(id);
  if (!existing) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Profile not found.');

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
  });

  const savedKeys = getSavedKeys(profile.id);

  res.json({
    matches: matches.map((m) => ({
      profile: getVisibleProfile(m.candidate.id, profile.id),
      reasons: m.reasons,
      sharedPractices: m.sharedPractices,
      sharedIntentions: m.sharedIntentions,
      sharedFormats: m.sharedFormats,
      saved: savedKeys.has(`match:${m.candidate.id}`),
    })),
  });
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

  const requester = getProfile(req.body.requesterId);
  if (!requester) {
    return err(res, 404, ERROR_CODES.REQUESTER_NOT_FOUND, 'Requester profile not found.');
  }
  if (!requester.consents || requester.consents.introductions !== true) {
    return err(res, 403, ERROR_CODES.CONSENT_REQUIRED,
      'This profile has not opted into introductions.');
  }

  const candidates = listCandidateProfiles();
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

  const requester = getProfile(req.body.requesterId);
  if (!requester) {
    return err(res, 404, ERROR_CODES.REQUESTER_NOT_FOUND, 'Requester profile not found.');
  }
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
  });

  return res.status(201).json({ introduction: toWireIntroduction(intro) });
});

app.get('/api/introductions', (req, res) => {
  const profileId = parseId(req.query.profileId);
  if (profileId === null) {
    return validationErr(res, [
      { field: 'profileId', message: 'profileId query parameter is required and must be a positive integer' },
    ]);
  }
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

function transition(targetStatus) {
  return (req, res) => {
    const id = parseId(req.params.id);
    const intro = id === null ? null : getIntroduction(id);
    if (!intro) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Introduction not found.');

    const allowed = VALID_TRANSITIONS[intro.status] || [];
    if (!allowed.includes(targetStatus)) {
      return err(res, 409, ERROR_CODES.INVALID_TRANSITION,
        `Cannot move introduction from "${intro.status}" to "${targetStatus}".`);
    }

    const updated = setIntroductionStatus(id, targetStatus);
    res.json(toWireIntroduction(updated));
  };
}

app.post('/api/introductions/:id/accept', transition('accepted'));
app.post('/api/introductions/:id/decline', transition('declined'));
// MVP simplification (contract): no auth, so any caller may withdraw a proposed intro.
app.post('/api/introductions/:id/withdraw', transition('withdrawn'));

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
  const viewerId = parseId(req.query.viewerId);
  const kind = CIRCLE_KIND_VALUES.includes(req.query.kind) ? req.query.kind : null;
  res.json({ circles: listCircles({ kind, viewerId }) });
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
  const viewerId = parseId(req.query.viewerId);
  const circle = getCircle(parseId(req.params.id), viewerId);
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
  if (req.body.profileId !== profile.id) {
    return err(res, 403, ERROR_CODES.FORBIDDEN, 'You can only request for yourself.');
  }
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
  const reporter = getProfile(req.body.reporterId);
  if (!reporter) return err(res, 404, ERROR_CODES.REQUESTER_NOT_FOUND, 'Reporter profile not found.');
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
