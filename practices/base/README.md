# base

**The failure it prevents.** A project whose gate is spread across commands
nobody remembers, run on whatever Node happens to be installed. CI and a
person then check different things.

**The rule.** One `npm run check` is the gate, locally and in CI. Node is
pinned in `.nvmrc`. Zero runtime dependencies, no build step.

**A gate that ran nothing fails** (keel's lessons 14 and 38, standardised
6 Oct 2026). Where `npm test` is node's runner with the night practice's test
ledger beside it (`keel init` wires it; migration 0004 adds it), a run that
executed no test exits 1, "no tests ran", even though node alone would pass
it. A project with no tests yet sets `"tests": {"allowEmpty": true}` in
`.keel/keel.json`. Another runner is left alone; its own empty-run flag is
the project's to set.

**Its files.** `package.json`, `.nvmrc`, `.gitignore` — all seeded: the project
owns them from the first render, and keel never writes them again.

**Lineage.** Keel's own repo floor (phase 0), from isocan's house rules.
