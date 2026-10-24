# Lesson screening — phase 122 contract, 24 October 2026

Settled implementation contract extending [evaluated learning records](evaluated-learning-records.md)
and [review learning](review-learning-evaluation.md). Code and evidence remain
separate from this specification. No paid trial or provider activation is approved.

## Existing authority and limits

- `lib/evaluation-ledger.mjs::evaluations({action:'inspect',experiment,manifest,state,appRoot})`
  returns `{receipt,execution}`; `receipt.plan` is frozen, attachment-checked authority.
- `evaluations({action:'compare',...})` delegates to `comparisonOperation` and returns
  `{action,preview:false,report,markdown}`. It recomputes a report; no durable report receipt exists.
- `lib/evaluation-comparison-report.mjs::summarizeComparison(plan,execution)` returns
  schemaVersion1, comparisonId/planDigest, cases/arms/pairs/slots/attempts/unplannedAttempts,
  issues, screening, candidate identities and limitations. Recommendation is ALWAYS inconclusive,
  automaticPromotion=false, agentEfficacy=false. It is not a phase-122 decision verifier.
- `inspectExecutions` validates original receipts and exposes retained `history`/`recovery`.
  `orderedSlots` defines frozen AB/BA order. Replacements are zero; no favorable retry selection.
- `lib/evaluated-learning-binding.mjs::{inspectLearningPlan,bindLearningPlan}` already verify
  candidate patch/material/configuration/case bindings; plan links are not measured results.
- `lib/evaluated-lessons.mjs::{validateRequest,validateHistory,replay}` currently permit only
  observed/proposed/rejected/superseded. `evaluatedLearning` refuses later interfaces.
- Reuse `withLearningWriter`, `publishInbox`, operationId/requestDigest recovery, preview digest,
  source verification and decisionTarget. Keep records in the existing inbox Evaluation section.
- Schema2 `comparison.promotion.criteria` currently MUST be null. Execution input requires
  offline + scripted-node-v1, no network/prerequisites, and null currency entitlement.
  Phase119 explicitly records a missing live adapter/spending gateway, not merely an owner walk.

## Phase 122: smallest useful extension

1. Add a strictly typed, versioned criteria object as an alternative to null in the existing
   frozen comparison record. Keep automatic=false, replacements=0 and all-planned-or-safety.
   Old null plans remain readable and inconclusive; never retrofit criteria after observing runs.
2. Exact `promotion.criteria` fields:
   `{schemaVersion:1,targetCaseIds,controlCaseIds,minimumComparablePairsPerCase,
     minimumTargetNetGains,maxControlRegressions,maxAdditionalCurrencyUsd,
     maxAdditionalMedianWallMs,comparability,missingEvidence}`.
   Require disjoint complete selected case groups, minimumPairs>=5, targetNetGains>=1,
   maxControlRegressions=0, finite nonnegative currency/latency tolerances,
   comparability='actual-identity-v1', missingEvidence='inconclusive'.
   Net gain = baseline-fail/candidate-pass minus baseline-pass/candidate-fail, PER target case.
   Currency tolerance = candidate all-attempt total minus baseline all-attempt total, PER case;
   latency tolerance = candidate minus baseline median per-attempt wallMs, PER case.
   Require complete cost AND wallMs coverage for these tests. No invented default tolerances:
   the author declares them before freeze; live authorization remains a separate owner action.
3. Append `learning-evaluation-plan` using the existing sealed version1 record envelope:
   `data:{proposalRef,planLinkRef,comparisonRef,planDigest,criteriaDigest,method}`;
   method='paired-screening-v1'; criteriaDigest hashes the actual frozen criteria (including null).
   Resolve native refs from the authorized ledger, verify the active proposal and re-run binding.
   For nonnull criteria require no prior execution/reservation at registration; frozen criteria
   remain execution authority even if local lesson registration subsequently races admission.
   A previously executed null plan may be imported only as retrospective/inconclusive.
   New criteria/changed case groups require a NEW frozen comparison and appended plan record.
4. Add one typed `evaluate` action to existing `learn evaluate decide --input`:
   payload `{proposalRef,evaluationPlanRef}` plus the existing request envelope/workspace options.
   It accepts locators/refs only: no caller report, metrics, disposition or `verified:true`.
   Preview/apply recompute observations; changed source/snapshot invalidates approval.
