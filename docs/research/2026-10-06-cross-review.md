# Cross-review: Claude reviews what Codex writes

Design, 6 October 2026. Phase 42 builds it.

## Why

Codex reviews every PR in ledger, duo and cajones, Claude Code's included.
On 6 October its reviews of keel's v0.8.0–v0.8.2 update PRs found 27
comments, all valid: a P1 sandbox escape, a P1 secret persisted in
artifacts, and a run of real bugs. The owner: "I like how Codex reviews
Claude Code PRs. I want Claude Code to review Codex PRs."

A second model reading the work catches what the author's model is blind
to. Today that runs one way only: Codex's own PRs (ledger's `codex/`
branches: #22, #38, #46) get no review from Claude.

## What changes

**An optional practice, `cross-review`.** It ships
`.github/workflows/keel-cross-review.yml` and a review brief
`.agents/cross-review/REVIEW.md`. Off unless a project switches it on; it
spends model tokens per reviewed PR.

**Which PRs.** `.keel/keel.json`: `"crossReview": { "for": ["codex/"], "budget": { "minutes": 15 } }`.
A PR is reviewed when its head branch starts with one of the prefixes
(Codex opens PRs under the owner's account, so the branch, not the author,
says who wrote it), on `opened` and `ready_for_review`, and again when a
person comments `/review` on it. Not on every push: a review per push costs
more than it tells.

**How it reviews.** `anthropics/claude-code-action` with the brief, the
PR's diff, and the project's own context: AGENTS.md, its lessons table,
`docs/keel-lessons.md` (keel's lessons for its stack), and the phase the PR
names, if any. The brief asks for findings only where the code shows them:
each one validated against the code before it is written, tagged P1 (wrong
or unsafe), P2 (a bug in some case) or P3 (worth a look), placed as an
inline comment on the line, with a one-paragraph summary review. No style
nits, no restating the diff. It reviews as a comment (never approve, never
request changes), never pushes, never merges; its tools are read-only plus
the inline-comment and PR-comment tools.

**Answering.** Phase 41's rule applies to the author: every comment is
validated and answered (fixed, tracked, not valid). Codex answering
Claude's comments is Codex's to do; keel's night counts unanswered ones on
every PR, whoever reviewed.

**What it never does.** Review Claude's own PRs (Codex already does; two
models reviewing each other's work is the point, the same model reviewing
itself is not). Run without a budget. Block a merge.

## Judged by

The comments it leaves and how they are answered: the share answered
"valid" over the first weeks, beside the cost per review. A reviewer whose
comments are mostly "not valid" is noise, and the practice says so on the
health page (`cross_review_valid`, once enough reviews exist).
