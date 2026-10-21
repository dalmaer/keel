import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runCard,runDetailView,runsView,routineCard,runLocation} from '../lib/web/run-views.mjs';
import {scopeLocation,startRunClient} from '../lib/web/run-client.mjs';
const project={id:'studio',name:'Acme Studio',repo:'acme/studio',repoId:102};
const access={workspace:{name:'Acme'},projects:[project,{id:'other',repo:'acme/other'}],csrf:'Acme'};
const item={id:JSON.stringify(['github-actions-attempt',102,71,2]),kind:'actions-attempt',projectId:'studio',title:'Acme checks',identity:{repoId:102,runId:71,attempt:2},parentId:JSON.stringify(['github-actions-run',102,71]),retryOf:JSON.stringify(['github-actions-attempt',102,71,1]),source:{kind:'github-actions'},provider:{status:'completed',conclusion:'failure'},state:'failed',acceptance:'not-established',updatedAt:'2026-10-21T10:00:00Z',timeBasis:'provider-attempt',cost:{weightedMinutes:null,actual:null},detailUrl:'/projects/studio/activity/actions/71/attempts/2',link:'https://github.com/acme/studio/actions/runs/71/attempts/2'};

test('scope navigation preserves applicable window/outcome but clears foreign routine and bound pagination',()=>{
  const url='https://acme.test/projects/studio/activity?days=7&status=failed&routine=.github%2Fworkflows%2Facme.yml&page=3&receiptsAfter=abc';
  assert.equal(scopeLocation(url,'routines','other'),'/projects/other/routines?days=7&status=failed');
  assert.equal(scopeLocation(url,'activity',''),'/activity?days=7&status=failed');
  assert.match(scopeLocation(url,'activity','studio'),/routine=\.github%2Fworkflows%2Facme.yml/);assert.doesNotMatch(scopeLocation(url,'activity','studio'),/page=|receiptsAfter/);
  let submitted,assigned;const form={dataset:{destination:'routines'},querySelector:()=>({value:'other'}),addEventListener:(name,fn)=>{assert.equal(name,'submit');submitted=fn;},removeEventListener(){}};
  const client=startRunClient({document:{querySelector:()=>form},window:{location:{href:url,assign:value=>{assigned=value;}}}});
  let prevented=false;submitted({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(assigned,'/projects/other/routines?days=7&status=failed');client.stop();
});

test('attempt cards retain original failure, retry identity, unknown charges and no acceptance claim',()=>{
  const html=runCard(item,project,'2026-10-21T11:00:00Z',{days:7,status:'failed'});
  assert.match(html,/completed \/ failure/);assert.match(html,/Usage estimate unknown/);assert.match(html,/Actual charges<\/dt><dd>Unknown/);assert.match(html,/Not established/);assert.match(html,/github-actions-run/);assert.match(html,/days=7&amp;status=failed/);
  assert.doesNotMatch(html,/Run now|Retry job|Cancel run|0 weighted min/);
});

test('authored outcomes and declared allocations cannot masquerade as actual successful attempts or charges',()=>{
  const html=runCard({...item,kind:'authored-night',source:{kind:'night-plan'},identity:{},state:'succeeded',allocatedMinutes:12,timeBasis:'authored-date',detailUrl:'/projects/studio/daily?date=2026-10-21'},project,'2026-10-21T11:00:00Z');
  assert.match(html,/Source-authored outcome/);assert.match(html,/not an independently observed execution attempt/);assert.match(html,/No execution identity/);assert.match(html,/12 min · declared/);assert.match(html,/Actual charges<\/dt><dd>Unknown/);
});

test('run detail retains expired unassigned evidence, partial stages and independently paged continuations',()=>{
  const html=runDetailView({project,item:{...item,cost:{weightedMinutes:null,observedWeightedMinutes:3,actual:null,basis:'observed-job-subtotal'}},readAt:'2026-10-21T11:00:00Z',coverage:{state:'partial',observed:1,gaps:[{source:'jobs',reason:'Additional job pages remain unread.'}]},stages:[{name:'Acme tests',status:'completed',conclusion:'failure',durationMs:1200,steps:[{name:'Verify Acme',status:'completed',conclusion:'failure',durationMs:1000}]}],evidence:[{id:1,name:'Acme report',expired:true,scope:'logical-run',attempt:null,sizeBytes:400}],pagination:{jobs:{page:3,nextPage:5},artifacts:{page:1,nextPage:3}}},access,{days:14,status:'failed'});
  assert.match(html,/observed subtotal only/);assert.match(html,/Expired/);assert.match(html,/Unassigned · logical run/);assert.match(html,/Additional job pages remain unread/);assert.match(html,/jobsPage=3&amp;artifactsPage=3/);assert.match(html,/Inspect preceding attempt 1/);assert.match(html,/Verify Acme/);
});

test('fleet gaps and unvisited projects stay visible even with no matching records',()=>{
  const html=runsView({projects:[{project,state:'complete-page'},{project:access.projects[1],state:'unvisited'}],readAt:'2026-10-21T11:00:00Z',filters:{days:7,status:'failed'},items:[],routines:[],coverage:{state:'partial',observed:0,gaps:[{source:'other',reason:'Project not visited.'}]},pagination:{projectPage:1,nextProjectPage:2}},access);
  assert.match(html,/Project not visited/);assert.match(html,/unvisited/);assert.match(html,/not evidence that nothing ran/);assert.match(html,/projectPage=2/);assert.match(html,/days=7&amp;status=failed/);
});

test('untrusted routine prose and provider/private links remain inert',()=>{
  const html=routineCard({id:'.github/workflows/acme.yml',name:'<script>Acme</script>',url:'javascript:alert(1)',schedules:[],gaps:[]},project,'2026-10-21T11:00:00Z');
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>Acme|href="javascript:/);assert.match(html,/Next due<\/dt><dd>Unknown/);
  const card=runCard({...item,detailUrl:'//acme.test/private',link:'https://github.com.evil.test/acme'},project,'now');assert.doesNotMatch(card,/href="\/\/acme|href="https:\/\/github.com.evil/);
});

test('actual project routes retain failed retries and unavailable private history without mutations',async()=>{
  const {runsHarness,runFixture}=await import('./helpers/web-runs.mjs');
  const {createWebService}=await import('../lib/web/server.mjs');
  const h=runsHarness(),login=await h.login();
  h.actions.runs=[runFixture({run_attempt:2,conclusion:'failure'})];h.actions.attempts.set('9001:1',runFixture());
  const service=createWebService(h.config,{fetcher:h.fetcher,now:()=>h.state.now});
  let response=await service(h.request('/api/projects/studio/activity?days=7&status=failed',{cookie:login.cookie}));
  assert.equal(response.status,200,await response.clone().text());const model=await response.json();
  assert.equal(model.items.filter(value=>value.kind==='actions-attempt').length,1);assert.equal(model.items[0].identity.attempt,2);assert.equal(model.items[0].provider.conclusion,'failure');assert.equal(model.filters.status,'failed');assert.ok(model.coverage.gaps.some(gap=>/Private operation listing/.test(gap.reason)));
  response=await service(h.request('/projects/studio/activity?days=7&status=failed',{cookie:login.cookie}));assert.equal(response.status,200);const html=await response.text();assert.match(html,/completed \/ failure/);assert.match(html,/days=7&amp;status=failed/);assert.doesNotMatch(html,/fake-user-access-token|signed-secret/);
  assert.equal(h.source.writes.length,0);assert.ok(h.actions.requests.every(request=>(request.options.method||'GET')==='GET'));
});

test('actual history detail and public assets retain auth, numeric identity and read-only boundaries',async()=>{
  const {runsHarness}=await import('./helpers/web-runs.mjs');const {createWebService}=await import('../lib/web/server.mjs');const {returnPath}=await import('../lib/web/auth.mjs');
  const h=runsHarness(),login=await h.login(),service=createWebService(h.config,{fetcher:h.fetcher,now:()=>h.state.now});
  assert.equal((await service(h.request('/api/projects/studio/activity'))).status,401);
  for(const path of ['/api/projects/other/activity','/api/projects/studio/activity?days=0','/api/projects/studio/activity?page=1&page=2','/api/projects/studio/activity?routine=../../secrets','/api/projects/studio/activity/actions/9007199254740992/attempts/1'])assert.ok([400,404].includes((await service(h.request(path,{cookie:login.cookie}))).status),path);
  const response=await service(h.request('/api/projects/studio/activity/actions/9001/attempts/1',{cookie:login.cookie}));assert.equal(response.status,200,await response.clone().text());const detail=await response.json();assert.equal(detail.stages[0].name,'Acme tests');assert.equal(detail.evidence[0].attempt,null);assert.doesNotMatch(JSON.stringify(detail),/archive_download_url|signed-secret/);
  for(const asset of ['run-client.mjs','run-views.mjs','run.css'])assert.equal((await service(h.request('/assets/'+asset))).status,200);
  for(const path of ['/activity','/routines','/projects/studio/activity','/projects/studio/routines','/projects/studio/activity/actions/9001/attempts/1'])assert.equal(returnPath(path),true,path);
  for(const path of ['//acme.test/activity','/activity?next=//acme.test','/projects/studio/activity/actions/0/attempts/1'])assert.equal(returnPath(path),false,path);
  const post=await service(new Request(h.config.origin+'/api/projects/studio/activity',{method:'POST',headers:{cookie:login.cookie,origin:h.config.origin,'Content-Type':'application/json'},body:'{}'}));assert.equal(post.status,404);
});

test('removing only the selected project during collection suppresses the old private model',async()=>{
  const {runsHarness}=await import('./helpers/web-runs.mjs');const {createWebService}=await import('../lib/web/server.mjs');
  for(const path of ['/api/projects/studio/activity','/api/projects/studio/activity/actions/9001/attempts/1']){
    const h=runsHarness(),login=await h.login();let removed=false;
    h.actions.onRequest=()=>{removed=true;};
    const fetcher=async(url,options)=>{
      if(removed&&new URL(url).pathname==='/repos/acme/keel-private/contents/workspace.json'){
        const content=JSON.stringify({version:1,id:'acme',name:'Acme workspace',repo:'acme/keel-private',projects:[]});
        return Response.json({type:'file',encoding:'base64',size:Buffer.byteLength(content),content:Buffer.from(content).toString('base64')});
      }
      return h.fetcher(url,options);
    };
    const response=await createWebService(h.config,{fetcher,now:()=>h.state.now})(h.request(path,{cookie:login.cookie}));
    assert.equal(response.status,401,path);assert.deepEqual(await response.json(),{error:'sign_in_required'});assert.deepEqual(h.state.members,[1],'owner membership remains valid');
  }
});

test('Actions grant removed during collection denies output even though project membership stays unchanged',async()=>{
  const {runsHarness}=await import('./helpers/web-runs.mjs');const {createWebService}=await import('../lib/web/server.mjs');
  const h=runsHarness(),login=await h.login();h.actions.onRequest=()=>{h.actions.permission=null;};
  const response=await createWebService(h.config,{fetcher:h.fetcher,now:()=>h.state.now})(h.request('/api/projects/studio/activity',{cookie:login.cookie}));
  assert.equal(response.status,404);assert.deepEqual(await response.json(),{error:'access_denied'});assert.equal(h.state.repoAccess,true);
});

test('actual fleet batches visit at most three projects sequentially and keep stored uncertainty without recovery',async()=>{
  const {runsUiHarness}=await import('./helpers/web-runs-ui.mjs');const h=await runsUiHarness(),login=await h.login();h.visited.length=0;
  let response=await h.service(h.request('/api/activity?days=7',{cookie:login.cookie}));assert.equal(response.status,200,await response.clone().text());const first=await response.json();
  assert.deepEqual([...new Set(first.items.filter(item=>item.kind==='actions-attempt').map(item=>item.identity.repoId))].sort(),[102,103,104],'each visited numeric repository contributes its own actual attempts');
  assert.equal(first.projects.filter(row=>row.state!=='unvisited').length,3);assert.equal(first.projects[3].state,'unvisited');assert.equal(first.pagination.nextProjectPage,2);assert.ok(first.coverage.gaps.some(gap=>gap.code==='unvisited'));
  const transitions=h.visited.filter((id,index,all)=>index===0||all[index-1]!==id);assert.deepEqual(transitions,['studio','project-2','project-3']);
  h.visited.length=0;response=await h.service(h.request('/api/activity?days=7&status=failed&projectPage=2',{cookie:login.cookie}));assert.equal(response.status,200,await response.clone().text());assert.deepEqual([...new Set(h.visited)],['project-4']);
  response=await h.service(h.request('/api/projects/studio/activity?routine=web-decision',{cookie:login.cookie}));assert.equal(response.status,200,await response.clone().text());const privateModel=await response.json();assert.equal(privateModel.items.length,1);assert.equal(privateModel.items[0].provider.status,'uncertain');assert.equal(privateModel.items[0].detailUrl,`/projects/studio/operations/${h.receipt.id}`);
  assert.doesNotMatch(JSON.stringify(privateModel),/Private reviewed|Private preview|Private refusal|private-user|intent/);assert.ok(h.providers.every(provider=>provider.source.writes.length===0));assert.equal(h.workspace.writes.length,0);
});

test('old unresolved private receipts remain visible without becoming running or being recovered',async()=>{
  const {runsUiHarness}=await import('./helpers/web-runs-ui.mjs');const h=await runsUiHarness({projectCount:1,receiptAt:'2025-01-01T12:00:00Z'});
  const old=h.receipt;
  const login=await h.login();const response=await h.service(h.request('/api/projects/studio/activity?days=30&routine=web-decision',{cookie:login.cookie}));assert.equal(response.status,200,await response.clone().text());
  const model=await response.json(),record=model.items.find(item=>item.identity.operationId===old.id);assert.ok(record,'old unresolved intent must not vanish behind a date window');assert.equal(record.state,'unknown');assert.equal(record.provider.status,'uncertain');assert.equal(record.startedAt,null);assert.equal(h.providers[0].source.writes.length,0);
});

test('definition-to-activity and attempt-back links retain the current applicable URL filters',()=>{
  const definition=routineCard({id:'.github/workflows/acme.yml',name:'Acme'},project,'now',{days:7,status:'failed'});assert.match(definition,/days=7&amp;status=failed&amp;routine=\.github%2Fworkflows%2Facme.yml/);
  const html=runsView({project,items:[item],filters:{days:7,status:'failed'},coverage:{gaps:[]},pagination:{page:2}},access);assert.match(html,/attempts\/2\?days=7&amp;status=failed&amp;page=2/);
});
