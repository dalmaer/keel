---
status: planned
since: 2026-10-05
goal: G2
depends: [14]
note: "From isocan: a Loop finding can name the project it belongs to, and docs/LOOP.md groups accepted findings by project, so isocan can retire its own loop.mjs."
evidence: []
---

# A Loop finding can belong to a project, not only a phase

## Done when

Rendering isocan's `docs/loop/` with keel's `scripts/loop.mjs` gives
isocan's own `docs/LOOP.md` with only the generated-by line and wording
from `.keel/keel.json` `loop` differing, so isocan can take keel's script.

## Scope

isocan's `scripts/loop.mjs` files each finding under a project
(`project: <name>` in front matter, `new project` when none fits) and groups
"Accepted, by project" with a link to `docs/projects/<name>/`. keel's groups
by phase. In keel's `practices/loop/files/scripts/loop.mjs`:

- read `project:` beside `phase:`; `propose --project <name|new>` beside
  `--phase`;
- in a projects-shaped repo (`.keel/keel.json` `phases.shape: "projects"`),
  render "Accepted, by project", linking each project's directory;
- `loadFindings` and `phaseCounts` keep their shape; add `projectCounts` for
  a roadmap that counts by project;
- the intro paragraph's wording comes from `loop` config so isocan's own
  sentence survives.

## Acceptance

- [ ] A synthetic projects-shaped fixture renders by project; a phases one
  renders as before.
- [ ] isocan's findings rendered in a copy match isocan's page except the
  generated-by line.

## Proof

`npm run check`; the copy comparison, by command, in the evidence file.

## Deliberately open

Nothing.

## Next action

Build it.
