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
   whose dated pages the project git-ignores makes the run red, since its page
   would never be committed (ledger lost its pages that way), and so does one
   that resolves outside the repo (a symlink) or starts with `:` (git
   pathspec magic). (On keel itself,
   `keel learn` gathers first). It runs before the drain, so `machine_prs`
   counts last night's PR.
2. If `git status --porcelain` shows a change in the night's data
   (tonight's dated page in the health directory, never the rest of it;
   `docs/inbox/`, `docs/INBOX.md`, `.keel/bounds.json`, a tracked one that
   is gone staged as its deletion; nothing else a gate run leaves behind;
   paths read literally, never as git pathspec magic), it is committed on
   `keel-night/<date>`, pushed to that branch only, and opened as one PR
   whose body is `scripts/keel/pr-body.mjs`'s (below), with the page's
   proposal as its note.
3. `node scripts/keel/drain.mjs keel-night/ --yes` keeps the queue at one:
   each older PR is merged when it holds only data (`docs/health/`, the
   configured health directory's dated pages, `docs/inbox/`, `docs/INBOX.md`, `.keel/bounds.json`) and still merges, and
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
(`PROJECT_LINTS` in `scripts/keel/improve.mjs`: phase, goal-without-phase,
claude-md-pointer, second-copy, symlink-replaced, lessons-table-split,
health-config, health-ignored), and the inbox is keel's.

**Proof lost.** `proofs_hold` (bound 0, no ratchet) counts the built or
lived-in phases whose Acceptance cites a `tests/` path that no longer
exists, or a named test (`tests/<file>: "<name>"`) that did not pass in the
newest recorded run of that file (the test ledger, below), or whose
`evidence` names a file that is gone; the page names each phase and what is
lost. A cited test in no recorded run is said, not counted. The night never
steps a phase back or writes evidence; its proposal is to make the test
pass, re-point the reference, or step the phase back with a reason, which a
person does.

**Reviews unanswered** (phase 41). `reviews_unanswered` (bound 0, no
ratchet) counts the review comments on the project's open PRs, and on PRs
merged in the last 7 days, that nobody answered, once they are a day old: a
thread whose newest comment is its reviewer's (resolving it is not an
answer; a reviewer's follow-up reopens it), and a review's top-level body,
or a conversation comment from a reviewer named in `.keel/keel.json`
`"review"`, that no later comment from someone else quotes (`> `), links or
names by id (an unrelated comment is not an answer). It is the rule
`keel review <repo>#<n>` reads one PR by (the repo read page by page;
`lib.mjs` holds it). The detail names each PR, its count and its oldest
comment; `keel loose-ends` lists the same PRs with `keel review <repo>#<n>`.
n/a without `repo` or gh auth, and n/a when the read is incomplete (more
PRs than four pages, or a list longer than its page); a failed read is
`broken`; never a zero. Not a gate: nothing refuses a merge for it, and the drain
merges as before. The answer is the work: validate each comment against the
code, then reply fixed (the commit), tracked (the issue or version) or not
valid (why), with `keel review <repo>#<n> --close <id> …`.

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
skipped one, a file with no test in it (node reports the file itself), and
a `describe()` with no test inside (a suite, not a test) do not. A project with no tests yet says so: `"tests": {"allowEmpty": true}`
in `.keel/keel.json`. It records each
top-level test (file, name, outcome, ms) with the commit, the tree, whether
the tree was dirty (git-ignored files and keel's machine directories,
`.keel/test-runs`, `.keel/climb` and `.keel/tend`, aside), the machine and
node, the run's config (a short hash of `NODE_OPTIONS`, its `--import` and
`--require` preloads, and each variable named in `"tests": {"configEnv":
[..]}`, recorded beside the hash: `NODE_OPTIONS` as written, and the
preloads; each `configEnv` variable only as its name, whether it was set,
and a short sha256 of its value, never the value, since runs are uploaded as
artifacts — so is a `NODE_OPTIONS` that carries a `token=`, `secret=`,
`key=` or `password=`),
the folder `node --test` ran in, whether it was narrowed (`--test-name-pattern` and the like), and in
Actions its workflow, in `.keel/test-runs/` at the repo's root (git's top
level, so a workspace's or app folder's own `node --test`, run from its
folder, lands in the same ledger; each lane, a suite's folder and config,
reserves its own newest 50 runs, or the window and ten more when that is
larger, so a busy lane never evicts a quiet one's baseline; 400 in all, or
lanes × (window + 10) when that is larger, prunes only what no lane reserves; the directory holds a
`.gitignore` of `*`, so no project's `.gitignore` changes), and ends the run
with a hygiene block: one line when clean, else each test that is

