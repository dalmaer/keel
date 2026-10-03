# base

**The failure it prevents.** A project whose gate is spread across commands
nobody remembers, run on whatever Node happens to be installed. CI and a
person then check different things.

**The rule.** One `npm run check` is the gate, locally and in CI. Node is
pinned in `.nvmrc`. Zero runtime dependencies, no build step.

**Its files.** `package.json`, `.nvmrc`, `.gitignore` — all seeded: the project
owns them from the first render, and keel never writes them again.

**Lineage.** Keel's own repo floor (phase 0), from isocan's house rules.
