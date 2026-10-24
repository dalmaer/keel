// Public, read-only packages derived from retained reports and actual Git bytes.
import { canonical, byteDigest, fingerprint, relativeFile } from './evaluation-records.mjs';
import { check, exact, hash, revision, prose, list, recordRef, ref, same, scope } from './evaluated-lessons.mjs';
import { bindLearningPlan, gitObservation } from './evaluated-learning-binding.mjs';
import { verifyRetainedEvaluation } from './evaluated-learning-screening.mjs';
import { comparisonSnapshot } from './evaluation-screening.mjs';
import { exportSource } from './evaluation-artifacts.mjs';
import { validateScreeningResult } from './lesson-screening-criteria.mjs';
const LIMIT=262144;
export const packageStates=['evaluated','ready-for-review','rejected','promoted','rolled-back'];
export function artifactFor(payload) {
  const payloadDigest=fingerprint(payload),publicJson=canonical(payload)+'\n';
  return {payloadDigest,publicJson,artifact:{path:'docs/evidence/learning-packages/'+payloadDigest+'.json',byteDigest:byteDigest(publicJson),byteLength:Buffer.byteLength(publicJson)}};
}
function publicBlob(x) {if(x===null)return;exact(x,['mode','byteDigest','byteLength']);check(x.mode==='100644'&&hash(x.byteDigest)&&Number.isSafeInteger(x.byteLength)&&x.byteLength>=0&&x.byteLength<=262144,'invalid_package_blob');}
export function validateArtifact(x) {exact(x,['path','byteDigest','byteLength']);check(/^docs\/evidence\/learning-packages\/[a-f0-9]{64}\.json$/.test(x.path)&&hash(x.byteDigest)&&Number.isSafeInteger(x.byteLength)&&x.byteLength>0&&x.byteLength<=LIMIT,'invalid_package_artifact');}
export function validateReadiness(x) {exact(x,['eligible','gaps']);list(x.gaps,prose,256);check(typeof x.eligible==='boolean'&&x.eligible===(x.gaps.length===0)&&new Set(x.gaps).size===x.gaps.length,'invalid_readiness');}
export function validatePublicPackage(p) {
  exact(p,['schemaVersion','kind','proposalRef','evaluationRef','reportRef','reportDigest','reporterDigest','hypothesis','expectedBenefit','downside','mechanism','scope','sourceLinks','baseRevision','candidateDigest','comparisonSummary','mapping','inverse','disposition','limitations']);
  check(p.schemaVersion===1&&p.kind==='learning-public-package','invalid_public_package');for(const k of ['proposalRef','evaluationRef'])recordRef(p[k]);recordRef(p.reportRef,true);check(p.proposalRef.kind==='learning-proposal'&&p.evaluationRef.kind==='learning-evaluation'&&p.reportRef.kind==='evaluation-report','invalid_package_refs');
  for(const k of ['reportDigest','reporterDigest','candidateDigest'])check(hash(p[k]),'invalid_package_digest');check(revision(p.baseRevision),'invalid_package_base');for(const k of ['hypothesis','expectedBenefit','downside'])prose(p[k]);check(['check','context','workflow','acceptance-case','specification'].includes(p.mechanism),'invalid_package_mechanism');scope(p.scope);
  list(p.sourceLinks,s=>{exact(s,['recordRef','url','sourceDigest']);recordRef(s.recordRef);check(s.recordRef.kind==='learning-source'&&hash(s.sourceDigest)&&(s.url===null||typeof s.url==='string'&&/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/[1-9][0-9]*(?:#discussion_r[1-9][0-9]*|#pullrequestreview-[1-9][0-9]*)?$/.test(s.url)),'invalid_public_source');},32,1);
  const s=p.comparisonSummary;exact(s,['screening','cases','attempts']);validateScreeningResult(s.screening);check(s.screening.disposition===p.disposition,'package_disposition_mismatch');
  list(s.cases,c=>{exact(c,['id','taskClass']);prose(c.id);prose(c.taskClass);},20,1);check(new Set(s.cases.map(c=>c.id)).size===s.cases.length,'duplicate_public_case');
  list(s.attempts,a=>{exact(a,['attemptId','evidence']);check(typeof a.attemptId==='string'&&/^[a-f0-9]{32}$/.test(a.attemptId),'invalid_public_attempt');list(a.evidence,e=>{exact(e,['record','digest']);check(typeof e.record==='string'&&/^[a-zA-Z][a-zA-Z0-9-]{0,127}$/.test(e.record)&&hash(e.digest),'invalid_public_evidence');},64,1);},2000,1);
  exact(p.mapping,['method','complete','entries']);check(p.mapping.method==='identity-paths-v1'&&typeof p.mapping.complete==='boolean','invalid_mapping');
  list(p.mapping.entries,e=>{exact(e,['path','before','after','baseMatches']);relativeFile(e.path);publicBlob(e.before);publicBlob(e.after);check(e.after!==null&&typeof e.baseMatches==='boolean','invalid_mapping_entry');},16,1);
  check(p.mapping.complete===p.mapping.entries.every(e=>e.baseMatches)&&same(p.mapping.entries.map(e=>e.path),[...p.scope.paths].sort())&&new Set(p.mapping.entries.map(e=>e.path)).size===p.mapping.entries.length,'invalid_mapping_coverage');
  exact(p.inverse,['available','entries']);check(typeof p.inverse.available==='boolean','invalid_inverse');list(p.inverse.entries,e=>{exact(e,['path','removeDigest','restoreDigest']);relativeFile(e.path);check(hash(e.removeDigest)&&(e.restoreDigest===null||hash(e.restoreDigest)),'invalid_inverse_entry');},16);
  check(p.inverse.available?p.mapping.complete&&same(p.inverse.entries,p.mapping.entries.map(e=>({path:e.path,removeDigest:e.after.byteDigest,restoreDigest:e.before?.byteDigest??null}))):p.inverse.entries.length===0,'invalid_inverse_mapping');list(p.limitations,prose,256,1);check(Buffer.byteLength(canonical(p))<=LIMIT,'package_bytes_bound');return p;
}
export function validatePackageRecord(d) {
  exact(d,['proposalRef','evaluationRef','payloadDigest','artifact','readiness','verificationDigest']);recordRef(d.proposalRef);recordRef(d.evaluationRef);validateArtifact(d.artifact);validateReadiness(d.readiness);check(d.proposalRef.kind==='learning-proposal'&&d.evaluationRef.kind==='learning-evaluation'&&hash(d.verificationDigest)&&hash(d.payloadDigest)&&d.artifact.path==='docs/evidence/learning-packages/'+d.payloadDigest+'.json','invalid_package_record');
}
const publicInfo=bytes=>({mode:'100644',byteDigest:byteDigest(bytes),byteLength:Buffer.byteLength(bytes)});
const privateInfo=bytes=>({mode:'100644',byteDigest:byteDigest(bytes),bytes});
function utf8(bytes) {const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);check(Buffer.from(text).equals(bytes)&&!text.includes('\0'),'binary_package_base');return text;}
export async function buildLearningPackage(options,history,proposal) {
  const evaluation=history.records.find(r=>r.kind==='learning-evaluation'&&same(r.data.proposalRef,ref(proposal)));check(evaluation,'package_requires_evaluation');
  const retained=await verifyRetainedEvaluation(options,history,evaluation),registration=retained.registration;
  const link=history.records.find(r=>same(ref(r),registration.data.planLinkRef));check(link,'package_missing_plan');const d=link.data;
  const bound=await bindLearningPlan(options,{proposalRef:ref(proposal),experimentId:d.comparisonRef.id,expectedPlanDigest:d.planDigest,targetCaseIds:d.targetCaseIds,controlCaseIds:d.controlCaseIds,heldOutCaseIds:d.heldOutCaseIds},proposal);check(same(bound,d),'package_binding_changed');
  const snapshot=await comparisonSnapshot({...options,experiment:d.comparisonRef.id,repository:options.root});check(snapshot.reportDigest===evaluation.data.reportDigest&&snapshot.executionDigest===evaluation.data.executionDigest,'package_execution_changed');
  const b=retained.plan.bundle,c=proposal.data.candidate,config=b.configurations.find(x=>same({kind:x.kind,id:x.id,digest:x.digest},d.candidateRef)),entries=[],changes=[];let inverseAvailable=true;
  for(const change of c.patch.changes) {
    check(!['.plates','requirements.json','docs/evidence/learning-packages'].some(p=>change.path===p||change.path.startsWith(p+'/')),'protected_public_path');
    const actual=gitObservation(options.root,c.baseRevision,change.path,options.deadline??Date.now()+30000);check(same(actual,change.gitBase),'package_base_changed');
    const item=config.overlays.find(x=>x.path===change.path),material=b.materials.find(x=>item&&same({kind:x.kind,id:x.id,digest:x.digest},item.material));check(material&&byteDigest(material.content)===change.after.contentSha256,'package_candidate_changed');
    let before=null,beforePublic=null;if(actual){const source=exportSource(options.root,c.baseRevision,[change.path],{deadline:options.deadline??Date.now()+30000})[0],bytes=Buffer.from(source.base64,'base64');check(byteDigest(bytes)===actual.contentSha256,'package_base_bytes_changed');beforePublic=publicInfo(bytes);try{before=privateInfo(utf8(bytes));}catch(error){if(error.code==='ERR_ENCODING_INVALID_ENCODED_DATA'||error.code==='binary_package_base')inverseAvailable=false;else throw error;}}
    const baseMatches=change.before===null?actual===null:actual!==null&&change.before.contentSha256===actual.contentSha256;
    entries.push({path:change.path,before:beforePublic,after:publicInfo(material.content),baseMatches});changes.push({path:change.path,before,after:privateInfo(material.content)});inverseAvailable&&=baseMatches;
  }
  const ed=evaluation.data,screening=Object.fromEntries(['method','disposition','caseResults','reasons','limitations'].map(k=>[k,ed[k]]));
  const lesson=history.records.find(r=>same(ref(r),proposal.data.lessonRef));check(lesson,'package_lesson_missing');
  const sourceLinks=history.records.filter(r=>r.kind==='learning-source'&&lesson.data.sourceRefs.some(rr=>same(rr,ref(r)))).map(r=>{const s=r.source;return {recordRef:ref(r),url:r.verification.method==='fresh-review-v1'?`https://github.com/${s.repo}/pull/${s.prNumber}`+(Number.isSafeInteger(Number(s.commentId??s.reviewId))?s.commentId?`#discussion_r${s.commentId}`:`#pullrequestreview-${s.reviewId}`:''):null,sourceDigest:r.verification.sourceIdentityDigest};});
  const payload={schemaVersion:1,kind:'learning-public-package',proposalRef:ref(proposal),evaluationRef:ref(evaluation),reportRef:ed.reportRef,reportDigest:ed.reportDigest,reporterDigest:ed.reporterIdentity.digest,hypothesis:proposal.data.hypothesis,expectedBenefit:proposal.data.expectedBenefit,downside:proposal.data.downside,mechanism:proposal.data.mechanism,scope:c.scope,sourceLinks,baseRevision:c.baseRevision,candidateDigest:c.patchDigest,comparisonSummary:{screening,cases:b.cases.map(x=>({id:x.id,taskClass:x.taskClass})),attempts:ed.attemptRefs.map(a=>({attemptId:a.attemptId,evidence:a.evidence}))},mapping:{method:'identity-paths-v1',complete:entries.every(e=>e.baseMatches),entries},inverse:{available:inverseAvailable,entries:inverseAvailable?entries.map(e=>({path:e.path,removeDigest:e.after.byteDigest,restoreDigest:e.before?.byteDigest??null})):[]},disposition:ed.disposition,limitations:['Source inclusion is not installation, production verification or acceptance.','Development-only evidence; held-out coverage is zero.','publication_mapping_unverified: no supported installed invocation route.','provider_integration_unavailable: offline execution is not agent efficacy.']};
  const publicStrings=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(publicStrings):[];
  const strings=publicStrings(payload);for(const value of strings)check(!value.includes(options.root)&&!/(?:^|[\s\"'])(?:\/(?:Users|private|tmp|home|var)\/)/.test(value),'private_package_text');
  for(const material of b.materials)if(material.content.length>=16)check(!strings.some(s=>s.includes(material.content)),'private_material_in_package');
  validatePublicPackage(payload);const artifact=artifactFor(payload),markdown='# Learning review package\n\n```json\n'+JSON.stringify(payload,null,2)+'\n```\n';check(Buffer.byteLength(artifact.publicJson)+Buffer.byteLength(markdown)<=LIMIT,'package_bytes_bound');
  const gaps=['publication_mapping_unverified','provider_integration_unavailable',...(ed.disposition!=='supported'?['screening_not_supported']:[]),...(!payload.mapping.complete?['installed_base_unverified']:[]),...(!inverseAvailable?['inverse_unavailable']:[])];
  return {public:{action:'package',readOnly:true,payload,...artifact,markdown,readiness:{eligible:false,gaps}},verificationDigest:fingerprint({reportRef:ed.reportRef,executionDigest:snapshot.executionDigest,currentVerifier:snapshot.reporterIdentity,planDigest:d.planDigest,mapping:payload.mapping}),changes,evaluation};
}
