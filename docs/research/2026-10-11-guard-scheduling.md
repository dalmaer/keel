# Guard scheduling experiment (2026-10-11)

Outcome: **not adopted**. Keep the existing climb guard file, its eight-file
stall set and 32 outer test-file workers. A faster isolated file did not provide
strong enough evidence of a worthwhile, repeatable whole-gate improvement.
The uncommitted phase-70 proposal was withdrawn; no phase was completed by this
experiment. This supplements the [test-value audit](2026-10-11-test-value.md).

## Measurements

11 October 2026, Node v24.21.0, macOS arm64, 14 logical CPUs, baseline
`abecf778c00ce983fa50e28a874c2348e411450e`. Each full observation ran
`npm run check` sequentially, without another audit test job running alongside
it. All passed 1,518 test events and every configured stall check. Other host
activity was not controlled; these are single observations, not distributions.

| Layout | Outer workers | Stall files | Full gate, seconds |
| --- | ---: | ---: | ---: |
| Original guard file | 32 | 8 | 190.498 |
| Three guard files | 32 | 10 | 174.551 |
| Three guard files | 16 | 10 | 183.312 |

The focused original file passed 27 cases in 42.051 seconds. A repo-shaped
scratch split passed in 18.837 seconds, and the proposed checkout split passed
in 17.335 seconds. An earlier scratch run failed a relative import; its elapsed
time is excluded. Splitting retained every original statement and assertion:
the three bodies reconstructed the original bytes exactly. The split preserved
all scenarios in the stall runner, rather than making the gate faster by
dropping checks.

With 32 workers, ordinary-suite elapsed time increased from 110.588 to 171.428
seconds while stall work overlapped more. Full-gate time improved by about
8.4%, much less than the isolated-file result. Lowering concurrency to 16
did not improve on that observation. Load samples identify context, not peak
load or causal attribution. These observations neither prove the original
layout optimal nor justify shipping the split as a dependable speedup.

## Reproduction and retained records

The [before](../evidence/2026-10-11-guard-scheduling/before.json),
[split at 32](../evidence/2026-10-11-guard-scheduling/after.json) and
[split at 16](../evidence/2026-10-11-guard-scheduling/split16.json) receipts
retain source hashes, revision, command, elapsed time, exit status and load.
The [preservation receipt](../evidence/2026-10-11-guard-scheduling/preservation.json)
records the experiment's byte equality, not the current unsplit tree.

To reconstruct the experiment in a disposable checkout of that baseline:
repeat original lines 1–13 as the header of each file; partition lines 14–190,
191–497 and 498–831 into `climb-guard.test.mjs`,
`climb-guard-state.test.mjs` and `climb-guard-history.test.mjs`, respectively.
Preserve the original newlines. Add the two new paths immediately after the
original path in `.keel/keel.json`'s `tests.stalls`. For the 16-worker variant,
change only `--test-concurrency=32` to `--test-concurrency=16` in `scripts.test`.
Compare hashes to the receipts before timing.

The retained [measurement script](../evidence/2026-10-11-guard-scheduling/gate-bench.py)
uses this machine's absolute checkout and `/tmp/keel-phase70` paths. Adjust
those constants explicitly for a disposable checkout on another machine.
Run `python3 docs/evidence/2026-10-11-guard-scheduling/gate-bench.py unique-label`;
it refuses to overwrite an existing observation. Raw focused/full logs remain
in `/tmp/keel-phase70`, `/tmp/keel-guard-split` and `/tmp/keel-test-audit`.

## Audit disposition

The retained phase-69 optimization has matched before/after/after/before
evidence and sensitivity checks. This scheduling experiment does not add to
its speedup claim. Test-count reduction is not a target in itself: the retained
suite has 1,518 events, while redundant evaluations and process launches fell.
Coverage gaps and historical catches remain documented in the main audit;
this experiment does not change their assessment.
