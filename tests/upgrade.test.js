// Relationship-network upgrade tests (October 2026):
// brand modularity, v7 profile fields (offers/needs/skills), matching
// complementarity + controlled serendipity, and the agent registry.
//
// Spins up the real express app on an ephemeral port with an isolated temp
// SQLite DB (SEED_DEMO=false); fixtures go through the API itself.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

// Brand override proves the name/tagline are configurable, not hard-coded.
process.env.BRAND_NAME = 'TestBrand';
process.env.BRAND_TAGLINE = 'Test tagline for meaningful connection';

const dir = mkdtempSync(join(tmpdir(), 'seren-upgrade-'));
process.env.DB_PATH = join(dir, 'upgrade-test.db');
process.env.SEED_DEMO = 'false';

// Dynamic import so DB_PATH / SEED_DEMO / BRAND_* are honored at load time.
const { app, db } = await import('../src/server.js');
const { scoreCandidate, findMatches, scoreAgent, findAgentMatches } = await import('../src/match.js');

const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const BASE = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try { db.close(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true });
});

// ---------- helpers ----------

let emailSeq = 0;
const uniqueEmail = () => `upgrader${++emailSeq}@example.com`;

function profileBody(overrides = {}) {
  return {
    name: 'Upgrade Tester',
    email: uniqueEmail(),
    interests: ['meditation'],
    intention: 'I want to find a meditation partner for daily morning practice.',
    connectionPrefs: { seeking: ['practice-partner'], availability: 'Mornings' },
    consents: { introductions: true, community_visible: true, ai_matching: true },
    ...overrides,
  };
}

// Identity: the session token arrives as an HttpOnly cookie on profile
// creation. Pass a created profile (or its `_auth` cookie string) as `auth`
// and its cookie is sent; the server derives identity from the token alone.
async function api(method, path, body, auth) {
  const headers = { 'Content-Type': 'application/json' };
  const cookie = typeof auth === 'string' ? auth : auth?._auth;
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json, setCookie: res.headers.get('set-cookie') };
}

function sessionCookie(setCookieHeader) {
  const m = /(?:^|,)\s*seren_profile=([^;]+)/.exec(String(setCookieHeader || ''));
  return m ? `seren_profile=${m[1]}` : null;
}

async function createProfile(overrides = {}) {
  const { status, json, setCookie } = await api('POST', '/api/profiles', profileBody(overrides));
  assert.equal(status, 201, 'fixture profile creation should succeed');
  return { ...json, _auth: sessionCookie(setCookie) };
}

// ---------- brand modularity ----------

test('GET /api/meta exposes the configured brand name and tagline', async () => {
  const { status, json } = await api('GET', '/api/meta');
  assert.equal(status, 200);
  assert.equal(json.brand.name, 'TestBrand');
  assert.equal(json.brand.tagline, 'Test tagline for meaningful connection');
});

// ---------- v7 profile fields ----------

test('profiles accept and persist offers, needs, and skills', async () => {
  const p = await createProfile({
    offers: ['tarot readings'],
    needs: ['a practice partner'],
    skills: ['facilitation'],
  });
  assert.deepEqual(p.offers, ['tarot readings']);
  assert.deepEqual(p.needs, ['a practice partner']);
  assert.deepEqual(p.skills, ['facilitation']);
});

test('offers/needs/skills are trimmed on write', async () => {
  const p = await createProfile({
    offers: ['  Reiki Healing ', 'listening  '],
  });
  assert.deepEqual(p.offers, ['Reiki Healing', 'listening']);
});

test('offers/needs/skills reject duplicates and blank items', async () => {
  const { status, json } = await api('POST', '/api/profiles', profileBody({
    offers: ['reiki', '  ', 'Reiki'],
  }));
  assert.equal(status, 400);
  const fields = json.error.details.map((d) => d.field);
  assert.ok(fields.includes('offers'), 'offers validation error expected');
});

