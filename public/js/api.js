// SEREN API client — thin wrappers around the REST endpoints.
// Every helper resolves to the parsed JSON payload and throws ApiError
// (with .status and .code) on non-2xx responses. The caller is responsible
// for surfacing loading/disabled/error states; ui.js provides helpers.
//
// Identity: the member's session token lives in the HttpOnly `seren_profile`
// cookie (set on profile creation / relink) and is sent automatically by the
// browser. These helpers NEVER send profileId as identity — it appears only
// as a *target* id (e.g. "view profile 7"). Extra leading profileId params
// are accepted for call-site compatibility but ignored.

import { setProfileId } from './state.js';

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
    // The session token is missing or invalid (e.g. pre-token members after
    // the auth upgrade, or a cleared cookie). Drop the local identity and
    // send the member back to the welcome screen, where the relink card
    // ("reconnect this device") re-issues a fresh token. Uses location.hash
    // directly to avoid an import cycle with the router.
    if (res.status === 401 && path !== '/api/auth/relink') {
      try { setProfileId(null); } catch { /* noop */ }
      if (typeof window !== 'undefined' && window.location.hash !== '#/welcome') {
        window.location.hash = '#/welcome';
      }
    }
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

// --- beta / meta ---
export const betaStatus = () => request('GET', '/api/beta/status');
export const betaEnter = (code) => request('POST', '/api/beta/enter', { code });
export const fetchMeta = () => request('GET', '/api/meta');
export const health = () => request('GET', '/api/health');

// --- profiles ---
export const createProfile = (payload) => request('POST', '/api/profiles', payload);
export const listProfiles = () => request('GET', '/api/profiles');
/** The viewer is derived server-side from the session cookie. */
export const getProfile = (id) =>
  request('GET', `/api/profiles/${id}`);
export const updateProfile = (id, patch) => request('PATCH', `/api/profiles/${id}`, patch);
/**
 * Permanently deletes the caller's own profile and all of its data.
 * Identity comes from the session token; there is no id to pass.
 */
export const deleteMyProfile = () => request('DELETE', '/api/profiles/me');

// --- discover ---
export const discover = (_profileId, opts = {}) =>
  request('GET', `/api/discover${q(opts)}`);
export const passProfile = (_profileId, targetId) =>
  request('POST', '/api/discover/pass', { targetId });
export const saveItem = (_profileId, kind, refId) =>
  request('POST', '/api/discover/save', { kind, refId });
export const unsaveItem = (_profileId, kind, refId) =>
  request('DELETE', `/api/discover/save${q({ kind, refId })}`);
export const listSaved = (_profileId) =>
  request('GET', '/api/saved');

// --- agent registry ---
export const listAgents = () => request('GET', '/api/agents');
export const getAgent = (id) => request('GET', `/api/agents/${id}`);
export const registerAgent = (payload) => request('POST', '/api/agents', payload);
export const updateAgent = (id, payload) => request('PATCH', `/api/agents/${id}`, payload);
export const hideAgent = (id, _operatorProfileId) =>
  request('POST', `/api/agents/${id}/hide`, {});
export const reviewAgent = (id) =>
  request('POST', `/api/agents/${id}/review`, {});

// --- legacy single-shot introduction request ---
export const requestIntroduction = (_requesterId, intention) =>
  request('POST', '/api/introductions/request', { intention });

// --- intentional connection requests (staged consent) ---
export const requestConnection = (payload) =>
  request('POST', '/api/connections/request', payload);
export const listIntroductions = (_profileId) =>
  request('GET', '/api/introductions');
export const respondToIntroduction = (id, _profileId, response, note) =>
  request('POST', `/api/introductions/${id}/respond`, { response, note });
export const endIntroduction = (id, _profileId) =>
  request('POST', `/api/introductions/${id}/end`);
export const acceptIntroduction = (id) => request('POST', `/api/introductions/${id}/accept`);
export const declineIntroduction = (id) => request('POST', `/api/introductions/${id}/decline`);
export const withdrawIntroduction = (id) => request('POST', `/api/introductions/${id}/withdraw`);
// Lift a decline block this member placed: allow future direct requests from
// the given requester again. The decliner's choice alone.
export const allowFutureRequests = (requesterId) =>
  request('DELETE', `/api/decline-blocks/${requesterId}`);

