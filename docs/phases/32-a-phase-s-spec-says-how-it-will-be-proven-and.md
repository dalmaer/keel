---
status: partial
since: 2026-10-06
goal: G0
spec: 2
depends: [0, 1]
note: "Built and proven in keel: template text and empty sections fail roadmap --check; spec 2 phases name a check per box and their Real surfaces; old phases get an acceptance-unchecked note; proofs_hold runs nightly. Waits on its own Real surface: cajones updated to the release that carries it (owner merges)."
evidence: ["evidence/2026-10-06-spec-rigor-checks.md"]
issue: 10
---

# A phase's spec says how it will be proven, and an empty one fails the check

## Done when

`roadmap --check` refuses a phase that still holds `keel phase new`'s template text or an empty Done when, Acceptance or Proof; every acceptance box in a new phase names its check (a test, a command, or ⚑ by hand); and the phase template asks for its Real surfaces, each needing one proof in that place.

## Scope

The design is [How rigorous is a keel spec](../research/2026-10-06-spec-rigor.md), lever 1.

- **Template text is refused.** `scripts/roadmap.mjs` (the phases practice)
  knows the template's placeholder sentences and fails on any left in a
  section, at any status. One source: the template and the check read the
  same list.
- **Each acceptance box names its check**: `tests/<file>: "<test name>"`, a
  command in backticks, or `⚑ by hand: <who>`. For a phase drafted after
  this ships, a box with none fails the check. For existing phases it is a
  lint (`acceptance-unchecked`) in doctor and the night, never a rewrite.
- **Real surfaces.** The template gains the section, with a closed list
  (published package, workflow shell, adopted project, owner's machine,
  GitHub API, fleet over time, or none). Each named surface needs a line in
  Proof that runs there; `none` is a full answer, so a doc phase stays small.
- **The conduct skill** briefs the builder with the phase's Real surfaces,
  and the conductor's verify step walks one proof per surface.
- When phase 33's ledger exists, a box citing a test is checked: the test
  exists and passed in the last recorded gate run.
- **`proofs_hold`**, a night measure (bound 0): every built phase's cited
  tests still exist and passed in the last recorded run (phase 33's ledger),
  and every path its evidence names still exists. A built phase that fails
  is flagged *proof lost* on the health page; the night never steps it back,
  a person (or phase 38's tend pass, by proposal) does.

## Acceptance

- [x] A phase holding template text, or with an empty Done when, Acceptance or Proof, fails `node scripts/roadmap.mjs --check` with the section named; mutation: an empty placeholder list lets it pass and fails the test. `tests/roadmap.test.mjs`
- [x] A new phase's box naming no test, command or ⚑ fails the check; an old phase's is reported as `acceptance-unchecked` by `keel doctor` and changes no file. `tests/roadmap.test.mjs`, `tests/doctor.test.mjs`
- [x] A phase naming a Real surface with no proof line for it fails; `none` passes with no proof line. `tests/roadmap.test.mjs`
- [x] `proofs_hold` flags a built phase whose cited test was deleted or failed in the last ledger run, or whose evidence names a missing path, and changes no phase file. Without a ledger (before phase 33) it checks the cited test files and evidence paths only, and says the ledger half is n/a, never zero. `tests/improve.test.mjs`
- [x] keel's own phases (39) pass, with every lint listed in the evidence file rather than fixed by rewriting. `npm run check`
- [ ] ⚑ by hand: cajones taken through `keel fleet update` to the release carrying this phase, its own `npm run check:all` green on the update PR, and the owner merges it.

## Real surfaces

- Adopted project: the phases practice's `scripts/roadmap.mjs` ships to every project with phases on; proof is one adopted project (cajones) updated and its roadmap check green.

## Proof

- Automated: `node --test tests/roadmap.test.mjs tests/doctor.test.mjs`, with the mutations named above; `npm run check`.
- By hand: cajones taken through `keel update` to the release; its own `npm run check:all` green.
- ⚑ The update PR in cajones (the owner merges).

## Deliberately open

- **Whether an old phase's unchecked boxes ever become failures.** Not by a
  date: when a phase is next edited, it is brought up to date.

## Next action

Release the practice, take cajones through `keel fleet update` to it, and walk its own `npm run check:all` on the update PR (the owner merges); then this phase is built.

## Trajectory

- **2026-10-06** — Spec problems fail `roadmap --check` only; writing and listing the roadmap still read a draft, so `keel phase new` keeps working and a draft is never rolled back. Builder's call, kept.
- **2026-10-06** — Superseded phases are exempt from the template-text rule: a draft retired with its goal (`goal retire --phases supersede`) owes nothing. Builder's call, kept.
- **2026-10-06** — New and old phases are told apart by `spec: 2` in front matter, written by the template; keel's 27 older built phases get an `acceptance-unchecked` note, never a failure or a rewrite.
- **2026-10-06** — A Real surfaces bullet's proof is the text after its colon (`- Workflow shell: <the proof>`); the check can hold that mechanically, where "a matching Proof line" it could not.
