// Synthetic Acme authority and actual local Git/frozen-ledger fixtures; only GitHub transport is fake.
import test from 'node:test';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { evaluatedLearningWorld as world } from './helpers/evaluated-learning.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm, cp, chmod, readdir, lstat, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { evaluationController } from './helpers/evaluation-execution.mjs';
import { randomUUID } from 'node:crypto';
import { run, cleanEnv } from './helpers/run.mjs';
import { acmeEvaluationPlan } from './helpers/evaluation-plan.mjs';
import { byteDigest, sealRecord, fingerprint } from '../lib/evaluation-records.mjs';
import { parseLearningJson, evaluationSection, validateRequest, validateHistory, ref, seal } from '../lib/evaluated-lessons.mjs';
import { formatProposal, parseProposal } from '../lib/learn.mjs';
import { withLearningWriter, publishInbox, readInboxFile } from '../lib/evaluated-learning-io.mjs';
const ROOT=resolve(fileURLToPath(new URL('..',import.meta.url))),AT='2026-10-24T00:00:00.000Z',BODY='Acme private selected review evidence. Keep its complete body private.';
const reference=r=>({kind:r.kind,id:r.id,digest:r.digest});
async function temp(t){const root=await realpath(await mkdtemp(join(tmpdir(),'acme-learning-')));t.after(()=>rm(root,{recursive:true,force:true}));return root;}

test('strict JSON and Markdown heading boundaries refuse ambiguity but preserve fenced claims',()=>{
  assert.throws(()=>parseLearningJson(Buffer.from('{"x":1,"x":2}')),/duplicate/);
  const base=formatProposal({meta:{kind:'lesson',status:'untriaged'},title:'Acme',claim:'## Evaluation\n\n```json\nAcme data\n```'});assert.equal(evaluationSection(base),null);assert.equal(parseProposal(base).claim.includes('## Evaluation'),true);
  for(const heading of ['## Evaluation ',' ## Evaluation','   ## Evaluation','## Evaluation ###'])assert.throws(()=>parseProposal(base+'\n'+heading+'\n\n```json\n{}\n```\n'),/noncanonical/);
  assert.throws(()=>evaluationSection(base+'\n## Evaluation\n\n```json\n{}\n```\n'),/invalid/);
});
test('real selected capture, proposal, immutable revision and actual frozen plan binding',async t=>{
  const w=await world(t);assert.ok(w.env.PLATES_GH);const capture=await w.call('capture',w.capture);assert.equal(capture.preview.destination,join(w.repo,'docs/inbox/2026-10-24-acme.md'));assert.equal((await readdir(join(w.repo,'docs/inbox'))).length,0);assert(!capture.preview.outputBytes.includes(BODY));
  assert.equal((await w.learning.evaluatedLearning(capture.opts)).digest,capture.preview.digest);
  const observed=await w.learning.evaluatedLearning({...capture.opts,yes:true,digest:capture.preview.digest});assert.equal(observed.status,'observed');
  const cli=run(process.execPath,[join(w.app,'bin/plates.mjs'),'learn','evaluate','inspect','2026-10-24-acme','--json'],{cwd:w.repo,env:w.env});assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).state,'observed');
  for(const args of [['inspect','2026-10-24-acme','--yes'],['inspect','2026-10-24-acme','--json','--json'],['follow-up','2026-10-24-acme']]){const r=run(process.execPath,[join(w.app,'bin/plates.mjs'),'learn','evaluate',...args,'--json'],{cwd:w.repo,env:w.env});assert.equal(r.status,2);}
  const history=evaluationSection(observed.outputBytes).value,lessonRef=ref(history.records.find(r=>r.kind==='learning-lesson'));
  const proposed=(await w.call('propose',w.proposal(lessonRef),{apply:true,previous:observed})).result;assert.equal(proposed.status,'proposed');assert(!proposed.outputBytes.includes(w.contentPath));
  const old=evaluationSection(proposed.outputBytes).value,proposalRef=ref(old.records.find(r=>r.kind==='learning-proposal'));
  const plan={proposalRef,experimentId:w.b.comparison.id,expectedPlanDigest:w.draft.digest,targetCaseIds:['acme-case-0'],controlCaseIds:['acme-case-1'],heldOutCaseIds:[]};
  const bound=(await w.call('bind-plan',plan,{apply:true,previous:proposed})).result;assert.equal(bound.status,'proposed');
  const revised=(await w.call('revise',{supersedesRef:proposalRef,proposal:{...w.proposal(lessonRef),hypothesis:'Acme revised hypothesis.'},scopeChangeReason:'Acme clarified hypothesis.'},{apply:true,previous:bound})).result;
  const next=evaluationSection(revised.outputBytes).value;assert.deepEqual(next.records.slice(0,old.records.length),old.records);assert.equal(next.records.filter(r=>r.kind==='learning-proposal').length,2);assert.equal(next.records.filter(r=>r.kind==='learning-plan-link').length,1);assert.equal(next.events.at(-1).replacementRef.version,2);assert.match(next.events.at(-1).reason,/Acme clarified hypothesis/);
  assert.equal((await w.learning.evaluatedLearning({...capture.opts,yes:true,digest:capture.preview.digest})).alreadyApplied,true);
  const rejected=(await w.call('reject',{evidenceRefs:[lessonRef]},{apply:true,previous:revised})).result;assert.equal(rejected.status,'rejected');assert.equal(evaluationSection(rejected.outputBytes).value.events.at(-1).reason,'Acme explicit evaluation');
});

