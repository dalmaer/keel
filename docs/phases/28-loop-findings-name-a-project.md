---
status: built
since: 2026-10-05
goal: G2
depends: [14]
note: "From isocan: a Loop finding can name its project and LOOP.md groups by project; its hedge rule (loop.hedge) and model proving on pull (loop.prove + ANTHROPIC_API_KEY) came too, opt-in. isocan's 85 findings render to its own page byte for byte."
evidence: ["evidence/2026-10-05-loop-findings-name-a-project.md"]
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

- [x] A synthetic projects-shaped fixture renders by project; a phases one
  renders as before.
- [x] isocan's findings rendered in a copy match isocan's page except the
  generated-by line. (Settled 2026-10-05: not even that line differs; isocan
  sets `loop.intro` to keep its sentence.)

## Proof

`npm run check`; the copy comparison, by command, in the evidence file.

## Deliberately open

Nothing.

## Next action

isocan's PR: set `.keel/keel.json` `loop` to `{intro, hedge: true, prove:
true}` and retire `scripts/loop.mjs` for keel's (the owner's call). keel now
carries isocan's hedge rule and model proving, both opt-in.
