---
status: planned
since: 2026-10-12
goal: G0
spec: 2
depends: []
note: "Specified 2026-10-12 from the phase 54 collision: one shared create-only branch per phase is the claim, and keel next lists what is ready and unclaimed."
evidence: []
issue: 113
---

# A phase being built is claimed, and keel next hands out what is free

## Done when

A session claims a phase before building it, in a way every other session, provider and machine can see with git alone; `keel next` offers only phases that are ready and unclaimed; and the conduct skill claims before it builds.

## Scope

The design is [Claims, and reviews that end](../research/2026-10-12-claims-and-review-rounds.md), phase 70. On 2026-10-10 two sessions built phase 54 at once (#59 and #74), and one was thrown away.

- **The claim**: `keel phase claim <n>` pushes one shared branch, `claims/phase-<n>`, before any work. The name is the same for every provider and the push is create-only, so of two sessions claiming at once the server lets exactly one through. The claim is its own commit, naming the provider, machine, time and a random token made fresh for each attempt, so two claims are never the same commit. The work goes on `<provider>/phase-<n>`; an open PR whose branch names the phase is a claim too.
- **Refusal**: claiming a claimed phase is refused, naming who claimed it and when. `--release` deletes a claim when no work branch or PR for the phase exists.
- **The free set**: `keel next` fetches, then lists every phase whose `depends:` are built and that nobody has claimed; a claimed phase is shown as claimed, with its branch. `--json` carries both lists.
- **The skill**: the conduct skill's first step for a phase is the claim. A refusal means take another free phase, or stop.
- **Stale claims**: a claim with no push for seven days is the owner's item on the board. keel never releases another session's claim.

Not in scope: locking. A session that skips `keel next` and the skill is not stopped.

## Acceptance

- [x] `keel phase claim <n>` pushes `claims/phase-<n>`, and a second claim of the same phase, from another clone, is refused naming the holder. `tests/claim.test.mjs`
- [x] Two providers that both fetched before either pushed, each from its own clone, race the claim: exactly one succeeds, and the other is told who holds it. `tests/claim.test.mjs`
- [x] Two claims with the same git identity and a frozen clock still differ: exactly one succeeds. `tests/claim.test.mjs`
- [x] An open PR whose branch names the phase counts as a claim; a merged or closed one does not, and a claim ends when its phase is built on the default branch. `tests/claim.test.mjs`
- [x] `keel next` lists every ready, unclaimed phase and shows a claimed one as claimed; a phase whose `depends:` are not built is in neither list. `tests/claim.test.mjs`
- [x] When the fetch fails, `keel next` says the claims could not be read (exit 2), and never lists a phase as free. `tests/claim.test.mjs`
- [x] `--release` deletes a claim with no work branch or PR, and refuses one that has either. `tests/claim.test.mjs`
- [x] The conduct skill claims before it builds, and the board shows a claim idle for seven days as the owner's. `tests/skill.test.mjs`, `tests/board.test.mjs`
- [ ] ⚑ by hand: the owner runs two sessions on keel for a week and neither builds a phase the other holds.

## Your part

- **Ask:** Run two agent sessions on keel for a week, as you do now, and say whether they ever started the same piece of work.
- **Why:** Two sessions building the same thing cost a day on 2026-10-10; this shows whether marking work as taken stops it.
- **Look at:** `keel next` in each session, which shows what is taken and by whom.
- **Choices:** Never collided | Collided
- **Takes:** 5 minutes at the end of the week.
- **Then:** Never collided: the phase is built. Collided: how they missed each other goes into the design.
- **Ready when:** the claim has shipped and a week has passed.

## Real surfaces

- Owner's machine: two sessions, each running `keel next` and the conduct skill.
- GitHub API: the open PRs whose branches name a phase; the claim branches are read and pushed with git.

## Proof

Automated: `node --test tests/claim.test.mjs tests/skill.test.mjs tests/board.test.mjs` (two clones of one bare origin: claim, refuse, a two-provider race, a same-identity frozen-clock race, release, fetch failure); `npm run check`.
By hand: a week of two sessions on keel.

## Deliberately open

- **A branch, or the phase's issue**: the claim is a pushed branch because git alone can read it. A label or assignee on the phase's issue would show on GitHub's own pages, but needs the API. Settled by the owner's week: if claims are missed because nobody looked at branches, the issue gets the mark too.
- **Seven days** as stale is a guess. Settled by the week's data.
- **Known limit**: the claim is advice with a record, not a lock. A session that never runs `keel next` or the skill can still build a claimed phase; the collision then shows as a work branch for a phase another session claimed, which `keel next` reports.

## Next action

Build `keel phase claim` and the claimed and free lists in `keel next`, with `tests/claim.test.mjs` on two clones of one origin.