test('source, request, decision target and duplicate inventory changes invalidate exact approval',async t=>{
  const w=await world(t),c=await w.call('capture',w.capture);
  const remote=JSON.parse(await readFile(w.transport));remote.pr.headRefOid='c'.repeat(40);await writeFile(w.transport,JSON.stringify(remote));
  await assert.rejects(w.learning.evaluatedLearning({...c.opts,yes:true,digest:c.preview.digest}),/stale_learning_preview/);
  assert.deepEqual(await readdir(join(w.repo,'docs/inbox')),[]);
  const updated=await w.learning.evaluatedLearning(c.opts),observed=await w.learning.evaluatedLearning({...c.opts,yes:true,digest:updated.digest});
  await assert.rejects(w.call('capture',w.capture,{slug:'2026-10-24-acme-copy'}),/duplicate_selected_source_set/);
  const history=evaluationSection(observed.outputBytes).value,lessonRef=ref(history.records.find(r=>r.kind==='learning-lesson'));
  const request={...c.request,operationId:randomUUID(),action:'propose',payload:w.proposal(lessonRef),expected:{fileDigest:observed.outputDigest,generation:1},decisionTarget:{kind:'phase',ref:'2'}};
  await assert.rejects(w.call('propose',request.payload,{request}),/decision_target_changed/);
  await assert.rejects(w.call('capture',w.capture,{request:{...c.request,reason:'Acme different bytes'}}),/operation_id_conflict/);
  const next=await w.call('propose',w.proposal(lessonRef),{previous:observed});await writeFile(join(w.repo,'docs/phases/1-acme.md'),'# Acme changed phase\n');
  await assert.rejects(w.learning.evaluatedLearning({...next.opts,yes:true,digest:next.preview.digest}),/stale_learning_preview/);
});
test('candidate bytes, protected paths, scope and authority are independently verified',async t=>{
  const w=await world(t),observed=(await w.call('capture',w.capture,{apply:true})).result,lessonRef=ref(evaluationSection(observed.outputBytes).value.records.find(r=>r.kind==='learning-lesson'));
  for(const mutate of [p=>{p.candidate.changes[0].expectedContentSha256='a'.repeat(64);},p=>{p.candidate.changes[0].path='acme.mjs';p.candidate.scope.paths=['acme.mjs'];},p=>{p.candidate.baseRevision='f'.repeat(40);},p=>{p.baselineSelection.configurationRef=w.b.comparison.candidate;},p=>{p.candidate.scope.paths=[];}]){
    const p=w.proposal(lessonRef);mutate(p);await assert.rejects(w.call('propose',p,{previous:observed}),/candidate|baseline|scope/);
  }
  const p=w.proposal(lessonRef);p.baselineSelection.expectedPlanDigest='f'.repeat(64);await assert.rejects(w.call('propose',p,{previous:observed}),/stale_plan/);
  const preview=await w.call('propose',w.proposal(lessonRef),{previous:observed});await writeFile(w.contentPath,'Acme changed public material');await assert.rejects(w.learning.evaluatedLearning({...preview.opts,yes:true,digest:preview.preview.digest}),/candidate_content_changed/);
});
test('strict retained histories refuse forged nested data and resealed invalid references',async t=>{
  const w=await world(t),observed=(await w.call('capture',w.capture,{apply:true})).result;const h=evaluationSection(observed.outputBytes).value;
  const alter=mutate=>{const v=structuredClone(h);mutate(v);for(let i=0;i<v.records.length;i++){const old=v.records[i].digest;v.records[i]=sealRecord(v.records[i]);const next=v.records[i].digest;for(const r of v.records)if(r.kind==='learning-lesson')for(const rr of r.data.sourceRefs)if(rr.digest===old)rr.digest=next;for(const e of v.events){for(const rr of e.recordRefs)if(rr.digest===old)rr.digest=next;if(e.subjectRef.digest===old)e.subjectRef.digest=next;}}v.events=v.events.map(e=>sealRecord(e));return v;};
  for(const mutate of [v=>{v.records[0].source.extra=true;},v=>{v.records[0].verification.verified=true;},v=>{v.events[0].at='yesterday';},v=>{v.events[0].operationId='Acme';},v=>{v.events[0].decisionTarget.kind='issue';},v=>{v.records[1].data.sourceRefs=[];},v=>{v.records[1].data.recurrence.distinctVerifiedIncidents=2;v.records[1].data.recurrence.established=true;}])assert.throws(()=>validateHistory(alter(mutate)),/invalid|bound|forged|decision/);
  const p=(await w.call('propose',w.proposal(ref(h.records[1])),{apply:true,previous:observed})).result;const v=evaluationSection(p.outputBytes).value;v.records.at(-1).data.candidate.patch.changes[0].after.extra=true;v.records.at(-1).data.candidate.patchDigest=fingerprint(v.records.at(-1).data.candidate.patch);v.records[v.records.length-1]=sealRecord(v.records.at(-1));assert.throws(()=>validateHistory(v),/invalid/);
});
test('legacy mutation and render consumers cannot bypass tagged evaluation via kind or outcome',async t=>{
  const w=await world(t),observed=(await w.call('capture',w.capture,{apply:true})).result;
  const learn=await w.load('learn'),distill=await w.load('distill'),p=(await learn.proposals(w.repo))[0],bytes=await readFile(join(w.repo,p.file));
  await assert.rejects(learn.propose({dir:w.repo,slug:p.slug,outcome:'lesson',note:'Acme',read:'acme.mjs'},{env:w.env}),/evaluated_record/);
  await assert.rejects(learn.decide({dir:w.repo,slug:p.slug,decision:'accepted',yes:true},{env:w.env}),/evaluated_record/);
  const stale={...p};delete stale.evaluation;await assert.rejects(learn.save(w.repo,stale),/evaluated_record/);
  await assert.rejects(distill.decideDistill(w.repo,{repo:'Acme/widget'},{...stale,meta:{...stale.meta,kind:'distill',status:'proposed',outcome:'family'}},{decision:'accepted'}),/evaluated_record/);
  assert.deepEqual(await readFile(join(w.repo,p.file)),bytes);
  await writeFile(join(w.repo,p.file),observed.outputBytes.replace('kind: lesson','kind: distill'));
  await assert.rejects(distill.renderPatterns(w.repo),/evaluated_record/);
});
test('concurrent writers, pending uncertainty and unsafe input paths refuse without reclaim',async t=>{
  const root=await temp(t);await mkdir(join(root,'docs/inbox'),{recursive:true});let unblock;const wait=new Promise(r=>{unblock=r;});let entered;const started=new Promise(r=>{entered=r;});const first=withLearningWriter(root,async()=>{entered();await wait;});await started;
  await assert.rejects(withLearningWriter(root,async()=>{}),/EEXIST/);unblock();await first;
  const name='2026-10-24-acme.md',path=join(root,'docs/inbox',name);await writeFile(path,'Acme original');const prior=await readInboxFile(path);
  await assert.rejects(withLearningWriter(root,async lock=>{await writeFile(path,'Acme editor');await publishInbox(root,name,prior,'Acme candidate',lock,{operationId:randomUUID(),requestDigest:'a'.repeat(64)});}),/stale_inbox/);
  assert.equal(await readFile(path,'utf8'),'Acme editor');assert((await readdir(join(root,'docs/inbox'))).some(p=>p.endsWith('.pending')));assert((await readdir(join(root,'docs'))).includes('.inbox-evaluation.lock'));
  await assert.rejects(withLearningWriter(root,async()=>{}),/EEXIST/);
  const alias=join(root,'alias');await symlink(path,alias);await assert.rejects(readInboxFile(alias),/unsafe/);await link(path,join(root,'hardlink'));await assert.rejects(readInboxFile(path),/unsafe/);
});

