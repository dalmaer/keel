# Evidence: phase 41, every review comment is validated and answered

Against the working tree on `779bef4` (the phase's commit is titled "phase 41: every review comment is validated and answered: none goes unread"). Built by a subagent; verified by the conductor.

| Did | Observed |
| --- | --- |
| `node --import ./tests/helpers/hermetic.mjs --test tests/review.test.mjs tests/skill.test.mjs tests/improve.test.mjs` | pass (review 10/10: read, unreadable is exit 2, wait and its timeout, close in three forms, not a gate; skill 9/9; two `reviews_unanswered` tests) |
| Builder's mutations | an unreadable read returning 0; `--not-valid` with no reason; `--gate` passing with an unanswered comment; an unknown `review:` value: each fails |
| `keel review dalmaer/ledger#55` and `#58` (real GitHub, read only) | exit 0, every comment answered (the conductor's replies of 6 Oct); a PR that doesn't exist, or no gh, exits 2 |
| `npm run check` on the integrated tree (phase 41, the v0.8.3 test-ledger fixes, the guides) | exit 0, 518 tests |

**Not done yet:** ⚑ the next fleet release with every reviewer comment validated and answered; Codex named as reviewer in ledger, duo and cajones; ledger's 27 earlier unanswered comments answered.

**Docs updated in the same change:** README (the verb row), the agent guide (cold start 3,190/3,200 and a `review` topic), the conduct skill and its AGENTS block, the climb and tend briefs, the night and phases practice READMEs, docs/guide/reviews-and-prs.md.
