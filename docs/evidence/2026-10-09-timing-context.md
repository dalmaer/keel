# Evidence: phase 56 — timing with context

- Date: 2026-10-09 (America/Denver)
- Phase: 56, keel knows where time goes
- Revision: base `6f00a18644a8712aa0d940ae57aa7b6bc75f61e5` plus the working tree for `phase 56: keel knows where time goes`.
- Claim: recorded machine context, failure memory, a measured full-gate boundary, and scoped local timing summaries without inventing missing history.

## Automated checks

Conductor proof: `node --import ./tests/helpers/hermetic.mjs --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=./scripts/keel/test-ledger.mjs --test-reporter-destination=stdout tests/test-ledger.test.mjs tests/improve-ledger.test.mjs tests/time.test.mjs`.

The initial conductor runs passed 84 then 87 tests. A real-source walk exposed additional cases, fixed before the final integrated tree: all-unreadable transcripts misreported zero, nested fixture gates misattributed to the parent project, and command/output text misclassified as test execution or interruption. Focused regressions now exercise those boundaries. The final conductor command `node --import ./tests/helpers/hermetic.mjs --test tests/time.test.mjs` exited 0 with 15 passing tests; the real CLI command also exited 0.

The 87-test proof reported a slow hidden-variable run-alone test (379 ms vs 93 ms median); it is tracked in #69 with its isolated command. Historical findings were not erased or rerun to green. Builder removed redundant per-record generation of usual-times data after observing its overhead; it is generated before runner launch instead.

Integration also exposed an old exact-output adoption assertion and a missing command-table entry; these were corrected. The conductor corrected the owner-walk wording to satisfy the roadmap contract, and the two affected CLI checks passed (exit 0).

Final full gate command: `npm run check`, covering the whole suite, roadmap, managed rendering and inbox. Its result belongs in the commit body.

## Real surfaces

- Local `node bin/keel.mjs time --weeks 2 --json`: legacy records disclose missing load context. Five synthetic nested-project gate observations (87–140 ms) remain on disk but are excluded from Keel's root-gate trend. Before the first integrated gate, root-gate timing correctly remained unavailable. After the first gate, the real summary reported one unsuccessful root gate at 102,819 ms, with observed busy context; it did not turn that failure into a passing timing baseline.
- The local Claude JSONL is about 43 MB. The final real walk observed 29 recognized test invocations, 25 long timeouts, two background runs and zero interruptions; 25 unique invocations met at least one worked-around condition. These are observations, not a claim that any test was wasteful. The reader streams with byte/row ceilings, emits safe identities/counts only, and discloses unsupported shell forms. It never reads transcripts in CI. The real source's structured interruption flags take precedence over words in stdout.
- Node/JUnit fixtures verify start/end capture, PSI delta parsing, redaction, lane separation, last-ten-pass medians and full-gate/subset separation. Synthetic pressure is not proof of the deployed Linux reader.

## Gaps and decision

The implementation can be used now; the phase remains partial with a walk owed. The owner reads two weeks of new context-aware records, no earlier than 2026-10-23, and judges whether timing matches their experience. Old retained observations cannot manufacture that history. Unsupported transcript syntax remains explicit coverage loss; no cost or causal productivity claim is inferred.

## Pushed Linux proof

