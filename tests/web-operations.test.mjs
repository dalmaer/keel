import { nameCandidate } from './helpers/web-name-candidate.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { decisionHarness,healthTarget,shapingTarget,token } from './helpers/web-decisions.mjs';
import { createDecisions } from '../lib/web/decisions.mjs';
import { createOperations } from '../lib/web/operations.mjs';
import { createOperationStore } from '../lib/web/operation-store.mjs';
import { createDecisionGitHub } from '../lib/web/decision-github.mjs';
const options=h=>({fetcher:h.fetcher,now:()=>h.state.now});
const preview=h=>createDecisions(h.config,options(h)).preview(h.access,token,h.project,{target:healthTarget,choice:'accept',reason:'Owner chooses this outcome.'});
const apply=(h,p,reauthorize=async()=>h.access)=>createOperations(h.config,options(h)).apply(h.access,token,h.project,p.id,{reauthorize});
const recover=(h,id)=>createOperations(h.config,options(h)).recover(h.access,token,h.project,id);
const intentFromPreview=p=>({id:p.operationId,repoId:p.source.repoId,repositoryNodeId:p.source.repositoryNodeId,branchNodeId:p.source.branchNodeId,originalBlob:p.source.blob,head:p.source.head,path:p.source.path,content:p.content,commitMessage:p.commitMessage,marker:`Keel-Operation: ${p.operationId}`});
test('dispatch and receipt recovery have fresh bounded deadlines after source time expires',async t=>{
 const h=decisionHarness(),p=await preview(h),intent=intentFromPreview(p),deadlines=[],outer=new AbortController();
 const timeout=AbortSignal.timeout;
 t.mock.method(AbortSignal,'timeout',milliseconds=>{
  if(milliseconds!==25000)return timeout(milliseconds);
  const controller=new AbortController();deadlines.push(controller);return controller.signal;
 });
 let expireHistory=false;
 const fetcher=async(url,options)=>{
  AbortSignal.any([outer.signal,options.signal]).throwIfAborted();
  const response=await h.fetcher(url,options);
  if(expireHistory&&options.body?.includes('query DecisionHistory'))deadlines.at(-1).abort();
  return response;
 };
 const provider=createDecisionGitHub(token,{fetcher}),snapshot=await provider.snapshot(h.project);
 await snapshot.reader.readFile(healthTarget.path);await provider.recheck(h.project,snapshot.source);
 deadlines[0].abort();
 const commit=await provider.dispatch(intent);assert.equal(h.source.writes.length,1);
 deadlines.at(-1).abort();
 const found=await provider.recover(intent,commit);assert.equal(found.commit,commit);assert.equal(deadlines.length,3);
 // The two recovery queries share one bound, rather than resetting it per query.
 expireHistory=true;const count=h.source.graphRequests.length;
 await assert.rejects(provider.recover(intent,commit),e=>e.code==='upstream_unavailable');
 assert.equal(h.source.graphRequests.length,count+1);
 expireHistory=false;
 // Fresh stage deadlines do not override the request-wide deadline in the fetcher.
 outer.abort();
 await assert.rejects(provider.dispatch(intent),e=>e.code==='upstream_unavailable');
 await assert.rejects(provider.recover(intent,commit),e=>e.code==='upstream_unavailable');
 assert.equal(h.source.writes.length,1);
});
test('receipt recovery remains bounded independently of the exhausted source call allowance',async()=>{
 const h=decisionHarness(),p=await preview(h),intent=intentFromPreview(p),provider=createDecisionGitHub(token,options(h));
 const snapshot=await provider.snapshot(h.project); // Three source requests.
 for(let i=0;i<247;i++)await provider.recheck(h.project,snapshot.source);
 await assert.rejects(provider.recheck(h.project,snapshot.source),e=>e.code==='source_limit');
 const commit=await provider.dispatch(intent),count=h.source.graphRequests.length;
 assert.equal((await provider.recover(intent,commit)).commit,commit);
 assert.equal(h.source.graphRequests.length,count+2);assert.equal(h.source.writes.length,1);
 await assert.rejects(provider.recheck(h.project,snapshot.source),e=>e.code==='source_limit');
});
test('conditional commit advances exactly reviewed HEAD, records one file and replays original receipt',async()=>{
 const h=decisionHarness(),p=await preview(h),done=await apply(h,p);
 assert.equal(done.state,'committed');assert.equal(done.id,p.operationId);assert.equal(done.receipt.acceptance,'not-established');assert.equal(done.receipt.actorId,1);
 assert.equal(h.source.writes.length,1);const write=h.source.writes[0];assert.equal(write.expectedHeadOid,p.source.head);assert.equal(write.fileChanges.additions.length,1);assert.equal(write.fileChanges.additions[0].path,healthTarget.path);
 assert.equal(`${write.message.headline}\n\n${write.message.body}`,p.commitMessage);
 assert.deepEqual(await apply(h,p),done);assert.deepEqual(await recover(h,done.id),done);assert.equal(h.source.writes.length,1);
 assert.doesNotMatch(JSON.stringify([...h.db.operations.values()]),/Owner chooses|fake-user-access/);
});
test('source HEAD, context, visibility, user/App permission and fresh membership changes refuse before write',async()=>{
 for(const change of ['head','content','visibility','user','app','membership','workspace']){
  const h=decisionHarness(),p=await preview(h);let fresh=()=>h.access;
  if(change==='head')h.source.head='e'.repeat(40);
  if(change==='content')h.source.files[healthTarget.path]+='\nSource changed.\n';
  if(change==='visibility')h.source.private=true;
  if(change==='user')h.source.push=false;
  if(change==='app')h.access.contentsPermission='read';
  if(change==='membership')fresh=()=>({...h.access,projects:[]});
  if(change==='workspace')fresh=()=>({...h.access,sourceRevision:'f'.repeat(40)});
  const result=await apply(h,p,async()=>fresh());assert.equal(result.state,'refused',change);assert.equal(h.source.writes.length,0,change);
 }
});
test('project reservations fence concurrent previews across instances and cannot be freed by uncertain expiry',async()=>{
 const h=decisionHarness(),first=await preview(h),second=await preview(h);h.source.mode='never';
 const uncertain=await apply(h,first);assert.equal(uncertain.state,'uncertain');
 h.state.now+=61000;
 await assert.rejects(apply(h,second),e=>e.code==='project_busy');
 const pending=await recover(h,first.operationId);assert.equal(pending.state,'uncertain');assert.equal(h.source.writes.length,1);
 const replay=await apply(h,first);assert.equal(replay.id,first.operationId);assert.equal(h.source.writes.length,1);
});
test('lost response after commit recovers the original operation without retry and rejects mismatched markers/content/parents',async()=>{
 const h=decisionHarness(),p=await preview(h);h.source.mode='lost';const uncertain=await apply(h,p);assert.equal(uncertain.state,'uncertain');
 const source=structuredClone(h.source.commits[0]);
 for(const mutate of [c=>c.commit.message='Unrelated commit',c=>c.parents[0].sha='f'.repeat(40),c=>c.content='Different file',c=>c.files.push({filename:'other.md'})]){
  h.source.commits[0]=structuredClone(source);mutate(h.source.commits[0]);assert.equal((await recover(h,p.operationId)).state,'uncertain');
 }
 h.source.commits[0]=source;const found=await recover(h,p.operationId);assert.equal(found.state,'committed');assert.equal(found.receipt.commit,source.sha);assert.equal(h.source.writes.length,1);
});
test('response loss while dispatch is still in flight never permits another write',{timeout:5000},async()=>{
 const h=decisionHarness(),p=await preview(h);let release;h.source.hold=new Promise(resolve=>{release=resolve;});
 let entered;const dispatched=new Promise(resolve=>{entered=resolve;});h.source.onDispatch=entered;
 const running=apply(h,p);await dispatched;
 try{const pending=await recover(h,p.operationId);assert.equal(pending.state,'dispatched');h.state.now+=61000;assert.equal((await apply(h,p)).state,'dispatched');assert.equal(h.source.writes.length,1);}
 finally{release();}
 assert.equal((await running).state,'committed');
});
test('expired preview, actor scope, disabled writes and wrong fencing cannot dispatch',async()=>{
 const h=decisionHarness(),p=await preview(h),ops=createOperations({...h.config,decisionWrites:false},options(h));
 await assert.rejects(ops.apply(h.access,token,h.project,p.id),e=>e.code==='submission_disabled');
 await assert.rejects(createOperations(h.config,options(h)).apply({...h.access,userId:2},token,h.project,p.id),e=>e.code==='preview_expired');
 const store=createOperationStore(h.config,h.fetcher),scope=store.scopeFor(1,h.project),id=p.operationId,fence='a'.repeat(64);
 await store.reserve(id,scope,store.projectFor(h.project),p.id,fence,{fence,previewId:p.id,projectId:h.project.id});
 assert.equal(await store.transition('dispatched',id,scope,'b'.repeat(64)),null);
 h.state.now+=61000;assert.equal(await store.transition('dispatched',id,scope,fence),null);
 assert.equal((await recover(h,id)).state,'refused');
 h.state.now+=900000;await assert.rejects(apply(h,p),e=>e.code==='preview_expired');assert.equal(h.source.writes.length,0);
});
test('remote protected/stale refusal stays at its destination and creates no issue or pull request',async()=>{
 const h=decisionHarness(),p=await preview(h);h.source.mode='refused';const result=await apply(h,p);
 assert.equal(result.state,'refused');assert.equal(h.source.writes.length,1);assert.deepEqual(Object.keys(h.source.writes[0]).sort(),['branch','clientMutationId','expectedHeadOid','fileChanges','message']);
 assert.deepEqual(h.source.commits,[]);
});
test('HTTP decision entrances enforce current access, exact Origin, CSRF, typed inputs and recoverable HTML',async()=>{
 const h=decisionHarness(),signed=await h.login(),query=new URLSearchParams(healthTarget),path=`/api/projects/studio/decisions?${query}`;
 assert.equal((await h.service(h.request(path))).status,401);
 const detail=await h.service(h.request(path,{cookie:signed.cookie}));assert.equal(detail.status,200);
 const post=(suffix,body,overrides={})=>h.service(new Request(`${h.config.origin}/api/projects/studio/decisions/${suffix}`,{method:'POST',headers:{cookie:signed.cookie,origin:h.config.origin,'content-type':'application/json',...overrides},body:JSON.stringify(body)}));
 const input={csrf:signed.session.csrf,target:healthTarget,choice:'accept'};
 assert.equal((await post('preview',input,{origin:'https://evil.test'})).status,403);
 assert.equal((await post('preview',{...input,csrf:'wrong'})).status,403);
 assert.equal((await post('preview',{...input,extra:true})).status,400);
 const p=await(await post('preview',input)).json();assert.ok(p.operationId);
 const result=await post('apply',{csrf:signed.session.csrf,previewId:p.id});assert.equal(result.status,200);const operation=await result.json();assert.equal(operation.state,'committed');
 assert.equal((await h.service(h.request(p.operationUrl,{cookie:signed.cookie}))).status,200);
 h.state.members=[];
 assert.equal((await h.service(h.request(path,{cookie:signed.cookie}))).status,404);
 for(const url of [`/api/projects/studio/operations/${p.operationId}`,p.operationUrl])assert.equal((await h.service(h.request(url,{cookie:signed.cookie}))).status,401);
});
test('reserved receipt bookmark remains recoverable before its operation row is visible',async()=>{
 const h=decisionHarness(),signed=await h.login(),id='e'.repeat(64);
 const api=await h.service(h.request(`/api/projects/studio/operations/${id}`,{cookie:signed.cookie}));assert.equal(api.status,404);assert.equal((await api.json()).error,'operation_not_found');
 const html=await h.service(h.request(`/projects/studio/operations/${id}`,{cookie:signed.cookie}));assert.equal(html.status,200);assert.match(await html.text(),/not visible yet|in-flight/);
});
test('visibility or push permission changing during final authorization refuses before dispatch',async()=>{
 for(const field of ['private','push']){const h=decisionHarness(),p=await preview(h);const result=await apply(h,p,async()=>{h.source[field]=field==='private';return h.access;});assert.equal(result.state,'refused');assert.equal(h.source.writes.length,0);}
});
test('a branch movement after validation is refused by the atomic expectedHeadOid mutation',async()=>{
 const h=decisionHarness(),p=await preview(h);h.source.onDispatch=()=>{h.source.head='e'.repeat(40);};
 const result=await apply(h,p);assert.equal(result.state,'refused');assert.equal(h.source.writes[0].expectedHeadOid,p.source.head);assert.equal(h.source.commits.length,0);
});
test('shaping delivery changes only its reviewed record and preserves proposed choices',async()=>{
 const h=decisionHarness(),p=await createDecisions(h.config,options(h)).preview(h.access,token,h.project,{target:shapingTarget,answer:'Use prefix matches.'});
 const result=await apply(h,p);assert.equal(result.state,'committed');assert.equal(result.receipt.path,shapingTarget.path);
 const shape=JSON.parse(h.source.files[shapingTarget.path]);assert.equal(shape.answers[0].text,'Use prefix matches.');assert.equal(shape.proposedDecisions.length,1);assert.equal(shape.revision,2);
 assert.equal(h.source.writes[0].fileChanges.additions.length,1);
});
test('preview and delivery pin numeric repository, repository node and branch node identities',async()=>{
 const h=decisionHarness(),p=await preview(h);
 assert.equal(p.source.repoId,102);assert.equal(p.source.repositoryNodeId,h.source.repositoryNodeId);assert.equal(p.source.branchNodeId,h.source.branchNodeId);
 const done=await apply(h,p);assert.equal(done.state,'committed');assert.deepEqual(h.source.writes[0].branch,{id:h.source.branchNodeId});
 const store=createOperationStore(h.config,h.fetcher),row=await store.read(p.operationId,store.scopeFor(1,h.project));
 assert.equal(row.value.intent.repoId,102);assert.equal(row.value.intent.repositoryNodeId,p.source.repositoryNodeId);assert.equal(row.value.intent.branchNodeId,p.source.branchNodeId);assert.equal(row.value.intent.originalBlob,p.source.blob);
});
test('recovery ignores an exact cloned operation under a recycled old repository name',async()=>{
 const h=decisionHarness(),p=await preview(h);h.source.mode='never';assert.equal((await apply(h,p)).state,'uncertain');
 const {gitBlob}=await import('../lib/web/decision-github.mjs');
 const cloned={sha:'d'.repeat(40),parents:[{sha:p.source.head}],commit:{message:p.commitMessage},files:[{filename:p.source.path,sha:gitBlob(p.content),status:'modified'}],path:p.source.path,content:p.content};
 h.source.repoName='acme/renamed-studio';h.project.repo=h.source.repoName;h.source.recycledCommits=[cloned];
 const absent=await recover(h,p.operationId);assert.equal(absent.state,'uncertain');assert.equal(h.source.oldNameReads,0);assert.equal(h.source.writes.length,1);
 // A matching commit in the pinned repository does establish the original source effect.
 h.source.commits=[structuredClone(cloned)];const found=await recover(h,p.operationId);
 assert.equal(found.state,'committed');assert.equal(found.receipt.repoId,102);assert.equal(found.receipt.repositoryNodeId,p.source.repositoryNodeId);assert.match(found.receipt.url,/acme\/renamed-studio\/commit\//);
 assert.equal(h.source.oldNameReads,0);
});
test('rename and name reuse after final validation cannot redirect an immutable branch-ID mutation',async()=>{
 const h=decisionHarness(),p=await preview(h);h.source.onDispatch=()=>{h.source.repoName='acme/renamed-studio';h.source.recycledCommits=[];};
 const result=await apply(h,p);assert.equal(result.state,'committed');assert.deepEqual(h.source.writes[0].branch,{id:p.source.branchNodeId});
 assert.equal(h.source.commits.length,1);assert.equal(h.source.recycledCommits.length,0);assert.equal(h.source.oldNameReads,0);
});
test('missing Ref, wrong immutable identity and unknown changed-file coverage keep recovery uncertain',async()=>{
 const h=decisionHarness(),p=await preview(h);h.source.mode='lost';assert.equal((await apply(h,p)).state,'uncertain');
 for(const field of ['refMissing','wrongRefRepository','wrongProofRepository','unknownChangedFiles']){
  h.source[field]=true;assert.equal((await recover(h,p.operationId)).state,'uncertain',field);h.source[field]=false;
 }
 const {createDecisionGitHub,gitBlob}=await import('../lib/web/decision-github.mjs'),store=createOperationStore(h.config,h.fetcher),row=await store.read(p.operationId,store.scopeFor(1,h.project));
 assert.equal(await createDecisionGitHub(token,options(h)).recover({...row.value.intent,originalBlob:gitBlob(row.value.intent.content)}),null);
 assert.equal((await recover(h,p.operationId)).state,'committed');assert.equal(h.source.writes.length,1);
});


test('held and candidate operation markers recover original uncertain commits across releases', async t => {
  const candidate = await nameCandidate(t, { cookies: false, markers: true });
  for (const candidateWrites of [false,true]) {
    const h = decisionHarness();
    const writerDecisions = candidateWrites ? candidate.decisions.createDecisions : createDecisions;
    const writerOperations = candidateWrites ? candidate.operations.createOperations : createOperations;
    const readerOperations = candidateWrites ? createOperations : candidate.operations.createOperations;
    const p = await writerDecisions(h.config, options(h)).preview(h.access, token, h.project, { target: healthTarget, choice: 'accept', reason: 'Acme owner decision.' });
    assert.ok(p.commitMessage.endsWith(`${candidateWrites ? 'Plates' : 'Keel'}-Operation: ${p.operationId}`));
    h.source.mode = 'lost';
    const pending = await writerOperations(h.config, options(h)).apply(h.access, token, h.project, p.id, { reauthorize: async () => h.access });
    assert.equal(pending.state, 'uncertain');
    const original = h.source.commits[0].commit.message;
    const recovered = await readerOperations(h.config, options(h)).recover(h.access, token, h.project, p.operationId);
    assert.equal(recovered.state, 'committed');
    assert.equal(h.source.writes.length, 1); assert.equal(h.source.commits[0].commit.message, original);
  }
});
