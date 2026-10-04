# Flourishing by Design

**SEREN's product strategy framework.**
**Date:** 2026-10-04
**Source:** Jon's "Flourishing by Design" specification — authoritative. This
document is the strategy surface of that spec; companion policies live in
[TRUST_AND_SAFETY.md](TRUST_AND_SAFETY.md), and the per-feature pre-ship test
in [FEATURE_ACCEPTANCE_CHECKLIST.md](FEATURE_ACCEPTANCE_CHECKLIST.md).

## The core principle

SEREN exists to help people become more present, discerning, connected, and
capable in their real lives.

AI in SEREN supports reflection and voluntary connection. It does not
replace human judgment, confer spiritual authority, predict truth, or
maximize engagement. Every feature must protect consent, preserve agency,
reduce dependency, respect uncertainty, and create a credible path from
screen interaction to meaningful human action.

## The primary design question

Ask this of every feature, screen, and copy change — before it ships:

> **Does this increase a user's agency, real-world connection, reflection,
> meaning, and positive action — or does it encourage dependency, compulsive
> checking, passive consumption, false certainty, oversharing, or reliance
> on the system?**

If the latter, redesign it with limits, friction, consent, human
stewardship, and off-app completion. If it cannot pass,
[do not build it yet](FEATURE_ACCEPTANCE_CHECKLIST.md).

## The six principles

### 1. Agency First

The user stays in control. AI is an optional reflection partner — never a
guru, oracle, or therapist.

**Product implications:**

- Language audit: prefer "consider," "reflect on," "one perspective" over
  "you should," "the answer is," "this means." Nothing in the product
  claims to know what is best for the user.
- The guide chat and matching engine *propose*; the member *decides*.
  Proposals are easy to dismiss, and dismissal is never punished
  (no reduced visibility, no guilt copy).
- AI-matched results are labeled as suggestions from a reflection tool,
  not as authoritative pairings.
- No feature may require sustained AI use to function. The human path
  (human-hosted introductions, Human Mode) must always be a first-class
  alternative, not a fallback.

### 2. Real-Life Completion

The screen is a starting line, not a destination. SEREN's job is to bridge
people toward real-world experience.

**Product implications:**

- Every major flow ends with a real-life prompt — the standing question:
  **"What would you like to bring into your real life in the next 24
  hours?"**
- Introductions aim at conversation, gathering, or collaboration — the
  follow-through is the product's success event, not the match itself.
- No infinite feeds. No addictive loops: no streaks, no leveling, no
  compulsive-check mechanics, no algorithmic "you might have missed this."
- Notifications are minimal, member-controlled, and about real-world
  commitments they asked for — never manufactured urgency.

### 3. Consent and Deliberate Friction

Granular consent everywhere; mutual opt-in before any contact; sensitive
contexts default to moderated small groups.

**Product implications:**

- "Not now" and "Pause matching" are available everywhere and honored
  immediately — no retention copy, no guilt, no friction on the way out.
- Introductions require both parties' explicit yes. No contact details,
  profile depth, or messaging are exposed before mutual consent.
- Friction is deliberate at sensitive moments: pauses before irreversible
  sharing, confirmations before public visibility changes, cooling periods
  where a hasty yes could be regretted.
- Sensitive contexts (grief, crisis, vulnerability, deep disclosure)
  default to small, moderated groups with trained human facilitators — never
  open rooms, never AI-only support.

### 4. Meaning Over Engagement

We measure meaningful outcomes, not attention. SEREN does not optimize for
screen time, session duration, message volume, DAU, notification opens,
content consumption, AI-chat length, or match counts without follow-through.

**Product implications:**

- **Flourishing Scorecard** (optional, non-clinical) at 30 / 60 / 90 days:
  a short, voluntary self-reflection check — connection, clarity, agency,
  belonging — framed as a mirror for the member, not a grade. Results
  belong to the member; they are never used to rank, score, or gate access.
- Primary internal metrics: % of users reporting a meaningful
  consent-based real-world action in 30 days; % of introductions leading to
  mutually positive conversation / gathering / collaboration; % reporting
  increased connection, clarity, agency, belonging; % reporting more
  meaningful offline time; safety incident rates and resolution times; %
  feeling able to pause or leave without losing autonomy; % reporting the AI
  felt appropriately humble.
