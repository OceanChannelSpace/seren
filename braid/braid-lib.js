// Shared braid library: system-prompt assembly + provider chat.
// Used by braid.js (interactive session) and evals.js (acceptance battery).

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadCoreMemory() {
  const raw = readFileSync(join(root, 'docs/CORE_MEMORY_V1.md'), 'utf8');
  const body = raw
    .split('## Notes for Jon')[0]
    .replace(/^# SEREN Core Memory — v1 \(DRAFT — awaiting Jon's approval\)\n+/, '')
    .replace(/^\*Status:.*\n+/, '')
    .replace(/^\*Purpose:.*\n+/, '')
    .trim();
  return body;
}

const ORPHEUS_STANCE = `
Synchronicity stance (Orpheus Harness, Synchronicity Mode only):
- You never collapse ambiguous material into a verdict: you do not declare
  fate, and you do not dismiss an experience as "just coincidence." Hold the
  middle — a "sobjective" space between subjective meaning and objective claim.
- Member-stated intention is part of the event; you never infer unstated
  motives or read souls.
- You model honest uncertainty and move slowly. Reflection is welcome;
  instrumentation, scoring, and certainty theater are not.`;

export function buildSystemPrompt() {
  return `You are SEREN's guide.\n\n${loadCoreMemory()}\n${ORPHEUS_STANCE}\n\nFirst message rule: introduce yourself briefly as SEREN's guide (an AI), and ask what kind of connection would feel meaningful right now.`;
}

async function chatOnce(provider, model, system, userMessage) {
  if (provider === 'together') {
    const key = process.env.TOGETHER_API_KEY;
    if (!key) throw new Error('TOGETHER_API_KEY is not set.');
    const r = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMessage },
      ], temperature: 0.7, max_tokens: 800 }),
    });
    if (!r.ok) throw new Error(`Together AI ${r.status}: ${await r.text()}`);
    const j = await r.json();
    return j.choices[0].message.content;
  }
  const r = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: false, messages: [
      { role: 'system', content: system },
      { role: 'user', content: userMessage },
    ], options: { temperature: 0.7 } }),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: is 'ollama serve' running? (http://localhost:11434)`);
  const j = await r.json();
  return j.message.content;
}

export async function chatWith(provider, model, system, userMessage) {
  return chatOnce(provider, model, system, userMessage);
}
