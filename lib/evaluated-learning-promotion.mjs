// Local promotion bridge. Provider observations never publish or install changes.
import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {check,ref,same} from './evaluated-lessons.mjs';
import {fingerprint,byteDigest} from './evaluation-records.mjs';
import {evaluationBytes} from './evaluation-ledger.mjs';
import {buildLearningPackage,artifactFor,packageStates} from './evaluated-learning-package.mjs';
import {verifyLearningMerge} from './learning-approval-github.mjs';
import {ghJson} from './review.mjs';
import {repairShape,validateRepairObservation} from './evaluated-learning-promotion-records.mjs';
import {parsePhase} from '../practices/phases/files/scripts/roadmap.mjs';
const resolve=(history,rr)=>{const r=history.records.find(x=>same(ref(x),rr));check(r,'unresolved_promotion_ref');return r;};
// Stable work-link identity is distinct from mutable planning observations.
export async function repairIdentity(options,r){return (await readRepairObservation(options,r)).identityDigest;}
export async function readRepairObservation(options,r,expectedIdentityDigest=null){
  repairShape(r);const deadline=options.deadline??Date.now()+30000;check(deadline>Date.now(),'repair_read_deadline');
  let identity,state,source;
  if(r.kind==='phase'){
    check(options.cfg?.phases?.source!=='milestones','repair_local_phase_unavailable');
    const names=await readdir(join(options.root,'docs/phases'));check(names.length<=2000,'repair_inventory_bound');
    const matches=names.filter(n=>new RegExp('^'+r.ref+'-[a-z0-9-]+\\.md$').test(n));check(matches.length===1,'repair_phase_missing_or_ambiguous');
    const path='docs/phases/'+matches[0],bytes=await evaluationBytes(join(options.root,path),262144),parsed=parsePhase(matches[0],bytes.toString());
    check(!parsed.problems?.length,'invalid_repair_phase');identity={issueId:null,path};state=parsed.status;source={bytes:byteDigest(bytes),state};
  }else{
    const [repository,number]=r.ref.split('#');check(repository===options.repository,'repair_repository_mismatch');
    const result=await ghJson(options.env??process.env,['api','--hostname','github.com',`repos/${repository}/issues/${number}`],'repair issue',{timeout:Math.max(1,Math.min(10000,deadline-Date.now())),maxBuffer:262144});
    check(!result.pull_request&&result.number===Number(number)&&Number.isSafeInteger(result.id)&&result.id>0&&['open','closed'].includes(result.state)&&result.html_url===`https://github.com/${repository}/issues/${number}`&&(result.body===null||typeof result.body==='string'),'repair_issue_unavailable');
    const updatedAt=result.updated_at??null;check(updatedAt===null||typeof updatedAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(updatedAt)&&Number.isFinite(Date.parse(updatedAt)),'invalid_repair_updated_at');
    identity={issueId:result.id,path:null};state=result.state;source={bodyDigest:fingerprint(result.body),state,updatedAt};
  }
  check(deadline>Date.now(),'repair_read_deadline');
  const stable={kind:r.kind,repository:options.repository,ref:r.ref,identity},identityDigest=fingerprint(stable);
  const observation={...stable,identityDigest,state,sourceDigest:fingerprint({identityDigest,...source})};validateRepairObservation(observation);
  check(expectedIdentityDigest===null||expectedIdentityDigest===identityDigest,'repair_identity_changed');return observation;
}
export async function prepareLearningPromotion(options,request,history,proposal,state){
  const p=request.payload;check(same(p.proposalRef,ref(proposal)),'stale_promotion_subject');
  const built=await buildLearningPackage(options,history,proposal),pack=built.public;
  if(request.action==='record-package'){
    check(packageStates.includes(state)&&same(p.evaluationRef,ref(built.evaluation)),'invalid_package_subject');check(!history.records.some(r=>r.kind==='learning-review-package'&&r.data.payloadDigest===pack.payloadDigest),'package_already_recorded');
    return {kind:'learning-review-package',data:{proposalRef:p.proposalRef,evaluationRef:p.evaluationRef,payloadDigest:pack.payloadDigest,artifact:pack.artifact,readiness:pack.readiness,verificationDigest:built.verificationDigest},to:state};
  }
  if(request.action==='ready'){
    const r=resolve(history,p.packageRef);check(state==='evaluated'&&r.kind==='learning-review-package'&&same(r.data.proposalRef,p.proposalRef)&&r.data.payloadDigest===pack.payloadDigest,'readiness_package_changed');check(pack.readiness.eligible,'readiness_unavailable:'+pack.readiness.gaps.join(','));
    return {kind:'learning-readiness',data:{proposalRef:p.proposalRef,packageRef:p.packageRef,evaluationRef:ref(built.evaluation),verificationDigest:built.verificationDigest},to:'ready-for-review'};
  }
  if(request.action==='promote'){
    const ready=resolve(history,p.readinessRef);check(state==='ready-for-review'&&ready.kind==='learning-readiness'&&same(ready.data.proposalRef,p.proposalRef),'invalid_promotion_subject');const r=resolve(history,ready.data.packageRef);check(r.data.payloadDigest===pack.payloadDigest&&pack.readiness.eligible,'current_readiness_unavailable');check(p.repo===options.repository,'promotion_repository_mismatch');
    const observation=await verifyLearningMerge({schemaVersion:1,repo:p.repo,prNumber:p.prNumber,reviewId:p.reviewId,action:'promote',payloadDigest:pack.payloadDigest,baseRevision:pack.payload.baseRevision,artifact:{path:pack.artifact.path,byteDigest:pack.artifact.byteDigest,bytes:pack.publicJson},changes:built.changes},{env:options.env,deadline:options.deadline??Date.now()+30000});return {kind:'learning-promotion',data:{proposalRef:p.proposalRef,readinessRef:p.readinessRef,observation},to:'promoted'};
  }
  if(request.action==='request-rollback'){
    const promoted=resolve(history,p.promotionRef);check(state==='promoted'&&promoted.kind==='learning-promotion'&&same(promoted.data.proposalRef,p.proposalRef)&&pack.payload.inverse.available,'invalid_rollback_subject');const ready=resolve(history,promoted.data.readinessRef),original=resolve(history,ready.data.packageRef);check(original.data.payloadDigest===pack.payloadDigest,'rollback_original_package_changed');
    const repairObservation=await readRepairObservation(options,p.repairRef),repairDigest=repairObservation.identityDigest,payload={schemaVersion:1,kind:'learning-inverse-package',originalPackageDigest:pack.payloadDigest,promotionRef:p.promotionRef,baseRevision:promoted.data.observation.merge.mergeSha,repairRef:p.repairRef,changes:built.changes.map(c=>({path:c.path,beforeDigest:c.after.byteDigest,afterDigest:c.before?.byteDigest??null}))},artifact=artifactFor(payload);
    return {kind:'learning-rollback-request',data:{proposalRef:p.proposalRef,promotionRef:p.promotionRef,repairRef:p.repairRef,repairDigest,repairObservation,payload,payloadDigest:artifact.payloadDigest,artifact:artifact.artifact},to:state};
  }
  if(request.action==='observe-rollback'){
    const r=resolve(history,p.rollbackRequestRef);check(state==='promoted'&&r.kind==='learning-rollback-request'&&same(r.data.proposalRef,p.proposalRef)&&r.data.payload.originalPackageDigest===pack.payloadDigest&&p.repo===options.repository,'invalid_rollback_observation');const repairObservation=await readRepairObservation(options,r.data.repairRef,r.data.repairDigest);const artifact=artifactFor(r.data.payload);
    const observation=await verifyLearningMerge({schemaVersion:1,repo:p.repo,prNumber:p.prNumber,reviewId:p.reviewId,action:'rollback',payloadDigest:artifact.payloadDigest,baseRevision:r.data.payload.baseRevision,artifact:{path:artifact.artifact.path,byteDigest:artifact.artifact.byteDigest,bytes:artifact.publicJson},changes:built.changes.map(c=>({path:c.path,before:c.after,after:c.before}))},{env:options.env,deadline:options.deadline??Date.now()+30000});return {kind:'learning-rollback',data:{proposalRef:p.proposalRef,rollbackRequestRef:p.rollbackRequestRef,observation,repairObservation},to:'rolled-back'};
  }
  check(false,'unsupported_promotion_action');
}

// Recovery validates original retained evidence, without reinterpreting old report
// bytes under the current reporter or claiming that a historical review is current.
export async function verifyAppliedPromotion(options,file,request){
  if(!['record-package','ready','promote','request-rollback','observe-rollback','follow-up'].includes(request.action))return;
  const history=file.evaluation,event=history.events.find(e=>e.operationId===request.operationId);check(event,'missing_original_operation');
  const subject=resolve(history,event.subjectRef),evaluation=history.records.find(r=>r.kind==='learning-evaluation'&&same(r.data.proposalRef,ref(subject)));check(evaluation,'missing_original_evaluation');
  const {verifyRetainedEvaluation}=await import('./evaluated-learning-screening.mjs');await verifyRetainedEvaluation(options,history,evaluation);
  if(['promote','observe-rollback'].includes(request.action)){
    // No current route can establish readiness yet. Never turn a retained claim
    // into recovered current authorization while that implementation is absent.
    check(false,'current_promotion_verification_unavailable');
  }
}
