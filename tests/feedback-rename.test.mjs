import './helpers/hermetic.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { feedbackFixture } from './helpers/feedback.mjs';
import { feedbackCapture, feedbackList, feedbackResolve, feedbackPropose } from '../lib/feedback-service.mjs';
import { createFeedbackStore } from '../lib/feedback-store.mjs';
import { feedbackHash, observationId, validateCapture } from '../lib/feedback.mjs';
import { planRename, applyRename } from '../lib/rename.mjs';

const oldProject='dalmaer/keel', project='dalmaer/plates'; // The actual product rename, with synthetic Acme content.
const options=h=>({root:h.root,env:h.env});
async function capture(h){
 const preview=await feedbackCapture({...options(h),file:'capture.json'});
 assert.equal(preview.exitCode,3,JSON.stringify(preview.data));
 const saved=await feedbackCapture({...options(h),file:'capture.json',yes:true,digest:preview.data.digest});
 assert.equal(saved.exitCode,0,JSON.stringify(saved.data));return saved.data.item;
}
async function migrateFeedback(t){
 const h=await feedbackFixture(t);
 h.config.repo=oldProject;h.config.plates='self';h.record.project=oldProject;
 h.record.result.work={kind:'issue',ref:`${oldProject}#7`};
 await writeFile(join(h.root,'.plates/plates.json'),JSON.stringify(h.config));await h.save('capture.json',h.record);
 const item=await capture(h),event=await readFile(join(h.root,'.plates/feedback',item.id,'00000001.json'));
 // Represent the pre-rename checkout without changing the captured event or snapshot.
 await rename(join(h.root,'.plates'),join(h.root,'.keel'));
 const legacy={...h.config,keel:'self'};delete legacy.plates;
 await rename(join(h.root,'.keel/plates.json'),join(h.root,'.keel/keel.json'));
 await writeFile(join(h.root,'.keel/keel.json'),JSON.stringify(legacy));
 await writeFile(join(h.root,'.git/info/exclude'),'/.keel/feedback/\n');
 h.git('add','--','.plates/plates.json','.keel/keel.json');h.git('commit','-qm','Acme legacy configuration');
 const plan=await planRename(h.root);await applyRename(h.root,{digest:plan.digest});
 return {h,item,event};
}

test('self rename preserves feedback replay, current routing, resolution and new capture without rewriting history',async t=>{
 const {h,item,event}=await migrateFeedback(t),listed=await feedbackList(options(h));
 assert.equal(listed.exitCode,0,JSON.stringify(listed.data));assert.equal(listed.data.items[0].id,item.id);assert.equal(listed.data.items[0].digest,item.digest);
 assert.deepEqual(await readFile(join(h.root,'.plates/feedback',item.id,'00000001.json')),event);
 const config=JSON.parse(await readFile(join(h.root,'.plates/plates.json'),'utf8'));
 assert.equal(config.repo,project);assert.equal(config.feedbackProject,oldProject);
 const publication={...h.publication(item.digest),destination:project};await h.save('publication.json',publication);
 const calls=[],github=async request=>{calls.push(request);return {status:200,data:{number:7,state:'open',html_url:`https://github.com/${project}/issues/7`,url:`https://api.github.com/repos/${project}/issues/7`}};};
 const proposal=await feedbackPropose({...options(h),id:item.id,record:'publication.json',github});
 assert.equal(proposal.exitCode,3,JSON.stringify(proposal.data));assert.equal(proposal.data.destination,project);assert.equal(proposal.data.handoff.repo,project);
 assert.equal(proposal.data.route.kind,'follow-up');assert.equal(proposal.data.route.work.ref,`${oldProject}#7`);
 assert.equal(proposal.data.links.source,`https://github.com/${oldProject}/commit/${h.record.result.sourceRevision}`);
 assert.equal(proposal.data.links.work,`https://github.com/${project}/issues/7`);assert.deepEqual(calls,[{method:'GET',path:`/repos/${project}/issues/7`}]);
 await h.save('publication.json',{...publication,destination:'acme/other'});
 assert.equal((await feedbackPropose({...options(h),id:item.id,record:'publication.json',github})).data.error,'destination_mismatch');
 await h.save('resolution.json',h.resolution(item.digest));
 const preview=await feedbackResolve({...options(h),id:item.id,record:'resolution.json'});assert.equal(preview.exitCode,3,JSON.stringify(preview.data));
 assert.equal((await feedbackResolve({...options(h),id:item.id,record:'resolution.json',yes:true,digest:preview.data.digest})).exitCode,0);
 const next=structuredClone(h.record);next.project=project;next.source.id='owner-note-2';next.result.version='v2';next.result.work.ref=`${project}#7`;
 await h.save('capture.json',next);const current=await capture(h);assert.equal(current.project,project);
 const all=await feedbackList(options(h));assert.equal(all.data.items.length,2);assert.equal(all.data.items.find(row=>row.id===item.id).state,'declined');
 assert.deepEqual(await readFile(join(h.root,'.plates/feedback',item.id,'00000001.json')),event);
 // The new spelling cannot evade the immutable artifact/version contract.
 const changed={...next,result:{...next.result,version:'v1',contentHash:feedbackHash('changed Acme bytes')}};
 await h.save('capture.json',changed);assert.equal((await feedbackCapture({...options(h),file:'capture.json'})).data.error,'immutable_result_changed');
 const scoped=await createFeedbackStore({...options(h),project,previousProject:oldProject}),record=validateCapture(changed,project,oldProject);
 await assert.rejects(scoped.append({kind:'capture',record,id:observationId(record),expected:null}),/immutable_result_changed/);
 const unscoped=await createFeedbackStore({...options(h),project});await assert.rejects(unscoped.inventory(),/invalid_capture/);
 const wrong=await createFeedbackStore({...options(h),project:'acme/other'});await assert.rejects(wrong.inventory(),/invalid_capture/);
 await assert.rejects(createFeedbackStore({...options(h),project:'acme/other',previousProject:oldProject}),/invalid_feedback_project/);
 await writeFile(join(h.root,'.plates/plates.json'),JSON.stringify({...config,repo:'acme/other'}));
 assert.equal((await feedbackList(options(h))).exitCode,2);
});
