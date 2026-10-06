---
status: planned
since: 2026-10-06
goal: G2
spec: 2
depends: [6, 22, 32]
note: "From Matt Pocock's /pr (skills v1.3), in keel's terms: every PR keel opens has a Summary (a picture), Evidence (before and after) and Merge danger (two-way or one-way door, blast radius from Real surfaces), from one deterministic script. Design: research/2026-10-06-pr-and-retro.md."
evidence: []
issue: 17
---

# Every PR keel opens can be judged in a minute: a picture, its evidence, its merge danger

## Done when

Every PR keel opens (fleet update, the night's data PR, and the climb and tend PRs when they exist) has a body built by `scripts/keel/pr-body.mjs` with three sections in order (Summary as a picture, Evidence as before and after, Merge danger as a two-way or one-way door with its blast radius), and a real fleet update PR in an adopted project reads that way.

## Scope

The design is [The PR a person reads](../research/2026-10-06-pr-and-retro.md).

- **`scripts/keel/pr-body.mjs`** (night practice, shipped): takes structured
  input (changed files, before/after rows, the gate's line, the door, the
  surfaces) and writes the body. Deterministic; no model.
- **Summary**: a file tree of the changed paths grouped by practice, or the
  caller's before-and-after table; never freehand prose.
- **Evidence**: rows the caller measured (a check that failed and now passes,
  numbers, the gate's result line). A body with no evidence row says
  "Evidence: none recorded" rather than omitting the section.
- **Merge danger**: `two-way` or `one-way` with the reason; the blast radius
  from Real surfaces (this project, every adopted project, the fleet over
  time). A fleet update that runs a migration rewriting project files is
  one-way for that project's history and says so.
- **Callers**: `keel fleet update` / `keel update` (lib/update.mjs), the
  night's data PR (keel-night.yml); phases 35 and 38 use it from the start.
- The keel-impact block (phase 26), when reconciliation is on, stays last.

## Acceptance

- [ ] `pr-body.mjs` writes the three sections in order from structured input; a missing evidence row is written as "none recorded", never dropped; mutation: dropping Merge danger fails the test. `tests/pr-body.test.mjs`
- [ ] A fleet update whose migrations rewrite project files is marked one-way, a re-render only two-way. `tests/update.test.mjs`
- [ ] The night's data PR body comes from `pr-body.mjs`, and its inline script passes `bash -n` and `node --check`. `tests/workflows.test.mjs`
- [ ] ⚑ by hand: one real fleet update PR, in an adopted project, read by the owner in that form.

## Real surfaces

- GitHub API: PR bodies written through `gh pr create` in fleet update and the night.
- Adopted project: the next fleet update PR in an adopted project.

## Proof

- Automated: `node --test tests/pr-body.test.mjs tests/update.test.mjs tests/workflows.test.mjs`, with the mutation above; `npm run check`.
- By hand: the fleet release's update PRs read in their new form.
- ⚑ The update PRs (the owner merges).

## Deliberately open

- **The conductor's commit bodies.** They stay prose arguments (the record
  of why); the three sections are for PRs a person must judge quickly.

## Next action

Write `pr-body.mjs` and its test from a synthetic fleet update's input.
