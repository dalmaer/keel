---
status: built
since: 2026-10-02
goal: G0
depends: [0]
note: "Seven practices (base, agents-md, phases, evidence, lessons, conduct, ci) render keel's own files; render --self --check in npm run check keeps the two copies one. Not yet rendered into a real project."
evidence: ["evidence/2026-10-02-practices.md"]
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

- [x] Every practice file on keel is accounted for by exactly one practice.
- [x] A render onto keel is a no-op (`git diff --exit-code`).
- [x] A render into an empty temp directory produces a tree whose `npm run check` passes after one generated phase.
- [x] `conduct`'s `practice.json` pins `source: dglazkov/isocan .claude/skills/conduct/SKILL.md @ 7227f325`.
- [x] Project names in templates come from config; none says "Keel" or "Cajones" by accident.

## Proof

`node --test tests/practices.test.mjs`; `node scripts/render.mjs --self --check` (exit 0, and exit 1 after a managed file is edited); the temp-directory render followed by its own `npm run check`.

## Deliberately open

- Template syntax. **Settled 2026-10-02:** `{{name}}`, `{{tagline}}`, `{{repo}}`
  and nothing more; an unknown or empty placeholder is an error, and `${{ }}`
  (Actions) passes through.
- AGENTS.md blocks. **Settled 2026-10-02:** one block per practice, so a project
  can switch a practice on or off without touching the others.

## Next action

None; phase 2 wraps the renderer in the CLI.

## Trajectory

- **2026-10-02** — `.keel/keel.json` is the renderer's *input*, not a seeded file: seeding it would need its own copy of the practice list (lesson 7). `init` (phase 3) writes it; `--into` requires it.
- **2026-10-02** — Shipped text must name a lesson's shape, never keel's row number: a new project's lessons table is empty, so "(lesson 2)" pointed at nothing. Found by rendering into an empty directory.
