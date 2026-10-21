---
status: designed
since: 2026-10-21
goal: G4
spec: 2
depends: [54, 91]
note: "Local capture, private revision storage, explicit publication handoff and resolution contracts settled; implementation and proof remain."
evidence: []
---

# Feedback names the result the owner reviewed

## Done when

Feedback retains the exact reviewed result and proposes a deduplicated follow-up with fresh routing facts, without publishing private words, accepting decisions or starting work automatically.

## Scope

Implement slice 92 of [Decisions and feedback](../specs/decisions-and-feedback.md).
Keep the existing authorities and authorization boundaries.

## Acceptance

- [ ] Capture retains immutable result identity and reports missing versions without replacing them with latest: `tests/feedback.test.mjs`.
- [ ] Source replay deduplicates, edits retain prior words, and feedback on a new result remains distinct: `tests/feedback.test.mjs`.
- [ ] Open, closed and unknown work states produce the specified route or gap; a conflicting decision produces a reopening proposal: `tests/feedback-route.test.mjs`.
- [ ] Publication handoff preserves the existing robot preview/intent identity and exact outbound payload; delivery and ambiguous-write recovery reuse the existing issue API: `tests/feedback-route.test.mjs`.
- [ ] Raw text is absent from Git exports, ordinary canvas snapshots, night artifacts and logs; capacity errors preserve stored work: `tests/feedback.test.mjs`.
- [ ] The board reports pending work and resolution links, and fresh-process capture/list/propose works with an unavailable adapter: `tests/feedback-cli.test.mjs`.

## Real surfaces

- Published package: pack and extract the CLI, then exercise the slice in a disposable Acme repository without a keel checkout.
- Adopted project: render the affected practice into Acme and check its agent guide, JSON interface and failure cases.
- Owner's machine: repeat the local lifecycle in a fresh process, retaining state and checking refusal after a source change.

## Proof

These are implementation targets, not tests already present or results of this
specification task. Add the named tests before claiming acceptance.

- `node --import ./tests/helpers/hermetic.mjs --test tests/feedback.test.mjs tests/feedback-route.test.mjs tests/feedback-cli.test.mjs`
- `npm run check`
- `npm run typecheck`
- `npm pack --ignore-scripts --pack-destination /tmp` followed by the disposable Acme lifecycle above. Record the extracted package revision, exact commands and outputs in this phase's evidence when implemented.

No live writes or paid sessions are required for the automated proof. A later
live walk must name its approved destination and actual costs in evidence;
local success is not a claim of deployed or lived-in behavior.

## Deliberately open

Automatic canvas comment collection is deferred until the installed public API supplies verified version identity and read coverage. Human usefulness and live adapter behavior require separate evidence; synthetic tests prove only mechanics.

## Next action

Implement the dated phase-92 contract: pure validation/routing, bounded private store, digest-bound capture/resolution, explicit issue handoff and metadata-only board projection. Run the named proofs and packed/adopted lifecycle; automatic provider collection remains unavailable.

## Trajectory

- **2026-10-21** — An independent adopted-package probe included locally Git-excluded private files in npm packing, and a negated descendant bypassed a single ignore probe. Verify actual destinations and retain a store-local npm exclusion; project-root user files remain untouched.

- **2026-10-21** — Guided web walks require the same immutable feedback model. Keep pure domain logic separate from local storage. Proposal-only capture does not claim remote delivery; handoff reuses the existing issue preview and journal identities. Explicit resolution and conflict attribution complete previously unnamed local transitions.

- **2026-10-20** — Phase 50 has an outstanding deployed canvas walk. Explicit local capture does not depend on that walk; the existing canvas receipt format is an optional input and automatic collection remains deferred.
