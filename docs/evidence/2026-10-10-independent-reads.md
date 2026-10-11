# Evidence: phase 68 — independent read costs

- Date: 2026-10-10
- Phase: [68](../phases/68-independent-reads.md)
- Revision: `16b2498` and working tree for “phase 68: Independent reads do not wait for each other”.
- Claim: bounded fresh GitHub reads remove serial waits without changing results; local overlap is not retained without a clear benefit.

## Automated checks

- `node --import ./tests/helpers/hermetic.mjs --test tests/time.test.mjs`: exit 0, 30 passed. No local runtime change was retained.
- `npm run typecheck`: exit 0 on the integrated dependency baseline.
- `node --import ./tests/helpers/hermetic.mjs --test tests/reconciliation.test.mjs tests/reconciliation-parallel.test.mjs tests/reconciliation-integration.test.mjs`: exit 0, 47 passed. Barrier tests verify the four-request cap, independent slot reuse, deterministic order, malformed/tool/timeout failures, offline/empty cases and both fresh proposal-verification passes.
- `npm run render`: exit 0, one managed source target updated; also refreshed the existing robot-route lock digest without changing its workflow bytes.
- Initial integrated gate exited 1 (1,260 passed, two failed) because two new acceptance items lacked named proof commands. The CLI contract test reproduced the error in isolation. After correction, the CLI contract and self-doctor tests each passed alone (exit 0, one test each). All pinned stall checks passed; hygiene reported no flaky or slower test.
- Final gate: `npm run check` covers runtime tests, generated roadmap, managed rendering and inbox consistency. Its result belongs in the commit body.

## Real measurements

`node /tmp/keel-phase68/github-bench.mjs`: exit 0. Five alternating
before/after real reconciliation pairs, two PRs per call, all remote facts
observed, zero unknowns or findings. Complete results matched in every pair.
Median elapsed 1,426.7 to 736.2 ms; no API payloads saved.

Local scratch experiments used twenty alternating pairs and ten instrumented
baseline runs. Complete result hashes matched in all 50 samples. Transcript
processing dominated; overlapping readers changed the function median by only
1.9 ms, within observed variation, so no local code change was retained.
Conductor independently ran the instrumented baseline: history 49.52 ms,
summary 2.30 ms, retention 0.34 ms, transcripts 175.83 ms; total 228.80 ms.
This single verification corroborates the cost distribution, not a speed claim.

[Research and reproduction](../research/2026-10-10-independent-reads.md)
links raw local and GitHub observations and explains the measurement scope.

## Gaps and decision

The GitHub results measure the engine, excluding CLI startup. Network and
filesystem caches are uncontrolled. Requests remain fresh; merging is never
acceptance. Timeout tests inject timeout-shaped tool errors and check the unchanged
15-second option; they do not spend 15 seconds waiting. The concurrency cap
is tested deterministically, not by requiring
a particular wall-clock improvement. This is implementation evidence, not a
claim of production deployment or lived-in adoption across the fleet.
