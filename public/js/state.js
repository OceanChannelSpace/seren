// SEREN frontend state — a tiny observable store + session persistence.
// The durable *authentication* is the HttpOnly `seren_profile` session
// cookie the server sets on profile creation / relink (never readable from
// JS). The profileId in localStorage is only a UI hint for this device
// (which profile is "me" for display and routing) — it is never a
// credential and the server never trusts it for identity.

const listeners = new Set();
const state = {
  profileId: null,     // our profile id on this device
  profile: null,       // our full profile (owner view)
  meta: null,          // taxonomy payload from /api/meta
  betaEntered: null,   // null = unknown, true/false = beta gate state
  route: null,         // current route descriptor
  routeParams: {},
  brief: null,         // our latest connection brief (draft/active/paused/withdrawn)
  guideSessionId: null, // guide session that produced the current brief, for proposals
  isHost: null,       // null = unknown, true/false once /api/me resolves
};

function getProfileId() {
  try { return Number(localStorage.getItem(`${STORAGE_PREFIX}.profileId`)) || null; } catch { return null; }
}

function setProfileId(id) {
  try {
    if (id == null) localStorage.removeItem(`${STORAGE_PREFIX}.profileId`);
    else localStorage.setItem(`${STORAGE_PREFIX}.profileId`, String(id));
  } catch { /* private mode */ }
  set({ profileId: id || null, profile: null, isHost: null });
}

export function get(key) {
  return state[key];
}

export function set(patch) {
  let changed = false;
  for (const k of Object.keys(patch)) {
    if (state[k] !== patch[k]) { state[k] = patch[k]; changed = true; }
  }
  if (changed) for (const fn of listeners) { try { fn(state); } catch { /* noop */ } }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function initSession() {
  set({ profileId: getProfileId() });
}

export function clearSession() {
  setProfileId(null);
  set({ profile: null });
}

export { setProfileId, getProfileId };

// Storage namespace for this device's keys (seren.profileId, …).
// Mirrors src/config.js STORAGE_PREFIX. Changing the VALUE logs out existing
// members — a rename needs a migration, not a find-replace.
export const STORAGE_PREFIX = 'seren';

// Convenience: labels from the meta taxonomy.
export function metaList(key) {
  const meta = get('meta');
  return (meta && meta[key]) || [];
}

/**
 * Provisional product name from the server brand config (/api/meta.brand).
 * Use this instead of hard-coding "SEREN" in user-facing copy so a future
 * rename is a server-side one-line change.
 */
export function brandName() {
  const meta = get('meta');
  return (meta && meta.brand && meta.brand.name) || 'SEREN';
}

/** Provisional product tagline from the server brand config. */
export function brandTagline() {
  const meta = get('meta');
  return (meta && meta.brand && meta.brand.tagline) || '';
}

export function connectionTypeLabel(value) {
  const found = metaList('connectionTypes').find((t) => t.value === value);
  return found ? found.label : value;
}

export function connectionTypeByValue(value) {
  return metaList('connectionTypes').find((t) => t.value === value) || null;
}

export function practiceLabel(value) {
  const found = metaList('practices').find((p) => p.value === value);
  return found ? found.label : value;
}

export function intentionLabel(value) {
  const found = metaList('intentions').find((i) => i.value === value);
  return found ? found.label : value;
}

export function formatLabel(value) {
  const found = metaList('connectionFormats').find((f) => f.value === value);
  return found ? found.label : value;
}

export function commitmentLabel(value) {
  const found = metaList('commitmentLevels').find((f) => f.value === value);
  return found ? found.label : value;
}

export function toneLabel(value) {
  const found = metaList('tones').find((f) => f.value === value);
  return found ? found.label : value;
}

export function exploreTopic(id) {
  return metaList('exploreTopics').find((t) => t.id === id) || null;
}
