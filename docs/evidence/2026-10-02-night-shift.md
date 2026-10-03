# Evidence: phase 10 — the night shift

- Date: 2026-10-02 (the first run's UTC date is 2026-10-03)
- Phase: 10
- Revision: `b9783d6`, plus the record commit.
- Claim being checked: the nightly measures, opens at most one PR per queue,
  never writes to main, and makes a run red only when an instrument is broken
  or the gate fails.

## Automated checks (conductor, integrated tree)

| Command | Exit | The line that says so |
| --- | --- | --- |
| `npm run check` | 0 | `ℹ tests 151` · `ℹ pass 151` · `ℹ fail 0` |
| `check` on GitHub for `b9783d6` | 0 | `gh run watch --exit-status` |

`tests/workflows.test.mjs` checks every shipped workflow template and keel's
rendered copies for a concurrency group, pushes only to their own prefix,
`git status --porcelain`, declared secrets, valid crons, a gate-conditional
`--gate-passed`, and the PR-permission notice path. It is mutation-checked
with 12 breakages, including `git push origin main`, `git diff --quiet` and
an unconditional `--gate-passed`.

`tests/night.test.mjs` runs drain against a gh stub that models real gh:

- the newest PR kept;
- older data-only, mergeable PRs merged;
- others closed as superseded, with a recovery note;
- forks never touched;
- UNKNOWN mergeability asked again once.

## By hand: one real dispatch on GitHub

Run: https://github.com/dalmaer/keel/actions/runs/37097720214 (exit 0)

| Step | Observed |
| --- | --- |
| Get the keel CLI | keel is `"self"`, so it used `bin/keel.mjs`; no KEEL_TOKEN was needed |
| Measure | `gate 0 ok — npm run check exit 0; 151 tests`; `phases_without_issue 9 outside`; `machine_prs 0 ok` (gh reads worked under GITHUB_TOKEN) |
| Open the PR | `* [new branch] HEAD -> keel-night/2026-10-03`, then `##[notice] … no PR was opened: allow it in Settings → Actions → General → Workflow permissions` |
| Drain | `keel drain keel-night/: 0 open PRs.` |
| Verdict | green: one measure outside is a notice; the gate passed and nothing was broken |

Before this was fixed, the same run would have gone red on keel every
night. The repo setting is off (`can_approve_pull_request_reviews: false`),
so a ⚑ the owner hadn't been asked about would have emailed them nightly.
The builder fixed it to a notice before the push.

## Gaps and decision

- Not yet observed:
  - seven nights, each with at most one open `keel-night/` PR;
  - a deliberately red night reaching the owner by email;
  - one adopted project's night.
- ⚑ The owner must:
  - turn on "Allow GitHub Actions to create and approve pull requests" on
    keel (and on each project);
  - set `KEEL_TOKEN` on each adopted project;
  - set `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` for `@claude`;
  - install the Renovate app.
- Supports **partial**.
