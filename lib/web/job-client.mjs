import {jobPreviewView,schedulePreviewView,jobReceipt,jobPath} from './job-views.mjs';
export async function jobRequest(fetch,url,body,{timeoutMs=58000}={}) {
  const controller=new AbortController();let timer;
  const unavailable=()=>({status:503,data:{error:'request_unavailable'}});
  try {
    return await Promise.race([
      (async()=>{
        const response=await fetch(url,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
        return {status:response.status,data:await response.json()};
      })(),
      new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(unavailable());},timeoutMs);}),
    ]);
  }catch{return unavailable();}
  finally{clearTimeout(timer);controller.abort();}
}

const messages={jobs_disabled:'Execution is not activated for this routine.',job_budget_conflict:'The approved runtime allowance cannot reserve this operation. Existing unresolved work remains charged.',job_lane_conflict:'Another operation holds this worker lane. Inspect its original receipt before starting competing work.',retry_requires_terminal:'The previous provider run has not been confirmed terminal. Reconcile it before reviewing a retry.',job_source_changed:'The approved project or worker source changed. Reload and review a new exact preview.',unsupported_schedule:'This cron or workflow shape is not supported by the bounded schedule editor.',schedule_budget_exceeded:'The proposed cadence exceeds the approved existing schedule budget.',schedule_managed_source:'Plates manages this workflow source. Change its owning practice instead of editing the generated file here.',schedule_unchanged:'The proposed cron matches the current source; no change is needed.',job_not_found:'No receipt is visible for this request yet. Check this original request again; do not start it again.',operation_not_found:'No receipt is visible for this request yet. Check this original request again; do not start it again.',stale_preview:'Source or policy changed. Reload the routine and review a new exact preview.',job_budget:'The approved runtime allowance cannot reserve this operation.',job_disabled:'Execution is not activated for this routine.',request_unavailable:'The response was lost or unavailable. Keep the original receipt and check it; do not repeat the submission.'};
export const jobMessage=code=>messages[code]||'This request could not be confirmed. Inspect the original operation and current source before taking another action.';
export function startJobClient({document,window,fetch}) {
  const root=document.querySelector('[data-job-root]');if(!root)return null;
  let model;try{model=JSON.parse(root.querySelector('[data-job-model]').value);}catch{return null;}
  const project=model.project;if(!project?.id)return null;
  const csrf=root.querySelector('[data-job-csrf]')?.value,output=root.querySelector('[data-job-output]'),status=root.querySelector('[data-job-status]');
  const receiptHost=root.querySelector('[data-job-receipt]')||output;
  function renderReceipt(value) {
    if(receiptHost!==output)output.innerHTML='';
    receiptHost.innerHTML=jobReceipt(value,project);
  }
  const prefix=`/api/projects/${encodeURIComponent(project.id)}`;
  let busy=false,preview=null,operation=model.operation||null,dispatched=!!operation,generation=0;
  const say=text=>{status.textContent=text;};
  function denied(response) {
    if([401,403,404].includes(response.status)&&!['job_not_found','operation_not_found'].includes(response.data?.error)) {
      root.innerHTML='<h1>Access needs to be checked again.</h1><p>The private operation view has been cleared. Sign in again before inspecting current access.</p>';return true;
    }return false;
  }
  function freeze() {for(const control of root.querySelectorAll('[data-preview-job],[data-start-job],[data-approve-job],[data-retry-job],[data-schedule-form] input,[data-schedule-form] button'))control.disabled=true;}
  async function review(retry=false) {
    if(busy||dispatched&&!retry)return;busy=true;say('Preparing the exact source and runtime review…');
    const path=retry?`${prefix}/jobs/${operation.id}/retry-preview`:`${prefix}/routines/${encodeURIComponent(model.routineId)}/preview`;
    const response=await jobRequest(fetch,path,{csrf});busy=false;
    if(denied(response))return;if(response.status!==200){say(jobMessage(response.data.error));return;}
    preview=response.data;dispatched=false;output.innerHTML=jobPreviewView(preview);say('Review this source and reserved runtime before approving. No run has started.');
  }
  async function reviewSchedule(event) {
    event.preventDefault();if(busy||dispatched)return;
    busy=true;const currentGeneration=generation,cron=event.currentTarget.elements.namedItem('cron').value;
    const response=await jobRequest(fetch,`${prefix}/routines/${encodeURIComponent(model.routineId)}/schedule-preview`,{csrf,cron});busy=false;
    if(denied(response))return;if(response.status!==200){say(jobMessage(response.data.error));return;}
    if(currentGeneration!==generation){say('The proposed cron changed. Review a fresh exact schedule preview.');return;}
    preview=response.data;output.innerHTML=schedulePreviewView(preview);say('Review the exact schedule file, UTC cadence and separate source budget before approving.');
  }
  async function start() {
    if(busy||dispatched||!preview?.canApply||!root.querySelector('[data-approve-job]')?.checked)return;
    operation={id:preview.requestId,kind:preview.kind==='schedule'?'schedule':undefined,projectId:project.id,routineId:preview.routineId,state:'unknown',reason:'The original submission has not been confirmed.',retryOf:preview.retryOf,budget:preview.budget,capabilities:{reconcile:true}};
    window.history.replaceState(null,'',jobPath(project.id,operation.id));
    dispatched=true;busy=true;freeze();renderReceipt(operation);say('Submitting this exact original request. Keep its receipt if the connection is lost.');
    const response=await jobRequest(fetch,`${prefix}/jobs/${preview.kind==='schedule'?'schedule-apply':'start'}`,{csrf,requestId:preview.requestId,previewId:preview.previewId,digest:preview.digest});busy=false;
    if(denied(response))return;
    if(response.status===200)operation=response.data;else operation={...operation,state:'uncertain',reason:jobMessage(response.data.error)};
    renderReceipt(operation);say('The original request is retained. Reloading or checking it never starts another run.');
  }
  async function act(action) {
    if(busy||!operation)return;busy=true;
    if(action==='cancel')say('Requesting cancellation of this exact original operation. This does not yet establish that it stopped.');
    const response=await jobRequest(fetch,`${prefix}/jobs/${operation.id}/${action}`,{csrf});busy=false;
    if(denied(response))return;if(response.status!==200){say(jobMessage(response.data.error));return;}
    operation=response.data;renderReceipt(operation);
    say(action==='cancel'?'Cancellation state recorded. Only provider terminal evidence confirms the run stopped.':'Original source state checked. No dispatch was repeated.');
  }
  const click=event=>{
    if(event.target.closest?.('[data-preview-job]'))review();
    if(event.target.closest?.('[data-start-job]'))start();
    if(event.target.closest?.('[data-reconcile-job]'))act('reconcile');
    if(event.target.closest?.('[data-cancel-job]'))act('cancel');
    if(event.target.closest?.('[data-retry-job]'))review(true);
  };
  const change=event=>{
    if(event.target.closest?.('[data-schedule-form]')&&!dispatched){generation++;preview=null;output.innerHTML='';}
    if(event.target.matches?.('[data-approve-job]'))root.querySelector('[data-start-job]').disabled=!event.target.checked;
  };
  root.querySelector('[data-schedule-form]')?.addEventListener('submit',reviewSchedule);
  root.addEventListener('click',click);root.addEventListener('change',change);root.addEventListener('input',change);
  return {review,reviewSchedule,start,act,stop(){root.removeEventListener('click',click);root.removeEventListener('change',change);root.removeEventListener('input',change);}};
}
if(typeof window!=='undefined'&&typeof document!=='undefined')startJobClient({document,window,fetch:window.fetch.bind(window)});
