---
status: planned
since: 2026-10-09
goal: G4
spec: 2
depends: [54, 56]
note: "The night writes one proposal, but nothing watches time get worse: the gate creeping, a test's median rising, wall-clock tests left unmoved, a test agents keep waiting out. New time measures with bounds feed the proposal with the fix named; an accepted one is filed as a keel:agent issue the robot builds, and the next night says whether it worked. Design: research/2026-10-09-robot-and-time.md (phase 57)."
evidence: []
issue: 44
---

# Time getting worse becomes a proposal, and a fix

## Done when

The night measures time against bounds (`gate_time`, `time_creep`, `wall_clock_tests`, `inconclusive_share`; `worked_around` from the conductor's machine), its proposal names the fix when one is outside, an accepted time proposal is filed as a `keel:agent` issue that the robot builds, and two such fixes have been merged and their measure seen back inside its bound.

## Scope

The design is [The robot, and keel's sense of time](../research/2026-10-09-robot-and-time.md), phase 57.

- **Measures** (the night, from the ledger, phase 56):
  - `gate_time`: the gate's wall time, against a bound the project sets, or 1.25 × its four-week median.
  - `time_creep`: tests whose median rose more than 1.5 × over four weeks.
  - `wall_clock_tests`: tests `--stalls` named that are not pinned yet.
  - `inconclusive_share`: tests inconclusive in half their runs.
  - `worked_around`: from `keel time` on the conductor's machine. keel-side only, n/a in CI.
- **Each measure names its fix**: a measure outside its bound carries the change it proposes, with the command that shows the problem and the measure that shows it mended: "move `<test>` to mock timers (failed under stalls, seed N)"; "split `<file>`: its tests take as long as the whole gate"; "`<test>` was waited out N times this week".
- **Accepted means filed**: accepting a time proposal on the board (`keel walk decide --accept`) files a `keel:agent` issue in the rubric's shape (phase 54) and links it from the health page; with the robot off, the issue is filed without the label and waits for the owner.
- **The loop closes**: the next night's measure, after the fix's PR merges, is written into the health page beside the proposal: back inside its bound, or not.

## Acceptance

- [ ] Each time measure reads the ledger and is n/a with too few runs, never a zero; `worked_around` is n/a in CI. `tests/improve-measures.test.mjs`
- [ ] A measure outside its bound carries its fix, its command and the measure that will show it mended; the night's proposal uses it. `tests/improve-measures.test.mjs`
- [ ] Accepting a time proposal files a `keel:agent` issue with every rubric field (without the label when the robot is off) and links it from the health page. `tests/board.test.mjs`
- [ ] After the fix merges, the next health page says whether the measure came back inside its bound. `tests/improve.test.mjs`
- [ ] ⚑ by hand: two time proposals accepted, built by the robot, merged by the owner, and seen back inside their bounds.

## Your part

- **Ask:** When the night proposes a fix for something that has got slower, accept or decline it on the board, then merge the robot's fix if it looks right.
- **Why:** It is the whole loop: keel notices, proposes, builds and checks, and you only decide.
- **Look at:** The health page's proposal and the robot's PR.
- **Choices:** Accept | Decline
- **Takes:** 5 minutes per proposal.
- **Then:** Accept: an issue is filed for the robot, and the next night says whether the fix worked. Decline: the reason is recorded, and the measure is not proposed again for four weeks.
- **Ready when:** phases 54 and 56 are built and the night has proposed a time fix.

## Real surfaces

- Workflow shell: the night's measures and health page.
- GitHub API: the filed issue, the robot's PR.
- Fleet over time: proposals accepted, fixed, and measured back inside their bounds.

## Proof

Automated: `node --test tests/improve-measures.test.mjs tests/improve.test.mjs tests/board.test.mjs`; `npm run check`.
Over time: two real fixes, from proposal to the measure back inside its bound.

## Deliberately open

- **Bounds**: 1.25 × and 1.5 × are first guesses. Settled by how many proposals the owner declines as noise.
- **One proposal a night**: time competes with every other measure for it. Settled by whether time fixes wait too long behind others.

## Next action

After phase 56, brief a builder on the time measures and their fixes.
