---
status: designed
since: 2026-10-07
goal: G4
spec: 2
depends: [45, 46]
note: "Path A holds (spike run 37716223683): under workspace-write and drop-sudo, Codex committed to a git dir inside the workspace under another name (.keel/agent-git, de7919f, confirmed outside the sandbox) while .git stayed read-only. Codex can run climb and tend on the unchanged protocol. Design: research/2026-10-07-review-hardening.md §2."
evidence: []
issue: 33
---

# Codex runs climb and tend

## Done when

A project can set `"agent": "codex"` on climb and on tend, and one Codex climb night and one Codex tend pass have run on a project under the unchanged three-job sandbox and guard, each PR read by the owner; Codex never runs with `danger-full-access` or `unsafe`.

## Scope

The design is [Review hardening](../research/2026-10-07-review-hardening.md), §2.

- **The spike first**: on GitHub Actions with `openai/codex-action@v1`, `sandbox: workspace-write`, `safety-strategy: drop-sudo`: can Codex run `git commit` against a git dir that is not `.git` (`GIT_DIR` inside the workspace under another name)? Its result decides the path, recorded in Trajectory.
- **Path A (the spike holds)**: the agent job gives Codex that git dir; the climb protocol and tend's commits are unchanged.
- **Path B (it does not)**: Codex edits the tree and writes `.keel/climb/plan.json` (what changed and why); a keel step after the agent, still in the read-only agent job, commits the tree as one change citing the plan; climb's `compare` and the guards run as today. A Codex climb night keeps at most one change; a tend pass is one commit citing every finding the plan names. The brief and the PR say which path ran.
- **Config**: `"agent": "codex"` stops being a config error on climb and tend; the adapter gains `editTree`.
- **Unchanged**: agent and judge jobs read-only, publish runs nothing from the branch, the guard, the budget, "Did the agent run?".

## Acceptance

- [x] The spike's result is recorded with its run: a Codex step on GitHub committing (or failing to) to a git dir other than `.git` under workspace-write and drop-sudo. `gh run view <id> -R dalmaer/keel --log`
- [ ] With `"agent": "codex"`, keel-climb.yml and keel-tend.yml run Codex's step with `sandbox: workspace-write` and `safety-strategy: drop-sudo`, and every sandbox rule holds as for Claude; mutation: `danger-full-access` fails the test. `tests/workflows.test.mjs`
- [ ] The chosen path's commit step (A: the git dir; B: the plan commit) produces commits the climb and tend guards judge as they judge Claude's, refusing the same things. `tests/climb.test.mjs`
- [ ] ⚑ by hand: one Codex climb night and one Codex tend pass on a project, each PR read by the owner.

## Real surfaces

- Workflow shell: keel-climb.yml and keel-tend.yml running Codex on GitHub Actions.
- Adopted project: the project the owner picks for the Codex nights (keel or ledger).

## Proof

- Automated: `node --test tests/workflows.test.mjs tests/climb.test.mjs tests/tend.test.mjs`, with the mutation above; `npm run check`.
- On GitHub: the spike's run, then one Codex night of each pass.

## Deliberately open

- **Path B's cost**: one change per Codex climb night loses the per-change measurement the protocol is built on. Its effect: a Codex night keeps less than a Claude night. Settled 2026-10-08 by the spike: Path A holds, so Path B is not built.
- **Who pays**: Codex's nights bill the OpenAI API account per token. The Budget line counts minutes, not dollars (phase 45's open question).

## Next action

Brief a builder on Path A: the agent job gives Codex a second git dir (.keel/agent-git) and the climb and tend protocols use it; keel's steps after the agent never trust that git dir's config or hooks.

## Trajectory

- **2026-10-08** — The spike (keel run 37716223683, openai/codex-action@v1, workspace-write, drop-sudo; writable roots: the workdir, /tmp, $TMPDIR): Codex's `git --git-dir=.keel/agent-git commit` exited 0 (de7919f, seen from outside), and `git commit` on `.git` exited 128 (`.git/index.lock: Read-only file system`). Codex protects `.git` by name; Path A holds and Path B is not needed. Two earlier runs failed before Codex ran (an invalid key: 401; then no API credit: quota exceeded), each caught as a failed step.
- **2026-10-08** — A git dir the agent can write can hold config and hooks the agent wrote (core.hooksPath, core.fsmonitor, aliases): keel's steps after the agent must run git with those neutralised, and the judge reads only objects from the bundle.
