---
status: planned
since: 2026-10-09
goal: G5
spec: 2
depends: [33]
note: "An agent sees one run: not what a test usually takes, not whether the machine was busy, not what a failure said before. The ledger records machine load with each run, each test's usual time, failure text, the gate's trend, and (locally) the tests agents worked around; keel time reports it, and the gate runs its slowest files first. Design: research/2026-10-09-robot-and-time.md (phase 56)."
evidence: []
issue: 43
---

# keel knows where time goes

## Done when

Every recorded run carries how busy the machine was; a slow run on a busy machine is never counted as a slower test; each test's usual time, its failures' text and the gate's wall time over weeks are in `keel time --json`; the gate starts its slowest files first; and the tests agents worked around on this machine are reported locally.

## Scope

The design is [The robot, and keel's sense of time](../research/2026-10-09-robot-and-time.md), phase 56.

- **The machine, with each run**: the ledger record gains `busy`: the load average and core count at the run's start and end and, on Linux, the CPU pressure (`/proc/pressure/cpu`, or the cgroup's) over the run. `slow_tests` and `flaky_tests` skip a run whose machine was busy (load above cores), and say so.
- **Usual times**: each test's median over its last ten passes on the same machine class and config, written for the runner as `KEEL_USUAL` (a JSON file path). keel's gate orders its test files longest first by it.
- **Failure memory**: a failed test's record keeps the first lines of what it said (bounded, secrets redacted as the ledger already does). A failure that matches an earlier one on a flaky test says so in the hygiene block. A test that ends differently on an identical tree says it was decided by something besides the files, with each run's `busy`.
- **Trend**: the gate's wall time and each test's median, by week, for the last eight weeks.
- **Worked around** (local only, never in CI): from the coding agent's session records on this machine (Claude Code's transcripts under `~/.claude/projects/<this project>`), the test commands given a long timeout, run in the background, or interrupted. Read only; nothing is uploaded or committed.
- **`keel time [--weeks N] [--json]`** reports it all for the project. The board's week strip gains the gate's wall time.

## Acceptance

- [ ] A run's record carries `busy`; a run whose machine was busy is left out of `slow_tests` and `flaky_tests`, which say how many were left out. `tests/test-ledger.test.mjs`, `tests/improve-ledger.test.mjs`
- [ ] `KEEL_USUAL` names each test's median of its last ten passes; the gate's files run longest first. `tests/test-ledger.test.mjs`
- [ ] A failed test keeps the start of what it said; a repeat of an earlier failure on a flaky test is named as one; a different end on an identical tree is named as decided by something else. `tests/test-ledger.test.mjs`
- [ ] `keel time --json` reports the gate's and each test's weekly medians. `tests/time.test.mjs`
- [ ] Worked-around tests are read from a fixture transcript (a long timeout, a background run, an interrupt); nothing is read in CI, and nothing is written outside the cache. `tests/time.test.mjs`
- [ ] ⚑ by hand: the owner reads `keel time` for keel after two weeks and says whether it matches where the time felt like it went.

## Your part

- **Ask:** After two weeks, read `keel time` for keel and say whether it matches where you felt the time went.
- **Why:** The measures in phase 57 are built on it; if it is wrong, so will they be.
- **Look at:** `keel time --weeks 2` in keel.
- **Choices:** Matches | Misses something
- **Takes:** 5 minutes.
- **Then:** Matches: the phase is built. Misses something: what it missed goes into the evidence, and the record gains it.
- **Ready when:** two weeks of runs have been recorded with `busy`.

## Real surfaces

- Owner's machine: the ledger's runs and the agent's transcripts.
- Workflow shell: the night's runs on Linux, with CPU pressure.

## Proof

Automated: `node --test tests/test-ledger.test.mjs tests/improve-ledger.test.mjs tests/time.test.mjs`; `npm run check`.
Over time: two weeks of keel's own runs, read by the owner.

## Deliberately open

- **Transcripts are one agent's format**: Claude Code's today. Another agent's records are read when one is in use; until then "worked around" covers Claude Code only.
- **Busy is a threshold** (load above cores). Settled by whether busy runs still produce false slow findings.

## Next action

Brief a builder on `busy` and failure memory in the ledger; `keel time` follows.
