---
status: partial
owes: walk
waits: time
since: 2026-10-07
goal: G4
spec: 2
depends: [35, 38, 42]
note: "Built and on GitHub: the Budget line (agent-step minutes per run from GitHub, ran out, a suggestion; runs whose agent never started skipped); the night of 2026-10-07 (run 37580217231, keel#26) wrote tend 2 of 30, climb 3, 0 of 45. Waits on the owner's read after four or more tend runs."
evidence: ["evidence/2026-10-07-budget-use.md"]
issue: 25
---

# Each budgeted pass shows what it used, and says when to extend or shorten

## Done when

keel's health page shows a Budget line for tend and climb: the agent step's minutes in each of the last runs (at most 8), which ran out, and a suggestion (extend, shorten to N, hold, or too few to say), read from GitHub's record of the runs; and the owner has read tend's line and kept or changed its budget by it.

## Scope

The design is [Budget use](../research/2026-10-06-budget-use.md).

- **The read**: for each budgeted pass that is on (climb, tend, cross-review), the workflow's completed runs, newest first (the default branch for climb and tend, every branch for cross-review), and each run's agent step by name; a run that never reached that step is skipped.
- **Minutes used**: the step's `startedAt` to `completedAt`; ran out when it was cancelled or used the budget less one minute.
- **The suggestion**: extend when half or more of the last runs (4 to 8) ran out; shorten to N when none used more than half (N the most used, rounded up to 5, at least 5); hold otherwise; too few to say below 4.
- **The line**: `Budget:` on the health page, one entry per pass, naming the budget it compares to; n/a with why when GitHub cannot be read. Not a bounded measure (lesson 6), never a change to the config.
- **The map** from workflow to agent step ("Climb", "Tend", "Review") lives in the night's script, held equal to the shipped workflows by a test.

## Acceptance

- [x] From synthetic runs: minutes per run from the agent step, a cancelled or full step counted as ran out, a run without the step skipped, and each suggestion (extend, shorten to N, hold, too few); mutation: not counting a cancelled step as ran out fails the test. `tests/improve-budget.test.mjs`
- [x] The step map equals the name of each shipped workflow's claude-code-action step; mutation: renaming tend's step in its workflow fails the test. `tests/workflows.test.mjs`
- [x] The health page has a Budget entry for each pass that is on and none for one that is off; GitHub unreadable is n/a with why, never an empty line. `tests/improve-budget.test.mjs`
- [x] keel's health page, after the night runs on GitHub, shows tend's real entry (its runs so far). `gh pr view <n> -R dalmaer/keel --json body`
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

⚑ After four or more tend runs (weeks), the owner reads tend's Budget line on the health page and keeps or changes its budget.

## Trajectory

- **2026-10-07** — A run whose agent never started is skipped, and the agent step can't say so: it is continue-on-error, so it reports `success` (keel's climb runs 37528477651 and 37522297684: 16–17 s, then "Did the agent run?" `failure`). The map holds both step names per workflow.
- **2026-10-07** — Cross-review's runs are read on every branch: they run on each PR's branch, so a default-branch filter would see almost none.
- **2026-10-07** — Codex's reviews of the fleet PRs found three gaps in the history read, each fixed before the next release: runs under an older budget were judged against today's (b6de324, v0.8.7); a capped read counted every run, and a default budget was resolved with today's default (7cacc7d, v0.8.8). Budgets are compared as written.
