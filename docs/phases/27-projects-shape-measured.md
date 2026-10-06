---
status: built
since: 2026-10-05
goal: G4
depends: [11, 15]
note: "improve reads the projects shape (isocan: 23 phases without an issue, 22 stuck) and gains eight record measures from isocan's practice page, each n/a with a reason where its source is absent."
evidence: ["evidence/2026-10-05-projects-shape-measured.md"]
---

# A project that keeps phases per project is measured, not skipped

## Done when

`keel improve` on a projects-shaped repo (isocan) reports `phases_stuck`,
`phases_without_issue` and the new record measures with values, not `n/a`,
and every new measure is `n/a` with a reason, never a zero, where the project
has nothing for it to read.

## Scope

isocan's `scripts/practice.mjs` (2 Oct 2026) measured, nightly, what keel's
improve skips for the projects shape. Bring what holds for any project into
`practices/night/files/scripts/keel/improve.mjs` (and `lib.mjs`), the module
`keel improve` and `keel-night.yml` both run:

- **Projects shape read** for the existing phase measures: a phase is a
  `## Phase` section of `docs/projects/<p>/phases.md` with a `**Status:**`
  line (NOT STARTED / PART-DONE / CLOSED / RETIRED); the project's status is
  its primary doc's front matter `status`, its issue `issue:`. `phases_stuck`
  reads "untouched" from the file's last commit when there is no `since`.
- New measures, each `n/a` when its source is absent:
  - `records_disagree`: front matter says `built` while a phase is open, or
    `partial` while every phase is closed (projects shape);
  - `status_unknown`: a `**Status:**` word outside the vocabulary, or
    `## Phase` headings with no Status line at all;
  - `changelog_gaps`: days in the last 30 with commits on the default branch
    but no `docs/changelog/<date>.md`, or one still marked draft;
  - `research_unindexed`: notes in `docs/research/` missing from its README;
  - `verify_owed`: walks in `docs/verify/` not yet verified, with the oldest
    age;
  - `issues_unnamed` (with `repo`): open issues no doc names;
  - `issues_done_open` (with `repo`): a built or superseded project whose
    issue is still open;
  - `prs_stale` (with `repo`): open PRs older than 14 days.
- `--selftest`'s unhealthy fixture grows a projects-shaped part, so every new
  measure is proved `outside` there.

Not here: anything only isocan has (its bundle ceiling, its export
ratchets). Those stay isocan's own checks.

## Acceptance

- [x] On a synthetic projects-shaped fixture each new measure reads the right
  count, and `n/a` with its reason when its directory is absent.
- [x] `--selftest` reports every measure `outside` on the unhealthy fixture.
- [x] On isocan, `phases_stuck` and `phases_without_issue` have values.

## Proof

`npm run check`. `node bin/keel.mjs improve --selftest`.
`node bin/keel.mjs improve --json` run in an isocan checkout.

## Deliberately open

Whether `records_disagree` should also compare the projects index row; it
is free prose in isocan, and a heuristic measure is worse than none.

## Next action

None: built. Lived-in when a projects-shaped repo's own night runs these measures (isocan keeps its own night today).
