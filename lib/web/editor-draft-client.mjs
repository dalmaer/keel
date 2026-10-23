import {clearPrivateView,startSafety} from './safety-client.mjs';
const random=window=>[...window.crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');
export async function editorRequest(fetch,url,body) {
  try{const r=await fetch(url,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(58000),headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
  catch{return {status:0,data:{error:'request_unavailable'}};}
}
export function startEditorDraft({root,document,window,fetch,csrf,kind,target,projectId=null,readPayload,restore,baseDigest,storageEnabled=false,onSaved=()=>{},onDiscard=()=>{},onAccessLost=()=>{}}) {
  let row=null,dirty=false,busy=false,uncertain=null,generation=0,locked=false;
  const endpoint=`/api/editor-drafts/${kind}/${encodeURIComponent(target)}`+(projectId?`?project=${encodeURIComponent(projectId)}`:'');
  const endpointFor=action=>`/api/editor-drafts/${kind}/${encodeURIComponent(target)}/${action}`+(projectId?`?project=${encodeURIComponent(projectId)}`:'');
  function controls(){return root.querySelector('[data-editor-draft]');}
  function ensure(){if(!controls()&&document.createElement){const section=document.createElement('section');section.setAttribute('data-editor-draft','');section.innerHTML='<h2>Private editor draft</h2><p>Saved content is never approval. Unsaved offline text exists only in this page.</p><button type="button" data-draft-save>Save private draft</button><button type="button" data-draft-load>Load saved draft</button><button type="button" data-draft-delete>Delete saved draft</button><p role="status" data-draft-status></p>';root.append(section);}}
  function say(message){const status=controls()?.querySelector('[data-draft-status]');if(status)status.textContent=message;}
  function disabled(){for(const b of controls()?.querySelectorAll('button')||[])b.disabled=busy||locked||row?.enabled===false||(b.hasAttribute('data-draft-save')||b.hasAttribute('data-draft-delete'))&&(!row||!!uncertain);}
  function denied(r){if([401,403,404].includes(r.status)&&r.data?.error!=='editor_drafts_disabled'){locked=true;clearPrivateView({root,document,window});return true;}return false;}
  async function refresh(load=false){
    if(busy||locked)return false;busy=true;disabled();const r=await editorRequest(fetch,endpoint);busy=false;if(locked||denied(r))return false;
    if(r.status!==200){say('Saved draft unavailable. Unsaved text remains only here.');disabled();return false;}
    const prior=uncertain;row=r.data;
    if(!row.enabled){say('Private draft storage is disabled. Edits remain in this page only.');disabled();return false;}
    if(prior){if(row.saveId===prior.id&&row.state===prior.state){uncertain=null;if(prior.generation===generation){dirty=false;onSaved();}say('Original save confirmed by readback.');}
      else {uncertain=null;say('Conflict: the saved generation differs. Your unsaved edits are unchanged. Review before saving again.');disabled();return false;}}
    if(prior&&prior.generation!==generation){say('Original save checked. Newer unsaved edits remain in this page.');disabled();return true;}
    if(load&&row.state==='saved') {restore(structuredClone(row.payload));generation++;dirty=false;baseDigest=row.baseDigest;say(row.stale?'Source changed. Authored text restored; fresh review is required.':'Saved private draft loaded. Review before any action.');}
    else if(!prior)say(row.state==='saved'?`Saved draft available${row.stale?' from an earlier source':''}. Load explicitly to replace this editor.`:`No active saved draft (${row.state}). Unsaved text remains here.`);
    disabled();return true;
  }
  async function save(){
    if(busy||locked||uncertain||!row?.enabled||window.navigator?.onLine===false)return false;
    let payload;try{payload=readPayload();}catch{say('Complete the editor fields before saving.');return false;}
    const saveId=random(window),started=generation;busy=true;disabled();say('Saving privately…');
    const r=await editorRequest(fetch,endpointFor('save'),{csrf,expectedRevision:row.revision,saveId,baseDigest,payload});busy=false;if(locked||denied(r))return false;
    if(r.status===200&&r.data.saveId===saveId&&r.data.state==='saved'){row=r.data;if(started===generation){dirty=false;onSaved();}say(row.stale?'Saved against an earlier source. Fresh review remains required.':'Saved privately for 30 days. This is not approval.');disabled();return !dirty;}
    if(r.status===0||r.status>=500){uncertain={id:saveId,generation:started,state:'saved'};say('Save unconfirmed. Load saved state to check the original save; do not repeat it.');}
    else say(r.status===409?'Conflict. Load saved state before another save; unsaved text remains here.':'Save refused. Unsaved text remains only in this page.');
    disabled();return false;
  }
  async function remove(){if(busy||locked||uncertain||!row?.enabled)return false;const saveId=random(window);busy=true;disabled();const r=await editorRequest(fetch,endpointFor('delete'),{csrf,expectedRevision:row.revision,saveId});busy=false;if(locked||denied(r))return false;
    if(r.status===200&&r.data.saveId===saveId){row=r.data;dirty=true;generation++;say('Saved draft deleted. Current editor text was not submitted.');}
    else if(r.status===0||r.status>=500){uncertain={id:saveId,generation:-1,state:'deleted'};say('Deletion unconfirmed. Load saved state before another change.');}else say('Deletion refused; a newer draft may exist.');disabled();return r.status===200;}
  function edited(event){if(locked)return;if(event.target.closest?.('[data-editor-draft]')||!event.target.closest?.('[data-model-task-form],[data-model-policy-form],[data-evening-form]'))return;dirty=true;generation++;say('Unsaved. Offline text exists only in this page.');}
  const click=event=>{if(locked)return;const b=event.target.closest?.('button');if(!b)return;if(b.hasAttribute('data-draft-save')){event.preventDefault();void save();}if(b.hasAttribute('data-draft-load')){event.preventDefault();if(dirty&&!uncertain&&!window.confirm('Replace unsaved edits with the saved draft?'))return;void refresh(true);}if(b.hasAttribute('data-draft-delete')){event.preventDefault();void remove();}};
  ensure();root.addEventListener('click',click);root.addEventListener('input',edited);root.addEventListener('change',edited);
  const safety=startSafety({root,document,window,readDirty:()=>dirty,save,discard:()=>{dirty=false;onDiscard();},onAccessLost:()=>{locked=true;dirty=false;uncertain=null;row=null;generation++;onAccessLost();}});if(storageEnabled)void refresh(false);else {row={enabled:false};say('Private draft storage is disabled. Edits remain in this page only.');disabled();}
  return {save,load:()=>refresh(true),refresh:()=>refresh(false),remove,markDirty(){if(!locked){dirty=true;generation++;}},getState:()=>({row,dirty,uncertain,busy}),stop(){root.removeEventListener('click',click);root.removeEventListener('input',edited);root.removeEventListener('change',edited);safety?.stop();}};
}
