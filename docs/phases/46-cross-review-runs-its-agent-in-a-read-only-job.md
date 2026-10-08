---
status: partial
owes: walk
waits: external
since: 2026-10-07
goal: G2
spec: 2
depends: [45]
note: "Built: a read-only review job (Claude handed the job's read-only github_token, no id-token; Codex as before) and a publish job with no agent that posts keel's validated findings from the default branch's script. Owes a real review on ledger after the update."
evidence: ["evidence/2026-10-07-cross-review-split.md"]
issue: 32
---

# Cross-review runs its agent in a read-only job, and posts from another

## Done when

keel-cross-review.yml runs the agent (Claude or Codex) in a job whose token can only read, with no OIDC App token, and posts the review from a second job that runs no agent and nothing from the PR's branch; the workflows test holds that for both providers, and a real review on ledger posts its findings as before.

## Scope

The design is [Review hardening](../research/2026-10-07-review-hardening.md), §1.

- **`review` job**: `contents: read`, `pull-requests: read`, no `id-token`; checkout with `persist-credentials: false`; Claude's step handed the job's read-only `github_token` (so the action exchanges no OIDC token); Codex's step as today. The final message and run record leave as an artifact.
- **`publish` job** (`needs: review`; `pull-requests: write`): checks out the default branch, runs its own `cross-review.mjs summary` on the artifact, and posts the COMMENT review. No agent step, no PR-branch code.
- **Unchanged**: the reviewer choice (phase 45), findings as JSON validated against the diff, the budget, "Did the agent run?", the concurrency rule.

## Acceptance

- [x] For each provider, the review job holds no write permission, no `id-token`, no persisted credentials, and Claude's step has `github_token`; the publish job has no agent step and checks out only the default branch; mutation: `pull-requests: write` on the review job fails the test. `tests/workflows.test.mjs`
- [x] The publish job posts exactly what `summary` builds from the artifact (findings, dropped ones named, the self-review line), and nothing when "Did the agent run?" failed. `tests/cross-review.test.mjs`
- [x] Claude's review step with a read-only `github_token` still reads the diff and returns findings (`gh pr diff` works with read): checked on a synthetic run in the test. `tests/cross-review.test.mjs`
- [ ] ⚑ by hand: a real review on ledger after the update posts inline comments from the publish job; the owner reads it.

## Real surfaces

- Workflow shell: keel-cross-review.yml's two jobs on ledger's Actions.
- GitHub API: the COMMENT review posted by the publish job.
- Adopted project: ledger.

## Proof

- Automated: `node --test tests/workflows.test.mjs tests/cross-review.test.mjs`, with the mutation above; `npm run check`.
- On ledger: the next cross-review run, its two jobs and its posted review.

## Deliberately open

- **Claude's comments lose `claude[bot]` as author** for good (they are `github-actions[bot]`'s since phase 45). Its effect: none on the tally, which counts by marker. Settled.
- **A third job for the judge, as climb has**: cross-review runs no code from the branch after the agent, so two jobs are enough; revisit if a step after the agent ever runs branch code.

## Next action

⚑ After the release reaches ledger: its next cross-review runs as two jobs and the publish job posts the review; the owner reads it.

## Trajectory

- **2026-10-07** — Claude's action works with a read-only token: a given `github_token` skips the OIDC exchange, and prompt mode's calls on PR events only read (its actor check needs metadata read). Climb never exercised this: a schedule event skips the actor check, so cross-review is the first to run it read-only on a PR event.
- **2026-10-07** — The which step's outputs (agent, author, reason, minutes) reach publish as job outputs set by keel's own steps, not inside the artifact; the artifact holds only pr.json, pr.diff and the agent's final message.
