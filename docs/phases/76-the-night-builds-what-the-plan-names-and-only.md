---
status: partial
owes: walk
waits: owner
since: 2026-10-14
goal: G4
spec: 2
depends: [73, 35, 54]
note: "Built 2026-10-14: climb's pick and the robot's scan read tonight's plan from keel-night-plan and build only what it names; willNotTouch is refused by the judges and publishers; each publish job ticks its items on the plan branch with a lease. Owes one real night with one item; Loop findings into robot issues left open."
evidence: ["evidence/2026-10-14-night-builds-the-plan.md"]
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
- **Ticking**: each pass ticks its item `running`, then `done` with the PR link or `failed` with the reason, through `plates night tick`.
- **Budgets**: the plan's per-item minutes may lower a pass's budget, never raise it.

## Acceptance

- [x] With a plan, `pick` runs the plan's climb item and nothing else; with no climb item it runs nothing; without a plan it picks as before. `tests/climb.test.mjs`
- [x] With a plan, the robot admits only the plan's issues: a plan with no robot item admits nothing, and a planned issue that fails its rubric ticks failed with the reason and no other issue is admitted; without a plan it admits as before. `tests/robot-runtime.test.mjs`
- [x] A change that touches a `willNotTouch` path is refused by the judge. `tests/climb.test.mjs`, `tests/robot-runtime.test.mjs`
- [x] Each pass ticks its item running, then done with the PR link or failed with the reason. `tests/night-plan.test.mjs`, `tests/workflows.test.mjs`
- [x] A plan budget lowers a pass's minutes and never raises them. `tests/climb.test.mjs`, `tests/robot-runtime.test.mjs`
- [ ] ⚑ by hand: one real night on plates builds the one item the owner put in the plan, and nothing else.

## Your part

- **Ask:** Put one small fix in tonight's plan with `/goodnight`, and in the morning check that the night opened a pull request for it and nothing else.
- **Why:** It shows the night does what you asked and only that.
- **Look at:** the morning's open pull requests on plates.
- **Choices:** It built what I asked, only that | It built something else, or nothing
- **Takes:** 10 minutes.
- **Then:** Something else: the night is held at measuring until it is fixed.
- **Ready when:** phases 73, 74 and this one have shipped.

## Real surfaces

- Workflow shell: `plates-climb` and `plates-robot` read the plan.
- GitHub API: the PR each pass opens.

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/climb.test.mjs tests/robot-runtime.test.mjs tests/night-plan.test.mjs tests/workflows.test.mjs`; `npm run check`.
By hand: one real night with one item.

## Deliberately open

- **Order between passes** follows their schedules (night, then climb, then the robot); one shared night budget is later.
- **Known limit**: the robot is still blocked on its sandbox prerequisite (phase 54). Not built as specified: while the robot is off its admission stops before any scan, so robot items are not ticked `skipped`; they stay `planned`, and the morning shows them unfinished. Who ticks them `skipped` with that reason (the robot's off run, or the morning) is open.
- **Where ticks live** — settled 2026-10-14 by this phase's build: on the plan branch. Each pass's publish job (the only job of its that holds a write token) adds one commit on top of `keel-night-plan`'s tip with the updated plan, pushed with `--force-with-lease` on that tip and retried from a new tip (`night-plan.mjs record`), so an owner's `/goodnight` push or the other pass's ticks are never lost; a plan dated another night is never ticked. The night's own record (`docs/night/<date>.json`) is committed before climb and the robot run, so it cannot carry their outcomes; an artifact expires and is per run. The branch is never merged and never main. `running` and the final status land together, from the publish job: the agent and judge jobs read only. When the night ran plates's default plan (nothing on the branch), there is nothing to tick and both passes choose as they always did.
- **The plan and a writer's own event** — settled 2026-10-14 by this phase's build: the plan narrows the robot's scans (its schedule, and a dispatch with no routed trigger). A writer's routed label or comment is that writer asking now, not the night, and is admitted as before. Revisit if the walk shows that surprises the owner.
- **Loop findings into robot issues**: not built. Turning an accepted finding into a robot issue needs a rubric (problem, reproduction, acceptance, change) the finding does not carry, a durable intent journal like the time proposals', and an owner verb to put it in the plan; that is not small. Until then a Loop finding in the plan is triage, as the default plan makes it.

## Next action

The owner's walk: put one small fix in tonight's plan with `/goodnight` (phase 74), and in the morning check the one PR and the plan branch's ticks. Then decide whether Loop findings into robot issues is its own phase.
