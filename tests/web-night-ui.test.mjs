import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nightRequest} from '../lib/web/night-client.mjs';

test('night transport bounds a never-settling fetch and never retries an uncertain request',async()=>{
  let calls=0,signal;
  const result=await nightRequest(async(_url,options)=>{calls++;signal=options.signal;return new Promise(()=>{});},'/api/projects/studio/night-plan/apply',{csrf:'Acme',previewId:'a'.repeat(64)},{timeoutMs:5});
  assert.equal(calls,1);assert.equal(signal.aborted,true);assert.deepEqual(result,{status:503,data:{error:'request_unavailable'}});
});
test('night receipt inspection is credentialed no-store GET with no approval or request body',async()=>{
  let options;
  const result=await nightRequest(async(_url,input)=>{options=input;return Response.json({state:'uncertain'});},'/api/projects/studio/night-plan/operations/'+'a'.repeat(64));
  assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');assert.equal(result.data.state,'uncertain');
});

import {createWebService} from '../lib/web/server.mjs';
import {nightPlanHarness} from './helpers/web-night-plan.mjs';
import {nightRetryHarness} from './helpers/web-night-retry.mjs';
import {nightPlanPreview,nightRetryPreview,nightReceiptBody,nightPlanPath,nightRetryPath} from '../lib/web/night-views.mjs';
import {createNightController} from '../lib/web/night-client.mjs';
import {describeRoute,lensRoute} from '../lib/web/navigation-routes.mjs';
import {runDetailView} from '../lib/web/run-views.mjs';
const H=character=>character.repeat(64);
async function ui(h) {
  const service=createWebService(h.config,{fetcher:h.fetcher,now:()=>h.state.now}),login=await h.login();
  return {...h,service,login,get:path=>service(h.request(path,{cookie:login.cookie})),post:(path,data,overrides={})=>service(new Request(h.config.origin+path,{method:'POST',headers:{cookie:login.cookie,origin:h.config.origin,'Content-Type':'application/json',...overrides.headers},body:JSON.stringify({csrf:login.session.csrf,...data})}))};
}
async function json(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}
async function planInput(h,date='2026-10-21') {
  const current=await json(await h.get(`/api/projects/studio/daily?date=${date}`));
  const plan=structuredClone(current.plan||current.capabilities.nightPlan.seed);plan.leftOpen.push('Acme reviewed follow-up');
  return {date,sourceDigest:current.sourceDigest,plan};
}
test('actual plan routes preview exact source and require public acknowledgment before one conditional publication',async()=>{
  const h=await ui(nightPlanHarness()),input=await planInput(h);
  const p=await json(await h.post('/api/projects/studio/night-plan/preview',input));assert.equal(p.kind,'night-plan');assert.equal(h.planState.writes.length,0);
  assert.match(nightPlanPreview(p),/Current plan/);assert.match(nightPlanPreview(p),/data-night-public/);
  await json(await h.post('/api/projects/studio/night-plan/apply',{previewId:p.id}),400);
  const result=await json(await h.post('/api/projects/studio/night-plan/apply',{previewId:p.id,publicAcknowledgement:p.digest}));assert.equal(result.state,'committed');assert.equal(h.planState.writes.length,1);
  const repeated=await json(await h.post('/api/projects/studio/night-plan/apply',{previewId:p.id,publicAcknowledgement:p.digest}));assert.equal(repeated.id,result.id);assert.equal(h.planState.writes.length,1);
  const page=await h.get(p.operationUrl);assert.match(await page.text(),/Night plan published/);assert.equal(h.branch.files['keep.txt'],'Acme unrelated branch file');
});
test('lost accepted plan response is recovered only through its original receipt with no new write',async()=>{
  const h=await ui(nightPlanHarness()),p=await json(await h.post('/api/projects/studio/night-plan/preview',await planInput(h)));
  h.planState.mode='lost';const result=await json(await h.post('/api/projects/studio/night-plan/apply',{previewId:p.id,publicAcknowledgement:p.digest}));
  assert.ok(['uncertain','committed','dispatched'].includes(result.state));
  const recovered=await json(await h.get('/api'+p.operationUrl));assert.equal(recovered.id,p.operationId);assert.equal(recovered.state,'committed');assert.equal(h.planState.writes.length,1);
});
test('night routes reject Origin, CSRF, scope, arbitrary payload and stale source before effects',async()=>{
  const h=await ui(nightPlanHarness()),input=await planInput(h),path='/api/projects/studio/night-plan/preview';
  await json(await h.post(path,input,{headers:{origin:'https://outside.acme.test'}}),403);
  await json(await h.post(path,{...input,csrf:'wrong'}),403);
  await json(await h.post(path,{...input,command:'npm run deploy'}),400);
  await json(await h.post('/api/projects/other/night-plan/preview',input),404);
  h.source.head='c'.repeat(40);await json(await h.post(path,input),409);assert.equal(h.planState.writes.length,0);
});
test('actual upcoming-date Daily exposes a canonical seed without inventing an observed plan and disabled writes remain review-only',async()=>{
  const fixture=nightPlanHarness();fixture.config.nightOperations.planWrites=false;const h=await ui(fixture);
  const model=await json(await h.get('/api/projects/studio/daily?date=2026-10-22'));assert.equal(model.plan,null);assert.equal(model.capabilities.nightPlan.seed.schema,1);
  const page=await h.get('/projects/studio/daily?date=2026-10-22');const html=await page.text();assert.match(html,/new authored draft/);assert.match(html,/Review the supported plan changes/);assert.doesNotMatch(html,/Canonical plan publication is unavailable for this source/);
  const p=await json(await h.post('/api/projects/studio/night-plan/preview',await planInput(h,'2026-10-22')));assert.equal(p.canSubmit,false);assert.doesNotMatch(nightPlanPreview(p),/data-night-approve/);assert.equal(h.planState.writes.length,0);
});
test('actual registered night inspection and approved retry retain original lineage; acceptance is not night success',async()=>{
  const h=await ui(await nightRetryHarness());
  const page=await h.get('/projects/studio/night-retries?run=7001&attempt=2');assert.equal(page.status,200,await page.clone().text());assert.match(await page.text(),/current UTC date and current plan/);
  const p=await json(await h.post('/api/projects/studio/night-retries/preview',{runId:7001,attempt:2}));assert.equal(h.nightState.posts.length,0);assert.match(nightRetryPreview(p),/60 min/);
  const result=await json(await h.post('/api/projects/studio/night-retries/apply',{previewId:p.id,digest:p.digest}));assert.equal(result.state,'request-accepted');assert.equal(h.nightState.posts.length,1);
  const repeated=await json(await h.post('/api/projects/studio/night-retries/apply',{previewId:p.id,digest:p.digest}));assert.equal(repeated.id,result.id);assert.equal(h.nightState.posts.length,1);
  const receipt=await h.get(p.operationUrl);assert.match(await receipt.text(),/Retry request accepted/);
  await json(await h.post('/api/projects/studio/night-retries/'+result.id+'/reconcile',{}));assert.equal(h.nightState.posts.length,1);
});
test('night receipt routes retain safe unknown identities and explicit unsupported setup without granting retry',async()=>{
  const h=await ui(await nightRetryHarness());
  for(const path of [nightPlanPath('studio',H('a')),nightRetryPath('studio',H('a'))]) {
    const page=await h.get(path);assert.equal(page.status,200);assert.match(await page.text(),/No receipt is visible/);
  }
  delete h.workspace.files['night-retries/studio.json'];
  const page=await h.get('/projects/studio/night-retries?run=7001&attempt=2');assert.equal(page.status,200);const html=await page.text();assert.match(html,/no reviewed night-retry profile/);assert.doesNotMatch(html,/data-night-preview-retry/);
  for(const path of ['/projects/studio/night-retries?run=7001&attempt=2&ref=main','/projects/studio/night-retries?run=7001&run=7002&attempt=2','/projects/studio/night-retries?run=1e3&attempt=2'])assert.equal((await h.get(path)).status,400);
});
test('new receipt and inspection destinations remain strict sign-in/lens routes and assets resolve',async()=>{
  const h=await ui(nightPlanHarness());
  for(const path of [nightPlanPath('studio',H('a')),nightRetryPath('studio',H('b')),'/projects/studio/night-retries?run=7001&attempt=2'])assert.ok(describeRoute(path),path);
  assert.equal(lensRoute(nightPlanPath('studio',H('a')),'lab').path,'/projects/lab/daily');assert.equal(lensRoute(nightRetryPath('studio',H('b')),'lab').path,'/projects/lab/activity');
  for(const path of [nightPlanPath('studio',H('a'))+'?key=Acme','//outside.acme.test/night-retries','/projects/studio/night-retries?run=1&attempt=2&attempt=3'])assert.equal(describeRoute(path),null,path);
  for(const path of ['night-client.mjs','night-views.mjs','night.css'])assert.equal((await h.get('/assets/'+path)).status,200,path);
});

