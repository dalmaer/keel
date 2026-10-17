# Evidence: phase 80 — changes are verified in parallel and published one at a time

- Date: 2026-10-16
- Phase: [80](../phases/80-changes-are-verified-in-parallel-and-published.md)
- Revision: base `29ca49a` (main, phase 79 merged) and working tree on
  `claude/phase-80`.
- Claim being checked: the optional `delivery` practice installs
  `keel-publish.yml`, `scripts/keel/publish.mjs` and `scripts/keel/delivery.mjs`;
  the publisher moves the tested ref (`delivery.tested`, default `green`) only
  to the newest commit on main whose gate passed, chosen from main's history
  and never from its trigger, with a lease; it skips a superseded commit,
  refuses a diverged ref, creates the ref on first use and never writes main;
  the workflow starts only after a successful gate on main, in one queued
  group that is never cancelled; `keel doctor` holds a project's workflows to
  the concurrency rule.

No real project and no network: every repository is a synthetic Acme bare
origin and a clone in a temp directory, and GitHub is a gh stub answering the
Actions API from fixtures.

## Automated checks

`node --import ./tests/helpers/hermetic.mjs --test tests/publish.test.mjs tests/workflows.test.mjs`
(the phase's Proof): 10 and 48 tests, all pass, exit 0. Also run by file, all
exit 0: `tests/doctor.test.mjs` (its phase 80 test), `tests/adopt.test.mjs`,
`tests/guides.test.mjs`, `tests/practices.test.mjs`, `tests/docs.test.mjs`,
`tests/cli.test.mjs`, `tests/init.test.mjs`, `tests/renovate.test.mjs`,
`tests/keel-generated.test.mjs`, `tests/package.test.mjs`. The whole gate,
`npm run check`, was not run by the builder (the session's permission
classifier refused it); it is the conductor's to run on the integrated tree.

| Acceptance box | Test |
| --- | --- |
| 1. moves to a newer passing descendant, skips a superseded commit, fails on a diverged ref, never writes main | `tests/publish.test.mjs` "the publisher moves the tested ref to the newest passing descendant, skips a superseded commit, refuses a diverged ref, and never writes main"; "the lease: a tested ref moved between choosing and advancing is refused …" (also a race inside the push itself, via a git that moves the ref just before `git push`, and a commit not on main); "first use creates the tested ref …"; "a gate result that cannot be read is red …"; "a pull request's run … never counts"; the script test (exit 1 on a diverged ref from `--plan`) |
| 2. two passing commits out of order leave the ref at the newer | `tests/publish.test.mjs` "two passing commits arriving out of order leave the tested ref at the newer one" (C before B, and B before C) |
| 3. A, B, C: B's late run replaces C's pending one; the surviving run advances to C | `tests/publish.test.mjs` "A, B, C: while A's publisher runs, C's run queues and B's late run replaces it; the surviving run still publishes C" (trigger B, result C, line says it did not trust its trigger) |
| 4. the workflow runs only after a successful gate on main and is queued, never cancelled | `tests/workflows.test.mjs` "phase 80: keel-publish.yml runs only after a successful gate on main (or by hand on main), queued in one group and never cancelled; …" (the job's `if:` and the group evaluated for success/failure/cancelled/PR/other-branch/dispatch events; least privilege; nine mutations) and "… names the gate workflow as GitHub does …" |
| 5. the concurrency check flags a test workflow without cancel-superseded and a deploy that can be cancelled | `tests/workflows.test.mjs` "phase 80: the concurrency rule: …" (synthetic Acme test and deploy workflows, every shipped template and keel's own workflows); `tests/doctor.test.mjs` "phase 80: with delivery on, doctor holds every workflow to the concurrency rule …" |
| 6. ⚑ the owner's two pushes | Not run: it waits for the practice to ship to one project. |

### Each guard fails without it

Mutations, one at a time, each reverted (a script that restores the file in
`finally`), running the named test file:

| Mutation (`publish.mjs`, `tests/publish.test.mjs`) | Result |
| --- | --- |
| walk candidates oldest first | exit 1: the move, A-B-C and first-use tests fail |
| drop the diverged check | exit 1: the move and script tests fail |
| drop the moved-since-read check | exit 1: the lease test fails |
| push with `--force` instead of the lease | exit 1: the lease test (the push race) fails |
| read the whole of main, not from the tested ref | exit 1: the pull-request-run test fails |
| drop the "already at the tip" return | exit 1: the move test (superseded B) fails |
| count a failed run as passed | exit 1: the first-use test fails |
| treat an unreadable result as not passed | exit 1: the unreadable test fails |

| Mutation (`delivery.mjs`, `tests/workflows.test.mjs`) | Result |
| --- | --- |
| a test workflow passes without `cancel-in-progress: true` | exit 1: the concurrency rule test fails |
| a publish workflow's cancel-in-progress is not checked | exit 1: both phase 80 workflow tests fail |
| a publish workflow's per-ref group is not checked | exit 1: both phase 80 workflow tests fail |

## Decisions made while building

- **Where the concurrency check lives: `keel doctor`**, rule
  `workflow-concurrency`, only for a project with `delivery` on (and
  `delivery-config` for the keys). Not the ci practice's
  `tests/keel-workflows.test.mjs`: that runs only where keel manages `ci`, and
  isocan and ledger keep their CI local. Not an adopt proposal: adopt runs
  once, doctor every time. A project without delivery is not newly flagged.
- **A run that will not publish gets its own concurrency group**
  (`publish-skip-<run id>`), as keel-cross-review.yml does since ledger#92: a
  failed gate's run would otherwise sit pending in `publish` and replace a
  passing one's pending run.
- **Two jobs for least privilege**: `choose` (contents read, actions read)
  and `advance` (contents write, no API token). Permissions are per job in
  Actions, so "only the step that moves the ref" is that job.
- **The gate result read is the run's, not the ledger's**: `readCiGate` (the
  night's reader: the gate workflow's latest attempt on exactly that commit,
  a push to the default branch, completed) with success as the verdict, no age
  limit, and no `keel-test-runs` artifact required, since a project's own gate
  workflow (isocan's release.yml) keeps none.
- **At most 30** of main's newest first-parent commits are asked per run; a
  first-parent commit that does not descend from the tested ref is never a
  candidate.
- **workflow_run takes names**: render writes the gate workflow's `name:`
  (from `delivery.gateWorkflow`, else the project's gate workflow) into the
  trigger; `check` is the template's.
- **Keel does not enable delivery for itself**: keel deploys nothing, and
  turning it on would push a `green` branch to dalmaer/keel from its Actions,
  a remote change the owner has not asked for.

## Gaps

- The owner's two pushes (⚑) and a real `workflow_run` on GitHub: the
  trigger's name matching, the skip group and the push under `contents: write`
  are read from text and tested with a stub, not observed on GitHub.
- No project's deploy was changed (by design): isocan's Cloud Build already
  follows `green`; ledger's deploy-on-push is documented in
  `docs/guide/delivery.md`, not moved.
