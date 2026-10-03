---
status: planned
since: 2026-10-02
goal: G0
depends: [0]
note: "Design names the three file kinds (managed, block, seeded); nothing is extracted yet."
evidence: []
---

# The practice is a set of modules keel can install, including on itself

## Done when

Keel's own practice files are rendered from `practices/<name>/`, and re-rendering them onto keel changes no bytes.

## Scope

Extract what phase 0 hand-installed into practices: `phases` (generator, test,
contract, templates), `lessons`, `evidence`, `conduct` (skill + doorway),
`agents-md` (the keel blocks of AGENTS.md), `ci`. Each has a `README.md` (the
failure it prevents, the rule, its lineage), a `practice.json` (files, each
`managed`/`block`/`seeded`, what it requires, its `source` if adapted from
upstream), and its templates. A renderer that takes a project config and writes
them. Not the CLI (phase 2) and not drift detection (phase 5).

## Acceptance

- [ ] Every practice file on keel is accounted for by exactly one practice.
- [ ] A render onto keel is a no-op (`git diff --exit-code`).
- [ ] A render into an empty temp directory produces a tree whose `npm run check` passes after one generated phase.
- [ ] `conduct`'s `practice.json` pins `source: dglazkov/isocan .claude/skills/conduct/SKILL.md @ 7227f325`.
- [ ] Project names in templates come from config; none says "Keel" or "Cajones" by accident.

## Proof

`node --test tests/practices.test.mjs`; `node scripts/render.mjs --self && git diff --exit-code`; the temp-directory render followed by its own `npm run check`.

## Deliberately open

- Template syntax. Prefer `{{name}}` replacement and nothing more; a template
  language is a dependency in disguise.
- Whether AGENTS.md is one block or one block per practice. Per practice reads
  better and diffs smaller; settle when extracting.

## Next action

List every file phase 0 created and assign each to a practice and a kind, in `docs/design.md` §1's table form, before moving any file.
