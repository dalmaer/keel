import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAuth} from '../lib/web/auth.mjs';
import {createStore} from '../lib/web/store.mjs';
import {createGitHub} from '../lib/web/github.mjs';
import {hash} from '../lib/web/common.mjs';
import {harness} from './helpers/web-http.mjs';
const authFor=(h,github=createGitHub(h.config,h.fetcher))=>createAuth(h.config,createStore(h.config,h.fetcher),github,()=>h.state.now);
const refFor=login=>hash(login.cookie.split('=')[1]);
test('initiating session resolution checks live identity and scope without extending idle lifetime',async()=>{
  const h=harness(),login=await h.login(),ref=refFor(login),row=h.state.records.get(`session:${ref}`),expires=row.expires;
  const resolved=await authFor(h).resolveInitiator(ref,1);
  assert.equal(resolved.access.userId,1);assert.equal(resolved.access.projects[0].repoId,102);assert.equal(resolved.token,'fake-user-access-token-for-tests');assert.equal(resolved.sessionRef,undefined);
  assert.equal(row.expires,expires);h.state.now+=1801000;
  await assert.rejects(authFor(h).resolveInitiator(ref,1),{code:'sign_in_required'});
});
test('expired, revoked, unknown, malformed or changed-scope initiating sessions cannot start worker activity',async()=>{
  for(const mode of ['absolute','revoked','scope','membership','actor']) {
    const h=harness(),login=await h.login(),ref=refFor(login),auth=authFor(h);
    if(mode==='absolute')h.state.now+=28801000;
    if(mode==='revoked')h.state.records.delete(`session:${ref}`);
    if(mode==='scope')h.state.repoAccess=false;
    if(mode==='membership')h.state.members=[];
    if(mode==='actor')h.state.userId=2;
    await assert.rejects(auth.resolveInitiator(ref,1),error=>[401,403,404].includes(error.status),mode);
  }
  const h=harness();for(const ref of ['','fake-token','a'.repeat(64),'../session'])await assert.rejects(authFor(h).resolveInitiator(ref,1));
});
test('session revocation during provider lookup wins before returning worker authority',async()=>{
  const h=harness(),login=await h.login(),ref=refFor(login),github=createGitHub(h.config,h.fetcher);
  const auth=authFor(h,{async access(...args){const result=await github.access(...args);h.state.records.delete(`session:${ref}`);return result;}});
  await assert.rejects(auth.resolveInitiator(ref,1),{code:'sign_in_required'});
});
test('a fresh owner session does not revive an expired initiating reference',async()=>{
  const h=harness(),old=await h.login(),oldRef=refFor(old);h.state.now+=1801000;
  const fresh=await h.login(),auth=authFor(h);
  await assert.rejects(auth.resolveInitiator(oldRef,1),{code:'sign_in_required'});
  assert.equal((await auth.resolveInitiator(refFor(fresh),1)).access.userId,1);
});

