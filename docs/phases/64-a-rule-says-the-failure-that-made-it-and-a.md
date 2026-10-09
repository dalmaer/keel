---
status: planned
since: 2026-10-09
goal: G0
spec: 2
depends: []
note: "Two habits from a project with its own practice: a rule without the failure that caused it gets 'improved' away by the next session, and a number in a doc is a dated observation, worth less than the command that re-derives it. keel's rendered rules mostly lack their cause, and its evidence quotes numbers without a date or a command. Design: research/2026-10-09-adopting-projects-that-ship-to-main.md."
evidence: []
issue: 51
---

# A rule says the failure that made it, and a number says when

## Done when

Every rule keel renders into a project's guide names the failure or lesson that made it (a lesson number, an issue, or one sentence); doctor notes a rule without one; a number in a phase's evidence or a research doc carries the date it was measured and, where one exists, the command that re-derives it; and a lint notes a figure with neither.

## Scope

The design is [Adopting projects that already have a practice](../research/2026-10-09-adopting-projects-that-ship-to-main.md), change 7.

- **Rules with causes**: each block in `practices/*/files` (AGENTS blocks, the skill) carries, per rule, a `(why: lesson N)`, an issue, or a one-sentence cause. A `keel lessons` lint (`rule-without-cause`) notes any without one. Keel's own blocks are filled in first.
- **Dated numbers**: in `docs/phases/*.md` evidence and `docs/research/*.md`, a measurement in the form `<number> (<YYYY-MM-DD>, <command>)` or under a dated heading. A `roadmap --check` note (`undated-number`) flags a figure with a unit (ms, s, minutes, %, points) and no date nearby. It is advice, never a failure.
- **Re-derivation**: `keel evidence rederive <phase>` reruns each recorded command and shows old against new.

## Acceptance

- [ ] Every rule in keel's shipped blocks has a cause; the lint notes one without. `tests/lessons.test.mjs`, `tests/practices.test.mjs`
- [ ] `roadmap --check` notes a measured figure with no date nearby, and stays quiet for a dated one. `tests/roadmap.test.mjs`
- [ ] `keel evidence rederive` reruns recorded commands and prints old and new values. `tests/evidence.test.mjs`
- [ ] ⚑ by hand: the owner reads keel's AGENTS blocks with their causes and says whether any rule now reads as obsolete.

## Your part

- **Ask:** Read keel's rules with their causes next to them, and say whether any of them no longer has a reason to exist.
- **Why:** A rule whose cause is gone is the cheapest thing to remove, and causes make that visible.
- **Look at:** keel's AGENTS.md blocks.
- **Choices:** All still needed | Some can go
- **Takes:** 15 minutes.
- **Then:** All needed: the phase is built. Some can go: they are retired in the next release.
- **Ready when:** keel's own blocks carry their causes.

## Real surfaces

- Adopted project: the guides keel renders, with causes.

## Proof

Automated: `node --test tests/lessons.test.mjs tests/practices.test.mjs tests/roadmap.test.mjs tests/evidence.test.mjs`; `npm run check`.
By hand: the owner's read of the rules.

## Deliberately open

- **What counts as a number**: units only, to keep the note quiet. Settled by how many false notes it gives on keel's own docs.

## Next action

Write the causes into keel's own blocks first, then brief a builder on the lints.
