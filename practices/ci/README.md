# ci

**The failure it prevents.** A guard that fires into a room nobody is in
(keel lesson 3): a check that only runs when someone remembers to run it.

**The rule.** `.github/workflows/check.yml` runs `npm run check` on every push
to `main` and every pull request, on the Node in `.nvmrc`, with no install
step. A red check is a failed workflow, which GitHub emails about.

**Its files.** `.github/workflows/check.yml` (managed).

**Lineage.** Keel phase 0, from ledger's and isocan's check workflows.
