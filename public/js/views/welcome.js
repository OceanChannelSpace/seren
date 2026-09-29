// SEREN welcome view — beta invite gate + landing.
// The beta gate lives here (not the router) so the invite is a full page.

import { get, set, setProfileId } from '../state.js';
import { betaEnter, fetchMeta, friendlyError, relink, getProfile } from '../api.js';
import { el, esc, card, errorBanner, wireSubmit, textInput, field, announce, toast } from '../ui.js';
import { navigate } from '../router.js';

export async function renderWelcome(root, ctx) {
  root.innerHTML = '';
  if (get('betaEntered') === false) {
    document.body.classList.add('beta-locked');
    root.appendChild(renderGate());
  } else {
    document.body.classList.remove('beta-locked');
    root.appendChild(renderLanding());
  }
  announce('Welcome to SEREN');
}

function renderGate() {
  const banner = errorBanner();
  const wrap = el(`
    <section class="page page-narrow" aria-label="Private beta invite">
      <div class="beta-gate">
        ${card([]).outerHTML}
      </div>
    </section>`);
  // Build the card content directly (card() gives us the article shell).
  const gateCard = wrap.querySelector('.card');
  gateCard.innerHTML = `
    <p class="beta-eyebrow">Private beta</p>
    <h1>Welcome to SEREN</h1>
    <p class="lede">SEREN is a quiet, consent-first space for intentional spiritual connection.
    It is currently in private beta — please enter your invite code to continue.</p>`;
  gateCard.appendChild(banner.node);

  const form = el(`<form novalidate></form>`);
  const codeInput = textInput({
    id: 'beta-code', placeholder: 'Invite code', autocomplete: 'off', required: true,
  });
  codeInput.setAttribute('aria-describedby', 'beta-hint');
  form.appendChild(field('Invite code', codeInput, {
    id: 'beta-code',
    hint: 'Beta codes are shared personally by the SEREN team.',
  }));
  const hint = form.querySelector('.field-hint');
  if (hint) hint.id = 'beta-hint';
  const submit = el(`<button type="submit" class="btn btn-primary" id="beta-submit">Enter</button>`);
  form.appendChild(submit);
  gateCard.appendChild(form);

  wireSubmit(form, submit, async () => {
    banner.clear();
    const code = codeInput.value.trim();
    if (!code) { banner.show('Please enter your invite code.'); codeInput.focus(); return; }
    try {
      await betaEnter(code);
      set({ betaEntered: true });
      document.body.classList.remove('beta-locked');
      // Meta was likely empty before entry (the beta gate 403s /api/meta),
      // so refresh it now that the device is admitted.
      try {
        const meta = await fetchMeta();
        set({ meta });
      } catch {
        /* keep whatever we have; views degrade gracefully */
      }
      navigate(get('profileId') ? '#/discover' : '#/onboarding');
    } catch (e) {
      banner.show(friendlyError(e));
      codeInput.focus();
      codeInput.select();
    }
  });
  return wrap;
}

