---
status: partial
owes: walk
since: 2026-10-07
goal: G2
spec: 2
depends: [41, 45]
note: "Built: keel release's review gate (each practice-scope commit since the last tag through a merged PR whose keel review --gate passes, reviewed by someone other than its author; --unreviewed \"<why>\" the owner's only way past, written into the commit and WHATSNEW), keel's own cross-review on (claude/ and codex/), and the conduct skill's rule. Owes the walk: three releases through the gate, and the owner's comparison of fleet rounds' findings with v0.8.12 to v0.8.19's."
evidence: []
issue: 34
---

# A release is reviewed before the fleet sees it

## Done when

`keel release` refuses while a shipped practice change since the last release has not come through a keel PR reviewed by a provider other than its author with every comment answered, and three releases have gone through that gate; the owner has compared the fleet rounds' findings after it with the eight rounds before.

## Scope

The design is [Review hardening](../research/2026-10-07-review-hardening.md), §3.

- **keel reviews itself**: keel's own `.keel/keel.json` turns on cross-review (`"agents": {"claude": {}, "codex": {}}`, `"for": ["claude/", "codex/"]`) with `OPENAI_API_KEY` on keel (⚑ the owner's secret and spend), so the conductor's `claude/` PRs are reviewed by Codex.
- **The gate**: `keel release` reads the commits since the last release tag that touch `practices/`, `migrations/` or `docs/lessons.md` (its SCOPE), and requires each to have arrived through a merged PR whose `keel review --gate` passes (every comment answered, the reviewer reviewed the head). A commit on main outside a PR fails it, naming the commit. `--yes` does not skip it; an owner's `--unreviewed "<why>"` does, recording the reason in the release commit and WHATSNEW.
- **The conductor**: the skill says a practice change lands as a `claude/` PR, waits for the other provider's review, answers it, then merges; records and CLI-only changes may still go to main.
- **Measured**: findings per fleet update round, from the update PRs' reviews (`keel review`), before and after, in the evidence.

## Acceptance

- [x] `keel release` refuses (exit 1, naming each commit) when a practice-scope commit since the last tag did not arrive through a merged PR, or arrived through one whose `keel review --gate` fails; passes when each did; `--unreviewed "<why>"` passes and writes the reason. `tests/release.test.mjs`
- [x] The conduct skill names the rule: practice changes land as a reviewed PR before release. `tests/skill.test.mjs`
- [ ] ⚑ by hand: the owner sets `OPENAI_API_KEY` on keel and turns on keel's own cross-review; three releases go through the gate; the owner compares the fleet rounds' findings with v0.8.12–v0.8.19's.

## Your part

- **Ask:** Let the next three keel releases go through the review check, then compare how many review comments the projects' update pull requests drew after it with the eight releases before (v0.8.12 to v0.8.19).
- **Why:** The check costs a review before each release. It earns its keep only if the projects' update rounds draw fewer findings.
- **Look at:** The reviews on each project's update pull request for the three releases (`keel review <repo>#<n>`), beside those for v0.8.12 to v0.8.19.
- **Choices:** Fewer findings | No change | Not three releases yet
- **Keeps it open:** Not three releases yet
- **Ready when:** three keel releases have gone through the review check and the projects' update pull requests for them have been reviewed
- **Takes:** 30 minutes, after the third release; each reviewed keel PR bills the OpenAI API account per token, up to its minutes budget
- **Then:** Fewer findings: recorded in an evidence file, and this is done. No change: recorded, and the check goes (Deliberately open). Not three releases yet: nothing changes.

## Real surfaces

- GitHub API: keel's PRs, their reviews and merge state, read by the release gate.
- Fleet over time: three releases' fleet update rounds.

## Proof

- Automated: `node --test tests/release.test.mjs tests/skill.test.mjs`; `npm run check`.
- Over time: the findings per fleet round, before and after, in the evidence.

## Deliberately open

- **The conductor's pace**: a review before every release adds the reviewer's minutes to each release. Its effect: fewer, larger releases. Settled by the comparison: if fleet rounds' findings do not fall, the gate goes.
- **Which commits count**: SCOPE only (practice files, migrations, the lessons catalogue); keel's CLI and records stay direct to main. Settled after three releases.

## Next action

⚑ The walk: land practice changes as `claude/` PRs reviewed by Codex, and cut three releases through the gate; then the owner compares the fleet rounds' findings with v0.8.12 to v0.8.19's, in an evidence file. The first release after this phase will meet practice commits that reached `main` before the gate (at least one since v0.8.26, and this phase's own change to the conduct skill): it needs the owner's `--unreviewed "<why>"`.

## Trajectory

- **2026-10-09** — `keel review --gate` alone would not hold here: keel's config names no reviewers, so it checks only that comments are answered, and the cross-review posts as `github-actions[bot]`. The gate (prGate, in lib/review.mjs, read in-process) adds that someone other than the PR's author reviewed its head commit.
- **2026-10-09** — `keel release` never had a `--yes`. Rather than accept and ignore one, the CLI refuses it, naming `--unreviewed "<why>"` as the owner's only way past.
- **2026-10-09** — Cost bounds: one `commits/<sha>/pulls` call per commit (eight at a time), each PR read once (its threads and its reviews), at most 40 commits (past it, exit 1 before any call). A failed read is exit 2, never a pass. A dry run reads no GitHub; it lists the commits the gate will check. `--unreviewed` skips the read entirely and is refused on a keel-only release, where there is nothing to skip.
- **2026-10-09** — "Since the last release tag": the newest `v*` tag reachable from HEAD, else the last practice release (the commit that last changed `practices/VERSION`), else all of history.
