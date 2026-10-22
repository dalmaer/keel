---
status: partial
owes: walk
since: 2026-10-17
goal: G0
spec: 2
depends: [70, 73]
note: "Built 2026-10-17: tests/helpers/property.mjs (seeded, shrinking, zero-dependency) drives properties over the plan validator, ticks and the morning's merge, claims and front matter in the gate, each also run against planted bugs. They found two real bugs on their first run (a readyBy on an impossible day accepted; an impossible since thrown as a bare RangeError), fixed apart. Owes the owner one read of a shrunk failure."
evidence: ["evidence/2026-10-17-properties.md"]
issue: 170
---

# Properties guard plates's plan, tick and claim code

## Done when

A seeded, shrinking, zero-dependency property runner lives in `tests/helpers`, and properties over the plan validator, tick merging, claims and front matter run in the gate, each failure reported as its smallest case and the seed that reproduces it.

## Scope

The design is [Verification: tests that tell right from plausibly wrong](../research/2026-10-16-verification.md), phase 85.

- **The runner**: generators for strings, ints, dates (valid and impossible), arrays and records; a fixed seed per run printed on failure; shrinking toward the smallest failing input; a small default count in the gate, a larger one by env var.
- **Properties**:
  - plan validator: anything accepted round-trips through write and read; any plan with a sixth build, a build with no number, an impossible date or an unknown field is refused, never thrown on;
  - ticks: the furthest tick wins regardless of order; applying a tick twice equals once; a done item never moves back;
  - claims: of N racers in one origin, exactly one holds;
  - front matter: parse after render is identity for every field the roadmap accepts.

## Acceptance

- [x] The runner shrinks a failing case to its smallest and reports the seed that reproduces it. `tests/helpers/property.test.mjs`
- [x] The plan, tick and front-matter properties pass, and each fails on a planted bug of its kind (an impossible date accepted, an order-dependent merge). `tests/properties.test.mjs`
- [x] The claim race property holds for N racers. `tests/properties.test.mjs`
- [x] Properties run in `npm run check` within the test budget. `tests/properties.test.mjs`
- [ ] ⚑ by hand: none beyond the gate; the owner reads one shrunk failure if one appears in review.

## Your part

- **Ask:** If a property fails in review or the night, read its shrunk case.
- **Why:** It shows whether the smallest case makes the bug obvious.
- **Look at:** the failing test's output.
- **Choices:** Obvious | Still hard to read
- **Takes:** 10 minutes.
- **Then:** Hard: the shrinker or the report is improved.
- **Ready when:** a property has failed for real. Ready: two did on their first run (the evidence's "Real bugs found", seed 283816414).

## Real surfaces

none

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/helpers/property.test.mjs tests/properties.test.mjs`; `npm run check`.

## Deliberately open

- **Count**: small in the gate; a larger run could be a night measure later.
- **Known limit**: properties cover these four modules first; others follow their own findings.
- **Seed** (settled 2026-10-17, by building it): a fresh seed per run, printed on every failure and set by `PLATES_PROPERTY_SEED`, so the gate explores new inputs each run; a failure there is a finding to read, never a flake to rerun.

## Next action

The owner reads the two shrunk failures in the evidence (readyBy 2000-01-32T07:00:00Z; since 2000-01-32) and says Obvious or Still hard to read, then tick the ⚑ box and set built.
