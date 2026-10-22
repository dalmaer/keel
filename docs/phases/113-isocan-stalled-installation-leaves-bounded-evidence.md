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

- [ ] Focused negative controls prove the phase contract: `node --test scripts/install-watchdog.test.mjs` in isocan.
- [ ] Required integrated checks pass: `npm run check`; `npm run typecheck`.
- [ ] Exact-head review is recorded: `node bin/plates.mjs review dglazkov/isocan#<PR> --gate --json` plus inspection of pinned complete review inputs.
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

- workflow shell: run the focused commands in Proof and inspect the required CI workflow at the exact reviewed head.

## Proof

`Run isocan watchdog non-exiting-child and suite-setup contract tests, then its required PR gate.`

Source required integrated checkpoint: `npm run check`; `npm run typecheck`.
Run focused checks first; do not repeat full suites during builder iteration.

## Deliberately open

Observed speed savings remain unknown until matched trials. Later phases and
consumer adoption wait for the preceding review; no policy is weakened here.

## Next action

Prepare a separate isocan PR against shared suite-setup with a synthetic hung-child proof.
