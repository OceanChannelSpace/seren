// SEREN MVP — honest empty-suggestions messaging tests.
// The guide must never promise suggestion cards that are not actually shown.
// This file covers the EMPTY case: the isolated DB holds exactly one profile,
// so no candidates can exist and proposals are always []. (The non-empty case
// lives in matched-suggestions.test.js.) Isolated temp DB, SEED_DEMO=false.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const dir = mkdtempSync(join(tmpdir(), 'seren-empty-sugg-'));
process.env.DB_PATH = join(dir, 'empty-suggestions.db');
process.env.SEED_DEMO = 'false';

// Dynamic import so DB_PATH / SEED_DEMO are honored at module load time.
const { app, db } = await import('../src/server.js');
const { proposalsStageText, NO_SUGGESTIONS_TEXT } = await import('../src/chat.js');

const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const BASE = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try { db.close(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true });
});

// ---------- helpers ----------

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

function msgText(m) {
  return String(m?.text ?? m?.body ?? m?.content ?? '');
}

// ---------- unit: proposalsStageText ----------

test('proposalsStageText(true) points at the cards above', () => {
  const t = proposalsStageText(true);
  assert.ok(/just above/i.test(t), `should reference the cards: ${t}`);
  assert.ok(/request introduction/i.test(t), `should mention requesting: ${t}`);
});

test('proposalsStageText(false) never promises cards', () => {
  const t = proposalsStageText(false);
  assert.ok(!/just above/i.test(t), `must not reference cards above: ${t}`);
  assert.ok(!/here are your.*suggestions/i.test(t), `must not promise suggestions: ${t}`);
  assert.ok(t.includes(NO_SUGGESTIONS_TEXT), `should carry the honest empty line: ${t}`);
});

// ---------- HTTP: one profile in the DB → proposals are always empty ----------

test('chat start: active brief, zero candidates → honest welcome, no phantom suggestions', async () => {
  const { status: cs, json: cj, setCookie } = await api('POST', '/api/profiles', {
    name: 'Lonely Lou',
    email: 'lonelylou@example.com',
    interests: ['meditation'],
    intention: 'I want a meditation practice partner to sit with weekly.',
    connectionPrefs: { seeking: ['practice-partner'], availability: 'Evenings' },
    consents: { introductions: true, community_visible: true, ai_matching: true },
    practices: ['meditation'],
    intentions: ['meditation-partner'],
    prefs: { localRemote: 'either', formats: ['message', 'video'], languages: ['English'] },
  });
  assert.equal(cs, 201, `fixture profile creation should succeed: ${JSON.stringify(cj)}`);
  const me = { ...cj, _auth: sessionCookie(setCookie) };

  const now = new Date().toISOString();
  db.prepare(`INSERT INTO briefs
    (profile_id, who_text, intention_text, good_fit_text, offer_text, logistics_text,
     boundaries_text, private_notes, shared_text, consent_save, consent_share, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      me.id,
      'Lonely Lou',
      'I want a meditation practice partner to sit with weekly.',
      'A calm and consistent meditation peer.',
      'I can offer steady presence and weekly sits.',
      'Weekday evenings, video or in person.',
      'Keep it gentle and secular.',
      '',
      'Lonely Lou is open to a calm meditation practice partner.',
      1, 1, 'active', now, now,
    );

  const { status, json } = await api('POST', '/api/chat/start', {}, me);
  assert.ok([200, 201].includes(status), `chat start failed: ${JSON.stringify(json)}`);
  assert.equal(json.session.stage, 'proposals');
  assert.ok(Array.isArray(json.proposals) && json.proposals.length === 0,
    'proposals should be empty when no candidates exist');
  const text = json.messages.map(msgText).join('\n');
  assert.ok(!/here are your current suggestions/i.test(text),
    `must not promise suggestions when none exist: ${text}`);
  assert.ok(text.includes(NO_SUGGESTIONS_TEXT),
    `welcome should say plainly that nothing fits: ${text}`);

  // Same session, proposals stage: any follow-up message must stay honest too.
  const r2 = await api('POST', '/api/chat/message', { sessionId: json.session.id, text: 'anything at all' }, me);
  assert.equal(r2.status, 200, JSON.stringify(r2.json));
  const text2 = r2.json.messages.map(msgText).join('\n');
  assert.ok(!/just above/i.test(text2),
    `must not point at cards above when none exist: ${text2}`);
  assert.ok(text2.includes(NO_SUGGESTIONS_TEXT),
    `proposals-stage reply should say plainly that nothing fits: ${text2}`);
});
