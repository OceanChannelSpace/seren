# SEREN — MVP

**SEREN** (short for *Serendipity*) is a consent-first platform for meaningful
spiritual, metaphysical, and consciousness-centered connections — real
introductions between aligned people, guided by intention.

This MVP implements the core loop: create a spiritual profile with explicit
granular consent → request an introduction around an intention → receive a
proposed connection with a warm intro note → accept or decline → manage
connections in an inbox. Everything persists in SQLite.

See [PRODUCT_TRUTH.md](PRODUCT_TRUTH.md) for the evidence-backed product
definition (with assumptions marked) and
[docs/CODEBASE_AUDIT.md](docs/CODEBASE_AUDIT.md) for the audit of the original
static prototype this replaces.

## Quick start

Prerequisites: **Node.js 22+** (uses the built-in `node:sqlite` — no native
build tools needed).

```bash
cd seren-mvp
npm install     # installs express, the only dependency
npm start       # starts on http://localhost:3000
```

Open **http://localhost:3000** in a browser. On first boot the database is
created and seeded with 6 labeled demo community members so the matching loop
works immediately.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port the web server listens on |
| `DB_PATH` | `./data/seren.db` | SQLite database file location |
| `SEED_DEMO` | `true` | Seed the demo community on first DB creation (`"false"` disables) |
| `BETA_CODE` | _(empty)_ | Private beta invite code. When set, visitors must enter the code once before the API serves any data. Leave empty for open access. |

Copy `.env.example` to `.env` to customize (optional — every variable has a
default). There are no secrets in this application.

## Private beta

Set `BETA_CODE` to any string (e.g. in your hosting provider's environment
variables) to put SEREN behind a beta invite code. Visitors see a code-entry
screen; entering the code sets a long-lived `HttpOnly` cookie and unlocks the
app. The health check (`/api/health`) stays open so hosting platforms can
probe it. For a network-only beta, share the deploy URL together with the
code — nothing else is needed.

## Primary user flow

1. **Land** (`#/`): read what SEREN is and how it works → "Begin your journey".
2. **Profile** (`#/`profile): enter name, email, pick spiritual interests,
   write an intention statement, set connection preferences, and toggle three
   explicit consents (introductions, community visibility, AI matching).
   Introductions consent is required — nothing happens without your clear yes.
3. **Connect** (`#/`connect): request an introduction around your intention.
   The matching engine scores community members by shared interests and
   intention keywords, then proposes one connection with a warm intro note and
   a plain-English explanation of the match.
4. **Decide**: accept the connection, or decline and get the next-best match.
5. **Inbox** (`#/`inbox): connections grouped by Proposed / Accepted /
   Declined / Withdrawn, with withdraw on requests you sent.
6. **Refresh or restart** — everything persists in SQLite.

Your profile identity is kept in the browser's `localStorage`
(`seren_profile_id`); "Start over" in the header clears it.

## Architecture

```
seren-mvp/
├── src/
│   ├── server.js     # Express app: all /api routes, static frontend serving
│   ├── db.js         # node:sqlite setup, schema, helpers, demo seed
│   ├── match.js      # Pure matching engine (deterministic, explainable)
│   ├── validate.js   # Input validation (server-side source of truth)
│   └── constants.js  # Fixed interests, seeking options, stopwords, statuses
├── public/
│   ├── index.html    # App shell
│   ├── styles.css    # Light, high-vibrational design (creams, golds, serif)
│   └── app.js        # Vanilla JS hash router + views + API client
├── tests/            # node:test suite (no extra dependencies)
├── docs/
│   ├── API_CONTRACT.md    # Binding data model + endpoint spec
│   └── CODEBASE_AUDIT.md  # Audit of the original prototype
├── PRODUCT_TRUTH.md  # Evidence-backed product definition
└── README.md
```

**Stack choices (deliberately boring):** Node.js + Express + `node:sqlite`
(built into Node 22+, zero native dependencies), vanilla JS frontend with no
build step. One npm dependency total. `npm install && npm start` is the whole
story — important because the maintainer doesn't code.

**Matching:** deterministic and explainable —
`score = 2 × shared interests + 1 × shared intention keywords`. Only members
who consented to community visibility are eligible; existing non-withdrawn
pairs are never re-proposed. In the MVP the "benevolent AI" role is this
matching/introduction engine itself; human-to-AI and AI-to-AI connections are
future work (see PRODUCT_TRUTH.md).

**API:** full endpoint reference in [docs/API_CONTRACT.md](docs/API_CONTRACT.md).
Errors use `{"error":{"code","message"}}`; validation failures include a
`details` array.

## Testing

```bash
npm test   # node --test, 36 tests: matching unit tests, API tests, full journey
```

The journey test boots real `node src/server.js` child processes, creates a
profile, requests + accepts an introduction, kills the server, restarts it on
the same database file, and verifies everything persisted.

## Demo seed data

The 6 seed members (Maya, Elena, Kai, Luna, River, Amara) are clearly labeled
"Demo seed" in the UI and carry `is_seed = 1` in the database. Set
`SEED_DEMO=false` for a clean database.

## Status & gaps

Working MVP on branch `seren/mvp-working-build`. Known simplifications and
open questions are documented in [PRODUCT_TRUTH.md](PRODUCT_TRUTH.md):
notably, **SARA** ("a friend for SARA") is undefined and unbuilt; there is no
multi-user auth (single-device profile); no messaging, email, or real AI
participants yet. **Not pushed to GitHub** — write access is pending; push and
open the PR when credentials are available.
