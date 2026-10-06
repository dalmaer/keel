---
status: planned
since: 2026-10-06
goal: G5
depends: [11, 13, 32, 33]
note: "Climb escapes per built phase: defects found after a phase was built, read from what is already written (a lesson with the project's own provenance, a fix commit, a trajectory correction). Each rigour change is an experiment against it. Design: research/2026-10-06-spec-rigor.md."
evidence: []
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

- [ ] On a synthetic repo with two fix commits, one self-provenance lesson and one trajectory correction since a tag, `escapes` is 4, attributed to the phases they name; with no tag it counts from the first commit. `tests/improve.test.mjs`
- [ ] A commit whose subject merely contains "fix" mid-sentence is not counted; mutation: a substring match fails the test. `tests/improve.test.mjs`
- [ ] keel's baseline is computed by the measure and matches the analysis's hand count within the cases the analysis names. `node scripts/keel/improve.mjs --report`
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

Blocked on phases 32 and 33. Meanwhile: record keel's baseline by hand in this phase's evidence, from the analysis's escape list.
