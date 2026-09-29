// SEREN API client — thin wrappers around the REST endpoints.
// Every helper resolves to the parsed JSON payload and throws ApiError
// (with .status and .code) on non-2xx responses. The caller is responsible
// for surfacing loading/disabled/error states; ui.js provides helpers.

import { get } from './state.js';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message || code || 'Request failed');
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const e = (json && json.error) || {};
    throw new ApiError(res.status, e.code || 'request_failed', e.message || `Request failed (${res.status})`, e.details);
  }
  return json;
}

const q = (params) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  }
  const str = s.toString();
  return str ? `?${str}` : '';
};

function profileQuery(profileId, extra) {
  return q({ profileId: profileId ?? get('profileId'), ...(extra || {}) });
}

// --- beta / meta ---
export const betaStatus = () => request('GET', '/api/beta/status');
export const betaEnter = (code) => request('POST', '/api/beta/enter', { code });
export const fetchMeta = () => request('GET', '/api/meta');
export const health = () => request('GET', '/api/health');

// --- profiles ---
export const createProfile = (payload) => request('POST', '/api/profiles', payload);
export const listProfiles = () => request('GET', '/api/profiles');
/** viewerId defaults to our own profile → owner view when viewing self. */
export const getProfile = (id, viewerId) =>
  request('GET', `/api/profiles/${id}${q({ viewerId: viewerId ?? get('profileId') })}`);
export const updateProfile = (id, patch) => request('PATCH', `/api/profiles/${id}`, patch);

// --- discover ---
export const discover = (profileId, opts = {}) =>
  request('GET', `/api/discover${profileQuery(profileId, opts)}`);
export const passProfile = (profileId, targetId) =>
  request('POST', '/api/discover/pass', { profileId: profileId ?? get('profileId'), targetId });
export const saveItem = (profileId, kind, refId) =>
  request('POST', '/api/discover/save', { profileId: profileId ?? get('profileId'), kind, refId });
export const unsaveItem = (profileId, kind, refId) =>
  request('DELETE', `/api/discover/save${profileQuery(profileId, { kind, refId })}`);
export const listSaved = (profileId) =>
  request('GET', `/api/saved${profileQuery(profileId)}`);

// --- legacy single-shot introduction request ---
export const requestIntroduction = (requesterId, intention) =>
  request('POST', '/api/introductions/request', { requesterId: requesterId ?? get('profileId'), intention });

// --- intentional connection requests (staged consent) ---
export const requestConnection = (payload) =>
  request('POST', '/api/connections/request', { profileId: get('profileId'), ...payload });
export const listIntroductions = (profileId) =>
  request('GET', `/api/introductions${profileQuery(profileId)}`);
export const respondToIntroduction = (id, profileId, response, note) =>
  request('POST', `/api/introductions/${id}/respond`, { profileId: profileId ?? get('profileId'), response, note });
export const endIntroduction = (id, profileId) =>
  request('POST', `/api/introductions/${id}/end`, { profileId: profileId ?? get('profileId') });
export const acceptIntroduction = (id) => request('POST', `/api/introductions/${id}/accept`);
export const declineIntroduction = (id) => request('POST', `/api/introductions/${id}/decline`);
export const withdrawIntroduction = (id) => request('POST', `/api/introductions/${id}/withdraw`);

// --- messages + plans ---
export const listMessages = (id, profileId) =>
  request('GET', `/api/introductions/${id}/messages${profileQuery(profileId)}`);
export const sendMessage = (id, profileId, body) =>
  request('POST', `/api/introductions/${id}/messages`, { profileId: profileId ?? get('profileId'), senderId: profileId ?? get('profileId'), body });
export const getPlan = (id, profileId) =>
  request('GET', `/api/introductions/${id}/plan${profileQuery(profileId)}`);
export const savePlan = (id, profileId, plan) =>
  request('POST', `/api/introductions/${id}/plan`, { profileId: profileId ?? get('profileId'), ...plan });

// --- circles ---
export const listCircles = (viewerId, kind) =>
  request('GET', `/api/circles${q({ viewerId: viewerId ?? get('profileId'), kind })}`);
export const listMyCircles = (profileId) =>
  request('GET', `/api/circles/mine${profileQuery(profileId)}`);
export const createCircle = (payload) =>
  request('POST', '/api/circles', { profileId: get('profileId'), ...payload });
export const getCircle = (id, viewerId) =>
  request('GET', `/api/circles/${id}${q({ viewerId: viewerId ?? get('profileId') })}`);
export const joinCircle = (id, profileId) =>
  request('POST', `/api/circles/${id}/join`, { profileId: profileId ?? get('profileId') });
export const requestCircleJoin = (id, profileId, message) =>
  request('POST', `/api/circles/${id}/request`, { profileId: profileId ?? get('profileId'), message });
export const approveCircleRequest = (requestId, profileId) =>
  request('POST', `/api/circle-requests/${requestId}/approve`, { profileId: profileId ?? get('profileId') });
export const declineCircleRequest = (requestId, profileId) =>
  request('POST', `/api/circle-requests/${requestId}/decline`, { profileId: profileId ?? get('profileId') });

// --- blocks & reports ---
export const listBlocks = (profileId) =>
  request('GET', `/api/blocks${profileQuery(profileId)}`);
export const blockProfile = (profileId, blockedId) =>
  request('POST', '/api/blocks', { profileId: profileId ?? get('profileId'), blockedId });
export const unblockProfile = (profileId, blockedId) =>
  request('DELETE', `/api/blocks/${blockedId}${profileQuery(profileId)}`);
export const reportProfile = (payload) =>
  request('POST', '/api/reports', { reporterId: get('profileId'), ...payload });

// --- connection briefs ---
// NOTE: the running backend requires profileId on every brief endpoint
// (contract text omitted it) — helpers always send it.
export const createBriefFromSession = (sessionId) =>
  request('POST', '/api/briefs', { profileId: get('profileId'), sessionId });
export const getMyBrief = () =>
  request('GET', `/api/briefs/mine${profileQuery()}`);
export const updateBrief = (id, patch) =>
  request('PATCH', `/api/briefs/${id}`, { profileId: get('profileId'), ...patch });
export const approveBrief = (id, { shared_text, consent_save, consent_share }) =>
  request('POST', `/api/briefs/${id}/approve`, { profileId: get('profileId'), shared_text, consent_save, consent_share });
export const pauseBrief = (id) =>
  request('POST', `/api/briefs/${id}/pause`, { profileId: get('profileId') });
export const resumeBrief = (id) =>
  request('POST', `/api/briefs/${id}/resume`, { profileId: get('profileId') });
export const withdrawBrief = (id) =>
  request('POST', `/api/briefs/${id}/withdraw`, { profileId: get('profileId') });
export const getProposals = (sessionId) =>
  request('GET', `/api/guide/proposals${profileQuery(null, { sessionId })}`);
/** Proposals for an approved brief, regenerated from the brief itself — no session needed. */
export const getBriefProposals = (id) =>
  request('GET', `/api/briefs/${id}/proposals${profileQuery()}`);

/** Friendly one-line summary for an ApiError, for banners/toasts. */
export function friendlyError(e) {
  if (e instanceof ApiError) {
    if (e.code === 'validation_error' && Array.isArray(e.details) && e.details.length) {
      return e.details.map((d) => d.message).join(' ');
    }
    return e.message;
  }
  return 'Something went wrong. Please try again.';
}
