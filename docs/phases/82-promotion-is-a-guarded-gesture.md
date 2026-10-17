---
status: planned
since: 2026-10-16
goal: G6
spec: 2
depends: [81]
note: "Specified 2026-10-16 from isocan's hand-moved prod tag: keel promote moves production only to a tested commit and verifies it."
evidence: []
issue: 165
---

# Promotion is a guarded gesture

## Done when

`keel promote [<commit>]` moves a project's production ref only to a commit on its tested ref, previews first, verifies production serves it afterwards (phase 81), and `keel promote --back <commit>` rolls back the same way; it is always a person's command and nothing runs it automatically.

## Scope

The design is [Delivery: a change reaches production once, checked](../research/2026-10-16-delivery.md), item 5.

- **The ref**: `delivery.promote` names it (`tag:prod`, `branch:production`); a project without one has no promote.
- **The guard**: the commit must be on the tested ref and its gate must have passed (phase 79's result); anything else is refused, naming why. Default commit: the tested ref's head.
- **Preview, then `--yes`**: show the commit, what changes from what production serves now, and the verify that will follow.
- **After**: run `verify.mjs` against production and report; a failed verify suggests `--back` and never moves anything itself.
- **Who**: the command runs on the owner's machine with their git credentials; no workflow promotes.

## Acceptance

- [ ] `keel promote` refuses a commit not on the tested ref or without a passing gate, and moves the ref for one that is, only with `--yes`. `tests/promote.test.mjs`
- [ ] After moving, it verifies production and reports; a failure suggests `--back` and moves nothing. `tests/promote.test.mjs`
- [ ] `--back <commit>` moves the ref to an earlier tested commit with the same checks. `tests/promote.test.mjs`
- [ ] No installed workflow runs `keel promote`. `tests/workflows.test.mjs`
- [ ] ⚑ by hand: the owner promotes isocan once with `keel promote` instead of moving the tag by hand.

## Your part

- **Ask:** The next time you promote isocan, use keel promote instead of moving the tag yourself.
- **Why:** It replaces an unguarded gesture with one that checks the commit was tested and that production serves it after.
- **Look at:** what keel promote shows before --yes.
- **Choices:** It was enough | I needed more before promoting
- **Takes:** 10 minutes.
- **Then:** More: what was missing goes into the preview.
- **Ready when:** this phase has shipped to isocan.

## Real surfaces

- Owner's machine: `keel promote` on isocan.
- GitHub API: the moved tag.

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/promote.test.mjs tests/workflows.test.mjs`; `npm run check`.
By hand: one real promotion.

## Deliberately open

- **"Do not promote while somebody is presenting"** (isocan's rule) is a person's judgement; keel does not encode it.
- **Known limit**: anyone who can push the tag can still move it by hand; keel guards its own command, not the ref.

## Next action

Write `keel promote` with `tests/promote.test.mjs` on a bare-origin fixture and a stub verify.
