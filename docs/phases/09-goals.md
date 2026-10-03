---
status: planned
since: 2026-10-02
goal: G1
depends: [2]
note: "goals.json and goal-derived progress already work in the roadmap generator; no verbs yet."
evidence: []
---

# A person can say what the project is for, and the work lines up behind it

## Done when

`keel goal add|list|show|retire` edits `docs/goals.json`, regenerates the roadmap, and `keel goal show G1 --json` reports its phases, how many are built and lived-in, and the next one.

## Scope

Goals are outcomes, not dates; progress is derived, never stored. `retire`
needs a reason and keeps the goal visible as retired. `keel phase new --goal G1`
scaffolds a phase from the template under the next free number.

## Acceptance

- [ ] Adding a goal with no phase is allowed by the verb but reported by `doctor` until a phase names it.
- [ ] Retiring a goal with unbuilt phases asks what happens to them (supersede or move).
- [ ] `phase new` picks the next free number even when two branches have added phases (the isocan lessons-number shape).

## Proof

`node --test tests/goal.test.mjs`.

## Deliberately open

- Whether goals carry a horizon ("this quarter"). Not unless a project asks; a date in a goal invites the same lie as an invented `due`.

## Next action

Make the roadmap's `--json` output the contract `goal show` reads, and test it.
