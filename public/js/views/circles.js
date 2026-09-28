// Circles views — directory, detail, and creation.
// Circles are small groups with a shared purpose: study, meditation,
// dreamwork, tarot/oracle, salons, creative reflection, local or virtual.

import * as api from '../api.js';
import {
  el, esc, pageShell, errorBanner, loading, emptyState, card,
  avatarFor, timeAgo, textInput, textArea, selectInput, field,
  chipSingle, wireSubmit, confirmDialog, toast, friendlyError,
} from '../ui.js';
import { get, metaList } from '../state.js';
import { navigate } from '../router.js';

const PRIVACY_LABELS = {
  'public': 'Public · anyone can join',
  'request-to-join': 'Request to join · host approves',
  'invite-only': 'Invite only',
};

function kindLabel(value) {
  const found = metaList('circleKinds').find((k) => k.value === value);
  return found ? found.label : value;
}

function truncate(s, n) {
  const t = String(s || '');
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
}

function circleCard(c) {
  const node = card();
  node.appendChild(el(`<p class="circle-kind">${esc(kindLabel(c.kind))}</p>`));
  node.appendChild(el(`<h3>${esc(c.name)}</h3>`));
  if (c.purpose) node.appendChild(el(`<p class="person-sub">${esc(truncate(c.purpose, 140))}</p>`));
  const meta = [];
  meta.push(`${c.memberCount ?? 0}${c.maxParticipants ? ` / ${c.maxParticipants}` : ''} members`);
  if (c.privacy) meta.push(PRIVACY_LABELS[c.privacy] || c.privacy);
  if (c.region) meta.push(c.region);
  if (c.schedule) meta.push(c.schedule);
  node.appendChild(el(`<p class="request-meta">${esc(meta.join(' · '))}</p>`));
  if (c.hostName) node.appendChild(el(`<p class="request-meta">Hosted by ${esc(c.hostName)}</p>`));
  const actions = el('<div class="match-actions"></div>');
  const open = el('<a class="btn btn-secondary btn-small">Open</a>');
  open.href = `#/circles/detail?id=${c.id}`;
  actions.appendChild(open);
  if (c.isMember) actions.appendChild(el('<span class="pill pill-good">Member</span>'));
  else if (c.requestPending) actions.appendChild(el('<span class="pill pill-pending">Request pending</span>'));
  node.appendChild(actions);
  return node;
}

export async function renderCircles(root, ctx) {
  const meId = get('profileId');
  const { root: page, body } = pageShell('Circles', 'Small groups, shared purpose');
  const banner = errorBanner();
  page.insertBefore(banner.node, body);
  root.appendChild(page);

  const topBar = el('<div class="match-actions" style="margin-bottom:1.25rem"></div>');
  const createBtn = el('<a class="btn btn-primary" href="#/circles/new">Create a circle</a>');
  topBar.appendChild(createBtn);
  body.appendChild(topBar);

  const filterSlot = el('<div style="margin-bottom:1.25rem"></div>');
  body.appendChild(filterSlot);
  const listSlot = el('<div></div>');
  body.appendChild(listSlot);

  let activeKind = '';

  async function load() {
    listSlot.innerHTML = '';
    listSlot.appendChild(loading('Loading circles…'));
    banner.clear();
    try {
      const [mine, all] = await Promise.all([
        api.listMyCircles(meId),
        api.listCircles(meId, activeKind || undefined),
      ]);
      listSlot.innerHTML = '';

      const myCircles = (mine && mine.circles) || [];
      if (myCircles.length) {
        listSlot.appendChild(el('<h2 class="section-title">My circles</h2>'));
        const grid = el('<div class="circle-grid"></div>');
        for (const c of myCircles) grid.appendChild(circleCard(c));
        listSlot.appendChild(grid);
      }

      listSlot.appendChild(el('<h2 class="section-title">Directory</h2>'));
      const circles = (all && all.circles) || [];
      if (!circles.length) {
        listSlot.appendChild(emptyState({
          title: 'No circles yet.',
          body: 'Circles are small groups with a shared purpose — a weekly sit, a study group, a dreamwork circle.',
          actionLabel: 'Create the first circle',
          actionHref: '#/circles/new',
        }));
      } else {
        const grid = el('<div class="circle-grid"></div>');
        for (const c of circles) grid.appendChild(circleCard(c));
        listSlot.appendChild(grid);
      }
    } catch (e) {
      listSlot.innerHTML = '';
      banner.show(friendlyError(e));
    }
  }

  const kinds = [{ value: '', label: 'All' }]
    .concat(metaList('circleKinds').map((k) => ({ value: k.value, label: k.label })));
  const chips = chipSingle({ name: 'kind', options: kinds, value: '', ariaLabel: 'Filter by kind' });
  // Re-load on selection: wrap each chip button with a change listener.
  chips.node.addEventListener('click', () => {
    setTimeout(() => {
      const v = chips.get() || '';
      if (v !== activeKind) { activeKind = v; load(); }
    }, 0);
  });
  filterSlot.appendChild(chips.node);

  await load();
}

