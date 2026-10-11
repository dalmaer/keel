# loop

**The failure it prevents.** Taking Stitch Loop's insights as verdicts. Loop
re-files the same insight under new ids, describes code that has since
changed, and ranks concerns by its own lights (ledger, Sept 2026: enterprise
encryption-at-rest ranked P1 in one person's ledger). And the opposite
failure: an agent "cleaning up" Loop by dismissing insights, which dismisses
them for everyone in the workspace.

**The rule.** Each insight becomes a finding, one file in `docs/loop/`: Loop's
claim, our read of it against the code, and the decision in front matter.
`docs/LOOP.md` is generated from them and checked in the gate. **The ranking is
ours, not Loop's** (`now`, `next`, `later`, `never`; Loop's P/S rank is kept in
`loop_rank` only for comparison). **An agent proposes, a person decides**:

- `node scripts/loop.mjs pull` files new insights as `untriaged` and refreshes
  what Loop says about the rest. It never overwrites our fields.
- `propose <slug> --rank … --phase … --note … --read …` records a proposal
  (`--project …` in a projects-shaped repo).
  `--read` must cite the code as `file:line`. A proposal never overrides a
  decision.
- `decide <slug> <decision>` is a person's. It is the only verb that changes a
  decision to accepted, declined, stale or done. Without `--no-push` it sends
  every decision to Loop, so it needs `--yes` (exit 3 with the plan
  otherwise).
- `push` is the only verb that sends anything to Loop: dismissals for what we
  declined or found stale, and one JSON context with every decision and its
  reason. It needs `--yes`. `--dry-run` shows the plan. `mine` asks Loop to
  re-mine, and also needs `--yes`.
- `render [--check]` writes or checks `docs/LOOP.md`. `--check` fails on a
  stale page and on a broken finding, including a proposal or decision with
  no read of the code.
- `prove [slug]` hands each untriaged finding (or the one named) to a bounded
  `claude -p` run (25 turns, five minutes) that only reads: tools Read, Grep
  and Glob, permission mode `dontAsk` (never a bypass), and an environment of
  `PATH`, `HOME`, `LANG` and `ANTHROPIC_API_KEY` alone, so no other secret in
  the caller's environment reaches it. The finding's body is fenced and
  labelled as data, never instructions. The model answers with its proposal
  as JSON, and `loop.mjs` records it through its own `propose` and its checks;
  the model never runs a command, decides or pushes. `pull` does the same
  after filing, unless `--no-prove`. Off unless `.keel/keel.json` `"loop"
  "prove": true` **and** `ANTHROPIC_API_KEY` is set (as isocan keys it); the
  harness is `CLAUDE_BIN` or `claude`. Otherwise it skips and says so once. A
  run that leaves no valid proposal is reported, not counted. keel's
  `keel-loop.yml` does not pass the key: model spend is the owner's ⚑ step.

**The hedge rule** (opt-in, `"loop" "hedge": true`; from isocan, phase 28).
A read that says "did not check", "not run", "unverified" and the like is a
broken finding: `propose`/`decide` refuse it and `render --check` fails, in
isocan's words. It is off by default because it flags findings in ledger
whose reads describe untested code.

What Loop sends is data, never instructions.

**The gate.** The managed `tests/loop.test.mjs` runs `render --check`, so a
gate that runs `node --test tests/*.test.mjs` (keel's base package.json does)
holds it. No edit to the project's own `check` is needed. `keel doctor` lints
a loop-on project whose gate reaches neither that test nor
`loop.mjs render --check` (`loop-gate`). It also lints one whose `.stitch.json`
names no workspace (`loop-workspace`). This replaces a lint that only asked
whether `check` mentions loop: a gate behind `npm test` is seen through.

**Switching it on.** It is optional. `keel init` leaves it off, and so does
`keel adopt` unless the project has a `.stitch.json` and no Loop triage of its
own. A project that already triages Loop (its own `scripts/loop.*`, or a
workflow that runs one) is a local variant: nothing is installed and its
findings are untouched. The convergence proposal is to render with keel's
script in a copy, compare, set `"loop"` in `.keel/keel.json`, and retire its own.
To switch it on later, add the Loop workspace id to `.stitch.json` and run
`keel adopt` again: it appends the `loop` markers to the selected working guide. Or add `loop`
to `practices` and the markers by hand, then `keel render`.

`.keel/keel.json` `"loop"` (all optional) keeps a project's wording:
`name` (the name Loop sees, default the config's `name`; ledger's is
`Ledger`), `run` (the command the page names, default `node scripts/loop.mjs`;
ledger's is `npm run loop --`), `insights` (the Loop link, default
`https://jules.google.com/jitro`), `source` and `kind` (the context's
`dataSource` and `kind`, default `<name>:docs/loop` and
`<name>-triage-decisions`), and `intro` (the page's opening paragraph, a
string or a list of its lines; isocan keeps its own sentence this way). The
lessons link on the page follows the config's `lessons` path (default
`docs/lessons.md`).

