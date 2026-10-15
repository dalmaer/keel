---
status: partial
owes: walk
waits: owner
since: 2026-10-14
goal: G4
spec: 2
depends: [73, 50]
note: "Built 2026-10-14: keel morning (the brief; --send as the assigned Good morning issue; --card as the live card night-plan), the keel-morning workflow (sends once the night is over; only its send job writes issues) and its final data-only PR (keel#137). Owes the owner one real morning's email."
evidence: ["evidence/2026-10-14-morning.md"]
issue: 135
---

# The plan lives on the canvas, and the morning sends a message

## Done when

With a canvas, tonight's plan is a live card updated in place as items tick; and every morning `keel morning` writes the brief in isocan's order (done, tried, failed, left alone) with links to the canvas, the health page and each PR, delivered as a GitHub issue assigned to the owner so that GitHub emails it.

## Scope

The design is [Nightwatch: a night with a plan you can shape](../research/2026-10-14-nightwatch.md), "The plan is a live card, and the morning sends a message".

- **The card**: `night-plan`, a live key (phase 50's `canvas.liveKeys`), rendered from the plan file; each tick republishes it through the conditional edit. A person's edit stops updates, as always.
- **The brief**: `keel morning` reads the plan as it ended, the health page and each item's PR, and renders markdown: what was done (with its number before and after), what was tried, what failed and why, what was left alone, and what is the owner's next.
- **Delivery**: by default a GitHub issue "Good morning, <date>" assigned to the owner (`morning.assignee` in `.keel/keel.json`, required to send), labelled `keel:morning`; the previous morning's issue is closed. GitHub's own notification is the email. No other mail is sent without an adapter the owner configures.
- **When it is sent**: not from the night, which runs before climb and the robot (07:23 UTC, then 10:17, then the robot). A `keel-morning` workflow sends the brief once every build item in tonight's plan is terminal (done, failed or skipped), started by each pass finishing (`workflow_run`) and by a schedule at the plan's `readyBy`. At `readyBy`, any item still planned or running is sent as "not finished by <time>", never as done. One brief per night: a second run for the same night does nothing.
- **A failed send** turns that workflow red, as a guard must fire into a room someone is in.

## Acceptance

- [x] The plan renders as one card and each tick edits it in place, with a person's edit stopping updates. `tests/canvas-sync.test.mjs`, `tests/morning.test.mjs`
- [x] `keel morning` renders the brief in order with every link, from a fixture plan and health page. `tests/morning.test.mjs`
- [x] `--send` opens one assigned, labelled issue and closes the previous one, on a stubbed gh; with no assignee it refuses, naming the key. `tests/morning.test.mjs`
- [x] The brief is sent only when every build item is terminal, or at `readyBy` with unfinished items marked "not finished by"; it includes each item's terminal outcome (the PR, or the reason it failed or was skipped); one brief per night; a failed send fails the workflow. `tests/morning.test.mjs`, `tests/workflows.test.mjs`
- [ ] ⚑ by hand: the owner gets the email one morning and opens the canvas from it.

## Your part

- **Ask:** One morning, open the "Good morning" email from GitHub and follow its link to the canvas.
- **Why:** It is the whole point: waking up to one message that says what the night did and where to look.
- **Look at:** your email from GitHub, subject "Good morning, <date>".
- **Choices:** It told me what I needed | I had to go digging
- **Takes:** 5 minutes.
- **Then:** Digging: what was missing goes into the brief.
- **Ready when:** this phase and phase 73 have shipped, and the owner has set `morning.assignee`.

## Real surfaces

- GitHub API: the assigned issue and GitHub's email.
- Owner's machine: the live plan card on the owner's isocan canvas.
- Workflow shell: the `keel-morning` workflow, after the night's passes.

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/morning.test.mjs tests/canvas-sync.test.mjs tests/workflows.test.mjs`; `npm run check`.
By hand: one real morning's email.

## Deliberately open

- **Mail beyond GitHub**: an adapter for a mail provider needs a secret the owner holds; built only if asked.
- **Known limit**: GitHub sends the email only if the owner's notification settings allow it.
- **Where final outcomes are read, settled 2026-10-14 by the build**: one function, `finalPlan` in `scripts/keel/morning.mjs`, reads every place the night's plan lives (the record on `keel-night/<date>-final`, `keel-night/<date>` and the checkout; the plan branch `keel-night-plan`; the working plan). The record is the base (the plan the night ran); each item takes its furthest tick from any place (terminal over running over planned; ties go to the plan branch). Phase 76 decides where passes record ticks durably; only this function changes.
- **"Terminal", settled 2026-10-14 by the build**: done, failed, skipped and left alone. Only build items hold the brief back; measure, review and triage items never do.
- **readyBy when none is set, settled 2026-10-14 by the build**: 17:00 UTC on the night's date, after climb (10:17, up to four hours) and the robot. The workflow's schedule is one daily run at 17:07 UTC, just after the default (cron cannot read the plan); `workflow_run` on the night, climb and the robot covers the usual case, when every build item ends. A plan whose readyBy is another time is caught by the next pass to finish or the next daily run, whichever comes first. **Known limit**: a readyBy after the next night starts (07:23 UTC the next day), on a night whose builds never all finish, gets no brief: by then decide reads the new night.
- **The brief's sections, settled 2026-10-14 by the build**: Done is the build items done (isocan's "sure"); Tried is every other item done (measures, reviews, triage); Failed, and why; Left alone (skipped, left alone, will not touch); Not finished by `<readyBy>` (Still going before it); Your next. Before → after is the night's own health page and the first page after it ("not measured yet" until the next night).
- **No assignee in the workflow, settled 2026-10-14 by the build**: `keel morning --send` refuses (exit 2, naming `morning.assignee`); the workflow says so as a notice and stays green, so a project that has not set it is not red every hour. The final PR is still opened.
- **keel#137, settled 2026-10-14 by the build**: the same run opens one data-only PR, `keel-night/<date>-final`, with the final `docs/night/<date>.json` and the night's health page section, started from the night's own PR branch while that is unmerged; the night's drain merges it with the series as data. It runs on every run once the night is over, sent or not (review on PR #146): a finalization that failed after the send, or a build that finished after a brief sent at readyBy, still reaches the archive; its no-change check makes repeats harmless.
- **Who republishes the card**: `keel morning --card --yes` does, from a machine with isocan; no workflow publishes it yet (the night's canvas step runs once at 07:23, before the builds tick). Wiring a tick to republish waits for phase 76's durable ticks.

## Next action

Set `"morning": { "assignee": "<login>" }` in keel's `.keel/keel.json` (and, for the card, `keel canvas live --card pulse --card night-plan --yes`), merge, and after one real night the owner opens the "Good morning" email and follows it to the canvas (Your part), then answers with `keel walk done 77 --choice "<choice>"`.
