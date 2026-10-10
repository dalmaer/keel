import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { makeTimeProposal,formatTimeProposal,parseTimeProposal,mergeHealthPage,writeHealthReport,withTimeProposal,readTimeProposals,selectableTimeProposal } from '../practices/night/files/scripts/keel/time-proposals.mjs';
const inputs={measure:'gate_time',identity:{kind:'timing',scope:'.',runner:'node',configHash:'acme-config',flagsHash:'acme-flags',machineClass:'acme-machine',commandHash:'acme-command',target:'gate'},candidate:{title:'Acme gate cleanup',rubric:{version:1,problem:'Acme gate exceeds its bound',reproduction:'npm test',acceptance:'gate inside frozen bound',change:'remove duplicate work',prerequisites:[],ownerBlockers:[]},remeasureCommand:'keel time --json'},baseline:{windowStart:'2026-09-01T00:00:00Z',windowEnd:'2026-09-29T00:00:00Z',value:1000,unit:'ms',runIds:['acme-run'],revisionShas:['a'.repeat(40)]},threshold:{contractVersion:1,rule:'gate_time',parameters:{maxMs:1250}},coverage:{retained:12,eligible:12,omitted:0,dates:['2026-09-01'],sampled:true,gaps:[]},at:'2026-10-01T00:00:00Z'};
const proposal=()=>makeTimeProposal(inputs);
const page=p=>`# Acme health\n\n## Proposal\n\n**\`${p.measure}\`**\n${formatTimeProposal(p)}\n\n## Other measurements\n\nAcme findings.\n`;
async function root(t){const r=await mkdtemp(join(tmpdir(),'acme-proposals-'));t.after(()=>rm(r,{recursive:true,force:true}));return r;}
test('time proposal subject excludes fix prose while instance freezes candidate baseline and thresholds',()=>{
 const a=proposal(),b=makeTimeProposal({...inputs,candidate:{...inputs.candidate,title:'Different Acme prose'}});
 assert.equal(a.subjectKey,b.subjectKey);assert.notEqual(a.instanceId,b.instanceId);
 assert.equal(parseTimeProposal(page(a)).proposal.instanceId,a.instanceId);
 assert.match(parseTimeProposal(page(a).replace('"value": 1000','"value": 1')).problems.join(' '),/frozen baseline mismatch/);
 assert.equal(parseTimeProposal(page(a)+formatTimeProposal(a)).proposal,null);
 const declined={...a,lifecycle:{...a.lifecycle,state:'declined',decidedAt:inputs.at,reason:'Acme declined'}};
 assert.equal(selectableTimeProposal({candidate:b,history:[declined],at:'2026-10-28T23:59:59Z'}).allowed,false);
 assert.equal(selectableTimeProposal({candidate:b,history:[declined],at:'2026-10-29T00:00:00Z'}).allowed,true);
 const other=makeTimeProposal({...inputs,identity:{...inputs.identity,target:'other-gate'}});assert.equal(selectableTimeProposal({candidate:other,history:[declined],at:inputs.at}).allowed,true);
});
test('health regeneration preserves every human byte accepting metadata and frozen accepted baseline',()=>{
 const p=proposal(),previous='Acme human prefix\r\n'+page({...p,lifecycle:{...p.lifecycle,state:'accepted',decidedAt:inputs.at,issue:{repo:'acme/anvils',number:7,url:'https://github.com/acme/anvils/issues/7'}}})+'Human suffix without newline';
 const changed=makeTimeProposal({...inputs,candidate:{...inputs.candidate,title:'new wording'},baseline:{...inputs.baseline,value:2000}});
 const merged=mergeHealthPage({previous,generated:page(changed)});assert.deepEqual(merged.problems,[]);assert.ok(merged.text.includes(previous));assert.equal(parseTimeProposal(merged.text).proposal.instanceId,p.instanceId);assert.equal(parseTimeProposal(merged.text).proposal.baseline.value,1000);
 assert.equal(mergeHealthPage({previous:merged.text,generated:page(changed)}).text,merged.text);
 const legacy='Acme unmarked owner text';assert.ok(mergeHealthPage({previous:legacy,generated:page(p)}).text.includes(legacy));
});
test('time proposal shared lock serializes report generation with acceptance and preserves dated history',async t=>{
 const r=await root(t),p=proposal(),path='docs/health/2026-10-01.md';await writeHealthReport({root:r,path,generated:page(p)});
 let entered,release;const arrived=new Promise(x=>entered=x),hold=new Promise(x=>release=x);
 const action=withTimeProposal({root:r,path,expectedInstance:p.instanceId},async({proposal,saveLifecycle})=>{entered();await hold;await saveLifecycle({...proposal.lifecycle,state:'accepting',decidedAt:inputs.at});});
 await arrived;const report=writeHealthReport({root:r,path,generated:page(p)+'New measured data\n'});release();await Promise.all([action,report]);
 const source=await readFile(join(r,path),'utf8');assert.equal(parseTimeProposal(source).proposal.lifecycle.state,'accepting');assert.match(source,/New measured data/);
 const later=makeTimeProposal({...inputs,at:'2026-10-02T00:00:00Z',identity:{...inputs.identity,target:'other'}});await writeHealthReport({root:r,path:'docs/health/2026-10-02.md',generated:page(later)});
 const history=await readTimeProposals({root:r});assert.equal(history.proposals.length,2);assert.deepEqual(history.gaps,[]);assert.equal(history.proposals[0].instanceId,p.instanceId);
});
test('time proposal actions refuse stale instances tampered baselines and symlink health paths',async t=>{
 const r=await root(t),p=proposal(),path='docs/health/2026-10-01.md';await writeHealthReport({root:r,path,generated:page(p)});
 await assert.rejects(withTimeProposal({root:r,path,expectedInstance:'b'.repeat(64)},()=>assert.fail()),/stale/);
 await assert.rejects(withTimeProposal({root:r,path},()=>assert.fail()),/instance/);
 await mkdir(join(r,'elsewhere'));await symlink(join(r,'elsewhere'),join(r,'linked'));
 await assert.rejects(writeHealthReport({root:r,path:'linked/2026-10-01.md',generated:page(p)}),/unsafe/);
 const before=await readFile(join(r,path),'utf8');await assert.rejects(writeHealthReport({root:r,path,generated:page(p)+formatTimeProposal(p)}),/one bounded/);assert.equal(await readFile(join(r,path),'utf8'),before);
});

