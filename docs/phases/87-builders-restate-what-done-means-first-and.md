---
status: planned
since: 2026-10-16
goal: G0
spec: 2
depends: []
note: "Specified 2026-10-16: builders restate the success criteria first and report in one shape the conductor checks."
evidence: []
issue: 172
---

# Builders restate what done means first, and report in one shape

## Done when

The conduct skill has every builder restate the phase's success criteria before it builds, and report in one shape (changes, each acceptance box with its test or why not, the gate's exit code, decisions the spec left open, what remains), and the conductor's checklist refuses a report missing the gate's exit code or an acceptance box.

## Scope

The design is [Verification: tests that tell right from plausibly wrong](../research/2026-10-16-verification.md), phase 87.

- **Restate first**: the builder's brief ends with "restate the success criteria in your own words before writing code"; a restatement that differs from the phase's Done when is the first thing the conductor reads.
- **One shape**: a fixed report template in the conduct skill, sections in order; the third idea from the 2026-10-11 "software factory" note.
- **The conductor's check**: the skill's verify step lists what to check in the report (gate exit code present and 0 before commit; every acceptance box addressed).

## Acceptance

- [ ] The conduct skill's brief asks for the restatement and the report shape, and its verify step names the checks. `tests/skill.test.mjs`
- [ ] The rendered skill in every adopted project carries the same text. `tests/practices.test.mjs`
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

Add the restatement, the report template and the conductor's checks to the conduct skill.
