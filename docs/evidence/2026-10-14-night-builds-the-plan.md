# Evidence: phase 76 — the night builds what the plan names, and only that

- Date: 2026-10-14 (local `date`)
- Phase: [76](../phases/76-the-night-builds-what-the-plan-names-and-only.md)
- Revision: base `8c41a25` (phase 73, `claude/phase-73`, PR #140, under
  review) plus the phase 76 commit on `claude/phase-76`, working tree when
  this was written.
- Claim being checked: climb's `pick --plan` runs only the plan's first
  climb item that may run, or nothing, and picks as before without a plan;
  the robot's scans admit only the plan's robot items in plan order, with no
  fallback; a `willNotTouch` path is refused by the judges (and rechecked by
  the publishers); each pass's publish job ticks its items running, then done
  with the PR or failed with why, on the plan branch with a lease; a plan
  item's minutes lower a pass's budget and never raise it.

**No real night ran.** Nothing here pushed to GitHub, read the live
`keel-night-plan` branch, or ran keel's `keel-climb` or `keel-robot`
workflows. GitHub reads are a stub gh or the robot tests' synthetic API; the
plan branch is a bare local origin; workflow steps run as bash in synthetic
Acme repos.

## Automated checks

`node --import ./tests/helpers/hermetic.mjs --test tests/climb.test.mjs tests/robot-runtime.test.mjs tests/night-plan.test.mjs tests/workflows.test.mjs tests/climb-pick.test.mjs tests/robot-workflow.test.mjs`
was run on the working tree before the gate; the gate (`npm run check`) then
covers every test file, the roadmap, render and inbox guards. Its exit code is
in the commit body.

| Acceptance box | Test |
| --- | --- |
| With a plan, `pick` runs the plan's climb item and nothing else; none, nothing; no plan, as before | `tests/climb.test.mjs`: "with a plan, pick runs the plan's climb item and nothing else; with no climb item it runs nothing; without a plan it picks as before" (the plan's job over the health page's; a job not configured, waiting on its PR, or after the first skipped with why; no climb item, a done item, a triage item: no climb, exit 0; every item blocked; another night's or a refused plan is no plan; an unreadable plan file exit 2; weekly off day skips with why) |
| With a plan, the robot admits only the plan's issues; none planned admits nothing; a planned issue failing its rubric ticks failed and no other is admitted; no plan, as before | `tests/robot-runtime.test.mjs`: "with a plan, the robot admits only the plan's issues: …" (the planned #2 over the older admissible #1, with #1 never read; no robot item, a done one or a triage one: nothing read, nothing admitted; a rubric failure ticked failed with its reason, its triage question still asked, #1 never read; plan order moves to the next planned issue; a writer's own label is not the plan's) |
| A change that touches a `willNotTouch` path is refused by the judge | `tests/climb.test.mjs`: "a change that touches a willNotTouch path is refused by the judge" (the matching rule, pure; a listed file refused, a same-prefix sibling not; a directory entry; changed and changed back; a clean merge passes and an evil merge is refused; an unreadable or refused plan is exit 2); `tests/robot-runtime.test.mjs`: "with a plan, the robot judge refuses a change to a willNotTouch path"; `tests/workflows.test.mjs`: "climb and the robot read tonight's plan before they choose, …" (the judge and the publisher both run the plan check after the unchanged off-limits check) |
| Each pass ticks its item running, then done with the PR link or failed with the reason | `tests/night-plan.test.mjs`: "each pass ticks its item running, then done with the PR link or failed with the reason, on the plan branch" (both workflows' real "Tick tonight's plan" steps against a bare origin: climb's item done with PR 21, its other item skipped with why; the robot's item failed with the judge's outcome and the run's link, a refused planned issue failed with its reason; a re-run never moves a done item back; one commit on the shaped plan, main untouched); "a pass never ticks another night's plan, records nothing without a plan branch, and retries a push that lost a race" (the owner's racing push is kept, the ticks land on top of it); `tests/workflows.test.mjs`: only the publish job, which holds the write token, ticks |
| A plan budget lowers a pass's minutes and never raises them | `tests/climb.test.mjs`: "a plan budget lowers a pass's minutes and never raises them" (10 of 45, 90 stays 45, 2.7 is 2, 0.5 is 1, none is 45; the workflow's pick step hands 12 to the agent's time box); `tests/robot-runtime.test.mjs`: the robot's build request is 10 minutes for a 10-minute item and stays 45 for a 90-minute one |

Mutations, each applied to the source and run against its test, then
restored (a scratch script, not committed): pick ignoring `--plan`; `planMinutes`
raising to the plan's minutes; the sandbox ignoring `--plan`; the robot
scanning as before with a plan; the robot judge ignoring `willNotTouch`;
`record` pushing with `--force` instead of a lease; `record` ticking another
night's plan. Each made its test fail; with the code restored each passes.
The tests were otherwise written with the feature, so none was run red
against code without it.

Existing guard tests touched, each to stay as strict: `tests/workflows.test.mjs`
"ledger#92" now counts only an unconditional `climb.mjs sandbox` line as the
judge's and the publisher's check (the plan check runs under an `if`, so it
must never stand in for it); `tests/climb-pick.test.mjs` "off" accepts the
plan artifact's guard (`plan_used`, set only by a pick that ran) and the
publish job's widened condition (it also runs to tick a plan when no job was
picked); `tests/robot-workflow.test.mjs` evaluates the publisher's condition
with the new `plan_ticks` output.

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| One real night on keel with one item in the plan | One PR for that item, nothing else; its tick on `keel-night-plan` | Not run | Owed: the owner's walk, after phase 74 (`/goodnight`) ships |

## Gaps and decision

- The contents API read (`gh api -H "Accept: application/vnd.github.raw+json"
  …?ref=keel-night-plan`) and the lease push from a real publish job have not
  run against GitHub; the tests stub gh and use a local bare origin.
- `running` and the final status land in one push, from the publish job: the
  agent and judge jobs cannot write, by design, so the branch never shows an
  item running while it runs.
- A night that ran keel's default plan (nothing on the branch) has nothing to
  tick: both passes choose as before and their outcomes are not on the branch.
- While the robot is off its robot items stay `planned`, not `skipped`.
- Loop findings into robot issues is not built (see the phase's
  *Deliberately open*).

This supports `partial`: every automated box is ticked; the walk is owed.
