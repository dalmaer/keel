---
status: planned
since: 2026-10-07
goal: G2
spec: 2
depends: [35, 38, 42]
note: "The owner asked for Codex beside Claude, and for it to be extendable. Every agent keel runs is Claude, spelled into each workflow. A provider becomes an adapter (action, secrets, how read-only and edit-the-tree are said, where its final message and error are read, its bot login); the rules stay keel's; a reviewer's findings are JSON keel posts. Design: research/2026-10-07-agent-providers.md."
evidence: []
issue: 29
---

# Agents are providers: Claude and Codex behind keel's rules

## Done when

A project chooses which agent runs each pass in `.keel/keel.json` (`"agents"`, and an `"agent"` on cross-review, climb and tend), Claude and Codex are both adapters held to the same rules by the same tests, a reviewing agent's findings are posted by keel's own step, and on ledger one pass runs on Codex by changing one line, its result read by the owner.

## Scope

The design is [Agent providers](../research/2026-10-07-agent-providers.md).

- **Config**: `"agents": { "claude": {}, "codex": {} }` (which providers the project uses; their secrets are declared per provider), and `"agent": "<name>"` on `crossReview`, `climb` and `tend`, defaulting to `claude`. Validated: an agent a pass names must be listed; an unknown provider is an error.
- **Adapters**: one per provider in the shipped scripts, each giving the action and its major, its secrets, its read-only and edit-the-tree settings (Claude: `--allowedTools`; Codex: `sandbox`, `safety-strategy: drop-sudo`, `read-only`), where its final message and its error are read (for "Did the agent run?" and the Budget line), and its bot login.
- **Workflows**: keel-cross-review.yml, keel-climb.yml and keel-tend.yml choose the agent's step by the pass's `agent`; the three-job sandbox, guard, judge and publish are unchanged.
- **Findings as data**: the reviewing agent ends with a fenced JSON block (`[{ path, line, severity: "P1"|"P2"|"P3", body }]`) and a summary; `cross-review.mjs` validates it (paths in the PR's diff, lines in range, severity known) and the workflow posts the inline comments and the COMMENT review. The agent holds no comment tool.
- **Not in scope**: an `@codex` worker beside the `claude` practice (ChatGPT's connection already answers `@codex`).

## Acceptance

- [ ] Config validation: an `agent` that is not listed in `agents`, an unknown provider, and a malformed `agents` are errors; no `agent` means `claude`. `tests/agents.test.mjs`
- [ ] Each shipped workflow, rendered for each provider, keeps every sandbox rule (agent and judge jobs read-only, publish runs nothing from the branch, secrets declared, no push to main), and the agent step is the provider's own action; mutation: a Codex agent step with `sandbox: danger-full-access` fails the test. `tests/workflows.test.mjs`
- [ ] "Did the agent run?" and the Budget line read each provider's output: a Codex run that failed to start is red with its error line only. `tests/agents.test.mjs`
- [ ] Findings: valid JSON findings become inline comments and a COMMENT review; a finding on a path outside the diff, a line out of range, or an unknown severity is dropped and named in the summary; prose with no JSON block posts the summary alone. `tests/cross-review.test.mjs`
- [ ] With no `agents` key and no `agent` on any pass, every rendered workflow is byte-identical to today's. `tests/agents.test.mjs`
- [ ] ⚑ by hand: on ledger, the owner sets `OPENAI_API_KEY` and switches one pass to `"agent": "codex"`; its next run is read by the owner.

## Real surfaces

- Workflow shell: a Codex agent step running in keel-cross-review.yml or keel-tend.yml on GitHub Actions.
- GitHub API: inline comments and a COMMENT review posted by keel's step from an agent's JSON findings.
- Adopted project: ledger, one pass on Codex.

## Proof

- Automated: `node --test tests/agents.test.mjs tests/workflows.test.mjs tests/cross-review.test.mjs`, with the mutation above; `npm run check`.
- On GitHub: one Codex run on ledger, its comments or PR read by the owner.
- ⚑ The owner's OpenAI key on ledger (API spend, per token, an API account's).

## Deliberately open

- **Codex's spend has no subscription path**: every Codex run is billed per token to the API account. Its effect: the Budget line counts minutes, not dollars. Settled when one project has run Codex for a few weeks.
- **Claude's inline-comment tool**: findings as JSON make it unnecessary; keeping it as a fallback doubles the paths. Settled at build: JSON for both, unless Claude's JSON proves unreliable on real PRs.
- **More providers** (Gemini, a local model): the adapter shape admits them; none is added until a project asks.

## Next action

Brief a builder on the config and the adapter for Claude first (with findings as JSON), proving every rendered workflow unchanged for a project that names no agent; then the Codex adapter.
