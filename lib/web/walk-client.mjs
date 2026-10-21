// Private walk edits stay in this page until an explicit CAS save. No browser persistence.
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
export function validWalkModel(model,project,walk) {
  return model?.schema===1 && model.project?.id===project && model.walk?.id===walk && hash(model.sourceDigest)
    && Array.isArray(model.walk.steps) && model.walk.steps.length>=1 && model.walk.steps.length<=20
    && model.walk.steps.every(step=>id(step.id)) && Number.isSafeInteger(model.draft?.revision)
    && hash(model.draft.digest) && Array.isArray(model.draft.steps);
}
export function canPreviewWalk(model) {
  return model.ready===true && model.draft.resultConfirmed===true && Boolean(model.draft.environment?.trim())
    && Boolean(model.draft.finalObservation?.trim()) && (!model.choices?.length || model.choices.includes(model.draft.choice) && !model.keepsOpen?.includes(model.draft.choice))
    && model.walk.steps.every(step=>{const row=model.draft.steps.find(row=>row.id===step.id);return row?.current===true && row.outcome==='pass' && step.requires.every(required=>model.draft.steps.some(row=>row.id===required&&row.current===true&&row.outcome==='pass'));});
}
export function validWalkPreview(preview,project,draftDigest) {
  return preview?.kind==='walk' && hash(preview.id) && hash(preview.digest) && hash(preview.operationId)
    && preview.project?.id===project && preview.draftDigest===draftDigest
    && preview.operationUrl===`/projects/${project}/operations/${preview.operationId}`
    && Number.isFinite(Date.parse(preview.expiresAt)) && typeof preview.canSubmit==='boolean'
    && ['public','private'].includes(preview.visibility) && typeof preview.commitMessage==='string'
    && Array.isArray(preview.files) && preview.files.length>=1 && preview.files.length<=3
    && preview.files.every(file=>typeof file.path==='string'&&typeof file.content==='string');
}
export async function walkRequest(fetch,url,{body,timeout=58000}={}) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try {const response=await fetch(url,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};}
  catch {return {status:503,data:{error:'request_unavailable'},uncertain:true};}
  finally {clearTimeout(timer);}
}
export function walkMessage(code) {
  return ({walk_source_changed:'The captured source changed. Your unsaved observations are still here. Reload saved state and inspect the current result.',draft_conflict:'Another tab saved a newer draft. Your edits are still here. Reload the saved draft only when you are ready to replace them.',source_changed:'The source changed. Your saved history remains private. Reload and review the current result before continuing.',stale_source:'The source changed. Reload and inspect which observations need repeating.',stale_preview:'The reviewed source or draft changed. Reload before another acceptance preview.',project_busy:'A source operation is reserved for this project. Recover its original receipt before changing this draft.',walk_incomplete:'Some steps are failed, blocked, unfinished or stale. Save those observations privately; acceptance remains open.',preview_expired:'This source preview expired. Review the current saved draft and create another preview.',submission_disabled:'Source submission is disabled for this instance. Private observations are still useful.',walk_capacity:'Private storage is at capacity. Existing observations were preserved; no history was deleted.',invalid_environment:'Use a single-line actual environment of at most 200 characters.',walk_not_ready:'Some steps or source requirements are incomplete, failed, blocked or stale. Acceptance remains open.',stale_draft:'The saved draft changed. Reload and review it before another preview.',choice_keeps_open:'That source choice keeps acceptance open. Your observations remain saved privately.',capacity_exceeded:'Private storage is at capacity. Existing observations were preserved.',invalid_csrf:'Your session security check expired. Sign in again before saving.',request_unavailable:'The request could not be confirmed. Keep this page open; reload saved state before retrying an uncertain save.'})[code] || 'The operation was refused or unavailable. Your unsaved observations remain on this page; review saved state before continuing.';
}
export function startWalkClient({document,window,fetch,renderWalkDetail,renderWalkPreview,renderWalkOperation,renderWalkRepair}) {
  const root=document.querySelector('[data-walk-root]');if(!root)return null;
  const project=root.dataset.project,walk=root.dataset.walk,csrf=root.querySelector('[data-walk-csrf]')?.value;
  if(!id(project)||!id(walk)||!csrf)return null;
  let model;try{model=JSON.parse(root.querySelector('[data-walk-model]').value);}catch{return null;}
  if(!validWalkModel(model,project,walk))return null;
  const base=`/api/projects/${project}/walks/${walk}`,content=root.querySelector('[data-walk-content]'),previewZone=root.querySelector('[data-walk-preview]'),operationZone=root.querySelector('[data-walk-operation]'),status=root.querySelector('[data-walk-status]');
  let selected=model.walk.steps[0].id,dirty=false,busy=false,locked=false,conflict=false,preview=null,acknowledged=false,operation=null,expiry=null;
  const say=message=>{if(status)status.textContent=message;};
  const field=name=>root.querySelector(`[name="${name}"]`);
  const selectedOutcome=()=>root.querySelector(`input[name="outcome-${selected}"]:checked`)?.value || 'unobserved';
  function controls(){
    const form=root.querySelector('[data-walk-form]');if(form?.querySelector('fieldset'))form.querySelector('fieldset').disabled=busy||locked;
    for(const button of root.querySelectorAll('[data-save-walk]'))button.disabled=busy||locked||conflict;
    for(const button of root.querySelectorAll('[data-step-nav]'))button.disabled=busy||locked;
    const review=root.querySelector('[data-preview-walk]');if(review)review.disabled=busy||locked||dirty||conflict||!canPreviewWalk(model);
    const ack=root.querySelector('[data-walk-ack]');if(ack){ack.disabled=busy||locked||!preview?.canSubmit||Date.parse(preview.expiresAt)<=Date.now();ack.checked=acknowledged;}
    const apply=root.querySelector('[data-apply-walk]');if(apply)apply.disabled=busy||locked||!acknowledged||!preview?.canSubmit||Date.parse(preview.expiresAt)<=Date.now();
    const reload=root.querySelector('[data-reload-walk]');if(reload){reload.disabled=busy||locked;reload.textContent=dirty||conflict?'Reload saved draft (replace unsaved edits)':'Reload saved draft and current source';}
    const recover=root.querySelector('[data-recover-walk]');if(recover)recover.disabled=busy;
    const note=field(`note-${selected}`);if(note)note.required=['fail','blocked'].includes(selectedOutcome());
  }
  function clearPreview(){preview=null;acknowledged=false;previewZone?.replaceChildren();if(expiry)window.clearTimeout(expiry);expiry=null;}
  function render(){content.innerHTML=renderWalkDetail(model,selected);controls();}
  function focus(selector){const element=root.querySelector(selector);if(element)element.focus();}
  function denied(){locked=true;clearPreview();root.innerHTML='<section class="signin"><h1>Please sign in again.</h1><p>Access changed. This private walk view has been cleared.</p><a class="button" href="/signin">Sign in</a></section>';document.querySelector('nav[aria-label="Account"]')?.remove();}
  function reject(result){if([401,404].includes(result.status)&&result.data?.error!=='operation_not_found'){denied();return true;}return false;}
  function edit(event){
    if(busy||locked||event.target.closest?.('[data-repair-form]'))return;
    dirty=true;clearPreview();
    if(event.target.name==='environment' && event.target.value!==model.draft.environment){
      for(const input of root.querySelectorAll('input[type="radio"]'))input.checked=false;
      for(const step of model.walk.steps){const note=field(`note-${step.id}`);if(note)note.value='';}
      if(field('finalObservation'))field('finalObservation').value='';if(field('resultConfirmed'))field('resultConfirmed').checked=false;
      say('Environment changed. Saved observations remain in history; record fresh outcomes for this environment.');
    }else {if(/^(note-|outcome-)/.test(event.target.name ?? '') && field('finalObservation'))field('finalObservation').value='';say('Unsaved private observations. Save before changing steps or refreshing.');}
    controls();
  }
  async function save(){
    if(busy||locked||conflict)return;
    const outcome=selectedOutcome(),note=field(`note-${selected}`)?.value ?? '';
    if(['fail','blocked'].includes(outcome)&&!note.trim()){say('Describe what happened or why you could not test this step.');field(`note-${selected}`)?.reportValidity();return;}
    const body={csrf,expectedRevision:model.draft.revision,sourceDigest:model.sourceDigest,environment:field('environment')?.value ?? '',resultConfirmed:field('resultConfirmed')?.checked===true,choice:root.querySelector('input[name="choice"]:checked')?.value ?? null};
    const prior=model.draft.steps.find(step=>step.id===selected),finalObservation=field('finalObservation')?.value ?? '';
    if(outcome!==prior?.outcome || note!==prior?.note || prior?.current!==true&&(outcome!=='unobserved'||note))body.step={id:selected,outcome,note};
    if(finalObservation!==model.draft.finalObservation)body.finalObservation=finalObservation;
    busy=true;clearPreview();controls();say('Saving private progress…');
    const result=await walkRequest(fetch,`${base}/draft`,{body});busy=false;if(reject(result))return;
    if(result.status===200&&validWalkModel(result.data,project,walk)){model=result.data;dirty=false;conflict=false;render();say('Saved privately. Phase acceptance is unchanged.');focus(`[data-step="${selected}"] h2`);}
    else {conflict=result.status===409||result.uncertain===true;say(walkMessage(result.data?.error));controls();}
  }
  async function reload(){
    if(busy||locked)return;busy=true;controls();say('Reloading saved observations and current sources…');
    const result=await walkRequest(fetch,base);busy=false;if(reject(result))return;
    if(result.status===200&&validWalkModel(result.data,project,walk)){model=result.data;dirty=false;conflict=false;clearPreview();if(!model.walk.steps.some(step=>step.id===selected))selected=model.walk.steps[0].id;render();say('Saved draft reloaded. Review the source and any observations that need repeating.');focus(`[data-step="${selected}"] h2`);}
    else {say(walkMessage(result.data?.error));controls();}
  }
  async function review(){
    if(busy||locked||dirty||conflict||!canPreviewWalk(model))return;
    busy=true;clearPreview();controls();say('Checking current sources and preparing exact files…');
    const result=await walkRequest(fetch,`${base}/preview`,{body:{csrf,draftDigest:model.draft.digest}});busy=false;if(reject(result))return;
    if(result.status===200&&validWalkPreview(result.data,project,model.draft.digest)){preview=result.data;previewZone.innerHTML=renderWalkPreview(preview);expiry=window.setTimeout(()=>{clearPreview();controls();say(walkMessage('preview_expired'));},Math.max(0,Date.parse(preview.expiresAt)-Date.now()));say('Exact source preview ready. Nothing has been submitted.');controls();focus('[data-walk-reviewed] h2');}
    else {say(walkMessage(result.data?.error));controls();}
  }
  function showOperation(){if(operation){operationZone.innerHTML=renderWalkOperation(operation,project);focus('[data-walk-operation] h2');}controls();}
  async function apply(){
    if(busy||locked||!acknowledged||!preview?.canSubmit||Date.parse(preview.expiresAt)<=Date.now())return;
    busy=true;locked=true;controls();if(expiry)window.clearTimeout(expiry);
    const original=window.location.pathname+window.location.search;
    window.history.replaceState(null,'',preview.operationUrl);say('Submitting the reviewed files. Waiting for a verified receipt…');
    const result=await walkRequest(fetch,`/api/projects/${project}/decisions/apply`,{body:{csrf,previewId:preview.id,publicAcknowledgement:preview.digest}});busy=false;if(reject(result))return;
    if(result.status===200&&result.data?.id===preview.operationId)operation=result.data;
    else if(!result.uncertain&&['submission_disabled','preview_expired','invalid_preview','invalid_csrf','project_busy','public_acknowledgement_required'].includes(result.data?.error)) {locked=false;clearPreview();window.history.replaceState(null,'',original);say(walkMessage(result.data.error));controls();return;}
    else operation={id:preview.operationId,previewId:preview.id,state:'uncertain',receipt:null};
    say('');showOperation();
  }
  async function recover(){
    const operationId=operation?.id || preview?.operationId;if(busy||!hash(operationId))return;
    busy=true;controls();say('Checking the original operation…');
    const result=await walkRequest(fetch,`/api/projects/${project}/operations/${operationId}`);busy=false;if(reject(result))return;
    if(result.status===200&&result.data?.id===operationId)operation=result.data;
    else operation={id:operationId,state:'uncertain',receipt:null};
    say(result.data?.error==='operation_not_found'?'The original operation is not visible yet. A request may still reserve it. Check this same receipt; do not resubmit.':'');showOperation();
  }
  async function repair(event){
    event.preventDefault();if(busy||locked)return;const form=event.target;if(!form.matches('[data-repair-form]')||!form.reportValidity())return;
    const value=name=>form.querySelector(`[name="${name}"]`)?.value ?? '';
    const publication={schema:1,feedbackDigest:form.dataset.feedbackDigest,excerpt:value('excerpt'),destination:model.project.repo,title:value('title'),rubric:{version:1,problem:value('problem'),reproduction:value('reproduction'),acceptance:value('acceptance'),change:value('change'),prerequisites:[],ownerBlockers:[]}};
    busy=true;controls();say('Preparing an explicit repair handoff; no issue will be created…');
    const result=await walkRequest(fetch,`${base}/repair`,{body:{csrf,stepId:form.dataset.step,feedbackDigest:form.dataset.feedbackDigest,publication}});busy=false;if(reject(result))return;
    const zone=root.querySelector('[data-repair-output]');
    if(result.status===200&&zone){zone.innerHTML=renderWalkRepair(result.data);say(result.data?.status==='preview'?'Repair brief preview ready. It has not been delivered or started.':'Required routing facts are unavailable. No issue was created.');focus('[data-repair-reviewed] h3');}
    else say(walkMessage(result.data?.error));controls();
  }
  function click(event){
    const target=event.target.closest('button');if(!target)return;
    if(target.hasAttribute('data-save-walk')){event.preventDefault();void save();}
    else if(target.hasAttribute('data-preview-walk')){event.preventDefault();void review();}
    else if(target.hasAttribute('data-reload-walk')){event.preventDefault();void reload();}
    else if(target.hasAttribute('data-apply-walk')){event.preventDefault();void apply();}
    else if(target.hasAttribute('data-recover-walk')){event.preventDefault();void recover();}
    else if(target.dataset.stepNav){event.preventDefault();if(busy||locked)return;if(dirty){say('Save your private observations before changing steps.');return;}selected=target.dataset.stepNav;render();focus(`[data-step="${selected}"] h2`);}
    else if(target.dataset.clearOutcome){event.preventDefault();for(const input of root.querySelectorAll(`input[name="outcome-${target.dataset.clearOutcome}"]`))input.checked=false;edit({target:{name:`outcome-${target.dataset.clearOutcome}`}});}
  }
  function change(event){if(event.target.matches('[data-walk-ack]')){acknowledged=event.target.checked===true;controls();}else if(event.target.closest('[data-walk-form]'))edit(event);}
  function input(event){if(event.target.closest('[data-walk-form]'))edit(event);}
  function beforeUnload(event){if(dirty){event.preventDefault();event.returnValue='';}}
  root.addEventListener('click',click);root.addEventListener('change',change);root.addEventListener('input',input);root.addEventListener('submit',repair);window.addEventListener('beforeunload',beforeUnload);controls();
  return {save,reload,review,apply,recover,getState:()=>({model,selected,dirty,busy,locked,conflict,preview,operation}),stop(){if(expiry)window.clearTimeout(expiry);root.removeEventListener('click',click);root.removeEventListener('change',change);root.removeEventListener('input',input);root.removeEventListener('submit',repair);window.removeEventListener('beforeunload',beforeUnload);}};
}
export function startWalkRecovery({document,fetch,renderWalkOperation}) {
  const root=document.querySelector('[data-walk-receipt]');if(!root||!id(root.dataset.project)||!hash(root.dataset.operation))return null;
  const {project,operation}=root.dataset;let busy=false;
  const output=root.querySelector('[data-walk-recovery-output]'),status=root.querySelector('[data-walk-recovery-status]');
  async function recover(){if(busy)return;busy=true;const button=root.querySelector('[data-recover-walk]');if(button)button.disabled=true;status.textContent='Checking the original operation…';
    const result=await walkRequest(fetch,`/api/projects/${project}/operations/${operation}`);busy=false;
    if(result.status===401||result.status===404&&result.data?.error!=='operation_not_found'){root.innerHTML='<p>Access changed. Sign in again to inspect this receipt.</p><a href="/signin">Sign in</a>';return;}
    if(result.status===200&&result.data?.id===operation){output.innerHTML=renderWalkOperation(result.data,project);status.textContent='Original operation checked.';}
    else {status.textContent='The original operation is not confirmed. Check this same receipt again; do not resubmit.';if(button)button.disabled=false;}
  }
  function click(event){if(event.target.closest('[data-recover-walk]')){event.preventDefault();void recover();}}
  root.addEventListener('click',click);return {recover,stop(){root.removeEventListener('click',click);}};
}
if(typeof window!=='undefined'&&typeof document!=='undefined')import('/assets/walk-views.mjs').then(views=>{const deps={document,window,fetch:window.fetch.bind(window),...views};startWalkClient(deps);startWalkRecovery(deps);}).catch(()=>{const status=document.querySelector('[data-walk-status]');if(status)status.textContent='The interactive walk could not start. Private save and submission remain disabled.';});
