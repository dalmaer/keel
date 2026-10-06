---
status: partial
since: 2026-10-06
goal: G3
depends: [8, 30]
note: "Built: keel learn distill (a worksheet from files only; family, reword, tag and promote proposals as public docs/inbox files; decide applies them, keeping provenance and the old words in docs/lessons-history.md; docs/patterns.md generated). Waits on the real pass: the conductor proposes over keel's 56 rows, the owner decides, and a release carries it."
evidence: ["evidence/2026-10-06-distill.md"]
issue: 9
---

# The lessons table is distilled into patterns, and patterns become guards

## Done when

One distilling pass over keel's catalogue has been proposed by an agent and decided by the owner: `docs/patterns.md` holds its families, every row is tagged or deliberately universal, and at least one family's guard has been proposed as a practice check that every project runs.

## Scope

The design is [Lessons by stack and by pattern](../research/2026-10-06-lessons-by-stack-and-pattern.md), part 2.

- **Families.** `docs/patterns.md` (keel's only): each family has a rule, a
  guard recipe and its member rows by number. The table stays the
  append-only record; a row can belong to one family.
- **`keel learn distill`.** Deterministic, no model: writes a worksheet
  (the catalogue, the current families, rows since the last pass) and
  records proposals made by an agent, as `learn propose` does. Kinds:
  `family`, `reword`, `tag` (with the evidence, where each incident
  happened), `promote` (a family's guard becomes a practice-change proposal).
  Each proposal must cite rows by number; one that cites none is refused.
- **Decisions.** `keel learn decide` takes them; accepting a `reword` keeps
  the old wording in the row's history line, never silently replaced;
  accepting `tag` fills the `Where` cell (phase 30); accepting `promote`
  opens the practice checklist.
- **Cost.** A pass spends model tokens, so it runs when the owner asks (after
  a large inbox), never from the night.

## Acceptance

- [x] `distill` writes the worksheet and records each proposal kind; a proposal citing no row, or an unknown row, or an unknown tag, is refused (exit 2). `tests/distill.test.mjs`
- [x] Accepting a family writes `docs/patterns.md` with members and keeps every member's number and provenance; accepting a reword keeps the old text in the row's history; both are tested on a synthetic catalogue, with a mutation that drops provenance failing. `tests/distill.test.mjs`
- [x] Nothing in the pass reads the private inbox: a test runs distill with no gh at all. `tests/distill.test.mjs`
- [ ] The real pass on keel's ~55 rows: proposals made, the owner's decisions recorded, the catalogue and `docs/patterns.md` released.
- [ ] One accepted `promote` becomes a practice change (its check shipped and released), or the owner declines every promote with a reason.

## Proof

- Automated: `node --test` on the learn tests, with a synthetic catalogue;
  the mutations named above.
- By hand: the real pass, its worksheet and proposals read by the owner, and
  the release that carries the result.

## Deliberately open

- **A concern axis (testing, concurrency, data, UI, CI, agents).** Families
  may make it unnecessary; settled after the first pass.
- **How often to distill.** On request for now; perhaps proposed by the night
  when the catalogue has grown by N rows since the last pass.

## Next action

The conductor runs the real pass over keel's catalogue (family, tag, reword and promote proposals in docs/inbox/, each citing rows); ⚑ the owner decides each; then a release carries the catalogue, docs/patterns.md and every project's re-rendered view.

## Trajectory

- **2026-10-06** — Rewording keel's own rows cannot break `keel lessons` dedupe: keel's rows are never sent home (keel is home); a shape reword still records the old fingerprint in docs/lessons-history.md.
- **2026-10-06** — A decide that changes the catalogue re-renders keel's own view itself, so a decision never leaves keel's check red; a distill proposal's claim is the agent's own words, though it still carries learn's generic "data sent from elsewhere" line.