import {routineView,jobReceipt,jobPreviewView,schedulePreviewView,jobsView,routinePath,jobPath} from '../lib/web/job-views.mjs';
import {startJobClient,jobRequest} from '../lib/web/job-client.mjs';
import {routineCard} from '../lib/web/run-views.mjs';
import {returnPath} from '../lib/web/auth.mjs';
import {webConfig} from '../lib/web/config.mjs';
const project={id:'studio',repo:'acme/studio',repoId:102},id='a'.repeat(64),routineId='.github/workflows/typecheck.yml';
const access={csrf:'fake-csrf',workspace:{id:'acme',name:'Acme'},projects:[project]};
const routine={schema:1,project,routineId,source:{head:'b'.repeat(40)},worker:{adapter:'typecheck-v1',path:routineId,branch:'main',job:'web-worker',protocol:1,timeoutMinutes:15,weeklyMinutes:60,concurrency:1},budget:{workspaceWeeklyMinutes:90,projectWeeklyMinutes:60,reservedMinutes:15},capabilities:{start:true},gaps:[]};
const preview={...routine,kind:'start',previewId:id,requestId:id,digest:'c'.repeat(64),registryDigest:'d'.repeat(64),expiresAt:'2026-10-21T15:00:00Z',effects:['One bounded Acme dispatch.'],canApply:true,limitations:[],retryOf:null};
const receipt={id,projectId:project.id,routineId,state:'running',worker:{state:'running',deadline:1792594800000},provider:{runId:9001,attempt:1,state:'in_progress',conclusion:null,url:'https://github.com/acme/studio/actions/runs/9001'},budget:{reservedMinutes:15,observedMinutes:null,cost:null},capabilities:{cancel:true,reconcile:true,retry:false}};
test('routine review names exact source and conservative reservation while unsupported controls remain absent',()=>{
  const html=routineView(routine,access);assert.match(html,/data-preview-job/);assert.match(html,/15 min including setup/);assert.match(html,/Actual financial cost<\/dt><dd>Unknown/);assert.doesNotMatch(html,/data-schedule-form/);
  const disabled=routineView({...routine,capabilities:{},worker:null,gaps:[{reason:'Acme worker not activated.'}]},access);assert.doesNotMatch(disabled,/data-preview-job|data-schedule-form/);assert.match(disabled,/Acme worker not activated/);
  const reviewed=jobPreviewView(preview);assert.match(reviewed,/data-start-job disabled/);assert.match(reviewed,/data-approve-job/);assert.match(reviewed,/registry|Registry/);assert.match(reviewed,new RegExp(jobPath('studio',id)));assert.match(reviewed,/One bounded Acme dispatch/);
});
test('cancellation, worker loss and provider outcome stay separate from measured duration and acceptance',()=>{
  const html=jobReceipt({...receipt,cancelRequested:true,worker:{state:'lost'},retryOf:'e'.repeat(64)},project);
  assert.match(html,/Cancellation requested/);assert.match(html,/not yet confirmed/);assert.match(html,/does not prove the provider stopped/);assert.match(html,/Observed runtime<\/dt><dd>Unknown/);assert.match(html,/Actual financial cost<\/dt><dd>Unknown/);assert.match(html,/Preceding request/);assert.match(html,/activity\/actions\/9001\/attempts\/1/);assert.doesNotMatch(html,/data-retry-job|<h2>cancelled/);
});
test('schedule review preserves exact escaped bytes and independent budget; commit requires verified receipt',()=>{
  const schedule={...preview,kind:'schedule',schedule:{current:'0 9 * * 1',proposed:'0 10 * * 1',timezone:'UTC',timeoutMinutes:15,maxRunsPer7Days:1,weeklyMinutes:15,overlap:'constant group; cancel-in-progress:false',budgetMechanism:'scheduled frequency × source timeout'},files:[{path:routineId,before:'name: Acme\n# <before>\n',content:'name: Acme\n# <after>\n'}],commitMessage:'Change Acme cron'};
  const html=schedulePreviewView(schedule);assert.match(html,/0 9 \* \* 1/);assert.match(html,/0 10 \* \* 1/);assert.match(html,/&lt;before&gt;/);assert.match(html,/&lt;after&gt;/);assert.match(html,/does not put existing scheduled executions under web reservations/);assert.match(html,/data-start-job disabled/);
  assert.doesNotMatch(jobReceipt({kind:'schedule',id,state:'committed',receipt:null,capabilities:{}},project),/Schedule source commit verified/);
});
test('unstarted routine is reachable from the existing catalogue through an exact internal workflow path',()=>{
  const html=routineCard({id:routineId,path:routineId,name:'Acme typecheck',gaps:[]},project,'2026-10-21T12:00:00Z');assert.ok(html.includes(routinePath(project.id,routineId)));assert.match(html,/Review supported operations/);assert.match(html,/Inspect observed activity/);
  assert.doesNotMatch(routineCard({id:'../private',name:'<script>Acme</script>'},project,'now'),/Review supported operations|<script>Acme/);
});
test('job return paths accept exact routine and receipt identities but reject external and encoded traversal',()=>{
  for(const path of ['/jobs','/projects/studio/jobs',jobPath('studio',id),routinePath('studio',routineId),'/setup'])assert.equal(returnPath(path),true,path);
  for(const path of ['//evil.test/jobs','/jobs?after=private','/projects/studio/jobs/short','/projects/studio/routines/..%2Fprivate','/projects/studio/routines/.github%252Fworkflows%252Facme.yml',routinePath('studio',routineId)+'?secret=fake'])assert.equal(returnPath(path),false,path);
});
test('fleet continuation keeps per-project cursors scoped and calls missing reads incomplete',()=>{
  const html=jobsView({projects:[{project,items:[],after:'opaque-cursor',hasMore:true,gaps:[]}],nextProjectPage:2,gaps:[{reason:'Additional Acme projects unread.'}]},access);assert.match(html,/\/projects\/studio\/jobs\?after=opaque-cursor/);assert.match(html,/\/jobs\?projectPage=2/);assert.match(html,/Additional Acme projects unread/);assert.match(html,/not.*complete history|before treating this as complete history/);
});
function clientFixture(fetch,{operation=null}={}) {
  const focused=[];
  const heading={setAttribute(name,value){assert.equal(name,'tabindex');assert.equal(value,'-1');},focus(){focused.push('heading');},scrollIntoView(){focused.push('scroll');}};
  const output={innerHTML:'',querySelector:()=>heading},receiptHost=operation?{innerHTML:jobReceipt(operation,project),querySelector:()=>heading}:null,status={textContent:''},checked={checked:true},control={disabled:false};
  const root={innerHTML:'',querySelector(selector){return {'[data-job-model]':{value:JSON.stringify({...routine,...(operation?{operation}:{})})},'[data-job-receipt]':receiptHost,'[data-job-csrf]':{value:'fake-csrf'},'[data-job-output]':output,'[data-job-status]':status,'[data-approve-job]':checked,'[data-start-job]':control}[selector]||null;},querySelectorAll(){return [control];},addEventListener(){},removeEventListener(){}};
  const history={path:null,replaceState(_a,_b,path){this.path=path;}};
  const document={querySelector:()=>root};
  return {root,output,receiptHost,status,history,document,focused,client:startJobClient({document,window:{history},fetch})};
}
test('lost dispatch retains original bookmark and only explicit reconciliation can issue another request',async()=>{
  const calls=[];let fixture,resolve;
  fixture=clientFixture(async(url,options)=>{
    calls.push({url,body:JSON.parse(options.body)});
    if(url.endsWith('/preview'))return Response.json(preview);
    if(url.endsWith('/start')){assert.equal(fixture.history.path,jobPath(project.id,id));return new Promise(done=>{resolve=done;});}
    return Response.json(receipt);
  });
  await fixture.client.review();assert.match(fixture.output.innerHTML,/Review this exact run/);
  assert.equal(fixture.document.title,'Review operation · Keel');assert.deepEqual(fixture.focused,['heading','scroll']);
  const pending=fixture.client.start();assert.equal(fixture.document.title,'Original operation · Keel');assert.deepEqual(fixture.focused.slice(-2),['heading','scroll']);assert.equal(calls.length,2);await fixture.client.start();assert.equal(calls.length,2);
  resolve(Response.json({error:'request_unavailable'},{status:503}));await pending;assert.match(fixture.output.innerHTML,/uncertain/);
  await fixture.client.start();assert.equal(calls.length,2);await fixture.client.act('reconcile');assert.equal(calls.length,3);assert.ok(calls[2].url.endsWith(`/jobs/${id}/reconcile`));assert.deepEqual(Object.keys(calls[2].body),['csrf']);
});
test('starting a reviewed retry replaces preceding receipt controls before dispatch and keeps its link',async()=>{
  const nextId='f'.repeat(64),previous={...receipt,state:'terminal',capabilities:{retry:true,reconcile:true}},next={...receipt,id:nextId,retryOf:id};
  const calls=[];let fixture;
  const rendered=()=>fixture.receiptHost.innerHTML+fixture.output.innerHTML;
  fixture=clientFixture(async(url,options)=>{
    calls.push({url,body:JSON.parse(options.body)});
    if(url.endsWith('/retry-preview'))return Response.json({...preview,kind:'retry',requestId:nextId,retryOf:id});
    if(url.endsWith('/start')) {
      assert.equal(fixture.history.path,jobPath(project.id,nextId));
      assert.equal((rendered().match(/data-reconcile-job/g)||[]).length,1,'only the new pending receipt is actionable before dispatch');
      assert.match(rendered(),/Preceding request/);
      return Response.json(next);
    }
    return Response.json(next);
  },{operation:previous});
  await fixture.client.review(true);await fixture.client.start();
  assert.equal((rendered().match(/data-reconcile-job/g)||[]).length,1,'one active receipt remains after retry response');
  assert.equal((rendered().match(/data-cancel-job/g)||[]).length,1);
  assert.ok(rendered().includes(jobPath(project.id,id)),'original operation remains a preceding-request link');
  await fixture.client.act('reconcile');await fixture.client.act('cancel');
  assert.deepEqual(calls.map(c=>c.url),[
    `/api/projects/studio/jobs/${id}/retry-preview`,
    '/api/projects/studio/jobs/start',
    `/api/projects/studio/jobs/${nextId}/reconcile`,
    `/api/projects/studio/jobs/${nextId}/cancel`,
  ]);
  assert.equal((rendered().match(/data-reconcile-job/g)||[]).length,1);
});
test('job configuration is explicit and bounded with no activation by absent fields',()=>{
  const h=harness();assert.equal(webConfig(h.input,h.secrets).jobs,undefined);
  const jobs={enabled:false,verifiedAt:null,restoreReconciledAt:null,weeklyMinutes:90,scheduleWrites:false};assert.deepEqual(webConfig({...h.input,jobs},h.secrets).jobs,jobs);
  for(const delta of [{weeklyMinutes:0},{weeklyMinutes:10081},{weeklyMinutes:1.5},{verifiedAt:'yesterday'},{enabled:'yes'},{command:'echo fake'},{scheduleWrites:1}])assert.throws(()=>webConfig({...h.input,jobs:{...jobs,...delta}},h.secrets));
});

