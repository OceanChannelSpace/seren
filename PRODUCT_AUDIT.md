# SEREN — Product Audit vs. the Relationship-Network Thesis

**Date:** 2026-10-01
**Auditor:** Muse (for Jon)
**Thesis under review:** "A trusted relationship network for humans, communities, and intelligent agents… an interoperability and trust layer through which benevolent human and machine intelligences can discover and collaborate."
**Note:** the supplied spec's §1 was truncated mid-sentence ("Explicit …"). This audit covers all visible requirements; consent machinery already exists (see below).

## 1. What already matches the thesis

| Thesis requirement | Existing implementation |
|---|---|
| Consent-first, opt-in connection | Granular consents (`introductions`, `community_visible`, `ai_matching`), explicit consent interview stage, mutual opt-in introductions, withdraw/pause |
| Human-to-human intentional matching | `scoreCandidate`/`findMatches` (practices, interests, intentions, keywords, formats), warm intro notes, accept/decline |
| Conversational AI interface | Chatbot onboarding interview + guide chat (follow-ups → brief → proposals), quick replies, resume |
| Standard app/dashboard interface | Views: home, discover, requests, connections, circles, saved, brief, me/edit, modes |
| Communities as participants | Circles: create, join, request/approve, member lists |
| Trust & safety basics | Blocks, reports, seed-data labeling, privacy-filtered profiles, no PII before mutual consent |
| Beachhead community | Spiritual/metaphysical taxonomy (practices, intentions, values), light high-vibrational design |
| Calm, non-coercive product | No scores shown, no dark patterns, skippable optionals |

## 2. Missing (gaps vs. the thesis)

1. **Intelligent agents as network participants.** The thesis's core differentiator — "humans, communities, *and intelligent agents*" — has zero implementation. No agent entity, registry, discovery, or trust attestation. The "benevolent AI" is only the matching engine itself.
2. **Brand modularity.** "SEREN"/"seren" is hard-coded across `package.json` (`seren-mvp`), localStorage keys (`seren.*`), UI copy, and comments. The name is not legally vetted; nothing is configurable.
3. **Structured offers / needs / skills / availability.** The spec's matching dimensions list "what someone offers / needs, skills, active projects, availability." Only free-text `offer_text` on briefs exists. Profiles have no structured offers, needs, skills, or availability — matching is similarity-only, never complementary.
4. **Controlled serendipity.** Matching is pure similarity ranking. Nothing injects permissioned surprise.
5. **Proactive, permissioned assistance.** The guide is purely reactive; no opt-in nudges, check-ins, or follow-ups.
6. **Sarah (inward-facing) vs. SEREN (outward-facing) distinction.** SARA/Sarah appears only in legacy docs. No product surface expresses the inward/outward split or a handoff story.
7. **Interoperability surface.** No API for external agents to register, discover, or request introductions — the "trust layer" has no programmatic door.

## 3. Conflicts with the thesis

- **None structural.** The old "Boardy for spirituality" framing is a subset of the new thesis (outward-facing connection), not a contradiction. The standing rule against copying Boardy's branding remains compatible.
- **Naming risk (latent):** `PRODUCT_TRUTH.md` asserts "SEREN — short for *Serendipity*" as the product name. The new spec explicitly says the name is not finalized or legally clear. Treat all brand strings as provisional.

## 4. Technical debt / blockers

1. **Single-device identity** (`localStorage` profileId, no real auth). Documented and reversible, but it caps the trust layer: no verified identity, no cross-device continuity without relink. Blocks anything calling itself a "trust layer."
2. **`origin/main` is behind local `main`** (GitHub connector unavailable to sandbox). Deploys currently go via Railway CLI from local. Reconnect the GitHub connector to restore the normal pipeline.
3. **`docs/CODEBASE_AUDIT.md` is stale** (describes the pre-MVP static prototype; the MVP was built 2026-09-27→30). Do not rely on it.
4. **No CI.** 147 tests exist but nothing runs them automatically.
5. **localStorage key prefix `seren.*`** is a de-facto namespace. Renaming it logs out existing members; any rename needs a migration, not a find-replace.