function controllerFixture(respond,{model=null}={}) {
  const approved={checked:false},publicApproved={checked:false},button={disabled:true},calls=[],events=[];
  const heading={setAttribute(){},focus(){events.push('focus');},scrollIntoView(){}};
  const host={innerHTML:'',querySelector:()=>heading};
  const status={textContent:''};
  const root={innerHTML:'Acme private editor',addEventListener(){},removeEventListener(){},querySelector:selector=>({'[data-night-approve]':approved,'[data-night-public]':publicApproved,'[data-night-apply]':button}[selector]||null)};
  const document={title:'Acme',querySelector(){return null;}};
  const window={location:{pathname:'/projects/studio/daily',search:''},history:{replaceState(_a,_b,path){events.push('url:'+path);}}};
  const fetch=async(path,options)=>{const call={path,method:options.method,body:options.body?JSON.parse(options.body):undefined};calls.push(call);events.push(options.method+':'+path);return respond(call,calls.length);};
  const controller=createNightController({root,host,status,document,window,fetch,project:{id:'studio'},csrf:'Acme csrf',model});
  return {controller,root,host,status,calls,events,approved,publicApproved};
}
function clientPreview(kind='night-plan') {
  return {schema:1,kind,id:H('a'),digest:H('b'),operationId:H('c'),operationUrl:kind==='night-plan'?nightPlanPath('studio',H('c')):nightRetryPath('studio',H('c')),project:{id:'studio'},canSubmit:true,visibility:'public',before:'{}',content:'{}',capabilities:{retry:true},run:{runId:7001,attempt:2},budget:{minutes:60}};
}
test('plan controller requires both exact approvals, bookmarks before dispatch, then recovers lost response without another publication',async()=>{
  const p=clientPreview();
  const h=controllerFixture(call=>{
    if(call.path.endsWith('/preview'))return Response.json(p);
    if(call.path.endsWith('/apply'))throw Error('Acme lost response');
    return Response.json({kind:'night-plan',id:p.operationId,state:'committed',receipt:{commit:'d'.repeat(40),url:'https://github.com/acme/studio/commit/'+'d'.repeat(40)}});
  });
  await h.controller.reviewPlan({date:'2026-10-21',sourceDigest:H('e'),plan:{}});
  await h.controller.apply();assert.equal(h.calls.length,1,'no default approval');
  h.approved.checked=true;await h.controller.apply();assert.equal(h.calls.length,1,'public publication needs separate acknowledgment');
  h.publicApproved.checked=true;await h.controller.apply();
  assert.deepEqual(h.calls[1].body,{csrf:'Acme csrf',previewId:p.id,publicAcknowledgement:p.digest});
  assert.ok(h.events.indexOf('url:'+p.operationUrl)<h.events.indexOf('POST:/api/projects/studio/night-plan/apply'));
  assert.equal(h.controller.getState().operation.state,'uncertain');assert.doesNotMatch(h.host.innerHTML,/Night plan published/);
  await h.controller.apply();await h.controller.reviewPlan({});assert.equal(h.calls.length,2,'unknown publication cannot be redispatched');
  await h.controller.recover();assert.equal(h.calls[2].method,'GET');assert.equal(h.calls[2].path,'/api'+p.operationUrl);assert.equal(h.calls[2].body,undefined);assert.match(h.host.innerHTML,/Night plan published/);h.controller.stop();
});
test('retry loss reads original receipt before an explicit readback reconcile and never issues a second retry',async()=>{
  const p=clientPreview('night-retry'),receipt={kind:'night-retry',id:p.operationId,original:p.run,state:'request-accepted',request:{accepted:true},capabilities:{reconcile:true},budget:{reservedMinutes:60,charged:true,laneHeld:true}};
  const h=controllerFixture(call=>{
    if(call.path.endsWith('/preview'))return Response.json(p);
    if(call.path.endsWith('/apply'))throw Error('Acme lost retry');
    return Response.json(receipt);
  },{model:{view:'inspect',run:p.run}});
  await h.controller.reviewRetry();h.approved.checked=true;await h.controller.apply();
  assert.deepEqual(h.calls[1].body,{csrf:'Acme csrf',previewId:p.id,digest:p.digest});
  await h.controller.recover();assert.equal(h.calls[2].method,'GET');assert.equal(h.calls[2].path,'/api'+p.operationUrl);
  await h.controller.recover();assert.equal(h.calls[3].method,'POST');assert.equal(h.calls[3].path,'/api'+p.operationUrl+'/reconcile');assert.deepEqual(h.calls[3].body,{csrf:'Acme csrf'});
  await h.controller.apply();assert.equal(h.calls.filter(call=>call.path.endsWith('/apply')).length,1);assert.match(h.host.innerHTML,/does not establish a successful night/);h.controller.stop();
});
test('an edit during preview invalidates old approval and denial clears private editor content',async()=>{
  let release;const h=controllerFixture(()=>new Promise(resolve=>{release=resolve;}));
  const pending=h.controller.reviewPlan({});h.controller.invalidate();release(Response.json(clientPreview()));await pending;
  assert.equal(h.controller.getState().preview,null);assert.match(h.status.textContent,/draft changed/);h.approved.checked=true;h.publicApproved.checked=true;await h.controller.apply();assert.equal(h.calls.length,1);h.controller.stop();
  const denied=controllerFixture(()=>Response.json({error:'access_denied'},{status:404}));await denied.controller.reviewPlan({});assert.equal(denied.controller.getState().locked,true);assert.match(denied.root.innerHTML,/Sign in again/);assert.doesNotMatch(denied.root.innerHTML,/Acme private editor/);denied.controller.stop();
});
test('receipt rendering separates observed successors, settled reservation and verified publication',()=>{
  const retry={kind:'night-retry',id:H('c'),state:'uncertain',request:{accepted:false},observations:[{attempt:3,state:'completed',conclusion:'success'}],budget:{reservedMinutes:60,charged:true,laneHeld:true}};
  const uncertain=nightReceiptBody(retry);assert.match(uncertain,/Night retry not yet confirmed/);assert.match(uncertain,/Attribution is unverified/);assert.doesNotMatch(uncertain,/Retry request accepted|Retry request settled/);
  const settled=nightReceiptBody({...retry,state:'settled',request:{accepted:true},budget:{...retry.budget,laneHeld:false}});assert.match(settled,/Retry request settled/);assert.match(settled,/full 60-minute charge remains for seven days/);assert.match(settled,/attribution and acceptance remain unverified/);
  assert.doesNotMatch(nightReceiptBody({kind:'night-plan',state:'committed',receipt:null}),/Night plan published/);
});
test('fresh authorization after buffered night inspection suppresses revoked Actions access',async()=>{
  const h=await ui(await nightRetryHarness());h.nightState.before=()=>{h.actions.permission=null;};
  const response=await h.get('/api/projects/studio/night-retries?run=7001&attempt=2');assert.equal(response.status,404);assert.deepEqual(await response.json(),{error:'access_denied'});assert.equal(h.nightState.posts.length,0);
});
test('only failed canonical night attempt details offer eligibility inspection and plan receipts keep their own route',async()=>{
  const {runCard}=await import('../lib/web/run-views.mjs');
  const project={id:'studio',name:'Acme Studio',repo:'acme/studio'},access={workspace:{name:'Acme'},projects:[project]};
  const item={kind:'actions-attempt',state:'failed',routineId:'.github/workflows/keel-night.yml',identity:{runId:7001,attempt:2},title:'Acme night'};
  const render=value=>runDetailView({project,item:value,coverage:{},stages:[],evidence:[]},access);
  assert.match(render(item),/night-retries\?run=7001&amp;attempt=2/);assert.match(render(item),/Opening this inspection retries nothing/);
  for(const changed of [{...item,state:'succeeded'},{...item,routineId:'.github/workflows/typecheck.yml'}])assert.doesNotMatch(render(changed),/night-retries/);
  const card=runCard({kind:'web-operation',detailUrl:nightPlanPath('studio',H('a'))},project);assert.match(card,new RegExp('href="'+nightPlanPath('studio',H('a'))+'"'));
});