test('offers/needs/skills can be updated and cleared', async () => {
  const p = await createProfile({ offers: ['old offer'], needs: ['old need'], skills: ['old skill'] });
  const { status, json } = await api('PATCH', `/api/profiles/${p.id}`, {
    offers: ['new offer'],
    needs: [],
    skills: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'],
  }, p);
  assert.equal(status, 400, 'more than 10 skills should fail validation');
  const { status: s2, json: j2 } = await api('PATCH', `/api/profiles/${p.id}`, {
    offers: ['new offer'],
    needs: [],
  }, p);
  assert.equal(s2, 200);
  assert.deepEqual(j2.offers, ['new offer']);
  assert.deepEqual(j2.needs, []);
});

test('offers/needs/skills share the practices visibility rule', async () => {
  const owner = await createProfile({
    offers: ['secret offer'], needs: ['secret need'], skills: ['secret skill'],
  });
  const viewer = await createProfile({ name: 'Viewer' });
  // Default consentSettings: showPractices on → fields visible to others.
  const { json: visible } = await api('GET', `/api/profiles/${owner.id}`, undefined, viewer);
  assert.deepEqual(visible.offers, ['secret offer']);
  assert.deepEqual(visible.needs, ['secret need']);
  assert.deepEqual(visible.skills, ['secret skill']);
  // Turn off showPractices → fields hidden from non-mutual viewers.
  await api('PATCH', `/api/profiles/${owner.id}`, { consentSettings: { showPractices: false } }, owner);
  const { json: hidden } = await api('GET', `/api/profiles/${owner.id}`, undefined, viewer);
  assert.ok(!('offers' in hidden), 'offers should be hidden when showPractices is off');
  assert.ok(!('needs' in hidden), 'needs should be hidden when showPractices is off');
});

// ---------- matching: complementarity (unit) ----------

function matchProfile(id, overrides = {}) {
  return {
    id,
    name: `Person ${id}`,
    practices: [],
    interests: [],
    intentions: [],
    intention: '',
    prefs: {},
    offers: [],
    needs: [],
    skills: [],
    consentSettings: {},
    ...overrides,
  };
}

test('scoreCandidate rewards offers-to-needs complementarity with reasons', () => {
  const requester = matchProfile(1, { needs: ['a tarot reading'] });
  const candidate = matchProfile(2, { offers: ['tarot readings for friends'] });
  const { score, reasons } = scoreCandidate(requester, candidate);
  assert.ok(score >= 3, `expected complementarity score, got ${score}`);
  assert.ok(reasons.some((r) => r.includes('tarot readings for friends')),
    'reason should name the matched offer');
});

test('scoreCandidate rewards the reverse direction (your offers ↔ their needs)', () => {
  const requester = matchProfile(1, { offers: ['garden help'] });
  const candidate = matchProfile(2, { needs: ['help in the garden'] });
  const { score, reasons } = scoreCandidate(requester, candidate);
  assert.ok(score >= 3, `expected complementarity score, got ${score}`);
  assert.ok(reasons.some((r) => r.startsWith('They’re looking for')),
    `reason should attribute the need to them, not quote it as your offer: ${JSON.stringify(reasons)}`);
});

test('scoreCandidate rewards shared skills with reasons', () => {
  const requester = matchProfile(1, { skills: ['deep listening'] });
  const candidate = matchProfile(2, { skills: ['listening circles'] });
  const { score, reasons } = scoreCandidate(requester, candidate);
  assert.ok(score >= 1);
  assert.ok(reasons.some((r) => r.includes('skills')), 'reason should mention skills');
});

test('scoreCandidate does not count more than 3 complementarity hits per axis', () => {
  const requester = matchProfile(1, { needs: ['alpha beta gamma delta epsilon zeta'] });
  const candidate = matchProfile(2, {
    offers: ['alpha one', 'beta two', 'gamma three', 'delta four', 'epsilon five', 'zeta six'],
  });
  const { score } = scoreCandidate(requester, candidate);
  assert.equal(score, 9, 'complementarity capped at 3 hits x 3 points');
});

