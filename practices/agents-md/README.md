# agents-md

**The failure it prevents.** Working rules copied into each harness's own
file (`CLAUDE.md`, `.cursorrules`, …), each a fork that can't hear the others.

**The rule.** `AGENTS.md` is the one working guide. `CLAUDE.md` is one line
pointing at it. Keel owns only the `<!-- keel:begin <id> -->` … `<!-- keel:end
<id> -->` regions, one per practice; everything else in `AGENTS.md` is the
project's.

**Its files.** `AGENTS.md` (seeded skeleton with an empty region per
practice), `CLAUDE.md` (managed), and the `agents-md` block (⚑ steps).

**Lineage.** isocan's "one file, many doorways" (keel design §2).

**Ancestors (phase 16, 3 Oct 2026).** What keel decided for the projects this
practice came from, where each keeps a version of its own:

- **isocan** and **ledger**: *on*. Their `AGENTS.md` keeps every byte; the
  on practices' blocks are appended under "The keel practice", and
  `CLAUDE.md` becomes the one-line doorway.
