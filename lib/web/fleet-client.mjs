import {clearPrivateView} from './safety-client.mjs';
import {rolloutBody,updateReceipt,preparationPreviewView,publicationPreviewView,rolloutPath,updatePath} from './fleet-views.mjs';
export async function fleetRequest(fetch,url,body,{timeoutMs=58000}={}) {
  const controller=new AbortController();let timer;
  const unavailable=()=>({status:503,data:{error:'request_unavailable'}});
  try {
    return await Promise.race([(async()=>{
      const response=await fetch(url,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal,
        headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
      return {status:response.status,data:await response.json()};
    })(),new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(unavailable());},timeoutMs);})]);
  } catch {return unavailable();}
  finally {clearTimeout(timer);controller.abort();}
}
const identity=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const messages={request_unavailable:'The response is unavailable. Keep the original receipt; do not repeat submission.',stale_preview:'Source or policy changed. Reload and review a new exact preview.',rollout_paused:'The preceding project has no verified green publication. Remaining work stays paused.',access_denied:'Current access could not be confirmed.',operation_not_found:'No receipt is visible for this original request yet. A request may still be in flight; do not submit it again.'};
const message=code=>messages[code]||'This operation could not be confirmed. Inspect the original receipt and current policy before continuing.';
export function startFleetClient({document,window,fetch}) {
  const root=document.querySelector('[data-fleet-root]');if(!root)return null;
  let model;try{model=JSON.parse(root.querySelector('[data-fleet-model]').value);}catch{return null;}
  const csrf=root.querySelector('[data-fleet-csrf]')?.value,output=root.querySelector('[data-fleet-output]'),status=root.querySelector('[data-fleet-status]');
  const host=root.querySelector('[data-fleet-current]')||output;
  let busy=false,preview=null,submitted=false,progressing=false,pausePublication=false;
  const say=text=>{status.textContent=text;};
  const clear=response=>{
    if([401,403,404].includes(response.status)&&!['operation_not_found','rollout_not_found'].includes(response.data?.error)) {
      pausePublication=true;model={...model,capabilities:{}};
      clearPrivateView({root,document,window});return true;
    }return false;
  };
  function focusCurrent(title) {
    document.title=title+' · Keel';
    const heading=host.querySelector?.('h1,h2');
    if(heading){heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});heading.scrollIntoView({block:'start',behavior:'auto'});}
  }
  function render(value,{focus=false}={}) {
    model=value;if(host!==output)output.innerHTML='';
    host.innerHTML=value.kind==='rollout'?rolloutBody(value):updateReceipt(value);
    const title=value.kind==='rollout'?'Update rollout':'Update operation';
    document.title=title+' · Keel';
    if(focus)focusCurrent(title);
  }
  function freeze() {
    for(const control of root.querySelectorAll('[data-create-rollout],[data-project-select],[data-canary],[data-submit-fleet],[data-approve-fleet],[data-public-fleet]'))control.disabled=true;
  }
  async function createRollout() {
    if(busy||submitted)return;
    const projectIds=[...root.querySelectorAll('[data-project-select]:checked')].map(x=>x.value),canary=root.querySelector('[data-canary]')?.value;
    if(projectIds.length<1||projectIds.length>3||new Set(projectIds).size!==projectIds.length||!projectIds.includes(canary)){say('Select one to three projects and explicitly choose a selected canary.');return;}
    const requestId=[...window.crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');
    submitted=true;busy=true;freeze();window.history.replaceState(null,'',rolloutPath(requestId));
    render({kind:'rollout',id:requestId,state:'unconfirmed',canary,projects:projectIds.map(projectId=>({projectId,state:'selection unconfirmed'})),capabilities:{}},{focus:true});
    say('Saving this exact selection. No computation or publication has started.');
    const response=await fleetRequest(fetch,'/api/updates/rollouts',{csrf,requestId,projectIds,canary});busy=false;
    if(clear(response))return;
    if(response.status===200&&response.data.id===requestId){render({...response.data,kind:'rollout'});say('Selection saved. Review the canary preparation next.');}
    else say('The selection response is unconfirmed. Open the original rollout receipt to check; do not create a replacement.');
  }
  async function review(kind,projectId=null) {
    if(busy)return;
    const publication=kind==='publication',p=publication?model.projectId:projectId;
    if(!p||publication&&!model.capabilities?.publish||!publication&&(model.kind!=='rollout'||p!==model.nextProjectId||!model.capabilities?.continue))return;
    busy=true;preview=null;output.innerHTML='';say('Reading exact source and approval requirements…');
    const response=await fleetRequest(fetch,`/api/projects/${encodeURIComponent(p)}/updates/${publication?'publication-preview':'prepare-preview'}`,
      {csrf,rolloutId:publication?model.rolloutId:model.id,...(publication?{preparationId:model.id}:{})});busy=false;
    if(clear(response))return;
    if(response.status!==200||!identity(response.data.requestId)||!identity(response.data.previewId)||!identity(response.data.digest)){say(message(response.data?.error));return;}
    preview={...response.data,kind:publication?'publication':'preparation',rolloutId:publication?model.rolloutId:model.id};
    submitted=false;if(host!==output)output.innerHTML='';
    const back=publication?updatePath(model.id):rolloutPath(model.id);
    host.innerHTML=`<p><a href="${back}">← Original ${publication?'preparation receipt':'rollout'}</a></p>`+(publication?publicationPreviewView(preview):preparationPreviewView(preview));
    focusCurrent(publication?'Review update publication':'Review update preparation');
    say(publication?'Review the exact patch and audience. No PR has been created.':'Review the exact runtime and commands. Nothing has been dispatched.');
  }
  async function submit() {
    if(busy||submitted||!preview?.canApply||!root.querySelector('[data-approve-fleet]')?.checked
      ||preview.audience==='public'&&!root.querySelector('[data-public-fleet]')?.checked)return;
    const p=preview;submitted=true;busy=true;freeze();
    window.history.replaceState(null,'',updatePath(p.requestId));
    const pending={id:p.requestId,kind:p.kind,projectId:p.project.id,rolloutId:p.rolloutId,state:'uncertain',reason:'The original request has not been confirmed.',capabilities:{reconcile:true}};
    render(pending,{focus:true});say('Submitting the exact approved request once. Keep this receipt if the connection is lost.');
    const publication=p.kind==='publication';
    const response=await fleetRequest(fetch,`/api/projects/${encodeURIComponent(p.project.id)}/updates/${publication?'publish':'prepare'}`,
      {csrf,rolloutId:p.rolloutId,requestId:p.requestId,previewId:p.previewId,digest:p.digest,...(publication?{publicAcknowledgement:p.audience==='public'?p.digest:null}:{})});busy=false;
    if(clear(response))return;
    if(response.status===200&&response.data.id===p.requestId)render(response.data);
    say(response.status===200?'Original receipt retained. Inspect each observation before continuing.':message(response.data?.error));
    if(publication&&response.status===200&&model.capabilities?.continue)await continueKnown();
  }
  async function act(action) {
    if(busy||!identity(model.id))return;
    if(action==='stop'&&(model.kind!=='rollout'||!model.capabilities?.stop))return;
    if(action!=='stop'&&!model.capabilities?.[action])return;
    busy=true;
    const path=action==='stop'?`/api/updates/rollouts/${model.id}/stop`:`/api/updates/${model.id}/${action}`;
    const response=await fleetRequest(fetch,path,{csrf,...(action==='stop'?{expectedVersion:model.version}:{})});busy=false;
    if(clear(response))return;
    if(response.status!==200||response.data?.id!==model.id){
      if(action==='continue')render({...model,state:'uncertain',reason:message(response.data?.error),capabilities:{...model.capabilities,continue:false,reconcile:true}});
      say(message(response.data?.error));return false;
    }
    render(action==='stop'?{...response.data,kind:'rollout'}:response.data);
    say(action==='stop'?'Remaining work stopped. Dispatched work is unchanged.':action==='cancel'?'Cancellation requested; terminal provider evidence is still required.':action==='continue'?'One approved publication stage advanced. Inspect its receipt before continuing.':'Original operation checked without resubmitting an uncertain effect.');
  }
  async function continueKnown() {
    if(progressing||busy)return;
    progressing=true;pausePublication=false;
    try {
      for(let step=0;step<208&&!pausePublication&&document.visibilityState!=='hidden'&&model.capabilities?.continue;step++) {
        await act('continue');
        if(model.state==='uncertain'||model.state==='refused')break;
      }
    } finally {
      progressing=false;
      if(model.capabilities?.continue)say('Publication progression paused. Continue the original approved operation when ready.');
    }
  }
  function click(event) {
    const button=event.target.closest?.('button');if(!button)return;
    if(button.matches('[data-pause-fleet]')){pausePublication=true;say('Pausing after the current request. The original receipt remains recoverable.');return;}
    if(progressing)return;
    if(button.matches('[data-continue-fleet]')){continueKnown();return;}
    if(button.matches('[data-create-rollout]'))createRollout();
    if(button.matches('[data-prepare-preview]'))review('preparation',button.dataset.project);
    if(button.matches('[data-publication-preview]'))review('publication');
    if(button.matches('[data-submit-fleet]'))submit();
    for(const [selector,action] of [['[data-stop-rollout]','stop'],['[data-reconcile-fleet]','reconcile'],['[data-cancel-fleet]','cancel']])if(button.matches(selector))act(action);
  }
  function change() {
    const button=root.querySelector('[data-submit-fleet]');
    if(button)button.disabled=!root.querySelector('[data-approve-fleet]')?.checked||(preview?.audience==='public'&&!root.querySelector('[data-public-fleet]')?.checked)||submitted;
  }
  root.addEventListener('click',click);root.addEventListener('change',change);
  return {createRollout,review,submit,act,continueKnown,pause(){pausePublication=true;},stop(){pausePublication=true;root.removeEventListener('click',click);root.removeEventListener('change',change);}};
}
if(typeof window!=='undefined'&&typeof document!=='undefined')startFleetClient({document,window,fetch:window.fetch.bind(window)});
