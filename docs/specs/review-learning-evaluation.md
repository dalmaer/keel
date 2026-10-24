# Review lessons promoted through evaluation

Design, 23 October 2026; no production behavior or paid evaluation is enabled.
Builds on [harness evaluation](harness-regression-evaluation.md), the
[capability map](../research/2026-10-23-evaluation-capabilities.md) and
[source decisions](../research/2026-10-23-evaluation-patterns.md).

## Problem and intended behavior

A recurring review finding can expose a missing check, misunderstood requirement
or broken procedure. A persuasive retrospective is only a hypothesis. Selected
findings should become narrow, testable proposals whose measured benefits and
regressions inform a human decision. Reviewer preferences are not automatically
engineering requirements. Success is reduced recurrence and intervention while
preserving acceptance and bounded cost, not more instructions or lessons.

## Existing mechanisms and authority

Extend `lib/learn.mjs` inbox/propose/decide and `lib/distill.mjs` related families;
use `lib/review.mjs` exact-head finding/answer receipts and `lib/decision.mjs`
accepted decision context. Preserve existing inbox records and legacy learning.
Do not create another knowledge platform, task store or scheduler. Phase/issue
records continue to own work; accepted decision records own architecture.

For selected proposals only, add a versioned structured evaluation section to the
existing `docs/inbox/<id>.md` record. Implement a strict parser and canonical
serializer before treating it as executable data. Private source text stays in
the existing private workspace; source records reference hashes and sanitized
facts. Evidence attachments are the harness experiment's retained artifacts.
Summaries go through the existing reviewed `docs/evidence/` lane.

The new lifecycle is derived from append-only transition entries in that section,
not a second independently editable status field. Legacy inbox status is rendered
as a compatibility projection in the same atomic write: observed=untriaged;
proposed/evaluated/ready-for-review=proposed; promoted=accepted;
rejected=declined; superseded=linked. Rolled-back maps to proposed with an explicit
rollback banner and linked repair task. Existing untagged records retain their
semantics. A mismatch is a validation error, never silently repaired.

Proposed operations extend `plates learn`: `evaluate propose`, `evaluate plan`,
`evaluate inspect`, `evaluate decide`, and `evaluate follow-up`, all with `--json`.
They are not implemented commands. Initial proposal input is an explicit list of
selected finding refs. No automatic review ingestion or automatic agent call.
Mutations preview exact records and digest; `--yes --digest` approves that local
change only. Evaluation execution uses retro's separately approved plan; publishing
uses existing reviewed PR/issue delivery and its original recovery receipts.

## Data contracts

All structured records use stable IDs, schema versions, content digests and
immutable typed references as defined in the harness contract. Keep previous
words, revisions and disposition history; superseding does not erase evidence.

| Record | Fields |
| --- | --- |
| Lesson | id/version, failure description, source finding IDs and execution/artifact refs, exact reviewed revisions, affected repositories/paths/task classes, recurrence observations and coverage, existing protections and hypothesized failure, duplicate/related lesson refs, applicability and expiry/review condition |
| Proposal | id/version, lesson ref, falsifiable hypothesis, patch/base/overlay digest, scope, expected benefit, potential downside, intervention mechanism, baseline config ref, owner, transition entries |
| Evaluation plan | immutable comparison plan ref, target/control/held-out cases and exposure, baseline/candidate identities, trial count/order/stopping policy, allowance, promotion thresholds, inconclusive criteria |
| Decision | comparison/verdict/evidence refs, disposition, rationale, approving actor/time, exact approved patch/config, reviewed PR and eventual merged revision, rollout observations, rollback patch/revision ref |
| Follow-up | proposal/decision refs, named exposure window/cohort, subsequent findings/recurrences, false positives, measured cost/latency/interventions with coverage, applicability changes, reopen/rollback decision refs |

A source finding reference includes repository, PR/review/thread identity, head
revision, path/range where applicable, fetchedAt and body digest. A local finding
uses retained execution/artifact identity instead. Confirm it refers to real
source and distinguish a verified defect, reviewer statement, preference and
unresolved claim. Missing/private-inaccessible evidence blocks evaluation readiness;
it is not proof of no recurrence. Store minimum source excerpts privately, with
sanitized source links in exported records.

