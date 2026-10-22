import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {modelPolicyEditor,modelSelectionView,modelPreparationView,modelQuoteView,modelAttemptBody,modelStyles} from '../lib/web/model-views.mjs';
import {startModelClient} from '../lib/web/model-client.mjs';
import {returnPath} from '../lib/web/auth.mjs';
const id='a'.repeat(64),digest='b'.repeat(64),task='c'.repeat(64),project={id:'studio',repo:'acme/studio',repoId:102};
const preparation={id,digest,taskId:task,stage:1,project,source:{visibility:'private'},context:{state:'not-configured'},selection:{selected:{model:'acme-model',connectionId:'acme-api',capacityState:'unknown'},candidates:[{id:'preferred',eligible:true,reasons:[]}]},packet:{files:[{path:'docs/phases/01-acme.md',blob:'d'.repeat(40)}]},outbound:{provider:'openai',model:'acme-model',instructions:'Treat source as <data>',input:'Private Acme <script>source</script>',retention:'Temporary provider retention'},canCount:true};
const quote={id:digest,digest:id,taskId:task,stage:1,model:'acme-model',inputTokens:123,maxOutputTokens:456,ceilingMicroUsd:8000,canRun:true,expiresAt:'2026-10-23T00:00:00.000Z'};
test('structured policy retains unsupported requirements and has no invented model or allowance',()=>{
  const html=modelPolicyEditor({taskClass:'review',requirements:{independentReview:true,privacy:'no-provider-retention'},candidates:[]});
  assert.match(html,/value="review" selected/);assert.match(html,/name="independentReview" checked/);assert.doesNotMatch(html,/name="retention" checked/);assert.match(html,/Choose a supported model/);assert.match(html,/name="attemptMicroUsd"[^>]*value=""/);assert.doesNotMatch(html,/<textarea/);
});
test('eligibility distinguishes unknown capacity, ordered alternatives and unsupported review',()=>{
  const html=modelSelectionView({selected:null,candidates:[{id:'preferred',eligible:false,reasons:['model_capacity_unknown']},{id:'review',eligible:false,reasons:['model_independent_review_unavailable']}]});
  assert.match(html,/Waiting for an eligible model/);assert.match(html,/configured to wait/);assert.match(html,/Independent review is required/);assert.doesNotMatch(html,/%|progress/);
});
test('packet and quote have separate explicit data and spend approvals and escape source',()=>{
  const packet=modelPreparationView(preparation),review=modelQuoteView(quote,preparation);
  assert.match(packet,/data-model-quote disabled/);assert.match(packet,/Checking cost sends this exact text/);assert.match(packet,/Private Acme &lt;script&gt;source/);assert.doesNotMatch(packet,/<script>source/);assert.match(packet,/Provider capacity unknown/);
  assert.match(review,/data-model-run disabled/);assert.match(review,/\$0.008000 USD/);assert.match(review,/123/);assert.match(review,/456/);assert.match(review,/not an invoice/);
});
test('receipt separates usage from held allowance and offers continuation only as a new review',()=>{
  const html=modelAttemptBody({id,project,taskId:task,model:'acme-model',stage:1,state:'completed',output:'Acme <b>summary</b>',reservedMicroUsd:10000,usage:null,capabilities:{continue:true}});
  assert.match(html,/Evidence summary ready/);assert.match(html,/Acme &lt;b&gt;summary/);assert.match(html,/Calculated cost<\/dt><dd>Unavailable/);assert.match(html,/Review suggested next actions/);assert.doesNotMatch(html,/<select|data-model-run/);assert.match(modelStyles,/@media\(max-width:700px\)/);
});
function clientFixture(fetch,{checked=true,model={view:'tasks',project}}={}) {
  const controls={checked,disabled:false},host={innerHTML:'old source form'},status={textContent:''},output={innerHTML:''};
  const root={querySelector(selector){return {'[data-model-data]':{textContent:JSON.stringify(model)},'[data-model-csrf]':{value:'fake-csrf'},'[data-model-current]':host,'[data-model-status]':status,'[data-model-output]':output,'[data-approve-count]':controls,'[data-approve-run]':controls,'[data-model-quote]':controls}[selector]||null;},querySelectorAll(){return [controls];},addEventListener(){},removeEventListener(){}};
  const history={path:null,replaceState(a,b,path){this.path=path;}};
  const document={querySelector:()=>root};
  return {host,status,controls,history,document,client:startModelClient({document,window:{history,crypto:webcrypto},fetch})};
}
test('render and unapproved count never transmit data; approved quote is a separate request',async()=>{
  const calls=[],f=clientFixture(async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return Response.json(url.endsWith('/prepare')?preparation:quote);},{checked:false});
  assert.equal(calls.length,0);await f.client.prepare({phase:'docs/phases/01-acme.md',paths:[],instructions:'Acme',taskId:null});await f.client.checkCost();assert.equal(calls.length,1);
  f.controls.checked=true;await f.client.checkCost();assert.equal(calls.length,2);assert.equal(calls[1].body.digest,digest);assert.match(f.host.innerHTML,/Run this stage/);assert.equal(f.document.title,'Review cost and run · Plates');
});
test('lost run response keeps original URL before dispatch and cannot duplicate or retain old controls',async()=>{
  let f;const calls=[];f=clientFixture(async(url,options)=>{calls.push({url,body:options.body?JSON.parse(options.body):null});if(url.endsWith('/prepare'))return Response.json(preparation);if(url.endsWith('/quote'))return Response.json(quote);if(url.endsWith('/run')){assert.match(f.history.path,/^\/projects\/studio\/model-tasks\/[a-f0-9]{64}$/);throw Error('Acme lost response');}return Response.json({error:'operation_not_found'},{status:404});});
  await f.client.prepare({taskId:null});await f.client.checkCost();await f.client.run();await f.client.run();assert.equal(calls.length,3);
  assert.doesNotMatch(f.host.innerHTML,/data-model-run|old source form/);assert.match(f.host.innerHTML,/No receipt is visible/);
  await f.client.act('reconcile');assert.equal(calls.length,4);assert.equal(calls[3].body,null);assert.match(f.status.textContent,/may still be in flight/);
});
test('checkpoint preparation sends only original task identity and cancellation targets one attempt',async()=>{
  const calls=[],model={view:'attempt',id,project,taskId:task,state:'completed',stage:1,capabilities:{continue:true,cancel:true}};
  const f=clientFixture(async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return Response.json(url.endsWith('/prepare')?{...preparation,stage:2}:model);},{model});
  await f.client.act('cancel');assert.equal(calls[0].url,`/api/projects/studio/model-tasks/${id}/cancel`);assert.match(f.status.textContent,/terminal confirmation/);
  await f.client.act('continue');assert.deepEqual(calls[1].body,{csrf:'fake-csrf',taskId:task});assert.match(f.host.innerHTML,/Stage one stays complete/);
});
test('session expiry points to sign-in with only the original safe receipt path',async()=>{
  const f=clientFixture(async()=>Response.json({error:'sign_in_required'},{status:401}),{model:{view:'attempt',id,project,state:'uncertain',capabilities:{reconcile:true}}});
  await f.client.act('reconcile');assert.ok(f.host.innerHTML.includes('/signin?returnTo='+encodeURIComponent(`/projects/studio/model-tasks/${id}`)));assert.doesNotMatch(f.host.innerHTML,/fake-csrf/);
});
test('return paths admit only exact model policy and original task routes',()=>{
  for(const path of ['/model-policy','/model-policy/operations/'+id,'/projects/studio/model-policy','/projects/studio/model-tasks','/projects/studio/model-tasks/'+id])assert.equal(returnPath(path),true,path);
  for(const path of ['//outside.test/model-policy','/model-policy?token=secret','/projects/studio/model-tasks/../private','/projects/studio/model-tasks/'+id+'?retry=1'])assert.equal(returnPath(path),false,path);
});

