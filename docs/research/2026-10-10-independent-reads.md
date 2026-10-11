# Independent read costs

Phase 68 follows the phase 67 measurements. Baseline source is `16b2498`,
including the practice updates pulled before this work; earlier phase 67
numbers are context, not the baseline for this comparison.

## GitHub reconciliation

On 10 October 2026, five alternating before/after pairs called the real
`reconcile({root, github: true, now})` export on the same Keel records and two
referenced PRs. Each pair used a fixed observation timestamp and compared the
complete returned objects in memory. All five were identical, with zero
unknowns and zero findings. Raw measurements contain no API payloads:
[observations](../evidence/2026-10-10-independent-reads-github.json).

| Reconciliation | Median | Range |
| --- | ---: | ---: |
| Sequential reads (baseline) | 1,426.7 ms | 1,377.9–1,448.8 ms |
| Up to four concurrent reads | 736.2 ms | 725.0–892.0 ms |

The median reduction was 690.5 ms (48%). This measures the reconciliation
engine including local record reads, not whole CLI startup. The elapsed time
inside `gh` includes tool, network and server work; it is not pure network
latency. Node 24.21.0, macOS arm64; one-minute load ranged 4.4–4.8.
No warmup samples were discarded; network and filesystem caches were
uncontrolled. Every request still reads fresh facts and retains its existing
15-second timeout. A four-worker pool bounds live requests, and results and
errors are published in original input order. Proposal verification retains
its second reconciliation pass to check current records and facts again.

Reproduction: extract the baseline standalone engine with
`git show 16b2498:practices/reconciliation/files/scripts/keel/reconcile.mjs`
to a scratch `.mjs` file, import its `reconcile` export and the current
practice export, and time each with `performance.now()`. Use the same real
root and fixed `now`, five pairs, swapping order on alternate pairs. Record
Node, OS, load, elapsed time, remote availability, PR/finding/unknown counts,
and whether the complete JSON results match. Never save API payloads.

## Local timing

Twenty alternating before/after fresh-process pairs tested independent read
overlap in temporary module copies; ten baseline samples measured individual
stages. The actual local root/home and fixed report time
`2026-10-10T18:00:00Z` were used, with an eight-week window. Only aggregate
timing, load and full-result hashes were saved, never transcript content:
[raw observations](../evidence/2026-10-10-independent-reads-local.json).

| Baseline stage | Median |
| --- | ---: |
| Transcript processing | 165.95 ms |
| Run history | 27.74 ms |
| Summary | 2.37 ms |
| Retention | 0.13 ms |

The candidate overlapped `readRuns`, `readRetention` and `workedAround` with
`Promise.all`, then computed the summary. Function medians were 199.51 ms
before and 197.60 ms after; fresh-process medians were 237.12 and 234.60 ms.
Paired function savings ranged from -7.93 to 22.54 ms, median 2.27 ms;
15 of 20 pairs improved. All 50 full-result hashes matched, including
formatted text and JSON. One-minute load was 5.09 to 4.83, with uncontrolled
filesystem caches. The process runner excludes CLI dispatch; these are wall
times, not isolated CPU costs, and stage medians are not one additive run.

**Decision: retain no local runtime change.** The small overlap saving is
within observed noise. Transcript processing dominates; a future CPU profile
could distinguish parsing from file reads before proposing an incremental
index or cache. Those would introduce freshness and coverage complexity and
are not justified by this experiment.

Reproduction: copy `lib/time.mjs` to scratch, resolving its ledger import to
the checkout. Create a candidate that awaits the three independent readers
with `Promise.all` and then calls `timeSummary`. Alternate the baseline and
candidate in fresh Node processes for 20 pairs, timing `keelTime` with
`performance.now()` and hashing the complete returned JSON. In a third copy,
time each of the four baseline stages separately for ten fresh processes.
Retain statuses, raw timings, hashes and load context; never source content.
Actual histories evolve, so later measurements need their own baseline.
