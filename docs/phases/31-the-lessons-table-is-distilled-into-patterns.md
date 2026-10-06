---
status: planned
since: 2026-10-06
goal: G3
depends: [8, 30]
note: "Specced 6 Oct: an agent-proposed, owner-decided pass that groups rows into families, rewords them generally, tags them by stack with evidence, and promotes guards that can ship. Design: research/2026-10-06-lessons-by-stack-and-pattern.md."
evidence: []
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

- [ ] `distill` writes the worksheet and records each proposal kind; a proposal citing no row, or an unknown row, or an unknown tag, is refused (exit 2).
- [ ] Accepting a family writes `docs/patterns.md` with members and keeps every member's number and provenance; accepting a reword keeps the old text in the row's history; both are tested on a synthetic catalogue, with a mutation that drops provenance failing.
- [ ] Nothing in the pass reads the private inbox: a test runs distill with no gh at all.
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

Blocked on phase 30 (the `Where` column and tag vocabulary). Then: the worksheet format and `docs/patterns.md`'s shape, with a synthetic catalogue test.
