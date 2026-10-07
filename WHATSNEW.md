# What's new in keel

Each entry is for the person whose project `keel update` brings to that
practice version: what changes in your repo, and anything you need to do.
Newest first. `keel release` writes them; `keel update` puts the entries
between your version and the new one into its pull request.

## v0.8.12 — practice 0.8.12 (2026-10-07)

- **Climb and tend judges never run the agent's code with your setup token.** Setup (and its `setupToken`) runs on the run's own commit before the agent's commits are taken; the agent may not change lockfiles, `.npmrc` or `package.json` beyond its non-install scripts. The judge trusts only the run's own commit as the base, never the agent's record.
- **Tend** opens a PR for a pass that only proposes (its proposals in `docs/tend/<date>.md`), counts a finding resolved only when the re-run no longer reports it, and may change only Markdown records, README, AGENTS.md, CLAUDE.md and `.agents/` text.
- **Climb** remembers a night that kept nothing in its rotation, links nested `node_modules` (a `web/` build runs in its worktrees), compares every test suite your gate ran, and a loop night defers to keel-loop.yml where it is installed.
- **Cross-review** queues only the runs that will review: a `/review` from someone without write access no longer displaces a maintainer's.
- **The unbounded-measure check** reads each clause on its own.

## v0.8.11 — practice 0.8.11 (2026-10-07)

- **Climb and tend agents can no longer reach a token that writes to your repo.** Each workflow is now three jobs: `agent` (read-only; the Claude action is handed that read-only token), `judge` (read-only, no agent: checks that the commits touch no `.github/`, `scripts/keel/` or `.keel/keel.json`, then runs the guard and your gate) and `publish` (pushes and opens the PR, running nothing from the branch). Found by Claude's cross-review of ledger#92. Runs take a little longer (the judge installs again) and keep two more artifacts for 7 days.
- **Cross-review keeps a person's `/review` queued**: a bot's comment on the PR no longer replaces it.
- **The unbounded-measure check** reads every measure an item names, and skips "not a night measure".

## v0.8.10 — practice 0.8.10 (2026-10-07)

- **The unbounded-measure check is narrower:** it applies only to the night's measures (a product's "recorded only" is not its business), reads a wrapped bullet as one item, and is satisfied by a Deliberately open or Trajectory line naming the measure itself, not every code span beside it.
- **The Budget line treats a pass that was off as off**, so switching a pass back on doesn't count runs from the earlier time it was on.

## v0.8.9 — practice 0.8.9 (2026-10-07)

