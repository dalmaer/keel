---
status: partial
since: 2026-10-17
goal: G6
spec: 2
depends: [80, 70]
owes: walk
note: "Partial 2026-10-17: keel ready hands a change off with its fast checks only; keel integrate, under the claims/integrate lock, gates every ready change once and pushes once, accumulating by halves on a failure so an interaction is found. The owner's two-sessions walk waits."
evidence: ["evidence/2026-10-17-integrate.md"]
issue: 166
---

# Agent sessions hand a change off as ready, and one integrator runs the expensive path

## Done when

A session that finishes a change runs only its fast checks and marks it ready instead of running the full gate and pushing; one integrator, holding a claim-based lock, takes every ready change as a batch, runs the full gate once on the combined tree and pushes it; and a failing batch is split until the change that broke it is found and sent back, while the rest land.

## Scope

The design is [Delivery: a change reaches production once, checked](../research/2026-10-16-delivery.md), "The owner's ask"; phase 80 publishes what the integrator pushes.

- **Ready**: `keel ready` pushes the session's branch and records it as ready (a ref under `ready/`, with the session, the fast checks it ran and their results). It never runs the full gate.
- **The lock**: `claims/integrate`, phase 70's create-only claim; one integrator at a time, across sessions and machines.
- **Integrate**: `keel integrate` takes the lock, merges every ready branch onto `origin/main` in order, runs the full gate once, and pushes. A conflict or a failed gate splits the batch in halves and retries, until each failing change is isolated, reported to its session and left ready-but-blocked.
- **The conduct skill**: builders and sessions finish with `keel ready`; only `keel integrate` runs the full gate. The existing "never run a build beside another build" becomes the lock, not a sentence.
- **Who runs it**: any session may run `keel integrate`; the lock makes the second one wait or exit.

## Acceptance

- [x] `keel ready` records a branch as ready without running the full gate. `tests/integrate.test.mjs`
- [x] Two integrators racing for the lock: exactly one runs. `tests/integrate.test.mjs`
- [x] Three ready changes, one breaking the gate: the integrator lands the two good ones in one push, isolates the bad one by splitting, and reports it. `tests/integrate.test.mjs`
- [x] The full gate runs once for a batch that passes. `tests/integrate.test.mjs`
- [x] Two individually passing changes whose combination fails: one lands, the other is reported as conflicting with it, and nothing failing is pushed (keel#166). `tests/integrate.test.mjs`
- [x] The conduct skill finishes with `keel ready` and leaves the full gate to `keel integrate`. `tests/skill.test.mjs`
- [ ] ⚑ by hand: the owner asks two sessions for two changes and sees one full gate and one push.

## Your part

- **Ask:** Ask two sessions for two small changes, one after the other, and watch what runs.
- **Why:** This is exactly the situation that started this: two changes, one expensive path.
- **Look at:** the integrator's report and the project's Actions page.
- **Choices:** One gate, one push | Two of either
- **Takes:** 10 minutes.
- **Then:** Two: whatever ran twice is found and fixed.
- **Ready when:** this phase has shipped.

## Real surfaces

- Owner's machine: two sessions, `keel ready` and `keel integrate`.
- GitHub API: the ready refs, the lock and the push.

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/integrate.test.mjs tests/skill.test.mjs`; `npm run check`.
By hand: the owner's two sessions.

## Deliberately open

- **Who starts the integrator**: a session, a person, or a schedule; the lock makes all three safe.
- **Known limit**: a change that only conflicts with another in the batch is reported as blocked; resolving the conflict stays its session's work.
- **Split or accumulate — settled 2026-10-17** by keel#166's review comment: splitting alone cannot isolate an interaction failure (two changes that each pass, and fail together). The fast path is the whole batch, gated once: a passing batch costs one gate run and one push, as the acceptance asks. Only on a failure does the integrator fall back, and the fallback accumulates by halves: the left half is accepted against `main`, then the right half against the tree accepted so far, down to single changes, so each change is kept only on top of everything kept before it. A single change that fails on top of kept ones is gated once more alone on `main`, to report "fails the gate" or "conflicts with <kept>". The tree pushed is always one the gate passed (`pushable`, checked at the push). Cost on failure, against applying the changes one at a time after the batch fails: for a large batch with one bad change the halves need about 2·log₂k gate runs instead of k; for a small one a run or so more (six against five for three changes, the test's count). The order stays the order changes were marked ready.
- **The second integrator exits, it does not wait — settled 2026-10-17**: exit 1 naming the holder; the holder takes every ready change, the second session's included. A lock left by a run that died is the owner's to delete (`git push origin --delete claims/integrate`), as a stale phase claim is.
- **Where the gate runs — settled 2026-10-17**: in a temporary worktree of the integrator's checkout, detached on `origin/main`, so the session's own tree is never moved. The project's `node_modules`, when the checkout has one, is linked in; a project whose gate needs other untracked setup in the tree is a known limit.
- **What "fast checks" are — settled 2026-10-17**: `.keel/keel.json` `"delivery": {"fast": [..]}` and each `keel ready --check "<cmd>"`, run by `keel ready` itself, so the recorded exit codes are observed, not reported. A check that is the full gate (`check`, default `npm run check`) is refused.

## Next action

The owner's walk: two sessions, two small changes, each finishing with `keel ready`; one `keel integrate`; read its report (one gate run, one push) and the Actions page.

## Trajectory

- **2026-10-17** — Splitting became accumulating by halves: keel#166 showed halving finds no culprit when two passing changes fail together. The interaction case is its own acceptance box. `tests/integrate.test.mjs`.
- **2026-10-17** — The cold start held its budget: `keel ready|integrate` went on one line, paid for by shortening five other lines (3,195 → 3,191 characters); the detail is the `improve` topic's "Ready and integrate" section.
