---
status: planned
since: 2026-10-07
goal: G0
spec: 2
depends: [32]
note: "The owner: lived-in feels like it slows a fast project down. It blocks nothing; partial does, when a phase's building is done and its rest is a walk or time. Lived-in becomes opt-in; owes: walk lets dependents proceed while built still means proven. Design: research/2026-10-07-walks-and-lived-in.md."
evidence: []
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
- **keel's records**: phases 10, 13, 34–38, 41–43 reviewed; those with nothing left to build get `owes: walk`.

## Acceptance

- [ ] `nextPhase` treats a partial `owes: walk` dependency as satisfied and skips the phase itself; a plain partial dependency still blocks; mutation: ignoring `owes` fails the test. `tests/roadmap.test.mjs`
- [ ] The roadmap check refuses `owes: walk` on a built or planned phase, and on a partial phase with an unchecked buildable box (one naming a `tests/` file). `tests/roadmap.test.mjs`
- [ ] With `livedIn` off the roadmap headline counts built only and names no lived-in count; with it on, as before. `tests/roadmap.test.mjs`
- [ ] `phases_stuck` does not count a partial `owes: walk` phase. `tests/improve-measures.test.mjs`
- [ ] keel's own roadmap: `node scripts/roadmap.mjs --next` names a buildable phase while walks are owed, and `docs/ROADMAP.md`'s headline counts built. `node scripts/roadmap.mjs --next`

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

Brief a builder on `owes: walk` in roadmap.mjs (parse, validate, nextPhase, render), `livedIn` in the roadmap's headline, and phases_stuck; then mark keel's walk-owed phases.
