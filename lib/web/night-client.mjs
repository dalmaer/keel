// Night controls keep original request identity after transport uncertainty.
export async function nightRequest(fetch,url,body,{timeoutMs=58000}={}) {
  const controller=new AbortController();
  let timer;
  const unavailable=()=>({status:503,data:{error:'request_unavailable'}});
  try {
    return await Promise.race([
      (async()=>{
        const response=await fetch(url,{
          method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,
          headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},
          ...(body===undefined?{}:{body:JSON.stringify(body)}),
        });
        return {status:response.status,data:await response.json()};
      })(),
      new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(unavailable());},timeoutMs);}),
    ]);
  } catch {return unavailable();}
  finally {clearTimeout(timer);controller.abort();}
}

import {nightPlanPreview,nightRetryPreview,nightReceiptBody,nightPlanPath,nightRetryPath} from './night-views.mjs';
import {clearPrivateView} from './safety-client.mjs';
const identity=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const nightMessage=code=>({
  stale_preview:'The source or approved policy changed. Keep your draft and review fresh source before publishing.',
  night_source_changed:'The night source changed. Review the current plan and attempt before another approval.',
  source_changed:'The source changed. Your authored draft remains here; review current source.',
  request_unavailable:'The response was unavailable. Inspect the original receipt; do not repeat the request.',
  daily_source_changed:'The daily source changed. Keep your draft and inspect the current source before publication.',
  invalid_night_plan:'This plan is not valid for the inspected date. Inspect the intended night date and preserve recorded progress before reviewing publication.',
  night_plan_unchanged:'The proposed plan matches the current source. No publication is needed.',
  night_plan_disabled:'Plan publication is not activated. Your private draft can still be saved.',
  night_retry_disabled:'Night retries are not activated for this project.',
  night_plan_branch_missing:'The canonical plan branch must already exist. Bootstrap is not supported here.',
  operation_not_found:'No receipt is visible yet. The original request may still be in flight; do not resubmit.',
  night_retry_not_found:'No receipt is visible yet. Inspect this original request again; do not submit another.',
}[code]||'This operation could not be confirmed. Inspect the current source, requirements and original receipt.');
const missing=code=>['operation_not_found','night_retry_not_found','night_plan_not_found','night_operation_not_found'].includes(code);
export function createNightController({root,host,status,document,window,fetch,project,csrf,model=null,onDispatch=()=>{},onAccessLost=()=>{}}) {
  let preview=null,operation=model?.view==='inspect'?null:model,busy=false,dispatched=!!operation,generation=0,locked=false;
  const prefix=`/api/projects/${encodeURIComponent(project.id)}`;
  const say=text=>{status.textContent=text;};
  const focus=title=>{
    document.title=`${title} · Plates`;
    const heading=host.querySelector?.('h1,h2');heading?.setAttribute?.('tabindex','-1');heading?.focus?.();heading?.scrollIntoView?.({block:'start'});
  };
  function denied(response) {
    if([401,403,404].includes(response.status)&&!missing(response.data?.error)) {
      locked=true;preview=null;onAccessLost();clearPrivateView({root,document,window});return true;
    }
    return false;
  }
  function renderOperation() {host.innerHTML=nightReceiptBody(operation);focus('Original night operation');}
  function validPreview(value,kind) {
    return value?.project?.id===project.id&&identity(value.id)&&identity(value.digest)&&identity(value.operationId)
      &&value.operationUrl===(kind==='night-plan'?nightPlanPath(project.id,value.operationId):nightRetryPath(project.id,value.operationId));
  }
  async function review(kind,input) {
    if(busy||locked||dispatched)return;
    const version=generation;busy=true;preview=null;say('Reading the current source and exact operation requirements…');
    const response=await nightRequest(fetch,`${prefix}/${kind==='night-plan'?'night-plan':'night-retries'}/preview`,{csrf,...input});busy=false;
    if(denied(response))return;
    if(version!==generation){say('The draft changed during review. Review the current draft again.');return;}
    if(response.status!==200||!validPreview(response.data,kind)){say(nightMessage(response.data?.error));return;}
    preview={...response.data,kind};host.innerHTML=kind==='night-plan'?nightPlanPreview(preview):nightRetryPreview(preview);
    focus(kind==='night-plan'?'Review night plan':'Review night retry');say('Review the exact source and effects. Nothing has been published or retried.');
  }
  async function apply() {
    if(busy||locked||dispatched||!preview||!root.querySelector('[data-night-approve]')?.checked)return;
    const allowed=preview.kind==='night-plan'?preview.canSubmit:preview.capabilities?.retry;
    const isPublic=preview.kind==='night-plan'&&preview.visibility==='public';
    if(!allowed||isPublic&&!root.querySelector('[data-night-public]')?.checked)return;
    operation={schema:1,id:preview.operationId,previewId:preview.id,kind:preview.kind,projectId:project.id,state:'uncertain',reason:'The original submission has not been confirmed.',...(preview.kind==='night-retry'?{original:preview.run,budget:{reservedMinutes:preview.budget?.minutes,charged:null,laneHeld:null},observations:[],capabilities:{reconcile:false}}:{})};
    window.history.replaceState(null,'',preview.operationUrl);
    dispatched=true;busy=true;onDispatch();renderOperation();say('Submitting this original request once. Keep this receipt if the connection is lost.');
    const body=preview.kind==='night-plan'?{csrf,previewId:preview.id,...(isPublic?{publicAcknowledgement:preview.digest}:{})}:{csrf,previewId:preview.id,digest:preview.digest};
    const response=await nightRequest(fetch,`${prefix}/${preview.kind==='night-plan'?'night-plan':'night-retries'}/apply`,body);busy=false;
    if(denied(response))return;
    if(response.status===200&&response.data?.id===operation.id&&response.data.kind===operation.kind)operation=response.data;
    else operation={...operation,state:'uncertain',reason:nightMessage(response.data?.error)};
    preview=null;renderOperation();say('Original request retained. Checking it never repeats publication or retry.');
  }
  async function recover() {
    if(busy||locked||!operation)return;busy=true;
    const retry=operation.kind==='night-retry';
    const canReconcile=retry&&operation.capabilities?.reconcile===true;
    const path=retry?`${prefix}/night-retries/${operation.id}${canReconcile?'/reconcile':''}`:`${prefix}/night-plan/operations/${operation.id}`;
    const response=await nightRequest(fetch,path,canReconcile?{csrf}:undefined);busy=false;
    if(denied(response))return;
    if(response.status===200&&response.data?.id===operation.id&&response.data.kind===operation.kind){operation=response.data;renderOperation();say('Original receipt checked. No publication or retry was repeated.');}
    else say(missing(response.data?.error)?'No receipt is visible yet. The original request may still be in flight. Keep this URL and check again; do not repeat submission.':nightMessage(response.data?.error));
  }
  const click=event=>{
    if(event.target.closest?.('[data-night-apply]'))void apply();
    if(event.target.closest?.('[data-night-recover]'))void recover();
    if(event.target.closest?.('[data-night-preview-retry]'))void review('night-retry',{runId:model.run.runId,attempt:model.run.attempt});
  };
  const change=()=>{
    const button=root.querySelector('[data-night-apply]');if(!button||!preview)return;
    button.disabled=!root.querySelector('[data-night-approve]')?.checked||(preview.kind==='night-plan'&&preview.visibility==='public'&&!root.querySelector('[data-night-public]')?.checked);
  };
  root.addEventListener('click',click);root.addEventListener('change',change);
  return {reviewPlan:input=>review('night-plan',input),reviewRetry:()=>review('night-retry',{runId:model.run.runId,attempt:model.run.attempt}),apply,recover,
    invalidate(){if(dispatched)return;generation++;preview=null;host.innerHTML='';},getState:()=>({preview,operation,busy,dispatched,locked}),
    stop(){root.removeEventListener('click',click);root.removeEventListener('change',change);}};
}
export function startNightClient({document,window,fetch}) {
  const root=document.querySelector('[data-night-root]');if(!root)return null;
  let model;try{model=JSON.parse(root.querySelector('[data-night-model]').value);}catch{return null;}
  const project=model.project||{id:model.projectId};if(!/^[a-z][a-z0-9-]{0,63}$/.test(project.id))return null;
  return createNightController({root,document,window,fetch,project,model,csrf:root.querySelector('[data-night-csrf]')?.value,host:root.querySelector('[data-night-current]'),status:root.querySelector('[data-night-status]')});
}
if(typeof window!=='undefined'&&typeof document!=='undefined')startNightClient({document,window,fetch:window.fetch.bind(window)});
