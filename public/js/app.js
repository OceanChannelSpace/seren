// SEREN app bootstrap — beta gate, taxonomy load, route registration.

import { get, set } from './state.js';
import { addRoute, startRouter } from './router.js';
import { betaStatus, fetchMeta, recordAttentionOpen } from './api.js';
import { renderWelcome } from './views/welcome.js';
import { renderHome } from './views/home.js';
import { renderOnboardingChat } from './views/onboarding-chat.js';
import { renderDiscover } from './views/discover.js';
import { renderMatchDetail } from './views/match.js';
import { renderModes } from './views/modes.js';
import { renderRequests } from './views/requests.js';
import { renderConnections } from './views/connections.js';
import { renderMessages } from './views/messages.js';
import { renderCircles, renderCircleDetail, renderCircleNew } from './views/circles.js';
import { renderMe, renderProfileEdit } from './views/me.js';
import { renderSaved } from './views/saved.js';
import { renderBrief } from './views/brief.js';
import { renderAgents } from './views/agents.js';
import { renderModeration } from './views/moderation.js';
import { renderFramework } from './views/framework.js';
import { renderTrust } from './views/trust.js';
import { renderFlourishing } from './views/flourishing.js';
import { renderHost } from './views/host.js';
import { renderAnalytics } from './views/analytics.js';

async function boot() {
  // Beta gate state.
  let betaEntered = true;
  try {
    const s = await betaStatus();
    betaEntered = !s.beta || s.entered;
  } catch { betaEntered = true; /* fail open locally */ }
  set({ betaEntered });

  // Digital Sapiens attention analytics: record one intentional app open
  // per boot. Fire-and-forget — never blocks boot or surfaces errors.
  // SEREN sends no engagement notifications, so 'intentional' is the
  // honest default origin.
  try {
    const bootProfileId = get('profileId');
    if (betaEntered && bootProfileId) {
      recordAttentionOpen(bootProfileId, 'intentional').catch(() => {});
    }
  } catch { /* never block boot */ }

  // Product taxonomy + brand (brand name is provisional — see src/config.js).
  try {
    set({ meta: await fetchMeta() });
  } catch (e) {
    console.error('meta load failed', e);
    set({ meta: { practices: [], intentions: [], connectionTypes: [], connectionFormats: [], commitmentLevels: [], tones: [], circleKinds: [], circlePrivacy: [], requestTemplates: [], exploreTopics: [], responseKinds: [] } });
  }
  try {
    const meta = get('meta');
    const brandName = (meta && meta.brand && meta.brand.name) || 'SEREN';
    document.title = `${brandName} — ${ (meta && meta.brand && meta.brand.tagline) || 'A consent-first space for meaningful connection'}`;
  } catch { /* noop */ }

  // '/' is the guided home for signed-in members, the welcome landing otherwise.
  addRoute('/', renderHome, { title: 'Welcome to SEREN' });
  addRoute('/welcome', renderWelcome, { title: 'Welcome to SEREN' });
  addRoute('/onboarding', renderOnboardingChat, { title: 'Create your profile', requiresBeta: true });
  addRoute('/discover', renderDiscover, { title: 'Discover', requiresBeta: true, requiresProfile: true });
  addRoute('/discover/match', renderMatchDetail, { title: 'Person', requiresBeta: true, requiresProfile: true });
  addRoute('/modes', renderModes, { title: 'Ways to begin', requiresBeta: true, requiresProfile: true });
  addRoute('/requests', renderRequests, { title: 'Requests', requiresBeta: true, requiresProfile: true });
  addRoute('/brief', renderBrief, { title: 'Your connection brief', requiresBeta: true, requiresProfile: true });
  addRoute('/connections', renderConnections, { title: 'Connections', requiresBeta: true, requiresProfile: true });
  addRoute('/connections/messages', renderMessages, { title: 'Conversation', requiresBeta: true, requiresProfile: true });
  addRoute('/circles', renderCircles, { title: 'Circles', requiresBeta: true, requiresProfile: true });
  addRoute('/circles/new', renderCircleNew, { title: 'Create a circle', requiresBeta: true, requiresProfile: true });
  addRoute('/circles/detail', renderCircleDetail, { title: 'Circle', requiresBeta: true, requiresProfile: true });
  addRoute('/me', renderMe, { title: 'Me', requiresBeta: true, requiresProfile: true });
  addRoute('/me/edit', renderProfileEdit, { title: 'Edit profile', requiresBeta: true, requiresProfile: true });
  addRoute('/saved', renderSaved, { title: 'Saved', requiresBeta: true, requiresProfile: true });
  addRoute('/agents', renderAgents, { title: 'Intelligent agents', requiresBeta: true, requiresProfile: true });
  addRoute('/moderation', renderModeration, { title: 'Moderation', requiresBeta: true, requiresProfile: true, requiresHost: true });
  addRoute('/framework', renderFramework, { title: 'Flourishing framework' });
  addRoute('/trust', renderTrust, { title: 'Trust & safety' });
  addRoute('/flourishing', renderFlourishing, { title: 'Flourishing check-in', requiresBeta: true, requiresProfile: true });
  addRoute('/host', renderHost, { title: 'Facilitator', requiresBeta: true, requiresProfile: true, requiresHost: true });
  addRoute('/analytics', renderAnalytics, { title: 'Community flourishing', requiresBeta: true, requiresProfile: true, requiresHost: true });
  addRoute('*', renderWelcome, { title: 'Welcome to SEREN' });

  startRouter();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
