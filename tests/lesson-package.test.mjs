import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {screeningWorld,syntheticTerminalReceipts} from './helpers/lesson-screening.mjs';
import {evaluationSection,ref,validateRequest} from '../lib/evaluated-lessons.mjs';
import {fingerprint,canonical,byteDigest} from '../lib/evaluation-records.mjs';
import {validatePublicPackage} from '../lib/evaluated-learning-package.mjs';
async function evaluated(t){const w=await screeningWorld(t);await syntheticTerminalReceipts(w);const applied=(await w.call('evaluate',{proposalRef:w.proposalRef,evaluationPlanRef:w.evaluationPlanRef},{previous:w.registered,apply:true})).result;const history=evaluationSection(applied.outputBytes).value,evaluation=history.records.find(r=>r.kind==='learning-evaluation');return {...w,applied,history,evaluation};}
test('Acme package is deterministic read-only allowlisted evidence, record and follow-up preserve unknown exposure',async t=>{
  const w=await evaluated(t),module=await w.load('evaluated-learning'),args={...w.options,dir:w.repo,env:w.env,slug:'2026-10-24-acme',action:'package'},before=await readFile(join(w.repo,'docs/inbox/2026-10-24-acme.md'));
  const pack=await module.evaluatedLearning(args),again=await module.evaluatedLearning(args);assert.deepEqual(pack,again);validatePublicPackage(pack.payload);assert.equal(pack.payloadDigest,fingerprint(pack.payload));assert.equal(pack.publicJson,canonical(pack.payload)+'\n');assert.equal(pack.artifact.byteDigest,byteDigest(pack.publicJson));assert.equal(pack.artifact.byteLength,Buffer.byteLength(pack.publicJson));assert.equal(pack.readiness.eligible,false);assert.equal(pack.payload.disposition,'inconclusive');assert.ok(pack.payload.inverse.available);assert.ok(!pack.publicJson.includes(w.root));assert.ok(!pack.publicJson.includes('console.log('));assert.deepEqual(await readFile(join(w.repo,'docs/inbox/2026-10-24-acme.md')),before);assert.equal((await readdir(join(w.dir,'reports'))).length,1);
  const recorded=(await w.call('record-package',{proposalRef:w.proposalRef,evaluationRef:ref(w.evaluation)},{previous:w.applied,apply:true})).result,record=evaluationSection(recorded.outputBytes).value.records.at(-1);assert.equal(record.kind,'learning-review-package');
  await assert.rejects(w.call('ready',{proposalRef:w.proposalRef,packageRef:ref(record)},{previous:recorded}),/readiness_unavailable/);
  const followed=(await w.call('follow-up',{proposalRef:w.proposalRef,decisionRef:ref(w.evaluation),window:{start:'2026-10-24T00:00:00.000Z',end:'2026-10-24T01:00:00.000Z'},selections:[],commentary:{text:'Acme eligible exposure unknown.',actor:'Acme owner',attribution:'manual'},relation:null},{previous:recorded,apply:true})).result;
  const f=evaluationSection(followed.outputBytes).value.records.at(-1);assert.equal(f.kind,'learning-follow-up');assert.equal(f.data.coverage,'unmeasured');for(const k of ['eligibleExposure','recurrenceRate','costChange','latencyChange','helpChange'])assert.equal(f.data[k],null);
  const revised=(await w.call('revise',{supersedesRef:w.proposalRef,proposal:{...w.proposal(w.lessonRef),hypothesis:'Acme changed hypothesis after observed result.'},scopeChangeReason:'Acme narrower scope.'},{previous:followed,apply:true})).result;assert.equal(revised.status,'proposed');assert.deepEqual(evaluationSection(revised.outputBytes).value.records.slice(0,-1),evaluationSection(followed.outputBytes).value.records);
});
test('Acme package schema refuses nested fields and caller-ready flags',async t=>{const w=await evaluated(t),m=await w.load('evaluated-learning'),p=await m.evaluatedLearning({...w.options,dir:w.repo,env:w.env,slug:'2026-10-24-acme',action:'package'});const changed=structuredClone(p.payload);changed.mapping.entries[0].approved=true;assert.throws(()=>validatePublicPackage(changed));const request={schemaVersion:1,operationId:'e1a5ac91-1d10-4dee-a7c7-aab394fef3d0',expected:{fileDigest:w.applied.outputDigest,generation:w.applied.generation},actor:'Acme',at:'2026-10-24T00:00:00.000Z',reason:'Acme',decisionTarget:{kind:'phase',ref:'1'},action:'ready',payload:{proposalRef:w.proposalRef,packageRef:ref(w.evaluation),ready:true}};assert.throws(()=>validateRequest(request));});

test('Acme differing tested overlay cannot establish installed base; binary prior bytes retain exact size with inverse unavailable',async t=>{
  const {promotionWorld}=await import('./helpers/lesson-promotion.mjs');
  for(const [baselineContent,gitBefore,baseMatches]of [['Acme overlay\n','Acme installed\n',false],['Acme\0binary','Acme\0binary',true]]){
    const w=await promotionWorld(t,{worldOptions:{baselineContent,gitBefore}}),pack=await w.learning.evaluatedLearning(w.packageOptions),entry=pack.payload.mapping.entries[0];
    assert.equal(entry.before.byteLength,Buffer.byteLength(gitBefore));assert.equal(entry.before.byteDigest,byteDigest(gitBefore));assert.equal(entry.baseMatches,baseMatches);assert.equal(pack.payload.inverse.available,false);assert.ok(pack.readiness.gaps.includes('inverse_unavailable'));
  }
});
