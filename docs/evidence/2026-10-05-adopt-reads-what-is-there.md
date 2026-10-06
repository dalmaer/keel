# Evidence: phase 29 — keel takes what isocan learned about lanes, tables and workflows

- Date: 2026-10-05
- Phase: 29 (`docs/phases/29-adopt-reads-what-is-there.md`)
- Revision: base `69e4cfc` (phases 27–29: what isocan does better comes home), working tree
- Claim being checked: keel's `renovate.json` renders a project's workspace
  rule and timezone, so isocan could take it without losing a rule; `keel
  doctor` names the three other ways a lessons table splits, each by line;
  `keel adopt` calls a claude-code-action workflow local only when a mention
  can start it.

## Automated checks

- `node --import ./tests/helpers/hermetic.mjs --test tests/renovate.test.mjs`
  — exit 0, `ℹ tests 4 ℹ pass 4 ℹ fail 0`. New: an Acme fixture with
  `workspaces: ["packages/*", "tools/cli"]` renders a first rule
  `enabled: false` naming `@acme/**`, `acme`, `acme-cli` (one shared scope as
  a pattern; two scopes stay exact names; a directory with no `name` is
  skipped), the four lanes after it unchanged;
  a fixture without workspaces, and one with no package.json, render the
  template byte for byte; `timezone` lands beside `schedule`, a bad one is
  refused, and the facts never serialize into `.keel/keel.json`; the Node
  lane is one weekly, person-read PR across nvm, dockerfile and npm.
- `node --import ./tests/helpers/hermetic.mjs --test tests/doctor.test.mjs`
  — exit 0, `ℹ tests 25 ℹ pass 25 ℹ fail 0`. New: a synthetic table with
  prose between rows (line 8), a row stranded under `## Habits` (line 16) and
  a second header row (line 18) gives exactly three `lessons-table-split`
  findings naming those lines, through `keel doctor --json` too (exit 1);
  the night's blank-line lint sees none of them; joined into one table it is
  clean; the existing blank-line fixture adds no second finding.
- `node --import ./tests/helpers/hermetic.mjs --test tests/adopt.test.mjs`
  — exit 0, `ℹ tests 22 ℹ pass 22 ℹ fail 0`. New: a workflow running
  claude-code-action on `schedule` and `workflow_dispatch` leaves `claude`
  off, not local, with the reason naming the file and its triggers; `--with
  claude` still switches it on; the same workflow with `issue_comment` added
  is local. `workflowTriggers` reads `on:` inline, as a list and as a block.
  The existing local-claude fixture gained an `on: issue_comment` (it had no
  trigger at all).
- `node --import ./tests/helpers/hermetic.mjs --test tests/practices.test.mjs`
  — exit 0, `ℹ pass 10 ℹ fail 0` (keel's own `renovate.json` and lock
  re-rendered for the Node lane's new description).
- The whole gate, `npm run check`, is the conductor's, on the integrated tree.

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| Rendered keel's `renovate.json` (`plan`) for a temp dir holding isocan's root and workspace `package.json`s and a keel.json with `timezone: America/Denver` | every rule of isocan's own `renovate.json` present | timezone `America/Denver`; first rule disables `@isocan/**` and `isocan` (19 workspace packages share the scope), as isocan's own did; patch-minor, weekly and node rules identical to isocan's but for descriptions; no top-level key of isocan's missing; `ignorePaths` `**/fixtures/**` covers isocan's `test/fixtures/**` | isocan can take keel's file losing no rule |
| `lessonsTableShapes` on `git show ea9983851:docs/reviews/lessons.md` (isocan before its fix) and on `7f7c5553f` (after) | three findings, then none | ea9983851: prose at line 80, a stranded row at 311, a second header at 313; 7f7c5553f: none | the lint names the three shapes isocan held on 5 Oct |
| `keel adopt /Users/dalmaer/code/isocan --dry-run --json` | `claude` off: changelog.yml is a scheduled writer | exit 0; `off — optional; --with claude to add it (changelog.yml runs anthropics/claude-code-action on schedule, workflow_dispatch, not on a mention)` | adopt now reads isocan's workflow by its triggers; isocan's own `.keel/keel.json` still lists claude as local until it re-adopts |

## Gaps and decision

Not done: the night's `lessonsTableSplit` (`practices/night`, another
builder's files this phase) still knows only the blank line, so `keel
improve`'s lint measure counts one shape and doctor four; moving
`lessonsTableShapes` into the night's lib would make them agree. Renovate
itself never ran against the rendered file. Supports **built**.
