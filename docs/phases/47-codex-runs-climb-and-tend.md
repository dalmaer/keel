---
status: planned
since: 2026-10-07
goal: G4
spec: 2
depends: [45, 46]
note: "Codex cannot commit under workspace-write (.git read-only), and climb and tend are built on the agent's commits. A spike settles whether a git dir under another name is writable to Codex; otherwise the workflow commits a plan Codex writes. Design: research/2026-10-07-review-hardening.md §2."
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

- [ ] The spike's result is recorded with its run: a Codex step on GitHub committing (or failing to) to a git dir other than `.git` under workspace-write and drop-sudo. `gh run view <id> -R dalmaer/keel --log`
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

- **Path B's cost**: one change per Codex climb night loses the per-change measurement the protocol is built on. Its effect: a Codex night keeps less than a Claude night. Settled by the spike: Path B only if A is impossible.
- **Who pays**: Codex's nights bill the OpenAI API account per token. The Budget line counts minutes, not dollars (phase 45's open question).

## Next action

Run the spike: a throwaway workflow on keel (dispatch only) running openai/codex-action with workspace-write and drop-sudo, asked to commit to a GIT_DIR under the workspace that is not `.git`; record the run.