test('health current report refresh is bounded replaces stale values and refuses managed human drift',()=>{
 const p=proposal();let current=mergeHealthPage({generated:page(p)+'Current value: 1000ms\n'}).text;
 current='Human prefix\r\n'+current+'\nHuman suffix';const originalLength=current.length;
 for(let n=0;n<30;n++){const merged=mergeHealthPage({previous:current,generated:page(p)+`Current value: ${2000+n}ms\n`});assert.deepEqual(merged.problems,[]);current=merged.text;}
 assert.ok(current.length<=originalLength+10);assert.equal((current.match(/keel:health-report:begin/g)??[]).length,1);assert.equal((current.match(/Current value:/g)??[]).length,1);assert.doesNotMatch(current,/Current value: 1000ms/);assert.match(current,/Current value: 2029ms/);assert.ok(current.startsWith('Human prefix\r\n'));assert.ok(current.endsWith('Human suffix'));
 const edited=current.replace('Current value: 2029ms','Human observation inside managed report');
 const drift=mergeHealthPage({previous:edited,generated:page(p)});assert.match(drift.problems.join(' '),/drift/);assert.equal(drift.text,edited);
});

test('time proposal oversized complete baseline is unavailable rather than truncated or report-fatal',()=>{
 const observations=[{id:'acme',date:inputs.at,commit:'a'.repeat(40),suite:{observedInventory:Array(5000).fill({file:'tests/acme.test.mjs',hierarchy:['Acme case'],occurrence:1,outcome:'pass'})}}];
 assert.equal(makeTimeProposal({...inputs,baseline:{...inputs.baseline,observations}}),null);
 const small=[{...observations[0],suite:{observedInventory:observations[0].suite.observedInventory.slice(0,2)}}];
 const p=makeTimeProposal({...inputs,baseline:{...inputs.baseline,observations:small}});assert.deepEqual(parseTimeProposal(formatTimeProposal(p)).proposal.baseline.observations,small);
});

