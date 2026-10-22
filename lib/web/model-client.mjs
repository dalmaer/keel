import {modelPolicyPreview,modelPolicyReceipt,modelPreparationView,modelQuoteView,modelAttemptBody,modelAttemptPath,modelReason,policyLimits,modelTaskForm,modelHeading} from './model-views.mjs';
export async function modelRequest(fetcher,url,data) {
  try {
    const response=await fetcher(url,{method:data===undefined?'GET':'POST',credentials:'same-origin',headers:data===undefined?{}:{'content-type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(58000)});
    return {status:response.status,data:await response.json()};
  } catch {return {status:0,data:{error:'request_unavailable'}};}
}
const identity=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function readModelPolicy(form,project=null) {
  const value=name=>form.querySelector(`[name="${name}"]`)?.value;
  const checked=name=>!!form.querySelector(`[name="${name}"]`)?.checked;
  return {version:1,enabled:checked('enabled'),taskClass:value('taskClass'),adapter:'project-evidence-brief-v1',automaticFallback:checked('automaticFallback'),
    candidates:[...form.querySelectorAll('[data-model-candidate]')].map(row=>({id:row.querySelector('[name="candidate-id"]').value,connectionId:row.querySelector('[name="connectionId"]').value,model:row.querySelector('[name="model"]').value,unknownCapacity:row.querySelector('[name="unknownCapacity"]').value})),
    requirements:{minimumContext:Number(value('minimumContext')),privacy:checked('retention')?'allow-temporary-provider-retention':'no-provider-retention',independentReview:checked('independentReview')},
    limits:Object.fromEntries(policyLimits.map(([key])=>[key,Number(value(key))])),capacity:Object.fromEntries(['maxAgeSeconds','reservePercent','cooldownSeconds','reentryPercent'].map(key=>[key,Number(value(key))])),
    ...(project?{projectId:project.id,repoId:project.repoId}:{})};
}
export function startModelClient({document=globalThis.document,window=globalThis.window,fetch=globalThis.fetch}={}) {
  const root=document?.querySelector('[data-model-root]');if(!root)return null;
  const initial=root.querySelector('[data-model-data]');let model;
  try {model=JSON.parse(initial.textContent);} catch {return null;}
  const csrf=root.querySelector('[data-model-csrf]')?.value,host=root.querySelector('[data-model-current]'),status=root.querySelector('[data-model-status]');
  let busy=false,submitted=false,preparation=null,quote=null,policyPreview=null,draft=null;
  const say=text=>{status.textContent=text;};
  const api=()=>`/api/projects/${encodeURIComponent(model.project.id)}/model-tasks`;
  function replace(body,title) {
    host.innerHTML=body;const output=root.querySelector('[data-model-output]');if(output)output.innerHTML='';
    document.title=`${title} · Keel`;const heading=host.querySelector?.('h1');heading?.focus?.({preventScroll:true});heading?.scrollIntoView?.({block:'start'});
  }
  function error(response) {
    if(response.status===401) {
      const destination=model.view==='attempt'?modelAttemptPath(model.project.id,model.id):model.view==='policy-operation'?`/model-policy/operations/${model.id}`:window.location?.pathname||'/';
      host.innerHTML=`<h1 tabindex="-1">Sign in to inspect this request</h1><p>Your session expired. The original receipt remains at this URL.</p><a href="/signin?returnTo=${encodeURIComponent(destination)}">Sign in again</a>`;
      say('Sign in again, then reopen the bookmarked original receipt. Do not resubmit an uncertain request.');return true;
    }
    if(response.status!==200){say(modelReason(response.data?.error));return true;}
    return false;
  }
  function freeze() {for(const control of root.querySelectorAll('button,input,select,textarea'))control.disabled=true;}
  async function prepare(input) {
    if(busy||submitted)return;
    if(input.taskId===null)draft=structuredClone(input);
    busy=true;say('Reading selected sources and explaining the model choice…');
    const result=await modelRequest(fetch,api()+'/prepare',{csrf,...input});busy=false;
    if(error(result))return;
    preparation=result.data;quote=null;replace(modelPreparationView(preparation),'Review text and model');
    say('No provider request has been sent. Review the exact text before checking cost.');
  }
  async function checkCost() {
    if(busy||submitted||!preparation?.canCount||!root.querySelector('[data-approve-count]')?.checked)return;
    busy=true;preparation={...preparation,canCount:false};const button=root.querySelector('[data-model-quote]');if(button)button.disabled=true;
    say('Sending the approved text once for token counting…');
    const result=await modelRequest(fetch,api()+'/quote',{csrf,previewId:preparation.id,digest:preparation.digest});busy=false;
    // Counting is an explicit transfer. Loss never causes an automatic retry.
    if(error(result)){preparation={...preparation,canCount:false};say(result.status===0?'The count response is unconfirmed. Return to project planning for a new explicit review; no generation was started.':modelReason(result.data?.error));return;}
    quote=result.data;replace(modelQuoteView(quote,preparation),'Review cost and run');say('Count received. Generation still needs your approval.');
  }
  async function run() {
    if(busy||submitted||!quote?.canRun||!root.querySelector('[data-approve-run]')?.checked)return;
    const requestId=[...window.crypto.getRandomValues(new Uint8Array(32))].map(v=>v.toString(16).padStart(2,'0')).join('');
    const project=model.project,q=quote;submitted=true;busy=true;freeze();
    window.history.replaceState(null,'',modelAttemptPath(project.id,requestId));
    model={view:'attempt',id:requestId,taskId:q.taskId,stage:q.stage,project,state:'unconfirmed',model:q.model,reservedMicroUsd:null,capabilities:{}};
    replace(modelAttemptBody(model),'Original model attempt');say('Submitting the approved attempt once. Keep this receipt.');
    const response=await modelRequest(fetch,api()+'/run',{csrf,requestId,quoteId:q.id,digest:q.digest});busy=false;
    if(error(response))return;
    if(response.data.id!==requestId){say('Receipt identity did not match. Check the original request.');return;}
    model={...response.data,view:'attempt'};replace(modelAttemptBody(model),'Model attempt');say('Original attempt retained. Check it for provider progress.');
  }
  async function act(action) {
    if(busy||!identity(model.id))return;
    if(action==='continue') {
      if(!model.capabilities?.continue)return;
      submitted=false;
      await prepare({taskId:model.taskId});
      return;
    }
    if(!model.capabilities?.[action]&&!(action==='reconcile'&&model.state==='unconfirmed'))return;
    busy=true;say(action==='cancel'?'Requesting cancellation of this attempt…':'Checking the original attempt…');
    const url=api()+'/'+model.id;
    const result=model.state==='unconfirmed'?await modelRequest(fetch,url):await modelRequest(fetch,url+'/'+action,{csrf});busy=false;
    if(result.status===404&&model.state==='unconfirmed'){say('No receipt is visible yet. The original request may still be in flight; do not resubmit.');return;}
    if(error(result))return;
    if(result.data.id!==model.id){say('Receipt identity did not match. Keep the original request.');return;}
    model={...result.data,view:'attempt'};replace(modelAttemptBody(model),'Model attempt');say(action==='cancel'?'Cancellation requested. Provider terminal confirmation is still required.':'Original attempt checked. No replacement request was sent.');
  }
  async function previewPolicy(form) {
    if(busy||submitted||!form.reportValidity())return;
    busy=true;const result=await modelRequest(fetch,'/api/model-policy/preview',{csrf,projectId:model.project?.id||null,policy:readModelPolicy(form,model.project),expectedPolicyDigest:model.expectedPolicyDigest});busy=false;
    if(error(result))return;policyPreview=result.data;replace(modelPolicyPreview(policyPreview),'Review model policy');say('Review the exact private files. No model request has been sent.');
  }
  async function applyPolicy() {
    if(busy||submitted||!policyPreview?.canApply||!root.querySelector('[data-approve-model-policy]')?.checked||!identity(policyPreview.operationId))return;
    submitted=true;busy=true;const p=policyPreview;
    window.history.replaceState(null,'',`/model-policy/operations/${p.operationId}`);
    model={view:'policy-operation',id:p.operationId,state:'uncertain'};replace(modelPolicyReceipt(model),'Model policy receipt');
    const result=await modelRequest(fetch,'/api/model-policy/apply',{csrf,previewId:p.id,digest:p.digest});busy=false;
    if(error(result))return;model={...result.data,view:'policy-operation'};replace(modelPolicyReceipt(model),'Model policy receipt');
  }
  async function recoverPolicy() {
    if(busy||!identity(model.id))return;busy=true;
    const result=await modelRequest(fetch,`/api/model-policy/operations/${model.id}/recover`,{csrf});busy=false;
    if(error(result))return;model={...result.data,view:'policy-operation'};replace(modelPolicyReceipt(model),'Model policy receipt');
  }
  function change() {
    for(const [button,check,allowed] of [['[data-model-quote]','[data-approve-count]',preparation?.canCount],['[data-model-run]','[data-approve-run]',quote?.canRun],['[data-apply-model-policy]','[data-approve-model-policy]',policyPreview?.canApply]]) {
      const control=root.querySelector(button);if(control)control.disabled=busy||submitted||!allowed||!root.querySelector(check)?.checked;
    }
  }
  function candidateOrder() {
    [...root.querySelectorAll('[data-model-candidate]')].forEach((row,index)=>{const legend=row.querySelector('legend');if(legend)legend.textContent=index===0?'Preferred model':`Alternative ${index}`;});
  }
  function click(event) {
    const button=event.target.closest?.('button');if(!button)return;
    if(button.matches('[data-model-edit]')&&!busy&&!submitted&&draft){preparation=null;quote=null;replace(modelHeading('Plan from project evidence')+modelTaskForm(model,draft),'Plan from project evidence');say('Your source selection and instructions are retained in this page only. Review them again before any new transfer.');}
    if(button.matches('[data-model-quote]'))checkCost();
    if(button.matches('[data-model-run]'))run();
    if(button.matches('[data-apply-model-policy]'))applyPolicy();
    if(button.matches('[data-model-policy-recover]'))recoverPolicy();
    for(const action of ['reconcile','cancel','continue'])if(button.matches(`[data-model-${action}]`))act(action);
    if(busy||submitted)return;
    if(button.matches('[data-add-candidate]')) {
      const rows=root.querySelector('[data-model-candidates]'),template=root.querySelector('[data-candidate-template]');
      if(rows.children.length<8)rows.append(template.content.cloneNode(true));else say('The candidate limit has been reached.');
    }
    const row=button.closest?.('[data-model-candidate]');
    if(row&&button.matches('[data-remove-candidate]'))row.remove();
    if(row&&button.matches('[data-move-candidate]')) {
      if(button.dataset.moveCandidate==='up'&&row.previousElementSibling)row.parentNode.insertBefore(row,row.previousElementSibling);
      else if(button.dataset.moveCandidate==='down'&&row.nextElementSibling)row.parentNode.insertBefore(row.nextElementSibling,row);
    }
    candidateOrder();
  }
  function submit(event) {
    if(event.target.matches('[data-model-policy-form]')){event.preventDefault();previewPolicy(event.target);}
    if(event.target.matches('[data-model-task-form]')) {
      event.preventDefault();const form=event.target;if(!form.reportValidity())return;
      const select=form.querySelector('[name="phase"]'),phase=select.value,phasePath=select.selectedOptions[0]?.dataset.phasePath;
      const paths=[...new Set([phasePath,...[...form.querySelectorAll('[name="path"]:checked')].map(v=>v.value)])];
      if(paths.length>8){say('Select at most eight source files, including the phase.');return;}
      prepare({phase,paths,instructions:form.querySelector('[name="instructions"]').value,taskId:null});
    }
  }
  root.addEventListener('click',click);root.addEventListener('change',change);root.addEventListener('submit',submit);
  return {prepare,checkCost,run,act,previewPolicy,applyPolicy,recoverPolicy,stop(){root.removeEventListener('click',click);root.removeEventListener('change',change);root.removeEventListener('submit',submit);}};
}
if(typeof document!=='undefined')startModelClient();
