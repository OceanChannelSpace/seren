// SEREN — input validation.
// validateProfileInput(body, {isUpdate}) -> {ok, errors:[{field,message}]}
// validateIntroRequest(body) -> {ok, errors:[{field,message}]}
//
// Extended validators for the current product surface:
// validateConnectionRequest, validateRespond, validateCircleInput,
// validateMessageInput, validateReportInput, validatePlanInput.

import {
  INTERESTS, SEEKING,
  PRACTICE_VALUES, INTENTION_VALUES,
  CONNECTION_TYPE_VALUES, CONNECTION_FORMATS, COMMITMENT_LEVELS, TONES,
  CIRCLE_KIND_VALUES, CIRCLE_PRIVACY, RESPONSE_KINDS, REPORT_REASONS,
} from './constants.js';

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

function checkShortText(errors, value, field, { required = false, min = 0, max = 200 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) push(errors, field, `${field} is required`);
    return;
  }
  if (typeof value !== 'string') {
    push(errors, field, `${field} must be a string`);
    return;
  }
  const len = value.trim().length;
  if (required && len === 0) push(errors, field, `${field} must not be empty`);
  else if (len > max) push(errors, field, `${field} must be at most ${max} characters`);
  else if (len < min) push(errors, field, `${field} must be at least ${min} characters`);
}

function checkStringArray(errors, value, field, { allowed = null, min = 0, max = 30, required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) push(errors, field, `${field} is required`);
    return;
  }
  if (!Array.isArray(value)) {
    push(errors, field, `${field} must be an array`);
    return;
  }
  if (value.length < min || value.length > max) {
    push(errors, field, `${field} must contain between ${min} and ${max} items`);
  }
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string' || (allowed && !allowed.includes(item))) {
      push(errors, field, `"${String(item)}" is not a valid ${field} option`);
    } else if (seen.has(item)) {
      push(errors, field, `"${item}" is duplicated in ${field}`);
    } else {
      seen.add(item);
    }
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

function checkPrefs(errors, value, required) {
  if (value === undefined || value === null) return;
  if (!isPlainObject(value)) {
    push(errors, 'prefs', 'prefs must be an object');
    return;
  }
  if (value.localRemote !== undefined && !['local', 'remote', 'either'].includes(value.localRemote)) {
    push(errors, 'prefs.localRemote', 'prefs.localRemote must be local, remote, or either');
  }
  if (value.formats !== undefined) {
    checkStringArray(errors, value.formats, 'prefs.formats', { allowed: CONNECTION_FORMATS, max: 5 });
  }
  if (value.languages !== undefined) {
    if (!Array.isArray(value.languages)) push(errors, 'prefs.languages', 'prefs.languages must be an array');
    else {
      for (const l of value.languages) {
        if (typeof l !== 'string' || l.trim().length === 0 || l.trim().length > 40) {
          push(errors, 'prefs.languages', 'each language must be a non-empty string up to 40 characters');
          break;
        }
      }
      if (value.languages.length > 10) push(errors, 'prefs.languages', 'choose at most 10 languages');
    }
  }
  if (value.availability !== undefined && value.availability !== null && value.availability !== '') {
    if (typeof value.availability !== 'string' || value.availability.length > 200) {
      push(errors, 'prefs.availability', 'prefs.availability must be at most 200 characters');
    }
  }
}

const CONSENT_SETTING_KEYS = [
  'messagesAfterMutual', 'intentionalRequests', 'groupInvites', 'eventInvites',
  'collaborationRequests', 'showPractices', 'showRegion', 'showPhoto',
  'discoveryEnabled', 'paused', 'notifications',
];