test('worker-only OIDC initialization does not disable an HTTP development sign-in surface',async()=>{
  const {createWebService}=await import('../lib/web/server.mjs');const h=harness(),config={...h.config,origin:'http://127.0.0.1:58404'},service=createWebService(config,{fetcher:h.fetcher,now:()=>h.state.now});
  const page=await service(new Request(config.origin+'/signin'));assert.equal(page.status,200);assert.match(await page.text(),/Continue with GitHub/);
  const worker=await service(new Request(config.origin+'/api/workers/claim',{method:'POST',headers:{authorization:'Bearer fake.unsigned.token','content-type':'application/json'},body:'{}'}));assert.equal(worker.status,401);
});
test('worker routes never accept an owner cookie or CSRF token as worker authority',async()=>{
  const h=harness(),login=await h.login(),before=h.state.requests.length;
  for(const action of ['claim','begin','heartbeat','complete']) {
    const response=await h.service(new Request(h.config.origin+`/api/workers/${action}`,{method:'POST',headers:{cookie:login.cookie,origin:h.config.origin,'content-type':'application/json'},body:JSON.stringify({csrf:login.session.csrf,operationId:id})}));
    assert.equal(response.status,401);assert.equal((await response.json()).error,'worker_identity_required');
  }
  assert.equal(h.state.requests.length,before,'no owner-session fallback or provider request');
});

