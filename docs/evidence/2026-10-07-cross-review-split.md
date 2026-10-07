# Evidence: phase 46 — cross-review runs its agent in a read-only job, and posts from another

- Date: 2026-10-07
- Phase: 46
- Revision: base cbc849c, working tree (the commit "phase 46: Cross-review runs its agent in a read-only job, and posts from another")
- Claim being checked: the agent (Claude or Codex) runs in a job whose token only reads, with no OIDC App token; the review is posted by a job that runs no agent and nothing from the PR's branch.

## Automated checks

- `node --test tests/workflows.test.mjs tests/cross-review.test.mjs tests/agents.test.mjs` → exit 0, `ℹ pass 55`, `ℹ fail 0` (conductor).
- Mutation (conductor, copy-restore): the review job's `pull-requests: read` → `write` fails tests/workflows.test.mjs (1).
- Builder: `crossReviewSandboxProblems` for both providers with 25 in-test mutations (id-token, issues write, the old workflow permissions, no github_token, an agent in publish, publish on the PR head, publish with always(), ran set before the check); a stub gh with a read and a write token: the read token reads the PR and diff and its review POST gets 403, only publish's posts; the post equals what summary builds from the same inputs.
- From claude-code-action@v1's source (builder): a given `github_token` skips the OIDC exchange; prompt mode's calls on PR events are reads (the actor's permission needs only metadata read).
- The gate, `npm run check`, runs after this file; its result is in the commit body.

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| A real review on ledger after the update | two jobs; the review posted by publish | Not run (after the release and ledger's update) | The workflow shell and GitHub API surfaces |

## Gaps and decision

Partial, owes a walk: ledger's next cross-review on the split workflow. No YAML linter on this machine: the workflow was checked by the text tests (bash -n, node --check on run blocks, the expression evaluator on if: and concurrency).
