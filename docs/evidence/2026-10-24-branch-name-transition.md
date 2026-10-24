# Phase 125: branch-name compatibility

Date: 2026-10-24. Base: `4731cdbfda9961a87a4ec07be736e7b28b2f23e6`. The prerequisite #218 fix is its own commit, `782f64154e06d0c49944accf5cb03e227fd0a712`, before the branch transition.

## Implemented source

Fresh writers select the exact plates branch rows; queue consumers accept both names. Existing night/final branches keep their namespace. Dated plan readers prefer the canonical plan for that date, record the skipped legacy plan, and keep the original legacy bytes; subsequent ticks write the canonical plan with a conditional Git lease. Verification readers combine both branches by observation time. Robot continuation preserves its original head and validates repository, issue and immutable delivery identity across both namespaces.

The read-only concurrency assessor requires complete repository-wide run evidence and an owner-approved disable/install barrier. It rejects active, unknown and incompletely cancelled runs. It does not itself collect current provider facts, disable workflows or confer approval. Self-rendered workflow changes therefore cannot merge until the owner approves and establishes the barrier.

The stable inventory ID `git ref:keel-claims/phase-` actually denotes private Git-directory ownership token storage. Source inspection of `lib/claim.mjs:tokenPaths` settled that classification. It stays held for phase 128; existing tokens and the remote `claims/phase-<n>` refs are unchanged.

## Observed proof

- Prerequisite #218: conductor independently ran 19 morning tests, then `plates prove` against base `4731cdbf` for both retained-section regressions. Result VERIFIED, red without the fix and green with it; generated trailer is in commit `782f6415`. Logs `/tmp/plates125-218-conductor.log` and `/tmp/plates125-218-prove.log`.
- Independent branch/concurrency proof: `PATH=/opt/homebrew/bin:$PATH TZ=UTC npm_config_cache=/tmp/plates125-npm-cache node --import ./tests/helpers/hermetic.mjs --test tests/phase125-branches.test.mjs tests/phase125-consumers.test.mjs tests/name-concurrency.test.mjs` exited 0: 22 passed, no failures or skips. Log `/tmp/plates125-conductor-proof.log`.
- Builder focused groups passed 132, 64, 141, 46 and 23 tests. These overlap and are not a total or an integrated gate. Handoff `/tmp/plates125-handoff.md` retains exact commands and earlier failures.
- [Mutation observations](2026-10-24-branch-name-mutations.json): 74 behavioral failures across 37 reader groups, independently removing each name. Conductor verified source hashes, assertion failures, original logs and retained log digests. Superseded ineffective or malformed attempts remain identified and excluded from accepted counts.
- After correcting the inventory metadata, the conductor refreshed the exact current retry table pin and reran its green baseline plus both one-name mutations in a disposable copy; both mutations failed behaviorally. Capability-source and retry suites passed 38/38 (`/tmp/plates125-source-pins-proof.log`). Those observations are appended to the mutation record; earlier executions are preserved.
- Final integrated gate, typecheck and render outcomes must be recorded before publication; these are not yet claimed here.

## Review and limitations

Capability auditing reviewed the changed queue/plan/robot/publication consumers. Nineteen existing source fingerprints change; the only CLI registry change is the goodnight summary naming its actual writer. No new CLI argument, automatic execution authority or permission classification is introduced. The trusted publisher now binds its imported canonical names helper. Historical retry-source identity remains unchanged; the current closure is separately pinned and is not owner deployment approval.

Focused testing exposed an absent-ref lease incorrectly rendered as literal null during first canonical plan creation. The corrected path uses an empty expected SHA and has a real bare-origin regression. Earlier failed fixture assumptions and copied-dependency gaps remain in the builder logs; no rerun is represented as proof that the earlier failures did not occur.

No workflow disabling, cancellation, dispatch, remote rename, production acceptance or lived-in result is claimed. The owner-controlled barrier precedes merge/install; phase 129 supplies the real dispatched-night and fleet observations.

The first integrated gate exited 1: 2,950 passed, 15 failed and four skipped (`/tmp/plates125-check.log`). Seven copied-helper tests omitted the newly imported names module; the other failures asserted old writer names or read back old output refs. Five test files were corrected without changing production code or legacy-reader fixtures. The conductor independently reran those files: 39 passed, exit 0 (`/tmp/plates125-conductor-corrections.log`). This preserves the failed run rather than treating a retry as its replacement.

Integration base: reviewed phase 127 merge `48ec9e2f` is included by local merge `7485328e`. Its cookie, operation-marker and RPC writers remain held; phase 125 branch writers and the six already-reviewed hosted environment reader rows remain dual. The fleet update keeps both its table-selected branch and held operation marker. The first focused merge check caught an assertion incorrectly expecting those six environment rows to remain held (66 passed, one failed); the exact six-row expectation was corrected, then all 67 integration checks passed. Canonical table/render/capability/current-retry pins were regenerated for the combined bytes; the retry green baseline and both one-name failures were observed in a new disposable copy with new retained logs. Historical observations are unchanged.
