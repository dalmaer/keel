# night

**The failure it prevents.** A machine queue that produces daily and drains
never: five open machine PRs at once on isocan (9 Sep 2026), each waiting on a
person remembering. A bot that writes to `main`. A merge that trusts a check
that never ran, because a `GITHUB_TOKEN` PR runs no CI. A nightly that fails
onto a page nobody opens (keel lesson 3). A commit step that tests
`git diff --quiet` and so never sees a file created for the first time
(ledger's audit agent lost every report to it).

**The rule.** A project's night runs from its own repo: everything it runs
is a managed file of this practice; it never fetches keel and needs no
secret (design §6, "Projects run on their own"). `keel-night.yml` runs
every night at 07:23 UTC (and by hand):

1. The test ledger's history is gathered (CI's `keel-test-runs` artifacts,
   below); then `node scripts/keel/improve.mjs --report` measures the practice and writes
   `<health>/<date>.md` and `.keel/bounds.json`. `<health>` is `"health"` in
   `.keel/keel.json` (default `docs/health`), read at run time; a directory
   the project git-ignores makes the run red, since its page would never be
   committed (ledger lost its pages that way). (On keel itself,
   `keel learn` gathers first). It runs before the drain, so `machine_prs`
   counts last night's PR.
2. If `git status --porcelain` shows a change in the night's data (the
   health directory, `docs/inbox/`, `docs/INBOX.md`, `.keel/bounds.json`;
   nothing else a gate run leaves behind), it is committed on
   `keel-night/<date>`, pushed to that branch only, and opened as one PR
   whose body is `scripts/keel/pr-body.mjs`'s (below), with the page's
   proposal as its note.
3. `node scripts/keel/drain.mjs keel-night/ --yes` keeps the queue at one:
   each older PR is merged when it holds only data (the health directory,
   `docs/inbox/`, `docs/INBOX.md`, `.keel/bounds.json`) and still merges, and
   closed as superseded otherwise, with a comment saying how to recover it
   (the branch is kept). The newest merges only with `--gate-passed`, which
   the workflow passes only when the gate improve ran on this tree passed.
4. A broken instrument (improve exit 2) or a failing gate fails the run, and
   GitHub emails. A measure outside its bound (exit 1) is news on the page,
   not red.

