// SEREN — deterministic matching engine (pure functions, no I/O).
//
// Two generations live here:
//  - findBestMatch / buildIntroNote: legacy MVP single-match flow (kept for
//    backward compatibility with existing tests and the old endpoint).
//  - scoreCandidate / findMatches: the current engine. It scores candidates
//    on transparent, explainable rules and returns qualitative *reasons* —
//    never an opaque "compatibility" claim, and never a numeric score in UI.

import { STOPWORDS, PRACTICE_LABELS, INTENTION_LABELS, FORMAT_LABELS } from './constants.js';
import { BRAND } from './config.js';

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

/**
 * Token-overlap between two free-text lists (offers / needs / skills).
 * Free text rarely matches exactly, so this works on meaningful tokens
 * (≥4 chars, minus stopwords). Returns the matching display phrases from
 * listB whose tokens overlap any token in listA.
 */
function complementaryMatches(listA, listB) {
  const tokensA = new Set();
  for (const item of asArray(listA)) for (const t of tokenize(item)) tokensA.add(t);
  if (tokensA.size === 0) return [];
  const hits = [];
  for (const item of asArray(listB)) {
    if (typeof item !== 'string') continue;
    const tokens = tokenize(item);
    if (tokens.some((t) => tokensA.has(t))) hits.push(item.trim());
  }
  return hits;
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

/* ------------------------------------------------------------------ */
/* Resonant introductions — transparent, low-claim framing.            */
/* (Flourishing by Design, section C.)                                 */
/*                                                                     */
/* Every introduction is optional and explainable. No copy in this     */
/* file asserts fate, destiny, spiritual proof, certainty, or          */
/* objective compatibility — every reason string and intro note is     */
/* audited below (and by tests/resonant-introductions.test.js) to      */
/* keep it that way.                                                   */
/* ------------------------------------------------------------------ */

/**
 * Sensitive-context keyword set. When the requester's intention or brief
 * text signals a tender context (grief, trauma-adjacent, or explicitly
 * vulnerable topics), match outputs recommend a small facilitated group
 * circle as the first step. Suggest, never coerce: direct introductions
 * are never blocked on this basis.
 *
 * Detection is a plain case-insensitive substring match against the
 * requester's intention/brief text — deliberately narrow and documented,
 * not a clinical classifier.
 */
export const SENSITIVE_CONTEXT_KEYWORDS = Object.freeze([
  // grief & loss
  'grief',
  'grieving',
  'bereaved',
  'bereavement',
  'mourning',
  'widow',
  'widower',
  'loss of',
  'lost my',
  // trauma-adjacent
  'trauma',
  'traumatic',
  'traumatized',
  'ptsd',
  'abuse',
  'assault',
  'addiction',
  'relapse',
  'recovery',
  // explicitly vulnerable
  'divorce',
  'separation',
  'suicide',
  'suicidal',
  'self-harm',
  'eating disorder',
]);

/**
 * True when the given free text signals a sensitive context per the
 * keyword set above.
 * @param {string} text
 * @returns {boolean}
 */
export function detectSensitiveContext(text) {
  const t = String(text || '').toLowerCase();
  return SENSITIVE_CONTEXT_KEYWORDS.some((k) => t.includes(k));
}

/** Gentle group-first copy for tender topics. */
export const GROUP_FIRST_STEP_COPY =
  'For tender topics like this, many people prefer meeting first in a small facilitated circle.';

/** Low-claim framing copy for ordinary introductions. */
export const DIRECT_FIRST_STEP_COPY =
  'This is only an optional introduction — not a prediction or judgment about compatibility.';

/**
 * Recommend whether a match should lead with a small group/circle or a
 * direct introduction.
 *
 * @param {string} intentionText the requester's intention / brief text
 * @returns {{ firstStep: 'group' | 'direct', copy: string }}
 */
export function suggestFirstStep(intentionText = '') {
  if (detectSensitiveContext(intentionText)) {
    return { firstStep: 'group', copy: GROUP_FIRST_STEP_COPY };
  }
  return { firstStep: 'direct', copy: DIRECT_FIRST_STEP_COPY };
}

/**
 * The user-facing "why this introduction" summary pattern: transparent,
 * respectful, low-claim.
 *
 * @param {object} parts { sharedPractices, sharedInterests, sharedIntentions }
 * @returns {string}
 */
export function resonanceNote({ sharedPractices = [], sharedInterests = [], sharedIntentions = [] } = {}) {
  const labels = [
    ...asArray(sharedPractices).slice(0, 3).map((p) => PRACTICE_LABELS[p] || p),
    ...asArray(sharedInterests).slice(0, 3),
    ...asArray(sharedIntentions).slice(0, 2).map((i) => INTENTION_LABELS[i] || i),
  ].slice(0, 4);
  const basis = labels.length > 0 ? ` based on your shared interest in ${labels.join(', ')}` : '';
  return (
    `${BRAND.name} noticed a possible point of resonance${basis}. ` +
    'This is only an optional introduction — not a prediction or judgment about compatibility.'
  );
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
 *   v7: their offers match your needs      3 each (token overlap, max 3 counted)
 *   v7: your offers match their needs      3 each (token overlap, max 3 counted)
 *   v7: shared skills                      1 each (token overlap, max 3 counted)
 *
 * Hard gates (applied by findMatches, not here): self, discovery disabled,
 * paused, no introductions consent, existing pair, passed, blocked.
 *
 * @param {object} requester camelCase profile
 * @param {object} candidate camelCase profile
 * @param {string} intentionText free-text intention for keyword overlap
 * @param {object} opts
 *   - quoteCandidateFields: when false, reasons never quote the candidate's
 *     raw offers/needs/skills wording (their practices view is hidden from
 *     the viewer). Generic reasons are used instead.
 *   - matchRequesterNeeds: when false, the requester's needs are not used
 *     for matching at all (their `needsMatching` consent).
 *   - matchCandidateNeeds: when false, the candidate's needs are not used
 *     for matching (their `needsMatching` consent).
 * @returns {{score:number, reasons:string[], sharedPractices:string[], sharedIntentions:string[], sharedFormats:string[]}}
 */
export function scoreCandidate(requester, candidate, intentionText = '', opts = {}) {
  const {
    quoteCandidateFields = true,
    matchRequesterNeeds = true,
    matchCandidateNeeds = true,
  } = opts || {};
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

  // v7: complementarity — connection is not only similarity. What you need
  // against what they offer (and the reverse), plus shared capabilities.
  // Privacy rules:
  //  - A member's needs are only a matching surface when their `needsMatching`
  //    consent is on (both directions).
  //  - Reasons quote the *candidate's* raw wording only when their offers /
  //    needs / skills are visible to the viewer; otherwise a generic reason
  //    is used. The requester's own wording is always safe to echo back.
  const needOfferHits = matchRequesterNeeds
    ? complementaryMatches(requester.needs, candidate.offers).slice(0, 3)
    : [];
  if (needOfferHits.length > 0) {
    score += 3 * needOfferHits.length;
    if (quoteCandidateFields) {
      reasons.push(
        needOfferHits.length === 1
          ? `They offer “${needOfferHits[0]}” — something you’re looking for.`
          : `They offer ${needOfferHits.length} things you’re looking for, including “${needOfferHits[0]}”.`,
      );
    } else {
      reasons.push('They offer something you’re looking for.');
    }
  }
  const offerNeedHits = matchCandidateNeeds
    ? complementaryMatches(requester.offers, candidate.needs).slice(0, 3)
    : [];
  if (offerNeedHits.length > 0) {
    score += 3 * offerNeedHits.length;
    if (quoteCandidateFields) {
      reasons.push(
        offerNeedHits.length === 1
          ? `They’re looking for “${offerNeedHits[0]}” — something you may be able to offer.`
          : `They’re looking for ${offerNeedHits.length} things you may be able to offer, including “${offerNeedHits[0]}”.`,
      );
    } else {
      reasons.push('They’re looking for something you may be able to offer.');
    }
  }
  const sharedSkills = complementaryMatches(requester.skills, candidate.skills).slice(0, 3);
  if (sharedSkills.length > 0) {
    score += 1 * sharedSkills.length;
    reasons.push(
      quoteCandidateFields
        ? `You share skills around ${quotedList(sharedSkills)}.`
        : 'You share skills in common.',
    );
  }

  if (reasons.length === 0) {
    reasons.push(`${BRAND.name} surfaced this profile as a gentle stretch beyond your stated preferences.`);
  }

  return { score, reasons, sharedPractices, sharedIntentions, sharedFormats, serendipity: false };
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
 *   - quoteCandidateFieldsFor: (candidate) => boolean. When false for a
 *     candidate, reasons never quote that candidate's raw offers/needs/skills
 *     wording (their practices view is hidden from the requester).
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
    quoteCandidateFieldsFor = null,
  } = opts;

  const reqId = requester.id;
  const reqMatchesNeeds = requester.consentSettings?.needsMatching !== false;
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

    const scored = scoreCandidate(requester, candidate, intentionText, {
      quoteCandidateFields: typeof quoteCandidateFieldsFor === 'function'
        ? quoteCandidateFieldsFor(candidate) !== false
        : true,
      matchRequesterNeeds: reqMatchesNeeds,
      matchCandidateNeeds: candidate.consentSettings?.needsMatching !== false,
    });
    results.push({ candidate, ...scored });
  }

  results.sort((a, b) => b.score - a.score || a.candidate.id - b.candidate.id);
  const cap = Math.max(1, limit);
  const final = results.slice(0, cap);

  // v7: controlled serendipity — one clearly-labeled wild card appended after
  // the ranked results. Permissioned: only when the requester left serendipity
  // on (consentSettings.serendipity !== false). The wild card still passed
  // every consent gate above; it simply isn't an obvious similarity match.
  // It is never counted against the limit — it arrives as an explicit extra.
  if (requester.consentSettings?.serendipity !== false && final.length >= 2) {
    const topIds = new Set(final.map((r) => r.candidate.id));
    const pool = results.filter((r) => !topIds.has(r.candidate.id) && r.score > 0);
    if (pool.length > 0) {
      const wild = pool[pool.length - 1]; // lowest-scoring eligible candidate
      wild.serendipity = true;
      wild.reasons = [
        'A gentle wild card — fewer obvious overlaps with your profile, offered to widen the circle. Shown only because you keep serendipity on; you can turn it off in settings.',
      ];
      final.push(wild);
    }
  }

  // Flourishing by Design (section C): every match output carries the
  // transparent resonance framing and a group-first vs. direct suggestion.
  // NOTE: guide.js proposals already expose a string-typed `suggestedFirstStep`
  // (the gentle first-step sentence, per the v3 contract) and overwrite it
  // explicitly in buildProposals — see the report for the backend wiring note.
  const step = suggestFirstStep(intentionText);
  return final.map((r) => ({
    ...r,
    resonanceNote: resonanceNote(r),
    suggestedFirstStep: step.firstStep,
    firstStepCopy: step.copy,
  }));
}

