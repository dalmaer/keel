---
status: built
since: 2026-10-22
goal: G5
spec: 2
depends: []
review: wait
note: "Reviewed implementation merged as PR 225; intermediate main UTC fixture failure is preserved and corrected by reviewed PR 226. No consumer rollout or speedup claim."
evidence: ["evidence/2026-10-22-validation-audit.md", "evidence/2026-10-23-validation-guardrail-merges.md"]
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
- [x] Required integrated checks pass: `npm run check`; `npm run typecheck`.
- [x] Exact-head review is recorded: `node bin/plates.mjs review dalmaer/plates#<PR> --gate --json` plus inspection of pinned complete review inputs.
- [x] ⚑ by hand: parent reviews evidence before broader rollout. Parent subsequently authorized the ordered source PR merges; consumer adoption and deployment remain separate boundaries.

## Your part

- **Ask:** Review this stage’s evidence before changes are adopted more broadly.
- **Why:** Workflow and gate changes must preserve coverage and observed reliability.
- **Look at:** [The staged contract](../specs/validation-efficiency.md) and this phase’s evidence.
- **Choices:** Proceed with the next stage | Revise the stage
- **Takes:** About five minutes once review and checks finish.
- **Then:** A separate implementation PR advances the next stage; no production rollout is automatic.
- **Ready:** yes; parent review and the subsequently authorized source merge are recorded. Consumer adoption requires its own evidence.

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

None. PR 225 and its reviewed phase 111 successor are merged. Preserve the intermediate UTC fixture failure and focused-replay omission in the subsequent evidence.

## Trajectory

- **2026-10-22** — Focused convention checks caught source-only documentation in the installed-CLI guide directory. Moved the guide to development documentation, preserving the guard and avoiding a full-suite iteration.
- **2026-10-22** — Legacy evidence lacks full immutable-input hashes, CPU and comparable baselines. Normalization preserves those as gaps; phase 110 cannot enable consumer reuse or claim pipeline savings.
- **2026-10-22** — Historical setup time must end at the recorded completion, not the audit cutoff. A negative control exposed inflated elapsed/heartbeat values; preserved the interrupted gate and corrected the calculation before the final checkpoint.
- **2026-10-22** — The complete gate caught direct test subprocess spawning. Routed the CLI tests through the existing hermetic helper and added its convention test to the focused preflight; the failed gate remains evidence, not a successful retry claim.

- **2026-10-22** — Parent identified the helper omission as a recurrence of the audit’s email case. Added an unconditional source convention preflight and required /spin step; generalized change-aware selection remains a separate reviewed phase.

- **2026-10-22** — The new shared instruction exposed an omitted downstream adoption guard. Expanded the preflight to adoption, skill and selected-guide conventions and retained the interrupted known-red run; no gate exemption follows from focused success.

- **2026-10-22** — The new package alias invalidated the reviewed executable-metadata fingerprint, another omitted audit preflight lesson. Inspected the single alias addition, refreshed only its package binding for PR review, and made capability invalidation checks mandatory in the preflight.

- **2026-10-22** — Independent Claude review of complete pinned inputs found silent unknown setup completion and omitted staged whitespace. Add regression-proven corrections; keep the old head’s pass/review distinct from the corrected candidate’s required checks.

- **2026-10-22** — Parent independently verified 0f8b157, its complete 23-file diff, CI and zero-finding Claude review, and accepted phase 110 as the boundary for continuing phase 111. This is implementation acceptance, not merge, deployment, consumer adoption or measured speedup.

- **2026-10-23** — PR 225 merged with prior exact-head checks/review, but its main run exposed the known UTC fixture before PR 226 fixed it. A premerge focused replay was omitted; the failed run remains evidence. [Merge record](../evidence/2026-10-23-validation-guardrail-merges.md).
