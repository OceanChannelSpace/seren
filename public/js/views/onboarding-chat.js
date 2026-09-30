// SEREN conversational onboarding — the chatbot profile-creation interview.
//
// Mounts the generalized renderChat view with onboarding transports:
//   startFn:  POST /api/onboarding/chat/start (no profile id needed)
//   sendFn:   POST /api/onboarding/chat/message { sessionId, text }
//   resumeFn: GET  /api/onboarding/chat/session/:id
//
// On the turn where consent creates the profile, the backend answers with
// `profileCreated: { profileId }` — we store it via setProfileId so the
// rest of the app (inbox, profile, connections) works immediately. The SAME
// session then continues into the guide flow (follow-ups -> brief ->
// proposals); nothing remounts and the conversation never breaks.

import { renderChat } from './chat.js';
import * as api from '../api.js';
import { get, setProfileId } from '../state.js';
import { navigate } from '../router.js';

const OB_SESSION_KEY = 'seren.obSessionId';

export async function renderOnboardingChat(mount) {
  // Already have a profile on this device — the guide lives at home.
  if (get('profileId')) {
    navigate('/');
    return;
  }
  await renderChat(mount, {
    profileId: null,
    sessionKey: OB_SESSION_KEY,
    startFn: () => api.onboardingChatStart(),
    sendFn: (_profileId, sessionId, text) => api.onboardingChatMessage(sessionId, text),
    resumeFn: (_profileId, sessionId) => api.onboardingChatResume(sessionId),
    title: 'Create your SEREN space',
    subtitle: 'A gentle conversation — nothing is shared with anyone until you say so.',
    placeholder: 'Say whatever feels true…',
    onTurn(data) {
      const created = data && data.profileCreated;
      if (created && created.profileId) {
        setProfileId(created.profileId);
      }
    },
  });

}
