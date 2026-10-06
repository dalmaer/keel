# Evidence: phase 32, a phase's spec says how it will be proven

Against the working tree on `779dd63` (the phase's commit is titled "phase 32: a phase's spec says how it will be proven, and an empty one fails the check"). Built by a subagent; verified by the conductor.

| Did | Observed |
| --- | --- |
| On a copy of the tree, `keel phase new "A probe phase left as the template" --goal G3`, then `node scripts/roadmap.mjs --check` | exit 1, naming each section that still holds the template's text (`## Deliberately open`, `## Next action`, `## Trajectory`); with the probe phase removed, exit 0. Before this phase the same probe exited 0, even as `partial` |
| `node --import ./tests/helpers/hermetic.mjs --test tests/roadmap.test.mjs tests/doctor.test.mjs tests/improve.test.mjs tests/improve-records.test.mjs tests/improve-measures.test.mjs tests/improve-selftest.test.mjs` | exit 0, 74 tests, 74 pass |
| Read `tests/roadmap.test.mjs` "spec 2: every acceptance box names its check" | Real `specProblems` against passing and failing boxes: a bare backticked name, a path that only ends in tests/, and a second box naming nothing each fail |
| Builder's mutations (each restored): empty `PLACEHOLDERS`; no spec-2 box rule; no surface-proof rule; `proofs_hold` ignoring cited tests; no doctor note | Each fails a named test (2 roadmap tests; the spec-2 box test; the Real surfaces test; the selftest and the proofs_hold test; the acceptance-unchecked test) |
| `node bin/keel.mjs doctor` on keel | 27 `acceptance-unchecked` notes (phases 00–09, 12, 14–29), exit code unchanged |
| `node scripts/keel/improve.mjs` on keel | `proofs_hold 0 ≤0 ok`; detail says the ledger half is n/a until phase 33 |

**The gate:** `npm run check` on the final tree with this record (tests, roadmap, render, inbox); its result is in the commit body.

**Not done yet:** the Real surface. cajones, taken through `keel fleet update` to the release that carries this, with its own `npm run check:all` green on the update PR (⚑ the owner merges). The phase stays `partial` until then.

**Docs updated in the same change:** README (the phases row), the phases practice README, the night practice README (`proofs_hold`), the conduct skill (brief carries Real surfaces; verify walks one proof per surface), the agent guide's topics.

## Walked at the fleet release (v0.8.0, 6 Oct)

| Did | Observed |
| --- | --- |
| `keel fleet update --yes` (after fixing new-file drift, 64696ea) | cajones#36, duo#63, isocan#403 opened; ledger#55 after documenting two env vars; every PR's checks green (cajones: `npm run check:all` in its Pages workflow) |
| Merged at the owner's instruction ("take the build to all of the users") | all four merged; `keel fleet`: every project on 0.8.0, current, green |