function checkConsentSettings(errors, value) {
  if (value === undefined || value === null) return;
  if (!isPlainObject(value)) {
    push(errors, 'consentSettings', 'consentSettings must be an object');
    return;
  }
  for (const key of Object.keys(value)) {
    if (!CONSENT_SETTING_KEYS.includes(key)) {
      push(errors, `consentSettings.${key}`, `unknown consent setting "${key}"`);
    } else if (typeof value[key] !== 'boolean') {
      push(errors, `consentSettings.${key}`, `consentSettings.${key} must be a boolean`);
    }
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

  // v1 extensions — optional on create, validated when present.
  if (body.pronouns !== undefined) checkShortText(errors, body.pronouns, 'pronouns', { max: 40 });
  if (body.region !== undefined) checkShortText(errors, body.region, 'region', { max: 80 });
  if (body.photoUrl !== undefined) checkShortText(errors, body.photoUrl, 'photoUrl', { max: 500 });
  if (body.about !== undefined) checkShortText(errors, body.about, 'about', { max: 500 });
  if (body.visualIdentity !== undefined) {
    const allowed = ['grounded', 'celestial', 'oceanic', 'minimal', 'warm'];
    if (typeof body.visualIdentity !== 'string' || !allowed.includes(body.visualIdentity)) {
      push(errors, 'visualIdentity', `visualIdentity must be one of: ${allowed.join(', ')}`);
    }
  }
  if (body.intentions !== undefined) {
    checkStringArray(errors, body.intentions, 'intentions', { allowed: INTENTION_VALUES, max: 15 });
  }
  if (body.intentionsOther !== undefined) checkShortText(errors, body.intentionsOther, 'intentionsOther', { max: 140 });
  if (body.practices !== undefined) {
    checkStringArray(errors, body.practices, 'practices', { allowed: PRACTICE_VALUES, min: 0, max: 27 });
  }
  if (body.practicesOther !== undefined) checkShortText(errors, body.practicesOther, 'practicesOther', { max: 140 });
  if (body.prefs !== undefined) checkPrefs(errors, body.prefs, required);
  if (body.consentSettings !== undefined) checkConsentSettings(errors, body.consentSettings);
  // v2: connection values from the guide "depth" question — short free-form strings.
  if (body.values !== undefined) {
    if (!Array.isArray(body.values)) {
      push(errors, 'values', 'values must be an array');
    } else if (body.values.length > 6) {
      push(errors, 'values', 'values must contain at most 6 items');
    } else {
      for (const v of body.values) {
        if (typeof v !== 'string' || v.trim().length === 0 || v.length > 40) {
          push(errors, 'values', 'each value must be a short string (1–40 characters)');
          break;
        }
      }
    }
  }
  // v5: optional social/website links — validated when present.
  if (body.links !== undefined) checkLinks(errors, body.links);

  return { ok: errors.length === 0, errors };
}

/** Supported keys for the optional profile links object. */
export const LINK_KEYS = ['website', 'instagram', 'x', 'linkedin'];

/**
 * Validate the optional social/website links object.
 * Pure check — normalization (scheme prefixing, trimming) happens at write time.
 */
function checkLinks(errors, links) {
  if (!isPlainObject(links)) {
    push(errors, 'links', 'links must be an object');
    return;
  }
  for (const key of Object.keys(links)) {
    if (!LINK_KEYS.includes(key)) {
      push(errors, 'links', `links.${key} is not supported (use: ${LINK_KEYS.join(', ')})`);
      continue;
    }
    const raw = typeof links[key] === 'string' ? links[key].trim() : '';
    if (!raw) continue; // empty string clears the link
    if (raw.length > 200) {
      push(errors, 'links', `links.${key} must be at most 200 characters`);
      continue;
    }
    const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`;
    let protocol = '';
    try {
      protocol = new URL(candidate).protocol;
    } catch {
      push(errors, 'links', `links.${key} is not a valid URL`);
      continue;
    }
    if (protocol !== 'http:' && protocol !== 'https:') {
      push(errors, 'links', `links.${key} must be an http(s) URL`);
    }
  }
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

/** Positive-integer id helper shared by new validators. */
function checkId(errors, body, field) {
  if (body[field] === undefined || body[field] === null) {
    push(errors, field, `${field} is required`);
  } else if (!Number.isInteger(body[field]) || body[field] <= 0) {
    push(errors, field, `${field} must be a positive integer`);
  }
}

/**
 * Targeted intentional connection request:
 * {requesterId, targetId, connectionType, message, format?, commitment?, tone?}
 */
export function validateConnectionRequest(body) {
  const errors = [];
  if (!isPlainObject(body)) {
    push(errors, 'body', 'request body must be a JSON object');
    return { ok: false, errors };
  }
  checkId(errors, body, 'requesterId');
  checkId(errors, body, 'targetId');
  if (body.requesterId === body.targetId) {
    push(errors, 'targetId', 'you cannot request a connection with yourself');
  }
  if (body.connectionType === undefined || body.connectionType === null || body.connectionType === '') {
    push(errors, 'connectionType', 'connectionType is required');
  } else if (!CONNECTION_TYPE_VALUES.includes(body.connectionType)) {
    push(errors, 'connectionType', 'connectionType is not a recognized connection type');
  }
  checkShortText(errors, body.message, 'message', { required: true, min: 5, max: 500 });
  if (body.briefId !== undefined && body.briefId !== null) {
    checkId(errors, body, 'briefId');
  }
  if (body.format !== undefined && body.format !== null && body.format !== '') {
    if (!CONNECTION_FORMATS.includes(body.format)) {
      push(errors, 'format', 'format must be a recognized conversation format');
    }
  }
  if (body.commitment !== undefined && body.commitment !== null && body.commitment !== '') {
    if (!COMMITMENT_LEVELS.includes(body.commitment)) {
      push(errors, 'commitment', 'commitment must be a recognized commitment level');
    }
  }
  if (body.tone !== undefined && body.tone !== null && body.tone !== '') {
    if (!TONES.includes(body.tone)) {
      push(errors, 'tone', 'tone must be a recognized tone');
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Recipient response: {response, note?} where response is a RESPONSE_KINDS value. */
export function validateRespond(body) {
  const errors = [];
  if (!isPlainObject(body)) {
    push(errors, 'body', 'request body must be a JSON object');
    return { ok: false, errors };
  }
  if (!RESPONSE_KINDS.includes(body.response)) {
    push(errors, 'response', `response must be one of: ${RESPONSE_KINDS.join(', ')}`);
  }
  if (body.note !== undefined && body.note !== null && body.note !== '') {
    checkShortText(errors, body.note, 'note', { max: 500 });
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Circle create/update:
 * {name, kind, purpose, privacy?, maxParticipants?, schedule?, agreements?, region?}
 */
export function validateCircleInput(body, { isUpdate = false } = {}) {
  const errors = [];
  if (!isPlainObject(body)) {
    push(errors, 'body', 'request body must be a JSON object');
    return { ok: false, errors };
  }
  const required = !isUpdate;
  checkShortText(errors, body.name, 'name', { required, min: 3, max: 80 });
  if (body.kind === undefined || body.kind === null) {
    if (required) push(errors, 'kind', 'kind is required');
  } else if (!CIRCLE_KIND_VALUES.includes(body.kind)) {
    push(errors, 'kind', 'kind is not a recognized circle kind');
  }
  checkShortText(errors, body.purpose, 'purpose', { required, min: 10, max: 500 });
  if (body.privacy !== undefined && !CIRCLE_PRIVACY.includes(body.privacy)) {
    push(errors, 'privacy', `privacy must be one of: ${CIRCLE_PRIVACY.join(', ')}`);
  }
  if (body.maxParticipants !== undefined) {
    if (!Number.isInteger(body.maxParticipants) || body.maxParticipants < 2 || body.maxParticipants > 200) {
      push(errors, 'maxParticipants', 'maxParticipants must be between 2 and 200');
    }
  }
  if (body.schedule !== undefined) checkShortText(errors, body.schedule, 'schedule', { max: 200 });
  if (body.agreements !== undefined) checkShortText(errors, body.agreements, 'agreements', { max: 1000 });
  if (body.region !== undefined) checkShortText(errors, body.region, 'region', { max: 80 });
  return { ok: errors.length === 0, errors };
}

/** Circle join request: {profileId, message?} */
export function validateCircleJoin(body) {
  const errors = [];
  if (!isPlainObject(body)) {
    push(errors, 'body', 'request body must be a JSON object');
    return { ok: false, errors };
  }
  checkId(errors, body, 'profileId');
  if (body.message !== undefined && body.message !== null && body.message !== '') {
    checkShortText(errors, body.message, 'message', { max: 500 });
  }
  return { ok: errors.length === 0, errors };
}

/** Message: {senderId, body} — body 1..2000 chars. */
export function validateMessageInput(body) {
  const errors = [];
  if (!isPlainObject(body)) {
    push(errors, 'body', 'request body must be a JSON object');
    return { ok: false, errors };
  }
  checkId(errors, body, 'senderId');
  checkShortText(errors, body.body, 'body', { required: true, min: 1, max: 2000 });
  return { ok: errors.length === 0, errors };
}

/** Guide session start: {profileId, text} — text 10..500 chars. */
export function validateGuideStart(body) {
  const errors = [];
  if (!isPlainObject(body)) {
    push(errors, 'body', 'request body must be a JSON object');
    return { ok: false, errors };
  }
  checkId(errors, body, 'profileId');
  checkShortText(errors, body.text, 'text', { required: true, min: 10, max: 500 });
  return { ok: errors.length === 0, errors };
}

/** Guide answer: {profileId, questionId, value?} — value null/'' = skip. */
export function validateGuideAnswer(body) {
  const errors = [];
  if (!isPlainObject(body)) {
    push(errors, 'body', 'request body must be a JSON object');
    return { ok: false, errors };
  }
  checkId(errors, body, 'profileId');
  if (typeof body.questionId !== 'string' || body.questionId.trim() === '') {
    push(errors, 'questionId', 'questionId is required');
  }
  return { ok: errors.length === 0, errors };
}

/** Report: {reporterId, reason, details?} */
export function validateReportInput(body) {
  const errors = [];
  if (!isPlainObject(body)) {
    push(errors, 'body', 'request body must be a JSON object');
    return { ok: false, errors };
  }
  checkId(errors, body, 'reporterId');
  if (!REPORT_REASONS.includes(body.reason)) {
    push(errors, 'reason', `reason must be one of: ${REPORT_REASONS.join(', ')}`);
  }
  if (body.details !== undefined && body.details !== null && body.details !== '') {
    checkShortText(errors, body.details, 'details', { max: 1000 });
  }
  return { ok: errors.length === 0, errors };
}

/** First-connection plan: {createdBy, format?, timeText?, expectations?} */
export function validatePlanInput(body) {
  const errors = [];
  if (!isPlainObject(body)) {
    push(errors, 'body', 'request body must be a JSON object');
    return { ok: false, errors };
  }
  // createdBy is derived from the session by the handler; accept it if supplied.
  if (body.createdBy !== undefined) checkId(errors, body, 'createdBy');
  if (body.format !== undefined && body.format !== null && body.format !== '') {
    if (!CONNECTION_FORMATS.includes(body.format)) {
      push(errors, 'format', 'format must be a recognized conversation format');
    }
  }
  if (body.timeText !== undefined) checkShortText(errors, body.timeText, 'timeText', { max: 200 });
  if (body.expectations !== undefined) checkShortText(errors, body.expectations, 'expectations', { max: 500 });
  return { ok: errors.length === 0, errors };
}

/* ------------------------------------------------------------------ */
/* Connection briefs.                                                  */
/* ------------------------------------------------------------------ */

const BRIEF_TEXT_FIELDS = [
  'who_text', 'intention_text', 'good_fit_text', 'offer_text',
  'logistics_text', 'boundaries_text', 'private_notes', 'shared_text',
];

function checkBriefFields(errors, body, { requiredSharedText = false } = {}) {
  for (const field of BRIEF_TEXT_FIELDS) {
    const value = body[field];
    if (value === undefined || value === null || value === '') {
      if (requiredSharedText && field === 'shared_text') {
        push(errors, field, 'shared_text is required');
      }
      continue;
    }
    if (typeof value !== 'string') {
      push(errors, field, `${field} must be a string`);
    } else if (value.length > 2000) {
      push(errors, field, `${field} must be at most 2000 characters`);
    }
  }
}

/** Draft fields supplied for brief creation/update: all optional, max 2000. */
export function validateBriefDraft(body) {
  const errors = [];
  if (!isPlainObject(body)) {
    push(errors, 'body', 'request body must be a JSON object');
    return { ok: false, errors };
  }
  checkBriefFields(errors, body);
  return { ok: errors.length === 0, errors };
}

/** PATCH fields: same shape as the draft — only present fields validated. */
export function validateBriefUpdate(body) {
  const errors = [];
  if (!isPlainObject(body)) {
    push(errors, 'body', 'request body must be a JSON object');
    return { ok: false, errors };
  }
  checkBriefFields(errors, body);
  if (BRIEF_TEXT_FIELDS.every((f) => body[f] === undefined)) {
    push(errors, 'body', 'supply at least one brief field to update');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Approve: {shared_text (required, 1–600 chars), consent_save (must be true),
 * consent_share (optional boolean)}.
 */
export function validateBriefApprove(body) {
  const errors = [];
  if (!isPlainObject(body)) {
    push(errors, 'body', 'request body must be a JSON object');
    return { ok: false, errors };
  }
  checkBriefFields(errors, body, { requiredSharedText: true });
  const shared = body.shared_text;
  if (typeof shared === 'string') {
    const len = shared.trim().length;
    if (len === 0) {
      push(errors, 'shared_text', 'shared_text must not be empty');
    } else if (len > 600) {
      push(errors, 'shared_text', 'shared_text must be at most 600 characters');
    }
  }
  if (body.consent_save !== true) {
    push(errors, 'consent_save', 'consent_save must be true to approve this brief');
  }
  if (body.consent_share !== undefined && typeof body.consent_share !== 'boolean') {
    push(errors, 'consent_share', 'consent_share must be a boolean');
  }
  return { ok: errors.length === 0, errors };
}

/* ------------------------------------------------------------------ */
/* Guide chat.                                                         */
/* ------------------------------------------------------------------ */

/** Chat start: {profileId}. */
export function validateChatStart(body) {
  const errors = [];
  if (!isPlainObject(body)) {
    push(errors, 'body', 'request body must be a JSON object');
    return { ok: false, errors };
  }
  checkId(errors, body, 'profileId');
  return { ok: errors.length === 0, errors };
}

/** Chat message: {profileId, sessionId, text} — text 1..2000 chars. */
export function validateChatMessage(body) {
  const errors = [];
  if (!isPlainObject(body)) {
    push(errors, 'body', 'request body must be a JSON object');
    return { ok: false, errors };
  }
  checkId(errors, body, 'profileId');
  checkId(errors, body, 'sessionId');
  checkShortText(errors, body.text, 'text', { required: true, min: 1, max: 2000 });
  return { ok: errors.length === 0, errors };
}

/**
 * Profile relink: {email, name}. Used when the frontend loses its stored
 * profile id and the user reclaims their profile with what they know.
 */
export function validateRelink(body) {
  const errors = [];
  if (!isPlainObject(body)) {
    push(errors, 'body', 'request body must be a JSON object');
    return { ok: false, errors };
  }
  if (body.email === undefined || body.email === null) {
    push(errors, 'email', 'email is required');
  } else if (typeof body.email !== 'string' || body.email.trim().length < 3 || body.email.trim().length > 254) {
    push(errors, 'email', 'email must be a string between 3 and 254 characters');
  }
  if (body.name === undefined || body.name === null) {
    push(errors, 'name', 'name is required');
  } else if (typeof body.name !== 'string' || body.name.trim().length < 1 || body.name.trim().length > 120) {
    push(errors, 'name', 'name must be a string between 1 and 120 characters');
  }
  return { ok: errors.length === 0, errors };
}
