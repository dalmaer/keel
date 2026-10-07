---
status: planned
since: 2026-10-06
goal: G2
spec: 2
depends: [6, 10, 39]
note: "After the v0.8.0 update PRs merged on green CI with 13 unread Codex comments (10 valid findings, one P1): keel review reads every thread, merges wait for the named reviewer, every keel merge path refuses while a thread is open, and each thread closes as fixed, tracked or not valid with a reply. Design: research/2026-10-06-review-gate.md."
evidence: []
issue: 23
---

# No PR keel merges has an unread review: every comment is answered and closed first

## Done when

`keel review` reads a PR's review threads and reviews deterministically; keel's merge paths (fleet update, drain, the conductor's merge step) wait for each named reviewer and refuse to merge while a thread is open; every thread is closed with a reply that says fixed (naming the commit), tracked (naming where) or not valid (saying why); and the next fleet release merges with every reviewer comment answered.

## Scope

The design is [The review gate](../research/2026-10-06-review-gate.md).

- **`keel review <repo>#<n> [--wait] [--json]`**: threads (GraphQL `reviewThreads`, `isResolved`), reviews and reviewer conversation comments; exit 0 all resolved, 1 any open, 2 unreadable (never clean). Reviewers named in `.keel/keel.json` `"review"`.
- **Waiting**: `--wait` until each named reviewer has reviewed the head commit or `wait` minutes pass; a timeout is said, never read as no comments.
- **Merge paths**: `keel fleet update` (when it merges), `scripts/keel/drain.mjs`, and the conduct skill's merge step run it and refuse while a thread is open, naming each.
- **Closing**: `keel review --close <thread> --fixed <commit> | --tracked <issue|version> | --not-valid "<why>"` posts the reply; fixed and not-valid resolve; tracked stays open until its fix is recorded, and is the only open thread a merge may pass, because its reply says where.
- **GitHub's own gate**: doctor notes a fleet repo with a named reviewer whose branch protection lacks "Require conversation resolution" (⚑ the owner turns it on).
- **Seen nightly**: `review_threads_open` on the night (open threads on open PRs older than a day); loose-ends lists them.
- **The rule written down**: the conduct skill and AGENTS block: read every review before merging; close each thread with one of the three replies.

## Acceptance

- [ ] `keel review` on a stubbed PR with one open and one resolved thread exits 1 and names the open one; all resolved exits 0; GitHub unreadable exits 2, never 0; mutation: an unreadable read returning 0 fails the test. `tests/review.test.mjs`
- [ ] `--wait` returns when the named reviewer's review on the head commit appears, and on timeout says so with exit 1, not 0. `tests/review.test.mjs`
- [ ] Fleet update and drain refuse to merge a PR with an open untracked thread, naming it; a tracked thread whose reply names where passes; mutation: drain ignoring threads fails. `tests/review.test.mjs`, `tests/night.test.mjs`
- [ ] `--close` posts the reply and resolves for fixed and not-valid, posts and leaves open for tracked, and refuses a not-valid with no reason. `tests/review.test.mjs`
- [ ] The conduct skill's merge step names `keel review --wait` and the three closing forms. `tests/skill.test.mjs`
- [ ] ⚑ by hand: the next fleet release's update PRs merged only after every reviewer comment was answered and closed; the owner reads one PR's threads.

## Real surfaces

- GitHub API: review threads read and resolved, replies posted, on real PRs in the fleet.
- Adopted project: the next fleet release's update PRs in ledger, duo and cajones, where Codex reviews.
- Fleet over time: the night's `review_threads_open` on every project.

## Proof

- Automated: `node --test tests/review.test.mjs tests/night.test.mjs tests/skill.test.mjs`, with the mutations above; `npm run check`.
- By hand: the next fleet release, its threads closed in the three forms, read by the owner.
- ⚑ "Require conversation resolution before merging" turned on per repo by the owner (a setting).

## Deliberately open

- **Which reviewers to wait for, per repo.** Codex today on ledger, duo and cajones; isocan and keel have none named. A repo with none waits for nothing and reads what exists.
- **Whether a tracked thread should ever block a later merge** (the fix never landing). The night's `review_threads_open` shows it ageing; settled after a few releases.

## Next action

Write `keel review` (the read and its exit codes) against a stubbed gh GraphQL answer, with the unreadable-is-never-clean test first.

## Trajectory

- **2026-10-06** — Escape (the reason for this phase): keel's v0.8.0 update PRs were merged on green CI with 13 unread Codex comments, every one valid, one a P1. Fixed in v0.8.1 (4175825), each thread answered and resolved; the v0.8.1 PRs' reviews were read before merging and found four more (v0.8.2).
