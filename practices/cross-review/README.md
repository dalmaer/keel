# cross-review

**The failure it prevents.** Review that runs one way only. Codex reviews
every pull request in ledger, duo and cajones, Claude Code's included, and
on 6 October its reviews of keel's v0.8.0–v0.8.2 update PRs found 27
comments, all valid (a P1 sandbox escape, a P1 secret persisted in
artifacts). Codex's own PRs got no second reader. A second model catches
what the author's model is blind to; the same model reviewing itself does
not.

**The rule.** `.github/workflows/keel-cross-review.yml` runs an agent on a
pull request whose head branch starts with a configured prefix, under the
brief `.agents/cross-review/REVIEW.md`. **A PR is reviewed by a
different provider than the one that wrote it, whenever one is available**
(the owner's rule, keel phase 45): Claude (`anthropics/claude-code-action`) reviews Codex's
`codex/` PRs, Codex (`openai/codex-action`) reviews Claude's `claude/` PRs.
The author is the provider whose branch the head starts with (`claude/` is
claude-code-action's default branch prefix; Codex's cloud always names its
branches `codex/<slug>`); the reviewer, chosen per PR, is the first
provider `"agents"` lists that is not the author and has its secret set.
Only when no other is available (none listed, or none with its secret) does
the author's own provider review it: the run says so in a notice, and the
review's summary says "reviewed by claude, its own provider: no other is
configured":

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
  (wrong or unsafe), P2 (a bug in some case) or P3 (worth a look), on the
  line it is about. No style nits, no restating the diff. The
  agent reads `AGENTS.md`, the project's lessons table,
  `docs/keel-lessons.md` and the phase the PR names.
- **What it can do.** Read, and nothing else. Claude's tools are Read,
  Grep, Glob, `gh pr diff` and `gh pr view`; Codex runs in its `read-only`
  sandbox (no write, no network) with `safety-strategy: drop-sudo` (its key
  stays out of its reach) and no GitHub token, reading the diff the
  workflow wrote before it ran. Neither holds a tool that comments: it never
  pushes, approves, requests changes or merges, and the workflow's token
  cannot write the repo's contents.
- **Findings are data.** The agent's final message is a short summary and
  a fenced `json` block, `[{ "path", "line", "severity": "P1"|"P2"|"P3",
  "body" }]`. `scripts/keel/cross-review.mjs summary` checks each against
  the PR's diff (the path is in it, the line in one of its hunks, a known
  severity, a body) and the workflow posts one `COMMENT` review: the
  summary, opened by a hidden marker so it is a status board that owes no
  answer, with the valid findings as its inline comments (each opening
  with a `<!-- keel:cross-review finding -->` marker and its priority).
  A finding dropped is named in the summary, with why; prose with no block
  posts the summary alone. Should GitHub refuse the inline comments, the
  review is posted with the findings listed in its summary instead.
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
`cross_review_valid` records the share of the cross-review's comments
(`claude[bot]`'s before phase 45, the workflow's own marked findings since)
answered valid
(fixed or tracked) among those answered, once ten are answered: a reviewer
whose comments are mostly "not valid" is noise, and the health page says
so. It is recorded with no bound.

**Config.** `.keel/keel.json`:

```json
"agents": { "claude": {}, "codex": {} },
"crossReview": { "for": ["codex/", "claude/"], "budget": { "minutes": 15 } }
```

List every provider you use in `"agents"`: each prefix's PRs are reviewed
by the first other one listed. No `"agents"` means claude alone, so
today's `"for": ["codex/"]` is reviewed by Claude, unchanged. No key, no
reviews: the workflow ends at its first step. The config is checked
before the secret gate, so a bad one is red, naming the key, never a quiet
green: an unknown key, an unknown provider in `"agents"` (a typo like
`"claud"`), an empty `for`, minutes outside 5–60, and an `"agent"` that
writes a prefix in `for` while another provider is listed. A prefix that
names a provider only partly (`"claude"` without the slash) is read as that
provider's. `"agent"` is optional, and only for a prefix no provider's
branch names (a person's `acme/`, say); default claude. With no reviewer's
secret set, the PR gets a notice and the run is green; a choice that would
put the author's provider on its own PR while another is available is red,
and no agent runs.

**What it needs (⚑).** The chosen agent's secret. Claude:
`CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) or
`ANTHROPIC_API_KEY` (billed per token), the claude practice's; the action's
OIDC exchange needs the Claude GitHub App installed on the repo. Codex:
`OPENAI_API_KEY`, always billed per token to the OpenAI API account (there
is no subscription path), and codex-action runs only for an actor with
write access, or a bot it is told to trust: the step names the other
providers' bots (`allow-bot-users: claude[bot]`, so a `claude/` PR Claude's
app opened is reviewed), never a wildcard or `allow-bots`. Each
reviewed PR spends model tokens, up to the budget. Until the secret is set
the run ends green with a notice. The review and its inline comments are
posted by the workflow's own step (`github-actions[bot]`), whichever agent
wrote them.

**Optional: opt in.** `keel init` and `keel adopt` leave it off unless asked
(`--with cross-review`), or unless `.keel/keel.json` already lists it.

**Its files.** `.github/workflows/keel-cross-review.yml`,
`scripts/keel/cross-review.mjs` and `.agents/cross-review/REVIEW.md`, all
managed.

**Lineage.** Keel phase 42, from the owner's request on 6 October 2026
("I want Claude Code to review Codex PRs"); design
`docs/research/2026-10-06-cross-review.md`. The trigger and agent-ran
patterns are the climb and claude practices'.
