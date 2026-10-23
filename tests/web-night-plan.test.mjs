import test from 'node:test';
import assert from 'node:assert/strict';
import {planChanges} from '../lib/web/night-plan-model.mjs';
import {createNightPlan} from '../lib/web/night-plan.mjs';
import {createOperations} from '../lib/web/operations.mjs';
import {nightPlanHarness,plan,previewPlan,token} from './helpers/web-night-plan.mjs';
const apply=(h,p,extra={})=>h.nightPlan.apply(h.access,token,h.project,p.id,{reauthorize:async()=>h.access,publicAcknowledgement:p.digest,...extra});
const build=()=>({id:'build-acme',title:'Improve Acme tests',kind:'build',source:'owner',number:{measure:'slow_tests',bound:20,better:'lower'},lane:'climb:test-time',budget:{minutes:10},status:'planned',result:null});
const config={climb:{jobs:['test-time'],budget:{minutes:45}}};
test('canonical plan edits preserve ordered owner lines, allocations and progress',()=>{
  const before=plan();before.items.push(build());
  const after=structuredClone(before);after.leftOpen.push('Acme follow-up');after.items[0].title='Measure Acme again';
  const valid=planChanges(before,after,config);assert.equal(valid.policy.newBuildAllowance,0);assert.equal(valid.policy.climb.minutes,45);
  for(const change of [p=>p.willNotTouch=[],p=>p.items.pop(),p=>p.items[1].budget.minutes=20,p=>p.items.reverse(),p=>p.readyBy='2026-10-21T23:00Z',p=>p.items[1].status='done',p=>p.items[0].result={note:'Invented pass'},p=>p.items[0].lane='robot:pending',p=>p.items.push({...build(),id:'new-build'})]) {
    const candidate=structuredClone(after);change(candidate);assert.throws(()=>planChanges(before,candidate,config));
  }
  for(const status of ['running','done','failed','skipped','left-alone']) {
    const prior=plan();prior.items[0].status=status;prior.items[0].result={note:'Actual Acme observation'};
    const next=structuredClone(prior);next.items[0].title='Changed meaning';assert.throws(()=>planChanges(prior,next,{}),e=>e.code==='protected_plan_item_changed');
  }
});
test('unchanged builds use canonical runner defaults and reject unavailable policy or incomplete build allowance',()=>{
  const before=plan();before.items.push(build());const after=structuredClone(before);after.leftOpen.push('Acme question');
  assert.equal(planChanges(before,after,{climb:{jobs:['test-time']}}).policy.climb.minutes,45);
  for(const cfg of [{},{climb:{jobs:['invented'],budget:{minutes:45}}},{climb:{jobs:['test-time'],budget:{minutes:5}}},{climb:{jobs:['test-time'],agent:'not-configured'}}])assert.throws(()=>planChanges(before,after,cfg),e=>e.code==='night_policy_unavailable');
  const outside=[1,2,3,4,5];assert.throws(()=>planChanges(before,after,config,{openRobotPrs:outside}),e=>e.code==='invalid_night_plan');
});
test('rollover only targets upcoming canonical UTC night with no implicit build carry or fabricated work',()=>{
  const before=plan();before.items.push({...build(),status:'done',result:{note:'Old actual result'}});
  const next=plan();next.date='2026-10-22';const options={now:Date.parse('2026-10-21T19:00:00Z')};
  assert.equal(planChanges(before,next,{},options).rollover,true);
  for(const edit of [p=>p.date='2026-10-23',p=>p.date='2026-10-20',p=>p.items.push(build()),p=>p.items[0].budget={minutes:1},p=>p.items[0].status='done',p=>p.items[0].result={note:'Done'},p=>p.items[0].source='default']) {
    const candidate=structuredClone(next);edit(candidate);assert.throws(()=>planChanges(before,candidate,{},options));
  }
});
test('exact canonical publication appends one commit preserving other files and history; other consumers reject its kind',async()=>{
  const h=nightPlanHarness(),p=await previewPlan(h),parent=h.branch.head;
  assert.equal(p.kind,'night-plan');assert.equal(p.files.length,1);assert.equal(p.before,h.branch.files['.keel/night/plan.json']);
  assert.match(p.commitMessage,/GitHub user 1/);assert.equal(p.canSubmit,true);
  const done=await apply(h,p);assert.equal(done.state,'committed');assert.equal(done.kind,'night-plan');assert.equal(done.receipt.execution,'not-started');
  assert.equal(h.planState.writes.length,1);assert.equal(h.branch.files['keep.txt'],'Acme unrelated branch file');assert.equal(h.branch.files['.keel/night/plan.json'],p.content);
  assert.equal(h.planState.commits[0].parents.nodes[0].oid,parent);assert.equal(h.planState.commits[0].before['.keel/night/plan.json'],p.before);
  const again=await apply(h,p);assert.equal(again.state,'committed');assert.equal(h.planState.writes.length,1);
  const legacy=createOperations(h.config,{fetcher:h.fetcher,now:()=>h.state.now});
  await assert.rejects(legacy.recover(h.access,token,h.project,p.operationId),e=>e.code==='operation_not_found');
  await assert.rejects(legacy.apply(h.access,token,h.project,p.id),e=>e.code==='invalid_preview');
});
test('public preview needs exact acknowledgement and disabled publication cannot write',async()=>{
  const h=nightPlanHarness(),p=await previewPlan(h);
  await assert.rejects(apply(h,p,{publicAcknowledgement:undefined}),e=>e.code==='public_acknowledgement_required');
  const disabled=createNightPlan({...h.config,nightOperations:{...h.config.nightOperations,planWrites:false}},{fetcher:h.fetcher,now:()=>h.state.now});
  await assert.rejects(disabled.apply(h.access,token,h.project,p.id),e=>e.code==='night_plan_disabled');assert.equal(h.planState.writes.length,0);
});
test('upcoming-date seed is explicitly empty and rollover retains complete previous plan in parent history',async()=>{
  const h=nightPlanHarness(),before=h.branch.files['.keel/night/plan.json'];
  const current=await h.daily.inspect(h.access,token,h.project,'2026-10-22');assert.equal(current.plan,null);assert.equal(current.capabilities.nightPlan.review,true);assert.deepEqual(current.capabilities.nightPlan.seed.items,[]);
  const p=await previewPlan(h,'2026-10-22');assert.equal(p.rollover,true);assert.match(p.consequence,/parent commit history/);
  assert.equal((await apply(h,p)).state,'committed');assert.equal(h.planState.commits[0].before['.keel/night/plan.json'],before);
});
test('missing canonical branch is explicit setup and incomplete PR inventory refuses preview',async()=>{
  const missing=nightPlanHarness();delete missing.source.branches['keel-night-plan'];const model=await missing.daily.inspect(missing.access,token,missing.project,'2026-10-21');assert.equal(model.capabilities.nightPlan.review,false);
  await assert.rejects(previewPlan(missing),e=>e.code==='night_plan_setup_required');
  const incomplete=nightPlanHarness();incomplete.planState.incomplete=true;await assert.rejects(previewPlan(incomplete),e=>e.code==='night_policy_unavailable');
  assert.equal(incomplete.planState.writes.length,0);
});
test('changed source, progress, open PR policy, private visibility and revoked permissions refuse before dispatch',async()=>{
  for(const change of [h=>h.source.head='f'.repeat(40),h=>{h.branch.files['.keel/night/plan.json']=JSON.stringify({...plan(),leftOpen:['Concurrent owner']});h.branch.head='f'.repeat(40);},h=>h.source.private=true,h=>h.source.push=false,h=>h.planState.ref='REF_replaced',h=>h.planState.open=[{number:12,headRefName:'keel/robot-12',isCrossRepository:false}]]) {
    const h=nightPlanHarness(),p=await previewPlan(h);change(h);const result=await apply(h,p);assert.equal(result.state,'refused');assert.equal(h.planState.writes.length,0);
  }
  const h=nightPlanHarness(),p=await previewPlan(h);assert.equal((await apply(h,p,{reauthorize:async()=>({...h.access,contentsPermission:'read'})})).state,'refused');assert.equal(h.planState.writes.length,0);
});
test('last-stage identity changes and concurrent ticks conditionally refuse without alternate writes',async()=>{
  for(const stage of ['onRecheck','onDispatch']) {
    const h=nightPlanHarness(),p=await previewPlan(h);h.planState[stage]=()=>{h.branch.head='f'.repeat(40);};
    const result=await apply(h,p);assert.equal(result.state,'refused');assert.equal(h.planState.writes.length,stage==='onDispatch'?1:0);
  }
  const h=nightPlanHarness(),p=await previewPlan(h);h.planState.onDispatch=()=>{h.planState.ref='REF_replacement';};
  assert.equal((await apply(h,p)).state,'refused');assert.equal(h.planState.writes.length,1);
});
test('lost response recovers original immutable commit without redispatch and missing-ref proof stays uncertain',async()=>{
  const h=nightPlanHarness(),p=await previewPlan(h);h.planState.mode='lost';assert.equal((await apply(h,p)).state,'uncertain');
  const recovered=await h.nightPlan.recover(h.access,token,h.project,p.operationId);assert.equal(recovered.state,'committed');assert.equal(h.planState.writes.length,1);
  await apply(h,p);assert.equal(h.planState.writes.length,1);
  const absent=nightPlanHarness(),q=await previewPlan(absent);absent.planState.mode='lost';await apply(absent,q);absent.planState.ref='REF_recycled_name';
  assert.equal((await absent.nightPlan.recover(absent.access,token,absent.project,q.operationId)).state,'uncertain');assert.equal(absent.planState.writes.length,1);
});
test('unknown dispatch blocks a second project operation; concurrent same-preview applies dispatch at most once',async()=>{
  const h=nightPlanHarness(),p=await previewPlan(h),q=await previewPlan(h);h.planState.mode='unknown';
  const results=await Promise.all([apply(h,p),apply(h,p)]);assert.ok(results.some(r=>r.state==='uncertain'));assert.equal(h.planState.writes.length,1);
  await assert.rejects(apply(h,q),e=>e.code==='project_busy');assert.equal((await h.nightPlan.recover(h.access,token,h.project,p.operationId)).state,'uncertain');assert.equal(h.planState.writes.length,1);
});

