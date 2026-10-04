// Host analytics — flourishing patterns for the whole community, rendered
// as calm stat cards with plain-language explanations. Host-only, gated by
// the router like #/moderation. NEVER engagement metrics: no streaks, no
// scores, no rankings, no time-on-app. These are community-level patterns
// from members who chose to share — never individual tracking.

import * as api from '../api.js';
import {
  el, esc, pageShell, errorBanner, loading, emptyState,
} from '../ui.js';

function pctOf(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  return `${Math.round(Number(v))}%`;
}

function statCard(value, label, note) {
  const c = el(`<div class="card stat-card" style="margin-bottom:0"></div>`);
  c.appendChild(el(`<p class="stat-value">${esc(value)}</p>`));
  c.appendChild(el(`<p class="stat-label">${esc(label)}</p>`));
  c.appendChild(el(`<p class="stat-note">${esc(note)}</p>`));
  return c;
}

/** Build calm stat cards from the GET /api/host/analytics payload.
 *  Every card is defensive about missing pieces — a partial payload still
 *  renders what it has. */
function buildCards(data, grid) {
  let shown = 0;
  const rwa = data.realWorldAction30d || {};
  if (rwa.pct !== undefined && rwa.pct !== null) {
    shown++;
    grid.appendChild(statCard(
      pctOf(rwa.pct),
      'Real-world follow-through',
      `Of members who checked in, this share said SEREN helped them take a meaningful action in real life in the last 30 days.${rwa.n ? ` Based on ${rwa.n} check-ins.` : ''} This is the number that matters most.`,
    ));
  }
  const iq = data.introductionQuality || {};
  if (iq.avgQuality !== undefined && iq.avgQuality !== null) {
    shown++;
    grid.appendChild(statCard(
      `${Number(iq.avgQuality).toFixed(1)} / 5`,
      'Introduction quality',
      `Average quality rating from post-connection feedback members chose to share.${iq.pctFeltSafe !== undefined ? ` ${pctOf(iq.pctFeltSafe)} of them felt safe.` : ''}${iq.n ? ` ${iq.n} responses in all.` : ''}`,
    ));
  }
  const cg = data.connectionGains || {};
  if (cg.pct !== undefined && cg.pct !== null) {
    shown++;
    grid.appendChild(statCard(
      pctOf(cg.pct),
      'Connections that took root',
      'Share of introductions where members reported feeling genuinely more connected — introductions that became something real.',
    ));
  }
  const ot = data.offlineTime || {};
  if (ot.pct !== undefined && ot.pct !== null) {
    shown++;
    grid.appendChild(statCard(
      pctOf(ot.pct),
      'Time beyond the screen',
      'Share of members who said SEREN helped them spend more meaningful time offline. Less app, more life — that is the point.',
    ));
  }
  const safety = data.safety || {};
  if (safety.incidents30d !== undefined && safety.incidents30d !== null) {
    shown++;
    const hrs = safety.avgResolutionHrs !== undefined && safety.avgResolutionHrs !== null
      ? ` Average human review time: ${Number(safety.avgResolutionHrs).toFixed(1)} hours.` : '';
    grid.appendChild(statCard(
      String(safety.incidents30d),
      safety.incidents30d === 1 ? 'Safety report in 30 days' : 'Safety reports in 30 days',
      `Reports are reviewed by a person, never an algorithm alone.${hrs}`,
    ));
  }
  const aut = data.autonomy || {};
  if (aut.pctPauseConfident !== undefined && aut.pctPauseConfident !== null) {
    shown++;
    grid.appendChild(statCard(
      pctOf(aut.pctPauseConfident),
      'In control of their pace',
      'Share of members who feel they could pause or leave SEREN without losing autonomy. A high number means the exit door is clearly marked.',
    ));
  }
  const ah = data.aiHumility || {};
  if (ah.pct !== undefined && ah.pct !== null) {
    shown++;
    grid.appendChild(statCard(
      pctOf(ah.pct),
      'Honest about what it doesn’t know',
      'Share of members who felt the SEREN guide was appropriately humble and non-authoritative — no fate, no certainty, no guru voice.',
    ));
  }
  // Digital Sapiens attention impact: does SEREN itself leave people more
  // present, intentional, and pulled toward real life?
  const ati = data.attentionImpact || {};
  const na = ati.netAttention || {};
  if (na.n) {
    shown++;
    grid.appendChild(statCard(
      pctOf(na.pctMorePresent),
      'Left more present',
      `Of members who checked in, this share said time on SEREN left them more present and focused rather than scattered. Based on ${na.n} check-ins. If this drops, the product is harming attention.`,
    ));
  }
  const iu = ati.intentionalUse || {};
  if (iu.pct !== undefined && iu.pct !== null) {
    shown++;
    grid.appendChild(statCard(
      pctOf(iu.pct),
      'Opened with purpose',
      'Share who opened SEREN with a clear purpose and left when done — intentional use, not compulsive checking.',
    ));
  }
  const rlp = ati.realLifePull || {};
  if (rlp.pct !== undefined && rlp.pct !== null) {
    shown++;
    grid.appendChild(statCard(
      pctOf(rlp.pct),
      'Pulled toward real life',
      'Share who said SEREN nudged them toward a real-world connection or action today.',
    ));
  }
  const opens = ati.opens30d || {};
  const openTotal = (opens.intentional || 0) + (opens.notification || 0) + (opens.reengagement || 0) + (opens.unknown || 0);
  if (openTotal > 0) {
    shown++;
    grid.appendChild(statCard(
      pctOf(Math.round((100 * (opens.intentional || 0)) / openTotal)),
      'Intentional opens',
      'Share of app opens in the last 30 days that members made on purpose, versus arriving via notification or re-engagement. SEREN sends no engagement notifications by design.',
    ));
  }
  return shown;
}

export async function renderAnalytics(root) {
  const { root: shell, body } = pageShell('Community flourishing', 'Host-only · patterns, not surveillance');
  root.appendChild(shell);
  const banner = errorBanner();
  body.appendChild(banner.node);
  const content = el(`<div></div>`);
  body.appendChild(content);
  content.appendChild(loading('Loading…'));

  let data = null;
  try {
    data = await api.getHostAnalytics();
  } catch (e) {
    content.innerHTML = '';
    banner.show(api.friendlyError(e));
    return;
  }
  content.innerHTML = '';

  if (!data || typeof data !== 'object') {
    content.appendChild(emptyState({
      title: 'No analytics yet',
      body: 'Flourishing patterns will appear here once the community has shared enough to see.',
    }));
    return;
  }

  const grid = el(`<div class="stat-grid"></div>`);
  const shown = buildCards(data, grid);
  if (!shown) {
    content.appendChild(emptyState({
      title: 'No analytics yet',
      body: 'Flourishing patterns will appear here once the community has shared enough to see.',
    }));
    return;
  }
  content.appendChild(grid);

  const foot = el(`<div class="card"></div>`);
  foot.appendChild(el(`<p class="about-text" style="margin-top:0">These are community-level patterns from members who chose to share — never individual tracking, and never engagement. SEREN does not measure streaks, scores, rankings, or time-on-app, because those optimize for the screen instead of real life.</p>`));
  if (data.computedAt) {
    foot.appendChild(el(`<p class="field-hint">Computed ${esc(new Date(data.computedAt).toLocaleString())}.</p>`));
  }
  content.appendChild(foot);
}
