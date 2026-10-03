# ci

**The failure it prevents.** A guard that fires into a room nobody is in
(keel lesson 3): a check that only runs when someone remembers to run it.

**The rule.** `.github/workflows/check.yml` runs the project's `check` (from `.keel/keel.json`, default `npm run check`) on every push
to `main` and every pull request, on the Node in `.nvmrc`. It has no install step, so it fits a project whose
check needs no dependencies; a project that installs keeps its own workflow,
and `keel adopt` leaves `ci` local there. A red check is a failed workflow, which GitHub emails about.

**Its files.** `.github/workflows/check.yml` (managed).

**Lineage.** Keel phase 0, from ledger's and isocan's check workflows.

**Ancestors (phase 16, 3 Oct 2026).** What keel decided for the projects this
practice came from, where each keeps a version of its own:

- **ledger**: *stays local*. `test.yml` is its gate on pushes (it runs the
  parts of `check:all`); keel's `check.yml` beside it would run the gate twice.
- **isocan**: *stays local*. `pr.yml` runs its tests, typecheck and lint in
  shards; its done-gate (`npm test && npm run typecheck`, the `check` adopt
  records) and pre-push gate (`npm run test:deep`) are its own. Keel records
  no second gate: a field nothing reads is config that drifts.
