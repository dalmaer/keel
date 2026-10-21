---
status: partial
since: 2026-10-16
owes: walk
goal: G6
spec: 2
depends: [81]
note: "Partial 2026-10-17: plates promote (the delivery practice's promote.mjs) moves delivery.promote only to a commit on the tested ref with phase 79's gate result, previews first, moves with --yes under a lease, and verifies production after; --back passes only on exactly the commit. No workflow runs it. The owner's one real promotion of isocan waits."
evidence: ["evidence/2026-10-17-promote.md"]
issue: 165
---

# Promotion is a guarded gesture

## Done when

`plates promote [<commit>]` moves a project's production ref only to a commit on its tested ref, previews first, verifies production serves it afterwards (phase 81), and `plates promote --back <commit>` rolls back the same way; it is always a person's command and nothing runs it automatically.

## Scope

The design is [Delivery: a change reaches production once, checked](../research/2026-10-16-delivery.md), item 5.

- **The ref**: `delivery.promote` names it (`tag:prod`, `branch:production`); a project without one has no promote.
- **The guard**: the commit must be on the tested ref and its gate must have passed (phase 79's result); anything else is refused, naming why. Default commit: the tested ref's head.
- **Preview, then `--yes`**: show the commit, what changes from what production serves now, and the verify that will follow.
- **After**: run `verify.mjs` against production and report; a failed verify suggests `--back` and never moves anything itself.
- **Rollback verifies the exact commit**: phase 81 accepts a descendant, which is right going forward but wrong going back (production still serving the newer B would pass a rollback to its ancestor A). `--back` requires production to report exactly the target commit, within the same bounded wait, and reports failure otherwise.
- **Who**: the command runs on the owner's machine with their git credentials; no workflow promotes.

## Acceptance

- [x] `plates promote` refuses a commit not on the tested ref or without a passing gate, and moves the ref for one that is, only with `--yes`. `tests/promote.test.mjs`
- [x] After moving, it verifies production and reports; a failure suggests `--back` and moves nothing. `tests/promote.test.mjs`
- [x] `--back <commit>` moves the ref to an earlier tested commit with the same checks, and passes only when production reports exactly that commit: production still serving the newer commit after the ref moved is a failure, never a success. `tests/promote.test.mjs`
- [x] No installed workflow runs `plates promote`. `tests/workflows.test.mjs`
- [ ] ⚑ by hand: the owner promotes isocan once with plates promote instead of moving the tag by hand.

## Your part

- **Ask:** The next time you promote isocan, use plates promote instead of moving the tag yourself.
- **Why:** It replaces an unguarded gesture with one that checks the commit was tested and that production serves it after.
- **Look at:** what plates promote shows before --yes.
- **Choices:** It was enough | I needed more before promoting
- **Takes:** 10 minutes.
- **Then:** More: what was missing goes into the preview.
- **Ready when:** this phase has shipped to isocan.

## Real surfaces

- Owner's machine: `plates promote` on isocan.
- GitHub API: the moved tag.

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/promote.test.mjs tests/workflows.test.mjs`; `npm run check`.
By hand: one real promotion.

## Deliberately open

- **"Do not promote while somebody is presenting"** (isocan's rule) is a person's judgement; plates does not encode it.
- **Known limit**: anyone who can push the tag can still move it by hand; plates guards its own command, not the ref.
- **A docs-only commit at the tested tip** (2026-10-17, open): CI's gate step records it as "skipped: docs only" (phase 79), which is not a gate record, so promote refuses it, naming why; promote the tested commit before it. Accepting a skip by checking its base is left until a project hits it.
- **Settled 2026-10-17, while building:**
  - *Where it runs*: `plates promote` runs the project's own `scripts/plates/promote.mjs` (a managed delivery file beside the night's scripts it imports, `gate.mjs` and `verify.mjs`), so doctor sees drift in it and a project without it is told to update.
  - *Which gate result*: phase 79's, `gate.mjs` `ciResult` (ledger evidence, not only the run's conclusion), for `delivery.gateWorkflow` else `ci.gateWorkflow`, at any age: the 24-hour window is for reusing a result instead of running the gate, not for whether a commit was tested.
  - *A sideways move* (production on a commit the target does not contain, as after a hand-moved tag) is allowed forward; the preview lists the commits that leave production. Only an ancestor of production needs `--back`.
  - *It does not `--record`* the verify: the project's deploy step records its own (phase 81); promote reports and exits by it.
  - *It pushes with `--no-verify`*, as the publisher does: a pre-push gate on the owner's checkout tests that checkout, not the promoted commit.
  - *A lightweight tag*: the tag is pushed as `<commit>:refs/tags/<name>`, so an annotated tag becomes a lightweight one; the lease is on the object origin had.

## Next action

The owner promotes isocan once with `plates promote` (preview, then `--yes`) instead of moving the tag by hand, once the delivery practice with `delivery.promote: "tag:prod"` has shipped there, and says whether the preview was enough.
