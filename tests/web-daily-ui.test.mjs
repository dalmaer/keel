import {test} from 'node:test';
import {returnPath} from '../lib/web/auth.mjs';
import assert from 'node:assert/strict';
import {learningHarness} from './helpers/web-learning.mjs';
import {dailyHarness,dailyPlan} from './helpers/web-daily.mjs';
import {dailyView,renderDailyPreview,renderPlanEditor} from '../lib/web/daily-views.mjs';
import {learningView,migrationPreviewView,migrationResult} from '../lib/web/learning-views.mjs';
import {readPlanDraft,startDailyClient} from '../lib/web/daily-client.mjs';
import {startLearningClient} from '../lib/web/learning-client.mjs';
const post=(h,login,path,data)=>h.service(new Request(`${h.config.origin}${path}`,{method:'POST',headers:{cookie:login.cookie,origin:h.config.origin,'Content-Type':'application/json'},body:JSON.stringify({csrf:login.session.csrf,...data})}));

test('actual authenticated learning routes preview private copies, verify receipt, and export only approved bytes',async()=>{
  const h=learningHarness(),login=await h.login();
  const page=await h.service(h.request('/projects/studio/learning',{cookie:login.cookie}));
  assert.equal(page.status,200);assert.match(await page.text(),/A bounded read needs a bound/);
  const model=await (await h.service(h.request('/api/projects/studio/learning',{cookie:login.cookie}))).json();
  const selection=[model.records[0].selection];
  let response=await post(h,login,'/api/projects/studio/learning/migration/preview',{selection});
  assert.equal(response.status,200,await response.clone().text());const preview=await response.json();
  assert.match(migrationPreviewView(preview),/Before: absent/);assert.equal(h.workspace.writes.length,0);
  response=await post(h,login,'/api/projects/studio/learning/migration/apply',{previewId:preview.id,digest:preview.digest});
  assert.equal(response.status,200,await response.clone().text());const operation=await response.json();
  assert.equal(operation.state,'committed');assert.equal(operation.id,preview.operationId);assert.equal(h.workspace.writes.length,1);
  const receipt=await h.service(h.request(preview.operationUrl,{cookie:login.cookie}));assert.match(await receipt.text(),/Copy verified in the private workspace/);
  response=await post(h,login,'/api/projects/studio/learning/export/preview',{selection,text:'Approved Acme lesson.\nOnly these bytes.'});
  assert.equal(response.status,200,await response.clone().text());const exp=await response.json();
  response=await post(h,login,'/api/projects/studio/learning/export/download',{previewId:exp.id,digest:exp.digest});
  assert.equal(response.status,200,await response.clone().text());assert.equal(response.headers.get('content-disposition'),'attachment; filename="plates-reviewed-lessons.txt"');assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(await response.text(),exp.text);
  assert.equal(h.source.writes.length,0,'project records are never changed');
});

test('learning routes retain current auth, CSRF, project selection scope and safe missing receipt',async()=>{
  const h=learningHarness(),login=await h.login();
  assert.equal((await h.service(h.request('/learning'))).status,401);
  const model=await (await h.service(h.request('/api/projects/studio/learning',{cookie:login.cookie}))).json();
  const selection=[model.records[0].selection];
  assert.equal((await post(h,login,'/api/projects/studio/learning/migration/preview',{selection,csrf:'x'.repeat(64)})).status,403);
  assert.equal((await post(h,login,'/api/projects/studio/learning/export/preview',{selection:[{...selection[0],projectId:'other'}],text:'Acme'})).status,400);
  const id='f'.repeat(64),api=await h.service(h.request(`/api/learning/operations/${id}`,{cookie:login.cookie}));assert.equal(api.status,404);
  const html=await h.service(h.request(`/learning/operations/${id}`,{cookie:login.cookie}));assert.equal(html.status,200);assert.match(await html.text(),/recheck without resubmitting/);
  h.state.members=[];
  assert.equal((await post(h,login,'/api/projects/studio/learning/export/preview',{selection,text:'Acme'})).status,404);
});

test('daily source rendering separates allowance allocation and unknown usage, including invalid preview',async()=>{
  const h=dailyHarness();const model=await h.daily.inspect(h.access,'fake-user-access-token-for-tests',h.project,'2026-10-21');
  const html=dailyView(model,{...h.access,csrf:'Acme'});
  assert.match(html,/plates goodnight/);assert.match(html,/45 min/);assert.match(html,/10 min/);assert.match(html,/Actual cost unknown/);assert.match(html,/Exact original plan and statuses/);
  const invalid=renderDailyPreview({valid:false,problems:['Acme invalid plan'],plan:null,budget:null});assert.match(invalid,/Acme invalid plan/);assert.match(invalid,/not a zero budget/);
  const editor=renderPlanEditor(model.plan,[{id:'climb',targets:['climb:test-time','climb:lint']}]);assert.match(editor,/value="climb:lint"/);assert.doesNotMatch(editor,/value="climb"/);
  model.items[0].resultUrl='https://preview.acme.test/result';assert.match(dailyView(model,{...h.access,csrf:'Acme'}),/href="https:\/\/preview.acme.test\/result"/);
});

