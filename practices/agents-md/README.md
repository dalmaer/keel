# agents-md

**The failure it prevents.** Working rules copied into each harness's own
file (`CLAUDE.md`, `.cursorrules`, …), each a fork that can't hear the others.

**The rule.** The selected working guide (`guide` in `.plates/plates.json`,
`AGENTS.md` by default) is the source of working rules. Adoption prefers an
existing `AGENTS.md`, then `CLAUDE.md`, or accepts an explicit `--guide`.
Safe in-repository aliases resolve to one canonical guide. Plates owns only
its `<!-- plates:begin <id> -->` … `<!-- plates:end <id> -->` regions; the rest
is the project's prose. Existing independent guides and aliases are preserved.

**Its files.** The selected guide (seeded skeleton with an empty region per
practice), an eligible managed `CLAUDE.md` doorway, and the `agents-md` block
(⚑ steps). A CLAUDE-only project uses `CLAUDE.md` itself; it needs no
`AGENTS.md` or self-pointing doorway.

**Read this before touching that (phase 65).** `.plates/plates.json`
`"contracts"` maps path patterns to the document to read before editing a
matching file. The `agents-md` block gains them as a table (without them
its bytes are unchanged). While contracts are set, render also writes
`scripts/plates/contract-hook.mjs` (managed) and seeds `.claude/settings.json`
with a `PreToolUse` hook on Edit, Write and MultiEdit that runs it. The hook
names the document and never blocks. A project that already has its own
`.claude/settings.json` keeps it; `plates doctor` notes `contract-hook` until
the hook entry is added by hand.

**What people are told keeps up (phase 18, lesson 16).** When a change
alters what a person or an agent would be told — a verb, a flag, a default, a
feature — the README and selected working guide change in the same commit. Plates can't
know a project's feature list, so the conduct skill's Record step asks it,
and `plates doctor` notes `readme-behind` when README.md's last commit is older
than the newest built phase. That note is information: it never fails the
gate, because a README can rightly stay unchanged after a phase. A project
with a CLI should go further and test its README against its own registry,
as plates's `tests/docs.test.mjs` does.

**Lineage.** isocan's "one file, many doorways" (plates design §2).

**Ancestors (phase 16, 3 Oct 2026).** What plates decided for the projects this
practice came from, where each keeps a version of its own:

- **isocan** and **ledger**: *on*. Their `AGENTS.md` keeps every byte; the
  on practices' blocks are appended under "The plates practice", and
  `CLAUDE.md` becomes the one-line doorway.
