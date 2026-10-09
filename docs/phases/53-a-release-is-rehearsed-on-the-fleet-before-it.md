---
status: partial
owes: walk
since: 2026-10-09
goal: G2
spec: 2
depends: [52]
note: "Built: keel fleet update --rehearse (phase 52's path with the candidate practice, stopped before the push; at most 4 projects at once, in worker threads) and keel release running it after its gate and before its commit, refusing while a project passes on main and fails with the release; --despite <repo> \"<why>\" the owner's way past, written into the commit and WHATSNEW. Owes the walk: three rehearsed releases, and the owner's comparison of their fleet rounds with v0.8.23 to v0.8.26. Design: research/2026-10-09-updates-never-block.md."
evidence: []
issue: 40
---

# A release is rehearsed on the fleet before it is tagged

## Done when

`keel release` rehearses the update on every managed fleet project before it commits and tags, and refuses while a project's check passes on main and fails with the release, unless the owner records why; three releases have gone through it, and the owner has compared their fleet rounds with v0.8.23 to v0.8.26.

## Scope

The design is [A fleet update never dead-ends](../research/2026-10-09-updates-never-block.md), phase 53. Phase 48 checks that a release was reviewed; this checks that it passes the projects' own checks.

- **The rehearsal**: `keel fleet update --rehearse` runs phase 52's per-project path (clone, setup or install, update with the candidate practice, the project's check, main's check when it fails) and stops before the push. It prints one row per project and `--json`.
- **The release**: `keel release` runs the rehearsal after its own check and before it commits. A project that passes on main and fails with the release makes it refuse (exit 1), naming the project and the failure's tail. A project whose main is already red, or that cannot be cloned or installed, is reported and never a refusal.
- **The owner's override**: `--despite <repo> "<why>"` (repeatable) releases anyway and writes the reason into the release commit and WHATSNEW; the fleet round then opens that project's draft (phase 52).
- **Bounded**: projects rehearse in parallel (at most 4), each with the fleet update's timeout; the release prints how long the rehearsal took.

## Acceptance

- [x] `keel fleet update --rehearse` runs each project's update and check and pushes nothing, opens nothing (a stubbed gh records no push or PR call). `tests/fleet.test.mjs`
- [x] `keel release` refuses (exit 1, writing no commit or tag) when a rehearsed project passes on main and fails with the release, naming it and its tail; passes when every project passes or its main was already red. `tests/release.test.mjs`
- [x] `--despite <repo> "<why>"` releases and records the reason in the release commit and WHATSNEW; a repo not in the fleet is refused. `tests/release.test.mjs`
- [ ] ⚑ by hand: three releases go through the rehearsal; the owner compares their fleet rounds (FAILED rows, draft PRs, releases per day) with v0.8.23 to v0.8.26.

## Your part

- **Ask:** After three releases have been rehearsed, read the comparison of their fleet rounds with the four releases of 9 October, and say whether the wait at release time is worth it.
- **Why:** A rehearsal makes each release slower; it stays only if the fleet rounds got quieter.
- **Look at:** This phase's evidence: fleet rounds before and after.
- **Choices:** Keep it | Keep it, only for some projects | Drop it
- **Takes:** 10 minutes.
- **Then:** Keep it: the phase is built. Only for some projects: name them, and a `rehearse` list goes in keel's config. Drop it: `keel release` stops rehearsing, and phase 52's drafts carry the load.
- **Ready when:** three releases have been rehearsed.

## Real surfaces

- Owner's machine: `keel release` cloning, installing and checking every fleet project.
- Fleet over time: three releases' fleet rounds.

## Proof

Automated: `node --test tests/fleet.test.mjs tests/release.test.mjs` (stubbed projects that pass, fail with the release, and are already red); `npm run check`.
Over time: the fleet rounds before and after, in the evidence.

## Deliberately open

- **Release time**: the slowest project's install and check (about 5 to 10 minutes today). Its effect: fewer, larger releases. Settled by the comparison.
- **A flaky project check** can refuse a release that is fine. The refusal names the tail; `--despite` with the reason is the way through, and a project that needs it twice is a lesson for that project.

## Next action

⚑ Walk: cut the next three releases through the rehearsal, then compare their fleet rounds (FAILED rows, draft PRs, releases per day) with v0.8.23 to v0.8.26 in this phase's evidence, and answer Your part.

## Trajectory

- **2026-10-09** — The rehearsal runs after keel's own gate (on the bumped tree) and before the commit, as Scope says; so a refusal puts every file back byte for byte, as a failing gate does. Nothing is committed or tagged and the tree is as it was. The WHATSNEW line for `--despite` is the owner's reason, written before the rehearsal runs; the commit message adds what the rehearsal found for that project.
- **2026-10-09** — The candidate is the release's own checkout: `practices/` and `migrations/` under its root, at the practice version the release carries (`to`). Run alone, `--rehearse` uses the next patch when the practice changed since its last release, because update to the version a project already has would change nothing. update runs without `--yes`, so it stops at its ⚑ push: the stop is update's own, not a new flag.
- **2026-10-09** — Four at once needs threads: update, its check and main's check are synchronous child processes. Each project rehearses in a worker thread (`lib/fleet-rehearse.mjs`); fleet update's commands keep their 15-minute timeout, and the update's own check now has it too (`checkTimeout`, the fleet's only; fleet update passes it as well).
- **2026-10-09** — Only "passes on main, fails with the release" refuses; main's check not finishing counts as that (as phase 52 makes it a draft). An update step that throws (a project's own edit of a managed file, say) is reported as not rehearsed, never a refusal, like a failed clone or install. No `--no-rehearse`: the phase names only `--despite`.
