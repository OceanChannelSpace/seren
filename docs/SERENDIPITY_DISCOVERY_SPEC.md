# SEREN — Serendipity / Social Discovery Module

**Product specification + initial implementation plan**
**Date:** 2026-10-05
**Status:** Draft for Jon's review. Nothing here is approved for build until Jon signs off.

---

## 1. Context

SEREN is a consent-first relationship network for meaningful human, community, and agent connection (private beta). Stack: Node.js 22 + Express 4, SQLite (Railway volume), server-rendered UI, deterministic rule-based matching engine (`src/match.js`) that returns qualitative reasons, never numeric scores in UI. Trust & safety policies are codified in `docs/TRUST_AND_SAFETY.md`, with host triage, durable decline blocks, and self-service data deletion already shipped.

**What this module adds:** an opt-in discovery layer that helps members find compatible people, small circles, gatherings, and collaborators in the real world — based on shared interests, intentions, values, projects, and opt-in contextual signals.

**What this module is not:**
- Not a dating app. No swipe mechanics, no attractiveness signals, no romantic-intent matching.
- Not an engagement feed. No infinite scroll, no algorithmic addiction loops.
- Not a copy of any existing product. Mechanics may be studied; branding, UI, wording, and proprietary implementation must be original to SEREN.
- Not a replacement for the existing superconnector flow. Discovery feeds *into* the consent-first introduction system; it does not bypass it.

---

## 2. Product principles

1. **Consent-first, privacy-first, by default.** Everything discoverable is explicitly chosen by the member. Defaults are off, hidden, and minimal.
2. **Separate discovery identity.** The discovery profile is not the SEREN profile and never exposes chat history, memories, or private data.
3. **Explainable, never opaque.** Every suggestion carries human-readable reasons. No black-box scores, no "98% compatible" claims.
4. **Calm cadence.** A small number of high-intent suggestions on a slow rhythm (proposed: weekly), not a slot machine.
5. **Reversible and understandable.** Pause, hide, tune, export, delete — all one tap, all immediate, all explained in plain language.
6. **Quality over quantity.** Success is a meaningful conversation or collaboration, not matches per session.
7. **Safety is structural, not a feature.** Rate limits, durable declines, block/report, audit logging, and host moderation are in the data model from day one.

---

## 3. Discovery profile

### 3.1 Separation from the SEREN profile

A member's SEREN profile (identity, circles, introduction history) stays as-is. The **discovery profile** is a separate, optional layer:

- Created only when the member explicitly opts into discovery.
- Contains only what the member puts into it — structured signals and free-text prompts.
- Never auto-populated from chat history, check-ins, memories, or AI conversations (the AI may *suggest* draft content from conversation, but nothing is added without explicit per-field approval — see §8).

### 3.2 Structured signals

Members may fill any subset; every field is optional:

| Category | Examples |
|---|---|
| Interests | meditation, freediving, ocean conservation, AI safety, jazz |
| Skills (offering) | early-stage prototyping, facilitation, grant writing |
| Skills (seeking) | complement to offering — used for complementary matching |
| Causes | climate, contemplative education, open science |
| Creative pursuits | music production, spiritually themed animation |
| Professional goals | finding a technical cofounder, transitioning into research |
| Current projects | short title + one-line description + collaboration need |
| Collaboration needs | "looking for," "open to help with" |
| Conversation preferences | deep 1:1, small group, walking conversations, async |
| Availability | windows (e.g., "weekday evenings"), timezone |
| Social intentions | make friends, find collaborators, learn together, attend events |

### 3.3 Free-text prompts

- "I'm currently exploring…"
- "I'd love to meet someone who…"
- "A project or question I'm working on…"
- "The kind of conversation I enjoy…"

Free text is matched with the existing token-based engine first (transparent). A semantic embedding layer may be added later (see §5.4) with strict privacy handling.

### 3.4 Modes

One member may enable several modes; each mode has its own visibility and matching behavior:

`friends`, `collaborators`, `mentors`, `learning-partners`, `local-activities`, `creative-partners`, `research-partners`, `founders`, `wellness-partners`, `events`

