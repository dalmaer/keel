import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkHarness, token, walkDefinition, walkPhase, phasePath, resultPath, resultBytes, walkItem } from './helpers/web-walks.mjs';
import { validateWalk, newWalkDraft, refreshDraft, draftView, editWalkDraft, acceptanceGaps, stepFingerprint } from '../lib/web/walks-model.mjs';
import { createWalkStore } from '../lib/web/walks-store.mjs';
import { createOperations } from '../lib/web/operations.mjs';
import { createWalks } from '../lib/web/walks.mjs';
import { gitBlob } from '../lib/web/decision-github.mjs';
import { digestOf, feedbackHash, replayEvents } from '../lib/feedback.mjs';
import { walkWritePlan } from '../lib/board.mjs';
import { render, parsePhase } from '../practices/phases/files/scripts/roadmap.mjs';
import { unseal } from '../lib/web/common.mjs';
import { createOperationStore } from '../lib/web/operation-store.mjs';
import { manualRobotIssueIdentity, previewRobotIssue } from '../lib/robot-issue.mjs';
import { robotPolicy } from '../practices/climb/files/scripts/plates/robot-policy.mjs';
const id='acme-search',definitionPath='docs/walks/acme-search.json';
const detail=h=>h.walks.detail(h.access,token,h.project,id);
const save=(h,m,patch)=>h.walks.save(h.access,token,h.project,id,{expectedRevision:m.draft.revision,sourceDigest:m.sourceDigest,...patch});
const preview=(h,m)=>h.walks.preview(h.access,token,h.project,id,{draftDigest:m.draft.digest});
async function complete(h){let m=await detail(h);m=await save(h,m,{environment:'Acme local desktop',resultConfirmed:true});for(const step of m.walk.steps)m=await save(h,m,{step:{id:step.id,outcome:'pass',note:''}});return save(h,m,{finalObservation:'I searched Acme and opened the expected anvil.'});}
function changeDefinition(h,change){const d=JSON.parse(h.source.files[definitionPath]);change(d);h.source.files[definitionPath]=JSON.stringify(d);}
function decrypt(h){const row=[...h.rows.values()][0];return unseal(row.value,h.config.encryptionKey,`walk:${row.scope}:${row.id}`);}
const bad=code=>e=>e.code===code;

