import {clearPrivateView} from './safety-client.mjs';
import {connectionPolicyPreview,policyReceiptView,connectionCredentialResult,credentialRecoveryPath} from './connection-views.mjs';
export async function connectionRequest(fetch,url,body) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),58000);
  try {
    const response=await fetch(url,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,data:await response.json()};
  } catch {return {status:503,data:{error:'request_unavailable'}};}
  finally {clearTimeout(timer);}
}
export function requestIdentity(crypto) {
  return [...crypto.getRandomValues(new Uint8Array(32))].map(value=>value.toString(16).padStart(2,'0')).join('');
}
const messages={provider_input:'The key or provider scope format was refused before storage. Reload the connection to correct it.',provider_denied:'The provider refused this key or scope. No provider error body is displayed.',provider_scope:'The provider could not verify the requested scope.',provider_timeout:'Provider validation timed out. Inspect the original request before submitting another key.',provider_rate_limited:'Provider validation is rate limited. No inference request was made.',connection_disabled:'Credential setup is not activated.',stale_policy:'Policy changed. Reload the connection before starting a new operation.',invalid_input:'The submitted fields were refused. Check the supported provider, scope and project selection.'};
export const connectionMessage=code=>messages[code]||'The request could not be confirmed. Keep the original operation and check its status; do not submit it again.';
export function startConnectionsClient({document,window,fetch,crypto=window.crypto}) {
  const root=document.querySelector('[data-connections-root]');
  if(!root)return null;
  let model;try{model=JSON.parse(root.querySelector('[data-connections-model]').value);}catch{return null;}
  const csrf=root.querySelector('[data-connections-csrf]')?.value;
  const output=root.querySelector('[data-connections-output]'),status=root.querySelector('[data-connections-status]');
  let busy=false,dispatched=!!model.recovery,preview=null,intent=model.recovery||null,operationId=model.operation?.id||null,generation=0;
  const say=text=>{status.textContent=text;};
  function clearDenied(response) {
    if([401,403,404].includes(response.status)) {
      clearPrivateView({root,document,window});
      return true;
    }
    return false;
  }
  function freeze() {
    dispatched=true;
    for(const control of root.querySelectorAll('[data-policy-form] input,[data-policy-form] select,[data-policy-form] button,[data-credential-form] input,[data-credential-form] button,[data-remove-credential],[data-confirm-remove]'))control.disabled=true;
  }
  async function reviewPolicy(event) {
    event.preventDefault();if(busy||dispatched)return;
    const form=event.currentTarget,field=name=>form.elements.namedItem(name);
    const projects=[...form.querySelectorAll('[name="project"]:checked')].map(input=>model.authorizedProjects?.find(p=>p.id===input.value)).filter(Boolean).map(({id,repoId})=>({id,repoId}));
    const policy={id:field('id').value,provider:field('provider').value,label:field('label').value,enabled:field('enabled').checked,projects,scope:Object.fromEntries(['organization','project','workspace'].map(name=>[name,field(`scope-${name}`).value||null]))};
    const currentGeneration=generation;busy=true;say('Reading the exact private policy preview…');
    const response=await connectionRequest(fetch,'/api/connections/policy/preview',{csrf,policy,expectedPolicyDigest:model.connection?.policyDigest||null});busy=false;
    if(clearDenied(response))return;
    if(currentGeneration!==generation){say('Policy fields changed. Review a fresh preview.');return;}
    if(response.status!==200){say(connectionMessage(response.data.error));return;}
    preview=response.data;output.innerHTML=connectionPolicyPreview(preview,model.workspace);say('Review every project grant and exact private file before approving.');
  }
  async function applyPolicy() {
    if(busy||dispatched||!preview?.canApply||!root.querySelector('[data-approve-policy]')?.checked)return;
    busy=true;freeze();operationId=preview.operationId;say('Applying the reviewed private policy. The original receipt link remains available.');
    const response=await connectionRequest(fetch,'/api/connections/policy/apply',{csrf,previewId:preview.previewId,digest:preview.digest});busy=false;
    if(clearDenied(response))return;
    const operation=response.status===200?response.data:{id:operationId,state:'uncertain',reason:connectionMessage(response.data.error),receipt:null};
    output.innerHTML=policyReceiptView(operation);say('This page retains the original receipt. Reload connections before starting another operation.');
  }
  async function recoverPolicy() {
    if(busy||!operationId)return;busy=true;
    const response=await connectionRequest(fetch,`/api/connections/operations/${operationId}/recover`,{csrf});busy=false;
    if(response.data?.error==='operation_not_found'){say('No receipt is visible for this request yet. Check this original request again; do not redispatch it.');return;}
    if(clearDenied(response))return;
    if(response.status!==200){say(connectionMessage(response.data.error));return;}
    (root.querySelector('[data-policy-receipt]')||output).innerHTML=policyReceiptView(response.data);say('Original policy receipt checked. No policy request was redispatched.');
  }
  async function mutateCredential(action,event) {
    event?.preventDefault();
    if(busy||dispatched||!model.connection)return;
    const keyInput=root.querySelector('[data-key]');
    // Retain a key only for this request; clear the visible control before any await.
    let key=action==='set'?keyInput?.value:null;
    if(keyInput)keyInput.value='';
    if(action==='set'&&!key)return;
    if(action==='remove'&&!root.querySelector('[data-confirm-remove]')?.checked)return;
    intent={requestId:requestIdentity(crypto),expectedVersion:model.connection.credential.version,policyDigest:model.connection.policyDigest,action};
    window.history.replaceState(null,'',credentialRecoveryPath(model.connection.id,intent));
    output.innerHTML=connectionCredentialResult({...intent,state:'uncertain'});
    busy=true;freeze();say('Checking this exact credential operation. Do not submit another request while its outcome is unknown.');
    const body={csrf,...intent};delete body.action;if(action==='set')body.key=key;
    const pending=connectionRequest(fetch,`/api/connections/${encodeURIComponent(model.connection.id)}/${action}`,body);
    key=null;delete body.key;
    const response=await pending;busy=false;
    if(clearDenied(response))return;
    const refused=['provider_input','provider_denied','provider_scope'].includes(response.data?.error);
    const result=response.status===200?response.data:{...intent,state:refused?'refused':'uncertain',credential:null};
    output.innerHTML=connectionCredentialResult(result);say(response.status===200?'Original credential request recorded. Reload before another operation.':connectionMessage(response.data.error));
  }
  async function reconcileCredential() {
    if(busy||!intent)return;busy=true;
    const response=await connectionRequest(fetch,`/api/connections/${encodeURIComponent(model.connection.id)}/reconcile`,{csrf,...intent});busy=false;
    if(clearDenied(response))return;
    if(response.status!==200){say(connectionMessage(response.data.error));return;}
    (root.querySelector('[data-credential-receipt]')||output).innerHTML=connectionCredentialResult(response.data);say('Only the original request metadata was checked. No key was resent and no provider probe ran.');
  }
  const policyForm=root.querySelector('[data-policy-form]'),credentialForm=root.querySelector('[data-credential-form]');
  policyForm?.addEventListener('submit',reviewPolicy);credentialForm?.addEventListener('submit',event=>mutateCredential('set',event));
  function changed(event) {
    if(event.target.closest?.('[data-policy-form]')&&!dispatched){generation++;preview=null;output.innerHTML='';}
    if(event.target.matches?.('[data-approve-policy]'))root.querySelector('[data-apply-policy]').disabled=!event.target.checked;
    if(event.target.matches?.('[data-confirm-remove]'))root.querySelector('[data-remove-credential]').disabled=!event.target.checked;
  }
  function clicked(event) {
    if(event.target.closest?.('[data-apply-policy]'))applyPolicy();
    if(event.target.closest?.('[data-recheck-policy]'))recoverPolicy();
    if(event.target.closest?.('[data-remove-credential]'))mutateCredential('remove');
    if(event.target.closest?.('[data-reconcile-credential]'))reconcileCredential();
  }
  root.addEventListener('input',changed);root.addEventListener('change',changed);root.addEventListener('click',clicked);
  return {reviewPolicy,applyPolicy,recoverPolicy,mutateCredential,reconcileCredential,getIntent:()=>intent,stop(){root.removeEventListener('input',changed);root.removeEventListener('change',changed);root.removeEventListener('click',clicked);}};
}
if(typeof window!=='undefined'&&typeof document!=='undefined')startConnectionsClient({document,window,fetch:window.fetch.bind(window)});
