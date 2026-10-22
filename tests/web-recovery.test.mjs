import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {describeRoute,lensRoute,signInPath} from '../lib/web/navigation-routes.mjs';
import {startEditorDraft} from '../lib/web/editor-draft-client.mjs';
import {clearPrivateView} from '../lib/web/safety-client.mjs';
import {editorHarness} from './helpers/web-editor-drafts.mjs';
const id='a'.repeat(64);
test('exact core HTML destinations and safe query schemas survive login while forged destinations refuse',()=>{
 for(const path of ['/projects/studio/walks/acme',`/projects/studio/operations/${id}`,'/projects/studio/decisions?kind=health&path=docs%2Fhealth%2Facme.md','/projects/studio/decisions?kind=shaping&path=docs%2Fshaping%2Facme.json&question=choice','/projects/studio/daily?date=2026-10-21',`/projects/studio/media?request=${id}`,'/projects/studio/model-tasks?phase=docs%2Fphases%2F1-acme.md','/projects/studio/activity?days=30&status=running','/projects/studio/activity/actions/12/attempts/1?routine=night&jobsPage=2','/capabilities?q=review']) {
  assert.equal(describeRoute(path)?.path,path,path);assert.equal(new URL(signInPath(path),'https://acme.example').searchParams.get('returnTo'),path);
 }
 for(const path of ['https://evil.example','//evil.example','/projects/studio/../other','/projects/studio/%2e%2e/other','/projects/studio/activity?days=3&days=4','/projects/studio/daily?date=2026-02-30','/projects/studio/model-tasks?instructions=private','/projects/studio/media?request='+id+'&after='+id,'/projects/studio/decisions?kind=health&path=../secret','/api/session','/signin'])assert.equal(describeRoute(path),null,path);
 const switched=lensRoute(`/projects/studio/media?request=${id}`,'garden');assert.equal(switched.path,'/projects/garden/media');assert.ok(switched.notice);
 assert.equal(lensRoute('/projects/studio/activity?days=30&status=failed&routine=night&page=2','garden').path,'/projects/garden/activity?days=30&status=failed');
});
test('actual expired receipt HTML retains exact safe sign-in destination; return inspection sends no mutation',async()=>{
 const h=await editorHarness(),path=`/projects/studio/operations/${id}`;
 const response=await h.editorService(h.request(path));assert.equal(response.status,401);
 const html=await response.text();assert.ok(html.includes(signInPath(path)));
 const login=await h.editorService(h.request(signInPath(path)));assert.equal(login.status,200);assert.match(await login.text(),/name="returnTo"/);
 assert.equal(h.source.writes.length,0);assert.equal(h.model.calls.length,0);
});
function editorClient(fetch) {
 const events={},documentEvents={},windowEvents={},status={textContent:''},controls={querySelector:()=>status,querySelectorAll:()=>[]};
 const root={querySelector:s=>s==='[data-editor-draft]'?controls:null,addEventListener:(n,f)=>events[n]=f,removeEventListener(){}};
 const document={querySelector:()=>null,addEventListener:(n,f)=>documentEvents[n]=f,removeEventListener(n){delete documentEvents[n];}};
 const window={crypto:webcrypto,navigator:{onLine:true},location:{pathname:'/projects/studio/model-tasks',search:'',assign(){}},addEventListener:(n,f)=>windowEvents[n]=f,removeEventListener(n){delete windowEvents[n];},confirm:()=>true};
 let payload={phase:'1',paths:['docs/phases/1-acme.md'],instructions:'Acme draft'},restored=0;
 const client=startEditorDraft({root,document,window,fetch,csrf:'Acme',kind:'model-source',target:'main',projectId:'studio',baseDigest:id,storageEnabled:true,readPayload:()=>payload,restore:p=>{payload=p;restored++;}});
 return {client,root,document,window,documentEvents,windowEvents,events,status,edit(){payload={...payload,instructions:'Newer unsaved words'};client.markDirty();},get restored(){return restored;}};
}
const empty={schema:1,enabled:true,revision:1,state:'empty',payload:null,saveId:null,currentDigest:id};
test('lost editor save is read back by original identity; reconnect never replays and newer unsaved text survives readback',async()=>{
 const calls=[];let row=empty,lose=true;
 const f=editorClient(async(url,options)=>{calls.push({url,method:options.method});if(options.method==='POST'){const body=JSON.parse(options.body);row={...empty,revision:2,state:'saved',saveId:body.saveId,payload:body.payload,baseDigest:body.baseDigest,stale:false};if(lose){lose=false;throw Error('Acme lost response');}}return Response.json(row);});
 await new Promise(resolve=>setTimeout(resolve,0));f.edit();assert.equal(await f.client.save(),false);assert.ok(f.client.getState().uncertain);
 f.windowEvents.offline();f.windowEvents.online();assert.equal(calls.filter(c=>c.method==='POST').length,1);
 assert.equal(await f.client.save(),false);assert.equal(calls.filter(c=>c.method==='POST').length,1);
 f.edit();await f.client.load();assert.equal(f.restored,0);assert.equal(f.client.getState().dirty,true);assert.equal(f.client.getState().uncertain,null);assert.equal(calls.filter(c=>c.method==='POST').length,1);f.client.stop();
});
test('conflicting remote draft never silently restores or retries local editing',async()=>{
 let row=empty;const calls=[];const f=editorClient(async(url,options)=>{calls.push(options.method);if(options.method==='POST')return Response.json({error:'editor_draft_conflict'},{status:409});return Response.json(row);});
 await new Promise(resolve=>setTimeout(resolve,0));f.edit();assert.equal(await f.client.save(),false);assert.equal(f.client.getState().dirty,true);assert.equal(f.restored,0);assert.deepEqual(calls,['GET','POST']);f.client.stop();
});
test('daily draft restores authored fields alongside current observations without retaining old result output',async()=>{
 const {authoredDailyDraft,restoreDailyDraft}=await import('../lib/web/daily-client.mjs');
 const {dailyPlan}=await import('./helpers/web-daily.mjs');
 const original=dailyPlan();original.items[0].result={note:'Old private provider output'};original.items[0].status='succeeded';
 const saved=authoredDailyDraft(original);assert.equal(saved.items[0].result,undefined);assert.equal(saved.items[0].status,undefined);assert.equal(saved.items[0].source,undefined);assert.doesNotMatch(JSON.stringify(saved),/Old private provider output/);
 saved.items[0].title='Acme authored title';saved.leftOpen=['Owner question'];
 const current=dailyPlan();current.items[0].status='failed';current.items[0].result={note:'Current observed failure'};
 const restored=restoreDailyDraft(current,saved);assert.equal(restored.items[0].title,'Acme authored title');assert.equal(restored.items[0].status,'failed');assert.deepEqual(restored.items[0].result,current.items[0].result);assert.deepEqual(restored.leftOpen,['Owner question']);
 assert.equal(lensRoute('/projects/studio/walks',null).path,'/');assert.match(lensRoute('/projects/studio/walks',null).notice,/no fleet index/);
});

