---
status: planned
since: 2026-10-14
goal: G4
spec: 2
depends: [10, 11]
note: "Specified 2026-10-14: every night writes its plan before it runs (the default plan when nobody shaped it), and each pass ticks its item."
evidence: []
issue: 131
---

# A night has a plan, written before it runs and ticked as it goes

## Done when

Every night has one plan file, written before any pass runs (keel's default plan when the owner did not shape it), every pass that runs that night ticks its item with an outcome, and the health page shows the plan and what became of each item.

## Scope

The design is [Nightwatch: a night with a plan you can shape](../research/2026-10-14-nightwatch.md), "One plan per night".

- **The plan file**: `.keel/night/plan.json`, schema 1, as the design gives it: items (id, title, kind, source, number, lane, budget, status, result), `willNotTouch`, `readyBy`, `settledToday`, `leftOpen`, `shapedBy`. A validator refuses anything else, naming the field.
- **The default plan**: `keel night plan` builds it deterministically from what keel already knows: tonight's measures, the climb job `climb.mjs pick` would choose, the robot's next admissible issue, Loop findings waiting for triage, and the health page's proposal. It spends no model tokens and needs no person.
- **Where it travels**: the plan branch `keel-night-plan` (one file, force-pushed, never merged). The night reads the plan dated for tonight from it, or makes the default plan when there is none.
- **Rules carried in the file**: a `build` item without a `number` is refused (it becomes `triage`); at most five `build` items, counted with the robot's open PRs.
- **Ticking**: `keel night tick <id> --status <s> [--note] [--link]` updates one item; the night ticks its measure items; the passes that build tick theirs (phase 76 wires those).
- **The record**: the night commits the plan as it ended into its data-only PR (`docs/night/<date>.json`), and the health page gains a "Tonight's plan" section.

Not in scope: shaping the plan (phase 74), personas (75), handing build items to climb and the robot (76), the canvas card and the morning message (77).

## Acceptance

- [ ] The plan validator accepts the design's schema and refuses an unknown field, a build item with no number, and a sixth build item, each naming the problem. `tests/night-plan.test.mjs`
- [ ] `keel night plan` makes the same default plan from the same inputs, with the measures, the climb job pick would choose, the robot's next issue and untriaged Loop findings, and writes nothing when any input is unreadable (exit 2, saying which). `tests/night-plan.test.mjs`
- [ ] The night uses tonight's plan from the plan branch when there is one and the default plan when there is none or it is dated for another night, and says which. `tests/night-plan.test.mjs`, `tests/workflows.test.mjs`
- [ ] `keel night tick` changes one item's status with a note and link, and refuses an unknown id or a move back from `done`. `tests/night-plan.test.mjs`
- [ ] The night's PR carries `docs/night/<date>.json`, and the health page shows each item and its outcome. `tests/night-plan.test.mjs`, `tests/improve.test.mjs`
- [ ] ⚑ by hand: the owner reads one real night's plan on keel's health page and says whether it says what the night did.

## Your part

- **Ask:** Open the next morning's health page on keel and read the section "Tonight's plan".
- **Why:** It is the first time a night says what it meant to do and what came of it; this shows whether that reads clearly.
- **Look at:** the newest `keel-night` pull request on keel.
- **Choices:** It says what the night did | It is unclear
- **Takes:** 5 minutes.
- **Then:** Unclear: what was missing goes into the section's wording.
- **Ready when:** this phase has shipped and one night has run.

## Real surfaces

- Workflow shell: keel's own `keel-night` run reads the plan branch and commits `docs/night/<date>.json`.
- Adopted project: the next fleet update carries it to one project's night.

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/night-plan.test.mjs tests/improve.test.mjs tests/workflows.test.mjs`; `npm run check`.
By hand: one real night's page read by the owner.

## Deliberately open

- **The branch, or a dispatch input**: the branch keeps the plan out of `main` and needs no hand-started run. Revisit if pushing a branch from a laptop proves awkward.
- **Known limit**: the default plan only names what keel would do anyway; until phase 76 the passes that build still pick for themselves and only tick.

## Next action

Write the plan schema, its validator and `keel night plan` with `tests/night-plan.test.mjs`.
