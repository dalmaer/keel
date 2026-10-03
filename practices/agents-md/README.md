# agents-md

**The failure it prevents.** Working rules copied into each harness's own
file (`CLAUDE.md`, `.cursorrules`, …), each a fork that can't hear the others.

**The rule.** `AGENTS.md` is the one working guide. `CLAUDE.md` is one line
pointing at it. Keel owns only the `<!-- keel:begin <id> -->` … `<!-- keel:end
<id> -->` regions, one per practice; everything else in `AGENTS.md` is the
project's.

**Its files.** `AGENTS.md` (seeded skeleton with an empty region per
practice), `CLAUDE.md` (managed), and the `agents-md` block (⚑ steps).

**What people are told keeps up (phase 18, lesson 16).** When a change
alters what a person or an agent would be told — a verb, a flag, a default, a
feature — the README and `AGENTS.md` change in the same commit. Keel can't
know a project's feature list, so the conduct skill's Record step asks it,
and `keel doctor` notes `readme-behind` when README.md's last commit is older
than the newest built phase. That note is information: it never fails the
gate, because a README can rightly stay unchanged after a phase. A project
with a CLI should go further and test its README against its own registry,
as keel's `tests/docs.test.mjs` does.

**Lineage.** isocan's "one file, many doorways" (keel design §2).

**Ancestors (phase 16, 3 Oct 2026).** What keel decided for the projects this
practice came from, where each keeps a version of its own:

- **isocan** and **ledger**: *on*. Their `AGENTS.md` keeps every byte; the
  on practices' blocks are appended under "The keel practice", and
  `CLAUDE.md` becomes the one-line doorway.
