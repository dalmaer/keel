---
status: partial
owes: walk
waits: owner
since: 2026-10-10
goal: G4
spec: 2
depends: [45, 47]
note: "Implemented opt-in issue robot, trusted build/judge/publish, shared build/review budget, permission checks and recoverable issue/publication state. Automated proof and read-only APIs verified; owner project/budget and three real reviewed/merged issues remain owed."
evidence: ["evidence/2026-10-10-robot.md"]
issue: 41
---

# The robot: an agent works the issues it is handed

## Done when

An issue labelled `keel:agent` that meets the rubric is worked by an agent with no person starting it: a PR through climb's sandbox, reviewed by the other provider, the agent's last message posted on the issue, and the owner's comment starting the next run; on a project with the pass turned on and a budget set, three such issues have been merged.

## Scope

The design is [The robot, and keel's sense of time](../research/2026-10-09-robot-and-time.md), phase 54.

- **The rubric**, in the agent guide and the issue template: what is wrong and how to see it (a command, a test, the steps); how to tell it is mended; nothing only the owner can give (no product choice, no secret, no exit-3 step); one change that fits a run; nothing waiting on unpushed work. `keel issue new --agent` writes one in that shape.
- **The triage**: an issue the owner labels that misses part of the rubric gets one comment naming what is missing, and is not worked.
- **The workflows** (practice `climb`): `keel-robot-route.yml` checks public label/reopen/comment events against fresh repository write/maintain/admin permission and issue identity, then dispatches `keel-robot.yml`. The worker revalidates the trigger and active label provenance; it runs weekly for missed work. Public router runs never share the worker queue or budget history. The worker handles one issue at a time: agent (read-only), judge, publish, then independent review. The provider comes from `"agents"`, as climb's does.
- **The result is a PR**, never a push to main: branch `keel/robot-<issue>`, `closes #N`, reviewed by the other provider (phase 45), merged by a person.
- **The issue is the conversation**: keel posts the agent's last message on the issue (what changed, how it knows, the PR; or one question with choices). The owner's comment starts the next run on that issue, with the comment in its brief.
- **Opt-in, with a budget**: off until `.keel/keel.json` has `"robot": { "on": true, "budgetMinutes": <per week> }`. The weekly allowance includes robot-associated build and other-provider review agent-step time. Both are constrained by the remaining allowance. When it runs out or cannot be established, the pass waits, and the board says so.
- **Issues it gets**: `keel review --close … --tracked` can file its issue in the rubric's shape (`--file-agent-issue`); an agent that finds a fault outside its work files one and goes on.

## Acceptance

- [x] `keel issue new --agent` writes an issue with every rubric field; the triage names each missing field on an issue that lacks it and refuses to work it. `tests/robot-rubric.test.mjs`, `tests/robot-issue.test.mjs`, `tests/robot-runtime.test.mjs`, `tests/robot-budget.test.mjs`
- [x] The worker admits only verified labelled issues and authorized label/reopen/comment triggers; bots and strangers cannot start model work. Public intake is separate, and model work remains one issue at a time per project. `tests/workflows.test.mjs`
- [x] The robot's jobs hold every climb sandbox rule for both providers (agent and judge read-only, publish runs nothing from the branch), and the result is a PR on `keel/robot-<issue>` with `closes #N`, never a push to main. `tests/workflows.test.mjs`
- [x] The agent's last message is posted on the issue; the next run's brief carries the comments since the last run. `tests/robot-rubric.test.mjs`, `tests/robot-issue.test.mjs`, `tests/robot-runtime.test.mjs`, `tests/robot-budget.test.mjs`
- [x] Off without `"robot": { "on": true }`; past its weekly budget it waits and says so. `tests/robot-rubric.test.mjs`, `tests/robot-issue.test.mjs`, `tests/robot-runtime.test.mjs`, `tests/robot-budget.test.mjs`
- [ ] ⚑ by hand: the owner turns the robot on for one project with a budget, labels three issues, and reads each PR and its review.

## Your part

- **Ask:** Turn the robot on for one project, give it a weekly budget, and label three small issues for it.
- **Why:** It is the only way to see whether an agent working alone, with a second provider reviewing, makes PRs you would merge.
- **Look at:** The three PRs it opens and their reviews.
- **Choices:** Keep it on | Keep it, with a smaller budget | Turn it off
- **Takes:** 20 minutes over a week.
- **Then:** Keep it on: the phase is built, and accepted time proposals (phase 57) start going to it. Smaller budget: the new budget is recorded and the week runs again. Turn it off: what it got wrong goes into this phase's evidence.
- **Ready when:** the implementation is merged; the enablement decision then includes the project, weekly allowance and credentials for both builder and reviewer.

## Real surfaces

- Workflow shell: `keel-robot.yml` on GitHub Actions, triggered by labels and comments.
- GitHub API: issues, comments, the robot's PRs and their reviews.
- Adopted project: the one the owner turns it on for.

## Proof

Automated: `node --test tests/robot-rubric.test.mjs tests/robot-issue.test.mjs tests/robot-policy.test.mjs tests/robot-budget.test.mjs tests/robot-runtime.test.mjs tests/robot-delivery.test.mjs tests/robot-workflow.test.mjs tests/workflows.test.mjs tests/review.test.mjs tests/board.test.mjs` (a stubbed gh: labels, comments with permitted, denied and unavailable permission lookups, the posted message, the budget); `npm run check`.
By hand: three issues worked on a real project, read by the owner.
⚑ Model spend per issue, within the owner's weekly budget.

## Deliberately open

- **Settled 2026-10-10: continuation descriptions belong to people.** A continuation never replaces the PR description. Initial body metadata preserves provenance; a canonical trusted bot comment carries current exact-head delivery and authorization. Consumers validate that comment and fail closed on missing or conflicting identity. Publication intent and comment identity support retry without repeated writes; a read immediately before PATCH is not atomic protection.

- **Settled 2026-10-10: approval binds content and can be revoked.** Public routing compares the writer event's issue-body snapshot with a fresh issue read before recording a trusted bot authorization receipt containing that body hash and writer/action identity. The worker requires the exact current body hash and revalidates the writer's permission. Labels alone never authorize a subsequently edited body. Missing/mismatched receipts require a fresh writer action; scheduled scans continue past rejected issues. Admission, publication and independent review each fetch the current default-branch policy and fail closed when disabled/unavailable. Immutable checkout policy cannot override a newer OFF setting. Receipts stay in the existing issue conversation, never a second acceptance system.

- **Settled 2026-10-10: acceptance records stay with the owner.** Robot changes to phase, decision, evidence, research, design and project records are blocked by the trusted sandbox. Ordinary implementation and guide changes use the shared PR-body format with a checked no-record-impact declaration. A task needing record reconciliation is returned for owner handling; a robot PR never establishes acceptance.

- **Settled 2026-10-10: extend the existing practice.** Robot files ship with `climb`; no second practice or tracking system is introduced. Configuration remains `robot: {on: true, budgetMinutes: N}` and the queue label remains `keel:agent`. The allowance covers build and review.
- **Settled 2026-10-10: issue creation is reviewable and recoverable.** `keel issue new --agent --title <title> --rubric <file>` previews before `--yes`. Review creation uses `--close <one-id> --tracked --file-agent-issue --title <title> --rubric <file>`; bare `--tracked` is legal only in this creation mode, and a supplied tracking reference cannot be combined with it. Fresh review receipts are validated before creation. Robot-off issues are unlabelled; unknown target policy cannot enable work. A durable instance intent precedes creation, and ambiguous writes are recovered by exact identity rather than blindly retried.

- **Settled 2026-10-09: review is part of the robot.** Publication must explicitly invoke a trusted other-provider review path for the actual PR head, including continuations. A robot branch prefix or bot-created PR alone does not prove review ran. Missing other-provider credentials blocks the promised review rather than silently self-reviewing. Standalone cross-review refuses robot branches even when an owner configures a matching prefix, so it cannot bypass robot accounting or author provenance. The weekly budget includes both build and review agent-step time. [GitHub's token rules](https://docs.github.com/en/actions/concepts/security/github_token) place token-created PR runs behind approval; an explicit trusted invocation is needed for the unattended path.

- **Settled 2026-10-09: permission is checked, not inferred.** OWNER/MEMBER/COLLABORATOR association is only an early event filter; it does not prove repository write access. The trusted runtime checks the sender's current write/maintain/admin permission, rejects bots and fails closed when permission cannot be read.

- **Whether the robot merges its own reviewed PR**: never, for now. A person merges. Revisited after the owner's week.
- **Issues across the fleet**: one project first. Settled by the week.

## Next action

The owner chooses one project and a weekly allowance covering build plus other-provider review, confirms both providers' credentials, then enables the robot and labels three small eligible issues. Read each PR and its review, merge only when satisfied, and record the operational walk. Keel remains OFF until that approval.

## Trajectory

- **2026-10-10** — First publication needs recovery between branch push and PR creation. A trusted judged-head intent now precedes publication; retries reuse only that exact head or associated PR and refuse human-moved heads. [Evidence](../evidence/2026-10-10-robot.md).
- **2026-10-10** — Agent prose is not continuation state. Reserved metadata is escaped and state requires a trusted envelope; standalone cross-review is excluded from robot branches to preserve author identity and the shared allowance. [Evidence](../evidence/2026-10-10-robot.md).
- **2026-10-10** — Prepared issue writes can resume after a proven-dead writer; attempted writes remain recovery-only. A missing response is never proof that no issue was created. [Evidence](../evidence/2026-10-10-robot.md).

- **2026-10-10** — Independent review caught two recovery boundaries: ordinary null issue bodies must not block lookup, and recovered publication must explicitly schedule independent review across a skipped judge. Both now have baseline-failing regressions; enabled operational verification remains owed.

- **2026-10-10** — Review separated public event intake from the allowance-accounted worker, required active label provenance for scheduled work, and protected repository instruction files. Private read-only fetches use scoped credentials; recovered failures retain verified PR identity. Main’s phase 60 was integrated before the final gate.

- **2026-10-10** — Publication and review completion are separate durable facts. Recovery resumes a missing exact-head review without rebuilding, and triage preserves the delivered head. Verified robot reviews remain actionable despite the shared Actions identity; a new head does not erase historical unanswered findings.

- **2026-10-10** — Queue rejection is per issue, not a permanent stop for later authorized work. Human PR retargets block continuation, and missing queue labels remain a verified but unqueued outcome. Intent storage refuses symlinked paths without rewriting external files or relabelling issues.

- **2026-10-10** — Current default-branch policy revokes queued work; writer authorization binds the exact body through a verified issue receipt and still requires active-label permission. The conductor’s real API probe rejected stale enabled input under current OFF policy without writing. Raised budgets remain usable for pending reviews.

- **2026-10-10** — Review exposed two operational boundaries: routed bot actors need explicit provider support, and continuing a queue scan must not discard approved questions. Worker isolation now fails closed before credentials; bounded, revalidated triage survives scans independently of build selection. Effective Linux provider isolation remains part of the owner walk.
