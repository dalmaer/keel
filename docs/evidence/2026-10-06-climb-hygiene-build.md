# Evidence: phase 36, a flaky test and a slower build are climbed the same way

Against the working tree on `bbd0dcb` (the phase's commit is titled "phase 36: a flaky test and a slower build are climbed the same way"). Built by a subagent; verified by the conductor.

| Did | Observed |
| --- | --- |
| `node --import ./tests/helpers/hermetic.mjs --test tests/climb.test.mjs tests/climb-hygiene.test.mjs tests/improve-climb.test.mjs` | exit 0, 16 tests, 16 pass |
| Read `tests/climb-hygiene.test.mjs` | real `prove-steady` over a synthetic Acme suite (steady only with N passes; one fail at any run is not; an unmatched name is exit 2); a hygiene night that keeps a proven fix and reverts a timeout-only one; the workflow files an issue on its own repo once, only when nothing was proven |
| Builder's mutations, restored | pick without hygiene first; the hygiene check never refusing; the build guard's unexplained list emptied; retirement never retiring: each fails its named test |
| Builder: the three new files five times alongside the whole suite | 16/16 each time (~32 s), and the full suite 409/409 each time |

**The gate:** `npm run check` on the final tree with this record; its result is in the commit body.

**Not done yet:** ⚑ a real hygiene night on keel (needs climb on, and a flaky test named by the ledger) and a build-time night on ledger (phase 37); the owner reads their PRs or issue.

**Docs updated in the same change:** practices/climb/README.md and the job briefs, PROTOCOL.md, practices/night/README.md (build_time), the agent guide's climb topic.
