'use strict';
/* SEREN MVP frontend — vanilla JS, hash routing, no build step.
   API contract: /home/hatch/workspace/seren-mvp/docs/API_CONTRACT.md */

const API_BASE = '/api';
const STORAGE_KEY = 'seren_profile_id';

const INTERESTS = [
  { value: 'meditation',   label: 'Meditation' },
  { value: 'tarot',        label: 'Tarot' },
  { value: 'astrology',    label: 'Astrology' },
  { value: 'breathwork',   label: 'Breathwork' },
  { value: 'reiki',        label: 'Reiki' },
  { value: 'sound-healing',label: 'Sound healing' },
  { value: 'yoga',         label: 'Yoga' },
  { value: 'journaling',   label: 'Journaling' },
  { value: 'dreamwork',    label: 'Dreamwork' },
  { value: 'numerology',   label: 'Numerology' },
  { value: 'crystals',     label: 'Crystals' },
  { value: 'shamanism',    label: 'Shamanism' },
];
const INTEREST_VALUES = INTERESTS.map(i => i.value);
const INTEREST_LABELS = Object.fromEntries(INTERESTS.map(i => [i.value, i.label]));

const SEEKING_OPTIONS = [
  { value: 'friendship',      label: 'Friendship' },
  { value: 'practice-partner',label: 'Practice partner' },
  { value: 'collaboration',   label: 'Collaboration' },
  { value: 'guidance',        label: 'Guidance' },
];
const SEEKING_VALUES = SEEKING_OPTIONS.map(s => s.value);

const STATUS_GROUPS = ['proposed', 'accepted', 'declined', 'withdrawn'];
const GROUP_EMPTY = {
  proposed:  'No proposed connections yet. When SEREN suggests an introduction, it will appear here.',
  accepted:  'No accepted connections yet. Introductions you accept will live here.',
  declined:  'No declined connections. Gently passed-on introductions appear here.',
  withdrawn: 'No withdrawn requests. Introductions you withdraw appear here.',
};

/* Small generic stopword list used only to *display* shared keywords on the
   match card. The server remains the source of truth for the keyword count
   in the score breakdown. */
const STOPWORDS = new Set([
  'the','and','for','are','but','not','you','your','with','have','has','had',
  'this','that','those','these','from','they','them','their','was','were',
  'been','being','our','ours','out','about','into','over','after','before',
  'will','would','could','should','shall','may','might','must','who','what',
  'when','where','which','while','each','such','more','most','very','also',
  'just','only','than','then','there','here','how','why','all','any','both',
  'does','did','done','its','per','via','among','between','through','during',
  'under','again','once','ever','never','some','many','much','such','own',
  'same','other','than','into','onto','upon','within','without','along',
]);

/* ---------------- tiny helpers ---------------- */

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function announce(message) {
  const region = $('#status-region');
  if (!region) return;
  region.textContent = '';
  // force re-announcement of identical messages
  setTimeout(() => { region.textContent = message; }, 30);
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function plural(n, one, many) { return n === 1 ? one : many; }

/* ---------------- API layer ---------------- */

class ApiError extends Error {
  constructor(kind, status, code, message, details) {
    super(message);
    this.kind = kind;       // 'network' | 'http'
    this.status = status;   // number | null
    this.code = code;       // snake_case error code | null
    this.details = details; // validation details array | null
  }
}

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError('network', null, null,
      'Could not reach the SEREN server. Please check your connection and try again.');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-JSON body */ }
  if (!res.ok) {
    const err = (data && data.error) || {};
    if (res.status === 403 && err.code === 'beta_required') lockBeta();
    throw new ApiError('http', res.status, err.code || null,
      err.message || ('Request failed (HTTP ' + res.status + ').'),
      err.details || null);
  }
  return data;
}

/* ---------------- private beta gate ---------------- */
/* When the server runs with BETA_CODE set, the API requires a beta cookie.
   The shell below collects the invite code and reloads once admitted. */

let betaLocked = false;

function lockBeta() {
  if (betaLocked) return;
  betaLocked = true;
  document.body.classList.add('beta-locked');
  render();
}

async function checkBeta() {
  let status = null;
  try {
    const res = await fetch(API_BASE + '/beta/status');
    status = await res.json();
  } catch (e) { /* server unreachable: let normal error paths handle it */ }
  if (status && status.beta && !status.entered) lockBeta();
  else document.body.classList.remove('beta-locked');
}

function renderBetaGate(main) {
  main.innerHTML =
    '<div class="card beta-gate">' +
      '<p class="beta-eyebrow">&#10022; Private beta</p>' +
      '<h1>Welcome to SEREN</h1>' +
      '<p>SEREN is currently in a private beta for a small circle. Enter your beta invite code to continue.</p>' +
      '<form id="beta-form" novalidate>' +
        '<label class="field"><span class="field-label">Beta invite code</span>' +
        '<input id="beta-code" name="code" type="text" inputmode="text" autocomplete="off" ' +
        'placeholder="Enter your invite code" required></label>' +
        '<p id="beta-error" class="field-error" role="alert" hidden></p>' +
        '<button type="submit" class="btn btn-primary" id="beta-submit">Enter beta</button>' +
      '</form>' +
    '</div>';
  const form = $('#beta-form');
  const input = $('#beta-code');
  const errP = $('#beta-error');
  input.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#beta-submit');
    btn.disabled = true;
    errP.hidden = true;
    try {
      await api('POST', '/beta/enter', { code: input.value });
      betaLocked = false;
      location.reload(); // pick up the freshly issued beta cookie
    } catch (err) {
      btn.disabled = false;
      errP.textContent = err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
      errP.hidden = false;
      input.focus();
      input.select();
    }
  });
}