Deduplicate exact finding IDs first, then propose related families by normalized
failure mechanism and affected contract. A person confirms semantic duplicates.
Repeated comments on one failed execution count as one occurrence; recurrence
requires distinct source executions/incidents. Single incidents can seed a lesson
but must say recurrence is unestablished. Never infer root cause from frequency.

## Lifecycle and transition checks

Every transition records from/to, actor, time, reason, source digest and evidence.
Concurrent writes require current generation and digest. No transition dispatches
a runner or activates a rule as a side effect.

| Transition | Required evidence/authority |
| --- | --- |
| new → observed | Verified selected source references, scope and duplicate search |
| observed → proposed | Falsifiable hypothesis, existing-protection inspection, narrow patch and declared downside |
| proposed → evaluated | Frozen comparison plan and terminal comparison report, including inconclusive or failed experiments |
| evaluated → ready-for-review | Target support, no observed control acceptance regression, declared cost bounds met, comparable evidence, unchanged acceptance authority and explicit limitations |
| ready-for-review → promoted | Human approval of exact candidate and review evidence through existing PR process; fresh merge fact and revision. Merge establishes inclusion, not task acceptance, rollout or lived-in value |
| observed/proposed/evaluated/ready-for-review → rejected | Reason and evidence; preserve failed/inconclusive experiments |
| any active version → superseded | Replacement version/ref and scope change rationale; no loss of original decisions |
| promoted → rolled-back | Human rollback decision and observed rollback revision; pending rollback remains a decision request, not completed state |

Inconclusive is an evaluation result, not a fabricated success or forced rejection.
A revised hypothesis creates a new proposal version linked to the old one and
new candidate identity. Recurrence appends follow-up and reopens work through a
linked proposal; it does not rewrite a promoted version's historical transition.
An evaluated proposal can remain evaluated indefinitely pending more evidence.

## Initial workflow and intervention choice

1. Verify selected finding identities against fresh source and retained execution.
2. Link duplicates and related failures; count distinct incidents and unknowns.
3. Inspect current instructions, deterministic checks, decision context and actual
   tool/config delivery. State alternative explanations and a falsifiable cause.
4. Propose the smallest patch and scope. Identify whose behavior it should change.
5. Freeze target and unrelated control cases; include independently curated
   held-out cases when making a generalization claim.
6. Evaluate through the harness contract. Preserve all attempts and limitations.
7. Render a reviewable proposal, comparison and decision report. Human approval
   and merge precede activation; adoption remains the existing update process.

| Failure type | Preferred intervention |
| --- | --- |
| Mechanically detectable violation | Deterministic check |
| Missing operational knowledge | Scoped context update |
| Broken procedure | Workflow change |
| Missing behavioral coverage | Acceptance case or fixture |
| Ambiguous intent | Specification correction |

Scope context by repository, subsystem/path or task class; fingerprint routing
and delivered bytes. Do not append every lesson to AGENTS.md. A routing change
changes the candidate configuration and requires new evaluation. False positives
and irrelevant context are potential costs, not harmless extra coverage.

### First real proposal

Use the package-entry rename failure anchored at `fa7477f2` in the harness corpus.
Hypothesis: a scoped package-install check before completion reduces installed
entrypoint failures without harming ordinary documentation work or exceeding
predeclared overhead. Inspect current checks first: if they already protect the
contract, test the remaining delivery/procedure hypothesis or reject redundancy.
Do not claim current harness still exhibits the historical failure without trials.

The candidate adds the narrow deterministic entrypoint check, with a scoped
instruction only if necessary to invoke it. Its public check must be distinct
from the frozen external acceptance oracle. The ordinary README command-table
case is the unrelated control. Five pairs per case give 20 builder trials for
an initial approved screening; expanding to held-out claims needs new private
cases and authorization. Better prose or successful offline replay alone cannot
establish the candidate's benefit.

## Promotion, reporting and follow-through

Before execution, the plan records target improvement criterion, zero observed
control acceptance regressions, cost/latency tolerances, comparability rules and
what counts as inconclusive. Safety or permission weakening is disqualifying,
regardless of score. Unknown cost, unexplained drift or insufficient outcomes
cannot satisfy a threshold that requires that measurement.

