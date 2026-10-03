---
status: planned
since: 2026-10-02
goal: G2
depends: [2, 5]
note: "Order is settled in design.md §3: CLI first, then migrations, then re-render, then check, then PR."
evidence: []
---

# A practice change reaches a project as one reviewed pull request

## Done when

A project on practice version N runs `keel update` and gets one pull request that brings it to N+1 through a migration, passes its check, and is idempotent when run again.

## Scope

Practice versions as tags; `migrations/NNNN-*.mjs` exporting `applies` and
`up` (returns edits, does not perform them); `keel update` updates the CLI
first, then applies pending migrations in order, stops at the first that does
not apply cleanly, re-renders managed files, runs check, bumps
`.keel/keel.json`, and opens a PR (`--local` leaves a working-tree diff).
`keel release` on keel cuts a version with a WHATSNEW entry written for the
person receiving it.

## Acceptance

- [ ] An old CLI refuses a project on a newer practice, and says how to update.
- [ ] A project on practice 0.0.0 holding the pre-`7227f325` conduct skill comes out of `keel update` on the current one (a managed re-render, no migration needed).
- [ ] The first real migration, `0001-milestone-to-goal`, converts a ritmo-shaped project's phases (milestones → goals), shown as a diff, and after it adopt finds `phases` on.
- [ ] Running update twice makes no second change.
- [ ] A failing migration leaves the project as it was and says which one.

## Proof

`node --test tests/update.test.mjs` across a temp project at 0.0.0 → the released version, and a ritmo-shaped fixture through 0001. ⚑ Then one real update PR on an adopted project (after phase 4's PRs merge).

## Deliberately open

- PR versus direct push for a person running update interactively. Default PR; `--local` for the person who wants to look first.

## Next action

Write the v0.1 → v0.2 migration test with a deliberately renamed file before writing the runner.
