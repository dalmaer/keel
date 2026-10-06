# The PR a person reads, and the retro after real work

Design, 6 October 2026. Phases 39 and 40 build it.

Two ideas from Matt Pocock's skills v1.3 (aihero.dev, "Skills changelog
v1.3"), brought over in keel's terms rather than installed: `/pr` (a PR body
built for the reviewer) and `/retro` (improving the agent's environment from
what a session went through). The ideas are credited here; no text is
copied.

## The PR a person reads (phase 39)

Keel and its passes open PRs a person must judge: fleet update PRs today,
climb (phases 35–37) and tend (38) PRs soon. Each is a request for a
person's minute. Their bodies today are prose and lists, and the reader has
to work out what changed and how risky it is.

Every PR keel opens gets three sections, in this order:

- **Summary: a picture, not a paragraph.** A file tree of what changed, a
  before-and-after table, or a short diff sketch. Generated from the change,
  never written freehand.
- **Evidence: before and after.** The numbers (a climb's table), the check
  that failed and now passes, the gate's result line. No "should work".
- **Merge danger.** A two-way door (reverting the merge restores
  everything) or a one-way door (something leaves the repo: a release, a
  migration that rewrites a project's files, a secret, a published package),
  and the blast radius, read from the phase's **Real surfaces** (phase 32):
  this project only, every adopted project, the fleet over time.

One shared, deterministic script, `scripts/keel/pr-body.mjs`, builds the
body from structured input; every PR-writing path (fleet update, night,
climb, tend) calls it. The keel-impact block (phase 26), when reconciliation
is on, stays at the end.

## The retro after real work (phase 40)

Keel learns from bugs (lessons) and from the night's numbers. It does not
learn from how a working session went: the friction an agent hit getting the
work done. This session alone had a shell whose working directory reset
between commands, glob errors from zsh, a probe that read `tail`'s exit code
instead of the check's, a citation check that refused a dotfile path, and a
script that failed on a flagged inbox issue. Several became fixes only
because someone noticed.

**When**: at the end of a phase that did real work, meaning its commit
changed code, tests or shipped practice files, not only docs. It is the last
step of `/conduct`, after the commit, and a person can run `keel retro` on
demand. It never runs from the night: an automated retro finds false
positives and keeps "fixing" them.

**What it reads**: a deterministic worksheet, `keel retro --worksheet`,
built from the session's own transcript as `keel loose-ends` reads it:
commands that failed and were retried, tool errors, permission denials,
files read many times, long tool calls, edits reverted. Transcript text is
never written to any file; the worksheet holds counts and pointers.

**What it asks** (seven areas): how easy the code was to find; what an
automated check could have caught; a standard that was missing; the health
of `AGENTS.md`; tool economy; instructions that did nothing; information the
agent needed and didn't have.

**What it produces**: a short list of candidates in the phase report, most
serious first, each one of:

- **a check** (a lint, a test, a guard in a script): for anything
  mechanical. Mechanical violations get deterministic checks, full stop;
- **an `AGENTS.md` or skill line**: for a judgment call only;
- **a lesson**: when it is a failure shape, through `keel learn` as today.

The owner picks; nothing is applied without the pick. An accepted candidate
is built as its own small change, or as a phase when it is bigger.

## Not taken, and why

- **`/implement-spec`** (parallel tickets in worktrees, one integration
  branch): keel already knows its frontier (`depends:`), but `/conduct`
  verifies and commits phase by phase on purpose. Deliberately open: building
  two independent frontier phases in parallel worktrees, still verified and
  committed one at a time, once climb and tend make independent phases
  common.
- **`GLOSSARY.md`**: keel's vocabulary lives in the agent guide; a second
  copy would drift (lesson 16). A per-project glossary may suit domain-heavy
  projects (isocan, ledger) later, as an optional practice.
- **A merge-conflict skill**: their reason for removing theirs ("a harness
  concern") holds for keel.
