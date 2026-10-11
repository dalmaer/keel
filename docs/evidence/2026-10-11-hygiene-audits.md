# Evidence: phase 66 — hygiene audits and proposals

- Date: 2026-10-11
- Phase: [66](../phases/66-hygiene-measures-from-real-audits.md)
- Revision: `80e44a8` and phase 66 working tree.
- Claim: bounded audits feed existing health proposals; source and policy checks precede recoverable robot issue delivery. Observations are not authority to delete worktrees, change PR state or claim acceptance.

## Conductor verification — 2026-10-11

`node --import ./tests/helpers/hermetic.mjs --test --test-reporter=spec
--test-reporter-destination=stdout --test-reporter=./scripts/keel/test-ledger.mjs
--test-reporter-destination=stdout tests/improve-measures.test.mjs
tests/worktree-hygiene.test.mjs tests/hygiene-measures.test.mjs
tests/hygiene-proposals.test.mjs tests/improve-selftest.test.mjs
tests/board.test.mjs tests/time-proposal-actions.test.mjs` exited 0: 108 passed,
zero failed; ledger reported no flaky or slower tests.

Coverage includes real synthetic Git worktrees, bounded scans/history, shared
GitHub quota/cache and malformed/truncated observations, generated/fixture
exclusions, source-derived split hints, isolated selftest evidence, source/policy
validation, CLI instance selection, preserved human notes and decisions on report
regeneration, prepared/crashed intent recovery without duplicate POST, and legacy
time/ordinary decisions. Fixtures are synthetic Acme projects.

`npm run render` exited 0, installing both new night helpers and regenerating
managed copies. The first integrated gate was interrupted (exit 130) after noticing the two
newly rendered helper files still needed intent-to-add for tracked-file checks.
They are now included. The final gate is `npm run check` (tests, hygiene, stalls,
roadmap, rendering and inbox), with `npm run typecheck` for the selected JSDoc
scope. Results belong in the commit body and exact-head CI.

## Real surfaces — 2026-10-11

The production `measure` registry was called with only `stale_worktrees`,
`drafts_waiting` and `long_files` via `/tmp/keel-phases-50-66/66-real.mjs` (exit 0).
This deliberately does not run or claim a second full night/gate. Its snapshots:

- Owner's machine: 23 registered worktrees, complete audit, two eligible for owner review. They hold 15,858,953 logical bytes; this is not guaranteed reclaimable physical space. Both qualify by local main reachability. No worktree was removed or branch changed by the audit.
- GitHub API: complete read of Keel's open PR connection at 07:35:16 UTC, zero current drafts older than 24 hours since creation. One query cost one point. A repeated production read used that cache with zero queries/points. This proves a complete empty result, not a real waiting-draft resolution.
- Local tracked source: five files over 1,500 lines, complete current-file coverage; all five histories explicitly incomplete under the bounded history window. The selected eligible proposal is `tests/workflows.test.mjs` at 2,080 lines, with heuristic section ranges and its exact Git blob. Protected canonical practice files retain manual advice.

The [selective health report](../health/2026-10-11.md) was saved through the
existing health writer, explicitly labelled as three measures only. Production
`keel board --json` exited 0 and exposed its proposed instance
`60fca6d4f7007ed0175324c097ea8cc910f8056acb22c3810f7f2015b517aa5c`
with Accept/Decline actions carrying `--instance`. Neither action was invoked.
Keel's robot remains OFF; no real issue was filed and no model spend enabled.

## Remaining acceptance

One real proposal from each category must be accepted and carried out. Individual
acceptance/decline and verified issue delivery are distinct from completion of a
fix; merge and usefulness are separate again. The owner's collective phase walk
therefore keeps “Still outstanding” open. The current audit cannot supply a
waiting-draft example because none met the threshold. The owner also needs to
approve a project and weekly robot allowance before selecting robot delivery.
No fleet-over-time or lived-in use is claimed.

## Integrated guard corrections — 2026-10-11

The first completed full run passed 1,437 of 1,439 tests. Existing guards found
test subprocess calls bypassing the shared helper and capitalized project-name
text in shipped templates. The calls now use the helper and the text is generic.
After rendering, conductor verification of `tests/helpers.test.mjs`,
`tests/practices.test.mjs`, `tests/hygiene-measures.test.mjs` and
`tests/hygiene-proposals.test.mjs` exited 0, 45 passed. The final integrated gate
runs after this record; none of these retries is presented as evidence of a flake.