for(const outcome of ['discard','denial'])test(`daily ${outcome} clears dirty guards without claiming a save`, async()=>{
 const {startDailyClient}=await import('../lib/web/daily-client.mjs');
 const {dailyPlan}=await import('./helpers/web-daily.mjs');
 const model={project:{id:'studio'},date:'2026-10-21',sourceDigest:id,plan:dailyPlan(),budget:{lanes:[]}};
 const events={},documentEvents={},windowEvents={},buttons={},status={textContent:''};let destination=null,requests=0;
 const controls={querySelector:()=>status,querySelectorAll:()=>[]};
 const form={querySelector:()=>({value:''})};
 const root={dataset:{project:'studio'},append(){},querySelector:selector=>({
  '[data-daily-model]':{value:JSON.stringify(model)},'[data-daily-csrf]':{value:'Acme'},
  '[data-daily-status]':status,'[data-evening-preview]':{innerHTML:''},'[data-evening-form]':form,
  '[data-evening-editor]':{},'[data-editor-draft]':controls,'[data-safety-status]':status,
 }[selector]),addEventListener:(name,fn)=>{(events[name]??=[]).push(fn);},removeEventListener(){}};
 const document={querySelector:()=>root,addEventListener:(name,fn)=>{documentEvents[name]=fn;},removeEventListener(){},
  createElement:()=>({setAttribute(){},querySelector:selector=>buttons[selector]??=( {focus(){}} ),addEventListener(){},showModal(){},close(){},remove(){}})};
 const window={navigator:{onLine:true},location:{assign(path){destination=path;}},addEventListener:(name,fn)=>{(windowEvents[name]??=[]).push(fn);},removeEventListener(){}};
 const client=startDailyClient({document,window,fetch:async()=>{requests++;throw Error('unexpected save');}});
 for(const fn of events.input)fn({target:{closest:selector=>selector==='[data-editor-draft]'?null:form}});
 let warnings=0;for(const fn of windowEvents.beforeunload)fn({preventDefault(){warnings++;}});assert.ok(warnings>0);
 const link={getAttribute:()=>'/daily',hasAttribute:()=>false};
 documentEvents.click({target:{closest:()=>link},preventDefault(){},stopImmediatePropagation(){}});
 if(outcome==='discard'){buttons['[data-safety-discard]'].onclick();assert.equal(destination,'/daily');}
 else {clearPrivateView({root,document,window});assert.match(root.innerHTML,/Unsaved text was not saved/);}
 assert.equal(client.getState().dirty,false);
 warnings=0;for(const fn of windowEvents.beforeunload)fn({preventDefault(){warnings++;}});
 assert.equal(warnings,0);assert.equal(requests,0);client.stop();
});

