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

This installs `.github/workflows/keel-publish.yml`, `scripts/keel/publish.mjs`,
`scripts/keel/delivery.mjs`, `scripts/keel/verify.mjs` and
`scripts/keel/promote.mjs` (it needs the
`night` practice, whose CI reader and morning brief it uses). In
`.keel/keel.json`, all optional:

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
  publish run that moved nothing also completes, so the deploy skips a
  commit production already has (`verify.mjs live`, below). Keep its
  concurrency one fixed group with `cancel-in-progress: false`.

Then a commit reaches production only after its gate passed, and two changes
in a row deploy once, the newer.

## Checking production by the commit it serves

A deploy command's exit code says the command finished, not that production
serves the change. After a deploy, keel asks production which commit it serves
and waits until that is the deployed commit or a descendant, then runs the
project's smoke checks (after ledger's `verify-production.mjs`). In
`.keel/keel.json`:

```json
"delivery": {
  "site": "https://anvils.acme.example",
  "version": "/api/version",
  "smoke": ["/", { "path": "/login", "status": 307 }, { "path": "/health", "status": [200, 204] }]
}
```

- `site`: the production origin; https (http only on localhost or 127.0.0.1).
  `--site <origin>` overrides it, for a preview.
- `version`: the path that reports the serving commit. keel accepts, from an
  HTTP 2xx answer of at most 64 KiB: a JSON object with a `sha` or a `commit`
  field (both: they must agree), a JSON string, or plain text that is the hash
  alone. The hash is a full one (40 hex, or 64 for SHA-256), any case. A
  short hash, a redirect or anything else is "cannot read", never a guess.
- `smoke`: up to 50 checks, each a path (expects 200) or `{ "path", "status" }`
  with a code or a list of codes. Redirects are not followed: a `307` is
  checked as a `307`. Smoke checks are status codes, not end-to-end journeys.

`site` is required with `version` or `smoke`. A bad value is an error naming
its key, from the verifier (exit 2) and from `keel doctor` (`delivery-config`).

```bash
node scripts/keel/verify.mjs <sha> [--within 600] [--every 10] [--record] [--json]
node scripts/keel/verify.mjs live <sha> [--json]
```

- **verify** reads the version path every `--every` seconds until production
  serves the commit or a descendant (`git merge-base --is-ancestor` in this
  checkout, which needs full history; a commit it lacks is fetched from origin
  once, and one it still lacks is never "yes"), or `--within` seconds pass;
  then reads each smoke path once. It passes (exit 0) only on what it saw;
  otherwise it fails (exit 1), naming each check that did not hold: what
  production served, after how many reads, and each smoke path's expected and
  actual status.
- **live** reads the version path once: exit 0 when production already
  serves that commit or a descendant, 1 otherwise, including when it cannot
  read it. A deploy step skips itself on yes, then verifies:

  ```yaml
  - name: Deploy, unless production already has it
    env:
      SHA: ${{ steps.tested.outputs.sha }}
    run: |
      if node scripts/keel/verify.mjs live "$SHA"; then echo "already live"; else ./deploy.sh; fi
  - name: Verify production
    env:
      SHA: ${{ steps.tested.outputs.sha }}
    run: node scripts/keel/verify.mjs "$SHA" --record
  ```

  The job that records needs `contents: write` (it pushes one data branch) and
  a checkout with `fetch-depth: 0`.

**Where the result goes.** `--record` adds the result to the branch
`keel-verify`, file `verify.json` (newest first, the last 30, and every failure of the last 72 hours so a burst of passes never drops one before its brief reads it, and the latest result of each site whatever its age, so production's last verify is never lost to previews; each with the
commit, the outcome, the time, the site, what production served, each failure
and the Actions run), with a lease; a file there that is not a verify record
is never replaced, nor is a `keel-verify` branch with no `verify.json`; every other file on the branch is kept. With the delivery practice on, the night's morning brief
and `keel board` read it:

- **The board**: when the latest verify failed, an owner's item, "production
  failed its verify for `<sha>`", with each failure and the run. A later pass
  clears it. Only production's results count (their site is `delivery.site`):
  a preview's pass (`--site`) never clears production's failure. A record that
  cannot be read is the `verify` source n/a, with why.
- **The morning brief**: each verify that failed in the day before the night
  started (07:23 UTC to 07:23 UTC) is a line first under "Your next", so every
  failure reaches one brief, once, and says when the same site has passed
  since. A preview's failure is said as the preview's.
  A record it cannot read is said there too, never silence.

