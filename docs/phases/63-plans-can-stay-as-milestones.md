---
status: planned
since: 2026-10-09
goal: G2
spec: 2
depends: [51]
note: "A project that plans with GitHub milestones (named for their ambition, with exit criteria) has no phase files, so adopt turns phases off, and keel next, the board and the night see no plan. keel reads a milestone's exit criteria as a phase's Done when, and its issues as the work, without rewriting the project's plans. Design: research/2026-10-09-adopting-projects-that-ship-to-main.md."
evidence: []
issue: 50
---

# Plans can stay as milestones

## Done when

On a project with `"phases": { "source": "milestones" }`, `keel next`, the board and the night read its open GitHub milestones as phases (the milestone's description as Done when, its issues as acceptance boxes, its deadline as `due`, without postponing work, closed when the milestone closes); nothing is written into the project's plans; and one real project's plan shows on the board this way for a release.

## Scope

The design is [Adopting projects that already have a practice](../research/2026-10-09-adopting-projects-that-ship-to-main.md), change 6.

- **The reader**: one GraphQL read per night or board refresh (milestones with their issues, bounded and priced as the board's reads are (lib/quota.mjs)), through the 10-minute cache and the quota floor.
- **The mapping**: title → title; description's exit criteria (a bullet list, or a section headed "Exit criteria") → Done when; open issues → unchecked boxes and closed ones → checked; an issue labelled for the owner (configurable) → a walk; due date → `due` (a deadline, never a not-before date); state → status (open with closed issues → partial).
- **Read-only**: keel never edits milestones or issues; converging to phase files remains a migration the owner may accept.
- **Adopt**: detects milestones with descriptions and proposes `source: milestones` instead of turning phases off.

## Acceptance

- [ ] Milestones with descriptions and issues map to phases: Done when, boxes, walks, `due` and status, as above. `tests/roadmap.test.mjs`
- [ ] `keel next`, the board and the night use them on a project with `source: milestones`, through the cache and the quota floor; nothing is written to GitHub. `tests/board.test.mjs`
- [ ] Adopt proposes `source: milestones` for a project with described milestones. `tests/adopt.test.mjs`
- [ ] ⚑ by hand: one project's release seen on the board as phases, read by its owner.

## Your part

- **Ask:** Look at one project's milestones shown as keel phases on the board, and say whether they read as the plan you have.
- **Why:** It decides whether keel can plan with a project as it is, without converting its plans.
- **Look at:** The board, filtered to that project.
- **Choices:** Reads right | Something is lost
- **Takes:** 10 minutes.
- **Then:** Reads right: the phase is built. Something lost: the mapping changes, and the loss goes into the evidence.
- **Ready when:** a project that plans with milestones has adopted keel.

## Real surfaces

- GitHub API: milestones and their issues.
- Adopted project: one that plans with milestones.

## Proof

Automated: `node --test tests/roadmap.test.mjs tests/board.test.mjs tests/adopt.test.mjs`; `npm run check`.
By hand: one release on the board.

## Deliberately open

- **Deadline semantics — settled 2026-10-10:** A milestone due date is `due`, not `after`. Keel defines `after` as the earliest buildable date; the original mapping would hide active work until its deadline. Closing a milestone reports GitHub planning state, never production verification, owner acceptance or lived-in evidence.
- **Incomplete reads — settled 2026-10-10:** Bounded queries disclose truncated milestone, issue and label coverage. Unavailable or incomplete source data must not report that all work is done.

- **Exit criteria in prose**: not every description lists them. Without a list, the whole description is the Done when, and the board says so.

## Next action

Build the bounded read-only milestone adapter, then walk a real milestone project with its owner.
