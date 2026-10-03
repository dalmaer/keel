---
status: built
since: 2026-10-02
goal: G0
depends: []
note: "The practice is installed on keel by hand and holds: check passes locally and on GitHub Actions, and /conduct loads through the .claude/skills symlink. Not yet rendered from practices (phase 1)."
evidence: ["evidence/2026-10-02-bootstrap.md"]
---

# Keel is run the way it will tell others to run

## Done when

A fresh clone of keel passes `npm run check` on GitHub Actions, and `/conduct keel` can read the next phase and its next action from the repo alone.

## Scope

The practice, hand-installed on keel: `AGENTS.md`, `CLAUDE.md`, phases and goals,
the generated roadmap and its check, the lessons catalogue seeded from the fleet,
the conduct skill with its `.claude/skills` doorway, the design, the fleet survey,
and a `check.yml` workflow. No CLI yet — that is phase 2. Nothing is extracted
into `practices/` yet — that is phase 1.

## Acceptance

- [x] `npm run check` runs the roadmap tests and the stale-roadmap guard, and passes.
- [x] The roadmap guard is shown to fail on a stale roadmap, an unbuilt-but-claimed phase and a dependency cycle (tests/roadmap.test.mjs).
- [x] `npm run next` prints the next phase and its next action.
- [x] The conduct skill is keel's adaptation of isocan's at `7227f325`, reached through a committed symlink, with its source pinned.
- [x] `docs/lessons.md` holds the inherited shapes with their provenance, and keel's first own lesson.
- [x] ⚑ `dalmaer/keel` exists on GitHub (private) and `main` is pushed.
- [x] `check.yml` passes on that push.

## Proof

Automated: `npm run check` (exit 0); `npm run next`.
⚑ `gh repo create dalmaer/keel --private --source . --push` — free; creates a repo. Needs the owner's yes.
Then `gh run watch` on the push's `check` run, exit 0.

## Deliberately open

- Public or private. **Settled 2026-10-02:** private, created on the owner's "get going"; flipping later costs nothing.

## Next action

Live in it: conduct the remaining phases with it, which is what lived-in means here.

## Trajectory

*Nothing — the phase went as planned.*
