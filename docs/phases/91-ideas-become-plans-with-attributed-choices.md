---
status: planned
since: 2026-10-20
goal: G0
spec: 2
depends: [90]
note: "Authorized specification; implementation and real-use evidence remain."
evidence: []
---

# An idea becomes work without losing the owner choices

## Done when

A locally reviewed shaping record produces non-overwriting phase drafts or robot rubric previews with attributed decisions, named proof and valid dependencies, while changed inputs invalidate approval.

## Scope

Implement slice 91 of [Decisions and feedback](../specs/decisions-and-feedback.md).
Keep the existing authorities and authorization boundaries.

## Acceptance

- [ ] Recommendations, owner answers and unanswered questions remain distinct, with stable IDs and bounded inputs: `tests/shaping.test.mjs`.
- [ ] Cycles, missing proof declarations and unknown decision references fail validation; a named proof is never reported as verified: `tests/shaping.test.mjs`.
- [ ] An input change invalidates the reviewed digest without deleting earlier choices: `tests/shaping.test.mjs`.
- [ ] Retries and interrupted multi-file writes recover the same drafts without overwriting edited files: `tests/shaping.test.mjs`.
- [ ] Milestone projects receive previews without archived local plans; no command starts a model or creates an issue: `tests/shaping-cli.test.mjs`.
- [ ] Packed commands, rendered guide and local review preserve the preview through a fresh process: `tests/shaping-cli.test.mjs`.

## Real surfaces

- Published package: pack and extract the CLI, then exercise the slice in a disposable Acme repository without a keel checkout.
- Adopted project: render the affected practice into Acme and check its agent guide, JSON interface and failure cases.
- Owner's machine: repeat the local lifecycle in a fresh process, retaining state and checking refusal after a source change.

## Proof

These are implementation targets, not tests already present or results of this
specification task. Add the named tests before claiming acceptance.

- `node --import ./tests/helpers/hermetic.mjs --test tests/shaping.test.mjs tests/shaping-cli.test.mjs`
- `npm run check`
- `npm run typecheck`
- `npm pack --ignore-scripts --pack-destination /tmp` followed by the disposable Acme lifecycle above. Record the extracted package revision, exact commands and outputs in this phase's evidence when implemented.

No live writes or paid sessions are required for the automated proof. A later
live walk must name its approved destination and actual costs in evidence;
local success is not a claim of deployed or lived-in behavior.

## Deliberately open

Whether a proposed proof is sufficient remains a conductor judgment. The first renderer uses local HTML and text; integrated visual choice editing and external planning writes are deferred.

## Next action

Implement the bounded shaping schema and failure fixtures, then build the local preview and recovery receipt.
