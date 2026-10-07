---
status: partial
since: 2026-10-06
goal: G2
spec: 2
depends: [6, 10, 39]
note: "Built: keel review (read, --wait, --close as fixed/tracked/not valid; --gate only for the opt-in review: wait or keel:wait-for-review), reviews_unanswered on the night, loose-ends, and the rule in the conduct skill and the climb/tend briefs. Not a gate by default. Waits on the next fleet release with every reviewer comment answered."
evidence: ["evidence/2026-10-06-answering-reviews.md"]
issue: 23
---

# Every review comment is validated and answered: none goes unread

## Done when

`keel review` reads a PR's review threads and comments deterministically; every keel agent that opens or merges a PR (the conductor, fleet update's report, climb, tend) validates each review comment against the code and answers it as fixed (naming the commit), tracked (naming where) or not valid (saying why), closing the thread when settled; the night counts comments left unanswered; and the next fleet release's reviews are all answered. Nothing blocks a merge.

## Scope

The design is [Answering reviews](../research/2026-10-06-answering-reviews.md). Not a gate: the owner asked for answers, not a merge blocker.

- **`keel review <repo>#<n> [--wait] [--json]`**: threads (GraphQL `reviewThreads`, `isResolved`), reviews and reviewer conversation comments, with which have a reply; exit 0 every comment answered, 1 any unanswered, 2 unreadable (never "all answered"). Reviewers named in `.keel/keel.json` `"review"`.
- **Waiting**: `--wait` until each named reviewer has reviewed the head commit or `wait` minutes pass (reviewers post minutes after CI), so an agent reads them before it moves on; a timeout is said.
- **Answering**: `keel review --close <thread> --fixed <commit> | --tracked <issue|version> | --not-valid "<why>"` posts the reply; fixed and not-valid resolve; tracked stays open until its fix is recorded. Validation (is the comment right?) is the agent's or person's judgement, recorded in the reply.
- **The rule written down**: the conduct skill, the AGENTS block, and the climb and tend briefs: when a PR has reviews, validate each comment first, then answer it.
- **Seen nightly**: `reviews_unanswered` on the night (comments on open or recently merged PRs with no reply, older than a day); loose-ends lists them with the command.

## Acceptance

- [x] `keel review` on a stubbed PR with one answered and one unanswered comment exits 1 and names the unanswered one; all answered exits 0; GitHub unreadable exits 2, never 0; mutation: an unreadable read returning 0 fails the test. `tests/review.test.mjs`
- [x] `--wait` returns when the named reviewer's review on the head commit appears, and on timeout says so. `tests/review.test.mjs`
- [x] `--close` posts the reply and resolves for fixed and not-valid, posts and leaves open for tracked, and refuses a not-valid with no reason or a fixed with no commit. `tests/review.test.mjs`
- [x] Nothing in keel refuses a merge because of an open thread (fleet update and drain merge as before). `tests/review.test.mjs`
- [x] The conduct skill and the climb and tend briefs say: validate each review comment, then answer it with one of the three replies. `tests/skill.test.mjs`
- [x] The night's `reviews_unanswered` counts comments with no reply older than a day, n/a when GitHub can't be read. `tests/improve.test.mjs`
- [ ] ⚑ by hand: the next fleet release's update PRs, every reviewer comment validated and answered; the owner reads one PR's threads.

## Real surfaces

- GitHub API: review threads read and resolved, replies posted, on real PRs in the fleet.
- Adopted project: the next fleet release's update PRs in ledger, duo and cajones, where Codex reviews.
- Fleet over time: the night's `review_threads_open` on every project.

## Proof

- Automated: `node --test tests/review.test.mjs tests/night.test.mjs tests/skill.test.mjs`, with the mutations above; `npm run check`.
- By hand: the next fleet release, its threads closed in the three forms, read by the owner.

## Deliberately open

- **Not a gate**, settled by the owner on 6 Oct: answers are required, merges are not blocked.
- **Which reviewers to wait for, per repo.** Codex today on ledger, duo and cajones; isocan and keel have none named. A repo with none waits for nothing and reads what exists.
- **A tracked thread whose fix never lands**: the night's count shows it ageing; settled after a few releases.

## Next action

The next fleet release (0.8.3): wait for Codex, validate and answer every comment with `keel review --close`, then merge; name Codex as the reviewer in ledger, duo and cajones (the owner said yes); answer ledger's 27 unanswered comments from the past week (the owner said yes).

## Trajectory

- **2026-10-06** — Escape (the reason for this phase): keel's v0.8.0 update PRs were merged on green CI with 13 unread Codex comments, every one valid, one a P1. Fixed in v0.8.1 (4175825), each thread answered and resolved; the v0.8.1 PRs' reviews were read before merging and found four more (v0.8.2).
- **2026-10-06** — Not a gate, the owner's call; and the owner's opt-in: a phase marked `review: wait` (or an issue labelled `keel:wait-for-review`) lands through a PR that waits for the reviewer and every answer (`keel review --gate`). Default off.
- **2026-10-06** — A reviewer's top-level summary that opens with a hidden `<!-- -->` marker counts as status, not something to answer; its findings are the inline threads (the owner kept the rule).
- **2026-10-06** — The first real read: ledger has 27 unanswered comments across 10 PRs merged in the week, beyond keel's own (all answered); the night's first `reviews_unanswered` there will be outside.
