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
   `docs/health/<date>.md` and `.keel/bounds.json` (on keel itself,
   `keel learn` gathers first). It runs before the drain, so `machine_prs`
   counts last night's PR.
2. If `git status --porcelain` shows anything, it is committed on
   `keel-night/<date>`, pushed to that branch only, and opened as one PR
   whose body carries the page's proposal.
3. `node scripts/keel/drain.mjs keel-night/ --yes` keeps the queue at one:
   each older PR is merged when it holds only data (`docs/health/`,
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
symlink-replaced), and the inbox is keel's.

Practice updates go out from keel: `keel fleet update` opens the
`keel/update-v<version>` PR in each project that is behind, with the owner's
own `gh` login. A person merges it. (`keel-update.yml`, which pulled keel
into each project weekly, was retired in 0.3.0 by migration 0002.)

Every workflow touches only its own branch prefix, never `main` and never a
person's PR; `tests/workflows.test.mjs` on keel holds the templates to that,
and to never naming keel's repo, a keel token, or a clone.
The night spends no model tokens: it measures, deterministically.

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