[Actions run 38022347807](https://github.com/dalmaer/keel/actions/runs/38022347807) completed successfully on `65a03041b969f8b49785732be1e47a080f3db86a`. The downloaded `keel-test-runs` artifact records a 192,696 ms gate with status 0, four cores, load 0.39 → 16.58, and `/proc/pressure/cpu` some-pressure delta 170,413,409 μs. The test-run record also has both pressure endpoints. This is actual Linux capture, not the fixture's simulated pressure. The watcher encountered a network timeout; the final API read, not that transport exit, establishes the successful workflow conclusion.

The initial phase commit's wall-time estimate was too broad: base commit 21:18 to the PR opening around 21:57 America/Denver is approximately 39 minutes. Subsequent review corrections and CI verification are additional work.

## Independent review corrections

PR #70 identified quoted Authorization values escaping redaction and Vitest discovery commands being counted as test executions. Both findings were reproduced, corrected and covered through the real collectors/parser. The five focused builder checks passed; conductor isolated-copy proofs below each exited 0 and observed red without the fix, green with it. An earlier redaction selector with the wrong capitalization matched no test and was correctly INCONCLUSIVE; it is not evidence of the fix.

- Proven-by: tests/test-ledger.test.mjs (quoted Authorization) — VERIFIED — "The input was expected to not match the regular expression /acme-fake-credential/. Input: '{'Authorization':'Bearer acme-fake-credential'}' (quoted Authoriza..."
- Proven-by: tests/time.test.mjs (Vitest discovery) — VERIFIED — "Expected values to be strictly equal: 6 !== 0 (transcripts exclude Vitest discovery commands with flags before or after the verb)"

The integrated review-fix run exposed a generator-probe race: a nested fixture's rotating ledger disappeared during a recursive copy. The isolated generated-file test passed 3/3, establishing the concurrency dependency rather than erasing the failure. [Hygiene issue #69](https://github.com/dalmaer/keel/issues/69#issuecomment-6093634654) preserves it. The probe now omits `.keel/test-runs` directories at every project depth before traversal, while retaining configuration and source inputs. Four focused generated-file tests passed.

- Proven-by: tests/keel-generated.test.mjs (generated probes exclude rotating ledgers) — VERIFIED — "Expected values to be strictly deep-equal: + actual - expected + [ + 'docs/ACME.md: its generator `node rewrites.mjs` failed (exit 1): } | | Node.js v24.21.0..."

## Further head-review corrections

Independent review follow-up: strip terminal escape sequences before redaction, so presentation cannot hide a credential; keep confirmed quiet-run flakes even when other observations are busy; keep timing storage diagnostic so unavailable telemetry cannot stop the underlying gate or replace its exit status. Transcript project/time scope, CLI argument validation and human-readable report details are covered by focused regressions. The API/JSON report and human report expose the same underlying observations without implying certainty for omitted history.

Conductor grouped proofs verified all seven newly reported regressions: every named test failed without its code fix and passed with it. The real human CLI exited 0 and printed named weekly/ usual timing, failure and coverage sections. The 20 timing tests and five focused ledger/measure checks passed before integration.

- Proven-by: tests/time.test.mjs (^review:) — VERIFIED — "Expected values to be strictly equal: 0 !== 3 (review: Vitest outside targets are omissions and local targets retain identities after flags)"
- Proven-by: tests/test-ledger.test.mjs (ANSI-colored|timed gates execute) — VERIFIED — "Expected values to be strictly equal: + actual - expected + 'acme-fake-credential' - '[redacted]' (ANSI-colored credentials are redacted before Node and JUni..."
- Proven-by: tests/improve-ledger.test.mjs (preserves confirmed quiet findings) — VERIFIED — "Expected values to be strictly equal: 'n/a' !== 'outside' (flaky_tests preserves confirmed quiet findings when a recent busy run is omitted)"

## Measurement boundaries from the additional review

Usual times now use full retained eligible history through report time, independent of the selected weekly trend. Gate medians use successful runs only, with unsuccessful counts retained and displayed. The real CLI reports three successful and two unsuccessful root gates separately. The flake window selects eligible observations before slicing, so busy records cannot crowd out quiet evidence. Equals-form Authorization is redacted, and real concurrent Node events verify failure detail is attached only through explicit parent IDs; legacy missing links remain a disclosed gap.

Vitest related and benchmark selection are outside the bounded invocation grammar and now explicitly count as coverage omissions, rather than disappearing silently. [Vitest’s CLI reference](https://vitest.dev/guide/cli#vitest-related) confirms they execute tests; source-file selectors are not reported as test identities.

The timing/board builder passed 48 focused tests, the ledger/measure builder six; conductor isolated-copy proofs below verify all seven regressions.

- Proven-by: tests/time.test.mjs (^round3:) — VERIFIED — "Expected values to be strictly equal: 0 !== 6 (round3: Vitest related and bench runs disclose omissions without naming sources as tests)"
- Proven-by: tests/board.test.mjs (^round3: board gate timing) — VERIFIED — "The input did not match the regular expression /acme-mixed: 2000 ms \(2 successful, 3 unsuccessful\)/. Input: '<!doctype html>\n' + '<html lang='en'><head><m..."
- Proven-by: tests/test-ledger.test.mjs (equals-form Authorization|concurrent Node parents) — VERIFIED — "The input was expected to not match the regular expression /acme-fake-credential/. Input: 'Authorization=Bearer acme-fake-credential' (equals-form Authorizat..."
- Proven-by: tests/improve-ledger.test.mjs (backfills its eligible window) — VERIFIED — "Expected values to be strictly equal: null !== 1 (flaky_tests backfills its eligible window and leaves all-busy history unavailable)"

The final head review found the hygiene block still sliced before busy filtering, unlike the corrected nightly measure. Both now select eligible observations first. A quiet pass/fail pair remains visible behind twenty busy runs; the conductor's focused test passed, and the isolated-copy proof is VERIFIED against `93029f2`.

- Proven-by: tests/test-ledger.test.mjs (^hygiene retains quiet flake proof behind twenty busy observations$) — VERIFIED — "The input did not match the regular expression /^keel test ledger: 1 hygiene item /. Input: 'keel test ledger: no flaky or slower test (22 runs in .keel/test..."

Configured environment values are now passed into failure redaction by both actual collectors regardless of variable-name heuristics. Values and text are normalized before longest-first replacement and truncation. The end-to-end regression checks saved Node and JUnit records, nested failures, overlapping values, ANSI and a value crossing the length boundary. Five focused checks passed; the conductor proof against `225922a` is VERIFIED.

- Proven-by: tests/test-ledger.test.mjs (^configured environment secrets are redacted end to end) — VERIFIED — "collector redacts configured, overlapping, colored and heuristic values before bounding (configured environment secrets are redacted end to end by Node and J..."

The escaped-quote head finding and conductor-discovered rule overlap are corrected by a single normalize → find protected spans in original text → merge → replace → truncate pipeline. Quoted assignments consume escaped characters and unfinished values conservatively; unquoted Authorization protects the full line without a scheme allowlist. Known configured values, private keys, URL credentials and assignment rules cannot erase each other's recognition markers. Four end-to-end/regression proofs are VERIFIED against `bd7f026`, and nine focused checks passed. The conductor also replayed both reported escaped-quote and overlapping-key examples and observed only redacted output.

- Proven-by: tests/test-ledger.test.mjs (^(quoted credential tokens|escaped quoted credentials|unquoted Authorization schemes|overlapping configured and structural)) — VERIFIED — "no credential fragment survived (quoted credential tokens consume escapes multiline and unterminated values completely)"


## Cross-platform and runner boundary corrections

Review found five additional boundary errors. Windows load averages are now unavailable, not known-quiet zeros; transcript paths normalize native separators before containment checks. Malformed or unreadable gate configuration fails before choosing a command. Adopted JUnit wrappers sample immediately before the runner, after preceding lint/build work, and preserve runner exit status even if sampling fails. Legacy imports without their own sample disclose missing start rather than inheriting the full gate start. Board lanes identify configuration, command hash and available source.

The builder passed 23 focused ledger/adoption checks, 11 timing/board checks and the updated real producer-shell test. Conductor isolated-copy proofs below each exited 0 with red without the fix and green with it (seven regressions). Windows path/load behavior was exercised with explicit platform inputs; no real Windows walk is claimed. Existing adopted package scripts remain project-owned and need their proposed wrapper update to capture a start.

- Proven-by: tests/time.test.mjs (^round4: (transcript cwd|gate summaries)) — VERIFIED — "Expected values to be strictly equal: + actual - expected + 'undefined' - 'function' (round4: transcript cwd normalizes win32 subfolders while rejecting esca..."
- Proven-by: tests/board.test.mjs (^round4: board distinguishes) — VERIFIED — "The input did not match the regular expression /linux-x64-4cpu: 2000 ms[^;]+config=acme-full command=acme-full-hash source=configured-gate/. Input: '<!doctyp..."
- Proven-by: tests/test-ledger.test.mjs (^(Windows load sampling|internal gate rejects|legacy JUnit imports)) — VERIFIED — "unsupported load must not be sampled (Windows load sampling is unavailable rather than quiet zero)"
- Proven-by: tests/adopt.test.mjs (^adopted JUnit shell samples) — VERIFIED — "Expected values to be strictly equal: + actual - expected + 'lint\nrunner\n' - 'lint\nsample\nrunner\n' ^ (adopted JUnit shell samples after lint immediately..."

The exact-head review found package-manager scripts bypassing the direct runners' external-target check. Forwarded absolute, parent-traversing and unsupported targets now produce explicit command omissions. Accepted invocations retain script identity because arguments alone cannot establish test identity. The focused shell-transcript test passed; conductor proof against `56158e9` is VERIFIED.

- Proven-by: tests/time.test.mjs (^round5: package scripts) — VERIFIED — "Expected values to be strictly equal: 0 !== 13 (round5: package scripts omit outside forwarded targets and unknown grammar while preserving local runs)"
