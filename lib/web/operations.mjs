import { createDecisions } from './decisions.mjs';
import { createDecisionGitHub, intentFiles } from './decision-github.mjs';
import { createOperationStore } from './operation-store.mjs';
import { hash, random, WebError } from './common.mjs';
const idValid=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
function walkFiles(preview) {
 const files=intentFiles(preview),roles=new Set();
 for(const file of files){const role=/^docs\/phases\/[^/]+\.md$/.test(file.path)?'phase':/^docs\/evidence\/[^/]+\.md$/.test(file.path)?'evidence':file.path==='docs/ROADMAP.md'?'roadmap':null;
  if(!role||roles.has(role))throw new WebError('invalid_write_files',400);roles.add(role);
 }
 if(!roles.has('phase')||!roles.has('evidence'))throw new WebError('invalid_write_files',400);
 return files;
}
export function createOperations(config,{fetcher=fetch,now=Date.now,inspectWalk}={}) {
 const store=createOperationStore(config,fetcher), decisions=createDecisions(config,{fetcher,now});
 const view=row=>({schema:1,id:row.id,previewId:row.value.previewId,projectId:row.value.projectId,...(row.value.kind==='walk'?{kind:'walk'}:{}),state:row.state,reason:row.value.reason??(row.state==='refused'?'This operation was not dispatched before its reservation expired.':null),receipt:row.value.receipt??null});
 async function recover(access,token,project,id) {
  if(!idValid(id))throw new WebError('invalid_operation',400);
  const scope=store.scopeFor(access.userId,project);let row=await store.read(id,scope);
  if(!row)throw new WebError('operation_not_found',404);
  if(row.state==='prepared'&&Date.parse(row.leaseUntil)<=now()) {
   row=await store.transition('refused',id,scope,row.value.fence,{...row.value,reason:'Preparation expired before dispatch.'})??row;
  }
  if(['dispatched','uncertain'].includes(row.state)) {
   try {
    const found=await createDecisionGitHub(token,{fetcher}).recover(row.value.intent);
    if(found){const value={...row.value,reason:null,receipt:{...found,...receiptPaths(row.value.intent),actorId:row.value.actorId,recordedAt:new Date(now()).toISOString(),acceptance:'not-established'}};
     row=await store.transition('committed',id,scope,row.value.fence,value)??row;
    }
   }catch(error){if([401,404].includes(error.status))throw error;}
  }
  return view(row);
 }
 async function apply(access,token,project,previewId,{reauthorize,publicAcknowledgement}={}) {
  if(config.decisionWrites!==true)throw new WebError('submission_disabled',403);
  if(!idValid(previewId))throw new WebError('invalid_preview',400);
  const scope=store.scopeFor(access.userId,project),saved=await store.preview(previewId,scope);
  if(!saved||Date.parse(saved.value.expiresAt)<=now())throw new WebError('preview_expired',410);
  const preview=saved.value;
  if(preview.actorId!==access.userId||preview.project.repoId!==project.repoId||preview.project.id!==project.id)throw new WebError('access_denied',404);
  const walk=preview.kind==='walk';
  if(preview.kind!==undefined&&!walk)throw new WebError('invalid_preview',400);
  if(walk&&preview.visibility==='public'&&(!idValid(preview.digest)||publicAcknowledgement!==preview.digest))throw new WebError('public_acknowledgement_required',400);
  const files=walk?walkFiles(preview):null;
  const id=preview.operationId,fence=hash(random()),intent={id,repo:project.repo,repoId:project.repoId,repositoryNodeId:preview.source.repositoryNodeId,branchNodeId:preview.source.branchNodeId,...(walk?{files}:{originalBlob:preview.source.blob,path:preview.source.path,content:preview.content}),branch:preview.source.branch,head:preview.source.head,commitMessage:preview.commitMessage,marker:`Keel-Operation: ${id}`};
  let value={previewId,projectId:project.id,actorId:access.userId,...(walk?{kind:'walk'}:{}),fence,intent,reason:null,receipt:null};
  let row=await store.reserve(id,scope,store.projectFor(project),previewId,fence,value);
  if(row?.conflict)throw new WebError('project_busy',409);
  if(!row)throw new WebError('preview_expired',410);
  if(!row.created)return view(row);
  let provider;
  try {
   if(walk&&typeof inspectWalk!=='function')throw new WebError('walk_inspection_unavailable',503);
   const checked=walk?await inspectWalk(access,token,project,preview):await decisions.inspect(access,token,project,preview.target);
   if(!checked.model.supported||!checked.canWrite)throw new WebError('decision_no_longer_writable',409);
   const source=checked.model.source;
   if(source.repoId!==preview.source.repoId||source.repositoryNodeId!==preview.source.repositoryNodeId||source.branchNodeId!==preview.source.branchNodeId||source.head!==preview.source.head||source.branch!==preview.source.branch||source.visibility!==preview.visibility||checked.model.context.digest!==preview.contextDigest)throw new WebError('stale_preview',409);
   if(walk?JSON.stringify(walkFiles({files:checked.files}))!==JSON.stringify(files):source.blob!==preview.source.blob||hash(checked.raw)!==preview.originalHash)throw new WebError('stale_preview',409);
   if(typeof reauthorize!=='function')throw new WebError('authorization_recheck_required',403);
   const fresh=await reauthorize();
   if(fresh.userId!==access.userId||fresh.contentsPermission!=='write'||fresh.sourceRevision!==preview.sourceRevision||!fresh.projects.some(p=>p.id===project.id&&p.repoId===project.repoId&&p.repo===project.repo))throw new WebError('access_changed',409);
   if(Date.parse(preview.expiresAt)<=now())throw new WebError('preview_expired',410);
   provider=checked.provider;
   await provider.recheck(project,preview.source);
  } catch(error) {
   value={...value,reason:error instanceof WebError?error.code:'validation_unavailable'};
   row=await store.transition('refused',id,scope,fence,value);
   if(!row)throw new WebError('operation_conflict',409);
   return view(row);
  }
  row=await store.transition('dispatched',id,scope,fence);
  if(!row)throw new WebError('operation_conflict',409);
  try {
   const commit=await provider.dispatch(intent),found=await provider.recover(intent,commit);
   if(!found)throw new WebError('remote_uncertain');
   value={...value,receipt:{...found,...receiptPaths(intent),actorId:access.userId,recordedAt:new Date(now()).toISOString(),acceptance:'not-established'}};
   const completed=await store.transition('committed',id,scope,fence,value);
   return view(completed??row);
  }catch(error){
   const state=error.code==='remote_refused'?'refused':'uncertain';
   value={...value,reason:state==='refused'?'The remote conditional commit was refused. No alternate destination was attempted.':'The source write outcome is uncertain. Recover this original operation; do not resubmit.'};
   try{row=await store.transition(state,id,scope,fence,value)??row;}catch{/* Durable dispatched intent still blocks any duplicate write. */}
   return view(row);
  }
 }
 return {apply,recover};
}
function receiptPaths(intent){return intent.files?{paths:intent.files.map(file=>file.path)}:{path:intent.path};}
