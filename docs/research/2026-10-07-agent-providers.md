# Agent providers: Claude, Codex, and the next one

The owner, 2026-10-07: the `claude` practice is optional; is there also
Codex, and could it be extendable?

## Where keel stands

Every agent keel runs today is Claude, through `anthropics/claude-code-action`:
the `claude` practice (`@claude` on an issue or PR), cross-review, and
climb and tend. Codex reaches keel's projects only from outside: its GitHub
connection is set in ChatGPT's settings and reviews PRs, and keel waits for
its reviews and answers them (`keel review`). "Claude" is spelled into each
workflow: its action, its secrets (`CLAUDE_CODE_OAUTH_TOKEN`,
`ANTHROPIC_API_KEY`), its tool allowlist (`--allowedTools`), its inline-
comment tool, and the "Did the agent run?" reading of its execution file.

## What Codex offers in a workflow

OpenAI ships `openai/codex-action@v1` ([reference](https://learn.chatgpt.com/docs/github-action.md)). It differs from
Claude's action in the ways that matter here:

- **Auth**: `openai-api-key` only, billed per token. No subscription
  sign-in, so its spend is an API account's, not a plan's.
- **Safety**: not a tool allowlist. `sandbox` (`read-only`,
  `workspace-write`, `danger-full-access`), `safety-strategy` (`drop-sudo`
  by default, which keeps secrets out of the agent's reach; or
  `unprivileged-user`), and `read-only` (no file changes, no network).
- **Output**: `final-message` (and `output-file`). It posts nothing itself:
  the workflow posts what it says.
- **Who may trigger it**: write collaborators by default; `allow-users`,
  `allow-bots`.

## The shape

**A provider is an adapter; the rules are keel's.** `.keel/keel.json`
names agents, and each pass names which one runs it:

```json
"agents": { "claude": {}, "codex": {} },
"crossReview": { "for": ["codex/"], "agent": "claude", "budget": { "minutes": 15 } },
"tend": { "agent": "codex", "schedule": "weekly", "budget": { "minutes": 30 } }
```

- **The adapter** (one file per provider, shipped in the practice): the
  action and its pinned major, the secret names, how "read-only" and "may
  edit the tree, no network beyond the model" are expressed (Claude: an
  `--allowedTools` list; Codex: `sandbox` + `safety-strategy`), where its
  final message and its error are read from (for "Did the agent run?" and
  the Budget line), and the bot login its comments carry.
- **The rules don't move**: the three-job sandbox (agent and judge read-only,
  publish runs nothing from the branch), the guard, declared secrets, never
  pushing main, budgets and the Budget line, "Did the agent run?". Each is
  tested once per provider by the same workflow tests.
- **Findings are data, posted by keel**: a reviewing agent ends with a JSON
  block of findings (`path`, `line`, `severity`, `body`) and a summary; the
  workflow's own step validates the shape and posts the inline comments and
  the COMMENT review. That is the only way Codex can comment, and it is
  safer for Claude too: the agent then holds no write tool at all.
- **Default `claude`**: a project that names no agent runs exactly what it
  runs today.

## What stays out

- **`@codex` mentions as a worker** (the `claude` practice's job, for Codex):
  ChatGPT's own GitHub connection already answers `@codex`; keel shipping a
  second path would race it. Settled after the review passes work.
- **A provider keel cannot test** without the owner's key: Codex runs need
  `OPENAI_API_KEY` on a project; until one is set, Codex passes end green
  with a notice, like Claude's with no secret.

## Judged by

On ledger, one pass is switched from Claude to Codex (or a Codex
cross-review of Claude's PRs runs) by changing one config line, and the
owner reads the result; keel's tests hold every rule for both providers.