/* ------------------------------------------------------------------ */
/* Agent matching — intelligent agents as discoverable participants.   */
/*                                                                     */
/* Agents are matched against a member's needs and intention language, */
/* never presented as human, and always labeled as AI in the UI. The   */
/* requesting member must have ai_matching consent (checked by the     */
/* caller, e.g. /api/discover).                                        */
/* ------------------------------------------------------------------ */

/**
 * Score one agent against a requester.
 *
 * Factors (weights internal; UI shows only reasons):
 *   capability tokens overlapping the member's needs   3 each (max 3)
 *   capability/description tokens in intention text    1 each (max 6)
 *
 * @param {object} requester camelCase profile
 * @param {object} agent camelCase agent
 * @param {string} intentionText free-text intention for keyword overlap
 * @param {object} opts { matchRequesterNeeds } — when false, the requester's
 *   needs are not matched against agent capabilities.
 * @returns {{score:number, reasons:string[]}}
 */
export function scoreAgent(requester, agent, intentionText = '', opts = {}) {
  const { matchRequesterNeeds = true } = opts || {};
  const reasons = [];
  let score = 0;

  const needHits = matchRequesterNeeds
    ? complementaryMatches(requester.needs, agent.capabilities).slice(0, 3)
    : [];
  if (needHits.length > 0) {
    score += 3 * needHits.length;
    reasons.push(
      needHits.length === 1
        ? `Its capabilities include “${needHits[0]}” — something you’re looking for.`
        : `Its capabilities include ${needHits.length} things you’re looking for, including “${needHits[0]}”.`,
    );
  }

  const reqTokens = new Set(tokenize(intentionText || requester.intention || ''));
  const agentTokens = new Set([
    ...tokenize(agent.description || ''),
    ...asArray(agent.capabilities).flatMap((c) => tokenize(c)),
  ]);
  const sharedKeywords = [...reqTokens].filter((t) => agentTokens.has(t)).slice(0, 6);
  if (sharedKeywords.length > 0) {
    score += 1 * sharedKeywords.length;
    reasons.push(`It works with ${quotedList(sharedKeywords.slice(0, 3))} — language from your intention.`);
  }

  return { score, reasons };
}

