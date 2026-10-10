---
status: partial
owes: walk
since: 2026-10-09
goal: G2
spec: 2
depends: [45, 46]
note: "Built: \"crossReview\": { \"after\": \"push\" } renders a push-to-main trigger and a daily run into keel-cross-review.yml (none without it); each run reviews main's commits since the last review as one diff, by a provider other than the one its commits' authors and Co-authored-by trailers name; findings are commit comments on the head and one keel:review-after issue per push, read and answered with keel review <repo>@<sha>; at most budget.pushes a day, the rest reviewed together by the next run. Owes the walk: a month of one project's pushes. Design: research/2026-10-09-adopting-projects-that-ship-to-main.md."
evidence: []
issue: 47
---

# Review after the push, for projects that ship to main

## Done when

On a project with `"crossReview": { "after": "push" }`, every push to main is reviewed by a provider other than its author, as one batch; each finding is posted where the owner reads it, answered fixed, tracked or not valid like any other, and a tracked one is a `keel:agent` issue; nothing about the push waits on it; and a month of one real project's pushes has been reviewed.

## Scope

The design is [Adopting projects that already have a practice](../research/2026-10-09-adopting-projects-that-ship-to-main.md), change 3.

- **The trigger**: `keel-cross-review.yml` gains `push: [main]`, on only when `.keel/keel.json` says `"crossReview": { "after": "push" }`. A push of many commits is one review of their combined diff. The workflow's concurrency group coalesces pushes that arrive while one is being reviewed.
- **The author**: from the commits' trailers and authors (phase 45's `authorOf`), so Claude's pushes are reviewed by Codex and the reverse; a push from a person is reviewed by the first listed provider.
- **Where findings go**: a commit comment on the push's head, with each finding inline where the diff allows, and a single tracking issue per push (`keel review after <sha>`) listing them. `keel review <repo>@<sha>` reads and closes them as it does a PR's.
- **Tracked becomes work**: a finding answered tracked files a `keel:agent` issue (phase 54) in the rubric's shape.
- **The sandbox**: the same two jobs as cross-review (a read-only review job; a publish job that runs nothing from the pushed code).
- **Spend**: per push, within the owner's budget; a day's pushes past the budget are reviewed together the next day.

## Acceptance

- [x] A push to main on a project with `after: push` runs one review of the push's combined diff; a project without it runs none. `tests/workflows.test.mjs`, `tests/cross-review.test.mjs`
- [x] The reviewer is a provider other than the commits' author, by phase 45's rules. `tests/agents.test.mjs`
- [x] Findings are posted on the head commit and listed in one issue per push; `keel review <repo>@<sha>` reads them with receipts and closes them by ID. `tests/review.test.mjs`
- [x] The review job is read-only and the publish job runs nothing from the pushed code. `tests/workflows.test.mjs`
- [x] Past the budget, pushes wait and are reviewed together. `tests/cross-review.test.mjs`
- [ ] ⚑ by hand: a month of one project's pushes reviewed; the owner compares real findings with noise.

## Your part

- **Ask:** Turn on review after the push for one project that ships to main, and after a month say whether the findings were worth reading.
- **Why:** It decides whether a second provider adds value without slowing a project that never waits for review.
- **Look at:** The month's review issues and how each finding was answered.
- **Choices:** Keep it | Keep it, fewer pushes reviewed | Turn it off
- **Takes:** 15 minutes at the end of the month.
- **Then:** Keep it: the phase is built. Fewer pushes: a minimum diff size or a daily batch is set. Turn it off: the reasons go into the evidence.
- **Ready when:** this is built and a project that ships to main has a second provider's secret set.

## Real surfaces

- Workflow shell: `keel-cross-review.yml` on a push to main.
- GitHub API: commit comments, the per-push issue.
- Adopted project: one that ships to main.

## Proof

Automated: `node --test tests/cross-review.test.mjs tests/workflows.test.mjs tests/agents.test.mjs tests/review.test.mjs`; `npm run check`.
Over time: a month of pushes.
⚑ Model spend per push, within the owner's budget.

## Deliberately open

- **Commit comments versus an issue**: commit comments are easy to miss. The per-push issue is the record; whether the comments stay is settled by the month.

## Next action

⚑ The owner turns on `"crossReview": { "after": "push" }` for one project that ships to main, with a second provider's secret set, and reads its review issues after a month.

## Trajectory

