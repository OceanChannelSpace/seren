// SEREN — "Digital Sapiens" layer tests (attention integrity).
//
// Grounded in Jack Probert's Digital Sapiens Experiment 2 (20 Harvard
// students, 3 days without instant messaging, Sep 2026):
// - New flourishing check-in questions (net_attention, intentional_use,
//   real_life_pull, pathways_reflection) validate and persist.
// - POST /api/introductions/:id/move-to-real-life: participant-only,
//   accepted-only, sets the flag, returns handoff copy.
// - POST /api/attention/open: records coarse open origins; rejects bad
//   origins; requires auth.
// - GET /api/host/analytics includes the attentionImpact section.
// - Guide: ATTENTION_INTEGRITY_RULES / REENGAGEMENT_BANNED /
//   REAL_LIFE_HANDOFF_TEXT are present; no banned re-engagement phrasing
//   appears in any bot copy; the handoff text is short and skippable.
// - DB: moved_to_real_life column and attention_opens table exist
//   (additive v17 migration).

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const dir = mkdtempSync(join(tmpdir(), 'seren-digital-sapiens-'));
process.env.DB_PATH = join(dir, 'digital-sapiens-test.db');
process.env.SEED_DEMO = 'false';
process.env.BETA_CODE = 'digitalsapiens-test-beta-code';
process.env.SEREN_HOSTS = 'host@example.com';

const { app, db } = await import('../src/server.js');
const guide = await import('../src/guide.js');

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
const uniqueEmail = (base = 'ds') => `${base}${++emailSeq}@example.com`;

function profileBody(name, email) {
  return {
    name,
    email,
    interests: ['meditation', 'yoga'],
    intention: 'I want to find a meditation partner for daily morning practice.',
    connectionPrefs: { seeking: ['practice-partner'], availability: 'Mornings' },
    consents: { introductions: true, community_visible: true, ai_matching: true },
  };
}

const pick = (setCookie, name) => (setCookie.match(new RegExp(name + '=[^;]+')) || [])[0] || '';

async function createMember(name, email) {
  let r = await fetch(`${BASE}/api/beta/enter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'digitalsapiens-test-beta-code' }),
  });
  assert.equal(r.status, 200);
  const beta = pick(r.headers.get('set-cookie') || '', 'seren_beta');
  r = await fetch(`${BASE}/api/profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: beta },
    body: JSON.stringify(profileBody(name, email)),
  });
  const bodyText = await r.text();
  assert.equal(r.status, 201, `profile creation failed: ${bodyText}`);
  const data = JSON.parse(bodyText);
  const cookie = [beta, pick(r.headers.get('set-cookie') || '', 'seren_profile')].filter(Boolean).join('; ');
  return { id: data.id, cookie, beta };
}

async function api(method, path, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data };
}

const host = await createMember('DS Host', 'host@example.com');
const alice = await createMember('DS Alice', uniqueEmail('alice'));
const bob = await createMember('DS Bob', uniqueEmail('bob'));
const cara = await createMember('DS Cara', uniqueEmail('cara'));

async function requestIntroduction(from, to) {
  const r = await api('POST', '/api/connections/request', {
    targetId: to.id,
    connectionType: 'meditation-partner',
    message: 'I would love a calm weekly meditation sit together, if that feels aligned.',
  }, from.cookie);
  assert.equal(r.status, 201, `request failed: ${JSON.stringify(r.data)}`);
  return r.data.introduction;
}

async function acceptIntroduction(intro, by) {
  const r = await api('POST', `/api/introductions/${intro.id}/respond`, {
    response: 'accepted',
  }, by.cookie);
  assert.equal(r.status, 200, `accept failed: ${JSON.stringify(r.data)}`);
  return r.data;
}

// ---------- new check-in questions ----------

test('Digital Sapiens questions are served with valid kinds and choices', async () => {
  const r = await api('GET', '/api/flourishing/questions', undefined, alice.cookie);
  assert.equal(r.status, 200);
  const byKey = Object.fromEntries(r.data.questions.map((q) => [q.key, q]));
  for (const key of ['net_attention', 'intentional_use', 'real_life_pull', 'pathways_reflection']) {
    assert.ok(byKey[key], `missing question ${key}`);
    assert.ok(byKey[key].text.length > 0, `question ${key} needs text`);
  }
  assert.equal(byKey.net_attention.kind, 'choice');
  assert.deepEqual(byKey.net_attention.choices, ['more_present', 'about_same', 'more_scattered']);
  assert.equal(byKey.intentional_use.kind, 'yesno');
  assert.equal(byKey.real_life_pull.kind, 'yesno');
  assert.equal(byKey.pathways_reflection.kind, 'text');
  assert.equal(byKey.pathways_reflection.optional, true);
});

