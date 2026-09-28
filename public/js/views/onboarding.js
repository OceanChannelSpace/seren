// SEREN onboarding — 6-step profile creation wizard.
// Backend requirements on create (src/validate.js): name, email, interests[]
// (legacy 1–8), intention free text (10–500), connectionPrefs.seeking (from
// SEEKING), consents with introductions=true. Richer fields ride along.

import { get, setProfileId, metaList, practiceLabel } from '../state.js';
import { createProfile, friendlyError } from '../api.js';
import {
  el, esc, card, errorBanner, toast, announce, chipGroup, chipSingle,
  field, textInput, textArea, selectInput, loading, pageShell,
} from '../ui.js';
import { navigate } from '../router.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Legacy interest values (src/constants.js INTERESTS) used for the
// introduction-tags field the backend still requires on create.
const LEGACY_INTERESTS = [
  'meditation', 'tarot', 'astrology', 'breathwork', 'reiki', 'sound-healing',
  'yoga', 'journaling', 'dreamwork', 'numerology', 'crystals', 'shamanism',
];
const interestLabel = (v) => v.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

// Map structured intentions → legacy connectionPrefs.seeking values.
// The legacy field is required by the backend; the structured intentions
// carry the real meaning.
const SEEKING_MAP = {
  'meaningful-friendship': 'friendship',
  'spiritual-peer-connection': 'friendship',
  'consciousness-exploration': 'collaboration',
  'meditation-partner': 'practice-partner',
  'dreamwork-symbolism': 'practice-partner',
  'tarot-oracle-exchange': 'practice-partner',
  'astrology-discussion': 'collaboration',
  'energy-work-discussion': 'practice-partner',
  'breathwork-somatic': 'practice-partner',
  'creative-collaboration': 'collaboration',
  'study-research': 'collaboration',
  'local-gathering': 'friendship',
  'remote-conversation': 'friendship',
  'accountability-partner': 'practice-partner',
  'mentorship-learning': 'guidance',
};

const VISUAL_IDENTITY_OPTIONS = [
  { value: '', label: 'Choose a feeling…' },
  { value: 'grounded', label: 'Grounded earth' },
  { value: 'celestial', label: 'Celestial light' },
  { value: 'oceanic', label: 'Oceanic depth' },
  { value: 'minimal', label: 'Quiet minimal' },
  { value: 'warm', label: 'Warm glow' },
];

const LOCALITY_OPTIONS = [
  { value: 'either', label: 'Either is fine' },
  { value: 'local', label: 'Mostly local' },
  { value: 'remote', label: 'Mostly remote' },
];

const STEPS = [
  { id: 'welcome', title: 'Welcome', heading: 'Begin with the basics' },
  { id: 'practices', title: 'Practices', heading: 'What calls to you?' },
  { id: 'intentions', title: 'Intentions', heading: 'What are you hoping for?' },
  { id: 'connect', title: 'Connection', heading: 'How would you like to connect?' },
  { id: 'about', title: 'About', heading: 'A little about you' },
  { id: 'consent', title: 'Consent', heading: 'Your consent, in plain language' },
];

