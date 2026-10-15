---
status: planned
since: 2026-10-14
goal: G4
spec: 2
depends: [73, 35, 54]
note: "Specified 2026-10-14: build items in the plan go to the passes that already build safely, name their number first, and tick their outcome."
evidence: []
issue: 134
---

# The night builds what the plan names, and only that

## Done when

Each build item in tonight's plan is handed to a pass that already builds safely (a climb job, or a robot issue), names the number it moves before the work starts, respects the plan's "will not touch" list, and ticks its item with the PR it opened or the reason it failed; nothing builds that the plan does not name.

## Scope

The design is [Nightwatch: a night with a plan you can shape](../research/2026-10-14-nightwatch.md), "The night does what the plan names".

- **Climb**: `climb.mjs pick --plan <file>` takes the first build item whose lane is `climb:<job>` and whose job is allowed; with a plan and no such item, climb does not run tonight. Without a plan it picks as before.
- **Robot**: with a plan present, the robot admits only the plan's `robot:#<n>` items, in plan order, and nothing else: no scan of other `keel:agent` issues, no fallback when a planned issue fails its rubric (that item ticks `failed` with the reason). A plan with no robot item means the robot builds nothing that night. Without a plan it admits as before. Its weekly allowance and every guard stay as they are.
- **Loop findings**: an accepted finding that names a number becomes a robot issue (`ensureRobotIssue`, as accepted time proposals do) when the owner adds it to the plan; never on its own.
- **Will not touch**: the judge refuses a change that touches a path in `willNotTouch`, as the sandbox refuses `.github/`.
- **Ticking**: each pass ticks its item `running`, then `done` with the PR link or `failed` with the reason, through `keel night tick`.
- **Budgets**: the plan's per-item minutes may lower a pass's budget, never raise it.

## Acceptance

- [ ] With a plan, `pick` runs the plan's climb item and nothing else; with no climb item it runs nothing; without a plan it picks as before. `tests/climb.test.mjs`
- [ ] With a plan, the robot admits only the plan's issues: a plan with no robot item admits nothing, and a planned issue that fails its rubric ticks failed with the reason and no other issue is admitted; without a plan it admits as before. `tests/robot.test.mjs`
- [ ] A change that touches a `willNotTouch` path is refused by the judge. `tests/climb.test.mjs`
- [ ] Each pass ticks its item running, then done with the PR link or failed with the reason. `tests/night-plan.test.mjs`
- [ ] A plan budget lowers a pass's minutes and never raises them. `tests/climb.test.mjs`
- [ ] ⚑ by hand: one real night on keel builds the one item the owner put in the plan, and nothing else.

## Your part

- **Ask:** Put one small fix in tonight's plan with `/goodnight`, and in the morning check that the night opened a pull request for it and nothing else.
- **Why:** It shows the night does what you asked and only that.
- **Look at:** the morning's open pull requests on keel.
- **Choices:** It built what I asked, only that | It built something else, or nothing
- **Takes:** 10 minutes.
- **Then:** Something else: the night is held at measuring until it is fixed.
- **Ready when:** phases 73, 74 and this one have shipped.

## Real surfaces

- Workflow shell: `keel-climb` and `keel-robot` read the plan.
- GitHub API: the PR each pass opens.

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/climb.test.mjs tests/robot.test.mjs tests/night-plan.test.mjs`; `npm run check`.
By hand: one real night with one item.

## Deliberately open

- **Order between passes** follows their schedules (night, then climb, then the robot); one shared night budget is later.
- **Known limit**: the robot is still blocked on its sandbox prerequisite (phase 54); until it runs, robot items tick `skipped` with that reason.

## Next action

Teach `climb.mjs pick` to read the plan, with tests, then the robot.
