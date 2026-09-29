// SEREN "Me" view — profile summary, settings, blocked accounts, sign-out —
// plus the full profile editor (renderProfileEdit).

import { get, clearSession, metaList, practiceLabel, intentionLabel, formatLabel } from '../state.js';
import {
  getProfile, updateProfile, listBlocks, unblockProfile, friendlyError,
  getMyBrief, pauseBrief, resumeBrief, withdrawBrief,
} from '../api.js';
import { briefPill } from './brief.js';
import {
  el, esc, card, pageShell, errorBanner, toast, announce, avatarFor,
  chipGroup, chipSingle, field, textInput, textArea, selectInput,
  confirmDialog, emptyState, loading, withView,
} from '../ui.js';
import { navigate } from '../router.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LEGACY_INTERESTS = [
  'meditation', 'tarot', 'astrology', 'breathwork', 'reiki', 'sound-healing',
  'yoga', 'journaling', 'dreamwork', 'numerology', 'crystals', 'shamanism',
];
const interestLabel = (v) => v.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
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

/** Settings toggle row bound to an async onChange(checked). */
function toggleRow(title, desc, initial, onChange) {
  const row = el(`
    <div class="toggle-row">
      <div class="toggle-text"><strong>${esc(title)}</strong><span>${esc(desc)}</span></div>
      <label class="switch"><input type="checkbox" ${initial ? 'checked' : ''} aria-label="${esc(title)}"><span class="track"></span></label>
    </div>`);
  const input = row.querySelector('input');
  input.addEventListener('change', async () => {
    input.disabled = true;
    try {
      await onChange(input.checked);
      toast('Setting updated.');
    } catch (e) {
      input.checked = !input.checked; // revert on failure
      toast(friendlyError(e));
    } finally {
      input.disabled = false;
    }
  });
  return row;
}

function chipRow(items) {
  if (!items || !items.length) return null;
  const row = el(`<div class="chip-row"></div>`);
  for (const label of items) row.appendChild(el(`<span class="chip chip-static">${esc(label)}</span>`));
  return row;
}

