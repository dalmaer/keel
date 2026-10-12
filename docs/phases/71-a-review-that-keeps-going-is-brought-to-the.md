---
status: planned
since: 2026-10-12
goal: G0
spec: 2
depends: [48]
note: "Specified 2026-10-12 from the ten-round review of #59: past three rounds keel review gives the owner the choice, findings sorted by the merge rule."
evidence: []
issue: 114
---

# A review that keeps going is brought to the owner after three rounds

## Done when

keel counts a PR's review rounds, and past the limit (three by default) `keel review` stops the fix-and-push loop and gives the owner the choice (merge with the rest tracked, split, or close), with each open finding sorted by the merge rule.

## Scope

The design is [Claims, and reviews that end](../research/2026-10-12-claims-and-review-rounds.md), phase 71. On 2026-10-10 #59 went about ten review rounds, and #85, #95 and #98 four or more.

- **A round**: one push answered by a reviewer with at least one finding, counted from the reviews `keel review` already reads.
- **The limit**: `"review": {"rounds": 3}` in `.keel/keel.json`; three when unset.
- **Past the limit**: `keel review <pr>` exits 3 and prints the choice. Under "merge with the rest tracked" it lists each open finding as **fix first** (a security hole, overwrites the owner's files, or skips an approval) or **track** (needs an issue with its known limit).
- **The class**: the session answering a finding names its kind: `--close <id> … --class security|overwrite|approval|other`. keel records and shows it, and never infers it from the text.
- **The board**: a PR past its limit is the owner's item, with the round count and open findings.
- **The skill**: the conduct skill stops pushing fixes at the limit and reports. It never merges.

Not in scope: keel merging anything, or judging a finding's class.

## Acceptance

- [ ] `keel review` counts rounds: a push with findings is one, a push the reviewer passed is none, and two reviewers on one push are one round. `tests/review-rounds.test.mjs`
- [ ] At the limit, `keel review <pr>` exits 3 with the three choices; under it, exit codes are as before. `"review": {"rounds": N}` changes the limit, and a bad value is refused naming the key. `tests/review-rounds.test.mjs`
- [ ] `--class` is recorded with the answer and shown in the list; an open finding with no class is listed as unsorted, never as "track". `tests/review-rounds.test.mjs`
- [ ] The board shows a PR past its limit as the owner's, and the conduct skill names the rule. `tests/board.test.mjs`, `tests/skill.test.mjs`
- [ ] ⚑ by hand: the next keel PR to pass three rounds reaches the owner with a sorted list, and the owner says whether the list was enough to decide.

## Your part

- **Ask:** The next time a keel change is still drawing review comments after three rounds, read the list keel gives you and pick one: merge with the rest tracked, split it, or close it.
- **Why:** On 2026-10-10 one change went ten rounds before anyone decided; this puts the decision in front of you at three.
- **Look at:** `keel review <the PR>`, which prints the choice and the sorted findings.
- **Choices:** The list was enough to decide | I had to read the threads myself
- **Takes:** 10 minutes.
- **Then:** Enough: the phase is built. Not enough: what was missing goes into the list.
- **Ready when:** a keel PR has passed three review rounds after this ships.

## Real surfaces

- Owner's machine: `keel review` on keel's own PRs.
- GitHub API: the reviews it already reads.

## Proof

Automated: `node --test tests/review-rounds.test.mjs tests/board.test.mjs tests/skill.test.mjs` (a stubbed gh: pushes, reviews with and without findings, classes); `npm run check`.
By hand: one real PR past the limit, read by the owner.

## Deliberately open

- **Three** is a guess from one day's PRs. Settled by the first few PRs that reach it.
- **Whether the limit also holds the release's review gate**: no, for now. `keel review --gate` still asks only that every comment is answered and the head is reviewed. Revisited after the owner's walk.
- **Known limit**: the class is the answering session's word. A finding wrongly marked "other" is tracked instead of fixed; the owner reads the list before merging. A reviewer that reviews every push makes three rounds pass in an hour; the limit counts rounds, not time.

## Next action

Count rounds in `keel review` from the reviews it already reads, with `tests/review-rounds.test.mjs` on a stubbed gh.