5. Extract a narrow verified comparison snapshot API inside the existing ledger/comparison lane:
   `{plan,ledgerDigest,execution,executionDigest,report,reportDigest,reporterIdentity}`.
   Preview is read-only: never acquire/create a writer lock, mutex, directory or receipt.
   Read bounded writer-state observations and complete validated receipt inventories before/after
   report derivation; require equal inventories and known inactive writer state throughout those
   observations. Active, changed, recoverable/uncertain or unreadable ownership refuses.
   Existing comparisonOperation inspects then observes the lock ONCE; it supplies no stronger
   guarantee. This extension detects observed changes, not an atomic snapshot against all writers
   or transient ABA changes. Recheck on apply; never stitch unrelated inspect/compare results.
   Hash the sorted validated receipt inventory, including original and reconciliation records,
   cancellation/reservation and missing planned slots. Keep private paths/bodies internal.
   Identify reporter/verifier version and source-byte digest; hash canonical report JSON, not Markdown.
   This is an extraction/reuse gap, not a new experiment store or a scheduler.
   Retain canonical report bytes in `<experiment>/reports/<record-digest>.json`, a bounded immutable
   schema2 `evaluation-report` record: header plus `{operationId,requestDigest,planDigest,
   ledgerDigest,executionDigest,reporterIdentity,receiptInventory,report,reportDigest}`.
   `report` is the exact canonical JSON value hashed by reportDigest; retain it, not just its hash.
   Receipt inventory is sorted relative evidence names + byte/record hashes and missing-slot markers;
   exclude reports themselves from executionDigest. Do not expose private inventory in public output.
   Timestamp is stable request attribution; reporter changes create new records, never rewrite old ones.
   Explicit `--yes --digest` approval binds BOTH report bytes and inbox change. Preview writes nothing.
   On approved apply, use existing writer serialization/publication primitives; recheck evidence,
   publish/recover the same report, then append its ref to the inbox. These two writes are not atomic:
   interruption may leave an unlinked report; recover by operationId/requestDigest and exact bytes.
   Missing/corrupt/conflicting original publication refuses; never allocate a replacement operation.
   Extend readFrozen's root allowlist explicitly for optional `reports/` and validate its contents:
   regular unlinked private digest-named files only, sealed/bound records, <=16 reports, <=1 MiB each,
   within the ORIGINAL frozen byte/event ceiling. Unknown entries refuse. inspectExecutions' execution
   subdirectory allowlist stays unchanged; reports are siblings, not foreign trial/control files.
   Retained reports remain readable with their version after algorithm changes; new decisions require
   the current verifier or an explicit supported historical verifier, not silently recomputed bytes.
6. Append `learning-evaluation`:
   `data:{proposalRef,evaluationPlanRef,reportRef,ledgerDigest,executionDigest,reportDigest,
     reporterIdentity,method,caseResults,attemptRefs,disposition,reasons,limitations}`.
   method='paired-screening-v1'; disposition='supported'|'rejected'|'inconclusive'.
   `caseResults` retains bounded raw numerators/denominators, discordance, resource coverage,
   cost subtotals/totals, per-case criteria observations and pass/fail/unknown results.
   `attemptRefs` contains slot, attempt/parent identity and every validated evidence digest,
   including failure and recovery evidence. It is never a selected list supplied by the caller.
   Store this compact public projection in the inbox; retain raw evidence in the same experiment.
   Define strict nested field schemas during implementation; reject overflow, never truncate.

## Outcome, accounting and lifecycle rules

- `proposed -> evaluated` means a verified terminal screening was recorded, including failed or
  inconclusive screening. Inconclusive is a disposition, not a new lifecycle state.
  `evaluated` keeps legacy status proposed. Recording rejected evidence does not silently execute
  the separate human reject transition. No phase122 promotion/readiness action.
- A normal report must cover every planned slot. Unsettled/missing work remains proposed with
  diagnostics. A cancelled comparison can be evaluated/inconclusive only if admission is closed
  and every existing operation is independently settled; missing slots remain explicit.
  If current interfaces cannot establish those facts, refuse; do not repair phase119 cancellation
  under this phase or infer death from absence. The owner hold remains independently binding.
- Per-case paired quality uses only comparable known paired outcomes; raw counts keep ALL planned
  slots and every attempt. Preserve invalid/missing/unknown and operational failures separately.
  Extra/unplanned attempts make support unavailable; do not drop them from resource denominators.
- Compare actual controller fingerprints, image requested/id/platform and environment, task/source,
  acceptance material and resolved model identities. Configuration aliases alone prove nothing.
  Compare candidate delivery to the phase121 material binding; only the intended overlay differs.
- Require >=5 comparable pairs for EACH target and EACH control, the preregistered target net gain,
  no comparable control regression and complete required resource bounds. Preserve every contrary
  observation. Partial evidence cannot establish support; proven safety/oracle weakening refuses
  binding, never converts into a favorable score. A verified observed control regression supports
  rejection even if other measurements are unavailable; retain those unavailable measurements.
- Known currency subtotal is not total. Total and cost/accepted require complete all-attempt cost
  coverage including failures; cost/accepted additionally requires positive accepted count.
  Zero accepted yields null, never infinity/zero. Resource distributions retain raw values/coverage.
