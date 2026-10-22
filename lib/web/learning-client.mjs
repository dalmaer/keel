import {clearPrivateView} from './safety-client.mjs';
import {migrationPreviewView,exportPreviewView,migrationResult} from './learning-views.mjs';
const identity=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export async function learningRequest(fetch,url,body) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),58000);
  try {
    const response=await fetch(url,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,data:await response.json()};
  } catch {return {status:503,data:{error:'request_unavailable'}};}
  finally {clearTimeout(timer);}
}
export function startLearningClient({document,window,fetch}) {
  const root=document.querySelector('[data-learning-root]')||document.querySelector('[data-learning-operation]');
  if(!root)return null;
  let model=null;
  if(root.matches('[data-learning-root]')) {
    try {model=JSON.parse(root.querySelector('[data-learning-model]').value);}catch{return null;}
    if(!Array.isArray(model.records))return null;
  }
  const csrf=root.querySelector('[data-learning-csrf]')?.value;
  const project=model?.project?.id;
  if(project&&!/^[a-z][a-z0-9-]{0,63}$/.test(project))return null;
  const prefix=project?`/api/projects/${project}/learning`:'/api/learning';
  const output=root.querySelector('[data-learning-preview]'),status=root.querySelector('[data-learning-status]');
  let preview=null,operationId=root.dataset.operation||null,busy=false,generation=0,dispatched=false;
  const say=text=>{status.textContent=text;};
  function clearPrivate(response,includeMissing=true) {
    if([401,403,...((includeMissing||response.data?.error!=='operation_not_found')?[404]:[])].includes(response.status)){clearPrivateView({root,document,window});return true;}return false;
  }
  function selected() {return [...root.querySelectorAll('[data-lesson-index]:checked')].map(input=>model.records[Number(input.dataset.lessonIndex)]?.selection).filter(Boolean);}
  function changed() {
    generation++;
    // A dispatched request remains attached to its original identity, even if inputs change.
    if(dispatched)return;
    preview=null;output.innerHTML='';say('Selection or text changed. Review a fresh exact preview before proceeding.');
  }
  async function review(kind) {
    if(dispatched){say('This page keeps the original receipt. After the copy is committed or refused, reload the catalogue to review another copy or export.');return;}
    if(busy||!model||!csrf)return;
    const selection=selected();
    if(selection.length<1||selection.length>3){say('Select one to three records to review.');return;}
    const text=root.querySelector('[data-export-text]')?.value||'';
    if(kind==='export'&&(!text.trim()||new TextEncoder().encode(text).length>65536)){say('Write the exact outbound text, up to 64 KiB, before reviewing.');return;}
    if(kind==='migration'&&!project)return;
    const version=generation;busy=true;preview=null;output.innerHTML='';say('Reading fresh selected source records…');
    const response=await learningRequest(fetch,`${prefix}/${kind}/preview`,{csrf,selection,...(kind==='export'?{text}:{})});busy=false;
    if(clearPrivate(response))return;
    if(version!==generation){say('Inputs changed during the read. Review the current selection again.');return;}
    if(response.status!==200||response.data?.kind!==kind||!identity(response.data.id)||!identity(response.data.digest)){say(response.status===409?'The selected source changed. Reload the catalogue before reviewing.':'Preview unavailable. No copy or download was made.');return;}
    preview=response.data;
    if(kind==='migration'&&!identity(preview.operationId)){preview=null;say('A stable original receipt is unavailable. Copying is blocked.');return;}
    output.innerHTML=kind==='migration'?migrationPreviewView(preview):exportPreviewView(preview);
    say('Review the complete preview and approve its exact contents.');
  }
  async function recheck() {
    if(busy||!identity(operationId))return;
    busy=true;say('Checking the original receipt without submitting again…');
    const response=await learningRequest(fetch,`/api/learning/operations/${operationId}`);busy=false;
    if(clearPrivate(response,false))return;
    if(response.status===200&&response.data?.id===operationId){output.innerHTML=migrationResult(response.data,project?`/projects/${project}/learning`:'/learning');say(response.data.state==='committed'&&response.data.receipt?.commit?'The original copy has a verified receipt.':'The original copy is not verified yet.');}
    else say(response.status===404?'The original receipt is not visible yet. An in-flight request may still reserve it. Keep this page and recheck; do not submit again.':'The original receipt is unavailable. Keep this page and recheck; do not submit again.');
  }
  async function apply() {
    if(busy||dispatched||preview?.kind!=='migration'||preview.canSubmit!==true||!root.querySelector('[data-approve-migration]')?.checked)return;
    operationId=preview.operationId;dispatched=true;busy=true;
    for(const control of root.querySelectorAll('[data-preview-migration],[data-preview-export]'))control.disabled=true;
    const reviewed=preview;
    output.innerHTML=migrationResult({id:operationId,state:'uncertain',reason:'The exact approved copy is being submitted. Keep this original receipt.',receipt:null});
    say('Submitting the approved private copy once…');
    const response=await learningRequest(fetch,`${prefix}/migration/apply`,{csrf,previewId:reviewed.id,digest:reviewed.digest});busy=false;
    if(clearPrivate(response))return;
    if(response.status===200&&response.data?.id===operationId){output.innerHTML=migrationResult(response.data,project?`/projects/${project}/learning`:'/learning');say(response.data.state==='committed'&&response.data.receipt?.commit?'The copy was verified.':'The copy has not been verified. Inspect its original receipt.');}
    else say('The submission response was not confirmed. Check the original receipt; do not submit again.');
  }
  async function download() {
    if(busy||preview?.kind!=='export'||!root.querySelector('[data-approve-export]')?.checked)return;
    const reviewed=preview,version=generation;busy=true;say('Rechecking the approved text and source selection…');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),58000);
    try {
      const response=await fetch(`${prefix}/export/download`,{method:'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({csrf,previewId:reviewed.id,digest:reviewed.digest})});
      if(clearPrivate(response))return;
      if(!response.ok){say(response.status===409?'Source or approval changed. Review a fresh export.':'Download unavailable. No text was downloaded.');return;}
      if(version!==generation||preview!==reviewed){say('Text changed during verification. Review the current text before downloading.');return;}
      const blob=await response.blob();
      if(blob.size>65536||await blob.text()!==reviewed.text){say('The download did not match the approved text. No file was downloaded.');return;}
      if(version!==generation||preview!==reviewed)return;
      const url=window.URL.createObjectURL(blob),anchor=document.createElement('a');
      anchor.href=url;anchor.download='plates-reviewed-lessons.txt';document.body.append(anchor);anchor.click();anchor.remove();window.setTimeout(()=>window.URL.revokeObjectURL(url),1000);
      say('The exact approved text was offered as a download. Nothing was published.');
    } catch {say('Download unavailable. Review the original preview before trying again.');}
    finally {busy=false;clearTimeout(timer);}
  }
  function click(event) {
    const button=event.target.closest?.('button');if(!button)return;
    if(button.matches('[data-preview-migration]'))review('migration');
    if(button.matches('[data-preview-export]'))review('export');
    if(button.matches('[data-apply-migration]'))apply();
    if(button.matches('[data-recheck-migration]'))recheck();
    if(button.matches('[data-download-export]'))download();
  }
  function input(event) {
    if(event.target.matches?.('[data-lesson-index],[data-export-text]'))changed();
    if(event.target.matches?.('[data-approve-migration]'))root.querySelector('[data-apply-migration]').disabled=!event.target.checked;
    if(event.target.matches?.('[data-approve-export]'))root.querySelector('[data-download-export]').disabled=!event.target.checked;
  }
  root.addEventListener('click',click);root.addEventListener('input',input);
  return {review,apply,recheck,download,changed,getState:()=>({preview,operationId,busy,dispatched}),stop(){root.removeEventListener('click',click);root.removeEventListener('input',input);}};
}
if(typeof document!=='undefined'&&typeof window!=='undefined')startLearningClient({document,window,fetch:window.fetch.bind(window)});