test('new daily and learning browser modules and setup are served by the real handler',async()=>{
  const h=learningHarness(),login=await h.login();
  for(const path of ['daily-client.mjs','daily-views.mjs','learning-client.mjs','learning-views.mjs','daily.css']){const response=await h.service(h.request(`/assets/${path}`));assert.equal(response.status,200,path);assert.match(response.headers.get('content-type'),path.endsWith('.css')?/text\/css/:/javascript/);}
  for(const path of ['/daily','/setup','/learning']){const response=await h.service(h.request(path,{cookie:login.cookie}));assert.equal(response.status,200,path);const body=await response.text();assert.doesNotMatch(body,/fake-user-access-token|BEGIN PRIVATE KEY/);assert.match(body,/<title>[^<]* · Plates<\/title>/);assert.match(body,/href="\/assets\/plates\.css"/);assert.match(body,/href="\/">All plates<\/a>/);}
});

test('source prose and exact files are escaped and unverified copy is never called success',()=>{
  const model={kind:'project',state:'complete',project:{id:'studio'},records:[{shape:'<script>Acme</script>',source:{path:'javascript:alert(1)'},selection:{}}]};
  const html=learningView(model,{workspace:{name:'Acme'},csrf:'Acme'});assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>Acme/);assert.doesNotMatch(html,/href="javascript:/);
  assert.doesNotMatch(migrationResult({id:'a'.repeat(64),state:'committed',receipt:null}),/Copy verified/);
});

