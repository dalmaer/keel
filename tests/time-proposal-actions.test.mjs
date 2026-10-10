import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { makeTimeProposal,formatTimeProposal,writeHealthReport,parseTimeProposal } from '../practices/night/files/scripts/keel/time-proposals.mjs';
import { robotAssociation } from '../practices/night/files/scripts/keel/robot-delivery.mjs';
import { decideTimeProposal,remeasureTimeProposal } from '../lib/time-proposal-actions.mjs';
import { render } from '../lib/practices.mjs';
import { run } from './helpers/run.mjs';
import { evaluateTimeEvidence } from '../practices/night/files/scripts/keel/time-measures.mjs';
import { timeEvidence } from './fixtures/improve/time-evidence.mjs';
const repo='acme/anvils',at='2026-10-10T12:00:00Z',path='docs/health/2026-10-10.md';
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
async function fixture(t,on=false){
 const root=await mkdtemp(join(tmpdir(),'acme-time-action-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'.keel'));await writeFile(join(root,'.keel/keel.json'),JSON.stringify({repo,robot:{on,budgetMinutes:60}}));
 git(root,'init','-q','-b','main');git(root,'add','.');git(root,'commit','-qm','Acme baseline');const base=git(root,'rev-parse','HEAD');
 const proposal=makeTimeProposal({measure:'critical_file',identity:{kind:'timing',scope:'.',runner:'node',configHash:'acme-config',flagsHash:'acme-flags',machineClass:'acme-machine',commandHash:'acme-command',target:'tests/acme.test.mjs'},candidate:{title:'Split Acme slow test',rubric:{version:1,problem:'Acme file dominates',reproduction:'npm test',acceptance:'complete successor suite inside frozen bound',change:'split independent Acme cases',prerequisites:[],ownerBlockers:[]},remeasureCommand:'keel improve --json'},baseline:{windowStart:'2026-10-01T00:00:00Z',windowEnd:'2026-10-08T00:00:00Z',value:2000,unit:'ms',runIds:['acme-run'],revisionShas:[base]},threshold:{contractVersion:1,rule:'critical_file',parameters:{share:0.8}},coverage:{retained:3,eligible:3,omitted:0,dates:['2026-10-07','2026-10-08'],sampled:true,gaps:[]},at});
 await writeHealthReport({root,path,generated:'# Acme health\n\n## Proposal\n\n'+formatTimeProposal(proposal)});
 let issue=null,posts=0,failRead=false,dropLabels=false;
 const github=async r=>{
   assert.ok(r.path.startsWith(`/repos/${repo}/`));
   if(r.method==='POST'){
     assert.equal(r.path,`/repos/${repo}/issues`);posts++;
     const saved=parseTimeProposal(await readFile(join(root,path),'utf8')).proposal;assert.equal(saved.lifecycle.state,'accepting','local intent precedes remote POST');
     issue={number:7,state:'open',html_url:`https://github.com/${repo}/issues/7`,url:`https://api.github.com/repos/${repo}/issues/7`,body:r.body.body,labels:dropLabels?[]:r.body.labels};
     if(failRead)throw new Error('Acme lost POST response');return {status:201,data:issue};
   }
   if(failRead&&issue)return {status:503};
   if(r.path.includes('/issues?'))return {status:200,data:issue?[issue]:[]};
   if(r.path.endsWith('/issues/7'))return {status:200,data:issue};
   throw new Error('unexpected Acme API '+r.path);
 };
 return {root,proposal,base,github,get issue(){return issue;},get posts(){return posts;},set failRead(v){failRead=v;},set dropLabels(v){dropLabels=v;}};
}
test('time acceptance persists intent before POST and resumes uncertain issue creation without duplicate',async t=>{
 const f=await fixture(t);f.failRead=true;
 const args={root:f.root,path,expectedInstance:f.proposal.instanceId,decision:'accept',at,github:f.github};
 let r=await decideTimeProposal(args);assert.equal(r.decision,'accepting');assert.equal(f.posts,1);
 f.failRead=false;r=await decideTimeProposal(args);assert.equal(r.decision,'accepted');assert.equal(r.issue.repo,repo);assert.deepEqual(f.issue.labels,[]);assert.equal(f.posts,1);
 const retry=await decideTimeProposal(args);assert.equal(retry.decision,'accepted');assert.equal(f.posts,1);assert.deepEqual(retry.proposal.baseline,f.proposal.baseline);
});
test('time acceptance unqueued retains verified issue and waits for owner without restoring label',async t=>{
 const f=await fixture(t,true);f.dropLabels=true;
 const args={root:f.root,path,expectedInstance:f.proposal.instanceId,decision:'accept',at,github:f.github};
 const first=await decideTimeProposal(args);assert.equal(first.state,'unqueued');assert.equal(first.proposal.lifecycle.state,'accepting');assert.equal(first.issue.number,7);
 await writeHealthReport({root:f.root,path,generated:'# Acme refreshed report\n\n## Proposal\n'+formatTimeProposal(f.proposal)});
 const retained=parseTimeProposal(await readFile(join(f.root,path),'utf8')).proposal;assert.equal(retained.lifecycle.state,'accepting');assert.equal(retained.lifecycle.issue.number,7);
 const again=await decideTimeProposal(args);assert.equal(again.state,'unqueued');assert.equal(f.posts,1);
 f.issue.labels=['keel:agent'];const ready=await decideTimeProposal(args);assert.equal(ready.state,'recovered');assert.equal(ready.proposal.lifecycle.state,'accepted');assert.equal(f.posts,1);
});
test('time decisions bind instance and local health path before any issue write',async t=>{
 const f=await fixture(t),args={root:f.root,path,decision:'accept',at,github:f.github};
 await assert.rejects(decideTimeProposal(args),/instance/);await assert.rejects(decideTimeProposal({...args,expectedInstance:'b'.repeat(64)}),/stale/);
 await assert.rejects(decideTimeProposal({...args,path:'outside.md',expectedInstance:f.proposal.instanceId}),/health directory/);assert.equal(f.posts,0);
 const declined=await decideTimeProposal({...args,expectedInstance:f.proposal.instanceId,decision:'decline',reason:'Acme owner declined'});assert.equal(declined.decision,'declined');assert.equal(f.posts,0);
});
test('time remeasurement verifies fresh merge local ancestry and reviewed full test mapping before evaluation',async t=>{
 const f=await fixture(t);const accepted=await decideTimeProposal({root:f.root,path,expectedInstance:f.proposal.instanceId,decision:'accept',at,github:f.github});
 await writeFile(join(f.root,'acme.txt'),'Acme fixed');git(f.root,'add','.');git(f.root,'commit','-qm','Acme merge');const merge=git(f.root,'rev-parse','HEAD');
 const pr={number:8,html_url:`https://github.com/${repo}/pull/8`,state:'closed',merged_at:'2026-10-11T00:00:00Z',merge_commit_sha:merge,user:{type:'Bot',login:'github-actions[bot]'},head:{sha:merge,ref:'keel/robot-7',repo:{full_name:repo}},base:{sha:f.base,ref:'main',repo:{full_name:repo}},body:robotAssociation({repo,issueNumber:7,instanceId:f.proposal.instanceId,author:'claude',headSha:merge,cursor:0})};
 const github=async r=>r.path.includes('/pulls?')?{status:200,data:[{number:8}]}:r.path.endsWith('/pulls/8')?{status:200,data:pr}:f.github(r);
 const id={file:'tests/acme.test.mjs',hierarchy:['Acme case'],occurrence:1};
 const transition={instanceId:f.proposal.instanceId,pr:{repo,number:8,headSha:merge,mergeSha:merge},fromIdentity:f.proposal.identity,toIdentity:{...f.proposal.identity,target:'tests/acme-successor.test.mjs'},testMapping:[{from:id,to:[{...id,file:'tests/acme-successor.test.mjs'}]}],executionSettings:{before:{concurrency:1},after:{concurrency:2}}};
 await assert.rejects(decideTimeProposal({root:f.root,path,expectedInstance:f.proposal.instanceId,decision:'map',transition:{...transition,testMapping:[{from:{file:id.file},to:[{file:'successor'}]}]},at,github}),/full file/);
 const reviewed=await decideTimeProposal({root:f.root,path,expectedInstance:f.proposal.instanceId,decision:'map',transition,at,github});assert.equal(reviewed.decision,'transition-reviewed');assert.deepEqual(reviewed.proposal.baseline,f.proposal.baseline);
 await mkdir(join(f.root,'.keel/test-runs'),{recursive:true});
 for(const [name,commit] of [['before',f.base],['after',merge]])await writeFile(join(f.root,'.keel/test-runs',name+'.json'),JSON.stringify({date:'2026-10-12T00:00:00Z',commit,tests:[]}));
 let calls=0;const evaluate=async input=>{calls++;assert.deepEqual(new Set(input.runs.map(r=>r.commit)),new Set([f.base,merge]));assert.deepEqual(input.comparison.eligibleRevisionShas,[merge]);assert.equal(input.comparison.mergeSha,merge);assert.equal(input.comparison.instanceId,f.proposal.instanceId);assert.deepEqual(input.comparison.baseline,f.proposal.baseline);return {state:'inside',value:0,coverage:{eligible:3},reasons:[]};};
 let result=await remeasureTimeProposal({root:f.root,proposal:reviewed.proposal,at:'2026-10-14T00:00:00Z',github,evaluate});assert.equal(result.state,'inside');assert.equal(calls,1);
 pr.head.sha='f'.repeat(40);result=await remeasureTimeProposal({root:f.root,proposal:reviewed.proposal,at:'2026-10-14T00:00:00Z',github,evaluate});assert.equal(result.state,'unavailable');assert.equal(calls,1);
 pr.head.sha=merge;git(f.root,'checkout','-q','--force','--detach',f.base);result=await remeasureTimeProposal({root:f.root,proposal:accepted.proposal,at:'2026-10-14T00:00:00Z',github,evaluate});assert.equal(result.state,'unavailable');assert.equal(calls,1);
});


test('adopted night without climb imports and executes shipped remeasurement with verified delivery',async t=>{
 const f=await fixture(t);
 await writeFile(join(f.root,'.keel/keel.json'),JSON.stringify({name:'Acme',tagline:'Acme tests timing',repo,practices:['base','agents-md','night']}));
 const rendered=await render(f.root);assert.equal(rendered.ok,true);
 await assert.rejects(readFile(join(f.root,'scripts/keel/robot.mjs')),{code:'ENOENT'});await assert.rejects(readFile(join(f.root,'lib/time-proposal-actions.mjs')),{code:'ENOENT'});
 const proposal={...f.proposal,lifecycle:{...f.proposal.lifecycle,state:'accepted',issue:{repo,number:7,url:`https://github.com/${repo}/issues/7`}}};
 const pr={number:8,html_url:`https://github.com/${repo}/pull/8`,state:'closed',merged_at:'2026-10-11T00:00:00Z',merge_commit_sha:f.base,user:{type:'Bot',login:'github-actions[bot]'},head:{sha:f.base,ref:'keel/robot-7',repo:{full_name:repo}},base:{sha:f.base,ref:'main',repo:{full_name:repo}},body:robotAssociation({repo,issueNumber:7,instanceId:proposal.instanceId,author:'claude',headSha:f.base,cursor:0})};
 await writeFile(join(f.root,'probe-input.json'),JSON.stringify({proposal,pr}));
 await writeFile(join(f.root,'probe.mjs'),`import {readFile} from 'node:fs/promises';
import {remeasureTimeProposal} from './scripts/keel/time-proposal-remeasurement.mjs';
const {proposal,pr}=JSON.parse(await readFile('probe-input.json','utf8'));
const github=async r=>{if(r.method!=='GET')throw new Error('no writes');return {status:200,data:r.path.includes('/pulls?')?[{number:8}]:pr};};
let evaluated=false;const result=await remeasureTimeProposal({root:process.cwd(),proposal,at:'2026-10-14T00:00:00Z',github,evaluate:async input=>{if(!Array.isArray(input.comparison.eligibleRevisionShas))throw new Error('missing ancestry list');evaluated=true;return {state:'outside',value:2000,reasons:['Acme still outside']};}});
console.log(JSON.stringify({evaluated,result}));
`);
 const result=run(process.execPath,['probe.mjs'],{cwd:f.root});assert.equal(result.status,0,result.stderr);const data=JSON.parse(result.stdout);assert.equal(data.evaluated,true);assert.equal(data.result.state,'outside');assert.equal(data.result.delivery.state,'merged');
});

test('delivery source ownership transfer keeps installed climb bytes and refuses existing human drift',async t=>{
 const f=await fixture(t),config={name:'Acme',tagline:'Acme climbs',repo,practices:['base','agents-md','night','climb']};await writeFile(join(f.root,'.keel/keel.json'),JSON.stringify(config));
 assert.equal((await render(f.root)).ok,true);const path='scripts/keel/robot-delivery.mjs',file=join(f.root,path),before=await readFile(file,'utf8');
 const lockPath=join(f.root,'.keel/lock.json'),lock=JSON.parse(await readFile(lockPath,'utf8'));lock.files[path].practice='climb';await writeFile(lockPath,JSON.stringify(lock));
 assert.equal((await render(f.root)).ok,true);assert.equal(await readFile(file,'utf8'),before);assert.equal(JSON.parse(await readFile(lockPath,'utf8')).files[path].practice,'night');
 await writeFile(file,before+'\n// Acme owner addition\n');await assert.rejects(render(f.root),/refusing to overwrite/);assert.match(await readFile(file,'utf8'),/Acme owner addition/);
});

test('installed night improve uses actual evaluator and persists mapped successor coverage verdicts',async t=>{
 const f=await fixture(t),day=86400000,now=Date.now(),iso=days=>new Date(now-days*day).toISOString();
 await writeFile(join(f.root,'.keel/keel.json'),JSON.stringify({name:'Acme',tagline:'Acme timing',repo,practices:['base','agents-md','night'],check:'node --test acme-smoke.test.mjs'}));
 await writeFile(join(f.root,'acme-smoke.test.mjs'),"import {test} from 'node:test';\ntest('Acme smoke',()=>{});\n");
 assert.equal((await render(f.root)).ok,true);
 await assert.rejects(readFile(join(f.root,'scripts/keel/robot.mjs')),{code:'ENOENT'});
 await assert.rejects(readFile(join(f.root,'lib/time-proposal-actions.mjs')),{code:'ENOENT'});
 const seed=timeEvidence(now).runs.find(r=>r.kind!=='gate');
 const baselineRuns=[8,9,10].map(d=>({...seed,id:`acme-baseline-${d}`,date:iso(d),commit:f.base}));
 const discovery=evaluateTimeEvidence({measure:'critical_file',runs:baselineRuns,at:now-7*day});
 assert.equal(discovery.state,'outside');
 const proposal=makeTimeProposal({...discovery.timeCandidates[0],at:iso(7)});
 await writeFile(join(f.root,'acme.txt'),'Acme successor suite');git(f.root,'add','.');git(f.root,'commit','-qm','Acme merged split');
 const merge=git(f.root,'rev-parse','HEAD'),successor='tests/acme-successor.test.mjs',suite=structuredClone(seed.suite);
 suite.expectedFiles[0]=successor;suite.observedSummaries[0].file=successor;suite.observedSummaries[0].durationMs=3000;suite.observedInventory[0].file=successor;
 const testId=({outcome,...identity})=>identity;
 const transition={instanceId:proposal.instanceId,pr:{repo,number:8,headSha:merge,mergeSha:merge},fromIdentity:proposal.identity,toIdentity:{...proposal.identity,target:{file:successor}},testMapping:seed.suite.observedInventory.map((id,i)=>({from:testId(id),to:[testId(suite.observedInventory[i])]})),executionSettings:{before:seed.suite.executionSettings,after:suite.executionSettings},reviewedAt:iso(4)};
 const accepted={...proposal,lifecycle:{...proposal.lifecycle,state:'accepted',decidedAt:iso(6),issue:{repo,number:7,url:`https://github.com/${repo}/issues/7`},transition}};
 const health='docs/health/'+new Date(now).toISOString().slice(0,10)+'.md';
 await rm(join(f.root,path));
 await writeHealthReport({root:f.root,path:health,generated:'# Acme health\n\n## Proposal\n\n'+formatTimeProposal(accepted)});
 await writeFile(join(f.root,health),(await readFile(join(f.root,health),'utf8'))+'\nAcme owner notes stay.\n');
 const pr={number:8,html_url:`https://github.com/${repo}/pull/8`,state:'closed',merged_at:iso(5),merge_commit_sha:merge,user:{type:'Bot',login:'github-actions[bot]'},head:{sha:merge,ref:'keel/robot-7',repo:{full_name:repo}},base:{sha:f.base,ref:'main',repo:{full_name:repo}},body:robotAssociation({repo,issueNumber:7,instanceId:proposal.instanceId,author:'claude',headSha:merge,cursor:0})};
 const gh=join(f.root,'fake-gh.cjs'),requests=join(f.root,'api-requests.jsonl');
 await writeFile(gh,`#!${process.execPath}
const fs=require('node:fs'),args=process.argv.slice(2);
if(args[0]!=='api')process.exit(1); // Other instruments explicitly lack remote coverage.
const i=args.indexOf('--method');if(i<0)process.exit(1); // Unsupported reads from unrelated instruments.
const method=args[i+1],path=args[i+2];
fs.appendFileSync(${JSON.stringify(requests)},JSON.stringify({method,path})+'\\n');
if(method!=='GET')throw Error('read-only fixture: no remote writes');
const pr=${JSON.stringify(pr)};let data;
if(path.startsWith('/repos/acme/anvils/pulls?'))data=[{number:8}];
else if(path==='/repos/acme/anvils/pulls/8')data=pr;
else throw Error('unexpected Acme endpoint '+path);
process.stdout.write('HTTP/2.0 200 OK\\r\\nContent-Type: application/json\\r\\n\\r\\n'+JSON.stringify(data));
`);await chmod(gh,0o755);
 const runs=[1,2,3].map(d=>({...seed,id:`acme-after-${d}`,date:iso(d),commit:merge,suite:structuredClone(suite)}));
 await mkdir(join(f.root,'.keel/test-runs'),{recursive:true});
 const save=async()=>{for(const r of runs)await writeFile(join(f.root,'.keel/test-runs',r.id+'.json'),JSON.stringify(r));};await save();
 const invoke=()=>run(process.execPath,['scripts/keel/improve.mjs','--report','--json'],{cwd:f.root,env:{...process.env,CI:'true',KEEL_GH:gh,KEEL_NPM:gh},timeout:30000});
 const first=invoke();assert.equal(first.status,0,first.stderr+first.stdout);
 const initial=JSON.parse(first.stdout).remeasurements.find(r=>r.instanceId===proposal.instanceId);
 assert.equal(initial.state,'inside');assert.equal(initial.value,0.3);assert.equal(initial.coverage.eligible,3);assert.equal(initial.delivery.pr.mergeSha,merge);
 assert.deepEqual(initial.suiteWall,{beforeMs:10000,afterMs:10000,note:'descriptive only; dominance change does not establish faster execution'});
 let saved=parseTimeProposal(await readFile(join(f.root,health),'utf8')).proposal;
 assert.equal(saved.lifecycle.remeasurement.state,'inside');assert.deepEqual(saved.baseline,proposal.baseline);assert.deepEqual(saved.lifecycle.transition,transition);
 runs[0].suite.observedInventory.shift();await save();
 const second=invoke();assert.equal(second.status,0,second.stderr+second.stdout);
 const missing=JSON.parse(second.stdout).remeasurements.find(r=>r.instanceId===proposal.instanceId);
 assert.equal(missing.state,'unavailable');assert.match(missing.reasons.join(' '),/inventory/);
 const text=await readFile(join(f.root,health),'utf8');saved=parseTimeProposal(text).proposal;
 assert.equal(saved.lifecycle.remeasurement.state,'unavailable');assert.deepEqual(saved.baseline,proposal.baseline);assert.deepEqual(saved.lifecycle.transition,transition);assert.match(text,/Acme owner notes stay/);
 const reads=(await readFile(requests,'utf8')).trim().split('\n').map(JSON.parse);assert.ok(reads.length>=4);assert.ok(reads.every(r=>r.method==='GET'));
});


test('time acceptance real CLI shell uses instance and durable issue API without a second yes',async t=>{
 const f=await fixture(t),gh=join(f.root,'fake-gh'),state=join(f.root,'api-state.json');
 await writeFile(state,JSON.stringify({issue:null,posts:0}));
 await writeFile(gh,`#!${process.execPath}
const fs=require('node:fs');const method=process.argv[process.argv.indexOf('--method')+1],path=process.argv[process.argv.indexOf('--method')+2];const file=${JSON.stringify(state)},s=JSON.parse(fs.readFileSync(file,'utf8'));let status=200,data;
if(!path.startsWith('/repos/acme/anvils/'))throw Error('foreign target');
if(method==='POST'){const b=JSON.parse(fs.readFileSync(0,'utf8'));if(!fs.readFileSync(${JSON.stringify(join(f.root,path))},'utf8').includes('"state": "accepting"'))throw Error('no local intent');s.posts++;s.issue={number:7,state:'open',body:b.body,labels:b.labels,html_url:'https://github.com/acme/anvils/issues/7',url:'https://api.github.com/repos/acme/anvils/issues/7'};status=201;data=s.issue;}else data=path.includes('/issues?')?(s.issue?[s.issue]:[]):s.issue;fs.writeFileSync(file,JSON.stringify(s));process.stdout.write('HTTP/2.0 '+status+' OK\\r\\nContent-Type: application/json\\r\\n\\r\\n'+JSON.stringify(data));
`);await chmod(gh,0o755);
 const cli=new URL('../bin/keel.mjs',import.meta.url).pathname;
 const invoke=()=>run(process.execPath,[cli,'walk','decide','--proposal',path,'--instance',f.proposal.instanceId,'--accept','--json'],{cwd:f.root,env:{...process.env,KEEL_GH:gh}});
 const first=invoke();assert.equal(first.status,0,first.stderr+first.stdout);assert.equal(JSON.parse(first.stdout).decision,'accepted');
 const again=invoke();assert.equal(again.status,0,again.stderr+again.stdout);assert.equal(JSON.parse(await readFile(state,'utf8')).posts,1);
});
