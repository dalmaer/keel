# cross-review

**The failure it prevents.** Review that runs one way only. Codex reviews
every pull request in ledger, duo and cajones, Claude Code's included, and
on 6 October its reviews of keel's v0.8.0–v0.8.2 update PRs found 27
comments, all valid (a P1 sandbox escape, a P1 secret persisted in
artifacts). Codex's own PRs got no second reader. A second model catches
what the author's model is blind to; the same model reviewing itself does
not.

**The rule.** `.github/workflows/keel-cross-review.yml` runs Claude
(`anthropics/claude-code-action`) on a pull request whose head branch
starts with a configured prefix, under the brief
`.agents/cross-review/REVIEW.md`:

- **Which PRs.** A head branch starting with a prefix in
  `"crossReview".for` (Codex opens PRs under the owner's account, so the
  branch, not the author, says who wrote it), in this repo (never a fork),
  when the PR is opened or marked ready for review, and again when a person
  with write access (OWNER, MEMBER, COLLABORATOR; never a bot) comments
  `/review` on it. Never on a push: a review per push costs more than it
  tells; `/review` asks again. Reviews of one PR queue, never cancelled; a
  comment that is not a `/review` runs in a group of its own, so it never
  displaces a `/review` waiting behind a running review.
- **How it reviews.** The brief asks for findings only where the code shows
  them: each validated against the code before it is written, tagged P1
  (wrong or unsafe), P2 (a bug in some case) or P3 (worth a look), placed as
  an inline comment on the line. No style nits, no restating the diff. The
  agent reads `AGENTS.md`, the project's lessons table,
  `docs/keel-lessons.md` and the phase the PR names.
- **What it can do.** Read, Grep, Glob, `gh pr diff`, `gh pr view` and the
  action's inline-comment tool. Nothing else: it never pushes, approves,
  requests changes or merges, and the workflow's token cannot write the
  repo's contents. Its final message is the summary, which the workflow
  posts as a `COMMENT` review (`scripts/keel/cross-review.mjs summary`),
  opened by a hidden marker so it is a status board that owes no answer.
- **Trust.** The config, the brief and the after-checks come from the
  default branch; only then is the PR's head checked out for the agent to
  read. Nothing runs the PR's code.
- **Budget.** The agent's step is time-boxed to `budget.minutes` (5 to 60,
  default 15). A timeout is not red: its comments stand, and the summary
  says the budget ran out. An agent that failed before its budget ran out
  (a refused secret, a refused model) is red and prints only the error line
  (lesson 29, the climb practice's check, copied into `cross-review.mjs`).

**Answering.** Phase 41's rule applies to the author: every comment is
validated and answered fixed, tracked or not valid (`keel review --close`).
The night counts the ones left (`reviews_unanswered`) whoever reviewed, and
`cross_review_valid` records the share of Claude's comments answered valid
(fixed or tracked) among those answered, once ten are answered: a reviewer
whose comments are mostly "not valid" is noise, and the health page says
so. It is recorded with no bound.

**Config.** `.keel/keel.json`:

```json
"crossReview": { "for": ["codex/"], "budget": { "minutes": 15 } }
```

No key, no reviews: the workflow ends at its first step. An unknown key, an
empty `for`, or minutes outside 5–60 is red, naming the key.

**What it needs (⚑).** One secret: `CLAUDE_CODE_OAUTH_TOKEN` (from
`claude setup-token`) or `ANTHROPIC_API_KEY` (billed per token), the claude
practice's. Each reviewed PR spends model tokens, up to the budget. Until
one is set the run ends green with a notice. The inline comments are
posted by the Claude GitHub App (`claude[bot]`), which the action's OIDC
exchange needs installed on the repo.

**Optional: opt in.** `keel init` and `keel adopt` leave it off unless asked
(`--with cross-review`), or unless `.keel/keel.json` already lists it.

**Its files.** `.github/workflows/keel-cross-review.yml`,
`scripts/keel/cross-review.mjs` and `.agents/cross-review/REVIEW.md`, all
managed.

**Lineage.** Keel phase 42, from the owner's request on 6 October 2026
("I want Claude Code to review Codex PRs"); design
`docs/research/2026-10-06-cross-review.md`. The trigger and agent-ran
patterns are the climb and claude practices'.
