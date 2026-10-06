# Evidence: phase 37, a project's own benchmark, its lessons and its Loop findings are climbed

Against the working tree on `131ef70` (the phase's commit is titled "phase 37: a project's own benchmark, its lessons and its Loop findings are climbed overnight"). Built by a subagent; verified by the conductor.

| Did | Observed |
| --- | --- |
| `node --import ./tests/helpers/hermetic.mjs --test tests/climb.test.mjs tests/distill.test.mjs tests/workflows.test.mjs` | exit 0, 51 tests, 51 pass, including "perf: …", "lessons: …" and "loop: …" |
| Builder's mutations, restored byte for byte | perf: `better` flipped, or read from the static table; lessons: propose editing the table, the guard's table check removed; loop: the decided-tonight and decided-finding-changed checks removed; workflows: `loop.mjs decide` or `loop.mjs *` in the agent's tools: each fails its test |

**The gate:** `npm run check` on the final tree with this record; its result is in the commit body.

**Not done yet:** ⚑ ledger's climb config and token at the fleet release, a one-number perf command, and one owner-read night of each job on ledger.

**Docs updated in the same change:** practices/climb/README.md, jobs/perf.md, jobs/lessons.md, jobs/loop.md, PROTOCOL.md, the agent guide's climb topic.
