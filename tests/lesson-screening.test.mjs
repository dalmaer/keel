import { evaluatedLearningWorld } from './helpers/evaluated-learning.mjs';
import { constants } from 'node:fs';
// Acme synthetic receipt tests exercise real readers; Docker proof is separately opt-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp, { readFile, writeFile, readdir, chmod, mkdir, rm, lstat, symlink } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { screeningWorld, syntheticTerminalReceipts } from './helpers/lesson-screening.mjs';
import { evaluationSection, ref, validateHistory, seal, serializeEvaluation } from '../lib/evaluated-lessons.mjs';
import { fingerprint, sealRecord } from '../lib/evaluation-records.mjs';
import { run } from './helpers/run.mjs';
const apply=(w,p)=>w.learning.evaluatedLearning({...p.opts,yes:true,digest:p.preview.digest});
async function inventory(path){const rows=[];for(const name of (await readdir(path)).sort()){const p=join(path,name),s=await lstat(p);rows.push([name,s.mode,s.isDirectory()?await inventory(p):fingerprint((await readFile(p)).toString('base64'))]);}return rows;}
async function overwrite(path,value){await chmod(path,0o600);await writeFile(path,JSON.stringify(value)+'\n');await chmod(path,0o400);}
const evaluation=r=>evaluationSection(r.outputBytes).value.records.find(r=>r.kind==='learning-evaluation');
test('twenty terminal receipts yield evaluated inconclusive, read-only approval and genuine revision',async t=>{
 const w=await screeningWorld(t);assert.ok(w.env.PLATES_GH);await syntheticTerminalReceipts(w,{regression:true,recovery:true});
 const before=await inventory(w.dir),p=await w.evaluate();assert.deepEqual(await inventory(w.dir),before);
 assert.equal((await w.learning.evaluatedLearning(p.opts)).digest,p.preview.digest);await assert.rejects(w.learning.evaluatedLearning({...p.opts,yes:true,digest:'0'.repeat(64)}),/stale_learning_preview/);
 const result=await apply(w,p),r=evaluation(result);assert.equal(result.status,'evaluated');assert.equal(r.data.disposition,'inconclusive');assert.equal(r.data.attemptRefs.length,20);assert(r.data.attemptRefs.some(a=>a.evidence.some(e=>e.record.startsWith('reconciliation-'))));
 assert.equal(r.data.caseResults.find(c=>c.role==='control').criteria.controlRegressions.status,'failed');
 const reports=await inventory(join(w.dir,'reports'));assert.equal(reports.length,1);assert.equal((await apply(w,p)).alreadyApplied,true);
 const inspect=run(process.execPath,[join(w.app,'bin/plates.mjs'),'learn','evaluate','inspect','2026-10-24-acme','--json'],{cwd:w.repo,env:w.env});assert.equal(inspect.status,0,inspect.stderr);assert.equal(JSON.parse(inspect.stdout).state,'evaluated');
 const revision={supersedesRef:w.proposalRef,proposal:w.proposal(w.lessonRef),scopeChangeReason:'Acme follow-up scope.'};await assert.rejects(w.call('revise',revision,{previous:result}),/unchanged_evaluated_revision/);
 revision.proposal.hypothesis='Acme revised hypothesis after measured limits.';const revised=(await w.call('revise',revision,{previous:result,apply:true})).result;assert.equal(revised.status,'proposed');assert.deepEqual(await inventory(join(w.dir,'reports')),reports);assert.deepEqual(evaluation(revised),r);
 const legacy=run(process.execPath,[join(w.app,'bin/plates.mjs'),'learn','decide','2026-10-24-acme','accepted','--yes','--json'],{cwd:w.repo,env:w.env});assert.equal(legacy.status,2);
});
test('missing slots, active locks, stale evidence and malformed chain cannot be screened',async t=>{
 const w=await screeningWorld(t);await syntheticTerminalReceipts(w,{omitLast:true});await assert.rejects(w.evaluate(),/terminal_slots/);
 const lock=join(w.options.state,'session-trials','.lock');await writeFile(lock,'',{mode:0o600});await assert.rejects(w.evaluate(),/writer not inactive/);assert.equal(await readFile(lock,'utf8'),'');await rm(lock);
 const complete=await screeningWorld(t);await syntheticTerminalReceipts(complete);const p=await complete.evaluate();
 const file=join(complete.dir,'execution',complete.b.comparison.pairs[0].id+'-baseline','result.json'),r=JSON.parse(await readFile(file));r.resources.wallMs=21;await overwrite(file,sealRecord(r));await assert.rejects(apply(complete,p),/stale_learning_preview/);
 r.verdictDigest='0'.repeat(64);await overwrite(file,sealRecord(r));await assert.rejects(complete.evaluate(),/unverified execution/);assert(!await fsp.stat(join(complete.dir,'reports')).catch(()=>null));
});
test('criteria registration is once per proposal and before execution, null import remains retrospective',async t=>{
 const w=await screeningWorld(t);await assert.rejects(w.call('register-screening',{proposalRef:w.proposalRef,planLinkRef:w.planLinkRef},{previous:w.registered}),/already_registered/);
 const late=await screeningWorld(t,{register:false});await syntheticTerminalReceipts(late);await assert.rejects(late.call('register-screening',{proposalRef:late.proposalRef,planLinkRef:late.planLinkRef},{previous:late.bound}),/after_execution/);
 const old=await screeningWorld(t,{register:false,screeningCriteria:null});await syntheticTerminalReceipts(old);const registered=(await old.call('register-screening',{proposalRef:old.proposalRef,planLinkRef:old.planLinkRef},{previous:old.bound,apply:true})).result;
 const registration=ref(evaluationSection(registered.outputBytes).value.records.find(r=>r.kind==='learning-evaluation-plan'));
 const result=(await old.call('evaluate',{proposalRef:old.proposalRef,evaluationPlanRef:registration},{previous:registered,apply:true})).result;assert.equal(evaluation(result).data.disposition,'inconclusive');
});
test('report before inbox failure blocks replacement UUID and recovers exact original operation',async t=>{
 const w=await screeningWorld(t);await syntheticTerminalReceipts(w);const p=await w.evaluate();
 const originalOpen=fsp.open,originalLstat=fsp.lstat;let published=false,injected=false;
 fsp.open=async function(path,...args){const h=await originalOpen.call(this,path,...args);if(String(path).includes('/reports/')&&typeof args[0]==='number'&&(args[0]&constants.O_CREAT)){const sync=h.sync.bind(h);h.sync=async()=>{await sync();published=true;};}return h;};
 fsp.lstat=async function(path,...args){if(published&&!injected&&String(path).endsWith('/.inbox-evaluation.lock')){injected=true;throw Error('Acme interruption before inbox intent');}return originalLstat.call(this,path,...args);};syncBuiltinESMExports();
 try{await assert.rejects(apply(w,p),/Acme interruption/);}finally{fsp.open=originalOpen;fsp.lstat=originalLstat;syncBuiltinESMExports();}
 assert(injected);const before=await inventory(join(w.dir,'reports'));assert.equal(before.length,1);
 const request={...p.request,operationId:randomUUID()};await assert.rejects(w.call('evaluate',request.payload,{request}),/original_operation/);
 const result=await apply(w,p);assert.equal(result.status,'evaluated');assert.deepEqual(await inventory(join(w.dir,'reports')),before);
 const path=join(w.dir,'reports',(await readdir(join(w.dir,'reports')))[0]);await rm(path);await assert.rejects(apply(w,p),/original_report_missing/);
});
test('resealed nested report forgery and foreign report storage refuse retained reads',async t=>{
 const w=await screeningWorld(t);await syntheticTerminalReceipts(w);const p=await w.evaluate();await apply(w,p);const home=join(w.dir,'reports'),file=join(home,(await readdir(home))[0]);
 const r=JSON.parse(await readFile(file));r.report.cases[0].arms.baseline.accepted='Acme forged count';r.reportDigest=fingerprint(r.report);const forged=sealRecord(r);await rm(file);await writeFile(join(home,forged.digest+'.json'),JSON.stringify(forged)+'\n',{mode:0o400});await assert.rejects(apply(w,p),/projection mismatch/);
 await rm(home,{recursive:true});await symlink(w.root,home);await assert.rejects(apply(w,p),/unsafe storage/);
});
test('strict learning evaluation references and nested arithmetic cannot be resealed into authority',async t=>{
 const w=await screeningWorld(t);await syntheticTerminalReceipts(w);const p=await w.evaluate(),result=await apply(w,p),base=evaluationSection(result.outputBytes).value;
 for(const mutate of [r=>r.data.attemptRefs[0].evidence[0].extra=true,r=>r.data.reporterIdentity.extra=true,r=>r.data.caseResults[0].arms.baseline.currencyUsd.total=0,r=>r.data.evaluationPlanRef.digest='0'.repeat(64)]){
  const h=structuredClone(base),index=h.records.findIndex(r=>r.kind==='learning-evaluation');mutate(h.records[index]);const {digest,...body}=h.records[index];h.records[index]=seal(body);const e=h.events.at(-1),{digest:ignored,...eb}=e;eb.recordRefs=[ref(h.records[index])];h.events[h.events.length-1]=seal(eb);assert.throws(()=>validateHistory(h));
 }
});
test('consistent resealed delivery substitution is refused against frozen composition',async t=>{
 const w=await screeningWorld(t);await syntheticTerminalReceipts(w);const path=join(w.dir,'execution',w.b.comparison.pairs[0].id+'-baseline'),records={};for(const name of await readdir(path))records[name.slice(0,-5)]=JSON.parse(await readFile(join(path,name)));
 records.intent.input.delivered[0].base64=Buffer.from('Acme unexpected delivery').toString('base64');records.intent.input.deliveredDigest=fingerprint(records.intent.input.delivered);records.intent.previewDigest=fingerprint(records.intent.input);records.intent=sealRecord(records.intent);
 for(const [key,r]of Object.entries(records))if(key!=='intent'){r.intentDigest=records.intent.digest;if(key==='lease')r.lease.commandDigest=records.intent.previewDigest;}
 for(const [key,r]of Object.entries(records))if(!['intent','verdict','result'].includes(key))records[key]=sealRecord(r);
 records.verdict.artifactDigest=records.artifact.digest;for(const [i,c]of records.verdict.checks.entries())c.observationDigest=records['check-'+i].digest;records.verdict=sealRecord(records.verdict);
 records.result.verdictDigest=records.verdict.digest;records.result.settlement.commandDigest=records.intent.previewDigest;records.result=sealRecord(records.result);
 for(const [key,r]of Object.entries(records))await overwrite(join(path,key+'.json'),r);
 const ledger=await w.load('evaluation-ledger');assert.equal((await ledger.evaluations({...w.options,action:'inspect',experiment:w.b.comparison.id})).execution.issues.length,0);
 await assert.rejects(w.evaluate(),/actual delivery mismatch/);
});
test('partial report publication preserves originals and reporter-source changes retain readable old bytes',async t=>{
 const w=await screeningWorld(t);await syntheticTerminalReceipts(w);const p=await w.evaluate(),result=await apply(w,p),before=await inventory(join(w.dir,'reports'));
 const module=join(w.app,'lib/lesson-screening-criteria.mjs');await fsp.appendFile(module,'\n// Acme changed implementation observation.\n');
 const ledger=await w.load('evaluation-ledger');assert.equal((await ledger.evaluations({...w.options,action:'inspect',experiment:w.b.comparison.id})).receipt.kind,'harness');assert.equal((await apply(w,p)).alreadyApplied,true);assert.deepEqual(await inventory(join(w.dir,'reports')),before);
 const screening=await w.load('evaluation-screening');await assert.rejects(screening.comparisonSnapshot({...w.options,experiment:w.b.comparison.id,repository:w.repo}),/source changed/);
 const partial=join(w.dir,'reports','f'.repeat(64)+'.json');await writeFile(partial,'{"schemaVersion":2',{mode:0o400});await assert.rejects(apply(w,p));assert.equal(await readFile(partial,'utf8'),'{"schemaVersion":2');assert.equal((await readFile(join(w.dir,'reports',before[0][0]),'utf8')).length>0,true);assert.equal(result.status,'evaluated');
});
test('original frozen retention ceiling refuses report allocation without changing evidence',async t=>{
 const w=await screeningWorld(t,{retention:{days:30,maxBytes:64*1024*1024,maxEvents:187}});await syntheticTerminalReceipts(w);
 const execution=await w.load('evaluation-execution');assert.equal((await execution.usage(w.dir)).count,w.b.comparison.retention.maxEvents);
 const before=await inventory(w.dir);await assert.rejects(w.evaluate(),/retention_exhausted/);assert.deepEqual(await inventory(w.dir),before);
});