test('real killed publisher preserves original operation before and after rename without automatic reclaim',async t=>{
  for(const stage of ['before','after'])await t.test(stage,async t=>{
    const root=await temp(t);await mkdir(join(root,'docs/inbox'),{recursive:true});const name='2026-10-24-acme.md',path=join(root,'docs/inbox',name);await writeFile(path,'Acme original');const operation={operationId:randomUUID(),requestDigest:'a'.repeat(64)};
    const url=new URL('../lib/evaluated-learning-io.mjs',import.meta.url).href;
    const source=`import fsp from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';import {withLearningWriter,publishInbox,readInboxFile} from ${JSON.stringify(url)};const root=${JSON.stringify(root)},path=${JSON.stringify(path)};const original=fsp.rename;fsp.rename=async(...a)=>{if(${JSON.stringify(stage)}==='before')process.kill(process.pid,'SIGKILL');const result=await original(...a);process.kill(process.pid,'SIGKILL');return result;};syncBuiltinESMExports();await withLearningWriter(root,async lock=>publishInbox(root,${JSON.stringify(name)},await readInboxFile(path),'Acme approved output',lock,${JSON.stringify(operation)}));`;
    const child=evaluationController(source),done=once(child,'exit');t.after(()=>child.kill('SIGKILL'));const [code,signal]=await done;assert.equal(code,null);assert.equal(signal,'SIGKILL');assert.equal(await readFile(path,'utf8'),stage==='before'?'Acme original':'Acme approved output');
    assert((await readdir(join(root,'docs'))).includes('.inbox-evaluation.lock'));const pending=(await readdir(join(root,'docs/inbox'))).filter(p=>p.endsWith('.pending'));assert.equal(pending.length,stage==='before'?1:0);if(pending.length)assert(pending[0].includes(operation.operationId+'.'+operation.requestDigest));await assert.rejects(withLearningWriter(root,async()=>{}),/EEXIST/);
  });
});

