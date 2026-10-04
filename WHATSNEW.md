# What's new in keel

Each entry is for the person whose project `keel update` brings to that
practice version: what changes in your repo, and anything you need to do.
Newest first. `keel release` writes them; `keel update` puts the entries
between your version and the new one into its pull request.

## v0.6.1 — practice 0.6.1 (2026-10-04)

- **The night counts real verdicts only.** The CI measure skips cancelled and skipped runs, so a project whose tests cancel themselves on every push (as ledger's do) no longer shows a broken or missing CI reading.

## v0.6.0 — practice 0.6.0 (2026-10-04)

A fresh agent can now run your project's practice without guessing, and
keel installs cleanly through npx.

- **The conductor skill:**
  - It works without a remote, a design doc or a README.
  - Small phases can be built by the conductor itself.
  - The record is written before the one full check, so the check covers
    exactly what's committed.
  - The evidence names the check command, and its result line goes in the
    commit message.
  - A proof that needs the commit is walked after it.
  - "Set `status:`" is the first step of the record.
- **The `keel` doorway skill** says how to run keel with no install:
  `npx -y github:dalmaer/keel <verb>`.
- **The roadmap check catches a stale status.** It now fails when a phase
  has every box checked and names evidence but is still marked planned,
  designed or partial.
- **Templates:**
  - the phase template has an optional `## Trajectory` section;
  - the evidence template's Revision line no longer asks for a commit that
    doesn't exist yet;
  - AGENTS.md says keel's files are listed in `.keel/lock.json`.
- **New projects** (`keel init`) get:
  - a README with "How to run it", and a `docs/evidence/` folder;
  - a drafted phase 0 called "The first thing that runs";
  - a goal titled from your description's first sentence;
  - a `package.json` name for node projects;
  - a `.gitignore` that now actually ships. Before this, `npx …keel init`
    failed for everyone.

## v0.5.2 — 2026-10-03

The nightly Loop pull now commits everything its gate checked.

- **`afterRenderWrites`, if your roadmap counts Loop findings.** A pull runs your `"loop" "afterRender"`, and if that rewrites a file (ledger's roadmap), the gate passed with it but the PR left it out, so main went stale and red after the merge. List those files in `.keel/keel.json`: `"loop": { "afterRender": "node scripts/roadmap.ts", "afterRenderWrites": ["docs/ROADMAP.md"] }`. The nightly PR then carries them, and the drain treats them as the queue's data. Each must be a plain repo-relative path: no `..`, no `.github/`, no glob or whitespace.
- Nothing to do if you have no `afterRender`, or it writes nothing.

## v0.5.1 — 2026-10-03

Fixes from adopting cajones.

- **The night's lessons measure reads more tables.** It now reads a table
  whose guard column is called anything containing "guard" (for example
  "Guard / status"), with or without row numbers. Before, it reported
  itself broken and turned the night red.
- **Machine PRs are bounded per queue.** keel's own queues (`keel/`,
  `keel-night/`, `keel-loop/`) allow one open PR. Renovate allows four, one
  per lane of keel's config, and is information only where your Renovate
  config is your own.

## v0.5.0 — 2026-10-03

Loop can carry your own contexts, and keel catches a lessons table that
GitHub silently breaks.

- **`keel adopt --with <practice>`** works on a project that's already
  adopted. It adds just that practice, and every other byte stays as it was.
- **Loop contexts.** In `.keel/keel.json`, `"loop"` gains `contexts`: Loop
  contexts produced by a command of yours and sent on `push`. It also gains
  `afterRender` and `name`, and `scripts/loop.mjs` exports `phaseCounts`
  for your own roadmap.
- **`lessons-table-split`.** A blank line inside your lessons table ends it
  in Markdown, so later rows show as raw text. `keel doctor` and the
  nightly lint now name the lines.
- Fleet update plans say when migrations are only *possibly* pending. They
  are checked on the clone, and nothing is opened if none applies.

## v0.4.0 — 2026-10-03

keel can now run a project whose gate needs installs or environment, and it
adds less to projects that already say things their own way.

- **`setup` and `env` in `.keel/keel.json`.**
  - `setup` is the install command the night shift runs before measuring.
    Without it, the night runs `npm ci` when there's a lockfile.
  - `env` holds variables applied wherever keel runs your gate.
  - `keel adopt --setup "<cmd>" --env KEY=VALUE` sets both, and
    `keel doctor` shows them.
- **`@claude` is opt-in.** The `claude` practice is off unless you ask for it
  with `--with claude`. Locally, Claude Code does the same work. Projects
  that already have it keep it.
- **No repeated rules.** If your AGENTS.md already states a rule, adopt
  doesn't append keel's copy of it (`blocksSkipped`).
- **adopt records your GitHub repo** from `origin`, but only when the
  project is its own git top level. The night's CI and PR measures then
  have something to read.
- **Shorter health pages.** A measure blocked by a local phases variant says
  so in one line; `keel doctor` has the detail.

## v0.3.1 — 2026-10-03

An agent working in your project now finds keel on its own.

- **A `keel` skill** at `.agents/skills/keel/SKILL.md` (with a
  `.claude/skills/keel` link) tells any agent this repo is run with keel,
  how to install it if it's missing, and to run `keel --agent-help` before
  anything else. It holds no verb list, so it can't fall behind the CLI.

## v0.3.0 — 2026-10-03

Your project now runs entirely on its own, and keel can read projects that
were built differently.

- **Your night shift needs nothing from keel.**
  - `keel-night.yml` runs your repo's own `scripts/keel/improve.mjs` and
    `scripts/keel/drain.mjs`, which are new managed files. There's no keel
    checkout and no secret.
  - What it can't measure from your repo alone, it marks "keel-side" rather
    than 0.
- **`keel-update.yml` is retired.** Migration 0002 deletes it if keel wrote
  it, and leaves it as yours if you edited it. Update PRs now arrive from
  keel (`keel fleet update`). You can delete a `KEEL_TOKEN` secret if you
  set one; nothing reads it now.
- **Stitch Loop uses the official `@google/stitch` CLI from npm.**
  - The secret is `STITCH_API_KEY`, and `STITCH_WORKSPACE` overrides
    `.stitch.json`.
  - The installer-URL secret is gone.
- **Adopt reads your setup instead of assuming keel's.**
  - It never invents a gate: with no `check` script, it asks for `--check`.
  - A lessons table outside `docs/lessons.md` is found and used (`lessons`
    in `.keel/keel.json`).
  - Phases kept as `docs/projects/<p>/phases.md` are read
    (`keel next --project <p>`).
- **Migration 0003** gives your phases goals, but only once every built
  phase names its evidence. Until then, `keel doctor` lists the phases
  owing it.
- **Docs.**
  - Conduct's Record step now asks whether a change alters what people or
    agents are told.
  - `keel doctor` notes when your README is older than your newest built
    phase.
- **New measure:** `evidence_placeholders` counts built phases whose
  evidence is still the blank template.

## v0.2.0 — 2026-10-02

Your project now gets measured overnight, can send its lessons home, and can
say what it is for.

- **Goals you can manage.**
  - `keel goal add|show|retire` and `keel phase new|list`.
  - A goal may exist before it has a phase. The roadmap allows it and
    `keel doctor` reminds you.
  - A retired goal stays visible and counted, and is never your next focus.
  - *If you're on 0.1.0:* your roadmap script rejects a goal with no phase
    until this update re-renders it, so update before you `goal add`.
- **`keel improve`** measures whether the practice is working here, with
  twelve numbers. Among them:
  - whether your gate passed, and whether it actually ran tests;
  - a stale roadmap, phases with no issue, phases stuck in one status;
  - lessons with no guard, drift, red CI streaks, queued machine PRs, and
    dependency age.

  `--report` writes `docs/health/<date>.md`, with one proposal for you to
  accept or decline. A measure that can't run says *broken*; it never reports
  zero. Bounds in `.keel/bounds.json` only tighten.
- **The night shift** (`night`, plus the optional `claude` and `renovate`
  practices).
  - `keel-night.yml` runs `keel improve --report` nightly and opens at most
    one PR. `keel drain` merges older data-only PRs and closes the rest as
    superseded, keeping their branches.
  - `keel-update.yml` opens the weekly practice-update PR.
  - A run goes red only when an instrument breaks or your gate fails. A
    missing secret or repo setting is a notice that names exactly what to set.
- **`keel lessons`** sends your new lessons, your edits to keel's files, and
  practice-shaped commits home to keel as issues, each exactly once. It asks
  first.
- **Stitch Loop** is an optional `loop` practice, for projects that triage
  Loop findings. `keel adopt` leaves a project's own loop script as a local
  variant.

## v0.1.0 — 2026-10-02

The first released practice. If your project was set up with `keel init` or
`keel adopt`, this is what it now runs on.

- **Seven practices, each switched on only where your project already fits
  it.** `base`, `agents-md` (one AGENTS.md; CLAUDE.md is a pointer to it),
  `phases` (each phase file owns its status; `docs/ROADMAP.md` is generated
  and checked), `evidence` (built needs an evidence file), `lessons`,
  `conduct` (the conductor skill, reached from Claude Code by a symlink) and
  `ci`. What your project does its own way stays a *local variant* in
  `.keel/keel.json`, with a proposal, and keel installs nothing over it.
- **Your gate is yours.** `check` in `.keel/keel.json` names the one command
  that must pass (default `npm run check`). Every instruction keel ships, and
  keel's CI workflow, runs that command.
- **`.keel/lock.json` records what keel wrote.** Each managed file and
  AGENTS.md block is locked by hash, so a change you make is told apart from
  keel moving on. `keel render` refuses to write over your change.
- **`keel doctor` shows what you changed, as a diff, and why it matters.**
  Your edit to a keel file is signal, not an error to revert: keep it
  (`keel doctor --fix <path> eject`), take keel's (`restore`), or send it home
  as a lesson. Doctor also flags a second copy of a skill, a CLAUDE.md that
  grew past a pointer, phase files the roadmap rejects and goals with no phase.
- **`keel update` brings later versions as one pull request.** It updates the
  CLI first, refuses if you changed a keel file, applies migrations, re-renders,
  runs your `check` and, if it fails, leaves your project exactly as it was.

If your phases still name milestones (`docs/milestones.json`), this update
runs migration `0001-milestone-to-goal`: milestones become `docs/goals.json`,
each phase says `goal: Gn`, sections keel's format needs are added and marked
as added, and keel's roadmap script, test and phase contract replace your own.
Read that diff in the PR; your evidence files are not touched.
