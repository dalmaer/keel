# Evidence: phase 47 — Codex runs climb and tend

- Date: 2026-10-08
- Phase: 47
- Revision: base bbdabd4, working tree (the commit "phase 47: Codex runs climb and tend")
- Claim being checked: with `"agent": "codex"`, climb and tend run Codex under the unchanged three-job sandbox; Codex commits to a second git dir (Path A, settled by the spike), and keel takes only objects from it.

## Automated checks

- `node --import ./tests/helpers/hermetic.mjs --test tests/workflows.test.mjs tests/climb.test.mjs tests/agents.test.mjs` → exit 0, `ℹ pass 73`, `ℹ fail 0` (conductor).
- Mutation (conductor, copy-restore): tend_codex's `TMPDIR` set to `${{ runner.temp }}` fails tests/workflows.test.mjs (1).
- Builder: 21 in-test mutations of `codexEditProblems` (danger-full-access, unsafe, read-only or default sandbox, sudo kept, allow-bots/allow-users, codex-args, a token held, another secret, no time box, the config ignored, Codex in publish, no git dir, the take reading the agent's git dir, hooks on, global config read, the ancestry check removed, a bundle from agent-git, .git bundled for Codex) plus TMPDIR's (removed, runner.temp, $RUNNER_TEMP/codex, /tmp/.git, never created), each caught. Real-file mutations: danger-full-access in keel-tend.yml fails; the handoff pointed at the agent's git dir fires a planted reference-transaction hook and fails; agentGitArgs disabled fails; worktrees beside the checkout fails.
- climb.test: nights run with .git and the checkout's parent read-only commit, keep and revert in .keel/agent-git while .git never moves; hooks, fsmonitor, aliases and include.path planted in agent-git fire when used directly and never during the handoff; the judge refuses scripts/keel/, .github/, .keel/keel.json and .keel/agent-git/config; an orphan head and a non-hex ref are refused.
- The spike (keel run 37716223683) is the basis: Codex committed to .keel/agent-git while .git was read-only.
- The gate, `npm run check`, runs after this file; its result is in the commit body.

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| One Codex climb night and one Codex tend pass on a project | each PR read by the owner | Not run (⚑: the owner switches a pass to codex) | — |

## Gaps and decision

Partial, owes a walk. Unproven until a real run: whether openai/codex-action passes KEEL_AGENT_GIT into Codex's shell (the brief also tells Codex to name the git dir), and whether Codex's sandbox lets `git worktree add` write under /tmp. Closed by construction: TMPDIR is pinned to /tmp/keel-codex on every Codex step, so Codex cannot reach $RUNNER_TEMP's command files. Limitation: on a Codex night, a gate that reads a sibling folder (ledger's ../ledger-data) fails, because compare's worktrees go to the OS temp.
