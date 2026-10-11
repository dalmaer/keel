# Interpretation of the native function-entry observations (2026-10-11)

2026-10-11. Production source: `3ef01bef9dd4f4f06b8dfce425712ac118fca4dd`. Analysis used source/test reads and existing raw profiles only; no tests or repository edits were made by this sidecar. Parent changes to tests and phase 69 are distinct from production source. This report interprets the counts in `native-coverage-summary/coverage-summary.json` and the full per-file offsets in `coverage-file-stats.json`.

## Scope and corrected denominator

The summarizer excludes all four tracked `practices/*/files/tests/*.test.mjs` files from production and preserves their paths separately under `excludedTestSources` in both JSON artifacts. They are shipped test assets, not absent production modules. No name-based exclusion removes runtime modules such as `test-ledger.mjs` or `lib/test.mjs`.

- 117 tracked `.mjs` candidates under lib/bin/practices/scripts minus 4 shipped test files = **113 production modules**.
- **102 modules observed; 11 absent** under the exact checkout URL rule.
- **8,493 raw native profile files**, including subprocess profiles; zero JSON parse errors, zero invalid coverage shapes, zero old `keelAudit` rewritten profiles.
- File-qualified function slots: **4,377 entry-positive / 5,338 observed**, or 961 zero-entry slots. These retain canonical and rendered paths separately.
- The additional union report collapses only 30 manifest-linked, currently byte-identical copy groups by entry offsets: **4,218 positive / 4,646 observed**, or 428 zero-entry slots. This is an alternative grouping, not another corpus to add.
- No overall percentage is claimed. Unobserved modules contribute no function denominator, and imported-but-never-called wrappers can contribute observed functions. Function entry execution does not establish assertion, branch or behavior coverage.

The paired native log says **1,517 tests, 1,514 pass, 3 fail**, not a fully passing collection. Two failures are CLI/doctor reporting the parent's phase-69 formatting; the parent reports the format fixed and doctor lint empty. The third is Loop's exact child-environment allowlist encountering Node's added `NODE_V8_COVERAGE`; the log shows that extra variable. These collection/record failures do not justify weakening the allowlist. Some test scenarios stopped early, so their later paths cannot be inferred exercised. This report neither reran those tests nor folded these three failures into the earlier ledger's product interpretations.

## All eleven absent modules, assessed against their copies and tests

All pairs below have identical current bytes according to the tracked practice manifest mapping. Numbers are entry-positive / observed at the **other exact checkout path**, not proof of full contract coverage.

| Absent exact source URL path | Other copy / source evidence | Assessment |
| --- | --- | --- |
| `practices/climb/files/scripts/keel/climb.mjs` | Rendered `scripts/keel/climb.mjs`: 12/119. `tests/helpers/climb.mjs:45` copies the canonical file into synthetic Acme projects; `climb()` executes that path and `load()` imports it. | Primarily copied-adopter exclusion. Most meaningful command tests execute the temporary copy; 12/119 on the rendered file is not the command family's test coverage. |
| `practices/climb/files/scripts/keel/tend.mjs` | Rendered `scripts/keel/tend.mjs`: 34/94. `tests/tend.test.mjs:17` directly imports selected rendered helpers; `tests/climb-tend.test.mjs:68` imports the copied project module. | Mixed direct helper observation and copied integration exclusion. Neither absence nor the uncalled rendered functions establishes no test. |
| `practices/climb/files/scripts/keel/robot.mjs` | Rendered copy: 1/50. `tests/robot-runtime.test.mjs:15–20` copies both shipped sibling directories to `acme-robot-runtime-*`, then imports/executes robot there. | Copied runtime exclusion, not a blanket robot testing gap. A single positive rendered function can be module initialization. |
| `practices/cross-review/files/scripts/keel/cross-review.mjs` **and** `scripts/keel/cross-review.mjs` | Both absent. `tests/cross-review.test.mjs:24–42` copies the canonical script into `keel-cross-review-acme-*` and executes that copy with stub gh. The native log contains successful cross-review cases. | Two absent paths for one copy family exercised elsewhere. Do not create redundant direct-import tests just to make both URLs positive. |
| `scripts/keel/distill.mjs` | Canonical `practices/climb/files/scripts/keel/distill.mjs`: 32/37; imported by `tests/distill.test.mjs:17`, also copied into climb projects. | Rendered-copy absence; remaining five canonical zero entries still need their own interpretation. |
| `scripts/keel/robot-rubric.mjs` | Canonical: 14/14; `tests/robot-rubric.test.mjs:3` imports its validator/parser/formatter. | Rendered-copy absence. 14/14 means observed function entries, not all decisions or inputs checked. |
| `scripts/keel/drain.mjs` | Canonical: 34/36; direct imports in reconciliation integration and night tests. | Rendered-copy absence; two canonical zero entries are not resolved by this table. |
| `scripts/keel/reconcile.mjs` | Canonical: 83/84; direct imports in reconciliation, update and robot tests. Parallel tests additionally import `reconcile.mjs?barriers=...`, intentionally excluded by exact URL matching. | Rendered-copy and query-URL exclusion. Do not merge query variants into production totals without establishing what they contain. |
| `scripts/keel/stalls.mjs` | Canonical: 42/45; `tests/stalls.test.mjs:16` imports it; interrupt fixture imports it too. | Rendered-copy absence, with direct canonical checks. No assertion of complete process/signal behavior. |
| `scripts/keel/test-history.mjs` | Canonical: 31/33; `tests/test-history.test.mjs:7` imports reader/recovery. | Rendered-copy absence. Two remaining canonical zero entries are not automatically dead code. |

