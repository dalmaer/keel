# Plates rename: migration and release evidence

Phase: [109](../phases/109-the-project-and-its-collection-become-plates.md).

## Scope and baseline

The owner authorized the complete Keel to Plates rename, including repository names, managed collection configuration and deployment. Work began from `47f3043948260d764b83bc5ff83d8bef6f5e308f` in an isolated clone. The original source checkout's untracked research and runtime reports were preserved.

Verified managed collection: `dalmaer/keel` (source), `dalmaer/duo`, `dalmaer/cajones`, `dalmaer/ledger`, and `dglazkov/isocan`. Connected private repositories are `dalmaer/keel-data` and `dalmaer/keel-inbox`. Repository numeric identities and permissions were inventoried before mutation. Consumer application names and local practices remain their own.

Concurrent changes are release dependencies: source PR214 must be incorporated, and Ledger PR154 must complete deployment before its configuration rollout. A merge alone does not satisfy either production check.

## Observed local proof

- Migration previews succeeded for all four consumers, with no preexisting managed-file drift. Exact baselines checked 39 lock entries for Duo, 47 for Cajones, 68 for Ledger, and 41 for isocan.
- Applied migration only to isolated Duo, Cajones and isocan clones. Their second previews reported already migrated; whitespace checks passed. Runtime files retained their original bytes. Ledger remains deferred.
- Duo migration baseline: `npm run check`, exit 0, 25 tests plus TypeScript, roadmap and Vite build.
- Cajones migration baseline: `npm run check:all`, exit 0, 99 tests plus syntax, roadmap and PWA integrity checks.
- isocan migration baseline: build and workspace typechecks exited 0. Its deep test command was denied before execution by automatic approval review, which classified the request under the superseded specification-only scope. No retry or equivalent bypass was performed. Deep verification remains pending renewed authorization.
- Production/test-history compatibility tests: 75 of 75 passed. Tests cover both workflow generations, legacy artifact names, exact attempt/config provenance, missing newest evidence, and repository-name continuity verified against GitHub numeric identity. Old-name reuse by another repository is rejected.
- Migration tests reached 15 of 15 passing, including durable remote plan paths, queue prefixes and operation namespaces. Night-plan tests passed 21 of 21; goodnight tests passed 10 of 10. The whole-night end-to-end test passed through plan, ticks, morning card, finalization and send.
- Canvas/production compatibility tests passed 46 of 46; targeted remediation rename tests passed 2 of 2 without a duplicate POST or rewriting prior references. Temporary-clone release rehearsal tests passed for both canonical and legacy consumers; ordinary update still refuses an unmigrated checkout without changing it.
- `npm run typecheck` exited 0 on the rename tree before integrating the separately merged web-decisions release. Render, roadmap and whitespace checks passed on that tree. These are not claims about the final merged tree.

These consumer checks cover the migration baseline. Final canonical practice rendering and checks remain necessary after all compatibility fixes are integrated.

## Continuity findings

Workflow filenames are active names and are renamed. Historical workflow IDs and artifact names remain recovery inputs. Budget calculations include both generations; unavailable history cannot reset an allowance.

Remote `keel-night-plan` and its `.keel/night/plan.json` blob remain one durable state identity. Local configuration and runtime paths become `.plates/`. SQL/RPC/session namespaces, Canvas ownership properties, queue markers, branch prefixes, labels and concurrency groups remain compatible. The source lesson fingerprint retains its former repository name through explicit `lessonProject` configuration. Historical evidence and receipts are not rewritten to claim they were produced by Plates.

Existing source robot issue60 proves that old repository-name markers cannot be treated as absent. Recovery must verify previous/current repository names against the same numeric identity or refuse without duplicating work.

## Remaining proof

The full source gate is `npm run check`; static verification is `npm run typecheck`. They must run against the final integrated source and record. Final consumer gates, reviewed PR/release results, renamed GitHub identity read-backs, local runtime migration, hosting metadata changes, exact production revision and live sign-in/Home verification are not yet complete.

GitHub App settings require fresh account verification. Mobile requests were sent through GitHub's official flow, but no successful verification has been observed. No App settings mutation is claimed.

The remaining robot comparison/state-recovery edit-and-test command was also denied before execution by automatic approval review, citing the superseded specification-only restriction. It was not retried. Six new robot rename regressions pass; the wider suite still requires fixture corrections and an environment that permits its localhost test servers. This is a release blocker, not a waived check.

At this record's creation, no product repository rename, release, deployment or consumer merge has occurred. Subsequent evidence must identify exact commits and observed outcomes before phase acceptance changes.
