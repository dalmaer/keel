---
status: planned
since: 2026-10-09
goal: G4
spec: 2
depends: [56]
note: "Three time sinks a project found only by auditing its own sessions by hand: stale worktrees holding tens of gigabytes, finished work left as draft PRs for days, and source files too long for an agent to read whole. Each becomes a night measure with a bound and a named fix the robot can take. Design: research/2026-10-09-adopting-projects-that-ship-to-main.md."
evidence: []
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

- [ ] `stale_worktrees` lists merged or week-old worktrees with sizes, is n/a in CI, and its fix removes nothing itself. `tests/improve-measures.test.mjs`
- [ ] `drafts_waiting` counts draft PRs past the bound through the cache and quota floor. `tests/improve-measures.test.mjs`
- [ ] `long_files` names files over the bound, skips generated and vendored ones, and its fix names split points. `tests/improve-measures.test.mjs`
- [ ] ⚑ by hand: one proposal from each measure accepted and carried out.

## Your part

- **Ask:** When the night proposes one of these (stale worktrees, a waiting draft, a file to split), accept or decline it, and see it through once for each.
- **Why:** These are the sinks a project found only by auditing itself by hand; this makes the audit nightly.
- **Look at:** The health page's proposal.
- **Choices:** Accept | Decline
- **Takes:** 5 minutes each.
- **Then:** Accept: the fix is carried out (by you for worktrees, the robot for a split). Decline: the reason is recorded and the bound may change.
- **Ready when:** this is built and each measure has fired once.

## Real surfaces

- Owner's machine: worktrees.
- GitHub API: draft PRs.
- Fleet over time: one proposal from each measure.

## Proof

Automated: `node --test tests/improve-measures.test.mjs`; `npm run check`.
Over time: one fix from each.

## Deliberately open

- **Bounds**: 1500 lines and 24 hours are first guesses. Settled by how many proposals are declined as noise.

## Next action

After phase 56, brief a builder on the three measures.
