---
status: built
since: 2026-10-07
goal: G0
spec: 2
depends: [32]
note: "Built and walked: owes: walk, lived-in opt-in, phases_stuck skipping a walk owed. keel runs it (34 of 46 built, 11 owe a walk); in the fleet, cajones (the one project on keel's roadmap script) took v0.8.16 to v0.8.20 green with its lived-in kept by migration 0006; duo, ledger and isocan keep their own phases."
evidence: ["evidence/2026-10-07-walks-and-lived-in.md"]
issue: 28
---

# A walk owed does not block the next phase, and lived-in is a project's choice

## Done when

keel's own roadmap runs with lived-in off (its headline counts built, not lived-in), every keel phase whose building is done and whose rest is a walk or time is marked `owes: walk`, and `keel next` names the next buildable phase instead of one waiting on a walk; no phase is built that was not proven.

## Scope

The design is [Walks owed, and lived-in by choice](../research/2026-10-07-walks-and-lived-in.md).

- **Lived-in, opt-in**: `"phases": { "livedIn": true }` in `.keel/keel.json`, default off. Off: the roadmap's headline and goal lines count built only, the phases README and template do not ask for it, and keel's own next actions stop saying "Lived-in after…". A `lived-in` status stays valid and done.
- **`owes: walk`**: a front-matter field, valid only on `partial`. Its dependents' `depends:` are satisfied; `keel next` skips it; the roadmap shows "partial, walk owed"; the night's `phases_stuck` does not count it.
- **Refused**: `owes:` on any status but partial; `owes: walk` while an unchecked Acceptance box is neither "⚑ by hand" nor a command that runs on a real surface (`gh …`).
- **keel's records**: phases 10, 11, 13, 34–38, 41–43 reviewed; those with nothing left to build get `owes: walk`.

## Acceptance

- [x] `nextPhase` treats a partial `owes: walk` dependency as satisfied and skips the phase itself; a plain partial dependency still blocks; mutation: ignoring `owes` fails the test. `tests/roadmap.test.mjs`
- [x] The roadmap check refuses `owes: walk` on a built or planned phase, and on a partial phase with an unchecked buildable box (one naming a `tests/` file). `tests/roadmap.test.mjs`
- [x] With `livedIn` off the roadmap headline counts built only and names no lived-in count; with it on, as before. `tests/roadmap.test.mjs`
- [x] `phases_stuck` does not count a partial `owes: walk` phase. `tests/improve-measures.test.mjs`
- [x] keel's own roadmap: `node scripts/roadmap.mjs --next` names a buildable phase while walks are owed, and `docs/ROADMAP.md`'s headline counts built. `node scripts/roadmap.mjs --next`
- [x] ⚑ by hand: the fleet update after the release: duo's and cajones's roadmaps regenerated and their checks green (ledger and isocan do not run this script).

## Real surfaces

- Adopted project: the next fleet update carries it to ledger, duo, cajones and isocan, and each roadmap check still passes there.

## Proof

- Automated: `node --test tests/roadmap.test.mjs tests/improve-measures.test.mjs`, with the mutation above; `npm run check`.
- On keel: `node scripts/roadmap.mjs --next` and the regenerated `docs/ROADMAP.md`.
- In the fleet: the update PRs' checks green.

## Deliberately open

- **The projects shape (isocan's docs/projects/*/phases.md)**: read-only to keel today; `owes:` applies to keel's phase files only. Its effect: isocan's roadmap is unchanged. Settled when that shape becomes writable.
- **Whether a walk owed for weeks should be named on the night**: `phases_stuck` stops counting it, so a forgotten walk could go quiet; the Next action still names it, and loose-ends lists ⚑ steps. Settled after a month of use.

## Next action

None.

## Trajectory

- **2026-10-07** — The walk rule stayed narrow: only a box that says ⚑ by hand, or whose check is a `gh …` command, is a walk; any other unchecked box counts as buildable, so `owes: walk` is refused rather than hiding work. Phases 10 and 11's boxes were walks in fact and are now worded as ⚑ steps.
- **2026-10-07** — The owes rule is in the phases README and the planning guide, not the agent cold start, which was at 3177 of 3200 characters.
- **2026-10-07** — The fleet walk: cajones, the only adopted project on keel's roadmap script, took every update from v0.8.16 to v0.8.20 with its checks green (duo#81's and cajones#54's checks, then each release's); migration 0006 kept its lived-in, so its roadmap's headline did not change. duo, ledger and isocan keep their own phases and never ran this script. Codex's reviews of v0.8.15–v0.8.17 found the walk-owed rules' edges (six rounds, each fixed), and that 0.8.15 dropped a project's lived-in silently (migration 0006).
