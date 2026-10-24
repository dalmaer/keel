// Controlled Acme public-CLI walk; real Docker execution, simulated GitHub only.
// Synthetic outcomes establish machinery, never measured agent efficacy.
import assert from 'node:assert/strict';
import {writeFile,readFile,readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {evaluatedLearningWorld} from '../../tests/helpers/evaluated-learning.mjs';
import {evaluationSection,ref} from '../../lib/evaluated-lessons.mjs';
const criteria={schemaVersion:1,targetCaseIds:['acme-case-0'],controlCaseIds:['acme-case-1'],minimumComparablePairsPerCase:5,minimumTargetNetGains:1,maxControlRegressions:0,maxAdditionalCurrencyUsd:0,maxAdditionalMedianWallMs:1000,comparability:'actual-identity-v1',missingEvidence:'inconclusive'};
const w=await evaluatedLearningWorld({after(){}},{realDocker:true,screeningCriteria:criteria});
console.log('Retained private workspace '+w.root);
const slug='2026-10-24-acme',cli=join(w.app,'bin/plates.mjs'),experiment=join(w.options.state,'session-trials',w.b.comparison.id);
const common=['--manifest',w.options.manifest,'--state',w.options.state];
let observations=0;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function inventory(path,prefix=''){
 const rows=[];for(const name of (await readdir(path)).sort()){
  const file=join(path,name),stat=await lstat(file);assert.equal(stat.isSymbolicLink(),false);
  if(stat.isDirectory())rows.push(...await inventory(file,prefix+name+'/'));
  else rows.push([prefix+name,digest(await readFile(file)),stat.mode]);
 }return rows;
}
async function call(args,expected=0){
 const r=spawnSync(process.execPath,[cli,...args,'--json'],{cwd:w.repo,env:w.env,encoding:'utf8',timeout:600000,maxBuffer:8*1024*1024});
 let data;try{data=JSON.parse(r.stdout||r.stderr);}catch{data={stdout:r.stdout,stderr:r.stderr};}
 await writeFile(join(w.root,String(++observations).padStart(2,'0')+'-cli.json'),JSON.stringify({args,expected,exit:r.status,signal:r.signal,error:r.error?.message??null,data,stderr:r.stderr},null,2)+'\n',{flag:'wx',mode:0o400});
 assert.equal(r.status,expected,JSON.stringify(data));return data;
}
async function mutate(action,payload,previous=null){
 const request={schemaVersion:1,operationId:randomUUID(),expected:{fileDigest:previous?.outputDigest??null,generation:previous?.generation??0},actor:'Acme owner',at:'2026-10-24T00:00:00.000Z',reason:'Acme controlled screening proof',action,payload,decisionTarget:{kind:'phase',ref:'1'}};
 const input=join(w.root,request.operationId+'.json');await writeFile(input,JSON.stringify(request),{flag:'wx',mode:0o600});
 const verb=['bind-plan','register-screening'].includes(action)?'plan':['evaluate','reject'].includes(action)?'decide':'propose';
 const args=['learn','evaluate',verb,slug,'--input',input,...common];
 const before={inbox:await inventory(join(w.repo,'docs/inbox')),ledger:await inventory(join(w.options.state,'session-trials'))};
 const preview=await call(args,3);
 assert.equal((await call(args,3)).digest,preview.digest);
 assert.deepEqual({inbox:await inventory(join(w.repo,'docs/inbox')),ledger:await inventory(join(w.options.state,'session-trials'))},before);
 await call([...args,'--yes','--digest','0'.repeat(64)],2);
 const applied=await call([...args,'--yes','--digest',preview.digest]);assert.equal(applied.written,true);
 const duplicate=await call([...args,'--yes','--digest',preview.digest]);assert.equal(duplicate.alreadyApplied,true);
 return applied;
}
const history=result=>evaluationSection(result.outputBytes).value;
const observed=await mutate('capture',w.capture);
const lesson=ref(history(observed).records.find(r=>r.kind==='learning-lesson'));
const proposed=await mutate('propose',w.proposal(lesson),observed);
const proposal=ref(history(proposed).records.find(r=>r.kind==='learning-proposal'));
const bound=await mutate('bind-plan',{proposalRef:proposal,experimentId:w.b.comparison.id,expectedPlanDigest:w.draft.digest,targetCaseIds:['acme-case-0'],controlCaseIds:['acme-case-1'],heldOutCaseIds:[]},proposed);
const planLink=ref(history(bound).records.find(r=>r.kind==='learning-plan-link'));
const registered=await mutate('register-screening',{proposalRef:proposal,planLinkRef:planLink},bound);
const evaluationPlan=ref(history(registered).records.find(r=>r.kind==='learning-evaluation-plan'));
const executions=w.b.comparison.pairs.flatMap(p=>(p.order==='AB'?['baseline','candidate']:['candidate','baseline']).map(arm=>({...w.executionRequest,pairId:p.id,arm})));
const descriptor=join(w.root,'resume.json');await writeFile(descriptor,JSON.stringify({schemaVersion:1,executions}),{flag:'wx',mode:0o600});
const resumeArgs=['retro','evaluations','resume','--experiment',w.b.comparison.id,'--execution',descriptor,...common];
const resumePreview=await call(resumeArgs,3);
const completed=await call([...resumeArgs,'--yes','--digest',resumePreview.digest]);
assert.equal(completed.execution.trials.length,20);
assert.ok(completed.execution.trials.every(t=>t.status==='terminal'));
const result=await mutate('evaluate',{proposalRef:proposal,evaluationPlanRef:evaluationPlan},registered);
assert.equal(result.status,'evaluated');
const evaluation=history(result).records.find(r=>r.kind==='learning-evaluation');
assert.equal(evaluation.data.disposition,'inconclusive');
assert.equal(evaluation.data.attemptRefs.length,20);
const reports=await inventory(join(experiment,'reports'));assert.equal(reports.length,1);
await call(['learn','decide',slug,'accepted','--yes'],2);
const inspected=await call(['learn','evaluate','inspect',slug]);assert.equal(inspected.state,'evaluated');
const revised=await mutate('revise',{supersedesRef:proposal,proposal:{...w.proposal(lesson),hypothesis:'Acme narrower revised hypothesis after inconclusive screening.'},scopeChangeReason:'Acme revision retains the inconclusive result.'},result);
assert.equal(revised.status,'proposed');
assert.deepEqual(history(revised).records.slice(0,history(result).records.length),history(result).records);
assert.deepEqual(await inventory(join(experiment,'reports')),reports);
console.log(JSON.stringify({root:w.root,observations,trials:20,reportFiles:reports.length,disposition:evaluation.data.disposition,finalState:revised.status,efficacy:'unavailable',reportRef:evaluation.data.reportRef}));