- **flaky** — passed and failed on one clean tree in one lane (its suite's
  folder and config; a fact, no threshold), or
- **slower** — above twice its median over its last 20 passing runs on the
  same machine class and lane, and more than 200 ms above it,

with its history in one line and the command to run it alone as it was
seen: that run's config variables (each set one as
`NAME="${NAME:?set NAME as it was in the run}"`, taken from your shell, so
the command runs as printed once you set it and stops saying so if you
haven't; never a value; each unset one, `NODE_OPTIONS` too, as `env -u NAME`)
and preloads, from its suite's folder
(printed elsewhere, it changes to that folder first: `cd "$(git rev-parse
--show-toplevel)"/'web' && …`). slow_tests is n/a until the newest run has a
window of earlier runs on its machine class in its own lane. `"tests":
{"window", "factor", "floorMs"}` in `.keel/keel.json` overrides 20, 2 and
200 (a window is at most 200) (and `allowEmpty`, above). The AGENTS block says what to do with one: **a hygiene note is work** —
fix it or file it, never rerun until green.

`keel init` wires the reporter into a node project's `npm test`; migration
0004 adds it to an adopted project's `scripts.test` when it is node's runner
(`node --test`, or `node --import … --test`) and leaves every other runner
alone (vitest and JUnit output are deliberately later); migration 0005 does
the same for each workspace's and app folder's own `scripts.test` (web/,
app/, client/, frontend/, and the root's workspaces). The ci practice's
`check.yml` keeps each run's `.keel/test-runs` as a `keel-test-runs`
artifact, red or green. The night reads the newest 30 of them on the default
branch (gh, read-only, by name) into `.keel/test-runs` before improve, its
gate run adds one more, and it keeps the result as its own artifact.
`flaky_tests` and `slow_tests` (bound 0, no ratchet) read that history; with
fewer runs than the window they are n/a, never zero. When every run read came
from a keel night, their detail says "nightly runs only: CI does not upload
keel-test-runs": a project whose CI is its own adds the upload step (migration
0005 prints it in the update PR; keel never edits a project's workflows).
`proofs_hold` reads a cited test's newest pass or fail: a skip, or a narrowed
run that left it out, says nothing about it.

**The build, timed** (phase 36). When `.keel/keel.json` names
`"climb": { "build": "<command>" }`, the night runs it once as `build_time`:
its wall time in ms, bound `"climb".buildBudgetMs` (no ratchet), else
recorded only (no bound, never outside, so the pages keep a trend). No
`build` is n/a; a failing build is broken, never a time. With the climb
practice on, the page also says when a climb job's last three
`keel-climb/<job>/` PRs were closed unmerged: that job proposes its own
retirement (gh's list of every state, read-only: a merged or open PR among
the newest three breaks the streak).

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

## Optional project canvas projection

Canvas publication is off unless `.keel/keel.json` has both
`canvas.enabled: true` and `canvas.cadence: "nightly"`. A manual binding does
not opt into scheduled publication. The step follows the health-page commit and consumes Measure’s
original JSON; it never repeats improve, the gate, a model call or a retro.
`keel canvas night --report <file> --json` saves a local snapshot and render;
`--yes` requests publication through the approved binding. Raw report detail,
commands, proposals and errors are not forwarded. Missing source intervals stay
coverage gaps. Dirty or unknown source revisions refuse publication. Committing the existing
night data first keeps this check intact; unrelated dirty files are never
exempted. Canvas failure is reported in Verdict while the existing PR and
drain steps still finish.

This is an owner-provisioned integration, not a new installer or token scheme.
Before opting in, the existing project `setup` must make pinned `keel` and
`isocan` executables available on PATH. Provision
`KEEL_CANVAS_KEEL_VERSION` and `KEEL_CANVAS_ISOCAN_VERSION` with their exact
`--version` outputs, and `KEEL_CANVAS_ISOCAN_HOME` with the path of a dedicated,
already admitted isocan home. Setup can persist non-secret paths/version pins
through `GITHUB_ENV` and executable directories through `GITHUB_PATH`.
Authentication uses isocan's existing credential storage in that home and the
binding's approved writer identity. Do not put credentials in config, artifacts,
or the public workflow. No admission or identity command is run by this step.
The supported deployment and credential provisioning must be approved and
verified separately; this change does not establish that contract for Keel.

Missing tools, pin mismatches, missing home, expired authentication and failed
publication fail visibly. The workflow does not fetch or install either CLI,
import project scripts as a substitute for an installed CLI, or create a
replacement canvas. Existing `keel-night` concurrency serializes nights; sync
also owns a local writer lock and pending receipt recovery.

The workflow restores `recovery.json` from the latest **canvas-enabled attempt**
of this repository's default-branch `keel-night.yml`, including failed attempts.
It reads the committed config at each candidate's source commit to establish
opt-in, rejects PR/fork/other-branch runs, and verifies repository, commit, run
ID and attempt against artifact provenance. Artifact names include the attempt:
`keel-canvas-night-<attempt>`. A missing, expired, oversized or ambiguous artifact
for the latest expected attempt is a manual-recovery failure, never permission
to fall back to an older journal. Reruns recover the immediately preceding
attempt. Discovery is bounded to the latest 100 workflow runs.

**Bootstrap:** before the first canvas-enabled CI night, owner-approved setup
must provision the original connection's `.keel/canvas/manifest.json` and any
history files it references. The committed binding alone is insufficient. No
night command reconnects or creates a replacement canvas. Existing local state
is never overwritten: a differing artifact journal requires manual resolution.
After bootstrap, artifact restore provides the state for fresh CI checkouts.

The recovery envelope matches project key, home, canvas, writer, audience,
space, privacy and publication mode. It contains only the validated sync
manifest, its hash-verified referenced history files, and bounded observation
history: the newest sample per UTC day for 90 days, at most 90 samples. Missing
intervals remain unknown. The complete sync journal and its referenced files
are preserved, including `pending`, `run`, groups, item identities and receipts;
no journal entries are silently pruned by the night wrapper. Exceeding the
64 MiB recovery-envelope limit fails visibly and needs reviewed retention.

`KEEL_CANVAS_OUTPUT` selects the local artifact directory (otherwise a fresh
temporary directory is used). In CI, `KEEL_CANVAS_PERSISTENCE=artifact-v1` enables
this contract and `KEEL_CANVAS_RECOVERY` names the verified downloaded envelope.
Snapshots, rendered views, receipts and recovery state use
`actions/upload-artifact@v7` with 90-day retention. A normal failed sync exports
its pending journal in `finally`, so the next fresh checkout can reconcile it
without resending a creation. Abrupt process termination or upload failure can
leave no usable artifact; that case stops for manual recovery. The workflow
never substitutes older state.

Credentials, isocan homes, environment variables, locks, raw reports and
unreferenced cache files are excluded from recovery. Canvas state is never
added to the health PR. This artifact contract is implemented and exercised
with synthetic local runners; it has not been deployed or proven against live
GitHub/isocan credentials. Keel's own cadence remains manual until its owner
provisions and approves scheduled use.
