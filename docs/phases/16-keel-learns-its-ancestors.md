---
status: planned
since: 2026-10-03
goal: G2
depends: [4, 6]
note: "Dry runs on ledger and isocan copies (3 Oct): ledger adopts cleanly with five local variants; isocan exposed three adopt bugs and a phase shape keel can't read."
evidence: []
---

# The projects the practice came from can use keel without losing their shapes

## Done when

`keel adopt` on fresh copies of ledger and isocan reports their real gate, their real lessons file and their real phases, installs nothing that duplicates something they already have, and each copy's own gate passes afterwards. ledger's adoption is a PR for the owner; isocan's is a PR prepared for Dimitri.

## Scope

**Adopt bugs found on isocan** (3 Oct dry run):

1. **The gate.** Adopt assumed `npm run check`, which isocan doesn't have
   (its gate is `npm test` plus typecheck plus `test:deep`). Adopt must
   detect the gate, or report "no gate found — pass `--check`". It must never
   invent one.
2. **A second lessons file.** Adopt would seed `docs/lessons.md` beside
   isocan's real `docs/reviews/lessons.md`, which is lesson 1. The lessons
   path becomes config (`lessons` in `.keel/keel.json`), detected from the
   repo, and lessons, doctor, fleet and improve all read it.
3. **Conduct switched off where it was invented.** isocan keeps its phases as
   `docs/projects/<name>/phases.md` with `**Status:**` lines. Keel learns that
   container as a second phase shape (read-only at first). `next`, `status`
   and conduct can then read it, and conduct is on there, as isocan's own
   skill. Its local copy stays local, pinned as keel's source.

**Reverse engineering.** For each of ledger's local variants (phases,
evidence, ci, renovate, loop) and isocan's, keel decides one of two things,
recorded in each practice's README:

- keel takes the project's version (learn), or
- the project converges to keel's through a migration (e.g. 0003:
  ledger's phases gain `goal` and the missing sections, never evidence).

## Acceptance

- [ ] Adopt on an isocan-shaped fixture with no `check` script reports no gate and asks for `--check`; with `--check "npm test && npm run typecheck"` it records that.
- [ ] Adopt never seeds a lessons file when one exists elsewhere; `lessons` config is honoured by lessons, doctor, fleet and improve.
- [ ] `keel next` on an isocan-shaped fixture reads `docs/projects/<p>/phases.md` and names the next phase.
- [ ] A fresh copy of ledger, adopted (plus migration 0003 if built), passes its own `npm run check:all`.
- [ ] A fresh copy of isocan, adopted, passes its own gate, and `git diff --stat` shows additions only.
- [ ] Every ledger and isocan local variant has a recorded decision in its practice README.
- [ ] ⚑ ledger's adoption PR opened (owner merges); isocan's adoption PR opened on dglazkov/isocan, for Dimitri to decide.

## Proof

- Automated: `node --test` on the adopt, lessons, doctor and fleet tests, and
  the new phase-shape tests, all with synthetic fixtures.
- By hand: dry runs and write runs on fresh clones of ledger and isocan
  (never the originals), each clone's gate run.
- ⚑ The two PRs.

## Deliberately open

- **Whether isocan's project-directory shape becomes writable through keel**
  (conduct writing its status lines), or stays read-only with isocan's own
  conduct writing it. Read-only first.
- **isocan's review lanes** (personas, grades, journeys). These are
  practices keel doesn't have yet. Learn them as sources before shipping
  them anywhere.

## Next action

Write the isocan-shaped fixture (synthetic: a `docs/projects/acme/phases.md`
with `**Status:**` lines, `docs/reviews/lessons.md`, and no `check` script),
and make the three bugs fail as tests first.
