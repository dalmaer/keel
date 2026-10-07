---
status: partial
since: 2026-10-06
goal: G2
spec: 2
depends: [39, 41]
note: "Built: the optional cross-review practice (keel-cross-review.yml, REVIEW.md, scripts/keel/cross-review.mjs): same-repo PRs on configured prefixes and a person's /review, read-only tools plus inline comments, a COMMENT summary, budgeted, green with no secret, red when the agent fails to start. Waits on the owner switching it on for ledger and reading its first review."
evidence: ["evidence/2026-10-06-cross-review.md"]
issue: 24
---

# Claude reviews what Codex writes, the way Codex reviews what Claude writes

## Done when

On ledger, a Codex PR (a `codex/` branch) opened after the practice is switched on gets a Claude review within its budget: inline comments tagged P1/P2/P3, each about something the code shows, and a summary; Claude never pushes, approves or merges; and the owner has read that review and judged its comments.

## Scope

The design is [Cross-review](../research/2026-10-06-cross-review.md).

- **The practice `cross-review`** (optional): `keel-cross-review.yml`, `.agents/cross-review/REVIEW.md`, the claude practice's two secrets declared for it; until one is set, the run ends green with a notice.
- **Config**: `"crossReview": { "for": [prefixes], "budget": { "minutes": N } }`, validated; no key, no reviews.
- **Triggers**: `pull_request` opened and ready_for_review on a matching head branch; an issue comment `/review` from a person with write access on such a PR. Never on the PR's own pushes, never on a branch that doesn't match.
- **The review**: claude-code-action with the brief and the project's context (AGENTS.md, its lessons, docs/keel-lessons.md, the cited phase); inline comments with P1/P2/P3 and a summary review posted as COMMENT. Tools: read-only (Read, Grep, Glob, `gh pr diff`, `gh pr view`) plus the inline-comment and PR-comment tools. No push, no approve, no merge, no request-changes.
- **The rule**: the brief says validate before writing a comment, and no style nits.
- **Measured**: `cross_review_valid` on the night once ten reviewed comments have been answered: the share answered valid (phase 41's replies), recorded, no bound.

## Acceptance

- [x] The workflow runs only for matching head branches and for `/review` from a person with write access; a non-matching branch, a fork, or a bot's `/review` does nothing. `tests/workflows.test.mjs`
- [x] The agent's tools include no push, merge, approve or request-changes, and no Bash beyond `gh pr diff`/`gh pr view`; its review event is COMMENT; mutation: allowing `gh pr merge` fails the test. `tests/workflows.test.mjs`
- [x] Config validation: unknown keys, an empty prefix list, a budget outside 5–60 minutes are errors; no `crossReview` key, the workflow ends at its first step. `tests/cross-review.test.mjs`
- [x] With no secret, the run ends green with a notice; with an agent that fails to start, the run is red and prints only the error line (phase 35's check). `tests/cross-review.test.mjs`
- [ ] ⚑ by hand: the owner switches cross-review on for ledger; the next `codex/` PR is reviewed; the owner reads the review and judges its comments.

## Real surfaces

- Workflow shell: keel-cross-review.yml on GitHub Actions, run for real on ledger.
- GitHub API: inline comments and a COMMENT review on a real PR.
- Adopted project: ledger, switched on through its config with CLAUDE_CODE_OAUTH_TOKEN already set.

## Proof

- Automated: `node --test tests/cross-review.test.mjs tests/workflows.test.mjs`, with the mutation above; `npm run check`.
- By hand: one real Codex PR on ledger reviewed, its review read by the owner.
- ⚑ Switching it on spends model tokens per reviewed PR, within the budget; ledger's secret is set.

## Deliberately open

- **Re-review on new pushes.** Not by default (cost); `/review` asks again. Settled after a few weeks of use.
- **Codex answering Claude's comments.** Codex's own behaviour; keel's night counts unanswered comments whoever reviewed.

## Next action

⚑ Owner: switch cross-review on for ledger (`"practices"` gains `cross-review`, and `"crossReview": {"for": ["codex/"], "budget": {"minutes": 15}}` in its `.keel/keel.json`, through an update PR); each reviewed PR spends model tokens within that budget. Then read the first `codex/` PR's review and judge its comments.

## Trajectory

- **2026-10-06** — The prefix is checked in the workflow's `which` step, not the job's `if:`, because prefixes live in the project's config; the job's `if:` holds the rest (same repo, not draft, a person with write access, no bot), evaluated on synthetic events in the test.
- **2026-10-06** — The review event is the script's, never the agent's: the summary is posted by a step as COMMENT, so the review can never approve; the summary therefore carries `github-actions[bot]`'s name, and the inline comments the action's.
- **2026-10-06** — `cross_review_valid` is built but not in the night's MEASURES: an unbounded measure can never be outside, so the night's selftest (lesson 6) refuses it. Wired when ten answered cross-review comments exist, with a bound or a recorded-only selftest rule decided then.
