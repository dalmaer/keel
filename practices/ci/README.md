# ci

**The failure it prevents.** A guard that fires into a room nobody is in
(plates lesson 3): a check that only runs when someone remembers to run it.

**The rule.** `.github/workflows/check.yml` runs the project's `check` (from `.plates/plates.json`, default `npm run check`) on every push
to `main` and every pull request, on the Node in `.nvmrc`. It has no install step, so it fits a project whose
check needs no dependencies; a project that installs keeps its own workflow,
and `plates adopt` leaves `ci` local there. A red check is a failed workflow, which GitHub emails about.
After the check, red or green, it keeps `.plates/test-runs` (the night
practice's test ledger) as a `plates-test-runs` artifact for 30 days, which
the night reads to name a flaky or slower test; a project without the
reporter has nothing to keep, and the step is a no-op.

**What runs is what was checked** (plates's lesson 30, standardised 6 Oct
2026). `tests/plates-workflows.test.mjs`, in the project's own gate, runs
`bash -n` on every `run:` block of `.github/workflows/*.yml` and `node
--check` on every inline `node -e '…'` body, and names the file, step and
line of each failure, so a quote or a missing `then` fails locally, not on
GitHub. The reader is `scripts/plates/workflows.mjs`, which plates's own tests
use too. A project whose CI stays local (`ci` not on) does not get it.

**Its files.** `.github/workflows/check.yml`, `scripts/plates/workflows.mjs`
and `tests/plates-workflows.test.mjs` (managed).

**Lineage.** Plates phase 0, from ledger's and isocan's check workflows.

**Ancestors (phase 16, 3 Oct 2026).** What plates decided for the projects this
practice came from, where each keeps a version of its own:

- **ledger**: *stays local*. `test.yml` is its gate on pushes (it runs the
  parts of `check:all`); plates's `check.yml` beside it would run the gate twice.
- **isocan**: *stays local*. `pr.yml` runs its tests, typecheck and lint in
  shards; its done-gate (`npm test && npm run typecheck`, the `check` adopt
  records) and pre-push gate (`npm run test:deep`) are its own. Plates records
  no second gate: a field nothing reads is config that drifts.
