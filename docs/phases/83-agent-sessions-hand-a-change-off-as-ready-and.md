---
status: planned
since: 2026-10-16
goal: G6
spec: 2
depends: [80, 70]
note: "Specified 2026-10-16 from the owner's two-sessions complaint: a session marks a change ready, one integrator batches ready changes and runs the full gate once."
evidence: []
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

- [ ] `keel ready` records a branch as ready without running the full gate. `tests/integrate.test.mjs`
- [ ] Two integrators racing for the lock: exactly one runs. `tests/integrate.test.mjs`
- [ ] Three ready changes, one breaking the gate: the integrator lands the two good ones in one push, isolates the bad one by splitting, and reports it. `tests/integrate.test.mjs`
- [ ] The full gate runs once for a batch that passes. `tests/integrate.test.mjs`
- [ ] The conduct skill finishes with `keel ready` and leaves the full gate to `keel integrate`. `tests/skill.test.mjs`
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

## Next action

Write `keel ready` and `keel integrate` over phase 70's claim, with `tests/integrate.test.mjs` on bare-origin clones.
