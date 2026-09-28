// SEREN MVP — express API server.
// Endpoints, shapes, and status codes per docs/API_CONTRACT.md.

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
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
