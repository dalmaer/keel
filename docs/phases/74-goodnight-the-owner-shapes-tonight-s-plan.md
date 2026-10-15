---
status: partial
owes: walk
waits: owner
since: 2026-10-14
goal: G4
spec: 2
depends: [73]
note: "Built 2026-10-14: keel goodnight (the opening, the draft and its shaping verbs, --yes writing the plan and pushing it to keel-night-plan as one parentless commit) and the conduct skill's /goodnight. Owes the owner one real evening and morning."
evidence: ["evidence/2026-10-14-goodnight.md"]
issue: 132
---

# Goodnight: the owner shapes tonight's plan

## Done when

The owner can say what tonight is for: `keel goodnight` (and the conduct practice's `/goodnight` skill, which runs it in conversation) shows what was settled today, what was left open, the default plan and a few things to try, takes the owner's changes, and on `--yes` writes the plan the night then runs.

## Scope

The design is [Nightwatch: a night with a plan you can shape](../research/2026-10-14-nightwatch.md), "`/goodnight` shapes it". isocan's rules carry over.

- **The opening**: settled today (PRs merged, phases moved, findings decided since the last plan), left open (open PRs, unanswered reviews, the board's "yours" items), the default plan from phase 73, and two or three suggestions from personas' missed goals, accepted Loop findings and the health page's proposal.
- **Shaping**: `keel goodnight add|drop|edit <id>|budget <id> <minutes>|skip <path-or-id>` change a draft plan (`.keel/night/draft.json`); `keel goodnight` with no verb shows the draft.
- **Saying it**: `keel goodnight --yes` validates, writes the plan with `shapedBy: owner`, and pushes it to the plan branch. That push is the only summons. With no `--yes`, nothing changes and the default plan runs.
- **The rules**: at most five build items; each names its number; `willNotTouch` holds paths and ids; anything merged or decided today is never an item; an item edited by the owner keeps their words.
- **The skill**: `/goodnight` in the conduct practice runs `keel goodnight`, talks it through, and runs `--yes` only when the owner says that's the plan. It never offers a plan unasked.

Not in scope: building (76), the canvas card and the morning (77).

## Acceptance

- [x] `keel goodnight` shows settled today, left open, the default plan and up to three suggestions, from a stubbed gh and a fixture project. `tests/goodnight.test.mjs`
- [x] add, drop, edit, budget and skip change the draft, and a sixth build item, a build item with no number, or an item naming something settled today is refused, naming why. `tests/goodnight.test.mjs`
- [x] `--yes` writes the plan with `shapedBy: owner` and pushes it to the plan branch of a bare-origin fixture; without `--yes` nothing is written or pushed. `tests/goodnight.test.mjs`
- [x] The conduct skill's `/goodnight` section says it runs only when asked and writes only on the owner's "that's the plan". `tests/skill.test.mjs`
- [ ] ⚑ by hand: the owner runs /goodnight on keel one evening and reads the plan the next morning.

## Your part

- **Ask:** One evening, type `/goodnight` in a Claude Code session on keel, say what you want the night to work on, and say "that's the plan".
- **Why:** It is the first time you steer a night instead of keel choosing; this shows whether the conversation gives you what you need to choose.
- **Look at:** the plan it shows before you agree.
- **Choices:** It gave me what I needed | I had to look things up myself
- **Takes:** 10 minutes in the evening, 5 the next morning.
- **Then:** Looked things up: what was missing goes into the opening.
- **Ready when:** this phase and phase 73 have shipped.

## Real surfaces

- Owner's machine: `keel goodnight` and the `/goodnight` skill.
- GitHub API: the push to the plan branch.

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/goodnight.test.mjs tests/skill.test.mjs`; `npm run check`.
By hand: one real evening and morning.

## Deliberately open

- **Five** is isocan's cap; settled by the first nights.
- **Known limit**: suggestions come from what keel can read (personas, Loop, health); a model's own ideas are not offered.

- **"Today", settled 2026-10-14 by the build**: since the plan branch's commit as this checkout last fetched it, or the last 24 hours, whichever is later. The opening never fetches (it writes nothing, not even a remote-tracking ref). A phase is "moved" when its committed status changed since then; a phase written today at planned or designed has not moved.
- **What names something settled, settled 2026-10-14 by the build**: a merged `#n` or a moved `phase n` in an item's title, a decided Loop finding in its source, lane or `loop-<slug>` id, a merged robot PR's `robot:#n`. The default plan's items that name one are left out of the draft, with a leftOpen line saying why; `--yes` checks every item again.
- **The push, settled 2026-10-14 by the build**: one parentless commit holding only `.keel/night/plan.json`, built with `git hash-object`, `mktree` and `commit-tree` (never the working tree, index or HEAD), force-pushed to the constant `refs/heads/keel-night-plan` on origin (else the first remote), then read back with `ls-remote`. Written then pushed: a failed push is exit 1 with the plan written locally and the night on the default plan.
- **Suggestions, settled 2026-10-14 by the build**: personas' missed goals are read from their newest review pages (the opening runs nothing), and are in the default plan already unless admission had no room; an accepted Loop finding "names a number" when its note, title or body names a bounded health measure in backticks, and is suggested as a build in lane `loop`; the health proposal is suggested as a build only for a climb job that measures it and is not already a build tonight.
- **A build with no `--lane`, settled 2026-10-14 by the build**: it takes the climb job that measures its number, or is refused: a build names the pass that builds it (phase 76 hands builds by lane).
- **The opening's "left open"** reads `keel board` in full (its reviews and "yours" items); with gh down or under the quota floor the reviews are a `not read:` line. Revisit if the board is too slow for an evening.

## Next action

Merge phase 73 and this phase; then, one evening, the owner types `/goodnight` on keel, shapes the night, says "that's the plan", reads the plan the next morning, and answers with `keel walk done 74 --choice "<choice>"` (Your part).
