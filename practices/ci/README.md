# ci

**The failure it prevents.** A guard that fires into a room nobody is in
(keel lesson 3): a check that only runs when someone remembers to run it.

**The rule.** `.github/workflows/check.yml` runs the project's `check` (from `.keel/keel.json`, default `npm run check`) on every push
to `main` and every pull request, on the Node in `.nvmrc`. It has no install step, so it fits a project whose
check needs no dependencies; a project that installs keeps its own workflow,
and `keel adopt` leaves `ci` local there. A red check is a failed workflow, which GitHub emails about.

**Its files.** `.github/workflows/check.yml` (managed).

**Lineage.** Keel phase 0, from ledger's and isocan's check workflows.