Exact URL filtering deliberately leaves copied adopter, packed package, worktree, query-suffixed and generated-VM executions out of the primary totals. That prevents mutants or similarly named files from inflating coverage, but also creates these false-negative interpretations if the source/test layout is ignored. Copy equality today is not a raw-profile source hash at collection time.

## High-value zero entries and what they mean

### 1. Evidence cancellation: genuine gap, now addressed by a focused supplement

Full-corpus `lib/evidence.mjs:135` had `onSignal` at UTF-16 offsets **[7723,7816)** and its signal-handler closure **[7888,7907)** at zero. Source registers SIGINT, SIGTERM and SIGHUP handlers that kill the child process group, finish cleanup, and potentially re-signal the parent. Existing `tests/evidence.test.mjs` tested timeout/output limits and ordinary descendant cleanup, but did not invoke this cancellation path. This was a real missing cancellation test, not serialization or a copied-module artifact.

The parent subsequently added `measurement cancellation cleans the process group and restores signal listeners` at `tests/evidence.test.mjs:329`. Source inspection shows all three signals, a forwarding spy over real `process.kill`, a process-group kill assertion, group-leader disappearance, and exact restoration of signal/exit listeners. It uses `process.emit(signal)` with an existing host listener; it does not deliver an OS signal to the test runner. The parent reports the focused check passed in about 0.12 s; this sidecar did not rerun it.

The **separate** `/tmp/keel-test-audit/cancellation-coverage` corpus contains one native profile, `coverage-5234-1791755951863-0.json`, with the exact checkout `lib/evidence.mjs` URL. Inspection confirms **onSignal entry count 3**, and the registered closure entry count 3. Its inner range **[7783,7814)** still has count 0: `process.kill(process.pid, sig)` when no other signal listener remains. Thus listener-preserving cancellation is addressed; **default self-resignal/termination semantics remain uncovered**, as do any untested higher-order signal races. The new check establishes the actual group-kill call and leader exit, not a fresh live-grandchild walk for each cancellation signal. Existing descendant cleanup tests cover a different trigger.

These focused observations are recorded separately in `native-coverage-summary/cancellation-supplement.json`. Full-corpus counts and zero lists remain unchanged; no full-suite rerun or combined coverage percentage is claimed.

### 2. Canvas browserMain: serialized execution, not an untested browser function

`lib/canvas-render.mjs:219`, `browserMain` **[24757,26930)**, has zero entry at the module URL because `renderSnapshot` serializes functions with `toString()` into HTML and calls browserMain inside the generated script. `tests/canvas-render.test.mjs:25–34` extracts that script and runs it with `runInNewContext`; the test at line 79 exercises filters, reset, delivery grouping, relation navigation, focus and empty metric results. The native log explicitly records this case passing.

Classification: **serialized/VM URL exclusion**, not a true missing entry test. This is a synthetic DOM behavior check, not a browser layout/accessibility/deployment proof. Keep that boundary explicit; marking browserMain “dead” or adding a direct module call to improve the number would misunderstand how it runs.

### 3. Canvas transport: some dependency-injected gaps, some packed-copy execution

At the exact `lib/canvas-sync.mjs` URL, these default transport wrappers are zero: `space` (line 85, [6461,6529)), `list` (88, [6734,6809)), `groups` (89, [6823,6917)), `groupNew` (90, [6933,7072)), `show` (91, [7084,7179)). Most `canvas-sync.test.mjs` state-machine cases inject an in-memory transport. The direct executable-boundary case at line 222 exercises capabilities, create, add and failing identity; it does not call these five wrappers directly.

