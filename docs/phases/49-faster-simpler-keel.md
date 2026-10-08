---
status: built
since: 2026-10-07
goal: G0
spec: 2
depends: [2, 5]
note: "Practice loading uses 60% less local warm-read time; deterministic fresh reads are tested and current guidance matches shipped workflows."
evidence: ["evidence/2026-10-07-faster-simpler-keel.md"]
---

# Keel starts faster and its guidance describes the code it ships

## Done when

Repeated measurements on the same machine demonstrate faster practice loading or CLI startup, existing command and validation behavior remains tested, and current documentation agrees with the implemented workflows.

## Scope

A bounded maintenance pass over practice loading, CLI dispatch and current documentation. Preserve public JSON shapes, deterministic validation, freshness between calls, file ownership and historical evidence. No dependencies, new tracking system or fleet rollout.

## Acceptance

- [x] Practice loading retains deterministic validation and fresh template reads while reducing measured cost. `tests/practices.test.mjs` and the before/after benchmark in the evidence.
- [x] CLI startup is measured, command results, errors and help remain tested, and changes without a demonstrated benefit are rejected. `tests/cli.test.mjs` and the before/after benchmark in the evidence.
- [x] Current README, working map, design and agent guidance agree with shipped commands. `tests/docs.test.mjs` and `tests/guides.test.mjs`, plus source review recorded in evidence.
- [x] Integrated checks pass and test-ledger hygiene is inspected. `npm run check`.

## Real surfaces

- Owner's machine: compare repeated fresh CLI processes and practice reads against the untouched base revision; report the method and limits.
- Published package: `tests/package.test.mjs` packs the actual tree, verifies its contents and starts an initialized project from the unpacked CLI.

## Proof

Focused hermetic tests for changed files, with `scripts/keel/test-ledger.mjs` as a reporter. Before/after measurements use the same inputs and machine, outside competing test runs. The final `npm run check` includes the package smoke test and generated-file checks. Do not claim a speedup that falls inside measurement noise.

## Deliberately open

Cold disk and other machines may differ; the measurements establish local process/read costs, not fleet-wide performance. Broad caching is excluded because long-lived callers must see edited templates.

## Next action

Observe the next real project updates for lived-in evidence; no fleet-wide performance claim yet.

## Trajectory

- **2026-10-07** — CLI command modules were already lazy. The remaining work is selected by measured startup/read costs; this pass does not replace the established dispatcher or add persistent caches.

- **2026-10-07** — Independent practice reads improved load time without caching. CLI import experiments were discarded because marginal gains overlapped noise and added complexity; the existing dispatcher remains. See the phase evidence.