// ---------- matching: controlled serendipity (unit) ----------

function consentingCandidate(id, extra = {}) {
  return matchProfile(id, {
    practices: ['meditation'],
    consents: { introductions: true, community_visible: true },
    consentSettings: {},
    ...extra,
  });
}

test('findMatches appends one labeled wild card without displacing top results', () => {
  const requester = matchProfile(1, { practices: ['meditation'], consentSettings: {} });
  const candidates = [consentingCandidate(2), consentingCandidate(3), consentingCandidate(4), consentingCandidate(5)];
  const results = findMatches(requester, candidates, { limit: 2 });
  assert.equal(results.length, 3, 'limit 2 + 1 wild card');
  assert.deepEqual(results.slice(0, 2).map((r) => r.candidate.id), [2, 3],
    'top results keep their deterministic order');
  const wild = results[2];
  assert.equal(wild.serendipity, true);
  assert.ok(wild.reasons.some((r) => r.toLowerCase().includes('wild card')),
    'wild card is clearly labeled');
  assert.equal(results[0].serendipity, false);
});

test('findMatches skips the wild card when the requester opts out', () => {
  const requester = matchProfile(1, {
    practices: ['meditation'],
    consentSettings: { serendipity: false },
  });
  const candidates = [consentingCandidate(2), consentingCandidate(3), consentingCandidate(4)];
  const results = findMatches(requester, candidates, { limit: 2 });
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.serendipity !== true));
});

test('findMatches never promotes a zero-score candidate as the wild card', () => {
  const requester = matchProfile(1, { practices: ['meditation'], consentSettings: {} });
  // Candidate 5 shares nothing at all → score 0 (fallback reason only).
  const candidates = [consentingCandidate(2), consentingCandidate(3), { ...consentingCandidate(5), practices: ['skydiving'] }];
  const results = findMatches(requester, candidates, { limit: 2 });
  assert.ok(results.every((r) => r.serendipity !== true),
    'no wild card when nothing eligible remains');
});

test('findMatches wild card respects consent gates (blocks)', () => {
  const requester = matchProfile(1, { practices: ['meditation'], consentSettings: {} });
  const candidates = [consentingCandidate(2), consentingCandidate(3), consentingCandidate(4)];
  const results = findMatches(requester, candidates, { limit: 2, blockedIds: new Set([4]) });
  assert.deepEqual(results.map((r) => r.candidate.id), [2, 3],
    'blocked candidate 4 must not appear, even as wild card');
});

// ---------- agent registry ----------

test('POST /api/agents registers an agent with operator attestation', async () => {
  const op = await createProfile({ name: 'Operator' });
  const { status, json } = await api('POST', '/api/agents', {
    name: 'Oneiro',
    description: 'A dream-work companion.',
    capabilities: ['dream interpretation', 'symbol exploration'],
    trustNote: 'I built Oneiro and vouch for its gentle approach.',
  }, op);
  assert.equal(status, 201);
  assert.equal(json.name, 'Oneiro');
  assert.equal(json.kind, 'ai');
  assert.equal(json.operatorProfileId, op.id);
  assert.equal(json.operatorName, 'Operator');
  assert.deepEqual(json.capabilities, ['dream interpretation', 'symbol exploration']);
  assert.equal(json.trustNote, 'I built Oneiro and vouch for its gentle approach.');
});

