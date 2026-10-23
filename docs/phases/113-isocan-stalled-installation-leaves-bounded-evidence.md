---
status: partial
since: 2026-10-23
goal: G2
spec: 2
depends: [110]
review: wait
note: "Consumer PR 514 merged and main workflow passed; retained acceptance/equivalence evidence remains distinct. Source record reconciliation, no gate-policy change."
evidence: ["evidence/2026-10-23-consumer-validation-reconciliation.md"]
---

# Isocan stalled installation leaves bounded evidence

## Done when

A stalled isocan installation fails within its configured bound with redacted diagnostics and any targeted retry retains immutable inputs and attempt history.

## Scope

[Validation efficiency spec](../specs/validation-efficiency.md), phase 113.
Only source and existing manifest-managed consumers. No deployment or schedule.

## Acceptance

- [ ] Focused negative controls prove the phase contract: `node --test scripts/install-watchdog.test.mjs` in isocan.
- [ ] Required consumer validation evidence is complete: isocan’s configured gate (`npm test && npm run typecheck && node --test tests/loop.test.mjs`), pre-push `npm run test:deep` plus `npm run typecheck`, and the complete strict hosted shard/check union.
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

When editing this source record, the source checkpoint remains `npm run check`; `npm run typecheck`. Those are not substitutes for the consumer’s commands above.
Run focused checks first; do not repeat full suites during builder iteration.

## Deliberately open

Observed speed savings remain unknown until matched trials. Later phases and
consumer adoption wait for the preceding review; no policy is weakened here.

## Next action

No duplicate implementation PR: isocan #514 is merged. Preserve its shared watchdog and recommendation-only retry boundary. Consolidate retained consumer acceptance proof separately; actual eligible retry outcomes, complete gate attestations and comparable setup measurements remain distinct work.

## Trajectory

- **2026-10-23** — PR [514](https://github.com/dglazkov/isocan/pull/514) merged to `58f0f543459ef7fc19b54434b6bebea73dd31e16`; the published main [workflow](https://github.com/dglazkov/isocan/actions/runs/39892476821) succeeded. This reconciles observed implementation/merge facts, without inferring full phase acceptance, local/hosted equivalence or causal speed savings. [Evidence](../evidence/2026-10-23-consumer-validation-reconciliation.md).
