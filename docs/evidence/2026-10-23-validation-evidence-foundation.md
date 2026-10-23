# Evidence: 114 — independent shadow evidence foundation

- Date: 23 October 2026
- Phase: 114, source-only partial slice
- Revision: base `513f8f4025f034060fcbb2f5d7ea2b5f57af0cd6`, contract commit `d2140ff86502c0035fcef6eafc924effcc928d03`, and working tree
- Claim: bounded shadow validation detects incomplete or mismatched retained evidence against independently supplied requirements without authorizing gate reuse.

## Automated checks

The conductor independently ran `TZ=UTC npm run check:focused -- tests/validation-evidence.test.mjs tests/gate-reuse.test.mjs`: exit 0, **143/143 tests**, followed by passing roadmap/render/inbox/whitespace stages. Total preflight wall time was **68.238 seconds**; nested test reporter wall time **65.489 seconds** is not additional elapsed time. CPU was not measured. The required convention bundle included helper isolation, docs/guides/CLI, adoption/skills/guide consumers, web capability bindings and check-focused regression checks with concurrency two.

The new evidence tests mutate every immutable candidate/input and execution-source axis for outer and child records. They reject missing/duplicate/extra stages, altered commands/manifests, failed or incomplete children, false wrappers, parent/child invocation mismatches, stale/future/expired records, unsupported retries, malformed UTF-8/duplicate JSON keys, oversized/deep inputs, unsafe paths and corrupted artifact bytes. CLI tests exercise explicit file reading and exit 0/1/2; all results deny reuse authority. The existing gate-reuse compatibility tests passed unchanged.

The builder’s focused-plus-helper run passed 19/19 test groups. A prior added CLI duplicate-key fixture was double-escaped and failed the intended setup; the fixture was corrected to use literal JSON escapes, and the failed attempt is retained. This is a test-fixture correction, not evidence of an observed product escape or pipeline speed gain.

`npm run typecheck`: exit 0. The new library is outside the existing explicitly selected TypeScript set; this result covers existing selected contracts only. The locked install completed successfully; no package/lock/runtime or capability-binding change was needed.

The required integrated commands remain `npm run check` (ordinary tests, stall validation and generated guards) and `npm run typecheck`. No full local suite ran while Ledger/isocan held the reserved slots. The integrated gate result belongs to the eventual checked candidate's commit/evidence, not this pre-gate record. Exact-head hosted checks and normal independent PR review remain pending. A fresh independent local reviewer inspected all four implementation files, the spec and phase contract, found no blocking issues, and independently passed 15/15 evidence test groups (1.902 seconds reporter wall). This working-tree review is not exact-commit hosted review.

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| Compare current gate/default/workflow/package paths to base | No adoption or gate-policy edit | Source slice adds an independent library/CLI/test/guide; existing execution paths unchanged | No new execution/reuse authority; does not prove consumer equivalence |
| Inspect producer versus downloader lifecycle | Producer fields exist before serialization | Execution identity binds inside outer/child records; post-upload artifact ID/expiry/hash remain independent metadata | Feasible provenance boundary; metadata is still caller-supplied, not authenticated |
| Inspect manifest/candidate source | Evidence cannot define its own requirements | Expected candidate and versioned stage manifest supplied separately | Structural mismatch detection, not approval of the supplied manifest |
| Check historical merge evidence | Reconcile stale phase 110/111 records without replacing history | Separate merge evidence preserves failed UTC run, review limits and final main proof | Prior source implementation accepted; no speed or production claim |

## Gaps and decision

Phase 114 remains partial. Ledger/isocan producer schemas and required-stage mappings depend on their final phase 112/113 contracts. Real execution observations, authenticated retrieval, workflow-source revision observation, end-to-end existing-validator integration and reuse policy adoption are not implemented. Artifact checksum comparison establishes only matching bytes. The CLI requires the caller to resolve a reviewed managed repository and independently justified expectations; it does not discover the fleet or approve requirements.

Version 1 rejects retries and cross-attempt aggregation; this avoids claiming unimplemented successful-sibling eligibility. The caller supplies an explicit applicable freshness policy and evaluation instant, with no default change and no expiration bypass. No worker-limit change, full-suite benchmark, schedule/delivery change, consumer edit, deployment or new merge is authorized or performed by this slice.
