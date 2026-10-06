---
status: partial
since: 2026-10-06
goal: G5
spec: 2
depends: [11, 13, 32, 33]
note: "Built: escapes on the night (fix: commits, the project's own lessons and — Escape: Trajectory lines since the last release, attributed only when one phase is named; bound: the previous release's count), with ceremony beside it. Baseline: 10 before v0.7.0, matching the analysis. Waits on the owner judging phases 32 and 33's levers after a release with them."
evidence: ["evidence/2026-10-06-escapes.md"]
issue: 12
---

# Keel counts its escapes, and every rigour change is judged by them

## Done when

The night reports `escapes` for keel and each adopted project (defects found after a phase was built, since the last release, each pointing at the phase it escaped where the record names one), the baseline from the spec-rigour analysis is recorded, and phases 32 and 33 each have a before-and-after reading in their evidence.

## Scope

The design is [How rigorous is a keel spec](../research/2026-10-06-spec-rigor.md), lever 3.

- **The signal is already written**: a lessons row whose provenance is the
  project itself, a commit whose subject starts `fix:`, and a Trajectory
  entry that records a correction. `escapes` counts them since the last
  release tag; a row or commit naming a phase is attributed to it.
- **The baseline**: the analysis's count for keel (5 Oct and before),
  recorded in this phase's evidence.
- **The bar**: no rise release over release; the night proposes the phase
  with the most escapes as the next hygiene target.
- **Judging a lever**: each of phases 32 and 33 records escapes before and
  after, and its ceremony (days planned to built, words per phase). A lever
  whose escapes do not fall while its ceremony rises is proposed for
  removal.
- Phase 13's six measures stay as they are; this adds one, defined once.

## Acceptance

- [x] On a synthetic repo with two fix commits, one self-provenance lesson and one trajectory correction since a tag, `escapes` is 4, attributed to the phases they name; with no tag it counts from the first commit. `tests/escapes.test.mjs`
- [x] A commit whose subject merely contains "fix" mid-sentence is not counted; mutation: a substring match fails the test. `tests/escapes.test.mjs`
- [x] keel's baseline is computed by the measure and matches the analysis's hand count within the cases the analysis names. `node scripts/keel/improve.mjs --report`
- [ ] ⚑ by hand: the owner reads phases 32 and 33's before-and-after and keeps or retires each lever.

## Real surfaces

- Adopted project: the measure ships in the night's improve; one adopted project's health page shows it.

## Proof

- Automated: `node --test tests/improve.test.mjs`, with the mutation above.
- By hand: the baseline on keel; one adopted project's health page after its update.
- ⚑ The owner's keep-or-retire reading of each lever.

## Deliberately open

- **Attributing an escape no record names to a phase.** Counted, not
  attributed; guessing a phase would be the kind of facade evidence forbids.
- **How long a lever runs before it is judged.** At least one release with
  three or more built phases after it.

## Next action

⚑ After the release that carries phases 32 and 33 and at least three phases built after it: the owner reads escapes and ceremony before and after each lever, and keeps or retires it.

## Trajectory

- **2026-10-06** — The measure reproduces the analysis's baseline exactly (10 before v0.7.0: nine own lessons and one fix commit) but missed all four of today's escapes: keel writes subsystem-prefixed subjects (`climb:`, `loose-ends:`), never `fix:`. The record is the fix, not the code: an escape is written as a `— Escape:` Trajectory line in the phase it escaped from (now in the conduct skill and the phases README), and today's four are.
- **2026-10-06** — A `fix:` commit naming a lesson counted in the same window is that lesson's escape, counted once; a lesson's phase is read from its shape and cost, never its Guard. Builder's calls, kept.
