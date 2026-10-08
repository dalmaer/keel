---
status: planned
since: YYYY-MM-DD
goal: G0
spec: 2
depends: []
note: "What is known, and what remains."
evidence: []
---

<!-- Optional front matter, not set by default: `review: wait` makes this phase land through a PR that waits for its reviewers (`keel review <repo>#<n> --gate`); the phase's issue labelled keel:wait-for-review does the same. Delete this line. -->

# Outcome, as the person who uses it would say it

## Done when

One independently checkable outcome.

## Scope

The smallest useful slice, and its boundaries.

## Acceptance

- [ ] Observable behaviour, including the failure path, and the check that proves it: `tests/<file>: "<test name>"`, a command in backticks, or ⚑ by hand: <who>.

## Your part

<!-- Only for a phase with a ⚑ walk: what the owner is asked, in plain words, for someone who has not read this phase. Delete the section when there is no walk. `**Ready when:** <what must happen first>` in place of `**Ready:** yes` keeps it off the owner's list until then. Add `- **Keeps it open:** <choice> | …` for choices that record an answer but leave the walk open ("Not enough data yet"). A table of the data may follow. -->
- **Ask:** What the owner does, in one plain sentence, with no keel words.
- **Why:** What it settles or unblocks, in one sentence.
- **Look at:** The one thing to read or open first; a [link](url) is fine.
- **Choices:** First choice | Second choice
- **Takes:** About how long, e.g. 5 minutes.
- **Then:** What happens after each choice, where they differ.
- **Ready:** yes, or **Ready when:** what must happen first.

## Real surfaces

- <surface>: <its proof>, one line for each place this runs for real (published package, workflow shell, adopted project, owner's machine, GitHub API, fleet over time); or the single line none.

## Proof

Automated: exact commands and what each one proves.
By hand: who does what, and what would change the design.
⚑ Anything that creates a resource, spends money or needs a login — with the price.

## Deliberately open

An unsettled decision, why it is open, and what will settle it.
A known limitation that could make this phase's output wrong (a suggestion, a count, a verdict): its effect, and when it is settled. Here, never only in a design's prose.

## Next action

One concrete action that advances this phase.

## Trajectory

<!-- Optional. Written by the conductor, only for what changed the course; delete it until something does. -->
- **YYYY-MM-DD** — Claim. Evidence.