- Dashboards and reviews celebrate real-world outcomes, never engagement
  numbers.

### 5. Epistemic Humility

SEREN distinguishes — in copy and in behavior — between personal meaning,
symbolic interpretation, evidence-informed information, community
perspectives, and unverified claims. It never diagnoses. It never encourages
abandoning care. It encourages qualified human support for health, safety,
legal, financial, or crisis decisions.

**Product implications:**

- The guide chat and all AI-generated text use humble, clearly attributed
  language: "a symbolic lens," "one way to see it," "people often find…" —
  never "the truth is," "your signs say," "you are."
- When a member raises health, safety, legal, financial, or crisis topics,
  the product points toward qualified human support and
  [grounding resources](TRUST_AND_SAFETY.md#crisis--grounding-resources) —
  it does not counsel, diagnose, or interpret.
- Spiritual content is presented as interpretive and personal, never as
  fact, fate, or medical/psychological guidance.
- Members' differing perspectives are treated as perspectives — the
  platform does not settle metaphysical disputes.

### 6. Human Stewardship

People — visible, accountable, reachable — stand behind the platform.
Moderation is human, facilitators are trained, and reporting, blocking, and
escalation always work.

**Product implications:**

- Moderators and facilitators are named and visible in the community, with
  a stated code of conduct (see
  [facilitator/host guidelines](TRUST_AND_SAFETY.md#facilitatorhost-guidelines)).
- Reporting and blocking are one-tap, always available, and followed by
  human review with published resolution timelines.
- Anti-coercion is a first-class feature: anything that pressures,
  manipulates, or isolates is a reportable violation, and repeat offenders
  are removed — see the
  [anti-coercion policy](TRUST_AND_SAFETY.md#anti-coercion-policy).
- No AI-only moderation of safety reports. Automation may triage; humans
  decide.

## How this maps to SEREN's layers and modes

SEREN's taxonomy (from Jon's product definition, 2026-10-02):

- **Layers describe WHO or WHAT is connecting:**
  1. Human → Human
  2. Human → Benevolent AI
  3. Benevolent AI → Benevolent AI
- **Modes describe HOW a connection is found:**
  1. Data
  2. Synchronicity
  3. Human

Flourishing by Design applies across the whole grid — and the grid itself
exists to keep agency visible:

| Layer | Mode | What "flourishing" looks like |
|---|---|---|
| Human → Human | Data | Matches proposed from shared interests/offers/needs — with consent, humble framing, and off-app completion. |
| Human → Human | Synchronicity | Beacons and guided prompts invite reflection; the member chooses their own synchronicity or an AI-generated one — meaning stays theirs. |
| Human → Human | Human | Host-assisted introductions: a real person stewards the connection, friction is human and kind. |
| Human → Benevolent AI | Data / Synchronicity | The AI is a labeled reflection partner, never an authority; the member can pause or end it anytime with full dignity. |
| Benevolent AI → Benevolent AI | — | Not built. Deliberately deferred — human flourishing comes first, and agent-to-agent networking must clear the same six principles before it is considered. |

In every cell: mutual opt-in, pause/leave without penalty, humble language,
and a bridge to real life.

## Non-negotiables

1. Consent-first, always — granular, explicit, revocable.
2. No engagement optimization — no dark patterns, streaks, or infinite
   feeds.
3. No spiritual authority — no guru, oracle, or therapist positioning, in
   copy or in behavior.
4. No false certainty — humble, attributed language for all AI output and
   spiritual content.
5. Human stewardship of safety — visible moderators, working reports,
   published timelines.
6. Real-life completion — every flow ends by pointing outward, to the
   member's actual life.

---

*Flourishing by Design is the lens, not the launch checklist. For the
pre-ship test, see
[FEATURE_ACCEPTANCE_CHECKLIST.md](FEATURE_ACCEPTANCE_CHECKLIST.md). For the
enforceable rules, see [TRUST_AND_SAFETY.md](TRUST_AND_SAFETY.md).*