test('sign-in preserves a validated receipt return path and rejects redirect/query abuse',async()=>{
  const {harness}=await import('./helpers/web-http.mjs'),h=harness();
  const path=`/projects/studio/model-tasks/${id}`;
  const page=await h.service(h.request('/signin?returnTo='+encodeURIComponent(path)));
  assert.equal(page.status,200);assert.match(await page.text(),new RegExp(`name="returnTo" value="${path}"`));
  for(const bad of ['https://outside.test/model-policy','//outside.test/model-policy','/projects/studio/model-tasks?packet=private','/model-policy#private']) {
    const response=await h.service(h.request('/signin?returnTo='+encodeURIComponent(bad)));assert.equal(response.status,400,bad);
  }
  assert.equal((await h.service(h.request('/signin?returnTo=%2F&returnTo=%2Fmodel-policy'))).status,400);
  assert.equal((await h.service(h.request('/signin?returnTo=%2F&packet=private'))).status,400);
  const begin=await h.begin(path);assert.equal(begin.started.status,303);
  const callback=await h.service(h.request(begin.path,{cookie:begin.cookie}));assert.equal(callback.headers.get('location'),path);
});
test('model browser assets use real routes and contain no external font or script dependencies',async()=>{
  const {harness}=await import('./helpers/web-http.mjs'),h=harness();
  for(const path of ['/assets/model-client.mjs','/assets/model-views.mjs','/assets/model.css']) {
    const response=await h.service(h.request(path));assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
    const body=await response.text();assert.doesNotMatch(body,/https:\/\/(?:fonts|cdn)|localStorage|sessionStorage/);
  }
});

