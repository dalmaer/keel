# Evidence: phase 78 — the night's plan stays live: the card ticks, default nights record, and Loop findings get built

- Date: 2026-10-14 (local `date`)
- Phase: [78](../phases/78-the-night-s-plan-stays-live-the-card-ticks.md)
- Revision: base `ad40efa` (main plus the phase 78 spec), plus the phase 78
  commit on `claude/phase-78`, working tree when this was written.
- Claim being checked: keel-morning republishes the `night-plan` live card
  after each pass with `keel canvas night`'s own provisioning, and only when
  the canvas is set for it; a night with no owner plan writes its default plan
  to `keel-night-plan` from its PR step and the passes tick it, never over an
  owner's plan for tonight or later; an accepted Loop finding that names a
  number becomes a robot build whose issue is made only on `keel goodnight
  --yes`, with a rubric the robot accepts; and the validator refuses a build in
  lane `loop` or `persona:<name>`.

**No real night ran.** Nothing here wrote a real canvas, pushed keel's live
`keel-night-plan`, opened an issue on GitHub or ran a workflow in Actions.
GitHub is a stub gh (or a stub issues API at ensureRobotIssue's boundary);
origins are local bare repos; the canvas is the fake isocan home in
`tests/helpers/isocan.mjs` (canvas-sync's own, moved there so the morning's
tests use the same one).

## Automated checks

`node --import ./tests/helpers/hermetic.mjs --test tests/morning.test.mjs tests/night-plan.test.mjs tests/goodnight.test.mjs tests/robot-runtime.test.mjs tests/workflows.test.mjs tests/persona.test.mjs tests/canvas-night.test.mjs tests/canvas-sync.test.mjs`:
exit 0, `ℹ tests 217`, `ℹ pass 217`, `ℹ fail 0`.

| Acceptance box | Test |
| --- | --- |
| The morning workflow republishes the plan card after each pass when the canvas is set up, does nothing and says why when it is not, and a person's edit stops it | `tests/workflows.test.mjs`: "keel-morning republishes the plan card after each pass when the canvas is set for nightly publishing, with keel canvas night's own provisioning; otherwise a notice and nothing else" (the card step's preflight is the night's, line for line; set up: `keel morning --card --yes --date <day> --json` once; four unset shapes: a notice, no call at all; no isocan home, no pins, no day: red, a never-ran receipt, no card); "phase 77: keel-morning.yml …" (now also: the card job holds `contents: read` and `actions: read` only and runs only for a night with a plan, three more mutations); `tests/morning.test.mjs`: "the plan card republishes after each tick through the live card's conditional edit, sends nothing when nothing ticked, and stops at a person's edit"; "on CI the card keeps the night's journal: …"; `tests/canvas-night.test.mjs`: "the night restores the newest canvas writer, the plan card's attempt when it ran last; …" and "the card waits (exit 3, the canvas untouched) while another canvas writer runs; …" |
| A night with no owner plan writes its default plan to the plan branch and the passes tick it; a night with an owner plan never replaces it | `tests/night-plan.test.mjs`: "a night with no owner plan writes its default plan to the plan branch, and the passes tick it; an owner's plan, tonight's or later, is never replaced" (a new branch; climb's own "Tick tonight's plan" step ticks it done; a rerun keeps tonight's ticks; owner plans for tonight and tomorrow untouched; an earlier night's kept as the parent; an unreadable plan left alone; the owner's or another night's working plan never written; a `/goodnight` that lands mid-push wins the lease); `tests/workflows.test.mjs`: "a default night writes its plan to keel-night-plan from its PR step, the one step that writes; the plan step only reads; a failed write is red at the verdict" (the real PR step against a bare origin) |
| `goodnight add` for an accepted Loop finding that names a number becomes a robot item, its issue created only on `--yes` with a rubric the robot accepts; one that names no number stays triage, with the reason | `tests/goodnight.test.mjs`: "goodnight add for an accepted Loop finding that names a number drafts a robot item; --yes alone makes its issue (once), …" (no GitHub call on add; one POST on `--yes`, labelled `keel:agent`, its body passing `robotRubricRefusal`; the plan pushed names `robot:#7`; a second `--yes` recovers #7; a finding declined since add stops `--yes`, nothing pushed); "the rubric drafted from a Loop finding: …"; `tests/robot-runtime.test.mjs`: "robot admits the issue keel goodnight drafts from an accepted Loop finding, and triages one whose rubric it refuses" (the robot's own `prepareRobot` is ready with exactly the drafted rubric) |
| The validator refuses a build in lane `loop`, and a persona build without a climb job that measures its number | `tests/night-plan.test.mjs`: "the validator refuses a build in lane loop, and a persona build; the default plan hands a persona build to the climb job that measures its number, or makes it triage"; `tests/persona.test.mjs`: "a missed goal is a candidate item naming its number: a build for the climb job that measures it, else triage; …" |

Red without the feature (each applied alone to the source, the named test run,
then restored; 2026-10-14, a scratch script over the worktree):

| Mutation | Fails |
| --- | --- |
| validatePlan: no `loop` refusal | the validator test (1 fail) |
| validatePlan: no `persona:` refusal | the validator test (1 fail) |
| planCandidates: `jobs` ignored | the persona candidates test (1 fail) |
| publishDefault: replaces a plan dated tonight (`>` for `>=`) | the default plan test (1 fail) |
| publishDefault: plain `--force` for the lease | the default plan test (1 fail: the owner's racing plan is lost) |
| goodnight: a Loop build lands in lane `loop` | the Loop finding test (1 fail) |
| goodnight: the drafted rubric not checked | the Loop finding tests (2 fail) |
| goodnight `--yes`: no issue made | the Loop finding test (1 fail) |
| robot-rubric: prerequisites no longer refused | the robot-runtime Loop test (1 fail) |
| lib/morning.mjs: no journal on CI | the card journal test (1 fail) |
| canvas-recovery.mjs: reads keel-night.yml only | the newest-writer test (1 fail) |
| keel-morning.yml: never runs `keel morning --card` | the card workflow test (1 fail) |

The workflow tests also carry their own mutations (a PR step that never
publishes leaves the branch empty; a card step without the isocan home check
publishes with no identity).

Also run: `npm run check` on the integrated tree; its exit code is in the
commit body.

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| The owner watches one night's plan card change on the canvas as climb and the robot finish, and follows the morning email to it | the card ticks after each pass; the email links the canvas | Not run | The ⚑ box. Needs this phase merged, `morning.assignee` set, and the canvas provisioned for nightly publishing with `night-plan` live. |

## Gaps and decisions

- **Provisioning and permissions.** The card job is a fourth job of
  `keel-morning.yml`: `contents: read` and `actions: read` (the night's job
  has those and more), the project's `setup` (with `setupToken` in its Install
  step alone, as the night), the night's own preflight, and
  `KEEL_CANVAS_PERSISTENCE=artifact-v1`. No secret, no new credential path:
  the canvas identity is the owner's isocan home.
- **One journal for two writers.** A card edit the night did not see would
  make the night's next sync read the card as a person's edit and refuse. So
  the recovery that was inline in keel-night.yml is now
  `scripts/keel/canvas-recovery.mjs` (managed), shared by both: it restores the
  newest attempt of either workflow. All of the night's recovery tests pass
  unchanged against it.
- **Known limit: a race between writers.** A card job still running when the
  night's canvas step starts makes the night's canvas step refuse (red, as an
  unfinished night always has); the card waits a pass when the night is
  running. A keel-morning run whose runner died mid-write leaves no artifact
  and is skipped, so the next writer's sync sees a version it did not record
  and refuses (a refusal, never an overwrite; the owner re-bases).
- **Default plan over an earlier night's.** The night writes on top of a
  plan dated before tonight, whoever shaped it: that night is over and in its
  record, and the old plan stays as the new commit's parent. It never writes
  over a plan for tonight or later, nor one it cannot read.
- **The pending marker.** A Loop build waits in the draft in lane
  `robot:pending`, which `validatePlan` accepts only with `{ draft: true }`
  (goodnight's draft); no plan the night or a pass reads can hold it.
  `--yes` resolves it to `robot:#<n>` after every other check holds, so a
  refused plan makes no issue.
- **Personas rarely build.** Climb's jobs measure keel's own numbers, so a
  persona's `persona:<name>:<goal>` number is measured by none of them today:
  each missed goal is triage, saying so. The review page says `triage` too.
- Not done: tracked limits keel#147 and #149 are unchanged by this phase.
