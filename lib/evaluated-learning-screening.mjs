import { usage } from './evaluation-execution.mjs';
import { readEvaluationForScreening } from './evaluation-ledger.mjs';
// Lifecycle bridge: retained proposal authority plus a fresh verified snapshot.
import { bindLearningPlan, nativeRef } from './evaluated-learning-binding.mjs';
import { comparisonSnapshot, screeningReport, inspectReports, validateReportReceipt } from './evaluation-screening.mjs';
import { screenComparison, screenComparisonV1 } from './lesson-screening-criteria.mjs';
import { fingerprint } from './evaluation-records.mjs';
import { check, ref, same } from './evaluated-lessons.mjs';
export async function prepareLearningScreening(options, request, requestDigest, history, proposal) {
  const p=request.payload, resolve=r=>{const found=history.records.find(v=>same(ref(v),r));check(found,'unresolved_screening_ref');return found;};
  const registration=request.action==='evaluate'?resolve(p.evaluationPlanRef):null;
  if(registration)check(registration.kind==='learning-evaluation-plan'&&same(registration.data.proposalRef,ref(proposal)),'screening_wrong_proposal');
  const link=resolve(registration?.data.planLinkRef??p.planLinkRef);check(link.kind==='learning-plan-link'&&same(link.data.proposalRef,ref(proposal)),'screening_wrong_plan');
  const d=link.data, experiment=d.comparisonRef.id;
  const bound=await bindLearningPlan(options,{proposalRef:ref(proposal),experimentId:experiment,expectedPlanDigest:d.planDigest,targetCaseIds:d.targetCaseIds,controlCaseIds:d.controlCaseIds,heldOutCaseIds:d.heldOutCaseIds},proposal);
  check(same(bound,d),'screening_binding_changed');
  const snapshot=await comparisonSnapshot({...options,experiment,repository:options.root}),comparison=snapshot.plan.bundle.comparison,criteria=comparison.promotion.criteria;
  check(same(nativeRef(comparison),d.comparisonRef),'screening_comparison_changed');
  if(criteria)check(same([...criteria.targetCaseIds].sort(),[...d.targetCaseIds].sort())&&same([...criteria.controlCaseIds].sort(),[...d.controlCaseIds].sort()),'screening_groups_changed');
  if(!registration){
    check(!history.records.some(r=>r.kind==='learning-evaluation-plan'&&same(r.data.proposalRef,ref(proposal))),'screening_already_registered');
    check(criteria===null||snapshot.execution===null,'screening_registration_after_execution');
    return {kind:'learning-evaluation-plan',data:{proposalRef:ref(proposal),planLinkRef:ref(link),comparisonRef:d.comparisonRef,planDigest:d.planDigest,criteriaDigest:fingerprint(criteria),method:'paired-screening-v1'},identity:{ledgerDigest:snapshot.ledgerDigest,executionDigest:snapshot.executionDigest,reporterIdentity:snapshot.reporterIdentity}};
  }
  check(registration.data.criteriaDigest===fingerprint(criteria)&&registration.data.planDigest===snapshot.plan.digest&&same(registration.data.comparisonRef,d.comparisonRef),'screening_registration_changed');
  check(!history.records.some(r=>r.kind==='learning-evaluation'&&same(r.data.proposalRef,ref(proposal))),'screening_already_evaluated');
  // The held phase119 cancellation gap cannot establish safe closed admission.
  check(snapshot.execution&&!snapshot.execution.cancellation&&snapshot.report.slots.every(s=>s.status==='completed')&&snapshot.report.attempts.every(a=>a.terminal),'screening_requires_terminal_slots');
  const retained=await inspectReports(snapshot.plan.destination,snapshot.ledger);
  for(const r of retained)if(!(options.retainedReportRefs??[]).some(rr=>same(rr,nativeRef(r))))check(r.operationId===request.operationId&&r.requestDigest===requestDigest,'unlinked_original_report_requires_original_operation');
  const result=screenComparison(criteria,snapshot.report),report=screeningReport(snapshot,request,requestDigest);
  validateReportReceipt(report,snapshot.ledger);
  const original=retained.find(r=>r.operationId===request.operationId);if(original)check(same(original,report),'original_report_conflicts');
  else {const used=await usage(snapshot.plan.destination),policy=comparison.retention;check(retained.length<16&&used.bytes+Buffer.byteLength(JSON.stringify(report)+'\n')<=policy.maxBytes&&used.count+1<=policy.maxEvents,'screening_report_retention_exhausted');}
  const attemptRefs=snapshot.report.attempts.map(a=>({slot:a.slot,attemptId:a.attemptId,attempt:a.attempt,parentAttemptId:a.parentAttemptId,evidence:a.evidence}));
  return {kind:'learning-evaluation',data:{proposalRef:ref(proposal),evaluationPlanRef:ref(registration),reportRef:nativeRef(report),ledgerDigest:snapshot.ledgerDigest,executionDigest:snapshot.executionDigest,reportDigest:snapshot.reportDigest,reporterIdentity:snapshot.reporterIdentity,...result,attemptRefs},identity:{reportRef:nativeRef(report)},snapshot,report};
}

export async function verifyAppliedScreening(options, file, request, requestDigest) {
  if(request.action!=='evaluate')return;
  const event=file.evaluation.events.find(e=>e.operationId===request.operationId),record=file.evaluation.records.find(r=>same(ref(r),event.recordRefs[0]));
  check(record?.kind==='learning-evaluation','missing_original_evaluation');
  return verifyRetainedEvaluation(options,file.evaluation,record,{operationId:request.operationId,requestDigest});
}
export async function verifyRetainedEvaluation(options, history, record, original=null) {
  const event=history.events.find(e=>e.recordRefs.some(r=>same(r,ref(record))));
  check(event?.action==='evaluate','missing_original_evaluation_event');
  original??={operationId:event.operationId,requestDigest:event.requestDigest};
  const registration=history.records.find(r=>same(ref(r),record.data.evaluationPlanRef));check(registration,'missing_original_registration');
  const observed=await readEvaluationForScreening({...options,experiment:registration.data.comparisonRef.id});
  check(observed.receipt.plan.digest===registration.data.planDigest,'original_plan_changed');
  const reports=await inspectReports(observed.receipt.plan.destination,observed.receipt),report=reports.find(r=>same(nativeRef(r),record.data.reportRef));
  check(report&&report.operationId===original.operationId&&report.requestDigest===original.requestDigest&&report.ledgerDigest===record.data.ledgerDigest&&report.executionDigest===record.data.executionDigest&&report.reportDigest===record.data.reportDigest&&same(report.reporterIdentity,record.data.reporterIdentity),'original_report_missing_or_changed');
  check(registration.data.criteriaDigest===fingerprint(observed.receipt.plan.bundle.comparison.promotion.criteria),'original_criteria_changed');
  const expected=screenComparisonV1(observed.receipt.plan.bundle.comparison.promotion.criteria,report.report);
  check(same(expected,Object.fromEntries(['method','disposition','caseResults','reasons','limitations'].map(k=>[k,record.data[k]]))),'original_screening_projection_changed');
  check(same(record.data.attemptRefs,report.report.attempts.map(a=>({slot:a.slot,attemptId:a.attemptId,attempt:a.attempt,parentAttemptId:a.parentAttemptId,evidence:a.evidence}))),'original_attempt_refs_changed');
  return {report,registration,plan:observed.receipt.plan};
}
