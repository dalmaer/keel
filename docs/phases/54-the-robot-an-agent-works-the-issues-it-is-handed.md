---
status: partial
owes: walk
since: 2026-10-09
goal: G4
spec: 2
depends: [45, 47]
note: "Built: keel-robot.yml (practice climb) works the issues labelled keel:agent through climb's three jobs, one at a time per project, on the label, a reopen, a writer's comment and Mondays; an issue missing a rubric field gets one comment and is not worked; the result is a PR on keel/robot-<issue> (Closes #N) and the agent's last message on the issue; off without robot.on, and it waits past its weekly budget. keel issue new --agent writes the rubric. Owes the walk: the owner turns it on for one project and reads three PRs and their reviews. Design: research/2026-10-09-robot-and-time.md (phase 54)."
evidence: []
issue: 41
---

# The robot: an agent works the issues it is handed

## Done when

An issue labelled `keel:agent` that meets the rubric is worked by an agent with no person starting it: a PR through climb's sandbox, reviewed by the other provider, the agent's last message posted on the issue, and the owner's comment starting the next run; on a project with the pass turned on and a budget set, three such issues have been merged.

## Scope

The design is [The robot, and keel's sense of time](../research/2026-10-09-robot-and-time.md), phase 54.

- **The rubric**, in the agent guide and the issue template: what is wrong and how to see it (a command, a test, the steps); how to tell it is mended; nothing only the owner can give (no product choice, no secret, no exit-3 step); one change that fits a run; nothing waiting on unpushed work. `keel issue new --agent` writes one in that shape.
- **The triage**: an issue the owner labels that misses part of the rubric gets one comment naming what is missing, and is not worked.
- **The workflow** `keel-robot.yml` (practice `climb`): on `issues: labeled|reopened` for `keel:agent`, on `issue_comment: created` from someone with write access (OWNER, MEMBER, COLLABORATOR; never a bot), and weekly for anything missed. One issue at a time per project (a concurrency group). The jobs are climb's: agent (read-only), judge, publish. The provider comes from `"agents"`, as climb's does.
- **The result is a PR**, never a push to main: branch `keel/robot-<issue>`, `closes #N`, reviewed by the other provider (phase 45), merged by a person.
- **The issue is the conversation**: keel posts the agent's last message on the issue (what changed, how it knows, the PR; or one question with choices). The owner's comment starts the next run on that issue, with the comment in its brief.
- **Opt-in, with a budget**: off until `.keel/keel.json` has `"robot": { "on": true, "budgetMinutes": <per week> }`. When the budget runs out the pass waits, and the board says so.
- **Issues it gets**: `keel review --close … --tracked` can file its issue in the rubric's shape (`--file-agent-issue`); an agent that finds a fault outside its work files one and goes on.

## Acceptance

- [x] `keel issue new --agent` writes an issue with every rubric field; the triage names each missing field on an issue that lacks it and refuses to work it. `tests/robot.test.mjs`
- [x] `keel-robot.yml` runs only for a `keel:agent` label, a reopen, or a comment from write access (a bot's or a stranger's comment runs nothing); one issue at a time per project. `tests/workflows.test.mjs`
- [x] The robot's jobs hold every climb sandbox rule for both providers (agent and judge read-only, publish runs nothing from the branch), and the result is a PR on `keel/robot-<issue>` with `closes #N`, never a push to main. `tests/workflows.test.mjs`
- [x] The agent's last message is posted on the issue; the next run's brief carries the comments since the last run. `tests/robot.test.mjs`
- [x] Off without `"robot": { "on": true }`; past its weekly budget it waits and says so. `tests/robot.test.mjs`
- [ ] ⚑ by hand: the owner turns the robot on for one project with a budget, labels three issues, and reads each PR and its review.

## Your part

- **Ask:** Turn the robot on for one project (`"robot": { "on": true, "budgetMinutes": <minutes a week> }`), give it a weekly budget, and label three small issues `keel:agent` (written with `keel issue new --agent`, or the issue template). With cross-review on, add `"keel/robot-"` to its `for` and comment `/review` on each PR.
- **Why:** It is the only way to see whether an agent working alone, with a second provider reviewing, makes PRs you would merge.
- **Look at:** The three PRs it opens, their reviews, and the agent's last message on each issue.
- **Choices:** Keep it on | Keep it, with a smaller budget | Turn it off
- **Takes:** 20 minutes over a week.
- **Then:** Keep it on: the phase is built, and accepted time proposals (phase 57) start going to it. Smaller budget: the new budget is recorded and the week runs again. Turn it off: what it got wrong goes into this phase's evidence.
- **Ready when:** the robot pass is built and the project has an `OPENAI_API_KEY` or Claude token for its provider, and the `keel:agent` label exists there.

## Real surfaces

- Workflow shell: `keel-robot.yml` on GitHub Actions, triggered by labels and comments.
- GitHub API: issues, comments, the robot's PRs and their reviews.
- Adopted project: the one the owner turns it on for.

## Proof

Automated: `node --test tests/robot.test.mjs tests/workflows.test.mjs` (a stubbed gh: labels, comments from each association, the posted message, the budget); `npm run check`.
By hand: three issues worked on a real project, read by the owner.
⚑ Model spend per issue, within the owner's weekly budget.

## Deliberately open

- **Whether the robot merges its own reviewed PR**: never, for now. A person merges. Revisited after the owner's week.
- **Issues across the fleet**: one project first. Settled by the week.
- **The review starts on a `/review`**: a PR the workflow's token opens starts no other workflow (GitHub's rule), so cross-review does not start on a robot PR by itself. Its reviewer is right (a robot PR's body names its author, so the other provider reviews it), but someone with write access comments `/review`. A dispatch from the robot's publish job (cross-review taking `workflow_dispatch`) is the follow-up, settled by the owner's week.
- **`keel review --close … --tracked --file-agent-issue`**: not built. It would grow `keel review` (a write on another verb's path) beyond this phase; `keel issue new --agent` files the same shape by hand meanwhile. Settled when tracked answers start piling up unworked.
- **The board saying the robot waits**: the run says so (a green notice naming the minutes used and the day it starts again) and the night's Budget line shows the robot's runs, but `keel board` does not read the robot's week yet. Settled when the owner looks for it there.
- **An agent filing a fault outside its work**: the robot's agent cannot reach gh, so it names the fault in its last message ("Also found"); an agent with gh files it with `keel issue new --agent` (the agent guide says so).

## Next action

⚑ The walk: the owner turns the robot on for one project with a weekly budget, labels three small issues `keel:agent`, and reads each PR, its review and the agent's message on the issue.

## Trajectory

- **2026-10-09** — The rubric has one home, `scripts/keel/rubric.mjs` (climb practice, no imports): `keel issue new --agent` imports it from the practice tree, robot.mjs triages with it, and the issue template is it unfilled. The three boxes (nothing only the owner can give, one change, nothing unpushed) are ticked boxes under `## For an agent`; a comment never fills a field, editing the body does.
- **2026-10-09** — The event only wakes the robot: `robot.mjs pick` reads the labelled issues and chooses the oldest never worked or with a writer's comment (or a reopen, or the label again) since its last run, the robot's own marked comment. So a queued run that GitHub replaces loses nothing, and the concurrency group is one per project (`keel-robot-queue`), with a run that will not work in a group of its own, as cross-review's.
- **2026-10-09** — Each run starts from the default branch, not from the open robot PR: running the PR's code where the setup token is would break ledger#92's rule. The brief carries the open PR's diff instead, and the push replaces the PR's commits.
- **2026-10-09** — The triage is posted by the publish job, which reads each issue again (`robot.mjs triage --post`) from the pick's issue numbers, never from anything the agent's job handed on: the agent could have written its hand-off.
- **2026-10-09** — The weekly use counts every run whose agent step ran, an agent that stopped with an error too (it spent its minutes), unlike the Budget line's per-run suggestion, which skips a run whose agent never started. `"robot"` joined `AGENT_PASSES`, the adapters' passes and the Budget line (`runMinutes`, the per-run box: a pass's `field` and `on`).
- **2026-10-09** — robot.mjs keeps its own copy of climb.mjs `lastResult`: climb.mjs loads robot.mjs for `guard --job robot`, and an import back under climb.mjs's top-level await never settled (the run hung, exit 13).
- **2026-10-09** — PR #59's reviews (Codex, twice) found five holes, each fixed with a test: an evidence file deleted passed the record rules (deletions were skipped before the evidence check); a dispatch from another branch made that branch's tip the trusted base (dispatch now runs from the default branch only); the run's mark was posted when the judge job failed before judging (publish now posts only on the judge step's own outcome); an owner's comment made while a run worked was dropped (the mark carries the pick's cursor, `read=`); and a rerun's earlier attempts dropped out of the week's spend (every attempt is read, each job counted in its own).
- **2026-10-09** — PR #59's second round, each fixed with a test: the run's mark waits for publishing (a failed push or PR leaves the issue to be tried again); the week's spend counts each attempt by when its agent step started, a rerun of a run created up to 30 days back and this run's own earlier attempts too; `keel issue new --agent` on another repo than the project's is a ⚑ step (exit 3 until `--yes`); the brief is bounded (each comment 4,000 characters, 16,000 in all, the body 16,000, each cut said); the cursor compares to the second and the mark names the comments it read in that second (`seen=`); and a robot PR's body names its author (`<!-- keel:robot agent=… -->`), which cross-review reads before `"robot".agent`.
- **2026-10-09** — PR #59's final review: a guard checked HEAD, then ran the agent's code (the gate), which could commit and exit 0, and the report and the push took the new HEAD. Every guard (the robot's, tend's, climb's main and proposals paths) now snapshots HEAD and the tracked tree before the agent's code runs and refuses if either moved (`tend.mjs` `treeState`, `heldProblems`). The robot's judge names the commit it takes before any of that code runs, and the report, the bundle and publish use that commit. Publish refuses any other head and holds the record rules itself (`climb.mjs sandbox --records`, git alone). No PR open after publishing is now a failure, so the issue is not marked worked. Climb's and tend's publish jobs still recheck only `sandbox`: a gate that tampers with git or the scripts on disk after the guard returns is caught there by nothing but their judge's tree check.
- **2026-10-09** — PR #59's last two: the robot's gate is judged as climb's is, by one shared `climb.mjs` `ledgerCheck` (the test ledger's records of the candidate's gate against the base's own, run in a worktree of the base), so a gate script the branch rewrote (`true`, `|| true`, fewer tests) is refused; climb's guard gains the same checks for a failing test hidden by an exit 0 and for a candidate gate that records nothing. And the label approves the body: an issue whose body was edited after a person last labelled it, by anyone but that person or an author with write access (GitHub's `lastEditedAt` and `editor`), gets one comment and is not worked until a writer labels it again.
- **2026-10-09** — PR #59: the record rules read git's paths NUL-delimited (`tend.mjs` `changesOf`, `pathsOf`), so a path git quotes (`docs/evidence/é.md` under the default core.quotePath) is checked as itself; and front matter and boxes are read with a BOM dropped and CRLF as LF, so a phase converted to CRLF on its way to built is still refused. Shared by the robot's guard, `sandbox --records`, tend's guard and climb's proposals rules.
- **2026-10-09** — PR #59: write access is GitHub's permission (`collaborators/<login>/permission`: write, maintain or admin), read once per login with the run's token, never `author_association` (MEMBER is anyone in the org). The workflow's `if:` keeps the association only as a pre-filter; the script decides who commented, labelled or reopened with write access, and a reopen by anyone else sends nothing back. And `recordRules` refuses deleting a phase, project or decision record, as it refuses deleting evidence.
