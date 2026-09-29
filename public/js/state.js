// SEREN frontend state — a tiny observable store + session persistence.
// Everything lives client-side; the only durable identity is the profileId
// stored in localStorage (this device).

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
};

function getProfileId() {
  try { return Number(localStorage.getItem('seren.profileId')) || null; } catch { return null; }
}

function setProfileId(id) {
  try {
    if (id == null) localStorage.removeItem('seren.profileId');
    else localStorage.setItem('seren.profileId', String(id));
  } catch { /* private mode */ }
  set({ profileId: id || null, profile: null });
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

// Convenience: labels from the meta taxonomy.
export function metaList(key) {
  const meta = get('meta');
  return (meta && meta[key]) || [];
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