/**
 * Curated agent suggestions for a requester.
 *
 * @param {object} requester camelCase profile
 * @param {object[]} agents camelCase agents
 * @param {object} opts { intentionText, limit, matchRequesterNeeds }
 * @returns {Array<{agent, score, reasons}>}
 */
export function findAgentMatches(requester, agents, { intentionText = '', limit = 3, matchRequesterNeeds = true } = {}) {
  const results = [];
  for (const agent of agents || []) {
    if (!agent || agent.isHidden) continue;
    const scored = scoreAgent(requester, agent, intentionText, { matchRequesterNeeds });
    if (scored.score <= 0) continue;
    results.push({ agent, ...scored });
  }
  results.sort((a, b) => b.score - a.score || a.agent.id - b.agent.id);
  return results.slice(0, Math.max(1, limit));
}

/* ------------------------------------------------------------------ */
/* Bilateral proposal reasons.                                         */
/* ------------------------------------------------------------------ */

/** Honest fallback when no concrete benefit for the candidate can be derived. */
export const PAIR_REASON_FALLBACK =
  "Based on what they've shared, the specific benefit for them is still open — that's yours to discover together.";

/**
 * Reasons for each side of a potential introduction.
 * - forRequester: the existing explainable why-it-fits reasons, verbatim.
 * - forCandidate: derived ONLY from whether a concrete link exists between
 *   the candidate's stated intentions/practices/interests and the requester's
 *   stated offer/intention. The wording is deliberately generic — neither
 *   party's raw words are ever quoted to the other side without their
 *   explicit say-so. With no concrete link, returns the honest fallback.
 *   Never invents mutual interest, shared history, or certainty.
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
    forCandidate =
      'What they bring overlaps with themes from your own profile — this may speak to your current path.';
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
    firstSentence += ' — SEREN noticed a possible point of resonance between you.';
  }

  const secondSentence = intentionEcho
    ? `${firstName}, your intention to "${intentionEcho}" feels like a beautiful beginning — may this connection serve your path.`
    : `${firstName}, may this connection serve your path.`;

  return `${firstSentence} ${secondSentence}`;
}
