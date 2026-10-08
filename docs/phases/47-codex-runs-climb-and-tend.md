---
status: partial
owes: walk
waits: external
since: 2026-10-08
goal: G4
spec: 2
depends: [45, 46]
note: "Built (Path A): Codex runs climb and tend with workspace-write and drop-sudo, TMPDIR pinned to /tmp/keel-codex, commits to .keel/agent-git; keel takes only objects from that git dir (no git command reads it) into a fresh repo, then the judge and publish jobs as before. Owes one real Codex night of each pass, read by the owner."
evidence: ["evidence/2026-10-08-codex-climb-tend.md"]
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
- [x] With `"agent": "codex"`, keel-climb.yml and keel-tend.yml run Codex's step with `sandbox: workspace-write` and `safety-strategy: drop-sudo`, and every sandbox rule holds as for Claude; mutation: `danger-full-access` fails the test. `tests/workflows.test.mjs`
- [x] The chosen path's commit step (A: the git dir; B: the plan commit) produces commits the climb and tend guards judge as they judge Claude's, refusing the same things. `tests/climb.test.mjs`
- [ ] ⚑ by hand: one Codex climb night and one Codex tend pass on a project, each PR read by the owner.

## Your part

- **Ask:** Read the pull request from one climb night and one tend pass that Codex ran on one of your projects, and say whether each is work you would accept from Claude.
- **Why:** It shows Codex can do the scheduled improvement and record-tidying work under the same locks as Claude, so a project can choose either agent.
- **Look at:** The two pull requests (on `keel-climb/…` and `keel-tend/…` branches) and, in each run, the "Take Codex's commits, objects only" step.
- **Choices:** Both held | Something was wrong | Not run yet
- **Keeps it open:** Something was wrong | Not run yet
- **Takes:** 20 minutes, once both have run; each run bills the OpenAI API account per token, up to its minutes budget
- **Then:** Both held: recorded, and the conductor writes the evidence and marks the work done. Something was wrong: recorded with what you saw in the note; the conductor fixes it and asks again. Not run yet: nothing changes.
- **Ready when:** you have set `"agent": "codex"` on `climb` and on `tend` in a project's `.keel/keel.json` (keel or ledger), listed `codex` in `"agents"`, set the `OPENAI_API_KEY` secret, and one Codex climb night and one Codex tend pass have run

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

⚑ Owner: set `"agent": "codex"` on climb and tend in a project (with codex in `"agents"` and OPENAI_API_KEY set), then read the first Codex night's PRs.

## Trajectory

- **2026-10-08** — The spike (keel run 37716223683, openai/codex-action@v1, workspace-write, drop-sudo; writable roots: the workdir, /tmp, $TMPDIR): Codex's `git --git-dir=.keel/agent-git commit` exited 0 (de7919f, seen from outside), and `git commit` on `.git` exited 128 (`.git/index.lock: Read-only file system`). Codex protects `.git` by name; Path A holds and Path B is not needed. Two earlier runs failed before Codex ran (an invalid key: 401; then no API credit: quota exceeded), each caught as a failed step.
- **2026-10-08** — A git dir the agent can write can hold config and hooks the agent wrote (core.hooksPath, core.fsmonitor, aliases): keel's steps after the agent must run git with those neutralised, and the judge reads only objects from the bundle.
- **2026-10-08** — Built on Path A. keel never runs a git command against the agent's git dir: the take copies regular object files and reads the branch's ref as a file into a fresh repo, so hooks, fsmonitor, aliases or include.path Codex could plant there never run. TMPDIR is pinned on every Codex step, so its writable /tmp root can never be the runner's command-file folder.
- **2026-10-08** — On a Codex night compare's worktrees go to the OS temp (the checkout's parent is outside Codex's writable roots), so a gate reading a sibling folder (ledger's ../ledger-data) fails there: a Codex night suits a project whose gate is self-contained.