test('Digital Sapiens check-in answers validate and persist', async () => {
  // Valid submission across all four new questions.
  let r = await api('POST', '/api/flourishing/checkin', {
    profileId: alice.id,
    responses: [
      { questionKey: 'net_attention', answer: 'more_present' },
      { questionKey: 'intentional_use', answer: 'yes' },
      { questionKey: 'real_life_pull', answer: 'no' },
      { questionKey: 'pathways_reflection', answer: 'a slow walk, no phone — a small ritual' },
    ],
  }, alice.cookie);
  assert.equal(r.status, 201, `checkin failed: ${JSON.stringify(r.data)}`);

  // Invalid choice value rejected.
  r = await api('POST', '/api/flourishing/checkin', {
    profileId: alice.id,
    responses: [{ questionKey: 'net_attention', answer: 'super_focused' }],
  }, alice.cookie);
  assert.equal(r.status, 400);
  assert.equal(r.data.error.code, 'validation_error');

  // Optional text may be empty.
  r = await api('POST', '/api/flourishing/checkin', {
    profileId: bob.id,
    responses: [{ questionKey: 'pathways_reflection', answer: '' }],
  }, bob.cookie);
  assert.equal(r.status, 201, `empty optional answer failed: ${JSON.stringify(r.data)}`);
});

// ---------- move to real life ----------

test('move-to-real-life: participant-only, accepted-only, sets flag with handoff copy', async () => {
  const intro = await requestIntroduction(alice, bob);
  const accepted = await acceptIntroduction(intro, bob);
  assert.equal(accepted.status, 'accepted');

  // Outsider (not a participant) is forbidden.
  let r = await api('POST', `/api/introductions/${intro.id}/move-to-real-life`, { profileId: cara.id }, cara.cookie);
  assert.equal(r.status, 403);

  // A merely proposed introduction cannot move.
  const proposed = await requestIntroduction(alice, cara);
  r = await api('POST', `/api/introductions/${proposed.id}/move-to-real-life`, { profileId: alice.id }, alice.cookie);
  assert.equal(r.status, 409);

  // Either participant can move an accepted introduction.
  r = await api('POST', `/api/introductions/${intro.id}/move-to-real-life`, { profileId: alice.id }, alice.cookie);
  assert.equal(r.status, 200, `move failed: ${JSON.stringify(r.data)}`);
  assert.equal(r.data.introduction.movedToRealLife, true);
  assert.ok(r.data.handoff && typeof r.data.handoff.text === 'string', 'handoff copy returned');
  assert.ok(r.data.handoff.text.toLowerCase().includes('step back'), 'handoff says SEREN steps back');
  assert.equal(r.data.handoff.skippable, true);

  // Idempotent: moving again still succeeds.
  r = await api('POST', `/api/introductions/${intro.id}/move-to-real-life`, { profileId: bob.id }, bob.cookie);
  assert.equal(r.status, 200);
  assert.equal(r.data.introduction.movedToRealLife, true);
});

// ---------- attention opens ----------

