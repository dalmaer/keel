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
- **2026-10-10** — Codex on keel#65: `keel review <repo>@<sha>` read only the newest 200 tracking issues, so an older push's findings went out of reach in weeks. It now reads every page (100 a page, up to 50) until one records the sha; a list that fills every page without it is an incomplete read (exit 2), never "no review".
- **2026-10-09** — Commit comments sit on the head commit's own diff (GitHub's `position`), so a finding on a line an earlier commit of the push changed is in the issue alone. The issue is the record, as Deliberately open says. Whether a commit comment needs more than `contents: read` is unverified; a refused one is a warning and its finding stays in the issue.
- **2026-10-09** — "A tracked finding is a keel:agent issue": phase 54 builds the robot in parallel, so `keel review <repo>@<sha> --close … --tracked` drafts the issue (`--json` `work`) and files nothing. The `--tracked` answer still names the issue it is tracked in.
- **2026-10-09** — Authorship: an adapter now names the commit identities its provider writes (`AGENTS.<n>.commits`: Claude Code's `Co-Authored-By: Claude … <noreply@anthropic.com>`, `claude[bot]`, Codex's). A push both providers wrote is reviewed by its first listed, said as a self-review; a person named Claude at their own address is a person.