test('POST /api/agents validates input', async () => {
  const op = await createProfile({ name: 'Op Two' });
  const { status: s1, json: j1 } = await api('POST', '/api/agents', {
    name: 'Bad',
    endpointUrl: 'ftp://not-http',
  }, op);
  assert.equal(s1, 400);
  assert.ok(j1.error.details.some((d) => d.field === 'endpointUrl'));

  // No session token → 401; the operator is always the authed caller.
  const { status: s2, json: j2 } = await api('POST', '/api/agents', { name: 'No Operator' });
  assert.equal(s2, 401, 'missing token → 401');
  assert.equal(j2.error.code, 'unauthorized');

  // A self-asserted operatorProfileId is ignored — the token decides.
  const { status: s3, json: j3 } = await api('POST', '/api/agents', {
    operatorProfileId: 99999,
    name: 'Ghost Operator',
  }, op);
  assert.equal(s3, 201, 'self-asserted operatorProfileId is ignored');
  assert.equal(j3.operatorProfileId, op.id, 'operator comes from the session token');
});

test('GET /api/agents lists visible agents; hidden agents are excluded', async () => {
  const op = await createProfile({ name: 'Op Three' });
  const { json: a1 } = await api('POST', '/api/agents', {
    name: 'Visible Agent', capabilities: ['listening'],
  }, op);
  assert.equal(a1.id > 0, true);
  const { status, json } = await api('GET', '/api/agents');
  assert.equal(status, 200);
  assert.ok(json.agents.some((a) => a.name === 'Visible Agent'));

  const { status: hideStatus } = await api('POST', `/api/agents/${a1.id}/hide`, {}, op);
  assert.equal(hideStatus, 200);
  const { json: after } = await api('GET', '/api/agents');
  assert.ok(!after.agents.some((a) => a.id === a1.id), 'hidden agent excluded from list');
  const { status: getStatus } = await api('GET', `/api/agents/${a1.id}`);
  assert.equal(getStatus, 404, 'hidden agent not fetchable directly');
});

test('only the registering operator can edit or hide an agent', async () => {
  const op = await createProfile({ name: 'True Operator' });
  const other = await createProfile({ name: 'Stranger' });
  const { json: agent } = await api('POST', '/api/agents', {
    name: 'Guarded Agent', description: 'v1',
  }, op);

  const { status: editForbidden } = await api('PATCH', `/api/agents/${agent.id}`, {
    description: 'hijacked',
  }, other);
  assert.equal(editForbidden, 403);

  const { status: editOk, json: edited } = await api('PATCH', `/api/agents/${agent.id}`, {
    description: 'v2',
  }, op);
  assert.equal(editOk, 200);
  assert.equal(edited.description, 'v2');

  const { status: hideForbidden } = await api('POST', `/api/agents/${agent.id}/hide`, {}, other);
  assert.equal(hideForbidden, 403);
});

// ---------- agent matching (unit + discover integration) ----------

test('scoreAgent matches agent capabilities against member needs', () => {
  const requester = matchProfile(1, { needs: ['dream interpretation help'] });
  const agent = { id: 1, name: 'Oneiro', capabilities: ['dream interpretation'], description: '' };
  const { score, reasons } = scoreAgent(requester, agent);
  assert.ok(score >= 3);
  assert.ok(reasons.some((r) => r.includes('dream interpretation')));
});

test('scoreAgent uses intention language against agent description', () => {
  const requester = matchProfile(1, { intention: 'I want help with my grief journey' });
  const agent = { id: 1, name: 'GriefBot', capabilities: [], description: 'A gentle grief companion' };
  const { score } = scoreAgent(requester, agent, 'I want help with my grief journey');
  assert.ok(score >= 1);
});

test('GET /api/discover?agents=true suggests matching agents alongside people', async () => {
  const seeker = await createProfile({
    name: 'Seeker',
    needs: ['dream interpretation'],
    interests: ['meditation'],
  });
  const op = await createProfile({ name: 'Agent Op' });
  await api('POST', '/api/agents', {
    name: 'Oneiro',
    description: 'A dream-work companion.',
    capabilities: ['dream interpretation'],
  }, op);

  const { status, json } = await api('GET', '/api/discover?agents=true', undefined, seeker);
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.matches), 'human matches still returned');
  assert.ok(json.agents.some((a) => a.agent.name === 'Oneiro'),
    'matching agent suggested');
  const entry = json.agents.find((a) => a.agent.name === 'Oneiro');
  assert.ok(entry.reasons.length > 0, 'agent suggestion carries reasons');
  assert.equal(entry.agent.kind, 'ai', 'agent is labeled as AI');
});

