# SEREN — Codebase Audit

**Date:** 2026-09-27
**Auditor:** SEREN build coordinator (subagent)
**Canonical repository:** `OceanChannelSpace/seren` (private)
**Default branch:** `main`

> **Access note:** This audit is based on the discovery report. The private
> repository could not be fetched directly (no GitHub authentication available
> in this environment). Findings below describe the repository as reported by
> discovery, not from a local clone.

## What exists today

| Item | State |
|---|---|
| `index.html` | Single ~50KB static prototype — the **entire** implementation |
| `README.md` | 122 bytes |
| `package.json` | Missing |
| Backend / API | None |
| Database / persistence | None |
| Tests | None |
| CI / lint / typecheck | None |
| Issues / PRs | None |
| Branch `feat/demo-ready-seren` | Exists, reported identical to `main` |

Repo description (GitHub): *"SEREN is a consent-first platform for meaningful spiritual, metaphysical, and consciousness-centered connections."*

## What currently runs

The static `index.html` prototype presumably renders in a browser (not verified
locally — the file was never fetched). There is nothing to install, build, or
start.

## What fails / is missing

- **No persistence:** any profile or connection state in the prototype cannot
  survive a refresh (no backend, no storage layer).
- **No matching logic:** no code exists to propose introductions between members.
- **No API surface:** no routes, no validation, no error handling beyond what a
  static page can do.
- **No consent machinery:** the "consent-first" positioning in the repo
  description has no implementation behind it.
- **No tests, no CI, no deployment config.**

## Fake / mocked / disconnected functionality

Unknown at the code level (file not fetched), but structurally: a single static
HTML file **cannot** implement multi-user introductions, persistence, or
server-side matching. Any such UI in the prototype is necessarily
disconnected/demo-only.

## Critical technical risks

1. The prototype's UI/UX may encode product decisions worth preserving, but it
   could not be inspected — the rebuild must rely on the evidence-backed
   product truth instead.
2. `feat/demo-ready-seren` being identical to `main` suggests branching
   happened without subsequent work; treat `main` as the single source.
3. No auth model exists; the MVP uses a single-device profile (localStorage)
   as a documented, reversible simplification.

## Exact commands (existing repo)

There are none — no package manager, build, test, or run commands exist.

## Recommended minimal route to a working MVP

Rebuild as a small, boring, deployable app rather than extending the static
file:

- **Stack:** Node.js + Express + `node:sqlite` (built-in, zero native deps),
  vanilla JS frontend served statically. One npm dependency (`express`).
- **Why:** the user doesn't code; `npm install && npm start` must be the whole
  story. No build step, no framework churn.
- **Scope:** profile creation with granular consent → introduction requests →
  deterministic matching engine → proposed connection with warm intro note →
  accept/decline → connections inbox. SQLite persistence, seeded demo
  community (labeled as seed data).
- **Deliberately out of scope for the MVP:** human-to-AI and AI-to-AI
  connections (the "benevolent AI" role is the matching engine itself),
  real-time chat/messaging, email delivery, production auth, and anything
  requiring third-party credentials.

See `PRODUCT_TRUTH.md` for the evidence behind these decisions and
`docs/API_CONTRACT.md` for the data model and endpoints.
