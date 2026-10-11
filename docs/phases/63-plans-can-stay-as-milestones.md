---
status: partial
since: 2026-10-10
owes: walk
goal: G2
spec: 2
depends: [51]
note: "Read-only milestone plans now feed next, status, the board and the installed night through shared cache/quota controls. Automated and live empty-source transport proofs passed; one real release and its owner read remain owed."
evidence: ["evidence/2026-10-10-milestone-plans.md"]
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

- [x] Milestones with descriptions and issues map to phases: Done when, boxes, walks, `due` and status, as above. `tests/milestones.test.mjs`
- [x] `keel next`, the board and the night use them on a project with `source: milestones`, through the cache and the quota floor; nothing is written to GitHub. `tests/board.test.mjs`
- [x] Adopt proposes `source: milestones` for a project with described milestones. `tests/adopt.test.mjs`, `tests/milestone-integration.test.mjs`
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

Automated: `node --test tests/roadmap.test.mjs tests/board.test.mjs tests/adopt.test.mjs tests/milestones.test.mjs tests/milestone-integration.test.mjs tests/milestone-read-context.test.mjs tests/milestone-surfaces.test.mjs tests/milestone-review.test.mjs tests/milestone-consumer-corrections.test.mjs tests/phase63-consumers.test.mjs tests/phase63-climb-loop.test.mjs tests/phase63-late-findings.test.mjs tests/migrations-phase-guard-reach.test.mjs`; `npm run check`.
By hand: one release on the board.

## Deliberately open

- **Other planning writers — settled 2026-10-11:** Loop collection remains available, but local phase-homing, its climb job and local rendered plan checks are inactive for milestone plans. Proof runs remain available without phase-evidence writeback. A future milestone-aware triage workflow must be designed explicitly; archived local plans are never a fallback.

- **Deadline semantics — settled 2026-10-10:** A milestone due date is `due`, not `after`. Keel defines `after` as the earliest buildable date; the original mapping would hide active work until its deadline. Closing a milestone reports GitHub planning state, never production verification, owner acceptance or lived-in evidence.
- **Incomplete reads — settled 2026-10-10:** Bounded queries reserve separate allowances for open milestones and closed history, and disclose truncated milestone, issue and label coverage. Unavailable or incomplete source data must not report that all work is done.

- **Exit criteria in prose — settled 2026-10-10:** An Exit criteria section takes precedence, then a bullet list, then the whole description. The board discloses the whole-description fallback; mapping tests cover each form.

## Next action

Owner: select a project with a GitHub milestone release, adopt the proposed read-only source and spend 10 minutes checking that its board reads as the plan. Keel, Ledger, isocan and duo currently have no milestones, so no pilot or acceptance is claimed.

## Trajectory

- **2026-10-10** — A milestone deadline cannot become `after`: doing so hides work until its due date. The projection uses `due` and keeps source closure separate from acceptance.
- **2026-10-10** — GitHub's `updatedAt` does not measure time in a status. The night leaves status age unavailable instead of treating unrelated edits as progress.
- **2026-10-10** — A failed GraphQL response can still charge quota, including when `gh` exits nonzero. Accounting precedes projection validation; cache keys hash the configured owner label to prevent different labels sharing a walk projection.
- **2026-10-10** — Review found that closed history could consume the entire milestone bound. Open milestones now have a separate 50-record allowance; a separate 20-record recent-history allowance cannot hide active work.

- **2026-10-10** — Source selection governs migrations and dormant ownership as well as reads. Archived plans stay untouched, and disabled managed files retain hashes so returning to file plans cannot overwrite intervening edits. Milestone adoption leaves the file-based conductor off. The selected source also takes precedence over a retained local shape.

- **2026-10-11** — Ownership is unknown when issue or label pagination can hide an owner gate. Invalid source settings fail before reads or writes; board refresh shares its root planning read rather than spending quota twice.

- **2026-10-11** — Source selection also gates Loop triage, its climb job and proof evidence writes. Installed gates preserve archival views; night proposals name GitHub milestones. Guarded reads sharing a cache are ordered within one process so concurrent fleet reads cannot all use the same pre-query balance.

- **2026-10-11** — A goals-only or legacy milestone file is already a local plan. Quota protection is an unavailable observation, not a broken instrument. Phase-test repair has its own migration identity so CI/night work performed under milestones cannot consume the later return-to-files repair.
