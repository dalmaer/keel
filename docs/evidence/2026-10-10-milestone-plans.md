# Evidence: 63 — read-only milestone plans

- Date: 2026-10-10
- Phase: [63](../phases/63-plans-can-stay-as-milestones.md)
- Revision: `8ca1c2d6ff5d1392e8f4478a16696c864f462b5f` plus phase 63 working tree.
- Claim: GitHub milestone plans can be projected without rewriting local plans or treating closure as acceptance.

## Automated checks

Conductor verification after rendering exited 0: 130 tests passed, 0 failed, with no flaky or slower-test report:

```sh
node --import ./tests/helpers/hermetic.mjs --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=./scripts/keel/test-ledger.mjs --test-reporter-destination=stdout tests/milestones.test.mjs tests/roadmap.test.mjs tests/board.test.mjs tests/adopt.test.mjs tests/quota.test.mjs tests/cli.test.mjs tests/practices.test.mjs
```

The adapter cases prove deadlines, source closure, complete empty versus truncated/error responses, owner-label mapping, cache isolation, quota floor and charged failures (including a nonzero subprocess). Board checks exercise escaped remote markup and refused mutation; adoption preserves local plans; the standalone test imports only copied night scripts. Mapping tests live in `tests/milestones.test.mjs` because the roadmap test is managed.

The builder separately ran 135 consumer tests and the final 8 adapter regressions. An earlier builder run exposed pending rendered targets and a managed-test edit; those were corrected before conductor proof. `git diff --check` exited 0. The final gate is `npm run check` (tests, roadmap, render, inbox and stall checks); selected production contracts use `npm run typecheck`. Gate result belongs in the commit body.

## Real surfaces

A direct authenticated GraphQL read on 2026-10-10 returned complete empty milestone connections for Keel, Ledger, isocan and duo, with no pagination remaining. Each bounded query reported cost 1. This proves API access and the absence of a current milestone pilot in those repositories, not a populated plan or an owner's acceptance. No GitHub write was performed.

`node /tmp/keel-phases-50-66/63-live-adapter.mjs` exited 0. The production adapter read `dalmaer/keel` through a fresh isolated cache: complete empty result, one query, cost 26. Its second read returned the same result from cache, zero queries and zero cost. Nested connections are priced even when the repository has no milestones; the earlier discovery query's cost 1 is not the adapter's price. `node /tmp/keel-phases-50-66/63-installed-live.mjs` exited 0 after copying only the shipped night scripts to a fresh directory. `phases_without_issue` read the complete-empty cached source and returned 0 with source coverage; `phases_stuck` was unavailable because milestone `updatedAt` is not status age; local roadmap and acceptance-proof measures were unavailable. No full Keel checkout existed in that directory. This proves installed runtime wiring, not a populated project's release.

## Startup observation

On 2026-10-10, `node scripts/profile.mjs --output /tmp/keel-phases-50-66/63-version-profile.json -- --version` exited 0: CLI imports 5.31 ms, elapsed 65.18 ms, no network calls. This is one diagnostic observation, not a claimed speedup. The adapter is loaded only for commands that need it; the goals mutation guard is lazy too.

## Gaps and decision

A real project's release still needs to be displayed and read by its owner. The established repos above cannot supply that walk because they have no milestones. Synthetic fixtures must not be called a real adoption. Owner time: 10 minutes after a milestone project is selected; no acceptance, production verification or lived-in claim follows from this PR's merge.

## Review and limitations

Independent review found charged-error accounting and owner-label cache collisions; both were corrected before integration and have regression cases. The canvas deliberately reports milestone phase coverage as unsupported. No real release adoption, owner read, production acceptance or lived-in use is claimed.

## Cross-review correction

Review of PR #103 found that selecting the oldest 50 mixed-state milestones could permanently hide an active plan behind closed history. The reader now reserves separate bounded connections: 50 open milestones and 20 recently updated closed milestones, in one query. Each connection discloses truncation. The earlier live query's cost 26 describes the initial query, not this revised query. The conductor ran `keel prove tests/milestones.test.mjs --fix practices/night/files/scripts/keel/milestones.mjs --trailer`: exit 0, VERIFIED (red without the fix, green with it). The complete adapter suite covers a history larger than its bound while the earliest open milestone remains next, including independent open/history truncation. Focused milestone adoption/board checks also exited 0.

