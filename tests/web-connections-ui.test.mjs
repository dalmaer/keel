import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectionsView,connectionPolicyPreview,connectionCredentialResult,capacityView,credentialRecoveryPath,connectionRecoveryView} from '../lib/web/connection-views.mjs';
import {startConnectionsClient} from '../lib/web/connection-client.mjs';
import {returnPath} from '../lib/web/auth.mjs';
const digest='a'.repeat(64),project={id:'studio',repoId:102,repo:'acme/studio'};
const access={workspace:{id:'acme',name:'Acme workspace'},projects:[project],csrf:'fake-csrf'};
const connection={id:'acme-api',label:'Acme API',provider:'openai',projects:[project],enabled:true,policyDigest:digest,scope:{organization:null,project:null,workspace:null},credential:{version:0,state:'absent',binding:'absent',health:null},capabilities:{set:true,rotate:true,remove:false}};
const model={schema:1,workspace:access.workspace,source:{head:'b'.repeat(40)},connection,authorizedProjects:[project],capabilities:{policyWrite:true},gaps:[]};
test('default and unavailable credential states remain explicit without a key form or invented capacity',()=>{
  for(const credential of [{version:0,state:'absent',binding:'absent'},{version:null,state:'unavailable',binding:'unavailable'}]) {
    const html=connectionsView({...model,connection:{...connection,credential,capabilities:{}}},access);
    assert.match(html,/Credential setup is disabled/);assert.match(html,/Capacity has not been observed/);assert.doesNotMatch(html,/data-key|100%|API key<input/);
  }
  const malicious=connectionsView({...model,connection:{...connection,credential:{version:null,state:'unavailable'},capabilities:{set:true,remove:true}}},access);
  assert.doesNotMatch(malicious,/data-key|data-remove-credential/);
});
test('project lens cannot edit shared policy or credentials; untrusted names remain text',()=>{
  const html=connectionsView({...model,connection:{...connection,label:'<script>Acme</script>'}},access,project);
  assert.match(html,/Project view is read-only/);assert.match(html,/&lt;script&gt;Acme/);assert.doesNotMatch(html,/data-policy-form|data-key|data-remove-credential|<script>Acme/);
});
test('policy review uses exact before/after files and explicit canApply; secret references are policy not keys',()=>{
  const html=connectionPolicyPreview({previewId:digest,operationId:digest,canApply:true,files:[{path:'connections/acme.json',before:'{"enabled":false}',content:'{"enabled":true,"secretRef":"opaque"}'}],digest,commitMessage:'Configure Acme',limitations:[]});
  assert.match(html,/&quot;enabled&quot;:false/);assert.match(html,/&quot;enabled&quot;:true/);assert.match(html,/data-approve-policy/);assert.match(html,/data-apply-policy disabled/);assert.match(html,/connections\/operations/);
  assert.doesNotMatch(connectionPolicyPreview({files:[],canApply:false,limitations:['Current write access unavailable']}),/data-apply-policy/);
});
test('capacity shows actual pool identity, provenance and separate units without adding endpoint or subscription limits',()=>{
  const html=capacityView({provider:'openai',observedAt:'2026-10-21T10:00:00Z',models:[{id:'acme-model'}],capacity:{pools:[{provider:'openai',pool:{id:'acme-pool',provenance:'provider-response'},identity:{provenance:'provider-response'},models:{ids:['acme-model'],provenance:'provider-response'},source:{kind:'api',id:'acme-source'},kind:'api-rate',unit:'tokens',measurement:{remaining:null,used:null,limit:null},window:{resetAt:'2026-10-21T11:00:00Z'},state:'conflict',eligible:false}],gaps:[{code:'subscription_reporter_unavailable'}]},endpointLimits:[{scope:'GET /v1/models',metric:'requests',unit:'requests',remaining:3,limit:5,eligible:false}]});
  for(const text of ['acme-pool','acme-source','acme-model','provider-response','conflict','GET /v1/models','historical evidence','not a current health','Not eligible inference capacity','11:00:00Z'])assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/\[object Object\]|100%|total allowance/);assert.match(html,/Remaining<\/dt><dd>Unknown/);
});
function clientFixture(fetch) {
  const output={innerHTML:''},status={textContent:''},key={value:'fake-acme-provider-key-for-ui',disabled:false},controls=[key],events={};
  const root={innerHTML:'',querySelector(selector){return {'[data-connections-model]':{value:JSON.stringify(model)},'[data-connections-csrf]':{value:'fake-csrf'},'[data-connections-output]':output,'[data-connections-status]':status,'[data-key]':key}[selector]||null;},querySelectorAll(){return controls;},addEventListener(name,callback){events[name]=callback;},removeEventListener(){}};
  const history={value:null,replaceState(_state,_title,value){this.value=value;}};
  const crypto={getRandomValues(bytes){bytes.fill(7);return bytes;}};
  const client=startConnectionsClient({document:{querySelector:()=>root},window:{crypto,history},fetch});
  return {client,root,output,status,key,history,events};
}
test('credential input clears and original identity is bookmarkable before dispatch; uncertain recovery never resends key',async()=>{
  let fixture,resolve,requests=[];
  fixture=clientFixture(async(url,options)=>{
    requests.push({url,body:JSON.parse(options.body)});
    assert.equal(fixture.key.value,'');assert.match(fixture.history.value,/\/requests\//);
    if(requests.length===1)return new Promise(done=>{resolve=done;});
    return Response.json({...fixture.client.getIntent(),state:'confirmed',credential:{version:1,state:'present'}});
  });
  const pending=fixture.client.mutateCredential('set',{preventDefault(){}});
  assert.equal(requests.length,1);assert.equal(requests[0].body.key,'fake-acme-provider-key-for-ui');assert.equal(fixture.key.disabled,true);
  await fixture.client.mutateCredential('set');assert.equal(requests.length,1);
  resolve(Response.json({error:'unavailable'},{status:503}));await pending;
  assert.match(fixture.output.innerHTML,/Credential operation uncertain/);assert.match(fixture.output.innerHTML,/data-reconcile-credential/);
  await fixture.client.reconcileCredential();assert.equal(requests.length,2);assert.ok(requests[1].url.endsWith('/reconcile'));assert.equal(requests[1].body.key,undefined);assert.equal(requests[1].body.requestId,requests[0].body.requestId);assert.equal(requests[1].body.expectedVersion,0);assert.match(fixture.output.innerHTML,/operation confirmed/);
});
test('credential denial clears private rendered state after the key has already been cleared',async()=>{
  const f=clientFixture(async()=>Response.json({error:'access_denied'},{status:403}));await f.client.mutateCredential('set');assert.equal(f.key.value,'');assert.match(f.root.innerHTML,/private connection view has been cleared/);
});
test('recovery return paths admit exact nonsecret intent identities and reject query, external and unsafe versions',()=>{
  const intent={requestId:'c'.repeat(64),expectedVersion:0,policyDigest:digest,action:'set'},path=credentialRecoveryPath(connection.id,intent);
  for(const value of ['/connections','/connections/acme-api','/projects/studio/connections','/projects/studio/connections/acme-api',`/connections/operations/${digest}`,path])assert.equal(returnPath(value),true,value);
  for(const value of [path+'?key=fake',path.replace('/0/','/9007199254740992/'),'//acme.test/connections','https://acme.test/connections','/connections/acme-api?next=//acme.test',path.replace('/set','/rotate')])assert.equal(returnPath(value),false,value);
  const html=connectionRecoveryView({...model,recovery:intent},access);assert.match(html,/Opening this page reads current authorized policy metadata only/);assert.match(html,/data-reconcile-credential/);assert.doesNotMatch(html,/data-key|data-policy-form/);
});
test('uncertain and superseded results never claim successful credential storage',()=>{
  assert.doesNotMatch(connectionCredentialResult({state:'uncertain'}),/<h2>Credential operation confirmed/);assert.match(connectionCredentialResult({state:'superseded'}),/newer credential operation exists/);
});

test('actual routes commit exact policy then set and recover only the original credential request',async()=>{
  const {connectionsUIHarness,policyInput,fakeKey}=await import('./helpers/web-connections-ui.mjs');
  const h=connectionsUIHarness(),login=await h.login();
  const post=(path,data)=>h.service(h.jsonRequest(path,login,data));
  let response=await post('/api/connections/policy/preview',policyInput);assert.equal(response.status,200,await response.clone().text());const preview=await response.json();assert.equal(preview.canApply,true);
  response=await post('/api/connections/policy/apply',{previewId:preview.previewId,digest:preview.digest});assert.equal(response.status,200,await response.clone().text());const operation=await response.json();assert.equal(operation.state,'committed');assert.equal(h.workspace.writes.length,1);
  response=await h.service(h.request(preview.operationUrl,{cookie:login.cookie}));assert.equal(response.status,200,await response.clone().text());assert.match(await response.text(),/Private policy commit verified/);
  response=await h.service(h.request('/api/connections/acme-openai',{cookie:login.cookie}));const view=(await response.json()).connection;assert.equal(response.status,200);
  const intent={requestId:'d'.repeat(64),expectedVersion:0,policyDigest:view.policyDigest};h.vault.lost=true;
  response=await post('/api/connections/acme-openai/set',{...intent,key:fakeKey});assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).state,'confirmed','the service confirms its CAS by metadata read after a lost SQL response');
  const putCount=h.vault.requests.filter(r=>r.p_operation==='put').length,providerCount=h.provider.calls.length;
  const path=credentialRecoveryPath('acme-openai',{...intent,action:'set'});
  response=await h.service(h.request(path,{cookie:login.cookie}));assert.equal(response.status,200,await response.clone().text());assert.doesNotMatch(await response.text(),new RegExp(fakeKey));
  response=await post('/api/connections/acme-openai/reconcile',{...intent,action:'set'});assert.equal(response.status,200);assert.equal((await response.json()).state,'confirmed');assert.equal(h.provider.calls.length,providerCount);assert.equal(h.vault.requests.filter(r=>r.p_operation==='put').length,putCount);
});
test('actual connection routes preserve Origin, CSRF, project read-only and unknown project boundaries',async()=>{
  const {connectionsUIHarness,fakeKey}=await import('./helpers/web-connections-ui.mjs');const h=connectionsUIHarness(),view=await h.seedPolicy(),login=await h.login();
  const input={requestId:'e'.repeat(64),expectedVersion:0,policyDigest:view.policyDigest,key:fakeKey};
  for(const [path,data,origin,status] of [['/api/connections/acme-openai/set',input,'https://other.test',403],['/api/connections/acme-openai/set',{...input,csrf:'wrong'},h.config.origin,403],['/api/projects/studio/connections/acme-openai/set',input,h.config.origin,404]]) {
    const response=await h.service(h.jsonRequest(path,login,data,{origin}));assert.equal(response.status,status,await response.clone().text());
  }
  assert.equal(h.provider.calls.length,0);assert.equal(h.vault.rows.size,0);
  let response=await h.service(h.request('/projects/studio/connections/acme-openai',{cookie:login.cookie}));assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/data-key|data-policy-form/);
  response=await h.service(h.request('/api/projects/missing/connections',{cookie:login.cookie}));assert.equal(response.status,404);
  response=await h.service(h.request('/connections/acme-openai?key=fake',{cookie:login.cookie}));assert.equal(response.status,400);
});
test('actual metadata read followed by Contents grant removal refuses HTML, JSON and recovery disclosure',async()=>{
  const {connectionsUIHarness}=await import('./helpers/web-connections-ui.mjs');
  for(const kind of ['html','json','recovery']) {
    let armed=false;
    const h=connectionsUIHarness({afterMetadata(h){if(armed)h.state.contentsPermission='read';}}),view=await h.seedPolicy(),login=await h.login();armed=true;
    const path=kind==='html'?'/connections/acme-openai':kind==='json'?'/api/connections/acme-openai':credentialRecoveryPath('acme-openai',{requestId:digest,expectedVersion:0,policyDigest:view.policyDigest,action:'set'});
    const response=await h.service(h.request(path,{cookie:login.cookie}));assert.equal(response.status,404,`${kind}: ${await response.clone().text()}`);assert.doesNotMatch(await response.text(),/Acme API|data-connections-model/);
  }
});
test('actual default disabled and unavailable storage routes expose coverage without key controls',async()=>{
  const {connectionsUIHarness}=await import('./helpers/web-connections-ui.mjs');
  for(const mode of ['disabled','unavailable']) {
    const h=connectionsUIHarness({enabled:mode!=='disabled'});await h.seedPolicy();const login=await h.login();if(mode==='unavailable')h.vault.unavailable=true;
    const response=await h.service(h.request('/connections/acme-openai',{cookie:login.cookie}));assert.equal(response.status,200,await response.clone().text());const html=await response.text();assert.match(html,/Credential setup is disabled/);assert.doesNotMatch(html,/data-key|data-remove-credential/);
  }
});
test('connection browser modules and stylesheet are served through the actual asset routes',async()=>{
  const {connectionsUIHarness}=await import('./helpers/web-connections-ui.mjs');const h=connectionsUIHarness();
  for(const path of ['/assets/connection-client.mjs','/assets/connection-views.mjs','/assets/connection.css']) {const response=await h.service(h.request(path));assert.equal(response.status,200);assert.ok((await response.text()).length>100);}
});