/* ---------------- failure banner (global, dismissible, retryable) ---------------- */

let pendingRetry = null;

function showBanner(message, retry) {
  pendingRetry = typeof retry === 'function' ? retry : null;
  const region = $('#banner-region');
  region.innerHTML =
    '<div class="banner" role="alert">' +
      '<div class="banner-inner">' +
        '<p><strong>Something went wrong.</strong> ' + esc(message) + '</p>' +
        '<div class="banner-actions">' +
          (pendingRetry ? '<button type="button" class="btn btn-small btn-primary" id="banner-retry">Retry</button>' : '') +
          '<button type="button" class="btn btn-small btn-ghost" id="banner-dismiss">Dismiss</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  const retryBtn = $('#banner-retry');
  if (retryBtn) retryBtn.addEventListener('click', () => {
    const fn = pendingRetry;
    hideBanner();
    if (fn) fn();
  });
  $('#banner-dismiss').addEventListener('click', hideBanner);
  announce('Error: ' + message);
}

function hideBanner() {
  $('#banner-region').innerHTML = '';
  pendingRetry = null;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#banner-region').firstChild) hideBanner();
});

/* ---------------- profile identity ---------------- */

let cachedProfile = null;

function profileId() { return localStorage.getItem(STORAGE_KEY); }

async function getProfile(id, force) {
  if (cachedProfile && cachedProfile.id === Number(id) && !force) return cachedProfile;
  const p = await api('GET', '/profiles/' + encodeURIComponent(id));
  cachedProfile = p;
  return p;
}

/* Public (demo-safe) directory, cached — used for demo-seed badges. */
let cachedDirectory = null;
async function getDirectory() {
  if (cachedDirectory) return cachedDirectory;
  try {
    const data = await api('GET', '/profiles');
    cachedDirectory = new Map((data.profiles || []).map(p => [p.id, p]));
  } catch (e) {
    cachedDirectory = new Map();
  }
  return cachedDirectory;
}

let pendingNotice = null;
function flashNotice(msg) { pendingNotice = msg; }
function takeNotice() { const n = pendingNotice; pendingNotice = null; return n; }

/* ---------------- keyword display (match card) ---------------- */

