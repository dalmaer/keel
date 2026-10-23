# Does keel help? The measures, fixed before looking

**Written 2 October 2026, before any project has been adopted.** No
after-adoption data exists yet, so none has been read. This page fixes the
questions, the measures and the comparison in advance. The later results
page (phase 13) then has to answer *these* questions with *these* numbers,
and report a null or negative result as plainly as a positive one.

## What can and can't be compared

| Project | First commit | History before keel | Use |
| --- | --- | --- | --- |
| ledger | 2026-09-15 | 17 days, 910 commits | The only real before/after |
| duo | 2026-09-30 | 2 days, 7 commits | Too short for a "before". Use as an *after-only* case |
| cajones (ritmo) | 2026-09-29 | 3 days, 8 commits | Same as duo |
| isocan | 2026-08-15 | 7 weeks, 1,550 commits | **Reference, never adopted.** It moves with the same models and tools, so a change seen in both is not keel's |
| keel | 2026-10-02 | none | Its own conduct costs only, not a before/after |

With n this small, nothing here is a statistical test. The results page
**describes** each measure with its n and does not declare an effect.

## The measures

Each measure is computed by a command the results page must name, from
git history or the GitHub API, and nothing else.

1. **Red streak.**
   - *What:* the longest run of consecutive failed default-branch runs of the
     project's gate workflow.
   - *Also:* the median hours from a first red to the next green.
   - *Source:* `gh run list --branch <default> --workflow <gate>`, reading
     only `conclusion` and `createdAt`.
   - *Expectation:* lower after adoption, if the night shift's "guard fires
     into a room" rule works.
2. **Lesson to guard.**
   - *What:* the share of `docs/lessons.md` rows added in the window whose
     Guard cell names a file that exists at the window's end.
   - *Source:* `git log -p docs/lessons.md` plus `git ls-tree`.
   - *Expectation:* higher after.
3. **Phases moved per week.**
   - *What:* the number of front-matter `status:` changes in `docs/phases/`
     per week, and separately the number of moves to `built` that carry an
     `evidence` path.
   - *Source:* `git log -p -- docs/phases`.
   - *Expectation:* the evidence-backed share rises. The raw count is
     reported but not interpreted, since more moves can mean churn.
4. **Practice drift across the fleet.**
   - *What:* doctor's `edited` + `both` counts, plus local variants, summed
     across managed projects, read on the same day each week.
   - *Expectation:* falls over time as local variants converge through
     migrations.
5. **Conduct cost per phase** (conducted sessions only).
   - *What:* builder whole-check runs, and builder wall minutes per committed
     phase.
   - *Source:* `keel improve --transcripts`.
   - *Baseline:* keel's own first session (2 Oct 2026): 0 whole-check runs by
     builders across the transcripts measured (phase 11 evidence).
   - *Expectation:* it stays at 0. Minutes are described, not judged.
6. **Lessons that came home.**
   - *What:* the count of `lesson` issues filed on keel, and of those, how
     many a person decided, and how many of the accepted ones shipped in a
     release.
   - *Expectation:* above zero. Zero after a month means the loop isn't
     being used, and the page says so.

## The comparison

- **ledger.** The 17 days before its adoption commit, against the first
  17 days after. isocan is read over the same two calendar windows. A change
  in ledger only counts as keel's if isocan didn't move the same way.
- **duo, cajones.** After-only: the measures over their first 4 weeks under
  keel, described.
- **Earliest results date: 4 weeks after the second adoption, and not before
  2026-11-01.** If fewer than two projects are adopted by 2026-11-15, the
  results page says so, and that *is* the finding.

## What would change the plan

- If a measure turns out impossible to compute as written, the results page
  says which and why. It must not substitute a different measure without
  marking it as substituted.
- Nothing on this page may be edited after the first after-adoption data
  is read. Corrections go in the results page.
