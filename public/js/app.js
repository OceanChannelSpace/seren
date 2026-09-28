// SEREN app bootstrap — beta gate, taxonomy load, route registration.

import { get, set } from './state.js';
import { addRoute, startRouter } from './router.js';
import { betaStatus, fetchMeta } from './api.js';
import { renderWelcome } from './views/welcome.js';
import { renderHome } from './views/home.js';
import { renderOnboarding } from './views/onboarding.js';
import { renderDiscover } from './views/discover.js';
import { renderMatchDetail } from './views/match.js';
import { renderModes } from './views/modes.js';
import { renderRequests } from './views/requests.js';
import { renderConnections } from './views/connections.js';
import { renderMessages } from './views/messages.js';
import { renderCircles, renderCircleDetail, renderCircleNew } from './views/circles.js';
import { renderMe, renderProfileEdit } from './views/me.js';
import { renderSaved } from './views/saved.js';

async function boot() {
  // Beta gate state.
  let betaEntered = true;
  try {
    const s = await betaStatus();
    betaEntered = !s.beta || s.entered;
  } catch { betaEntered = true; /* fail open locally */ }
  set({ betaEntered });

  // Product taxonomy.
  try {
    set({ meta: await fetchMeta() });
  } catch (e) {
    console.error('meta load failed', e);
    set({ meta: { practices: [], intentions: [], connectionTypes: [], connectionFormats: [], commitmentLevels: [], tones: [], circleKinds: [], circlePrivacy: [], requestTemplates: [], exploreTopics: [], responseKinds: [] } });
  }

  // '/' is the guided home for signed-in members, the welcome landing otherwise.
  addRoute('/', renderHome, { title: 'Welcome to SEREN' });
  addRoute('/welcome', renderWelcome, { title: 'Welcome to SEREN' });
  addRoute('/onboarding', renderOnboarding, { title: 'Create your profile', requiresBeta: true });
  addRoute('/discover', renderDiscover, { title: 'Discover', requiresBeta: true, requiresProfile: true });
  addRoute('/discover/match', renderMatchDetail, { title: 'Person', requiresBeta: true, requiresProfile: true });
  addRoute('/modes', renderModes, { title: 'Ways to begin', requiresBeta: true, requiresProfile: true });
  addRoute('/requests', renderRequests, { title: 'Requests', requiresBeta: true, requiresProfile: true });
  addRoute('/connections', renderConnections, { title: 'Connections', requiresBeta: true, requiresProfile: true });
  addRoute('/connections/messages', renderMessages, { title: 'Conversation', requiresBeta: true, requiresProfile: true });
  addRoute('/circles', renderCircles, { title: 'Circles', requiresBeta: true, requiresProfile: true });
  addRoute('/circles/new', renderCircleNew, { title: 'Create a circle', requiresBeta: true, requiresProfile: true });
  addRoute('/circles/detail', renderCircleDetail, { title: 'Circle', requiresBeta: true, requiresProfile: true });
  addRoute('/me', renderMe, { title: 'Me', requiresBeta: true, requiresProfile: true });
  addRoute('/me/edit', renderProfileEdit, { title: 'Edit profile', requiresBeta: true, requiresProfile: true });
  addRoute('/saved', renderSaved, { title: 'Saved', requiresBeta: true, requiresProfile: true });
  addRoute('*', renderWelcome, { title: 'Welcome to SEREN' });

  startRouter();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
