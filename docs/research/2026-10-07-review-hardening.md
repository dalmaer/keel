# Three follow-ups to agent providers: a split review, Codex on climb and tend, and a review before release

The owner, 2026-10-07, approved three follow-ups to phase 45 and asked for a
phase each.

## 1. Cross-review in two jobs (phase 46)

**Today**: keel-cross-review.yml is one job holding `pull-requests: write`,
`issues: write` and `id-token: write`, with the agent step inside it. Codex
is contained by its read-only, no-network sandbox and a blanked GH_TOKEN;
Claude by read-only tools. But the job's token can write, and Claude's
action, given no `github_token`, exchanges OIDC for its App token with
write rights: the agent's process could reach a credential that comments,
labels or closes.

**The shape** (as climb and tend since 10c59b5):

- **`review` job**: `contents: read`, `pull-requests: read`; no `id-token`;
  checkout without persisted credentials; Claude's action handed the job's
  read-only `github_token`, Codex's as today. Its output (the agent's final
  message and run record) leaves as an artifact.
- **`publish` job** (`needs: review`, `pull-requests: write`, no agent):
  checks out the default branch, runs the default branch's
  `cross-review.mjs summary` on the artifact (findings validated against the
  diff, as today), and posts the COMMENT review. It runs nothing from the
  PR's branch and no agent.
- Findings stay data; the posting step is the only writer.

**Judged by**: the workflows test holds "no write in the agent's job, no agent
in the writing job" for both providers (as `agentSandboxProblems` does for
climb and tend), and a real review on ledger posts as before.

## 2. Codex runs climb and tend (phase 47)

**The block** (phase 45): under `workspace-write`, Codex keeps `.git`
read-only, so the agent cannot `git commit`, and climb's protocol (one change
per commit, `compare --decide` keeps or resets it) and tend's guard (commits
citing findings) are built on the agent's commits. `danger-full-access` is
refused.

**Two ways through, settled by a spike before building:**

- **A git dir Codex may write**: the agent job gives Codex a worktree whose
  git dir lies inside the workspace under another name (`GIT_DIR` pointing at
  e.g. `.keel/agent-git`), if Codex's sandbox protects `.git` by name only.
  Then the protocol is unchanged. The spike checks it on GitHub, with
  `drop-sudo`, before anything depends on it.
- **The workflow commits for Codex**: Codex edits the tree and writes a plan
  (`.keel/climb/plan.json`: what each change is and why, in order); a keel
  step outside the agent commits the tree as one change and runs `compare`
  and the guard. Climb loses "one change at a time, measured each" (one
  change a night for Codex), tend loses per-finding commits (one commit
  citing every finding the plan names).

The first is preferred if the spike holds; the second is the fallback, and
the brief says which a night ran under. Either way the three-job sandbox,
the guard, the judge and the publish job are unchanged.

**Judged by**: one Codex climb night and one Codex tend pass on a project, each
PR read by the owner; the guard held both.

## 3. A review before the fleet sees a release (phase 48)

**The cost**: v0.8.12 to v0.8.19 each drew new findings from Codex on the
fleet update PRs, in code written that day. Each round meant fixing, a new
release and a new fleet round: four projects' PRs, CI and reviews each time.

**The shape**: keel's own changes to shipped practice files land through a
PR on keel before `keel release` runs, reviewed by a provider other than the
one that wrote them (keel's own cross-review, Claude's work reviewed by
Codex, phase 45's rule). `keel release` refuses (exit 1, naming the PR) while
a practice change since the last release has not been through a reviewed PR
whose comments are all answered (`keel review --gate`). The conductor's
skill says so. The fleet then sees a release whose new code has already had
one review.

**Measured**: the night's record (or a short evidence table) of findings per
fleet update round, before and after; the rule earns its keep if fleet
rounds with findings fall.

**Judged by**: three releases through the gate; the owner compares the fleet
rounds' findings with the eight before.
