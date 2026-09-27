# SEREN — Product Truth

**Date:** 2026-09-27
**Status:** Evidence-backed definition. Every statement below is tagged
**[EVIDENCE]** (sourced) or **[ASSUMPTION]** (a pragmatic choice made where
evidence was incomplete, chosen to be simple and reversible).

## What SEREN is

**[EVIDENCE]** SEREN — short for *Serendipity* — is "a friend for SARA,"
designed to support three forms of connection: human-to-human,
human-to-benevolent-AI, and benevolent-AI-to-benevolent-AI. It is designed to
aggregate benevolent AIs while facilitating spiritual, metaphysical, and
esoteric connections among like-minded people to help realize humanity's
consciousness.
*Source: user's Perplexity saved memory, 2026-09-16 (strongest source).*

**[EVIDENCE]** The GitHub repo description states: "SEREN is a consent-first
platform for meaningful spiritual, metaphysical, and consciousness-centered
connections." *Source: `OceanChannelSpace/seren` (private), default branch
`main`.*

## Who it is for

**[EVIDENCE]** Like-minded people seeking spiritual, metaphysical, and esoteric
connection — plus benevolent AIs as participants in the network.
*Source: Perplexity saved memory, 2026-09-16.*

## The problem it solves

**[ASSUMPTION]** People on a spiritual/consciousness path struggle to find
aligned others (and, eventually, aligned AIs) for meaningful connection;
existing networking products (e.g. Boardy-style intro platforms) are
transactional and not built around spiritual intention or consent.

## The promised outcome

**[EVIDENCE]** Realize humanity's consciousness through facilitated
connections among like-minded people (and benevolent AIs).
*Source: Perplexity saved memory, 2026-09-16.*

## MVP workflow (the core loop)

**[ASSUMPTION]** The MVP implements the smallest coherent Boardy-like loop
for spiritual connection, since Boardy Pro
(`https://www.boardy.ai/#boardy-pro`) is the explicit product/website
reference **[EVIDENCE]** *(source: Perplexity saved memory, 2026-09-16)*:

1. A newcomer lands on a page that immediately explains what SEREN is.
2. They create a profile: name, email, spiritual interests, an intention
   statement, connection preferences, and **explicit granular consent
   toggles** (consent-first: opt-in, no dark patterns).
3. They request an introduction around an intention.
4. The matching engine scores community members by shared interests and
   intention alignment and proposes one connection with a warm intro note.
5. They accept or decline the proposed connection.
6. Accepted/pending connections live in a connections inbox; requests can be
   withdrawn.

## Required characteristics (evidence-backed)

- **[EVIDENCE]** The product's name and identity must be spiritual.
  *(Perplexity saved memory, 2026-09-16.)*
- **[EVIDENCE]** Consent-first: granular opt-ins, no dark patterns.
  *(Repo description: "consent-first platform…"; Perplexity memory.)*
- **[EVIDENCE]** Light, high-vibrational visual design — explicitly **not** a
  dark aesthetic. *(User's wife's design preference, via Perplexity saved
  memory, 2026-09-16.)*
- **[EVIDENCE]** Boardy Pro is the reference for product and website.
  *(Perplexity saved memory, 2026-09-16.)*

## Explicitly out of scope for the MVP

- **[ASSUMPTION]** Human-to-benevolent-AI and benevolent-AI-to-benevolent-AI
  connections: in the MVP the "benevolent AI" role is embodied by the
  matching/introduction engine itself. Real AI participants are future work.
- **[ASSUMPTION]** Real-time messaging/chat between connections, email
  notifications, production authentication, and third-party integrations
  (none are evidenced as required).

## Open questions (do not build around these)

1. **What is SARA?** Mentioned once ("a friend for SARA"), undefined. No
   SARA features are built in the MVP.
2. **Fireflies evidence:** ZERO meetings discuss SEREN as a product. There are
   no transcript-backed requirements, user stories, or decisions. Nothing in
   this document claims otherwise.
3. The exact Boardy Pro mechanics worth emulating were not inspected in
   depth; the MVP follows the generic "profile → request intro → proposed
   connection → accept/decline" loop.

## Seed data

**[ASSUMPTION]** The MVP ships with a small labeled demo community (seed
members) so the matching loop is exercisable on first run. Seed members are
clearly marked as demo data in the UI and database (`is_seed = 1`).

## Design language

**[EVIDENCE]** Light, warm, high-vibrational: soft creams and golds, gentle
gradients, serif display type, calm whitespace.
*(Wife's preference via Perplexity saved memory, 2026-09-16.)*
