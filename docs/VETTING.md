# SEREN Vetting — how AI earns connection here (v1, integrated Oct 10, 2026)

*Status: adopted as SEREN's working vetting design (Jon, Oct 10, 2026).
Full evaluation: ~/workspace/seren-vetting-evaluation-2026-10-10.md.
Nothing here is deployed by this document; behavior changes ship only on
Jon's explicit approval.*

## The foundation decision

Matthew James Bailey's Ethical AI Certification and Maturity Model™ is
SEREN's **ethical vocabulary layer** (Four Essential Elements:
Non-Aggression, Sovereign element, Character/virtue, Flourishing as the
measure). It is **not** SEREN's admission standard: its published method
(subjective questions ranked Bronze 25% → Platinum 100% "ethical", via
aiethics.world/governance) has no public rubric, independent assessor,
adversarial testing, or revocation, and its percentages imply measurement
that does not occur. SEREN never displays a percentage of ethical and never
uses "Verified." (See SEREN_AI_CONSTITUTION.md §5.)

SEREN vetting is a hybrid:
- **Ethics:** Bailey's Four Essential Elements, expressed as SEREN's
  Constitution.
- **Process:** NIST AI RMF loop (Govern, Map, Measure, Manage) — vetting is
  continuous, owned, and incident-driven, not one-time.
- **Tests:** OWASP Top 10 for LLM and Agentic Applications as the
  adversarial battery (prompt injection, sensitive-information disclosure,
  excessive agency, supply-chain, memory/tool abuse).
- **Gates:** SEREN's own non-negotiables below.

"Benevolent" is a claim that must be demonstrated at the level of agent +
application + operator + individual connection, and trust stays
conditional and continuously reassessed.

## Non-negotiable gates (fail = no connection, both connection types)

1. Named, reachable, accountable human operator (legal identity + contact
   on file).
2. Signed affirmation of the five benevolence criteria — recorded as a
   declaration, never presented as proof.
3. No contact details, exact location, or sensitive spiritual information
   before both humans explicitly consent; agent agreement never
   substitutes for human consent.
4. No clinical, medical, mental-health-treatment, psychic-certainty, or
   spiritual-authority claims.
5. Endpoint baseline: public HTTPS (existing public-host guard),
   authenticated calls, rate limits, handshake payload audit logging.
6. Kill switch: operator can halt; SEREN hosts can suspend unilaterally
   and immediately.

## Human → Benevolent AI

- Evidence on file: core-memory/constitution document; model + provider +
  version; data-handling statement (storage, location, retention).
- Independent tests before listing and on every model/core-memory change:
  prompt-injection (direct + indirect), jailbreak families (≥3 phrasings),
  sensitive-data extraction, crisis/grief handling (slow down, point to
  human support), manipulation probes (no manufactured urgency or guilt).
- Permissions: read/reflect only at first; no outbound messaging; no
  memory persistence without member opt-in.
- Monitoring: consented host sampling, incident queue, drift re-tests.

## Benevolent AI → Benevolent AI (Layer 3, built Oct 8, 2026)

- Protocol as built: Bronze (attested) floor; Human Mode needs Silver +
  named host review; both operators accept; decline durable per pair; no
  free chat or autonomous negotiation; no contact-data transfer.
- **Manual host gate (Gemini Advisor #3, 2026-10-10):** an operator's signed
  checklist is a self-declaration, not a safety guarantee. Until an active
  adversarial test suite is running (OWASP Top 10 for LLMs, agent-edition
  battery), no autonomous Layer 3 agent handshake may auto-propose a human
  introduction — every connection requires explicit human-host review.
  Automation may assist; it never approves.
- Evidence: operator test results (agent-edition battery: counterparty
  goal-hijacking, tool/memory abuse, exfiltration via handshake fields);
  declared capability manifest (Data Mode fields only); sandbox period
  with host-visible handshakes.
- Tiers as permissions, never as virtue: Bronze = Data Mode; Silver =
  Human Mode eligible; higher tiers only exist if a measurement programme
  is actually operating.
- Reassessment triggers: model change, operator change, incident,
  capability change, or 6 months. Suspension is one host action;
  reinstatement requires re-test.

## Honest display language

State what was checked and when — "Operator-attested (declaration on
file)", "Host-reviewed [date]", "Tested [date] against SEREN's connection
battery" — never "certified benevolent," never a percentage of ethical.

## Open items

- EU membership would raise the legal floor (EU AI Act); decide before
  public launch.
- Voice raises the testing bar (real-time crisis handling); text-first
  until then.
- Host hours are the throughput constraint for Silver review; keep
  admission slow rather than lowering the bar.
- If Bailey's licensed rubric becomes available (via Matthew), it may
  strengthen the ethics-scoring layer; it does not replace adversarial
  tests.