function learningController(fetch) {
  const output={innerHTML:''},status={textContent:''},approval={checked:true},text={value:'Approved Acme'},selection={dataset:{lessonIndex:'0'}};
  const model={kind:'project',project:{id:'studio'},records:[{selection:{kind:'project',projectId:'studio',id:'one',sourceDigest:'a'.repeat(64)}}]};
  const elements={'[data-learning-model]':{value:JSON.stringify(model)},'[data-learning-csrf]':{value:'Acme'},'[data-learning-preview]':output,'[data-learning-status]':status,'[data-export-text]':text,'[data-approve-migration]':approval};
  const root={dataset:{},matches:()=>true,querySelector:s=>elements[s],querySelectorAll:()=>[selection],addEventListener(){},removeEventListener(){}};
  const client=startLearningClient({document:{querySelector:()=>root},window:{},fetch});return {client,status,output,text};
}
test('lost copy response preserves original recovery identity and never dispatches twice',async()=>{
  const requests=[],id='a'.repeat(64),operationId='b'.repeat(64);
  const h=learningController(async(url,options)=>{requests.push({url,options});if(url.endsWith('/preview'))return Response.json({kind:'migration',id,digest:'c'.repeat(64),operationId,canSubmit:true,files:[]});if(options.method==='POST')throw Error('Acme lost response');return Response.json({error:'operation_not_found'},{status:404});});
  await h.client.review('migration');await h.client.apply();await h.client.apply();await h.client.recheck();
  assert.equal(requests.filter(r=>r.url.endsWith('/apply')).length,1);assert.equal(requests.at(-1).options.method,'GET');assert.equal(h.client.getState().operationId,operationId);assert.match(h.status.textContent,/do not submit again/);assert.match(h.output.innerHTML,new RegExp(operationId));
});
test('editing while an exact export preview is in flight invalidates its response',async()=>{
  let finish;const h=learningController(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=h.client.review('export');h.text.value='Changed';h.client.changed();finish(Response.json({kind:'export',id:'a'.repeat(64),digest:'b'.repeat(64),text:'Approved Acme'}));await pending;
  assert.equal(h.client.getState().preview,null);assert.equal(h.output.innerHTML,'');assert.match(h.status.textContent,/Inputs changed/);
});

test('draft parsing preserves absent bounds as missing rather than inventing zero',()=>{
  const values={date:'2026-10-21','title-0':'Acme','kind-0':'build','lane-0':'climb:test-time','measure-0':'slow_tests','bound-0':'','better-0':'lower'};
  const form={querySelector:selector=>({value:values[selector.match(/name="([^"]+)"/)[1]]||''})};
  const draft=readPlanDraft(form,dailyPlan());assert.equal(draft.items[0].number.bound,null);assert.equal(draft.items[0].budget,null);
});

test('new login return routes stay exact internal paths',()=>{
  for(const path of ['/','/daily','/learning','/setup','/projects/studio/daily','/projects/studio/learning',`/learning/operations/${'a'.repeat(64)}`])assert.equal(returnPath(path),true,path);
  for(const path of ['https://acme.test/learning','//acme.test/learning','/learning?next=https://acme.test','/projects/studio/daily?date=2026-10-21','/learning/../setup','/learning/operations/nope','/learning/'])assert.equal(returnPath(path),false,path);
});

test('authored import metadata stays declared attribution, never verified transfer identity',()=>{
  const html=learningView({kind:'workspace',workspace:{name:'Acme'},state:'complete',records:[{shape:'Acme',source:{},imported:{actorId:42,at:'2026-10-21'},selection:{}}]}, {workspace:{name:'Acme'},csrf:'Acme'});
  assert.match(html,/Record declares import by actor 42/);assert.match(html,/declared attribution, not a verified copy receipt/);assert.doesNotMatch(html,/Copied by actor/);
});

test('actual daily route validates unsaved previews without writes and rejects changed source',async()=>{
  const h=dailyHarness(),login=await h.login();
  // dailyHarness supplies an actual transport; create its handler with that transport.
  const {createWebService}=await import('../lib/web/server.mjs');
  h.service=createWebService(h.config,{fetcher:h.fetcher,now:()=>h.state.now});
  const response=await h.service(h.request('/api/projects/studio/daily?date=2026-10-21',{cookie:login.cookie}));
  assert.equal(response.status,200,await response.clone().text());const model=await response.json();
  let result=await post(h,login,'/api/projects/studio/daily/preview',{date:model.date,sourceDigest:model.sourceDigest,plan:model.plan});
  assert.equal(result.status,200,await result.clone().text());const preview=await result.json();assert.equal(preview.unsaved,true);assert.equal(preview.valid,true);
  h.source.head='e'.repeat(40);
  result=await post(h,login,'/api/projects/studio/daily/preview',{date:model.date,sourceDigest:model.sourceDigest,plan:model.plan});assert.equal(result.status,409);
  assert.equal(h.source.writes.length,0);
});

test('completed copy visibly offers a fresh catalogue for the next review and never silently redispatches',async()=>{
  const operationId='b'.repeat(64),requests=[];
  const h=learningController(async(url,options)=>{requests.push(url);return Response.json(url.endsWith('/preview')?{kind:'migration',id:'a'.repeat(64),digest:'c'.repeat(64),operationId,canSubmit:true,files:[]}:{id:operationId,state:'committed',receipt:{commit:'d'.repeat(40),url:'https://github.com/acme/keel-private/commit/'+ 'd'.repeat(40),paths:[]}});});
  await h.client.review('migration');await h.client.apply();assert.match(h.output.innerHTML,/Reload catalogue to review another copy or export/);assert.match(h.output.innerHTML,/href="\/projects\/studio\/learning"/);
  await h.client.review('export');assert.match(h.status.textContent,/reload the catalogue/);assert.equal(requests.length,2);
});

test('daily edits during validation preserve current input and discard obsolete preview; form submit stays private',async()=>{
  const model={project:{id:'studio'},date:'2026-10-21',sourceDigest:'a'.repeat(64),plan:dailyPlan(),budget:{lanes:[]}},events={},output={innerHTML:''},status={textContent:''};
  const values={date:model.date,'title-0':'Acme','kind-0':'build','lane-0':'climb:test-time','measure-0':'slow_tests','bound-0':'20','better-0':'lower'};
  const form={reportValidity:()=>true,querySelector:selector=>({value:values[selector.match(/name="([^"]+)"/)[1]]||''})};
  const root={dataset:{project:'studio'},querySelector:selector=>({'[data-daily-model]':{value:JSON.stringify(model)},'[data-daily-csrf]':{value:'Acme'},'[data-daily-status]':status,'[data-evening-preview]':output,'[data-evening-form]':form,'[data-evening-editor]':{}}[selector]),addEventListener:(name,fn)=>{events[name]=fn;},removeEventListener(){}};
  let finish;
  const client=startDailyClient({document:{querySelector:()=>root},window:{addEventListener(){},removeEventListener(){}},fetch:()=>new Promise(resolve=>{finish=resolve;})});
  const pending=client.preview();events.input({target:{closest:()=>form}});finish(Response.json({project:{id:'studio'},unsaved:true,valid:true,plan:model.plan}));await pending;
  assert.equal(output.innerHTML,'');assert.match(status.textContent,/Draft changed during validation/);
  let prevented=false;form.reportValidity=()=>false;events.submit({target:{matches:()=>true},preventDefault(){prevented=true;}});assert.equal(prevented,true,'private draft fields must never become a default GET query');client.stop();
});

test('OAuth round trips retain each new exact internal return destination',async()=>{
  for(const returnTo of ['/daily','/setup','/projects/studio/daily','/projects/studio/learning',`/learning/operations/${'a'.repeat(64)}`]){
    const h=learningHarness();
    const first=await h.service(h.request('/signin')),cookie=h.cookieHeader(first);
    const start=await h.service(h.request('/api/auth/start',{cookie,body:{csrf:cookie.split('=')[1],returnTo}}));
    assert.equal(start.status,303,returnTo);const target=new URL(start.headers.get('location'));h.state.challenges.add(target.searchParams.get('code_challenge'));
    const done=await h.service(h.request(`/api/auth/callback?code=fake-code&state=${target.searchParams.get('state')}`,{cookie:h.cookieHeader(start)}));
    assert.equal(done.status,303,returnTo);assert.equal(done.headers.get('location'),returnTo);
  }
});
