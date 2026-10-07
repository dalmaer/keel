# Evidence: phase 44 — a walk owed does not block the next phase, and lived-in is a project's choice

- Date: 2026-10-07
- Phase: 44
- Revision: base e409c2b, working tree (the commit "phase 44: A walk owed does not block the next phase, and lived-in is a project's choice")
- Claim being checked: a partial phase marked `owes: walk` satisfies its dependents' `depends:` and is never next; `owes` is refused off partial or while a buildable box is unchecked; lived-in is off unless a project opts in; `phases_stuck` skips a walk owed.

## Automated checks

- `node --test tests/roadmap.test.mjs tests/improve-measures.test.mjs tests/goal.test.mjs` → exit 0, `ℹ pass 49`, `ℹ fail 0` (conductor).
- Mutation (conductor, copy-restore): `satisfies` back to built/lived-in only → `tests/roadmap.test.mjs` `ℹ fail 1`.
- Mutations (builder, temp copies): `nextPhase` ignoring `owes` fails 3; the `phases_stuck` filter removed fails its test; the buildable-box refusal disabled fails its test.
- `node scripts/roadmap.mjs --check` → "Checked roadmap: 45 phases, 6 goals", with phases 10, 11, 34–38 and 41–43 marked `owes: walk`.
- `node scripts/roadmap.mjs --next` → "13. Keel can show it makes projects better, or find out that it does not [partial]" (a buildable phase; before, the walks blocked their dependents and the conductor worked past `depends:` by hand).
- docs/ROADMAP.md headline: "**33 of 45 phases built; 10 owe a walk.** Built means implemented and checked; planned is not available."
- The gate, `npm run check`, runs after this file; its result is in the commit body.

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| Reworded phases 10 and 11's last boxes as ⚑ steps | they are walks (seven nights passing; the owner's decision), so the walk rule accepts them | accepted by the check | That the rule reads a walk only when the box says so |
| The fleet update carrying it | each project's roadmap check passes | Not run (after the release) | The adopted-project surface |

## Gaps and decision

Partial, owes a walk: the fleet update after the release. ledger keeps its own roadmap.ts (a local variant) and isocan the projects shape, so neither runs this script; duo and cajones do, and their regenerated roadmaps are the proof.