export async function renderMe(root, ctx) {
  root.innerHTML = '';
  const shell = pageShell('Me', 'Your profile & settings');
  const banner = errorBanner();
  shell.body.appendChild(banner.node);
  root.appendChild(shell.root);
  const profileId = get('profileId');

  await withView(root, shell.body, banner, async () => {
    const [profile, blocks] = await Promise.all([
      getProfile(profileId, profileId),
      listBlocks(profileId).catch(() => ({ blocked: [] })),
    ]);
    const cs = profile.consentSettings || {};
    const consents = profile.consents || {};

    if (cs.paused) {
      const pb = el(`<div class="pause-banner" role="status">
        <p><strong>Discovery is paused.</strong> You’re hidden from Discover and new requests. Existing connections are unaffected.</p>
      </div>`);
      shell.body.appendChild(pb);
    }

    // (a) Profile summary
    const head = el(`<div class="person-head"></div>`);
    if (profile.photoUrl) {
      head.appendChild(el(`<img class="avatar avatar-lg" style="object-fit:cover" src="${esc(profile.photoUrl)}" alt="Profile photo of ${esc(profile.name)}">`));
    } else {
      const av = avatarFor(profile.name);
      av.classList.add('avatar-lg');
      head.appendChild(av);
    }
    const who = el(`<div class="who"></div>`);
    who.appendChild(el(`<h3>${esc(profile.name)}</h3>`));
    const sub = [profile.pronouns, profile.region].filter(Boolean).join(' · ');
    if (sub) who.appendChild(el(`<p class="person-sub">${esc(sub)}</p>`));
    if (profile.isSeed) who.appendChild(el(`<p class="person-sub">Demo member</p>`));
    head.appendChild(who);
    const summary = card([head]);
    if (profile.about) summary.appendChild(el(`<p class="about-text">${esc(profile.about)}</p>`));
    const pChips = chipRow((profile.practices || []).map(practiceLabel));
    if (pChips) { summary.appendChild(el(`<h3 class="detail-section" style="font-size:0.85rem">Practices</h3>`)); summary.appendChild(pChips); }
    const iChips = chipRow((profile.intentions || []).map(intentionLabel));
    if (iChips) { summary.appendChild(el(`<h3 class="detail-section" style="font-size:0.85rem">Intentions</h3>`)); summary.appendChild(iChips); }
    const prefs = profile.prefs || {};
    const fmtChips = chipRow((prefs.formats || []).map(formatLabel));
    if (fmtChips) { summary.appendChild(el(`<h3 class="detail-section" style="font-size:0.85rem">Ways to connect</h3>`)); summary.appendChild(fmtChips); }
    const meta2 = [];
    if (prefs.localRemote) meta2.push(`Prefers ${prefs.localRemote === 'either' ? 'local or remote' : prefs.localRemote}`);
    if ((prefs.languages || []).length) meta2.push(`Speaks ${(prefs.languages || []).join(', ')}`);
    const avail = prefs.availability || (profile.connectionPrefs || {}).availability;
    if (avail) meta2.push(`Usually free: ${avail}`);
    if (meta2.length) summary.appendChild(el(`<p class="request-meta">${esc(meta2.join(' · '))}</p>`));
    summary.appendChild(el(`<div class="btn-row"><a class="btn btn-secondary" href="#/me/edit">Edit profile</a>
      <a class="btn btn-ghost" href="#/saved">Saved items</a></div>`));
    shell.body.appendChild(summary);

    // (b) My connection brief
    const briefCard = card([el(`<h3 style="margin-top:0">My connection brief</h3>`)]);
    briefCard.appendChild(el(`<p class="field-hint">What SEREN understood about what you’re seeking — and exactly what another person may see.</p>`));
    const briefBody = el(`<div></div>`);
    briefCard.appendChild(briefBody);
    shell.body.appendChild(briefCard);

    async function loadBriefCard() {
      briefBody.innerHTML = '';
      let brief = null;
      try {
        brief = (await getMyBrief()).brief || null;
      } catch {
        briefBody.appendChild(el(`<p class="field-hint">Couldn’t load your brief right now.</p>`));
        return;
      }
      if (!brief) {
        briefBody.appendChild(el(`<p class="field-hint">No brief yet. Tell SEREN what would feel meaningful and it will draft one for your review.</p>`));
        briefBody.appendChild(el(`<div class="btn-row"><a class="btn btn-secondary btn-small" href="#/">Start a guided conversation</a></div>`));
        return;
      }
      const row = el(`<div style="display:flex;align-items:center;gap:0.75rem;margin:0.5rem 0"></div>`);
      row.appendChild(briefPill(brief.status));
      briefBody.appendChild(row);
      const excerpt = brief.shared_text && brief.consent_share
        ? brief.shared_text
        : (brief.intention_text || brief.who_text || '');
      if (excerpt) briefBody.appendChild(el(`<p class="about-text">${esc(excerpt.length > 220 ? excerpt.slice(0, 220) + '…' : excerpt)}</p>`));
      else briefBody.appendChild(el(`<p class="field-hint">Still a draft — nothing written yet.</p>`));

      const actions = el(`<div class="btn-row"></div>`);
      const edit = el(`<a class="btn btn-secondary btn-small" href="#/brief">Edit</a>`);
      actions.appendChild(edit);
      if (brief.status === 'paused') {
        const resume = el(`<button type="button" class="btn btn-primary btn-small">Resume</button>`);
        resume.addEventListener('click', async () => {
          resume.disabled = true;
          try {
            await resumeBrief(brief.id);
            toast('Discovery resumed.');
            await loadBriefCard();
          } catch (e) { toast(friendlyError(e)); resume.disabled = false; }
        });
        actions.appendChild(resume);
      } else if (brief.status === 'active' || brief.status === 'draft') {
        const pause = el(`<button type="button" class="btn btn-ghost btn-small">Pause</button>`);
        pause.addEventListener('click', async () => {
          const ok = await confirmDialog({
            title: 'Pause discovery?',
            body: 'SEREN will stop looking for matches. Your brief stays saved — you can resume any time.',
            confirmLabel: 'Pause',
          });
          if (!ok) return;
          pause.disabled = true;
          try {
            await pauseBrief(brief.id);
            toast('Discovery paused.');
            await loadBriefCard();
          } catch (e) { toast(friendlyError(e)); pause.disabled = false; }
        });
        actions.appendChild(pause);
      }
      if (brief.status !== 'withdrawn') {
        const withdraw = el(`<button type="button" class="btn btn-ghost btn-small">Withdraw</button>`);
        withdraw.addEventListener('click', async () => {
          const ok = await confirmDialog({
            title: 'Withdraw your brief?',
            body: 'This removes the brief from matching. It stays private to you, and you can start a new one any time.',
            confirmLabel: 'Withdraw brief',
            danger: true,
          });
          if (!ok) return;
          withdraw.disabled = true;
          try {
            await withdrawBrief(brief.id);
            toast('Brief withdrawn.');
            await loadBriefCard();
          } catch (e) { toast(friendlyError(e)); withdraw.disabled = false; }
        });
        actions.appendChild(withdraw);
      }
      briefBody.appendChild(actions);
    }
    await loadBriefCard();

    // (c) Discovery & request settings
    const patchSettings = async (patch) => {
      await updateProfile(profileId, { consentSettings: patch });
      Object.assign(cs, patch);
    };
    const patchConsents = async (patch) => {
      await updateProfile(profileId, { consents: { ...consents, ...patch } });
      Object.assign(consents, patch);
    };

    const discoveryCard = card([el(`<div class="settings-section"><h3>Discovery</h3></div>`)]);
    const dsec = discoveryCard.querySelector('.settings-section');
    dsec.appendChild(toggleRow('Appear in Discover', 'Other members can find you in curated Discover suggestions.', cs.discoveryEnabled !== false, (v) => patchSettings({ discoveryEnabled: v })));
    dsec.appendChild(toggleRow('Pause discovery', 'Pausing hides you from Discover and new requests. Existing connections stay exactly as they are.', cs.paused === true, (v) => patchSettings({ paused: v })));
    shell.body.appendChild(discoveryCard);

    const reqCard = card([el(`<div class="settings-section"><h3>Requests & messages</h3></div>`)]);
    const rsec = reqCard.querySelector('.settings-section');
    rsec.appendChild(toggleRow('Receive intentional requests', 'Allow members to send you direct connection requests.', cs.intentionalRequests !== false, (v) => patchSettings({ intentionalRequests: v })));
    rsec.appendChild(toggleRow('Messages after mutual connection', 'Once you both accept, conversation opens here in SEREN.', cs.messagesAfterMutual !== false, (v) => patchSettings({ messagesAfterMutual: v })));
    rsec.appendChild(toggleRow('Group invitations', 'Allow invitations to join circles.', cs.groupInvites !== false, (v) => patchSettings({ groupInvites: v })));
    rsec.appendChild(toggleRow('Event invitations', 'Allow invitations to gatherings and events.', cs.eventInvites !== false, (v) => patchSettings({ eventInvites: v })));
    rsec.appendChild(toggleRow('Collaboration requests', 'Allow collaboration-style connection requests.', cs.collaborationRequests !== false, (v) => patchSettings({ collaborationRequests: v })));
    shell.body.appendChild(reqCard);

    const privCard = card([el(`<div class="settings-section"><h3>Privacy</h3></div>`)]);
    const psec = privCard.querySelector('.settings-section');
    psec.appendChild(el(`<p class="field-hint" style="margin-top:0">Your email is never shown to other members.</p>`));
    psec.appendChild(toggleRow('Show my practices', 'Display your practices on your profile to other members.', cs.showPractices !== false, (v) => patchSettings({ showPractices: v })));
    psec.appendChild(toggleRow('Show my general region', 'Display your general area (never an exact address).', cs.showRegion !== false, (v) => patchSettings({ showRegion: v })));
    psec.appendChild(toggleRow('Show my photo', 'Display your profile photo to other members.', cs.showPhoto !== false, (v) => patchSettings({ showPhoto: v })));
    psec.appendChild(toggleRow('Notifications', 'Gentle updates about requests and replies.', cs.notifications !== false, (v) => patchSettings({ notifications: v })));
    shell.body.appendChild(privCard);

    const conCard = card([el(`<div class="settings-section"><h3>Consent</h3></div>`)]);
    const csec = conCard.querySelector('.settings-section');
    csec.appendChild(toggleRow('Open to introductions', 'You can opt out anytime; existing connections are unaffected.', consents.introductions === true, (v) => patchConsents({ introductions: v })));
    csec.appendChild(toggleRow('Visible in community spaces', 'Include your profile in community areas like circles.', consents.community_visible !== false, (v) => patchConsents({ community_visible: v })));
    csec.appendChild(toggleRow('Thoughtful matching', 'Let SEREN suggest aligned people — with clear reasons, never a score.', consents.ai_matching !== false, (v) => patchConsents({ ai_matching: v })));
    shell.body.appendChild(conCard);

    // (e) Blocked accounts
    const blocked = blocks.blocked || [];
    const blockCard = card([el(`<h3 style="margin-top:0">Blocked accounts</h3>`)]);
    if (!blocked.length) {
      blockCard.appendChild(el(`<p class="field-hint">No blocked accounts. Blocking is quiet — the other person is not notified.</p>`));
    } else {
      const list = el(`<ul class="member-list"></ul>`);
      for (const b of blocked) {
        const li = el(`<li></li>`);
        li.appendChild(avatarFor(b.name));
        li.appendChild(el(`<span>${esc(b.name)}</span>`));
        const unblock = el(`<button type="button" class="btn btn-ghost btn-small" style="margin-left:auto">Unblock</button>`);
        unblock.addEventListener('click', async () => {
          const ok = await confirmDialog({
            title: `Unblock ${b.name}?`,
            body: 'They will be able to appear in your Discover suggestions again.',
            confirmLabel: 'Unblock',
          });
          if (!ok) return;
          try {
            await unblockProfile(profileId, b.id);
            toast(`${b.name} unblocked.`);
            renderMe(root, ctx); // refresh
          } catch (e) { toast(friendlyError(e)); }
        });
        li.appendChild(unblock);
        list.appendChild(li);
      }
      blockCard.appendChild(list);
    }
    shell.body.appendChild(blockCard);

    // (f) Sign out
    const dangerCard = card([
      el(`<h3 style="margin-top:0">This device</h3>`),
      el(`<p class="field-hint">Signing out removes your profile from this device only. Your profile itself stays in the community.</p>`),
    ]);
    const signOut = el(`<button type="button" class="btn btn-danger">Sign out of this device</button>`);
    signOut.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Sign out of this device?',
        body: 'Your SEREN profile stays as it is. You can sign back in on this device later.',
        confirmLabel: 'Sign out',
      });
      if (!ok) return;
      clearSession();
      announce('Signed out.');
      navigate('#/');
    });
    const btnRow = el(`<div class="btn-row"></div>`);
    btnRow.appendChild(signOut);
    dangerCard.appendChild(btnRow);
    shell.body.appendChild(dangerCard);

    shell.body.appendChild(el(`<p class="footer-note">SEREN is a connection platform — not medical, mental-health, legal, or emergency support.</p>`));
    announce('Your profile and settings');
  });
}