## 5. Recommended implementation order

1. **Brand config** — centralize product name/tagline in `src/config.js` (+ `/api/meta`), derive UI strings from it. Zero user impact.
2. **Profile: offers / needs / skills / availability** — structured fields, validation, API, editor UI. Unlocks complementary matching.
3. **Matching v2** — offers↔needs complementarity scoring + a permissioned serendipity slot (one wild-card suggestion, clearly labeled, only for opted-in members).
4. **Agent registry (foundation)** — `agents` table + owner-managed CRUD + discovery alongside humans (clearly labeled, consent-gated). This is the thesis's load-bearing wall; build the registry before any agent-to-agent flows.
5. **Interoperability door** — documented, authenticated endpoint for external agents to register/discover (after 4 proves the model).
6. **Later:** proactive permissioned nudges; Sarah handoff story; real auth.

## 6. Explicit assumptions & unresolved decisions

- **A1:** The truncated spec sentence ("Explicit …") most plausibly continues the consent thread; consent-first behavior is already implemented and preserved.
- **A2:** "Jon, not John" — no "John" strings exist in the codebase; nothing to rename. Noted for future copy.
- **A3 (revised 2026-10-01):** Agents are registered by a human operator whose
  name, capability list, and trust note are shown as *unverified operator
  declarations* — the platform does not independently verify agent behavior,
  capabilities, or safety. Registry copy was updated to remove any implication
  of benevolence verification or platform endorsement.
- **A4:** localStorage keys keep the `seren.` prefix for now (renaming = forced logout); the prefix is centralized in one constant for a future migration.
- **U1 (unresolved):** Legal clearance of the "Seren"/"Serendipity" name — brand config makes a rename cheap when decided.
- **U2 (unresolved):** Whether agent-to-human introductions need a distinct consent toggle beyond `introductions` — foundation ships with agents discoverable only where the member opted into introductions; a separate toggle is a follow-up.
- **U3 (unresolved):** Sarah integration surface — no requirements supplied; not built.

## 7. What was implemented from this audit (2026-10-01)

- Brand config (`src/config.js`, `/api/meta.brand`, frontend `state.meta.brand`).
- Profile `offers`, `needs`, `skills`, `availability` (+ validation, API, editor, matching).
- Matching v2: complementarity + labeled serendipity slot.
- Agent registry foundation: `agents` table, CRUD API, discovery integration.

## 8. Trust & privacy review follow-ups (2026-10-01)

An external review (Perplexity Pro, saved thread in the operator's account)
flagged the broad AI-agent discovery surface and several privacy gaps; the
following were implemented locally, tested (178/178), and committed but not
yet pushed or deployed:

1. **Agent trust labeling** — registry, Discover, and registration copy now
   say *AI*, *unverified*, and *operator-declared capabilities (not verified)*
   everywhere; "operator attests" replaced with "unverified operator
   declaration"; no copy implies verification, safety, or endorsement.
2. **Endpoint hardening** — agent `endpointUrl` rejects loopback, RFC1918,
   link-local, unspecified, `localhost`/`.local`/`.internal` hostnames
   (hostname-based only; not DNS-rebinding protection or an egress control).
3. **Match-reason privacy** — a candidate's hidden offers/needs/skills are
   never quoted verbatim in reasons; generic phrasing is substituted.
   Bilateral proposal explanations quote neither party's raw wording, and
   reverse complementarity is attributed correctly ("looking for something
   you may be able to offer").
4. **`needsMatching` consent** — new `consentSettings` key (default `true`);
   when off, the member's needs are excluded from matching in both
   directions; Me → Discovery has a "Match me on my needs" toggle.
5. **Serendipity disclosure** — first-run Discover banner explaining wild
   cards with a "Got it" dismissal and a link to the off switch; also fixed
   the `serendipity` key missing from the PATCH validation whitelist.

Still open: real authentication (authorization still rests on supplied
operator profile IDs), report/block flows, CI, and a DNS-rebinding/egress
strategy for agent endpoints.
