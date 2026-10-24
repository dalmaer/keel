// Read-only screening observations and immutable reports; no execution authority.
import { mkdir, readdir, lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants } from 'node:fs';
import { evaluationBytes, readEvaluationForScreening } from './evaluation-ledger.mjs';
import { safePath, storeImmutable } from './session-ledger-io.mjs';
import { checkEvaluation as check, fields, fingerprint, byteDigest, sealRecord, relativeFile } from './evaluation-records.mjs';
import { inspectExecutions, usage } from './evaluation-execution.mjs';
import { summarizeComparison, summarizeComparisonV1 } from './evaluation-comparison-report.mjs';
import { composeExecutionDelivery } from './evaluation-execution-input.mjs';
import { exportSource } from './evaluation-artifacts.mjs';
const hash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const REPORT_SOURCES = Object.freeze(['evaluation-screening.mjs','evaluation-ledger.mjs','evaluation-records.mjs','evaluation-comparison-report.mjs','evaluation-execution.mjs','evaluation-execution-input.mjs','evaluation-artifacts.mjs','session-ledger-io.mjs','lesson-screening-criteria.mjs','evaluated-learning-binding.mjs','evaluated-lessons.mjs','evaluated-learning.mjs','validation-budget.mjs','evaluated-learning-screening.mjs','evaluation-corpus.mjs','evaluation-provenance.mjs','evaluation-docker.mjs','web/workspace.mjs','web/update-container.mjs','evaluated-learning-io.mjs','evaluated-learning-sources.mjs']);
export function validateReporterIdentity(value) {
  fields(value,['method','version','sources','digest']);
  check(value.method === 'paired-screening-verifier' && value.version === 1 && Array.isArray(value.sources) && value.sources.length > 0 && value.sources.length <= 32,'invalid reporter identity');
  for(const s of value.sources){fields(s,['path','byteDigest']);relativeFile(s.path);check(hash(s.byteDigest),'invalid reporter source');}
  check(new Set(value.sources.map(s=>s.path)).size===value.sources.length && fingerprint({method:value.method,version:value.version,sources:value.sources})===value.digest,'invalid reporter digest');
}
async function observeReporter() {
  const sources=[];
  for(const path of REPORT_SOURCES) sources.push({path:'lib/'+path,byteDigest:byteDigest(await evaluationBytes(fileURLToPath(new URL(path,import.meta.url)),1048576))});
  const body={method:'paired-screening-verifier',version:1,sources};return {...body,digest:fingerprint(body)};
}
// Capture loaded implementation bytes, then compare at every derivation.
const loadedReporter = await observeReporter();
async function reporterIdentity(){const current=await observeReporter();check(current.digest===loadedReporter.digest,'screening source changed; restart');return current;}
function validateInventory(items) {
  check(Array.isArray(items)&&items.length<=20000,'receipt inventory bound');let previous='';
  for(const item of items){fields(item,['path','byteDigest','recordDigest','missing']);relativeFile(item.path);check(item.path>previous,'receipt inventory order');previous=item.path;
    check(typeof item.missing==='boolean'&&(item.missing?item.byteDigest===null&&item.recordDigest===null:hash(item.byteDigest)&&(item.recordDigest===null||hash(item.recordDigest))),'invalid receipt inventory');
    check(!item.path.startsWith('reports/'),'report in execution inventory');
  }
}
export function validateReportReceipt(r, ledger) {
  fields(r,['schemaVersion','kind','id','createdAt','operationId','requestDigest','planDigest','ledgerDigest','executionDigest','reporterIdentity','receiptInventory','report','reportDigest','digest']);
  check(r.schemaVersion===2&&r.kind==='evaluation-report'&&typeof r.operationId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(r.operationId)&&r.id==='report-'+r.operationId.replaceAll('-',''),'invalid report identity');
  check(typeof r.createdAt==='string'&&Number.isFinite(Date.parse(r.createdAt))&&new Date(r.createdAt).toISOString()===r.createdAt,'invalid report timestamp');
  for(const k of ['requestDigest','planDigest','ledgerDigest','executionDigest','reportDigest','digest'])check(hash(r[k]),'invalid report digest');
  check(sealRecord(r).digest===r.digest&&r.planDigest===ledger.plan.digest&&r.ledgerDigest===ledger.digest,'report binding mismatch');
  validateReporterIdentity(r.reporterIdentity);validateInventory(r.receiptInventory);
  fields(r.report,['schemaVersion','comparisonId','planDigest','status','cases','arms','pairs','slots','attempts','unplannedAttempts','issues','screening','recommendation','candidate','limitations']);
  check(r.report.schemaVersion===1&&r.report.planDigest===r.planDigest&&r.report.comparisonId===ledger.plan.bundle.comparison.id&&fingerprint(r.report)===r.reportDigest&&fingerprint(r.receiptInventory)===r.executionDigest,'report content binding mismatch');
  check(Buffer.byteLength(JSON.stringify(r)+'\n')<=1048576,'report byte bound');return r;
}
export async function inspectReports(dir, ledger) {
  const home=join(dir,'reports');if(!await safePath(home))return [];
  check(((await lstat(home)).mode&0o077)===0,'reports directory not private');
  const names=(await readdir(home)).sort();check(names.length<=16,'report count bound');const reports=[],operations=new Set();
  for(const name of names){check(/^[a-f0-9]{64}\.json$/.test(name),'foreign or partial report');const path=join(home,name),stat=await lstat(path);check((stat.mode&0o277)===0&&stat.nlink===1,'report not immutable');
    const raw=await evaluationBytes(path,1048576),r=validateReportReceipt(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),ledger);
    check(name===r.digest+'.json'&&raw.equals(Buffer.from(JSON.stringify(r)+'\n'))&&!operations.has(r.operationId),'conflicting report publication');operations.add(r.operationId);
    for(const item of r.receiptInventory)if(!item.missing){const bytes=await evaluationBytes(join(dir,item.path),4*1048576);check(byteDigest(bytes)===item.byteDigest,'retained report evidence changed');if(item.recordDigest!==null)check(JSON.parse(bytes).digest===item.recordDigest,'retained report evidence reference changed');}
    // Version 1's projection is reconstructed from exactly the retained evidence,
    // not from caller JSON or later appended records. Future projector versions
    // must retain this versioned reader rather than reinterpret old report bytes.
    const current=await inspectExecutions(dir,ledger.plan),paths=new Set(r.receiptInventory.filter(x=>!x.missing).map(x=>x.path));
    const trials=(current?.trials??[]).filter(t=>paths.has('execution/'+t.slot+'/intent.json')).map(t=>{
      check(t.records,'retained report trial unavailable');
      const records=Object.fromEntries(Object.entries(t.records).filter(([key])=>paths.has('execution/'+t.slot+'/'+key+'.json')));
      const history=Object.entries(records).filter(([key])=>key.startsWith('reconciliation-')).map(([,v])=>v);
      const receipt=history.filter(v=>v.status==='terminal').at(-1),recovery=receipt?{receipt,result:receipt.result,verdict:receipt.verdict}:null;
      return {slot:t.slot,status:recovery?'terminal':records.result?.status??'uncertain',records,history,...(recovery?{recovery}:{})};
    });
    const execution=current?{cancellation:paths.has('execution/control/cancel.json')?current.cancellation:null,status:'complete',reservation:paths.has('execution/reservation.json')?current.reservation:null,trials,issues:[]}:null;
    const derived=summarizeComparisonV1(ledger.plan,canonicalExecution(execution));
    check(fingerprint(derived)===r.reportDigest,'retained report projection mismatch');
    reports.push(r);
  }
  const retained=await usage(dir),policy=ledger.plan.bundle.comparison.retention;check(retained.bytes<=policy.maxBytes&&retained.count<=policy.maxEvents,'report retention exhausted');return reports;
}
async function inventory(dir, plan) {
  const items=[];let total=0,visited=0;
  async function visit(folder,relative='') {
    check(++visited<=4000&&relative.split('/').length<=4,'screening directory bound');
    for(const name of (await readdir(folder)).sort()){
      if(!relative&&name==='reports')continue;
      const path=join(folder,name),rel=relative?relative+'/'+name:name,stat=await lstat(path);relativeFile(rel);
      check(!stat.isSymbolicLink()&&(stat.isDirectory()||stat.isFile())&&(stat.mode&0o077)===0,'unsafe screening evidence');
      if(stat.isDirectory())await visit(path,rel);else {const bytes=await evaluationBytes(path,4*1048576);total+=bytes.length;check(total<=64*1048576&&items.length<20000,'screening inventory bound');
        let recordDigest=null;if(rel.endsWith('.json')){const record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));check(hash(record.digest),'unsealed screening evidence');recordDigest=record.digest;}
        items.push({path:rel,byteDigest:byteDigest(bytes),recordDigest,missing:false});
      }
    }
  }
  await visit(dir);
  for(const pair of plan.bundle.comparison.pairs)for(const arm of ['baseline','candidate']){const path='execution/'+pair.id+'-'+arm+'/intent.json';if(!items.some(i=>i.path===path))items.push({path,byteDigest:null,recordDigest:null,missing:true});}
  items.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);validateInventory(items);return items;
}
function validateDeliveries(plan, execution, repository, deadline) {
  const b=plan.bundle,cache=new Map();
  for(const trial of execution?.trials??[]){check(trial.records?.intent,'unverified trial');const input=trial.records.intent.input,request=input.request;
    const pair=b.comparison.pairs.find(p=>p.id===request?.pairId);check(pair&&['baseline','candidate'].includes(request.arm)&&trial.slot===pair.id+'-'+request.arm,'unplanned delivery cannot bind');
    check(request.repository===repository,'delivery repository mismatch');const task=b.cases.find(c=>c.id===pair.case.id),config=b.configurations.find(c=>c.id===b.comparison[request.arm].id);
    const key=fingerprint({revision:task.startingCommit,paths:request.sourcePaths});if(!cache.has(key))cache.set(key,exportSource(repository,task.startingCommit,request.sourcePaths,{deadline}));const source=cache.get(key);
    const {delivered}=composeExecutionDelivery(b,task,config,source,request.builderArgv);
    check(input.taskDigest===task.digest&&input.configurationDigest===config.digest&&input.checkManifestDigest===task.acceptanceManifest.digest&&input.sourceDigest===fingerprint(source)&&input.deliveredDigest===fingerprint(delivered)&&fingerprint(input.delivered)===fingerprint(delivered),'actual delivery mismatch');
  }
}
function canonicalExecution(execution) {
  if(!execution)return null;
  return {...execution,trials:[...execution.trials].sort((a,b)=>a.slot.localeCompare(b.slot,'en')).map(t=>t.records?{...t,records:Object.fromEntries(Object.entries(t.records).sort(([a],[b])=>a.localeCompare(b,'en')))}:t)};
}
export async function comparisonSnapshot(options) {
  const first=await readEvaluationForScreening(options),{receipt:ledger}=first,dir=ledger.plan.destination;
  const writer=await first.observeWriter(),before=await inventory(dir,ledger.plan),identity=await reporterIdentity();
  const execution=canonicalExecution(await inspectExecutions(dir,ledger.plan));check(!execution?.issues.length,'unverified execution evidence');
  validateDeliveries(ledger.plan,execution,options.repository,Date.now()+30000);
  const report=summarizeComparison(ledger.plan,execution);
  const after=await inventory(dir,ledger.plan),last=await readEvaluationForScreening(options);
  check(fingerprint(before)===fingerprint(after)&&last.receipt.digest===ledger.digest&&fingerprint(canonicalExecution(last.execution))===fingerprint(execution)&&writer===await first.observeWriter()&&(await reporterIdentity()).digest===identity.digest,'screening snapshot changed');
  return {plan:ledger.plan,ledgerDigest:ledger.digest,execution,executionDigest:fingerprint(before),report,reportDigest:fingerprint(report),reporterIdentity:identity,receiptInventory:before,ledger};
}
export function screeningReport(snapshot, request, requestDigest) {
  return sealRecord({schemaVersion:2,kind:'evaluation-report',id:'report-'+request.operationId.replaceAll('-',''),createdAt:request.at,operationId:request.operationId,requestDigest,planDigest:snapshot.plan.digest,ledgerDigest:snapshot.ledgerDigest,executionDigest:snapshot.executionDigest,reporterIdentity:snapshot.reporterIdentity,receiptInventory:snapshot.receiptInventory,report:snapshot.report,reportDigest:snapshot.reportDigest});
}
export async function publishScreeningReport(snapshot, record) {
  const dir=snapshot.plan.destination;validateReportReceipt(record,snapshot.ledger);
  const reports=await inspectReports(dir,snapshot.ledger),existing=reports.find(r=>r.operationId===record.operationId);
  if(existing){check(existing.requestDigest===record.requestDigest&&fingerprint(existing)===fingerprint(record),'original report publication conflicts');return {recovered:true};}
  check(reports.length<16,'report count exhausted');const retained=await usage(dir),policy=snapshot.plan.bundle.comparison.retention;
  check(retained.bytes+Buffer.byteLength(JSON.stringify(record)+'\n')<=policy.maxBytes&&retained.count+1<=policy.maxEvents,'report retention exhausted');
  const home=join(dir,'reports');if(!await safePath(home)){await mkdir(home,{mode:0o700});const parent=await open(dir,constants.O_RDONLY);try{await parent.sync();}finally{await parent.close();}}
  await storeImmutable(join(home,record.digest+'.json'),record);return {recovered:false};
}
