# Evaluation and learning: current capability map

Inspected 23 October 2026 at Plates `8f218d7e138edda2c86fc5055c97a59b9df8427a`.
This is source inspection, not a new execution or production audit. The current
primary checkout was older; this map uses published main in an isolated checkout.
**Implemented** below means inspected source and its named tests exist. Phase
status and live activation are separate. No agent evaluation ran for this work.

| Requirement | Existing mechanism | Gap | Proposed extension |
| --- | --- | --- | --- |
| Agent/runtime adapters | Implemented provider selection and Claude/Codex build/review paths in `scripts/plates/robot.mjs`, `scripts/plates/cross-review.mjs`, and their workflow templates; `tests/robot-runtime.test.mjs`, `tests/cross-review.test.mjs` | Workflow-oriented; no general isolated evaluation launcher. Hosted `job-worker.mjs` accepts only `typecheck-v1` | Extract a narrow typed trial adapter from these execution paths; unsupported capabilities refuse. Do not call hosted typecheck a coding-agent adapter |
| Task execution/workspaces | `scripts/plates/climb.mjs` scratch worktrees, guards and compare; `lib/prove.mjs` scratchTree/runTestLimited; `lib/web/workspace.mjs` explicit external private state | Worktrees and same-user directories do not protect hidden checks or host memory | Fresh exported source plus separate builder/evaluator containers; reuse scratch artifact and workspace ownership helpers |
| Budgets/leases/deadlines/cancel | `lib/validation-budget.mjs` host admission and process-group termination; `scripts/plates/robot-budget.mjs` weekly admission; `lib/web/job-store.mjs` and `job-worker.mjs` fences/deadline/heartbeat/cancel | Host slots are not model dollars; robot allowance is not an evaluation allowance; web worker activation is not established by code | Comparison reservation in existing experiment ledger, linked execution leases, stage ceilings; no automatic lease expiry refund |
| Run/phase/settlement/verdict | `lib/session-trials.mjs` experiment events; climb settlement and guard outcomes; phases own acceptance | Session trials accept supplied outcome observations and only vary contextTokens. Not independent task acceptance | Add explicitly tagged harness experiment schema and evaluator-owned verdicts; leave v1 handoff semantics intact |
| Immutable receipts/evidence | Validation artifacts, `lib/validation-evidence.mjs`, `lib/web/run-receipts.mjs`, `lib/evidence.mjs`, canvas/robot recovery receipts, source `docs/evidence/` | Not one universal store; no existing case/config/artifact/evaluator binding | Add trial evidence attachments to the experiment's existing private workspace; refer to existing receipts rather than copying them; export reviewed summaries to docs/evidence |
| Validation planning/execution | `lib/validation-plan.mjs` focused-first advisory plan; `scripts/check-focused.mjs`; configured full gate; `lib/prove.mjs` red/green proof | Focused feedback is not acceptance authority, and mutable project tests are not held-out evaluation | Immutable per-case acceptance manifest and external checker; retain full project gate as a separately attributed observation |
| Cross-review/findings | `lib/review.mjs` exact-head reads, answer receipts and round limits; `scripts/plates/cross-review.mjs` tagged findings; `lib/robot-issue.mjs` durable issue intents | Review preference is not verified cause; no measured lesson promotion requirement | Explicit selected finding capture, provenance/dedup, hypothesis and comparison links in existing learn records |
| Baselines/night self-measurement | `scripts/plates/improve.mjs` measures/selftest/bounds; climb paired performance and guards; `lib/session-trials.mjs` ABBA handoff audit | Outcomes for representative coding tasks and control regressions not measured; automatic handoff policy can apply within its envelope | New task experiment kind never auto-applies; per-case paired outcomes and cost provenance |
| Recovery/retries | Existing robot/canvas intents; job fences; session ledger lock/atomic write; phase 116 report recovery and exact push lease | No comparison slot plan or artifact/verdict reconciliation | Immutable slots, parent attempt IDs and resume-missing operation on the experiment ledger |
| Context/skills/conventions | `lib/practices.mjs` managed/block/seeded files and selected guide; `.plates/lock.json`; `.agents/skills/spin`; hermetic subprocess helpers | No fingerprint of the complete effective context actually delivered to an evaluated agent | Hash rendered context, routing decisions, tool policies and runtime settings; candidate overlay inactive outside trial |
| Lessons/decisions | `lib/learn.mjs` inbox/propose/decide, `lib/distill.mjs` families; `lib/decision.mjs` scoped decision context; `docs/lessons.md` provenance | Existing acceptance may append a lesson without an experiment; no full observed→promoted history | Optional evaluation extension on selected inbox records, not replacement of their status or global retro rules |
| Reporting/roadmap | Generated `docs/ROADMAP.md`, `docs/goals.json`; improve/morning/fleet/canvas project source records | No task comparison report; phase 116 does not evaluate harness quality | JSON + Markdown comparison through retro/improve, no new dashboard or scheduler |