test('authored walks reject unknown fields, unsafe targets, duplicate steps, missing prerequisites and cycles',()=>{
 for(const change of [d=>d.script='run',d=>d.result.path='../secret',d=>d.result.previewUrl='https://x.test/?token=a',d=>d.steps.push({...d.steps[0]}),d=>d.steps[0].requires=['missing'],d=>d.steps[0].requires=['open'],d=>d.target.phase='docs/phases/../../other.md',d=>d.result.version=['build-one']]){const d=walkDefinition();change(d);assert.throws(()=>validateWalk(d),bad('invalid_walk_definition'));}
 assert.deepEqual(validateWalk(walkDefinition()),walkDefinition());
});
test('dense twenty-step prerequisite DAG is bounded and fingerprints independent of display order',()=>{
 const d=walkDefinition();d.steps=Array.from({length:20},(_,i)=>({id:`step-${i}`,instruction:`Try ${i}`,expected:`See ${i}`,requires:Array.from({length:i},(_,j)=>`step-${j}`)}));
 validateWalk(d);const before=performance.now(),print=stepFingerprint(d,'step-19');d.steps.reverse();assert.equal(stepFingerprint(d,'step-19'),print);assert.ok(performance.now()-before<1000,'memoized DAG should not expand hundreds of thousands of paths');
});
test('detail retains source-bound binary bytes, attributes serving confirmation, and starts with no observations',async()=>{
 const h=walkHarness(),m=await detail(h),stored=decrypt(h);
 assert.equal(m.ready,true);assert.equal(m.walk.result.verification,'bytes-verified');assert.equal(m.walk.result.servingEvidence,'owner-observation');assert.equal(m.draft.counts.unobserved,2);assert.equal(m.draft.resultConfirmed,false);
 assert.deepEqual(Buffer.from(stored.snapshots[m.walk.result.contentHash],'base64'),resultBytes);assert.deepEqual(stored.feedback,{});assert.ok(![...h.rows.values()][0].value.includes('Acme search'));
 assert.equal(h.source.graphRequests.find(r=>r.query.startsWith('query DecisionResult')).variables.oid,h.source.head);
});
test('guided walks prefer canonical config and recover legacy-only config without resetting readiness or policy',async()=>{
 const canonical=walkHarness();canonical.source.files['.keel/keel.json']='invalid legacy JSON';assert.equal((await detail(canonical)).ready,true);
 const legacy=walkHarness();legacy.source.files['.keel/keel.json']=legacy.source.files['.plates/plates.json'];delete legacy.source.files['.plates/plates.json'];
 const m=await complete(legacy),p=await preview(legacy,m);assert.equal(p.kind,'walk');assert.equal(p.canSubmit,true);assert.equal(legacy.source.writes.length,0);
 legacy.source.files['.keel/keel.json']=JSON.stringify({...JSON.parse(legacy.source.files['.keel/keel.json']),phases:{source:'milestones'}});
 const blocked=await detail(legacy);assert.ok(blocked.gaps.includes('milestone_planning_inspect_only'));assert.equal(blocked.ready,false);
});
test('present malformed or inaccessible canonical walk config never falls back to legacy policy',async()=>{
 for(const status of [null,403,404]){
  const h=walkHarness(),canonical=h.source.files['.plates/plates.json'];h.source.files['.keel/keel.json']=JSON.stringify({...JSON.parse(canonical),name:'Acme legacy policy'});
  const legacyBlob=gitBlob(h.source.files['.keel/keel.json']);let legacyReads=0;
  if(status===null)h.source.files['.plates/plates.json']='invalid canonical JSON';
  const canonicalBlob=gitBlob(h.source.files['.plates/plates.json']);
  h.walks=createWalks(h.config,{now:()=>h.state.now,fetcher:async(url,options)=>{
   if(new URL(url).pathname.endsWith(`/git/blobs/${legacyBlob}`))legacyReads++;
   if(status&&new URL(url).pathname.endsWith(`/git/blobs/${canonicalBlob}`))return Response.json({message:'Acme source unavailable'},{status});
   return h.fetcher(url,options);
  }});
  await assert.rejects(detail(h),status===null?SyntaxError:error=>error.code==='access_denied'||error.code==='upstream_unavailable');
  assert.equal(legacyReads,0);assert.equal(h.rows.size,0);assert.equal(h.source.writes.length,0);
 }
});
test('historical artifact resolution uses authored revision rather than current HEAD and refuses mismatched hashes',async()=>{
 const h=walkHarness(),sha='e'.repeat(40),bytes=Buffer.from([0,255,3,10]);h.source.revisions[sha]={[resultPath]:bytes};changeDefinition(h,d=>Object.assign(d.result,{sourceRevision:sha,contentHash:feedbackHash(bytes)}));
 let m=await detail(h);assert.equal(m.ready,true);assert.deepEqual(Buffer.from(decrypt(h).snapshots[m.walk.result.contentHash],'base64'),bytes);
 changeDefinition(h,d=>d.result.contentHash='0'.repeat(64));m=await detail(h);assert.equal(m.ready,false);assert.ok(m.gaps.includes('result_hash_mismatch'));
});
test('saved partial notes, failure and blocked details reload privately without recording acceptance',async()=>{
 const h=walkHarness();let m=await detail(h);m=await save(h,m,{environment:'Acme phone',step:{id:'find',outcome:'unobserved',note:'Partially typed Acme detail'}});m=await detail(h);assert.equal(m.draft.steps[0].note,'Partially typed Acme detail');assert.equal(m.draft.counts.observed,0);
 await assert.rejects(save(h,m,{step:{id:'find',outcome:'fail',note:''}}),bad('invalid_walk_step'));
 m=await save(h,m,{step:{id:'find',outcome:'fail',note:'Acme showed the wrong item.'}});m=await save(h,m,{step:{id:'open',outcome:'blocked',note:'The item cannot open.'}});assert.deepEqual(m.draft.counts,{observed:2,passed:0,failed:1,blocked:1,unobserved:0});assert.equal(h.source.writes.length,0);assert.equal(h.source.files[phasePath],walkPhase());
 const v=decrypt(h);assert.equal(v.observations.some(o=>'note'in o),false);for(const [feedbackId,events] of Object.entries(v.feedback))assert.equal(replayEvents(events,h.project.repo).id,feedbackId);
 await assert.rejects(preview(h,m),bad('walk_not_ready'));
});
test('draft compare-and-set refuses raced revisions and unavailable storage is never empty',async()=>{
 const h=walkHarness(),a=await detail(h),b=await detail(h);await save(h,a,{environment:'Acme desktop'});await assert.rejects(save(h,b,{environment:'Acme phone'}),bad('draft_conflict'));
 h.state.unavailable=true;await assert.rejects(detail(h));
});
test('encrypted drafts are scoped by authenticated actor and immutable project binding',async()=>{
 const h=walkHarness(),m=await detail(h),store=createWalkStore(h.config,h.fetcher);
 assert.equal(await store.read(2,h.project,id),null);assert.equal(await store.read(1,{...h.project,repoId:999},id),null);
 const row=[...h.rows.values()][0];row.digest='f'.repeat(64);await assert.rejects(store.read(1,h.project,id),bad('invalid_walk_storage'));assert.ok(m.draft.id);
});
test('prerequisites must already pass; later prerequisite retest invalidates dependent and final observations',async()=>{
 const h=walkHarness();let m=await detail(h);await assert.rejects(save(h,m,{step:{id:'open',outcome:'pass',note:''}}),bad('prerequisite_not_passed'));
 m=await complete(h);m=await save(h,m,{step:{id:'find',outcome:'pass',note:'A different actual check.'}});assert.equal(m.draft.steps[1].outcome,'unobserved');assert.equal(m.draft.finalObservation,'');await assert.rejects(preview(h,m),bad('walk_not_ready'));
});
test('unchanged UI form submission adds no observations and does not invalidate downstream passes',async()=>{
 const h=walkHarness(),m=await complete(h),saved=await save(h,m,{step:{id:'find',outcome:'pass',note:''},finalObservation:m.draft.finalObservation,environment:m.draft.environment,resultConfirmed:true,choice:null});assert.equal(saved.draft.digest,m.draft.digest);assert.equal(saved.draft.historyCount,3);assert.equal(saved.draft.counts.passed,2);await preview(h,saved);
});
test('environment changes and switching back require fresh outcomes and confirmation',async()=>{
 const h=walkHarness();let m=await complete(h);m=await save(h,m,{environment:'Acme phone'});m=await save(h,m,{environment:'Acme local desktop'});assert.equal(m.draft.counts.passed,0);assert.equal(m.draft.resultConfirmed,false);assert.equal(m.draft.finalObservation,'');assert.equal(m.draft.historyCount,3);
});
test('reordering identical stable steps preserves observations; changed and reverted instructions do not',async()=>{
 const h=walkHarness();let m=await complete(h);changeDefinition(h,d=>d.steps.reverse());m=await detail(h);assert.equal(m.draft.counts.passed,2);assert.ok(m.draft.finalObservation);
 changeDefinition(h,d=>d.steps.find(s=>s.id==='find').instruction='Find another Acme thing.');m=await detail(h);assert.equal(m.draft.counts.passed,0);
 changeDefinition(h,d=>d.steps.find(s=>s.id==='find').instruction=walkDefinition().steps[0].instruction);m=await detail(h);assert.equal(m.draft.counts.passed,0);assert.equal(m.draft.history[0].step.instruction,walkDefinition().steps[0].instruction);
});
test('changed build and switching back do not revive old passes',async()=>{
 const h=walkHarness();let m=await complete(h);changeDefinition(h,d=>d.result.version='build-two');m=await detail(h);changeDefinition(h,d=>d.result.version='build-one');m=await detail(h);assert.equal(m.draft.counts.passed,0);assert.equal(m.draft.resultConfirmed,false);assert.equal(m.draft.history[0].result.version,'build-one');
});
test('changed phase or acceptance target invalidates all outcomes even for same result and walk ID',async()=>{
 for(const change of [d=>d.target.phase='docs/phases/02-other.md',d=>d.target.acceptanceHash='f'.repeat(64)]){
 const h=walkHarness();await complete(h);const store=createWalkStore(h.config,h.fetcher),row=await store.read(1,h.project,id),capture=structuredClone(row.value.capture);change(capture.definition);const value=refreshDraft(row.value,capture,resultBytes),view=draftView({...row,value});assert.equal(view.counts.passed,0);assert.equal(view.resultConfirmed,false);assert.ok(acceptanceGaps({...row,value}).length);
 }
});
test('readiness uses server date, explicit authored readiness, dependencies, waiting state, Your part and planning ownership',async()=>{
 for(const [change,code] of [
 [h=>h.source.files[phasePath]=walkPhase().replace('waits: owner','waits: owner\nafter: 2026-10-22'),'phase_date_not_ready'],
 [h=>changeDefinition(h,d=>d.readiness.state='not-ready'),'authored_readiness_not_ready'],
 [h=>h.source.files[phasePath]=walkPhase().replace('waits: owner','waits: external'),'phase_not_waiting_for_owner'],
 [h=>h.source.files[phasePath]+='\n## Your part\n\n- **Ready when:** Acme is deployed.\n','your_part_not_ready'],
 [h=>h.source.files['.plates/plates.json']=JSON.stringify({practices:['phases'],phases:{source:'milestones'}}),'milestone_planning_inspect_only']]){const h=walkHarness();change(h);const m=await detail(h);assert.equal(m.ready,false,code);assert.ok(m.gaps.includes(code),JSON.stringify(m.gaps));}
 const h=walkHarness();h.source.files[phasePath]=walkPhase().replace('depends: []','depends: [2]');h.source.files['docs/phases/02-acme-dependency.md']=walkPhase().replace('status: partial','status: planned').replace('owes: walk\nwaits: owner\n','');assert.ok((await detail(h)).gaps.includes('phase_dependencies_not_ready'));
});
test('duplicate matching open acceptance items and absent authored records remain gaps',async()=>{
 const h=walkHarness();h.source.files[phasePath]=walkPhase().replace(`- [ ] ${walkItem}`,`- [ ] ${walkItem}\n- [ ] ${walkItem}`);assert.ok((await detail(h)).gaps.includes('acceptance_target_unavailable'));delete h.source.files[definitionPath];assert.deepEqual((await h.walks.list(h.access,token,h.project)).gaps,['authored_walks_missing']);
});
test('acceptance requires actual environment, displayed-result confirmation and final owner observation',async()=>{
 const h=walkHarness();let m=await detail(h);m=await save(h,m,{step:{id:'find',outcome:'pass',note:''}});m=await save(h,m,{step:{id:'open',outcome:'pass',note:''}});await assert.rejects(preview(h,m),bad('walk_not_ready'));
 m=await save(h,m,{environment:'Acme desktop',resultConfirmed:true});await assert.rejects(preview(h,m),bad('walk_not_ready'));for(const s of m.walk.steps)m=await save(h,m,{step:{id:s.id,outcome:'pass',note:''}});await assert.rejects(preview(h,m),bad('walk_not_ready'));m=await save(h,m,{finalObservation:'I observed both Acme steps.'});assert.equal((await preview(h,m)).files.length,3);
});
test('acceptance preview reuses pure CLI selected-box plan, exact evidence and generated roadmap without writes',async()=>{
 const h=walkHarness(),m=await complete(h),p=await preview(h,m),pure=walkWritePlan({file:phasePath.split('/').at(-1),raw:walkPhase(),note:m.draft.finalObservation,box:2,today:'2026-10-21'});
 assert.deepEqual(p.files.slice(0,2).map(f=>[f.path,f.content]),pure.writes);assert.equal(p.files[1].originalBlob,null);assert.match(p.files[0].content,/status: built/);assert.match(p.files[0].content,/\[x\] Search is covered/);assert.match(p.files[0].content,/\[x\] ⚑ by hand/);
 const roadmap=render({config:JSON.parse(h.source.files['.plates/plates.json']),phases:[parsePhase(phasePath.split('/').at(-1),p.files[0].content)],goals:JSON.parse(h.source.files['docs/goals.json'])});assert.equal(p.files[2].content,roadmap);assert.equal(p.commitMessage,`Record Plates guided walk\n\nKeel-Operation: ${p.operationId}`);assert.equal(h.source.writes.length,0);assert.ok(p.digest);assert.equal(p.visibility,'public');
});
test('preview refuses source changes, edits after preview and stale application without dispatch',async()=>{
 const h=walkHarness(),m=await complete(h),p=await preview(h,m);await save(h,m,{step:{id:'open',outcome:'fail',note:'Acme no longer opens.'}});
 const ops=createOperations(h.config,{fetcher:h.fetcher,now:()=>h.state.now,inspectWalk:h.walks.inspectPreview}),receipt=await ops.apply(h.access,token,h.project,p.id,{publicAcknowledgement:p.digest,reauthorize:async()=>h.access});assert.equal(receipt.state,'refused');assert.equal(receipt.reason,'stale_draft');assert.equal(h.source.writes.length,0);
 const h2=walkHarness(),m2=await complete(h2);h2.source.revisions[h2.source.head]={...h2.source.files};h2.source.head='e'.repeat(40);await assert.rejects(preview(h2,m2),bad('walk_source_changed'));
});
test('shared reservation blocks draft mutation through dispatch and uncertain recovery; source commit is verified once',async()=>{
 const h=walkHarness(),m=await complete(h),p=await preview(h,m);let attempted=false;
 h.source.onDispatch=()=>{attempted=true;};h.source.mode='lost';
 const ops=createOperations(h.config,{fetcher:h.fetcher,now:()=>h.state.now,inspectWalk:async(...args)=>{await assert.rejects(save(h,m,{step:{id:'open',outcome:'fail',note:'Concurrent Acme change.'}}),bad('project_busy'));return h.walks.inspectPreview(...args);}});
 const first=await ops.apply(h.access,token,h.project,p.id,{publicAcknowledgement:p.digest,reauthorize:async()=>h.access});assert.equal(first.state,'uncertain');assert.equal(attempted,true);assert.equal(h.source.writes.length,1);await assert.rejects(save(h,m,{environment:'Other Acme device'}),bad('project_busy'));
 const recovered=await ops.recover(h.access,token,h.project,p.operationId);assert.equal(recovered.state,'committed');assert.equal(recovered.receipt.paths.length,3);assert.equal(h.source.writes.length,1);
});
test('public acceptance requires exact preview digest acknowledgement and writes remain disabled by default',async()=>{
 const h=walkHarness(),m=await complete(h),p=await preview(h,m),ops=createOperations(h.config,{fetcher:h.fetcher,now:()=>h.state.now,inspectWalk:h.walks.inspectPreview});await assert.rejects(ops.apply(h.access,token,h.project,p.id,{reauthorize:async()=>h.access}),bad('public_acknowledgement_required'));
 const disabled=createWalks({...h.config,decisionWrites:false},{fetcher:h.fetcher,now:()=>h.state.now});assert.equal((await disabled.preview(h.access,token,h.project,id,{draftDigest:m.draft.digest})).canSubmit,false);
});