`keel improve` and `keel drain` are these same modules, run from keel. What
a project's copy cannot read alone it calls `keel-side only`, never a zero:
drift there is by `.keel/lock.json` (bytes keel did not write are `edited`;
`behind` needs keel's templates), lint is the rules its own files show
(phase, goal-without-phase, claude-md-pointer, second-copy,
symlink-replaced, health-config, health-ignored), and the inbox is keel's.

**Proof lost.** `proofs_hold` (bound 0, no ratchet) counts the built or
lived-in phases whose Acceptance cites a `tests/` path that no longer
exists, or a named test (`tests/<file>: "<name>"`) that did not pass in the
newest recorded run of that file (the test ledger, below), or whose
`evidence` names a file that is gone; the page names each phase and what is
lost. A cited test in no recorded run is said, not counted. The night never
steps a phase back or writes evidence; its proposal is to make the test
pass, re-point the reference, or step the phase back with a reason, which a
person does.

**Escapes** (phase 34). `escapes` counts the defects found after a phase
was built, since the newest release tag (`v*`; with none, the first commit),
from what is already written: a commit whose subject starts `fix:` or
`fix(` (never "fix" mid-subject), a lessons row added since the tag whose
provenance italics name the project (its `repo` or `name`), and a
Trajectory entry added since the tag that begins `- **YYYY-MM-DD** —
Escape:` (the phases README's marker; no prose is read). A fix commit that
names a lesson counted there is that lesson's escape, counted once. Each is
attributed to the one phase its text names (`phase 33`, `phases/33-`; a
lesson by its shape and cost, not the guard; an Escape entry naming none
belongs to its own file's phase); none or several is counted unattributed,
never guessed. The bound is no rise release over release: the previous
release's own count, from git, which `--report` records in
`.keel/bounds.json` (no release before: recorded only). Its proposal names
the phase with the most escapes as the next hygiene target. Beside it, not
judged, the detail carries the ceremony of each phase built since the tag:
days from planned (`since` with `status: planned`) to the commit that set
`built`, and the phase file's words. A shallow clone, or no repository or
commits, is n/a, never zero.

**Every test run is remembered** (phase 33). `scripts/keel/test-ledger.mjs`
is a node test reporter, run beside the usual one:

    node --test --test-reporter=spec --test-reporter-destination=stdout \
      --test-reporter=./scripts/keel/test-ledger.mjs --test-reporter-destination=stdout …

It changes nothing about the run's output, and its exit code in one case:
**a run that executed no test fails**, "no tests ran" (keel's lessons 14
and 38: a gate that ran nothing passed). A test passed or failed counts; a
skipped one, and a file with no test in it (node reports the file itself),
do not. A project with no tests yet says so: `"tests": {"allowEmpty": true}`
in `.keel/keel.json`. It records each
top-level test (file, name, outcome, ms) with the commit, the tree, whether
the tree was dirty, the machine and node, in `.keel/test-runs/` (the newest
50 runs; the directory holds a `.gitignore` of `*`, so no project's
`.gitignore` changes), and ends the run with a hygiene block: one line when
clean, else each test that is

- **flaky** — passed and failed on one clean tree (a fact, no threshold), or
- **slower** — above twice its median over its last 20 passing runs on the
  same machine class, and more than 200 ms above it,

with its history in one line and the command to run it alone. `"tests":
{"window", "factor", "floorMs"}` in `.keel/keel.json` overrides 20, 2 and
200 (and `allowEmpty`, above). The AGENTS block says what to do with one: **a hygiene note is work** —
fix it or file it, never rerun until green.

`keel init` wires the reporter into a node project's `npm test`; migration
0004 adds it to an adopted project's `scripts.test` when it is node's runner
(`node --test`, or `node --import … --test`) and leaves every other runner
alone (vitest and JUnit output are deliberately later). The ci practice's
`check.yml` keeps each run's `.keel/test-runs` as a `keel-test-runs`
artifact, red or green. The night reads the newest 30 of them on the default
branch (gh, read-only, by name) into `.keel/test-runs` before improve, its
gate run adds one more, and it keeps the result as its own artifact.
`flaky_tests` and `slow_tests` (bound 0, no ratchet) read that history; with
fewer runs than the window they are n/a, never zero.

**The build, timed** (phase 36). When `.keel/keel.json` names
`"climb": { "build": "<command>" }`, the night runs it once as `build_time`:
its wall time in ms, bound `"climb".buildBudgetMs` (no ratchet), else
recorded only (no bound, never outside, so the pages keep a trend). No
`build` is n/a; a failing build is broken, never a time. With the climb
practice on, the page also says when a climb job's last three
`keel-climb/<job>/` PRs were closed unmerged: that job proposes its own
retirement (gh's closed list, read-only).

**The Tend line** (phase 38). With `"tend"` in `.keel/keel.json` (the climb
practice's weekly tend pass), the night reads the newest `keel-tend`
artifact on the default branch (gh, read-only, by name) into `.keel/tend`
before improve, and the page carries one line: `Tend: <date>: resolved N of
M, K proposed for the owner, PR #n; unresolved: <each finding> (tried: …)`.
A pass that did not finish says so; tend off, or never run, is no line.
Like the climb's line, it is not a measure: no bound, nothing to ratchet.

**Every PR keel opens can be judged in a minute** (phase 39).
`scripts/keel/pr-body.mjs` builds the body from structured input,
deterministically, in three sections in this order: **Summary**, a picture
(a file tree of the changed paths, or a table; never prose); **Evidence**,
the gate's line and rows of before and after ("Evidence: none recorded."
when there are none; the section is never dropped); **Merge danger**, a
two-way door (a revert restores everything) or a one-way door (something
leaves the repo), with the blast radius in Real surfaces terms (phase 32;
none is "this repo's … only"). Notes follow, and the keel-impact block
stays last. The night writes its input with `improve.mjs --pr-input` and
the commit's files: two-way, data files only. `keel update` and `keel
fleet update` use it too: the changed files, the gate and the practice
before → after, two-way when it only re-renders keel's files, one-way when
a migration rewrote the project's own files. Bad input (an unknown door
or surface, a summary that is not a picture) is exit 2.

Practice updates go out from keel: `keel fleet update` opens the
`keel/update-v<version>` PR in each project that is behind, with the owner's
own `gh` login. A person merges it. (`keel-update.yml`, which pulled keel
into each project weekly, was retired in 0.3.0 by migration 0002.)

Every workflow touches only its own branch prefix, never `main` and never a
person's PR; `tests/workflows.test.mjs` on keel holds the templates to that,
and to never naming keel's repo, a keel token, or a clone.
The night spends no model tokens: it measures, deterministically.

**Its config, read at run time** (so a change never needs a re-render), all
in `.keel/keel.json`: `setup`, the install command (default `npm ci` when
there is a lockfile); `env`, variables for every gate run; `setupToken`, a
repo secret's name passed as `GH_TOKEN` to the install step only, so setup
can clone a private repo the gate needs; `health`, above.

**What it needs (⚑).** No secret. The repo setting *Allow GitHub Actions to
create and approve pull requests*, or `gh pr create` is refused (the run
pushes the branch and ends green with a notice). Squash merges allowed, for
the drain.

**Its files.** `.github/workflows/keel-night.yml`, `scripts/keel/improve.mjs`,
`scripts/keel/drain.mjs`, `scripts/keel/lib.mjs`, `scripts/keel/test-ledger.mjs`,
`scripts/keel/pr-body.mjs` (managed), and the `night` block of `AGENTS.md` (so it needs agents-md). They need the
phases practice's `scripts/roadmap.mjs` for the phase measures; with phases
off or local those measures are n/a.

**Lineage.** Keel phase 10. The rules are isocan's "The night shift's pull
requests" (AGENTS.md; the drain after its grades and loop workflows, and
`scripts/changelog-drain.mjs`); the skip-with-a-notice from isocan's
`loop.yml`; porcelain over `git diff --quiet` from ledger's
`agent-audit.yml`.

**Ancestors (phase 16, 3 Oct 2026).** What keel decided for the projects this
practice came from, where each keeps a version of its own:

- **isocan**: *stays local*. Its `scripts/night.mjs` (a converge lane and a
  morning comment) is a different night from keel's measures; adopt keeps
  `night` local where a project has `scripts/night.*` or an `npm run night`.
  Its ideas already came home: conduct cost (`subagent-time.mjs`) and the
  ratchet (`ratchet.mjs`).
- **ledger**: *on*. Its agent workflows are its product's jobs, not a night
  shift over its practice.