test('health refresh migrates verified embedded non-time proposals and does not freeze empty offers',()=>{
 const body='# Acme health\n\nOld value.\n\n## Proposal\n\n**`escapes`** — Acme original.\n';
 const hash=createHash('sha256').update(body).digest('hex');
 const suffix='\n\n**Decided 2026-10-08: accepted** — Acme decision.\nHuman suffix.\n';
 const previous=`Human prefix.\n<!-- keel:health-report:begin ${hash} -->\n${body}\n<!-- keel:health-report:end -->${suffix}`;
 const generated='# Acme health\n\nFresh value.\n\n## Proposal\n\n**`escapes`** — Different candidate.\n';
 const migrated=mergeHealthPage({previous,generated});assert.deepEqual(migrated.problems,[]);
 assert.ok(migrated.text.startsWith('Human prefix.\n'));assert.ok(migrated.text.endsWith(suffix));
 assert.equal((migrated.text.match(/^## Proposal$/gm)??[]).length,1);
 assert.match(migrated.text,/Acme original/);assert.doesNotMatch(migrated.text,/Different candidate|Old value/);
 assert.ok(migrated.text.indexOf('## Proposal')>migrated.text.indexOf('<!-- keel:health-report:end -->'));
 assert.equal(mergeHealthPage({previous:migrated.text,generated}).text,migrated.text);
 const edited=previous.replace('Acme original.','Acme owner edit.');
 assert.equal(mergeHealthPage({previous:edited,generated}).text,edited);
 assert.match(mergeHealthPage({previous:edited,generated}).problems.join(' '),/drift/);
 const empty=mergeHealthPage({generated:'# Acme health\n\n## Proposal\n\nNone: every measure is within its bound.\n'});
 const offered=mergeHealthPage({previous:empty.text,generated});assert.deepEqual(offered.problems,[]);
 assert.equal((offered.text.match(/^## Proposal$/gm)??[]).length,1);assert.match(offered.text,/Different candidate/);
});

test('configured health alias and canonical path share proposal lock while other paths remain refused',async t=>{
 const r=await root(t),p=proposal(),alias='.keel/health/2026-10-01.md',canonical='acme-pages/2026-10-01.md';
 await mkdir(join(r,'.keel'));await mkdir(join(r,'acme-pages'));
 await writeFile(join(r,'.keel/keel.json'),JSON.stringify({health:'.keel/health'}));
 await symlink('../acme-pages',join(r,'.keel/health'));
 await writeHealthReport({root:r,path:alias,generated:page(p)});
 let entered,release;const arrived=new Promise(done=>entered=done),hold=new Promise(done=>release=done);
 const decision=withTimeProposal({root:r,path:alias,expectedInstance:p.instanceId},async({proposal,saveLifecycle})=>{entered();await hold;await saveLifecycle({...proposal.lifecycle,state:'accepting',decidedAt:inputs.at});});
 await arrived;
 const update=writeHealthReport({root:r,path:canonical,generated:page(p)+'Fresh Acme values.\n'});
 release();await Promise.all([decision,update]);
 const text=await readFile(join(r,canonical),'utf8');assert.equal(parseTimeProposal(text).proposal.lifecycle.state,'accepting');assert.match(text,/Fresh Acme values/);
 const history=await readTimeProposals({root:r,healthDir:'.keel/health'});assert.deepEqual(history.gaps,[]);assert.equal(history.proposals.length,1);
 await mkdir(join(r,'unrelated'));await symlink('acme-pages',join(r,'other-alias'));
 for(const path of ['unrelated/2026-10-01.md','other-alias/2026-10-01.md'])await assert.rejects(writeHealthReport({root:r,path,generated:page(p)}),/unsafe health path/);
 await symlink(join(r,canonical),join(r,'acme-pages/2026-10-02.md'));
 await assert.rejects(writeHealthReport({root:r,path:'.keel/health/2026-10-02.md',generated:page(p)}),/unsafe health path/);
});
