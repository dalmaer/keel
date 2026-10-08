---
status: planned
since: 2026-10-07
goal: G2
spec: 2
depends: [41, 45]
note: "v0.8.12 to v0.8.19 each drew new Codex findings on the fleet update PRs, in code written that day; each round cost a release and a fleet round. Shipped practice changes land through a keel PR reviewed by another provider before keel release runs. Design: research/2026-10-07-review-hardening.md §3."
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

- [ ] `keel release` refuses (exit 1, naming each commit) when a practice-scope commit since the last tag did not arrive through a merged PR, or arrived through one whose `keel review --gate` fails; passes when each did; `--unreviewed "<why>"` passes and writes the reason. `tests/release.test.mjs`
- [ ] The conduct skill names the rule: practice changes land as a reviewed PR before release. `tests/skill.test.mjs`
- [ ] ⚑ by hand: the owner sets `OPENAI_API_KEY` on keel and turns on keel's own cross-review; three releases go through the gate; the owner compares the fleet rounds' findings with v0.8.12–v0.8.19's.

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

Brief a builder on the release gate; keel's own cross-review (Codex reviewing the conductor's claude/ PRs) is switched on with it. OPENAI_API_KEY is set on keel (2026-10-08).