A project may add its own channel (ledger's Telegram alert) beside these.

## Promoting production

Where a project promotes by hand (isocan moves a `prod` tag, and its deploy
follows the tag), `keel promote` is that gesture with a guard on it. Name the
ref in `.keel/keel.json`:

```json
"delivery": { "promote": "tag:prod", "site": "https://anvils.acme.example", "version": "/api/version" }
```

`promote` is `"tag:<name>"` or `"branch:<name>"` (never the default branch, nor
the tested ref), or `"none"`; a project without one has no promote. It needs
`site` and `version`, because every promotion ends in a verify.

```bash
keel promote                    # preview: the tested ref's tip; nothing moves (exit 3)
keel promote <commit> --yes     # move production there, then verify it
keel promote --back <commit>    # preview a rollback; --yes to do it
```

**The guard**, before anything moves. Each refusal names why and exits 1:

- the commit is on the tested ref as origin has it now (its tip or an
  ancestor of it). A commit on `main` the publisher has not passed through,
  or one off `main`, is refused;
- its gate passed: phase 79's result, the same one the night reuses. That
  is CI's exact, clean, successful run of the gate workflow on that commit
  (`delivery.gateWorkflow`, else `ci.gateWorkflow`), with `keel-test-runs`
  records showing the gate's command passing with tests. The 24-hour reuse
  window does not apply here: a commit tested last week is still tested;
- forward never moves production to an ancestor of what it serves now (that
  is `--back`), and `--back` only does.

**The preview** shows the commit, what production is now, each commit that
reaches production (or, going back, leaves it), the gate run that passed and
the verify that will follow. `--yes` moves the one ref, with a lease on the
value it read, so a ref someone moved meanwhile is refused, not overwritten.

**After moving** it runs `verify.mjs`: production must report the commit or a
descendant within `--within` seconds (default 600), then pass its smoke
checks. A failure says what production served and suggests `keel promote
--back <what production was>` when that command can do it. After a sideways
move (production was off the tested line) it cannot, so it names the `git
push` that restores the previous ref by hand instead. It never moves
anything itself. Run again with the ref already in place, it pushes nothing
and verifies production again (exactly, for `--back`).

**Rolling back verifies the exact commit.** Going forward, a descendant
serving is fine. Going back it is the failure: production still serving the
newer commit would contain the older one. So `--back` passes only when
production reports exactly the commit it went back to (`verify.mjs
--exact`), within the same bounded wait.

**Who.** It runs on the owner's machine with their git credentials. It
refuses to run in GitHub Actions, and no workflow keel installs runs it
(`tests/workflows.test.mjs`). Deciding when to promote is still a person's
call. isocan's "not while somebody is presenting" is one keel does not
encode. Anyone who can push the tag can still move it by hand: keel guards
its own command, not the ref.

## The concurrency rule

With delivery on, `keel doctor` reads every workflow in `.github/workflows`
and reports `workflow-concurrency` when:

- a **test or gate workflow** (the gate workflow, or one named test, check,
  ci or gate) has no concurrency group per ref (`${{ github.ref }}`) with
  `cancel-in-progress: true`: superseded test runs keep running;
- a **publish or deploy workflow** (named publish, deploy, release or promote)
  has no concurrency group, a group per ref, commit or run (`github.run_id`,
  `github.run_number`, `github.run_attempt`), or `cancel-in-progress` other than `false`: a
  deploy can be cancelled midway, or two can run at once. A group expression
  keel cannot establish is fixed (one reading `inputs.environment`, say) is
  named, never passed; a literal, `github.workflow`, `github.repository` and
  `vars.*` are fixed, and so is `${{ <condition> && '<name>' || <a per-run
  skip group> }}` when every job the group covers runs on that condition
  alone: its `if:` is the condition, or it needs a job whose `if:` is (and
  has no `always()`, `failure()` or `cancelled()`), so a run in the fallback
  group publishes nothing (keel-publish.yml's form: its choose job's `if:`
  is the group's condition, and advance needs choose). On an unconditional
  job, `${{ github.run_attempt == 1 && 'deploy' || … }}` is named: a retry
  would deploy in a group of its own.

Only a workflow-level block covers a whole test workflow. Without one, every
job needs its own per-ref, cancelling block: one compliant `unit` job does not
cover an `integration` job with none.

A workflow named neither way is not checked. A gate workflow that also
publishes (isocan's `release.yml`) is held as a publisher.

## Sessions hand off; one integrator runs the gate

Before a change reaches `main` at all, two sessions can each run the full gate
on their own change and push. Phase 83 makes that one run:

- A session finishes with `keel ready`: it runs only the fast checks
  (`"delivery": {"fast": ["node --test tests/x.test.mjs"]}` and each
  `--check "<cmd>"`), pushes its branch and records `ready/<branch>`. It
  refuses to run the full gate.
- `keel integrate` takes the lock `claims/integrate` (the phase claim's
  create-only push; a second integrator exits 1 and leaves the work to the
  first), merges every ready change onto `main` in a temporary worktree, runs
  the full gate (`check`, default `npm run check`) once and pushes once.
- When the batch fails, it accumulates by halves rather than only splitting:
  each change is kept only on top of what was kept before it, so two changes
  that pass alone and fail together are told apart (one lands, the other is
  sent back as conflicting with it). The tree it pushes is always one the
  gate passed.
- A change sent back keeps its `ready/` ref, marked blocked with the reason,
  until its session fixes it and runs `keel ready` again.

`keel --agent-help improve` ("Ready and integrate") has the JSON.

## What it does not do

- The publisher does not merge, and never writes `main`; `keel integrate`
  does, and only with a tree its gate passed. The verifier writes only the
  `keel-verify` data branch, and only with `--record`. `keel promote` writes
  only the production ref, and only with `--yes`.
- It does not promote on its own. No workflow runs `keel promote`.
- The publisher does not batch untested commits into one test run; "newest
  passing wins" is its batching. `keel integrate` batches ready changes
  before `main` (above).
- A merge queue is an alternative a project may add; keel does not require it.