- **2026-10-09** — A workflow's triggers cannot read `.keel/keel.json`, so "on only when configured" is a render shape (`lib/practices.mjs` `shapeCrossReview`, as renovate.json is shaped): with `"after": "push"` the managed workflow gains `push: branches: [main]` and a daily schedule; without it the bytes are the template's, and no push ever starts a run. The which step reads the config again and refuses a push without `"after"`.
- **2026-10-09** — Coalescing needs a record of where the last review ended: GitHub keeps one pending run per concurrency group, so a run's own `before..after` would skip the pushes whose runs were replaced. The tracking issue's first line is that record (a hidden JSON comment). A run reviews main's commits since it, else the push's range, else the head alone. Every reviewed push gets its issue, closed as it opens when there are no findings, so the record and the day's count are complete.
- **2026-10-09** — The daily schedule is new: "reviewed together the next day" needs a run when no push comes. It reviews only once a push has been reviewed (a record exists), and costs no model spend when nothing is new.
- **2026-10-09** — After a push the default branch is the pushed code, so the publish job checks out the range's base (the review job's `trusted`), never the default branch's tip. The review job still runs main's own scripts with its read-only token. Codex on keel#65 found the push that installs (or upgrades) the publisher would meet the base's older script, fail after spending the review, and fail again on every retry from the same base. So the script carries `PUSH_PROTOCOL`, and before any agent runs the which step moves the base to the first commit whose script speaks it: the commits that brought it are named as not reviewed, and a push that brings it at its head is a notice with no review and no spend. Skipping and re-reviewing the same range, the simpler answer, would spend the review on every retry and never move past a record left before an upgrade.
- **2026-10-10** — Codex on keel#65 (P1): the review job runs the pushed code, so its `trusted` could name the head, and the publish job would run pushed code with a write token. The publish job now decides for itself: the suggestion must be the push's `before` or the last record's end (read with its own token, the workflow's issues only), never the run's commit, and GitHub's compare must put it below the run's commit (and, for a push, no newer than its before); otherwise it is red and runs nothing. That ends the move-forward above: a base is only ever one of those facts, so the push that installs or upgrades the publisher, a first push and a force push are not reviewed at all (the head-alone review of 2026-10-09 ran its parent, pushed code too). The bound is the workflow file: a push that edits keel-cross-review.yml itself changes what runs, and shows in its diff.
- **2026-10-10** — Codex on keel#65 (P2): a daily run with no record skipped forever, so the retry never came when `"after": "push"` arrived with the install. A run with nothing reviewable now starts the record at the run's commit: a closed tracking issue the publish job opens from the event alone (`github.sha`), running no repository code and spending nothing (a start is not one of the day's reviews). The next run reviews from it.
- **2026-10-10** — Codex on keel#65: `keel review <repo>@<sha>` read only the newest 200 tracking issues, so an older push's findings went out of reach in weeks. It now reads every page (100 a page, up to 50) until one records the sha; a list that fills every page without it is an incomplete read (exit 2), never "no review".
- **2026-10-10** — Codex on keel#65, the last round: a first review that failed before its issue left no record, so the next push began at its own `before` and the failed push's commits were never reviewed. A review now only ever starts from a record: with none that can serve, the run reviews nothing and starts the record first (at the push's `before` when its script can post, so the next run reviews that push; else at the head), before anything is spent. The publish job's trust step accordingly takes the last record's end alone. And the record is written only by the one edit that finishes a review's issue (opened pending), so a failed post records nothing and is reviewed again. The record keeps each finding's whole text, as far as an issue holds it (22,000 characters shared, each written twice), for `keel review` and a tracked finding's draft.
- **2026-10-10** — Codex on keel#65, the last round: authorship is evidence, not a name. A commit is a provider's only by an email its commits carry (the author's, or a `Co-authored-by` trailer's), and trailers are the trailer block git parses (`%(trailers)`), never a line quoted in the body. Claude reads the push's diff from a folder granted alone (`--add-dir`). `keel review <repo>@<sha>` shows every other comment on the issue whole before its receipt counts it read, and a tracked answer says the issue may close. The tests' commits carry a neutral Acme author whatever the developer's own identity. A push from a bot (`chatgpt-codex-connector[bot]`, `github-actions[bot]`) is tracked by the conductor, not built here.
- **2026-10-10** — Codex app on keel#65 (P1): running the last record's script trusted a commit for having been reviewed, and every commit on main was pushed code once. No commit is trusted for what it is now. After a push the publish job checks out nothing; it fetches `cross-review.mjs` and `lib.mjs` alone and runs them only when their sha256 is the one `keel render` wrote into the workflow (`KEEL_PUBLISHER`, filled with `"after": "push"`). A push that changes them is refused; the bound is the workflow file, which GitHub runs from the pushed commit anyway. A base is now only where the diff begins, so the push protocol check is gone and the push that installs the publisher is reviewed like any other (from the record, once one exists). Also: a review whose post failed (its issue left pending, with a hidden marker) counts against the day's budget, and `keel review <repo>@<sha>` says a sha covered only by a start was not reviewed (exit 1). Tracked in #67: _l2Y, _l2d, _l2f.
- **2026-10-10** — Codex app on keel#65 (P1): the publish job chose its path by the review job's `mode`, which on a push the pushed script writes; a pushed script saying `pr` would have had the publish job check out the default branch (the pushed code) and run its script. Which path runs is now the event's: the checkout and the PR summary run on `pull_request` and `issue_comment` alone, the publisher, the push's post and the start on `push` and `schedule` alone, the review job choosing only between review and start within them. Also: an answer naming no finding (`**F9**` where only F1 and F2 exist) answered nothing, so `keel review <repo>@<sha>` shows it as a follow-up and a close refuses it until read.
- **2026-10-09** — Commit comments sit on the head commit's own diff (GitHub's `position`), so a finding on a line an earlier commit of the push changed is in the issue alone. The issue is the record, as Deliberately open says. Whether a commit comment needs more than `contents: read` is unverified; a refused one is a warning and its finding stays in the issue.
- **2026-10-09** — "A tracked finding is a keel:agent issue": phase 54 builds the robot in parallel, so `keel review <repo>@<sha> --close … --tracked` drafts the issue (`--json` `work`) and files nothing. The `--tracked` answer still names the issue it is tracked in.
- **2026-10-09** — Authorship: an adapter now names the commit identities its provider writes (`AGENTS.<n>.commits`: Claude Code's `Co-Authored-By: Claude … <noreply@anthropic.com>`, `claude[bot]`, Codex's). A push both providers wrote is reviewed by its first listed, said as a self-review; a person named Claude at their own address is a person.
