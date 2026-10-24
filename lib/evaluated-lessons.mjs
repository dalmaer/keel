import {promotionActions,promotionRequest,validatePromotionRecord,replayPromotion} from './evaluated-learning-promotion-records.mjs';
import { validateScreeningResult } from './lesson-screening-criteria.mjs';
import { validateReporterIdentity } from './evaluation-screening.mjs';
// Pure evaluated-learning records. Attribution and hashes are not authorization.
import { fingerprint, evaluationId, relativeFile } from './evaluation-records.mjs';
import { parseEvidenceJson } from './validation-evidence.mjs';
export const fail = message => { throw Object.assign(new Error(message), { exitCode: 2, code: message }); };
export const check = (ok, message = 'invalid_learning_record') => { if (!ok) fail(message); };
export const exact = (x, keys) => check(x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k)), 'invalid_learning_fields');
export const hash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
export const revision = x => typeof x === 'string' && /^[a-f0-9]{40}$/.test(x);
export const prose = x => check(typeof x === 'string' && x.length > 0 && Buffer.byteLength(x) <= 4096 && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(x), 'invalid_learning_text');
export const repo = x => check(typeof x === 'string' && /^[\w.-]+\/[\w.-]+$/.test(x), 'invalid_repository');
export const list = (x, validate, max = 32, min = 0) => { check(Array.isArray(x) && x.length >= min && x.length <= max, 'learning_array_bound'); x.forEach(validate); };
export const same = (a,b) => fingerprint(a) === fingerprint(b);
export const seal = value => ({ ...value, digest: fingerprint(value) });
export const ref = r => ({ kind:r.kind, id:r.id, version:r.version, digest:r.digest });
export function recordRef(r, native = false) { exact(r, native ? ['kind','id','digest'] : ['kind','id','version','digest']); check(evaluationId(r.kind) && evaluationId(r.id) && hash(r.digest) && (native || Number.isSafeInteger(r.version) && r.version > 0), 'invalid_record_ref'); }
export function scope(s) { exact(s, ['repositories','paths','taskClasses']); list(s.repositories,repo,32,1); list(s.paths,relativeFile); list(s.taskClasses,prose); for (const v of Object.values(s)) check(new Set(v).size === v.length, 'duplicate_scope'); }
export function protection(p) { exact(p,['repo','revision','path','sha256','assessment']); repo(p.repo); check(revision(p.revision)&&hash(p.sha256),'invalid_protection'); relativeFile(p.path); prose(p.assessment); }
function related(r) { exact(r,['recordRef','relation','reason']); recordRef(r.recordRef); check(['related','duplicate'].includes(r.relation),'invalid_relation'); prose(r.reason); }
function lesson(l, recorded = false) {
  exact(l, ['failure','scope','applicability','reviewCondition','existingProtections','hypothesisOfFailure','related', ...(recorded ? ['sourceRefs','recurrence'] : [])]);
  for (const k of ['failure','applicability','reviewCondition','hypothesisOfFailure']) prose(l[k]); scope(l.scope); list(l.existingProtections,protection); list(l.related,related,16);
  if (recorded) { list(l.sourceRefs,r=>recordRef(r),32,1); exact(l.recurrence,['distinctVerifiedIncidents','unknownIncidentSources','established','eligibleExposure']); check(Number.isSafeInteger(l.recurrence.distinctVerifiedIncidents)&&l.recurrence.distinctVerifiedIncidents>=0&&Number.isSafeInteger(l.recurrence.unknownIncidentSources)&&l.recurrence.unknownIncidentSources>=0&&l.recurrence.established===(l.recurrence.distinctVerifiedIncidents>=2)&&l.recurrence.eligibleExposure===null,'invalid_recurrence'); }
}
export function selection(s) {
  exact(s,['selector','classification']); const v=s.selector;
  check(v && ['github-review','harness-artifact'].includes(v.kind),'unsupported_source');
  if(v.kind==='github-review') { exact(v,['kind','repo','prNumber','reviewId','threadId','commentId','reviewedHead','expectedBodySha256']); repo(v.repo); check(Number.isSafeInteger(v.prNumber)&&v.prNumber>0&&revision(v.reviewedHead)&&hash(v.expectedBodySha256),'invalid_github_selector'); check((v.threadId===null)===(v.commentId===null),'invalid_comment_selector'); for(const k of ['reviewId','threadId','commentId']) if(v[k]!==null) check(typeof v[k]==='string'&&v[k].length>0&&v[k].length<=128 || Number.isSafeInteger(v[k])&&v[k]>0,'invalid_provider_id'); }
  else { exact(v,['kind','experimentId','planDigest','slot','intentDigest','artifactDigest','verdictDigest','checkId']); check(evaluationId(v.experimentId)&&evaluationId(v.slot)&&evaluationId(v.checkId),'invalid_harness_selector'); for(const k of ['planDigest','intentDigest','artifactDigest','verdictDigest']) check(hash(v[k]),'invalid_harness_digest'); }
  classification(s.classification);
}
function classification(c) { exact(c,['value','attribution','actor','rationale']); check(['reviewer-statement','preference','unresolved','verified-defect'].includes(c.value)&&c.attribution==='manual','invalid_classification'); prose(c.actor); prose(c.rationale); }
function proposal(p) {
  exact(p,['lessonRef','hypothesis','candidate','expectedBenefit','downside','mechanism','owner','baselineSelection']); recordRef(p.lessonRef); for(const k of ['hypothesis','expectedBenefit','downside','owner']) prose(p[k]); check(['check','context','workflow','acceptance-case','specification'].includes(p.mechanism),'invalid_mechanism');
  exact(p.baselineSelection,['experimentId','expectedPlanDigest','configurationRef']); check(evaluationId(p.baselineSelection.experimentId)&&hash(p.baselineSelection.expectedPlanDigest),'invalid_baseline'); recordRef(p.baselineSelection.configurationRef,true);
  const c=p.candidate; exact(c,['kind','repository','baseRevision','changes','scope']); check(c.kind==='scoped-material-overlay-v1','unsupported_candidate_shape'); repo(c.repository); check(revision(c.baseRevision),'invalid_base'); scope(c.scope);
  list(c.changes,x=>{exact(x,['path','contentPath','expectedContentSha256']);relativeFile(x.path);check(typeof x.contentPath==='string'&&x.contentPath.startsWith('/')&&hash(x.expectedContentSha256),'invalid_candidate_content');},16,1);
  check(new Set(c.changes.map(x=>x.path)).size===c.changes.length,'duplicate_candidate_path');
}
export function validateRequest(r) {
  exact(r,['schemaVersion','operationId','expected','actor','at','reason','action','payload','decisionTarget']); check(r.schemaVersion===1&&typeof r.operationId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(r.operationId),'invalid_operation');
  exact(r.expected,['fileDigest','generation']); check((r.expected.fileDigest===null||hash(r.expected.fileDigest))&&Number.isSafeInteger(r.expected.generation)&&r.expected.generation>=0&&r.expected.generation<=128,'invalid_expected'); prose(r.actor);prose(r.reason); check(typeof r.at==='string'&&Number.isFinite(Date.parse(r.at))&&new Date(r.at).toISOString()===r.at,'invalid_at');
  exact(r.decisionTarget,['kind','ref']);check(r.decisionTarget.kind==='phase'&&typeof r.decisionTarget.ref==='string'&&/^[1-9][0-9]{0,5}$/.test(r.decisionTarget.ref),'unsupported_decision_target');
  const p=r.payload;
  if(r.action==='capture') { exact(p,['inbox','selections','lesson']); if(p.inbox!==null){exact(p.inbox,['title','sanitizedClaim']);prose(p.inbox.title);prose(p.inbox.sanitizedClaim);check(!/[\r\n]/.test(p.inbox.title),'invalid_title');}list(p.selections,selection,32,1);lesson(p.lesson); }
  else if(r.action==='propose') proposal(p);
  else if(r.action==='revise') { exact(p,['supersedesRef','proposal','scopeChangeReason',...(Object.hasOwn(p,'followUpRef')?['followUpRef']:[])]);if(Object.hasOwn(p,'followUpRef'))recordRef(p.followUpRef);recordRef(p.supersedesRef);proposal(p.proposal);prose(p.scopeChangeReason); }
  else if(r.action==='bind-plan') { exact(p,['proposalRef','experimentId','expectedPlanDigest','targetCaseIds','controlCaseIds','heldOutCaseIds']);recordRef(p.proposalRef);check(evaluationId(p.experimentId)&&hash(p.expectedPlanDigest),'invalid_plan');for(const k of ['targetCaseIds','controlCaseIds','heldOutCaseIds'])list(p[k],x=>check(evaluationId(x),'invalid_case'));const ids=[...p.targetCaseIds,...p.controlCaseIds,...p.heldOutCaseIds];check(new Set(ids).size===ids.length&&p.targetCaseIds.length&&p.controlCaseIds.length,'invalid_case_groups'); }
  else if(r.action==='register-screening'||r.action==='evaluate') {const key=r.action==='evaluate'?'evaluationPlanRef':'planLinkRef';exact(p,['proposalRef',key]);recordRef(p.proposalRef);recordRef(p[key]);}
  else if(r.action==='reject') {exact(p,['evidenceRefs']);list(p.evidenceRefs,r=>recordRef(r));}
  else if(r.action==='supersede') {exact(p,['replacementRef','scopeChangeReason']);recordRef(p.replacementRef);prose(p.scopeChangeReason);}
  else if(promotionActions.includes(r.action))promotionRequest(r.action,p,selection);
  else fail('verification_interface_unavailable');
  return r;
}
export function parseLearningJson(bytes, max=262144) { check(bytes.length<=max,'learning_bytes_bound');return parseEvidenceJson(bytes); }
export function evaluationSection(text) {
  check(Buffer.byteLength(text)<=1048576,'inbox_bytes_bound');
  let fence=null, offset=0; const headings=[];
  for(const line of text.split('\n')) { const m=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if(m) { if(!fence) fence={char:m[1][0],size:m[1].length}; else if(m[1][0]===fence.char&&m[1].length>=fence.size&&!m[2].trim()) fence=null; }
    else if(!fence){const heading=/^ {0,3}##[ \t]+(.+?)[ \t]*$/.exec(line);if(heading){const name=heading[1].replace(/[ \t]+#+[ \t]*$/,'').trim();if(name==='Evaluation')check(line==='## Evaluation','noncanonical_evaluation_heading');headings.push({name,offset});}}
    offset+=line.length+1;
  }
  const sections=headings.filter(h=>h.name==='Evaluation'); if(!sections.length)return null;
  check(sections.length===1&&!fence,'invalid_evaluation_section');const h=sections[0];check(headings.filter(x=>x.name==='Decision'&&x.offset<h.offset).length===1&&headings.at(-1)===h,'invalid_evaluation_position');
  const m=/^## Evaluation\n\s*```json\n([\s\S]*?)\n```\s*$/.exec(text.slice(h.offset));check(m,'invalid_evaluation_fence');
  const value=parseLearningJson(Buffer.from(m[1]));validateHistory(value);
  const statuses=[...text.slice(0,text.indexOf('\n---',4)).matchAll(/^status: (.+)$/gm)];check(statuses.length===1,'invalid_projection');let status=statuses[0][1];if(status.startsWith('"'))status=JSON.parse(status);check(status===projection(replay(value).state),'evaluation_projection_mismatch');
  return {value,prefix:text.slice(0,h.offset)};
}
export const projection = state => ({observed:'untriaged',proposed:'proposed',evaluated:'proposed','ready-for-review':'proposed',promoted:'accepted','rolled-back':'proposed',rejected:'declined',superseded:'linked'})[state];
export function serializeEvaluation(prefix,value) { validateHistory(value); const status=projection(replay(value).state);const rollback=[...value.records].reverse().find(r=>r.kind==='learning-rollback');if(rollback&&!prefix.includes('<!-- learning-rollback:'+rollback.digest+' -->')){const request=value.records.find(r=>same(ref(r),rollback.data.rollbackRequestRef));const repair=request.data.repairRef;prefix=prefix.replace(/\n*$/,'\n\n')+'<!-- learning-rollback:'+rollback.digest+' -->\nRollback source inclusion observed; installation and deployment unverified. Repair: '+repair.kind+' '+repair.ref+'.\n';}check(/^status: .+$/m.test(prefix),'missing_status');return prefix.replace(/^status: .+$/m,'status: '+status).replace(/\n*$/,'\n\n')+'## Evaluation\n\n```json\n'+JSON.stringify(value,null,2)+'\n```\n'; }
const timestamp = x => typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString()===x;
const uuid = x => typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(x);
const providerId = x => typeof x==='string'&&x.length>0&&x.length<=128||Number.isSafeInteger(x)&&x>0;
function location(x) { if(x===null)return; exact(x,['start','end']);check(Number.isSafeInteger(x.start)&&x.start>0&&Number.isSafeInteger(x.end)&&x.end>=x.start,'invalid_line_range'); }
function sourceData(r) {
  const s=r.source,v=r.verification;
  if(v.method==='fresh-review-v1') {
    exact(s,['repo','prNumber','reviewId','threadId','commentId','reviewedHead','currentPrHead','reviewCoversCurrentHead','commentCommit','originalCommentCommit','path','lineRange','originalPath','originalLineRange','bodySha256','fetchedAt']);
    repo(s.repo);check(Number.isSafeInteger(s.prNumber)&&s.prNumber>0&&providerId(s.reviewId)&&revision(s.reviewedHead)&&revision(s.currentPrHead)&&s.reviewCoversCurrentHead===(s.reviewedHead===s.currentPrHead)&&hash(s.bodySha256)&&timestamp(s.fetchedAt),'invalid_review_source');
    check((s.threadId===null)===(s.commentId===null),'invalid_comment_membership');for(const k of ['threadId','commentId'])check(s[k]===null||providerId(s[k]),'invalid_comment_id');for(const k of ['commentCommit','originalCommentCommit'])check(s[k]===null||revision(s[k]),'invalid_comment_commit');for(const k of ['path','originalPath'])if(s[k]!==null)relativeFile(s[k]);location(s.lineRange);location(s.originalLineRange);
    if(s.commentId===null)check(['commentCommit','originalCommentCommit','path','lineRange','originalPath','originalLineRange'].every(k=>s[k]===null),'review_body_has_comment_fields');
    exact(v,['method','receiptContentDigest','receiptAt','sourceIdentityDigest']);check(hash(v.receiptContentDigest)&&timestamp(v.receiptAt)&&s.fetchedAt===v.receiptAt&&hash(v.sourceIdentityDigest)&&r.incidentKey===null,'invalid_review_verification');check(r.classification.value!=='verified-defect','review_prose_not_behavioral_defect');
  } else {
    exact(s,['repository','experimentId','planDigest','slot','intentDigest','artifactDigest','verdictDigest','checkId','startingCommit']);repo(s.repository);for(const k of ['experimentId','slot','checkId'])check(evaluationId(s[k]),'invalid_harness_identity');for(const k of ['planDigest','intentDigest','artifactDigest','verdictDigest'])check(hash(s[k]),'invalid_harness_identity');check(revision(s.startingCommit)&&hash(r.incidentKey),'invalid_harness_source');exact(v,['method','sourceIdentityDigest']);check(v.method==='retained-harness-v1'&&hash(v.sourceIdentityDigest),'invalid_harness_verification');
  }
}
function candidateData(c) {
  exact(c,['kind','repository','baseRevision','scope','patch','patchDigest','baselineDeliveryDigest','candidateDeliveryDigest']);check(c.kind==='scoped-material-overlay-v1'&&revision(c.baseRevision),'invalid_candidate');repo(c.repository);scope(c.scope);for(const k of ['patchDigest','baselineDeliveryDigest','candidateDeliveryDigest'])check(hash(c[k]),'invalid_candidate_digest');
  const p=c.patch;exact(p,['schemaVersion','kind','repository','baseRevision','baselineConfigurationDigest','changes']);check(p.schemaVersion===1&&p.kind==='material-overlay-patch'&&p.repository===c.repository&&p.baseRevision===c.baseRevision&&hash(p.baselineConfigurationDigest)&&fingerprint(p)===c.patchDigest,'invalid_patch');
  list(p.changes,x=>{exact(x,['path','operation','mode','gitBase','before','after']);relativeFile(x.path);check(['add','replace'].includes(x.operation)&&x.mode==='100644','invalid_patch_operation');if(x.gitBase!==null){exact(x.gitBase,['blobOid','mode','contentSha256']);check(revision(x.gitBase.blobOid)&&x.gitBase.mode==='100644'&&hash(x.gitBase.contentSha256),'invalid_git_base');}if(x.before!==null){exact(x.before,['materialRef','contentSha256']);recordRef(x.before.materialRef,true);check(x.before.materialRef.kind==='material'&&hash(x.before.contentSha256),'invalid_before');}exact(x.after,['contentSha256','bytes']);check(hash(x.after.contentSha256)&&Number.isSafeInteger(x.after.bytes)&&x.after.bytes>=0&&x.after.bytes<=65536,'invalid_after');check(x.operation==='add'?x.before===null&&x.gitBase===null:x.before!==null&&x.before.contentSha256!==x.after.contentSha256,'invalid_patch_before');},16,1);
  const paths=p.changes.map(x=>x.path);check(new Set(paths).size===paths.length&&same(paths,[...paths].sort())&&same(paths,[...c.scope.paths].sort()),'invalid_patch_scope');
}
function planData(d) {
  for(const k of ['targetCaseIds','controlCaseIds','heldOutCaseIds'])list(d[k],x=>check(evaluationId(x),'invalid_plan_case'));
  const ids=[...d.targetCaseIds,...d.controlCaseIds,...d.heldOutCaseIds];check(new Set(ids).size===ids.length&&d.targetCaseIds.length&&d.controlCaseIds.length&&d.heldOutCaseIds.length===0,'invalid_plan_case_groups');
  exact(d.binding,['method','patchDigest','baselineDeliveryDigest','candidateDeliveryDigest','baselineConfigurationDigest','candidateConfigurationDigest']);check(d.binding.method==='scoped-material-overlay-v1','invalid_binding');for(const [k,v]of Object.entries(d.binding))if(k!=='method')check(hash(v),'invalid_binding_digest');
  check(d.binding.baselineConfigurationDigest===d.baselineRef.digest&&d.binding.candidateConfigurationDigest===d.candidateRef.digest,'invalid_binding_refs');list(d.limitations,prose,16,1);check(d.limitations.includes('material-plan-binding-only; actual delivery/execution unverified'),'missing_binding_limitation');check(same([...ids].sort(),d.caseRefs.map(r=>r.id).sort())&&d.caseRefs.every(r=>r.kind==='case'),'invalid_plan_case_refs');
}

function validateRecord(r) {
  if(r.kind==='learning-source') {exact(r,['schemaVersion','kind','id','version','source','classification','incidentKey','verification','digest']);classification(r.classification);check(r.incidentKey===null||hash(r.incidentKey),'invalid_incident');check(r.source&&r.verification&&['fresh-review-v1','retained-harness-v1'].includes(r.verification.method),'invalid_source');}
  else {exact(r,['schemaVersion','kind','id','version','data','digest']);const d=r.data;
    if(r.kind==='learning-lesson')lesson(d,true);
    else if(r.kind==='learning-proposal'){exact(d,['lessonRef','hypothesis','candidate','expectedBenefit','downside','mechanism','owner','baselineRef','supersedesRef']);recordRef(d.lessonRef);recordRef(d.baselineRef,true);if(d.supersedesRef!==null)recordRef(d.supersedesRef);for(const k of ['hypothesis','expectedBenefit','downside','owner'])prose(d[k]);exact(d.candidate,['kind','repository','baseRevision','scope','patch','patchDigest','baselineDeliveryDigest','candidateDeliveryDigest']);check(d.candidate.kind==='scoped-material-overlay-v1'&&fingerprint(d.candidate.patch)===d.candidate.patchDigest,'invalid_patch');scope(d.candidate.scope);}
    else if(r.kind==='learning-plan-link'){exact(d,['proposalRef','comparisonRef','planDigest','targetCaseIds','controlCaseIds','heldOutCaseIds','caseRefs','baselineRef','candidateRef','binding','limitations']);recordRef(d.proposalRef);for(const k of ['comparisonRef','baselineRef','candidateRef'])recordRef(d[k],true);list(d.caseRefs,r=>recordRef(r,true));check(hash(d.planDigest),'invalid_plan_digest');}
    else if(r.kind==='learning-evaluation-plan') {exact(d,['proposalRef','planLinkRef','comparisonRef','planDigest','criteriaDigest','method']);recordRef(d.proposalRef);recordRef(d.planLinkRef);recordRef(d.comparisonRef,true);check(d.proposalRef.kind==='learning-proposal'&&d.planLinkRef.kind==='learning-plan-link'&&d.comparisonRef.kind==='comparison'&&hash(d.planDigest)&&hash(d.criteriaDigest)&&d.method==='paired-screening-v1','invalid_screening_plan');}
    else if(r.kind==='learning-evaluation') {
      exact(d,['proposalRef','evaluationPlanRef','reportRef','ledgerDigest','executionDigest','reportDigest','reporterIdentity','method','caseResults','attemptRefs','disposition','reasons','limitations']);recordRef(d.proposalRef);recordRef(d.evaluationPlanRef);recordRef(d.reportRef,true);check(d.proposalRef.kind==='learning-proposal'&&d.evaluationPlanRef.kind==='learning-evaluation-plan'&&d.reportRef.kind==='evaluation-report','invalid_evaluation_refs');for(const k of ['ledgerDigest','executionDigest','reportDigest'])check(hash(d[k]),'invalid_evaluation_hash');validateReporterIdentity(d.reporterIdentity);
      validateScreeningResult(Object.fromEntries(['method','caseResults','disposition','reasons','limitations'].map(k=>[k,d[k]])));
      list(d.attemptRefs,a=>{exact(a,['slot','attemptId','attempt','parentAttemptId','evidence']);check(typeof a.slot==='string'&&/^[a-z][a-z0-9-]{0,127}$/.test(a.slot)&&typeof a.attemptId==='string'&&/^[a-f0-9]{32}$/.test(a.attemptId)&&Number.isSafeInteger(a.attempt)&&a.attempt>0&&(a.parentAttemptId===null||typeof a.parentAttemptId==='string'&&/^[a-f0-9]{32}$/.test(a.parentAttemptId)),'invalid_attempt_ref');list(a.evidence,e=>{exact(e,['record','digest']);check(typeof e.record==='string'&&/^[a-zA-Z][a-zA-Z0-9-]{0,127}$/.test(e.record)&&hash(e.digest),'invalid_attempt_evidence');},64,1);check(new Set(a.evidence.map(e=>e.record)).size===a.evidence.length,'duplicate_attempt_evidence');},2000,1);check(new Set(d.attemptRefs.map(a=>a.attemptId)).size===d.attemptRefs.length,'duplicate_attempt_ref');
    }
    else validatePromotionRecord(r.kind,d);
  }
  if(r.kind==='learning-source') sourceData(r);
  if(r.kind==='learning-proposal'){candidateData(r.data.candidate);check(['check','context','workflow','acceptance-case','specification'].includes(r.data.mechanism),'invalid_mechanism');check(r.data.baselineRef.kind==='configuration'&&r.data.baselineRef.digest===r.data.candidate.patch.baselineConfigurationDigest,'invalid_proposal_baseline');}
  if(r.kind==='learning-plan-link')planData(r.data);
  const {digest,...body}=r;check(r.schemaVersion===1&&evaluationId(r.id)&&Number.isSafeInteger(r.version)&&r.version>0&&hash(digest)&&fingerprint(body)===digest,'invalid_record_digest');
}
const eventFields=['schemaVersion','kind','id','sequence','operationId','requestDigest','previousDigest','action','from','to','actor','at','reason','sourceDigest','decisionContextDigest','decisionTarget','recordRefs','evidenceRefs','duplicateSearchDigest','subjectRef','replacementRef','digest'];
export function replay(value,{resolveExternal}={}) {
  let state=null, active=null, previous=null;const versions=new Map();const available=new Map(), operations=new Set();let cursor=0;
  for(const [i,e]of value.events.entries()) {
    exact(e,eventFields);exact(e.decisionTarget,['kind','ref']);check(e.decisionTarget.kind==='phase'&&typeof e.decisionTarget.ref==='string'&&/^[1-9][0-9]{0,5}$/.test(e.decisionTarget.ref)&&(!i||same(e.decisionTarget,value.events[0].decisionTarget)),'decision_target_changed'); const {digest,...body}=e;check(e.schemaVersion===1&&e.kind==='learning-event'&&evaluationId(e.id)&&e.sequence===i+1&&e.previousDigest===previous&&hash(digest)&&fingerprint(body)===digest&&e.from===state,'invalid_event_chain');
    check(uuid(e.operationId)&&timestamp(e.at)&&(e.duplicateSearchDigest===null||hash(e.duplicateSearchDigest)),'invalid_event_metadata');check(!operations.has(e.operationId),'duplicate_operation');operations.add(e.operationId);for(const k of ['requestDigest','sourceDigest','decisionContextDigest'])check(hash(e[k]),'invalid_event_hash');prose(e.actor);prose(e.reason);list(e.recordRefs,r=>recordRef(r),64);list(e.evidenceRefs,r=>recordRef(r));
    for(const rr of e.recordRefs) {const r=value.records[cursor++];check(r&&same(rr,ref(r))&&!available.has(r.digest),'orphan_or_duplicate_record');const key=r.kind+':'+r.id;check(r.version===(versions.get(key)??0)+1,'invalid_record_version');versions.set(key,r.version);available.set(r.digest,r);}
    const resolve=rr=>{recordRef(rr);const r=available.get(rr.digest);check(r&&same(rr,ref(r)),'unresolved_record');return r;};
    for(const rr of e.recordRefs){const r=resolve(rr);if(r.kind==='learning-lesson'){const sources=r.data.sourceRefs.map(resolve);check(sources.every(s=>s.kind==='learning-source'),'invalid_lesson_sources');const keys=new Set(sources.map(s=>s.incidentKey).filter(Boolean));check(same(r.data.recurrence,{distinctVerifiedIncidents:keys.size,unknownIncidentSources:sources.filter(s=>s.incidentKey===null).length,established:keys.size>=2,eligibleExposure:null}),'forged_recurrence');}if(r.kind==='learning-proposal')check(resolve(r.data.lessonRef).kind==='learning-lesson','invalid_proposal_lesson');if(r.kind==='learning-plan-link')check(resolve(r.data.proposalRef).kind==='learning-proposal','invalid_plan_proposal');}
    for(const rr of e.evidenceRefs)resolve(rr);
    for(const rr of e.recordRefs){const r=resolve(rr);if(r.kind==='learning-follow-up'&&r.data.relation){const target=r.data.relation.recordRef;if(available.has(target.digest))resolve(target);else if(resolveExternal)resolveExternal(target);else check(!value.records.some(x=>x.id===target.id&&x.kind===target.kind),'unresolved_followup_relation');}}
    const subject=resolve(e.subjectRef);if(e.action==='capture'){check(state===null&&e.to==='observed'&&subject.kind==='learning-lesson'&&hash(e.duplicateSearchDigest)&&e.recordRefs.length===subject.data.sourceRefs.length+1&&e.recordRefs.every(r=>r.kind==='learning-source'||same(r,e.subjectRef)),'invalid_capture_transition');active=e.subjectRef;}
    else if(e.action==='propose'){check(e.recordRefs.length===1&&same(e.recordRefs[0],e.subjectRef)&&state==='observed'&&e.to==='proposed'&&subject.kind==='learning-proposal'&&same(subject.data.lessonRef,active)&&subject.version===1&&subject.data.supersedesRef===null,'invalid_propose_transition');active=e.subjectRef;}
    else if(e.action==='revise'){check(e.recordRefs.length===1&&same(e.recordRefs[0],e.replacementRef)&&['proposed','evaluated','ready-for-review','promoted','rolled-back'].includes(state)&&e.to==='proposed'&&same(e.subjectRef,active),'invalid_revise_transition');const replacement=resolve(e.replacementRef);check(replacement.kind==='learning-proposal'&&replacement.id===subject.id&&replacement.version===subject.version+1&&same(replacement.data.supersedesRef,e.subjectRef)&&same(replacement.data.lessonRef,subject.data.lessonRef),'invalid_revision');if(['ready-for-review','promoted','rolled-back'].includes(state))check(e.evidenceRefs.length===1&&resolve(e.evidenceRefs[0]).kind==='learning-follow-up'&&same(resolve(e.evidenceRefs[0]).data.proposalRef,active),'revision_requires_followup');if(state!=='proposed')check(replacement.data.hypothesis!==subject.data.hypothesis||!same(replacement.data.candidate,subject.data.candidate),'unchanged_evaluated_revision');active=e.replacementRef;}
    else if(e.action==='bind-plan'){check(state==='proposed'&&e.to===state&&same(e.subjectRef,active)&&e.recordRefs.length===1,'invalid_plan_transition');const plan=resolve(e.recordRefs[0]);check(plan.kind==='learning-plan-link'&&same(plan.data.proposalRef,active),'plan_wrong_proposal');}
    else if(e.action==='register-screening') {
      check(state==='proposed'&&e.to===state&&same(e.subjectRef,active)&&e.recordRefs.length===1,'invalid_registration_transition');const r=resolve(e.recordRefs[0]);check(r.kind==='learning-evaluation-plan'&&same(r.data.proposalRef,active),'registration_wrong_proposal');const link=resolve(r.data.planLinkRef);check(link.kind==='learning-plan-link'&&same(link.data.proposalRef,active)&&same(link.data.comparisonRef,r.data.comparisonRef)&&link.data.planDigest===r.data.planDigest,'registration_wrong_plan');check([...available.values()].filter(x=>x.kind==='learning-evaluation-plan'&&same(x.data.proposalRef,active)).length===1,'duplicate_registration');
    }
    else if(e.action==='evaluate') {
      check(state==='proposed'&&e.to==='evaluated'&&same(e.subjectRef,active)&&e.recordRefs.length===1,'invalid_evaluation_transition');const r=resolve(e.recordRefs[0]);check(r.kind==='learning-evaluation'&&same(r.data.proposalRef,active),'evaluation_wrong_proposal');const plan=resolve(r.data.evaluationPlanRef);check(plan.kind==='learning-evaluation-plan'&&same(plan.data.proposalRef,active),'evaluation_wrong_registration');check([...available.values()].filter(x=>x.kind==='learning-evaluation'&&same(x.data.proposalRef,active)).length===1,'duplicate_evaluation');
    }
    else if(promotionActions.includes(e.action))replayPromotion(e,state,active,resolve,available);
    else if(['reject','supersede'].includes(e.action)){check(['observed','proposed','evaluated'].includes(state)&&same(e.subjectRef,active)&&e.to===(e.action==='reject'?'rejected':'superseded')&&e.recordRefs.length===0,'invalid_terminal_transition');if(e.action==='supersede'){recordRef(e.replacementRef);check(!same(e.replacementRef,e.subjectRef),'self_supersession');}}
    else fail('verification_interface_unavailable');
    if(!['supersede','revise'].includes(e.action))check(e.replacementRef===null,'unexpected_replacement');state=e.to;previous=digest;
  }
  check(cursor===value.records.length,'orphan_record');return {state,active,generation:value.events.length};
}
export function validateHistory(value) {exact(value,['schemaVersion','kind','id','records','events']);check(value.schemaVersion===1&&value.kind==='evaluated-learning'&&evaluationId(value.id),'invalid_evaluation');list(value.records,validateRecord,128,1);list(value.events,()=>{},128,1);check(Buffer.byteLength(JSON.stringify(value))<=262144,'evaluation_bytes_bound');replay(value);return value;}
