---
status: partial
since: 2026-10-17
goal: G4
spec: 2
depends: [54, 73, 81]
note: "Released v0.8.32 after 1,855-test gate and reviewed PR #194. Static fleet rolled out; Ledger PR #143 and nightly retention proof pending; Isocan validation and Google access remain."
evidence: ["evidence/88-production-errors.md"]
---

# Production errors become verified fixes

## Done when

Configured fleet projects collect bounded production error evidence into the existing night practice, deduplicate recurring errors into reviewable repair work, and distinguish deployed verified fixes from missing evidence while preserving source acceptance.

## Scope

[Production errors](../specs/production-errors.md) is the contract. Extend the
night, plan, robot and delivery flows; no parallel tracking system.

## Acceptance

- [x] Configured Cloud Logging/Vercel and normalized JSON sources collect bounded evidence with explicit coverage and safe persistence: `tests/production-errors.test.mjs`.
- [x] Recurrence, redaction, overlap/replay and recovery preserve privacy and counts: `tests/production-errors.test.mjs`.
- [x] Specs and issue preparation reuse existing authorization and durable recovery; the night/morning expose candidates and gaps: `tests/production-integration.test.mjs`.
- [x] Verification refuses zero/unknown traffic, incomplete coverage or unproven deployment; recurrence is preserved: `tests/production-errors.test.mjs`.
- [x] CLI help, guides and managed rendering agree: `npm run check`, `npm run typecheck`.
- [ ] Real source collection and scheduled retention are verified on configured fleet projects, with unavailable and not-applicable projects explicitly recorded: `keel production collect --yes --json` and GitHub run links.

## Real surfaces

- Owner's machine: run read-only bounded gcloud and Vercel collection with `keel production collect --yes --json`.
- Workflow shell: observe the installed night and verify retained artifacts in the following run.
- Adopted project: run `keel production status --json` and collection from each configured repository.

## Proof

`node --import ./tests/helpers/hermetic.mjs --test tests/production-errors.test.mjs tests/production-integration.test.mjs`; `npm run check`; `npm run typecheck`.
Walk each available provider through its public CLI and the final installed night.

## Deliberately open

- Provider-specific traffic and revision evidence must be established in the walk;
  absent proof yields inconclusive verification, never a fabricated healthy result.
- New recurring model budgets require a separate explicit allowance.

## Next action

Finish Ledger PR #143 and verify nightly collection followed by restoration of
its retained state. Finish Isocan validation; its collection needs Google
reauthentication and an approved CI reader identity.

## Trajectory

2026-10-17: bounded collectors, strict sanitized state, robot issue preparation,
night/morning projections and timed production verification implemented. Independent
review caught overlap overcounting, late-error invalidation, lifecycle rewinds,
malformed-history bootstrap and incomplete probe intervals; regression tests cover
these. Ledger read succeeds with explicit coverage gaps; Isocan access is unavailable.