test('plan binding refuses independently frozen wrong bytes, order, runtime, hidden paths and dirty overlays',async t=>{
  const w=await world(t),observed=(await w.call('capture',w.capture,{apply:true})).result,lessonRef=ref(evaluationSection(observed.outputBytes).value.records.find(r=>r.kind==='learning-lesson'));
  const proposed=(await w.call('propose',w.proposal(lessonRef),{apply:true,previous:observed})).result,proposalRef=ref(evaluationSection(proposed.outputBytes).value.records.at(-1)),ledger=await w.load('evaluation-ledger');
  const variants=[
    ['bytes',b=>{const i=b.materials.findIndex(m=>m.id==='acme-public-check');b.materials[i]=sealRecord({...b.materials[i],content:'Acme different bytes'});b.configurations[1].overlays.at(-1).material=reference(b.materials[i]);},/candidate_delivery_mismatch/],
    ['order',b=>{b.configurations[1].overlays.reverse();},/candidate_delivery_mismatch/],
    ['runtime',b=>{b.configurations[1].runtime.version='2';},/plan_noncandidate_fields_changed/],
    ['hidden',b=>{b.configurations[1].overlays.push({path:'acme-hidden.mjs',material:b.configurations[1].overlays[0].material});},/candidate_delivery_mismatch/],
    ['dirty',b=>{b.configurations[1].dirtyOverlay='a'.repeat(64);},/plan_harness_mismatch/],
    ['authority',b=>{b.comparison.authority.ref='2';},/comparison_authority_mismatch/],
  ];
  for(const [id,mutate,error]of variants){const b=structuredClone(w.b);mutate(b);b.configurations=b.configurations.map(sealRecord);b.comparison=sealRecord({...b.comparison,id:'acme-'+id,baseline:reference(b.configurations[0]),candidate:reference(b.configurations[1])});const bundle=join(w.root,'inputs',id+'.json');await writeFile(bundle,JSON.stringify(b));const preview=await ledger.evaluations({...w.options,bundle,action:'freeze'});await ledger.evaluations({...w.options,bundle,action:'freeze',yes:true,digest:preview.digest});await assert.rejects(w.call('bind-plan',{proposalRef,experimentId:b.comparison.id,expectedPlanDigest:preview.digest,targetCaseIds:['acme-case-0'],controlCaseIds:['acme-case-1'],heldOutCaseIds:[]},{previous:proposed}),error);}
});

