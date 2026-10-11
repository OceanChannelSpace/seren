// SEREN Braid Prototype — Phase 2 (Kevin's recipe, lightweight)
// Interactive text-braid session against CORE_MEMORY_V1.md + Orpheus stance.
//
// Usage:
//   node braid.js "your message here" [--model qwen3:8b] [--provider ollama|together]
// Sessions are appended to ./sessions/ as JSONL.

import { appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSystemPrompt, chatWith } from './braid-lib.js';

const sessionsDir = join(dirname(fileURLToPath(import.meta.url)), 'sessions');

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const provider = process.argv.includes('--provider=together') ? 'together'
    : process.argv.includes('--provider=ollama') ? 'ollama'
    : (process.env.TOGETHER_API_KEY ? 'together' : 'ollama');
  const modelFlag = process.argv.find((a) => a.startsWith('--model='));
  const model = modelFlag ? modelFlag.slice(8) : (provider === 'together' ? 'Qwen/Qwen3-8B' : 'qwen3:8b');
  const message = args.join(' ').trim() || 'Hello — who are you, and how does this work?';

  const system = buildSystemPrompt();
  console.log(`[braid] provider=${provider} model=${model}\n`);
  const reply = await chatWith(provider, model, system, message);
  console.log(`you: ${message}\n\nseren: ${reply}\n`);

  mkdirSync(sessionsDir, { recursive: true });
  appendFileSync(join(sessionsDir, 'braid-sessions.jsonl'), JSON.stringify({
    at: new Date().toISOString(), provider, model,
    systemPromptChars: system.length, user: message, assistant: reply,
  }) + '\n');
  console.log(`[braid] session logged to braid/sessions/braid-sessions.jsonl`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
