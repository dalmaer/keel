# Evidence: phase 30, each project reads the lessons that apply to its stack

Against the working tree on `b6362a4` (the phase's commit is titled "phase 30: each project reads the lessons that apply to its stack"). Built by a subagent; the release scope fix by the conductor; verified by the conductor.

| Did | Observed |
| --- | --- |
| `node --import ./tests/helpers/hermetic.mjs --test tests/stacks.test.mjs tests/lessons.test.mjs tests/doctor.test.mjs tests/adopt.test.mjs tests/package.test.mjs` | exit 0, 66 tests, 66 pass |
| Builder's mutations (each in a scratch copy) | a filter that drops untagged rows; a fingerprint including the Where cell; stack-evidence silent when declared ≠ detected; docs/lessons.md dropped from package `files`; an unknown catalogue tag let through: each fails |
| keel's own `docs/keel-lessons.md` | generated; stack `node`, `github-actions`; 56 of 56 rows (all universal until phase 31 tags them) |
| `node bin/keel.mjs doctor` on keel | no stack finding |
| `node --import ./tests/helpers/hermetic.mjs --test tests/release.test.mjs` after adding docs/lessons.md to the release scope | exit 0, 9 pass; with docs/lessons.md removed from `SCOPE`, the lessons-only release case fails |

**The gate:** `npm run check` on the final tree with this record; its result is in the commit body.

**Not done yet:** ⚑ ledger and isocan declare their stacks through the fleet release, and their views are read against their stacks.

**Docs updated in the same change:** practices/lessons/README.md and AGENTS block (names docs/keel-lessons.md), README.md, the agent guide (the release scope; lessons topic).
