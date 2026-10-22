---
status: partial
since: 2026-10-22
goal: G5
spec: 2
depends: []
review: wait
note: "Read-only analyzer and real replay verified; exact-head CI/review and parent rollout review pending."
evidence: ["evidence/2026-10-22-validation-audit.md"]
---

# Recorded validation evidence produces actionable audits

## Done when

A read-only local command audits retained evidence for the managed fleet, emits stable actionable findings and explicit coverage gaps, and cannot execute gates or weaken policy.

## Scope

[Validation efficiency spec](../specs/validation-efficiency.md), phase 110.
Only source and existing manifest-managed consumers. No deployment or schedule.

## Acceptance

- [x] `tests/validation-audit.test.mjs` proves redundant gates, comparable regressions, setup stalls, attestation/review/freshness gaps and stable deduplication.
- [x] `tests/validation-audit.test.mjs` proves unknown evidence cannot authorize reuse or hide missing fleet coverage, and the CLI runs no gates or network calls.
- [x] Real retained audit evidence produces an attributable report with CPU/wall/overlap limitations explicit: `node scripts/validation-audit.mjs --manifest plates.json --input ../audit-input.json --json`.
- [x] `tests/check-focused.test.mjs` proves mandatory convention selection and failure propagation; /spin invokes preflight before integration.
- [ ] Required integrated checks pass: `npm run check`; `npm run typecheck`.
- [ ] Exact-head review is recorded: `node bin/plates.mjs review dalmaer/plates#<PR> --gate --json` plus inspection of pinned complete review inputs.
- [ ] ⚑ by hand: parent reviews evidence before broader rollout.

## Your part

- **Ask:** Review this stage’s evidence before changes are adopted more broadly.
- **Why:** Workflow and gate changes must preserve coverage and observed reliability.
- **Look at:** [The staged contract](../specs/validation-efficiency.md) and this phase’s evidence.
- **Choices:** Proceed with the next stage | Revise the stage
- **Takes:** About five minutes once review and checks finish.
- **Then:** A separate implementation PR advances the next stage; no production rollout is automatic.
- **Ready when:** Exact-head checks and normal review have completed.

## Real surfaces

- owner's machine: invoke the documented read-only report entrypoint with the preserved audit input; retain the output and source hashes.

## Proof

`npm run check:focused -- tests/validation-audit.test.mjs tests/practices.test.mjs tests/decision-brief.test.mjs`

Source required integrated checkpoint: `npm run check`; `npm run typecheck`.
Run focused checks first; do not repeat full suites during builder iteration.

## Deliberately open

Observed speed savings remain unknown until matched trials. Later phases and
consumer adoption wait for the preceding review; no policy is weakened here.

## Next action

Complete exact-head checks and normal review, then ask the parent to review this stage before broader rollout.

## Trajectory

- **2026-10-22** — Focused convention checks caught source-only documentation in the installed-CLI guide directory. Moved the guide to development documentation, preserving the guard and avoiding a full-suite iteration.
- **2026-10-22** — Legacy evidence lacks full immutable-input hashes, CPU and comparable baselines. Normalization preserves those as gaps; phase 110 cannot enable consumer reuse or claim pipeline savings.
- **2026-10-22** — Historical setup time must end at the recorded completion, not the audit cutoff. A negative control exposed inflated elapsed/heartbeat values; preserved the interrupted gate and corrected the calculation before the final checkpoint.
- **2026-10-22** — The complete gate caught direct test subprocess spawning. Routed the CLI tests through the existing hermetic helper and added its convention test to the focused preflight; the failed gate remains evidence, not a successful retry claim.

- **2026-10-22** — Parent identified the helper omission as a recurrence of the audit’s email case. Added an unconditional source convention preflight and required /spin step; generalized change-aware selection remains a separate reviewed phase.

- **2026-10-22** — The new shared instruction exposed an omitted downstream adoption guard. Expanded the preflight to adoption, skill and selected-guide conventions and retained the interrupted known-red run; no gate exemption follows from focused success.

- **2026-10-22** — The new package alias invalidated the reviewed executable-metadata fingerprint, another omitted audit preflight lesson. Inspected the single alias addition, refreshed only its package binding for PR review, and made capability invalidation checks mandatory in the preflight.