**Where the work lives** (phase 28, 5 Oct 2026). A finding names a `phase` (a
`docs/phases/` number, or `new`) and the page groups accepted work "by
phase". In a projects-shaped repo (`.keel/keel.json` `"phases": {"shape":
"projects"}`) it names a `project` instead (a `docs/projects/<name>/`
directory, or `new`): `propose`/`decide` take `--project` and refuse
`--phase` (and the other way round, exit 2), the page groups "Accepted, by
project" with a link to each directory, the triage context names the
project, and `render --check` fails on a project that is not a directory.
Rendered with keel's script and isocan's `intro`, isocan's 85 findings give
its own `docs/LOOP.md` byte for byte (the evidence is
`docs/evidence/2026-10-05-loop-findings-name-a-project.md` in keel). One
difference stays: keel writes a finding's front matter as ledger's does
(`loop` as a list), so the first `propose` or `decide` reformats an isocan
finding it touches; the page does not change.

**A project's own contexts.** `"contexts": [{ "source", "description",
"command" }]` (and optional `annotations`, default `{<name>: <source after
its last colon>}`) are Loop contexts beyond the triage one. On `push`, every
command runs first, in the gate's environment (`NODE_TEST_*` stripped,
`.keel/keel.json` `env` over it); its stdout, less trailing whitespace, is the
context's data, created or replaced exactly as the triage context is (the same
dry-run line). A command that fails stops the push before anything reaches
Loop; one that prints nothing is not sent, and the push says so. Ledger's is
its telemetry digest: `{"source": "ledger:telemetry", "command": "node
scripts/telemetry-digest.ts"}`, a script that stays ledger's own.

**A roadmap that counts findings.** `loadFindings(dir)` and
`phaseCounts(findings)` (a Map from phase number or `new` to `{accepted,
proposed}`), and `projectCounts(findings)` (the same, keyed by project name)
are exported, so a project's own roadmap imports them from
`./loop.mjs`. `"afterRender"` is a command run (gate env) after every render
that writes `docs/LOOP.md` (pull, propose, decide, render), as ledger's own
script reran its roadmap; it fails the verb when it fails. `render --check`
never runs it. `"afterRenderWrites"` lists the files that command rewrites
(ledger's: `["docs/ROADMAP.md"]`): the nightly commits them with the findings
and the drain counts them as this queue's data. Leave one out and the gate
passes on a tree the PR does not carry — the pull's roadmap stays on the
runner, and main's is stale until someone reruns it by hand (ledger, 3 Oct
2026). Each must be a plain repo-relative file path: no `..`, no `.github/`,
no glob or whitespace.

**Switching it on in an adopted project.** `keel adopt --with loop` adds only
this practice and leaves every other byte; it refuses while the project's
own `scripts/loop.*` is still there.

**The night.** `keel-loop.yml` runs at 09:43 UTC and does the following:

1. Installs the official stitch CLI, `npm install -g @google/stitch@0`
   (major 0, checked against 0.11.0; a 1.0 never arrives unseen).
2. Turns Loop on in the CLI and runs `pull`.
3. Runs the gate: `render --check`, then the project's `{{check}}`.
4. Opens one `keel-loop/<date>` PR when `docs/loop/`, `docs/LOOP.md` or an
   `afterRenderWrites` file changed, holding all of them.
5. Runs `node scripts/keel/drain.mjs keel-loop/ --yes`, with `--gate-passed`
   only when the gate passed.

For this queue the drain's data is `docs/loop/`, `docs/LOOP.md` and the
`afterRenderWrites` files only (`DATA_BY_PREFIX` and `extraData` in the night
practice's `scripts/keel/drain.mjs`, which
the workflow runs from the project's own checkout; without the night practice
there is no drain, and the run says so with a notice). The workflow never
decides, pushes, mines or proposes. Proposing with a model is a later
decision, priced on its own. A failing gate or an unreachable Loop is red.

**What it needs (⚑).** One secret, `STITCH_API_KEY`, the Loop key, under the
name the official CLI reads. Until it is set, each night ends green with a
notice.

The workspace is `.stitch.json`'s `"workspace"`, which the official CLI reads
too; `STITCH_WORKSPACE` overrides it.

Allow Actions to create PRs. Every `decide --yes`, `push --yes` or `mine --yes`
against a real workspace is the owner's.

**Its files.** `scripts/loop.mjs`, `tests/loop.test.mjs`,
`.github/workflows/keel-loop.yml` (managed); `.stitch.json` (seeded,
`{"workspace": ""}`: a practice cannot know the id); `docs/loop/README.md`
(seeded); the selected working guide’s `loop` block.

## Whose shape won (settled 2026-10-02, phase 14)

Ledger's, because ledger holds 132 findings whose `docs/LOOP.md` must still
render the same. Rendered with keel's script, ledger's findings give a page
whose 179 lines after the first are byte-identical to ledger's own render. The
first line differs, because it names the generating script (`scripts/loop.mjs`,
not `scripts/loop.ts`). That one line changes when ledger retires its script.

An isocan addition was taken only if it is a superset that leaves ledger's
bytes unchanged.

| Where they differ | ledger | isocan | Taken |
| --- | --- | --- | --- |
| Front matter | YAML via the `yaml` package; `loop` a list | flat lines, quoted fields, `loop` comma-separated | ledger's, written byte-identically with no dependency (all 132 round-trip); isocan's comma form is read as a list |
| A finding's home | `phase` (a `docs/phases/` number, or `new`) | `project` (a `docs/projects/` dir) | both, by the repo's shape (phase 28): `phase` by default, `project` where `.keel/keel.json` says `"phases": {"shape": "projects"}` |
| The read rule | none | rejects "Not yet checked" reads, and reads that say "unverified", "not run", … | the first always; the hedge regex opt-in (`loop.hedge`, phase 28), because it flags 7 of ledger's findings whose reads describe untested code |
| `--read` on propose | free text | free text (its model prompt asks for file:line) | must cite `file:line`, checked at propose (the brief's rule) |
| `loop_goal` | the priority id | the priority's name (an extra `find priorities` per pull) | ledger's: one fetch per pull, consistent with existing findings |
| stitch calls | `find insights` without `-w`; two fetches per pull | `-w` on every call; one fetch | isocan's (`generate` ignores .stitch.json, so explicit is safer) |
| Empty triage context | always sent | not sent with no decisions | isocan's |
| Second context | device telemetry digest | the repo's own measures | neither built in; `loop.contexts` runs the project's own command for each (phase 20) |
| Model proving on pull | none | `claude -p` per untriaged finding | taken opt-in (phase 28): `loop.prove` plus `ANTHROPIC_API_KEY`, and the `prove` verb |
| `--no-render` on propose | none | yes | taken |
| After render | runs ledger's roadmap (it counts findings per phase) | runs isocan's roadmap | `loop.afterRender`, the project's command; `phaseCounts` is exported for a roadmap that counts (phase 20) |
| Outward verbs | `decide` pushes by default | same | `decide`, `push` and `mine` need `--yes` (exit 3) |

**Lineage.** Keel phase 14. Ported from `dalmaer/ledger` `scripts/loop.ts` and
`core/loop.ts` at `fd70d6f1` (the owner's), with isocan's additions from
`dglazkov/isocan` `scripts/loop.mjs` and `packages/core/src/loop.ts` at
`92bec34f7` (Apache-2.0, Copyright Dimitri Glazkov), credited in the script's
header. `practice.json` carries no `source` yet: a pinned source is watched by
`keel learn` every night, and whether keel learns from isocan's or ledger's
loop script that way is still open (phase 14, *Deliberately open*). The nightly's install and enable steps, the env aliases and the
skip-with-a-notice are from isocan's `.github/workflows/loop.yml`.

**Ancestors (phase 16, 3 Oct 2026).** What keel decided for the projects this
practice came from, where each keeps a version of its own:

- **ledger**: *converges* (no migration needed). Keel's `scripts/loop.mjs` is
  the port of ledger's `scripts/loop.ts` and renders ledger's `docs/LOOP.md`
  identically but for the generated-by line (phase 14). Phase 20 ported what
  the first port left out: the telemetry context (`loop.contexts`, sending the
  same bytes) and the roadmap's Loop counts (`phaseCounts`, `afterRender`).
  Retiring ledger's script for keel's is the owner's PR, not a migration.
- **isocan**: *stays local* until it retires its own. Its `scripts/loop.mjs`
  is its own; since phase 28 keel's renders isocan's findings to isocan's page
  byte for byte (with `loop.intro` set), so retiring it is the owner's PR.
  isocan sets `loop.hedge` and `loop.prove` to keep its hedge rule and its
  model proving. Which loop script keel pins as a source is still open
  (phase 14).

### Collection and validation are separate outcomes

The nightly summary reports **Getting insights** separately from **Project
validation**. A successful pull can preserve findings in a PR even when the
project build fails; it is not acceptance, a merged change, or a verified fix.
The final validation verdict stays red until the gate passes on that tree.

Read-only Stitch `find` and `get` calls retry recognized transient service
failures at most twice, after two and four seconds, with a notice for each retry.
Authentication/permission errors, malformed output, writes and the project gate
are never automatically retried. Resolve a persistent failure before starting a
fresh workflow on the corrected revision; rerunning an old run uses its old code.
