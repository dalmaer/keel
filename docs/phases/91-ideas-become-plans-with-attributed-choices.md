---
status: partial
since: 2026-10-20
goal: G0
spec: 2
depends: [90]
note: "PR #208 reached three review rounds; owner decision required for the reproduced tilde-fence injection finding before landing."
evidence: ["evidence/2026-10-20-shaping.md"]
---

# An idea becomes work without losing the owner choices

## Done when

A locally reviewed shaping record produces non-overwriting phase drafts or robot rubric previews with attributed decisions, named proof and valid dependencies, while changed inputs invalidate approval.

## Scope

Implement slice 91 of [Decisions and feedback](../specs/decisions-and-feedback.md).
Keep the existing authorities and authorization boundaries.

## Acceptance

- [x] Recommendations, owner answers and unanswered questions remain distinct, with stable IDs and bounded inputs: `tests/shaping.test.mjs`.
- [x] Cycles, missing proof declarations and unknown decision references fail validation; a named proof is never reported as verified: `tests/shaping.test.mjs`.
- [x] An input change invalidates the reviewed digest without deleting earlier choices: `tests/shaping.test.mjs`.
- [x] Retries and interrupted multi-file writes recover the same drafts without overwriting edited files: `tests/shaping.test.mjs`.
- [x] Milestone projects receive previews without archived local plans; no command starts a model or creates an issue: `tests/shaping-cli.test.mjs`.
- [ ] Packed commands, rendered guide and local review preserve the preview through a fresh process: `tests/shaping-cli.test.mjs`.

## Real surfaces

- Published package: pack and extract the CLI, then exercise the slice in a disposable Acme repository without a keel checkout.
- Adopted project: render the affected practice into Acme and check its agent guide, JSON interface and failure cases.
- Owner's machine: repeat the local lifecycle in a fresh process, retaining state and checking refusal after a source change.

## Proof

The named tests exercise the implementation and refusal paths. The evidence records actual results and limits.

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

Owner decides how PR #208 proceeds at its three-round review limit. Recommended: authorize one additional repair/review round to escape tildes and prove generated prose cannot open a Markdown fence. Do not merge until the finding is repaired and the corrected head passes review and CI.

## Trajectory

2026-10-20: Recovery must ignore only its own exact generated draft bytes when recomputing source context. The resolver verifies hashes and excludes no file containing decision metadata. Otherwise the first successful write could invalidate its own retry. Milestone previews reject external local-phase dependencies rather than treating unknown references as valid.

2026-10-20: Independent review caught a blocker inferred from formatted owner words. The fix derives unanswered prerequisites from structured IDs; a red-without/green-with regression proves the correction.

2026-10-20: A second review found that composing two escaping passes corrupted owner wording. Single-pass escaping now preserves rendered text, with a verified roundtrip regression for literal entities and structural injection attempts.

2026-10-20: Third review reproduced a tilde-fence injection in generated prose. A scope of `~~~` passed validation and emitted an unescaped code fence. This invalidates complete rendering acceptance. The finding is classified security/fix-first; no further fix or merge proceeds without the owner’s decision at the review limit.
