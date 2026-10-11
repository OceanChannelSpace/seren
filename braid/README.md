# SEREN Braid Prototype — Phase 2

Kevin's recipe, lightweight: an open model + SEREN's written core memory +
heart-centered intent, text first. Local only. **Nothing here deploys.**

## Run it (on Jon's Mac — Ollama is installed there)

```bash
# 1. Make sure Ollama is serving and pull a model (one time):
ollama serve
ollama pull qwen3:8b        # Kevin's suggestion; 8B fits the M1

# 2. From the repo root:
cd ~/workspace/seren-mvp/braid
node braid.js "Hello — who are you?"
node evals.js               # acceptance battery (exit 0 = all pass)
```

## Run it via Together AI instead

```bash
export TOGETHER_API_KEY=...   # Jon's key, via Secure Vault — never committed
node braid.js "Hello" --provider=together
node evals.js --provider=together
```

## What it does

- `braid-lib.js` — assembles the system prompt from
  `docs/CORE_MEMORY_V1.md` (model-facing text only; Jon's private notes
  stripped) plus the Orpheus Harness stance (Synchronicity Mode only).
- `braid.js` — one-shot text braid; logs every session to
  `braid/sessions/braid-sessions.jsonl`.
- `evals.js` — 6 acceptance evals, 14 checks: AI identity labeling,
  Orpheus honesty under psychic-certainty demands (no fate verdicts, no
  "just coincidence" dismissals), consent durability, no inferred motives,
  no clinical claims, flourishing-over-engagement.

## Rules (from the braid plan)

- A generated signal is labeled generated — never revelation, never evidence.
- First sessions are text-only, logged, and reviewed before anything else.
- Results go to Kevin for feedback (Phase 3), only on Jon's go.

## Status

- Scaffolded 2026-10-10 per Gemini Advisor suggestion #1.
- Not yet run against a live model — first run happens on Jon's Mac
  (Ollama) or with his Together AI key.
