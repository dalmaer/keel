---
status: built
since: 2026-10-04
goal: G2
depends: [2, 5]
note: "keel update and release work, and update PRs reach projects for real: keel fleet update took duo and cajones to 0.5.2 (#48, #23), green and merged, and left ledger alone because nothing applied."
evidence: ["evidence/2026-10-02-update.md"]
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

- [x] An old CLI refuses a project on a newer practice, and says how to update.
- [x] A project on practice 0.0.0 holding the pre-`7227f325` conduct skill comes out of `keel update` on the current one (a managed re-render, no migration needed).
- [x] The first real migration, `0001-milestone-to-goal`, converts a ritmo-shaped project's phases (milestones → goals), shown as a diff, and after it adopt finds `phases` on.
- [x] Running update twice makes no second change.
- [x] A failing migration leaves the project as it was and says which one.

## Proof

`node --test tests/update.test.mjs` across a temp project at 0.0.0 → the released version, and a ritmo-shaped fixture through 0001. ⚑ Then one real update PR on an adopted project (after phase 4's PRs merge).

## Deliberately open

- PR versus direct push. **Settled 2026-10-02:** default is a local branch and commit, then exit 3 with the push/PR plan; `--yes` pushes and opens the PR; `--local` leaves a working-tree diff.

## Next action

None.

## Trajectory

- **2026-10-02** — Migrations run once per project, when `applies()` is true; they aren't gated on version. A version gate never reaches a project adopted after the migration's version, and that's every newly adopted project. Found on the real ritmo walk.
- **2026-10-02** — A gate spawned from inside `node --test` inherits `NODE_TEST_CONTEXT` and passes while running nothing. All spawns go through one helper, and spawned gates must show tests ran (lesson 14).