Modes are the primary matching axis: a member in `collaborators` mode is matched against others in compatible modes, not against everyone.

### 3.5 Visibility controls

Every category of information gets its own control:

- **Discoverable:** on/off master switch (default: off).
- **Per-category visibility:** each signal category can be set to `hidden`, `matches-only` (visible after mutual interest), or `discoverable` (visible on suggestion cards).
- **Per-mode visibility:** e.g., discoverable as a collaborator but not for local activities.
- **Contact policy:** who may send a connection request — `mutual-only`, `any-discoverable-member`, `nobody` (browse-only).
- **Location:** off by default (§6).

All controls live on one screen, in plain language, with a live preview: "This is what a stranger would see."

---

## 4. Matching engine

### 4.1 Extend, don't replace

`src/match.js` already implements deterministic, explainable matching with qualitative reasons and no numeric scores in UI. The discovery engine builds on it:

**New match dimensions:**
1. **Shared interests** — token overlap on interests, causes, creative pursuits.
2. **Complementary skills** — A's "seeking" overlaps B's "offering" and/or vice versa. This is the highest-value signal for collaborator modes.
3. **Shared goals & project relevance** — overlap on professional goals; project descriptions matched against others' skills/interests.
4. **Communication style** — overlap on conversation preferences.
5. **Intention alignment** — mode compatibility matrix (e.g., `mentors` ↔ `learning-partners`, `founders` ↔ `collaborators`).
6. **Availability overlap** — shared windows/timezones (coarse: "weekday evenings ET").
7. **Geographic proximity** — only when both members have location discovery on; computed on approximate areas, never precise coordinates (§6).

### 4.2 Explainable reasons (required on every suggestion)

Every suggestion must include 1–3 human-readable reasons drawn from the actual match dimensions, e.g.:

- "Both exploring AI and consciousness research"
- "You're seeking product collaborators; they have early-stage AI prototyping experience"
- "Both interested in freediving and ocean conservation"

Reasons are generated from the same rule firings that produced the match — never invented by the AI layer. If the engine can't name a reason, the suggestion doesn't ship.

### 4.3 Discovery priority tuning

Members tune what matters most to them (ranked, not scored):

- Local proximity
- Professional collaboration
- Shared interests
- Diversity of perspectives (deliberately surfaces people *unlike* you on chosen axes)
- Event-based encounters
- Deep conversation

Tuning re-weights dimension priority in the rule engine. The UI shows the current tuning in plain words: "Prioritizing professional collaboration and shared interests."

### 4.4 Semantic layer (later, optional)

A vector-embedding layer over free-text prompts could improve match quality, but embeddings are effectively fingerprints of personal expression. Rules:

- Only with explicit separate opt-in ("improve my matches with AI understanding").
- Embeddings stored server-side only, never exposed via API, never logged.
- Member can delete embeddings independently of the rest of the discovery profile.
- The deterministic rule engine remains the baseline; semantic similarity is a tiebreaker, never the sole basis.

**Recommendation:** ship v1 without the semantic layer. Validate the rule engine first.

---

## 5. Privacy and safety architecture

### 5.1 Never exposed

The following are never part of discovery, in any form:

- Raw chat history or AI conversation content
- Memory/check-in content
- Embedding vectors (if the semantic layer ships)
- Exact home/work location or precise coordinates
- Contact information (email, phone, socials) — revealed only after mutual connection, and only what the member chooses
- Sensitive inferences (health, beliefs, orientation) — the system must not infer or display these

### 5.2 Location

- **Off by default.** Enabling requires a separate, explicit action.
- **Approximate only:** city or neighborhood level. No precise distance displayed ("within 2.3 miles" is banned; "in the Boston area" is allowed).
- **User-selectable radius:** e.g., 10 / 25 / 50 miles, or "same metro area."
- **Time-limited sharing:** "discoverable near me for the next 4 hours" for events/gatherings, auto-expiring. No persistent background location.
- Location is stored as a coarse geohash or metro-area label, never raw coordinates.

