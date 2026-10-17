# Evidence: phase 83 — sessions hand a change off as ready; one integrator runs the full gate

- Date: 2026-10-17
- Phase: [83](../phases/83-agent-sessions-hand-a-change-off-as-ready-and.md)
- Revision: base `b8b86c6` (Merge pull request #178, phase 80), working tree; committed as "phase 83: Agent sessions hand a change off as ready, and one integrator runs the expensive path"
- Claim being checked: `keel ready` runs only fast checks and records the change ready; `keel integrate`, holding `claims/integrate`, gates every ready change once and pushes once; on a failure it accumulates by halves, so a change that breaks the gate, or a combination of two that each pass, is found and sent back while the rest land, and nothing failing is pushed.

## Automated checks

All on bare-origin clones on this machine's disk (`tests/integrate.test.mjs`, hermetic: no network, node spawned only through `tests/helpers/run.mjs`). The full gate is a fake: in-process, a function reading the tree (fails on a `BREAK` file, and on `left.txt` with `right.txt`); through the CLI, the fixture's `check: "node gate.mjs"`, which logs each run. The bare origin's `post-receive` hook logs every push to `main`, so "one push" is counted on the server.

| Acceptance | Test (`tests/integrate.test.mjs` unless named) |
| --- | --- |
| `keel ready` records a branch ready without the full gate | "keel ready records a branch as ready without running the full gate"; refusals in "keel ready refuses the full gate as a fast check, a failing fast check, the default branch and an uncommitted tree; nothing is pushed" |
| Two integrators racing: exactly one runs | "two integrators racing for the lock: exactly one runs" (both read the remote before either pushes the lock) |
| Three changes, one bad: two land in one push, the bad one isolated and reported | "three ready changes, one breaking the gate: …" (6 gate runs; one push; `ready/codex/broken` rewritten `Status: blocked`; skipped on the next run; lands after its session fixes it and marks it ready again) |
| The full gate runs once for a passing batch | "the full gate runs once for a batch that passes, and the batch lands in one push" (1 gate run, on the combined tree; 1 push) |
| Interaction: one lands, the other conflicting with it, nothing failing pushed | "two individually passing changes whose combination fails: …" (main's tree passes the fake gate afterwards) |
| The conduct skill finishes with `keel ready` | `tests/skill.test.mjs` "the conduct skill finishes with keel ready and leaves the full gate to keel integrate" |

Also: a merge conflict on top of a kept change is reported as conflicting with it; `main` moving during the gate is never overwritten and nothing lands; the CLI path runs the project's own `check` in a temporary worktree, leaves the checkout unmoved and the lock released, and refuses when someone holds the lock.

```
node --import ./tests/helpers/hermetic.mjs --test tests/integrate.test.mjs tests/skill.test.mjs
exit 0; tests 28, pass 28, fail 0
```

The gate runs after this file is written: `npm run check` (the whole suite plus the roadmap, render and inbox guards). Its result line is in the commit body.

### Mutation check: each guard broken by hand

Each row: one edit to the guard, the test file run, the file restored (a scratch script; the restore was confirmed by the green run above). Every mutation turned at least one test red.

| # | Guard broken | Red |
| --- | --- | --- |
| M1 | `keel ready` refuses a fast check that is the full gate | ready refusals test |
| M2 | a failing fast check pushes nothing | ready refusals test |
| M3 | `keel ready` refuses the default branch | ready refusals test |
| M4 | `keel ready` refuses an uncommitted tree | ready refusals test |
| M5 | the lock is held only when its own token reads back | race test; CLI test |
| M6 | the lock push is create-only (made a forced push) | CLI test (a held lock is overwritten). The race test stays green under this one: the token read-back alone still lets one through when the two pushes land in order; create-only is what refuses an existing lock |
| M7 | the lock is released when the run ends | race, three-change, main-moved, CLI tests |
| M8 | the right half is gated on the kept left half (made plain splitting) | three-change, interaction, merge-conflict, CLI tests |
| M9 | the whole batch is gated once first (fast path removed) | passing-batch, three-change, interaction tests |
| M10 | only a tree the gate passed is pushable | the `pushable` unit test. The search always ends on a tree it gated, so in the integration tests this check is unreachable; it guards a later change to the search |
| M11 | the push to `main` is leased on the batch's base (made `--force`) | main-moved test |
| M12 | a blocked change is skipped until marked ready again | three-change test |
| M13 | a change sent back is recorded blocked on its ready ref | three-change test |
| M14 | a change failing on kept ones is gated alone, to say "conflicts with" | interaction test |
| M15 | landed changes lose their ready refs | passing-batch, three-change tests |
| M16 | the conduct skill's "**Finish with `keel ready`.**" | `tests/skill.test.mjs` phase 83 test |
| M17 | the skill's lock sentence (restored to "Never run a build beside another build.") | `tests/skill.test.mjs` phase 83 test |

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| The owner asks two sessions for two changes | one full gate, one push | Not run | The ⚑ box; the phase stays partial, `owes: walk` |
| A real GitHub remote (ready refs, the lock, the push) | as on the bare origin | Not run | Real surfaces: the fixture is not GitHub |

## Gaps and decision

Not walked: the owner's two sessions, and a real GitHub remote. Known limits: the gate's worktree gets the checkout's `node_modules` linked and nothing else; a lock left by a run that died waits for the owner to delete it. Supports `partial` with `owes: walk`, not built.
