---
status: built
since: 2026-10-21
goal: G4
spec: 2
depends: [54, 91]
note: "Private exact-result feedback, reviewed issue/shaping handoffs and metadata board proven locally and through a packed adopted project; hosted walks remain phase 98."
evidence: ["evidence/2026-10-21-private-result-feedback.md"]
---

# Feedback names the result the owner reviewed

## Done when

Feedback retains the exact reviewed result and proposes a deduplicated follow-up with fresh routing facts, without publishing private words, accepting decisions or starting work automatically.

## Scope

Implement slice 92 of [Decisions and feedback](../specs/decisions-and-feedback.md).
Keep the existing authorities and authorization boundaries.

## Acceptance

- [x] Capture retains immutable result identity and reports missing versions without replacing them with latest: `tests/feedback.test.mjs`.
- [x] Source replay deduplicates, edits retain prior words, and feedback on a new result remains distinct: `tests/feedback.test.mjs`.
- [x] Open, closed and unknown work states produce the specified route or gap; a conflicting decision produces a reopening proposal: `tests/feedback-route.test.mjs`.
- [x] Publication handoff preserves the existing robot preview/intent identity and exact outbound payload; delivery and ambiguous-write recovery reuse the existing issue API: `tests/feedback-route.test.mjs`.
- [x] Raw text is absent from Git exports, ordinary canvas snapshots, night artifacts and logs; capacity errors preserve stored work: `tests/feedback.test.mjs`.
- [x] The board reports pending work and resolution links, and fresh-process capture/list/propose works with an unavailable adapter: `tests/feedback-cli.test.mjs`.

## Real surfaces

- Published package: pack and extract the CLI, then exercise the slice in a disposable Acme repository without a plates checkout.
- Adopted project: render the affected practice into Acme and check its agent guide, JSON interface and failure cases.
- Owner's machine: repeat the local lifecycle in a fresh process, retaining state and checking refusal after a source change.

## Proof

The evidence records the named tests, extracted-package lifecycle and local
browser walk. The full gate is run by the integrator on the recorded tree.

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

None for this local slice. Lived-in evidence requires actual owner feedback and live adapter observations; hosted guided walks continue in phase 98.

## Trajectory

- **2026-10-21** — A generic reopening tag could not enter phase 91. Require an explicitly authored, validated shaping draft and prove the returned draft through the existing inspection path; inventing goals, proof commands or owner answers would change authority.

- **2026-10-21** — An independent adopted-package probe included locally Git-excluded private files in npm packing, and a negated descendant bypassed a single ignore probe. Verify actual destinations and retain a store-local npm exclusion; project-root user files remain untouched.

- **2026-10-21** — Guided web walks require the same immutable feedback model. Keep pure domain logic separate from local storage. Proposal-only capture does not claim remote delivery; handoff reuses the existing issue preview and journal identities. Explicit resolution and conflict attribution complete previously unnamed local transitions.

- **2026-10-20** — Phase 50 has an outstanding deployed canvas walk. Explicit local capture does not depend on that walk; the existing canvas receipt format is an optional input and automatic collection remains deferred.
