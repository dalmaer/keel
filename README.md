# Keel

Keel keeps a way of building software in one place, and carries it into
every project that uses it.

The way of working came from four projects: isocan, ledger, duo and cajones.
Each one copied it from the one before, by hand, and the copies drifted.
Keel makes it one versioned thing. It does three jobs:

1. **It is the source of the practice.** Ways of working, each with the
   failure it prevents, live in [`practices/`](practices/).
2. **It carries changes out to projects.** `keel init` and `keel adopt`
   install the practice. `keel update` and `keel fleet update` bring each
   new practice version as a pull request a person reads, or a local diff
   with `keel update --local`.
3. **It is where lessons come home.** A project sends what it learned
   (`keel lessons`). Keel turns that into proposals (`keel learn`), a person
   decides, and the next release carries the change to everyone.

For the private data repository and hosted UI setup, see [Private workspace and web UI](#private-workspace-and-web-ui).

A project never depends on keel at runtime. Its workflows run from its own
repo, with its own copies of the scripts they need.

> **If you are an agent, run `keel --agent-help` first.** It prints a cold
> start: what keel is, every verb on one line, and the rules that bite.
> `keel --agent-help <topic>` opens the details, and `all` prints everything.
> It ships with the CLI, so it always matches the keel you have. The rest of
> this page is the same story, told for people, and the [guides](#guides)
> tell it one situation at a time.
>
> Every keel project carries a short `keel` skill at
> `.agents/skills/keel/SKILL.md` (linked from `.claude/skills/keel`). An agent
> working there finds keel and runs `keel --agent-help` without being told.

## Install

Node 24.21.0 or later, and git. No registry, no build step.

```bash
git clone https://github.com/dalmaer/keel ~/code/keel
npm install -g ~/code/keel
```

Then `keel --version` prints the CLI's version, its commit, and the
practice version it carries. The global install is a link to the checkout,
so updating keel is a `git pull` there, and `keel update` does that for you
first when the checkout can fast-forward cleanly.

The CLI version moves with every release. The practice version moves only
when practices, migrations or the lessons catalogue change; a CLI-only
release leaves projects current. See [Keep the fleet current](docs/guide/keep-the-fleet-current.md).

## What a project gets

A project that uses keel carries `.keel/keel.json`, which records:

- its name;
- the gate command that must pass (`check`);
- the practice version it is on;
- the practices it has switched on;
- where its nightly health page goes (`health`, default `docs/health`;
  `keel doctor` flags a directory the project git-ignores);
- how the test ledger judges a slower test (`tests`: `window` 20, `factor`
  2, `floorMs` 200);
- anything it does its own way, as a *local variant* with a reason.

Existing agent guides are preserved: adoption selects `AGENTS.md`, then
`CLAUDE.md`, or an explicit `--guide <path>`. See the [adoption guide](docs/guide/bring-a-project-under-keel.md).

Projects can also keep GitHub milestones as their plan with
`"phases": {"source": "milestones"}`. Keel projects them into `next`, the
board and the night without editing GitHub or claiming acceptance from closure.
Local phase-homing in Loop and proof writeback are inactive for that source;
archived phase files remain unchanged.

**The practices:**

| Practice | What it gives a project | The failure it prevents |
| --- | --- | --- |
| `base` | The project's skeleton: Node pinned in `.nvmrc`, a `package.json` whose `check` is the gate, an ignore file | Each project starting from a different floor |
| `phases` | One file per phase in `docs/phases/`, owning its status; `docs/goals.json`; a generated roadmap that CI checks, which also refuses a phase still holding the template's text; a new phase names the check behind each acceptance box and where it runs for real | Status written in two places, drifting; a spec that cannot be proven |
| `evidence` | `built` needs an evidence file that says what was actually checked | Claiming what was never run |
| `lessons` | `docs/lessons.md`: failure *shapes*, each with the guard that now catches it; `docs/keel-lessons.md`, generated: keel's catalogue filtered for the project's `stack` | Paying for the same bug twice, or one keel already paid for |
| `conduct` | The conductor skill: brief a builder, verify the named proof yourself, record, commit | Trusting a subagent's "tests pass" |
| `agents-md` | Practice sections in the selected agent guide, preserving existing project instructions | Instructions copied per harness, ageing |
| `ci` | A `check` workflow running the project's own gate, keeping each run's test ledger as an artifact | A green laptop that isn't the build |
| `night` | `keel-night.yml` measures the project nightly, opens at most one PR, and goes red only when something is broken; a test ledger that remembers every `node --test` run and ends it naming any flaky or slower test | Guards that fire into an empty room; a flaky test rerun until green |
| `claude` *(optional)* | `@claude` on issues and PRs: it opens PRs and never pushes to `main` | Agents landing unread changes |
| `renovate` | Dependency updates in four lanes: small ones merge on green, majors wait for a person | A pile of dependency PRs nobody reads |
| `personas` *(optional)* | Goals the project sets itself (a number, a bound, the command that prints it), measured into a dated review page; a missed goal becomes a candidate for the night's plan | Standards stated once and never measured again |
| `delivery` *(optional)* | One queued publisher moves a tested ref (`green`) to the newest commit on `main` whose gate passed, skipping the superseded and refusing a diverged ref; deploys follow it; doctor holds workflows to cancel-superseded tests and never-cancelled deploys | Two changes in a row each running the whole path, or a deploy from `main` before its gate |
| `shaping` *(optional)* | Local structured idea review, digest-bound draft writes and robot rubric previews | Recommendations mistaken for owner choices; stale approvals overwriting work |
| `reconciliation` *(optional)* | Local and read-only GitHub record checks, PR impact declarations, manual health proposals | Merges mistaken for acceptance; obsolete next work and decisions |
| `loop` *(optional)* | Stitch Loop findings triaged as files: the ranking is ours, an agent proposes, a person decides | Outside findings taken as verdicts |
| `climb` *(optional)* | Climb nights: on a schedule, an agent improves one number (the suite's time, first) under a shared protocol; a script makes every measurement and keep-or-revert, and a person merges the one PR | A speed-up nobody measured against noise; a test quietly gone |
| `cross-review` *(optional)* | An available provider reviews another provider's PRs, falling back to self-review when necessary; inline P1/P2/P3 findings validated against the code, read-only and budgeted, never approves or merges | Review tied to one provider or running in only one direction |

**Who owns which file.** Every file keel writes is one of three kinds:

- **Managed** files are keel's. They are re-rendered on update.
  `.keel/lock.json` records what keel wrote.
- **Blocks** are the `<!-- keel:begin … -->` regions of the selected agent guide. The
  rest of that file is the project's.
- **Seeded** files (your phases, goals and lessons) are written once, and
  are yours from then on.

If you change a managed file, keel treats it as **signal, not an error**.
`keel render` refuses to overwrite it. `keel doctor` shows the diff and
offers three moves: keep yours (eject), take keel's (restore), or send yours
home as a lesson.

An edit that keel has since made too, such as Renovate bumping an action in
your copy of a keel workflow before keel ships the same bump, is not
treated as yours: the next update simply takes keel's file.

## The loop

1. **Start.** `keel init` in an empty directory, or `keel adopt` in an
   existing repo. Adopt switches on only what the repo already satisfies.
   Everything else is recorded as a local variant with a proposal, never
   overwritten and never faked.
2. **Work.** Phases are the plan. `keel next` lists the phases that are
   ready, and which of them another session already holds. A session takes
   one with `keel phase claim <n>` before it builds, so two sessions never
   build the same phase. In Claude Code, `/conduct` walks them: one phase at
   a time, claimed first, proof verified, one commit each. A session finishes
   with `keel ready` (its fast checks only), and `keel integrate`, one at a
   time under a lock, runs the full gate once for every ready change and
   pushes them together.
3. **Review.** A reviewer reads the PR (with the cross-review practice on,
   the other provider does), and `keel review` makes
   sure every comment is validated and answered. A review that is still
   drawing findings after three rounds stops there: `keel review` hands you
   the choice (merge with the rest tracked, split, or close) with the open
   findings sorted. See [Conduct a phase](docs/guide/conduct-a-phase.md) for
   the whole path.
4. **Overnight.** The project's own nightly runs `scripts/keel/improve.mjs`.
   It writes a dated health page, opens one PR with it, and proposes one
   change. You read it in the morning.
5. **Lessons go home.** `keel lessons` files the project's new lessons, its
   edits to keel's files, and practice-shaped commits as issues on keel's
   inbox (a private repo, so a private project's lessons stay private),
   each exactly once.
6. **At home.** `keel learn` turns those issues, and any upstream source that
   moved, into proposals. A person decides. `keel release` cuts a version.
7. **Out again.** `keel fleet update` opens the update PR in each project
   that's behind. `keel update` runs it: the CLI first, then migrations,
   re-render, the project's own gate, and a byte-for-byte restore if
   anything fails.

`keel fleet` shows every project at once: practice version, health, CI,
unsent lessons, and open machine PRs.

## Private workspace and web UI

Keel's hosted UI is being built around a Home screen that answers three things:
**which decisions need you, what to test step by step, and what changed recently**.
Guided walks will retain “works”, “does not work” and “cannot test yet” observations;
recent additions will include screenshots, tested revisions and links to try them.
Project cards will refresh independently, retain source freshness, and preserve
an open decision or walk when new updates arrive.

**Available today:** the CLI, the local `keel board`, and external workspace
manifest validation/initialization. The first Vercel project has been created,
but **hosted sign-in and Home are not deployed**. Supabase Free is connected to
production; the read-only GitHub App is approved and awaiting GitHub identity
verification before registration. Phase status lives in [the roadmap](docs/ROADMAP.md):
[93: local foundation](docs/phases/93-workspace-data-stays-outside-public-code.md)
is built; [94: connections](docs/phases/94-private-instance-has-approved-connections.md)
is partial; [95: sign-in](docs/phases/95-sign-in-scopes-every-project.md) and
[96: Home](docs/phases/96-home-explains-every-project.md) follow. Decisions,
walks, visual changes and real-use verification follow in phases 97–101.

### Keep application code and private data separate

| Location | What belongs there |
| --- | --- |
| Public Keel repo | Application/CLI code, schemas, reusable practices and synthetic examples |
| Your private data repo, such as `acme/keel-data` | Workspace manifest, shared private lessons, approved cross-project decisions and setup records |
| Each project repo | Its `.keel` configuration, planning records, decisions, evidence and project lessons |
| External private runtime storage | Sessions, drafts, caches and operation receipts; private media storage holds screenshots |
| Deployment secret store | GitHub App credentials, database credentials and session secrets |

The private data repo is yours; it is not a fork of Keel. It does not become a
second authority for project acceptance. Keep tokens, private keys, runtime state
and raw screenshots out of Git, including private Git. Existing fleet and lesson
inbox configuration continue to work; creating this repo does not migrate them
or redirect `keel lessons` automatically.

### Create your private data repo

Install/authenticate GitHub CLI (`gh auth login`) as well as Keel. The following
example creates a **new** private repo; replace `acme` with your account or
organization. To reuse a repo, skip creation and verify its privacy. Keep its
checkout outside the public Keel application directory.

```sh
mkdir -p "$HOME/code"
gh repo create acme/keel-data --private --description "Private Keel workspace records" --add-readme
gh repo view acme/keel-data --json nameWithOwner,isPrivate,id
gh repo clone acme/keel-data "$HOME/code/keel-data"
```

Confirm the readback says `"isPrivate": true`. In that checkout, create
`workspace.json` with your identity. Start with an empty project list:

```json
{
  "version": 1,
  "id": "acme",
  "name": "Acme",
  "repo": "acme/keel-data",
  "projects": []
}
```

Keep this manifest in the private repo. Add entries such as
`{"id":"studio","repo":"acme/studio"}` when selecting projects; listing a repo
does not grant GitHub access or adopt it into Keel. The [setup guide](docs/guide/web-workspace-setup.md)
covers private commits, project records, validation and the lesson inbox.

### Validate and initialize local workspace state

Choose a runtime directory outside **every Git working tree**, the application,
and the manifest directory. Its parent must already exist. For a normal home
layout, these locations are separate:

```sh
mkdir -p "$HOME/.local/state"
keel workspace inspect --manifest "$HOME/code/keel-data/workspace.json" --state "$HOME/.local/state/keel-workspace" --json
keel workspace init --manifest "$HOME/code/keel-data/workspace.json" --state "$HOME/.local/state/keel-workspace" --json
# Preview intentionally exits 3. After reviewing it, apply explicitly:
keel workspace init --manifest "$HOME/code/keel-data/workspace.json" --state "$HOME/.local/state/keel-workspace" --yes --json
```

Initialization creates a private ownership marker and is idempotent for matching
state. Unsafe or mismatched state is refused. `privacy.state` remains
`"unverified"`: the local command never contacts GitHub or establishes login,
even if you verified privacy separately with `gh`. Run
`keel --agent-help workspace` for the complete schema and command contract.

### Prepare a hosted instance on Vercel

The selected hosting design uses Vercel Node functions, the private data repo,
an external transactional database, and a GitHub App installed on selected
repositories. Vercel's temporary filesystem cannot hold durable sessions or
drafts. The first instance uses Supabase Free through Marketplace;
private screenshot storage is a later phase. Verify current plan limits, price
and backup needs before provisioning.

Follow [Set up a private Keel web workspace](docs/guide/web-workspace-setup.md)
for Vercel login/team selection, project creation, the saved-login path workaround,
GitHub App permissions, production-only secrets and the remaining acceptance
checks. A Vercel project or domain alone is not a running Keel UI. The local
workspace commands above do not provision the hosted stores or start a server.

See the [UX design](docs/specs/web-ui.md),
[interactive Home prototype](docs/design-previews/keel-home.html),
[CLI-to-UI mapping](docs/specs/web-ui-command-map.md) and
[workspace contract](docs/specs/web-workspace.md). The prototype contains synthetic
examples; open the HTML locally to explore it.

## Guides

Each guide starts from a situation, says why keel does what it does there,
then gives the commands and every flag by the reason you'd pass it.

| Guide | Read this when… |
| --- | --- |
| [Start a project](docs/guide/start-a-project.md) | you have an idea and an empty directory |
| [Bring a project under keel](docs/guide/bring-a-project-under-keel.md) | a repo already exists, perhaps with its own copy of the practice |
| [Plan with phases and goals](docs/guide/plan-with-phases-and-goals.md) | you are lining up the work and saying what done means |
| [Conduct a phase](docs/guide/conduct-a-phase.md) | a phase is specified and you want it built without trusting the builder's word |
| [The night shift](docs/guide/the-night-shift.md) | you want to know each morning whether the practice is holding |
| [Climb and tend](docs/guide/climb-and-tend.md) | you want an agent to improve a number, or keep the records true, while you sleep |
| [Lessons and learning](docs/guide/lessons-and-learning.md) | a bug turned out to have a shape, or lessons are waiting at home |
| [Keep the fleet current](docs/guide/keep-the-fleet-current.md) | the practice changed and every project should have it |
| [Production errors](docs/guide/production-errors.md) | repeated runtime errors should become evidence-backed repair work |
| [The robot](docs/guide/the-robot.md) | Preview agent issues and opt in to bounded build/review work |
| [Reviews and PRs](docs/guide/reviews-and-prs.md) | a PR from keel arrived, or a reviewer commented on one |
| [Delivery](docs/guide/delivery.md) | two changes in a row should publish once, and deploys should follow tested commits, not `main` |
| [When something is red](docs/guide/when-something-is-red.md) | a night, an update, a doctor or a climb did not go green |
| [Project canvas](docs/guide/project-canvas.md) | you want a source-linked view of the project's lifecycle and improvement |
| [Session handoff trials](docs/guide/session-handoff-trials.md) | you want to measure and tune session handoffs within a bounded experiment |
| [Loose ends and the retro](docs/guide/loose-ends-and-retro.md) | you are picking work back up, or a phase just finished |
| [Private web workspace setup](docs/guide/web-workspace-setup.md) | you want a private data repo and the path to hosted sign-in and Home |
| [The board](docs/guide/the-board.md) | you are asking "what's next?", or what is waiting on you |

## The verbs

Every verb takes `--json`. Exit codes are the same everywhere:

- **0:** done.
- **1:** it ran and found something.
- **2:** usage error, or not where it can run.
- **3:** it needs a yes. Run it again with `--yes`.

**In a project:**

| Verb | What it does |
| --- | --- |
| `keel status`, `keel next` | Where the project stands; the next free phase, and which ready ones are claimed |
| `keel goal list\|show\|add\|retire` | Goals as outcomes. Progress is derived from phases, never stored |
| `keel phase new\|list\|claim` | Scaffold the next free phase under a goal; claim a phase before building it |
| `keel ready`, `keel integrate` | Hand a committed change off with only its fast checks; one integrator (lock `claims/integrate`) runs the full gate once for every ready change and pushes once, sending a failing change back blocked |
| `keel init`, `keel adopt` | Start a project, or bring one under keel |
| `keel render` | Write the practices onto the project; `--check` only compares |
| `keel doctor` | What the project changed of keel's files, and practice rules broken. Changes nothing without `--fix` |
| `keel improve` | Measures against bounds, including worktree/draft/file hygiene; `--report` writes the health page and its proposal |
| `keel persona run [<name>\|--all]` | Measure the goals a project sets itself in `.agents/personas/<name>.md`: each command's one number against its bound, met, missed or broken; writes `docs/reviews/<date>-<persona>.md` and nothing else |
| `keel time [--weeks N]` | Retained weekly gate/test timing, load coverage, failure memory and local worked-around test summaries |
| `keel test <file> --stalls` | Run test files paused at random moments, and without; name each test that judges the wall clock rather than the code |
| `keel update` | Take the next practice version, as a branch for a PR (or `--local`) |
| `keel lessons` | Send what this project learned home to keel |
| `keel drain <prefix>` | Keep one open PR per machine queue (the nightly runs this) |
| `keel night plan`, `keel night tick <id>` | Write tonight's default plan before the night runs; tick one of its items with a status, a note and a link |
| `keel goodnight` | You shape tonight's plan: what was settled and left open, the default plan, things to try; add, drop, edit, budget or skip items; `--yes` pushes it to the plan branch |
| `keel morning` | The night's brief: done, tried, failed and why, left alone, your next; `--send` opens the assigned "Good morning" issue, once a night; `--card` keeps the plan as a live canvas card |
| `keel retro sessions` | Reserve and record bounded handoff trials; audit, promote and roll back within an explicit envelope (`keel improve --sessions` reads the same evidence) |
| `keel retro` | After a phase that changed more than docs: a worksheet from the session's transcript (counts and pointers, never its text) and seven areas to answer; the owner picks what becomes a check |
| `keel shape check\|render\|plan` | Validate and render local shaping records; write drafts with `--yes --digest <reviewed-digest>` |
| `keel decision context` | Read scoped decisions for `--phase <id>` or `--issue <owner/repo#n>`; refresh before dispatch or resume |
| `keel evidence rederive <phase>` | Preview structured measurements from a phase’s evidence; `--yes` reruns them and compares dated old/new values without rewriting history |
| `keel prove <test> --fix <path>...` | A fix is proven by its test failing without it: runs the test with the fix reverted in a scratch copy of the repository, then with it, and prints VERIFIED, NOT WORKING or INCONCLUSIVE; `--trailer` gives the `Proven-by:` line a `fix:` commit carries. Never touches your tree |

**At home, in keel's own checkout:**

| Verb | What it does |
| --- | --- |
| `keel learn` | Lesson issues and moved sources become proposals: `propose` is an agent's, `decide` is a person's |
| `keel release` | Release the CLI; bump the practice only when project-facing files changed, with a what's-new for the recipient |
| `keel fleet`, `keel fleet update` | Every project at a glance; open update PRs where they're behind |

**Across projects:**

| Verb | What it does |
| --- | --- |
| `keel workspace inspect\|init` | Inspect explicit external workspace configuration; preview private runtime initialization, then apply with `--yes`; remote privacy remains unverified |
| `keel canvas` | Project lifecycle snapshots and isocan canvas publishing; preview changes before applying them |
| `keel loose-ends` | What you started and didn't finish, across keel and each fleet checkout: chats, files, branches, PRs, owner steps; `mark` one resume, park or drop |
| `keel production status`, `collect`, `spec`, `verify` | Bounded production-error evidence, recurring repair candidates, and revision-scoped verification; missing coverage stays unknown |
| `keel issue new --agent` | Preview a rubric issue; `--yes` creates it, unlabelled while robot is OFF |
| `keel review <repo>#<n>` | A PR's review comments and which are answered; `--wait` for its reviewers; `--close` answers one fixed, tracked or not valid, only once it was read; `--class` sorts a finding without answering it. At three review rounds on an open PR it exits 3 and gives you the choice. Not a gate |
| `keel board` | Whose turn it is: every open item as yours, broken, the agent's or waiting on time, gathered from the roadmap, loose ends, reviews, the health page, the inbox and the fleet. A page on 127.0.0.1, or `--json` |
| `keel promote [<commit>]`, `keel promote --back <commit>` | Move production (`delivery.promote`, like `tag:prod`) only to a commit on the tested ref whose gate passed: a preview first, then `--yes` moves it and verifies production serves it; `--back` rolls back and passes only when production serves exactly that commit. A person's command: no workflow runs it |
| `keel walk done\|decide` | Settle the owner's turn: `done` checks a phase's ⚑ walk and writes the read into its evidence (built when nothing is left open); `decide` accepts or declines a health proposal; time proposals require `--instance`, create/recover their issue on acceptance, and support reviewed `--map` transitions. Leaves a diff to commit |

## Where a person decides

Keel stops and asks, with the price, before anything that:

- creates a repo;
- sets a secret or changes a repo setting;
- opens a PR or an issue elsewhere;
- spends money or model tokens on a schedule.

Outward verbs print their plan and exit 3 until they get `--yes`.

Judgements are a person's too. An agent may *propose* a lesson, a rank or a
fix, and `keel learn decide` and Loop's `decide` are a person's. Nothing
marks a phase `lived-in` except someone who used the thing.

## Evidence, timing and decisions

`keel time --weeks 8 --json` shows retained gate/test timing, machine load
coverage and local worked-around counts. [Timing and the night](docs/guide/the-night-shift.md).

Adoption previews include monthly weighted-minute estimates for newly added
workflows, with history and coverage. `keel improve` reports `ci_minutes`;
`ci.gateWorkflow` can reuse completed CI on the exact clean default-branch SHA.
These usage estimates are not invoices. [CI usage and reuse](docs/guide/the-night-shift.md#actions-usage-and-reusing-ci).

Builders can read current scoped choices with
`keel decision context --phase <id> --json` (or `--issue <owner/repo#n>`).
See [decision context](docs/reconciliation.md#decision-context-for-a-builder)
for read bounds, provenance, exit states and dispatch/resume checks.

Use the optional [shaping practice](practices/shaping/README.md) to review supplied
records locally. [The guide](practices/shaping/files/docs/shaping.md) includes
a minimal fixture and the exact preview/approval/recovery commands.

## Working on keel itself

Keel is built with its own practice. [AGENTS.md](AGENTS.md) is the working
guide, [docs/design.md](docs/design.md) is the argument, and
[docs/ROADMAP.md](docs/ROADMAP.md) is where it stands.

```bash
npm run next     # next phase and action
npm run check    # tests, roadmap, rendered practices and inbox views
npm ci --ignore-scripts  # development-only type tooling
npm run typecheck        # checked JSDoc, no emitted JavaScript
```

In Claude Code, `/conduct` walks the phases.

The CLI still runs directly from its `.mjs` source with zero runtime
dependencies. Type checking covers selected production evidence contracts;
it does not compile the CLI or change what adopted projects must install.
See [measuring CLI cost and checking contracts](docs/development.md).

## Lineage and license

The practice was invented in [isocan](https://github.com/dglazkov/isocan),
ported to ledger, then to duo and cajones. Keel adapts isocan's conduct skill
and its measurement ideas under Apache-2.0, and credits them in
[NOTICE](NOTICE) and in each adapted file's header. Keel itself is
Apache-2.0.
