# Start a project

## When you'd reach for this

You have an idea and an empty directory (or one holding nothing but `.git`).
You want the project to start the way keel's own projects run: a plan you
can check, a gate that is the same on your laptop and in CI, and a night
that tells you each morning whether the practice is holding.

If the directory already has code in it, you want
[Bring a project under keel](bring-a-project-under-keel.md) instead. If it
is already a keel project, you want `keel update`
([Keep the fleet current](keep-the-fleet-current.md)).

## What it does, and why it works that way

`keel init` writes the whole practice in one commit, and it starts you with
three things rather than a blank page:

- **A phase, not a to-do list.** It seeds goal G0 and
  `docs/phases/00-first-thing-that-runs.md`. Phase 0 is deliberately a
  draft: its Done when, Acceptance and Proof are generic until you replace
  them with the first thing a person could check. Starting with a phase means
  the first conversation is "what will prove this works?", before any code.
  The alternative, a plan kept in a README and in someone's head, is the
  shape keel's lesson 2 records: status written in two places drifts.
- **A gate.** `npm run check` is the one command that must pass, locally and
  in CI (the `base` and `ci` practices). On a node project the test script
  also carries the test ledger, so a run that executed no test fails rather
  than passing empty (lessons 14 and 38, "a check that cannot fail").
- **A night.** `keel-night.yml` measures the project every night and opens
  at most one PR with a dated health page. It costs nothing: no model, no
  secret. It exists because a guard nobody sees is no guard (lesson 3).

Init asks no questions. Everything it needs is a flag, so an agent can run it
as easily as a person, and the same flags give the same project.

## The commands

```bash
keel init acme-notes --description "Acme Notes keeps meeting notes as plain files. It finds any of them by a word." --kind node
cd acme-notes && keel next
```

Each flag, by why you'd pass it:

- `--description "<paragraph>"` (required). The one paragraph every agent
  reads first: it goes into `AGENTS.md`, becomes goal G0's outcome, and its
  first sentence titles G0. It is required because a project nobody has
  described gets agents guessing what it is for.
- `--name <n>`. Only when the project's name is not the directory's name.
  The name is what lessons are filed under when there is no repo, and what
  the fleet shows.
- `--tagline <t>`. Only when the description's first sentence is not the
  line you want on the project's front door; it defaults to that sentence.
- `--kind static|node|web|other`. Pass `node` for a Node project: the seeded
  `package.json` gets a test script that runs node's runner with the test
  ledger beside it, so the night can name a flaky or slower test from the
  first run. The default is `other`.
- `--repo owner/name`. Pass it when you know where the project will live on
  GitHub. Measures that ask GitHub (CI red streak, machine PRs, phases with
  no issue) are n/a without it, and lessons are fingerprinted under it.
- `--with <practice>`, repeatable. Switches on an optional practice. The
  optional ones are marked in the README's practice table; `--with` with any
  other name is refused, and the refusal lists the ones it takes. Each
  optional practice is off by default for a reason: `claude` and `climb`
  spend model tokens, `loop` needs a Loop workspace, `reconciliation` adds
  record checks a small project may not want.
- `--github`. Plans a private GitHub repo for the project and prints the
  secrets each switched-on workflow needs. It creates nothing: it exits 3.
  Add `--yes` to init and then create the repo and push. Creating a repo is a
  ⚑ step, the owner's, which is why it never happens without the yes. Keel
  never sets a secret.

Then make phase 0 real. Its next action says how: replace the draft's Done
when, Acceptance and Proof with the first thing that runs, as its own
commit, and conduct it ([Conduct a phase](conduct-a-phase.md)).

## What you'll see

A line naming the directory, the practice version and the commit, then the
next command to run and the secrets needed (often none). If `keel` is not on
your `PATH`, it says how to run it through `npx`.

- **0**: initialised and committed on `main`.
- **2**: a usage error, or the wrong directory. A directory that is already a
  keel project is refused (use `keel update`); one holding anything besides
  `.git` is refused (use `keel adopt`). An unknown `--with` is refused here
  too.
- **3**: `--github` without `--yes`. The plan is printed; nothing was
  written.

`keel --agent-help init` is the exact reference, including the JSON shape.

## What it never does

- It never creates a GitHub repo, pushes, or sets a secret without `--yes`,
  and it never sets a secret at all.
- It never writes into a directory with work in it. That is adopt's job,
  which reads what is there before switching anything on.
- It never fills in phase 0 for you. The draft is generic on purpose; the
  first real check is yours to name.

## See also

- [Plan with phases and goals](plan-with-phases-and-goals.md): what to do
  with phase 0, and the phases after it.
- [The night shift](the-night-shift.md): what the night you just installed
  will measure.
- [`practices/`](../../practices/): each practice's own argument.
