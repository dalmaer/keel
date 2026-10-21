import test from 'node:test';
import assert from 'node:assert/strict';
import { decisionHarness, healthTarget, token } from './helpers/web-decisions.mjs';
import { createDecisionGitHub, gitBlob, intentFiles } from '../lib/web/decision-github.mjs';
import { createOperations } from '../lib/web/operations.mjs';
import { createOperationStore } from '../lib/web/operation-store.mjs';
import { createDecisions } from '../lib/web/decisions.mjs';
import { hash, WebError } from '../lib/web/common.mjs';

const phase='docs/phases/01-acme.md',evidence='docs/evidence/acme-1.md',roadmap='docs/ROADMAP.md';
async function fixture({privateRepo=false}={}) {
 const h=decisionHarness();h.source.private=privateRepo;
 Object.assign(h.source.files,{[phase]:'# Acme\n- [ ] Check the result\n',[roadmap]:'# Acme roadmap\nWaiting\n'});
 const options={fetcher:h.fetcher,now:()=>h.state.now},store=createOperationStore(h.config,h.fetcher);
 const snapshot=await createDecisionGitHub(token,options).snapshot(h.project);
 const files=[{path:phase,content:'# Acme\n- [x] Check the result\n',originalBlob:gitBlob(h.source.files[phase])},{path:evidence,content:'# Acme evidence\nThe owner observed both rows.\n',originalBlob:null},{path:roadmap,content:'# Acme roadmap\nBuilt\n',originalBlob:gitBlob(h.source.files[roadmap])}];
 let index=0,draftDigest=hash('Acme saved all-pass draft');
 const makePreview=async(change={})=>{
  const id=hash(`Acme preview ${++index}`),operationId=hash(`Acme operation ${index}`);
  const p={schema:1,kind:'walk',id,operationId,project:h.project,target:{kind:'walk',id:'acme'},actorId:1,sourceRevision:h.access.sourceRevision,source:snapshot.source,visibility:privateRepo?'private':'public',files,contextDigest:hash('Acme context'),draftId:hash('Acme draft'),draftDigest,expiresAt:new Date(h.state.now+900000).toISOString(),commitMessage:`Record Acme walk\n\nKeel-Operation: ${operationId}`,digest:hash(`Acme public preview ${index}`),...change};
  await store.createPreview(id,store.scopeFor(1,h.project),p);return p;
 };
 const inspectWalk=async(access,token,project,p)=>{
  assert.ok([...h.db.operations.values()].some(r=>r.id===p.operationId&&r.state==='prepared'),'reserve before reading mutable draft');
  if(p.draftDigest!==draftDigest)throw new WebError('draft_changed',409);
  const provider=createDecisionGitHub(token,options),fresh=await provider.snapshot(project);
  return {model:{supported:true,source:fresh.source,context:{digest:hash('Acme context')}},canWrite:fresh.canWrite&&access.contentsPermission==='write',provider,files:p.files.map(file=>({...file,originalBlob:h.source.files[file.path]===undefined?null:gitBlob(h.source.files[file.path])}))};
 };
 const ops=createOperations(h.config,{...options,inspectWalk});
 return {...h,options,store,ops,makePreview,inspectWalk,setDraft(value){draftDigest=value;},apply(p,extra={}){return ops.apply(h.access,token,h.project,p.id,{reauthorize:async()=>h.access,publicAcknowledgement:p.digest,...extra});},recover(p){return ops.recover(h.access,token,h.project,p.operationId);}};
}

