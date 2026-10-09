---
status: planned
since: 2026-10-09
goal: G2
spec: 2
depends: [45, 46]
note: "A project that ships to main never opens the PRs keel's cross-review reads, so its agent-written code gets no second provider. The other provider reviews each push to main as one batch, findings answered as usual and filed as keel:agent issues or fixed by a follow-up commit; nothing waits. Design: research/2026-10-09-adopting-projects-that-ship-to-main.md."
evidence: []
issue: 47
---

# Review after the push, for projects that ship to main

## Done when

On a project with `"crossReview": { "after": "push" }`, every push to main is reviewed by a provider other than its author, as one batch; each finding is posted where the owner reads it, answered fixed, tracked or not valid like any other, and a tracked one is a `keel:agent` issue; nothing about the push waits on it; and a month of one real project's pushes has been reviewed.

## Scope

The design is [Adopting projects that already have a practice](../research/2026-10-09-adopting-projects-that-ship-to-main.md), change 3.

- **The trigger**: `keel-cross-review.yml` gains `push: [main]`, on only when `.keel/keel.json` says `"crossReview": { "after": "push" }`. A push of many commits is one review of their combined diff. The workflow's concurrency group coalesces pushes that arrive while one is being reviewed.
- **The author**: from the commits' trailers and authors (phase 45's `authorOf`), so Claude's pushes are reviewed by Codex and the reverse; a push from a person is reviewed by the first listed provider.
- **Where findings go**: a commit comment on the push's head, with each finding inline where the diff allows, and a single tracking issue per push (`keel review after <sha>`) listing them. `keel review <repo>@<sha>` reads and closes them as it does a PR's.
- **Tracked becomes work**: a finding answered tracked files a `keel:agent` issue (phase 54) in the rubric's shape.
- **The sandbox**: the same two jobs as cross-review (a read-only review job; a publish job that runs nothing from the pushed code).
- **Spend**: per push, within the owner's budget; a day's pushes past the budget are reviewed together the next day.

## Acceptance

- [ ] A push to main on a project with `after: push` runs one review of the push's combined diff; a project without it runs none. `tests/workflows.test.mjs`, `tests/cross-review.test.mjs`
- [ ] The reviewer is a provider other than the commits' author, by phase 45's rules. `tests/agents.test.mjs`
- [ ] Findings are posted on the head commit and listed in one issue per push; `keel review <repo>@<sha>` reads them with receipts and closes them by ID. `tests/review.test.mjs`
- [ ] The review job is read-only and the publish job runs nothing from the pushed code. `tests/workflows.test.mjs`
- [ ] Past the budget, pushes wait and are reviewed together. `tests/cross-review.test.mjs`
- [ ] ⚑ by hand: a month of one project's pushes reviewed; the owner compares real findings with noise.

## Your part

- **Ask:** Turn on review after the push for one project that ships to main, and after a month say whether the findings were worth reading.
- **Why:** It decides whether a second provider adds value without slowing a project that never waits for review.
- **Look at:** The month's review issues and how each finding was answered.
- **Choices:** Keep it | Keep it, fewer pushes reviewed | Turn it off
- **Takes:** 15 minutes at the end of the month.
- **Then:** Keep it: the phase is built. Fewer pushes: a minimum diff size or a daily batch is set. Turn it off: the reasons go into the evidence.
- **Ready when:** this is built and a project that ships to main has a second provider's secret set.

## Real surfaces

- Workflow shell: `keel-cross-review.yml` on a push to main.
- GitHub API: commit comments, the per-push issue.
- Adopted project: one that ships to main.

## Proof

Automated: `node --test tests/cross-review.test.mjs tests/workflows.test.mjs tests/agents.test.mjs tests/review.test.mjs`; `npm run check`.
Over time: a month of pushes.
⚑ Model spend per push, within the owner's budget.

## Deliberately open

- **Commit comments versus an issue**: commit comments are easy to miss. The per-push issue is the record; whether the comments stay is settled by the month.

## Next action

Brief a builder on the push trigger and `keel review <repo>@<sha>`.
