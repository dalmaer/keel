// Verify material-only candidate links from actual Git objects and authorized frozen ledgers.
import { spawnSync } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { evaluations, evaluationBytes } from './evaluation-ledger.mjs';
import { byteDigest, fingerprint } from './evaluation-records.mjs';
import { filePath, exportSource } from './evaluation-artifacts.mjs';
import { corpusDefinition } from './evaluation-corpus.mjs';
import { check, same, revision, recordRef } from './evaluated-lessons.mjs';
export const nativeRef = r => ({kind:r.kind,id:r.id,digest:r.digest});
const decode = bytes => {const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);check(Buffer.from(text).equals(Buffer.from(bytes)),'invalid_utf8');return text;};
function git(root,args,deadline) {
  const timeout=Math.min(10000,deadline-Date.now());check(timeout>0,'learning_preparation_deadline');
  const r=spawnSync('/usr/bin/git',['--no-pager','-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-C',root,...args],{env:{PATH:process.env.PATH,HOME:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1',GIT_OPTIONAL_LOCKS:'0'},timeout,maxBuffer:262145});
  check(!r.error&&r.status===0,'git_object_unavailable');return r.stdout;
}
export function gitObservation(root,base,path,deadline=Date.now()+30000) {
  check(revision(base),'invalid_base');filePath(path);check(git(root,['cat-file','-t',base],deadline).toString().trim()==='commit','base_not_commit');
  const row=git(root,['ls-tree','-z',base,'--',':(literal)'+path],deadline).toString();if(!row)return null;
  const m=/^100644 blob ([a-f0-9]{40})\t([^\0]+)\0$/.exec(row);check(m&&m[2]===path,'nonregular_git_base');
  const bytes=git(root,['cat-file','blob',m[1]],deadline);return {blobOid:m[1],mode:'100644',contentSha256:byteDigest(bytes)};
}
export async function verifyProtections(root,repository,protections,deadline) {
  for(const p of protections){check(p.repo===repository,'protection_repository_mismatch');const observed=gitObservation(root,p.revision,p.path,deadline);check(observed&&observed.contentSha256===p.sha256,'protection_changed');}
  return protections;
}
export async function inspectLearningPlan(options,selection) {
  const result=await evaluations({action:'inspect',experiment:selection.experimentId,manifest:options.manifest,state:options.state,appRoot:options.appRoot});
  const plan=result.receipt.plan;check(same(plan.bundle.comparison.authority,options.decisionTarget),'comparison_authority_mismatch');check(plan.digest===selection.expectedPlanDigest,'stale_plan');return {plan,bundle:plan.bundle,execution:result.execution};
}
function resolve(bundle,r,kind) {recordRef(r,true);check(r.kind===kind,'wrong_native_kind');const values=kind==='configuration'?bundle.configurations:kind==='material'?bundle.materials:bundle.cases;const value=values.find(x=>same(nativeRef(x),r));check(value,'unresolved_frozen_ref');return value;}
function delivery(bundle,config) {
  const paths=new Set(),entries=[];
  for(const [layer,items]of [['context',config.context],['overlay',config.overlays]])for(const [index,item]of items.entries()){
    filePath(item.path);check(!paths.has(item.path),'duplicate_delivery_path');paths.add(item.path);const m=resolve(bundle,item.material,'material');const bytes=Buffer.from(m.content);check(decode(bytes)===m.content,'invalid_material_utf8');entries.push({layer,index,path:item.path,mode:'100644',contentSha256:byteDigest(bytes),bytes:bytes.length});
  }return entries;
}
const deliveryDigest=entries=>fingerprint({schemaVersion:1,kind:'ordered-material-delivery',entries});
function patchFor(repository,baseRevision,baseline,entries,observations,changed) {
  return {schemaVersion:1,kind:'material-overlay-patch',repository,baseRevision,baselineConfigurationDigest:baseline.digest,changes:changed.map(c=>{
    const before=entries.find(e=>e.path===c.path),overlay=baseline.overlays.find(e=>e.path===c.path);
    check(!before||before.layer==='overlay','cannot_change_context');check(!before||before.contentSha256!==c.contentSha256,'unchanged_candidate');check(before||observations[c.path]===null,'addition_exists_in_git');
    return {path:c.path,operation:before?'replace':'add',mode:'100644',gitBase:observations[c.path],before:before?{materialRef:overlay.material,contentSha256:before.contentSha256}:null,after:{contentSha256:c.contentSha256,bytes:c.bytes}};
  })};
}
function candidateEntries(entries,changed) {
  const next=entries.map(e=>{const c=changed.find(c=>c.path===e.path);return c?{...e,contentSha256:c.contentSha256,bytes:c.bytes}:e;});let index=entries.filter(e=>e.layer==='overlay').length;
  for(const c of changed)if(!entries.some(e=>e.path===c.path))next.push({layer:'overlay',index:index++,path:c.path,mode:'100644',contentSha256:c.contentSha256,bytes:c.bytes});return next;
}
async function protectedPaths(bundle,root,deadline) {
  const protectedSet=new Set(['requirements.json']);
  for(const task of bundle.cases){const d=await corpusDefinition(task.id);check(same(task,d.task),'unknown_or_changed_corpus_case');const files=exportSource(root,d.definition.start,d.definition.sources.map(s=>s.path),{deadline});
    for(const s of d.definition.sources){const f=files.find(f=>f.path===s.path);check(f&&byteDigest(Buffer.from(f.base64,'base64'))===s.sha256,'corpus_source_changed');protectedSet.add(s.path);}
    for(const p of d.probes)protectedSet.add(p.path);
    const acceptance=JSON.parse(d.acceptance.content);for(const c of acceptance.checks)for(const arg of c.argv)if(arg.startsWith('/work/'))protectedSet.add(arg.slice(6));
  }return protectedSet;
}
function guardPaths(changed,baseline,scope,protectedSet) {
  check(same([...scope.paths].sort(),changed.map(c=>c.path)),'candidate_scope_mismatch');
  for(const c of changed){filePath(c.path);check(![...protectedSet].some(p=>c.path===p||c.path.startsWith(p+'/')||p.startsWith(c.path+'/'))&&!baseline.exclusions.some(p=>c.path===p||c.path.startsWith(p+'/')||p.startsWith(c.path+'/'))&&c.path!=='requirements.json','protected_candidate_path');}
}
export async function deriveCandidate(options,payload) {
  const deadline=options.deadline??Date.now()+30000,{bundle,plan}=await inspectLearningPlan(options,payload.baselineSelection),c=payload.candidate;
  check(c.repository===options.repository&&bundle.comparison.repository===options.repository&&c.scope.repositories.every(r=>r===options.repository),'candidate_repository_mismatch');
  check(same(payload.baselineSelection.configurationRef,bundle.comparison.baseline),'wrong_baseline');const baseline=resolve(bundle,bundle.comparison.baseline,'configuration');check(baseline.dirtyOverlay===null&&baseline.harnessCommit===c.baseRevision,'unsupported_baseline');
  const entries=delivery(bundle,baseline),changes=[...c.changes].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0),changed=[],candidatePreview=[],observations={};
  const protectedSet=await protectedPaths(bundle,options.root,deadline);guardPaths(changes,baseline,c.scope,protectedSet);
  for(const item of changes){const stat=await lstat(item.contentPath);check(stat.uid===process.getuid?.()&&(stat.mode&0o077)===0,'candidate_input_not_private');const bytes=await evaluationBytes(item.contentPath,65536),content=decode(bytes);check(byteDigest(bytes)===item.expectedContentSha256,'candidate_content_changed');changed.push({path:item.path,contentSha256:byteDigest(bytes),bytes:bytes.length});candidatePreview.push({path:item.path,content,contentSha256:byteDigest(bytes)});observations[item.path]=gitObservation(options.root,c.baseRevision,item.path,deadline);}
  const patch=patchFor(c.repository,c.baseRevision,baseline,entries,observations,changed);
  return {candidate:{kind:c.kind,repository:c.repository,baseRevision:c.baseRevision,scope:c.scope,patch,patchDigest:fingerprint(patch),baselineDeliveryDigest:deliveryDigest(entries),candidateDeliveryDigest:deliveryDigest(candidateEntries(entries,changed))},baselineRef:bundle.comparison.baseline,candidatePreview,sourceIdentity:{planDigest:plan.digest,baseline:bundle.comparison.baseline,patchDigest:fingerprint(patch)}};
}
export async function bindLearningPlan(options,payload,proposal) {
  const deadline=options.deadline??Date.now()+30000,{bundle,plan}=await inspectLearningPlan(options,payload),c=proposal.data.candidate;
  check(bundle.comparison.repository===options.repository&&c.repository===options.repository&&same(bundle.comparison.baseline,proposal.data.baselineRef),'plan_baseline_mismatch');
  const baseline=resolve(bundle,bundle.comparison.baseline,'configuration'),candidate=resolve(bundle,bundle.comparison.candidate,'configuration');check(baseline.dirtyOverlay===null&&candidate.dirtyOverlay===null&&baseline.harnessCommit===c.baseRevision&&candidate.harnessCommit===baseline.harnessCommit,'plan_harness_mismatch');
  const stripped=x=>Object.fromEntries(Object.entries(x).filter(([k])=>!['id','createdAt','digest','overlays'].includes(k)));check(same(stripped(baseline),stripped(candidate)),'plan_noncandidate_fields_changed');
  const entries=delivery(bundle,baseline),actual=delivery(bundle,candidate),changed=c.patch.changes.map(x=>({path:x.path,...x.after})),observations={};
  const protectedSet=await protectedPaths(bundle,options.root,deadline);guardPaths(changed,baseline,c.scope,protectedSet);
  for(const x of changed)observations[x.path]=gitObservation(options.root,c.baseRevision,x.path,deadline);
  const patch=patchFor(c.repository,c.baseRevision,baseline,entries,observations,changed);check(same(patch,c.patch)&&fingerprint(patch)===c.patchDigest&&deliveryDigest(entries)===c.baselineDeliveryDigest,'stale_candidate_base');
  const expected=candidateEntries(entries,changed);check(same(expected,actual)&&deliveryDigest(actual)===c.candidateDeliveryDigest,'candidate_delivery_mismatch');
  for(const item of baseline.overlays)if(!changed.some(c=>c.path===item.path))check(same(item,candidate.overlays.find(c=>c.path===item.path)),'unchanged_material_ref_changed');
  const ids=[...payload.targetCaseIds,...payload.controlCaseIds,...payload.heldOutCaseIds];check(same([...ids].sort(),bundle.cases.map(c=>c.id).sort()),'case_coverage_mismatch');check(payload.heldOutCaseIds.length===0&&bundle.cases.every(c=>c.visibility==='development'),'heldout_unavailable');
  for(const id of [...payload.targetCaseIds,...payload.controlCaseIds])check(bundle.comparison.pairs.filter(p=>p.case.id===id).length>=5,'insufficient_case_pairs');
  return {proposalRef:payload.proposalRef,comparisonRef:nativeRef(bundle.comparison),planDigest:plan.digest,targetCaseIds:payload.targetCaseIds,controlCaseIds:payload.controlCaseIds,heldOutCaseIds:payload.heldOutCaseIds,caseRefs:bundle.comparison.cases,baselineRef:bundle.comparison.baseline,candidateRef:bundle.comparison.candidate,binding:{method:'scoped-material-overlay-v1',patchDigest:c.patchDigest,baselineDeliveryDigest:c.baselineDeliveryDigest,candidateDeliveryDigest:c.candidateDeliveryDigest,baselineConfigurationDigest:baseline.digest,candidateConfigurationDigest:candidate.digest},limitations:['material-plan-binding-only; actual delivery/execution unverified','development-only; held-out inventory zero; costs and effectiveness unverified']};
}
