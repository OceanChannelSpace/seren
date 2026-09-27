// SEREN MVP — input validation.
// validateProfileInput(body, {isUpdate}) -> {ok, errors:[{field,message}]}
// validateIntroRequest(body) -> {ok, errors:[{field,message}]}

import { INTERESTS, SEEKING } from './constants.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function push(errors, field, message) {
  errors.push({ field, message });
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function checkName(errors, value, required, field = 'name') {
  if (value === undefined || value === null) {
    if (required) push(errors, field, 'name is required');
    return;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    push(errors, field, 'name must be a non-empty string');
    return;
  }
  if (value.trim().length > 80) {
    push(errors, field, 'name must be at most 80 characters');
  }
}

function checkEmail(errors, value, required, field = 'email') {
  if (value === undefined || value === null) {
    if (required) push(errors, field, 'email is required');
    return;
  }
  if (typeof value !== 'string' || !EMAIL_RE.test(value.trim())) {
    push(errors, field, 'email must be a valid email address');
  }
}

function checkInterests(errors, value, required, field = 'interests') {
  if (value === undefined || value === null) {
    if (required) push(errors, field, 'interests is required');
    return;
  }
  if (!Array.isArray(value)) {
    push(errors, field, 'interests must be an array');
    return;
  }
  if (value.length < 1 || value.length > 8) {
    push(errors, field, 'interests must contain between 1 and 8 items');
  }
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string' || !INTERESTS.includes(item)) {
      push(errors, field, `interest "${String(item)}" is not one of the fixed options`);
    } else if (seen.has(item)) {
      push(errors, field, `interest "${item}" is duplicated`);
    } else {
      seen.add(item);
    }
  }
}

function checkIntention(errors, value, required, min, max, field = 'intention') {
  if (value === undefined || value === null) {
    if (required) push(errors, field, 'intention is required');
    return;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    push(errors, field, 'intention must be a non-empty string');
    return;
  }
  const len = value.trim().length;
  if (len < min || len > max) {
    push(errors, field, `intention must be between ${min} and ${max} characters`);
  }
}

function checkConnectionPrefs(errors, value, required) {
  if (value === undefined || value === null) {
    if (required) push(errors, 'connectionPrefs', 'connectionPrefs is required');
    return;
  }
  if (!isPlainObject(value)) {
    push(errors, 'connectionPrefs', 'connectionPrefs must be an object');
    return;
  }
  const { seeking, availability } = value;
  if (seeking === undefined || seeking === null) {
    if (required) push(errors, 'connectionPrefs.seeking', 'connectionPrefs.seeking is required');
  } else if (!Array.isArray(seeking)) {
    push(errors, 'connectionPrefs.seeking', 'connectionPrefs.seeking must be an array');
  } else {
    for (const s of seeking) {
      if (typeof s !== 'string' || !SEEKING.includes(s)) {
        push(errors, 'connectionPrefs.seeking', `seeking option "${String(s)}" is not one of the fixed options`);
      }
    }
  }
  if (availability !== undefined && availability !== null && availability !== '') {
    if (typeof availability !== 'string') {
      push(errors, 'connectionPrefs.availability', 'connectionPrefs.availability must be a string');
    } else if (availability.length > 200) {
      push(errors, 'connectionPrefs.availability', 'connectionPrefs.availability must be at most 200 characters');
    }
  }
}

function checkConsents(errors, value, required, requireIntroductions) {
  if (value === undefined || value === null) {
    if (required) push(errors, 'consents', 'consents is required');
    return;
  }
  if (!isPlainObject(value)) {
    push(errors, 'consents', 'consents must be an object');
    return;
  }
  for (const key of ['introductions', 'community_visible', 'ai_matching']) {
    const v = value[key];
    if (typeof v !== 'boolean') {
      push(errors, `consents.${key}`, `consents.${key} is required and must be a boolean`);
    }
  }
  if (requireIntroductions && value.introductions !== true) {
    push(errors, 'consents.introductions', 'consents.introductions must be true to create a profile');
  }
}

/**
 * Validate a profile payload.
 * @param {object} body request body (camelCase)
 * @param {{isUpdate?: boolean}} opts on update, only present fields are validated
 * @returns {{ok: boolean, errors: Array<{field: string, message: string}>}}
 */
export function validateProfileInput(body, { isUpdate = false } = {}) {
  const errors = [];
  if (!isPlainObject(body)) {
    push(errors, 'body', 'request body must be a JSON object');
    return { ok: false, errors };
  }
  const required = !isUpdate;
  checkName(errors, body.name, required);
  checkEmail(errors, body.email, required);
  checkInterests(errors, body.interests, required);
  checkIntention(errors, body.intention, required, 10, 500);
  checkConnectionPrefs(errors, body.connectionPrefs, required);
  // introductions consent must be true at creation; on update the user may opt out.
  checkConsents(errors, body.consents, required, !isUpdate);
  return { ok: errors.length === 0, errors };
}

/**
 * Validate an introduction-request payload: {requesterId, intention}.
 * intention here is 5–500 chars (per contract).
 */
export function validateIntroRequest(body) {
  const errors = [];
  if (!isPlainObject(body)) {
    push(errors, 'body', 'request body must be a JSON object');
    return { ok: false, errors };
  }
  if (body.requesterId === undefined || body.requesterId === null) {
    push(errors, 'requesterId', 'requesterId is required');
  } else if (!Number.isInteger(body.requesterId) || body.requesterId <= 0) {
    push(errors, 'requesterId', 'requesterId must be a positive integer');
  }
  checkIntention(errors, body.intention, true, 5, 500);
  return { ok: errors.length === 0, errors };
}
