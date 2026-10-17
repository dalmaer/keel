# delivery

**The failure it prevents.** Two changes land a minute apart and both run the
whole expensive path: test, build, deploy, promote, twice, the older one
possibly finishing last and deploying over the newer (the owner, 16 Oct 2026).
Or a deploy follows `main` itself, so a commit reaches production before (or
without) its gate passing.

**The rule.** Verify in parallel, publish one at a time, skip the superseded
(isocan's `scripts/release-order.sh`, keel's
`docs/research/2026-10-16-delivery.md`, items 1, 2 and 6):

- `.github/workflows/keel-publish.yml` starts when the project's gate workflow
  finishes on `main` (`workflow_run`, a push, success) or by hand. It has one
  fixed concurrency group, `publish`, never cancelled. A run that will not
  publish (a failed gate, a pull request's run) has a group of its own, so it
  never displaces a queued publisher.
- GitHub keeps only one *pending* run per group, so a late trigger can
  replace a newer one. `scripts/keel/publish.mjs` therefore never trusts the
  commit that started it: it reads `main`'s first-parent history from the
  tested ref to the tip and each commit's gate result (the night's
  `readCiGate`: the gate workflow's latest attempt on exactly that commit, a
  push to the default branch), and moves the tested ref to the newest commit
  that passed, with a lease on the value it read. Already there, or nothing
  newer passed: nothing. A tested ref that is not an ancestor of `main` has
  diverged: the run is red and nothing moves. The ref is created on first use
  at the newest passing commit. It never writes `main`.
- Least privilege: the job that chooses reads (`contents: read`,
  `actions: read`); only the job that moves the ref has `contents: write`, and
  it calls no API.
- Deploys follow the tested ref, never a push to `main`. A service outside
  GitHub Actions (isocan's Cloud Build) can trigger on a push to it; an
  Actions deploy starts on `workflow_run` of keel-publish completing, never on
  a push to the tested ref, because GitHub starts no workflow for a push made
  with `GITHUB_TOKEN`, which is what the publisher pushes with.
  `docs/guide/delivery.md` in keel says how, for both.
- `keel doctor` holds every workflow of a project with this practice to the
  concurrency rule (`workflow-concurrency`): a test or gate workflow has a
  per-ref group with `cancel-in-progress: true`; a publish or deploy workflow
  has a fixed group with `cancel-in-progress: false`. Only a workflow-level
  block covers a whole test workflow; otherwise every job needs its own. A
  group naming the run (`github.run_id`, `run_number`, `run_attempt`), the
  commit or the ref is not fixed, and one keel cannot establish is named;
  `${{ <condition> && '<name>' || <a per-run skip group> }}` is fixed for the
  runs that publish (keel-publish.yml's form, whose condition is exactly its
  choose job's).

**Configuration** (`.keel/keel.json`): `"delivery": { "tested": "green",
"gateWorkflow": "check.yml" }`. `tested` is a branch's short name, never the
default branch; `gateWorkflow` is the workflow whose success on `main` starts
the publisher (its file or the name GitHub shows), default the project's gate
workflow (`ci.gateWorkflow`, else `check.yml`, else the one running the
check). Each error names its key. `"delivery".docsOnly` is the night's gate
(phase 79).

**Its files.** `.github/workflows/keel-publish.yml`, `scripts/keel/publish.mjs`
and `scripts/keel/delivery.mjs` (managed). It requires `night` (the gate
result reader, `scripts/keel/ci.mjs` and `lib.mjs`). Optional: `keel adopt
--with delivery`; its publisher pushes a branch on the project's remote.

**Lineage.** Keel phase 80, from isocan's `release-order.sh` and
`release.yml` publish job (`green`, a queued group, skip the superseded,
refuse the diverged), and isocan's `test/workflows.test.ts` for the
concurrency rule. Adapted, no code copied.
