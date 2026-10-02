// SEREN MVP — Synchronicity Mode tests (v13).
// Beacons are short, time-bound signals matched on exact normalized text.
// Matching runs synchronously at beacon creation; a match creates an
// introduction through the existing staged mutual-consent flow. Spins up
// the real express app on an ephemeral port with an isolated temp SQLite
// DB (SEED_DEMO=false), BETA_CODE and SEREN_HOSTS set.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const dir = mkdtempSync(join(tmpdir(), 'seren-sync-'));
process.env.DB_PATH = join(dir, 'sync-test.db');
process.env.SEED_DEMO = 'false';
process.env.BETA_CODE = 'sync-test-beta-code';
process.env.SEREN_HOSTS = 'host@example.com';

const { app, db } = await import('../src/server.js');
const dbApi = await import('../src/db.js');
const { SYNC_DECK } = await import('../src/sync-deck.js');

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
const uniqueEmail = (base = 'synctester') => `${base}${++emailSeq}@example.com`;

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
    body: JSON.stringify({ code: 'sync-test-beta-code' }),
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
  return { id: data.id, cookie };
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

const beacon = (member, payload) => api('POST', '/api/sync/beacons', payload, member.cookie);

// ---------- fixtures ----------

const host = await createMember('Sync Host', 'host@example.com');
const alice = await createMember('Sync Alice', uniqueEmail('alice'));
const bob = await createMember('Sync Bob', uniqueEmail('bob'));
const cara = await createMember('Sync Cara', uniqueEmail('cara'));
const dan = await createMember('Sync Dan', uniqueEmail('dan'));
const erin = await createMember('Sync Erin', uniqueEmail('erin'));
const finn = await createMember('Sync Finn', uniqueEmail('finn'));
const gail = await createMember('Sync Gail', uniqueEmail('gail'));
const hank = await createMember('Sync Hank', uniqueEmail('hank'));
const ivy = await createMember('Sync Ivy', uniqueEmail('ivy'));
const jay = await createMember('Sync Jay', uniqueEmail('jay'));
const kim = await createMember('Sync Kim', uniqueEmail('kim'));
const leo = await createMember('Sync Leo', uniqueEmail('leo'));

// ---------- tests ----------

