---
status: planned
since: 2026-10-09
goal: G4
spec: 2
depends: [45, 47]
note: "Review comments answered 'tracked' file issues nobody works. An issue labelled keel:agent, written to a rubric (what is wrong, how to see it, how to tell it is mended, nothing only the owner can give, one change), is worked by an agent through climb's sandbox: a PR reviewed by the other provider, the agent's last message posted on the issue, the next run started by the owner's comment. Opt-in with a weekly budget. Design: research/2026-10-09-robot-and-time.md (phase 54)."
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
- **The workflow** `keel-robot.yml` (practice `climb`): on `issues: labeled|reopened` for `keel:agent`, on `issue_comment: created` from someone with write access (confirmed repository write/maintain/admin permission; never a bot), and weekly for anything missed. One issue at a time per project (a concurrency group). The jobs are climb's: agent (read-only), judge, publish. The provider comes from `"agents"`, as climb's does.
- **The result is a PR**, never a push to main: branch `keel/robot-<issue>`, `closes #N`, reviewed by the other provider (phase 45), merged by a person.
- **The issue is the conversation**: keel posts the agent's last message on the issue (what changed, how it knows, the PR; or one question with choices). The owner's comment starts the next run on that issue, with the comment in its brief.
- **Opt-in, with a budget**: off until `.keel/keel.json` has `"robot": { "on": true, "budgetMinutes": <per week> }`. The weekly allowance includes robot-associated build and other-provider review agent-step time. Both are constrained by the remaining allowance. When it runs out or cannot be established, the pass waits, and the board says so.
- **Issues it gets**: `keel review --close … --tracked` can file its issue in the rubric's shape (`--file-agent-issue`); an agent that finds a fault outside its work files one and goes on.

## Acceptance

- [ ] `keel issue new --agent` writes an issue with every rubric field; the triage names each missing field on an issue that lacks it and refuses to work it. `tests/robot-rubric.test.mjs`, `tests/robot-issue.test.mjs`, `tests/robot-runtime.test.mjs`, `tests/robot-budget.test.mjs`
- [ ] `keel-robot.yml` runs only for a `keel:agent` label, a reopen, or a comment from write access (a bot's or a stranger's comment runs nothing); one issue at a time per project. `tests/workflows.test.mjs`
- [ ] The robot's jobs hold every climb sandbox rule for both providers (agent and judge read-only, publish runs nothing from the branch), and the result is a PR on `keel/robot-<issue>` with `closes #N`, never a push to main. `tests/workflows.test.mjs`
- [ ] The agent's last message is posted on the issue; the next run's brief carries the comments since the last run. `tests/robot-rubric.test.mjs`, `tests/robot-issue.test.mjs`, `tests/robot-runtime.test.mjs`, `tests/robot-budget.test.mjs`
- [ ] Off without `"robot": { "on": true }`; past its weekly budget it waits and says so. `tests/robot-rubric.test.mjs`, `tests/robot-issue.test.mjs`, `tests/robot-runtime.test.mjs`, `tests/robot-budget.test.mjs`
- [ ] ⚑ by hand: the owner turns the robot on for one project with a budget, labels three issues, and reads each PR and its review.

## Your part

- **Ask:** Turn the robot on for one project, give it a weekly budget, and label three small issues for it.
- **Why:** It is the only way to see whether an agent working alone, with a second provider reviewing, makes PRs you would merge.
- **Look at:** The three PRs it opens and their reviews.
- **Choices:** Keep it on | Keep it, with a smaller budget | Turn it off
- **Takes:** 20 minutes over a week.
- **Then:** Keep it on: the phase is built, and accepted time proposals (phase 57) start going to it. Smaller budget: the new budget is recorded and the week runs again. Turn it off: what it got wrong goes into this phase's evidence.
- **Ready when:** the robot pass is built and the project has an `OPENAI_API_KEY` or Claude token for its provider.

## Real surfaces

- Workflow shell: `keel-robot.yml` on GitHub Actions, triggered by labels and comments.
- GitHub API: issues, comments, the robot's PRs and their reviews.
- Adopted project: the one the owner turns it on for.

## Proof

Automated: `node --test tests/robot-rubric.test.mjs tests/robot-issue.test.mjs tests/robot-policy.test.mjs tests/robot-budget.test.mjs tests/robot-runtime.test.mjs tests/robot-delivery.test.mjs tests/robot-workflow.test.mjs tests/workflows.test.mjs tests/review.test.mjs tests/board.test.mjs` (a stubbed gh: labels, comments with permitted, denied and unavailable permission lookups, the posted message, the budget); `npm run check`.
By hand: three issues worked on a real project, read by the owner.
⚑ Model spend per issue, within the owner's weekly budget.

## Deliberately open

- **Settled 2026-10-10: extend the existing practice.** Robot files ship with `climb`; no second practice or tracking system is introduced. Configuration remains `robot: {on: true, budgetMinutes: N}` and the queue label remains `keel:agent`. The allowance covers build and review.
- **Settled 2026-10-10: issue creation is reviewable and recoverable.** `keel issue new --agent --title <title> --rubric <file>` previews before `--yes`. Review creation uses `--close <one-id> --tracked --file-agent-issue --title <title> --rubric <file>`; bare `--tracked` is legal only in this creation mode, and a supplied tracking reference cannot be combined with it. Fresh review receipts are validated before creation. Robot-off issues are unlabelled; unknown target policy cannot enable work. A durable instance intent precedes creation, and ambiguous writes are recovered by exact identity rather than blindly retried.

- **Settled 2026-10-09: review is part of the robot.** Publication must explicitly invoke a trusted other-provider review path for the actual PR head, including continuations. A robot branch prefix or bot-created PR alone does not prove review ran. Missing other-provider credentials blocks the promised review rather than silently self-reviewing. The weekly budget includes both build and review agent-step time. [GitHub's token rules](https://docs.github.com/en/actions/concepts/security/github_token) place token-created PR runs behind approval; an explicit trusted invocation is needed for the unattended path.

- **Settled 2026-10-09: permission is checked, not inferred.** OWNER/MEMBER/COLLABORATOR association is only an early event filter; it does not prove repository write access. The trusted runtime checks the sender's current write/maintain/admin permission, rejects bots and fails closed when permission cannot be read.

- **Whether the robot merges its own reviewed PR**: never, for now. A person merges. Revisited after the owner's week.
- **Issues across the fleet**: one project first. Settled by the week.

## Next action

Write the rubric into the agent guide and `keel issue new --agent`; then brief a builder on `keel-robot.yml` from climb's jobs.
