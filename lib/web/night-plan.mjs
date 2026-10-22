import { featureRestoreReady } from './recovery.mjs';
import {createDaily} from './daily.mjs';
import {validateDraftInput} from './daily-model.mjs';
import {createDecisionGitHub,gitBlob} from './decision-github.mjs';
import {createOperationStore} from './operation-store.mjs';
import {createNightPlanGitHub} from './night-plan-github.mjs';
import {PLAN,planChanges,planDigest} from './night-plan-model.mjs';
import {hash,random,WebError} from './common.mjs';
const idValid=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function authorize(access,project) {
  if(!access?.projects?.some(p=>p.id===project.id&&p.repoId===project.repoId&&p.repo===project.repo))throw new WebError('access_denied',404);
}
const policyCoverage='Policy was rechecked before dispatch. The canonical plan branch commit is conditional; the default policy ref is not part of that atomic condition.';
const enabled=(config,now)=>config.nightOperations?.planWrites===true&&typeof config.nightOperations.verifiedAt==='string'&&typeof config.nightOperations.restoreReconciledAt==='string'&&featureRestoreReady(config,config.nightOperations.restoreReconciledAt,now);
export function createNightPlan(config,{fetcher=fetch,now=Date.now}={}) {
  const store=createOperationStore(config,fetcher),daily=createDaily(config,{fetcher,now});
  const view=row=>({schema:1,kind:'night-plan',id:row.id,previewId:row.value.previewId,projectId:row.value.projectId,state:row.state,reason:row.value.reason??null,receipt:row.value.receipt??null});
  async function inspect(access,token,project,input) {
    authorize(access,project);validateDraftInput(input);
    const current=await daily.publication(access,token,project,input.date);
    if(current.model.sourceDigest!==input.sourceDigest)throw new WebError('daily_source_changed',409);
    if(!current.model.capabilities.nightPlan.review)throw new WebError(current.canonical?'night_plan_not_writable':'night_plan_setup_required',409);
    if(input.plan.date!==input.date)throw new WebError('invalid_night_plan',400);
    const provider=createNightPlanGitHub(token,{fetcher});
    const openRobotPrs=await provider.openRobotPrs(project,current.canonical.source);
    const changes=planChanges(current.canonical.plan,input.plan,current.config,{openRobotPrs,now:now()});
    if(gitBlob(changes.content)===current.canonical.blob)throw new WebError('night_plan_unchanged',409);
    return {...current,...changes,provider};
  }
  async function preview(access,token,project,input) {
    const checked=await inspect(access,token,project,input),id=hash(random()),operationId=hash(`night-plan:${id}`);
    const source={...checked.canonical.source,blob:checked.canonical.blob,path:PLAN,defaultSource:checked.model.source};
    const commitMessage=`Publish Keel night plan for ${input.date} by GitHub user ${access.userId}\n\nKeel-Operation: ${operationId}`;
    const reviewed={kind:'night-plan',project,date:input.date,actorId:access.userId,source,sourceDigest:input.sourceDigest,policy:checked.policy,policyCoverage,rollover:checked.rollover,before:checked.canonical.raw,content:checked.content,commitMessage};
    const result={schema:1,...reviewed,id,digest:planDigest(reviewed),operationId,operationUrl:`/projects/${project.id}/night-plan/operations/${operationId}`,expiresAt:new Date(now()+900000).toISOString(),visibility:source.visibility,files:[{path:PLAN,originalBlob:source.blob,content:checked.content}],canSubmit:enabled(config,now()),refusal:enabled(config,now())?null:'Night plan publication is disabled until its storage and write activation are verified.',consequence:checked.rollover?'Replace the older current plan for the upcoming UTC night. Its complete bytes remain in the parent commit history. Only reviewed measurement and triage items are introduced; no run starts.':'Append the reviewed canonical plan while preserving existing builds, owner lines and progress. No run starts and no additional build budget is granted.'};
    // Store canonical output once; display-only before/files and parsed input duplicate up to 256KiB each.
    const {before:ignoredBefore,files:ignoredFiles,...stored}=result;
    if(!await store.createPreview(id,store.scopeFor(access.userId,project),{...stored,input:{date:input.date,sourceDigest:input.sourceDigest},sourceRevision:access.sourceRevision}))throw new WebError('preview_conflict',409);
    return result;
  }
  async function recover(access,token,project,id) {
    authorize(access,project);if(!idValid(id))throw new WebError('invalid_operation',400);
    const scope=store.scopeFor(access.userId,project);let row=await store.read(id,scope);
    if(!row||row.value.kind!=='night-plan'||row.value.actorId!==access.userId||row.value.projectId!==project.id)throw new WebError('operation_not_found',404);
    if(row.state==='prepared'&&Date.parse(row.leaseUntil)<=now())row=await store.transition('refused',id,scope,row.value.fence,{...row.value,reason:'Preparation expired before dispatch.'})??row;
    if(['dispatched','uncertain'].includes(row.state)) {
      try {
        const found=await createDecisionGitHub(token,{fetcher}).recover(row.value.intent);
        if(found)row=await store.transition('committed',id,scope,row.value.fence,{...row.value,reason:null,receipt:receipt(found,row.value)})??row;
      } catch(error) {if([401,404].includes(error.status))throw error;}
    }
    return view(row);
  }
  function receipt(found,value) {return {...found,path:PLAN,branch:value.intent.branch,actorId:value.actorId,recordedAt:new Date(now()).toISOString(),execution:'not-started',acceptance:'not-established',reviewedDefaultSource:value.reviewedDefaultSource,policyDigest:value.policyDigest,policyCoverage};}
  async function apply(access,token,project,previewId,{reauthorize,publicAcknowledgement}={}) {
    authorize(access,project);if(!enabled(config,now()))throw new WebError('night_plan_disabled',403);
    if(!idValid(previewId))throw new WebError('invalid_preview',400);
    const scope=store.scopeFor(access.userId,project),saved=await store.preview(previewId,scope),preview=saved?.value;
    if(!preview||preview.kind!=='night-plan')throw new WebError('invalid_preview',400);
    if(Date.parse(preview.expiresAt)<=now())throw new WebError('preview_expired',410);
    if(preview.actorId!==access.userId||preview.project.id!==project.id||preview.project.repoId!==project.repoId||preview.project.repo!==project.repo)throw new WebError('access_denied',404);
    if(preview.visibility==='public'&&publicAcknowledgement!==preview.digest)throw new WebError('public_acknowledgement_required',400);
    const id=preview.operationId,fence=hash(random()),intent={id,repo:project.repo,repoId:project.repoId,repositoryNodeId:preview.source.repositoryNodeId,branchNodeId:preview.source.branchNodeId,branch:preview.source.branch,head:preview.source.head,path:PLAN,originalBlob:preview.source.blob,content:preview.content,commitMessage:preview.commitMessage,marker:`Keel-Operation: ${id}`};
    let value={kind:'night-plan',previewId,projectId:project.id,actorId:access.userId,fence,intent,reviewedDefaultSource:preview.source.defaultSource,policyDigest:planDigest(preview.policy),reason:null,receipt:null};
    let row=await store.reserve(id,scope,store.projectFor(project),previewId,fence,value);
    if(row?.conflict)throw new WebError('project_busy',409);
    if(!row)throw new WebError('preview_expired',410);
    if(!row.created)return view(row);
    try {
      const checked=await inspect(access,token,project,{...preview.input,plan:JSON.parse(preview.content)});
      const currentSource={...checked.canonical.source,blob:checked.canonical.blob,path:PLAN,defaultSource:checked.model.source};
      if(planDigest(currentSource)!==planDigest(preview.source)||checked.content!==preview.content||planDigest(checked.policy)!==planDigest(preview.policy))throw new WebError('stale_preview',409);
      if(typeof reauthorize!=='function')throw new WebError('authorization_recheck_required',403);
      const fresh=await reauthorize();authorize(fresh,project);
      if(fresh.userId!==access.userId||fresh.contentsPermission!=='write'||fresh.sourceRevision!==preview.sourceRevision)throw new WebError('access_changed',409);
      if(Date.parse(preview.expiresAt)<=now())throw new WebError('preview_expired',410);
      await checked.provider.recheck(project,preview.source,preview.source.defaultSource);
      if(Date.parse(preview.expiresAt)<=now())throw new WebError('preview_expired',410);
    } catch(error) {
      row=await store.transition('refused',id,scope,fence,{...value,reason:error instanceof WebError?error.code:'validation_unavailable'});
      if(!row)throw new WebError('operation_conflict',409);
      return view(row);
    }
    row=await store.transition('dispatched',id,scope,fence);
    if(!row)throw new WebError('operation_conflict',409);
    try {
      const provider=createDecisionGitHub(token,{fetcher}),commit=await provider.dispatch(intent),found=await provider.recover(intent,commit);
      if(!found)throw new WebError('remote_uncertain',503);
      value={...value,receipt:receipt(found,value)};
      return view(await store.transition('committed',id,scope,fence,value)??row);
    } catch(error) {
      const state=error.code==='remote_refused'?'refused':'uncertain';
      value={...value,reason:state==='refused'?'The exact conditional plan commit was refused. Refresh and review before another publication.':'The publication outcome is uncertain. Recover this original receipt; do not resubmit.'};
      try {row=await store.transition(state,id,scope,fence,value)??row;}catch{/* The dispatched intent remains authoritative; never repeat the write. */}
      return view(row);
    }
  }
  return {preview,apply,recover};
}
