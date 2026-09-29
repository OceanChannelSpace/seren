// SEREN onboarding — 7-screen flow, one focused question at a time.
// Backend requirements on create (src/validate.js): name, email, interests[]
// (legacy 1–8, required), intention free text (10–500), connectionPrefs.seeking
// (from SEEKING), consents with introductions=true. Richer fields ride along.
//
// Payload notes:
// - `values` (screen 6) has no column in the DB, so it is persisted inside
//   prefs.values (JSON) rather than being silently dropped as a top-level key.
// - `intentions[]` is derived from the prompt chip picked on screen 2, and
//   only values present in the live taxonomy are sent.

import { get, setProfileId, metaList } from '../state.js';
import { createProfile, friendlyError } from '../api.js';
import {
  el, esc, card, errorBanner, toast, announce, chipGroup, chipSingle,
  field, textInput, textArea, pageShell,
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

// Intention prompt chips (screen 2). Each maps to a taxonomy intention value;
// 'meaningful-friendship' is the fallback where no closer value exists.
const PROMPTS = [
  { text: 'I want more spiritually aligned friendships', intention: 'meaningful-friendship' },
  { text: 'I want a peer to explore consciousness with', intention: 'consciousness-exploration' },
  { text: 'I want a practice partner', intention: 'meditation-partner' },
  { text: 'I want to find an intentional local community', intention: 'local-gathering' },
  { text: 'I want to join or form a circle', intention: 'meaningful-friendship' },
  { text: 'I want to explore a topic or modality', intention: 'consciousness-exploration' },
  { text: 'I want a creative or research collaborator', intention: 'creative-collaboration' },
  { text: 'I want a mentor, teacher, or learning exchange', intention: 'mentorship-learning' },
];

const VALUES_OPTIONS = [
  { value: 'grounded', label: 'Grounded' },
  { value: 'curious', label: 'Curious' },
  { value: 'reflective', label: 'Reflective' },
  { value: 'playful', label: 'Playful' },
  { value: 'structured', label: 'Structured' },
  { value: 'open-hearted', label: 'Open-hearted' },
];

const FORMAT_VALUES = ['message', 'video', 'voice', 'in-person'];
const FORMAT_FALLBACK_LABELS = {
  message: 'Text messages', video: 'Video call', voice: 'Voice call', 'in-person': 'In person',
};

const LOCALITY_OPTIONS = [
  { value: 'either', label: 'No preference' },
  { value: 'local', label: 'Local' },
  { value: 'remote', label: 'Remote' },
];

const STEPS = [
  { id: 'welcome', title: 'Welcome' },
  { id: 'intention', title: 'Your intention' },
  { id: 'basics', title: 'Basics' },
  { id: 'practices', title: 'Practices' },
  { id: 'preferences', title: 'Preferences' },
  { id: 'values', title: 'Values' },
  { id: 'consent', title: 'Consent' },
];

const DRAFT_KEY = 'seren.onboarding2.draft.v1';

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

  const shell = pageShell('Create your profile', 'A few gentle steps · about three minutes');
  shell.root.classList.add('page-narrow');
  const banner = errorBanner();
  shell.body.appendChild(banner.node);

  const stepper = el(`<div class="stepper" role="list" aria-label="Onboarding progress"></div>`);
  shell.body.appendChild(stepper);
  const stepCount = el(`<p class="step-count" aria-live="polite" style="color:var(--mist-dim);font-size:0.85rem;margin:-1.1rem 0 1.25rem;"></p>`);
  shell.body.appendChild(stepCount);
  const stepHost = el(`<div></div>`);
  shell.body.appendChild(stepHost);
  root.appendChild(shell.root);

  // Draft accumulates across screens and survives a reload (session-scoped).
  const draft = {
    intentionText: '', intentionPrompt: null,
    name: '', email: '', pronouns: '', region: '',
    practices: [], practicesOther: '', tags: [],
    formats: [], localRemote: 'either',
    values: [],
    communityVisible: true, aiMatching: true,
  };
  try {
    const saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
    if (saved && typeof saved === 'object') Object.assign(draft, saved);
  } catch { /* start fresh */ }
  const persistDraft = () => {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* private mode */ }
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
    stepCount.textContent = `Step ${stepIndex + 1} of ${STEPS.length}`;
  }

  function navRow({ backLabel = 'Back', nextLabel = 'Continue', onBack, onNext, onSkip, nextPrimary = true }) {
    const row = el(`<div class="step-nav"></div>`);
    const back = el(`<button type="button" class="btn btn-ghost">${esc(backLabel)}</button>`);
    if (onBack) back.addEventListener('click', onBack);
    else back.disabled = true, back.style.visibility = 'hidden';
    row.appendChild(back);

    const right = el(`<div style="display:flex;gap:0.75rem;flex-wrap:wrap;justify-content:flex-end"></div>`);
    if (onSkip) {
      const skip = el(`<button type="button" class="btn btn-ghost">Skip for now</button>`);
      skip.addEventListener('click', async () => {
        if (submitting) return;
        banner.clear();
        const err = await onSkip();
        if (err) { banner.show(err); announce(err); }
      });
      right.appendChild(skip);
    }
    const next = el(`<button type="button" class="btn ${nextPrimary ? 'btn-primary' : 'btn-secondary'}">${esc(nextLabel)}</button>`);
    next.addEventListener('click', async () => {
      if (submitting) return;
      banner.clear();
      const err = await onNext();
      if (err) { banner.show(err); announce(err); }
    });
    right.appendChild(next);
    row.appendChild(right);
    return { row, next };
  }

  const goStep = (i) => {
    stepIndex = i;
    try { sessionStorage.setItem(DRAFT_KEY + '.step', String(i)); } catch { /* private mode */ }
    persistDraft();
    paintStepper(); renderStep(); window.scrollTo({ top: 0 });
  };
  try {
    const savedStep = parseInt(sessionStorage.getItem(DRAFT_KEY + '.step') || '0', 10);
    if (Number.isInteger(savedStep) && savedStep >= 0 && savedStep < STEPS.length) stepIndex = savedStep;
  } catch { /* start at step 0 */ }

  function renderStep() {
    stepHost.innerHTML = '';
    const step = STEPS[stepIndex];
    const wrap = card([]);
    const form = el(`<div></div>`);
    wrap.appendChild(form);

    /* ---------------- 1. Welcome ---------------- */
    if (step.id === 'welcome') {
      wrap.insertBefore(el(`<h2 style="margin-top:0">Find people who meet you where you are.</h2>`), form);
      form.appendChild(el(`<p style="color:var(--mist);font-size:1.05rem;line-height:1.6">SEREN helps you make meaningful spiritual, metaphysical, and consciousness-centered connections — with clarity, consent, and mutual respect.</p>`));

      const explainer = el(`<div class="how-it-works" hidden style="margin:1.25rem 0;padding:1rem 1.25rem;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,0.02)">
        <h3 style="margin:0 0 0.6rem;font-size:1rem">How SEREN works</h3>
        <ol style="margin:0;padding-left:1.25rem;color:var(--mist);line-height:1.7">
          <li>Share what you are looking for</li>
          <li>Create a profile that reflects your interests, values, and boundaries</li>
          <li>Receive thoughtful connection suggestions</li>
          <li>Choose whether to request an introduction</li>
          <li>SEREN connects you only when both people opt in</li>
        </ol>
      </div>`);
      form.appendChild(explainer);

      const { row } = navRow({
        onBack: null,
        nextLabel: 'Begin',
        onNext: () => { goStep(1); return null; },
      });
      // Secondary "How does SEREN work?" toggle sits beside Begin.
      const howBtn = el(`<button type="button" class="btn btn-ghost">How does SEREN work?</button>`);
      howBtn.addEventListener('click', () => {
        explainer.hidden = !explainer.hidden;
        howBtn.textContent = explainer.hidden ? 'How does SEREN work?' : 'Hide';
      });
      row.querySelector('div').prepend(howBtn);
      wrap.appendChild(row);
    }

    /* ---------------- 2. Intention ---------------- */
    if (step.id === 'intention') {
      wrap.insertBefore(el(`<h2 style="margin-top:0">What would feel meaningful for you right now?</h2>`), form);
      const free = textArea({
        id: 'ob-intention', value: draft.intentionText, rows: 4, maxLength: 500,
        placeholder: 'In your own words — a sentence or two is plenty.',
      });
      const count = el(`<p class="char-count" aria-live="polite"></p>`);
      const paintCount = () => { count.textContent = `${free.value.trim().length} / 500`; };
      free.addEventListener('input', paintCount); paintCount();

      const chipsWrap = el(`<div class="chip-group" role="group" aria-label="Intention starters" style="margin-top:1rem"></div>`);
      const chipBtns = [];
      PROMPTS.forEach((p, idx) => {
        const b = el(`<button type="button" class="chip" aria-pressed="${draft.intentionPrompt === idx}">${esc(p.text)}</button>`);
        b.addEventListener('click', () => {
          free.value = p.text;
          draft.intentionPrompt = idx;
          for (const [i, cb] of chipBtns.entries()) cb.setAttribute('aria-pressed', String(i === idx));
          paintCount();
          free.focus();
        });
        chipBtns.push(b);
        chipsWrap.appendChild(b);
      });

      form.append(
        field('Your intention', free, { id: 'ob-intention', hint: 'This is shared when you’re introduced — write it like you’d say it to a friend.' }),
        count,
        el(`<p style="color:var(--mist-dim);font-size:0.9rem;margin:1.25rem 0 0.5rem">Or start with one of these — you can edit it after:</p>`),
        chipsWrap,
      );
      const { row } = navRow({
        onBack: () => goStep(0),
        onNext: () => {
          draft.intentionText = free.value.trim();
          if (draft.intentionText.length < 10) return 'Please share a little more — even a sentence helps SEREN understand what you’re hoping for.';
          if (draft.intentionText.length > 500) return 'Please keep it under 500 characters.';
          goStep(2);
          return null;
        },
      });
      wrap.appendChild(row);
    }

    /* ---------------- 3. Basics ---------------- */
    if (step.id === 'basics') {
      wrap.insertBefore(el(`<h2 style="margin-top:0">What should we call you?</h2>`), form);
      const name = textInput({ id: 'ob-name', value: draft.name, placeholder: 'Your name or a name you love', maxLength: 80, autocomplete: 'name' });
      const email = textInput({ id: 'ob-email', value: draft.email, type: 'email', placeholder: 'you@example.com', maxLength: 254, autocomplete: 'email' });
      const pronouns = textInput({ id: 'ob-pronouns', value: draft.pronouns, placeholder: 'she/her, he/him, they/them… (optional)', maxLength: 40 });
      const region = textInput({ id: 'ob-region', value: draft.region, placeholder: 'e.g. Boston area (optional)', maxLength: 80 });
      form.append(
        field('Your name', name, { id: 'ob-name', hint: '2–80 characters. This is how you’ll appear to others.' }),
        field('Email', email, { id: 'ob-email', hint: 'Private — never shown to other members. Used only for your account.' }),
        field('Pronouns', pronouns, { id: 'ob-pronouns' }),
        field('General area', region, { id: 'ob-region', hint: 'A general area is plenty — never an exact address.' }),
      );
      const { row } = navRow({
        onBack: () => goStep(1),
        onNext: () => {
          draft.name = name.value.trim();
          draft.email = email.value.trim().toLowerCase();
          draft.pronouns = pronouns.value.trim();
          draft.region = region.value.trim();
          if (draft.name.length < 2) return 'Please share your name (at least 2 characters).';
          if (!EMAIL_RE.test(draft.email)) return 'Please enter a valid email address.';
          if (draft.pronouns.length > 40) return 'Pronouns must be under 40 characters.';
          if (draft.region.length > 80) return 'Please keep your area under 80 characters.';
          goStep(3);
          return null;
        },
      });
      wrap.appendChild(row);
    }

    /* ---------------- 4. Practices ---------------- */
    if (step.id === 'practices') {
      wrap.insertBefore(el(`<h2 style="margin-top:0">What practices or paths are part of your life?</h2>`), form);
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
        field('Practices & paths', g.node, { hint: 'Choose up to 8 — or skip this entirely. These describe interests only, never expertise.' }),
        field('Anything else? (optional)', other, { id: 'ob-practices-other' }),
        field('How should we describe you in introductions?', tags.node, {
          hint: 'Short labels shown when we introduce you. Pick at least one.',
        }),
      );
      if (!practices.length) banner.show('Practices couldn’t be loaded — please reload the page and try again.');

      const collect = () => {
        draft.practices = g.get();
        draft.practicesOther = other.value.trim();
        draft.tags = tags.get();
        if (draft.practicesOther.length > 140) return 'Please keep “anything else” under 140 characters.';
        if (!draft.tags.length) return 'Please pick at least one introduction tag — it’s how SEREN describes you when proposing an introduction.';
        return null;
      };
      const { row } = navRow({
        onBack: () => goStep(2),
        onSkip: () => {
          draft.practices = [];
          draft.practicesOther = '';
          draft.tags = tags.get();
          if (!draft.tags.length) return 'Please pick at least one introduction tag — it’s how SEREN describes you when proposing an introduction.';
          goStep(4);
          return null;
        },
        onNext: () => {
          const err = collect();
          if (err) return err;
          goStep(4);
          return null;
        },
      });
      wrap.appendChild(row);
    }

    /* ---------------- 5. Preferences ---------------- */
    if (step.id === 'preferences') {
      wrap.insertBefore(el(`<h2 style="margin-top:0">How do you like to connect?</h2>`), form);
      const metaFormats = metaList('connectionFormats');
      const fmtOpts = FORMAT_VALUES.map((v) => {
        const found = metaFormats.find((f) => f.value === v);
        return { value: v, label: found ? found.label : (FORMAT_FALLBACK_LABELS[v] || v) };
      });
      const g = chipGroup({ name: 'formats', options: fmtOpts, values: draft.formats, max: 4, ariaLabel: 'Preferred connection formats' });
      const loc = chipSingle({ name: 'locality', options: LOCALITY_OPTIONS, value: draft.localRemote, ariaLabel: 'Local or remote' });
      form.append(
        field('Formats', g.node, { hint: 'Choose up to 4 — or skip. You can always adjust these later.' }),
        field('Local, remote, or either?', loc.node, {}),
      );
      const { row } = navRow({
        onBack: () => goStep(3),
        onSkip: () => {
          draft.formats = [];
          draft.localRemote = 'either';
          goStep(5);
          return null;
        },
        onNext: () => {
          draft.formats = g.get();
          draft.localRemote = loc.get() || 'either';
          goStep(5);
          return null;
        },
      });
      wrap.appendChild(row);
    }

    /* ---------------- 6. Values ---------------- */
    if (step.id === 'values') {
      wrap.insertBefore(el(`<h2 style="margin-top:0">What matters most in a connection right now?</h2>`), form);
      const g = chipGroup({ name: 'values', options: VALUES_OPTIONS, values: draft.values, max: 3, ariaLabel: 'Values' });
      form.append(
        field('Values', g.node, { hint: 'Pick up to 3 — or skip. There are no wrong answers here.' }),
      );
      const { row } = navRow({
        onBack: () => goStep(4),
        onSkip: () => {
          draft.values = [];
          goStep(6);
          return null;
        },
        onNext: () => {
          draft.values = g.get();
          goStep(6);
          return null;
        },
      });
      wrap.appendChild(row);
    }

    /* ---------------- 7. Consent ---------------- */
    if (step.id === 'consent') {
      wrap.insertBefore(el(`<h2 style="margin-top:0">Your boundaries, honored.</h2>`), form);
      form.appendChild(el(`<p style="color:var(--mist);line-height:1.6">Consent isn’t a checkbox you tick once — it’s the ground SEREN stands on. Set things as they feel right today; you can change any of this later in Settings.</p>`));

      const toggles = el(`<div></div>`);
      const mkToggle = (title, desc, initial) => {
        const rowEl = el(`
          <div class="toggle-row">
            <div class="toggle-text"><strong>${esc(title)}</strong><span>${esc(desc)}</span></div>
            <label class="switch"><input type="checkbox" ${initial ? 'checked' : ''} aria-label="${esc(title)}"><span class="track"></span></label>
          </div>`);
        toggles.appendChild(rowEl);
        return rowEl.querySelector('input');
      };
      const introInput = mkToggle('Thoughtful introductions',
        'You’re open to SEREN proposing introductions. Nothing happens without your explicit yes, each time.',
        true);
      const communityInput = mkToggle('Visible in community spaces',
        'Include your profile in Discover suggestions and the community directory.',
        draft.communityVisible);
      const aiInput = mkToggle('Thoughtful matching',
        'Let SEREN suggest aligned people based on shared practices and intentions — with clear reasons, never a score.',
        draft.aiMatching);
      form.appendChild(toggles);
      form.appendChild(el(`<div class="privacy-note">
        <strong>Private by default:</strong> your email is never shown to other members. Your general area and
        practices appear only as you’ve allowed. Pausing hides you from Discover and new requests —
        existing connections stay exactly as they are.</div>`));

      const { row, next } = navRow({
        onBack: () => goStep(5),
        nextLabel: 'Complete profile',
        onNext: async () => {
          draft.communityVisible = communityInput.checked;
          draft.aiMatching = aiInput.checked;
          if (!introInput.checked) {
            return 'Introductions need to be on to create your profile — they’re the heart of SEREN. You can pause them or step back anytime in Settings.';
          }
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
      // Only taxonomy-valid intention values are sent.
      const validIntentions = new Set(metaList('intentions').map((i) => i.value));
      const intentions = draft.intentionPrompt != null
        ? [PROMPTS[draft.intentionPrompt].intention].filter((v) => validIntentions.has(v))
        : [];
      const seekingSet = new Set(intentions.map((i) => SEEKING_MAP[i]).filter(Boolean));
      const seeking = seekingSet.size ? [...seekingSet] : ['friendship'];
      const payload = {
        name: draft.name,
        email: draft.email,
        interests: draft.tags,
        intention: draft.intentionText,
        practices: draft.practices,
        intentions,
        connectionPrefs: { seeking, availability: '' },
        prefs: {
          localRemote: draft.localRemote,
          formats: draft.formats,
          values: draft.values,
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
      if (draft.practicesOther) payload.practicesOther = draft.practicesOther;

      const profile = await createProfile(payload);
      setProfileId(profile.id);
      try {
        sessionStorage.removeItem(DRAFT_KEY);
        sessionStorage.removeItem(DRAFT_KEY + '.step');
      } catch { /* ignore */ }
      toast('Welcome to SEREN — your profile is created.');
      navigate('#/');
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
