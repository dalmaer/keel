import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {versionsView,publicationPreviewView,preparationPreviewView,updateReceipt,rolloutView,lessonTraceView} from '../lib/web/fleet-views.mjs';
import {startFleetClient} from '../lib/web/fleet-client.mjs';
import {returnPath} from '../lib/web/auth.mjs';
import {webConfig} from '../lib/web/config.mjs';
import {harness} from './helpers/web-http.mjs';
import {fleetUIHarness} from './helpers/web-fleet-updates-ui.mjs';
const id='a'.repeat(64),next='b'.repeat(64),digest='c'.repeat(64),project={id:'studio',repo:'acme/studio'},access={workspace:{name:'Acme'},csrf:'fake-csrf'};
const target={repoId:103,repositoryNodeId:'R_acme_103',repo:'acme/keel',commit:'d'.repeat(40),cliVersion:'1.0.0',practiceVersion:'1.0.0',bundleDigest:digest};
const prep={kind:'preparation',previewId:id,requestId:next,digest,project,target,canApply:true,rolloutId:id,container:{image:'node@sha256:'+digest,platform:'linux/amd64',network:'none'},setup:'npm ci --ignore-scripts',check:'npm run check',environmentKeys:['ACME_MODE'],budget:{reservedMinutes:60,projectWeeklyMinutes:120,workspaceWeeklyMinutes:180}};
const pub={...prep,source:{head:'e'.repeat(40)},kind:'publication',audience:'public',title:'Update Acme',body:'Exact <script>PR</script> text',branch:'keel/web-'+next,draft:false,files:[{path:'docs/acme.md',before:{mode:'100644',blob:'e'.repeat(40)},after:{mode:'100644',content:Buffer.from('Acme <after>\n').toString('base64')}},{path:'old.md',before:{mode:'100644',blob:'e'.repeat(40)},after:null}],checks:{setup:null,updated:{command:'npm run check',exit:0,tail:'Acme passed'},baseSetup:{command:'npm ci',exit:1,tail:'Acme setup failed'},base:null}};
test('comparison keeps version facts distinct and requires explicit project/canary selection',()=>{
  const html=versionsView({target,projects:[{project,versions:{practice:'1.0.0',lock:'0.9.0',cliDeclaration:'^1.0.0',runtime:null},ownership:{state:'changed',files:[{path:'AGENTS.md#base',state:'changed'}]},migrations:{state:'applicability-unverified',pending:['0001-acme']},capabilities:{prepare:true}}]},access);
  assert.match(html,/Observed runtime/);assert.match(html,/Unavailable/);assert.match(html,/AGENTS.md#base/);assert.match(html,/0001-acme/);assert.doesNotMatch(html,/checked|selected=/);assert.match(html,/Choose a selected project/);assert.match(html,/\/setup/);
});
test('preparation and publication reviews expose exact policies, bytes, deletes, check gaps and public acknowledgment separately',()=>{
  const a=preparationPreviewView(prep),b=publicationPreviewView(pub);
  assert.match(a,/does not publish a PR/);assert.match(a,/60/);assert.match(a,/ACME_MODE/);assert.match(a,/linux\/amd64/);assert.match(a,/data-submit-fleet disabled/);
  assert.match(b,/&lt;script&gt;PR/);assert.match(b,/Acme &lt;after&gt;/);assert.match(b,/old.md · delete/);assert.ok(b.includes('https://github.com/acme/studio/blob/'+'e'.repeat(40)+'/old.md'));assert.match(b,/View original file/);assert.match(b,/data-public-fleet/);assert.match(b,/Pristine base setup/);assert.match(b,/Acme setup failed/);assert.match(b,/Unavailable or not run/);assert.doesNotMatch(b,/<script>PR/);
});
test('publication verification requires PR and commit, and rollout stop never claims cancellation',()=>{
  assert.doesNotMatch(updateReceipt({id,kind:'publication',state:'committed',pr:null,commit:null}),/Update PR verified/);
  const verified=updateReceipt({id,kind:'publication',state:'committed',reason:null,pr:{number:1,url:'https://github.com/acme/studio/pull/1'},commit:'d'.repeat(40)});
  assert.match(verified,/GitHub confirms this pull request/);assert.doesNotMatch(verified,/No confirmed completion/);assert.match(verified,/does not establish merge, installed practice or acceptance/);
  assert.match(rolloutView({id,state:'active',canary:'studio',projects:[{projectId:'studio',state:'prepared'}],capabilities:{stop:true}},access),/does not cancel a dispatched worker/);
  assert.match(lessonTraceView({id:'lesson-'+'a'.repeat(40),source:{state:'evidenced',label:'Original lesson',shape:'<script>Acme</script>'}},access),/&lt;script&gt;Acme/);
});
function clientFixture(fetch,model,{checked=true,publicChecked=true}={}) {
  const output={innerHTML:''},host={innerHTML:'old receipt'},status={textContent:''},controls={disabled:false},listeners={};
  const root={innerHTML:'',querySelector(s){return {'[data-fleet-model]':{value:JSON.stringify(model)},'[data-fleet-csrf]':{value:'fake-csrf'},'[data-fleet-output]':output,'[data-fleet-current]':host,'[data-fleet-status]':status,'[data-approve-fleet]':{checked},'[data-public-fleet]':{checked:publicChecked},'[data-submit-fleet]':controls,'[data-canary]':{value:'studio'}}[s]||null;},querySelectorAll(s){return s==='[data-project-select]:checked'?[{value:'studio'}]:[controls];},addEventListener(k,f){listeners[k]=f;},removeEventListener(){}};
  const history={path:null,replaceState(a,b,path){this.path=path;}};
  const document={visibilityState:'visible',querySelector:()=>root};
  return {root,host,output,status,history,document,client:startFleetClient({document,window:{history,crypto:webcrypto},fetch})};
}
test('lost rollout creation keeps preissued durable URL and never sends a replacement selection',async()=>{
  let f;const calls=[];f=clientFixture(async(url,o)=>{calls.push(JSON.parse(o.body));assert.match(f.history.path,/^\/updates\/rollouts\/[a-f0-9]{64}$/);throw Error('Acme lost response');},{kind:'comparison'});
  await f.client.createRollout();await f.client.createRollout();assert.equal(calls.length,1);assert.ok(f.history.path.endsWith(calls[0].requestId));assert.match(f.status.textContent,/do not create a replacement/);assert.equal(f.document.title,'Update rollout · Keel');assert.doesNotMatch(f.host.innerHTML,/old receipt|data-project-select/);
});
test('public publication cannot submit without separate audience acknowledgment',async()=>{
  const calls=[],f=clientFixture(async(url,o)=>{calls.push(url);return Response.json(pub);},{id,kind:'preparation',projectId:'studio',rolloutId:id,capabilities:{publish:true}},{publicChecked:false});
  await f.client.review('publication');await f.client.submit();assert.equal(calls.length,1);assert.match(f.host.innerHTML,/data-public-fleet/);
});
test('approved publication advances known stages, halts after lost response, and clears old controls',async()=>{
  let f;const calls=[];const receipt={id:next,kind:'publication',projectId:'studio',rolloutId:id,state:'publishing',capabilities:{continue:true}};
  f=clientFixture(async(url,o)=>{calls.push({url,body:JSON.parse(o.body)});if(url.endsWith('publication-preview'))return Response.json(pub);if(url.endsWith('/publish')){assert.equal(f.history.path,'/updates/'+next);assert.equal(f.output.innerHTML,'');return Response.json(receipt);}if(url.endsWith('/continue'))throw Error('Acme lost stage');return Response.json({...receipt,state:'uncertain',capabilities:{reconcile:true}});},{id,kind:'preparation',projectId:'studio',rolloutId:id,capabilities:{publish:true}});
  await f.client.review('publication');await f.client.submit();assert.equal(calls.length,3);assert.equal(calls[1].body.publicAcknowledgement,digest);
  await f.client.submit();await f.client.continueKnown();assert.equal(calls.length,3);assert.match(f.host.innerHTML,/uncertain/);assert.doesNotMatch(f.host.innerHTML,/data-continue-fleet/);
  await f.client.act('reconcile');assert.equal(calls[3].url,`/api/updates/${next}/reconcile`);
});
test('bounded foreground progression pauses visibly at its cap without losing original approval',async()=>{
  let count=0;const receipt={id,kind:'publication',state:'publishing',capabilities:{continue:true}};
  const f=clientFixture(async()=>{count++;return Response.json(receipt);},receipt);
  await f.client.continueKnown();assert.equal(count,208);assert.match(f.status.textContent,/paused/);assert.match(f.host.innerHTML,/Continue publication/);
  f.document.visibilityState='hidden';await f.client.continueKnown();assert.equal(count,208);
});
test('new return paths and configuration are exact and off by absence',()=>{
  for(const p of ['/versions','/projects/studio/versions','/updates/'+id,'/updates/rollouts/'+id,'/learning/trace/lesson-'+'a'.repeat(40)])assert.equal(returnPath(p),true);
  for(const p of ['//outside.test/versions','/versions?secret=value','/updates/rollouts/../private','/learning/trace/other'])assert.equal(returnPath(p),false);
  const h=harness();assert.equal(webConfig(h.input,h.secrets).fleetUpdates,undefined);
  const fleetUpdates={enabled:false,publishEnabled:false,target};assert.deepEqual(webConfig({...h.input,fleetUpdates},h.secrets).fleetUpdates,fleetUpdates);
  assert.throws(()=>webConfig({...h.input,fleetUpdates:{...fleetUpdates,target:{...target,codeUrl:'https://outside.test'}}},h.secrets));
});
async function fixture(){const h=await fleetUIHarness(),login=await h.login();return {h,login};}
async function json(h,request,status=200){const r=await h.service(request);assert.equal(r.status,status,await r.clone().text());return r.json();}
test('actual comparison and persisted rollout routes recover original selection and enforce CSRF',async()=>{
  const {h,login}=await fixture();const comparison=await json(h,h.request('/api/versions',{cookie:login.cookie}));assert.equal(comparison.projects[0].versions.practice,'1.0.0');assert.equal(comparison.projects[0].versions.runtime,null);assert.equal(comparison.projects[0].capabilities.prepare,true);
  const input={requestId:id,projectIds:['studio'],canary:'studio'};
  await json(h,h.post('/api/updates/rollouts',login,input,{origin:'https://outside.test'}),403);
  const r=await json(h,h.post('/api/updates/rollouts',login,input));assert.equal(r.id,id);assert.equal(r.nextProjectId,'studio');
  const page=await h.service(h.request('/updates/rollouts/'+id,{cookie:login.cookie}));assert.match(await page.text(),/Review preparation for studio/);
  const duplicate=await json(h,h.post('/api/updates/rollouts',login,input));assert.equal(duplicate.id,id);assert.equal(h.actions.dispatches.length,0);
  const stopped=await json(h,h.post('/api/updates/rollouts/'+id+'/stop',login,{expectedVersion:r.version}));assert.equal(stopped.state,'stopped');
});
test('actual preparation uses original authenticated session and signed output route rejects browser authority',async()=>{
  const {h,login}=await fixture();await json(h,h.post('/api/updates/rollouts',login,{requestId:id,projectIds:['studio'],canary:'studio'}));
  const p=await json(h,h.post('/api/projects/studio/updates/prepare-preview',login,{rolloutId:id}));assert.equal(p.budget.reservedMinutes,60);
  await json(h,h.post('/api/projects/studio/updates/prepare-preview',login,{rolloutId:id,sessionRef:digest}),400);
  const input={rolloutId:id,requestId:p.requestId,previewId:p.previewId,digest:p.digest};
  const receipt=await json(h,h.post('/api/projects/studio/updates/prepare',login,input));assert.equal(receipt.kind,'preparation');assert.equal(h.actions.dispatches.length,1);
  await json(h,h.post('/api/projects/studio/updates/prepare',login,input));assert.equal(h.actions.dispatches.length,1);
  await json(h,h.post('/api/workers/update-output',login,{}),401);
});
test('actual signed preparation output leads to separately approved exact PR and read-only receipts',async()=>{
  const {h,login}=await fixture();await json(h,h.post('/api/updates/rollouts',login,{requestId:id,projectIds:['studio'],canary:'studio'}));
  const p=await json(h,h.post('/api/projects/studio/updates/prepare-preview',login,{rolloutId:id}));
  await json(h,h.post('/api/projects/studio/updates/prepare',login,{rolloutId:id,requestId:p.requestId,previewId:p.previewId,digest:p.digest}));
  const runId=[...h.actions.runs.keys()].at(-1),authority={operationId:p.requestId,nonce:'f'.repeat(64),jobName:'web-worker'};
  const claim=await json(h,h.worker('claim',runId,authority));assert.equal(claim.adapter,'update-preparation-v1');
  Object.assign(authority,{fence:claim.fence,jobId:claim.jobId});await json(h,h.worker('begin',runId,authority));
  const uploaded=await json(h,h.worker('update-output',runId,{...authority,output:h.output()}));assert.equal(uploaded.accepted,true);
  await json(h,h.worker('complete',runId,{...authority,sequence:1,result:{state:'succeeded',exitCode:0}}));
  let receipt=await json(h,h.request('/api/updates/'+p.requestId,{cookie:login.cookie}));assert.equal(receipt.capabilities.publish,false,'worker completion alone cannot publish');
  Object.assign(h.actions.runs.get(runId),{status:'completed',conclusion:'success'});
  receipt=await json(h,h.post('/api/updates/'+p.requestId+'/reconcile',login));assert.equal(receipt.capabilities.publish,true);
  const preview=await json(h,h.post('/api/projects/studio/updates/publication-preview',login,{rolloutId:id,preparationId:p.requestId}));
  assert.equal(preview.files[0].path,'docs/acme.md');assert.equal(h.remote.prs.length,0);
  const input={rolloutId:id,requestId:preview.requestId,previewId:preview.previewId,digest:preview.digest,publicAcknowledgement:preview.digest};
  let pub=await json(h,h.post('/api/projects/studio/updates/publish',login,input));
  for(let n=0;n<30&&pub.capabilities.continue;n++)pub=await json(h,h.post('/api/updates/'+pub.id+'/continue',login));
  assert.equal(pub.state,'committed');assert.equal(h.remote.prs.length,1);
  const writes=h.remote.writes.length;
  const page=await h.service(h.request('/updates/'+pub.id,{cookie:login.cookie}));assert.match(await page.text(),/Update PR verified/);assert.equal(h.remote.writes.length,writes);
  const current=await json(h,h.request('/api/projects/studio/versions',{cookie:login.cookie}));assert.equal(current.projects[0].versions.practice,'1.0.0');assert.equal(h.source.files['docs/acme.md'],'Acme before\n','published PR does not mutate the observed default branch');
});
test('buffered reads suppress private models after Pull Requests permission disappears',async()=>{
  let armed=false;const h=await fleetUIHarness({afterRead(h,url){if(armed&&url.includes('/git/trees/'))h.uiState.pullRequestsPermission='read';}}),login=await h.login();armed=true;
  const response=await h.service(h.request('/api/versions',{cookie:login.cookie}));assert.equal(response.status,404);assert.doesNotMatch(await response.text(),/Acme Studio|0001-acme/);
});
test('fresh authorization denial halts foreground publication after one request and clears its private model',async()=>{
  let count=0;const f=clientFixture(async()=>{count++;return Response.json({error:'access_denied'},{status:404});},{id,kind:'publication',state:'publishing',capabilities:{continue:true}});
  await f.client.continueKnown();assert.equal(count,1);assert.match(f.root.innerHTML,/private view has been cleared/);assert.doesNotMatch(f.root.innerHTML,/Acme|data-continue/);
});