test('agent suggestions are omitted without the flag or without ai_matching consent', async () => {
  const seeker = await createProfile({
    name: 'Private Seeker',
    needs: ['dream interpretation'],
    consents: { introductions: true, community_visible: true, ai_matching: false },
  });
  const op = await createProfile({ name: 'Agent Op 2' });
  await api('POST', '/api/agents', {
    name: 'Oneiro Two', capabilities: ['dream interpretation'],
  }, op);

  const { json: noFlag } = await api('GET', '/api/discover', undefined, seeker);
  assert.deepEqual(noFlag.agents, [], 'no agents without the flag');

  const { json: noConsent } = await api('GET', '/api/discover?agents=true', undefined, seeker);
  assert.deepEqual(noConsent.agents, [], 'no agents when ai_matching consent is off');
});

// ---------- discover carries the serendipity flag ----------

test('GET /api/discover marks the wild card in its response', async () => {
  const mk = (name) => createProfile({
    name,
    interests: ['meditation'],
    intention: 'Daily meditation practice with others.',
    connectionPrefs: { seeking: ['practice-partner'] },
  });
  const requester = await mk('Wild Requester');
  await mk('Wild A');
  await mk('Wild B');
  await mk('Wild C');
  await mk('Wild D');

  const { status, json } = await api('GET', '/api/discover?limit=2', undefined, requester);
  assert.equal(status, 200);
  const wilds = json.matches.filter((m) => m.serendipity === true);
  assert.equal(wilds.length, 1, 'exactly one wild card appended');
  assert.ok(wilds[0].reasons.some((r) => r.toLowerCase().includes('wild card')));
});

// ---------- external review follow-ups (trust & privacy) ----------

test('POST /api/agents rejects non-public endpoint hosts', async () => {
  const op = await createProfile({ name: 'Op Endpoint' });
  for (const url of [
    'http://localhost:4000/agent',
    'http://127.0.0.1/agent',
    'http://10.0.0.5/agent',
    'http://192.168.1.10/agent',
    'http://169.254.169.254/agent',
    'http://mybox.local/agent',
  ]) {
    const { status, json } = await api('POST', '/api/agents', {
      name: `E-${Math.abs(hashStr(url))}`, endpointUrl: url,
    }, op);
    assert.equal(status, 400, `should reject ${url}`);
    assert.ok(json.error.details.some((d) => d.field === 'endpointUrl'), url);
  }
  const { status: ok } = await api('POST', '/api/agents', {
    name: 'E-public', endpointUrl: 'https://agents.example.org/chat',
  }, op);
  assert.equal(ok, 201, 'public https endpoint accepted');
});

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

test('PATCH /api/profiles/:id accepts serendipity and needsMatching consent settings', async () => {
  const p = await createProfile({ name: 'Consent Keys' });
  const { status, json } = await api('PATCH', `/api/profiles/${p.id}`, {
    consentSettings: { serendipity: false, needsMatching: false },
  }, p);
  assert.equal(status, 200, `expected 200, got ${JSON.stringify(json)}`);
  assert.equal(json.consentSettings.serendipity, false);
  assert.equal(json.consentSettings.needsMatching, false);
});

