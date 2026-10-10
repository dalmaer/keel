import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {run} from './helpers/run.mjs';
import {evaluateTimeEvidence,validateTimeTransition} from '../practices/night/files/scripts/keel/time-measures.mjs';
import {digest,nodePlan,suiteCollector} from '../practices/night/files/scripts/keel/time-receipts.mjs';
import {flagsIn,shellWords,readRuns,retainedRecords,RETENTION} from '../practices/night/files/scripts/keel/test-ledger.mjs';
const T=Date.parse('2026-10-10T12:00:00Z'),DAY=86400000,sha='a'.repeat(40);
const quiet={start:{load:[0],cores:4},end:{load:[0],cores:4}};
const inv=file=>({file,hierarchy:['Acme'],occurrence:1,type:'test',outcome:'pass'});
function suite(a=9000,b=1000) {return {version:1,complete:true,inventoryComplete:true,expectedFiles:['tests/acme.test.mjs','tests/other.test.mjs'],observedSummaries:[{file:'tests/acme.test.mjs',durationMs:a,success:true},{file:'tests/other.test.mjs',durationMs:b,success:true}],aggregate:{durationMs:10000,success:true},executionSettings:{isolation:'process',concurrency:'2',selection:['tests/*.test.mjs'],flagsHash:'acme',filtered:false},observedInventory:[inv('tests/acme.test.mjs'),inv('tests/other.test.mjs')],commandHash:'acmecommand'};}
function record(days,i=0,ms=1000){return {id:`acme-${days}-${i}`,date:new Date(T-days*DAY-i).toISOString(),commit:sha,dirty:false,completed:true,dir:'.',runner:'node',config:'acmeconfig',flags:[],machine:{os:'linux',arch:'x64',cpus:4},busy:quiet,suite:suite(),tests:[{file:'tests/acme.test.mjs',name:'Acme',outcome:'pass',ms}]};}
const evaluate=(measure,runs,more={})=>evaluateTimeEvidence({measure,runs,at:T,...more});
test('time measures require explicit quiet context and separated bounded timing windows',()=>{
 const rs=[30,31,32,33,34].map((d,i)=>record(d,i,100));rs.push(...[1,2,3,4,5].map((d,i)=>record(d,i,500)));
 const r=evaluate('time_creep',rs);assert.equal(r.state,'outside');assert.equal(r.baseline.value,100);assert.equal(r.timeCandidates.length,1);
 for(const edit of [r=>delete r.busy,r=>r.busy={...quiet,end:{load:[5],cores:4}},r=>r.filtered=true,r=>r.completed=false,r=>r.date=new Date(T+1).toISOString(),r=>r.config='other']){
  const changed=structuredClone(rs);changed.slice(5).forEach(edit);assert.equal(evaluate('time_creep',changed).state,'unavailable');
 }
 assert.equal(evaluate('time_creep',rs.map(r=>({...r,tests:r.tests.map(t=>({...t,ms:200}))}))).state,'inside');
});
test('gate time needs actual outer configured provenance and full baseline bins or explicit bound',()=>{
 const gate=(days,i=0)=>({...record(days,i),kind:'gate',runner:'gate',gateSource:'configured-check',commandHash:'acmegate',ms:2000,status:0,invocationId:`acme-${days}-${i}`,provenance:{source:'outer-launcher',invocationId:`acme-${days}-${i}`,outerCommandHash:'acmegate'}});
 const recent=[gate(1),gate(1,1),gate(2)];assert.equal(evaluate('gate_time',recent).state,'unavailable');
 assert.equal(evaluate('gate_time',recent,{gateBoundMs:1000}).state,'outside');
 const old=[...Array(4)].flatMap((_,i)=>[0,1,2].map(n=>({...gate(8+i*7+n),ms:1000})));
 assert.equal(evaluate('gate_time',[...old,...recent]).state,'outside');
 for(const bad of ['explicit-command','legacy'])assert.equal(evaluate('gate_time',recent.map(r=>({...r,gateSource:bad})),{gateBoundMs:1000}).state,'unavailable');
 assert.equal(evaluate('gate_time',recent.map(({provenance,...r})=>r),{gateBoundMs:1000}).state,'unavailable');
 assert.equal(evaluate('gate_time',recent.map(r=>({...r,status:1})),{gateBoundMs:1000}).state,'unavailable');
});
test('critical file uses per-file and aggregate durations, freezes every inventory, and never sums children',()=>{
 const rs=[1,2,3].map(d=>record(d));const r=evaluate('critical_file',rs);assert.equal(r.state,'outside');assert.equal(r.baseline.observations.length,3);assert.deepEqual(r.timeCandidates[0].candidate.rubric.ownerBlockers,[]);assert.match(r.timeCandidates[0].candidate.rubric.acceptance,/After building the PR/);
 assert.equal(evaluate('critical_file',rs.map(r=>({...r,suite:suite(9000,9000)}))).state,'inside');
 for(const edit of [r=>delete r.suite,r=>r.suite.expectedFiles.pop(),r=>r.suite.observedSummaries.push(r.suite.observedSummaries[0]),r=>r.suite.aggregate.success=false,r=>r.suite.executionSettings.isolation='none']) {const copy=structuredClone(rs);copy.forEach(edit);assert.equal(evaluate('critical_file',copy).state,'unavailable');}
 const c={instanceId:'acme',identity:r.identity,baseline:r.baseline,threshold:r.threshold,mergeTime:new Date(T-6*DAY).toISOString(),mergeSha:sha,eligibleRevisionShas:[sha]};
 assert.equal(evaluate('critical_file',rs,{comparison:c}).state,'outside');
 const lost=structuredClone(rs);lost.forEach(r=>r.suite.observedInventory.pop());assert.equal(evaluate('critical_file',lost,{comparison:c}).state,'unavailable');
 const disagreed=structuredClone(c);disagreed.baseline.observations[0].suite.observedInventory[0].hierarchy=['different'];assert.equal(validateTimeTransition(disagreed,rs).ok,false);
});
test('critical reviewed mappings are exhaustive and compare whole successor suites without a faster claim',()=>{
 const original=[1,2,3].map(d=>record(d));const found=evaluate('critical_file',original);const rs=structuredClone(original);
 rs.forEach(r=>{r.suite.expectedFiles=['tests/left.test.mjs','tests/other.test.mjs'];r.suite.observedSummaries=[{file:'tests/left.test.mjs',durationMs:4500,success:true},{file:'tests/other.test.mjs',durationMs:4500,success:true}];r.suite.observedInventory=[inv('tests/left.test.mjs'),inv('tests/other.test.mjs')];});
 const strip=({outcome,...t})=>t;
 const c={instanceId:'acme',identity:found.identity,baseline:found.baseline,threshold:found.threshold,mergeTime:new Date(T-6*DAY).toISOString(),mergeSha:sha,eligibleRevisionShas:[sha]};
 c.transition={instanceId:'acme',reviewedAt:new Date(T-5*DAY).toISOString(),pr:{headSha:sha,mergeSha:sha},fromIdentity:c.identity,toIdentity:c.identity,testMapping:[{from:strip(inv('tests/acme.test.mjs')),to:[strip(inv('tests/left.test.mjs'))]},{from:strip(inv('tests/other.test.mjs')),to:[strip(inv('tests/other.test.mjs'))]}],executionSettings:{before:original[0].suite.executionSettings,after:rs[0].suite.executionSettings}};
 const r=evaluate('critical_file',rs,{comparison:c});assert.equal(r.state,'inside');assert.match(r.suiteWall.note,/does not establish faster/);
 const reorder=v=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).reverse().map(([k,v])=>[k,reorder(v)])):v;assert.equal(evaluate('critical_file',rs,{comparison:reorder(c)}).state,'inside','object key order is not execution identity');
 for(const mutate of [t=>t.testMapping.pop(),t=>t.pr.mergeSha='b'.repeat(40),t=>t.instanceId='wrong',t=>t.testMapping.push(t.testMapping[0])]){const bad=structuredClone(c);mutate(bad.transition);assert.equal(evaluate('critical_file',rs,{comparison:bad}).state,'unavailable');}
 const skip=structuredClone(rs);skip[0].suite.observedInventory[0].outcome='skip';assert.equal(evaluate('critical_file',skip,{comparison:c}).state,'unavailable');
});
test('inconclusive share classifies pass fail and inconclusive only, with count and date minima',()=>{
 const rs=Array.from({length:10},(_,i)=>record(1+i%3,i));rs.forEach((r,i)=>r.tests[0].outcome=i<5?'inconclusive':'fail');
 assert.equal(evaluate('inconclusive_share',rs).state,'outside');rs[0].tests[0].outcome='skip';assert.equal(evaluate('inconclusive_share',rs).state,'unavailable');
});
test('typed stalls and local workarounds do not invent timing lanes and require verified receipts',()=>{
 const identity={kind:'stalls',scope:'.',runner:'node',configHash:'acme',flagsHash:'acme',target:{file:'tests/acme.test.mjs',name:'Acme'}};
 const receipt={id:'acme',version:1,identity,revision:sha,clean:true,complete:true,completedAt:new Date(T-DAY).toISOString(),verifiedInjected:true,pauses:1,seed:42,pinned:false,plain:'pass',stalled:'fail'};
 assert.equal(evaluate('wall_clock_tests',[],{stallsReceipts:[receipt]}).state,'outside');
 assert.equal(evaluate('wall_clock_tests',[],{stallsReceipts:[{...receipt,verifiedInjected:false}]}).state,'unavailable');
 const found=evaluate('wall_clock_tests',[],{stallsReceipts:[receipt]});assert.equal(found.baseline.observations[0].seed,42);assert.deepEqual(found.baseline.observations[0].identity,identity);assert.match(found.timeCandidates[0].candidate.remeasureCommand,/--seed 42 --name/);assert.ok(found.timeCandidates[0].candidate.remeasureCommand.includes(identity.target.name));const rs=[1,2,3].map(d=>({...receipt,id:`acme${d}`,completedAt:new Date(T-d*DAY).toISOString(),pinned:true,stalled:'pass'}));
 assert.equal(evaluate('wall_clock_tests',[],{stallsReceipts:rs,comparison:{...found,mergeTime:new Date(T-5*DAY).toISOString(),mergeSha:sha,eligibleRevisionShas:[sha]}}).state,'inside');
 const obs=[1,2].map(i=>({id:`acme${i}`,date:new Date(T-i*DAY).toISOString(),validated:true,identity:{kind:'file',id:'tests/acme.test.mjs'}}));
 const local={available:true,scope:'.',observations:obs,coverage:{state:'partial'}};
 const result=evaluate('worked_around',[],{localWorkarounds:local});assert.equal(result.state,'outside');assert.equal(result.identity.kind,'local-workaround');assert.equal('machineClass' in result.identity,false);
 assert.equal(evaluate('worked_around',[],{localWorkarounds:{...local,observations:obs.slice(0,1)}}).state,'unavailable');
});
test('retention samples quiet weeks by stable IDs, reserves recency, and discloses hard caps',()=>{
 const rows=Array.from({length:240},(_,i)=>({name:`acme-${i}`,run:record(1+i%50,i),bytes:100}));
 const a=retainedRecords(rows,{now:T}), b=retainedRecords(rows.map(r=>({...r,run:{...r.run,tests:[{outcome:'fail',ms:999}]}})),{now:T});
 assert.deepEqual(a.names,b.names);assert.ok(a.names.length>50);assert.equal(a.coverage.sampled,true);
 const pressured=retainedRecords(rows,{now:T,limits:{...RETENTION,bytes:300}});assert.equal(pressured.names.length,3);assert.ok(pressured.coverage.pressureLosses>0);
});
test('actual outer launcher resolves expected files before Node executes and persists complete file summaries',async t=>{
 const root=await mkdtemp(join(tmpdir(),'acme-time-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'.keel'));await mkdir(join(root,'tests'));
 const ledger=resolve('practices/night/files/scripts/keel/test-ledger.mjs');
 const command=`node --test --test-reporter=${JSON.stringify(ledger)} tests/*.test.mjs`;
 await writeFile(join(root,'package.json'),JSON.stringify({scripts:{test:command}}));await writeFile(join(root,'.keel/keel.json'),JSON.stringify({check:command}));
 for(const file of ['a','b'])await writeFile(join(root,`tests/${file}.test.mjs`),`import {test} from 'node:test'; test('Acme',()=>{});`);
 const r=run(process.execPath,[ledger,'--gate'],{cwd:root});assert.equal(r.status,0,r.stdout+r.stderr);
 const {runs}=await readRuns(root,undefined,{gates:true});const testRun=runs.find(r=>r.kind!=='gate');assert.ok(testRun,JSON.stringify(runs));
 assert.equal(testRun.suite.complete,true,JSON.stringify(testRun.suite));assert.equal(testRun.suite.observedSummaries.length,2);assert.equal(testRun.suite.aggregate.success,true);assert.equal(testRun.suite.inventoryComplete,true,JSON.stringify(testRun.suite));
 const gate=runs.find(r=>r.kind==='gate');assert.equal(gate.provenance.source,'outer-launcher');assert.equal(testRun.parentInvocationId,gate.invocationId);
});

test('literal Node plans omit dynamic discovery, outside files, narrowed and nonisolated coverage',async t=>{
 const root=await mkdtemp(join(tmpdir(),'acme-plan-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'tests'));await writeFile(join(root,'tests/acme.test.mjs'),'');
 for(const script of ['node helper.mjs --test','node --test','node --test $(find tests)','node --test ../other.mjs','node --test tests/*.test.mjs && echo Acme'])assert.equal((await nodePlan({root,script,words:shellWords,flags:flagsIn})).available,false,script);
 const plan=await nodePlan({root,script:'node --test tests/*.test.mjs',words:shellWords,flags:flagsIn});assert.equal(plan.available,true);assert.deepEqual(plan.expectedFiles,['tests/acme.test.mjs']);
 const finish=(p,events)=>{const c=suiteCollector({root,plan:p,flagsHash:p.executionSettings.flagsHash});events.forEach(e=>c.push(e));return c.finish();};
 const summary=file=>({type:'test:summary',data:{...(file?{file:join(root,file)}:{}),duration_ms:2,success:true,counts:{tests:0,suites:0}}});
 const events=[summary('tests/acme.test.mjs'),summary()];assert.equal(finish(plan,events).complete,true);
 for(const events0 of [events.slice(0,1),[...events,summary('tests/acme.test.mjs')],[summary('tests/other.test.mjs'),summary()]])assert.equal(finish(plan,events0).complete,false);
 for(const key of ['filtered','isolation']){const p=structuredClone(plan);p.executionSettings[key]=key==='filtered'?true:'none';assert.equal(finish(p,events).complete,false);}
});
test('concurrent parent identities use explicit lineage; duplicate names never use completion order',async t=>{
 const root=await mkdtemp(join(tmpdir(),'acme-lineage-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'.keel'));await mkdir(join(root,'tests'));
 const ledger=resolve('practices/night/files/scripts/keel/test-ledger.mjs');const script=`node --test --test-reporter=${JSON.stringify(ledger)} tests/*.test.mjs`;
 await writeFile(join(root,'package.json'),JSON.stringify({scripts:{test:script}}));await writeFile(join(root,'.keel/keel.json'),JSON.stringify({check:script}));
 await writeFile(join(root,'tests/acme.test.mjs'),`import {test} from 'node:test'; await Promise.all(['Acme left','Acme right'].map(n=>test(n,{concurrency:true},async t=>{await t.test('shared name',()=>{});})));`);
 assert.equal(run(process.execPath,[ledger,'--gate'],{cwd:root}).status,0);
 let r=(await readRuns(root)).runs.at(-1);assert.equal(r.suite.inventoryComplete,true,JSON.stringify(r.suite));assert.ok(r.suite.observedInventory.some(t=>sameArray(t.hierarchy,['Acme left','shared name'])));assert.ok(r.suite.observedInventory.some(t=>sameArray(t.hierarchy,['Acme right','shared name'])));
 await writeFile(join(root,'tests/acme.test.mjs'),`import {test} from 'node:test'; test('Acme',()=>{});test('Acme',()=>{});`);
 assert.equal(run(process.execPath,[ledger,'--gate'],{cwd:root}).status,0);r=(await readRuns(root)).runs.at(-1);assert.equal(r.suite.complete,true);assert.equal(r.suite.inventoryComplete,false);assert.match(r.suite.inventoryProblems.join(' '),/ambiguous/);
});
const sameArray=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

test('nested explicit wrapper links to one actual configured outer gate; stale inherited labels confer none',async t=>{
 const root=await mkdtemp(join(tmpdir(),'acme-outer-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'.keel'));
 const ledger=resolve('practices/night/files/scripts/keel/test-ledger.mjs');const inner=`node ${JSON.stringify(ledger)} --run "node -e 'process.exit(0)'"`;
 await writeFile(join(root,'.keel/keel.json'),JSON.stringify({check:inner}));
 const r=run(process.execPath,[ledger,'--gate'],{cwd:root,env:{...process.env,KEEL_GATE_ACTIVE:root,KEEL_GATE_INVOCATION:'00000000-0000-0000-0000-000000000000'}});assert.equal(r.status,0,r.stderr);
 let gates=(await readRuns(root,undefined,{gates:true})).runs;assert.equal(gates.length,1);assert.equal(gates[0].gateSource,'configured-check');assert.ok(gates[0].provenance.innerPayloadHash);
 assert.equal(run(process.execPath,[ledger,'--run',inner],{cwd:root}).status,0);gates=(await readRuns(root,undefined,{gates:true})).runs;assert.equal(gates.length,2);assert.equal(gates.at(-1).gateSource,'explicit-command');
});

test('remeasurement requires explicit verified ancestry, postmerge dates and frozen numerical bounds',()=>{
 const rs=[1,2,3,4,5].map(d=>record(d,0,100));const original=[30,31,32,33,34].map(d=>record(d,0,100));const found=evaluate('time_creep',[...original,...rs.map(r=>({...r,tests:r.tests.map(t=>({...t,ms:500}))}))]);
 const c={...found,instanceId:'acme',mergeTime:new Date(T-6*DAY).toISOString(),mergeSha:sha,eligibleRevisionShas:[sha]};
 assert.equal(evaluate('time_creep',rs,{comparison:c}).state,'inside');
 for(const change of [{eligibleRevisionShas:undefined},{eligibleRevisionShas:[]},{mergeTime:new Date(T-DAY).toISOString()}])assert.equal(evaluate('time_creep',rs,{comparison:{...c,...change}}).state,'unavailable');
});

test('new nested inventories and stalls targets redact configured secrets and refuse changed identities',async t=>{
 const root=await mkdtemp(join(tmpdir(),'acme-secret-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'.keel'));await mkdir(join(root,'tests'));
 const ledger=resolve('practices/night/files/scripts/keel/test-ledger.mjs'),script=`node --test --test-reporter=${JSON.stringify(ledger)} tests/*.test.mjs`;
 await writeFile(join(root,'package.json'),JSON.stringify({scripts:{test:script}}));await writeFile(join(root,'.keel/keel.json'),JSON.stringify({check:script,tests:{configEnv:['ACME_AUTH']}}));
 await writeFile(join(root,'tests/acme.test.mjs'),`import {test} from 'node:test'; test('Acme parent',async t=>{await t.test('Acme '+process.env.ACME_AUTH,()=>{});});`);
 const env={...process.env,ACME_AUTH:'acme-sensitive-nested-name'};
 assert.equal(run(process.execPath,[ledger,'--gate'],{cwd:root,env}).status,0);
 const {runs}=await readRuns(root,undefined,{gates:true});const found=runs.find(r=>r.kind!=='gate');
 assert.equal(JSON.stringify(runs).includes(env.ACME_AUTH),false);assert.equal(found.suite.complete,true);assert.equal(found.suite.inventoryComplete,false);assert.match(found.suite.inventoryProblems.join(' '),/redacted/);
 // Fresh keel test also persists safe targets, not its raw runner names.
 await writeFile(join(root,'tests/acme.test.mjs'),`import {test} from 'node:test'; test('Acme '+process.env.ACME_AUTH,()=>{});`);
 for(const args of [['init','-q'],['add','.'],['commit','-qm','Acme']])assert.equal(run('git',args,{cwd:root}).status,0);
 const r=run(process.execPath,[resolve('bin/keel.mjs'),'test','tests/acme.test.mjs','--stalls','--seed','42','--json'],{cwd:root,env});assert.equal(r.status,0,r.stderr+r.stdout);
 const all=(await readRuns(root,undefined,{gates:true,stalls:true})).runs;const stalled=all.find(r=>r.kind==='stalls');assert.ok(stalled,r.stdout+r.stderr);assert.equal(JSON.stringify(stalled).includes(env.ACME_AUTH),false);assert.ok(stalled.stallsReceipts.every(r=>r.complete===false));
});

test('stalls skipped todo and inconclusive pairs never establish an inside verdict',()=>{
 const identity={kind:'stalls',scope:'.',runner:'node',configHash:'acme',flagsHash:'acme',target:{file:'tests/acme.test.mjs',name:'Acme'}};
 const base={id:'acme',version:1,identity,revision:sha,clean:true,complete:true,completedAt:new Date(T-DAY).toISOString(),verifiedInjected:true,pauses:1,seed:42,pinned:false,plain:'pass',stalled:'fail'};
 const found=evaluate('wall_clock_tests',[],{stallsReceipts:[base]});
 const c={...found,mergeTime:new Date(T-6*DAY).toISOString(),mergeSha:sha,eligibleRevisionShas:[sha]};
 for(const outcome of ['skip','todo','inconclusive']) {
  const receipts=[1,2,3].map(d=>({...base,id:`acme${d}`,completedAt:new Date(T-d*DAY).toISOString(),stalled:outcome}));
  assert.equal(evaluate('wall_clock_tests',[],{stallsReceipts:receipts}).state,'unavailable',outcome);
  assert.equal(evaluate('wall_clock_tests',[],{stallsReceipts:receipts,comparison:c}).state,'unavailable',outcome);
 }
});
test('postmerge target dates exclude missing unclassified and duplicate target observations',()=>{
 for(const measure of ['time_creep','inconclusive_share']) {
  const original=[30,31,32,33,34].map(d=>record(d,0,100)), recent=Array.from({length:10},(_,i)=>record(1+i%3,i,500));
  if(measure==='inconclusive_share')recent.forEach(r=>r.tests[0].outcome='inconclusive');
  const found=evaluate(measure,[...original,...recent]);assert.equal(found.state,'outside');
  const c={...found,mergeTime:new Date(T-6*DAY).toISOString(),mergeSha:sha,eligibleRevisionShas:[sha]};
  const atOneDate=Array.from({length:10},(_,i)=>record(1,i,100));
  for(const missing of [[],[{file:'tests/acme.test.mjs',name:'Acme',outcome:'skip',ms:1}],[{file:'tests/acme.test.mjs',name:'Acme',outcome:'pass',ms:1},{file:'tests/acme.test.mjs',name:'Acme',outcome:'pass',ms:1}]]) {
   const rs=[...atOneDate,...[2,3].map(d=>({...record(d),tests:missing}))];
   assert.equal(evaluate(measure,rs,{comparison:c}).state,'unavailable',JSON.stringify(missing));
  }
 }
});
test('critical target rename validates successor lane target while preserving the frozen mapping anchor',()=>{
 const original=[1,2,3].map(d=>record(d));const found=evaluate('critical_file',original),rs=structuredClone(original);
 rs.forEach(r=>{r.suite.expectedFiles[0]='tests/renamed.test.mjs';r.suite.observedSummaries[0].file='tests/renamed.test.mjs';r.suite.observedSummaries[0].durationMs=3000;r.suite.observedInventory[0].file='tests/renamed.test.mjs';});
 const id=({...inv('tests/acme.test.mjs')});delete id.outcome;
 const other={...inv('tests/other.test.mjs')};delete other.outcome;
 const toIdentity={...found.identity,target:{file:'tests/renamed.test.mjs'}};
 const c={instanceId:'acme',identity:found.identity,baseline:found.baseline,threshold:found.threshold,mergeTime:new Date(T-6*DAY).toISOString(),mergeSha:sha,eligibleRevisionShas:[sha],transition:{instanceId:'acme',reviewedAt:new Date(T-5*DAY).toISOString(),pr:{headSha:sha,mergeSha:sha},fromIdentity:found.identity,toIdentity,testMapping:[{from:id,to:[{...id,file:'tests/renamed.test.mjs'}]},{from:other,to:[other]}],executionSettings:{before:original[0].suite.executionSettings,after:rs[0].suite.executionSettings}}};
 assert.equal(evaluate('critical_file',rs,{comparison:c}).state,'inside');assert.equal(c.identity.target.file,'tests/acme.test.mjs');
 assert.equal(evaluate('critical_file',rs,{comparison:{...c,transition:{...c.transition,toIdentity:{...toIdentity,configHash:'other'}}}}).state,'unavailable');
});

test('postmerge gate comparison uses newest three verified outer gates and their dates',()=>{
 const gate=(d,ms)=>({...record(d),kind:'gate',runner:'gate',gateSource:'configured-check',commandHash:'acmegate',ms,status:0,invocationId:`acme-${d}`,provenance:{source:'outer-launcher',invocationId:`acme-${d}`,outerCommandHash:'acmegate'}});
 const found=evaluate('gate_time',[gate(1,2000),gate(2,2000),gate(3,2000)],{gateBoundMs:1250});
 const comparison={...found,mergeTime:new Date(T-8*DAY).toISOString(),mergeSha:sha,eligibleRevisionShas:[sha]};
 for(const [recent,older,state] of [[1000,2000,'inside'],[2000,1000,'outside']]){
  const runs=[1,2,3,4,5,6,6.5].map(d=>gate(d,d<=3?recent:older));const r=evaluate('gate_time',runs,{comparison});assert.equal(r.state,state);assert.equal(r.value,recent);assert.equal(r.coverage.eligible,3);
 }
 assert.equal(evaluate('gate_time',[1,2,3].map(d=>({...gate(d,1000),provenance:{...gate(d,1000).provenance,outerCommandHash:'acme-other'}})),{comparison}).state,'unavailable');
 assert.equal(evaluate('gate_time',[1,1.01,1.02,3].map(d=>gate(d,1000)),{comparison}).state,'unavailable');
});
