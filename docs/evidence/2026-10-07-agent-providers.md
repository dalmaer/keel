# Evidence: phase 45 — agents are providers: Claude and Codex behind keel's rules

- Date: 2026-10-07
- Phase: 45
- Revision: base a844df0, working tree (the commit "phase 45: Agents are providers: Claude and Codex behind keel's rules")
- Claim being checked: a project chooses the agent per pass; Claude and Codex are adapters held to the same rules; a reviewing agent's findings are JSON keel's step validates and posts; a project naming no agent runs Claude as before.

## Automated checks

- `node --test tests/agents.test.mjs tests/workflows.test.mjs tests/cross-review.test.mjs` → exit 0, `ℹ pass 45`, `ℹ fail 0` (conductor).
- Mutation (conductor, copy-restore): the Codex review step's `sandbox: read-only` → `workspace-write` fails 3 (workflows, agents).
- Builder: 221 pass across agents, workflows, cross-review, climb, tend, improve-budget, keel-workflows, practices, adopt, improve, cli, docs, guides, climb-hygiene, update, night and review. In-test mutations caught: Codex with danger-full-access, workspace-write or the default sandbox; `unsafe`; sudo kept; allow-bots; allow-users; codex-args; GH_TOKEN not blanked; a foreign secret; no time box; the Codex step missing; the comment tool back. Temp-copy mutations each red: `Bash(git push *)` in Claude's climb step; the "agent listed" check removed; Codex allowed on climb/tend; the hunk-range check removed; an empty Codex message read as ran; the tally's marker branch removed.
- The default: Claude's climb and tend steps equal their pre-phase text byte for byte; cross-review's Claude step equals it but for the `agent == 'claude'` guard and the removed inline-comment tool (findings are JSON now). A config naming no agent runs claude.
- The gate, `npm run check`, runs after this file; its result is in the commit body.

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| A Codex cross-review on ledger | inline comments posted by keel's step from Codex's JSON | Not run (⚑: OPENAI_API_KEY on ledger, the owner's) | — |

## Gaps and decision

Partial, owes a walk: the Codex run on ledger. Codex runs cross-review only: under `workspace-write` Codex keeps `.git` read-only, so it cannot commit, and climb's and tend's guards are built on the agent's commits; the only sandbox that commits (`danger-full-access`) is refused. `"agent": "codex"` on climb or tend is a config error saying why.
