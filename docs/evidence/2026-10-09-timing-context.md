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

The implementation can be used now; the phase remains partial with a walk owed. GitHub Linux pressure capture must be inspected on the pushed revision. The owner reads two weeks of new context-aware records, no earlier than 2026-10-23, and judges whether timing matches their experience. Old retained observations cannot manufacture that history. Unsupported transcript syntax remains explicit coverage loss; no cost or causal productivity claim is inferred.
