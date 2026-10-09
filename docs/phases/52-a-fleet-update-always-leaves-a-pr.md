---
status: partial
owes: walk
since: 2026-10-09
goal: G2
spec: 2
depends: []
note: "Built: a failing check keeps the fleet's update on its branch and opens the PR anyway (ordinary on an already-red main, a draft otherwise, each opening with what failed); the board lists a draft update PR under Broken. Owes the walk: the first real update that fails a project's check, fixed on its own branch and merged. Design: research/2026-10-09-updates-never-block.md."
evidence: ["evidence/2026-10-09-fleet-update-leaves-a-pr.md"]
issue: 39
---

# A fleet update always leaves a PR

## Done when

`keel fleet update` never ends a project at FAILED for its check: when the check fails after the update it pushes the branch and opens the PR, ordinary when main fails the same check without the update and a draft otherwise, each opening with what failed; the board lists a draft update PR under Broken; and one real update that failed a project's check has been fixed by a commit on its own branch.

## Scope

The design is [A fleet update never dead-ends](../research/2026-10-09-updates-never-block.md), phase 52.

- **Keep the work**: `update()` (lib/update.mjs) gains an option that leaves the rendered files in place and returns the failed check (`{ check: { command, ok: false, exit, tail } }`) instead of restoring and throwing. Only the fleet passes it; `keel update` in one checkout keeps today's restore and exit 1.
- **The PR**: lib/fleet.mjs `updateOne` commits the update, pushes the branch and opens the PR as it does on a pass. It also runs main's check (`mainCheckOf`, as today) and puts its line in the PR description:
  - main already red: an ordinary PR opening with "main was already red: `<check>` fails without this update (exit N); this update did not cause it", and main's tail;
  - main passes: a draft opening with "this update fails the project's check", the command and the update's tail;
  - main's check did not finish: a draft, saying so.
- **The fleet's report**: a row says `opened <url> (draft: the update fails the check)` or `opened <url> (main was already red)`, never FAILED for a check. Clone, setup and install failures stay FAILED: there is nothing to push.
- **The board**: a draft PR on a `keel/update-` branch is a Broken item ("<repo>: keel update <version> fails <repo>'s check"), linking the PR.
- **Never merged by keel**: nothing here merges. A draft cannot be merged by accident.

## Acceptance

- [x] The update's check fails, main passes without it: `keel fleet update` pushes the branch and opens a draft PR whose description opens with the failure and its tail; the row says draft, never FAILED. `tests/fleet.test.mjs`
- [x] The update's check fails and main fails the same check: an ordinary PR whose description opens with "main was already red" and main's tail. `tests/fleet.test.mjs`
- [x] `keel update` in one checkout still restores and exits 1 on a failing check; only the fleet's option keeps the files. `tests/update.test.mjs`
- [x] Clone, setup and install failures are still FAILED with nothing pushed. `tests/fleet.test.mjs`
- [x] A draft PR on a keel update branch is a Broken item on the board, linking the PR. `tests/board.test.mjs`
- [ ] ⚑ by hand: the next real update that fails a project's check opens its draft; the owner (or the agent) fixes it with one commit on that branch, and the owner merges it.

## Your part

- **Ask:** When a keel update PR shows up as a draft, check that its description told you what was wrong and how to fix it, then merge it once fixed.
- **Why:** It proves a failing update now leaves something to fix, instead of nothing.
- **Look at:** The draft update PR the board lists under Broken.
- **Choices:** Clear enough | Needed more
- **Takes:** 5 minutes.
- **Then:** Clear enough: the phase is built. Needed more: what was missing goes into the PR description, and the phase stays open for the next one.
- **Ready when:** a fleet update has failed a project's check since this was built.

## Real surfaces

- GitHub API: the fleet's update branches and PRs (draft and ordinary), opened by `keel fleet update`.
- Fleet over time: the first real update that fails a project's check.

## Proof

Automated: `node --test tests/fleet.test.mjs tests/update.test.mjs tests/board.test.mjs` (a stubbed gh and git: the push, the draft flag, each description's opening); `npm run check`.
By hand: the next real failing update, read by the owner as a PR.

## Deliberately open

- **Whether the agent fixes a draft unasked**: tend could take a draft update PR as its next job. Settled after the first few drafts show what the fixes look like.
- **A flaky check**: "main passes without the update" can mean a test that fails only sometimes (the fleet already says so). The draft says it too; a rerun of CI on the PR settles it.

## Next action

⚑ Walk: when a fleet update next fails a project's check, read its draft PR (the board lists it under Broken), fix it with one commit on its branch, and merge it.

## Trajectory

- **2026-10-09** — `update()` with `keepFailedCheck` commits the update on its branch and returns the failed check without pushing; the fleet then runs main's check on the clone (back on main, so without the update) and opens the PR itself (`publishUpdate`, lib/update.mjs). The scope had update return the check with the files left in place: committing first is what gives main's check a tree without the update.
- **2026-10-09** — A kept check is not a failure: its row is `ok`, so `keel fleet update` exits 0 when the only trouble was a check (the PR says it). The PR's Evidence line says the check's real exit, never "exit 0".
- **2026-10-09** — The fleet's existing machine-PR read asks `isDraft` too (no new call; same cache and quota floor); `machinePrs.drafts` names the draft ones. A draft update PR in a fleet checkout's loose ends is not listed twice: the fleet's Broken item wins.
