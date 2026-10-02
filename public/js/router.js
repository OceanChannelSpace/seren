// SEREN hash router. Views register with addRoute(path, render).
// render(root, ctx) may be async. Guards enforce beta gate + onboarding.

import { get, set, initSession } from './state.js';
import { announce } from './ui.js';
import * as api from './api.js';

const routes = new Map();
const main = () => document.getElementById('main');

export function addRoute(path, render, opts = {}) {
  routes.set(path, { render, ...opts });
}

const NAV_ITEMS = [
  { path: '#/', label: 'Home', icon: '⌂' },
  { path: '#/discover', label: 'Discover', icon: '✦' },
  { path: '#/agents', label: 'Agents', icon: '⚛' },
  { path: '#/modes', label: 'Modes', icon: '◈' },
  { path: '#/requests', label: 'Requests', icon: '✉' },
  { path: '#/connections', label: 'Connections', icon: '❋' },
  { path: '#/circles', label: 'Circles', icon: '◉' },
  { path: '#/me', label: 'Me', icon: '☾' },
];

function parseHash() {
  const raw = (location.hash || '#/').slice(1); // strip '#'
  const [pathPart, queryPart] = raw.split('?');
  const path = pathPart || '/';
  const params = Object.fromEntries(new URLSearchParams(queryPart || ''));
  return { path, params };
}

export function navigate(path) {
  if (location.hash === path) { handleRoute(); return; }
  location.hash = path;
}

function buildNav() {
  const list = document.getElementById('nav-list');
  const bottom = document.getElementById('bottom-nav');
  if (!list || !bottom) return;
  const profileId = get('profileId');
  const items = profileId ? [...NAV_ITEMS] : [];
  // The moderation queue is visible only to hosts; the server enforces it too.
  if (profileId && get('isHost') === true) {
    items.push({ path: '#/moderation', label: 'Moderation', icon: '⚑' });
  }
  list.innerHTML = items.map((i) =>
    `<li><a href="${i.path}" data-nav="${i.path}"><span class="nav-icon" aria-hidden="true">${i.icon}</span><span class="nav-label">${i.label}</span></a></li>`).join('');
  bottom.innerHTML = items.map((i) =>
    `<a href="${i.path}" data-nav="${i.path}" class="bottom-tab"><span class="nav-icon" aria-hidden="true">${i.icon}</span><span class="nav-label">${i.label}</span></a>`).join('');
}

function markActive(path) {
  for (const a of document.querySelectorAll('[data-nav]')) {
    const active = a.getAttribute('data-nav') === `#${path}`;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

function headerActions() {
  const region = document.getElementById('header-actions');
  if (!region) return;
  const profileId = get('profileId');
  region.innerHTML = '';
  if (!profileId) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-ghost btn-small';
  btn.textContent = 'Sign out';
  btn.addEventListener('click', async () => {
    const { clearSession } = await import('./state.js');
    clearSession();
    buildNav();
    headerActions();
    navigate('#/');
    announce('Signed out of this device.');
  });
  region.appendChild(btn);
}

async function handleRoute() {
  const { path, params } = parseHash();
  const route = routes.get(path) || routes.get('*');
  if (!route) { main().innerHTML = '<p>Not found.</p>'; return; }

  // Beta gate: routes may require beta access.
  if (route.requiresBeta && get('betaEntered') === false) {
    navigate('#/welcome');
    return;
  }
  // Auth gate: member routes require a profile on this device.
  if (route.requiresProfile && !get('profileId')) {
    navigate('#/onboarding');
    return;
  }
  // Resolve host status once per session so host-only nav/routes can gate.
  if (get('profileId') && get('isHost') === null) {
    try {
      const session = await api.me();
      set({ isHost: !!session.isHost, profile: session });
    } catch {
      // A 401 here already routes to welcome via the api 401 handler.
      set({ isHost: false });
    }
    if (!get('profileId')) { navigate('#/welcome'); return; }
  }
  // Host gate: host-only routes (moderation) need the host flag.
  if (route.requiresHost && get('isHost') !== true) {
    navigate('#/');
    return;
  }

  set({ route: path, routeParams: params });
  buildNav();
  markActive(path);
  const root = main();
  root.innerHTML = '';
  announce(route.title || 'Page');
  try {
    await route.render(root, { params });
    document.getElementById('main').focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  } catch (e) {
    console.error('route render failed', e);
    root.innerHTML = '<div class="banner banner-error" role="alert">Something went wrong loading this page. Please try again.</div>';
  }
}

export function startRouter() {
  initSession();
  buildNav();
  headerActions();
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}

// Re-render nav when session changes.
import { subscribe } from './state.js';
subscribe(() => { buildNav(); headerActions(); });
