---
status: partial
owes: walk
waits: owner
since: 2026-10-16
goal: G0
spec: 2
depends: []
note: "Built 2026-10-16: the conduct skill's brief ends with the restatement and fixes the report's sections in order; its verify step reads the restatement first and refuses a report missing an acceptance box or an exit code. Owes the owner one read of a conducted phase's report."
evidence: ["evidence/2026-10-16-builder-shape.md"]
issue: 172
---

# Builders restate what done means first, and report in one shape

## Done when

The conduct skill has every builder restate the phase's success criteria before it builds, and report in one shape (changes, each acceptance box with its test or why not, the focused test commands the builder ran with their exit codes, decisions the spec left open, what remains), and the conductor's checklist refuses a report missing those exit codes or an acceptance box. The full gate stays the conductor's, run once on the integrated tree, as the skill already says.

## Scope

The design is [Verification: tests that tell right from plausibly wrong](../research/2026-10-16-verification.md), phase 87.

- **Restate first**: the builder's brief ends with "restate the success criteria in your own words before writing code"; a restatement that differs from the phase's Done when is the first thing the conductor reads.
- **One shape**: a fixed report template in the conduct skill, sections in order; the third idea from the 2026-10-11 "software factory" note.
- **The conductor's check**: the skill's verify step lists what to check in the report (every acceptance box addressed; the builder's focused test commands and their exit codes present). The full gate is not the builder's: the conductor runs it once on the integrated tree, after the record, as now.

## Acceptance

- [x] The conduct skill's brief asks for the restatement and the report shape, and its verify step names the checks. `tests/skill.test.mjs`
- [x] The rendered skill in every adopted project carries the same text. `tests/practices.test.mjs`
- [ ] ⚑ by hand: the owner reads one conducted phase's builder report and says whether it read faster.

## Your part

- **Ask:** Read the next builder report a conducted phase produces.
- **Why:** It shows whether one shape makes reports quicker to check.
- **Look at:** the conductor's summary of the next phase.
- **Choices:** Faster to read | No different
- **Takes:** 10 minutes.
- **Then:** No different: the shape is revised.
- **Ready when:** this phase has shipped and one phase has been conducted with it.

## Real surfaces

- Adopted project: the rendered conduct skill.

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/skill.test.mjs tests/practices.test.mjs`; `npm run check`.
By hand: one report read.

## Deliberately open

- **Known limit**: the shape is advice to a model; the conductor's check is what holds it.

## Next action

Land this phase's PR (a practice change: cross-review first); then conduct one phase with the new shape, and the owner reads its builder report and answers with `plates walk done 87 --choice "<choice>"` (Your part).

## Trajectory

- **2026-10-16** — The restatement is section 0 of the report, so a builder run in the background still hands it over before anything else; the brief's last section asks for it before code. The skill has no word budget; the shape replaced the old five-item return list rather than adding to it.
