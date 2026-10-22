---
status: designed
since: 2026-10-22
goal: G2
spec: 2
depends: [110]
review: wait
note: "Staged implementation from the migration audit; required gate policy unchanged."
evidence: []
---

# Isocan stalled installation leaves bounded evidence

## Done when

A stalled isocan installation fails within its configured bound with redacted diagnostics and any targeted retry retains immutable inputs and attempt history.

## Scope

[Validation efficiency spec](../specs/validation-efficiency.md), phase 113.
Only source and existing manifest-managed consumers. No deployment or schedule.

## Acceptance

- [ ] Focused negative controls prove the phase contract.
- [ ] Required integrated checks and exact-head review are recorded.
- [ ] ⚑ by hand: parent reviews evidence before broader rollout.

## Real surfaces

The named source/consumer checkout and its required reviewed CI workflow.

## Proof

`Run isocan watchdog non-exiting-child and suite-setup contract tests, then its required PR gate.`

Source required integrated checkpoint: `npm run check`; `npm run typecheck`.
Run focused checks first; do not repeat full suites during builder iteration.

## Deliberately open

Observed speed savings remain unknown until matched trials. Later phases and
consumer adoption wait for the preceding review; no policy is weakened here.

## Next action

Prepare a separate isocan PR against shared suite-setup with a synthetic hung-child proof.