The corrected production query was read live on 2026-10-10 via `63-live-adapter.mjs`: exit 0, one query cost 36, complete empty source. The second read was cached with zero queries/cost. This replaces the initial query's pricing observation; it still does not establish a real milestone adoption.

## Source-switch and adoption review

A later review identified four integration gaps: source-disabled targets lost their drift hashes; adoption enabled the file-based conductor through a local dependency; plain-text phase listing omitted individual records; and phase-conversion migrations could rewrite archived local plans. Corrections preserve dormant hashes, leave the incompatible conductor off during milestone adoption, print milestone rows and skip those conversions for this source. Historical plans and existing human instructions are preserved. The conductor ran the seven focused files `tests/milestone-integration.test.mjs`, `tests/milestones.test.mjs`, `tests/adopt.test.mjs`, `tests/contracts.test.mjs`, `tests/migrations-test-ledger.test.mjs`, `tests/migrations-lived-in.test.mjs` and `tests/practices.test.mjs` with the hermetic preload and test-ledger reporter: exit 0, 79 passed, no hygiene findings. `keel prove tests/milestone-integration.test.mjs --fix lib/practices.mjs lib/adopt.mjs lib/cli.mjs migrations/0001-milestone-to-goal.mjs migrations/0003-phases-gain-goals.mjs migrations/0005-test-ledger-reach.mjs migrations/0006-lived-in-kept.mjs --trailer` exited 0, VERIFIED.

The tests perform source-switch and re-adoption round trips, preserve project-authored instructions, verify the new source-aware guide seed, apply the actual migration pipeline, and invoke the text CLI. Disabled phase-test wiring and lived-in migration are skipped while night/CI migration work continues. Existing guides are not rewritten.

## Source precedence

The next review reproduced `source: milestones` combined with a retained `shape: projects`: CLI reads selected the archived local shape first. A small correction built by the conductor makes the source win for `next`/`status` and suppresses archived-shape phase lints in doctor, while local mutations remain refused. The seven integration tests exited 0 with no hygiene findings. `keel prove tests/milestone-integration.test.mjs --name "milestone source wins" --fix lib/cli.mjs lib/doctor.mjs --trailer` exited 0, VERIFIED: the actual CLI returned the wrong source without the fix and the milestone record with it. The test also confirms archived bytes remain unchanged and local-shape linting returns when that source is selected again.

## Diagnostic, refresh and inactive-plan surfaces

Further review identified unexpected discovery from ordinary doctor surveys, missing freshness/quota propagation in loose-ends, missing next-work text in status, inactive roadmap checks failing the standard gate, archived goals leaking into canvas snapshots, and blank milestone exit criteria being reported without a gap. These are corrected at their existing consumer boundaries; no additional tracking system is introduced. The conductor ran the nine focused files (milestone read-context, surfaces, integration, adapter, canvas snapshot, helpers, roadmap and generated checks): exit 0, 81 tests passed, no hygiene findings. Three `keel prove` runs for read-context, inactive-plan surfaces and canvas suppression exited 0, VERIFIED. The production adapter with cache schema v4 again returned a complete empty source: one fresh query cost 36, then zero queries/cost from cache. The final gate is `npm run check` plus `npm run typecheck`; its result belongs in the commit. No owner walk is inferred.

## Ownership, configuration and refresh correction — 2026-10-11

The next review found that unobserved labels could wrongly assign work to an agent, invalid local settings could consume quota or fall through to archived files, and a fresh board read queried its root plan twice. Unknown ownership now remains unavailable, configuration is validated at consumer boundaries before I/O, and loose-ends skips the root plan already read by the board while fleet refresh remains fresh. The standalone roadmap's validator is checked byte-for-byte against the shared CLI/night validator. The cache schema is v5 so earlier ownership projections cannot survive the fix.

Conductor verification: eight focused test files (milestone review, integration, read-context, surfaces, adapter, roadmap, practices and helpers), exit 0, 80 tests and no hygiene findings. `keel prove tests/milestone-review.test.mjs --name "unknown ownership|invalid owner labels|actual CLI|board fresh|ownership projection"` with the changed production files and base `df58dd7` exited 0, VERIFIED. The tests invoke real CLI and installed reader boundaries, and check query count/cost on fresh and cached board reads. The v5 production adapter and standalone installed-night scripts both exited 0 against the real empty source: one fresh query cost 36, then a cache hit cost 0. No populated release or owner acceptance is inferred. Final gate: `npm run check` and `npm run typecheck`, results in the commit.
