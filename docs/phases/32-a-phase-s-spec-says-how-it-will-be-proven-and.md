---
status: planned
since: 2026-10-06
goal: G0
depends: [0, 1]
note: "From the spec-rigour analysis: 1 of 139 acceptance boxes names a test, and a phase left as the template passes the roadmap check. Lints for observable specs, checks named per box, and a Real surfaces section scaled to where the change runs. Design: research/2026-10-06-spec-rigor.md."
evidence: []
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

## Acceptance

- [ ] A phase holding template text, or with an empty Done when, Acceptance or Proof, fails `node scripts/roadmap.mjs --check` with the section named; mutation: an empty placeholder list lets it pass and fails the test. `tests/roadmap.test.mjs`
- [ ] A new phase's box naming no test, command or ⚑ fails the check; an old phase's is reported as `acceptance-unchecked` by `keel doctor` and changes no file. `tests/roadmap.test.mjs`, `tests/doctor.test.mjs`
- [ ] A phase naming a Real surface with no proof line for it fails; `none` passes with no proof line. `tests/roadmap.test.mjs`
- [ ] keel's own 34 phases pass, with every lint listed in the evidence file rather than fixed by rewriting. `npm run check`

## Real surfaces

- Adopted projects: the phases practice's `scripts/roadmap.mjs` ships to every project with phases on; proof is one adopted project (cajones) updated and its roadmap check green.

## Proof

- Automated: `node --test tests/roadmap.test.mjs tests/doctor.test.mjs`, with the mutations named above; `npm run check`.
- By hand: cajones taken through `keel update` to the release; its own `npm run check:all` green.
- ⚑ The update PR in cajones (the owner merges).

## Deliberately open

- **Whether an old phase's unchecked boxes ever become failures.** Not by a
  date: when a phase is next edited, it is brought up to date.

## Next action

Collect the template's placeholder sentences into one exported list in `scripts/roadmap.mjs`, and write the failing test for a template-only phase.
