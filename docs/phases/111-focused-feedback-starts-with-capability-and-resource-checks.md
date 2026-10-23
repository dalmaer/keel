---
status: partial
since: 2026-10-22
goal: G5
spec: 2
depends: [110]
review: wait
note: "Source implementation awaits integrated checks, exact-head review and parent review; defaults unchanged."
evidence: ["evidence/2026-10-22-validation-preflight.md"]
---

# Focused feedback starts with capability and resource checks

## Done when

An advisory focused-first plan fails closed for unknown/shared inputs and an opt-in resource budget preserves every required gate.

## Scope

[Validation efficiency spec](../specs/validation-efficiency.md), phase 111.
Only source and existing manifest-managed consumers. No deployment or schedule.

## Acceptance

- [x] Explicit source mappings retain conventions; unknown/shared/config/rename and consumer inputs request broad coverage without executing gates: `node --import ./tests/helpers/hermetic.mjs --test tests/validation-plan.test.mjs`.
- [x] Actual runtime/tool/binding capability gaps fail closed; unsupported runtime is refused before focused execution: `node --import ./tests/helpers/hermetic.mjs --test tests/validation-plan.test.mjs tests/check-focused.test.mjs`.
- [x] Opt-in shared host admission preserves commands and foreground process-group lifecycle across roots, refuses ambiguous or stale ownership, and changes no default: `node --import ./tests/helpers/hermetic.mjs --test tests/validation-budget.test.mjs`.
- [x] Synthetic paired evidence preserves outcomes and demonstrates bounded contention without claiming pipeline savings: `node --import ./tests/helpers/hermetic.mjs --test tests/validation-budget.test.mjs`.
- [x] Focused negative controls prove the phase contract: `node --import ./tests/helpers/hermetic.mjs --test tests/validation-plan.test.mjs tests/validation-budget.test.mjs`.
- [ ] Required integrated checks pass: `npm run check`; `npm run typecheck`.
- [ ] Exact-head review is recorded: `node bin/plates.mjs review dalmaer/plates#<PR> --gate --json` plus inspection of pinned complete review inputs.
- [ ] ⚑ by hand: parent reviews evidence before broader rollout.

## Your part

- **Ask:** Review this stage’s evidence before changes are adopted more broadly.
- **Why:** Workflow and gate changes must preserve coverage and observed reliability.
- **Look at:** [The staged contract](../specs/validation-efficiency.md) and this phase’s evidence.
- **Choices:** Proceed with the next stage | Revise the stage
- **Takes:** About five minutes once review and checks finish.
- **Then:** A separate implementation PR advances the next stage; no production rollout is automatic.
- **Ready when:** Exact-head checks and normal review have completed.

## Real surfaces

- workflow shell: run the focused commands in Proof and inspect the required CI workflow at the exact reviewed head.

## Proof

`node --import ./tests/helpers/hermetic.mjs --test tests/validation-plan.test.mjs tests/validation-budget.test.mjs`

Source required integrated checkpoint: `npm run check`; `npm run typecheck`.
Run focused checks first; do not repeat full suites during builder iteration.

## Deliberately open

Admission is cooperative POSIX foreground process-group coordination, not containment of arbitrary or daemonizing processes. Explicit acknowledgement is required for execution; escaped-session commands and unsupported platforms are not admitted. Existing or unknown child groups retain capacity.

Observed speed savings remain unknown until matched trials. Later phases and
consumer adoption wait for the preceding review; no policy is weakened here.

## Next action

Complete focused/convention verification and the unchanged integrated checkpoint, then record clean exact-head CI and independent review in the separate draft PR stacked on phase 110. Parent reviews this stage before broader rollout; no merge or deployment.

## Trajectory

- **2026-10-22** — The parent accepted reviewed phase 110 for continuation only. Phase 111 is a separate stacked draft; complete gates, normal independent review and a parent review boundary remain. [Evidence](../evidence/2026-10-22-validation-preflight.md).
- **2026-10-22** — Admission is cooperative foreground process-group coordination, not arbitrary process containment. Internal bookkeeping must tolerate brief writer contention without killing admitted work, while execution deadlines begin at spawn. [Evidence](../evidence/2026-10-22-validation-preflight.md).