However, `tests/canvas-package.test.mjs:168` runs the actual packed CLI through interrupted publication/recovery with a strict fake executable. It supports group creation, list and show and checks durable intents, no duplicate creation and preserved human edits. A supplemental read-only scan of the native corpus, restricted to URLs matching `/keel-canvas-package-*/package/lib/canvas-sync.mjs`, found 11 script/profile records. Each wrapper appears in 10 records: **list positive in 1, groupNew in 1, show in 5; space positive in 0 and groups in 0**. These are observation counts, not total function invocations. This auxiliary scan did not add any copied URL to the production denominator.

Classification:

- **list, groupNew, show:** observed in the packed-copy scenario; not globally untested default adapters. Exact-source zeros reflect the filter and injection strategy.
- **space and groups:** genuine unexercised default-adapter entries in the reviewed full/excluded-package observations. Creation authorization uses `transport.space`; pending-group recovery uses `transport.groups`. Injected fake methods check the state machine but cannot validate the real wrapper's command/home/ID construction. A small executable-boundary check is a stronger next step than duplicating full publication scenarios. No live isocan claim follows from a stub.
- `status` and `disconnect` at lines 509–510 are zero forwarding aliases. `lib/canvas.mjs:157` routes the CLI to `canvasStatus`/`canvasDisconnect` directly, and CLI tests exercise those operations. These alias zeros are low-priority API-wrapper observations, not evidence that user status/disconnect behavior lacks tests. No removal is proposed without checking consumers.

### 4. release.candidatePractice: live default-path gap, not a dead export

`lib/release.mjs:218`, **[12032,12729)**, has a live caller at `lib/cli.mjs:482` in `fleet update --rehearse` when `KEEL_FLEET_PRACTICE` is unset. It checks keel-self identity, reads the recorded practice version, tests whether practice content changed, and derives the next candidate version. `tests/fleet.test.mjs:716` covers rehearsal, but the CLI test at line 760 explicitly injects `KEEL_FLEET_PRACTICE`, bypassing this production branch; direct `rehearse()` calls pass `cli` explicitly. No direct candidatePractice test was found in the test-source search.

Classification: **true default version-selection entry gap**. Do not delete it as unused. A bounded synthetic repository check can exercise unchanged/changed practice, next version and non-self rejection without remote calls. Related release helper coverage does not establish this orchestration branch's contract.

### 5. Board default dispatch and launch wrappers: boundary gaps with tested core

`lib/board.mjs:1333` default `runVerb` ([97206,97432)) is zero. Server tests, e.g. `tests/board.test.mjs:453`, inject `deps.run`, asserting allowed actions and argv without invoking the default `main()` adapter. `openBrowser` (1393, [101557,101891)) and `boardServe` (1399, [101961,102343)) are also zero, while the underlying `serve()` has direct HTTP tests.

Classification: **default dispatch/CLI-launch integration gaps**, not an untested server. The action boundary that calls real CLI dispatch merits a focused check if it changes. OS browser launching is a lower-priority platform side effect; no need to open the user's browser to improve coverage. Existing auth/CSP/action assertions remain substantive.

## What is and is not concluded

The audit identifies concrete next-test candidates: default space/group-list adapter construction, rehearsal candidate-version selection, and board's default action bridge; cancellation's listener-preserving path has already received a focused regression. Default cancellation re-signal remains open. The parent chooses implementation and priorities.

The eleven absent paths are explainable by copy/import layout rather than evidence that eleven modules lack tests. That does not prove every function inside those families is exercised: hundreds of remaining anonymous callbacks and conditional paths have not been individually classified in this bounded review. Similarly, `renderLocal` in `lib/distill.mjs` has a caller in `scripts/keel/generated.mjs:31–32`, and `localConfig` in `lib/review.mjs` is called for explicit-reviewer configuration; zero entry alone cannot label either dead.

No assertion coverage, complete branch coverage, 100% coverage, or zero-risk conclusion is supported. The full corpus contains early-aborted scenarios, supplementary copied-code evidence stays outside strict totals, and the cancellation supplement remains a separate focused run.

## Follow-up: confirmed adapter gaps addressed

The parent and builder subsequently extended existing release and executable
transport cases. `candidatePractice` now has explicit unchanged-practice,
next-patch, non-self refusal and no-write preview assertions. The default `space`
and `groups` wrappers run against the existing real fake executable, asserting
exact selected IDs and per-call homes. The parent independently ran these three
cases under native coverage: all passed (1.736 seconds), and each previously
zero-entry function was observed. See the separate
[boundary supplement](../evidence/2026-10-11-test-audit/boundary-supplement.json).
The frozen full-corpus table above is not silently rewritten by this supplement.
Board default dispatch, OS browser launch and default signal re-raising retain
the limitations described above; these additions do not claim live-service or
OS-interface validation.
