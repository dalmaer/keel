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

**Optional: opt in with `--with claude` (owner's decision, 3 Oct 2026).**
`keel init` and `keel adopt` leave it off unless asked (`--with claude`), or
unless `.keel/keel.json` already lists it. It earns its place when the owner is
away: it runs Claude on GitHub, from an issue or a review, with nobody at a
terminal. With the owner at hand, Claude Code does the same work locally, so
the workflow adds a second way to spend, not a second capability; each
mention spends model tokens. Adopt still marks it local where the project
runs its own claude-code-action workflow.

**Its files.** `.github/workflows/claude.yml` (managed). `keel adopt` keeps
the practice local where a project already runs `anthropics/claude-code-action`
in a workflow of its own, so two Claudes never answer one mention.

**Lineage.** Keel phase 10, from duo's `.github/workflows/claude.yml`, with
git narrowed from `git *` to the subcommands that cannot push.

**Ancestors (phase 16, 3 Oct 2026).** What keel decided for the projects this
practice came from, where each keeps a version of its own:

- **isocan**: *stays local*. `changelog.yml` already runs
  `anthropics/claude-code-action`; two Claudes would answer one mention.
- **ledger**: *on*.