test('invalid canonical JSON and coercible identifier shapes stay unavailable rather than crashing or publishing',async()=>{
  for(const raw of ['null','not JSON']) {
    const h=nightPlanHarness();h.branch.files['.keel/night/plan.json']=raw;
    const model=await h.daily.inspect(h.access,token,h.project,'2026-10-21');
    assert.equal(model.capabilities.nightPlan.review,false);assert.match(model.capabilities.nightPlan.reason,/invalid/);
  }
  const before=plan(),next=plan();next.items[0].number={measure:['slow_tests'],bound:1,better:'lower'};
  assert.throws(()=>planChanges(before,next,{}),e=>e.code==='invalid_night_plan');
});
test('near-limit canonical plan preview and durable intent fit SQL004 without lowering the canonical 256KiB bound',async()=>{
  const h=nightPlanHarness(),large=plan();
  large.willNotTouch=Array.from({length:64},(_,i)=>`${i}:`+'a'.repeat(496));
  large.settledToday=Array.from({length:64},(_,i)=>`${i}:`+'b'.repeat(496));
  large.leftOpen=Array.from({length:63},(_,i)=>`${i}:`+'c'.repeat(496));
  large.items=Array.from({length:64},(_,i)=>({...plan().items[0],id:`measure-${i}`,title:'A'.repeat(300),status:'done',result:{note:'"'.repeat(500)}}));
  for(let size=501;size<=999;size++) {
    const candidate=structuredClone(large);for(const item of candidate.items)item.result.note='"'.repeat(size);
    if(Buffer.byteLength(JSON.stringify(candidate,null,2))>260000)break;
    for(const item of large.items)item.result.note='"'.repeat(size);
  }
  const before=JSON.stringify(large,null,2)+'\n';assert.ok(Buffer.byteLength(before)>250000);
  h.branch.files['.keel/night/plan.json']=before+' '.repeat(262144-Buffer.byteLength(before));
  h.source.files['docs/night/2026-10-21.json']=JSON.stringify(large);
  const current=await h.daily.inspect(h.access,token,h.project,large.date),next=structuredClone(current.plan);next.leftOpen.push('Acme final question');
  const p=await h.nightPlan.preview(h.access,token,h.project,{date:large.date,sourceDigest:current.sourceDigest,plan:next});
  assert.ok(Buffer.byteLength(p.content)>250000);assert.ok(Buffer.byteLength(p.content)<=262144);
  assert.ok(Buffer.byteLength(h.db.previews.get(p.id).value)<=1048576);
  assert.equal((await apply(h,p)).state,'committed');assert.ok(Buffer.byteLength(h.db.operations.get(p.operationId).value)<=1048576);
});
test('receipt names reviewed policy revision without pretending the plan commit atomically locks another ref',async()=>{
  const h=nightPlanHarness(),p=await previewPlan(h),reviewed=h.source.head;
  h.planState.onDispatch=()=>{h.source.head='f'.repeat(40);};
  const done=await apply(h,p);assert.equal(done.state,'committed');
  assert.equal(done.receipt.reviewedDefaultSource.head,reviewed);assert.notEqual(done.receipt.reviewedDefaultSource.head,h.source.head);
  assert.match(done.receipt.policyCoverage,/not part of that atomic condition/);assert.match(done.receipt.policyDigest,/^[a-f0-9]{64}$/);assert.equal(h.planState.writes.length,1);
});