test('client deadline bounds even a transport that never settles and retains an unavailable result',async()=>{
  let signal;
  const response=await jobRequest(async(_url,options)=>{signal=options.signal;return new Promise(()=>{});},'/api/projects/studio/jobs/start',{requestId:id},{timeoutMs:5});
  assert.equal(response.status,503);assert.equal(response.data.error,'request_unavailable');assert.equal(signal.aborted,true);
});

async function liveFixture(options) {const {jobsUIHarness}=await import('./helpers/web-jobs-ui.mjs');const h=await jobsUIHarness(options),login=await h.login();return {h,login};}
const submission=p=>({requestId:p.requestId,previewId:p.previewId,digest:p.digest});
test('actual authenticated preview and duplicate start produce one durable dispatch and a reloadable receipt',async()=>{
  const {h,login}=await liveFixture();const p=await h.previewRun(login);
  assert.equal(p.canApply,true);assert.equal(p.budget.reservedMinutes,15);assert.doesNotMatch(JSON.stringify(p),/sessionRef|fake-user-access/);
  for(let n=0;n<2;n++) {const response=await h.service(h.jsonRequest('/api/projects/studio/jobs/start',login,submission(p)));assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).id,p.requestId);}
  assert.equal(h.actions.dispatches.length,1);
  const page=await h.service(h.request(p.operationUrl,{cookie:login.cookie}));assert.equal(page.status,200);const html=await page.text();assert.match(html,/Waiting for worker/);assert.match(html,/Original provider run/);assert.doesNotMatch(html,/sessionRef|fake-user-access|"nonce"|"fence"/);
  const list=await h.service(h.request('/api/projects/studio/jobs',{cookie:login.cookie}));assert.equal(list.status,200);assert.equal((await list.json()).items.length,1);
});
test('actual lost dispatch reconciles exact original identity without another provider POST',async()=>{
  const {h,login}=await liveFixture();h.actions.lost=true;const p=await h.previewRun(login);
  let response=await h.service(h.jsonRequest('/api/projects/studio/jobs/start',login,submission(p)));assert.equal(response.status,200);assert.equal((await response.json()).state,'uncertain');
  response=await h.service(h.jsonRequest(`/api/projects/studio/jobs/${p.requestId}/reconcile`,login));assert.equal(response.status,200);assert.equal((await response.json()).provider.runId,9001);assert.equal(h.actions.dispatches.length,1);
  response=await h.service(h.jsonRequest(`/api/projects/studio/jobs/${p.requestId}/cancel`,login));assert.equal(response.status,200);const cancellation=await response.json();assert.equal(cancellation.cancelRequested,true);assert.notEqual(cancellation.state,'terminal');assert.equal(h.actions.cancellations.length,1);
  response=await h.service(h.jsonRequest(`/api/projects/studio/jobs/${p.requestId}/retry-preview`,login));assert.equal(response.status,409);
  Object.assign(h.actions.runs.get(9001),{status:'completed',conclusion:'cancelled'});
  response=await h.service(h.jsonRequest(`/api/projects/studio/jobs/${p.requestId}/reconcile`,login));assert.equal((await response.json()).state,'terminal');
  response=await h.service(h.jsonRequest(`/api/projects/studio/jobs/${p.requestId}/retry-preview`,login));assert.equal(response.status,200);const retry=await response.json();assert.equal(retry.retryOf,p.requestId);assert.notEqual(retry.requestId,p.requestId);assert.equal(h.actions.dispatches.length,1);
});
test('actual signed worker routes recover one lost claim, grant begin once and reject forged actor authority',async()=>{
  const {h,login}=await liveFixture(),p=await h.previewRun(login);await h.service(h.jsonRequest('/api/projects/studio/jobs/start',login,submission(p)));
  const input={operationId:p.requestId,nonce:'e'.repeat(64),jobName:'web-worker'};h.jobDb.lost='claim';
  let response=await h.service(h.workerRequest('claim',9001,input));assert.equal(response.status,503);const row=[...h.jobDb.rows.values()][0],fence=row.fence;
  response=await h.service(h.workerRequest('claim',9001,input));assert.equal(response.status,200,await response.clone().text());const claim=await response.json();assert.equal(claim.fence,fence);
  const begin={...input,fence:claim.fence,jobId:claim.jobId};response=await h.service(h.workerRequest('begin',9001,begin));assert.equal(response.status,200);assert.equal((await response.json()).granted,true);
  response=await h.service(h.workerRequest('begin',9001,begin));assert.equal(response.status,409);
  response=await h.service(h.workerRequest('heartbeat',9001,{...begin,sequence:1},{actor_id:'2'}));assert.equal(response.status,403);
  response=await h.service(h.workerRequest('heartbeat',9001,{...begin,sequence:1}));assert.equal(response.status,200);assert.equal((await response.json()).continue,true);
  response=await h.service(h.workerRequest('complete',9001,{...begin,sequence:2,result:{state:'succeeded',exitCode:0}}));assert.equal(response.status,200);
  const operation=await (await h.service(h.request('/api'+p.operationUrl,{cookie:login.cookie}))).json();assert.equal(operation.state,'worker-complete');assert.equal(operation.provider.state,'in_progress');assert.equal(operation.capabilities.retry,false);
});
test('actual job routes reject missing CSRF, foreign Origin, injected initiator and cross-project access',async()=>{
  const {h,login}=await liveFixture(),path=`/api/projects/studio/routines/${encodeURIComponent(h.routineId)}/preview`;
  for(const [data,headers,status] of [[{csrf:'wrong'},{},403],[{},{origin:'https://elsewhere.test'},403],[{sessionRef:'a'.repeat(64)},{},400]]) {const response=await h.service(h.jsonRequest(path,login,data,headers));assert.equal(response.status,status,await response.clone().text());}
  const response=await h.service(h.request('/api/projects/other/jobs',{cookie:login.cookie}));assert.equal(response.status,404);assert.equal(h.actions.dispatches.length,0);assert.equal(h.jobDb.previews.size,0);
});
test('actual buffered job reads recheck current Actions and Workflows grants before returning private output',async()=>{
  for(const permission of ['permission','workflowsPermission']) {
    let armed=false;const {h,login}=await liveFixture({afterRead(h){if(armed)h.actions[permission]='read';}});armed=true;
    const response=await h.service(h.request('/api/projects/studio/jobs',{cookie:login.cookie}));assert.equal(response.status,404,await response.clone().text());assert.doesNotMatch(await response.text(),/studio|Acme/);
  }
});
test('actual schedule-only source previews exact bytes and commits without dispatch, preserving unrelated content',async()=>{
  const {h,login}=await liveFixture({schedule:true}),path=`/api/projects/studio/routines/${encodeURIComponent(h.routineId)}`;
  let response=await h.service(h.request(path,{cookie:login.cookie}));assert.equal(response.status,200);const model=await response.json();assert.equal(model.capabilities.start,false);assert.equal(model.capabilities.schedule,true);
  response=await h.service(h.jsonRequest(path+'/schedule-preview',login,{cron:'24 7 * * *'}));assert.equal(response.status,200,await response.clone().text());const p=await response.json();assert.equal(p.files[0].before.replace('23 7 * * *','24 7 * * *'),p.files[0].content);
  response=await h.service(h.jsonRequest('/api/projects/studio/jobs/schedule-apply',login,submission(p)));assert.equal(response.status,200,await response.clone().text());const result=await response.json();assert.equal(result.state,'committed');assert.equal(h.actions.dispatches.length,0);
  response=await h.service(h.request(result.operationUrl,{cookie:login.cookie}));assert.match(await response.text(),/Schedule source commit verified/);
});
test('disabled activation keeps routine inspection available and source-neutral early receipt cannot imply work ran',async()=>{
  const {h,login}=await liveFixture({enabled:false});let response=await h.service(h.request(`/projects/studio/routines/${encodeURIComponent(h.routineId)}`,{cookie:login.cookie}));assert.equal(response.status,200);const html=await response.text();assert.doesNotMatch(html,/data-preview-job/);assert.match(html,/Job effects require explicit/);
  response=await h.service(h.request(`/projects/studio/jobs/${'1'.repeat(64)}`,{cookie:login.cookie}));assert.equal(response.status,200);assert.match(await response.text(),/No receipt is visible for this request yet/);assert.equal(h.actions.dispatches.length,0);
});
