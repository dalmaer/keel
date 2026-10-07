# Evidence: phase 43 — each budgeted pass shows what it used

- Date: 2026-10-07
- Phase: 43
- Revision: base 18f4bb8, working tree (the commit "phase 43: Each budgeted pass shows what it used, and says when to extend or shorten")
- Claim being checked: the night's Budget line reads each budgeted pass's agent-step minutes from GitHub's record of its runs, marks the runs that ran out, skips runs whose agent never started, and suggests extend, shorten to N, hold or too few to say.

## Automated checks

- `node --test tests/improve-budget.test.mjs tests/workflows.test.mjs` → exit 0, `ℹ pass 31`, `ℹ fail 0` (conductor).
- Mutation (conductor, copy-restore): `ranOut` without `cancelled`/`timed_out` → `tests/improve-budget.test.mjs` `ℹ fail 1`.
- Mutation (conductor, copy-restore): keel-tend.yml's agent step renamed "Tend the repo" → `tests/workflows.test.mjs` `ℹ fail 3` (the map test and two older tend tests).
- Mutation (builder, temp copy): deleting the skip for a failed "Did the agent run?" step → 2 tests fail.
- The gate, `npm run check`, runs after this file; its result is in the commit body.

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| `readBudget` (keel's rendered scripts/keel/improve.mjs) on keel's own .keel/keel.json, against GitHub | an entry for tend and climb from their real runs | `Budget: tend 2 of 30 min (last 1 run; too few to say) · climb 3, 0 of 45 min (last 2 runs; too few to say)` | The GitHub API surface: the real runs and jobs are read and the never-started climb runs (37528477651, 37522297684) skipped; not the night on GitHub |
| Read keel's climb runs' steps | the agent step's conclusion says whether the agent started | Climb `success` in 16–17 s with "Did the agent run?" `failure` | Why the skip reads the check step, not the agent step |

## Gaps and decision

Partial. Not yet walked: the night on GitHub writing the line (after the commit), and the owner's read after four or more tend runs (weeks). One counted run, 37519559575 (climb, 17 s), predates the "Did the agent run?" step and was very likely the same failure; it ages out after eight newer runs.
