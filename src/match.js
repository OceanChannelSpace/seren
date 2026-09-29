// SEREN — deterministic matching engine (pure functions, no I/O).
//
// Two generations live here:
//  - findBestMatch / buildIntroNote: legacy MVP single-match flow (kept for
//    backward compatibility with existing tests and the old endpoint).
//  - scoreCandidate / findMatches: the current engine. It scores candidates
//    on transparent, explainable rules and returns qualitative *reasons* —
//    never an opaque "compatibility" claim, and never a numeric score in UI.

import { STOPWORDS, PRACTICE_LABELS, INTENTION_LABELS, FORMAT_LABELS } from './constants.js';

const stopwordSet = new Set(STOPWORDS);

/**
 * Lowercase alphanumeric tokens ≥ 4 chars, minus stopwords. Deduplicated.
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  if (typeof text !== 'string') return [];
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !stopwordSet.has(t));
  return [...new Set(tokens)];
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

/**
 * Natural-language list with quoted items: “a”, “a” and “b”,
 * “a”, “b”, and “c”. Quoting keeps raw keyword tokens readable
 * instead of dumping them bare into a sentence.
 * @param {string[]} words
 * @returns {string}
 */
function quotedList(words) {
  const qs = (words || []).map((w) => `“${w}”`);
  if (qs.length <= 1) return qs.join('');
  if (qs.length === 2) return `${qs[0]} and ${qs[1]}`;
  return `${qs.slice(0, -1).join(', ')}, and ${qs[qs.length - 1]}`;
}

function intersect(a, b) {
  const setB = new Set(b);
  return a.filter((x) => setB.has(x));
}

function sameRegion(a, b) {
  if (!a || !b) return false;
  const na = String(a).toLowerCase().trim();
  const nb = String(b).toLowerCase().trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  // City-level match: compare the part before the first comma ("Boston, MA" vs "Boston").
  const cityA = na.split(',')[0].trim();
  const cityB = nb.split(',')[0].trim();
  return cityA.length > 2 && cityA === cityB;
}

/**
 * Score one candidate against a requester with explainable rules.
 *
 * Factors (weights are internal; the UI shows only the reasons):
 *   shared practices (new taxonomy)      3 each
 *   shared legacy interests               2 each
 *   shared intentions                     2 each
 *   shared intention keywords             1 each
 *   compatible connection format          2
 *   local/remote alignment                2
 *   shared language                       1
 *
 * Hard gates (applied by findMatches, not here): self, discovery disabled,
 * paused, no introductions consent, existing pair, passed, blocked.
 *
 * @param {object} requester camelCase profile
 * @param {object} candidate camelCase profile
 * @param {string} intentionText free-text intention for keyword overlap
 * @returns {{score:number, reasons:string[], sharedPractices:string[], sharedIntentions:string[], sharedFormats:string[]}}
 */
export function scoreCandidate(requester, candidate, intentionText = '') {
  const reasons = [];
  let score = 0;

  const reqPractices = asArray(requester.practices);
  const candPractices = asArray(candidate.practices);
  const sharedPractices = intersect(reqPractices, candPractices).filter((p) => PRACTICE_LABELS[p]);
  if (sharedPractices.length > 0) {
    score += 3 * sharedPractices.length;
    const listed = sharedPractices.slice(0, 3).map((p) => PRACTICE_LABELS[p]).join(', ');
    reasons.push(
      sharedPractices.length === 1
        ? `You both care about ${listed}.`
        : `You share ${sharedPractices.length} practices, including ${listed}.`,
    );
  }

  const reqInterests = asArray(requester.interests);
  const candInterests = asArray(candidate.interests);
  const sharedInterests = intersect(reqInterests, candInterests)
    .filter((i) => !sharedPractices.includes(i));
  if (sharedInterests.length > 0) {
    score += 2 * sharedInterests.length;
    if (sharedPractices.length === 0) {
      reasons.push(`You share an interest in ${sharedInterests.slice(0, 3).join(', ')}.`);
    }
  }

  const reqIntentions = asArray(requester.intentions);
  const candIntentions = asArray(candidate.intentions);
  const sharedIntentions = intersect(reqIntentions, candIntentions).filter((i) => INTENTION_LABELS[i]);
  if (sharedIntentions.length > 0) {
    score += 2 * sharedIntentions.length;
    const first = INTENTION_LABELS[sharedIntentions[0]];
    reasons.push(
      sharedIntentions.length === 1
        ? `You both chose “${first}.”`
        : `You both chose “${first}”${sharedIntentions.length > 1 ? ` and ${sharedIntentions.length - 1} more` : ''}.`,
    );
  }

  const reqTokens = new Set(tokenize(intentionText || requester.intention || ''));
  const candTokens = new Set(tokenize(candidate.intention || ''));
  const sharedKeywords = [...reqTokens].filter((t) => candTokens.has(t)).slice(0, 6);
  if (sharedKeywords.length > 0) {
    score += 1 * sharedKeywords.length;
    reasons.push(`You both mention ${quotedList(sharedKeywords.slice(0, 3))} in your intentions.`);
  }

  const reqFormats = asArray(requester.prefs?.formats);
  const candFormats = asArray(candidate.prefs?.formats);
  const sharedFormats = intersect(reqFormats, candFormats);
  if (sharedFormats.length > 0) {
    score += 2;
    reasons.push(`You’re both open to ${sharedFormats.slice(0, 2).map((f) => (FORMAT_LABELS[f] || f).toLowerCase()).join(' and ')}.`);
  }

  const reqLR = requester.prefs?.localRemote || 'either';
  const candLR = candidate.prefs?.localRemote || 'either';
  const localOk = reqLR === 'either' || candLR === 'either' || reqLR === candLR;
  if (localOk && (reqLR !== 'either' || candLR !== 'either')) {
    score += 2;
    if (reqLR === 'local' || candLR === 'local') {
      if (sameRegion(requester.region, candidate.region)) {
        reasons.push(`You’re both in the ${requester.region || candidate.region} area.`);
      } else {
        reasons.push('You’re both open to local connection.');
      }
    } else if (reqLR === 'remote' || candLR === 'remote') {
      reasons.push('You’re both open to remote conversation.');
    }
  }

  const reqLang = asArray(requester.prefs?.languages).map((l) => String(l).toLowerCase());
  const candLang = asArray(candidate.prefs?.languages).map((l) => String(l).toLowerCase());
  if (reqLang.length && candLang.length && reqLang.some((l) => candLang.includes(l))) {
    score += 1;
  }

  if (reasons.length === 0) {
    reasons.push('SEREN surfaced this profile as a gentle stretch beyond your stated preferences.');
  }

  return { score, reasons, sharedPractices, sharedIntentions, sharedFormats };
}