test('upcoming-date publication restores authored fields onto the canonical seed and never copies old build state',async()=>{
  const {restoreDailyDraft,authoredDailyDraft,startDailyClient}=await import('../lib/web/daily-client.mjs');
  const h=await ui(nightPlanHarness());
  const model=await json(await h.get('/api/projects/studio/daily?date=2026-10-22'));
  const seed=model.capabilities.nightPlan.seed;
  const restored=restoreDailyDraft(seed,{...authoredDailyDraft(seed),leftOpen:['Acme restored note'],items:[{id:'triage',title:'Inspect Acme failure',kind:'triage',lane:'night',budget:null,number:null}]});
  assert.equal(restored.schema,1);assert.equal(restored.shapedBy,'owner');assert.equal(restored.items[0].status,'planned');assert.equal(restored.items[0].result,null);assert.equal(restored.items[0].source,'owner');
  const fields={date:model.date,leftOpen:'Acme upcoming note'},requests=[];
  const form={reportValidity:()=>true,querySelector:selector=>({value:fields[selector.match(/name="([^"]+)"/)[1]]||''})};
  const elements={'[data-daily-model]':{value:JSON.stringify(model)},'[data-daily-csrf]':{value:'Acme'},'[data-daily-status]':{},'[data-evening-preview]':{},'[data-evening-form]':form,'[data-evening-editor]':{},'[data-night-preview-host]':{innerHTML:'',querySelector(){return null;}},'[data-night-status]':{}};
  const root={dataset:{project:'studio'},querySelector:selector=>elements[selector],addEventListener(){},removeEventListener(){}};
  const client=startDailyClient({document:{querySelector:()=>root},window:{addEventListener(){},removeEventListener(){}},fetch:async(path,options)=>{requests.push(JSON.parse(options.body));return Response.json({error:'night_plan_disabled'},{status:409});}});
  await client.reviewPublication();assert.equal(requests.length,1);assert.equal(requests[0].plan.schema,1);assert.equal(requests[0].plan.shapedBy,'owner');assert.deepEqual(requests[0].plan.items,[]);assert.deepEqual(requests[0].plan.leftOpen,['Acme upcoming note']);client.stop();
});
