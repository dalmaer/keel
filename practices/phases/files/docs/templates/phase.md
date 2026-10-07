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
