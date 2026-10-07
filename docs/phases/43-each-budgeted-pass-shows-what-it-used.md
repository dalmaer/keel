---
status: planned
since: 2026-10-06
goal: G4
spec: 2
depends: [35, 38, 42]
note: "The owner set tend at 30 minutes and asked to track its use, to extend or shorten it. A Budget line on the night: the agent step's minutes per run from GitHub's record, which ran out, and a suggestion; never a change. Design: research/2026-10-06-budget-use.md."
evidence: []
issue: 25
---

# Each budgeted pass shows what it used, and says when to extend or shorten

## Done when

keel's health page shows a Budget line for tend and climb: the agent step's minutes in each of the last runs (at most 8), which ran out, and a suggestion (extend, shorten to N, hold, or too few to say), read from GitHub's record of the runs; and the owner has read tend's line and kept or changed its budget by it.

## Scope

The design is [Budget use](../research/2026-10-06-budget-use.md).

- **The read**: for each budgeted pass that is on (climb, tend, cross-review), the workflow's completed runs on the default branch, newest first, and each run's agent step by name; a run that never reached that step is skipped.
- **Minutes used**: the step's `startedAt` to `completedAt`; ran out when it was cancelled or used the budget less one minute.
- **The suggestion**: extend when half or more of the last runs (4 to 8) ran out; shorten to N when none used more than half (N the most used, rounded up to 5, at least 5); hold otherwise; too few to say below 4.
- **The line**: `Budget:` on the health page, one entry per pass, naming the budget it compares to; n/a with why when GitHub cannot be read. Not a bounded measure (lesson 6), never a change to the config.
- **The map** from workflow to agent step ("Climb", "Tend", "Review") lives in the night's script, held equal to the shipped workflows by a test.

## Acceptance

- [ ] From synthetic runs: minutes per run from the agent step, a cancelled or full step counted as ran out, a run without the step skipped, and each suggestion (extend, shorten to N, hold, too few); mutation: not counting a cancelled step as ran out fails the test. `tests/improve-budget.test.mjs`
- [ ] The step map equals the name of each shipped workflow's claude-code-action step; mutation: renaming tend's step in its workflow fails the test. `tests/workflows.test.mjs`
- [ ] The health page has a Budget entry for each pass that is on and none for one that is off; GitHub unreadable is n/a with why, never an empty line. `tests/improve-budget.test.mjs`
- [ ] keel's health page, after the night runs on GitHub, shows tend's real entry (its runs so far). `gh pr view <n> -R dalmaer/keel --json body`
- [ ] ⚑ by hand: after four or more tend runs, the owner reads tend's line and keeps or changes the budget.

## Real surfaces

- GitHub API: the Actions runs and jobs of keel-tend.yml and keel-climb.yml on keel.
- Workflow shell: keel-night.yml on GitHub Actions, writing the line.
- Fleet over time: tend's runs over four or more weeks.

## Proof

- Automated: `node --test tests/improve-budget.test.mjs tests/workflows.test.mjs`, with the mutations above; `npm run check`.
- On GitHub: the next keel night's health page carries tend's line.
- By hand: the owner's read, weeks later.

## Deliberately open

- **Counting what the agent spent, not only its minutes** (turns, tokens, cost from the action's execution file). Minutes first: they are what the budget sets.
- **Per-PR passes**: cross-review runs once per PR; its window is its last 8 reviewed PRs, the same rule. Settled when one project has had eight.

## Next action

Brief a builder on the read (runs, jobs, the agent step) and the suggestion, with synthetic runs in the test.

## Trajectory

*Nothing yet.*