test('attention/open: auth required, origin validated, recorded', async () => {
  // Beta cookie but no session → 401 (beta gate itself is 403, tested implicitly).
  let r = await api('POST', '/api/attention/open', { profileId: alice.id, origin: 'intentional' }, alice.beta);
  assert.equal(r.status, 401);

  // Bad origin → 400.
  r = await api('POST', '/api/attention/open', { profileId: alice.id, origin: 'doomscroll' }, alice.cookie);
  assert.equal(r.status, 400);
  assert.equal(r.data.error.code, 'validation_error');

  // Missing origin → 400.
  r = await api('POST', '/api/attention/open', { profileId: alice.id }, alice.cookie);
  assert.equal(r.status, 400);

  // Valid origins record.
  for (const origin of ['intentional', 'notification', 'unknown']) {
    r = await api('POST', '/api/attention/open', { profileId: alice.id, origin }, alice.cookie);
    assert.equal(r.status, 200, `open (${origin}) failed: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.recorded, true);
  }

  // Wrong identity → 403.
  r = await api('POST', '/api/attention/open', { profileId: bob.id, origin: 'intentional' }, alice.cookie);
  assert.equal(r.status, 403);
});

// ---------- host analytics attentionImpact ----------

test('host analytics includes attentionImpact with opens and net-attention aggregates', async () => {
  // Seed: one intentional open + one full Digital Sapiens check-in from bob.
  await api('POST', '/api/attention/open', { profileId: bob.id, origin: 'intentional' }, bob.cookie);
  await api('POST', '/api/flourishing/checkin', {
    profileId: bob.id,
    responses: [
      { questionKey: 'net_attention', answer: 'more_present' },
      { questionKey: 'intentional_use', answer: 'yes' },
      { questionKey: 'real_life_pull', answer: 'yes' },
    ],
  }, bob.cookie);

  const r = await api('GET', '/api/host/analytics', undefined, host.cookie);
  assert.equal(r.status, 200, `analytics failed: ${JSON.stringify(r.data)}`);
  const impact = r.data.attentionImpact;
  assert.ok(impact, 'attentionImpact section present');
  assert.ok(impact.opens30d.intentional >= 1, 'intentional opens counted');
  assert.equal(typeof impact.opens30d.notification, 'number');
  assert.equal(typeof impact.opens30d.unknown, 'number');
  assert.ok(impact.netAttention.n >= 1, 'net_attention answers counted');
  assert.ok(impact.netAttention.distribution.more_present >= 1, 'more_present counted');
  assert.equal(typeof impact.netAttention.pctMorePresent, 'number');
  assert.equal(typeof impact.intentionalUse.pct, 'number');
  assert.equal(typeof impact.realLifePull.pct, 'number');

  // Non-host is still rejected.
  const denied = await api('GET', '/api/host/analytics', undefined, alice.cookie);
  assert.equal(denied.status, 403);
});

// ---------- guide rules ----------

test('guide: Digital Sapiens attention-integrity rules are present and exported', () => {
  assert.ok(Array.isArray(guide.ATTENTION_INTEGRITY_RULES));
  assert.ok(guide.ATTENTION_INTEGRITY_RULES.length >= 5, 'five attention-integrity rules');
  const joined = guide.ATTENTION_INTEGRITY_RULES.join(' ').toLowerCase();
  assert.ok(joined.includes('urgency'), 'covers manufactured urgency');
  assert.ok(joined.includes('miss you'), 'covers guilt-tripping about inactivity');
  assert.ok(joined.includes('reply'), 'covers reply-when-you-want norms');
  assert.ok(joined.includes('logistics'), 'distinguishes logistics from connection');
});

test('guide: no banned re-engagement phrasing in any bot copy', () => {
  assert.ok(Array.isArray(guide.REENGAGEMENT_BANNED));
  assert.ok(guide.REENGAGEMENT_BANNED.includes('we miss you'));
  const copy = guide.allBotCopy();
  for (const text of copy) {
    const lower = String(text).toLowerCase();
    for (const phrase of guide.REENGAGEMENT_BANNED) {
      assert.ok(!lower.includes(phrase), `banned re-engagement phrase "${phrase}" in: ${String(text).slice(0, 120)}`);
    }
  }
});

test('guide: real-life handoff copy is short, skippable, and covered by bot-copy audits', () => {
  const text = guide.REAL_LIFE_HANDOFF_TEXT;
  assert.ok(typeof text === 'string' && text.length > 0);
  assert.ok(text.length <= 400, `handoff text must fit the 400-char bot limit, got ${text.length}`);
  assert.ok(guide.allBotCopy().includes(text), 'handoff text covered by allBotCopy audits');
  const handoff = guide.realLifeHandoff();
  assert.equal(handoff.kind, 'real_life_handoff');
  assert.equal(handoff.skippable, true);
  assert.equal(handoff.text, text);
});

// ---------- migration ----------

test('db: v17 migration added moved_to_real_life and attention_opens', () => {
  const cols = db.prepare('PRAGMA table_info(introductions)').all();
  assert.ok(cols.some((c) => c.name === 'moved_to_real_life'), 'introductions.moved_to_real_life exists');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
  assert.ok(tables.includes('attention_opens'), 'attention_opens table exists');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  assert.ok(version >= 17, `user_version should be >= 17, got ${version}`);
});
