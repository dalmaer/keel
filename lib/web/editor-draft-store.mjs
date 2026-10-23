import {exact,hash,requestJson,seal,unseal,WebError} from './common.mjs';
export const draftDigest=v=>hash(JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x));
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export function createEditorDraftStore(config,fetcher=fetch) {
  async function rpc(operation,actor,project,kind,target,input={}) {
    const scope=hash(JSON.stringify(['editor-draft-v1',config.appId,config.installationId,config.workspace.id,config.workspace.repoId,actor,project?{id:project.id,repoId:project.repoId}:null,kind,target]));
    const purpose=`editor-draft-v1:${scope}`,digest=operation==='save'?draftDigest({baseDigest:input.baseDigest,payload:input.payload}):null;
    const requestDigest=operation==='read'?null:draftDigest({operation,expectedRevision:input.expectedRevision,digest});
    const value=operation==='save'?seal({baseDigest:input.baseDigest,payload:input.payload},config.encryptionKey,purpose):null;
    const result=await requestJson(fetcher,`${config.storageUrl}/rest/v1/rpc/keel_editor_draft_rpc`,{method:'POST',headers:{apikey:config.storageKey,Authorization:`Bearer ${config.storageKey}`,'Content-Type':'application/json'},body:JSON.stringify({p_operation:operation,p_scope:scope,p_expected:input.expectedRevision??null,p_request:input.saveId??null,p_request_digest:requestDigest,p_digest:digest,p_value:value})},220000);
    if(result?.conflict)throw new WebError('editor_draft_conflict',409);
    if(result?.capacity)throw new WebError('editor_draft_capacity',413);
    if(!exact(result,['revision','state','digest','saveId','savedAt','expiresAt','value'])||!Number.isSafeInteger(result.revision)||result.revision<1||!['empty','saved','expired','deleted'].includes(result.state)
      ||!(result.digest===null||hex(result.digest))||!(result.saveId===null||hex(result.saveId))||!(result.savedAt===null||stamp(result.savedAt))||!(result.expiresAt===null||stamp(result.expiresAt)))throw new WebError('invalid_editor_storage');
    let data={baseDigest:null,payload:null};
    if(result.state==='saved') {
      if(typeof result.value!=='string'||!hex(result.digest)||!hex(result.saveId)||!stamp(result.savedAt)||!stamp(result.expiresAt)||result.revision<1)throw new WebError('invalid_editor_storage');
      data=unseal(result.value,config.encryptionKey,purpose);
      if(!exact(data,['baseDigest','payload'])||!hex(data.baseDigest)||draftDigest(data)!==result.digest)throw new WebError('invalid_editor_storage');
    }else if(result.value!==null||result.digest!==null)throw new WebError('invalid_editor_storage');
    const {value:_,...safe}=result;return {...safe,...data};
  }
  return {read:(a,p,k,t)=>rpc('read',a,p,k,t),save:(a,p,k,t,i)=>rpc('save',a,p,k,t,i),remove:(a,p,k,t,i)=>rpc('delete',a,p,k,t,i)};
}
