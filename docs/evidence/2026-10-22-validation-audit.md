# Evidence: phase 110 — recorded validation audit

- Date: 2026-10-22.
- Phase: 110, Recorded validation evidence produces actionable audits.
- Revision: `9b23419508b04b2c26a6c548435acc2d9722e1b7` plus working tree,
  committed as `phase 110: Recorded validation evidence produces actionable audits`.
- Claim: a bounded source-local command reports retained evidence and gaps
  without executing gates, sending notifications or authorizing reuse.

## Automated checks

Conductor independently ran:

- `node --import ./tests/helpers/hermetic.mjs --test tests/validation-audit.test.mjs tests/helpers.test.mjs tests/docs.test.mjs tests/guides.test.mjs`:
  exit 0, 26 passed, zero failed/skipped on Node
  v26.12.1. Thirteen are the new analyzer/CLI cases; the rest are conventions.
- `npm run typecheck`: exit 0; the repository's explicitly scoped contracts,
  not a claim that the new analyzer is statically typed.
- `npm run render:check`: exit 0, 91 targets, nine kept and 82 same.
- `node scripts/roadmap.mjs --check`: exit 0; 116 phases, eight goals.
- `git diff --check`: exit 0.

The first combined focused run exited 1: 20 passed and the installed-guide
command check rejected a source-only script. Moved its documentation into
`docs/development/`, retained the existing guard, then reran the same focused
set successfully. The builder's initial CLI tests also exposed macOS /var
symlink fixture paths; canonicalized the fixtures, retaining symlink refusal.
Neither issue required a full-suite iteration.

Final inspection found that a completed setup timeout accrued elapsed time to
the audit cutoff. The old calculation reported 3,600,000 ms for a recorded
300,000 ms setup. A regression assertion failed on the old calculation in an
isolated temporary copy (exit 1); the focused file passed after the correction
(exit 0, 13 tests). Ended setup now freezes elapsed/heartbeat age at its end;
a missing end remains unknown. The earlier full checkpoint was deliberately
terminated (exit 143) after this finding, not called a pass or retried into green.
Its incomplete logs are retained as `phase110-integrated.log`.

The next complete gate exited 1: 2,796 of 2,797 ordinary tests passed, with
all eight stall-pinned files passing. The sole failure was the repository
helper convention: the new test used direct spawn instead of the shared
`tests/helpers/run.mjs`. Replaced that call without weakening the guard and
added `tests/helpers.test.mjs` to the focused set. The failed checkpoint is
retained in `phase110-integrated-final.log`; its measured wall time was
404.25 s, user CPU 2,080.73 s and system CPU 996.67 s. These are separate
measurements, not additive elapsed time or a speedup. The local host was busy;
this is not a matched benchmark. This repeated the exact helper-convention
failure documented in the email case: it is a failed early-selection guardrail,
not a newly discovered convention. Parent direction required a deterministic
preflight before another broad run. Phase 110 now includes the conservative
source preflight and /spin instruction described below. The final required
checkpoint follows a clean corrected preflight.

The required integrated command is `npm run check` (ordinary tests, existing
stall probes and roadmap/render/inbox guards). It runs after this corrected record
on the final candidate; its actual result belongs in the phase commit body.
Normal PR check/typecheck/reconciliation and exact-head review remain required.
No required gate is removed, narrowed, cached by this analyzer, or redefined.

## Changed-file convention inventory before the next broad run