function tokenize(text) {
  const tokens = String(text || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  return new Set(tokens.filter(t => t.length >= 4 && !STOPWORDS.has(t)));
}

function sharedKeywords(a, b) {
  const sa = tokenize(a), sb = tokenize(b);
  return [...sa].filter(t => sb.has(t)).sort().slice(0, 8);
}

/* ---------------- router ---------------- */

const routes = {
  '/': renderLanding,
  '/profile': renderProfile,
  '/connect': renderConnect,
  '/inbox': renderInbox,
};

function currentPath() {
  const h = location.hash.replace(/^#/, '') || '/';
  return h.split('?')[0];
}

function render() {
  hideBanner();
  const main = $('#main');
  if (betaLocked) {
    renderBetaGate(main);
    $('#main').focus({ preventScroll: true });
    return;
  }
  const path = currentPath();
  $$('[data-nav]').forEach(a => {
    const key = a.getAttribute('data-nav');
    const active = (path === '/' && key === 'home') || ('/' + key === path);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const view = routes[path] || renderLanding;
  main.innerHTML = '';
  view(main).catch(err => {
    if (err instanceof ApiError) {
      main.innerHTML =
        '<div class="card"><h1>Something went wrong</h1>' +
        '<p>' + esc(err.message) + '</p></div>';
      showBanner(err.message, () => render());
    } else {
      throw err;
    }
  });
  $('#main').focus({ preventScroll: true });
}

window.addEventListener('hashchange', render);

/* Notice shown after redirects (e.g. guard redirects). */
function maybeRenderNotice(main) {
  const n = takeNotice();
  if (!n) return;
  const div = document.createElement('div');
  div.className = 'notice';
  div.setAttribute('role', 'status');
  div.innerHTML = '<p>' + esc(n) + '</p>';
  main.prepend(div);
}

/* ---------------- view 1: landing ---------------- */

async function renderLanding(main) {
  maybeRenderNotice(main);
  const id = profileId();
  let name = null;
  if (id) {
    try { name = (await getProfile(id)).name; } catch (e) { /* stay generic */ }
  }

  main.innerHTML =
    '<section class="hero">' +
      '<span class="sigil" aria-hidden="true">&#10022;</span>' +
      '<p class="eyebrow">A consent-first spiritual community</p>' +
      '<h1>SEREN</h1>' +
      '<p class="lede">SEREN is a consent-first way to meet aligned people on your spiritual path &mdash; real introductions, guided by intention.</p>' +
      (id
        ? '<div class="welcome-back" role="status">' +
            '<h2>Welcome back' + (name ? ', ' + esc(name) : '') + '</h2>' +
            '<p>Your profile is saved on this device. Pick up where you left off:</p>' +
            '<div class="btn-row">' +
              '<a class="btn btn-primary" href="#/connect">Connect</a>' +
              '<a class="btn btn-secondary" href="#/inbox">Inbox</a>' +
            '</div>' +
          '</div>'
        : '<div class="btn-row center" style="justify-content:center">' +
            '<a class="btn btn-primary" href="#/profile">Begin your journey</a>' +
          '</div>') +
    '</section>' +

    '<section aria-labelledby="how-it-works">' +
      '<h2 id="how-it-works" class="center">How it works</h2>' +
      '<div class="steps">' +
        '<div class="step"><span class="step-num" aria-hidden="true">1</span>' +
          '<h3>Create your profile</h3>' +
          '<p>Share your name, spiritual interests, and an intention statement &mdash; plus exactly what you&rsquo;re open to.</p></div>' +
        '<div class="step"><span class="step-num" aria-hidden="true">2</span>' +
          '<h3>Request an introduction</h3>' +
          '<p>Set an intention for who you&rsquo;d like to meet. SEREN&rsquo;s matching engine finds an aligned member.</p></div>' +
        '<div class="step"><span class="step-num" aria-hidden="true">3</span>' +
          '<h3>Meet your match</h3>' +
          '<p>Receive a warm intro note explaining the alignment. Accept with joy &mdash; or gently pass and try another.</p></div>' +
      '</div>' +
    '</section>' +

    '<section class="consent-note" aria-labelledby="consent-heading">' +
      '<h2 id="consent-heading">Consent comes first</h2>' +
      '<p>Nothing in SEREN happens without your clear yes. You choose what to share, introductions only happen with your consent, and you can withdraw a request at any time.</p>' +
      '<p>No dark patterns, no hidden sharing &mdash; just aligned connection.</p>' +
    '</section>' +

    '<div class="divider-sigil" aria-hidden="true">&#10022;</div>';
}

/* ---------------- view 2: profile form ---------------- */

const FIELD_LABELS = {
  name: 'Name', email: 'Email', interests: 'Spiritual interests',
  intention: 'Intention', seeking: 'Seeking', availability: 'Availability',
  consents: 'Consents', introductions: 'Introductions consent',
};

function normalizeServerDetails(details) {
  const map = {};
  if (!Array.isArray(details)) return map;
  details.forEach(d => {
    let field = null, message = null;
    if (typeof d === 'string') {
      message = d;
    } else if (d && typeof d === 'object') {
      field = d.field || d.param || d.path || d.key || null;
      message = d.message || d.msg || d.error || null;
    }
    if (field && typeof field === 'string') {
      const f = field.toLowerCase();
      if (f.includes('seeking')) field = 'seeking';
      else if (f.includes('availability')) field = 'availability';
      else if (f.includes('introductions')) field = 'introductions';
      else if (f === 'connectionprefs' || f === 'connection_prefs') field = 'seeking';
      map[field] = message || 'This field needs attention.';
    } else if (message) {
      map._summary = (map._summary ? map._summary + ' ' : '') + message;
    }
  });
  return map;
}

function clientValidate(values, isEdit) {
  const errors = {};
  const name = values.name.trim();
  if (!name) errors.name = 'Please enter your name.';
  else if (name.length > 80) errors.name = 'Name must be 80 characters or fewer.';

  const email = values.email.trim().toLowerCase();
  if (!email) errors.email = 'Please enter your email address.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Please enter a valid email address.';

  if (!values.interests.length) errors.interests = 'Choose at least one spiritual interest.';
  else if (values.interests.length > 8) errors.interests = 'Choose at most 8 spiritual interests.';

  const intention = values.intention.trim();
  if (intention.length < 10) errors.intention = 'Your intention needs at least 10 characters.';
  else if (intention.length > 500) errors.intention = 'Your intention must be 500 characters or fewer.';

  if (values.availability.trim().length > 200) errors.availability = 'Availability must be 200 characters or fewer.';

  if (!isEdit && !values.consents.introductions) {
    errors.introductions = 'Introductions consent is required to create a profile — introductions are the heart of SEREN.';
  }
  return { errors, values: { ...values, name, email, intention } };
}

async function renderProfile(main) {
  maybeRenderNotice(main);
  const id = profileId();
  const isEdit = !!id;
  let existing = null;

  main.innerHTML =
    '<div class="view-head">' +
      '<p class="eyebrow">' + (isEdit ? 'Your profile' : 'Begin your journey') + '</p>' +
      '<h1>' + (isEdit ? 'Edit your profile' : 'Create your profile') + '</h1>' +
      '<p>' + (isEdit
        ? 'Update anything below — your changes save right away.'
        : 'Tell us a little about yourself so SEREN can introduce you to aligned members.') + '</p>' +
    '</div>' +
    '<div id="profile-loading" class="card"><p><span class="spinner" aria-hidden="true"></span> Loading your profile&hellip;</p></div>';

  if (isEdit) {
    try {
      existing = await getProfile(id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        localStorage.removeItem(STORAGE_KEY);
        cachedProfile = null;
        flashNotice('Your saved profile was not found, so let\u2019s create a new one.');
        location.hash = '#/profile';
        render();
        return;
      }
      main.innerHTML = '<div class="card"><h1>Could not load your profile</h1><p>' + esc(e.message) + '</p></div>';
      showBanner(e.message, () => renderProfile(main));
      return;
    }
  } else {
    $('#profile-loading').remove();
  }

  const v = existing ? {
    name: existing.name || '',
    email: existing.email || '',
    interests: Array.isArray(existing.interests) ? existing.interests.slice() : [],
    intention: existing.intention || '',
    seeking: (existing.connectionPrefs && existing.connectionPrefs.seeking) || [],
    availability: (existing.connectionPrefs && existing.connectionPrefs.availability) || '',
    consents: {
      introductions: !!(existing.consents && existing.consents.introductions),
      community_visible: !!(existing.consents && existing.consents.community_visible),
      ai_matching: !!(existing.consents && existing.consents.ai_matching),
    },
  } : {
    name: '', email: '', interests: [], intention: '',
    seeking: [], availability: '',
    consents: { introductions: true, community_visible: true, ai_matching: true },
  };

  const form = document.createElement('form');
  form.id = 'profile-form';
  form.noValidate = true;
  form.innerHTML =
    '<div id="form-errors" hidden></div>' +

    '<div class="card">' +
      '<div class="field">' +
        '<label for="pf-name">Name</label>' +
        '<input type="text" id="pf-name" name="name" maxlength="80" autocomplete="name" value="' + esc(v.name) + '" aria-describedby="pf-name-err">' +
        '<p class="field-error" id="pf-name-err" hidden></p>' +
      '</div>' +
      '<div class="field">' +
        '<label for="pf-email">Email</label>' +
        '<input type="email" id="pf-email" name="email" autocomplete="email" value="' + esc(v.email) + '" aria-describedby="pf-email-err">' +
        '<span class="hint">Only used for your account — never shown to other members.</span>' +
        '<p class="field-error" id="pf-email-err" hidden></p>' +
      '</div>' +
    '</div>' +

    '<div class="card">' +
      '<fieldset>' +
        '<legend id="interests-legend">Spiritual interests</legend>' +
        '<span class="hint" id="interests-hint">Choose 1 to 8 — these help SEREN find your alignment.</span>' +
        '<div class="chips" role="group" aria-labelledby="interests-legend" aria-describedby="interests-hint pf-interests-err">' +
          INTERESTS.map(i =>
            '<button type="button" class="chip" data-interest="' + i.value + '" ' +
            'aria-pressed="' + (v.interests.includes(i.value) ? 'true' : 'false') + '">' + esc(i.label) + '</button>'
          ).join('') +
        '</div>' +
        '<p class="field-error" id="pf-interests-err" hidden></p>' +
      '</fieldset>' +

      '<div class="field">' +
        '<label for="pf-intention">Your intention</label>' +
        '<textarea id="pf-intention" name="intention" maxlength="500" aria-describedby="pf-intention-hint pf-intention-err">' + esc(v.intention) + '</textarea>' +
        '<span class="hint" id="pf-intention-hint">A sentence or two about what you&rsquo;re seeking or offering on your path (10&ndash;500 characters).</span>' +
        '<div class="char-count" id="pf-intention-count" aria-live="off"></div>' +
        '<p class="field-error" id="pf-intention-err" hidden></p>' +
      '</div>' +
    '</div>' +

    '<div class="card">' +
      '<fieldset>' +
        '<legend>What are you seeking?</legend>' +
        '<span class="hint">Choose any that resonate — or none at all.</span>' +
        '<ul class="check-list two-col">' +
          SEEKING_OPTIONS.map(s =>
            '<li><label class="check-item">' +
              '<input type="checkbox" name="seeking" value="' + s.value + '"' +
              (v.seeking.includes(s.value) ? ' checked' : '') + '>' +
              '<span class="check-text"><strong>' + esc(s.label) + '</strong></span>' +
            '</label></li>'
          ).join('') +
        '</ul>' +
        '<p class="field-error" id="pf-seeking-err" hidden></p>' +
      '</fieldset>' +
      '<div class="field">' +
        '<label for="pf-availability">Availability <span class="hint" style="display:inline">(optional)</span></label>' +
        '<input type="text" id="pf-availability" name="availability" maxlength="200" value="' + esc(v.availability) + '" aria-describedby="pf-availability-err" placeholder="e.g. Weekday evenings, open to video calls">' +
        '<p class="field-error" id="pf-availability-err" hidden></p>' +
      '</div>' +
    '</div>' +

    '<div class="card">' +
      '<h2>Your consent</h2>' +
      '<p class="card-meta">Consent-first means nothing is assumed. Each choice below is yours to make, and you can change them any time.</p>' +
      '<ul class="check-list">' +
        '<li><label class="check-item">' +
          '<input type="checkbox" id="pf-consent-intro" name="consent-introductions"' + (v.consents.introductions ? ' checked' : '') + ' aria-describedby="pf-introductions-err">' +
          '<span class="check-text"><strong>Introductions</strong>' +
          '<span>Allow SEREN to introduce you to aligned members. This is the heart of SEREN &mdash; it must be on to create a profile.</span></span>' +
        '</label></li>' +
        '<li><label class="check-item">' +
          '<input type="checkbox" id="pf-consent-visible" name="consent-community"' + (v.consents.community_visible ? ' checked' : '') + '>' +
          '<span class="check-text"><strong>Community visibility</strong>' +
          '<span>Let other members be introduced to you. Turn this off and you won&rsquo;t appear as a match for anyone.</span></span>' +
        '</label></li>' +
        '<li><label class="check-item">' +
          '<input type="checkbox" id="pf-consent-ai" name="consent-ai"' + (v.consents.ai_matching ? ' checked' : '') + '>' +
          '<span class="check-text"><strong>AI matching</strong>' +
          '<span>Allow SEREN&rsquo;s matching engine to consider your profile when finding aligned introductions.</span></span>' +
        '</label></li>' +
      '</ul>' +
      '<p class="field-error" id="pf-introductions-err" hidden></p>' +
    '</div>' +

    '<div class="btn-row">' +
      '<button type="submit" class="btn btn-primary" id="pf-submit">' + (isEdit ? 'Save changes' : 'Create my profile') + '</button>' +
      (isEdit ? '<a class="btn btn-secondary" href="#/connect">Cancel</a>' : '') +
    '</div>';

  const loadingEl = $('#profile-loading');
  if (loadingEl) loadingEl.remove();
  main.appendChild(form);

  /* ---- interactive bits ---- */

  const selected = new Set(v.interests.filter(i => INTEREST_VALUES.includes(i)));

  $$('.chip', form).forEach(chip => {
    chip.addEventListener('click', () => {
      const val = chip.getAttribute('data-interest');
      if (selected.has(val)) { selected.delete(val); chip.setAttribute('aria-pressed', 'false'); }
      else {
        if (selected.size >= 8) {
          setFieldError('interests', 'Choose at most 8 spiritual interests.');
          announce('You can choose at most 8 interests.');
          return;
        }
        selected.add(val); chip.setAttribute('aria-pressed', 'true');
      }
      clearFieldError('interests');
    });
  });

  const intentionEl = $('#pf-intention', form);
  const countEl = $('#pf-intention-count', form);
  const updateCount = () => {
    const n = intentionEl.value.length;
    countEl.textContent = n + ' / 500 characters' + (n < 10 ? ' (minimum 10)' : '');
  };
  intentionEl.addEventListener('input', updateCount);
  updateCount();

  function setFieldError(field, msg) {
    const map = { name: 'pf-name-err', email: 'pf-email-err', interests: 'pf-interests-err',
      intention: 'pf-intention-err', seeking: 'pf-seeking-err', availability: 'pf-availability-err',
      introductions: 'pf-introductions-err' };
    const el = document.getElementById(map[field]);
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    const inputMap = { name: 'pf-name', email: 'pf-email', intention: 'pf-intention', availability: 'pf-availability' };
    if (inputMap[field]) $('#' + inputMap[field], form).setAttribute('aria-invalid', 'true');
  }
  function clearFieldError(field) {
    const map = { name: 'pf-name-err', email: 'pf-email-err', interests: 'pf-interests-err',
      intention: 'pf-intention-err', seeking: 'pf-seeking-err', availability: 'pf-availability-err',
      introductions: 'pf-introductions-err' };
    const el = document.getElementById(map[field]);
    if (el) { el.textContent = ''; el.hidden = true; }
    const inputMap = { name: 'pf-name', email: 'pf-email', intention: 'pf-intention', availability: 'pf-availability' };
    if (inputMap[field]) $('#' + inputMap[field], form).removeAttribute('aria-invalid');
  }
  function clearAllErrors() {
    ['name','email','interests','intention','seeking','availability','introductions'].forEach(clearFieldError);
    const box = $('#form-errors', form);
    box.hidden = true; box.innerHTML = '';
  }
  function showErrors(errors) {
    clearAllErrors();
    const summary = [];
    Object.keys(errors).forEach(f => {
      if (f === '_summary') { summary.push(errors[f]); return; }
      if (FIELD_LABELS[f]) {
        setFieldError(f, errors[f]);
        summary.push(FIELD_LABELS[f] + ': ' + errors[f]);
      } else {
        summary.push(errors[f]);
      }
    });
    if (summary.length) {
      const box = $('#form-errors', form);
      box.hidden = false;
      box.className = 'form-errors';
      box.setAttribute('role', 'alert');
      box.innerHTML = '<h2>Please review the following</h2><ul>' +
        summary.map(s => '<li>' + esc(s) + '</li>').join('') + '</ul>';
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    const first = $('.field-error:not([hidden])', form);
    if (first) announce('There are ' + summary.length + ' things to review: ' + summary.join(' '));
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = {
      name: $('#pf-name', form).value,
      email: $('#pf-email', form).value,
      interests: [...selected],
      intention: $('#pf-intention', form).value,
      seeking: $$('input[name="seeking"]:checked', form).map(c => c.value),
      availability: $('#pf-availability', form).value,
      consents: {
        introductions: $('#pf-consent-intro', form).checked,
        community_visible: $('#pf-consent-visible', form).checked,
        ai_matching: $('#pf-consent-ai', form).checked,
      },
    };
    const { errors, values } = clientValidate(raw, isEdit);
    if (Object.keys(errors).length) { showErrors(errors); return; }

    const submitBtn = $('#pf-submit', form);
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Saving&hellip;';
    announce(isEdit ? 'Saving your profile.' : 'Creating your profile.');

    const payload = {
      name: values.name,
      email: values.email,
      interests: values.interests,
      intention: values.intention,
      connectionPrefs: { seeking: values.seeking, availability: values.availability.trim() },
      consents: values.consents,
    };

    try {
      const saved = isEdit
        ? await api('PATCH', '/profiles/' + encodeURIComponent(id), payload)
        : await api('POST', '/profiles', payload);
      localStorage.setItem(STORAGE_KEY, String(saved.id));
      cachedProfile = saved;
      announce(isEdit ? 'Your profile was updated.' : 'Welcome to SEREN — your profile is ready.');
      location.hash = '#/connect';
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = isEdit ? 'Save changes' : 'Create my profile';
      if (err instanceof ApiError && err.code === 'validation_error') {
        showErrors(normalizeServerDetails(err.details));
        if (err.message && !err.details) showErrors({ _summary: err.message });
      } else if (err instanceof ApiError && err.code === 'email_taken') {
        showErrors({ email: 'That email is already registered. Try another, or use Start over to begin fresh.' });
      } else if (err instanceof ApiError) {
        showBanner(err.message, () => $('#pf-submit', form).click());
      } else { throw err; }
    }
  });
}

/* ---------------- view 3: connect ---------------- */

async function renderConnect(main) {
  maybeRenderNotice(main);

  const id = profileId();
  if (!id) {
    flashNotice('Create your profile first — it only takes a minute, and introductions need it.');
    location.hash = '#/profile';
    return;
  }

  main.innerHTML =
    '<div class="view-head">' +
      '<p class="eyebrow">Connect</p>' +
      '<h1>Request an introduction</h1>' +
      '<p>Set an intention for who you&rsquo;d like to meet. SEREN will find the most aligned member and write you a warm introduction.</p>' +
    '</div>' +
    '<div id="connect-body"><div class="card"><p><span class="spinner" aria-hidden="true"></span> Loading&hellip;</p></div></div>';

  let profile;
  try {
    profile = await getProfile(id, true);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      localStorage.removeItem(STORAGE_KEY); cachedProfile = null;
      flashNotice('Your saved profile was not found, so let\u2019s create a new one.');
      location.hash = '#/profile';
      return;
    }
    $('#connect-body').innerHTML = '<div class="card"><h2>Could not load your profile</h2><p>' + esc(e.message) + '</p></div>';
    showBanner(e.message, () => renderConnect(main));
    return;
  }

  const body = $('#connect-body');
  body.innerHTML =
    '<div class="card" id="request-card">' +
      '<div class="field">' +
        '<label for="cx-intention">Your intention for this introduction</label>' +
        '<textarea id="cx-intention" maxlength="500" aria-describedby="cx-intention-hint cx-intention-err">' + esc(profile.intention || '') + '</textarea>' +
        '<span class="hint" id="cx-intention-hint">Prefilled from your profile — shape it for this moment (5&ndash;500 characters).</span>' +
        '<div class="char-count" id="cx-intention-count"></div>' +
        '<p class="field-error" id="cx-intention-err" hidden></p>' +
      '</div>' +
      '<div class="btn-row">' +
        '<button type="button" class="btn btn-primary" id="cx-request">Request introduction</button>' +
      '</div>' +
    '</div>' +
    '<div id="match-region" aria-live="off"></div>';

  const intentionEl = $('#cx-intention');
  const countEl = $('#cx-intention-count');
  const updateCount = () => {
    const n = intentionEl.value.length;
    countEl.textContent = n + ' / 500 characters' + (n < 5 ? ' (minimum 5)' : '');
  };
  intentionEl.addEventListener('input', updateCount);
  updateCount();

  const requestBtn = $('#cx-request');
  const matchRegion = $('#match-region');

  function setRequestLoading(loading, label) {
    requestBtn.disabled = loading;
    requestBtn.innerHTML = loading
      ? '<span class="spinner" aria-hidden="true"></span> ' + esc(label || 'Finding your match…')
      : 'Request introduction';
  }

  function intentionError(msg) {
    const el = $('#cx-intention-err');
    if (!el) return;
    if (msg) { el.textContent = msg; el.hidden = false; intentionEl.setAttribute('aria-invalid', 'true'); }
    else { el.textContent = ''; el.hidden = true; intentionEl.removeAttribute('aria-invalid'); }
  }

  async function requestIntroduction(intention) {
    const data = await api('POST', '/introductions/request', {
      requesterId: Number(id),
      intention,
    });
    return data;
  }

  function seedBadgeFor(memberId, directory) {
    const entry = directory.get(memberId);
    return (entry && entry.is_seed) ? '<span class="seed-badge">Demo seed</span>' : '';
  }

  async function renderMatch(data, requestIntention) {
    const intro = data.introduction;
    const proposed = data.proposed;
    const bd = data.scoreBreakdown || {};
    const si = Number(bd.sharedInterests || 0);
    const sk = Number(bd.sharedKeywords || 0);
    const myInterests = new Set(profile.interests || []);
    const shared = (proposed.interests || []).filter(i => myInterests.has(i));
    const keywords = sharedKeywords(requestIntention, proposed.intention);
    const directory = await getDirectory();

    matchRegion.innerHTML =
      '<div class="card card-glow match-wrap" role="status">' +
        '<p class="eyebrow center">A kindred spirit</p>' +
        '<h2 class="match-name"><span class="sigil" aria-hidden="true">&#10022;</span> ' + esc(proposed.name) + ' ' + seedBadgeFor(proposed.id, directory) + '</h2>' +
        '<div class="chips" style="justify-content:center" aria-label="Shared spiritual interests">' +
          (shared.length
            ? shared.map(i => '<span class="chip-static">' + esc(INTEREST_LABELS[i] || i) + '</span>').join('')
            : '<span class="card-meta">No shared interests — sometimes the most meaningful connections are a gentle stretch.</span>') +
        '</div>' +
        (keywords.length
          ? '<div class="kw-row"><div class="kw-label">Shared intention keywords</div>' +
            '<div class="chips">' + keywords.map(k => '<span class="chip-static">' + esc(k) + '</span>').join('') + '</div></div>'
          : '') +
        '<blockquote class="intro-note">' + esc(intro.note) + '</blockquote>' +
        '<p class="score-line">Why this match? It shares ' + si + ' spiritual ' + plural(si, 'interest', 'interests') +
          ' + ' + sk + ' intention ' + plural(sk, 'keyword', 'keywords') +
          ' with you &middot; match score ' + esc(String(bd.score == null ? '—' : bd.score)) + '</p>' +
        '<div class="btn-row" style="justify-content:center">' +
          '<button type="button" class="btn btn-primary" id="match-accept">Accept connection</button>' +
          '<button type="button" class="btn btn-secondary" id="match-decline">Not quite &mdash; find another</button>' +
        '</div>' +
      '</div>';
    matchRegion.scrollIntoView({ behavior: 'smooth', block: 'start' });
    announce('SEREN found a match: ' + proposed.name + '.');

    // If the user navigated away while the request was in flight, this view is
    // detached: drop the stale proposal UI instead of wiring the wrong buttons.
    const acceptBtn = $('#match-accept');
    const declineBtn = $('#match-decline');
    if (!matchRegion.isConnected || !acceptBtn || !declineBtn) return;

    acceptBtn.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Accepting…';
      try {
        await api('POST', '/introductions/' + encodeURIComponent(intro.id) + '/accept');
        announce('Connection with ' + proposed.name + ' accepted.');
        location.hash = '#/inbox';
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Accept connection';
        if (err instanceof ApiError) showBanner(err.message, () => { const b = $('#match-accept'); if (b) b.click(); });
        else throw err;
      }
    });

    declineBtn.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Finding another…';
      announce('Passing on ' + proposed.name + ' and finding another match.');
      try {
        await api('POST', '/introductions/' + encodeURIComponent(intro.id) + '/decline');
        await doRequest(true);
      } catch (err) {
        btn.disabled = false;
        btn.innerHTML = 'Not quite &mdash; find another';
        if (err instanceof ApiError) showBanner(err.message, () => { const b = $('#match-decline'); if (b) b.click(); });
        else throw err;
      }
    });
  }

  function renderNoMatch() {
    matchRegion.innerHTML =
      '<div class="empty" role="status">' +
        '<span class="sigil" aria-hidden="true">&#10022;</span>' +
        '<h2>No aligned members yet</h2>' +
        '<p>There&rsquo;s no one to introduce you to right now — try broadening your intention above, and ask again.</p>' +
        '<div class="btn-row">' +
          '<a class="btn btn-secondary" href="#/inbox">Check your inbox</a>' +
        '</div>' +
      '</div>';
    announce('No aligned members found yet. Try broadening your intention.');
  }

  function renderConsentRequired(message) {
    matchRegion.innerHTML =
      '<div class="empty" role="status">' +
        '<span class="sigil" aria-hidden="true">&#10022;</span>' +
        '<h2>Introductions are paused</h2>' +
        '<p>' + esc(message || 'You need to opt into introductions before SEREN can match you.') + '</p>' +
        '<div class="btn-row"><a class="btn btn-primary" href="#/profile">Review consent in your profile</a></div>' +
      '</div>';
    announce('Introductions need your consent. Please review your profile.');
  }

  async function doRequest(isRerequest) {
    const intention = intentionEl.value.trim();
    intentionError(null);
    if (intention.length < 5) { intentionError('Your intention needs at least 5 characters.'); return; }
    if (intention.length > 500) { intentionError('Your intention must be 500 characters or fewer.'); return; }

    if (!isRerequest) {
      matchRegion.innerHTML = '';
      setRequestLoading(true, 'Finding your match…');
      announce('Requesting an introduction. Finding your most aligned match.');
    }

    try {
      const data = await requestIntroduction(intention);
      setRequestLoading(false);
      await renderMatch(data, intention);
    } catch (err) {
      setRequestLoading(false);
      if (!(err instanceof ApiError)) throw err;
      if (err.code === 'validation_error') {
        intentionError(err.message || 'Please check your intention and try again.');
        const btn2 = $('#match-decline');
        if (btn2) { btn2.disabled = false; btn2.innerHTML = 'Not quite &mdash; find another'; }
      } else if (err.code === 'no_match' || err.status === 404) {
        renderNoMatch();
      } else if (err.code === 'consent_required' || err.status === 403) {
        renderConsentRequired(err.message);
      } else if (err.code === 'requester_not_found') {
        localStorage.removeItem(STORAGE_KEY); cachedProfile = null;
        flashNotice('Your saved profile was not found, so let\u2019s create a new one.');
        location.hash = '#/profile';
      } else {
        showBanner(err.message, () => doRequest(isRerequest));
        const btn2 = $('#match-decline');
        if (btn2) { btn2.disabled = false; btn2.innerHTML = 'Not quite &mdash; find another'; }
      }
    }
  }

  requestBtn.addEventListener('click', () => doRequest(false));
}

