# night

**The failure it prevents.** A machine queue that produces daily and drains
never: five open machine PRs at once on isocan (9 Sep 2026), each waiting on a
person remembering. A bot that writes to `main`. A merge that trusts a check
that never ran, because a `GITHUB_TOKEN` PR runs no CI. A nightly that fails
onto a page nobody opens (keel lesson 3). A commit step that tests
`git diff --quiet` and so never sees a file created for the first time
(ledger's audit agent lost every report to it).

**The rule.** `keel-night.yml` runs every night at 07:23 UTC (and by hand):

1. `keel improve --report` measures the practice and writes
   `docs/health/<date>.md` and `.keel/bounds.json` (on keel itself,
   `keel learn` gathers first). It runs before the drain, so `machine_prs`
   counts last night's PR.
2. If `git status --porcelain` shows anything, it is committed on
   `keel-night/<date>`, pushed to that branch only, and opened as one PR
   whose body carries the page's proposal.
3. `keel drain keel-night/ --yes` keeps the queue at one: each older PR is
   merged when it holds only data (`docs/health/`, `docs/inbox/`,
   `docs/INBOX.md`, `.keel/bounds.json`) and still merges, and closed as
   superseded otherwise, with a comment saying how to recover it (the branch
   is kept). The newest merges only with `--gate-passed`, which the workflow
   passes only when the gate `keel improve` ran on this tree passed.
4. A broken instrument (improve exit 2) or a failing gate fails the run, and
   GitHub emails. A measure outside its bound (exit 1) is news on the page,
   not red.

`keel-update.yml` runs on Mondays: `keel update --yes` opens the
`keel/update-v<version>` PR (migrations, re-render, the gate), and older
update PRs are closed as superseded. A person merges it. An update that is
refused or fails its gate fails the run.

Every workflow touches only its own branch prefix, never `main` and never a
person's PR; `tests/workflows.test.mjs` on keel holds the templates to that.
The night spends no model tokens: it measures, deterministically.

**What it needs (⚑).** The secret `KEEL_TOKEN`, a token with read access to
`dalmaer/keel` (private), for both workflows; until it is set each run ends
green with a notice. Keel itself runs its own checkout and needs none. The
repo setting *Allow GitHub Actions to create and approve pull requests*, or
`gh pr create` is refused. Squash merges allowed, for the drain.

**Its files.** `.github/workflows/keel-night.yml`, `.github/workflows/keel-update.yml` (managed).

**Lineage.** Keel phase 10. The rules are isocan's "The night shift's pull
requests" (AGENTS.md; the drain after its grades and loop workflows, and
`scripts/changelog-drain.mjs`); the skip-with-a-notice from isocan's
`loop.yml`; porcelain over `git diff --quiet` from ledger's
`agent-audit.yml`.