test('directory and lock replacements retain evidence and never write through the observed replacement',async t=>{
  const root=await temp(t);await mkdir(join(root,'docs/inbox'),{recursive:true});const name='2026-10-24-acme.md',dir=join(root,'docs/inbox'),old=join(root,'docs/original-inbox');
  const nativeOpen=fsp.open;let replaced=false;
  fsp.open=async(path,...args)=>{const handle=await nativeOpen(path,...args);if(String(path).endsWith('.pending')&&!replaced){replaced=true;await fsp.rename(dir,old);await mkdir(dir);await writeFile(join(dir,'owner'),'Acme replacement');}return handle;};syncBuiltinESMExports();
  try{await assert.rejects(withLearningWriter(root,lock=>publishInbox(root,name,null,'Acme approved',lock,{operationId:randomUUID(),requestDigest:'a'.repeat(64)})),/inbox_directory_replaced/);}finally{fsp.open=nativeOpen;syncBuiltinESMExports();}
  assert.deepEqual(await readdir(dir),['owner']);const pending=(await readdir(old))[0];assert.equal((await lstat(join(old,pending))).size,0);
  const second=await temp(t);await mkdir(join(second,'docs/inbox'),{recursive:true});const lockpath=join(second,'docs/.inbox-evaluation.lock');
  await assert.rejects(withLearningWriter(second,async()=>{await fsp.rename(lockpath,lockpath+'.retained');await writeFile(lockpath,'Acme replacement lock');}),/inbox_lock_replaced/);assert.equal(await readFile(lockpath,'utf8'),'Acme replacement lock');
});
test('native publication races refuse without replacing the winning file',async t=>{
  const root=await temp(t);await mkdir(join(root,'docs/inbox'),{recursive:true});const name='2026-10-24-acme.md',destination=join(root,'docs/inbox',name),nativeLink=fsp.link;
  fsp.link=async(from,to)=>{if(to===destination)await writeFile(to,'Acme winning file',{flag:'wx'});return nativeLink(from,to);};syncBuiltinESMExports();
  try{await assert.rejects(withLearningWriter(root,lock=>publishInbox(root,name,null,'Acme approved',lock,{operationId:randomUUID(),requestDigest:'a'.repeat(64)})),/EEXIST/);}finally{fsp.link=nativeLink;syncBuiltinESMExports();}
  assert.equal(await readFile(destination,'utf8'),'Acme winning file');assert((await readdir(join(root,'docs/inbox'))).some(f=>f.endsWith('.pending')));
});
