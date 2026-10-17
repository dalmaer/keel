# Verification: tests that tell right from plausibly wrong

The owner, 2026-10-16, twice: "Can we learn anything from
https://addyo.substack.com/p/agentic-verification", then "Please spec out all of
the gaps and start to work through."

Addy Osmani's argument: the bottleneck has moved from writing code to knowing
it is correct, so the work is building checks an agent runs on itself. Keel
already holds most of it: the builder never grades its own work (the conductor
runs the proof, the other provider reviews), a fix's test must fail without the
fix (`keel prove`, phase 62), a phase names its tests before it is built, and
lessons become guards. This note is the four gaps the week's own work showed.

## What the week showed

Phases 73–78 (the nightwatch) took 1,700 passing tests and still drew real
findings in review, several of a kind example tests cannot catch:

- **A test that shares the builder's misunderstanding.** Phase 78's card job
  read `needs.decide.outputs.plan`, an output the job never exported; its tests
  passed. Codex caught it. The fix was a check over every shipped workflow, not
  one more example.
- **Inputs nobody wrote an example for.** An impossible date (`2026-13-01`)
  crashed instead of being refused; two personas made the same item id; an
  equal-rank tick never replaced the record; a property-only edit slipped past
  adoption.
- **The whole loop was proven only by running it.** The first real morning
  (keel#156) was what showed the night, plan, finalize and brief working
  together; no test ran them as one.
- **Builders reported in five different shapes**, and every report had to be
  read in full to find what failed.

## The four phases

| Phase | Title | Depends on |
| --- | --- | --- |
| 84 | A fix's test is shown to catch plausible wrong versions of the fix | 62 |
| 85 | Properties guard keel's plan, tick and claim code | 70, 73 |
| 86 | A whole night runs in one test | 73, 76, 77, 78 |
| 87 | Builders restate what done means first, and report in one shape | — |

**84, mutation proofs.** `keel prove` shows a test fails without the fix. It
does not show the test fails for a *nearly* right fix. `keel prove --mutate`
applies small, mechanical mutations to the fix's own changed lines (flip a
comparison, drop a condition, return early, swap `&&`/`||`, change a constant
by one) and requires the named test to fail for each, reporting the survivors.
A survivor is not a failure of the fix; it is a gap in the test, shown to the
conductor before the commit.

**85, properties.** A small, zero-dependency generator in `tests/helpers`
(seeded, shrinking to the smallest failing case, reproducible by seed) and
properties on the code that holds state: the plan validator (anything it
accepts round-trips; a sixth build or an impossible date is always refused),
tick merging (the furthest tick wins, order does not matter, applying twice
equals once), claims (exactly one of N racers holds), and front matter
(parse after render is identity).

**86, a night in a box.** One test runs the night's plan, a climb pass that
ticks, the morning's decide/finalize/send and the card against a bare origin,
a stubbed GitHub and the fake isocan, with a frozen clock, and checks the brief
and the card say what happened. The oracle is the owner's view, not the
internals.

**87, the builder's shape.** The conduct skill asks a builder to restate the
success criteria before building (the article's "restate what you think done
means") and to report in one shape: what changed, each acceptance box with its
test, the gate's exit code, decisions the spec left open, what remains. The
conductor's own check reads that shape, so a missing gate result is caught,
not skimmed past.

## Open

- **Which mutations**: start with the five mechanical ones; widen from the
  survivors the first weeks show.
- **Property budget**: properties run in the gate with a fixed small count and a
  seed; a larger run is a night measure.
