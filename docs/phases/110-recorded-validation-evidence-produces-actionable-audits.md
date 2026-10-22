---
status: designed
since: 2026-10-22
goal: G5
spec: 2
depends: []
review: wait
note: "Staged implementation from the migration audit; required gate policy unchanged."
evidence: []
---

# Recorded validation evidence produces actionable audits

## Done when

A read-only local command audits retained evidence for the managed fleet, emits stable actionable findings and explicit coverage gaps, and cannot execute gates or weaken policy.

## Scope

[Validation efficiency spec](../specs/validation-efficiency.md), phase 110.
Only source and existing manifest-managed consumers. No deployment or schedule.

## Acceptance

- [ ] `tests/validation-audit.test.mjs` proves redundant gates, comparable regressions, setup stalls, attestation/review/freshness gaps and stable deduplication.
- [ ] `tests/validation-audit.test.mjs` proves unknown evidence cannot authorize reuse or hide missing fleet coverage, and the CLI runs no gates or network calls.
- [ ] Real retained audit evidence produces an attributable report with CPU/wall/overlap limitations explicit.
- [ ] Required integrated checks and exact-head review are recorded.
- [ ] ⚑ by hand: parent reviews evidence before broader rollout.

## Real surfaces

Retained local audit evidence, through the new read-only report entrypoint.

## Proof

`node --import ./tests/helpers/hermetic.mjs --test tests/validation-audit.test.mjs`

Source required integrated checkpoint: `npm run check`; `npm run typecheck`.
Run focused checks first; do not repeat full suites during builder iteration.

## Deliberately open

Observed speed savings remain unknown until matched trials. Later phases and
consumer adoption wait for the preceding review; no policy is weakened here.

## Next action

Implement the retained-evidence analyzer, strict schema, CLI and negative controls.