## Confirmed limits and roadmap intentions

- Phase 72 is **built**: explicit handoff trial ledger, not a launcher. It uses
  `.plates/session-trials/<id>/state.json`, bounded exclusive locks and atomic
  replacement. Its three-pair minimum and automatic policy tuning are specific
  to handoffs; neither is inherited by harness evaluation.
- Phase 111 is **built**: cooperative foreground admission, explicitly **not a
  sandbox**. Phase 110 provides read-only audits. Phase 114 is **partial**;
  consumer exact-head producers/reuse remain pending. Phase 115 is **designed**;
  shadow selection is not an implemented acceptance system.
- Phase 104 is **partial, walk owed**: durable hosted worker code exists, but
  activation/live exercises remain. The inspected worker pins `typecheck-v1`
  and executes install/typecheck; it cannot presently execute arbitrary trials.
- Phase 116 is **built**, not fleet-adopted/lived-in. It records nightly source
  verification and reports gaps; report-only revision drift remains tracked in
  issue [237](https://github.com/dalmaer/plates/issues/237). It is not a trial verdict.
- `prove` demonstrates a test distinguishes a selected fix. It does not measure
  whether an agent using changed instructions solves a task more often.
- Existing experiment records and proposed local execution stay subordinate to
  project phase/issue authority. No new queue, task graph, cron or auto-promotion.

## Design entry points

[Harness evaluation](../specs/harness-regression-evaluation.md),
[measured review learning](../specs/review-learning-evaluation.md), and
[source decisions](2026-10-23-evaluation-patterns.md) define the extensions.

## Implementation follow-up: phase 117

The original table above remains the inspection at its named baseline. Phase 117
adds local `retro evaluations plan|freeze|inspect`, strict schema-2 definitions,
external workspace ownership and shared session-ledger I/O. Its
[evidence](../evidence/2026-10-23-evaluation-records.md) establishes record mechanics
only. Agent execution, independent task acceptance, paired outcome comparison and
measured lesson promotion remain future work; no provider availability or spend
is inferred from a declared configuration.

## Implementation follow-up: phase 118

Offline `retro evaluations run` extends the same private experiment with explicit
submission, separate Docker execution/evaluation, existing host-coordinator
container leases and immutable artifact-bound verdicts. An independently bounded
non-root supervisor covers controller loss. Observed execution-source hashes are
separate from declared harness metadata. The retained
[owner-machine walk](../evidence/2026-10-23-evaluation-isolation-walk.mjs) replays
known broken and corrected historical artifacts through clean synthetic package
consumers. This tests machinery and acceptance sensitivity, not whether a model
using candidate instructions improves. No paid provider, comparison runner,
held-out generalization or lesson promotion is activated.


## Implementation follow-up: phase 119

The offline experiment now supports ordered missing-slot resume, compare,
explicit original-operation reconciliation and cancellation. It extends the
existing host coordinator and session ledger rather than adding a scheduler.
New harness locks retain verifiable ownership; legacy ambiguous locks remain
blocked. Stage authorization and immutable reconciliation preserve failed or
unknown attempts and completed verdicts. The
[phase evidence](../evidence/2026-10-23-evaluation-comparison.md) records the real
twenty-slot CLI walk and actual controller termination/resume.

This is implemented offline machinery, not a live provider adapter. Enforced
provider spending, paid screening, held-out generalization and measured
promotion remain gaps. Phase 119 stays partial; its remaining live requirements
do not prevent independent corpus and lesson-record implementation.

## Phase 120–121 observations — 24 October 2026

Phase 120's six development cases and bounded export are implemented and have
independent historical artifact replay and installed-CLI evidence. Its exact-head
CI/review passed; it remains unmerged behind phase 119's review-limit decision.
Phase 121 now implements selected source verification, append-only inbox versions,
legacy bypass guards and actual material-plan binding. Its public-CLI walk retained
five lifecycle transitions and refused acceptance/promotion paths without execution.
Its final integrated gate passed; PR review remains pending. These are record and verification
mechanisms, not measured agent benefit; phase 119's live adapter/spend integration
and owner-approved screening remain open.