### 5.3 Member controls (all immediate, all reversible)

- Pause discovery (profile hidden from new suggestions, existing connections kept)
- Hide profile entirely
- Per-category and per-mode visibility (§3.5)
- Block / report a member (block also excludes them from all future matching)
- Remove a connection
- Delete all discovery data (profile, preferences, embeddings, match history)
- Export personal discovery data (machine-readable)

### 5.4 Consent flow for contact

1. A sends a connection request with an **intentional message** (required, minimum length, no empty "hi").
2. B sees: A's discovery-profile preview (per A's visibility settings), the match reasons, and the message.
3. B accepts or declines. **Decline is durable** — A cannot re-request (extends the existing durable-decline pattern).
4. Only on mutual accept does a conversation open.

### 5.5 Abuse prevention

- **Rate limits:** max 5 pending outgoing requests; max 10 new requests per week; cooldowns after declines.
- **No re-request after decline or block**, enforced at the data layer.
- **Spam detection:** identical copy-pasted intentional messages across many requests are flagged for host review.
- **Anti-stalking:** location-gated discovery cannot be combined with narrow filters to isolate one person; minimum anonymity thresholds on event/gathering attendee lists.
- **Impersonation:** discovery profiles are bound to verified SEREN identities; no duplicate discovery profiles per member.
- **Non-discrimination:** matching dimensions exclude protected characteristics; the diversity-of-perspectives tuning is opt-in and member-controlled.
- **Moderation:** reuses `docs/TRUST_AND_SAFETY.md` report categories and host triage. New report category: "discovery misuse" (unwanted contact, deceptive profile, location abuse).
- **Audit logging:** every suggestion generated, request sent/declined/accepted, block, report, and visibility change is logged with timestamps for host review. Members can see their own log.

---

## 6. Discovery experience

### Primary flows

1. **Onboarding into discovery** — separate from SEREN onboarding. Explains in plain language what becomes visible and to whom, with the live preview. Ends with an explicit "Turn on discovery" confirmation. Skippable forever.
2. **Editing settings & visibility** — one screen, per-category controls, live stranger-preview.
3. **Browse suggested people** — the weekly digest: max 3–5 suggestions, each with photo/name (per visibility), match reasons, shared modes. No infinite list; "that's everyone for this week."
4. **Browse local groups, gatherings, projects, events** — only when location is on; coarse areas; minimum attendee counts before listing.
5. **"Why this match?"** — tap any suggestion to see the full reason list and which of your signals fired.
6. **Send a connection request** — intentional message required; shows exactly what the recipient will see.
7. **Mutual connection → conversation** — opens in the existing chat UI; contact details shared only if the member adds them.
8. **AI-mediated introductions** — SEREN's AI may *propose* an introduction (with reasons), but sends nothing until **both** people consent. Either party can decline silently.
9. **Event/group-based discovery** — opt into a gathering's discovery window; see other opted-in attendees at coarse granularity; window auto-closes.
10. **Pause / hide / delete / report / block** — reachable within two taps from any discovery surface.

### Cadence

Weekly digest ("Your serendipity, this week") with 3–5 suggestions. Members can also open the discovery tab anytime, but it shows the same curated set — no refresh-to-gamble, no pull-to-refresh farming.

---

## 7. AI's role (helpful, never invasive)

The AI assists discovery under these rules:

- **Profile drafting help:** the AI may suggest discovery-profile content based on conversation, but each suggestion is presented for per-field approval. Nothing is written silently.
- **Match explanation:** the AI renders the engine's rule-based reasons into warm, natural language. It does not invent reasons.
- **Message drafting:** the AI can help draft the intentional connection message; the member reviews and edits before sending.
- **Introduction proposals:** the AI may propose introductions it thinks are high-value, with reasons, pending dual consent.
- **Tuning guidance:** "You're getting collaborator suggestions but your priority is local activities — want to adjust?"

The AI must never: auto-contact anyone, use chat/memory content for matching without explicit opt-in, expose one member's private data to another, or override a decline/block.