| Changed surface | Relevant early check |
| --- | --- |
| New analyzer and explicit-file CLI | `tests/validation-audit.test.mjs`; `node --check` for new JavaScript |
| New tests and subprocess calls | `tests/helpers.test.mjs`, hermetic preload, synthetic Acme fixtures |
| README and source documentation/command examples | `tests/docs.test.mjs`, `tests/guides.test.mjs` |
| `lib/agent-guide.md` and package command metadata | `tests/cli.test.mjs`, `tests/web-operation-coverage.test.mjs` with unchanged executable-metadata invalidation controls |
| Preflight command and fixed convention set | `tests/check-focused.test.mjs` (selection, invalid arguments, failure propagation) |
| Upstream conductor and rendered managed copy | `tests/practices.test.mjs`, `tests/decision-brief.test.mjs`, `tests/adopt.test.mjs`, `tests/skill.test.mjs`, `tests/guide-consumers.test.mjs`, `npm run render:check` |
| Phase acceptance, evidence references and generated roadmap | `npm run roadmap:check` after generation |
| Shared lesson render guard | `npm run inbox:check` |
| All diff paths | `git diff --check`; manually inspect scope and fixtures |
| Existing scoped production contracts | `npm run typecheck` |

The corrected preflight command is
`npm run check:focused -- tests/validation-audit.test.mjs tests/practices.test.mjs tests/decision-brief.test.mjs`.
Its mandatory conventions cannot be dropped by the caller. The builder’s first
expanded preflight exited 1 (47/49 passed, 24.284 s): a copied-tree CLI check
observed the conductor template while the builder was still rendering it, and
the package dry-run could not write the sandboxed default npm cache. Both
failures are retained in `phase110-preflight-builder-failed.log`. Subsequent
verification waits for a stable rendered tree and uses an isolated writable npm
cache; these environmental corrections do not weaken either assertion. Results are recorded
before starting the next integrated gate. Conductor execution exited 0: 72/72
tests passed, zero failures/skips, test-runner wall 23.559516 s. The files were
`validation-audit`, `check-focused`, `helpers`, `docs`, `guides`, `cli`,
`practices` and `decision-brief`. Roadmap (116 phases/eight goals), render
(91 targets), inbox and whitespace stages all passed. Scoped typecheck and
syntax checks passed; doctor reported zero drift and lint findings. This
preflight could not attest the full suite or authorize reuse. General change-aware
mapping remains phase 111. The result is retained as `phase110-preflight-accepted.log`.

The subsequent integrated attempt found another omitted convention:
`tests/adopt.test.mjs` rejects a hard-coded gate in the generic conductor text.
The new `npm run check:focused` example matched that existing guard. Stopped
this known-red run (exit 143), retaining `phase110-integrated-accepted.log`;
that filename does not mean acceptance. No completed timing or test count is
claimed for this interrupted attempt. This exposed a second incomplete
convention inventory, now corrected by adding adoption, skill and selected-guide
consumer checks to the mandatory preflight. The shared instruction describes
invoking the configured script without hard-coding a generic gate; the original
adoption assertion remains unchanged. Other search matches concerned fixture
history or unrelated runtime behavior and remain covered by the mandatory gate.

Expanded preflight: the same documented command exited 0 with 130/130
tests passed, zero failures/skips, test-runner wall 87.642465042 s. Its exact set
was helpers, docs, guides, CLI, adopt, skill, guide-consumers, check-focused,
validation-audit, practices and decision-brief. Roadmap/render/inbox/whitespace
stages passed, as did scoped typecheck and syntax checks. The unchanged adoption
guard was separately demonstrated failing before the wording correction and
passing afterward (one test). Logs: `phase110-preflight-complete.log`,
`phase110-adoption-red.log`, `phase110-adoption-green.log`. The subsequent integrated run exited 1: 2,800/2,803 ordinary tests passed,
all eight stall-pinned files passed. The three failures all named the package
capability binding changed by the new source-only script alias. Measured cost:
431.17 s wall, 2,013.67 s user CPU, 994.54 s system CPU; ordinary reporter wall
365.445825583 s is nested, not additive. Logs remain
`phase110-integrated-complete.log` and `phase110-integrated-complete-time.log`.
This was another missed audit preflight lesson. The package diff adds only
`check:focused`; bin/exports/engines/runtime dispatch are unchanged. Refreshing
that one reviewed package binding requires normal PR review, retains the
existing executable-metadata invalidation controls and adds their suite to the
mandatory preflight. No security setting, capability authority or gate policy
changes. Observed validation costs are not savings benchmarks.