/* ---------------- view 4: inbox ---------------- */

async function renderInbox(main) {
  maybeRenderNotice(main);

  const id = profileId();
  if (!id) {
    flashNotice('Create your profile first to see your connections.');
    location.hash = '#/profile';
    return;
  }

  main.innerHTML =
    '<div class="view-head">' +
      '<p class="eyebrow">Inbox</p>' +
      '<h1>Your connections</h1>' +
      '<p>Every introduction SEREN has proposed for you, grouped by where things stand.</p>' +
    '</div>' +
    '<div id="inbox-body"><div class="card"><p><span class="spinner" aria-hidden="true"></span> Loading your connections&hellip;</p></div></div>';

  let intros;
  try {
    const data = await api('GET', '/introductions?profileId=' + encodeURIComponent(id));
    intros = data.introductions || [];
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      localStorage.removeItem(STORAGE_KEY); cachedProfile = null;
      flashNotice('Your saved profile was not found, so let\u2019s create a new one.');
      location.hash = '#/profile';
      return;
    }
    $('#inbox-body').innerHTML = '<div class="card"><h2>Could not load your inbox</h2><p>' + esc(e.message) + '</p></div>';
    showBanner(e.message, () => renderInbox(main));
    return;
  }

  const directory = await getDirectory();
  const body = $('#inbox-body');
  const myId = Number(id);

  const grouped = { proposed: [], accepted: [], declined: [], withdrawn: [] };
  intros.forEach(x => { (grouped[x.status] || grouped.proposed).push(x); });
  Object.values(grouped).forEach(list =>
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));

  function seedBadge(memberId) {
    const entry = directory.get(memberId);
    return (entry && entry.is_seed) ? ' <span class="seed-badge">Demo seed</span>' : '';
  }

  function cardHtml(x) {
    const iAmRequester = Number(x.requesterId) === myId;
    const otherName = iAmRequester ? x.proposedName : x.requesterName;
    const otherId = iAmRequester ? x.proposedId : x.requesterId;
    const direction = iAmRequester ? 'You requested' : 'Requested of you';
    const note = x.note || '';
    const intention = x.intention || '';

    let actions = '';
    if (x.status === 'proposed') {
      if (!iAmRequester) {
        actions =
          '<div class="btn-row">' +
            '<button type="button" class="btn btn-primary btn-small" data-action="accept" data-id="' + x.id + '">Accept</button>' +
            '<button type="button" class="btn btn-secondary btn-small" data-action="decline" data-id="' + x.id + '">Decline</button>' +
          '</div>';
      } else {
        actions =
          '<div class="btn-row">' +
            '<button type="button" class="btn btn-danger btn-small" data-action="withdraw" data-id="' + x.id + '">Withdraw request</button>' +
          '</div>';
      }
    }

    return (
      '<article class="card intro-card" data-intro-id="' + x.id + '">' +
        '<div class="intro-top"><h3>' + esc(otherName) + '</h3>' + seedBadge(otherId) +
          '<span class="direction-tag">' + esc(direction) + '</span></div>' +
        (note ? '<p class="note">&ldquo;' + esc(note) + '&rdquo;</p>' : '') +
        (intention ? '<p class="intention-text"><strong>Intention:</strong> ' + esc(intention) + '</p>' : '') +
        '<p class="date">' + esc(fmtDate(x.createdAt)) + '</p>' +
        actions +
      '</article>'
    );
  }

  body.innerHTML =
    STATUS_GROUPS.map(status => {
      const list = grouped[status];
      const title = status.charAt(0).toUpperCase() + status.slice(1);
      return (
        '<section class="inbox-group" aria-labelledby="grp-' + status + '">' +
          '<h2 id="grp-' + status + '">' + title + ' <span class="count-pill">' + list.length + '</span></h2>' +
          (list.length
            ? list.map(cardHtml).join('')
            : '<div class="empty"><span class="sigil" aria-hidden="true">&#10022;</span><p>' + esc(GROUP_EMPTY[status]) + '</p>' +
              (status === 'proposed' ? '<div class="btn-row"><a class="btn btn-primary" href="#/connect">Request an introduction</a></div>' : '') +
              '</div>') +
        '</section>'
      );
    }).join('');

  announce('Inbox loaded. ' + intros.length + ' ' + plural(intros.length, 'introduction', 'introductions') + '.');

  async function refresh() {
    hideBanner();
    await renderInbox(main);
  }

  body.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn || btn.disabled) return;
    const action = btn.getAttribute('data-action');
    const introId = btn.getAttribute('data-id');

    /* Two-step inline confirm for withdraw — no window.confirm. */
    if (action === 'withdraw' && !btn.classList.contains('btn-armed')) {
      btn.classList.add('btn-armed');
      btn.dataset.originalText = btn.textContent;
      btn.textContent = 'Click again to confirm withdraw';
      btn.setAttribute('aria-label', 'Click again to confirm withdrawing this introduction request');
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn btn-ghost btn-small';
      cancel.textContent = 'Keep it';
      cancel.setAttribute('data-action', 'withdraw-cancel');
      btn.after(cancel);
      cancel.addEventListener('click', () => {
        btn.classList.remove('btn-armed');
        btn.textContent = btn.dataset.originalText || 'Withdraw request';
        btn.removeAttribute('aria-label');
        cancel.remove();
      }, { once: true });
      return;
    }
    if (action === 'withdraw-cancel') return; // handled by its own listener

    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Working…';

    const verb = action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'withdrawn';
    try {
      await api('POST', '/introductions/' + encodeURIComponent(introId) + '/' + action);
      announce('Introduction ' + verb + '.');
      await refresh();
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = original;
      if (err instanceof ApiError) showBanner(err.message, () => refresh());
      else throw err;
    }
  });
}

/* ---------------- global: start over ---------------- */

$('#start-over').addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  cachedProfile = null;
  cachedDirectory = null;
  hideBanner();
  announce('Signed out on this device. Your profile remains saved on the server.');
  if (currentPath() === '/') render();
  else location.hash = '#/';
});

/* ---------------- boot ---------------- */

checkBeta().then(() => render()).catch(() => render());