---

## 8. Data model (SQLite migrations)

Following the existing `migrateToVN()` convention in `src/db.js`:

**v19 — discovery profiles**
```sql
CREATE TABLE discovery_profiles (
  id INTEGER PRIMARY KEY,
  profile_id INTEGER NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  is_discoverable INTEGER NOT NULL DEFAULT 0,
  contact_policy TEXT NOT NULL DEFAULT 'mutual-only',
  -- 'mutual-only' | 'any-discoverable' | 'nobody'
  priorities TEXT NOT NULL DEFAULT '[]',          -- ordered list of tuning keys
  paused_at TEXT,                                 -- NULL = active
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE discovery_signals (
  id INTEGER PRIMARY KEY,
  discovery_profile_id INTEGER NOT NULL REFERENCES discovery_profiles(id) ON DELETE CASCADE,
  category TEXT NOT NULL,                          -- interests | skills_offering | ...
  value TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'discoverable' -- hidden | matches-only | discoverable
);
CREATE TABLE discovery_modes (
  discovery_profile_id INTEGER NOT NULL REFERENCES discovery_profiles(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,                              -- friends | collaborators | ...
  is_enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (discovery_profile_id, mode)
);
CREATE TABLE discovery_prompts (
  discovery_profile_id INTEGER NOT NULL REFERENCES discovery_profiles(id) ON DELETE CASCADE,
  prompt_key TEXT NOT NULL,                        -- exploring | meet_someone | ...
  body TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'discoverable',
  PRIMARY KEY (discovery_profile_id, prompt_key)
);
```

**v20 — connection requests + match history**
```sql
CREATE TABLE discovery_suggestions (
  id INTEGER PRIMARY KEY,
  discovery_profile_id INTEGER NOT NULL REFERENCES discovery_profiles(id) ON DELETE CASCADE,
  candidate_profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  week_key TEXT NOT NULL,                          -- e.g. '2026-W41'
  reasons_json TEXT NOT NULL,                      -- engine-generated reasons
  shown_at TEXT NOT NULL DEFAULT (datetime('now')),
  dismissed_at TEXT
);
CREATE TABLE connection_requests (
  id INTEGER PRIMARY KEY,
  from_profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  to_profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',          -- pending | accepted | declined
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT,
  UNIQUE (from_profile_id, to_profile_id)          -- durable decline: no re-request
);
```