test('editor access denial releases sign-in navigation and unload guards without saving',async()=>{
 const calls=[];const f=editorClient(async(url,options)=>{calls.push(options.method);return options.method==='POST'?Response.json({error:'access_denied'},{status:401}):Response.json(empty);});
 await new Promise(resolve=>setTimeout(resolve,0));f.edit();
 const oldClick=f.documentEvents.click,oldUnload=f.windowEvents.beforeunload;
 assert.equal(await f.client.save(),false);assert.match(f.root.innerHTML,/Unsaved text was not saved/);
 assert.equal(f.client.getState().dirty,false);
 let blocked=0;const link={getAttribute:()=>'/signin?returnTo=%2Fdaily',hasAttribute:()=>false};
 oldClick({target:{closest:()=>link},preventDefault(){blocked++;}});oldUnload({preventDefault(){blocked++;}});
 assert.equal(blocked,0);assert.equal(f.documentEvents.click,undefined);assert.equal(f.windowEvents.beforeunload,undefined);
 assert.equal(await f.client.save(),false);assert.deepEqual(calls,['GET','POST']);f.client.stop();
});
test('domain denial fences pending draft restoration and later draft actions',async()=>{
 let finish;const calls=[];const f=editorClient(async(url,options)=>{calls.push(options.method);if(calls.length===1)return Response.json(empty);return new Promise(resolve=>{finish=resolve;});});
 await new Promise(resolve=>setTimeout(resolve,0));f.edit();const pending=f.client.load();
 clearPrivateView({root:f.root,document:f.document,window:f.window});
 finish(Response.json({...empty,state:'saved',payload:{instructions:'Private saved words'},baseDigest:id}));
 assert.equal(await pending,false);assert.equal(f.restored,0);assert.equal(f.client.getState().dirty,false);
 assert.equal(await f.client.save(),false);assert.equal(await f.client.load(),false);assert.deepEqual(calls,['GET','GET']);f.client.stop();
});
