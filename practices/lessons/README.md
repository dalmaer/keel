# lessons

**The failure it prevents.** The same bug, paid for twice, because the first
time was recorded as an incident rather than a shape (and so nobody added a
guard).

**The rule.** `docs/lessons.md` holds shapes, each with what it cost and the
guard that now catches it. Read the table before adding a guard. A project's
rows are its own; `plates lessons` (phase 7) sends new ones home.

**Its files.** `docs/lessons.md` (seeded: a header and an empty table — plates's
central catalogue is not copied into projects; its `seat` is `lessons`, so a
project whose `.plates/plates.json` names another `lessons` path keeps its table
there and nothing is seeded beside it); `docs/plates-lessons.md` (managed,
generated, never edited by hand: plates's lessons that apply to this project);
the `lessons` block of the selected working guide, which names both.

**Where a lesson applies (phase 30).** Plates's catalogue has a fifth column,
`Where`: empty for a lesson every project reads, else tags from the closed
vocabulary in `stacks.json` (node, web, vercel, gcp, firebase, github-pages,
github-actions), each tag with a meaning and the file evidence that detects
it. A tag is a fact about where a failure happened, never a guess, and a new
tag is a decision like any practice change. A project declares its stack as
`"stack"` in `.plates/plates.json`; `plates adopt` and `plates init` record what the
files show, and `plates doctor` reports `stack-unknown` (a tag outside the
vocabulary) and `stack-evidence` (the declaration and the evidence disagree,
either way; a note when nothing is declared). `docs/plates-lessons.md` is every
universal row plus the rows whose `Where` meets the stack, in catalogue order,
with plates's numbers and provenance; its source is the catalogue this plates
carries (the package ships `docs/lessons.md`). Untagged means everyone reads
it, so a tag only narrows. A project's own table keeps four columns, and its
fingerprints and `.plates/sent.json` never move for any of this. Reader:
`lib/stacks.mjs`.

**From rows to patterns (phase 31, plates only).** `plates learn distill`
prints a worksheet: every catalogue row (number, cells, `Where`, provenance,
family), the families decided so far, the open proposals, and the rows added
since the last pass. It is deterministic: no model, no `gh`, never the
private inbox. An agent reads it and records proposals with `plates learn
distill propose --kind family|reword|tag|standardise`, each citing rows by number
(an unknown row, tag, family or practice is refused, exit 2); a person
decides each with `plates learn decide`. A **family** (two rows or more, a row
in one family at most) joins `docs/patterns.md`, generated from the accepted
proposals and the catalogue: a rule, a guard recipe and the member rows with
their numbers and provenance. A **reword** replaces one cell; the old words
are appended to `docs/lessons-history.md` (with the old fingerprint, for a
shape) and a shape keeps its provenance. A **tag** fills `Where`
(`universal` leaves it empty, deliberately). A **standardise** turns a family's
guard into a practice change: the checklist, and an inert migration stub only
when one is needed. A row changed since a proposal read it is refused. A
decision that changes the catalogue re-renders plates's practices, so
`docs/plates-lessons.md` is never stale. A pass spends an agent's tokens, so it
runs when the owner asks, never from the night. Reader: `lib/distill.mjs`.

**Lineage.** ledger's lessons table, carried by duo and cajones.

**Ancestors (phase 16, 3 Oct 2026).** What plates decided for the projects this
practice came from, where each keeps a version of its own:

- **isocan**: *plates takes isocan's location*. Its table is
  `docs/reviews/lessons.md`; adopt records it as `lessons` in
  `.plates/plates.json`, seeds no second table, and the `lessons` block names it
  (`{{lessons}}`). `plates lessons`, doctor, fleet and improve read that path.
- **ledger**: *on*, at `docs/lessons.md` — this practice's origin.