// --- messages + plans ---
export const listMessages = (id, _profileId) =>
  request('GET', `/api/introductions/${id}/messages`);
export const sendMessage = (id, profileId, body) =>
  request('POST', `/api/introductions/${id}/messages`, { senderId: profileId, body });
export const getPlan = (id, _profileId) =>
  request('GET', `/api/introductions/${id}/plan`);
export const savePlan = (id, _profileId, plan) =>
  request('POST', `/api/introductions/${id}/plan`, plan);

// --- circles ---
export const listCircles = (_viewerId, kind) =>
  request('GET', `/api/circles${q({ kind })}`);
export const listMyCircles = (_profileId) =>
  request('GET', '/api/circles/mine');
export const createCircle = (payload) =>
  request('POST', '/api/circles', payload);
export const getCircle = (id, _viewerId) =>
  request('GET', `/api/circles/${id}`);
export const joinCircle = (id, _profileId) =>
  request('POST', `/api/circles/${id}/join`, {});
export const requestCircleJoin = (id, _profileId, message) =>
  request('POST', `/api/circles/${id}/request`, { message });
export const approveCircleRequest = (requestId, _profileId) =>
  request('POST', `/api/circle-requests/${requestId}/approve`, {});
export const declineCircleRequest = (requestId, _profileId) =>
  request('POST', `/api/circle-requests/${requestId}/decline`, {});

// --- blocks & reports ---
export const listBlocks = (_profileId) =>
  request('GET', '/api/blocks');
export const blockProfile = (_profileId, blockedId) =>
  request('POST', '/api/blocks', { blockedId });
export const unblockProfile = (_profileId, blockedId) =>
  request('DELETE', `/api/blocks/${blockedId}`);
export const reportProfile = (payload) =>
  request('POST', '/api/reports', payload);

// --- session & host moderation ---
export const me = () =>
  request('GET', '/api/me');
export const listReports = () =>
  request('GET', '/api/reports');
export const dismissReport = (reportId) =>
  request('POST', `/api/reports/${reportId}/dismiss`, {});
export const hideReportedProfile = (reportId) =>
  request('POST', `/api/reports/${reportId}/hide-profile`, {});

// --- host assists (Human Mode: host-facilitated introductions) ---
export const createHostAssist = (payload) =>
  request('POST', '/api/host-assists', payload);
export const listMyHostAssists = () =>
  request('GET', '/api/host-assists/mine');
export const withdrawHostAssist = (id) =>
  request('POST', `/api/host-assists/mine/${id}/withdraw`, {});
/** Host queue: every open assist request with the asker's name. */
export const listHostAssists = () =>
  request('GET', '/api/host-assists');
/** Host proposes a member for a request: { suggestedId, hostNote? }. */
export const proposeHostAssist = (id, payload) =>
  request('POST', `/api/host-assists/${id}/propose`, payload);

// --- synchronicity mode (v13) ---
/** The curated deck: words plus open reflective prompts. */
export const getSyncDeck = () =>
  request('GET', '/api/sync/deck');
/** Carry a beacon: { source: 'self_input'|'deck_draw', text?, cardId?, intentionType? }. */
export const createBeacon = (payload) =>
  request('POST', '/api/sync/beacons', payload);
/** The caller's own beacons: active plus history. */
export const myBeacons = () =>
  request('GET', '/api/sync/beacons/mine');
/** Withdraw the caller's active beacon. */
export const withdrawMyBeacon = () =>
  request('POST', '/api/sync/beacons/mine/withdraw', {});
/** The caller's beacon matches (proposed etc.). */
export const mySyncMatches = () =>
  request('GET', '/api/sync/matches/mine');

// --- connection briefs ---
export const createBriefFromSession = (sessionId) =>
  request('POST', '/api/briefs', { sessionId });
export const getMyBrief = () =>
  request('GET', '/api/briefs/mine');
export const updateBrief = (id, patch) =>
  request('PATCH', `/api/briefs/${id}`, patch);
