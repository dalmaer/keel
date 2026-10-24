import { prepareLearningScreening, verifyAppliedScreening } from './evaluated-learning-screening.mjs';
import { publishScreeningReport } from './evaluation-screening.mjs';
// Explicit selected intake and material-plan proposals. No execution or promotion.
import { join } from 'node:path';
import { home, formatProposal, instructionShaped } from './learn.mjs';
import { evaluationBytes, withEvaluationWriter } from './evaluation-ledger.mjs';
import { byteDigest, fingerprint } from './evaluation-records.mjs';
import { decisionContext } from '../practices/reconciliation/files/scripts/plates/decision-context.mjs';
import { check, fail, seal, ref, same, validateRequest, parseLearningJson, evaluationSection, serializeEvaluation, replay } from './evaluated-lessons.mjs';
import { inboxInventory, readInboxFile, withLearningWriter, publishInbox, inboxName, pendingLearningOperations } from './evaluated-learning-io.mjs';
import { deriveCandidate, bindLearningPlan, verifyProtections } from './evaluated-learning-binding.mjs';
const LIM=['local cooperating-writer serialization; arbitrary editors are not kernel-CAS participants','source observations are not atomic with external providers','attribution is not authorization; no execution, promotion or publication'];
const getRef=(inventory,r)=>{const matches=inventory.flatMap(f=>(f.evaluation?.records??[]).filter(v=>same(ref(v),r)).map(record=>({record,file:f.name})));check(matches.length===1,'unresolved_or_ambiguous_learning_ref');return matches[0];};
function selectorOf(r) {
  const s=r.source;
  return r.verification.method==='fresh-review-v1'?{kind:'github-review',repo:s.repo,prNumber:s.prNumber,reviewId:s.reviewId,threadId:s.threadId,commentId:s.commentId,reviewedHead:s.reviewedHead,expectedBodySha256:s.bodySha256}:{kind:'harness-artifact',experimentId:s.experimentId,planDigest:s.planDigest,slot:s.slot,intentDigest:s.intentDigest,artifactDigest:s.artifactDigest,verdictDigest:s.verdictDigest,checkId:s.checkId};
}
const sourceKey=s=>fingerprint(selectorOf(s));
function locate(inventory,slug) {
  check(typeof slug==='string'&&/^(?:\d{4}-\d\d-\d\d-)?[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)&&slug.length<=75,'invalid_inbox_slug');
  const matches=inventory.filter(f=>f.name===slug+'.md'||f.name.slice(11,-3)===slug);check(matches.length<=1,'ambiguous_inbox_slug');return matches[0]??null;
}
function retainedOperation(file,request,requestDigest) {
  const event=file?.evaluation?.events.find(e=>e.operationId===request.operationId);if(!event)return null;
  check(event.requestDigest===requestDigest,'operation_id_conflict');return {action:request.action,preview:false,alreadyApplied:true,operationId:request.operationId,requestDigest,outputDigest:file.digest,generation:replay(file.evaluation).generation,status:replay(file.evaluation).state};
}
async function prepare(options,request,requestDigest,root,cfg,inventory) {
  const current=locate(inventory,options.slug),history=current?.evaluation??null,projection=history?replay(history):{state:null,active:null,generation:0};
  check((current?.digest??null)===request.expected.fileDigest&&projection.generation===request.expected.generation,'stale_learning_input');
  check(current||request.action==='capture','missing_inbox_record');
  const name=current?.name??options.slug+'.md';check(inboxName.test(name),'native_capture_requires_full_date_slug');
  if(!current)check(name.startsWith(request.at.slice(0,10)+'-')&&request.expected.fileDigest===null&&request.expected.generation===0,'native_capture_date_mismatch');
  let prefix=current?(evaluationSection(current.text)?.prefix??current.text):null;
  const value=history?structuredClone(history):{schemaVersion:1,kind:'evaluated-learning',id:'learning-'+fingerprint(name).slice(0,32),records:[],events:[]};
  if(history)check(same(request.decisionTarget,history.events[0].decisionTarget),'decision_target_changed');
  const context=await decisionContext({root,phase:request.decisionTarget.ref});check(context.gaps.length===0,'decision_context_unavailable');
  const sourceRecords=history?.records.filter(r=>r.kind==='learning-source')??[],selected=request.action==='capture'?request.payload.selections:sourceRecords.map(r=>({selector:selectorOf(r),classification:r.classification}));
  const {verifyLearningSources}=await import('./evaluated-learning-sources.mjs');
  const publicText=[prefix??'',JSON.stringify(request.payload)].join('\n');
  const verified=await verifyLearningSources({selections:selected,manifest:options.manifest,state:options.state,appRoot:options.appRoot??root,env:options.env??process.env,publicText});
  check(verified.sources.length>0,'missing_verified_sources');
  if(history){const old=sourceRecords.map(sourceKey).sort(),fresh=verified.sources.map(sourceKey).sort();check(same(old,fresh),'retained_source_changed');}
  const record=(kind,id,version,data)=>seal({schemaVersion:1,kind,id,version,data});
  const added=[],extraIdentities=[],p=request.payload;let subject=projection.active,replacement=null,to=projection.state,candidatePreview=null,duplicateSearchDigest=null,screening=null;
  const append=r=>{added.push(r);return ref(r);};
  const inventoryDigest=fingerprint(inventory.map(f=>({name:f.name,digest:f.digest})));
  const refs=(related,ownName=name)=>{for(const relation of related){const target=getRef(inventory,relation.recordRef);check(target.file!==ownName,'self_relation');if(target.record.kind==='learning-lesson')check(!target.record.data.related.some(x=>history?.records.some(r=>same(ref(r),x.recordRef))),'circular_relation');}};
  if(request.action==='capture') {
    check(!history,'already_captured');check(current?p.inbox===null:p.inbox!==null,'capture_inbox_fields');
    const keys=[...new Set(verified.sources.map(sourceKey))].sort();check(keys.length===verified.sources.length,'duplicate_selected_source');
    for(const file of inventory)if(file.name!==name&&file.evaluation){const existing=file.evaluation.records.filter(r=>r.kind==='learning-source').map(sourceKey).sort();check(!same(keys,existing),'duplicate_selected_source_set:'+file.name);}
    refs(p.lesson.related);await verifyProtections(root,cfg.repo,p.lesson.existingProtections,Date.now()+30000);
    const sourceRefs=verified.sources.map(append),incidents=new Set(verified.sources.map(s=>s.incidentKey).filter(Boolean));
    subject=append(record('learning-lesson','lesson-'+fingerprint(name).slice(0,32),1,{...p.lesson,sourceRefs,recurrence:{distinctVerifiedIncidents:incidents.size,unknownIncidentSources:verified.sources.filter(s=>s.incidentKey===null).length,established:incidents.size>=2,eligibleExposure:null}}));to='observed';duplicateSearchDigest=inventoryDigest;
    if(!current)prefix=formatProposal({meta:{kind:'lesson',status:'untriaged',from:'selected:'+fingerprint(keys),...(instructionShaped(p.inbox.sanitizedClaim)?{flag:'instruction-shaped'}:{})},title:p.inbox.title,claim:p.inbox.sanitizedClaim});
  } else {
    check(history,'not_evaluated');const active=value.records.find(r=>same(ref(r),projection.active));
    const lesson=active.kind==='learning-lesson'?active:value.records.find(r=>same(ref(r),active.data.lessonRef));check(lesson,'missing_lesson');await verifyProtections(root,cfg.repo,lesson.data.existingProtections,Date.now()+30000);refs(lesson.data.related);
    if(request.action==='propose'||request.action==='revise') {
      const proposal=request.action==='revise'?p.proposal:p;
      check(request.action==='propose'?projection.state==='observed':['proposed','evaluated'].includes(projection.state),'invalid_proposal_state');check(same(proposal.lessonRef,ref(lesson)),'proposal_lesson_mismatch');
      if(request.action==='revise')check(same(p.supersedesRef,projection.active),'stale_supersedes_ref');
      const derived=await deriveCandidate({root,repository:cfg.repo,...options,decisionTarget:request.decisionTarget},proposal);candidatePreview=derived.candidatePreview;extraIdentities.push(derived.sourceIdentity);
      const next=record('learning-proposal',request.action==='revise'?active.id:'proposal-'+fingerprint(name).slice(0,32),request.action==='revise'?active.version+1:1,{lessonRef:proposal.lessonRef,hypothesis:proposal.hypothesis,candidate:derived.candidate,expectedBenefit:proposal.expectedBenefit,downside:proposal.downside,mechanism:proposal.mechanism,owner:proposal.owner,baselineRef:derived.baselineRef,supersedesRef:request.action==='revise'?projection.active:null});
      if(projection.state==='evaluated')check(next.data.hypothesis!==active.data.hypothesis||!same(next.data.candidate,active.data.candidate),'unchanged_evaluated_revision');
      const nextRef=append(next);if(request.action==='revise')replacement=nextRef;else subject=nextRef;to='proposed';
    } else if(request.action==='bind-plan') {
      check(projection.state==='proposed'&&same(p.proposalRef,projection.active),'invalid_plan_subject');check(!history.records.some(r=>r.kind==='learning-plan-link'&&r.data.comparisonRef.id===p.experimentId&&!same(r.data.proposalRef,projection.active)),'revised_proposal_requires_new_experiment');const data=await bindLearningPlan({root,repository:cfg.repo,...options,decisionTarget:request.decisionTarget},p,active);extraIdentities.push({planDigest:data.planDigest,binding:data.binding});append(record('learning-plan-link','plan-'+request.operationId.replaceAll('-',''),1,data));
    } else if(['register-screening','evaluate'].includes(request.action)) {
      check(projection.state==='proposed'&&same(p.proposalRef,projection.active),'invalid_screening_subject');screening=await prepareLearningScreening({root,repository:cfg.repo,...options,decisionTarget:request.decisionTarget,retainedReportRefs:inventory.flatMap(f=>(f.evaluation?.records??[]).filter(r=>r.kind==='learning-evaluation').map(r=>r.data.reportRef))},request,requestDigest,history,active);append(record(screening.kind,'screening-'+request.operationId.replaceAll('-',''),1,screening.data));extraIdentities.push(screening.identity);if(request.action==='evaluate')to='evaluated';
    } else if(request.action==='reject') {check(['observed','proposed','evaluated'].includes(projection.state),'invalid_rejection_state');for(const r of p.evidenceRefs)check(value.records.some(v=>same(ref(v),r)),'unresolved_evidence');to='rejected';}
    else if(request.action==='supersede') {check(['observed','proposed','evaluated'].includes(projection.state),'invalid_supersession_state');const target=getRef(inventory,p.replacementRef);check(target.file!==name,'self_supersession');const targetFile=inventory.find(f=>f.name===target.file);check(!targetFile.evaluation.events.some(e=>e.replacementRef&&value.records.some(r=>same(ref(r),e.replacementRef))),'circular_supersession');replacement=p.replacementRef;to='superseded';extraIdentities.push({replacement:p.replacementRef,fileDigest:targetFile.digest});}
  }
  value.records.push(...added);
  const sourceDigest=fingerprint({sources:[...verified.sourceIdentities].sort((a,b)=>fingerprint(a).localeCompare(fingerprint(b))),retained:history?history.records.map(ref):[],extraIdentities,relatedInventory:inventoryDigest});
  const event=seal({schemaVersion:1,kind:'learning-event',id:'event-'+request.operationId.replaceAll('-',''),sequence:value.events.length+1,operationId:request.operationId,requestDigest,previousDigest:value.events.at(-1)?.digest??null,action:request.action,from:projection.state,to,actor:request.actor,at:request.at,reason:request.reason+(['revise','supersede'].includes(request.action)?'\nScope change: '+p.scopeChangeReason:''),sourceDigest,decisionContextDigest:context.digest,decisionTarget:request.decisionTarget,recordRefs:added.map(ref),evidenceRefs:request.action==='reject'?p.evidenceRefs:[],duplicateSearchDigest,subjectRef:subject,replacementRef:replacement});value.events.push(event);
  const outputBytes=serializeEvaluation(prefix,value);check(outputBytes.length<=1048576,'inbox_output_bound');
  // Reuse the source adapter's body-disclosure check for the actual serialized output,
  // including newly supplied candidate material, without exposing source bodies.
  const checked=await verifyLearningSources({selections:selected,manifest:options.manifest,state:options.state,appRoot:options.appRoot??root,env:options.env??process.env,publicText:outputBytes+'\n'+JSON.stringify(candidatePreview)});
  check(same(checked.sourceIdentities,verified.sourceIdentities),'source_changed_during_preview');
  const preview={action:request.action,preview:true,operationId:request.operationId,requestDigest,currentDigest:current?.digest??null,expectedGeneration:projection.generation,destination:join(root,'docs/inbox',name),sourceDigest,decisionContextDigest:context.digest,decisionTarget:request.decisionTarget,duplicateSearchDigest,outputDigest:byteDigest(Buffer.from(outputBytes)),outputBytes,candidatePreview,changes:{from:projection.state,to,appendedRecords:added.map(ref)},limitations:[...LIM,...(context.state==='not-configured'?['decision context not-configured; no verified architecture coverage']:[])]};
  return {preview:{...preview,digest:fingerprint(preview)},current,name,value,screening,diagnostics:checked.diagnostics};
}
export async function evaluatedLearning(options) {
  const {root,cfg}=await home(options.dir),inventory=await inboxInventory(root);
  if(options.action==='inspect') {check(!options.input&&!options.yes&&!options.digest&&!options.manifest&&!options.state,'inspect_read_only');const file=locate(inventory,options.slug);if(!file?.evaluation){const pending=await pendingLearningOperations(root,options.slug+'.md');check(pending.length,'evaluated_record_missing');return {action:'inspect',readOnly:true,status:'not-found',operations:pending,verification:'pending operation is not proof of commitment'};}return {action:'inspect',readOnly:true,destination:join(root,'docs/inbox',file.name),fileDigest:file.digest,...replay(file.evaluation),evaluation:file.evaluation,operations:file.evaluation.events.map(e=>({operationId:e.operationId,requestDigest:e.requestDigest,status:'committed'})),pending:await pendingLearningOperations(root,file.name,file.evaluation.events),verification:'retained attribution; no fresh source read'};}
  if(options.action==='follow-up')fail('verification_interface_unavailable');
  check(['propose','plan','decide'].includes(options.action),'unknown_evaluate_action');check(options.yes||options.digest===undefined,'digest_requires_yes');
  check(typeof options.input==='string'&&options.input.startsWith('/'),'absolute_request_required');
  const bytes=await evaluationBytes(options.input,262144),request=validateRequest(parseLearningJson(bytes)),requestDigest=byteDigest(bytes);
  check(({propose:['capture','propose','revise'],plan:['bind-plan','register-screening'],decide:['reject','supersede','evaluate']})[options.action].includes(request.action),'action_route_mismatch');
  const recovered=retainedOperation(locate(inventory,options.slug),request,requestDigest);if(recovered){await verifyAppliedScreening(options,locate(inventory,options.slug),request,requestDigest);return recovered;}
  if(!options.yes)return (await prepare(options,request,requestDigest,root,cfg,inventory)).preview;
  check(typeof options.digest==='string','approval_digest_required');
  return withLearningWriter(root,async lock=>{
    check(byteDigest(await evaluationBytes(options.input,262144))===requestDigest,'request_changed');const fresh=await inboxInventory(root),already=retainedOperation(locate(fresh,options.slug),request,requestDigest);if(already){await verifyAppliedScreening(options,locate(fresh,options.slug),request,requestDigest);return already;}
    const apply=async()=>{
    const prepared=await prepare(options,request,requestDigest,root,cfg,fresh);check(prepared.preview.digest===options.digest,'stale_learning_preview');
    if(prepared.screening?.report)await publishScreeningReport(prepared.screening.snapshot,prepared.screening.report);
    await publishInbox(root,prepared.name,prepared.current,prepared.preview.outputBytes,lock,{operationId:request.operationId,requestDigest});
    return {...prepared.preview,preview:false,written:true,generation:prepared.value.events.length,status:replay(prepared.value).state,view:'not refreshed; use explicit learn render'};
    };
    return ['register-screening','evaluate'].includes(request.action)?withEvaluationWriter(options,apply):apply();
  });
}
export async function evaluatedLearningCommand({args,dir,appRoot,env=process.env}) {
  const [action,slug,...rest]=args,options={action,slug,dir,appRoot,env},seen=new Set();
  check(action&&slug,'evaluate_needs_action_and_slug');for(let i=0;i<rest.length;i++){const key=rest[i];check(['--input','--manifest','--state','--yes','--digest','--json'].includes(key)&&!seen.has(key),'unknown_or_duplicate_evaluate_flag');seen.add(key);if(key==='--yes'||key==='--json')options[key.slice(2)]=true;else{check(rest[i+1]&&!rest[i+1].startsWith('--'),'missing_evaluate_value');options[key.slice(2)]=rest[++i];}}
  try{const data=await evaluatedLearning(options);return {data,text:JSON.stringify(data,null,2)+'\n',exitCode:data.preview?3:0};}catch(error){error.exitCode=2;throw error;}
}
