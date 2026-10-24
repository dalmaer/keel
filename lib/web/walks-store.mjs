import { writeName } from '../names.mjs';
import { createOperationStore } from './operation-store.mjs';
import { requestJson, hash, seal, unseal, WebError } from './common.mjs';
import { digestOf } from '../feedback.mjs';
export function createWalkStore(config,fetcher=fetch){
 const scopes=createOperationStore(config,fetcher);
 const idFor=(actor,project,walkId)=>hash(JSON.stringify([scopes.scopeFor(actor,project),'walk-v1',walkId]));
 async function rpc(operation,actor,project,walkId,expected=null,value=null){
  const scope=scopes.scopeFor(actor,project),id=idFor(actor,project,walkId),purpose=`walk:${scope}:${id}`;
  if(value&&Buffer.byteLength(JSON.stringify(value))>1048576)throw new WebError('walk_capacity',413);
  const digest=value?digestOf(value):null;
  const result=await requestJson(fetcher,`${config.storageUrl}/rest/v1/rpc/${writeName('database:keel_walk_rpc')}`,{method:'POST',headers:{apikey:config.storageKey,Authorization:`Bearer ${config.storageKey}`,'Content-Type':'application/json'},body:JSON.stringify({p_operation:operation,p_id:id,p_scope:scope,p_project:scopes.projectFor(project),p_expected:expected,p_digest:digest,p_value:value?seal(value,config.encryptionKey,purpose):null})},1550000);
  if(result===null){if(operation==='read')return null;throw new WebError('invalid_walk_storage');}
  if(result.blocked)throw new WebError('project_busy',409);
  if(result.conflict)throw new WebError('draft_conflict',409);
  if(result.capacity)throw new WebError('walk_capacity',413);
  if(result.id!==id||!Number.isSafeInteger(result.revision)||result.revision<1||typeof result.value!=='string')throw new WebError('invalid_walk_storage');
  const data=unseal(result.value,config.encryptionKey,purpose);
  if(digestOf(data)!==result.digest||data.actorId!==actor||data.projectId!==project.id||data.walkId!==walkId||data.revision!==result.revision)throw new WebError('invalid_walk_storage');
  return {id,revision:result.revision,digest:result.digest,value:data};
 }
 return {idFor,read:(actor,project,id)=>rpc('read',actor,project,id),save:(actor,project,id,expected,value)=>rpc('save',actor,project,id,expected,value)};
}
