# claude

**The failure it prevents.** An agent with write access that lands work
nobody read: a bot pushing to `main`. And the opposite failure, an issue that
waits for a person to have time to start it.

**The rule.** `.github/workflows/claude.yml` answers `@claude` in an issue,
a comment or a review (or an issue labelled `claude`) with Claude Code,
which reads `AGENTS.md`, does the work on a `claude/` branch and opens a pull
request. A person merges. Its tools let git read, stage and commit, not push;
the action publishes its own branch. The action answers only people with
write access. No model is pinned: a pinned model is a fact that ages. Branch
protection on `main` is what makes "never pushes main" a guarantee rather
than a configuration.

**What it needs (⚑).** One secret: `CLAUDE_CODE_OAUTH_TOKEN` (from
`claude setup-token`, drawn from a Claude subscription) or
`ANTHROPIC_API_KEY` (billed per token). Every mention spends model tokens.
Until one is set the run ends green with a notice.

**Its files.** `.github/workflows/claude.yml` (managed). `keel adopt` keeps
the practice local where a project already runs `anthropics/claude-code-action`
in a workflow of its own, so two Claudes never answer one mention.

**Lineage.** Keel phase 10, from duo's `.github/workflows/claude.yml`, with
git narrowed from `git *` to the subcommands that cannot push.
