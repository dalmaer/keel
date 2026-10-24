// Controlled Acme CLI walk. Only the external GitHub transport is simulated.
import assert from 'node:assert/strict';
import {writeFile,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {evaluatedLearningWorld} from '../../tests/helpers/evaluated-learning.mjs';
import {evaluationSection,ref} from '../../lib/evaluated-lessons.mjs';
const w=await evaluatedLearningWorld({after(){}});
console.log('Retained private workspace '+w.root);
let n=0;
const cli=join(w.app,'bin/plates.mjs'),slug='2026-10-24-acme';
async function call(args,expected=0){
 const result=spawnSync(process.execPath,[cli,...args,'--json'],{cwd:w.repo,env:w.env,encoding:'utf8',timeout:90000,maxBuffer:2*1024*1024});
 let data;try{data=JSON.parse(result.stdout||result.stderr);}catch{data={stdout:result.stdout,stderr:result.stderr};}
 await writeFile(join(w.root,String(++n).padStart(2,'0')+'-cli.json'),JSON.stringify({args,expected,exit:result.status,signal:result.signal,error:result.error?.message??null,data,stderr:result.stderr},null,2)+'\n',{flag:'wx',mode:0o400});
 assert.equal(result.status,expected,JSON.stringify(data));return data;
}
async function mutate(action,payload,previous=null){
 const request={schemaVersion:1,operationId:randomUUID(),expected:{fileDigest:previous?.outputDigest??null,generation:previous?.generation??0},actor:'Acme owner',at:'2026-10-24T00:00:00.000Z',reason:'Acme controlled CLI verification',action,payload,decisionTarget:{kind:'phase',ref:'1'}};
 const input=join(w.root,request.operationId+'.json');await writeFile(input,JSON.stringify(request),{flag:'wx',mode:0o600});
 const verb=action==='bind-plan'?'plan':action==='reject'?'decide':'propose';
 const args=['learn','evaluate',verb,slug,'--input',input,'--manifest',w.options.manifest,'--state',w.options.state];
 const preview=await call(args,3);
 assert.equal((await call(args,3)).digest,preview.digest);
 await call([...args,'--yes','--digest','0'.repeat(64)],2);
 const applied=await call([...args,'--yes','--digest',preview.digest]);
 assert.equal(applied.written,true);
 const repeated=await call([...args,'--yes','--digest',preview.digest]);assert.equal(repeated.alreadyApplied,true);
 return applied;
}
assert.deepEqual(await readdir(join(w.repo,'docs/inbox')),[]);
const observed=await mutate('capture',w.capture);
const history=evaluationSection(observed.outputBytes).value,lesson=ref(history.records.find(r=>r.kind==='learning-lesson'));
assert.equal(observed.status,'observed');
const proposed=await mutate('propose',w.proposal(lesson),observed);
const old=evaluationSection(proposed.outputBytes).value,proposal=ref(old.records.find(r=>r.kind==='learning-proposal'));
const bound=await mutate('bind-plan',{proposalRef:proposal,experimentId:w.b.comparison.id,expectedPlanDigest:w.draft.digest,targetCaseIds:['acme-case-0'],controlCaseIds:['acme-case-1'],heldOutCaseIds:[]},proposed);
assert.equal(bound.status,'proposed');
await call(['learn','decide',slug,'accepted','--yes'],2);
const revised=await mutate('revise',{supersedesRef:proposal,proposal:{...w.proposal(lesson),hypothesis:'Acme revised testable hypothesis.'},scopeChangeReason:'Acme narrower expectation.'},bound);
const next=evaluationSection(revised.outputBytes).value;
assert.deepEqual(next.records.slice(0,old.records.length),old.records);
assert.equal(next.records.filter(r=>r.kind==='learning-proposal').length,2);
const rejected=await mutate('reject',{evidenceRefs:[lesson]},revised);
assert.equal(rejected.status,'rejected');
const inspected=await call(['learn','evaluate','inspect',slug]);
assert.equal(inspected.state,'rejected');assert.equal(inspected.generation,5);
await call(['learn','evaluate','follow-up',slug],2);
const retained=await readFile(join(w.repo,'docs/inbox',slug+'.md'),'utf8');
assert.equal(retained,rejected.outputBytes);
const ledger=await w.load('evaluation-ledger');
const execution=await ledger.evaluations({...w.options,action:'inspect',experiment:w.b.comparison.id});
assert.equal(execution.execution,null);
console.log(JSON.stringify({root:w.root,observations:n,generation:inspected.generation,status:inspected.state,executions:0,efficacy:'unavailable'}));
