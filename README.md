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
2. **Work.** Phases are the plan. `keel next` names the next one and its
   next action. In Claude Code, `/conduct` walks them: one phase at a time,
   proof verified, one commit each.
3. **Overnight.** The project's own nightly runs `scripts/keel/improve.mjs`.
   It writes a dated health page, opens one PR with it, and proposes one
   change. You read it in the morning.
4. **Lessons go home.** `keel lessons` files the project's new lessons, its
   edits to keel's files, and practice-shaped commits as issues on keel's
   inbox (a private repo, so a private project's lessons stay private),
   each exactly once.
5. **At home.** `keel learn` turns those issues, and any upstream source that
   moved, into proposals. A person decides. `keel release` cuts a version.
6. **Out again.** `keel fleet update` opens the update PR in each project
   that's behind. `keel update` runs it: the CLI first, then migrations,
   re-render, the project's own gate, and a byte-for-byte restore if
   anything fails.

`keel fleet` shows every project at once: practice version, health, CI,
unsent lessons, and open machine PRs.

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
| [The robot](docs/guide/the-robot.md) | Preview agent issues and opt in to bounded build/review work |
| [Reviews and PRs](docs/guide/reviews-and-prs.md) | a PR from keel arrived, or a reviewer commented on one |
| [When something is red](docs/guide/when-something-is-red.md) | a night, an update, a doctor or a climb did not go green |
| [Project canvas](docs/guide/project-canvas.md) | you want a source-linked view of the project's lifecycle and improvement |
| [Loose ends and the retro](docs/guide/loose-ends-and-retro.md) | you are picking work back up, or a phase just finished |
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
| `keel status`, `keel next` | Where the project stands; the next phase and its next action |
| `keel goal list\|show\|add\|retire` | Goals as outcomes. Progress is derived from phases, never stored |
| `keel phase new\|list` | Scaffold the next free phase under a goal |
| `keel init`, `keel adopt` | Start a project, or bring one under keel |
| `keel render` | Write the practices onto the project; `--check` only compares |
| `keel doctor` | What the project changed of keel's files, and practice rules broken. Changes nothing without `--fix` |
| `keel improve` | Is the practice working here? Measures against bounds, one proposal; `--report` writes the health page |
| `keel time [--weeks N]` | Retained weekly gate/test timing, load coverage, failure memory and local worked-around test summaries |
| `keel test <file> --stalls` | Run test files paused at random moments, and without; name each test that judges the wall clock rather than the code |
| `keel update` | Take the next practice version, as a branch for a PR (or `--local`) |
| `keel lessons` | Send what this project learned home to keel |
| `keel drain <prefix>` | Keep one open PR per machine queue (the nightly runs this) |
| `keel retro` | After a phase that changed more than docs: a worksheet from the session's transcript (counts and pointers, never its text) and seven areas to answer; the owner picks what becomes a check |
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
| `keel canvas` | Project lifecycle snapshots and isocan canvas publishing; preview changes before applying them |
| `keel loose-ends` | What you started and didn't finish, across keel and each fleet checkout: chats, files, branches, PRs, owner steps; `mark` one resume, park or drop |
| `keel issue new --agent` | Preview a rubric issue; `--yes` creates it, unlabelled while robot is OFF |
| `keel review <repo>#<n>` | A PR's review comments and which are answered; `--wait` for its reviewers; `--close` answers one fixed, tracked or not valid, only once it was read. Not a gate |
| `keel board` | Whose turn it is: every open item as yours, broken, the agent's or waiting on time, gathered from the roadmap, loose ends, reviews, the health page, the inbox and the fleet. A page on 127.0.0.1, or `--json` |
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

`keel time --weeks 8 --json` shows retained gate/test timing, machine load
coverage and local worked-around counts. [Timing and the night](docs/guide/the-night-shift.md).

Adoption previews include monthly weighted-minute estimates for newly added
workflows, with history and coverage. `keel improve` reports `ci_minutes`;
`ci.gateWorkflow` can reuse completed CI on the exact clean default-branch SHA.
These usage estimates are not invoices. [CI usage and reuse](docs/guide/the-night-shift.md#actions-usage-and-reusing-ci).
