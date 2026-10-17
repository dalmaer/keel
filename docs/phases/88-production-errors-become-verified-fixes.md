---
status: designed
since: 2026-10-17
goal: G4
spec: 2
depends: [54, 73, 81]
note: "Production-log collection, recurring-error evidence, repair proposals and post-deployment verification specified; implementation and fleet rollout pending."
---

# Production errors become verified fixes

## Done when

Configured fleet projects collect bounded production error evidence into the existing night practice, deduplicate recurring errors into reviewable repair work, and distinguish deployed verified fixes from missing evidence while preserving source acceptance.

## Scope

[Production errors](../specs/production-errors.md) is the contract. Extend the
night, plan, robot and delivery flows; no parallel tracking system.

## Acceptance

- [ ] Configured Cloud Logging/Vercel and normalized JSON sources collect bounded evidence with explicit coverage and safe persistence: `tests/production-errors.test.mjs`.
- [ ] Recurrence, redaction, overlap/replay and recovery preserve privacy and counts: `tests/production-errors.test.mjs`.
- [ ] Specs and issue preparation reuse existing authorization and durable recovery; the night/morning expose candidates and gaps: `tests/production-integration.test.mjs`.
- [ ] Verification refuses zero/unknown traffic, incomplete coverage or unproven deployment; recurrence is preserved: `tests/production-errors.test.mjs`.
- [ ] CLI help, guides and managed rendering agree: `npm run check`, `npm run typecheck`.
- [ ] Real source collection and scheduled retention are verified on configured fleet projects, with unavailable and not-applicable projects explicitly recorded: dated evidence and GitHub run links.

## Real surfaces

- Public gcloud and Vercel CLIs against authorized production sources, read-only.
- GitHub night workflow, durable artifacts and existing issue recovery flow.
- Fleet repositories with actual source configurations and bounded collection.

## Proof

`node --import ./tests/helpers/hermetic.mjs --test tests/production-errors.test.mjs tests/production-integration.test.mjs`; `npm run check`; `npm run typecheck`.
Walk each available provider through its public CLI and the final installed night.

## Deliberately open

- Provider-specific traffic and revision evidence must be established in the walk;
  absent proof yields inconclusive verification, never a fabricated healthy result.
- New recurring model budgets require a separate explicit allowance.

## Next action

Implement the collector and evidence lifecycle, integrate the existing night and
repair flow, then configure and verify each discovered production source.

## Trajectory

*Nothing yet.*
