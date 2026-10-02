// SEREN MVP — Human Mode tests.
// A member asks a real host to suggest a connection. The host's proposal
// creates an introduction through the existing staged mutual-consent
// machinery — no new consent model. Spins up the real express app on an
// ephemeral port with an isolated temp SQLite DB (SEED_DEMO=false),
// BETA_CODE and SEREN_HOSTS set.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const dir = mkdtempSync(join(tmpdir(), 'seren-human-'));
process.env.DB_PATH = join(dir, 'human-test.db');
process.env.SEED_DEMO = 'false';
process.env.BETA_CODE = 'human-test-beta-code';
process.env.SEREN_HOSTS = 'host@example.com';

const { app, db } = await import('../src/server.js');

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
const uniqueEmail = (base = 'hmtester') => `${base}${++emailSeq}@example.com`;

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
    body: JSON.stringify({ code: 'human-test-beta-code' }),
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

// ---------- fixtures ----------

const host = await createMember('Human Host', 'host@example.com');
const alice = await createMember('Ask Alice', uniqueEmail('alice'));
const bob = await createMember('Suggest Bob', uniqueEmail('bob'));
const carol = await createMember('Decline Carol', uniqueEmail('carol'));

const REQUEST_TEXT = 'I am hoping to meet someone who also journals at dawn, and to understand why I keep waking at 4am with new ideas.';

// ---------- member flow ----------

test('member creates an assist request', async () => {
  const r = await api('POST', '/api/host-assists', { requestText: REQUEST_TEXT }, alice.cookie);
  assert.equal(r.status, 201);
  assert.equal(r.data.assist.requestText, REQUEST_TEXT);
  assert.equal(r.data.assist.status, 'open');
  assert.equal(r.data.assist.profileId, alice.id);
  assert.ok(r.data.assist.createdAt);
});

test('a second open request is rejected while one is open', async () => {
  const r = await api('POST', '/api/host-assists', { requestText: 'Another request.' }, alice.cookie);
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'conflict_state');
});

test('member lists their own requests (only their own)', async () => {
  const bobs = await api('POST', '/api/host-assists', { requestText: 'Bob also asks.' }, bob.cookie);
  assert.equal(bobs.status, 201);

  const mine = await api('GET', '/api/host-assists/mine', undefined, alice.cookie);
  assert.equal(mine.status, 200);
  const ids = (mine.data.assists || []).map((a) => a.id);
  assert.ok(ids.length >= 1, 'alice sees her own request');
  assert.ok(!ids.includes(bobs.data.assist.id), 'alice does not see bob\u2019s request');

  // Clean up so bob has no open request later.
  const w = await api('POST', `/api/host-assists/mine/${bobs.data.assist.id}/withdraw`, {}, bob.cookie);
  assert.equal(w.status, 200);
});

test('member withdraws their own open request', async () => {
  const mine = await api('GET', '/api/host-assists/mine', undefined, alice.cookie);
  const open = mine.data.assists.find((a) => a.status === 'open');
  assert.ok(open, 'alice has an open request to withdraw');

  const w = await api('POST', `/api/host-assists/mine/${open.id}/withdraw`, {}, alice.cookie);
  assert.equal(w.status, 200);
  assert.equal(w.data.assist.status, 'withdrawn');

  // Withdrawing twice is a 409.
  const w2 = await api('POST', `/api/host-assists/mine/${open.id}/withdraw`, {}, alice.cookie);
  assert.equal(w2.status, 409);
  assert.equal(w2.data.error.code, 'invalid_transition');

  // Another member's request is not found (never exposed).
  const w3 = await api('POST', `/api/host-assists/mine/${open.id}/withdraw`, {}, bob.cookie);
  assert.equal(w3.status, 404);

  // Withdrawing frees the member to ask again.
  const again = await api('POST', '/api/host-assists', { requestText: REQUEST_TEXT }, alice.cookie);
  assert.equal(again.status, 201);
});

