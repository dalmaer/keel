# Delivery: verify in parallel, publish one at a time

**The situation.** You ask for one change, then another. The first lands and
starts the whole path: test, build, deploy. The second lands a minute later
and starts it again. Two expensive runs, and if the older one finishes last it
deploys over the newer. Or the deploy follows `main` itself, so a commit
reaches production before its tests have passed.

Keel's answer, after isocan's `release-order.sh` and its `green` ref, is three
rules (the design is
[docs/research/2026-10-16-delivery.md](../research/2026-10-16-delivery.md)):

1. **Many commits test at once; one publisher at a time moves a tested ref.**
   The tested ref (`green` by default) only ever moves forward, to the newest
   commit on `main` whose gate passed. A commit a later one has already passed
   is skipped.
2. **Deploys follow the tested ref, never `main`.**
3. **Tests cancel the superseded; deploys never cancel.**

## Turning it on

```bash
keel adopt --with delivery
```

This installs `.github/workflows/keel-publish.yml`, `scripts/keel/publish.mjs`
and `scripts/keel/delivery.mjs` (it needs the `night` practice, whose CI
reader it uses). In `.keel/keel.json`, all optional:

```json
"delivery": { "tested": "green", "gateWorkflow": "check.yml" }
```

- `tested`: the branch the publisher moves. Never `main` (the publisher never
  writes the default branch).
- `gateWorkflow`: the workflow whose success on `main` counts as "the gate
  passed" (its file, or the name GitHub shows). Default: the project's gate
  workflow (`ci.gateWorkflow`, else `check.yml`, else the workflow running
  the check). Render writes its name into the publisher's trigger.

A bad value is an error naming its key, from the publisher (exit 2) and from
`keel doctor` (`delivery-config`).

## What the publisher does

`keel-publish.yml` starts when the gate workflow finishes on `main` after a
push, or by hand from `main` (a workflow dispatch). Its runs share one
concurrency group, `publish`, never cancelled. GitHub keeps only one *pending*
run per group, so a late trigger can replace a newer one: commits A, B and C
land; while A's publisher runs, C's gate finishes, then B's, and B's run
replaces C's in the queue. So the publisher never trusts the commit that
started it. Each run:

1. reads `main` and the tested ref from the remote;
2. fails red, moving nothing, if the tested ref is not an ancestor of `main`
   (it has diverged; put it back by hand);
3. walks `main`'s first-parent history from the tip back to the tested ref,
   newest first, and asks each commit's gate result (the gate workflow's
   latest attempt on exactly that commit, a push to the default branch). The
   first that succeeded is chosen; a failed, cancelled, pending or missing run
   is skipped; a result it cannot read is red;
4. moves the tested ref there with a lease on the value it read (the ref is
   created on first use). Already at `main`'s tip, or nothing newer passed:
   it does nothing.

In the A, B, C case the surviving run, started by B, publishes C.

By hand, in a checkout with `gh` signed in:

```bash
node scripts/keel/publish.mjs --json          # choose and move
node scripts/keel/publish.mjs --plan --json   # choose only; moves nothing
```

The workflow runs these as two jobs. `choose` reads (`contents: read`,
`actions: read`) and runs `node scripts/keel/publish.mjs --plan --trigger
<sha>`; the trigger is recorded, never used. `advance`, the only job with
`contents: write`, calls no API and runs `node scripts/keel/publish.mjs
--advance --from <sha|none> --to <sha>`, which re-checks that the commit is
on `main` and descends from the tested ref, and that the ref has not moved,
before it pushes. Exit codes: 0 moved, created or nothing to do; 1 refused;
2 configuration or usage.

## Making a deploy follow the tested ref

Keel does not deploy; each project keeps its own mechanism. It only has to
start from the tested ref instead of `main`:

- **A deploy service outside GitHub Actions, watching a branch** (isocan's
  Cloud Build trigger): point the trigger at the tested ref. isocan already
  deploys its dev home on a push to `green`; nothing else changes. A push by
  the publisher reaches such a service like any other push.
- **A GitHub Actions workflow that deploys** (ledger's `deploy.yml` on every
  push to `main`): start it on the publisher finishing, **never on a push to
  the tested ref**. The publisher pushes with the workflow's own
  `GITHUB_TOKEN`, and GitHub starts no workflow for a push made with that
  token, so an `on: push` to `green` would never run. Instead:

  ```yaml
  on:
    workflow_run:
      workflows: [keel-publish]
      types: [completed]
  ```

  with the job guarded on `github.event.workflow_run.conclusion == 'success'`,
  checking out the tested ref (`ref: green`), not the event's commit. A
  publish run that moved nothing also completes, so the deploy may skip a
  commit production already has (phase 81). Keep its concurrency one fixed
  group with `cancel-in-progress: false`.

Then a commit reaches production only after its gate passed, and two changes
in a row deploy once, the newer.

## The concurrency rule

With delivery on, `keel doctor` reads every workflow in `.github/workflows`
and reports `workflow-concurrency` when:

- a **test or gate workflow** (the gate workflow, or one named test, check,
  ci or gate) has no concurrency group per ref (`${{ github.ref }}`) with
  `cancel-in-progress: true`: superseded test runs keep running;
- a **publish or deploy workflow** (named publish, deploy, release or promote)
  has no concurrency group, a group per ref or commit, or
  `cancel-in-progress` other than `false`: a deploy can be cancelled midway,
  or two can run at once.

A workflow named neither way is not checked. A gate workflow that also
publishes (isocan's `release.yml`) is held as a publisher.

## What it does not do

- It does not merge, and never writes `main`.
- It does not batch untested commits into one test run; "newest passing wins"
  is the batching (agent sessions handing off to one integrator is phase 83).
- A merge queue is an alternative a project may add; keel does not require it.