export async function renderOnboarding(root, ctx) {
  root.innerHTML = '';

  // Already have a profile on this device — don't create a second one.
  if (get('profileId')) {
    const shell = pageShell('You’re already here', 'Onboarding');
    shell.body.appendChild(card([
      el(`<h2 style="margin-top:0">Welcome back</h2>`),
      el(`<p>There’s already a SEREN profile on this device. You can continue discovering, or refine your profile.</p>`),
      el(`<div class="btn-row"><a class="btn btn-primary" href="#/discover">Continue to Discover</a>
        <a class="btn btn-secondary" href="#/me/edit">Edit my profile</a></div>`),
    ]));
    root.appendChild(shell.root);
    return;
  }

  const shell = pageShell('Create your profile', 'Onboarding · step by step, at your pace');
  shell.root.classList.add('page-narrow');
  const banner = errorBanner();
  shell.body.appendChild(banner.node);

  const stepper = el(`<div class="stepper" role="list" aria-label="Onboarding progress"></div>`);
  shell.body.appendChild(stepper);
  const stepHost = el(`<div></div>`);
  shell.body.appendChild(stepHost);
  root.appendChild(shell.root);

  // Draft accumulates across steps.
  const draft = {
    name: '', email: '', pronouns: '', region: '',
    practices: [], practicesOther: '', tags: [],
    intentions: [], intentionsOther: '', intentionText: '',
    formats: [], localRemote: 'either', languages: '', availability: '',
    about: '', visualIdentity: '', photoUrl: '',
    communityVisible: true, aiMatching: true,
  };

  let stepIndex = 0;
  let submitting = false;

  function paintStepper() {
    stepper.innerHTML = '';
    STEPS.forEach((s, i) => {
      const dot = el(`<span class="step-dot${i < stepIndex ? ' done' : ''}${i === stepIndex ? ' now' : ''}"
        role="listitem" aria-label="Step ${i + 1}: ${esc(s.title)}${i === stepIndex ? ' (current)' : ''}"></span>`);
      stepper.appendChild(dot);
    });
  }

  function navRow({ backLabel = 'Back', nextLabel = 'Continue', onBack, onNext, nextPrimary = true }) {
    const row = el(`<div class="step-nav"></div>`);
    const back = el(`<button type="button" class="btn btn-ghost">${esc(backLabel)}</button>`);
    const next = el(`<button type="button" class="btn ${nextPrimary ? 'btn-primary' : 'btn-secondary'}">${esc(nextLabel)}</button>`);
    if (onBack) back.addEventListener('click', onBack);
    else back.disabled = true, back.style.visibility = 'hidden';
    next.addEventListener('click', async () => {
      if (submitting) return;
      banner.clear();
      const err = await onNext();
      if (err) { banner.show(err); announce(err); }
    });
    row.append(back, next);
    return { row, next };
  }

  const goStep = (i) => { stepIndex = i; paintStepper(); renderStep(); window.scrollTo({ top: 0 }); };

  function renderStep() {
    stepHost.innerHTML = '';
    const step = STEPS[stepIndex];
    const wrap = card([]);
    wrap.appendChild(el(`<h2 style="margin-top:0">${esc(step.heading)}</h2>`));
    const form = el(`<div></div>`);
    wrap.appendChild(form);

    if (step.id === 'welcome') {
      const name = textInput({ id: 'ob-name', value: draft.name, placeholder: 'What should we call you?', maxLength: 80, autocomplete: 'name' });
      const email = textInput({ id: 'ob-email', value: draft.email, type: 'email', placeholder: 'you@example.com', maxLength: 254, autocomplete: 'email' });
      const pronouns = textInput({ id: 'ob-pronouns', value: draft.pronouns, placeholder: 'she/her, he/him, they/them…', maxLength: 40 });
      const region = textInput({ id: 'ob-region', value: draft.region, placeholder: 'e.g. Boston area, Pacific Northwest', maxLength: 80 });
      form.append(
        field('Your name', name, { id: 'ob-name', hint: '2–80 characters. This is how you’ll appear to others.' }),
        field('Email', email, { id: 'ob-email', hint: 'Private — never shown to other members. Used only for your account.' }),
        field('Pronouns (optional)', pronouns, { id: 'ob-pronouns' }),
        field('General area (optional)', region, { id: 'ob-region', hint: 'A general area is plenty — never an exact address.' }),
      );
      const { row } = navRow({
        onBack: null,
        nextLabel: 'Continue',
        onNext: () => {
          draft.name = name.value.trim();
          draft.email = email.value.trim().toLowerCase();
          draft.pronouns = pronouns.value.trim();
          draft.region = region.value.trim();
          if (draft.name.length < 2) return 'Please share your name (at least 2 characters).';
          if (!EMAIL_RE.test(draft.email)) return 'Please enter a valid email address.';
          if (draft.pronouns.length > 40) return 'Pronouns must be under 40 characters.';
          if (draft.region.length > 80) return 'Please keep your area under 80 characters.';
          goStep(1);
          return null;
        },
      });
      wrap.appendChild(row);
    }

    if (step.id === 'practices') {
      const practices = metaList('practices').map((p) => ({ value: p.value, label: p.label }));
      const g = chipGroup({ name: 'practices', options: practices, values: draft.practices, max: 8, ariaLabel: 'Practices and interests' });
      const other = textInput({ id: 'ob-practices-other', value: draft.practicesOther, placeholder: 'Anything else? (optional)', maxLength: 140 });
      // Legacy introduction tags — pre-seed from practice overlap on first visit.
      if (!draft.tags.length && draft.practices.length) {
        draft.tags = draft.practices.filter((p) => LEGACY_INTERESTS.includes(p));
      }
      const tags = chipGroup({
        name: 'tags', ariaLabel: 'Introduction tags',
        options: LEGACY_INTERESTS.map((v) => ({ value: v, label: interestLabel(v) })),
        values: draft.tags, max: 8,
      });
      form.append(
        field('Practices & interests', g.node, { hint: 'Choose up to 8. These describe interests only — never proof of expertise.' }),
        field('Other practices (optional)', other, { id: 'ob-practices-other' }),
        field('Introduction tags', tags.node, {
          hint: 'Short labels shown when we introduce you. Pick at least one.',
        }),
      );
      const { row } = navRow({
        onBack: () => goStep(0),
        onNext: () => {
          draft.practices = g.get();
          draft.practicesOther = other.value.trim();
          draft.tags = tags.get();
          if (!draft.practices.length) return 'Please choose at least one practice.';
          if (!draft.tags.length) return 'Please pick at least one introduction tag.';
          goStep(2);
          return null;
        },
      });
      wrap.appendChild(row);
    }

    if (step.id === 'intentions') {
      const intentions = metaList('intentions').map((p) => ({ value: p.value, label: p.label }));
      const g = chipGroup({ name: 'intentions', options: intentions, values: draft.intentions, max: 5, ariaLabel: 'Intentions' });
      const other = textInput({ id: 'ob-intentions-other', value: draft.intentionsOther, placeholder: 'In a few words (optional)', maxLength: 140 });
      const free = textArea({ id: 'ob-intention-text', value: draft.intentionText, rows: 4, maxLength: 500, placeholder: 'e.g. I’m hoping to find a calm meditation partner to sit with weekly and reflect on practice together.' });
      const count = el(`<p class="char-count" aria-live="polite"></p>`);
      const paintCount = () => { count.textContent = `${free.value.trim().length} / 500 (minimum 10)`; };
      free.addEventListener('input', paintCount); paintCount();
      form.append(
        field('Intentions', g.node, { hint: 'Choose up to 5. What kind of connection are you hoping for?' }),
        field('Other intention (optional)', other, { id: 'ob-intentions-other' }),
        field('In your own words', free, { id: 'ob-intention-text', hint: 'A sentence or two about what you’re hoping for. This is shared when you’re introduced.' }),
        count,
      );
      const { row } = navRow({
        onBack: () => goStep(1),
        onNext: () => {
          draft.intentions = g.get();
          draft.intentionsOther = other.value.trim();
          draft.intentionText = free.value.trim();
          if (draft.intentionText.length < 10) return 'Please share a little more — at least 10 characters about what you’re hoping for.';
          if (draft.intentionText.length > 500) return 'Please keep it under 500 characters.';
          goStep(3);
          return null;
        },
      });
      wrap.appendChild(row);
    }

    if (step.id === 'connect') {
      const formats = metaList('connectionFormats');
      const fmtOpts = formats.length
        ? formats.map((f) => ({ value: f.value, label: f.label }))
        : ['message', 'voice', 'video', 'group', 'in-person'].map((v) => ({ value: v, label: interestLabel(v) }));
      const g = chipGroup({ name: 'formats', options: fmtOpts, values: draft.formats, max: 4, ariaLabel: 'Preferred connection formats' });
      const loc = chipSingle({ name: 'locality', options: LOCALITY_OPTIONS, value: draft.localRemote, ariaLabel: 'Local or remote' });
      const langs = textInput({ id: 'ob-langs', value: draft.languages, placeholder: 'English, Français…', maxLength: 200 });
      const avail = textInput({ id: 'ob-avail', value: draft.availability, placeholder: 'e.g. Sunday mornings, weekday evenings', maxLength: 200 });
      form.append(
        field('How would you like to connect?', g.node, { hint: 'Choose up to 4. You can always adjust these later.' }),
        field('Local, remote, or either?', loc.node, {}),
        field('Languages', langs, { id: 'ob-langs', hint: 'Comma-separated. Up to 10.' }),
        field('Availability (optional)', avail, { id: 'ob-avail', hint: 'A gentle sense of when you’re usually free.' }),
      );
      const { row } = navRow({
        onBack: () => goStep(2),
        onNext: () => {
          draft.formats = g.get();
          draft.localRemote = loc.get() || 'either';
          draft.languages = langs.value.trim();
          draft.availability = avail.value.trim();
          const langsArr = draft.languages.split(',').map((s) => s.trim()).filter(Boolean);
          if (langsArr.length > 10) return 'Please list at most 10 languages.';
          if (langsArr.some((l) => l.length > 40)) return 'Each language must be under 40 characters.';
          goStep(4);
          return null;
        },
      });
      wrap.appendChild(row);
    }

    if (step.id === 'about') {
      const about = textArea({ id: 'ob-about', value: draft.about, rows: 5, maxLength: 500, placeholder: 'Whatever feels right to share — your path, your practice, what’s alive for you lately. (optional)' });
      const count = el(`<p class="char-count" aria-live="polite"></p>`);
      const paintCount = () => { count.textContent = `${about.value.length} / 500`; };
      about.addEventListener('input', paintCount); paintCount();
      const visual = selectInput({ id: 'ob-visual', options: VISUAL_IDENTITY_OPTIONS, value: draft.visualIdentity, ariaLabel: 'Visual feeling' });
      const photo = textInput({ id: 'ob-photo', value: draft.photoUrl, type: 'url', placeholder: 'https://… (optional)', maxLength: 500 });
      form.append(
        field('About you (optional)', about, { id: 'ob-about', hint: 'A few sentences others will see on your profile.' }),
        count,
        field('Visual feeling (optional)', visual, { id: 'ob-visual', hint: 'A subtle aesthetic for your profile card.' }),
        field('Photo URL (optional)', photo, { id: 'ob-photo', hint: 'A link to an image of you, if you’d like one. Never required.' }),
      );
      const { row } = navRow({
        onBack: () => goStep(3),
        onNext: () => {
          draft.about = about.value.trim();
          draft.visualIdentity = visual.value || '';
          draft.photoUrl = photo.value.trim();
          if (draft.about.length > 500) return 'Please keep your about section under 500 characters.';
          goStep(5);
          return null;
        },
      });
      wrap.appendChild(row);
    }

    if (step.id === 'consent') {
      const toggles = el(`<div></div>`);
      const mkToggle = (key, title, desc, initial) => {
        const rowEl = el(`
          <div class="toggle-row">
            <div class="toggle-text"><strong>${esc(title)}</strong><span>${esc(desc)}</span></div>
            <label class="switch"><input type="checkbox" ${initial ? 'checked' : ''} aria-label="${esc(title)}"><span class="track"></span></label>
          </div>`);
        toggles.appendChild(rowEl);
        return rowEl.querySelector('input');
      };
      form.appendChild(el(`<div class="consent-note" style="margin-bottom:1rem">
        <p><strong>Introductions are the heart of SEREN.</strong> Creating a profile means you’re open to
        thoughtful introductions — you can pause them or opt out entirely at any time in Settings.
        Nothing here is ever shared without your say-so.</p></div>`));
      const communityInput = mkToggle('community', 'Visible in community spaces',
        'Include your profile in Discover suggestions and the community directory.', draft.communityVisible);
      const aiInput = mkToggle('ai', 'Thoughtful matching',
        'Let SEREN suggest aligned people based on shared practices and intentions — with clear reasons, never a score.', draft.aiMatching);
      form.appendChild(toggles);
      form.appendChild(el(`<div class="privacy-note">
        <strong>Private by default:</strong> your email is never shown to other members. Your general area,
        practices, and photo appear only as you’ve allowed. Pausing hides you from Discover and new
        requests — existing connections stay exactly as they are.</div>`));

      const { row, next } = navRow({
        onBack: () => goStep(4),
        nextLabel: 'Create my profile',
        onNext: async () => {
          draft.communityVisible = communityInput.checked;
          draft.aiMatching = aiInput.checked;
          await submitProfile(next);
          return null;
        },
      });
      wrap.appendChild(row);
    }

    stepHost.appendChild(wrap);
    announce(`Step ${stepIndex + 1} of ${STEPS.length}: ${step.title}`);
  }

  async function submitProfile(nextBtn) {
    submitting = true;
    const original = nextBtn.textContent;
    nextBtn.disabled = true; nextBtn.classList.add('btn-loading'); nextBtn.textContent = 'Creating…';
    try {
      const languages = draft.languages.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10);
      const seekingSet = new Set(draft.intentions.map((i) => SEEKING_MAP[i]).filter(Boolean));
      const seeking = seekingSet.size ? [...seekingSet] : ['friendship'];
      const payload = {
        name: draft.name,
        email: draft.email,
        interests: draft.tags,
        intention: draft.intentionText,
        practices: draft.practices,
        intentions: draft.intentions,
        connectionPrefs: { seeking, availability: draft.availability },
        prefs: {
          localRemote: draft.localRemote,
          formats: draft.formats,
          languages,
          availability: draft.availability,
        },
        consents: { introductions: true, community_visible: draft.communityVisible, ai_matching: draft.aiMatching },
        consentSettings: {
          discoveryEnabled: true, paused: false, intentionalRequests: true,
          messagesAfterMutual: true, groupInvites: true, eventInvites: true,
          collaborationRequests: true, showPractices: true, showRegion: true,
          showPhoto: true, notifications: true,
        },
      };
      if (draft.pronouns) payload.pronouns = draft.pronouns;
      if (draft.region) payload.region = draft.region;
      if (draft.about) payload.about = draft.about;
      if (draft.visualIdentity) payload.visualIdentity = draft.visualIdentity;
      if (draft.photoUrl) payload.photoUrl = draft.photoUrl;
      if (draft.practicesOther) payload.practicesOther = draft.practicesOther;
      if (draft.intentionsOther) payload.intentionsOther = draft.intentionsOther;

      const profile = await createProfile(payload);
      setProfileId(profile.id);
      toast('Welcome to SEREN — your profile is created.');
      navigate('#/discover');
    } catch (e) {
      banner.show(friendlyError(e));
      announce('Profile creation failed: ' + friendlyError(e));
    } finally {
      submitting = false;
      nextBtn.disabled = false; nextBtn.classList.remove('btn-loading'); nextBtn.textContent = original;
    }
  }

  paintStepper();
  renderStep();
}
