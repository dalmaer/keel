import { writeName } from '../names.mjs';
import { requestJson, hash, seal, unseal, WebError } from './common.mjs';
export function createOperationStore(config, fetcher = fetch) {
 const scopeFor = (actor, project) => hash(JSON.stringify([config.appId,config.installationId,config.workspace.repoId,config.workspace.id,actor,project.repoId,project.id]));
 const projectFor = project => hash(JSON.stringify([config.appId,config.installationId,config.workspace.repoId,project.repoId]));
 async function rpc(operation,id,scope,opts={}) {
  const result=await requestJson(fetcher,`${config.storageUrl}/rest/v1/rpc/${writeName('database:keel_decision_rpc')}`,{method:'POST',headers:{apikey:config.storageKey,Authorization:`Bearer ${config.storageKey}`,'Content-Type':'application/json'},body:JSON.stringify({p_operation:operation,p_id:id,p_scope:scope,p_project:null,p_preview:null,p_fence:null,p_value:null,...opts})},1100000);
  if(!result||result.conflict)return result;
  if(typeof result.value!=='string')throw new WebError('invalid_operation_response');
  return {...result,value:unseal(result.value,config.encryptionKey,`decision:${scope}:${result.id??id}`)};
 }
 const encrypted=(id,scope,value)=>seal(value,config.encryptionKey,`decision:${scope}:${id}`);
 async function list(scope,project,{after=null,limit=20}={}) {
  const id=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
  if(!id(scope)||!id(project)||(after!==null&&!id(after))||!Number.isInteger(limit)||limit<1||limit>20)throw new WebError('invalid_history_page',400);
  const result=await requestJson(fetcher,`${config.storageUrl}/rest/v1/rpc/${writeName('database:keel_run_history')}`,{method:'POST',headers:{apikey:config.storageKey,Authorization:`Bearer ${config.storageKey}`,'Content-Type':'application/json'},body:JSON.stringify({p_scope:scope,p_project:project,p_after:after,p_limit:limit})},2200000);
  if(!result||!Array.isArray(result.rows)||result.rows.length>limit||typeof result.hasMore!=='boolean'||(result.after!==null&&!id(result.after))||result.hasMore!==(result.after!==null)||result.hasMore&&result.after!==result.rows.at(-1)?.id)throw new WebError('invalid_history_response');
  const seen=new Set();
  const rows=result.rows.map(row=>{
   if(!id(row.id)||seen.has(row.id)||!id(row.previewId)||!['prepared','dispatched','uncertain','committed','refused'].includes(row.state)||typeof row.value!=='string'||row.timeBasis!=='inferred-preview-created-at'||typeof row.recordedAt!=='string'||!Number.isFinite(Date.parse(row.recordedAt)))throw new WebError('invalid_history_response');
   seen.add(row.id);
   return {...row,recordedAt:new Date(row.recordedAt).toISOString(),value:unseal(row.value,config.encryptionKey,`decision:${scope}:${row.id}`)};
  });
  return {rows,after:result.after,hasMore:result.hasMore};
 }
 return {scopeFor,projectFor,list,
  createPreview:(id,scope,value)=>rpc('preview-create',id,scope,{p_value:encrypted(id,scope,value)}),
  preview:(id,scope)=>rpc('preview-read',id,scope),
  reserve:(id,scope,project,preview,fence,value)=>rpc('reserve',id,scope,{p_project:project,p_preview:preview,p_fence:fence,p_value:encrypted(id,scope,value)}),
  read:(id,scope)=>rpc('read',id,scope),
  transition:(state,id,scope,fence,value)=>rpc(state,id,scope,{p_fence:fence,p_value:value?encrypted(id,scope,value):null}),
 };
}
