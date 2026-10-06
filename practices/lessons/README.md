# lessons

**The failure it prevents.** The same bug, paid for twice, because the first
time was recorded as an incident rather than a shape (and so nobody added a
guard).

**The rule.** `docs/lessons.md` holds shapes, each with what it cost and the
guard that now catches it. Read the table before adding a guard. A project's
rows are its own; `keel lessons` (phase 7) sends new ones home.

**Its files.** `docs/lessons.md` (seeded: a header and an empty table — keel's
central catalogue is not copied into projects; its `seat` is `lessons`, so a
project whose `.keel/keel.json` names another `lessons` path keeps its table
there and nothing is seeded beside it); `docs/keel-lessons.md` (managed,
generated, never edited by hand: keel's lessons that apply to this project);
the `lessons` block of `AGENTS.md`, which names both.

**Where a lesson applies (phase 30).** Keel's catalogue has a fifth column,
`Where`: empty for a lesson every project reads, else tags from the closed
vocabulary in `stacks.json` (node, web, vercel, gcp, firebase, github-pages,
github-actions), each tag with a meaning and the file evidence that detects
it. A tag is a fact about where a failure happened, never a guess, and a new
tag is a decision like any practice change. A project declares its stack as
`"stack"` in `.keel/keel.json`; `keel adopt` and `keel init` record what the
files show, and `keel doctor` reports `stack-unknown` (a tag outside the
vocabulary) and `stack-evidence` (the declaration and the evidence disagree,
either way; a note when nothing is declared). `docs/keel-lessons.md` is every
universal row plus the rows whose `Where` meets the stack, in catalogue order,
with keel's numbers and provenance; its source is the catalogue this keel
carries (the package ships `docs/lessons.md`). Untagged means everyone reads
it, so a tag only narrows. A project's own table keeps four columns, and its
fingerprints and `.keel/sent.json` never move for any of this. Reader:
`lib/stacks.mjs`.

**From rows to patterns (phase 31, keel only).** `keel learn distill`
prints a worksheet: every catalogue row (number, cells, `Where`, provenance,
family), the families decided so far, the open proposals, and the rows added
since the last pass. It is deterministic: no model, no `gh`, never the
private inbox. An agent reads it and records proposals with `keel learn
distill propose --kind family|reword|tag|standardise`, each citing rows by number
(an unknown row, tag, family or practice is refused, exit 2); a person
decides each with `keel learn decide`. A **family** (two rows or more, a row
in one family at most) joins `docs/patterns.md`, generated from the accepted
proposals and the catalogue: a rule, a guard recipe and the member rows with
their numbers and provenance. A **reword** replaces one cell; the old words
are appended to `docs/lessons-history.md` (with the old fingerprint, for a
shape) and a shape keeps its provenance. A **tag** fills `Where`
(`universal` leaves it empty, deliberately). A **standardise** turns a family's
guard into a practice change: the checklist, and an inert migration stub only
when one is needed. A row changed since a proposal read it is refused. A
decision that changes the catalogue re-renders keel's practices, so
`docs/keel-lessons.md` is never stale. A pass spends an agent's tokens, so it
runs when the owner asks, never from the night. Reader: `lib/distill.mjs`.

**Lineage.** ledger's lessons table, carried by duo and cajones.

**Ancestors (phase 16, 3 Oct 2026).** What keel decided for the projects this
practice came from, where each keeps a version of its own:

- **isocan**: *keel takes isocan's location*. Its table is
  `docs/reviews/lessons.md`; adopt records it as `lessons` in
  `.keel/keel.json`, seeds no second table, and the `lessons` block names it
  (`{{lessons}}`). `keel lessons`, doctor, fleet and improve read that path.
- **ledger**: *on*, at `docs/lessons.md` — this practice's origin.
