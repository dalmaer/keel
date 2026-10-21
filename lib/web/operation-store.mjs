import { requestJson, hash, seal, unseal, WebError } from './common.mjs';
export function createOperationStore(config, fetcher = fetch) {
 const scopeFor = (actor, project) => hash(JSON.stringify([config.appId,config.installationId,config.workspace.repoId,config.workspace.id,actor,project.repoId,project.id]));
 const projectFor = project => hash(JSON.stringify([config.appId,config.installationId,config.workspace.repoId,project.repoId]));
 async function rpc(operation,id,scope,opts={}) {
  const result=await requestJson(fetcher,`${config.storageUrl}/rest/v1/rpc/keel_decision_rpc`,{method:'POST',headers:{apikey:config.storageKey,Authorization:`Bearer ${config.storageKey}`,'Content-Type':'application/json'},body:JSON.stringify({p_operation:operation,p_id:id,p_scope:scope,p_project:null,p_preview:null,p_fence:null,p_value:null,...opts})},1100000);
  if(!result||result.conflict)return result;
  if(typeof result.value!=='string')throw new WebError('invalid_operation_response');
  return {...result,value:unseal(result.value,config.encryptionKey,`decision:${scope}:${result.id??id}`)};
 }
 const encrypted=(id,scope,value)=>seal(value,config.encryptionKey,`decision:${scope}:${id}`);
 return {scopeFor,projectFor,
  createPreview:(id,scope,value)=>rpc('preview-create',id,scope,{p_value:encrypted(id,scope,value)}),
  preview:(id,scope)=>rpc('preview-read',id,scope),
  reserve:(id,scope,project,preview,fence,value)=>rpc('reserve',id,scope,{p_project:project,p_preview:preview,p_fence:fence,p_value:encrypted(id,scope,value)}),
  read:(id,scope)=>rpc('read',id,scope),
  transition:(state,id,scope,fence,value)=>rpc(state,id,scope,{p_fence:fence,p_value:value?encrypted(id,scope,value):null}),
 };
}
