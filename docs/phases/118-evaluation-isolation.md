---
status: built
since: 2026-10-23
goal: G5
spec: 2
depends: [117]
review: wait
note: "Offline isolated execution, historical compatibility verdicts and adversarial boundary proved; no paid agent efficacy claim."
evidence: ["evidence/2026-10-23-evaluation-isolation.md"]
---

# Evaluate one historical artifact behind an independent boundary

## Done when

One historical compatibility case runs through a fresh isolated builder and independently controlled acceptance, retaining an artifact-bound verdict.

## Scope

Implement the corresponding slice of [harness-regression-evaluation](../specs/harness-regression-evaluation.md).
Reuse the existing experiment, learn, execution and evidence mechanisms. Do not
introduce a second scheduler, evidence authority or automatic production default.

## Acceptance

- [x] Adversarial probes cannot read checks, forge verdicts, escape mounts or contaminate another trial; failed setup remains separate: `tests/evaluation-isolation.test.mjs`.
- [x] CLI JSON/help, compatibility, bounds and failure paths are covered: `npm run check:focused -- tests/evaluation-isolation.test.mjs`.
- [x] Integrated gates and selected contracts pass: `npm run check`; `npm run typecheck`.

## Real surfaces

- owner's machine: use a fresh private external workspace and synthetic Acme fixture; retain exact invocation and receipt identities before claiming built.

## Proof

Implemented proof:
`npm run check:focused -- tests/evaluation-isolation.test.mjs`. The conductor runs
`npm run check` and `npm run typecheck` on the integrated implementation.
Record negative controls and original failures in an evidence file. Live model
work requires the exact approved comparison preview and retained provider receipts;
offline fixtures establish machinery only.

## Deliberately open

Provider activation, actual minute/currency allowance and practical cost tolerances
remain owner decisions before live work. Held-out cases are not yet authored;
public historical cases establish development coverage only. Existing handoff
experiments, hosted activation and fleet schedules are not changed by this phase.

## Next action

None for the offline boundary. Phase 119 adds paired comparison and recovery;
paid screening still requires an approved provider and exact allowance.

## Trajectory

- **2026-10-23** — Real Docker proof found that `docker cp` silently omitted tmpfs files. Use an explicitly submitted, bounded regular-file envelope and independently evaluate its bytes after termination; do not claim filesystem-snapshot attestation or weaken isolation. The spec records the withdrawn transport.

- **2026-10-23** — A host-only deadline could leave an orphaned container running. A different non-root supervisor UID now bounds lifetime independently; real tests prove executor signals refuse and expiry stops the container without a host kill.
- **2026-10-23** — Declared harness metadata does not identify the code actually executing. Bind observed controller source hashes and Node to approval and verdict while preserving the declaration and explicit coverage limits.
- **2026-10-23** — Cross-review found incomplete execution writes could hide the intact frozen receipt. Read-only inspection now exposes uncertain partial records; admission refuses before external effects, with no automatic reset or lock reclamation. A red-without-fix regression covers eight interrupted-write shapes.
