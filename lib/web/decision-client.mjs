// Explicit preview -> owner acknowledgement -> one dispatch. Recovery is GET-only.
const token = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const operationId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function createDecisionState() {
  return { preview:null, operation:null, acknowledged:false, busy:false, dispatched:false, error:null };
}
export function decisionTransition(state,event) {
  if(event.type==='edit') return state.dispatched ? state : {...state,preview:null,acknowledged:false,error:null};
  if(event.type==='preview-start') return state.busy || state.dispatched ? state : {...state,busy:true,preview:null,acknowledged:false,error:null};
  if(event.type==='preview') return {...state,busy:false,preview:event.preview,acknowledged:false,error:null};
  if(event.type==='acknowledge') return {...state,acknowledged:event.checked===true && Boolean(state.preview) && !state.dispatched};
  if(event.type==='apply-start') return {...state,busy:true,dispatched:true,acknowledged:false,error:null};
  if(event.type==='operation') return {...state,busy:false,dispatched:true,operation:event.operation,error:null};
  if(event.type==='uncertain') return {...state,busy:false,dispatched:true,error:'operation_uncertain',operation:state.operation ?? {id:state.preview?.operationId,previewId:state.preview?.id,state:'uncertain'}};
  if(event.type==='recover-start') return {...state,busy:true,error:null};
  if(event.type==='refused-before-dispatch') return {...state,busy:false,dispatched:false,preview:null,acknowledged:false,error:event.code};
  if(event.type==='error') return {...state,busy:false,acknowledged:false,error:event.code || 'request_unavailable'};
  if(event.type==='expire') return state.dispatched ? state : {...state,preview:null,acknowledged:false,error:'preview_expired'};
  return state;
}
export function validPreview(preview,projectId) {
  return preview && token(preview.id) && operationId(preview.operationId)
    && preview.operationUrl===`/projects/${encodeURIComponent(projectId)}/operations/${preview.operationId}`
    && typeof preview.expiresAt==='string' && Number.isFinite(Date.parse(preview.expiresAt))
    && typeof preview.canSubmit==='boolean' && typeof preview.content==='string' && typeof preview.commitMessage==='string'
    && ['public','private'].includes(preview.visibility) && preview.project?.id===projectId;
}
export function mayApplyDecision(state,now=Date.now()) {
  return Boolean(state.preview?.canSubmit === true && token(state.preview.id) && operationId(state.preview.operationId) && state.acknowledged && !state.busy && !state.dispatched && Date.parse(state.preview.expiresAt)>now);
}
export function operationRecoveryPath(projectId,state) {
  const id=state.operation?.id || state.preview?.operationId;
  return operationId(id) ? `/api/projects/${encodeURIComponent(projectId)}/operations/${id}` : null;
}
export async function decisionRequest(fetch,url,{method='GET',body,timeout=58000}={}) {
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),timeout);
  try {
    const response=await fetch(url,{method,credentials:'same-origin',cache:'no-store',signal:controller.signal,
      headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,data:await response.json(),transportFailure:false};
  } catch { return {status:503,data:null,transportFailure:true}; }
  finally {clearTimeout(timer);}
}
const messages={
  preview_expired:'This preview expired. Review the current source and create another preview.',
  stale_preview:'The source changed after this preview. Review the current source before deciding again.',
  source_changed:'The source changed. Review its current content and create another preview.',
  context_changed:'Decision context changed. Review the current context and create another preview.',
  submission_disabled:'Submission is disabled for this instance. The preview does not grant write access.',
  write_disabled:'Submission is disabled for this instance. The preview does not grant write access.',
  permission_denied:'The required write permission is unavailable. No new submission is allowed.',
  project_busy:'Another operation owns this project. Inspect its original receipt before new work.',
  operation_uncertain:'The outcome is not confirmed. Do not resubmit. Check the original operation below.',
  operation_not_found:'The original operation is not visible yet. A request may still reserve it; check this same receipt again. Do not resubmit.',
  choice_required:'Choose an option yourself before previewing.', answer_required:'Write your answer before previewing.',
  invalid_csrf:'The session security check expired. Reload this page before creating a new preview.',
  invalid_preview:'The preview could not be validated. Submission remains unavailable.',
  request_unavailable:'The request could not be completed. Your choice has not been submitted from this view.',
};
export function decisionMessage(code) { return messages[code] || 'The request was refused or unavailable. Review the current source before continuing.'; }
export function startDecisionClient({document,window,fetch,renderDecisionPreview,renderDecisionOperation}) {
  const root=document.querySelector('[data-decision-root]'); if(!root) return null;
  const projectId=root.dataset.project;
  if(!/^[a-z][a-z0-9-]{0,63}$/.test(projectId)) return null;
  const base=`/api/projects/${projectId}/decisions`, csrf=root.querySelector('[data-decision-csrf]')?.value;
  if(!csrf) return null;
  const form=root.querySelector('[data-decision-form]'), previewZone=root.querySelector('[data-decision-preview]'), operationZone=root.querySelector('[data-decision-operation]'), status=root.querySelector('[data-decision-status]');
  let state=createDecisionState(), expiryTimer=null;
  const initialPreview=root.querySelector('[data-preview-id]');
  if(initialPreview) state.preview={id:initialPreview.dataset.previewId,operationId:initialPreview.dataset.reservedOperation,operationUrl:initialPreview.dataset.operationUrl,expiresAt:initialPreview.dataset.expiresAt,canSubmit:initialPreview.dataset.canSubmit==='true'};
  const initialOperation=root.querySelector('[data-operation-id]');
  if(initialOperation) state={...state,dispatched:true,operation:{id:initialOperation.dataset.operationId,state:initialOperation.dataset.operationState}};
  function controls() {
    const reason=form?.dataset.kind==='health' ? form.querySelector('[name="reason"]') : null;
    if(reason) reason.required=form.querySelector('input[name="choice"]:checked')?.value==='decline';
    const fieldset=form?.querySelector('fieldset'); if(fieldset) fieldset.disabled=state.busy || state.dispatched;
    const previewButton=form?.querySelector('[data-preview-button]'); if(previewButton) previewButton.disabled=state.busy || state.dispatched;
    const ack=root.querySelector('[data-preview-ack]'); if(ack) {ack.disabled=!state.preview?.canSubmit || state.busy || state.dispatched || Date.parse(state.preview.expiresAt)<=Date.now();ack.checked=state.acknowledged;}
    const apply=root.querySelector('[data-apply-decision]'); if(apply) apply.disabled=!mayApplyDecision(state);
    const recovery=root.querySelector('[data-recover-operation]'); if(recovery) recovery.disabled=state.busy || !operationRecoveryPath(projectId,state);
    if(status) status.textContent=state.error?decisionMessage(state.error):state.busy?state.dispatched?'Checking the original operation…':'Preparing the exact source preview…':'';
  }
  function focusHeading(zone) {const heading=zone?.querySelector('h2');if(heading){heading.tabIndex=-1;heading.focus();}}
  function scheduleExpiry() {
    if(expiryTimer) window.clearTimeout(expiryTimer);
    if(state.preview && !state.dispatched) expiryTimer=window.setTimeout(()=>{state=decisionTransition(state,{type:'expire'});controls();},Math.max(0,Math.min(2147483647,Date.parse(state.preview.expiresAt)-Date.now())));
  }
  function denied() {
    if(expiryTimer) window.clearTimeout(expiryTimer);
    state=createDecisionState();
    root.innerHTML='<section class="signin"><h1>Please sign in again.</h1><p>Access changed. This private decision view has been cleared.</p><a class="button" href="/signin">Sign in</a></section>';
    document.querySelector('nav[aria-label="Account"]')?.remove();
  }
  function showOperation() {if(operationZone && state.operation){operationZone.innerHTML=renderDecisionOperation(state.operation,projectId);focusHeading(operationZone);}controls();}
  function edit() {
    if(state.dispatched || state.busy) return;
    state=decisionTransition(state,{type:'edit'}); if(previewZone) previewZone.replaceChildren(); if(expiryTimer) window.clearTimeout(expiryTimer); controls();
  }
  async function preview(event) {
    event?.preventDefault(); if(state.busy || state.dispatched || !form?.reportValidity()) return;
    const target={kind:form.dataset.kind,path:form.dataset.path,...(form.dataset.question?{question:form.dataset.question}:{})};
    const body={csrf,target};
    if(target.kind==='health') {
      body.choice=form.querySelector('input[name="choice"]:checked')?.value;
      if(!['accept','decline'].includes(body.choice)){state=decisionTransition(state,{type:'error',code:'choice_required'});controls();return;}
      body.reason=form.querySelector('[name="reason"]')?.value ?? '';
    } else if(target.kind==='shaping') {
      body.answer=form.querySelector('[name="answer"]')?.value ?? '';
      if(!body.answer.trim()){state=decisionTransition(state,{type:'error',code:'answer_required'});controls();return;}
    } else return;
    state=decisionTransition(state,{type:'preview-start'});controls();
    const result=await decisionRequest(fetch,`${base}/preview`,{method:'POST',body});
    if([401,404].includes(result.status)){denied();return;}
    if(result.status>=200 && result.status<300 && validPreview(result.data,projectId)) {
      state=decisionTransition(state,{type:'preview',preview:result.data}); previewZone.innerHTML=renderDecisionPreview(result.data);scheduleExpiry();controls();focusHeading(previewZone);
    } else {state=decisionTransition(state,{type:'error',code:result.data?.error || (result.status===200?'invalid_preview':'request_unavailable')});controls();}
  }
  async function apply() {
    if(!mayApplyDecision(state)) {if(state.preview && Date.parse(state.preview.expiresAt)<=Date.now()){state=decisionTransition(state,{type:'expire'});controls();}return;}
    const previewId=state.preview.id, reserved=state.preview.operationId;
    state=decisionTransition(state,{type:'apply-start'});if(expiryTimer) window.clearTimeout(expiryTimer);controls();
    // Preserve the receipt URL before the request, including if the response is lost.
    const originalUrl=window.location.pathname + window.location.search;
    window.history.replaceState(null,'',state.preview.operationUrl);
    const result=await decisionRequest(fetch,`${base}/apply`,{method:'POST',body:{csrf,previewId}});
    if(result.status===401 || result.status===404 && result.data?.error!=='operation_not_found'){denied();return;}
    if(result.status>=200 && result.status<300 && result.data?.id===reserved && ['prepared','dispatched','uncertain','committed','refused'].includes(result.data.state)) state=decisionTransition(state,{type:'operation',operation:result.data});
    else if(!result.transportFailure && ['submission_disabled','preview_expired','invalid_preview','project_busy','invalid_csrf'].includes(result.data?.error)) {
      state=decisionTransition(state,{type:'refused-before-dispatch',code:result.data.error});window.history.replaceState(null,'',originalUrl);
    } else state=decisionTransition(state,{type:'uncertain'});
    showOperation();
  }
  async function recover() {
    if(state.busy) return;
    const path=operationRecoveryPath(projectId,state); if(!path) return;
    const id=state.operation?.id || state.preview.operationId;
    state=decisionTransition(state,{type:'recover-start'});controls();
    const result=await decisionRequest(fetch,path);
    if(result.status===401 || result.status===404 && result.data?.error!=='operation_not_found'){denied();return;}
    if(result.status>=200 && result.status<300 && result.data?.id===id && ['prepared','dispatched','uncertain','committed','refused'].includes(result.data.state)) state=decisionTransition(state,{type:'operation',operation:result.data});
    else {state=decisionTransition(state,{type:'uncertain'});if(result.data?.error==='operation_not_found') state={...state,error:'operation_not_found'};}
    showOperation();
  }
  function click(event) {if(event.target.closest('[data-apply-decision]')) {event.preventDefault();void apply();} else if(event.target.closest('[data-recover-operation]')) {event.preventDefault();void recover();}}
  function change(event) {if(event.target.matches('[data-preview-ack]')) {state=decisionTransition(state,{type:'acknowledge',checked:event.target.checked});controls();}}
  form?.addEventListener('submit',preview);form?.addEventListener('input',edit);form?.addEventListener('change',edit);
  root.addEventListener('click',click);root.addEventListener('change',change);controls();scheduleExpiry();
  return {preview,apply,recover,getState:()=>state,stop(){if(expiryTimer) window.clearTimeout(expiryTimer);form?.removeEventListener('submit',preview);form?.removeEventListener('input',edit);form?.removeEventListener('change',edit);root.removeEventListener('click',click);root.removeEventListener('change',change);}};
}
if(typeof window!=='undefined' && typeof document!=='undefined') {
  import('/assets/decision-views.mjs').then(({renderDecisionPreview,renderDecisionOperation})=>startDecisionClient({document,window,fetch:window.fetch.bind(window),renderDecisionPreview,renderDecisionOperation})).catch(()=>{
    const status=document.querySelector('[data-decision-status]');if(status) status.textContent='The interactive preview could not start. Submission remains disabled.';
  });
}
