# Job: lessons

**The number:** the rows of the project's lessons table (`.keel/keel.json`
`"lessons"`, default `docs/lessons.md`) added since the last distill pass.
`climb.mjs measure lessons` prints it. This job changes no code and no row:
it writes proposals, and the owner decides each.

**Start with the worksheet:** `node scripts/keel/climb.mjs distill` — every
row with its cells and provenance, the families the owner accepted, the
proposals still open, and which rows are new since the last pass.

**What to propose** (`node scripts/keel/climb.mjs distill propose …`, each
with `--read` citing the table and the code you checked; the script commits
each one alone under `.keel/climb/lessons/`):

- `--kind family --name "…" --rule "…" --guard "…" --rows 3,7` — two rows or
  more that are one shape, with the one rule and the one guard recipe that
  covers them all. A row belongs to one family.
- `--kind reword --row 7 --shape|--cost|--guard "…"` — one cell that says the
  incident where it should say the shape, or a guard that is "to write"
  when the code already has one (name it). The old words are kept.
- `--kind promote --family "…" --check "…"` — a family the owner accepted,
  whose guard should become a check the project runs.

Propose only what the rows and the code show; nothing is a fine night.

**Not this job:** editing the table, a proposal file, or anything else (the
guard refuses all of it); deciding; sending a lesson home (the owner does,
with `keel lessons`).