test('definitive provider validation refusal says key not stored and offers a fresh view without endless reconciliation',async()=>{
  for(const error of ['provider_denied','provider_scope','provider_input']) {
    const f=clientFixture(async()=>Response.json({error},{status:error==='provider_input'?400:503}));await f.client.mutateCredential('set');
    assert.match(f.output.innerHTML,/Credential request refused/);assert.match(f.output.innerHTML,/This key was not stored/);assert.match(f.output.innerHTML,/Reload connections/);assert.doesNotMatch(f.output.innerHTML,/data-reconcile-credential/);assert.equal(f.key.value,'');
  }
});
test('actual authorization revoked during provider validation prevents any credential write',async()=>{
  const {connectionsUIHarness,fakeKey}=await import('./helpers/web-connections-ui.mjs');const h=connectionsUIHarness(),view=await h.seedPolicy(),login=await h.login();
  h.provider.beforeResponse=async()=>{h.state.members=[];};
  const response=await h.service(h.jsonRequest('/api/connections/acme-openai/set',login,{requestId:'f'.repeat(64),expectedVersion:0,policyDigest:view.policyDigest,key:fakeKey}));
  assert.ok([401,403,404].includes(response.status));assert.equal(h.vault.rows.size,0);assert.doesNotMatch(await response.text(),new RegExp(fakeKey));
});

test('pre-reservation policy bookmark is source-neutral while API lookup and revoked access stay denied',async()=>{
  const {connectionsUIHarness}=await import('./helpers/web-connections-ui.mjs');const h=connectionsUIHarness(),login=await h.login();
  const path=`/connections/operations/${'1'.repeat(64)}`;
  let response=await h.service(h.request(path,{cookie:login.cookie}));assert.equal(response.status,200);const html=await response.text();assert.match(html,/No receipt is visible for this request yet/);assert.doesNotMatch(html,/Private policy commit verified|state&quot;:&quot;uncertain/);
  response=await h.service(h.request('/api'+path,{cookie:login.cookie}));assert.equal(response.status,404);assert.equal((await response.json()).error,'operation_not_found');
  h.state.members=[];response=await h.service(h.request(path,{cookie:login.cookie}));assert.ok([401,403,404].includes(response.status));assert.doesNotMatch(await response.text(),/No receipt is visible for this request yet/);
});
