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

1. `node scripts/keel/improve.mjs --report` measures the practice and writes
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
   whose body carries the page's proposal.
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
exists, or whose `evidence` names a file that is gone; the page names each
phase and what is missing. Its ledger half (a cited test passed in the last
recorded run) is n/a until phase 33's test ledger, and says so. The night
never steps a phase back or writes evidence; its proposal is to re-point the
reference or step the phase back with a reason, which a person does.

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
`scripts/keel/drain.mjs`, `scripts/keel/lib.mjs` (managed). They need the
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
