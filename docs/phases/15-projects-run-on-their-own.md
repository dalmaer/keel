---
status: planned
since: 2026-10-03
goal: G4
depends: [10, 11]
note: "The owner's correction: a project's workflows must never reach back to keel at runtime. Today keel-night clones keel with KEEL_TOKEN."
evidence: []
---

# A project's night shift runs from its own repo, and keel is only where the ideas come from

## Done when

A project made by `keel init` runs its night shift with no keel checkout and no `KEEL_TOKEN`, and the update PR a project receives is opened from keel by `keel fleet update`.

## Scope

- **Measures and drain ship into the project.** `improve` and `drain` become
  managed files, e.g. `scripts/keel/improve.mjs` and
  `scripts/keel/drain.mjs`, with the libraries they need, rendered like
  `scripts/roadmap.mjs`.
- **keel-night.yml runs the project's own copies.** The keel CLI keeps the
  same verbs by calling the same modules.
- **`keel-update.yml` is retired from the night practice.** Migration 0002
  removes it, and `KEEL_TOKEN`, from projects that have them.
- **`keel fleet update [--yes]`, run on keel.** For each managed project
  that's behind, or has pending migrations: clone it into a temp dir with the
  owner's `gh` login, run `keel update`, and open the PR. Without `--yes` it
  prints the plan and exits 3.
- Nothing in a project's workflows names keel's repo.

## Acceptance

- [ ] A workflow test fails if any shipped workflow references `dalmaer/keel`, `KEEL_TOKEN`, or clones anything.
- [ ] A fresh `keel init` project, with keel's checkout moved away, runs its night steps (`improve --report`, drain) locally and they pass.
- [ ] Migration 0002 removes `keel-update.yml` and leaves the rest of the night practice rendered.
- [ ] `keel fleet update` without `--yes` lists each behind project and the PR it would open; with `--yes`, against the gh stub, it opens exactly one PR per behind project.
- [ ] The managed improve/drain copies and keel's own verbs share one source (the render check fails if they drift).

## Proof

- Automated: `node --test` on the workflow, night, improve and fleet tests,
  plus the moved-away-checkout test.
- By hand: dispatch keel's own nightly once more. It must not mention a keel
  checkout.
- ⚑ The first real `keel fleet update --yes` opens PRs on the owner's repos.

## Deliberately open

- **Where the shipped scripts live** (`scripts/keel/`, or `.keel/bin/`).
  Prefer `scripts/keel/`: it's visible, and its tests sit beside it.

## Next action

List every module `improve` and `drain` import, to see how much ships into a
project, then write the "no workflow names keel" test first.
