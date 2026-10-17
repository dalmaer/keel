# Evidence: phase 87 — builders restate what done means first, and report in one shape

- Date: 2026-10-16
- Phase: 87
- Revision: base commit 70c429e and working tree (the phase's commit, "phase 87: Builders restate what done means first, and report in one shape")
- Claim being checked: the conduct skill's brief asks the builder to restate the success criteria before code and to report in a fixed shape, its verify step reads the restatement first and refuses a report missing an acceptance box or a focused command's exit code, and every rendered copy carries the same text.

## Automated checks

- `node scripts/render.mjs --self --check` before the render: exit 1, `update  .agents/skills/conduct/SKILL.md (conduct)`; after `node scripts/render.mjs --self`: `Rendered 83 practice targets: 9 kept, 73 same, 1 update`, exit 0.
- `node --import ./tests/helpers/hermetic.mjs --test tests/skill.test.mjs tests/practices.test.mjs`: exit 0, `ℹ pass 31` / `ℹ fail 0` (before the practices.test.mjs assertion below was added; rerun in the gate).
  - `tests/skill.test.mjs` "the conduct skill's brief asks for the restatement and the report shape, and its verify step names the checks": the brief template ends with `## Before any code` and the restatement; the return list has sections 0 to 5 in order (restatement, what changed, each acceptance box, focused tests with exit codes, decisions left open, what remains); the brief still forbids the whole check; §2 opens with **Read the report's shape first.** (restatement first, every box, every exit code, sent back down if missing, the whole check stays in §3), before `git pull --ff-only`; keel's own rendered copy carries it.
  - `tests/practices.test.mjs` "a render into an empty directory, plus one phase, passes its own npm run check": the Acme project's rendered conduct skill carries the restatement, section 0 and the verify rule.
  - `tests/practices.test.mjs` "each shipped structural guide and conduct rule carries its cause": the new bold rule carries its `(why: …)`.
- The whole gate, `npm run check` (tests, roadmap, render and inbox guards), runs after this record; its result line is in the commit body.

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| The owner reads one conducted phase's builder report (⚑) | It reads faster, or no different | Not run | Whether one shape makes reports quicker to check |

## Gaps and decision

The shape is advice to a model (Deliberately open); the conductor's check is what holds it, and no conducted phase has used it yet. The ⚑ read waits for the owner: status `partial`, `owes: walk`.
