---
status: planned
since: 2026-10-09
goal: G0
spec: 2
depends: []
note: "Every bug fix ships with a test, but nothing records that the test fails without the fix. A fix is proven when its named test is seen failing with the fix reverted, the failure text recorded, and the verdict reported as VERIFIED, NOT WORKING or INCONCLUSIVE. keel did this informally on 2026-10-09 (each fix mutated to confirm its test caught it). Design: research/2026-10-09-adopting-projects-that-ship-to-main.md."
evidence: []
issue: 49
---

# A fix is proven by its test failing without it

## Done when

`keel prove <test> --fix <files>` reverts the fix's files, runs the named test, records that it failed and how, restores the fix, runs it again, and writes the verdict (VERIFIED, NOT WORKING or INCONCLUSIVE) with the failure text into the commit trailer or the phase's evidence; the conduct skill requires it for every `fix:` commit; and keel's own fixes for two weeks carry it.

## Scope

The design is [Adopting projects that already have a practice](../research/2026-10-09-adopting-projects-that-ship-to-main.md), change 5.

- **The command**: `keel prove <test file> [--name <pattern>] --fix <path>...` stashes the named files' changes (or reverts them to the base commit), runs the test, captures the first lines of its failure, restores the files, runs it again, and prints the verdict:
  - VERIFIED: red without the fix, green with it.
  - NOT WORKING: green without it (the test doesn't catch the bug) or red with it.
  - INCONCLUSIVE: the test can't run without the fix (it doesn't compile, say), with the reason.
- **The record**: `--trailer` prints a `Proven-by:` commit trailer (the test, the verdict, the failure's first line); `--evidence <phase>` appends it to the phase's evidence.
- **The rule**: the conduct skill and the agent guide say a `fix:` commit carries a `Proven-by:` trailer; the night's `escapes` measure notes fixes without one.

## Acceptance

- [ ] `keel prove` reports VERIFIED for a test that fails without the fix and passes with it, NOT WORKING for one that passes either way, and INCONCLUSIVE when the test cannot run without it; the working tree is restored in every case. `tests/prove.test.mjs`
- [ ] `--trailer` prints a `Proven-by:` line with the verdict and the failure's first line; `--evidence` appends it to the phase's evidence. `tests/prove.test.mjs`
- [ ] The conduct skill names the rule. `tests/skill.test.mjs`
- [ ] The night notes `fix:` commits since the last release that carry no `Proven-by:`. `tests/improve-measures.test.mjs`
- [ ] ⚑ by hand: two weeks of keel's own fixes carry it; the owner reads three.

## Your part

- **Ask:** Read three of keel's fix commits from the last two weeks and their `Proven-by:` lines, and say whether they convince you the fix works.
- **Why:** A test that never failed without its fix proves nothing, and this is how keel shows it did.
- **Look at:** `git log --grep Proven-by` in keel.
- **Choices:** Convincing | Not convincing
- **Takes:** 10 minutes.
- **Then:** Convincing: the phase is built. Not convincing: what was missing goes into the rule.
- **Ready when:** two weeks of fixes have been proven.

## Real surfaces

- Owner's machine: `keel prove` in keel's own work.

## Proof

Automated: `node --test tests/prove.test.mjs tests/skill.test.mjs tests/improve-measures.test.mjs`; `npm run check`.
Over time: two weeks of keel's fixes.

## Deliberately open

- **Which files are the fix**: `--fix` names them; inferring them from the commit is later work.

## Next action

Brief a builder on `keel prove`.
