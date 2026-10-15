---
status: partial
owes: walk
waits: owner
since: 2026-10-14
goal: G4
spec: 2
depends: [73, 74, 76, 77]
note: "Built 2026-10-14: keel-morning's card job republishes night-plan after each pass with keel canvas night's provisioning and one shared canvas journal; a default night writes its plan to keel-night-plan from its PR step; an accepted Loop finding becomes a robot build whose issue keel goodnight --yes makes; no build lane without a builder. Owes the owner one watched night."
evidence: ["evidence/2026-10-14-night-plan-live.md"]
issue: 150
---

# The night's plan stays live: the card ticks, default nights record, and Loop findings get built

## Done when

Through a night, the canvas plan card shows each item's latest status after every pass finishes, with no one at a keyboard; a night that ran keel's default plan records its outcomes exactly as an owner's plan does; and an accepted Loop finding the owner adds to tonight's plan is built by the robot under its rubric, never left in a lane no pass builds.

## Scope

The design is [Nightwatch: a night with a plan you can shape](../research/2026-10-14-nightwatch.md). Phases 73, 74, 76 and 77 left these three open.

- **The card ticks**: the `keel-morning` workflow, which already runs after the night, climb and the robot finish, republishes the `night-plan` live card from tonight's plan as it stands, when the project's canvas is set for nightly publishing (the same owner-provisioned isocan home and pinned CLI as `keel canvas night`). Without that setup it does nothing and says so. A person's edit to the card stops updates, as always.
- **Default nights record**: when there is no owner plan for tonight on `keel-night-plan`, the night writes its default plan there (`shapedBy: default`), so the passes tick it. It never replaces a plan the owner shaped, and never writes another night's date.
- **Loop findings get built**: `keel goodnight add` (and its suggestion) for an accepted Loop finding that names a number drafts a robot issue with a rubric from the finding (problem, the number and its bound as acceptance, the cited files as the change, no prerequisites) and puts the item in lane `robot:#<n>`. The issue is created only on `keel goodnight --yes`, through `ensureRobotIssue`, never before. A finding that names no number, or whose rubric would be refused, stays a triage item with the reason.
- **No lane without a builder**: the plan validator refuses a build in lane `loop`; `persona:<name>` builds are handed to a climb job that measures the number, or refused.

## Acceptance

- [x] The morning workflow republishes the plan card after each pass when the canvas is set up, does nothing and says why when it is not, and a person's edit stops it. `tests/morning.test.mjs`, `tests/workflows.test.mjs`
- [x] A night with no owner plan writes its default plan to the plan branch and the passes tick it; a night with an owner plan never replaces it. `tests/night-plan.test.mjs`, `tests/workflows.test.mjs`
- [x] `goodnight add` for an accepted Loop finding that names a number becomes a robot item, its issue created only on `--yes` with a rubric the robot accepts; one that names no number stays triage, with the reason. `tests/goodnight.test.mjs`, `tests/robot-runtime.test.mjs`
- [x] The validator refuses a build in lane `loop`, and a persona build without a climb job that measures its number. `tests/night-plan.test.mjs`
- [ ] ⚑ by hand: the owner watches one night's plan card change on the canvas as climb and the robot finish, and gets the morning email linking to it.

## Your part

- **Ask:** One evening put one Loop finding and one small fix in tonight's plan with `/goodnight`; the next morning, open the email and follow it to the canvas.
- **Why:** It is the whole nightwatch, end to end, on a real night.
- **Look at:** the "Good morning" email and the canvas's plan card.
- **Choices:** The card and email told me what happened | Something was missing or wrong
- **Takes:** 10 minutes in the evening, 10 the next morning.
- **Then:** Missing or wrong: what it was goes into the next fix.
- **Ready when:** this phase has shipped, `morning.assignee` is set, and the canvas is set for nightly publishing.

## Real surfaces

- Workflow shell: `keel-morning` republishing the card; `keel-night` writing the default plan.
- GitHub API: the robot issue created from a Loop finding.
- Owner's machine: `keel goodnight` and the canvas card.

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/morning.test.mjs tests/night-plan.test.mjs tests/goodnight.test.mjs tests/robot-runtime.test.mjs tests/workflows.test.mjs`; `npm run check`.
By hand: one real night, watched.

## Deliberately open

- **Who may write the plan branch**: settled 2026-10-14 by the build. The night's PR step, the one step of its job that already writes, pushes `refs/heads/keel-night-plan` and nothing else new (`night-plan.mjs publish`), with a lease; its plan step only reads. It writes over a plan for an earlier night (kept as the parent commit), never over one for tonight or later, nor one it cannot read.
- **How a draft names a robot issue that does not exist yet**: settled 2026-10-14 by the build. The draft holds the item in lane `robot:pending`, which only `validatePlan(plan, { draft: true })` accepts; `keel goodnight --yes` makes the issue (ensureRobotIssue, idempotent) after every other check holds and writes `robot:#<n>`.
- **Two canvas writers**: settled 2026-10-14 by the build. The night and the card share one journal: `scripts/keel/canvas-recovery.mjs` restores the newest attempt of either. Known limit: a card job still running when the night's canvas step starts makes that step refuse (red), as an unfinished night does; the card waits a pass while the night runs.
- **Known limit**: a Loop finding's rubric is drafted from the finding's own text; one Loop wrote badly can be refused by the robot's rubric check, and then stays triage. A finding that cites no file drafts no change and stays triage.

## Next action

The ⚑ walk: one evening, the owner puts one Loop finding and one small fix in tonight's plan with `/goodnight`; the next morning, opens the email and follows it to the canvas's plan card (needs this merged, `morning.assignee` set, and the canvas set for nightly publishing with `night-plan` live).