test('self-input beacon creation normalizes and stores', async () => {
  const r = await beacon(alice, { source: 'self_input', text: 'Quill', intentionType: 'conversation' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.beacon.source, 'self_input');
  assert.equal(r.data.beacon.text, 'Quill');
  assert.equal(r.data.beacon.word, 'quill');
  assert.equal(r.data.beacon.status, 'active');
  assert.equal(r.data.beacon.intentionType, 'conversation');
  assert.ok(r.data.beacon.expiresAt, 'beacon carries an expiry');
  assert.equal(r.data.match, null, 'no one else carries it yet');
});

test('deck draw beacon creation', async () => {
  const deck = await api('GET', '/api/sync/deck', undefined, bob.cookie);
  assert.equal(deck.status, 200);
  assert.ok(Array.isArray(deck.data.cards) && deck.data.cards.length >= 40, 'deck is a real starter set');
  for (const c of deck.data.cards) {
    assert.ok(c.id && c.word && c.prompt, 'every card has id, word, prompt');
  }
  const card = deck.data.cards.find((c) => c.id === 'ember');
  assert.ok(card, 'ember card exists');
  const r = await beacon(bob, { source: 'deck_draw', cardId: 'ember' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.beacon.source, 'deck_draw');
  assert.equal(r.data.beacon.cardId, 'ember');
  assert.equal(r.data.beacon.text, 'ember');
  assert.equal(r.data.beacon.word, 'ember');
});

test('one active beacon per member: second create is 409', async () => {
  const r = await beacon(alice, { source: 'self_input', text: 'harbor' });
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'conflict_state');
});

test('withdraw frees the member to carry a new beacon', async () => {
  const w = await api('POST', '/api/sync/beacons/mine/withdraw', {}, alice.cookie);
  assert.equal(w.status, 200);
  assert.equal(w.data.beacon.status, 'withdrawn');
  const r = await beacon(alice, { source: 'self_input', text: 'harbor' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.beacon.word, 'harbor');
  const again = await api('POST', '/api/sync/beacons/mine/withdraw', {}, alice.cookie);
  assert.equal(again.status, 200);
  const none = await api('POST', '/api/sync/beacons/mine/withdraw', {}, alice.cookie);
  assert.equal(none.status, 404, 'withdrawing with no active beacon is 404');
});

test('exact match: case and whitespace insensitive, creates an introduction', async () => {
  const a = await beacon(cara, { source: 'self_input', text: 'river' });
  assert.equal(a.status, 201);
  assert.equal(a.data.match, null);

  // Bob already carries 'ember' from the deck test; withdraw it first so the
  // 'River' input below is a clean second-beacon attempt for him.
  const wb = await api('POST', '/api/sync/beacons/mine/withdraw', {}, bob.cookie);
  assert.equal(wb.status, 200);

  const b = await beacon(dan, { source: 'self_input', text: 'River ' });
  assert.equal(b.status, 201, JSON.stringify(b.data));
  assert.ok(b.data.match, 'exact normalized match proposed');
  assert.equal(b.data.match.sharedWord, 'river');
  assert.ok(b.data.match.introductionId, 'match links an introduction');
  const intro = b.data.match.introduction;
  assert.ok(intro.note.includes("You both carried 'river' this week."),
    `introduction note carries the shared-beacon reason: ${intro.note}`);
  // The LATER beacon holder (dan, whose creation triggered the match) is
  // the requester; the earlier holder (cara) is the proposed side.
  assert.equal(intro.requesterId, dan.id);
  assert.equal(intro.proposedId, cara.id);

  // Both beacons are now 'matched'.
  const caraMine = await api('GET', '/api/sync/beacons/mine', undefined, cara.cookie);
  const danMine = await api('GET', '/api/sync/beacons/mine', undefined, dan.cookie);
  assert.equal(caraMine.data.beacons[0].status, 'matched');
  assert.equal(danMine.data.beacons[0].status, 'matched');

  // BOTH members see the proposal in their normal introductions list.
  for (const m of [cara, dan]) {
    const list = await api('GET', '/api/introductions', undefined, m.cookie);
    const found = (list.data.introductions || []).find((i) => i.id === intro.id);
    assert.ok(found, `${m === cara ? 'cara' : 'dan'} sees the proposal in Requests`);
    assert.ok(found.note.includes("You both carried 'river' this week."));
  }

  // And in their beacon matches.
  const dm = await api('GET', '/api/sync/matches/mine', undefined, dan.cookie);
  assert.equal(dm.data.matches.length, 1);
  assert.equal(dm.data.matches[0].status, 'proposed');
  assert.equal(dm.data.matches[0].sharedWord, 'river');
  assert.equal(dm.data.matches[0].otherProfileId, cara.id);
});

test('accepting the introduction marks the beacon match accepted', async () => {
  const list = await api('GET', '/api/introductions', undefined, cara.cookie);
  const intro = list.data.introductions.find((i) => i.note.includes("You both carried 'river' this week."));
  assert.ok(intro, 'cara has the synchronicity proposal');
  // Only the proposed (recipient) side may respond.
  const r = await api('POST', `/api/introductions/${intro.id}/respond`, { response: 'accepted' }, cara.cookie);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const dm = await api('GET', '/api/sync/matches/mine', undefined, dan.cookie);
  assert.equal(dm.data.matches[0].status, 'accepted', 'match follows the introduction lifecycle');
});

test('no match for different words', async () => {
  const e = await beacon(erin, { source: 'self_input', text: 'summit' });
  assert.equal(e.status, 201);
  const f = await beacon(finn, { source: 'self_input', text: 'valley' });
  assert.equal(f.status, 201);
  assert.equal(f.data.match, null);
  assert.equal(f.data.beacon.status, 'active');
});

test('expired beacons do not match', async () => {
  const g = await beacon(gail, { source: 'self_input', text: 'flint' });
  assert.equal(g.status, 201);
  // Backdate gail's beacon past expiry.
  db.prepare('UPDATE beacons SET expires_at = ? WHERE id = ?')
    .run(new Date(Date.now() - 1000).toISOString(), g.data.beacon.id);
  const h = await beacon(hank, { source: 'self_input', text: 'flint' });
  assert.equal(h.status, 201, JSON.stringify(h.data));
  assert.equal(h.data.match, null, 'the expired beacon is not matchable');
  assert.equal(h.data.beacon.status, 'active');
  // Lazy expiry: gail's beacon now reads as expired and no longer blocks her.
  const gm = await api('GET', '/api/sync/beacons/mine', undefined, gail.cookie);
  assert.equal(gm.data.beacons[0].status, 'expired');
  const g2 = await beacon(gail, { source: 'self_input', text: 'flint' });
  assert.equal(g2.status, 201, 'an expired beacon does not block carrying a new one');
});

test('blocked pair does not match', async () => {
  dbApi.addBlock(ivy.id, jay.id);
  const i = await beacon(ivy, { source: 'self_input', text: 'granite' });
  assert.equal(i.status, 201);
  const j = await beacon(jay, { source: 'self_input', text: 'granite' });
  assert.equal(j.status, 201, JSON.stringify(j.data));
  assert.equal(j.data.match, null, 'a block between the pair prevents the proposal');
  assert.equal(j.data.beacon.status, 'active');
});

test('decline-blocked pair does not match', async () => {
  dbApi.recordDeclineBlock(kim.id, leo.id);
  const k = await beacon(kim, { source: 'self_input', text: 'zephyr' });
  assert.equal(k.status, 201);
  const l = await beacon(leo, { source: 'self_input', text: 'zephyr' });
  assert.equal(l.status, 201, JSON.stringify(l.data));
  assert.equal(l.data.match, null, 'a durable decline block prevents the proposal');
  assert.equal(l.data.beacon.status, 'active');
});

test('beacon text with a URL is rejected with a plain message', async () => {
  const r = await beacon(erin, { source: 'self_input', text: 'visit https://example.com now' });
  assert.equal(r.status, 400);
  const textErr = (r.data.error.details || []).find((e) => e.field === 'text');
  assert.ok(textErr, 'the text field carries the rejection');
  assert.ok(textErr.message.toLowerCase().includes('links'),
    `plain explanation, no jargon: ${textErr.message}`);
  const email = await beacon(erin, { source: 'self_input', text: 'reach me at a@b.com' });
  assert.equal(email.status, 400);
  const phone = await beacon(erin, { source: 'self_input', text: 'call 5551234567' });
  assert.equal(phone.status, 400);
});

test('beacons are private: no endpoint leaks another member\u2019s beacon text', async () => {
  // Erin already carries 'summit' (unmatched). Finn must not see it.
  const finnMine = await api('GET', '/api/sync/beacons/mine', undefined, finn.cookie);
  assert.ok(finnMine.data.beacons.every((b) => b.text !== 'summit'),
    'mine lists only the caller\u2019s own beacons');
  const finnMatches = await api('GET', '/api/sync/matches/mine', undefined, finn.cookie);
  assert.equal(finnMatches.data.matches.length, 0, 'no matches, nothing revealed');
  const deck = await api('GET', '/api/sync/deck', undefined, finn.cookie);
  assert.ok(!JSON.stringify(deck.data).includes('summit'), 'the deck carries no member text');
  // After a match, the counterpart sees the word only inside the
  // introduction note (the proposal stage), never as a raw beacon row.
  const cm = await api('GET', '/api/sync/matches/mine', undefined, cara.cookie);
  assert.equal(cm.data.matches[0].sharedWord, 'river');
  assert.ok(!('text' in cm.data.matches[0]), 'no raw beacon text on the match row');
});

test('validation: source, text, cardId, intentionType', async () => {
  const bad = await beacon(alice, { source: 'telepathy', text: 'x' });
  assert.equal(bad.status, 400);
  const empty = await beacon(alice, { source: 'self_input', text: '   ' });
  assert.equal(empty.status, 400);
  const long = await beacon(alice, { source: 'self_input', text: 'x'.repeat(61) });
  assert.equal(long.status, 400);
  const noCard = await beacon(alice, { source: 'deck_draw', cardId: 'nope' });
  assert.equal(noCard.status, 400);
  const badInt = await beacon(alice, { source: 'self_input', text: 'okword', intentionType: 'dating' });
  assert.equal(badInt.status, 400);
  // Beta cookie only, no profile token: token-bound identity rejects with 401.
  const betaOnly = alice.cookie.split(';')[0];
  const noAuth = await api('POST', '/api/sync/beacons', { source: 'self_input', text: 'x' }, betaOnly);
  assert.equal(noAuth.status, 401);
});

test('sweep: host-only expiry pass', async () => {
  const m = await createMember('Sync Mia', uniqueEmail('mia'));
  const b = await beacon(m, { source: 'self_input', text: 'dandelion' });
  assert.equal(b.status, 201);
  db.prepare('UPDATE beacons SET expires_at = ? WHERE id = ?')
    .run(new Date(Date.now() - 1000).toISOString(), b.data.beacon.id);

  const nonHost = await api('POST', '/api/sync/sweep', {}, alice.cookie);
  assert.equal(nonHost.status, 403, 'sweep is host-only');

  const swept = await api('POST', '/api/sync/sweep', {}, host.cookie);
  assert.equal(swept.status, 200);
  assert.ok(swept.data.swept.beaconsExpired >= 1, 'stale beacons marked expired');
  const mine = await api('GET', '/api/sync/beacons/mine', undefined, m.cookie);
  assert.equal(mine.data.beacons[0].status, 'expired');
});

test('deck copy audit: no banned phrases', async () => {
  assert.ok(SYNC_DECK.length >= 40, `starter deck has ${SYNC_DECK.length} cards`);
  const ids = new Set();
  const BANNED = [
    'destined', 'meant to meet', 'sign from the universe', 'universe says',
    'your reading', 'you will', 'love is coming', 'new love', 'from beyond',
    'spirit guide', 'afterlife', 'telepath', 'predict', 'meant to be', 'fate',
    '\u2014', // no em dashes in user-facing copy
  ];
  for (const card of SYNC_DECK) {
    assert.ok(card.id && !ids.has(card.id), `unique card id: ${card.id}`);
    ids.add(card.id);
    assert.ok(card.word.length >= 2 && card.word.length <= 20, `word length sane: ${card.word}`);
    assert.ok(card.prompt.length >= 10 && card.prompt.length <= 140, `prompt length sane: ${card.id}`);
    const hay = `${card.word} ${card.prompt}`.toLowerCase();
    for (const phrase of BANNED) {
      assert.ok(!hay.includes(phrase),
        `deck card "${card.id}" contains banned phrase "${phrase}"`);
    }
    // Prompts are open questions, never pronouncements.
    assert.ok(card.prompt.trim().endsWith('?'), `prompt is a question: ${card.id}`);
  }
});