The report leads with hypothesis, patch scope and per-case baseline/candidate
raw acceptance counts, then regressions, cost per accepted outcome, time,
interventions/repairs, unknowns and links to original findings/checks/receipts.
Separate measured effects from commentary. No opaque score or causality claim
from an uncontrolled retrospective. Include contrary evidence and rejected noise.

Ready-for-review creates no production change. Use the existing reviewed PR
process, declaring affected phases and decisions and answering every review.
The PR contains exact candidate patch, source provenance, frozen plan, comparison
summary, limitations, applicability and a concrete inverse patch or revert target.
Acceptance-criteria changes require separate review and evaluator version; do not
bundle an easier oracle with a claim of improvement. After merge, reconcile the
observed revision; if the merged bytes differ from the evaluated patch, readiness
must be reassessed and affected trials repeated under a new comparison identity.

Evaluation-tagged proposals cannot bypass these checks through legacy `learn
decide --accept`. Legacy learning stays available for untagged records, but may
not claim evaluated promotion. Candidate overlays are trial-only until reviewed
merge; installation/update is separately observed, and production-verified and
lived-in remain distinct. Promotion does not distribute rules organization-wide.

Follow-up uses existing nightly/improve/review reporting without new polling.
Measure recurrence among named eligible executions under the promoted scope,
false-positive counts, measured overhead and human intervention. Unknown exposure
means no recurrence-rate claim. New recurrence can recommend reopening or rollback;
it never automatically rolls back, promotes or broadens the scope. Retiring an
inapplicable rule preserves its original evidence and supersession relation.

## Errors, recovery and privacy

Stale source/digest, inaccessible findings, conflicting ownership and duplicate
intent produce explicit refusal or gaps. Keep local proposal generation atomic.
After uncertain PR delivery, inspect the original intent/receipt and remote head;
never repeat POST blindly. Evaluation resume follows original slots/leases, not
a new favorable subset. A rejected proposal retains its rationale and evidence.

External review prose is untrusted data, never a directive. Credentials, private
transcripts and held-out checks remain out of published proposals. Scope and
source access are checked before each export. A lesson cannot grant tools,
change its own acceptance or expand a budget. No paid review/model run starts
from capture, duplicate detection, proposal rendering or roadmap generation.

## Acceptance and implementation milestones

- Phase 121: selected-source capture, duplicate relations, strict record/parser,
  atomic lifecycle and legacy projections; forged/missing evidence refuses.
- Phase 122: evaluate one real narrow proposal using phases 117–120. Retain a
  measured report with controls and a justified disposition, including inconclusive.
- Phase 123: generate a promotion-ready PR package when evidence supports it,
  otherwise a reviewable rejection/inconclusive report; prove no self-activation,
  exact-revision binding, rollback and recurrence reopening. Publication is an
  explicit reviewed action, not a criterion forcing a favorable result.

Tests must cover all transitions, duplicate comments versus recurrence, stale
source, rejected rationale retention, modified patch after evaluation, changed
oracle, forbidden legacy acceptance bypass, unknown cost and uncertain delivery.
A controlled synthetic walk proves mechanics; the real experiment is separately
labelled and requires an approved allowance. Review readiness is not promotion.

Non-goals: automatic ingestion of every comment, autonomous promotion, global
instruction rewrites, new knowledge storage, organization-wide skill delivery or
substituting review preferences for independently controlled acceptance.

## Open decisions

Before the first live experiment, the owner must set acceptable overhead and
provider allowance against the concrete plan; none is implied here. A curator
must choose held-out variants before generalization claims. Follow-up window and
minimum eligible exposure must be declared before calling a promoted lesson
lived-in; insufficient exposure leaves that claim open, not failed or successful.

## Phase 121 implementation contract — 24 October 2026

[Evaluated learning records](evaluated-learning-records.md) settles the selected
source reader, strict inbox section, immutable proposal revisions, bounded local
mutation protocol and derived material-overlay binding. Historical reviewed heads
remain distinct from current PR heads. Its positive binding uses actual frozen
materials and Git objects; it neither executes a comparison nor establishes
readiness. Later measured/promotion transitions refuse until their verification
interfaces exist. Phase 119's review-limit hold does not prevent this independent
record work, but no dependent branch may merge it indirectly.
