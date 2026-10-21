# Plates rename: migration and release evidence

Phase: [109](../phases/109-the-project-and-its-collection-become-plates.md).

## Scope and baseline

The owner authorized the complete Keel to Plates rename, including repository names, managed collection configuration and deployment. Work began from `47f3043948260d764b83bc5ff83d8bef6f5e308f` in an isolated clone. The original source checkout's untracked research and runtime reports were preserved.

Verified managed collection: `dalmaer/keel` (source), `dalmaer/duo`, `dalmaer/cajones`, `dalmaer/ledger`, and `dglazkov/isocan`. Connected private repositories are `dalmaer/keel-data` and `dalmaer/keel-inbox`. Repository numeric identities and permissions were inventoried before mutation. Consumer application names and local practices remain their own.

Concurrent changes are release dependencies: source PR214 must be incorporated, and Ledger PR154 must complete deployment before its configuration rollout. A merge alone does not satisfy either production check.

## Observed local proof

- Migration previews succeeded for all four consumers, with no preexisting managed-file drift. Exact baselines checked 39 lock entries for Duo, 47 for Cajones, 68 for Ledger, and 41 for isocan.
- Applied migration to isolated Duo, Cajones and isocan clones. After Ledger PR154's production deployment was confirmed, migrated its isolated checkout at `93277e76e4892e24645f105f5cd57a7f6ad95714`: 102 file operations, 19 preserved runtime files, and no overlap with the feedback release's seven changed files. Second previews reported already migrated; whitespace checks passed. Original owner checkouts remain untouched.
- Duo migration baseline: `npm run check`, exit 0, 25 tests plus TypeScript, roadmap and Vite build.
- Cajones migration baseline: `npm run check:all`, exit 0, 99 tests plus syntax, roadmap and PWA integrity checks.
- isocan migration baseline: build and workspace typechecks exited 0. Its deep test command was initially denied before execution by automatic approval review, which classified the request under the superseded specification-only scope. After the parent explicitly refreshed the implementation authorization, one permitted retry was accepted. The baseline deep run exited 1: 9,270 tests passed, 7 failed and 115 were skipped. Failures identified a partial variable rename, unstaged path inventory and missing shallow history. The transformer now has an executable regression; full Git history was fetched. Final rendering and a staged final gate remain necessary. Cloud-store emulator coverage was skipped by this command and remains a separate CI requirement.
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

GitHub account verification succeeded through the official email flow. The existing App was renamed to Plates Workspace dalmaer; GitHub confirmed the save and retained App ID 5413891. Its homepage and callback still point to the existing working origin until the new hosting origin is verified. No authentication settings or permission scopes changed.

The remaining robot comparison/state-recovery edit-and-test command was initially denied before execution by automatic approval review, citing the superseded specification-only restriction. The parent explicitly refreshed the implementation authorization; the single permitted retry applied the reviewed patch and passed all 10 focused tests, including localhost Git tests and recovery without a second POST. Canonical/rendered robot modules match. The source full gate is still required.

At this record's creation, no product repository rename, release, deployment or consumer merge has occurred. Subsequent evidence must identify exact commits and observed outcomes before phase acceptance changes.

## Integrated check and command naming

The first full source check exited 1: 2,040 tests, 1,993 passing and 47 failing. Its stall checks passed and hygiene found no flaky or slower test. The failures exposed renamed expectations for durable queues and RPC fixtures, two filename-order assertions, old-metadata path protections, and fixture read counts. Focused corrections preserve those production identities. Web tests passed 27/27; compatibility suites passed their relevant tests, including five localhost tests rerun with approved local-server access. The final integrated gate must pass before release.

The owner additionally requested `/conduct` become `/spin`. The canonical skill and Claude doorway now use spin, with a thin conduct forwarding wrapper. Technical practice/block IDs and historical upstream source pins remain conduct. Canonical skill behavior was compared with the previous version: only name, heading and slash-invocation text changed. Ejected/local conductors retain ownership; isocan's locally owned conductor is adapted separately. Focused skill, initialization and ownership checks passed.

The next integrated run passed all 2,044 tests (zero failures or skips), all stall checks, roadmap and managed-render guards; its final inbox guard found a stale generated patterns page. Regenerating only `renderPatterns` from the local accepted records restored the original historical provenance text, and `plates learn render --check` then passed. The private-inbox count refresh was unavailable before the repository rename; no remote count or issue mutation is claimed. A final full gate follows this generated-record correction. Typechecking passed on the integrated code.

The final-ready retry was interrupted before a result: its terminal session disappeared and the recorded gate process was confirmed absent. It is not counted as a pass. A separate phase 92 feedback integration is running against the existing main; the rename will incorporate its landed result before the final gate and deployment. The prepared source is retained as a local checkpoint, with no release or production acceptance claimed.

## Concurrent feedback integration

The phase 92 integration landed at `ceb56e4f7234ea3e795e36a23172e87ada2f1065`; its own full gate passed 2,034 tests and the record/render guards. The rename preserves that implementation, resolves shared CLI/documentation conflicts, and uses canonical Plates configuration and private feedback paths. The combined focused feedback/CLI checks passed 43 of 43; the combined full gate follows.

A metadata-only inventory found neither `.keel/feedback` nor `.plates/feedback` in the original source, Duo, Cajones, Ledger or isocan checkout. No feedback record was read or rewritten. Feedback event hashes and repository identity checks remain unchanged; a journal attributed to another repository identity fails closed rather than being silently rewritten. Migration must retain local Git-ignore protection before moving private runtime bytes.

The ignored-runtime migration correction passed all 21 focused migration tests. They verify byte preservation for binary feedback records and store-local `.npmignore`, effective old/new exclusions before publication, no ordinary Git staging exposure, interruption recovery without duplicate exclusions, and refusal of unsafe or changed exclude files. Public previews contain metadata and hashes, not private contents.

PR-impact preflight additionally exposed a record-rename gap: the checker demanded deleted historical phase filenames even when Git identified their new paths. The correction must use the actual Git diff as rename evidence, preserve old decision-fence obligations, and retain strict handling of deletions without a verified destination. Its focused and actual-PR checks precede the final gate.

The record-rename correction passed all 32 focused reconciliation tests. Git-verified moves within the same record class accept the new path declaration; missing declarations, unsupported moves, unrelated deletions and deleted decision anchors still fail. Original decision fences are checked from the merge base. The final combined commands are `npm run check` and `npm run typecheck`; their actual result belongs to the subsequent checkpoint and remote CI.

## Combined source checkpoint

On 2026-10-21, the combined source at `e9c46c00491dcf491e800d97d0c8f842fb4c3f30` passed `npm run check` and `npm run typecheck`, exit 0: 2,079 tests passed, zero failed or skipped; all configured stall checks and roadmap/render/inbox guards passed. The test ledger reported no flaky or slower test.

The actual PR-impact check then identified one short historical record whose broad branding replacement prevented Git from recognizing its rename. Phase 19 retains its original 2026-10-03 contents under the new filename, a byte-identical historical record rather than a rewritten acceptance claim. Its evidence reference remains valid. The corresponding roadmap and PR-impact guards are checked after this documentation-only correction; remote CI will validate the exact final PR head.