- **A failed update says whether your main already fails.** When your check fails after `keel update` in `keel fleet update`, keel runs it once more without the update and says "main fails the same check without the update: not this update", or "main passes without the update: the update, or a test that fails only sometimes".
- **The roadmap check flags a phase asking for a night measure with no bound** (the night's self-test refuses one), naming the two fixes: an optional bound, or a line on the health page.
- **The phase template asks for known limitations under Deliberately open**, with their effect: a limitation that could make the phase's output wrong is never only in the design's prose. Replace that template line when you draft a phase.
- **The Budget line reads an unset budget as the default of its own practice version**, so a release that changes a default doesn't hide the change.

## v0.8.8 — practice 0.8.8 (2026-10-07)

- **The Budget line's history is read conservatively.** If the read of `.keel/keel.json`'s history stops short, the oldest config read is the cutoff, never every run; and a budget left to the default only matches another left to the default, since a default can change between releases.

## v0.8.7 — practice 0.8.7 (2026-10-07)

- **The Budget line counts only runs since the budget became what it is today**, and names that date ("tend 3, 2 of 30 min since 2026-09-20"): after you change a budget, runs under the old one no longer skew the suggestion.

## v0.8.6 — practice 0.8.6 (2026-10-07)

- **Claude can review Codex's PRs** (the new `cross-review` practice, off unless you switch it on). PRs on a branch prefix you name (`"crossReview": {"for": ["codex/"], "budget": {"minutes": 15}}`), or a `/review` comment from someone with write access, get a Claude review: inline P1/P2/P3 comments, each validated first, and a summary posted as a comment. It reads and comments only: it never pushes, approves or merges. It needs `CLAUDE_CODE_OAUTH_TOKEN` (or `ANTHROPIC_API_KEY`), and each review spends model time within its budget.
- **A Budget line on the health page** for each budgeted pass you have on (climb, tend, cross-review): the minutes the agent actually used in its last runs, which ran out, and a suggestion (extend, shorten to N, hold, or too few to say). It never changes your budget.
- **Tend's loose ends name paths in your repo**, not the runner's checkout.

## v0.8.5 — practice 0.8.5 (2026-10-06)

- **A reopened review thread gets its own day.** When a reviewer follows up on an answered thread, `reviews_unanswered` ages it from the follow-up, not from the original comment.
- **The health-ignored check probes tonight's page**, so an ignore rule for this year's pages is caught and one for an old archive is not.
- **The run-alone command reproduces an empty value**: it stops only when a variable that was set in the run is unset in your shell.
- **The default `docs/health` is dated pages only** for the night's drain, like a configured health directory: a shared index there is no longer merged as data.
- **The conductor runs `node scripts/roadmap.mjs --next`**, which every project with keel's phases has; `npm run next` only where you have that alias.

## v0.8.4 — practice 0.8.4 (2026-10-06)

- **An answer is a reply.** `keel review` counts a comment answered only when someone replied citing it (a quote, a link or its id); resolving the thread alone is not an answer, and if the reviewer speaks again it is open again. Top-level review bodies are read too, and a partial page from GitHub is reported as unreadable, never as a count.
- **The night stages only its dated health page**, and commits deleted inbox files as deletions. A `health` setting that resolves outside the repo through a symlink, or starts with `:`, is refused; the git-ignore check uses a dated page name and goes red if git itself errors.
- **Measures read further.** `ci_red_streak` reads up to 100 runs; `dependency_age` also covers app and workspace folders with their own lockfile; a bounds file that isn't JSON is a usage error (exit 2). A lessons row with more cells than its header (an unescaped `|`) is flagged.
- **The conductor finds your roadmap command** from `.keel/keel.json` instead of assuming `npm run next`, and the AGENTS block names the small-phase exception the skill already had.
- **The test ledger's run-alone command pastes as printed.**

## v0.8.3 — practice 0.8.3 (2026-10-06)

- **Review comments are answered, not left.** `keel review <repo>#<n>` shows a PR's reviewer comments and which are answered; `--close` replies fixed, tracked or not valid. Nothing blocks a merge by default; a phase you mark `review: wait` (or an issue labelled `keel:wait-for-review`) lands through a PR that waits for every answer. The night counts `reviews_unanswered`. Name your reviewer with `"review": {"reviewers": ["…"]}` in `.keel/keel.json`.
- **Secrets stay out of the test ledger.** Variables named in `tests.configEnv` are recorded only as a hash, never their value; the run-alone command names them, and unsets the ones that were unset.
- **Each suite folder is its own lane** (root and web/ no longer mix), and history is kept so every lane can reach its baseline.
- **Guides:** keel's docs now include a guide per use case (`docs/guide/` in keel).

## v0.8.2 — practice 0.8.2 (2026-10-06)

Fixes from review of the 0.8.1 update.

- **Slow tests are judged like with like.** After a change to NODE_OPTIONS, preloads or your `configEnv` variables, `slow_tests` says n/a until that setting has its own history, instead of a misleading 0.
- **The run-alone command reproduces what was seen:** it carries the setting a flaky or slower test was seen under, and works from whatever folder it's printed in (web/ and workspace suites included).
- **More history per setting.** The ledger keeps runs per suite and setting (at least 50 each, 400 in all), so a project with several test lanes (ledger runs four) builds a baseline in each.

## v0.8.1 — practice 0.8.1 (2026-10-06)

Fixes from review of the 0.8.0 update.

- **Loop's prove pass is sandboxed.** If you turned on `loop.prove`, the model now reads code only (Read, Grep, Glob; no shell), gets only the environment it needs, and a finding's text is fenced as data. It answers with its proposal; keel records it.
- **The test ledger reaches more and judges better.** Your web or workspace test suites get the reporter too, recording at the repo root. Runs under different settings (NODE_OPTIONS, preloads, or variables you name in `"tests": {"configEnv": [...]}`) are compared only with each other. Running one test alone no longer marks its siblings' proofs lost. A file with only an empty `describe()` counts as "no tests ran".
- **To do by hand, if your CI is your own:** keel can't edit your workflows, so the update PR shows the three-line step to upload `.keel/test-runs` from your CI; until then the night's flaky and slow measures say they read nightly runs only.
- **If your test command doesn't run keel's shipped tests,** they're added to it, and `keel doctor` reports any it still misses.

## v0.8.0 — practice 0.8.0 (2026-10-06)

This update rewrites some of your own files, so its PR is marked a one-way door: read it before merging.

- **Your test runs are remembered.** Migration 0004 adds keel's test-ledger reporter to your `node --test` script. Every run ends with one hygiene line; a test that both passed and failed on the same clean tree is named flaky, and one more than twice its usual time is named slower, each with the command to run it alone. A run where no test executed now fails ("no tests ran"); set `"tests": {"allowEmpty": true}` if that's intended.
- **The night reads more.** New measures: `flaky_tests`, `slow_tests`, `proofs_hold` (a built phase whose cited tests or evidence files are gone), `escapes` (defects found after a phase was built: `fix:` commits, your own lessons, and `— Escape:` lines in a phase's Trajectory), and `build_time` when you name a build.
- **Specs say how they'll be proven.** The roadmap check refuses a phase still holding the template's text. New phases (`spec: 2`) name the check behind each acceptance box and their Real surfaces; older phases get a note, never a failure.
- **Lessons for your stack.** You get `docs/keel-lessons.md`: keel's lessons that apply to your stack (declare `"stack"` in `.keel/keel.json`; `keel doctor` checks it against your files). keel's catalogue now groups its lessons into ten families (`docs/patterns.md` in keel).
- **Every PR keel opens** (updates, the night's data PR) has a Summary, Evidence and Merge danger section.
- **New checks:** with `ci`, every workflow `run:` block passes `bash -n` and every inline `node -e` passes `node --check`; with `phases`, a test proves each generated file is rewritten whole by its generator.
- **Optional, off unless you switch it on:** `climb` (an agent improves one number overnight: test time, flaky tests, build time, your benchmark, lessons, Loop findings; never merges) and `tend` (a weekly pass that keeps your records true). Each spends model tokens within a budget you set, and needs `CLAUDE_CODE_OAUTH_TOKEN`.

## v0.7.0 — practice 0.7.0 (2026-10-05)

- **Projects-shaped phases are measured.** If your phases live in `docs/projects/<project>/phases.md`, the night now reads them: `phases_without_issue` and `phases_stuck` have values instead of n/a.
- **Eight new nightly measures**, each n/a (with the reason) when your repo has nothing for it to read:
  - `records_disagree`, `status_unknown`;
  - `changelog_gaps`, `research_unindexed`, `verify_owed`;
  - and, with `repo` set, `issues_unnamed`, `issues_done_open`, `prs_stale`.
- **`gateWorkflow` counts on the night too.** If `.keel/keel.json` names your gate workflow, `ci_red_streak` reads it.
- **Loop findings can name a project** (`project:`, `propose --project`), and in a projects-shaped repo `docs/LOOP.md` groups accepted findings by project. Two new options, both off unless you set them:
  - `loop.intro` sets your page's own opening;
  - `loop.hedge` rejects a hedged read;
  - `loop.prove` lets `pull` ask a model to prove findings when `ANTHROPIC_API_KEY` is set.
- **Renovate is shaped by your project.** Your own workspace packages are never updated as dependencies (one shared scope becomes `@scope/**`), the timezone comes from `.keel/keel.json` `timezone`, and Node moves in one lane together with a Dockerfile's `FROM node:`. With no workspaces and no timezone, the file is unchanged.
- **The lessons check names every way a table splits**: a blank line, prose between rows, a second header, or a row stranded after the table. `keel doctor` and the night agree.
- **`keel adopt` reads a claude workflow by its triggers.** A scheduled job that runs claude-code-action no longer counts as an `@claude` responder.

## v0.6.7 — practice 0.6.7 (2026-10-05)

- **GitHub Actions v7.** keel's workflows move to `actions/checkout@v7` and `actions/setup-node@v7`.
- **Renovate's action bumps no longer block updates.** If your Renovate already bumped an action in one of keel's workflows (duo's did), `keel update` now sees that keel made the same change and takes keel's file, instead of refusing it as your own edit.

## v0.6.6 — practice 0.6.6 (2026-10-05)

- **Renovate watches vendored git submodules.** If your repo vendors code as submodules, their updates now arrive in the Monday majors PR, for a person to read. A repo without submodules sees no change.
- **New optional practice, `reconciliation`** (`keel adopt --with reconciliation`): it compares your phase and decision records with what actually shipped, and asks each PR to declare which records it touches (a `keel-impact` block). Renovate, night and Loop PRs carry a no-impact declaration. Off unless you switch it on; the night shows its measure as n/a.
- **With reconciliation on, editing a PR's description re-checks it** (`keel-impact.yml`, a few seconds), so fixing the declaration turns the PR green without re-running your gate.
- **Node 24.21.0** in the `.nvmrc` keel seeds for new projects.

## v0.6.5 — practice 0.6.5 (2026-10-04)

- **Choose where the nightly health page goes.** Set `"health"` in `.keel/keel.json` (default `docs/health`). The night shift, drain, `keel fleet` and `keel loose-ends` all read it. If your repo git-ignores that directory, the night run goes red and `keel doctor` reports `health-ignored`, instead of the page being written and quietly lost.
- **The night commits only its own data:** the health directory, `docs/inbox/`, `docs/INBOX.md` and `.keel/bounds.json`. Anything else a gate run leaves behind stays out of its pull request.

## v0.6.4 — practice 0.6.4 (2026-10-04)

- **Fixes two broken workflow steps.** An apostrophe in a comment inside an inline script broke the night shift's "Read the config" step (in 0.6.3) and the Loop workflow (since 0.5.2). If your night or Loop run went red with a bash "syntax error", this is the fix. keel now tests every workflow's shell and inline scripts before shipping.

## v0.6.3 — practice 0.6.3 (2026-10-04)

- **Setup can fetch a private repo your gate depends on.** Name a repo secret in `.keel/keel.json` as `setupToken`, and the night shift (and the Loop workflow) passes it, to the install step only, as `GH_TOKEN`, so `setup` can `gh repo clone` it.

## v0.6.2 — practice 0.6.2 (2026-10-04)

- **Unsent lessons are counted every night.** The health page gains `lessons_unsent`: rows in your lessons table that haven't gone home yet. Send them with `npx -y github:dalmaer/keel lessons --yes`. `keel loose-ends` lists them too.

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