export const approveBrief = (id, { shared_text, consent_save, consent_share }) =>
  request('POST', `/api/briefs/${id}/approve`, { shared_text, consent_save, consent_share });
export const pauseBrief = (id) =>
  request('POST', `/api/briefs/${id}/pause`, {});
export const resumeBrief = (id) =>
  request('POST', `/api/briefs/${id}/resume`, {});
export const withdrawBrief = (id) =>
  request('POST', `/api/briefs/${id}/withdraw`, {});
export const getProposals = (sessionId) =>
  request('GET', `/api/guide/proposals${q({ sessionId })}`);
/** Proposals for an approved brief, regenerated from the brief itself — no session needed. */
export const getBriefProposals = (id) =>
  request('GET', `/api/briefs/${id}/proposals`);

// --- SEREN guide chat ---
// Contract with the chat backend (2026-09-29):
//   POST /api/chat/start   {}                  → { session:{id, stage}, messages:[...], quickReplies?, proposals?, brief? }
//   POST /api/chat/message {sessionId, text}   → same shape
//   GET  /api/chat/session/:id                 → { session:{id, stage}, transcript:[...], question?, brief?, proposals? }
export const chatStart = (_profileId) =>
  request('POST', '/api/chat/start', {});
export const chatMessage = (_profileId, sessionId, text) =>
  request('POST', '/api/chat/message', { sessionId, text });
export const chatResume = (_profileId, sessionId) =>
  request('GET', `/api/chat/session/${encodeURIComponent(sessionId)}`);

// --- conversational onboarding chat (profile-less sessions) ---
// Contract:
//   POST /api/onboarding/chat/start        {}                  → { session:{id, stage}, messages, quickReplies? }
//   POST /api/onboarding/chat/message      {sessionId, text}   → same shape (+ profileCreated on consent)
//   GET  /api/onboarding/chat/session/:id                      → { session, transcript, question?, quickReplies? }
// Once consent creates the profile, the same session continues into the
// standard guide flow via these endpoints — no profile id is ever needed.
export const onboardingChatStart = () =>
  request('POST', '/api/onboarding/chat/start', {});
export const onboardingChatMessage = (sessionId, text) =>
  request('POST', '/api/onboarding/chat/message', { sessionId, text });
export const onboardingChatResume = (sessionId) =>
  request('GET', `/api/onboarding/chat/session/${encodeURIComponent(sessionId)}`);

// --- device relink (returning users) ---
// POST /api/auth/relink {email, name} → 200 {profileId, name} | 404 | 400
// The session cookie is set by the server; profileId is for UI state only.
export const relink = (email, name) =>
  request('POST', '/api/auth/relink', { email, name });

// --- flourishing check-ins ---
// GET /api/flourishing/questions → {questions:[{key,text,kind}]}
export const getFlourishingQuestions = () =>
  request('GET', '/api/flourishing/questions');
// POST /api/flourishing/checkin {profileId, responses:[{questionKey,answer}]} → 201
export const submitCheckin = (profileId, responses) =>
  request('POST', '/api/flourishing/checkin', { profileId, responses });
// GET /api/flourishing/checkins/mine?profileId= → {checkins:[...]} newest first
export const getMyCheckins = (profileId) =>
  request('GET', `/api/flourishing/checkins/mine${q({ profileId })}`);

// --- post-connection flourishing ---
// POST /api/introductions/:id/feedback {profileId,feltSafe,quality?,notes?} → 201
export const submitIntroductionFeedback = (id, payload) =>
  request('POST', `/api/introductions/${id}/feedback`, payload);
// POST /api/introductions/:id/real-life-intention {profileId,intention} → 200
export const setRealLifeIntention = (id, profileId, intention) =>
  request('POST', `/api/introductions/${id}/real-life-intention`, { profileId, intention });
// POST /api/introductions/:id/real-life-intention/complete {profileId} → 200
export const completeRealLifeIntention = (id, profileId) =>
  request('POST', `/api/introductions/${id}/real-life-intention/complete`, { profileId });

// --- host flourishing analytics ---
// GET /api/host/analytics (host-only) →
export const getHostAnalytics = () =>
  request('GET', '/api/host/analytics');

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
