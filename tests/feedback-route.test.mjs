import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { feedbackFixture, feedbackWords } from './helpers/feedback.mjs';
import { feedbackCapture, feedbackPropose, feedbackList } from '../lib/feedback-service.mjs';
import { ensureRobotIssue, recoverRobotIssue, robotTargetPolicy, robotRubricFile, manualRobotIssueIdentity, robotIssueInstance } from '../lib/robot-issue.mjs';
import { inspectShape, validateShape } from '../lib/shaping.mjs';
const opts=h=>({root:h.root,env:h.env,now:()=>new Date('2026-10-21T14:00:00.000Z')});
async function prepared(h,work){if(work)h.record.result.work=work;await h.save('capture.json',h.record);const p=await feedbackCapture({...opts(h),file:'capture.json'});assert.equal(p.exitCode,3,JSON.stringify(p.data));const s=await feedbackCapture({...opts(h),file:'capture.json',yes:true,digest:p.data.digest});assert.equal(s.exitCode,0,JSON.stringify(s.data));await h.save('publication.json',h.publication(s.data.item.digest));return s.data.item;}
function workAPI(kind,state){return async req=>{assert.equal(req.method,'GET');return {status:200,data:{number:12,state,html_url:`https://github.com/acme/studio/${kind==='pr'?'pull':'issues'}/12`,url:`https://api.github.com/repos/acme/studio/${kind==='pr'?'pulls':'issues'}/12`}};};}
test('fresh open and closed issue/PR facts propose follow-up or repair; unknown/wrong-identity facts stop routing',async t=>{
 for(const kind of ['issue','pr']){
  const h=await feedbackFixture(t),item=await prepared(h,{kind,ref:'acme/studio#12'});
  for(const [state,route] of [['open','follow-up'],['closed','repair']]){const r=await feedbackPropose({...opts(h),id:item.id,record:'publication.json',github:workAPI(kind,state)});assert.equal(r.exitCode,3,JSON.stringify(r.data));assert.equal(r.data.route.kind,route);assert.match(r.data.outbound.body,/Original work:/);assert.equal(r.data.route.fact.observedAt,'2026-10-21T14:00:00.000Z');}
  for(const github of [async()=>{throw Error('Private token secret');},async()=>({status:404}),async()=>({status:200,data:{number:12,state:'open',html_url:'https://github.com/acme/other/issues/12'}}),workAPI(kind,'unknown')]){
   const r=await feedbackPropose({...opts(h),id:item.id,record:'publication.json',github});assert.equal(r.exitCode,2);assert.equal(r.data.route.kind,'unavailable');assert.doesNotMatch(JSON.stringify(r),/secret/);
  }
 }
});
test('local phase is planning context, not closure or acceptance; unavailable configured adapter cannot return an empty route',async t=>{
 const h=await feedbackFixture(t),item=await prepared(h,{kind:'phase',ref:'92'});let calls=0;
 const r=await feedbackPropose({...opts(h),id:item.id,record:'publication.json',github:async()=>{calls++;throw Error();}});
 assert.equal(r.exitCode,3);assert.equal(r.data.route.kind,'new-change');assert.equal(r.data.route.acceptance,'not-established');assert.equal(calls,0);
 const other=await feedbackFixture(t),remote=await prepared(other,{kind:'issue',ref:'acme/studio#12'});assert.equal((await feedbackPropose({...opts(other),id:remote.id,record:'publication.json'})).exitCode,2);
});
test('explicit conflicts require current accepted canonical choices and yield only a shaping reopening proposal',async t=>{
 const h=await feedbackFixture(t),ref='docs/decisions/storage.md#storage';
 await mkdir(join(h.root,'docs/decisions'),{recursive:true});
 const put=async status=>writeFile(join(h.root,'docs/decisions/storage.md'),`<a id="storage"></a>\n# Storage\nAcme retains immutable previews.\n\`\`\`keel-decision\n${JSON.stringify({version:1,id:'storage',status,scope:['previews'],decided_by:'Acme Owner',decided_at:'2026-10-21',supersedes:[],superseded_by:[]})}\n\`\`\`\n`);
 await put('accepted');h.record.conflicts=[{ref,reason:'Acme private conflict explanation'}];const item=await prepared(h);
 assert.equal((await feedbackPropose({...opts(h),id:item.id,record:'publication.json'})).data.error,'shaping_draft_required');
 const publication=h.publication(item.digest);publication.shaping={version:1,id:'acme-reopening',revision:1,date:'2026-10-21',goal:'G0',sources:['docs/decisions/storage.md'],questions:[{id:'reopen',question:'Should the Acme choice be reopened?',whyOwner:'Only the owner can change this accepted choice.',recommendation:{text:'Review the selected result first.',evidence:[ref],alternatives:['Keep the current accepted choice.']}}],answers:[],proposedDecisions:[],items:[{id:'review',kind:'robot',title:'Review the Acme choice',problem:'Acme feedback conflicts with the recorded choice.',scope:'Review the selected result and current choice.',doneWhen:'The owner has reviewed whether the choice should change.',proof:['node --test tests/acme-choice.test.mjs'],depends:[],decisions:[ref],ownerPrerequisites:['reopen'],surfaces:[]}]};
 await h.save('publication.json',publication);
 const r=await feedbackPropose({...opts(h),id:item.id,record:'publication.json'});assert.equal(r.exitCode,3,JSON.stringify(r.data));assert.equal(r.data.route.kind,'reopen-decision');assert.equal(r.data.handoff.kind,'shaping');assert.equal(r.data.reopening.status,'proposed');assert.deepEqual(r.data.reopening.decisionRefs,[ref]);assert.doesNotMatch(JSON.stringify(r),/private conflict explanation/);
 assert.deepEqual(validateShape(r.data.handoff.record),publication.shaping);assert.equal(r.data.outbound.body,JSON.stringify(publication.shaping,null,2)+'\n');assert.deepEqual(r.data.handoff.record.answers,[]);
 h.config.practices=['shaping'];await h.save('.plates/plates.json',h.config);await h.save('docs/goals.json',[{id:'G0',title:'Acme review',outcome:'Owner choices remain explicit.'}]);await h.save('reopening.json',r.data.handoff.record);
 const plan=await inspectShape(h.root,'reopening.json');assert.equal(plan.previews[0].kind,'robot');assert.deepEqual(plan.previews[0].rubric.ownerBlockers,['reopen']);
 const extra=structuredClone(publication);extra.shaping.items[0].decisions.push('docs/decisions/missing.md#absent');await h.save('publication.json',extra);assert.equal((await feedbackPropose({...opts(h),id:item.id,record:'publication.json'})).data.error,'decision_context_unavailable');
 const missing=structuredClone(publication);missing.shaping.items[0].decisions=[];await h.save('publication.json',missing);assert.equal((await feedbackPropose({...opts(h),id:item.id,record:'publication.json'})).data.error,'shaping_conflict_reference_missing');
 const invalid=structuredClone(publication);invalid.shaping.items[0].proof=[];await h.save('publication.json',invalid);assert.equal((await feedbackPropose({...opts(h),id:item.id,record:'publication.json'})).data.error,'invalid_shaping_draft');
 publication.shaping.answers=[{question:'reopen',actor:'Acme Owner',role:'owner',time:'2026-10-21T13:00:00.000Z',source:'Manual Acme owner instruction',text:'Review the choice; do not replace it yet.'}];await h.save('publication.json',publication);const answered=await feedbackPropose({...opts(h),id:item.id,record:'publication.json'});assert.deepEqual(answered.data.handoff.record.answers,publication.shaping.answers);assert.equal(answered.data.handoff.attribution,'manual-not-authenticated');assert.match(await readFile(join(h.root,'docs/decisions/storage.md'),'utf8'),/"status":"accepted"/);
 await put('proposed');assert.equal((await feedbackPropose({...opts(h),id:item.id,record:'publication.json'})).exitCode,2);
 await put('accepted');await writeFile(join(h.root,'docs/decisions/storage.md'),'# Missing exact anchored choice');assert.equal((await feedbackPropose({...opts(h),id:item.id,record:'publication.json'})).exitCode,2);
});
test('publication requires current digest, exact selected excerpt, same destination and bounded authored rubric',async t=>{
 const h=await feedbackFixture(t),item=await prepared(h);
 for(const mutation of [p=>p.feedbackDigest='f'.repeat(64),p=>p.excerpt='Invented owner approval',p=>p.destination='acme/other',p=>p.rubric.problem='x'.repeat(4000),p=>p.rubric.decisions=['docs/missing.md#absent']]){
  const p=h.publication(item.digest);mutation(p);await h.save('publication.json',p);const r=await feedbackPropose({...opts(h),id:item.id,record:'publication.json'});assert.equal(r.exitCode,2);assert.doesNotMatch(JSON.stringify(r),/Invented owner approval/);
 }
});
test('publication handoff is byte-identical to issue new normalization and uses existing uncertain-write journal recovery',async t=>{
 for(const mode of ['landed','absent']){
  const h=await feedbackFixture(t),item=await prepared(h),r=await feedbackPropose({...opts(h),id:item.id,record:'publication.json'});assert.equal(r.exitCode,3);
  const proposal=r.data;assert.doesNotMatch(proposal.outbound.body,/Acme private feedback:/);assert.match(proposal.outbound.body,/the second row is missing/);assert.equal(proposal.excerpt,h.publication(item.digest).excerpt);
  await assert.rejects(readdir(join(h.root,'.plates/robot-issues')),{code:'ENOENT'});
  const handoff=proposal.handoff;await h.save('rubric.json',handoff.rubric);const rubric=await robotRubricFile(join(h.root,'rubric.json')),identity=manualRobotIssueIdentity(handoff.repo,handoff.title,rubric);
  assert.equal(identity.subjectKey,`manual:${robotIssueInstance(handoff.title.trim())}`);assert.equal(identity.instanceId,robotIssueInstance(handoff.repo.toLowerCase(),identity.subjectKey,rubric));assert.equal(identity.instanceId,handoff.instanceId);
  const policy=await robotTargetPolicy({root:h.root,repo:handoff.repo}),rows=[];let posts=0;
  const github=async req=>{
   if(req.method==='POST'){posts++;assert.equal(req.body.body,proposal.outbound.body);assert.equal(req.body.title,proposal.outbound.title);assert.deepEqual(req.body.labels,proposal.outbound.labels);if(mode==='landed')rows.push({number:1,state:'open',html_url:'https://github.com/acme/studio/issues/1',url:'https://api.github.com/repos/acme/studio/issues/1',body:req.body.body,labels:[]});throw Error('Acme lost response');}
   return {status:200,data:/\/issues\/1$/.test(req.path)?rows[0]:rows};
  };
  const args={repo:handoff.repo,title:handoff.title,rubric,policy,...identity,stateDir:join(h.root,'.plates/robot-issues'),github};
  const preview=await ensureRobotIssue(args);assert.equal(preview.state,'preview');assert.equal(preview.preview.body,proposal.outbound.body);
  const delivered=await ensureRobotIssue({...args,yes:true});assert.equal(delivered.state,mode==='landed'?'recovered':'pending');
  const repeated=await ensureRobotIssue({...args,yes:true}),recovered=await recoverRobotIssue(args);assert.equal(repeated.state,delivered.state);assert.equal(recovered.state,delivered.state);assert.equal(posts,1);
  assert.equal((await feedbackList(opts(h))).data.items[0].state,'pending');
 }
});
test('manual issue identity preserves normalized historical subject and instance bytes',async()=>{
 const rubric={ownerBlockers:[],prerequisites:[],change:' One change. ',acceptance:' It works. ',reproduction:' Run Acme. ',problem:' Acme problem. ',version:1};
 const normalized={version:1,problem:'Acme problem.',reproduction:'Run Acme.',acceptance:'It works.',change:'One change.',prerequisites:[],ownerBlockers:[]};
 const expectedSubject=`manual:${robotIssueInstance('Acme title')}`;
 assert.deepEqual(manualRobotIssueIdentity('ACME/STUDIO',' Acme title ',rubric),{subjectKey:expectedSubject,instanceId:robotIssueInstance('acme/studio',expectedSubject,normalized)});
});
