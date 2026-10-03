---
status: built
since: 2026-10-02
goal: G1
depends: [2]
note: "goal add|show|retire and phase new|list work; a goal with no phase is allowed and reported by doctor; retired goals stay counted but are never next focus. Cold-start cap raised to 3,200."
evidence: ["evidence/2026-10-02-goals.md"]
---

# A person can say what the project is for, and the work lines up behind it

## Done when

`keel goal add|list|show|retire` edits `docs/goals.json`, regenerates the roadmap, and `keel goal show G1 --json` reports its phases, how many are built and lived-in, and the next one.

## Scope

Goals are outcomes, not dates; progress is derived, never stored. `retire`
needs a reason and keeps the goal visible as retired. `keel phase new --goal G1`
scaffolds a phase from the template under the next free number.

## Acceptance

- [x] Adding a goal with no phase is allowed by the verb but reported by `doctor` until a phase names it.
- [x] Retiring a goal with unbuilt phases asks what happens to them (supersede or move).
- [x] `phase new` picks the next free number even when two branches have added phases (the isocan lessons-number shape).

## Proof

`node --test tests/goal.test.mjs`.

## Deliberately open

- Whether goals carry a horizon ("this quarter"). Still no: not unless a project asks. A date in a goal invites the same lie as an invented `due`.

## Next action

None.

## Trajectory

- **2026-10-02** — A goal with no phases now passes the roadmap; only `keel doctor` reports it. Otherwise `goal add` would break the project's own check. Projects pick this up from v0.1.0 on their next update.
- **2026-10-02** — The agent guide's cold-start cap rose from 2,500 to 3,200 characters. It was set at 7 verbs and there are now 16; its purpose is "one screen". Word lists (`goal list|show|add|retire`) count as announcing each verb.