**v21 — location (only if/when approved)**
```sql
CREATE TABLE discovery_location (
  discovery_profile_id INTEGER NOT NULL PRIMARY KEY REFERENCES discovery_profiles(id) ON DELETE CASCADE,
  area_label TEXT NOT NULL,                        -- 'Boston metro', never coordinates
  radius_miles INTEGER NOT NULL DEFAULT 25,
  enabled_until TEXT,                              -- time-boxed; NULL = indefinite (discouraged in UI)
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**v22 — audit log**
```sql
CREATE TABLE discovery_audit (
  id INTEGER PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  action TEXT NOT NULL,                            -- suggestion_shown | request_sent | ...
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

All tables respect the existing self-service deletion: deleting a SEREN profile cascades through discovery data.

---

## 9. API design (new endpoints)

Consistent with `docs/API_CONTRACT.md` conventions (server-issued session tokens, owner-only writes):

| Method & path | Purpose |
|---|---|
| `GET /api/discovery/profile` | Own discovery profile + signals + modes + prompts |
| `PUT /api/discovery/profile` | Create/update discovery profile (owner only) |
| `DELETE /api/discovery/profile` | Delete all discovery data (owner only) |
| `GET /api/discovery/preview` | "What a stranger would see" |
| `GET /api/discovery/suggestions` | This week's curated suggestions with reasons |
| `POST /api/discovery/suggestions/:id/dismiss` | Dismiss a suggestion (tunes future matching) |
| `POST /api/discovery/requests` | Send connection request (intentional message required; rate-limited) |
| `GET /api/discovery/requests` | Incoming/outgoing requests |
| `POST /api/discovery/requests/:id/accept` | Accept (recipient only) |
| `POST /api/discovery/requests/:id/decline` | Decline — durable (recipient only) |
| `POST /api/discovery/location` | Enable time-boxed approximate location |
| `DELETE /api/discovery/location` | Disable location |
| `GET /api/discovery/export` | Export own discovery data |
| `GET /api/discovery/audit` | Own audit log |

Every endpoint enforces: session-token ownership, rate limits on writes, and visibility rules on reads (a member never sees another's `hidden` or pre-mutual `matches-only` fields).

---

## 10. Implementation plan

**Standing rule: no push, merge, or Railway deployment without Jon's explicit approval at each stage.**

### Phase 0 — Spec review & foundations (no code)
- [ ] Jon reviews and approves this spec (scope, cadence, modes, v1 exclusions).
- [ ] Decide open questions (§11).
- [ ] Add `docs/SERENDIPITY_DISCOVERY_SPEC.md` to the repo (this file).

### Phase 1 — Discovery profile (backend + UI)
- [ ] Migration v19 (profiles, signals, modes, prompts).
- [ ] API: profile CRUD, preview, export, delete.
- [ ] UI: onboarding flow, settings screen with live stranger-preview.
- [ ] Tests: visibility rules (hidden/matches-only/discoverable), owner-only writes, cascade delete.
- [ ] Host review → Jon approval → deploy.

### Phase 2 — Matching engine + weekly digest
- [ ] Extend `src/match.js`: complementary-skill matching, mode compatibility matrix, priority tuning, reason generation for all new dimensions.
- [ ] Weekly suggestion job (cron within the Railway service): generate max 5 suggestions per discoverable member, store with reasons, write audit entries.
- [ ] API: suggestions list, dismiss.
- [ ] UI: weekly digest view, "Why this match?" detail.
- [ ] Tests: reason correctness (every suggestion has ≥1 true reason), tuning changes output, no-score invariant (no numeric scores leak to client).
- [ ] Host review → Jon approval → deploy.

### Phase 3 — Connection requests
- [ ] Migration v20 (suggestions, connection requests with durable-decline unique constraint).
- [ ] API: send/accept/decline with rate limits (5 pending, 10/week).
- [ ] UI: request composer (intentional message required), inbox, mutual-connection → chat handoff.
- [ ] Integration with existing blocks/reports/pass flows.
- [ ] Tests: durable decline enforced, rate limits, block excludes from matching.
- [ ] Host review → Jon approval → deploy.

### Phase 4 — Location & gatherings (only if Jon approves the concept)
- [ ] Migration v21 (approximate location, time-boxed).
- [ ] API: location enable/disable, nearby gatherings (coarse areas, minimum attendee counts).
- [ ] UI: location consent screen, event discovery window, auto-expiry display.
- [ ] Abuse tests: no precise distance leaks, no single-person isolation, expiry enforced.
- [ ] Host review → Jon approval → deploy.

### Phase 5 — AI assistance
- [ ] AI profile-draft suggestions with per-field approval.
- [ ] AI-rendered match explanations (from engine reasons only).
- [ ] AI introduction proposals with dual-consent gating.
- [ ] Tests: AI cannot invent reasons, cannot auto-contact, respects declines/blocks.
- [ ] Host review → Jon approval → deploy.

### Explicitly deferred
- Semantic embedding layer (§4.4) — revisit after v1 validation.
- Public event ingestion (external event APIs) — v1 uses member/host-created gatherings only.
- Group matching beyond 1:1 and small circles.

---

## 11. Open questions for Jon

1. **Cadence:** weekly digest (recommended) or a different rhythm?
2. **Modes for v1:** all ten modes, or a smaller launch set (e.g., friends, collaborators, local-activities, events)?
3. **Location in v1:** include Phase 4 in the first build, or ship discovery without location and add it later?
4. **AI-mediated introductions:** in scope for v1, or phase 5 only?
5. **Naming:** "Serendipity," "Discovery," or something else in SEREN's voice?

---

*End of spec. Awaiting Jon's review before any build begins.*
