# Bring a project under keel

## When you'd reach for this

A repo already exists, with its own history and its own way of working, and
you want keel's practice in it: the night's health page, the lessons going
home, updates arriving as PRs. Perhaps it already has a version of the
practice, copied by hand from another project, and the copy has drifted.

For an empty directory, [Start a project](start-a-project.md) is shorter.

## What it does, and why it works that way

`keel adopt` surveys the repo and switches a practice **on only where the
project already satisfies it**. Every practice ends up in one of three
states:

- **on**: keel installs its files.
- **local**: the project has its own version. Keel installs nothing for it,
  and records why in `.keel/keel.json` `local`, with a proposal for how the
  two could converge in `docs/keel-adoption.md`.
- **off**: nothing is there to build on (no phases means no phases, no
  evidence and no conductor).

The reason is the rule keel holds above all others: never overwrite a
project's own work. A project's phases may be in a shape its history can't
be rewritten into; its built phases may carry no evidence. Adopt never
rewrites the first and never invents the second, because a placeholder
evidence page would pass the check without being the thing (lesson 6's
family, "a check that cannot fail"). Converging is a migration the owner
accepts later, or a decision to leave it local.

The same rule decides the smaller cases. A file the project already has
where keel would write one is **keep-local**, and makes its practice local.
A project with its own CI workflow keeps `ci` local, because keel would
otherwise add a second workflow running the same gate. The selected agent guide keeps
every byte; keel's sections are appended under a heading of their own, and
any rule the file already states in its own words is skipped rather than
said twice.

Keel uses the guide the project already has: `AGENTS.md` when present, otherwise
`CLAUDE.md`, otherwise a new `AGENTS.md`. `--guide <repo-relative-path>` selects
another guide explicitly, and adoption records it as `guide` in
`.keel/keel.json`. With both files present, the default stays `AGENTS.md` and
is reported in the plan; neither existing file is removed. A symlinked pair
counts as one guide. Render, doctor and update use the same selection, including
skipped blocks and the contracts table. Existing project prose is preserved.

Projects that plan with GitHub milestones can keep that plan. With
`"phases": {"source": "milestones"}` and a configured `repo`, keel reads
milestone descriptions and issues for `next`, the board and the night.
Adoption proposes this source when it finds described milestones and no
existing local plan to preserve. It does not create phase files or change
GitHub milestones and issues. The file-based conductor stays off because it
requires local phase and goal files; existing project instructions remain yours.
Switching an existing project to this source preserves dormant managed-file
hashes, so returning to file plans cannot overwrite edits made in the meantime.
Local phase-conversion migrations leave archived plans untouched. The local
roadmap check reports that it is inactive for this source; it does not claim
the remote plan is verified. Ordinary doctor surveys stay offline. Missing
milestone exit criteria are reported as a coverage gap.

A milestone deadline is `due`: it never postpones work until that date.
Issue checkboxes reflect GitHub issue state, and a closed milestone reflects
GitHub planning state. Neither proves acceptance, production verification
or lived-in use. Missing access and truncated reads remain visible gaps.
Keep editing the plan in GitHub; keel's projection is read-only. Open issues
labelled `keel:owner` become owner walks; set `phases.ownerLabel` to use
another label. The reader caches for ten minutes, respects the GitHub quota
floor and discloses its limits: 50 open and 20 recently updated closed milestones, 50 issues per milestone and
20 labels per issue. An incomplete read cannot establish that nothing remains.

What stays local is never a failure. `keel doctor` lists local variants as
information, and says when one would now switch on if adopted again.

**Read this before touching that.** If some code has a document an agent
must read before changing it (an as-built contract), name it in
`.keel/keel.json`:

```json
"contracts": [{ "paths": ["src/index/**"], "read": "docs/engine/indexing.md", "why": "the index format is measured" }]
```

`keel render` then lists the contracts as a table in the selected guide, and adds a
Claude Code hook that names the document before an edit to a matching file.
The hook never blocks an edit. `keel doctor` notes a document that is
missing or a pattern that matches no file.

## The commands

Read first. A dry run writes nothing and prints the whole plan:

```bash
keel adopt ../acme-app --dry-run
```

Then, on a branch, for a PR a person merges:

```bash
keel adopt ../acme-app --check "npm run check:all"
```

Each flag, by why you'd pass it:

- `--dry-run`. Always first. It shows the gate it found, the stack, each
  practice's state with the reason, and each file it would create or keep.
- `--check "<command>"`. The project's gate, when adopt can't find it or
  finds the wrong one. Without it, adopt takes an existing `check` from
  `.keel/keel.json`, then a `check:all` script, then a `check` script; with none, the dry run says `Gate: none
  found` and a real run refuses (exit 2). **Adopt never invents a gate**,
  because a gate keel guessed would be green on things the project never
  checks. Keel's `check.yml`, the night and `keel update` all run this one
  command.
- `--setup "<command>"`. When the gate needs an install step that is not
  `npm ci` (a workspace build, a private clone). The night runs it before
  measuring, read at run time, so changing it later needs no re-render.
- `--env KEY=VALUE`, repeatable. Variables set wherever keel runs the gate.
  The usual reason is a gate that would otherwise do something outward, for
  example `--env ACME_AUTOSYNC=0`, so a keel run never syncs or pushes.
- `--with <practice>`, repeatable. Asks for an optional practice. On a
  project already adopted it adds only that practice: its files, its
  guide section and its lock rows, and every other byte stays. If the
  project has its own version, adopt exits 1, says why, and writes nothing:
  retire the project's own version first.

Running adopt again is a no-op, which makes it safe to re-run after you
change something to see what would now switch on.

## What you'll see

The dry run's survey: `Gate:`, `Lessons:`, `Stack:`, `Repo:`, `Tests:` when
the gate runs `bun test`, vitest or `node --test` (on bun or vitest, with the
line that lets keel's test ledger read the runner's JUnit; adopt records the
runner but never edits the gate, so making that change is yours), then
`Practices:` with `on`, `local` or `off` and the reason for each, then
`Files:` with `create`, `same`, `keep-local` or `conflict`, then the secrets
the switched-on practices need, each a ⚑ step for the owner.

- **0**: surveyed (dry run), or written.
- **1**: `--with` asked for a practice the project has its own version of.
  Nothing was written.
- **2**: usage, or no gate found on a run that would write.

The exact config fields adopt records (`setupToken`, `gateWorkflow`,
`health`, `stack`, the projects shape) are in `keel --agent-help adopt`.

## What it never does

- It never commits, branches or opens a PR. Landing the adoption is the
  owner's step.
- It never rewrites a phase file, writes evidence, or steps a phase back.
- It never replaces a file the project already has.
- It never invents a gate, and never adds a second workflow running the one
  the project has.

## See also

- [When something is red](when-something-is-red.md): reading `keel doctor`
  after adoption.
- [Keep the fleet current](keep-the-fleet-current.md): how the adopted
  project gets later versions.
- [`practices/phases/README.md`](../../practices/phases/README.md): what
  happens to a project whose phases are in another shape.
