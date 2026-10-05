---
status: built
since: 2026-10-05
goal: G2
depends: [4, 6]
note: "Adopt reads the ancestors' real gate, lessons and phases. ledger adopted (#16); isocan's adoption PR (#392) is open for Dimitri."
evidence: ["evidence/2026-10-03-ancestors.md", "evidence/2026-10-05-isocan-adoption.md"]
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

- [x] Adopt on an isocan-shaped fixture with no `check` script reports no gate and asks for `--check`; with `--check "npm test && npm run typecheck"` it records that.
- [x] Adopt never seeds a lessons file when one exists elsewhere; `lessons` config is honoured by lessons, doctor, fleet and improve.
- [x] `keel next` on an isocan-shaped fixture reads `docs/projects/<p>/phases.md` and names the next phase.
- [x] A fresh copy of ledger, adopted (plus migration 0003 if built), passes its own `npm run check:all`.
- [x] A fresh copy of isocan, adopted, passes its own gate, and `git diff --stat` shows additions only.
- [x] Every ledger and isocan local variant has a recorded decision in its practice README.
- [x] ⚑ ledger's adoption PR opened (owner merges); isocan's adoption PR opened on dglazkov/isocan, for Dimitri to decide.

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

Dimitri merges or closes [dglazkov/isocan#392](https://github.com/dglazkov/isocan/pull/392). On a merge, move isocan in `fleet.json` from `source` to `managed`.

## Trajectory

- **2026-10-03** — Placeholder evidence was rejected as a facade, before it was built. 0003 applies only when every built phase already names evidence. ledger therefore keeps local phases, with 17 owed listed, until that's settled honestly.
- **2026-10-03** — isocan's own files show 39 doctor findings (29 heading statuses, 10 `DONE`): real signal keel can send it, once Dimitri adopts.
- **2026-10-05** — Dimitri agreed; isocan#392 opened, additions only (+191), gate green on 7,679 tests. Doctor found isocan's lessons table split from row 29 (ledger's bug): named in the PR, not fixed in it, since the PR only adds.
