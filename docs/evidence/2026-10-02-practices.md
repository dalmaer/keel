# Evidence: phase 1 — the practice is a set of modules

- Date: 2026-10-02
- Phase: 1
- Revision: the phase 1 commit. Built by a subagent; verified by the conductor.
- Claim being checked: keel's own practice files are rendered from
  `practices/<name>/`, a re-render changes no bytes, and a render into an
  empty directory makes a project whose own check passes.

## Automated checks (conductor, on the integrated tree)

| Command | Exit | The line that says so |
| --- | --- | --- |
| `npm run check` | 0 | `ℹ tests 15` · `ℹ pass 15` · `ℹ fail 0` · `Checked roadmap: 14 phases, 6 goals` · `Checked 20 practice targets: 6 kept, 14 same` |
| `node scripts/render.mjs --self --check` | 0 | `Checked 20 practice targets: 6 kept, 14 same` |

`tests/practices.test.mjs` (10 tests) covers:

- no target claimed by two practices, with the guard shown to fail;
- every managed target exists on keel;
- the conduct source pin;
- no stray project names in templates;
- an unknown placeholder errors;
- `--self --check` fails on a copy of keel with a mutated managed file and a
  mutated block, ignores edits outside the blocks, and passes again after a render;
- an Acme `--into` render plus one phase passes that directory's own `npm run check`;
- a second render keeps seeded files.

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| Appended a line to `scripts/roadmap.mjs`, ran `--self --check` | exit 1, naming the file | `update  scripts/roadmap.mjs (phases)`, exit 1 | The CI guard fires on the real tree, not only in the test's copy |
| Rendered into a temp dir as "Acme" and grepped for lesson numbers | none | Found `(lesson 2)`, `(lessons 4, 5)` and `#2`, which point at nothing in a new project | A real bug, reported by the builder. Fixed by naming the shape instead; re-rendered, the check passes |
| Grepped templates for dalmaer, Cajones, ledger, Keel | provenance only | Two lineage lines (phases README, roadmap.mjs) | Fixtures and templates carry no project's data |

The phase named `node scripts/render.mjs --self && git diff --exit-code` as
its proof. That command can't be run as written while the phase is
uncommitted, because it diffs against HEAD. `render --self --check`, which
compares the tree with the templates, is the proof that holds. The phase's
Proof has been corrected.

## Gaps and decision

- No `keel` CLI wraps this yet (phase 2).
- Not yet rendered into any real project (phases 3 and 4).
- Supports **built**.
