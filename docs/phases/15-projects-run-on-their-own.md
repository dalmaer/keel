---
status: built
since: 2026-10-04
goal: G4
depends: [10, 11]
note: "Night and loop workflows run each project's own scripts/plates/*.mjs with no plates checkout and no token, and update PRs go out from plates: plates fleet update opened duo #48 and cajones #23, both merged."
evidence: ["evidence/2026-10-03-projects-run-on-their-own.md"]
---

# A project's night shift runs from its own repo, and plates is only where the ideas come from

## Done when

A project made by `plates init` runs its night shift with no plates checkout and no `PLATES_TOKEN`, and the update PR a project receives is opened from plates by `plates fleet update`.

## Scope

- **Measures and drain ship into the project.** `improve` and `drain` become
  managed files, e.g. `scripts/plates/improve.mjs` and
  `scripts/plates/drain.mjs`, with the libraries they need, rendered like
  `scripts/roadmap.mjs`.
- **plates-night.yml runs the project's own copies.** The plates CLI keeps the
  same verbs by calling the same modules.
- **`plates-update.yml` is retired from the night practice.** Migration 0002
  removes it, and `PLATES_TOKEN`, from projects that have them.
- **`plates fleet update [--yes]`, run on plates.** For each managed project
  that's behind, or has pending migrations: clone it into a temp dir with the
  owner's `gh` login, run `plates update`, and open the PR. Without `--yes` it
  prints the plan and exits 3.
- Nothing in a project's workflows names plates's repo.

## Acceptance

- [x] A workflow test fails if any shipped workflow references `dalmaer/plates`, `PLATES_TOKEN`, or clones anything.
- [x] A fresh `plates init` project, with plates's checkout moved away, runs its night steps (`improve --report`, drain) locally and they pass.
- [x] Migration 0002 removes `plates-update.yml` and leaves the rest of the night practice rendered.
- [x] `plates fleet update` without `--yes` lists each behind project and the PR it would open; with `--yes`, against the gh stub, it opens exactly one PR per behind project.
- [x] The managed improve/drain copies and plates's own verbs share one source (the render check fails if they drift).

## Proof

- Automated: `node --test` on the workflow, night, improve and fleet tests,
  plus the moved-away-checkout test.
- By hand: dispatch plates's own nightly once more. It must not mention a plates
  checkout.
- ⚑ The first real `plates fleet update --yes` opens PRs on the owner's repos.

## Deliberately open

- **Where the shipped scripts live.** **Settled 2026-10-03:** `scripts/plates/`,
  which is visible, with its tests beside it.

## Next action

None.

## Trajectory

- **2026-10-03** — A project measures what it can read itself: drift by its own lock, plus five lint rules. The `behind` state, the `both` state and the loop lints are keel-side, and say so rather than 0. keel's own night loads the full set from its checkout, which is still its own repo.
