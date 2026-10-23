---
status: partial
since: 2026-10-23
goal: G2
spec: 2
depends: [110]
review: wait
note: "Consumer PR 162 merged and main workflow passed; retained acceptance/equivalence evidence remains distinct. Source record reconciliation, no gate-policy change."
evidence: ["evidence/2026-10-23-consumer-validation-reconciliation.md"]
---

# Ledger validates core and web independently

## Done when

Ledger core and web start independently after scope resolution with the existing stage coverage, clocks and failure propagation preserved.

## Scope

[Validation efficiency spec](../specs/validation-efficiency.md), phase 112.
Only source and existing manifest-managed consumers. No deployment or schedule.

## Acceptance

- [ ] Focused negative controls prove the phase contract: `node --test cli/ci-workflows.test.ts` in Ledger.
- [ ] Required consumer validation evidence is complete: `npm run check:all` in Ledger; both unchanged hosted Tests lanes must also pass.
- [ ] Exact-head review is recorded: `node bin/plates.mjs review dalmaer/ledger#<PR> --gate --json` plus inspection of pinned complete review inputs.
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

`Run Ledger workflow contract tests and both unchanged required CI lanes on the reviewed candidate.`

When editing this source record, the source checkpoint remains `npm run check`; `npm run typecheck`. Those are not substitutes for the consumer’s commands above.
Run focused checks first; do not repeat full suites during builder iteration.

## Deliberately open

Observed speed savings remain unknown until matched trials. Later phases and
consumer adoption wait for the preceding review; no policy is weakened here.

## Next action

No duplicate implementation PR: Ledger #162 is merged. Preserve the independent graph and unchanged hosted union. Consolidate retained consumer acceptance proof separately; phase 114 must supply complete producer/manifest/input evidence before any equivalence or reuse claim.

## Trajectory

- **2026-10-23** — PR [162](https://github.com/dalmaer/ledger/pull/162) merged to `ab69eccf029458dfee26c33822a085445705d629`; the published main [workflow](https://github.com/dalmaer/ledger/actions/runs/39892488810) succeeded. This reconciles observed implementation/merge facts, without inferring full phase acceptance, local/hosted equivalence or causal speed savings. [Evidence](../evidence/2026-10-23-consumer-validation-reconciliation.md).
