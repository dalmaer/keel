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

## Publication blocked by approval review

On 2026-10-21, the attempted `git push -u origin claude/phase-109` from reviewed local head `c9387f9615b5dc92ec15007dccf89b590f364fb6` was rejected before process execution by automatic approval review. The rejection cited the original spec-only no-push restriction, despite the later explicit owner authorization for implementation, repository renaming and deployment carried in the delegated conversation. No retry or alternate publication path was attempted. A read-only `git ls-remote origin refs/heads/claude/phase-109` returned no branch afterward.

The exact remaining blocker is authorization review for publishing this branch to the existing `dalmaer/keel` repository. No source PR, repository rename, release, deployment or consumer rollout is claimed. A non-mutating v0.8.33 release preview was saved outside the repository; normal review and rehearsal gates remain required.

## Publication resumed and review boundary

The parent supplied refreshed owner authorization after the denial. The single permitted retry pushed `516e1169c664d3b5a46ccb4d5a0d0a614c6795b1`; remote read-back matched. PR216 was created as a draft, attached to the task, then marked ready after local validation. The connector could not create the PR (integration permission403); the existing authenticated repository-owner CLI created it. No permissions were expanded.

PR216 full check, impact validation and typecheck passed on exact head `516e1169c664d3b5a46ccb4d5a0d0a614c6795b1`. Cross-review run39675132151 failed before a model ran: the workflow correctly checked out trusted main, which still contains `scripts/keel`, then attempted to invoke the renamed `scripts/plates/cross-review.mjs`. The compatibility correction must select the old or new helper only from that same trusted checkout, preserving the read-only reviewer, separate writer, publisher pinning and artifact boundary. It must not substitute code from the unreviewed PR.

The existing release-review gate passed for all four already-landed practice commits since v0.8.32, through reviewed PRs196,207,208,214. PR216 still needs its own successful head review before merge and release.

The trusted-checkout compatibility correction passed 81 focused cross-review/workflow tests, exit 0. The unchanged legacy script pair read from main `ceb56e4f7234ea3e795e36a23172e87ada2f1065` completed configuration, selection, brief, copied result judge and independent publisher execution in an Acme fixture; the identical regression fails against the previous workflow with its missing `scripts/plates` module. Incomplete canonical pairs and malformed configuration refuse. The pinned after-push publisher and token boundaries are unchanged. The final integrated commands are `npm run check` and `npm run typecheck`; remote head review remains required.

## Historical record audit and complete review input

The workflow correction at `d169dd7f968d41833939f635de72b41184b6742e` passed the complete local check and typecheck: 2,081 tests, zero failures/skips, all configured stall and generated-file guards. Hosted run39677135293 passed the old failure point and published review5606328012, but the reviewer explicitly reported incomplete coverage: GitHub refused the diff with HTTP406 because it exceeded 300 files, and the shallow checkout lacked merge-base history. Its green job status is not accepted as a clean review. Complete, exact-revision review input is required before merge.

A final consumer diff audit found that dated changelogs, nightly practice reports, adoption reports, Loop dispositions and project narrative/phase records needed broader historical protection. The migration now retains their original prose, commands and attribution while moving filenames and updating only working Markdown link destinations. All four prepared adoption reports and the affected dated/decision records were restored from their original revisions; mixed active indexes retain current commands with explicit historical attribution. The original owner checkouts remain untouched. The migration regression was red without the correction and its 24 focused tests passed; the next combined gate covers both this correction and the review-input fix.

The complete-diff correction passed all 84 focused cross-review/workflow tests. Three new regressions failed against the previous workflow. A real 302-file merged-branch fixture exercises HTTP406 fallback with both trusted helper layouts; malformed, missing, shallow, drifted and empty/incomplete inputs refuse. Actual PR216 at d169dd7 has 631 diff headers and 6,019,189 bytes, matching GitHub metadata and fitting the bounded acquisition. Both providers receive the same verified snapshot; token scopes and publisher boundaries remain unchanged. The concurrently merged guided-walk implementation at main `0c3c261f8dcd0b188284e70fc00280bf7c0f6f22` will be incorporated before the next combined gate.


## Fixed integration snapshot

The rename integrates only already-landed main `0c3c261f8dcd0b188284e70fc00280bf7c0f6f22`; unfinished parallel features are outside this release candidate. The guided-walk adaptation preserves SQL/RPC identities, operation markers, permission scopes and disabled-by-default writes. Canonical `.plates/plates.json` reads fall back only on confirmed absence; malformed content, access denial and missing blobs cannot trigger legacy fallback. Six merge conflicts were resolved without changing those boundaries.

Focused board/server/mutation checks passed 66/66, exit 0. Walk/decision/Home/feedback checks passed 109/111; two packaging tests failed with npm-cache EPERM and both exact tests passed with an isolated `/tmp` cache, exit 0. The original failure log is retained. Migration tests passed 25/25, exit 0; the added decision/walk RPC regression failed before its narrow allowlist correction. The combined final gate is `npm run check` followed by `npm run typecheck` on Node 24.21.0, with an isolated cache. Its result belongs to the candidate commit.

Hosted migrations 004/005 and their actual-owner write proof remain separately pending in the originating web work. This integration does not enable writes or claim production acceptance for those features. The rename's deployment walkthrough verifies existing sign-in, Home and repository access against the serving revision.


## Complete review and migration corrections

Candidate `cf58467dac283a460ece5f24a9e6850d7456951c` passed the complete local check and typecheck: 2,142 tests, zero failures/skips, all eight stall checks and generated-file guards. Hosted check39680666764, typecheck39680666787 and impact39680666712 also passed. Complete-diff cross-review39680726832 reached the reviewer and published review5606610924. Its two P2 findings were validated: nested executable/path config fields retained old locations, and renamed ejected files could lose their exact-path management exclusions. Neither finding is dismissed on the strength of the green test suite.

The correction is limited to supported local references and the actual inventory's file mapping. Repository, provider, Canvas and recovery identities remain unchanged; exclusion block suffixes remain intact. Focused before/after proof precedes the next combined gate and head review. During review, already-reviewed dependency PRs109/110 landed on main. Their Node24.22.1 and TypeScript7 updates merge cleanly and are preserved through base `10a82c9`; no unfinished feature work is added. The final combined commands use the exact current lockfile and Node24.22.1.

The corrected migration passed all 28 focused tests, exit 0. The original two review regressions failed before the fix; the absent-ejected-target regression separately failed before canonical exclusion mapping. Tests execute migrated command slots and call the renderer's real `targets()` selection, including a missing ejected file that must not be recreated. Exact block suffixes, local conductor ownership and unrelated identities remain intact. The next combined gate covers these changes plus the merged dependency updates; remote findings will be answered with the resulting commit.
