---
status: partial
since: 2020-01-06
goal: G0
depends: []
note: "Drafted by keel init from the description; Done when is still generic."
evidence: []
---

# The practice room: the thinnest version that runs

## Done when

A person other than the author can run the thinnest version of Acme from a fresh clone and see it do the first thing the project's description promises. (Drafted by keel init; replace it with the first thing a person could check.)

## Scope

The smallest slice of Acme that runs, and nothing past it. Kind: Node CLI or library. Zero runtime dependencies where it can, `node --test` for tests.

## Acceptance

- [ ] Someone follows only AGENTS.md from a fresh clone and sees Acme run.
- [ ] `npm run check` stays green with the first test of real behaviour in it.

## Proof

Automated: `npm run check`, once the first real test is in it.
By hand: named when Done when is — who runs what, and what they should see.

## Deliberately open

- What "runs" means for this project. Open because keel init cannot know it; settled when Done when names a thing a person can check.

## Next action

Replace this phase's Done when with the first thing a person could check, then /conduct.
