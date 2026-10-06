---
status: partial
since: 2026-10-06
goal: G4
spec: 2
depends: [14, 20, 31, 35]
note: "Built: perf (the command's last-line number, better lower or higher, the project's perf check as guard), lessons (a distill pass over the project's own table: proposals only, decided by editing their status) and loop (pull, propose a rank for each untriaged finding, decide none; unreachable is a notice). Waits on ledger's climb config and token at the fleet release, and one owner-read night of each."
evidence: ["evidence/2026-10-06-climb-perf-lessons-loop.md"]
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
  family, reword and standardise proposals in the PR, never applied to the table
  until the owner accepts them; lessons that belong home are sent with
  `keel lessons`, by the owner.
- **`loop`**: the loop practice's pull, then the agent's `propose` for each
  untriaged finding (a rank, a phase, a read citing code); `decide` stays
  the owner's. It replaces the Loop workflow's pull on a climb night, never
  runs beside it.
- **Ledger first**: its `.keel/keel.json` gains `climb` with these jobs and a
  budget, by an update PR the owner merges.

## Acceptance

- [x] `perf` reads `better` and keeps only changes that move the number the right way past the margin; mutation: a flipped direction fails the test. `tests/climb.test.mjs: "perf"`
- [x] The `lessons` job writes proposals and changes no row of the project's table. `tests/climb.test.mjs: "lessons"`
- [x] The `loop` job proposes for every untriaged finding and decides none; a run with Loop unreachable ends with a notice, not red. `tests/climb.test.mjs: "loop"`
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

At the fleet release: ledger gains `"climb"` (perf, lessons, loop; 45 minutes) with a working CLAUDE_CODE_OAUTH_TOKEN; settle the perf command first (one number on its last line), and add the test-ledger reporter so a perf night's guard can tell.

## Trajectory

- **2026-10-06** — The distill rules ship to projects as scripts/keel/distill.mjs (no imports); keel's lib/distill.mjs re-exports them: one source. In a project the owner decides a lessons proposal by setting its status; `keel learn decide` stays keel's.
- **2026-10-06** — ledger's `npm run perf` prints several budget rows, not one number; its perf job needs a one-number command (an awk over the table works but is fragile), and its data must be reachable from compare's temporary worktrees.
- **2026-10-06** — Loop unreachable reaches the run's notice and step summary but not yet the night's Climb line (night's climbLine); and keel-climb and keel-loop both pull on a day both run: harmless, not yet merged.
