# Evidence: phase 42 — Claude reviews what Codex writes, read-only and comment-only

- Date: 2026-10-06
- Phase: 42
- Revision: base f3c317d, working tree (the commit "phase 42: Claude reviews what Codex writes, the way Codex reviews what Claude writes")
- Claim being checked: the cross-review practice runs only for matching, same-repo PRs and a person's `/review`; its agent can read and comment, never push, approve or merge; it validates its config; with no secret it is green, and an agent that fails to start is red.

## Automated checks

- `node --test tests/cross-review.test.mjs tests/workflows.test.mjs` → exit 0, `ℹ pass 30`, `ℹ fail 0` (run by the conductor).
- Mutation, by the conductor on a copy-restore of the workflow: adding `Bash(gh pr merge:*)` to the agent's `--allowedTools` → `ℹ fail 3`; restored byte-identical.
- Mutations, by the builder on temp copies, each exit 1: the review event set to `APPROVE`; "Did the agent run?" made continue-on-error; the fork check removed from `which`. The job's `if:` is evaluated on synthetic Acme events (fork, draft, bot, no write access), each guard mutation-checked.
- `node scripts/render.mjs --self --check` → exit 0, "Checked 54 practice targets: 8 kept, 46 same".
- Builder: `keel init --with cross-review` on an Acme project, its `npm run check` exit 0 and `keel doctor` "Clean".
- The gate, `npm run check` (every test, render check, roadmap check), runs after this file; its result is in the commit body.

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| Read the workflow's review steps | the after-checks run from the default branch's copy; the PR head is checked out only for reading, without credentials | `$RUNNER_TEMP/keel/scripts/keel/cross-review.mjs` judges; checkout has `persist-credentials: false`; agent tools Read, Grep, Glob, `gh pr diff`/`gh pr view`, inline comment | The shape; not the run |
| A real Codex PR on ledger reviewed | inline P1/P2/P3 comments and a COMMENT review | Not run (⚑: the owner switches it on for ledger) | — |

## Gaps and decision

Partial. Unwalked: all three real surfaces (the workflow on ledger's Actions, the comments through the GitHub API, ledger itself). Unverified there: whether claude-code-action exposes its inline-comment tool with a `prompt` on pull_request and issue_comment events, and whose name the inline comments carry (`claude[bot]` only with the Claude GitHub App installed); the summary review is posted as `github-actions[bot]`.

`cross_review_valid` is built and tested (`crossReviewTally`, `CROSS_REVIEW_VALID`) but not in the night's MEASURES: a measure with no bound can never be outside, and the night's selftest (lesson 6) refuses a measure that is not outside on the unhealthy fixture. Wiring waits for ten answered cross-review comments to exist.

## The owner's judgment (2026-10-07)

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| A real codex/ PR reviewed by Claude on ledger (ledger#92, Codex switching tend on) | inline P1/P2/P3 comments and a COMMENT review | Run 37637421414: one inline P2 (claude[bot]) and a summary; the P2 (the tend agent could push with a write token) was valid and fixed in 10c59b5 | The workflow shell and GitHub API surfaces, on ledger |
| The owner judged that review's comment | valid or not | The owner: "good" — valid, as the conductor had found | The by-hand box |