test('duplicate recovery checks all attempt references and explicit evaluated rejection preserves evidence',async t=>{
 const w=await screeningWorld(t);await syntheticTerminalReceipts(w);const p=await w.evaluate(),result=await apply(w,p),section=evaluationSection(result.outputBytes),h=structuredClone(section.value);
 const index=h.records.findIndex(r=>r.kind==='learning-evaluation'),original=h.records[index];original.data.attemptRefs.pop();const {digest,...body}=original;h.records[index]=seal(body);const {digest:eventDigest,...event}=h.events.at(-1);event.recordRefs=[ref(h.records[index])];h.events[h.events.length-1]=seal(event);
 const altered=serializeEvaluation(section.prefix,h),file=join(w.repo,'docs/inbox/2026-10-24-acme.md');await writeFile(file,altered);await assert.rejects(apply(w,p),/original_attempt_refs_changed/);await writeFile(file,result.outputBytes);
 const evaluationRef=ref(evaluation(result));const rejected=(await w.call('reject',{evidenceRefs:[evaluationRef]},{previous:result,apply:true})).result;assert.equal(rejected.status,'rejected');assert.deepEqual(evaluation(rejected),evaluation(result));assert.equal((await readdir(join(w.dir,'reports'))).length,1);
});

test('shared Acme probe yields canonical equal case environments and unique delivery',async t=>{
 const w=await evaluatedLearningWorld(t,{realDocker:true}),corpus=await w.load('evaluation-corpus');
 for(const task of w.b.cases){assert.deepEqual(task,(await corpus.corpusDefinition(task.id)).task);for(const c of w.b.configurations)assert.deepEqual(task.environment,c.environment);}
 assert.equal(new Set(w.b.materials.map(m=>m.id)).size,w.b.materials.length);
 for(const c of w.b.configurations)assert.equal(new Set(c.overlays.map(o=>o.path)).size,c.overlays.length);
 if(process.env.PLATES_EVALUATION_DOCKER==='1'){
   const ledger=await w.load('evaluation-ledger');
   for(const task of w.b.cases){const pair=w.b.comparison.pairs.find(p=>p.case.id===task.id);await writeFile(w.execution,JSON.stringify({...w.executionRequest,pairId:pair.id}));const p=await ledger.evaluations({...w.options,action:'run',experiment:w.b.comparison.id,execution:w.execution});assert.equal(p.preview,true);assert.equal(p.input.taskDigest,task.digest);}
   assert.equal(await fsp.stat(join(w.options.state,'session-trials',w.b.comparison.id,'execution')).catch(()=>null),null);
 }
});