test('request text validation: required and at most 1000 chars', async () => {
  const empty = await api('POST', '/api/host-assists', { requestText: '   ' }, bob.cookie);
  assert.equal(empty.status, 400);
  const long = await api('POST', '/api/host-assists', { requestText: 'x'.repeat(1001) }, bob.cookie);
  assert.equal(long.status, 400);
  const max = await api('POST', '/api/host-assists', { requestText: 'y'.repeat(1000) }, bob.cookie);
  assert.equal(max.status, 201);
  // Clean up: withdraw so bob has no open request.
  await api('POST', `/api/host-assists/mine/${max.data.assist.id}/withdraw`, {}, bob.cookie);
});

test('introductions consent is required to ask a host', async () => {
  const quiet = await createMember('Quiet Quinn', uniqueEmail('quinn'));
  const upd = await api('PATCH', `/api/profiles/${quiet.id}`, {
    consents: { introductions: false, community_visible: true, ai_matching: true },
  }, quiet.cookie);
  assert.equal(upd.status, 200);
  const r = await api('POST', '/api/host-assists', { requestText: 'Please help.' }, quiet.cookie);
  assert.equal(r.status, 403);
  assert.equal(r.data.error.code, 'consent_required');
});

// ---------- host queue ----------

test('non-host gets 403 on the assist queue', async () => {
  const r = await api('GET', '/api/host-assists', undefined, alice.cookie);
  assert.equal(r.status, 403);
  assert.equal(r.data.error.code, 'forbidden');
});

test('non-host gets 403 on propose', async () => {
  const r = await api('POST', '/api/host-assists/1/propose', { suggestedId: bob.id }, alice.cookie);
  assert.equal(r.status, 403);
  assert.equal(r.data.error.code, 'forbidden');
});

test('unauthenticated requests are rejected', async () => {
  const r = await api('GET', '/api/host-assists');
  assert.equal(r.status, 403); // outer beta gate
  assert.equal(r.data.error.code, 'beta_required');

  const r2 = await api('GET', '/api/host-assists', undefined, alice.beta);
  assert.equal(r2.status, 401); // beta cookie, no profile token

  const r3 = await api('POST', '/api/host-assists', { requestText: 'Hi.' }, alice.beta);
  assert.equal(r3.status, 401);
});

test('host lists open requests with asker details', async () => {
  const r = await api('GET', '/api/host-assists', undefined, host.cookie);
  assert.equal(r.status, 200);
  const found = r.data.assists.find((a) => a.profileId === alice.id);
  assert.ok(found, 'host sees alice\u2019s open request');
  assert.equal(found.askerName, 'Ask Alice');
  assert.equal(found.requestText, REQUEST_TEXT);
  assert.equal(found.status, 'open');
  assert.ok(found.createdAt);
  // Withdrawn requests are not in the queue.
  assert.ok(!r.data.assists.some((a) => a.status === 'withdrawn'), 'only open requests listed');
});

// ---------- propose -> normal staged-consent flow ----------

test('host proposes: introduction created with requester=asker, status proposed', async () => {
  const queue = await api('GET', '/api/host-assists', undefined, host.cookie);
  const assist = queue.data.assists.find((a) => a.profileId === alice.id);
  assert.ok(assist, 'alice has an open request to propose on');

  const p = await api('POST', `/api/host-assists/${assist.id}/propose`,
    { suggestedId: bob.id, hostNote: 'Bob journals at dawn too.' }, host.cookie);
  assert.equal(p.status, 201);
  assert.equal(p.data.assist.status, 'proposed');

  const intro = p.data.introduction;
  assert.equal(intro.requesterId, alice.id);
  assert.equal(intro.proposedId, bob.id);
  assert.equal(intro.status, 'proposed');
  assert.ok(intro.note.includes('Bob journals at dawn too.'), 'host note lands on the introduction');
  assert.ok(intro.note.includes('person, not an algorithm'), 'note is honest about provenance');

  // The suggested member sees it in their normal queue.
  const bobs = await api('GET', '/api/introductions', undefined, bob.cookie);
  assert.equal(bobs.status, 200);
  assert.ok(bobs.data.introductions.some((i) => i.id === intro.id));
});

