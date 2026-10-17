# Evidence: phase 79 — one gate result per commit, shared by every pass

- Date: 2026-10-16
- Phase: [79](../phases/79-one-gate-result-per-commit-shared-by-every-pass.md)
- Revision: base `755044a` (release v0.8.31) and working tree on
  `claude/phase-79`.
- Claim being checked: `scripts/keel/gate.mjs` reuses CI's result for a commit
  only when the run's `keel-test-runs` records prove a passing gate of the
  same command on that exact clean tree with tests that ran; the night, the
  loop's gate step and a pre-push hook use it, CI's own step never reuses; a
  docs-only commit records a skip against the last fully tested commit; CI's
  gate workflow keeps the records and adoption proposes the upload for a
  project's own CI.

No real project and no network: every repository is a synthetic Acme one in a
temp directory, and GitHub is a gh stub answering the Actions API and a real
deflated ZIP of fixture records.

## Automated checks

`node --import ./tests/helpers/hermetic.mjs --test tests/gate-reuse.test.mjs tests/workflows.test.mjs tests/adopt.test.mjs`
(the phase's Proof) and the files whose tests changed with it
(`tests/ci.test.mjs`, `tests/loop.test.mjs`, `tests/time-improve.test.mjs`):
all pass, exit 0. The whole gate, `npm run check`, ran on the integrated tree
before the commit; its result line is in the commit body.

| Acceptance box | Test |
| --- | --- |
| 1. the gate workflow uploads `keel-test-runs` red or green; adoption proposes it | `tests/workflows.test.mjs` "check.yml keeps each run's test ledger as an artifact, red or green; …" (existing) and "check.yml's gate is gate.mjs --ci, kept as the artifact after it, read-only; …"; `tests/adopt.test.mjs` "a project's own CI that keeps no gate result gets the test ledger's upload proposed, never written (phase 79)" (acme-groove's pages.yml; the proposed step is check.yml's byte for byte; the workflow is left unchanged; none proposed where the upload is there) |
| 2. every pass reuses an exact, clean, successful result and runs only without one, saying which | **Not ticked.** Proven for the night (`tests/gate-reuse.test.mjs` "the night's gate measure reuses through the same function …"), the loop's shipped shell and the pre-push helper ("the loop's gate step and the pre-push helper: …"), the function itself ("the gate reuses an exact, clean, successful CI result for HEAD and says so; without one it runs, saying why") and CI's step ("CI's own gate step (--ci) never reuses …"). climb's guard and the robot's judge still run their own base gate: see Gaps. |
| 3. another command, another tree, a run with no tests is never reused | `tests/gate-reuse.test.mjs` "a result for another command, another tree, a dirty tree, or a run with no tests is never reused" (18 record shapes) and "CI runs that are not an exact, completed, successful, recent result of the gate are never reused" (failure, cancelled, >24h, PR event, no/two/expired/foreign artifact, digest mismatch, unreadable archive, dirty local tree, no gateWorkflow, no repo) |
| 4. a doc-only commit records a skip; anything else runs | `tests/gate-reuse.test.mjs` "a docs-only commit records "skipped: docs only"; a commit touching anything else runs the suite", "docs-only is decided against the last fully tested commit, never the parent: a cancelled code run is never covered", "delivery.docsOnly is a list of repo-relative paths that never covers code …" |
| 5. ⚑ the owner's week of CI minutes | Not run: it waits for a week after this ships. |

### Each guard fails without it

Mutations of `practices/night/files/scripts/keel/gate.mjs`, one at a time,
each reverted (file identical to the committed one afterwards), running
`tests/gate-reuse.test.mjs`:

| Mutation | Result |
| --- | --- |
| drop the command-hash check | exit 1: "a result for another command, …" fails |
| drop the tree check | exit 1: the same test fails |
| drop "no test ran" | exit 1: the same test fails |
| drop the dirty-record check | exit 1: the same test fails |
| drop the failed-test check | exit 1: the same test fails |
| docs-only accepts the nearest docs-only ancestor without CI's result | exit 1: "docs-only is decided against the last fully tested commit, never the parent …" fails |
| treat a dirty tree as clean | exit 1: the night, loop and docs-only tests fail |
| let `--ci` reuse | exit 1: "CI's own gate step (--ci) never reuses …" fails |
| pass CI's read token to the check | exit 1: "check.yml's gate step runs gate.mjs --ci with a read-only token it keeps from the check …" fails (the check exits 9, not 7) |

### PR #174 review: a protected path is never docs only (2026-10-16)

The config check tested seven sample paths, so `docsOnly: ["scripts/keel/test-ledger.mjs"]`
or `[".github/workflows/keel-night.yml"]` was accepted and a clean commit
changing only that file skipped the gate. Now `protectedPath` refuses, when
classifying changed paths, all of `.github/` and `scripts/keel/`, the repo's
config and version files, a manifest, lockfile or package-manager config at any
depth, and the managed files of HEAD's committed `.keel/lock.json` (decided:
read the committed lock, not the working tree's; a changed lock is itself
protected). The config refusal checks each entry against those sets
structurally. `tests/gate-reuse.test.mjs` "a docs-only list that reaches a
protected path is refused at config time, structurally" and "a protected path
is never docs only when changed, even if a pattern slipped through" fail
without the fix (`keel prove`, the commit's Proven-by trailer).

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| A real CI run of keel's check.yml reused by a real night | the night's gate line names the run | Not run | the first push after merge shows it; nothing here proves the live API shapes beyond the fixtures |
| The owner's week of CI minutes | fewer minutes | Not run | box 5 |

## Gaps and decision

- **The judges' base gates do not reuse.** climb's guard (`baseLedger`) and
  the robot's judge run the gate on the base, which is the commit CI tested.
  The judge job holds no token by design, the agent's code runs in that same
  step, and the robot's judge strips `GITHUB_*` from the gate's env, so CI's
  run is not like for like there. Their candidate gates and tend's guard test
  trees CI never saw and rightly run.
- The night no longer reuses on a job's name alone, and no longer reuses a red
  CI result: it runs its own gate in both cases (stronger, at the cost of a
  run on a red night).
- Supports **partial**, not built: box 2 and the owner's week remain.
