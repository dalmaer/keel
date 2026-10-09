# When something is red

## When you'd reach for this

Something keel runs did not go green, and you want to know what it means
and what to do first. Each case below is a situation, what it means, and
the first move. The rule under all of them: **red means a person should
look**, and keel never turns red into green by retrying, guessing or
writing over your work.

## What each one means, and the first move

### A red night

GitHub emailed: `keel-night.yml` failed. A measure outside its bound is
news on the page, not red, so a red night means one of these:

- **The gate failed** on the default branch. Run the project's `check`
  locally on `main`. Read the test ledger's hygiene block at the end: if it
  names a flaky test, that is your next piece of work. Never rerun until
  green.
- **An instrument is broken** (improve exited 2): a measure could not run,
  and the night refuses to report it as zero. Run `keel improve` and read
  the `broken` row's detail; it says what could not be read.
- **The health directory is git-ignored**, so the page could never be
  committed. Set `health` in `.keel/keel.json` to a directory that isn't
  (`keel doctor` names this one as `health-ignored`).

If the run is green but no PR opened, the run's summary has a notice: most
often the repo setting that lets Actions create PRs is off (a ⚑ step for the
owner).

### `keel update` refused

- **Exit 1, "the project changed keel's …"**: a file keel manages was
  edited here. Update never overwrites that. Run `keel doctor` to see the
  diff, then pick one of three moves: keep yours
  (`keel doctor --fix <path> eject --yes`), take keel's
  (`keel doctor --fix <path> restore --yes`), or send yours home as a lesson
  (`keel lessons`) and keep it until keel decides. Then update again.
- **Exit 2, "update keel first"**: the project is on a newer practice than
  your keel. Pull keel's checkout (or let `keel update` do it by not passing
  `--no-self-update`).
- **Exit 2, "the working tree is not clean"**: commit what you have first,
  so the update is its own change.
- **"render would overwrite …, which keel never wrote here"**: a file is in
  the way that keel would create. Move it aside, or eject it.

### The gate failed after an update

Update ran the project's `check` on the updated tree, it failed, and every
byte update touched was put back: the project is exactly as it was. The
message ends with the gate's output. The usual causes are a migration
meeting something in this project keel's fixtures didn't have, or the
project's gate needing an install or an environment variable keel doesn't
know about (`setup` and `env` in `.keel/keel.json`; see
[Bring a project under keel](bring-a-project-under-keel.md)). Try
`keel update --local` to look at the change in the working tree, run the
gate yourself, and if keel's change is wrong, that is a lesson to send home.

From `keel fleet update`, the row's last line says which it was: the same
check ran once more on the clone without the update. "main fails the same
check without the update" means fix main first; this update is not the
cause. "main passes without the update" means the update, or a test that
fails only sometimes: run that test alone before blaming either.

### `keel doctor` exits 1

Doctor has findings. It changes nothing without `--fix`. Read it by section:

- **Changed by the project**: drift, as in "update refused" above. Signal,
  not an error.
- **Behind keel**: unchanged files keel's template has moved past. Not a
  finding to fix by hand; `keel update` brings them.
- **Practice rules**: lints, each naming its file and line. A `phase` lint
  means a phase still holds template text, or a spec 2 box names no check
  ([Plan with phases and goals](plan-with-phases-and-goals.md)). A
  `platform-guard` lint means a test runs a macOS-only tool (`hdiutil`,
  `ditto`, `codesign`, `stat -f`…) with no skip, so it passes on your Mac and
  fails on Linux CI. Add `{ skip: process.platform !== 'darwin' }` to that
  test. A tool of your own goes in `.keel/keel.json` `platformTools`.
- **Notes**: information. They never change the exit code.

### `keel render --check` differs

Exit 1, listing each file that differs from what this keel carries. A file
marked as changed by the project is drift (see `keel doctor`); render will
refuse to write it. One that is only behind is fixed by `keel render`, or
better by `keel update`, which also runs migrations and the gate.

### A climb or tend night that didn't start

Read the run's summary. In order of likelihood:

- **No `climb` (or `tend`) in `.keel/keel.json`**: off, by design. The run
  says so and does nothing.
- **No secret**: green, with a notice naming `CLAUDE_CODE_OAUTH_TOKEN` (or
  `ANTHROPIC_API_KEY`). Setting it is the owner's ⚑ step.
- **An open PR from the last pass**: the job (or tend) waits for you to read
  it. Merge or close it.
- **Three PRs closed unmerged**: the job proposes its own retirement on the
  health page and is skipped until you remove it from `jobs` or reopen one.
- **Not tonight**: a `weekly` schedule runs on Mondays.

`node scripts/keel/climb.mjs pick` (or `tend-pick`) says which, without
spending anything. A climb run that is **red** means the agent failed before
its budget ran out: the step after it prints the error's text, saying
whether the secret or the model was refused.

### A command exited 2 or 3

Not a failure:

- **2** is usage, or the wrong place: not in a keel project, a keel-only
  verb outside keel, a flag that doesn't exist. Under `--json` the reason is
  `{"error": "…"}` on stdout. `keel help` lists every verb with its usage
  line. There is no per-verb `--help` (it is refused as an unexpected
  argument); `keel --agent-help` lists the topics that hold each verb's
  details, and `keel --agent-help <topic>` opens one.
- **"no such verb", or a flag this guide names that your keel refuses**: your
  keel may be older than the guide. `keel --version` prints the CLI's
  version, its commit and the practice version it carries; `keel update`
  pulls keel's checkout first.
- **3** means a ⚑ step was planned and nothing was done. Read the plan; run
  it again with `--yes` if it is yours to approve.

## The commands

```bash
keel doctor            # drift, lints and notes; changes nothing
keel improve           # every measure now, with the broken one's reason
keel render --check    # what differs from this keel's practice; writes nothing
keel update --local    # the update as a working-tree diff, to look at
```

## What you'll see

Every keel verb uses the same exit codes: **0** done, **1** it ran and found
something, **2** usage or not where it can run, **3** it needs a yes. Under
`--json`, stdout carries one JSON document, and an error is `{"error":
"…"}`.

## What it never does

- It never reruns a failed check until it passes.
- It never restores your edit away silently: drift is shown, and the choice
  is yours.
- It never leaves a half-applied update.

## See also

- [The night shift](the-night-shift.md): what each measure means.
- [Keep the fleet current](keep-the-fleet-current.md): update's order, and
  why.
- `keel --agent-help doctor` and `keel --agent-help update`: the exact
  reference.