export async function renderProfileEdit(root, ctx) {
  root.innerHTML = '';
  const shell = pageShell('Edit profile', 'Refine how you appear to others');
  shell.root.classList.add('page-narrow');
  const banner = errorBanner();
  shell.body.appendChild(banner.node);
  root.appendChild(shell.root);
  const profileId = get('profileId');

  await withView(root, shell.body, banner, async () => {
    const profile = await getProfile(profileId, profileId);
    const prefs = profile.prefs || {};
    const form = el(`<form novalidate></form>`);
    shell.body.appendChild(form);

    const section = (title) => {
      const s = el(`<div class="settings-section"></div>`);
      s.appendChild(el(`<h3>${esc(title)}</h3>`));
      form.appendChild(s);
      return s;
    };

    // Basics
    let s = section('Basics');
    const name = textInput({ id: 'ed-name', value: profile.name || '', maxLength: 80, autocomplete: 'name' });
    const email = textInput({ id: 'ed-email', value: profile.email || '', type: 'email', maxLength: 254, autocomplete: 'email' });
    const pronouns = textInput({ id: 'ed-pronouns', value: profile.pronouns || '', maxLength: 40 });
    const region = textInput({ id: 'ed-region', value: profile.region || '', maxLength: 80 });
    s.append(
      field('Your name', name, { id: 'ed-name' }),
      field('Email (private — never shown to others)', email, { id: 'ed-email' }),
      field('Pronouns', pronouns, { id: 'ed-pronouns' }),
      field('General area', region, { id: 'ed-region', hint: 'A general area is plenty — never an exact address.' }),
    );

    // Practices
    s = section('Practices & interests');
    const practices = metaList('practices').map((p) => ({ value: p.value, label: p.label }));
    const gP = chipGroup({ name: 'ed-practices', options: practices, values: profile.practices || [], max: 8, ariaLabel: 'Practices' });
    const pOther = textInput({ id: 'ed-practices-other', value: profile.practicesOther || '', maxLength: 140 });
    const gT = chipGroup({
      name: 'ed-tags', ariaLabel: 'Introduction tags',
      options: LEGACY_INTERESTS.map((v) => ({ value: v, label: interestLabel(v) })),
      values: profile.interests || [], max: 8,
    });
    s.append(
      field('Practices', gP.node, { hint: 'Up to 8.' }),
      field('Other practices', pOther, { id: 'ed-practices-other' }),
      field('Introduction tags', gT.node, { hint: 'Short labels shown when we introduce you. At least one.' }),
    );

    // Intentions
    s = section('Intentions');
    const intentions = metaList('intentions').map((p) => ({ value: p.value, label: p.label }));
    const gI = chipGroup({ name: 'ed-intentions', options: intentions, values: profile.intentions || [], max: 5, ariaLabel: 'Intentions' });
    const iOther = textInput({ id: 'ed-intentions-other', value: profile.intentionsOther || '', maxLength: 140 });
    const iText = textArea({ id: 'ed-intention-text', value: profile.intention || '', rows: 4, maxLength: 500 });
    s.append(
      field('Intentions', gI.node, { hint: 'Up to 5.' }),
      field('Other intention', iOther, { id: 'ed-intentions-other' }),
      field('In your own words', iText, { id: 'ed-intention-text', hint: '10–500 characters. Shared when you’re introduced.' }),
    );

    // Connection
    s = section('How you connect');
    const formats = metaList('connectionFormats');
    const fmtOpts = formats.length
      ? formats.map((f) => ({ value: f.value, label: f.label }))
      : ['message', 'voice', 'video', 'group', 'in-person'].map((v) => ({ value: v, label: interestLabel(v) }));
    const gF = chipGroup({ name: 'ed-formats', options: fmtOpts, values: prefs.formats || [], max: 4, ariaLabel: 'Formats' });
    const gL = chipSingle({ name: 'ed-locality', options: LOCALITY_OPTIONS, value: prefs.localRemote || 'either', ariaLabel: 'Locality' });
    const langs = textInput({ id: 'ed-langs', value: (prefs.languages || []).join(', '), maxLength: 200 });
    const avail = textInput({ id: 'ed-avail', value: prefs.availability || '', maxLength: 200 });
    s.append(
      field('Ways to connect', gF.node, { hint: 'Up to 4.' }),
      field('Local, remote, or either?', gL.node, {}),
      field('Languages', langs, { id: 'ed-langs', hint: 'Comma-separated, up to 10.' }),
      field('Availability', avail, { id: 'ed-avail' }),
    );

    // About
    s = section('About');
    const about = textArea({ id: 'ed-about', value: profile.about || '', rows: 5, maxLength: 500 });
    const count = el(`<p class="char-count" aria-live="polite"></p>`);
    const paintCount = () => { count.textContent = `${about.value.length} / 500`; };
    about.addEventListener('input', paintCount); paintCount();
    const visual = selectInput({ id: 'ed-visual', options: VISUAL_IDENTITY_OPTIONS, value: profile.visualIdentity || '', ariaLabel: 'Visual feeling' });
    const photo = textInput({ id: 'ed-photo', value: profile.photoUrl || '', type: 'url', maxLength: 500 });
    s.append(
      field('About you', about, { id: 'ed-about' }),
      count,
      field('Visual feeling', visual, { id: 'ed-visual' }),
      field('Photo URL', photo, { id: 'ed-photo', hint: 'Optional. Never required.' }),
    );

    const btnRow = el(`<div class="btn-row"></div>`);
    const save = el(`<button type="submit" class="btn btn-primary">Save changes</button>`);
    const cancel = el(`<a class="btn btn-ghost" href="#/me">Cancel</a>`);
    btnRow.append(save, cancel);
    form.appendChild(btnRow);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (save.disabled) return;
      banner.clear();
      const tags = gT.get();
      const intentionText = iText.value.trim();
      if (name.value.trim().length < 2) { banner.show('Your name needs at least 2 characters.'); return; }
      if (!EMAIL_RE.test(email.value.trim())) { banner.show('Please enter a valid email address.'); return; }
      if (!tags.length) { banner.show('Please pick at least one introduction tag.'); return; }
      if (intentionText.length < 10 || intentionText.length > 500) { banner.show('“In your own words” must be 10–500 characters.'); return; }
      const langsArr = langs.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 10);
      if (langsArr.some((l) => l.length > 40)) { banner.show('Each language must be under 40 characters.'); return; }

      const original = save.textContent;
      save.disabled = true; save.classList.add('btn-loading'); save.textContent = 'Saving…';
      try {
        const patch = {
          name: name.value.trim(),
          email: email.value.trim().toLowerCase(),
          interests: tags,
          intention: intentionText,
          practices: gP.get(),
          intentions: gI.get(),
          prefs: {
            localRemote: gL.get() || 'either',
            formats: gF.get(),
            languages: langsArr,
            availability: avail.value.trim(),
          },
        };
        if (pronouns.value.trim()) patch.pronouns = pronouns.value.trim();
        if (region.value.trim()) patch.region = region.value.trim();
        if (about.value.trim()) patch.about = about.value.trim();
        if (visual.value) patch.visualIdentity = visual.value;
        if (photo.value.trim()) patch.photoUrl = photo.value.trim();
        if (pOther.value.trim()) patch.practicesOther = pOther.value.trim();
        if (iOther.value.trim()) patch.intentionsOther = iOther.value.trim();
        await updateProfile(profileId, patch);
        toast('Profile updated.');
        navigate('#/me');
      } catch (err) {
        banner.show(friendlyError(err));
      } finally {
        save.disabled = false; save.classList.remove('btn-loading'); save.textContent = original;
      }
    });
    announce('Edit your profile');
  });
}
