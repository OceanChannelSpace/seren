// SEREN MVP — deterministic matching engine (pure functions, no I/O).

import { STOPWORDS } from './constants.js';

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

/**
 * Deterministic match per the contract:
 *   score = 2 × (shared interests) + 1 × (shared intention keywords)
 * Skips the requester, candidates without community_visible consent,
 * and pairs with an existing non-withdrawn introduction in either direction.
 * Ties break by lowest profile id. A score-0 candidate wins if nothing better
 * exists; null if no eligible candidates.
 *
 * @param {object} requester  camelCase profile {id, interests[], intention, name}
 * @param {object[]} candidates camelCase profiles {id, interests[], intention, name, consents}
 * @param {string} intentionText the intention the request was made with
 * @param {Set<string>} [existingPairKeys] "minId:maxId" keys for non-withdrawn intros
 * @returns {{candidate, sharedInterests: string[], sharedKeywords: string[], score: number} | null}
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
 * Warm 1–2 sentence intro note per the contract template:
 * "You and {name} share {n} spiritual {interest|interests}{keyword-bit}.
 *  {first-name-requester}, {intention-echo}"
 * Honest about score-0 matches.
 *
 * @param {object} requester  camelCase profile {name, intention}
 * @param {object} candidate  camelCase profile {name}
 * @param {string[]} sharedInterests
 * @param {string[]} sharedKeywords
 * @returns {string}
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
