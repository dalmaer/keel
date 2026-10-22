// Typed authored editors only. A draft is neither a source record nor authority.
import {exact,hash,record,WebError} from './common.mjs';
import {validateModelPolicy} from './model-policy.mjs';
import {createModelRegistry} from './model-registry.mjs';
import {createDaily} from './daily.mjs';
import {createLearning} from './learning.mjs';
import {createEditorDraftStore,draftDigest} from './editor-draft-store.mjs';
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const text=(v,n)=>typeof v==='string'&&Buffer.byteLength(v)<=n&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v);
const date=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\d$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const fail=()=>{throw new WebError('invalid_editor_draft',400);};
export function validateEditorPayload(kind,target,payload,project=null) {
  if(!record(payload)||Buffer.byteLength(JSON.stringify(payload))>131072)fail();
  if(kind==='model-policy') {
    if(target!=='main')fail();validateModelPolicy(payload,!!project);
    if(project&&(payload.projectId!==project.id||payload.repoId!==project.repoId))fail();
  } else if(kind==='model-source') {
    if(!project||target!=='main'||!exact(payload,['phase','paths','instructions'])||typeof payload.phase!=='string'||!/^\d{1,8}$/.test(payload.phase)
      ||!Array.isArray(payload.paths)||payload.paths.length<1||payload.paths.length>8||new Set(payload.paths).size!==payload.paths.length
      ||!payload.paths.every(p=>typeof p==='string'&&p.length<=500&&/^docs\/(phases|evidence|decisions)\/[A-Za-z0-9_./-]+\.md$/.test(p)&&p.split('/').every(x=>x&&!['.','..'].includes(x)))||!text(payload.instructions,4096))fail();
  } else if(kind==='daily') {
    if(!project||!date(target)||!exact(payload,['date','readyBy','willNotTouch','settledToday','leftOpen','items'])||payload.date!==target
      ||!(payload.readyBy===null||text(payload.readyBy,100))||!['willNotTouch','settledToday','leftOpen'].every(k=>Array.isArray(payload[k])&&payload[k].length<=128&&payload[k].every(x=>text(x,4096)))
      ||!Array.isArray(payload.items)||payload.items.length>64||new Set(payload.items.map(x=>x?.id)).size!==payload.items.length)fail();
    for(const item of payload.items) {
      if(!exact(item,['id','title','kind','lane','budget','number'])||!text(item.id,100)||!item.id||!text(item.title,300)||!['measure','triage','review','build'].includes(item.kind)||!text(item.lane,200)
        ||!(item.budget===null||exact(item.budget,['minutes'])&&Number.isFinite(item.budget.minutes)&&item.budget.minutes>=0&&item.budget.minutes<=10080)
        ||!(item.number===null||exact(item.number,['measure','bound','better'])&&text(item.number.measure,1000)&&(item.number.bound===null||Number.isFinite(item.number.bound))&&['','higher','lower'].includes(item.number.better)))fail();
    }
  } else fail();
  return structuredClone(payload);
}
export function createEditorDrafts(config,{fetcher=fetch,now=Date.now}={}) {
  const learning=createLearning(config,{fetcher}),registry=createModelRegistry(config,{fetcher,now}),daily=createDaily(config,{fetcher,now}),store=createEditorDraftStore(config,fetcher);
  async function authorize(access,token,project,kind,target) {
    if(!['daily','model-source','model-policy'].includes(kind)||!(kind==='daily'?date(target):target==='main')||!project&&kind!=='model-policy')fail();
    if(project)learning.authorizedProject(access,project);
    await learning.workspace(access,token);
  }
  async function current(access,token,project,kind,target) {
    if(kind==='daily')return (await daily.inspect(access,token,project,target)).sourceDigest;
    if(kind==='model-source')return draftDigest((await registry.catalogue(access,token,project)).source);
    return (await registry.policy.read(access,token,project)).digest;
  }
  const enabled=()=>config.drafts?.enabled===true&&typeof config.drafts.verifiedAt==='string'&&Number.isFinite(Date.parse(config.drafts.verifiedAt))&&Date.parse(config.drafts.verifiedAt)<=now();
  function view(row,currentDigest){return {schema:1,enabled:true,...row,currentDigest,stale:row.state==='saved'&&row.baseDigest!==currentDigest};}
  async function read(access,token,project,kind,target) {
    await authorize(access,token,project,kind,target);
    if(!enabled())return {schema:1,enabled:false,state:'empty',revision:0,payload:null,reason:'Private editor drafts are not activated.'};
    const row=await store.read(access.userId,project,kind,target),currentDigest=await current(access,token,project,kind,target);
    if(row.payload)validateEditorPayload(kind,target,row.payload,project);
    return view(row,currentDigest);
  }
  async function mutate(access,token,project,kind,target,input,remove=false) {
    await authorize(access,token,project,kind,target);if(!enabled())throw new WebError('editor_drafts_disabled',403);
    if(!exact(input,remove?['expectedRevision','saveId']:['expectedRevision','saveId','baseDigest','payload'])||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1||!hex(input.saveId)||!remove&&!hex(input.baseDigest))fail();
    const currentDigest=await current(access,token,project,kind,target);
    const payload=remove?null:validateEditorPayload(kind,target,input.payload,project);
    // Authored text may be saved against its older source. Restore clearly marks it stale.
    const row=await store[remove?'remove':'save'](access.userId,project,kind,target,{...input,payload});
    return view(row,currentDigest);
  }
  return {read,save:(...args)=>mutate(...args),remove:(...args)=>mutate(...args,true)};
}
