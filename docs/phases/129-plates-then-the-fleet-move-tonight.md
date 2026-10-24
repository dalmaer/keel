---
status: planned
since: 2026-10-23
goal: G2
spec: 2
depends: [128]
note: "Specified 2026-10-23 (docs/specs/name-transition.md). Owner's call the same day: no waiting a week. The whole fleet moves tonight, plates first, each project proven by a night run dispatched by hand. The next project starts only when the one before is clean."
evidence: []
issue: 245
---

# Plates, then the fleet, move tonight, each proven by a night run dispatched by hand

## Done when

In one evening, plates and then ledger, duo, cajones, isocan and dtv each run on the transitioned release. Each passes a checklist on a night run dispatched by hand (`workflow_dispatch`):
- a full night and morning ran;
- every branch, marker, fence, label and artifact written was a plates name;
- every old-name PR and plan still in flight was read and drained;
- `plates names` for that project shows nothing left except what the owner chose to keep.

## Scope

The design is [Name transition](../specs/name-transition.md), "The rule". The owner chose, 2026-10-23, to do it in one evening rather than one project per night.

- **Release** with phases 124–128 (`plates release`, the fleet rehearsal included).
- **Plates first.**
  1. With explicit owner approval, disable affected workflows and keep them disabled through installation, then re-enable only the installed new definitions. Prove the concurrency preflight: no old-group run is queued, waiting, pending or running, with complete run coverage. The owner drains runs or confirms cancellation before proceeding. Then update plates itself.
  2. Run `plates names --yes`, plus the owner's secret commands.
  3. Dispatch `plates-night.yml`, then `plates-morning.yml`.
  4. Check the plates checklist below.

  Only then does the fleet start.
- **Then each project in order:** ledger, duo, cajones, isocan, dtv.
  1. Establish the same owner-approved disable/install/re-enable barrier and pass the old-run concurrency preflight before installing changed workflows. `plates fleet update` opens the PR, and the owner merges it (isocan's merge is Dimitri's or the owner's).
  2. `plates names --yes` for that project.
  3. Dispatch its night, then its morning.
  4. Check its checklist.

  A project that fails stops the rollout. It's fixed, or set aside by the owner, before the next one starts.
- **Project files plates doesn't manage**, named before the rollout so the owner can approve each:
  - ledger's Tests upload of `keel-test-runs`, its `cli/ci-workflows.test.ts` assertion of that name, and the `keel-*` names its ci-alert.yml watches;
  - any project workflow that triggers on a `keel-*` workflow name.

  Each gets a project PR, with that project's gate passing.
- **dtv** is adopted but not in `plates.json`. Add it (`role: managed`), or name it out, before its turn.
- **The checklist**, scripted as `plates names --verify <repo>`:
  - the dispatched night's run is green;
  - its PR is on `plates-night/<date>`;
  - the morning's final is on the night's own prefix;
  - no new marker, fence, label or artifact uses a keel name;
  - drain left no keel-prefixed PR that still merges;
  - the board and the morning brief read the verify and plan history.

## Acceptance

- [ ] `plates names --verify` checks one project's last dispatched night against the checklist and names each failure. `tests/names-cli.test.mjs` (stub `gh`): "verify names each failed check"
- [ ] Plates passes the checklist on its dispatched night. ⚑ by hand: the owner
- [ ] Ledger, duo, cajones, isocan and dtv each pass it, in order, the same evening. The evidence holds each one's run links and `plates names` before and after. ⚑ by hand: the owner

## Your part

- **Ask:** This evening, merge each project's update PR when asked, run the listed secret commands, and say go before each next project.
- **Why:** The merges, secrets and label moves are yours. Doing it in one sitting is your call (2026-10-23).
- **Look at:** `plates names --verify <repo>` after each dispatched night.
- **Choices:** All six clean | Stopped at a project
- **Takes:** About an evening: roughly 20 minutes per project, most of it the night's own run.
- **Then:** If it stopped at a project, that project's failure becomes the next fix. The ones already moved stay moved; phase 125 means they work either way.
- **Ready when:** phase 128 has shipped and the release is cut.

## Real surfaces

- fleet over time: six repositories, each with a night and morning dispatched under the new names.
- workflow shell: each project's night, morning, climb and impact workflows.
- GitHub API: label renames, branch prefixes and PR bodies across the fleet.
- adopted project: dtv, the first project adopted after the rename.

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/names-cli.test.mjs`; `npm run check`.
By hand: ⚑ the evening's rollout. Each project's dispatched run links and `plates names --verify` output go in the evidence.

## Deliberately open

- **A dispatched night isn't a scheduled one.** It runs from the default branch with `workflow_dispatch`, not the cron, so the first scheduled night after the rollout is the last check. The morning after, the brief should show every project on plates names; if one isn't, it reopens this phase.
- **isocan** is Dimitri's. Its update is a PR, and plates never merges it on its own.

## Next action

Write `plates names --verify` against a stub of plates's own last night, then list the project files plates doesn't manage that still say keel, per repository.