test('source-valid choices and Keeps it open cannot be bypassed for acceptance',async()=>{
 const h=walkHarness();h.source.files[phasePath]+='\n## Your part\n\n- **Ready:** yes\n- **Choices:** Keep it | Drop it | Not enough data yet\n- **Keeps it open:** Not enough data yet\n- **Then:** Record the answer.\n';
 let m=await complete(h);await assert.rejects(preview(h,m),bad('invalid_choice'));m=await save(h,m,{choice:'Not enough data yet'});await assert.rejects(preview(h,m),bad('choice_keeps_open'));m=await save(h,m,{choice:'Keep it'});assert.match((await preview(h,m)).files[1].content,/Chose: Keep it/);
});
test('target box is rederived after another box is inserted and only selected acceptance changes',async()=>{
 const h=walkHarness();h.source.files[phasePath]=walkPhase().replace(`- [ ] ${walkItem}`,`- [ ] ⚑ by hand: inspect another Acme surface.\n- [ ] ${walkItem}`);
 const m=await complete(h),p=await preview(h,m);assert.equal(m.walk.target.box,3);assert.match(p.files[0].content,/status: partial/);assert.match(p.files[0].content,/- \[ \] ⚑ by hand: inspect another Acme surface/);assert.match(p.files[0].content,/- \[x\] ⚑ by hand: the owner tries/);
});
test('date boundary makes old preview stale even when HEAD is unchanged',async()=>{
 const h=walkHarness(),m=await complete(h),p=await preview(h,m);h.state.now+=86400000;await assert.rejects(h.walks.inspectPreview(h.access,token,h.project,p),bad('walk_source_changed'));
});
test('existing evidence appends and generated roadmap preserves design/lesson links',async()=>{
 const h=walkHarness();h.source.files[phasePath]=walkPhase().replace('evidence: []','evidence: ["evidence/acme.md"]');h.source.files['docs/evidence/acme.md']='# Earlier Acme evidence\n';h.source.files['docs/design.md']='# Acme design\n';h.source.files['docs/lessons.md']='# Acme lessons\n';h.source.files['.plates/plates.json']=JSON.stringify({...JSON.parse(h.source.files['.plates/plates.json']),tagline:'Acme search.'});
 const p=await preview(h,await complete(h));assert.equal(p.files[1].path,'docs/evidence/acme.md');assert.match(p.files[1].content,/^# Earlier Acme evidence/);assert.ok(p.files[1].originalBlob);assert.match(p.files[2].content,/\[Design\]\(design.md\).*\[Lessons\]\(lessons.md\)/);
});
test('new evidence collision and unreadable output size are refused before persistence',async()=>{
 const h=walkHarness();h.source.files['docs/evidence/2026-10-21-phase-1-walk.md']='Other Acme evidence';await assert.rejects(preview(h,await complete(h)),bad('evidence_destination_exists'));
 const h2=walkHarness();h2.source.files[phasePath]=walkPhase().replace('evidence: []','evidence: ["evidence/acme.md"]');h2.source.files['docs/evidence/acme.md']='x'.repeat(262100);await assert.rejects(preview(h2,await complete(h2)),bad('output_limit'));
});
test('per-draft storage bound refuses capacity without deleting any history',async()=>{
 const h=walkHarness();await detail(h);const store=createWalkStore(h.config,h.fetcher),row=await store.read(1,h.project,id),value=structuredClone(row.value);value.revision++;value.snapshots.extra='x'.repeat(1048576);await assert.rejects(store.save(1,h.project,id,row.revision,value),bad('walk_capacity'));assert.equal((await store.read(1,h.project,id)).digest,row.digest);
});
test('selected historical failure repair retains original authored step, environment and result through phase92 issue identity',async()=>{
 for(const legacy of [false,true]){
 const h=walkHarness();if(legacy){h.source.files['.keel/keel.json']=h.source.files['.plates/plates.json'];delete h.source.files['.plates/plates.json'];}let m=await detail(h);m=await save(h,m,{environment:'Acme phone',step:{id:'find',outcome:'fail',note:'The Acme anvil is missing.'}});const entry=m.draft.history[0];changeDefinition(h,d=>d.steps[0].instruction='Try a different Acme query.');m=await detail(h);
 const publication={schema:1,feedbackDigest:entry.feedbackDigest,excerpt:'The Acme anvil is missing.',destination:h.project.repo,title:'Repair Acme search',rubric:{version:1,problem:'Acme search is incomplete.',reproduction:'Search for Acme anvil.',acceptance:'The expected item is visible.',change:'Repair the missing result.',prerequisites:[],ownerBlockers:[]}};
 const p=await h.walks.repair(h.access,token,h.project,id,{stepId:'find',feedbackDigest:entry.feedbackDigest,publication});assert.equal(p.status,'preview');assert.equal(p.handoff.kind,'issue');assert.equal(p.route.acceptance,'not-established');assert.match(p.outbound.body,/Search for the Acme anvil/);assert.doesNotMatch(p.outbound.body,/Try a different Acme query/);assert.match(p.outbound.body,/Actual environment: Acme phone/);assert.match(p.outbound.body,/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/);
 const identity=manualRobotIssueIdentity(h.project.repo,p.handoff.title,p.handoff.rubric);assert.equal(p.handoff.instanceId,identity.instanceId);assert.equal(previewRobotIssue({repo:h.project.repo,title:p.handoff.title,rubric:p.handoff.rubric,policy:robotPolicy(JSON.parse(h.source.files[legacy?'.keel/keel.json':'.plates/plates.json'])),...identity}).body,p.outbound.body);assert.equal(h.source.writes.length,0);assert.equal(h.db.operations.size,0);assert.equal(p.feedbackDigest,entry.feedbackDigest);
 await assert.rejects(h.walks.repair(h.access,token,h.project,id,{stepId:'find',feedbackDigest:entry.feedbackDigest,publication:{...publication,excerpt:'Fabricated approval'}}),bad('invalid_excerpt'));
 }
});
test('strict save and repair input reject unknown fields and malformed values',async()=>{
 const h=walkHarness(),m=await detail(h);await assert.rejects(save(h,m,{script:'run'}),bad('invalid_walk_save'));await assert.rejects(save(h,m,{environment:['Acme']}),bad('invalid_environment'));await assert.rejects(save(h,m,{step:{id:'find',outcome:'pass',note:'',unknown:1}}),bad('invalid_walk_step'));await assert.rejects(h.walks.repair(h.access,token,h.project,id,{stepId:'find',feedbackDigest:'f'.repeat(64),publication:{},unknown:1}),bad('invalid_repair'));
});

test('an unchanged final observation in a combined form cannot be replayed onto changed step observations',async()=>{
 const h=walkHarness(),m=await complete(h),saved=await save(h,m,{step:{id:'open',outcome:'pass',note:'A new actual Acme detail.'},finalObservation:m.draft.finalObservation});assert.equal(saved.draft.finalObservation,'');assert.equal(saved.draft.historyCount,4);await assert.rejects(preview(h,saved),bad('walk_not_ready'));
});

test('repair never turns missing retained result bytes into a complete reviewed-result handoff',async()=>{
 const h=walkHarness();let m=await detail(h);m=await save(h,m,{step:{id:'find',outcome:'fail',note:'The Acme result is missing.'}});const e=m.draft.history[0],store=createWalkStore(h.config,h.fetcher),row=await store.read(1,h.project,id),value=structuredClone(row.value);value.snapshots={};value.revision++;await store.save(1,h.project,id,row.revision,value);await assert.rejects(h.walks.repair(h.access,token,h.project,id,{stepId:'find',feedbackDigest:e.feedbackDigest,publication:{}}),bad('result_bytes_unavailable'));
});
