# Evidence: 110/111 — reviewed source guardrails merged

- Date: 23 October 2026
- Phases: 110, 111
- Exact phase-111 review head: `35f392620e8e06f0038e1e88370be9b0958b3f19`
- Final main: `513f8f4025f034060fcbb2f5d7ea2b5f57af0cd6`
- Claim: recorded exact-head checks and independent review support the source implementation; consumer adoption, reuse policy and performance gains remain separate.

## Automated checks

Phase 111's UTC focused preflight passed 153/153 tests and roadmap/render/inbox/whitespace, with typecheck exit 0. Its final local configured gate passed 2,846/2,846 ordinary tests and eight stall files: 343.48 seconds wall, 1,868.95 user CPU seconds and 924.81 system CPU seconds. This local run was on a frozen working tree; it is distinct from clean commit CI.

[Exact-head CI](https://github.com/dalmaer/plates/actions/runs/39878946287) passed on 35f3926. After retargeting to merged phase 110, the 20-file, 174,110-byte diff remained byte-identical. [Fresh independent Claude review](https://github.com/dalmaer/plates/actions/runs/39881499517) returned zero findings; normal review gate exit 0. Its latest pass read production files fully, skimmed docs and did not open three test files; prior independent test review and the parent's exact-head review covered these limits. Parent approval explicitly covered planner, capability probes, admission/history, regression tests and UTC correction.

[PR 225](https://github.com/dalmaer/plates/pull/225) merged at 00:58:17 UTC to ad15621. Its subsequent [main gate](https://github.com/dalmaer/plates/actions/runs/39881271277) failed the known UTC calendar fixture in ordinary and stalled runs. The premerge focused replay should have caught this; that omission and the 428.614-second failed gate remain evidence. The correction was already in reviewed PR 226, not a new unreviewed change.

[PR 226](https://github.com/dalmaer/plates/pull/226) merged at 01:07:30 UTC. The actual merge tree `4ae05147e0cac57f5b70d0b96e729e30ccbd494d` equals its reviewed head tree. [Final main check](https://github.com/dalmaer/plates/actions/runs/39882198221) passed: 2,846 total ordinary tests, 2,842 passed, four existing platform skips, zero failed; all eight stall files passed and 84 complete clean exact-head attestations were verified. The outer configured gate took 446.362 seconds wall; CPU unknown. Nested ordinary timing is not additive. [Typecheck](https://github.com/dalmaer/plates/actions/runs/39882198148) passed; main reconciliation succeeded.

Final check artifact 12471635720 SHA-256: `b8ebba58d53aaffe65be7ea6c14d1e71cbf05f5003483f2639df1c5755972093`. Fresh review artifact 12470777524 SHA-256: `739d06517922aad059bff10c9057fe579cb037a733b4acdc10153abce83d4154`. Both downloaded byte digests were checked. Historical phase-110/111 evidence manifests retained all 25/387 original matching hashes.

## By hand and limits

The parent independently approved 35f3926 with no blocking findings and authorized ordered merges. Actual main tree/parents and the unchanged reviewed diff were checked. Canonical unpublished email commit c33084dd remains separate and was excluded. No new schedule, consumer deployment, credentials/security change or blocked automation change occurred.

GitHub returned no automatic deployment records. Independent serving-revision verification was unavailable without existing provider authentication; a read-only CLI's unexpected login wait was cancelled without completing authentication. No production verification is claimed.

## Gaps and decision

Phases 110/111 are built at their source-only boundary. These checks do not establish lived-in behavior, measured pipeline savings, consumer equivalence or permission to weaken gates. Five paired fixed-head workloads remain necessary before any default-concurrency proposal; no such benchmark is claimed here. Consumer stage graphs and real evidence producers remain phases 112–114. Preserve failed attempts rather than replacing them with the final success.