/**
 * Curated matches for a requester.
 *
 * @param {object} requester camelCase profile
 * @param {object[]} candidates camelCase profiles
 * @param {object} opts
 *   - intentionText: free text for keyword overlap
 *   - limit: max results (default 6 — small, curated, never infinite)
 *   - excludeIds: Set of profile ids to skip (passed, already paired)
 *   - existingPairKeys: "minId:maxId" keys for non-withdrawn intros
 *   - blockedIds: Set of profile ids blocked in either direction
 *   - filters: {connectionType?, locality?, format?, practice?}
 * @returns {Array<{candidate, score, reasons, sharedPractices, sharedIntentions, sharedFormats}>}
 */
export function findMatches(requester, candidates, opts = {}) {
  const {
    intentionText = '',
    limit = 6,
    excludeIds = new Set(),
    existingPairKeys = new Set(),
    blockedIds = new Set(),
    filters = {},
  } = opts;

  const reqId = requester.id;
  const results = [];

  for (const candidate of candidates || []) {
    if (!candidate || candidate.id === reqId) continue;
    if (excludeIds.has(candidate.id)) continue;
    if (blockedIds.has(candidate.id)) continue;
    const cs = candidate.consents || {};
    const settings = candidate.consentSettings || {};
    if (cs.community_visible === false) continue;
    if (cs.introductions !== true) continue; // real consent hole: introductions are opt-in
    if (settings.discoveryEnabled === false) continue;
    if (settings.paused === true) continue;

    const lo = Math.min(reqId, candidate.id);
    const hi = Math.max(reqId, candidate.id);
    if (existingPairKeys.has(`${lo}:${hi}`)) continue;

    // Mode filters.
    if (filters.practice) {
      const practices = asArray(candidate.practices);
      if (!practices.includes(filters.practice)) continue;
    }
    if (filters.locality && filters.locality !== 'either') {
      const candLR = candidate.prefs?.localRemote || 'either';
      if (candLR !== 'either' && candLR !== filters.locality) continue;
      if (filters.locality === 'local' && !sameRegion(requester.region, candidate.region)) {
        // For local filtering, require a region in common when both state one.
        if (requester.region && candidate.region) continue;
      }
    }
    if (filters.format) {
      const candFormats = asArray(candidate.prefs?.formats);
      if (candFormats.length && !candFormats.includes(filters.format)) continue;
    }

    const scored = scoreCandidate(requester, candidate, intentionText);
    results.push({ candidate, ...scored });
  }

  results.sort((a, b) => b.score - a.score || a.candidate.id - b.candidate.id);
  return results.slice(0, Math.max(1, limit));
}

/* ------------------------------------------------------------------ */
/* Bilateral proposal reasons.                                         */
/* ------------------------------------------------------------------ */

/** Honest fallback when no concrete benefit for the candidate can be derived. */
export const PAIR_REASON_FALLBACK =
  "Based on what they've shared, the specific benefit for them is still open — that's yours to discover together.";

function truncateText(text, max = 90) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (t.length <= max) return t;
  // Break on a word boundary so we never leave a dangling fragment ("Happ…").
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > Math.floor(max / 2) ? cut.slice(0, lastSpace) : cut;
  return base.trimEnd() + '…';
}

