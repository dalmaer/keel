---
status: partial
owes: walk
waits: external
since: 2026-10-07
goal: G2
spec: 2
depends: [35, 38, 42]
note: "Built: agents (\"agents\", and \"agent\" per pass, default claude), adapters for Claude and Codex in the night lib, findings as JSON that keel validates against the diff and posts (no agent holds a comment tool), Codex reviewing in a read-only, drop-sudo sandbox. Phase 47 supersedes the original Claude-only climb/tend restriction with agent-git object transfer; phase 46 splits review from publishing. Owes the owner assessment of a Codex review on ledger."
evidence: ["evidence/2026-10-07-agent-providers.md"]
issue: 29
---

# Agents are providers: Claude and Codex behind keel's rules

## Done when

A project chooses which agent runs each pass in `.keel/keel.json` (`"agents"`, and an `"agent"` on cross-review, climb and tend), Claude and Codex are both adapters held to the same rules by the same tests, a reviewing agent's findings are posted by keel's own step, and on ledger one pass runs on Codex by changing one line, its result read by the owner.

## Scope

The design is [Agent providers](../research/2026-10-07-agent-providers.md).

- **Config**: `"agents": { "claude": {}, "codex": {} }` (which providers the project uses; their secrets are declared per provider), and `"agent": "<name>"` on `crossReview`, `climb` and `tend`, defaulting to `claude`. Validated: an agent a pass names must be listed; an unknown provider is an error.
- **Adapters**: one per provider in the shipped scripts, each giving the action and its major, its secrets, its read-only and edit-the-tree settings (Claude: `--allowedTools`; Codex: `sandbox`, `safety-strategy: drop-sudo`, `read-only`), where its final message and its error are read (for "Did the agent run?" and the Budget line), and its bot login.
- **Workflows (reconciled 2026-10-09)**: cross-review chooses the other provider from the author branch; phase 46 separates read-only review and trusted publication. Phase 47 adds Codex climb/tend using agent-git object transfer under workspace-write. The historical Claude-only constraint below is superseded; its sandbox failure remains part of the record.
- **Findings as data**: the reviewing agent ends with a fenced JSON block (`[{ path, line, severity: "P1"|"P2"|"P3", body }]`) and a summary; `cross-review.mjs` validates it (paths in the PR's diff, lines in range, severity known) and the workflow posts the inline comments and the COMMENT review. The agent holds no comment tool.
- **Not in scope**: an `@codex` worker beside the `claude` practice (ChatGPT's connection already answers `@codex`).

## Acceptance

- [x] Config validation: an `agent` that is not listed in `agents`, an unknown provider, and a malformed `agents` are errors; no `agent` means `claude`. `tests/agents.test.mjs`
- [x] Each shipped workflow, rendered for each provider, keeps every sandbox rule (agent and judge jobs read-only, publish runs nothing from the branch, secrets declared, no push to main), and the agent step is the provider's own action; mutation: a Codex agent step with `sandbox: danger-full-access` fails the test. `tests/workflows.test.mjs`
- [x] "Did the agent run?" and the Budget line read each provider's output: a Codex run that failed to start is red with its error line only. `tests/agents.test.mjs`
- [x] Findings: valid JSON findings become inline comments and a COMMENT review; a finding on a path outside the diff, a line out of range, or an unknown severity is dropped and named in the summary; prose with no JSON block posts the summary alone. `tests/cross-review.test.mjs`
- [x] With no `agents` key and no `agent` on any pass, climb's and tend's agent steps are byte-identical to today's, and cross-review's Claude step passes the same inputs but for the comment tool (findings are JSON now). `tests/agents.test.mjs`
- [ ] ⚑ by hand: on ledger, the owner sets `OPENAI_API_KEY` and switches one pass to `"agent": "codex"`; its next run is read by the owner.

## Your part

- **Ask:** On ledger, read the review Codex leaves on the next pull request Claude opens, and say whether its comments were worth having.
- **Why:** It proves keel can run a second AI provider under the same rules by changing one setting.
- **Look at:** The next `claude/…` pull request on ledger and Codex's review on it.
- **Choices:** Worth having | Not worth having
- **Takes:** 10 minutes
- **Then:** Worth having: recorded, and this is done. Not worth having: recorded; say why in the note, and the conductor proposes what to change in how Codex reviews.
- **Ready when:** Codex has reviewed a pull request Claude opened on ledger (switched on in ledger#105).

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

⚑ Owner: assess the usefulness of a Codex cross-review on a Ledger change authored by Claude. Configuration was enabled in [Ledger PR #105](https://github.com/dalmaer/ledger/pull/105); that configuration change does not prove the owner assessment. Phases 46 and 47 own the later sandbox and provider changes.

## Trajectory

- **2026-10-07** — Codex cannot run climb or tend: under `workspace-write` it keeps `.git` read-only, so it cannot commit, and both passes' guards are built on the agent's commits; `danger-full-access` is refused. Codex reviews; `"agent": "codex"` on climb or tend is a config error naming why. A redesign (the workflow commits a plan Codex writes, or a named permission profile) is its own phase.
- **2026-10-07** — Findings became data: no agent holds a comment tool; keel's step validates each finding against the PR's diff hunks and posts one COMMENT review. Its comments are now `github-actions[bot]`'s, so `cross_review_valid`'s tally counts them by a marker.
- **2026-10-07** — Cross-review is still one job with pull-requests: write; Codex is contained by its read-only, no-network sandbox and a blanked GH_TOKEN, Claude by read-only tools. Splitting it into agent and publish jobs, as climb and tend are, is the next hardening.
- **2026-10-07** — The owner's rule: a PR is always reviewed by a different provider than the one that wrote it. The reviewer is derived per PR from its author (the provider whose branch, `claude/` or `codex/`, its head starts with): the first other provider `"agents"` lists. A prefix whose author has no other provider listed, or an `agent` equal to a prefix's author, is a config error; a run that would review its own author ends red with no agent run. `codex/` matches the fleet; OpenAI does not document it.
- **2026-10-07** — Switched on for ledger (ledger#105): `OPENAI_API_KEY` set by the owner, `"agents": {"claude": {}, "codex": {}}`, and `crossReview.for: ["codex/", "claude/"]`; ledger's own reviewerOf routes codex/ to Claude and claude/ to Codex.

- **2026-10-09** — Reconciled current architecture with phases 46 and 47: split review/publication and Codex agent-git transfer supersede the original one-job/Claude-only restrictions. Historical trajectory is preserved, and the owner usefulness assessment remains unchecked.
