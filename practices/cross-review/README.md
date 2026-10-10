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
review's summary says why, exactly ("reviewed by claude, its own provider:
no other provider is listed", or "…: codex is listed but its secret
OPENAI_API_KEY is not set"):

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
  pushes, approves, requests changes or merges.
- **Two jobs** (keel phase 46, as climb and tend since ledger#92). The
  agent runs in the `review` job, whose token only reads (`contents: read`,
  `pull-requests: read`; no `id-token`, no credential persisted by a
  checkout), and Claude's action is handed that token as `github_token`, so
  it never trades OIDC for its app's token, which could write. Its final
  message, the PR and its diff leave as an artifact. The `publish` job
  (`pull-requests: write`) runs no agent and nothing from the PR's branch:
  it checks out the default branch, runs that branch's
  `cross-review.mjs summary` on the artifact and posts the review. It runs
  only when the agent ran: a red "Did the agent run?" ends the run there.
- **Findings are data.** The agent's final message is a short summary and
  a fenced `json` block, `[{ "path", "line", "severity": "P1"|"P2"|"P3",
  "body" }]`. `scripts/keel/cross-review.mjs summary` checks each against
  the PR's diff (the path is in it, the line in one of its hunks, a known
  severity, a body) and the publish job posts one `COMMENT` review: the
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
writes a prefix in `for` while another provider is listed, and a prefix
that matches a provider's branches and others (`"claude"` matches `claude/`
and `claude-fix`; `"c"`): name the provider's branch exactly (`claude/`,
or longer, `claude/feature-`) or a prefix no provider's branch shares
(`custom/`). `"agent"` is optional, and only for a prefix no provider's
branch names (a person's `acme/`, say); default claude. With no reviewer's
secret set, the PR gets a notice and the run is green; a choice that would
put the author's provider on its own PR while another is available is red,
and no agent runs.

**What it needs (⚑).** The chosen agent's secret. Claude:
`CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) or
`ANTHROPIC_API_KEY` (billed per token), the claude practice's; the action
is handed the review job's read-only token, so it needs no Claude GitHub
App and exchanges no OIDC token (phase 46). Codex:
`OPENAI_API_KEY`, always billed per token to the OpenAI API account (there
is no subscription path), and codex-action runs only for an actor with
write access, or a bot it is told to trust; so does claude-code-action.
Both steps name exactly the providers' bots (Codex's `allow-bot-users`,
Claude's `allowed_bots`: `claude[bot]`), so a `claude/` PR Claude's app
opened is reviewed, by Codex or, as the fallback, by Claude; never a
wildcard or `allow-bots`. Each
reviewed PR spends model tokens, up to the budget. Until the secret is set
the run ends green with a notice. The review and its inline comments are
posted by the workflow's publish job (`github-actions[bot]`), whichever
agent wrote them.

**After the push** (keel phase 60). A project that ships to main opens no
PR, so its agents' code never meets a second provider. With
`"crossReview": { "after": "push" }` each push to main is reviewed after
it lands, and nothing waits on it:

- **The trigger.** `keel render` adds `push: branches: [main]` and a daily
  run to the workflow only for such a project; without `"after"` the
  workflow has no push trigger at all. `"for"` becomes optional (a project
  may review its PRs too). All pushes and the daily run share one
  concurrency group, so pushes that land during a review coalesce into the
  one pending run.
- **What it reviews.** Everything on main since the last review, as one
  batch: the combined diff. The last review's tracking issue records where
  it ended. A review only ever starts from such a record, so a review that
  fails is retried from it, with every push since. With no record that can
  serve (none yet; one a force push dropped; one from before an upgrade),
  nothing is reviewed and the record starts first, before anything is
  spent: at the push's `before` when its script can post (the next run
  reviews that push), else at the head (a first push, `before` all zeros;
  a force push; the push that installs or upgrades the publisher; a daily
  run before any review). A start is a closed tracking issue, said in a
  notice.
- **Who reviews it.** A provider other than the one that wrote the
  commits: each commit's author, and its `Co-authored-by` trailers (the
  trailer block git parses, never a line quoted in the body), name the
  provider by email: Claude Code's `<noreply@anthropic.com>`,
  `claude[bot]`'s, Codex's. A name alone is never evidence: a person may
  be named Claude. A person's push goes to the first provider listed. Its
  own provider reviews only when no other is available, said as for a PR.
- **Where findings go.** Checked against the push's diff exactly as a PR's
  are. Each one whose line the head commit's own diff holds becomes a
  commit comment on the head; all of them go into one tracking issue per
  push, `keel review after <sha>` (label `keel:review-after`), each with an
  id (F1, F2, …). The issue opens pending; the one edit that finishes it
  writes its hidden record (the next run's starting point, each finding's
  whole text as far as the issue holds it) and, with no findings, closes
  it. Until that edit lands nothing is recorded, so a failed post is
  reviewed again. Answer each with `keel review <repo>@<sha> --close <id>
  --fixed …`; the issue closes when every finding is answered (a tracked
  one too: its work goes on where it is tracked). A read shows every other
  comment on the issue, whole, before it counts it read. A finding
  answered tracked is drafted as a `keel:agent` issue (`--json` `work`),
  for phase 54's robot to file.
- **The sandbox.** The same two jobs. The review job reads main's whole
  history (no credential kept) and the tracking issues (`issues: read`).
  The publish job (`issues: write` too) checks out the commit before the
  reviewed ones, the range's base, so nothing it runs came in with the
  push; it posts with `cross-review.mjs push-post`. The review job ran the
  pushed code, so the publish job decides that commit itself, from a fact
  the push cannot set: it must be the last record's end (read with the
  publish job's own token), and GitHub's compare must put it below the
  run's commit. Anything else is red and runs nothing. A start is at the
  push's `before` only when GitHub puts it below the run's commit, else
  at the run's commit. Claude reads the push's diff from a folder of its
  own under the runner's temp (`--add-dir`), granted alone. The base's script must also speak the push protocol
  (`PUSH_PROTOCOL`); one that does not (from before an install or an
  upgrade) is never a base. That is checked before any agent runs, so
  nothing is spent on a review that cannot be posted. Starting the record
  runs no repository code at all.
- **Spend.** One review per run, within `budget.minutes`, and at most
  `budget.pushes` reviews a UTC day (1 to 48, default 8). Past it a push
  waits, with a notice, and the next run (the daily one, if no push comes)
  reviews the waiting pushes together.

**Optional: opt in.** `keel init` and `keel adopt` leave it off unless asked
(`--with cross-review`), or unless `.keel/keel.json` already lists it.

**Its files.** `.github/workflows/keel-cross-review.yml`,
`scripts/keel/cross-review.mjs` and `.agents/cross-review/REVIEW.md`, all
managed.

**Lineage.** Keel phase 42, from the owner's request on 6 October 2026
("I want Claude Code to review Codex PRs"); design
`docs/research/2026-10-06-cross-review.md`. The trigger and agent-ran
patterns are the climb and claude practices'.