test('one reserved walk writes only all reviewed files including new evidence and replays its durable receipt',async()=>{
 const h=await fixture(),p=await h.makePreview(),done=await h.apply(p);
 assert.equal(done.state,'committed');assert.equal(done.kind,'walk');assert.deepEqual(done.receipt.paths,p.files.map(f=>f.path));assert.equal(h.source.writes.length,1);
 const mutation=h.source.writes[0];assert.deepEqual(mutation.branch,{id:p.source.branchNodeId});assert.equal(mutation.expectedHeadOid,p.source.head);
 assert.deepEqual(mutation.fileChanges.additions,p.files.map(f=>({path:f.path,contents:Buffer.from(f.content).toString('base64')})));
 assert.equal(h.source.commits[0].files.find(f=>f.filename===evidence).status,'added');
 assert.deepEqual(await h.apply(p),done);assert.deepEqual(await h.recover(p),done);assert.equal(h.source.writes.length,1);
});
test('public walk delivery requires acknowledgement of the exact preview; private delivery can omit it',async()=>{
 const h=await fixture(),p=await h.makePreview();
 for(const ack of [undefined,'wrong',hash('other preview')])await assert.rejects(h.apply(p,{publicAcknowledgement:ack}),e=>e.code==='public_acknowledgement_required');
 assert.equal(h.db.operations.size,0);assert.equal(h.source.writes.length,0);
 const privateH=await fixture({privateRepo:true}),privateP=await privateH.makePreview();assert.equal((await privateH.apply(privateP,{publicAcknowledgement:undefined})).state,'committed');
});
test('draft and source changes after preview refuse before dispatch; callback cannot substitute another write',async()=>{
 for(const change of ['draft','head','content','visibility','context','files','permission','unavailable']){
  const h=await fixture(),p=await h.makePreview();
  if(change==='draft')h.setDraft(hash('Acme failed observation'));
  if(change==='head')h.source.head='f'.repeat(40);
  if(change==='content')h.source.files[phase]+='Changed\n';
  if(change==='visibility')h.source.private=true;
  if(change==='permission')h.source.push=false;
  const inspectWalk=change==='unavailable'?undefined:async(...args)=>{const result=await h.inspectWalk(...args);if(change==='context')result.model.context.digest=hash('new context');if(change==='files')result.files[0].content+='Different owner note\n';return result;};
  const ops=createOperations(h.config,{...h.options,inspectWalk}),result=await ops.apply(h.access,token,h.project,p.id,{reauthorize:async()=>h.access,publicAcknowledgement:p.digest});
  assert.equal(result.state,'refused',change);assert.equal(h.source.writes.length,0,change);
 }
});
test('walk file sets reject unrelated records, aliases, no-ops and oversized output before reservation',async()=>{
 const h=await fixture(),base=await h.makePreview();
 for(const files of [[...base.files,{path:'extra.md',content:'Extra',originalBlob:null}],base.files.map((f,i)=>i===0?{...f,path:'README.md'}:f),base.files.map((f,i)=>i===1?{...f,path:phase}:f),base.files.map((f,i)=>i===0?{...f,content:h.source.files[phase]}:f),base.files.map((f,i)=>i===0?{...f,content:'x'.repeat(262145)}:f),base.files.map(f=>({...f,content:'x'.repeat(140000)}))]){
  const p=await h.makePreview({files});await assert.rejects(h.apply(p),e=>['invalid_write_files','output_limit'].includes(e.code));
 }
 assert.equal(h.db.operations.size,0);assert.equal(h.source.writes.length,0);
 assert.throws(()=>intentFiles({files:[]}),/invalid_write_files/);
});
test('lost multi-file response verifies every result blob and exact file count without another mutation',async()=>{
 const h=await fixture(),p=await h.makePreview();h.source.mode='lost';assert.equal((await h.apply(p)).state,'uncertain');
 const original=structuredClone(h.source.commits[0]);
 for(const change of [c=>c.content+='wrong',c=>c.outputs[evidence]+='wrong',c=>c.outputs[roadmap]+='wrong',c=>delete c.outputs[evidence],c=>c.files.push({filename:'extra.md'}),c=>c.parents[0].sha='e'.repeat(40),c=>c.commit.message='wrong']){
  h.source.commits[0]=structuredClone(original);change(h.source.commits[0]);assert.equal((await h.recover(p)).state,'uncertain');
 }
 h.source.commits[0]=original;assert.equal((await h.recover(p)).state,'committed');assert.equal(h.source.writes.length,1);
});
test('truncated, missing or unknown multi-file proof stays uncertain even with matching text',async()=>{
 const h=await fixture(),p=await h.makePreview();h.source.mode='lost';await h.apply(p);
 for(const mutate of [r=>r.blob1.isTruncated=true,r=>r.blob2.byteSize++,r=>r.blob1.oid='e'.repeat(40),r=>r.commit.changedFilesIfAvailable=null,r=>r.blob1=null]){
  const fetcher=async(url,options)=>{const response=await h.fetcher(url,options);if(new URL(url).pathname==='/graphql'&&JSON.parse(options.body).query.startsWith('query DecisionCommitProof')){const result=await response.json();mutate(result.data.node);return Response.json(result);}return response;};
  const ops=createOperations(h.config,{...h.options,fetcher});assert.equal((await ops.recover(h.access,token,h.project,p.operationId)).state,'uncertain');
 }
 assert.equal((await h.recover(p)).state,'committed');assert.equal(h.source.writes.length,1);
});
test('uncertain walks share project reservations with decisions and never release on lease expiry',async()=>{
 const h=await fixture(),p=await h.makePreview(),next=await h.makePreview(),decision=await createDecisions(h.config,h.options).preview(h.access,token,h.project,{target:healthTarget,choice:'accept'});
 h.source.mode='never';assert.equal((await h.apply(p)).state,'uncertain');h.state.now+=61000;
 await assert.rejects(h.apply(next),e=>e.code==='project_busy');
 await assert.rejects(h.ops.apply(h.access,token,h.project,decision.id,{reauthorize:async()=>h.access}),e=>e.code==='project_busy');
 assert.equal((await h.recover(p)).state,'uncertain');assert.equal(h.source.writes.length,1);
});
test('historical result reader verifies exact repository, commit, path and binary bytes without fetching preview URLs',async()=>{
 const h=await fixture(),revision='e'.repeat(40),path='docs/previews/acme.png',bytes=Buffer.from([0,255,128,1]);
 h.source.revisions[revision]={[path]:bytes};h.source.files[path]='A different current result';
 const provider=createDecisionGitHub(token,h.options),result=await provider.readResult(h.project,revision,path);
 assert.deepEqual(result,{bytes,blob:gitBlob(bytes),commit:revision});
 await assert.rejects(provider.readResult(h.project,'main',path),e=>e.code==='invalid_result');
 await assert.rejects(provider.readResult(h.project,revision,'../secret'),e=>e.code==='invalid_result');
 await assert.rejects(provider.readResult(h.project,'f'.repeat(40),path),e=>e.code==='result_unavailable');
 for(const mutate of [r=>r.databaseId=999,r=>r.commit.oid='f'.repeat(40),r=>r.commit.file.mode=40960,r=>r.commit.repository.id='wrong']){
  const fetcher=async(url,options)=>{const response=await h.fetcher(url,options);if(new URL(url).pathname==='/graphql'&&JSON.parse(options.body).query.startsWith('query DecisionResult')){const data=await response.json();mutate(data.data.node);return Response.json(data);}return response;};
  await assert.rejects(createDecisionGitHub(token,{fetcher}).readResult(h.project,revision,path),e=>e.code==='result_unavailable');
 }
 const tampered=async(url,options)=>{const response=await h.fetcher(url,options);if(new URL(url).pathname.includes('/git/blobs/')){const data=await response.json();data.content=Buffer.from('wrong').toString('base64');return Response.json(data);}return response;};
 await assert.rejects(createDecisionGitHub(token,{fetcher:tampered}).readResult(h.project,revision,path),e=>e.code==='result_unavailable');
});
