// SEREN MVP — suggestions messaging when candidates DO exist.
// Companion to empty-suggestions.test.js: with matching candidates seeded,
// the guide should promise the suggestion cards. Isolated temp DB,
// SEED_DEMO=false. No score threshold exists in findMatches, so any
// consenting candidate appears in proposals.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const dir = mkdtempSync(join(tmpdir(), 'seren-matched-sugg-'));
process.env.DB_PATH = join(dir, 'matched-suggestions.db');
process.env.SEED_DEMO = 'false';

// Dynamic import so DB_PATH / SEED_DEMO are honored at module load time.
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
const uniqueEmail = () => `matchedsugg${++emailSeq}@example.com`;

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

async function createProfile(name) {
  const { status, json, setCookie } = await api('POST', '/api/profiles', {
    name,
    email: uniqueEmail(),
    interests: ['meditation'],
    intention: 'I want a meditation practice partner to sit with weekly.',
    connectionPrefs: { seeking: ['practice-partner'], availability: 'Evenings' },
    consents: { introductions: true, community_visible: true, ai_matching: true },
    practices: ['meditation'],
    intentions: ['meditation-partner'],
    prefs: { localRemote: 'either', formats: ['message', 'video'], languages: ['English'] },
  });
  assert.equal(status, 201, `fixture profile creation should succeed: ${JSON.stringify(json)}`);
  return { ...json, _auth: sessionCookie(setCookie) };
}

function msgText(m) {
  return String(m?.text ?? m?.body ?? m?.content ?? '');
}

/** Insert an active, share-approved brief directly (bypasses the guide flow). */
function insertBrief(profileId, name) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO briefs
    (profile_id, who_text, intention_text, good_fit_text, offer_text, logistics_text,
     boundaries_text, private_notes, shared_text, consent_save, consent_share, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      profileId,
      name,
      'I want a meditation practice partner to sit with weekly.',
      'A calm and consistent meditation peer.',
      'I can offer steady presence and weekly sits.',
      'Weekday evenings, video or in person.',
      'Keep it gentle and secular.',
      '',
      `${name} is open to a calm meditation practice partner.`,
      1, 1, 'active', now, now,
    );
}

/** Seed a matchable candidate: profile + active, share-approved brief. */
async function seedCandidate(name) {
  const p = await createProfile(name);
  insertBrief(p.id, name);
  return p;
}

// ---------- HTTP: candidates exist ----------

test('chat start: active brief with matching candidates → welcome promises suggestions', async () => {
  const me = await createProfile('Social Sam');
  await seedCandidate('Candace Gamma');
  await seedCandidate('Candace Delta');
  insertBrief(me.id, 'Social Sam');

  const { status, json } = await api('POST', '/api/chat/start', {}, me);
  assert.ok([200, 201].includes(status), `chat start failed: ${JSON.stringify(json)}`);
  assert.equal(json.session.stage, 'proposals');
  assert.ok(json.proposals.length > 0,
    `seeded matching candidates should yield proposals: ${JSON.stringify(json.proposals).slice(0, 300)}`);
  const text = json.messages.map(msgText).join('\n');
  assert.ok(/here are your current suggestions/i.test(text),
    `should promise suggestions when they exist: ${text}`);

  // Follow-up message in the proposals stage should point at the cards.
  const r2 = await api('POST', '/api/chat/message',
    { sessionId: json.session.id, text: 'what did you find?' }, me);
  assert.equal(r2.status, 200, JSON.stringify(r2.json));
  const text2 = r2.json.messages.map(msgText).join('\n');
  assert.ok(/just above/i.test(text2),
    `should point at the cards when they exist: ${text2}`);
});
