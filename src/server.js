// SEREN MVP — express API server.
// Endpoints, shapes, and status codes per docs/API_CONTRACT.md.

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { ERROR_CODES, VALID_TRANSITIONS } from './constants.js';
import { validateProfileInput, validateIntroRequest } from './validate.js';
import { findBestMatch, buildIntroNote } from './match.js';
import {
  db,
  hasSeedProfiles,
  getProfile,
  getProfileByEmail,
  listPublicProfiles,
  listCandidateProfiles,
  createProfile,
  updateProfile,
  createIntroduction,
  getIntroduction,
  setIntroductionStatus,
  getNonWithdrawnPairKeys,
  listIntroductionsFor,
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
    createdAt: intro.createdAt,
    updatedAt: intro.updatedAt,
  };
}

// ---------- routes ----------

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', seeded: hasSeedProfiles() });
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
  const profile = id === null ? null : getProfile(id);
  if (!profile) return err(res, 404, ERROR_CODES.NOT_FOUND, 'Profile not found.');
  res.json(profile);
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

// --- introductions ---

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

app.get('/api/introductions', (req, res) => {
  const profileId = parseId(req.query.profileId);
  if (profileId === null) {
    return validationErr(res, [
      { field: 'profileId', message: 'profileId query parameter is required and must be a positive integer' },
    ]);
  }
  res.json({ introductions: listIntroductionsFor(profileId) });
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

// ---------- static frontend ----------

const here = dirname(fileURLToPath(import.meta.url));
app.use(express.static(join(here, '..', 'public')));

// ---------- boot ----------

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`SEREN MVP listening on port ${port} (db: ${process.env.DB_PATH || './data/seren.db'})`);
  });
}

export { db };