export async function renderCircleDetail(root, ctx) {
  const meId = get('profileId');
  const circleId = Number(ctx.params.id);
  const { root: page, body } = pageShell('Circle', 'A shared space');
  const banner = errorBanner();
  page.insertBefore(banner.node, body);
  root.appendChild(page);
  body.appendChild(loading('Opening circle…'));

  if (!Number.isInteger(circleId) || circleId <= 0) {
    body.innerHTML = '';
    body.appendChild(emptyState({
      title: 'No circle selected.', body: 'Choose a circle from the directory.',
      actionLabel: 'Back to Circles', actionHref: '#/circles',
    }));
    return;
  }

  async function load() {
    body.innerHTML = '';
    body.appendChild(loading('Opening circle…'));
    banner.clear();
    let data;
    try {
      data = await api.getCircle(circleId, meId);
    } catch (e) {
      body.innerHTML = '';
      body.appendChild(emptyState({
        title: e.status === 403 ? 'This circle is invite-only.' : 'Circle not found.',
        body: e.status === 403 ? 'Only members can view this space.' : friendlyError(e),
        actionLabel: 'Back to Circles', actionHref: '#/circles',
      }));
      return;
    }

    const { circle, members, pendingRequests } = data;
    body.innerHTML = '';

    // The shell's generic "Circle" heading becomes the circle's name.
    const titleEl = page.querySelector('.page-title');
    if (titleEl) titleEl.textContent = circle.name;
    page.setAttribute('aria-label', circle.name);

    const head = card();
    head.appendChild(el(`<p class="circle-kind">${esc(kindLabel(circle.kind))}</p>`));
    head.appendChild(el(`<h2>${esc(circle.name)}</h2>`));
    if (circle.purpose) head.appendChild(el(`<p class="about-text">${esc(circle.purpose)}</p>`));
    const meta = [];
    meta.push(`${(members || []).length}${circle.maxParticipants ? ` of ${circle.maxParticipants}` : ''} members`);
    if (circle.privacy) meta.push(PRIVACY_LABELS[circle.privacy] || circle.privacy);
    if (circle.region) meta.push(circle.region);
    if (circle.schedule) meta.push(circle.schedule);
    head.appendChild(el(`<p class="request-meta">${esc(meta.join(' · '))}</p>`));
    if (circle.agreements) {
      head.appendChild(el('<div class="detail-section"><h3>Shared agreements</h3></div>'));
      head.appendChild(el(`<p class="about-text">${esc(circle.agreements)}</p>`));
    }

    // Membership actions.
    const actions = el('<div class="match-actions"></div>');
    const actionSlot = el('<div></div>');
    if (circle.isMember) {
      actions.appendChild(el('<span class="pill pill-good">You’re a member</span>'));
    } else if (circle.requestPending) {
      actions.appendChild(el('<span class="pill pill-pending">Request pending</span>'));
    } else if (circle.privacy === 'public') {
      const join = el('<button type="button" class="btn btn-primary btn-small">Join this circle</button>');
      join.addEventListener('click', async () => {
        join.disabled = true;
        try {
          await api.joinCircle(circle.id, meId);
          toast('Welcome to the circle.');
          load();
        } catch (e) {
          toast(friendlyError(e));
          join.disabled = false;
        }
      });
      actions.appendChild(join);
    } else if (circle.privacy === 'request-to-join') {
      const req = el('<button type="button" class="btn btn-primary btn-small">Request to join</button>');
      req.addEventListener('click', () => {
        actionSlot.innerHTML = '';
        const msg = textArea({ placeholder: 'A few words about why you’d like to join (optional)', maxLength: 500, rows: 3 });
        const row = el('<div class="btn-row"></div>');
        const cancel = el('<button type="button" class="btn btn-ghost btn-small">Cancel</button>');
        const send = el('<button type="button" class="btn btn-primary btn-small">Send request</button>');
        cancel.addEventListener('click', () => { actionSlot.innerHTML = ''; });
        send.addEventListener('click', async () => {
          send.disabled = true;
          send.textContent = 'Sending…';
          try {
            await api.requestCircleJoin(circle.id, meId, msg.value.trim());
            toast('Request sent. The host will review it.');
            load();
          } catch (e) {
            toast(friendlyError(e));
            send.disabled = false;
            send.textContent = 'Send request';
          }
        });
        row.appendChild(cancel);
        row.appendChild(send);
        const wrap = el('<div class="inline-form"></div>');
        wrap.appendChild(field('Message to the host', msg));
        wrap.appendChild(row);
        actionSlot.appendChild(wrap);
        msg.focus();
      });
      actions.appendChild(req);
    } else {
      actions.appendChild(el('<p class="request-meta">This circle is invite-only.</p>'));
    }
    head.appendChild(actions);
    head.appendChild(actionSlot);
    body.appendChild(head);

    // Host: pending membership requests.
    if ((pendingRequests || []).length && circle.isMember) {
      const reqCard = card();
      reqCard.appendChild(el('<h3>Membership requests</h3>'));
      for (const r of pendingRequests) {
        const row = el('<div class="toggle-row"></div>');
        const who = el(`<div class="toggle-text"><strong>${esc(r.name || 'Someone')}</strong><span>${esc(r.message || 'No message')}</span><span> · ${esc(timeAgo(r.createdAt))}</span></div>`);
        row.appendChild(who);
        const btns = el('<div class="btn-row" style="margin-top:0"></div>');
        const approve = el('<button type="button" class="btn btn-primary btn-small">Approve</button>');
        const decline = el('<button type="button" class="btn btn-ghost btn-small">Decline</button>');
        approve.addEventListener('click', async () => {
          approve.disabled = true;
          try {
            await api.approveCircleRequest(r.id, meId);
            toast('Request approved.');
            load();
          } catch (e) {
            toast(friendlyError(e));
            approve.disabled = false;
          }
        });
        decline.addEventListener('click', async () => {
          decline.disabled = true;
          try {
            await api.declineCircleRequest(r.id, meId);
            toast('Request declined.');
            load();
          } catch (e) {
            toast(friendlyError(e));
            decline.disabled = false;
          }
        });
        btns.appendChild(approve);
        btns.appendChild(decline);
        row.appendChild(btns);
        reqCard.appendChild(row);
      }
      body.appendChild(reqCard);
    }

    // Members.
    const memCard = card();
    memCard.appendChild(el(`<h3>Members (${(members || []).length})</h3>`));
    const list = el('<ul class="member-list"></ul>');
    for (const m of members || []) {
      const li = el('<li></li>');
      li.appendChild(avatarFor(m.name));
      li.appendChild(el(`<span>${esc(m.name)}</span>`));
      if (m.isHost) li.appendChild(el('<span class="pill pill-muted host-tag">Host</span>'));
      list.appendChild(li);
    }
    memCard.appendChild(list);
    body.appendChild(memCard);

    const back = el('<div class="match-actions"><a class="btn btn-ghost btn-small" href="#/circles">Back to circles</a></div>');
    body.appendChild(back);
  }

  await load();
}