test('scoreCandidate: quoteCandidateFields=false keeps score, generalizes reasons', () => {
  const requester = matchProfile(1, {
    needs: ['a tarot reading'], offers: ['help moving house'], skills: ['deep listening'],
  });
  const candidate = matchProfile(2, {
    offers: ['tarot readings for friends'], needs: ['help in the garden'], skills: ['listening circles'],
  });
  const quoted = scoreCandidate(requester, candidate);
  const generic = scoreCandidate(requester, candidate, '', { quoteCandidateFields: false });
  assert.equal(generic.score, quoted.score, 'same score either way');
  assert.ok(quoted.reasons.some((r) => r.includes('tarot readings for friends')), 'quoted variant names the offer');
  assert.ok(!generic.reasons.some((r) => r.includes('tarot readings for friends')), 'no verbatim candidate offer');
  assert.ok(!generic.reasons.some((r) => r.includes('help in the garden')), 'no verbatim candidate need');
  assert.ok(!generic.reasons.some((r) => r.includes('listening circles')), 'no verbatim candidate skill');
  assert.ok(generic.reasons.some((r) => r.includes('something you’re looking for')), 'generic need→offer reason');
  assert.ok(generic.reasons.some((r) => r.includes('something you may be able to offer')), 'generic offer→need reason');
  assert.ok(generic.reasons.some((r) => r.includes('skills in common')), 'generic skills reason');
});

test('needsMatching=false removes needs from matching in both directions', () => {
  const requester = matchProfile(1, {
    needs: ['a tarot reading'], consentSettings: { needsMatching: false },
  });
  const candidate = matchProfile(2, { offers: ['tarot readings for friends'] });
  const r1 = scoreCandidate(requester, candidate, '', { matchRequesterNeeds: false });
  assert.equal(r1.score, 0, 'requester needs ignored → no complementarity score');

  const req2 = matchProfile(1, { offers: ['garden help'] });
  const cand2 = matchProfile(2, { needs: ['help in the garden'] });
  const r2 = scoreCandidate(req2, cand2, '', { matchCandidateNeeds: false });
  assert.equal(r2.score, 0, 'candidate needs ignored → no complementarity score');
});

test('findMatches honors needsMatching consent on both sides', () => {
  const base = (id, overrides) => ({
    ...matchProfile(id, overrides),
    consents: { introductions: true, community_visible: true },
  });
  const requester = base(1, { needs: ['a tarot reading'], consentSettings: { needsMatching: false } });
  const candidate = base(2, { offers: ['tarot readings for friends'] });
  const ms = findMatches(requester, [candidate], {});
  assert.equal(ms.length, 1);
  assert.equal(ms[0].score, 0, 'opted-out need contributes nothing');
  assert.ok(!ms[0].reasons.some((r) => r.includes('looking for')), 'no need-based reason');
});

test('findAgentMatches honors needsMatching=false', () => {
  const requester = matchProfile(1, {
    needs: ['dream interpretation'], consentSettings: { needsMatching: false },
  });
  const agent = { id: 1, name: 'Oneiro', capabilities: ['dream interpretation'], description: '', isHidden: false };
  const ms = findAgentMatches(requester, [agent], { matchRequesterNeeds: false });
  assert.equal(ms.length, 0, 'no capability-based suggestion when needs matching is off');
});

test('findMatches quoteCandidateFieldsFor=false generalizes candidate quotes', () => {
  const base = (id, overrides) => ({
    ...matchProfile(id, overrides),
    consents: { introductions: true, community_visible: true },
  });
  const requester = base(1, { needs: ['a tarot reading'] });
  const candidate = base(2, { offers: ['tarot readings for friends'] });
  const ms = findMatches(requester, [candidate], { quoteCandidateFieldsFor: () => false });
  assert.equal(ms.length, 1);
  assert.ok(ms[0].score >= 3, 'still scores');
  assert.ok(!ms[0].reasons.some((r) => r.includes('tarot readings for friends')), 'no verbatim quote');
  assert.ok(ms[0].reasons.some((r) => r.includes('something you’re looking for')), 'generic reason used');
});

test('defaultConsentSettings includes needsMatching=true', async () => {
  const { defaultConsentSettings } = await import('../src/db.js');
  assert.equal(defaultConsentSettings().needsMatching, true);
  assert.equal(defaultConsentSettings().serendipity, true);
});