- Initial interventions=[] or repairRounds=0 are recorded declarations, not actual zero external
  assistance. Actual human-help coverage stays unknown unless a real observation interface exists.
- Offline scripted evidence may reach evaluated/inconclusive (machinery only), never supported
  agent efficacy. Null criteria, unresolved aliases, unknown required costs, drift, inadequate
  pairs cannot become positive claims through a supplied report. Zero held-out inventory limits
  generalization; it ALONE does not bar supported results for the declared development cases.
- Phase121 rejects held-out cases; preserve development-only exposure until actual private case
  inventory and delivery/verification support exist. Five pairs are screening, not statistical proof.

## Focused implementation proof and live boundary

- Actual frozen-ledger tests: 20 mixed target/control slots; gain and control regression;
  omitted/missing/unplanned attempts; failed attempts with unknown cost; zero accepted; drift;
  malformed evidence; altered patch/oracle; recovery retaining original failures; changed snapshot
  between preview/apply; criteria mutation/post-run registration; duplicate operation recovery;
  read-only previews; report publication interruption/retention bounds; old report bytes after upgrade.
  Test zero held-out permits otherwise-qualified scoped development support; offline efficacy does not.
- Test a terminal offline import records evaluated/inconclusive with no efficacy; positive pure
  criteria arithmetic is synthetic mechanics only and must not be advertised as live efficacy.
- Add lifecycle/projection/help/privacy/bounds tests and preserve legacy acceptance guards.
- Necessary before a REAL walk: isolation-capable provider adapter, enforced minute/currency
  gateway, actual model/delivery/resource receipts and uncertain-operation recovery. Existing
  inspect/report cannot manufacture these. This is code/activation work, not just permission.
- Then the owner approves the exact provider, comparison quote, capped allowance and scope.
  The requested package-entry target + ordinary documentation control need five pairs each.
  Retain actual invocations/receipts. Without adapter plus approval, report offline proof and keep
  real phase122 acceptance open. No paid calls or automatic activation from learning operations.


## Registration, delivery and recovery clarifications

`learn evaluate plan` adds request action `register-screening` with exact payload
`{proposalRef,planLinkRef}`. Resolve the experiment from the retained native
comparison reference; workspace locators remain existing CLI options. Append one
`learning-evaluation-plan` per active proposal version, proposed → proposed.
Criteria groups must equal the verified plan link. Registration grants no execution.
`learn evaluate decide` adds action `evaluate` with exact payload
`{proposalRef,evaluationPlanRef}` and transition proposed → evaluated. Derive all
results from original authority, never supplied report JSON.

Initial same-version re-registration or re-evaluation refuses. Further work uses
an explicit new proposal version: extend `revise` to evaluated → proposed, require
a genuinely changed hypothesis or candidate, preserve supersedes links and prior
plans/reports, and transfer no old result to the replacement. Revised plans remain
new experiments with their own stopping policy; old unfavorable evidence stays
visible. A rejected evaluation disposition does not silently decline its lesson.

Reconstruct the expected complete execution delivery using existing executor
composition rules. Compare it with each retained intent's delivered inventory
and digest. The phase-121 material digest excludes task sources and requirements
and cannot prove actual delivery. No claim of provider execution follows from
matching configuration labels.

Apply uses a fixed inbox → harness lock order. Reading under the controller's own
harness lock uses an internal ownership-verified path, never a caller boolean
that bypasses public inspection's active-writer refusal. Preview stays lock-free
and writes no reports or mutexes. Recover a matching orphan report by its original
operationId/requestDigest and exact sealed bytes before any new allocation.
Revalidate the approved snapshot before appending its inbox reference. Conflicting
or partial report publication refuses; original byte/event ceilings apply.
An empty reports directory left before publication is permitted; it is not proof
of a completed report. Report bytes count toward retention but not executionDigest.

A verified control regression is exposed as failed criteria; missing required
evidence produces inconclusive, and support requires every declared positive
condition. Offline scripted results never establish supported agent efficacy.
Keep artifact regressions and all operational failures visible even when the
overall recommendation remains inconclusive. Zero held-out cases prevents unseen
generalization claims, not an otherwise supported development-cohort claim.

This phase does not fix or bypass phase 119's held cancellation change. If closed
admission and settled operations cannot be established, refuse evaluation of an
incomplete cancelled comparison. The real screening acceptance remains open
until both the provider/spending implementation and exact owner allowance exist.

## Proof and scope

The focused implementation proof is `npm run check:focused -- tests/lesson-screening.test.mjs`;
the conductor runs the full `npm run check` and `npm run typecheck` on the final
tree and a retained public-CLI walk. Tests exercise actual frozen receipts and
negative controls; synthetic arithmetic is labelled machinery, never paid-agent
evidence. Keep the phase partial while its named real screening remains unavailable.
