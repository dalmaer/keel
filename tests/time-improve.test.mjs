import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MEASURES,measure,propose,improve} from '../practices/night/files/scripts/keel/improve.mjs';
import {makeTimeProposal,formatTimeProposal,parseTimeProposal,withTimeProposal} from '../practices/night/files/scripts/keel/time-proposals.mjs';
import {render} from '../lib/practices.mjs';
import {run} from './helpers/run.mjs';
import {readRuns} from '../practices/night/files/scripts/keel/test-ledger.mjs';
import {timeEvidence} from './fixtures/improve/time-evidence.mjs';
const now=Date.parse('2026-10-10T12:00:00Z');
const measures=MEASURES.filter(m=>m.time);
async function project(t) {
 const root=await mkdtemp(join(tmpdir(),'acme-time-improve-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'.keel/test-runs'),{recursive:true});await mkdir(join(root,'docs/health'),{recursive:true});
 await writeFile(join(root,'.keel/keel.json'),JSON.stringify({name:'Acme',repo:'acme/anvils',health:'docs/health'}));
 return root;
}
test('production time readers preserve recovered gaps and never convert missing history to zero',async t=>{
 const root=await project(t),e=timeEvidence(now);
 for(const r of e.runs)await writeFile(join(root,'.keel/test-runs',r.id+'.json'),JSON.stringify(r));
 await mkdir(join(root,'.keel/test-runs/recovery'));
 await writeFile(join(root,'.keel/test-runs/recovery/status.json'),JSON.stringify({version:1,at:new Date(now).toISOString(),repo:'acme/anvils',branch:'main',selected:[],imported:0,bytes:0,gaps:[{code:'bounded',detail:'Acme bounded recovery gap'}],complete:false}));
 const r=await measure({root,config:{},env:{CI:'true'},now,measures});
 assert.equal(r.find(r=>r.id==='time_creep').state,'outside');assert.match(r.find(r=>r.id==='time_creep').detail,/Acme bounded recovery gap/);
 assert.equal(r.find(r=>r.id==='worked_around').state,'n/a');assert.equal(r.find(r=>r.id==='wall_clock_tests').state,'n/a');
});
test('declined worst target does not suppress another time candidate and frozen values never ratchet',async t=>{
 const root=await project(t),e=timeEvidence(now);
 e.runs.filter(r=>r.kind!=='gate').forEach(r=>r.tests.push({...r.tests[0],name:'Acme alternative',ms:r.tests[0].ms*2}));
 const results=await measure({root,config:{},env:{CI:'true'},now,measures:measures.filter(m=>m.id==='time_creep'),timeEvidence:e});
 assert.equal(results[0].timeCandidates.length,2);
 const first=propose(results,{}, {at:now});const declined={...first.metadata,lifecycle:{...first.metadata.lifecycle,state:'declined',decidedAt:new Date(now-86400000).toISOString(),reason:'Acme owner chose another cut'}};
 const next=propose(results,{}, {history:[declined],at:now});assert.ok(next);assert.notEqual(next.metadata.subjectKey,first.metadata.subjectKey);
 const both=propose(results,{}, {history:[declined,{...next.metadata,lifecycle:{...next.metadata.lifecycle,state:'accepted'}}],at:now});assert.equal(both,null);
 assert.ok(propose(results,{}, {history:[declined],at:now+29*86400000}));
});
test('time proposal report regenerates through shared lock, retains accepted baseline and persists remeasurement',async t=>{
 const root=await project(t);const selected=measures.filter(m=>m.id==='time_creep');
 // Real root reader, with dates relative to the actual report (not the fixture's fixed clock).
 for(const r of timeEvidence(Date.now()).runs)await writeFile(join(root,'.keel/test-runs',r.id+'.json'),JSON.stringify(r));
 let r=await improve({root,report:true,date:'2026-10-10'},{env:{CI:'true'},measures:selected});assert.equal(r.data.proposal.metadata.measure,'time_creep');
 const path=r.data.report,initial=parseTimeProposal(await readFile(join(root,path),'utf8')).proposal;assert.ok(initial);
 await withTimeProposal({root,path,expectedInstance:initial.instanceId},({proposal,saveLifecycle})=>saveLifecycle({...proposal.lifecycle,state:'accepted',decidedAt:new Date().toISOString(),issue:{repo:'acme/anvils',number:7,url:'https://github.com/acme/anvils/issues/7'}}));
 await writeFile(join(root,path),(await readFile(join(root,path),'utf8'))+'\nAcme owner notes stay.\n');
 let calls=0;const remeasure=async ({proposal})=>{calls++;assert.equal(proposal.instanceId,initial.instanceId);return {state:'unavailable',observedAt:new Date().toISOString(),value:null,coverage:null,delivery:null,reasons:['fresh comparable observations required']};};
 r=await improve({root,report:true,date:'2026-10-10'},{env:{CI:'true'},measures:selected,remeasure});assert.equal(calls,1);assert.equal(r.data.remeasurements[0].state,'unavailable');
 const text=await readFile(join(root,path),'utf8'),after=parseTimeProposal(text).proposal;assert.match(text,/Acme owner notes stay/);assert.deepEqual(after.baseline,initial.baseline);assert.equal(after.lifecycle.state,'accepted');assert.equal(after.lifecycle.remeasurement.state,'unavailable');assert.equal(text.match(/keel:health-report:begin/g).length,1);
});
test('oversized frozen candidate is omitted without truncation while another target remains selectable',async t=>{
 const root=await project(t),r=await measure({root,config:{},env:{CI:'true'},now,measures:measures.filter(m=>m.id==='time_creep'),timeEvidence:timeEvidence(now)});
 const first=r[0].timeCandidates[0],huge=structuredClone(first);huge.baseline.observations=[{acme:'x'.repeat(270000)}];
 const small=structuredClone(first);small.identity.target.name='Acme alternative';r[0].timeCandidates=[huge,small];
 const selected=propose(r,{}, {at:now});assert.equal(selected.metadata.identity.target.name,'Acme alternative');assert.equal(huge.baseline.observations[0].acme.length,270000);assert.match(r[0].facts.coverage.gaps.join(' '),/size bound/);
});

test('budget source ownership transfer preserves installed bytes and rejects human drift',async t=>{
 const root=await project(t),config={name:'Acme',tagline:'Acme climbs',repo:'acme/anvils',practices:['base','agents-md','night','climb']};
 await writeFile(join(root,'.keel/keel.json'),JSON.stringify(config));assert.equal((await render(root)).ok,true);
 const path='scripts/keel/robot-budget.mjs',file=join(root,path),before=await readFile(file,'utf8'),lockPath=join(root,'.keel/lock.json'),lock=JSON.parse(await readFile(lockPath,'utf8'));
 lock.files[path].practice='climb';await writeFile(lockPath,JSON.stringify(lock));
 assert.equal((await render(root)).ok,true);assert.equal(await readFile(file,'utf8'),before);assert.equal(JSON.parse(await readFile(lockPath,'utf8')).files[path].practice,'night');
 await writeFile(file,before+'\n// Acme human addition\n');await assert.rejects(render(root),/refusing to overwrite/);assert.match(await readFile(file,'utf8'),/Acme human addition/);
});
test('shipped CI records the configured outer gate with night and preserves CI-only check exit',async t=>{
 const template=await readFile(new URL('../practices/ci/files/.github/workflows/check.yml',import.meta.url),'utf8');
 const block=template.split('      - name: Run the configured gate\n        run: |\n')[1].split('      # The test ledger')[0].split('\n').map(l=>l.slice(10)).join('\n');
 for(const night of [false,true]){
  const root=await project(t),config={name:'Acme',tagline:'Acme CI',repo:'acme/anvils',practices:['base','agents-md','ci',...(night?['night']:[])],check:'printf Acme > marker; exit 7'};
  await writeFile(join(root,'.keel/keel.json'),JSON.stringify(config));assert.equal((await render(root)).ok,true);
  const result=run('bash',['-e','-c',block.replace('{{check}}',config.check)],{cwd:root});assert.equal(result.status,7,result.stderr);assert.equal(await readFile(join(root,'marker'),'utf8'),'Acme');
  const history=await readRuns(root,undefined,{gates:true});const gates=history.runs.filter(r=>r.kind==='gate');assert.equal(gates.length,night?1:0);
  if(night){assert.equal(gates[0].gateSource,'configured-check');assert.equal(gates[0].provenance.source,'outer-launcher');assert.equal(gates[0].status,7);}
 }
});

test('cross-date remeasurement reports only actually changed historical health paths in JSON and PR input',async t=>{
 const root=await project(t),selected=measures.filter(m=>m.id==='time_creep');
 for(const r of timeEvidence(Date.now()).runs)await writeFile(join(root,'.keel/test-runs',r.id+'.json'),JSON.stringify(r));
 const first=await improve({root,report:true,date:'2026-10-09'},{env:{CI:'true'},measures:selected});
 const path=first.data.report,initial=parseTimeProposal(await readFile(join(root,path),'utf8')).proposal;
 await withTimeProposal({root,path,expectedInstance:initial.instanceId},({proposal,saveLifecycle})=>saveLifecycle({...proposal.lifecycle,state:'accepted',decidedAt:'2026-10-09T12:00:00Z',issue:{repo:'acme/anvils',number:7,url:'https://github.com/acme/anvils/issues/7'}}));
 await writeFile(join(root,path),(await readFile(join(root,path),'utf8'))+'\nAcme owner notes stay.\n');
 await writeFile(join(root,'docs/health/owner.md'),'Acme private working notes\n');
 const before=await readFile(join(root,path),'utf8'),prInput=join(root,'pr.json');
 const reading={state:'unavailable',observedAt:'2026-10-10T12:00:00Z',value:null,coverage:null,delivery:null,reasons:['Acme awaits observations']};
 const opts={env:{CI:'true'},measures:selected,remeasure:async()=>reading};
 const readonly=await improve({root,date:'2026-10-10',prInput},opts);assert.deepEqual(readonly.data.changedHistoricalHealthPaths,[]);assert.equal(await readFile(join(root,path),'utf8'),before);
 const changed=await improve({root,report:true,date:'2026-10-10',prInput},opts);
 assert.deepEqual(changed.data.changedHistoricalHealthPaths,[path]);assert.deepEqual(JSON.parse(await readFile(prInput,'utf8')).changedHistoricalHealthPaths,[path]);assert.notEqual(changed.data.report,path);
 const after=await readFile(join(root,path),'utf8');assert.notEqual(after,before);assert.match(after,/Acme owner notes stay/);assert.deepEqual(parseTimeProposal(after).proposal.baseline,initial.baseline);
 const unchanged=await improve({root,report:true,date:'2026-10-10',prInput},opts);assert.deepEqual(unchanged.data.changedHistoricalHealthPaths,[]);assert.deepEqual(JSON.parse(await readFile(prInput,'utf8')).changedHistoricalHealthPaths,[]);assert.equal(await readFile(join(root,path),'utf8'),after);assert.equal(await readFile(join(root,'docs/health/owner.md'),'utf8'),'Acme private working notes\n');
});
