---
status: planned
since: 2026-10-06
goal: G3
depends: [7, 8]
note: "Specced 6 Oct after a 131-item inbox: tag keel's catalogue by stack (evidence-backed, universal by default), declare each project's stack, ship the filtered view. Design: research/2026-10-06-lessons-by-stack-and-pattern.md."
evidence: []
issue: 8
---

# Each project reads the lessons that apply to its stack

## Done when

An agent in ledger (node, vercel) and one in isocan (node, gcp) each read a `docs/keel-lessons.md` holding every universal row of keel's catalogue plus the rows tagged for their own stack, and neither holds a row tagged only for the other's.

## Scope

The design is [Lessons by stack and by pattern](../research/2026-10-06-lessons-by-stack-and-pattern.md), part 1.

- **The vocabulary.** `practices/lessons/stacks.json`: closed, each tag with
  a meaning and its file evidence. Starts with node, web, vercel, gcp,
  firebase, github-pages, github-actions.
- **The column.** keel's catalogue gains `Where` (empty = universal). Keel's
  table only; a project's table keeps four columns and its fingerprints.
  Tagging the current rows is phase 31's first `tag` pass; until then every
  row is universal, which is the safe default.
- **The project's stack.** `"stack"` in `.keel/keel.json`, validated against
  the vocabulary. `keel adopt` detects and records it; `keel doctor` lints
  `stack-evidence` when the evidence and the declaration disagree.
- **The view.** The lessons practice ships managed `docs/keel-lessons.md`:
  universal rows plus rows whose `Where` meets the stack, in catalogue
  order, numbers and provenance kept. The lessons AGENTS block names it.
  `keel update` re-renders it; `render --check` catches a stale one.

## Acceptance

- [ ] An unknown tag in `stacks.json`, the catalogue or a project's `stack` fails (a test and a doctor lint), never passes silently.
- [ ] Detection: a synthetic repo with `vercel.json` and a workflow is detected as vercel and github-actions; one with neither is not; `stack-evidence` fires both ways (declared without evidence, evidence without declaration).
- [ ] The view: for a catalogue with universal, vercel-only and gcp-only rows, a vercel project's view holds the universal and vercel rows and no gcp row; an untagged row reaches every project. Mutation: a filter that drops untagged rows fails the test.
- [ ] A project's own lessons table, its fingerprints and `.keel/sent.json` are byte-identical before and after (keel lessons sends nothing new).
- [ ] ledger and isocan declare their stacks through `keel fleet update`, and each repo's `docs/keel-lessons.md` is checked against its stack by hand.

## Proof

- Automated: `node --test` on the lessons, doctor, adopt and render tests,
  with synthetic fixtures; the mutation named above.
- By hand: fresh clones of ledger and isocan updated through keel; read both
  views and the rows each excludes.
- ⚑ The update PRs in ledger and isocan (the owner merges).

## Deliberately open

- **Tags on a project's own table.** Not in this phase: the project's table is
  its own, and its fingerprints are what `keel lessons` uses to know what it
  has sent.
- **Families in the view instead of rows.** Settled after phase 31 has run once.

## Next action

Write `practices/lessons/stacks.json` and its test (closed vocabulary, every tag with evidence), then the `Where` column parser.
