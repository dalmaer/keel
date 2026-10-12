---
status: built
since: 2026-10-12
goal: G5
spec: 2
depends: [40, 67]
note: "Explicit session trials, bounded admission, safe handoffs, paired audit and policy rollback implemented; packed lifecycle verified. Real-world savings and host lifecycle adapters remain unproven."
evidence: ["evidence/2026-10-12-session-handoff-trials.md"]
---

# Session handoffs improve through bounded measured trials

## Done when

The CLI admits bounded comparable session trials, records safe handoffs and explicit outcomes, audits better/worse/inconclusive evidence, and promotes or rolls back only the experiment's approved policy while preserving its history.

## Scope

[Session handoff trials](../specs/session-handoff-trials.md) is the contract.
Extend `retro` and `improve`; no model launcher, scheduler, global default or
new phase/acceptance authority. Keep runtime dependency-free and executable
without compilation. Conduct integration is through the guide and agent help;
installed fleet skills do not change in this phase.

## Acceptance

- [x] Runtime-validated policy envelopes reserve bounded runs before work; competing admissions cannot overspend or duplicate work: `tests/session-trials.test.mjs`.
- [x] Structured handoffs preserve owner choices, proof, pending jobs and claims; unsafe boundaries and excess handoffs are refused: `tests/session-trials.test.mjs`.
- [x] Missing, failed and incomparable observations cannot produce a winning trial; proven candidates and later regressions produce auditable promotion and rollback: `tests/session-trials.test.mjs`.
- [x] Public CLI previews are read-only, JSON works, retained observations survive restart, and improve reads the same audit: `tests/session-trials.test.mjs` and the evidence's packed CLI walk.
- [x] Agent help and guides name the commands and their limits; all integrated checks pass: `npm run check` and `npm run typecheck`.

## Real surfaces

- Owner's machine: packed no-build CLI on a disposable Acme project, from an explicit envelope through audit and rollback, with restarted processes. Synthetic observations demonstrate mechanics only.

## Proof

- `node --import ./tests/helpers/hermetic.mjs --test tests/session-trials.test.mjs tests/cli.test.mjs`
- `npm run typecheck`
- `npm run check`
- Pack the CLI into `/tmp/keel-phase72`, extract it and run the lifecycle in an isolated Acme project; retain inputs and output paths in evidence.

## Deliberately open

- Real savings and the best threshold remain unmeasured. Observe comparable authorized work; do not infer them from synthetic tests or the BenOS replay estimate.
- Provider lifecycle and usage adapters are not implemented here. Explicit records work across providers, but automatic context measurement, stopping and relaunching need host-specific proof.
- Admission limits future work, not a running process. The calling harness must enforce its own timeout and approved model-spend ceiling.

## Next action

Observe comparable authorized work with an explicitly chosen experiment envelope. Record real costs and outcomes before claiming savings or adopting fleet defaults.

## Trajectory

- **2026-10-12** — The provider-local BenOS hook was absent. Keep lifecycle control explicit and provider-neutral; build durable admission and audit first rather than claiming a host rotation feature that has not been verified.

- **2026-10-12** — Independent review found a mixed-workload winner and an event-cap write that could make history unreadable. Pin task class across the experiment, enforce the cap before persistence, and make repeated policy selections idempotent.