async function actual() {const {modelUIHarness}=await import('./helpers/web-model-routing-ui.mjs');const h=await modelUIHarness();return {h,login:await h.login()};}
async function responseJson(h,request,status=200) {const response=await h.service(request);assert.equal(response.status,status,await response.clone().text());return response.json();}
async function approved(h,login) {
  const {sourceInput}=await import('./helpers/web-model-tasks.mjs');
  const p=await responseJson(h,h.post('/api/projects/studio/model-tasks/prepare',login,sourceInput()));
  const q=await responseJson(h,h.post('/api/projects/studio/model-tasks/quote',login,{previewId:p.id,digest:p.digest}));
  return {p,q};
}
test('actual authenticated policy and packet routes expose catalogue, exact text and no implicit provider call',async()=>{
  const {h,login}=await actual();
  const policy=await responseJson(h,h.request('/api/projects/studio/model-policy',{cookie:login.cookie}));assert.equal(policy.inherited,true);assert.equal(policy.connections[0].id,'acme-openai');
  const catalogue=await responseJson(h,h.request('/api/projects/studio/model-tasks',{cookie:login.cookie}));assert.equal(catalogue.phases[0].id,'1');assert.ok(catalogue.files.some(f=>f.path==='docs/evidence/acme.md'));
  const page=await h.service(h.request('/projects/studio/model-tasks?phase=docs%2Fphases%2F1-acme.md',{cookie:login.cookie}));assert.equal(page.status,200);assert.match(await page.text(),/value="1" data-phase-path="docs\/phases\/1-acme.md" selected/);assert.equal(h.model.calls.length,0);
  await responseJson(h,h.post('/api/projects/studio/model-tasks/prepare',login,{},{origin:'https://outside.test'}),403);
  await responseJson(h,h.post('/api/projects/studio/model-tasks/prepare',login,{csrf:'invalid'}),403);
  await responseJson(h,h.request('/api/projects/forbidden/model-tasks',{cookie:login.cookie}),404);
  await responseJson(h,h.request('/api/projects/studio/model-tasks?packet=private',{cookie:login.cookie}),400);
  const {p,q}=await approved(h,login);assert.equal(p.selection.selected.capacity,'unknown');assert.match(modelPreparationView(p),/Provider capacity unknown/);assert.equal(h.model.calls.length,1);assert.match(h.model.calls[0].url,/input_tokens$/);assert.equal(q.inputTokens,1000);
});
test('actual disabled and unknown-capacity policies cannot count and unavailable receipt is source-neutral',async()=>{
  const {h,login}=await actual(),{sourceInput,routingPolicy}=await import('./helpers/web-model-tasks.mjs');
  h.config.modelRouting.enabled=false;
  const p=await responseJson(h,h.post('/api/projects/studio/model-tasks/prepare',login,sourceInput()));assert.equal(p.canCount,false);assert.match(modelPreparationView(p),/disabled pending activation/);assert.equal(h.model.calls.length,0);
  h.config.modelRouting.enabled=true;const policy=routingPolicy();policy.candidates[0].unknownCapacity='wait';h.workspace.files['routing/workspace.json']=JSON.stringify(policy,null,2)+'\n';
  const wait=await responseJson(h,h.post('/api/projects/studio/model-tasks/prepare',login,sourceInput()));assert.equal(wait.canCount,false);assert.match(modelPreparationView(wait),/configured to wait/);
  const page=await h.service(h.request(`/projects/studio/model-tasks/${id}`,{cookie:login.cookie}));assert.equal(page.status,200);assert.match(await page.text(),/No receipt is visible for this request yet/);
  const absent=await responseJson(h,h.request(`/api/projects/studio/model-tasks/${id}`,{cookie:login.cookie}),404);assert.equal(absent.error,'model_attempt_not_found');
});
test('actual quote/run/reconcile/checkpoint routes pin one attempt and saved summary across devices',async()=>{
  const {h,login}=await actual(),{q}=await approved(h,login);
  const body={quoteId:q.id,digest:q.digest,requestId:id};
  const first=await responseJson(h,h.post('/api/projects/studio/model-tasks/run',login,body));assert.equal(first.state,'queued');
  await responseJson(h,h.post('/api/projects/studio/model-tasks/run',login,body));assert.equal(h.model.calls.filter(c=>c.url.endsWith('/v1/responses')).length,1);
  const count=h.model.calls.length;await responseJson(h,h.request(`/api/projects/studio/model-tasks/${id}`,{cookie:login.cookie}));assert.equal(h.model.calls.length,count,'receipt GET is read only');
  h.model.status='completed';h.model.text='Acme summary <script>never execute</script>';
  const completed=await responseJson(h,h.post(`/api/projects/studio/model-tasks/${id}/reconcile`,login));assert.equal(completed.capabilities.continue,true);assert.match(modelAttemptBody(completed),/&lt;script&gt;never execute/);
  const next=await responseJson(h,h.post('/api/projects/studio/model-tasks/prepare',login,{taskId:first.taskId}));assert.equal(next.stage,2);assert.ok(next.outbound.input.includes(h.model.text));assert.equal(next.taskId,first.taskId);
  const secondLogin=await h.login();const reread=await responseJson(h,h.request(`/api/projects/studio/model-tasks/${id}`,{cookie:secondLogin.cookie}));assert.equal(reread.output,h.model.text);assert.equal(h.model.calls.filter(c=>c.url.endsWith('/v1/responses')).length,1);
});
test('actual lost provider response retains one request and cancellation never creates another',async()=>{
  const {h,login}=await actual(),{q}=await approved(h,login);h.model.lost=true;
  const first=await responseJson(h,h.post('/api/projects/studio/model-tasks/run',login,{quoteId:q.id,digest:q.digest,requestId:id}));assert.equal(first.state,'uncertain');assert.equal(first.usage,null);assert.equal(first.capabilities.reconcile,false);
  await responseJson(h,h.post(`/api/projects/studio/model-tasks/${id}/reconcile`,login));assert.equal(h.model.calls.filter(c=>c.url.endsWith('/v1/responses')).length,1);
  const other=await actual(),approval=await approved(other.h,other.login);
  await responseJson(other.h,other.h.post('/api/projects/studio/model-tasks/run',other.login,{quoteId:approval.q.id,digest:approval.q.digest,requestId:id}));
  const cancelled=await responseJson(other.h,other.h.post(`/api/projects/studio/model-tasks/${id}/cancel`,other.login));assert.equal(cancelled.state,'cancelled');assert.equal(other.h.model.calls.filter(c=>c.url.endsWith('/v1/responses')).length,1);
});
test('actual buffered reads deny changed owner or project grants before returning content',async()=>{
  const {modelUIHarness}=await import('./helpers/web-model-routing-ui.mjs');let armed=false;
  const h=await modelUIHarness({afterRead(h,url){if(armed&&new URL(url).pathname.includes('/git/trees/')){h.state.repoAccess=false;armed=false;}}}),login=await h.login();
  armed=true;const response=await h.service(h.request('/projects/studio/model-policy',{cookie:login.cookie}));assert.equal(response.status,401,'changing the authorized project set invalidates the bound session');assert.doesNotMatch(await response.text(),/acme-model-2026/);
});
test('expired model evidence leaves configuration and Home readable while selection explains wait',async()=>{
  const {webConfig}=await import('../lib/web/config.mjs'),{harness}=await import('./helpers/web-http.mjs'),{modelEvidence,sourceInput}=await import('./helpers/web-model-tasks.mjs');
  const h=harness(),at=Date.now(),evidence={...modelEvidence(),observedAt:new Date(at-7200000).toISOString(),expiresAt:new Date(at-3600000).toISOString()};
  const config=webConfig({...h.input,modelRouting:{enabled:false,verifiedAt:null,restoreReconciledAt:null,models:[evidence]}},h.secrets);
  assert.equal(config.modelRouting.models[0].expiresAt,evidence.expiresAt);
  assert.throws(()=>webConfig({...h.input,modelRouting:{enabled:false,verifiedAt:null,restoreReconciledAt:null,models:[{...evidence,background:false}]}},h.secrets));
  assert.throws(()=>webConfig({...h.input,modelRouting:{enabled:true,verifiedAt:null,restoreReconciledAt:null,models:[evidence]}},h.secrets));
  const fixture=await actual();fixture.h.config.modelRouting.models[0]=evidence;
  const page=await fixture.h.service(fixture.h.request('/',{cookie:fixture.login.cookie}));assert.equal(page.status,200);
  const p=await responseJson(fixture.h,fixture.h.post('/api/projects/studio/model-tasks/prepare',fixture.login,sourceInput()));assert.equal(p.canCount,false);assert.match(modelPreparationView(p),/capability and price evidence is unavailable/);assert.equal(fixture.h.model.calls.length,0);
});
test('permission changed during buffered policy read is denied before returning source content',async()=>{
  const {modelUIHarness}=await import('./helpers/web-model-routing-ui.mjs');let armed=false;
  const h=await modelUIHarness({afterRead(h,url){if(armed&&new URL(url).pathname.includes('/git/trees/')){h.state.contentsPermission='read';armed=false;}}}),login=await h.login();
  armed=true;const response=await h.service(h.request('/model-policy',{cookie:login.cookie}));assert.equal(response.status,404);assert.doesNotMatch(await response.text(),/acme-model-2026/);
});
test('private policy preview and apply use original operation receipt and reject widened project grants',async()=>{
  const {h,login}=await actual(),{routingPolicy}=await import('./helpers/web-model-tasks.mjs');
  const overview=await responseJson(h,h.request('/api/model-policy',{cookie:login.cookie})),policy=routingPolicy();policy.limits.maxOutputTokens=900;
  const p=await responseJson(h,h.post('/api/model-policy/preview',login,{projectId:null,policy,expectedPolicyDigest:overview.expectedPolicyDigest}));assert.equal(p.canApply,true);assert.match(p.files[0].content,/900/);assert.ok(p.operationUrl.endsWith(p.operationId));
  const saved=await responseJson(h,h.post('/api/model-policy/apply',login,{previewId:p.id,digest:p.digest}));assert.equal(saved.state,'committed');
  const receipt=await responseJson(h,h.request('/api/model-policy/operations/'+p.operationId,{cookie:login.cookie}));assert.equal(receipt.receipt.commit,saved.receipt.commit);
  const projectPolicy=await responseJson(h,h.request('/api/projects/studio/model-policy',{cookie:login.cookie}));
  await responseJson(h,h.post('/api/model-policy/preview',login,{projectId:'studio',policy:{...policy,projectId:'studio',repoId:102,limits:{...policy.limits,maxOutputTokens:1000}},expectedPolicyDigest:projectPolicy.expectedPolicyDigest}),409);
  assert.equal(h.model.calls.length,0);
});
test('editing source selection within the page retains draft text and explicit selected paths',async()=>{
  const {modelTaskForm}=await import('../lib/web/model-views.mjs');
  const html=modelTaskForm({phases:[{id:'1',path:'docs/phases/1-acme.md',title:'Acme'}],files:[{path:'docs/evidence/acme.md'}]}, {phase:'1',paths:['docs/phases/1-acme.md','docs/evidence/acme.md'],instructions:'Acme <retained> instruction'});
  assert.match(html,/value="1"[^>]*selected/);assert.match(html,/value="docs\/evidence\/acme.md" checked/);assert.match(html,/Acme &lt;retained&gt; instruction/);assert.doesNotMatch(html,/localStorage|sessionStorage/);
});
test('receipt shows a saved summary only for completed nonempty output',()=>{
  const receipt={id,project,stage:1,capabilities:{}};
  for(const [state,output] of [['queued',''],['in_progress','Partial Acme text'],['completed',''],['completed','   ']]) {
    const html=modelAttemptBody({...receipt,state,output});
    assert.doesNotMatch(html,/Saved evidence summary|Evidence summary ready|class="model-output"/,`${state} must not present a retained summary`);
  }
  const complete=modelAttemptBody({...receipt,state:'completed',output:'Retained Acme summary.'});
  assert.match(complete,/Saved evidence summary/);assert.match(complete,/Retained Acme summary\./);
});
