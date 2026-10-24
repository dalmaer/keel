import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalWorld } from './helpers/learning-approval-github.mjs';
import { validateLearningApproval,inspectLearningApprovalPolicy,verifyLearningMerge,validateLearningPolicyObservation,validateLearningMergeObservation } from '../lib/learning-approval-github.mjs';
const copy=x=>structuredClone(x);
const opts=w=>({env:w.env,deadline:Date.now()+30000});
test('Acme real two-parent Git merge verifies deterministic provider observations without raw bodies',async t=>{
 const w=await approvalWorld(t),p=await inspectLearningApprovalPolicy({repo:w.expected.repo},opts(w));assert.equal(p.state,'configured');assert.equal(validateLearningPolicyObservation(p),p);
 const r=await verifyLearningMerge(w.expected,opts(w));assert.equal(r.merge.mergeSha,w.merge);assert.equal(validateLearningMergeObservation(r),r);assert.deepEqual(await verifyLearningMerge(w.expected,opts(w)),r);assert(!JSON.stringify(r).includes('Acme before'));assert(!JSON.stringify(r).includes('plates-learning-approval-v1'));
 const log=await w.calls();assert(!/POST|PATCH|DELETE/.test(log));
 for(const mutate of [r=>r.extra=true,r=>r.policy.approval.ownerApproverIds=[8],r=>r.merge.parentShas.reverse(),r=>r.review.state='DISMISSED',r=>r.artifact.path='acme.json',r=>r.review.bodySha256='0'.repeat(64)]){const v=copy(r);mutate(v);assert.throws(()=>validateLearningMergeObservation(v));}
});
test('missing policy is disabled; malformed or unknown policy is refusal',async t=>{
 const w=await approvalWorld(t,{config:{}});assert.equal((await inspectLearningApprovalPolicy({repo:w.expected.repo},opts(w))).state,'not-configured');await assert.rejects(verifyLearningMerge(w.expected,opts(w)),/not_configured/);
 for(const v of [null,{}, {schemaVersion:1,provider:'github',ownerApproverIds:[]},{schemaVersion:1,provider:'github',ownerApproverIds:[7,7]},{schemaVersion:1,provider:'github',ownerApproverIds:[7],verified:true}])assert.throws(()=>validateLearningApproval(v));
 await assert.rejects(inspectLearningApprovalPolicy({repo:'https://enterprise/Acme/widgets'},opts(w)),/unsupported/);
});
test('decisive reviews cannot be cleared by comments, hidden older approvals or bots',async t=>{
 const w=await approvalWorld(t),original=copy(w.routes[w.reviewsKey]);
 for(const [label,mutate] of [
  ['bot',r=>{r[0].user.type='Bot';}],['wrong ID',r=>{r[0].user.id=9;}],['author',r=>{r[0].user.id=8;}],['dismissed',r=>{r[0].state='DISMISSED';}],['head',r=>{r[0].commit_id=w.base;}],['marker',r=>{r[0].body+=' extra';}],['membership',r=>{r[0].pull_request_url+='2';}],
  ['dismissed cannot clear request',r=>r.push({...r[0],id:12,user:{id:9,type:'User'},state:'CHANGES_REQUESTED'},{...r[0],id:13,user:{id:9,type:'User'},state:'DISMISSED',submitted_at:'2026-10-24T11:01:00Z'})],
  ['inconsistent immutable account type',r=>r.push({...r[0],id:12,user:{id:7,type:'Bot'},state:'COMMENTED'})],
  ['older',r=>r.push({...r[0],id:12,submitted_at:'2026-10-24T11:01:00Z'})],
  ['comment does not clear',r=>r.push({...r[0],id:12,user:{id:9,type:'User'},state:'CHANGES_REQUESTED'},{...r[0],id:13,user:{id:9,type:'User'},state:'COMMENTED',submitted_at:'2026-10-24T11:01:00Z'})]
 ]){const r=copy(original);mutate(r);w.routes[w.reviewsKey]=r;await w.save();await assert.rejects(verifyLearningMerge(w.expected,opts(w)),undefined,label);}
 w.routes[w.reviewsKey]=[...original,{...original[0],id:12,user:{id:9,type:'User'},state:'CHANGES_REQUESTED'},{...original[0],id:13,user:{id:9,type:'User'},state:'APPROVED',submitted_at:'2026-10-24T11:01:00Z'}];await w.save();await verifyLearningMerge(w.expected,opts(w));
});
test('complete trees, actual blob hashes, topology and stable observations are mandatory',async t=>{
 const w=await approvalWorld(t),saved=copy(w.routes),mergeKey=w.prefix+'/git/commits/'+w.merge,treeKey=w.prefix+'/git/trees/'+w.routes[mergeKey].tree.sha+'?recursive=1';
 for(const [label,mutate] of [
 ['truncated',r=>{r[treeKey].truncated=true;}],['omitted leaf',r=>{r[treeKey].tree.pop();}],['squash',r=>{r[mergeKey].parents.pop();}],['wrong base',r=>{r[w.prefix+'/pulls/1'].base.sha=w.head;}],['wrong repo',r=>{r[w.prefix+'/pulls/1'].base.repo.id=99;}],['unmerged',r=>{r[w.prefix+'/pulls/1'].merged=false;}],
 ['changing facts',r=>{const key=w.prefix+'/pulls/1';r[key]={responses:[r[key],{...r[key],merged:false}]};}],
 ['blob corruption',r=>{const e=r[treeKey].tree.find(x=>x.path==='acme.md');r[w.prefix+'/git/blobs/'+e.sha].content=Buffer.from('Acme fake!\n').toString('base64');}]
 ]){Object.keys(w.routes).forEach(k=>delete w.routes[k]);Object.assign(w.routes,copy(saved));mutate(w.routes);await w.save();await assert.rejects(verifyLearningMerge(w.expected,opts(w)),undefined,label);}
});
test('rollback inverse deletion has independent action marker and expected bytes',async t=>{
 const w=await approvalWorld(t,{action:'rollback'});const r=await verifyLearningMerge(w.expected,opts(w));assert.equal(r.action,'rollback');
 const fake=copy(w.expected);fake.action='promote';await assert.rejects(verifyLearningMerge(fake,opts(w)),/deletion/);
 const changed=copy(w.expected);changed.changes[0].before.bytes='invented';await assert.rejects(verifyLearningMerge(changed,opts(w)),/expected_blob/);
 await assert.rejects(verifyLearningMerge(w.expected,{env:w.env,deadline:Date.now()-1}),/deadline/);
});
test('actual extra Git blobs, modes and candidate-only policy cannot gain authority',async t=>{
 for(const options of [{extra:true},{executable:true},{config:{},headConfig:{learning:{approval:{schemaVersion:1,provider:'github',ownerApproverIds:[7]}}}},{headConfig:{learning:{approval:{schemaVersion:1,provider:'github',ownerApproverIds:[9]}}}}]){
  const w=await approvalWorld(t,options);await assert.rejects(verifyLearningMerge(w.expected,opts(w)),/tree_delta|nonregular|policy_mismatch/);
 }
});
test('shared bounded pagination requires all pages; fresh policy changes and missing reads refuse',async t=>{
 const w=await approvalWorld(t),review=w.routes[w.reviewsKey][0];
 w.routes[w.reviewsKey]=[review,...Array.from({length:99},(_,n)=>({...review,id:100+n,state:'COMMENTED'}))];await w.save();await assert.rejects(verifyLearningMerge(w.expected,opts(w)),/could not be read/);
 w.routes[w.reviewsKey.replace('&page=1','&page=2')]=[];await w.save();await verifyLearningMerge(w.expected,opts(w));
 w.routes[w.prefix+'/git/ref/heads/main']={responses:[{ref:'refs/heads/main',object:{type:'commit',sha:w.merge}},{ref:'refs/heads/main',object:{type:'commit',sha:w.base}}]};await w.save();await assert.rejects(inspectLearningApprovalPolicy({repo:w.expected.repo},opts(w)),/source_changed/);
 delete w.routes[w.prefix];await w.save();await assert.rejects(inspectLearningApprovalPolicy({repo:w.expected.repo},opts(w)),/could not be read/);
});
