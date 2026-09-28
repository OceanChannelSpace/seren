// Connections view — mutual connections (accepted or accepted with a
// boundary), with a quiet archive of ended connections.

import * as api from '../api.js';
import {
  el, esc, pageShell, errorBanner, loading, emptyState, card,
  avatarFor, statusPill, timeAgo, confirmDialog, toast, friendlyError,
} from '../ui.js';
import { get, connectionTypeLabel } from '../state.js';

const CONNECTED = new Set(['accepted', 'accepted_with_boundary']);

function connectionCard(intro, meId, onDone) {
  const other = intro.other || {};
  const c = card();

  const head = el(`
    <div class="person-head">
      <div class="who">
        <h3>${esc(other.name || 'Someone')}</h3>
        ${intro.connectionType ? `<p class="person-sub">${esc(connectionTypeLabel(intro.connectionType))}</p>` : ''}
        <p class="request-meta">Connected ${esc(timeAgo(intro.updatedAt))}</p>
      </div>
    </div>`);
  head.prepend(avatarFor(other.name));
  c.appendChild(head);
  c.appendChild(statusPill(intro.status));

  if (intro.responderNote) {
    c.appendChild(el(`<div class="boundary-note">${esc(intro.responderNote)}</div>`));
  }

  const actions = el('<div class="match-actions"></div>');

  const open = el('<a class="btn btn-primary btn-small">Open conversation</a>');
  open.href = `#/connections/messages?id=${intro.id}`;
  actions.appendChild(open);

  const plan = el('<a class="btn btn-secondary btn-small">Plan your first connection</a>');
  plan.href = `#/connections/messages?id=${intro.id}`;
  actions.appendChild(plan);

  const end = el('<button type="button" class="btn btn-ghost btn-small">End connection</button>');
  end.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'End this connection?',
      body: 'This closes your conversation. You can both still see each other in Discover.',
      confirmLabel: 'End connection',
      danger: true,
    });
    if (!ok) return;
    end.disabled = true;
    try {
      await api.endIntroduction(intro.id, meId);
      toast('Connection ended. Wishing you both well.');
      onDone();
    } catch (e) {
      toast(friendlyError(e));
      end.disabled = false;
    }
  });
  actions.appendChild(end);

  c.appendChild(actions);
  return c;
}

export async function renderConnections(root, ctx) {
  const meId = get('profileId');
  const { root: page, body } = pageShell('Connections', 'Mutual, by consent');
  const banner = errorBanner();
  page.insertBefore(banner.node, body);
  root.appendChild(page);

  const loader = loading('Loading connections…');
  body.appendChild(loader);

  async function load() {
    body.innerHTML = '';
    body.appendChild(loader);
    banner.clear();
    try {
      const { introductions } = await api.listIntroductions(meId);
      body.innerHTML = '';

      const live = introductions.filter((i) => CONNECTED.has(i.status));
      const ended = introductions.filter((i) => i.status === 'ended');

      if (!live.length && !ended.length) {
        body.appendChild(emptyState({
          title: 'No connections yet.',
          body: 'When you and another person both say yes, your conversations live here.',
          actionLabel: 'Explore Discover',
          actionHref: '#/discover',
        }));
        return;
      }

      if (live.length) {
        for (const intro of live) body.appendChild(connectionCard(intro, meId, load));
      }

      if (ended.length) {
        body.appendChild(el('<h2 class="section-title">Ended</h2>'));
        body.appendChild(el('<p class="section-note">Closed with care. These stay in your history and no longer receive messages.</p>'));
        for (const intro of ended) {
          const other = intro.other || {};
          const c = card();
          const head = el(`
            <div class="person-head">
              <div class="who">
                <h3>${esc(other.name || 'Someone')}</h3>
                ${intro.connectionType ? `<p class="person-sub">${esc(connectionTypeLabel(intro.connectionType))}</p>` : ''}
              </div>
            </div>`);
          head.prepend(avatarFor(other.name));
          c.appendChild(head);
          c.appendChild(statusPill(intro.status));
          body.appendChild(c);
        }
      }
    } catch (e) {
      body.innerHTML = '';
      banner.show(friendlyError(e));
    }
  }

  await load();
}
