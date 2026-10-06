---
status: planned
since: 2026-10-06
goal: G4
spec: 2
depends: [14, 20, 31, 35]
note: "The last three climb jobs, proven on ledger: perf (the project's own benchmark), lessons (phase 31's distill, in the project) and loop (pull Stitch Loop's findings and propose a rank for each; a person decides). Design: research/2026-10-06-climb-nights.md."
evidence: []
issue: 15
---

# A project's own benchmark, its lessons and its Loop findings are climbed overnight

## Done when

On ledger, climb nights have run each of `perf` (its own benchmark command, measured under the protocol), `lessons` (a distill pass over ledger's table, proposals for the owner) and `loop` (Loop's new findings pulled and each given a proposed rank), each opening at most one PR that the owner reads, and none deciding anything a person decides.

## Scope

The design is [Climb nights](../research/2026-10-06-climb-nights.md).

- **`perf`**: `"climb": { "perf": { "command": "<prints one number>", "better": "lower"|"higher" } }`.
  The protocol as for test-time; the guard adds the project's own perf
  check, if it has one (ledger's `perf --check`), passing.
- **`lessons`**: phase 31's distill, run in the project on its own table:
  family, reword and promote proposals in the PR, never applied to the table
  until the owner accepts them; lessons that belong home are sent with
  `keel lessons`, by the owner.
- **`loop`**: the loop practice's pull, then the agent's `propose` for each
  untriaged finding (a rank, a phase, a read citing code); `decide` stays
  the owner's. It replaces the Loop workflow's pull on a climb night, never
  runs beside it.
- **Ledger first**: its `.keel/keel.json` gains `climb` with these jobs and a
  budget, by an update PR the owner merges.

## Acceptance

- [ ] `perf` reads `better` and keeps only changes that move the number the right way past the margin; mutation: a flipped direction fails the test. `tests/climb.test.mjs: "perf"`
- [ ] The `lessons` job writes proposals and changes no row of the project's table. `tests/climb.test.mjs: "lessons"`
- [ ] The `loop` job proposes for every untriaged finding and decides none; a run with Loop unreachable ends with a notice, not red. `tests/climb.test.mjs: "loop"`
- [ ] ⚑ by hand: on ledger, one night of each job, each PR read by the owner.

## Real surfaces

- Adopted project: ledger, through its update PR and three real climb nights.
- Workflow shell: the climb workflow on ledger's Actions, with its setup (`setupToken`) and env.
- GitHub API: Loop's pull, through Stitch, with the project's `STITCH_API_KEY`.

## Proof

- Automated: `node --test tests/climb.test.mjs`, with the mutation above.
- By hand: the three nights on ledger and their PRs.
- ⚑ ledger's update PR; three nights' model spend within the budget the owner sets.

## Deliberately open

- **Whether `lessons` should also send home** what it finds general. Not by
  itself: sending is the owner's act, as in phase 25.

## Next action

Blocked on phases 31 (distill) and 35 (the protocol).
