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
