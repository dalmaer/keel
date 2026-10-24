// Acme synthetic receipt construction for adversarial tests, NOT Docker proof.
// The conductor uses evaluatedLearningWorld({realDocker:true}) and actual execution.
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { evaluatedLearningWorld } from './evaluated-learning.mjs';
import { evaluationSection, ref } from '../../lib/evaluated-lessons.mjs';
import { fingerprint, sealRecord } from '../../lib/evaluation-records.mjs';
import { storeImmutable } from '../../lib/session-ledger-io.mjs';
import { exportSource } from '../../lib/evaluation-artifacts.mjs';
import { composeExecutionDelivery } from '../../lib/evaluation-execution-input.mjs';
export const criteria={schemaVersion:1,targetCaseIds:['acme-case-0'],controlCaseIds:['acme-case-1'],minimumComparablePairsPerCase:5,minimumTargetNetGains:1,maxControlRegressions:0,maxAdditionalCurrencyUsd:0,maxAdditionalMedianWallMs:1000,comparability:'actual-identity-v1',missingEvidence:'inconclusive'};
export async function screeningWorld(t,{register=true,screeningCriteria=criteria,retention,worldOptions={}}={}) {
  const w=await evaluatedLearningWorld(t,{...worldOptions,realDocker:true,screeningCriteria,resolvedModel:'acme-synthetic-model',...(retention?{retention}:{})});
  const observed=(await w.call('capture',w.capture,{apply:true})).result;
  const lessonRef=ref(evaluationSection(observed.outputBytes).value.records.find(r=>r.kind==='learning-lesson'));
  const proposed=(await w.call('propose',w.proposal(lessonRef),{previous:observed,apply:true})).result;
  const proposalRef=ref(evaluationSection(proposed.outputBytes).value.records.find(r=>r.kind==='learning-proposal'));
  const bound=(await w.call('bind-plan',{proposalRef,experimentId:w.b.comparison.id,expectedPlanDigest:w.draft.digest,targetCaseIds:['acme-case-0'],controlCaseIds:['acme-case-1'],heldOutCaseIds:[]},{previous:proposed,apply:true})).result;
  const planLinkRef=ref(evaluationSection(bound.outputBytes).value.records.find(r=>r.kind==='learning-plan-link'));
  const registered=register?(await w.call('register-screening',{proposalRef,planLinkRef},{previous:bound,apply:true})).result:null;
  const evaluationPlanRef=registered?ref(evaluationSection(registered.outputBytes).value.records.find(r=>r.kind==='learning-evaluation-plan')):null;
  const dir=join(w.options.state,'session-trials',w.b.comparison.id);
  return {...w,dir,lessonRef,proposalRef,planLinkRef,bound,registered,evaluationPlanRef,evaluate:()=>w.call('evaluate',{proposalRef,evaluationPlanRef},{previous:registered})};
}
export async function syntheticTerminalReceipts(w,{omitLast=false,recovery=false,regression=false}={}) {
  const ledger=JSON.parse(await readFile(join(w.dir,'state.json'))),plan=ledger.plan,b=plan.bundle,home=join(w.dir,'execution');await mkdir(home,{mode:0o700});
  const envelope=(kind,id,body)=>sealRecord({schemaVersion:2,kind,id,createdAt:'2026-10-24T00:00:00.000Z',...body});
  await storeImmutable(join(home,'reservation.json'),envelope('evaluation-reservation','acme-reservation',{planDigest:plan.digest,allowance:b.comparison.allowance,currencyUsage:null}));
  const provenance=await w.load('evaluation-provenance'),controller=await provenance.controllerIdentity();
  const sources=exportSource(w.repo,w.sha,['acme.mjs']);
  const slots=b.comparison.pairs.flatMap(p=>['baseline','candidate'].map(arm=>({p,arm})));if(omitLast)slots.pop();
  for(const [index,{p,arm}] of slots.entries()) {
    const task=b.cases.find(c=>c.id===p.case.id),config=b.configurations.find(c=>c.id===b.comparison[arm].id),request={...w.executionRequest,pairId:p.id,arm};
    const {delivered}=composeExecutionDelivery(b,task,config,sources,request.builderArgv),driver=JSON.parse(b.materials.find(m=>m.id===task.acceptanceManifest.id).content);
    const id=randomBytes(16).toString('hex'),slot=p.id+'-'+arm,path=join(home,slot);await mkdir(path,{mode:0o700});
    const input={request,planDigest:plan.digest,taskDigest:task.digest,configurationDigest:config.digest,checkManifestDigest:task.acceptanceManifest.digest,sourceDigest:fingerprint(sources),delivered,deliveredDigest:fingerprint(delivered),controller,image:{requested:task.environment.image,id:task.environment.image,platform:task.environment.platform,inherited:[],nodeVersion:'v24.22.1'}};
    const operations=['builder',...driver.checks.map((_,i)=>'check-'+i)].map(s=>'plates-eval-'+id+'-'+s);
    const intent=envelope('evaluation-intent',id,{slot,input,previewDigest:fingerprint(input),operations,dispatchProtocol:'ordered-authorization-v1',attempt:1,parentAttemptId:null,interventions:[],repairRounds:0}),records={intent};
    const record=(kind,body)=>envelope(kind,id,{intentDigest:intent.digest,...body});
    records.lease=record('evaluation-lease',{lease:{id,commandDigest:intent.previewDigest,operations,root:w.repo,repo:'Acme/widget'}});
    const observations=operations.map((operation,i)=>({operation,state:'terminated',containerId:String(i+1).repeat(64),running:false}));
    const failed=regression&&task.taskClass==='control'&&arm==='candidate'&&index===11;
    for(const [i,operation]of operations.entries()){const name=i?'check-'+(i-1):'builder';records['dispatch-'+name]=record('evaluation-dispatch',{operation,index:i});records[name]=record('evaluation-stage',{stage:{operation,containerId:observations[i].containerId,setup:'passed',execution:'passed',error:null,output:{exit:0,signal:null,stdout:i?(failed?'Acme wrong\n':driver.checks[i-1].stdout):'',stderr:''},termination:observations[i]}});}
    records.artifact=record('evaluation-artifact',{files:sources,filesDigest:fingerprint(sources),sourceDigest:input.sourceDigest});
    records.verdict=record('evaluation-verdict',{artifactDigest:records.artifact.digest,checkManifestDigest:input.checkManifestDigest,evaluator:{identity:'plates-host-stdio-v1',version:1,controller,image:input.image},acceptance:failed?'rejected':'accepted',failureCategory:failed?'acceptance':null,checks:driver.checks.map((c,i)=>({id:c.id,status:failed?'failed':'passed',observationDigest:records['check-'+i].digest}))});
    const settlement={id,commandDigest:intent.previewDigest,released:true,observations};
    const result=record('evaluation-result',{status:'terminal',verdictDigest:records.verdict.digest,settlement,validation:failed?'failed':'passed',resources:{wallMs:10,currencyUsd:null},...(recovery&&index===0?{recoveryInputDigest:'c'.repeat(64)}:{})});
    for(const [key,r]of Object.entries(records))await storeImmutable(join(path,key+'.json'),r);
    if(recovery&&index===0){const receipt=record('evaluation-reconciliation',{inputDigest:'c'.repeat(64),result,verdict:records.verdict,settlement,observations,status:'terminal',originalEvidence:Object.fromEntries(Object.entries(records).map(([k,v])=>[k,v.digest]))});await storeImmutable(join(path,'reconciliation-'+receipt.digest+'.json'),receipt);}else await storeImmutable(join(path,'result.json'),result);
  }
}