Final complete preflight after package-binding review: exit 0, 140/140 tests,
zero failures/skips, test-runner wall 32.457286667 s. The exact set is the eleven
files above plus `tests/web-operation-coverage.test.mjs`. All five stages passed;
scoped typecheck passed and doctor reported zero drift/lint. The unchanged
capability suite was red before the binding refresh (7/10) and green afterward
(10/10), including its mutation controls. Logs: `phase110-preflight-verified.log`,
`phase110-capability-red.log`, `phase110-capability-green.log`. The final required
integrated command remains `npm run check`; its result is recorded in the phase
commit body and retained in `phase110-integrated-verified.log`, after this record.

## Retained evidence replay on the owner's machine

Command:
`node scripts/validation-audit.mjs --manifest plates.json --input ../audit-input.json --json`.

The local task workspace retains `prepare-audit-replay.py`, `audit-input.json`,
`audit-replay-provenance.json`, `audit-replay.json` and `audit-replay-run.json`.
The normalizer reads the completed audit's original source files, records each
source SHA-256 and copies only known fields. It neither runs tests nor fetches
anything. The fixed historical cutoff is 2026-10-22T20:50:00Z, not a claim of
current fleet state. No private full logs or source paths are added to fixtures.

Observed exit 1 means actionable gaps, as documented; this is successful audit
execution, not a gate failure to rerun. It processed 50 records: 44 historical
source gates, two Ledger test records and four isocan profile-artifact records.
Duo and Cajones had no normalized records in this replay and were explicitly
reported missing rather than silently considered healthy.

| Rule | Findings |
| --- | ---: |
| Missing project coverage | 2 |
| Missing comparable baseline | 50 |
| Missing configured gate coverage | 2 |
| Missing review coverage | 3 |
| Missing wall or CPU telemetry | 50 |
| Incomplete configured-gate attestation | 44 |

The analyzer did not call the partial consumer records reusable, infer full
stage equivalence, label incomparable historical runs regressions, or claim
saved test time. Replay elapsed wall time was 0.121519333 s (Python monotonic
measurement of one CLI invocation). CPU was not collected. This is execution
cost, not a benchmark or observed improvement in pipeline speed. Nested test,
gate and hosted waits remain separate; there is no summed elapsed-day claim.

Reviewed the code boundary: the library imports only Node crypto; the source
entrypoint reads two explicit bounded regular files and prints a result. It
has no execution/network/write adapter. Synthetic negative controls cover
conflicting input copies, missing/extra/failed stage records, changed inputs,
dirty trees, insufficient baselines, missing CPU, stale review head/workflow,
wrong review events, unsupported freshness, malformed/symlink/oversized input,
scope exclusion and stable duplicate handling. Text groups repeated actions;
JSON keeps stable individual evidence identifiers for caller deduplication.

## Gaps and decision

Status remains partial. Exact committed-head CI/review and the parent's review
before broader rollout are still pending. The actual configured cross-review
routing identifies `codex/` as Codex-authored and selects Claude, so this branch
retains its honest provider prefix rather than adopting the skill’s stale
Claude-only practice example. The release gate requires a reviewed PR and
answered findings, not that example’s prefix. No review bypass is used. The source-only analyzer consumes
explicit schema-1 normalization; production collectors and consumer equivalent
attestation producers are separate phases. Supplied digests and summarized
baselines are recorded claims, not independently authenticated evidence. A
zero-finding report never authorizes gate reuse.

The six-stage spec is committed separately. Phases 111–115 are designed, not
implemented or benchmarked: preflight/resource admission, Ledger independence,
isocan watchdog, consumer attestations and shadow selection. No schedules,
recipients, blocked email automation, credentials, callback URLs, deployments,
consumer code, required gate policy or local canonical main were changed.
The branch excludes the unpushed email-renderer commit `c33084dd`.