function renderLanding() {
  const profileId = get('profileId');
  const wrap = el(`<section class="page" aria-label="Welcome to SEREN"></section>`);

  const hero = el(`
    <div class="hero center">
      <div class="sigil" aria-hidden="true">✦</div>
      <h1>SEREN</h1>
      <p class="lede">A consent-first space for intentional spiritual, metaphysical,
      and consciousness-centered connection. Small, curated, and calm —
      never a feed, never a scoreboard.</p>
    </div>`);
  wrap.appendChild(hero);

  if (profileId) {
    const back = card([
      el(`<h2>Welcome back</h2>`),
      el(`<p class="lede" style="font-size:1rem">Your profile is on this device. Pick up where you left off — gently.</p>`),
      el(`<div class="btn-row"><a class="btn btn-primary" href="#/discover">Continue to Discover</a>
        <a class="btn btn-secondary" href="#/me">My profile</a></div>`),
    ]);
    back.classList.add('welcome-back');
    wrap.appendChild(back);
  }

  const steps = card([
    el(`<h2>How SEREN works</h2>`),
    el(`<div class="steps">
      <div class="step"><span class="step-num" aria-hidden="true">1</span>
        <h3>Create your profile</h3><p>Share your practices and intentions at your own pace. Your email stays private — always.</p></div>
      <div class="step"><span class="step-num" aria-hidden="true">2</span>
        <h3>Discover aligned people</h3><p>A few thoughtful suggestions with clear reasons why — no endless browsing, no gamification.</p></div>
      <div class="step"><span class="step-num" aria-hidden="true">3</span>
        <h3>Connect with consent</h3><p>Send an intentional request. The other person can accept, ask a question, set a boundary, or decline — every answer is dignified.</p></div>
    </div>`),
  ]);
  wrap.appendChild(steps);

  const principles = card([
    el(`<h2>Our principles</h2>`),
    el(`<ul class="reason-list">
      <li><strong>Private by default.</strong> No exact location, no contact details, nothing sensitive — until you both choose to share.</li>
      <li><strong>Staged consent.</strong> Accept, accept with a boundary, ask a question, or decline. Pausing is as easy as connecting.</li>
      <li><strong>No spiritual ranking.</strong> You will never see a “compatibility score” used to judge a soul.</li>
      <li><strong>Not therapy, not fortune-telling.</strong> SEREN is for peer connection — not clinical, medical, or psychic-certainty claims.</li>
    </ul>`),
  ]);
  wrap.appendChild(principles);

  if (!profileId) {
    const newCard = card([
      el(`<h2>New to SEREN</h2>`),
      el(`<p class="lede" style="font-size:1rem">Create your profile in a few gentle steps — about three minutes. You can pause anytime.</p>`),
      el(`<div class="btn-row"><a class="btn btn-primary" href="#/onboarding">Begin gently</a></div>`),
    ]);
    newCard.classList.add('welcome-back');
    wrap.appendChild(newCard);

    const back = card([]);
    back.classList.add('welcome-back');
    back.appendChild(el(`<h2>Welcome back</h2>`));
    back.appendChild(el(`<p class="lede" style="font-size:1rem">Used SEREN on another device? Enter your email and display name to reconnect this device to your profile.</p>`));
    const banner = errorBanner();
    back.appendChild(banner.node);
    const form = el(`<form novalidate></form>`);
    const emailInput = textInput({
      id: 'relink-email', type: 'email', placeholder: 'you@example.com',
      autocomplete: 'email', required: true,
    });
    const nameInput = textInput({
      id: 'relink-name', placeholder: 'Your display name',
      autocomplete: 'name', required: true,
    });
    form.appendChild(field('Email', emailInput, { id: 'relink-email' }));
    form.appendChild(field('Display name', nameInput, { id: 'relink-name' }));
    const submit = el(`<button type="submit" class="btn btn-secondary">Reconnect this device</button>`);
    form.appendChild(submit);
    wireSubmit(form, submit, async () => {
      banner.clear();
      const email = emailInput.value.trim();
      const name = nameInput.value.trim();
      if (!email || !name) {
        banner.show('Please enter both your email and display name.');
        return;
      }
      try {
        const data = await relink(email, name);
        setProfileId(data.profileId);
        try {
          const profile = await getProfile(data.profileId);
          set({ profile });
        } catch { /* profile loads on the next route */ }
        toast('Welcome back — this device is reconnected.');
        navigate('#/');
      } catch (e) {
        // A 404/400 means no matching profile; anything else gets its
        // friendly summary. The copy stays gentle either way.
        if (e && (e.status === 404 || e.status === 400)) {
          banner.show('No profile matches that email and name.');
        } else {
          banner.show(friendlyError(e));
        }
      }
    });
    back.appendChild(form);
    wrap.appendChild(back);
  }

  wrap.appendChild(el(`<p class="footer-note center" style="margin-top:2.5rem;max-width:38rem;margin-left:auto;margin-right:auto">
    SEREN is a connection platform — not medical, mental-health, legal, or emergency support.
    If you are in crisis, please contact your local emergency number or a trusted support line.</p>`));
  return wrap;
}