/**
 * Reasons for each side of a potential introduction.
 * - forRequester: the existing explainable why-it-fits reasons, verbatim.
 * - forCandidate: derived ONLY from the candidate's stated intentions,
 *   practices, and interests plus the requester's stated offer/intention.
 *   A concrete link = shared keyword tokens between those two texts. With no
 *   concrete link, returns the honest fallback. Never invents mutual
 *   interest, shared history, or certainty.
 *
 * @param {object} requester camelCase profile
 * @param {object} candidate camelCase profile
 * @param {object} scored scoreCandidate/findMatches result (has .reasons)
 * @param {string} requesterOffer the requester's stated offer (free text)
 * @returns {{forRequester: string[], forCandidate: string}}
 */
export function buildPairReasons(requester, candidate, scored, requesterOffer = '') {
  const forRequester = [...(scored?.reasons || [])];

  const candStated = [
    candidate?.intention || '',
    asArray(candidate?.practices).map((p) => PRACTICE_LABELS[p] || p).join(' '),
    asArray(candidate?.intentions).map((i) => INTENTION_LABELS[i] || i).join(' '),
    asArray(candidate?.interests).join(' '),
  ].join(' ');
  const reqStated = [requesterOffer || '', requester?.intention || ''].join(' ');

  const candTokens = new Set(tokenize(candStated));
  const shared = [...new Set(tokenize(reqStated))].filter((t) => candTokens.has(t)).slice(0, 3);

  let forCandidate = PAIR_REASON_FALLBACK;
  if (shared.length > 0) {
    const offerBit = String(requesterOffer || '').trim()
      ? ` — what you offer (“${truncateText(requesterOffer, 90)}”) speaks to that ground`
      : '';
    forCandidate =
      `They've mentioned ${quotedList(shared)} in what they're looking for${offerBit}.`;
  }
  return { forRequester, forCandidate };
}

/* ------------------------------------------------------------------ */
/* Legacy MVP single-match flow (backward compatible).                 */
/* ------------------------------------------------------------------ */

/**
 * Deterministic match per the contract:
 *   score = 2 × (shared interests) + 1 × (shared intention keywords)
 * (unchanged legacy behavior)
 */
export function findBestMatch(requester, candidates, intentionText, existingPairKeys = new Set()) {
  const requestTokens = new Set(tokenize(intentionText));
  const requesterInterests = new Set(Array.isArray(requester.interests) ? requester.interests : []);
  const reqId = requester.id;

  let best = null;

  for (const candidate of candidates || []) {
    if (!candidate || candidate.id === reqId) continue;
    if (!candidate.consents || candidate.consents.community_visible !== true) continue;

    const lo = Math.min(reqId, candidate.id);
    const hi = Math.max(reqId, candidate.id);
    if (existingPairKeys.has(`${lo}:${hi}`)) continue;

    const candInterests = Array.isArray(candidate.interests) ? candidate.interests : [];
    const sharedInterests = candInterests.filter((i) => requesterInterests.has(i));

    const candTokens = new Set(tokenize(candidate.intention));
    const sharedKeywords = [...requestTokens].filter((t) => candTokens.has(t));

    const score = 2 * sharedInterests.length + 1 * sharedKeywords.length;

    if (
      best === null ||
      score > best.score ||
      (score === best.score && candidate.id < best.candidate.id)
    ) {
      best = { candidate, sharedInterests, sharedKeywords, score };
    }
  }

  return best;
}

function truncate(text, max = 140) {
  if (typeof text !== 'string') return '';
  const t = text.trim();
  return t.length > max ? t.slice(0, max).trimEnd() + '…' : t;
}

/**
 * Warm 1–2 sentence intro note per the contract template (unchanged).
 */
export function buildIntroNote(requester, candidate, sharedInterests, sharedKeywords) {
  const candName = candidate?.name || 'your match';
  const firstName = String(requester?.name || 'friend').trim().split(/\s+/)[0];
  const intentionEcho = truncate(requester?.intention || '');
  const n = sharedInterests.length;

  let firstSentence;
  if (n > 0) {
    const listed = sharedInterests.join(', ');
    firstSentence = `You and ${candName} share ${n} spiritual ${n === 1 ? 'interest' : 'interests'} (${listed})`;
    if (sharedKeywords.length > 0) {
      firstSentence += ` and a shared focus on ${sharedKeywords.join(', ')}`;
    }
    firstSentence += '.';
  } else {
    firstSentence = `You and ${candName} don't share listed spiritual interests yet`;
    if (sharedKeywords.length > 0) {
      firstSentence += `, but you both resonate with ${sharedKeywords.join(', ')}`;
    }
    firstSentence += ' — SEREN brought you together anyway.';
  }

  const secondSentence = intentionEcho
    ? `${firstName}, your intention to "${intentionEcho}" feels like a beautiful beginning — may this connection serve your path.`
    : `${firstName}, may this connection serve your path.`;

  return `${firstSentence} ${secondSentence}`;
}
