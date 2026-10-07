---
status: partial
owes: walk
since: 2026-10-06
goal: G2
spec: 2
depends: [6, 10, 39]
note: "Built and used: keel review (read, --wait, --close; --gate only for the opt-in), reviews_unanswered on the night, the rule in conduct and the climb/tend briefs. Every Codex comment on the 0.8.3, 0.8.4 and 0.8.5 fleet PRs validated and answered; Codex named as reviewer in ledger, duo, cajones; ledger's 26 past comments answered (21 issues). Waits on the owner reading one PR's threads."
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

⚑ Owner: read one PR's answered threads (cajones#41: five Codex findings, each answered "fixed in dalmaer/keel@7eb26d3") and judge the answers; then built.

## Trajectory

- **2026-10-06** — Escape (the reason for this phase): keel's v0.8.0 update PRs were merged on green CI with 13 unread Codex comments, every one valid, one a P1. Fixed in v0.8.1 (4175825), each thread answered and resolved; the v0.8.1 PRs' reviews were read before merging and found four more (v0.8.2).
- **2026-10-06** — Not a gate, the owner's call; and the owner's opt-in: a phase marked `review: wait` (or an issue labelled `keel:wait-for-review`) lands through a PR that waits for the reviewer and every answer (`keel review --gate`). Default off.
- **2026-10-06** — A reviewer's top-level summary that opens with a hidden `<!-- -->` marker counts as status, not something to answer; its findings are the inline threads (the owner kept the rule).
- **2026-10-06** — The first real read: ledger has 27 unanswered comments across 10 PRs merged in the week, beyond keel's own (all answered); the night's first `reviews_unanswered` there will be outside.
- **2026-10-06** — Used across three releases: v0.8.3's 12 comments answered as tracked, then fixed in v0.8.4 and closed; v0.8.4's 12 (five distinct findings) fixed in v0.8.5 before merging; v0.8.5's PRs had none. ledger's past 26: 21 valid became issues #60–#80, 3 already fixed, 2 not valid; the 11 keel-side issues were fixed and closed.
- **2026-10-06** — Escape: `keel review --wait` timed out on every PR Codex found clean: Codex then posts no review, only a 👍 and a status board naming the commit "Completed"; fixed in f3c317d (the reviewer's own completed line for the head counts).
