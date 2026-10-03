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
- [ ] The first real migration carries isocan `7227f325`'s conduct changes to a project still on the pre-efficiency skill.
- [ ] Running update twice makes no second change.
- [ ] A failing migration leaves the project as it was and says which one.

## Proof

`node --test tests/update.test.mjs` across a temp project at v0.1 → v0.2. Then one real update PR on an adopted project.

## Deliberately open

- PR versus direct push for a person running update interactively. Default PR; `--local` for the person who wants to look first.

## Next action

Write the v0.1 → v0.2 migration test with a deliberately renamed file before writing the runner.
