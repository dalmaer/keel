---
status: partial
owes: walk
waits: owner
since: 2026-10-10
goal: G4
spec: 2
depends: [54, 56]
note: "Implemented bounded timing evidence, resumable fix proposals and installed-night remeasurement. Independent proof and real artifact recovery verified; two owner-approved robot fixes and measured outcomes remain owed."
evidence: ["evidence/2026-10-10-time-proposals.md"]
issue: 44
---

# Time getting worse becomes a proposal, and a fix

## Done when

The night measures time against bounds (`gate_time`, `time_creep`, `wall_clock_tests`, `inconclusive_share`, `critical_file`; `worked_around` from the conductor's machine), its proposal names the fix when one is outside, an accepted time proposal is filed as a `keel:agent` issue that the robot builds, and two such fixes have been merged and their measure seen back inside its bound.

## Scope

The design is [The robot, and keel's sense of time](../research/2026-10-09-robot-and-time.md), phase 57.

- **Measures** (the night, from the ledger, phase 56):
  - `gate_time`: the gate's wall time, against a bound the project sets, or 1.25 × its four-week median.
  - `time_creep`: tests whose median rose more than 1.5 × over four weeks.
  - `wall_clock_tests`: tests `--stalls` named that are not pinned yet.
  - `inconclusive_share`: tests inconclusive in half their runs.
  - `critical_file`: a test file whose verified duration dominates complete comparable suites, with the sample and runner-up margins in the timing proposal contract (lesson 57). The fix proposed is to split it, naming its slowest tests as the cut, or to run its independent checks concurrently.
  - `worked_around`: from `keel time` on the conductor's machine. keel-side only, n/a in CI.
- **Each measure names its fix**: a measure outside its bound carries the change it proposes, with the command that shows the problem and the measure that shows it mended: "move `<test>` to mock timers (failed under stalls, seed N)"; "split `<file>`: its tests take as long as the whole gate"; "`<test>` was waited out N times this week".
- **Accepted means verified**: accepting a time proposal on the board (`keel walk decide --accept`) creates or recovers the rubric-shaped issue and links it from the health page. With the robot off, verified unlabelled creation succeeds and waits for the owner. With the robot enabled but its required label missing, retain accepting plus the verified issue and reason; retry never duplicates or automatically relabels it.
- **The loop closes**: the next night's measure, after the fix's PR merges, is written into the health page beside the proposal: inside, outside, or unavailable when comparable evidence is insufficient.

## Acceptance

- [x] Each time measure reads the ledger and is n/a with too few runs, never a zero; `worked_around` is n/a in CI. `tests/time-measures.test.mjs`
- [x] `critical_file` names a file whose own time sets the suite's wall time (a synthetic ledger with one file at twice the rest) and stays quiet when no file does. `tests/time-measures.test.mjs`
- [x] A measure outside its bound carries its fix, its command and the measure that will show it mended; the night's proposal uses it. `tests/time-measures.test.mjs`
- [x] Accepting a time proposal files a `keel:agent` issue with every rubric field (without the label when the robot is off) and links it from the health page. `tests/board.test.mjs`
- [x] After the fix merges, the next health page says whether the measure came back inside its bound. `tests/time-proposal-actions.test.mjs`
- [ ] ⚑ by hand: two time proposals accepted, built by the robot, merged by the owner, and seen back inside their bounds.

## Your part

- **Ask:** When the night proposes a fix for something that has got slower, accept or decline it on the board, then merge the robot's fix if it looks right.
- **Why:** It is the whole loop: keel notices, proposes, builds and checks, and you only decide.
- **Look at:** The health page's proposal and the robot's PR.
- **Choices:** Accept | Decline
- **Takes:** 5 minutes per proposal.
- **Then:** Accept: an issue is filed for the robot, and later nights report inside, outside or unavailable against its frozen bound. Decline: the reason is recorded, and the measure is not proposed again for four weeks.
- **Ready when:** phases 54 and 56 are built and the night has proposed a time fix.

## Real surfaces

- Workflow shell: the night's measures and health page.
- GitHub API: the filed issue, the robot's PR.
- Fleet over time: proposals accepted, fixed, and measured back inside their bounds.

## Proof

Automated: `node --test tests/time-measures.test.mjs tests/time-proposals.test.mjs tests/time-proposal-actions.test.mjs tests/time-improve.test.mjs tests/test-history.test.mjs tests/improve-measures.test.mjs tests/improve.test.mjs tests/board.test.mjs`; `npm run check`.
Over time: two real fixes, from proposal to the measure back inside its bound.

## Deliberately open

- **Settled 2026-10-10: numerical and producer contract.** [Timing proposal contract](../specs/time-proposals.md) specifies windows, minima, retention and typed evidence. Thresholds are investigation defaults, not statistical significance. Missing or incompatible evidence stays unavailable. The audit found the current ledger lacks complete file telemetry and trusted outer gate timing; those producer changes are part of this phase, without relabelling historical records.
- **Settled 2026-10-10: resumable acceptance.** A stable measure/target/lane subject suppresses duplicate work and declines; a separate instance owns the immutable baseline. Persist intent before issue creation and recover by verified identity. Preserve lifecycle and human content through night regeneration. A merge alone never proves improvement.
- **Settled 2026-10-10: changed topology needs review.** A split or concurrency change needs an explicit reviewed transition with complete logical-test coverage. The disappearance of a file is never an improvement verdict. The original diagnosis and baseline remain immutable.

- **Bounds**: 1.25 × and 1.5 × are first guesses. Settled by how many proposals the owner declines as noise.
- **One proposal a night**: time competes with every other measure for it. Settled by whether time fixes wait too long behind others.

## Next action

After the owner chooses a project and the phase 54 robot allowance, accumulate comparable observations, accept two real time proposals, inspect and merge their fixes, and verify subsequent nights against the frozen bounds. Review exhaustive mappings for any changed test topology. Until those observations exist, retain unavailable; acceptance of an issue and merge status do not establish improvement.

## Trajectory

- **2026-10-09** — The lever this phase is for was found by hand first. `tests/climb.test.mjs` (96 s, its tests one after another) set keel's `npm test` at 96 s; split into five files, the suite took 47–51 s (418181a). A second round, splitting `improve.test.mjs` and `improve-measures.test.mjs` (53 s and 50 s), showed no difference in an alternating A/B (64–74 s before, 66–72 s after) with the machine's load average at 80–130 on 14 cores, and was reverted: once no file stands out, the suite waits on the CPU, not a file. So `critical_file` must fire only when one file's time clearly exceeds the others' (the bound above), never on a suite whose files are all slow together. The self-test's 87 runs now go 8 at a time (41 s to 12.5 s when the file runs alone).

- **2026-10-10** — Historical reporter wall time cannot establish complete gate or file timing. CI now wraps its existing check once with the configured outer launcher; legacy records remain unavailable. Bounded artifact recovery preserves loss provenance. [Evidence](../evidence/2026-10-10-time-proposals.md).
- **2026-10-10** — An adopted night needs delivery verification without the mothership CLI. Shared read-only delivery/budget modules moved into night with unchanged installed paths; owner drift and frozen health-page decisions survive updates. A reviewed test split proves identity coverage, not faster execution by itself.
