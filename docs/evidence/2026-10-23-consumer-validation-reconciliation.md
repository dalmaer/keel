# Evidence: 112/113 — published consumer changes and remaining coverage

- Date: 23 October 2026
- Source baseline: `140792623f7c7db656d143a8ba5adf336c9d0edf`; source records working tree
- Claim: reconcile observed consumer implementation/merge/main results without turning merge into acceptance or profiles into equivalent gates.

## Observed published facts

[Ledger PR 162](https://github.com/dalmaer/ledger/pull/162), head `b5d077b92ed0ee8f4d4344124a1f074d6cfffb7a`, merged at 02:58:38 UTC to `ab69eccf029458dfee26c33822a085445705d629`. Its [Tests main run 39892488810](https://github.com/dalmaer/ledger/actions/runs/39892488810) completed successfully. The published workflow has separate scope, test and web jobs; test/web depend only on scope. The two lanes upload separate child artifacts. Package commands retain `check:all`; voice diagnostics and performance are required locally and absent from the hosted union. The frozen consumer [evidence](https://github.com/dalmaer/ledger/blob/ab69eccf029458dfee26c33822a085445705d629/docs/evidence/112-independent-ci.md) preserves prior attempts, changed build dirtiness, private-data caveats and unmatched observations. Its historical pending wording is not a new failed or missing run.

[isocan PR 514](https://github.com/dglazkov/isocan/pull/514), head `d40888dec6263631c349c8dad3d2e5ff0069c32b`, merged at 02:58:29 UTC to `58f0f543459ef7fc19b54434b6bebea73dd31e16`. Its [release main run 39892476821](https://github.com/dglazkov/isocan/actions/runs/39892476821) completed successfully. Published PR/release workflows share the bounded installer and preserve four strict shards. Their checks profiles differ: PR typecheck/lint versus release typecheck, grader/persona selftests and roadmap. The frozen consumer [evidence](https://github.com/dglazkov/isocan/blob/58f0f543459ef7fc19b54434b6bebea73dd31e16/docs/projects/validation-efficiency/evidence.md) retains local deep/strict hosted differences, setup failures and watchdog cleanup corrections. The retry planner is recommendation-only and does not authenticate supplied artifacts or verify actual rerun completion.

These observations came from read-only published refs, pinned source bytes and GitHub merge/workflow metadata. This source record did not execute consumer suites or independently reproduce their retained local runs. The parent approved the prior reviewed implementations and merges; that is separate from complete phase-114 evidence/equivalence adoption.

## Decision and gaps

Source phases 112/113 become partial records of observed implementations rather than stale designed plans asking for duplicate PRs. Their remaining acceptance evidence must be consolidated from retained actual results, not fabricated or recreated merely to fill documentation. Generic source `npm run check` proof is corrected to each consumer’s actual required commands. No gates, thresholds, skips or review policy change here.

The source shadow foundation itself merged as PR 228 and actual main `1407926` passed its configured gate/typecheck. Phase 114 remains partial: all required stages need observed immutable provenance, actual private-data/environment bindings where relevant, archive lineage, real producers and an existing-validator round trip. No speedup, complete equivalence, changed default or new reuse permission is claimed from these merges.
