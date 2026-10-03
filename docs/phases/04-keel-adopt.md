---
status: planned
since: 2026-10-02
goal: G2
depends: [3]
note: "duo and cajones are the first candidates; both already run a hand-ported version."
evidence: []
---

# An existing project comes under keel without losing what is its own

## Done when

`keel adopt` on duo and on cajones produces a pull request a person merges, after which each project's own check passes and its `.keel/keel.json` names the practice version.

## Scope

Detect what a repo already has (phase files, a roadmap generator, lessons,
workflows, renovate, AGENTS.md sections) and map each to a practice. Existing
seeded content stays; existing hand-ports of managed files become proposals:
"yours differs from keel's here — keep yours (eject), take keel's, or send
yours upstream as a lesson". Phase metadata translation (duo's `issue`-only
front matter, ritmo's `milestone` → `goal`) is a migration, shown as a diff.

## Acceptance

- [ ] A dry run lists, per file, adopt / keep-local / conflict, and changes nothing.
- [ ] duo adopted: its roadmap, lessons and workflows still pass; the PR is merged by its owner.
- [ ] cajones adopted, the same.
- [ ] Every local difference from keel's managed version is either ejected or filed as a lesson — none silently overwritten.

## Proof

`node --test tests/adopt.test.mjs` against synthetic fixtures shaped like each project (fixtures are synthetic: "Acme"). Then the two real PRs, each with its CI run.

## Deliberately open

- ledger: it has the most local practice (Loop, parity, deploy watching). Adopt it after two simpler projects prove the boundary.
- isocan: learned from as a source; adopting it is Dimitri's call.

## Next action

Write down, for duo and cajones, every practice file each has and which keel practice it maps to — that table is adopt's test fixture.
