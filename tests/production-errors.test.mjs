import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { productionConfig, normalizeEvent, collectSource, commandFor, providerTime, execute, providerEnv } from '../practices/night/files/scripts/keel/production-collectors.mjs';
import { collect, status, applyObservation, assessVerification } from '../lib/production.mjs';
import { emptyState, readState, validateState, transaction, atomicJson, recoverState, digest, retainVerification } from '../practices/night/files/scripts/keel/production-store.mjs';
const start='2026-10-17T10:00:00.000Z',end='2026-10-17T11:00:00.000Z',now=new Date(end);
const base={id:'acme',provider:'json',service:'acme',environment:'production',input:'events.json',windowMinutes:60,maxEvents:10,maxBytes:10000,timeoutMs:1000,threshold:2};
const config=s=>({production:{version:1,enabled:true,sources:[{...base,...s}]}});
const source=s=>productionConfig(config(s)).sources[0];
async function fixture(t,events=[],extra={}) {
 const root=await mkdtemp(join(tmpdir(),'acme-production-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'.keel')); await writeFile(join(root,'.keel/keel.json'),JSON.stringify(config()));
 await writeFile(join(root,'events.json'),JSON.stringify({version:1,source:'acme',service:'acme',environment:'production',start,end,coverage:'complete',events,...extra}));return root;
}
const event=(id='one',message='TypeError: failure at src/acme.mjs:42:3')=>({id,timestamp:'2026-10-17T10:30:00.123456789Z',message,revision:'acme-r1'});
test('strict provider timestamps preserve micro/nanoseconds and reject rollover',()=>{
 assert.equal(providerTime('2026-10-17T10:30:00.123456789Z'),'2026-10-17T10:30:00.123Z');
 assert.equal(providerTime('2026-02-30T10:00:00Z'),null);assert.equal(providerTime('2026-10-17T25:00:00Z'),null);
 assert.equal(providerTime(Date.parse(start)),start);
});
test('redaction retains only hashes and allowlisted types, separates code and HTTP shapes',()=>{
 const s=source(); const a=normalizeEvent(event('private-id','TypeError alice@example.test token=fake-secret at src/acme.mjs:42:3'),s);
 assert.doesNotMatch(JSON.stringify(a),/alice|fake-secret|private-id|acme-r1|src\/acme/);
 assert.equal(a.signature,normalizeEvent(event('two','TypeError bob@example.test token=fake-other at src/acme.mjs:42:3'),s).signature);
 assert.notEqual(a.signature,normalizeEvent(event('two','TypeError at src/acme.mjs:43:3'),s).signature);
 const http={timestamp:start,message:'',responseStatusCode:500,source:'serverless'};
 assert.notEqual(normalizeEvent({...http,requestPath:'/acme/orders?token=fake'},s).signature,normalizeEvent({...http,requestPath:'/acme/billing'},s).signature);
 assert.equal(normalizeEvent({...http,requestPath:'/acme/orders?token=fake'},s).signature,normalizeEvent({...http,requestPath:'/acme/orders?token=other'},s).signature);
});
test('bounded provider commands use explicit scope, retries back off only transient reads',async t=>{
 const root=await fixture(t), s=source({provider:'vercel',project:'prj_acme',scope:'team_acme'}),w={start,end};
 const cmd=commandFor(s,w);assert.equal(cmd.command,'vercel');assert.ok(cmd.args.includes('--environment'));assert.ok(!cmd.args.includes('--follow'));
 const calls=[],sleep=[];
 const got=await collectSource(root,s,w,{runner:async(...args)=>{calls.push(args);return calls.length<3?{reason:'transient'}:{stdout:JSON.stringify({...event(),timestamp:Date.parse(start)})};},sleep:async ms=>sleep.push(ms)});
 assert.equal(calls.length,3);assert.deepEqual(sleep,[100,200]);assert.ok(got.gaps.includes('provider-completeness-unproven'));assert.ok(got.gaps.includes('nightly-cadence-gap'));
 let auth=0;await collectSource(root,s,w,{runner:async()=>{auth++;return {reason:'access-or-config'};}});assert.equal(auth,1);
 const g=commandFor(source({provider:'gcp',project:'acme-prod',region:'us-west1'}),w);assert.equal(g.command,'gcloud');assert.match(g.args[2],/cloud_run_revision/);assert.ok(g.args.includes('acme-prod'));
});
test('transport bounds timeout and byte output without leaking stderr or auth failures',async()=>{
 const options={root:process.cwd(),timeoutMs:100,maxBytes:1024};
 const timed=await execute(process.execPath,['-e','setTimeout(()=>{},10000)'],options);assert.equal(timed.reason,'timeout');assert.equal(timed.stdout,'');
 const bytes=await execute(process.execPath,['-e','process.stdout.write("x".repeat(100000))'],{...options,timeoutMs:5000});assert.equal(bytes.reason,'byte-limit');
 const auth=await execute(process.execPath,['-e','console.error("invalid_grant fake-private");process.exit(1)'],{...options,timeoutMs:5000});assert.equal(auth.reason,'access-or-config');assert.doesNotMatch(JSON.stringify(auth),/fake-private/);
});
test('preview writes nothing; replay and overlap preserve counts and recurrence',async t=>{
 const root=await fixture(t,[event('one'),event('two')]);
 assert.equal((await collect({root,config:config(),start,end,now})).state,'preview');assert.deepEqual(await readdir(join(root,'.keel')),['keel.json']);
 await collect({root,config:config(),start,end,now,yes:true});await collect({root,config:config(),start,end,now,yes:true});
 const state=await readState(root),i=Object.values(state.incidents)[0];assert.equal(i.count,2);assert.equal(i.status,'recurring');
 const s=source(),o=await collectSource(root,s,{start,end});applyObservation(state,s,{...o,start:'2026-10-17T10:10:00.000Z',end:'2026-10-17T11:10:00.000Z'});assert.equal(i.count,2);
 assert.equal(state.sources.acme.windows.length,2);assert.equal(validateState(state),state);
 assert.doesNotMatch(await readFile(join(root,'.keel/production/state.json'),'utf8'),/src\/acme|acme-r1/);
});
test('partial, malformed, pagination and identity gaps never become complete coverage',async t=>{
 const root=await fixture(t,[event(),{message:'missing timestamp'}],{sampled:true});
 const o=await collectSource(root,source(),{start,end});assert.equal(o.coverage,'partial');assert.ok(o.gaps.includes('timestamp-or-shape'));
 const limit=await collectSource(root,source({maxEvents:1}),{start,end});assert.ok(limit.gaps.includes('event-limit'));
 const missing=normalizeEvent({...event(),id:undefined},source());const state=emptyState();applyObservation(state,source(),{start,end,events:[missing,missing],coverage:'partial',gaps:['identity-unknown'],traffic:null});assert.equal(Object.values(state.incidents)[0].count,1);assert.equal(Object.values(state.incidents)[0].confidence,'lower-bound');
 await writeFile(join(root,'events.json'),'not json');assert.equal((await collectSource(root,source(),{start,end})).coverage,'unavailable');
});
test('strict durable schema rejects unknown/raw fields, invalid dates and incompatible versions',async t=>{
 const root=await fixture(t,[event()]);await collect({root,config:config(),start,end,now,yes:true});const state=await readState(root);
 for(const mutate of [s=>s.raw='private',s=>s.version=2,s=>Object.values(s.incidents)[0].message='private',s=>s.sources.acme.windows[0].requestBody='private',s=>Object.values(s.incidents)[0].firstSeen='not-a-date',s=>s.sources.acme.scope='raw']){const bad=structuredClone(state);mutate(bad);assert.throws(()=>validateState(bad));}
});
test('symlink refusal, serialized writers and interrupted transaction recovery',async t=>{
 const root=await fixture(t);await mkdir(join(root,'elsewhere'));await symlink(join(root,'elsewhere'),join(root,'.keel/production'));
 await assert.rejects(()=>collect({root,config:config(),start,end,now,yes:true}),/symlink/);await rm(join(root,'.keel/production'));
 let entered,release;const started=new Promise(r=>entered=r),wait=new Promise(r=>release=r);
 const first=transaction(root,async()=>{entered();await wait;return {state:'ok'};});await started;await assert.rejects(()=>transaction(root,async()=>({})),/lock/);release();await first;
 const state=await readState(root);const pending={version:1,id:'1792234800000-00000000-0000-4000-8000-000000000001',at:end,state,digest:digest(state)};
 await atomicJson(join(root,'.keel/production/pending.json'),pending);await assert.rejects(()=>readState(root),/interrupted/);await recoverState(root);assert.deepEqual(await readState(root),state);assert.ok((await readdir(join(root,'.keel/production/observations'))).includes(pending.id+'.json'));
});
test('retention discloses evicted windows and keeps unresolved incidents',()=>{
 const state=emptyState(),s=source(),e=normalizeEvent(event(),s);
 for(let n=0;n<66;n++){const a=new Date(Date.parse(start)+n*60000).toISOString(),b=new Date(Date.parse(a)+60000).toISOString();applyObservation(state,s,{start:a,end:b,events:n===0?[e]:[],gaps:[],coverage:'complete',traffic:null});}
 assert.equal(state.droppedWindows,2);assert.equal(Object.values(state.incidents)[0].count,1);assert.equal(state.sources.acme.windows.length,64);
 assert.throws(()=>applyObservation(state,s,{start,end,events:[],gaps:[],coverage:'complete',traffic:null}),/horizon/);
});
test('verification requires source-matched timed deployment/probe and complete ordered window; regression survives replay',()=>{
 const state=emptyState(),s=source({site:'https://acme.example',equivalentProbe:'/acme-probe'}),e=normalizeEvent(event(),s);
 applyObservation(state,s,{start,end,events:[e],coverage:'complete',gaps:[],traffic:null});const incident=Object.values(state.incidents)[0];
 const revision='a'.repeat(40),window={start:'2026-10-17T11:00:00.000Z',end:'2026-10-17T12:00:00.000Z',coverage:'complete',gaps:[],incidents:[]};
 const timedProbe={version:2,scope:s.scopeKey,revision,site:s.site,path:'/acme-probe',startedAt:'2026-10-17T11:20:00.000Z',completedAt:'2026-10-17T11:30:00.000Z',smokeCount:1,origin:'delivery.verify'};timedProbe.id=digest([timedProbe.scope,revision,timedProbe.site,timedProbe.path,timedProbe.startedAt,timedProbe.completedAt]);
 const good={incident,source:s,window,revision,timedProbe,probe:'/acme-probe',now:new Date('2026-10-17T12:01:00Z'),deployment:{site:s.site,serving:revision,ok:true,at:'2026-10-17T10:59:59.000Z',run:'https://github.com/Acme/app/actions/runs/1'},live:{site:s.site,serving:revision,ok:true,at:'2026-10-17T11:30:00.000Z',smoke:[{path:'/acme-probe',matched:true}]}};
 assert.equal(assessVerification(good).state,'verified');
 for(const bad of [{deployment:null},{live:null},{probe:null},{window:{...window,coverage:'partial'}},{window:{...window,traffic:0},probe:null},{deployment:{...good.deployment,site:'https://wrong.example'}},{timedProbe:null},{window:{...window,start:timedProbe.completedAt}},{deployment:{...good.deployment,at:window.start}}]) assert.equal(assessVerification({...good,...bad}).state,'inconclusive');
 incident.status='verified';incident.verification=assessVerification(good);
 applyObservation(state,s,{start:'2026-10-17T12:00:00.000Z',end:'2026-10-17T13:00:00.000Z',events:[{...e,event:digest('new-event'),time:'2026-10-17T12:30:00.000Z'}],coverage:'complete',gaps:[],traffic:null});assert.equal(incident.status,'regressed');assert.equal(incident.count,2);
});

test('provider credentials are scoped to Vercel environment; config rejects unsafe probe/dashboard input',()=>{
 const env={PATH:'/acme/bin',VERCEL_TOKEN:'fake-private',VERCEL_API_TOKEN:'fake-unused',GH_TOKEN:'fake-gh'};
 assert.equal(providerEnv('vercel',env).VERCEL_TOKEN,'fake-private');
 for(const command of ['gcloud','gh']){assert.equal(providerEnv(command,env).VERCEL_TOKEN,undefined);assert.equal(providerEnv(command,env).VERCEL_API_TOKEN,undefined);}
 assert.throws(()=>source({equivalentProbe:'/probe'}),/equivalentProbe/);
 assert.throws(()=>source({site:'https://acme.example',equivalentProbe:'/probe?secret=fake'}),/equivalentProbe/);
 assert.throws(()=>source({dashboardUrl:'https://evil.example/acme/app'}),/dashboardUrl/);
 assert.equal(source({dashboardUrl:'https://vercel.com/acme/app'}).dashboardUrl,'https://vercel.com/acme/app');
});
test('receipt retention is time ordered, disclosed, and bounded',async t=>{
 const root=await fixture(t);
 await transaction(root,async()=>({state:'ok'}));
 const dir=join(root,'.keel/production/observations');
 for(let n=0;n<65;n++)await atomicJson(join(dir,`${1700000000000+n}-00000000-0000-4000-8000-000000000001.json`),{version:1});
 await transaction(root,async()=>({state:'ok'}));
 assert.equal((await readdir(dir)).length,64);assert.equal((await readState(root)).droppedReceipts,3);
 assert.ok(!(await readdir(dir)).some(f=>f.startsWith('1700000000000-')));
});

test('late arrivals invalidate verified windows; unknown identities do not manufacture overlap recurrence',()=>{
 const state=emptyState(),s=source(),e=normalizeEvent({...event(),id:undefined},s);
 const o={start,end,events:[e],coverage:'partial',gaps:['identity-unknown'],traffic:null};
 applyObservation(state,s,o);applyObservation(state,s,{...o,start:'2026-10-17T10:10:00.000Z',end:'2026-10-17T11:10:00.000Z'});
 const incident=Object.values(state.incidents)[0];assert.equal(incident.count,1);assert.equal(incident.status,'new');
 incident.status='verified';incident.verification={state:'verified',gaps:[],revision:'a'.repeat(40),start:'2026-10-17T11:00:00.000Z',end:'2026-10-17T12:00:00.000Z'};
 const historical=structuredClone(incident.verification);
 applyObservation(state,s,{...o,start:'2026-10-17T11:00:00.000Z',end:'2026-10-17T12:00:00.000Z',events:[{...e,event:digest('late-event'),time:'2026-10-17T11:30:00.000Z'}]});
 assert.equal(incident.status,'regressed');assert.deepEqual(incident.verification,historical);assert.equal(incident.count,2);
});


test('verification history bounds, deduplication, strict proof schema and recovery preserve sanitized snapshots',async t=>{
 const root=await fixture(t,[event()]);await collect({root,config:config(),start,end,now,yes:true});
 await transaction(root,async state=>{
  const i=Object.values(state.incidents)[0];
  for(let n=0;n<35;n++) {
   const proof={state:'inconclusive',gaps:['probe-outside-window'],revision:'a'.repeat(40),start,end,evidence:{scope:i.scope,checkedAt:new Date(Date.parse(end)+n).toISOString(),window:{id:digest('acme-window'),digest:digest('acme-observation'),coverage:'partial'},probe:null,deployment:null,liveProbe:null}};
   retainVerification(i,proof);retainVerification(i,proof);
  }
  return {state:'recorded'};
 });
 const state=await readState(root),i=Object.values(state.incidents)[0];
 assert.equal(i.verificationHistory.length,32);assert.equal(i.verificationHistoryDropped,3);
 assert.equal(i.verificationHistory[0].evidence.checkedAt,new Date(Date.parse(end)+3).toISOString());
 const reading=await status({root,config:config(),now});assert.equal(reading.incidents[0].verificationHistoryDropped,3);assert.equal(reading.retention.verificationHistoryPerIncident,32);
 for(const mutate of [i=>i.verificationHistory.push(i.verificationHistory[0]),i=>i.verificationHistoryDropped=-1,i=>i.verificationHistory[0].message='private',i=>i.verificationHistory[0].evidence.raw='private',i=>i.verificationHistory[0].evidence.scope=digest('other'),i=>i.verificationHistory[0].evidence.checkedAt='invalid',i=>i.verificationHistory[0].evidence.deployment={reference:'private'},i=>i.verificationHistory[0].evidence.probe={message:'private'}]) {
  const bad=structuredClone(state);mutate(Object.values(bad.incidents)[0]);assert.throws(()=>validateState(bad));
 }
 const pending={version:1,id:'1792234800000-00000000-0000-4000-8000-000000000002',at:end,state,digest:digest(state)};
 await atomicJson(join(root,'.keel/production/pending.json'),pending);await recoverState(root);assert.deepEqual(await readState(root),state);
});

test('Vercel request rows retain nested error/fatal shapes with stable bounded request identities',async t=>{
 const root=await fixture(t),s=source({provider:'vercel',project:'prj_acme',scope:'team_acme'});
 const args=commandFor(s,{start,end}).args;
 assert.deepEqual(args.flatMap((v,n)=>v==='--level'?[args[n+1]]:[]),['error','fatal']);
 const row={id:'acme-request',timestamp:Date.parse(start),deploymentId:'acme-deployment',projectId:'prj_acme',level:'fatal',message:'RangeError at src/acme.mjs:24:1',source:'serverless',domain:'acme.example.test',requestMethod:'GET',requestPath:'/acme/items?token=private',responseStatusCode:500,environment:'production',logs:[
  {level:'error',message:'TypeError at src/acme.mjs:12:1',messageTruncated:false},
  {level:'fatal',message:'RangeError at src/acme.mjs:24:1',messageTruncated:false},
  {level:'error',message:'TypeError at src/acme.mjs:12:1',messageTruncated:false},
  {level:'info',message:'private informational content',messageTruncated:false},
 ]};
 const read=rows=>collectSource(root,s,{start,end},{runner:async()=>({stdout:rows.map(r=>JSON.stringify(r)).join('\n')})});
 const first=await read([row,row]);assert.equal(first.events.length,2);assert.deepEqual(first.events.map(e=>e.type).sort(),['RangeError','TypeError']);
 assert.equal(first.events.find(e=>e.type==='TypeError').lowerBound,true);
 const state=emptyState();applyObservation(state,s,first);
 assert.equal(Object.values(state.incidents).find(i=>i.type==='TypeError').confidence,'lower-bound');
 const reordered=await read([{...row,logs:[...row.logs].reverse()}]);applyObservation(state,s,reordered);
 assert.deepEqual(Object.values(state.incidents).map(i=>i.count),[1,1]);
 const second=await read([{...row,id:'acme-another-request'}]);applyObservation(state,s,second);
 assert.deepEqual(Object.values(state.incidents).map(i=>i.count),[2,2]);
 const unknown=await read([{...row,id:''}]);assert.ok(unknown.events.every(e=>e.event===null));assert.ok(unknown.gaps.includes('identity-unknown'));
 applyObservation(state,s,unknown);applyObservation(state,s,{...unknown,start:'2026-10-17T09:59:00.000Z'});
 assert.deepEqual(Object.values(state.incidents).map(i=>i.count),[3,3]);
 for(const truncated of [{...row,messageTruncated:true},{...row,logs:row.logs.map((l,n)=>({...l,messageTruncated:n===0}))}]) assert.ok((await read([truncated])).gaps.includes('event-coverage-incomplete'));
 const limited=await collectSource(root,{...s,maxEvents:1},{start,end},{runner:async()=>({stdout:JSON.stringify(row)})});assert.equal(limited.events.length,1);assert.ok(limited.gaps.includes('event-limit'));
 const empty=await read([{...row,message:'',logs:[]}]);assert.equal(empty.events.length,1);
 validateState(state);assert.doesNotMatch(JSON.stringify(state),/private|acme-request|acme-deployment|src\/acme|acme\.example/);
});


test('malformed identities remain unknown and non-string message or stack fields make JSON coverage partial',async t=>{
 const root=await fixture(t),s=source();
 for(const id of [{},[],true,false,null,'','   ',1.5,Number.MAX_SAFE_INTEGER+1,Infinity]) assert.equal(normalizeEvent({...event(),id},s).event,null);
 for(const id of ['acme-id',0,42]) assert.ok(normalizeEvent({...event(),id},s).event);
 for(const field of ['message','stack','textPayload','exceptionType']) for(const value of [{private:'acme'},[],true,42,null]) {
  await fixtureInput([{...event(),[field]:value}]);
  const observed=await collectSource(root,s,{start,end});
  assert.equal(observed.events.length,0);assert.equal(observed.coverage,'partial');assert.ok(observed.gaps.includes('timestamp-or-shape'));
 }
 for(const field of ['message','stack']) assert.equal(normalizeEvent({...event(),jsonPayload:{[field]:{private:'acme'}}},s),null);
 await fixtureInput([{...event(),id:{}},{...event(),id:[]}]);
 const unknown=await collectSource(root,s,{start,end});assert.ok(unknown.gaps.includes('identity-unknown'));
 const state=emptyState();applyObservation(state,s,unknown);const incident=Object.values(state.incidents)[0];assert.equal(incident.count,1);assert.equal(incident.confidence,'lower-bound');
 async function fixtureInput(events) { await writeFile(join(root,'events.json'),JSON.stringify({version:1,source:'acme',service:'acme',environment:'production',start,end,coverage:'complete',events})); }
});
