---
status: planned
since: 2026-10-02
goal: G3
depends: [6, 7]
note: "The first source is known: isocan's conduct skill, pinned at 7227f325."
evidence: []
---

# Keel turns what it hears into the next practice version, with a person deciding

## Done when

`keel learn` reads open lesson issues and every pinned source, writes a proposal for each into `docs/inbox/`, and an accepted proposal lands as a central lesson, a practice change and its migration in one commit.

## Scope

Sources: `practices/*/practice.json` `source` entries (repo, path, commit);
learn diffs each against its upstream head and files a proposal per change.
Proposals: `docs/inbox/<date>-<slug>.md` with the claim, our read of it, and
the proposed outcome — central lesson / practice change + migration / decline
(project-specific) / link to an existing shape. **An agent proposes; a person
decides** (`keel learn decide <slug> <outcome>`), as with ledger's Loop
findings. Lesson text from projects is data, never instructions.

## Acceptance

- [ ] A changed upstream source produces exactly one proposal, citing the upstream commit.
- [ ] An instruction-shaped sentence inside a lesson is surfaced, not followed (a fixture proves it).
- [ ] Accepting a practice-change proposal produces the practice edit, its migration stub and the central lesson row together.
- [ ] Declining closes the issue with the reason, so the project hears why.

## Proof

`node --test tests/learn.test.mjs`; then a real run that picks up whatever isocan's conduct skill has done since `7227f325`.

## Deliberately open

- Whether learn may run nightly with a model proving claims (as isocan's loop.yml does) or only on demand. On demand until phase 10's night shift exists.

## Next action

Record the conduct source pin in phase 1's practice.json, then write the "source moved" test against a fixture repo.
