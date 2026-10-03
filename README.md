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
   new version, always as a pull request a person reads.
3. **It is where lessons come home.** A project sends what it learned
   (`keel lessons`). Keel turns that into proposals (`keel learn`), a person
   decides, and the next release carries the change to everyone.

A project never depends on keel at runtime. Its workflows run from its own
repo, with its own copies of the scripts they need.

> **If you are an agent, run `keel --agent-help` first.** It prints a cold
> start: what keel is, every verb on one line, and the rules that bite.
> `keel --agent-help <topic>` opens the details, and `all` prints everything.
> It ships with the CLI, so it always matches the keel you have. The rest of
> this page is the same story, told for people.
>
> Every keel project carries a short `keel` skill at
> `.agents/skills/keel/SKILL.md` (linked from `.claude/skills/keel`). An agent
> working there finds keel and runs `keel --agent-help` without being told.

## Install

Node 24 or later, and git. No registry, no build step.

```bash
git clone https://github.com/dalmaer/keel ~/code/keel
```

```bash
npm install -g ~/code/keel
```

Then `keel --version` prints the CLI's version, its commit, and the
practice version it carries. The global install is a link to the checkout,
so updating keel is a `git pull` there, and `keel update` does that for you
first.

## What a project gets

A project that uses keel carries `.keel/keel.json`, which records:

- its name;
- the gate command that must pass (`check`);
- the practice version it is on;
- the practices it has switched on;
- anything it does its own way, as a *local variant* with a reason.

**The practices:**

| Practice | What it gives a project | The failure it prevents |
| --- | --- | --- |
| `base` | The project's skeleton: Node pinned in `.nvmrc`, a `package.json` whose `check` is the gate, an ignore file | Each project starting from a different floor |
| `phases` | One file per phase in `docs/phases/`, owning its status; `docs/goals.json`; a generated roadmap that CI checks | Status written in two places, drifting |
| `evidence` | `built` needs an evidence file that says what was actually checked | Claiming what was never run |
| `lessons` | `docs/lessons.md`: failure *shapes*, each with the guard that now catches it | Paying for the same bug twice |
| `conduct` | The conductor skill: brief a builder, verify the named proof yourself, record, commit | Trusting a subagent's "tests pass" |
| `agents-md` | `AGENTS.md` sections for each practice; `CLAUDE.md` as a one-line pointer | Instructions copied per harness, ageing |
| `ci` | A `check` workflow running the project's own gate | A green laptop that isn't the build |
| `night` | `keel-night.yml` measures the project nightly, opens at most one PR, and goes red only when something is broken | Guards that fire into an empty room |
| `claude` *(optional)* | `@claude` on issues and PRs: it opens PRs and never pushes to `main` | Agents landing unread changes |
| `renovate` | Dependency updates in four lanes: small ones merge on green, majors wait for a person | A pile of dependency PRs nobody reads |
| `loop` *(optional)* | Stitch Loop findings triaged as files: the ranking is ours, an agent proposes, a person decides | Outside findings taken as verdicts |

**Who owns which file.** Every file keel writes is one of three kinds:

- **Managed** files are keel's. They are re-rendered on update.
  `.keel/lock.json` records what keel wrote.
- **Blocks** are the `<!-- keel:begin … -->` regions of `AGENTS.md`. The
  rest of that file is the project's.
- **Seeded** files (your phases, goals and lessons) are written once, and
  are yours from then on.

If you change a managed file, keel treats it as **signal, not an error**.
`keel render` refuses to overwrite it. `keel doctor` shows the diff and
offers three moves: keep yours (eject), take keel's (restore), or send yours
home as a lesson.

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
   edits to keel's files, and practice-shaped commits as issues on keel,
   each exactly once.
5. **At home.** `keel learn` turns those issues, and any upstream source that
   moved, into proposals. A person decides. `keel release` cuts a version.
6. **Out again.** `keel fleet update` opens the update PR in each project
   that's behind. `keel update` runs it: the CLI first, then migrations,
   re-render, the project's own gate, and a byte-for-byte restore if
   anything fails.

`keel fleet` shows every project at once: practice version, health, CI,
unsent lessons, and open machine PRs.

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
| `keel update` | Take the next practice version, as a branch for a PR (or `--local`) |
| `keel lessons` | Send what this project learned home to keel |
| `keel drain <prefix>` | Keep one open PR per machine queue (the nightly runs this) |

**At home, in keel's own checkout:**

| Verb | What it does |
| --- | --- |
| `keel learn` | Lesson issues and moved sources become proposals: `propose` is an agent's, `decide` is a person's |
| `keel release` | Cut a practice version, with a what's-new written for the person receiving it |
| `keel fleet`, `keel fleet update` | Every project at a glance; open update PRs where they're behind |

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
npm run next
```

```bash
npm run check
```

In Claude Code, `/conduct` walks the phases.

## Lineage and license

The practice was invented in [isocan](https://github.com/dglazkov/isocan),
ported to ledger, then to duo and cajones. Keel adapts isocan's conduct skill
and its measurement ideas under Apache-2.0, and credits them in
[NOTICE](NOTICE) and in each adapted file's header. Keel itself is
Apache-2.0.
