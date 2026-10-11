---
status: partial
owes: walk
since: 2026-10-11
goal: G4
spec: 2
depends: [56]
note: "Bounded hygiene measures and recoverable split proposals verified; owner one-fix-each walk and robot budget approval remain."
evidence: ["evidence/2026-10-11-hygiene-audits.md"]
issue: 53
---

# Hygiene measures from real audits

## Done when

The night measures stale worktrees (merged into main or untouched for a week, with the disk they hold), draft PRs waiting longer than a bound, and source files longer than a bound in lines; each outside its bound names its fix (the worktrees to remove, the PRs to finish, the file to split and where); and one fix from each has been proposed and taken.

## Scope

The design is [Adopting projects that already have a practice](../research/2026-10-09-adopting-projects-that-ship-to-main.md), change 9.

- **`stale_worktrees`**: `git worktree list` on the conductor's machine (keel-side, n/a in CI): worktrees whose branch is merged into main or untouched for 7 days, with their size. The fix lists them, one `git worktree remove` each (never a bulk loop), and is the owner's to run: keel never deletes.
- **`drafts_waiting`**: open draft PRs older than a bound (default 24 hours), from one bounded read through the cache and the quota floor. The fix: finish it (mark ready, merge), or close it with why.
- **`long_files`**: source files (excluding generated, vendored and fixture files) over a bound in lines (default 1500), with their history of growth. The fix names the file and its largest internal sections as split points, and is filed for the robot (phase 54) when accepted.

## Acceptance

- [x] `stale_worktrees` lists merged or week-old worktrees with sizes, is n/a in CI, and its fix removes nothing itself. `tests/improve-measures.test.mjs`, `tests/worktree-hygiene.test.mjs`
- [x] `drafts_waiting` counts draft PRs past the bound through the cache and quota floor. `tests/improve-measures.test.mjs`
- [x] `long_files` names files over the bound, skips generated and vendored ones, and its fix names split points. `tests/improve-measures.test.mjs`
- [x] Accepted long-file proposals validate fresh local/default-branch source and approved policy, preserve decisions on report regeneration, and recover uncertain issue writes without duplicates. `tests/hygiene-proposals.test.mjs`
- [ ] ⚑ by hand: one proposal from each measure accepted and carried out.

## Your part

- **Ask:** Review the individual health proposals, then confirm this phase only after one worktree cleanup, one waiting draft resolution and one file split have actually been carried out.
- **Why:** These are the sinks a project found only by auditing itself by hand; this makes the audit nightly.
- **Look at:** [The selective hygiene report](../health/2026-10-11.md), then later health proposals for any category still missing.
- **Choices:** All three carried out | Still outstanding
- **Keeps it open:** Still outstanding
- **Takes:** 5 minutes each.
- **Then:** All three carried out: record their evidence and mark the phase built. Still outstanding: record what remains and keep the phase open. Individual proposal acceptance or decline does not complete this walk.
- **Ready when:** an actionable proposal exists for each category and a robot budget is approved for a selected split.

## Real surfaces

- Owner's machine: worktrees.
- GitHub API: draft PRs.
- Fleet over time: one proposal from each measure.

## Proof

Automated: `node --test tests/improve-measures.test.mjs tests/worktree-hygiene.test.mjs tests/hygiene-proposals.test.mjs`; `npm run check`.
Over time: one fix from each.

## Deliberately open

- **Robot source availability — settled 2026-10-11:** Local source freshness alone does not establish availability to the robot. Before a new delivery, verify that GitHub's default-branch file path and blob match the frozen observation; mismatches or unavailable reads block filing. Recover attempted issue writes first, even if source changed afterward. This is an acceptance-time observation, not a promise that the branch cannot change later.

- **Observation and authority — settled 2026-10-11:** Worktree size is logical bytes held, not guaranteed reclaimable physical disk space. Local main reachability establishes merged code only. Current, primary, locked, dirty or incompletely inspected worktrees are protected; bounded filesystem activity and size scans disclose gaps. Commands are one-at-a-time owner advice, never automatic cleanup.
- **Draft age — settled 2026-10-11:** Count currently open drafts by age since creation, explicitly not continuous time in draft. Bounded cached GitHub reads preserve truncation, quota and access gaps as unavailable.
- **Thresholds — settled 2026-10-11:** Configured hygiene filters are positive finite values (draft hours, worktree days and file lines); measure count bounds remain separate, default zero with no ratchet. Long-file history and split points are bounded heuristics tied to source revisions.
- **Accepted split proposals — settled 2026-10-11:** Extend the existing health page and `keel walk decide` flow. An explicitly accepted, fresh file-split proposal can use the existing recoverable robot issue journal only under an approved project policy and budget. Missing approval, changed source or uncertain delivery remains explicit. Worktree and draft decisions record the owner's choice without executing the suggested action.

- **Bounds**: 1500 lines and 24 hours are first guesses. Settled by how many proposals are declined as noise.

## Next action

Owner: review the concrete long-file proposal and the two worktree candidates, approve a project/weekly robot allowance before delivering a split, and resolve one genuinely waiting draft when one exists. Record actual outcomes for all three; the current complete draft read found none old enough.

## Trajectory

- **2026-10-11** — The existing health proposal section and robot issue journal already provide durable decisions and recovery; no second tracking store was needed. Protected or unsupported file targets retain manual advice. A real audit found two worktree candidates, no old drafts, and five long files; the fleet-over-time walk stays open. See the evidence.
