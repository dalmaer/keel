---
status: built
since: 2026-10-02
goal: G3
depends: [6, 7]
note: "keel learn gathers lesson issues and pinned sources into docs/inbox proposals (INBOX.md generated and checked); propose needs a cited read, decide is the person's; real run: 0 issues, conduct source still at its pin."
evidence: ["evidence/2026-10-02-learn.md"]
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

- [x] A changed upstream source produces exactly one proposal, citing the upstream commit.
- [x] An instruction-shaped sentence inside a lesson is surfaced, not followed (a fixture proves it).
- [x] Accepting a practice-change proposal produces its inert migration stub, the central lesson row and the checklist for the practice edit (which a person or agent makes in the same commit).
- [x] Declining closes the issue with the reason, so the project hears why.

## Proof

`node --test tests/learn.test.mjs`; then a real run that picks up whatever isocan's conduct skill has done since `7227f325`.

## Deliberately open

- Whether learn may run nightly with a model proving claims (as isocan's loop.yml does) or only on demand. Still open: gathering nightly is safe (reads plus files); a model `propose` step is phase 10's call, with the owner's yes on its cost. `decide` never runs unattended.

## Next action

None; it waits for the first real lesson from a project (phase 7's ⚑).

## Trajectory

- **2026-10-02** — `learn` is one verb with subcommands (`propose`, `decide`, `render`), because the surface test wants one cold-start line per verb and the cap had 21 characters left. The cap itself is phase 9's to settle.
- **2026-10-02** — Proof reworded: accepting a practice change can't produce the practice edit; keel writes the lesson row and an inert migration stub, and the edit is a person's or an agent's, made in the same commit.