test('suggested member accepts through the normal flow', async () => {
  const bobs = await api('GET', '/api/introductions', undefined, bob.cookie);
  const intro = bobs.data.introductions.find((i) => i.requesterId === alice.id && i.status === 'proposed');
  assert.ok(intro, 'proposed introduction waiting for bob');
  const a = await api('POST', `/api/introductions/${intro.id}/accept`, {}, bob.cookie);
  assert.equal(a.status, 200);
  assert.equal(a.data.status, 'accepted');
});

test('proposing on a non-open assist is rejected', async () => {
  const queue = await api('GET', '/api/host-assists', undefined, host.cookie);
  // Alice's only open request was just proposed; the queue should be empty of it.
  assert.ok(!queue.data.assists.some((a) => a.profileId === alice.id), 'no open request left for alice');

  // Propose against the already-proposed assist row anyway: look it up directly.
  const mine = await api('GET', '/api/host-assists/mine', undefined, alice.cookie);
  const proposed = mine.data.assists.find((a) => a.status === 'proposed');
  assert.ok(proposed, 'alice has a proposed assist');
  const p = await api('POST', `/api/host-assists/${proposed.id}/propose`, { suggestedId: bob.id }, host.cookie);
  assert.equal(p.status, 409);
});

test('propose with a bogus suggestedId is 404', async () => {
  // Carol has no block history with anyone; keep alice out of it: use carol's own assist.
  const c = await api('POST', '/api/host-assists', { requestText: 'Carol asks for help too.' }, carol.cookie);
  assert.equal(c.status, 201);
  const p = await api('POST', `/api/host-assists/${c.data.assist.id}/propose`, { suggestedId: 99999 }, host.cookie);
  assert.equal(p.status, 404);
  // The request stays open after the failed proposal.
  const q = await api('GET', '/api/host-assists/mine', undefined, carol.cookie);
  assert.equal(q.data.assists.find((a) => a.id === c.data.assist.id).status, 'open');
});

test('propose with the asker as the suggested member is rejected', async () => {
  const q = await api('GET', '/api/host-assists/mine', undefined, carol.cookie);
  const open = q.data.assists.find((a) => a.status === 'open');
  const p = await api('POST', `/api/host-assists/${open.id}/propose`, { suggestedId: carol.id }, host.cookie);
  assert.equal(p.status, 400);
});

test('propose to a member who previously declined the asker is 403 declined_previously', async () => {
  // Alice sends carol a direct request; carol declines (durable block).
  const req = await api('POST', '/api/connections/request', {
    targetId: carol.id,
    connectionType: 'practice-partner',
    message: 'I would love to connect and practice together sometime soon.',
  }, alice.cookie);
  assert.equal(req.status, 201);
  const d = await api('POST', `/api/introductions/${req.data.introduction.id}/decline`, {}, carol.cookie);
  assert.equal(d.status, 200);

  // Alice asks again via Human Mode (her prior assist is 'proposed', so she may).
  const assist = await api('POST', '/api/host-assists', { requestText: 'Hoping to meet carol-type people.' }, alice.cookie);
  assert.equal(assist.status, 201);

  const p = await api('POST', `/api/host-assists/${assist.data.assist.id}/propose`, { suggestedId: carol.id }, host.cookie);
  assert.equal(p.status, 403);
  assert.equal(p.data.error.code, 'declined_previously');

  // The request stays open after the rejected proposal.
  const q = await api('GET', '/api/host-assists/mine', undefined, alice.cookie);
  assert.equal(q.data.assists.find((a) => a.id === assist.data.assist.id).status, 'open');
});