export async function renderCircleNew(root, ctx) {
  const { root: page, body } = pageShell('Create a circle', 'Hold a small space');
  const banner = errorBanner();
  page.insertBefore(banner.node, body);
  root.appendChild(page);

  const form = el('<form novalidate></form>');
  const c = card();
  form.appendChild(c);

  c.appendChild(el('<p class="field-hint" style="margin-bottom:1.25rem">Circles are small on purpose — a weekly sit, a study group, a dreamwork circle. As host, you approve new members for request-to-join circles.</p>'));

  const nameIn = textInput({ placeholder: 'e.g. Sunday Morning Sitters', maxLength: 80, required: true });
  const kindSel = selectInput({
    ariaLabel: 'Kind of circle',
    options: [{ value: '', label: 'Choose a kind' }]
      .concat(metaList('circleKinds').map((k) => ({ value: k.value, label: k.label }))),
    required: true,
  });
  const purposeIn = textArea({ placeholder: 'What is this circle for? Who is it for?', maxLength: 500, rows: 4, required: true });
  const privacy = chipSingle({
    name: 'privacy',
    ariaLabel: 'Who can join',
    value: 'request-to-join',
    options: Object.entries(PRIVACY_LABELS).map(([value, label]) => ({ value, label })),
  });
  const maxIn = textInput({ type: 'number', value: '12' });
  maxIn.setAttribute('min', '2');
  maxIn.setAttribute('max', '30');
  const scheduleIn = textInput({ placeholder: 'e.g. Sundays at 8am ET', maxLength: 120 });
  const regionIn = textInput({ placeholder: 'e.g. Boston, MA — or “Online”', maxLength: 120 });
  const agreementsIn = textArea({ placeholder: 'e.g. We begin on time, phones away, confidentiality holds.', maxLength: 1000, rows: 3 });

  c.appendChild(field('Circle name', nameIn, { hint: '3–80 characters. Clear and welcoming.' }));
  c.appendChild(field('Kind', kindSel));
  c.appendChild(field('Purpose', purposeIn, { hint: '10–500 characters. Say what gathers people here.' }));
  c.appendChild(field('Who can join', privacy.node));
  c.appendChild(field('Maximum members', maxIn, { hint: 'Between 2 and 30. Small is intentional.' }));
  c.appendChild(field('Schedule', scheduleIn, { hint: 'Optional. A rhythm helps people show up.' }));
  c.appendChild(field('Region', regionIn, { hint: 'Optional. A city, or “Online”.' }));
  c.appendChild(field('Shared agreements', agreementsIn, { hint: 'Optional. How you’ll hold the space together.' }));

  const row = el('<div class="btn-row"></div>');
  const cancel = el('<a class="btn btn-ghost" href="#/circles">Cancel</a>');
  const submit = el('<button type="submit" class="btn btn-primary">Create circle</button>');
  row.appendChild(cancel);
  row.appendChild(submit);
  c.appendChild(row);
  body.appendChild(form);

  wireSubmit(form, submit, async () => {
    banner.clear();
    const name = nameIn.value.trim();
    const kind = kindSel.value;
    const purpose = purposeIn.value.trim();
    const maxParticipants = Math.max(2, Math.min(30, Number(maxIn.value) || 12));
    if (name.length < 3) { banner.show('Please give your circle a name of at least 3 characters.'); nameIn.focus(); return; }
    if (!kind) { banner.show('Please choose what kind of circle this is.'); kindSel.focus(); return; }
    if (purpose.length < 10) { banner.show('Please describe the purpose in at least 10 characters.'); purposeIn.focus(); return; }
    try {
      const { circle } = await api.createCircle({
        name, kind, purpose,
        privacy: privacy.get() || 'request-to-join',
        maxParticipants,
        schedule: scheduleIn.value.trim(),
        region: regionIn.value.trim(),
        agreements: agreementsIn.value.trim(),
      });
      toast('Circle created. Welcome, host.');
      navigate(`#/circles/detail?id=${circle.id}`);
    } catch (e) {
      banner.show(friendlyError(e));
    }
  });
}
