import {renderPlanEditor,renderDailyPreview} from './daily-views.mjs';
export function readPlanDraft(form, base) {
  const value=name=>form.querySelector(`[name="${name}"]`)?.value??'';
  const plan=structuredClone(base);
  plan.date=value('date');plan.readyBy=value('readyBy').trim()||null;plan.shapedBy='owner';
  for(const key of ['willNotTouch','settledToday','leftOpen'])plan[key]=value(key).split(/\r?\n/).filter(line=>line.trim());
  plan.items=base.items.flatMap((item,index)=>{
    if(form.querySelector(`[name="omit-${index}"]`)?.checked)return [];
    const minutes=value(`minutes-${index}`),measure=value(`measure-${index}`).trim();
    return [{...item,title:value(`title-${index}`),kind:value(`kind-${index}`),lane:value(`lane-${index}`),budget:minutes===''?null:{minutes:Number(minutes)},number:measure?{...item.number,measure,bound:value(`bound-${index}`)===''?null:Number(value(`bound-${index}`)),better:value(`better-${index}`)}:null}];
  });
  return plan;
}
export async function dailyRequest(fetch,url,body){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),58000);
  try{const response=await fetch(url,{method:'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};}
  catch{return {status:503,data:{error:'request_unavailable'}};}
  finally{clearTimeout(timer);}
}
export function startDailyClient({document,window,fetch}){
  const root=document.querySelector('[data-daily-root]');if(!root)return null;
  let model;try{model=JSON.parse(root.querySelector('[data-daily-model]').value);}catch{return null;}
  const project=root.dataset.project,csrf=root.querySelector('[data-daily-csrf]')?.value;
  if(!/^[a-z][a-z0-9-]{0,63}$/.test(project)||model.project?.id!==project||!csrf)return null;
  let base=structuredClone(model.plan),busy=false,dirty=false,generation=0;
  const status=root.querySelector('[data-daily-status]'),output=root.querySelector('[data-evening-preview]'),editor=root.querySelector('[data-evening-editor]');
  const form=()=>root.querySelector('[data-evening-form]');
  const say=text=>{status.textContent=text;};
  function edited(){generation++;dirty=true;output.innerHTML='';say('Unsaved draft changed. Validate it again; no source records were changed.');}
  async function preview(){
    if(busy||!base||!form()?.reportValidity())return;
    const plan=readPlanDraft(form(),base),version=generation;busy=true;say('Checking current source and configured limits…');
    const response=await dailyRequest(fetch,`/api/projects/${project}/daily/preview`,{csrf,date:model.date,sourceDigest:model.sourceDigest,plan});busy=false;
    if([401,403,404].includes(response.status)){root.innerHTML='<h1>Please sign in again.</h1><p>The private daily view has been cleared.</p>';return;}
    if(version!==generation){say('Draft changed during validation. Validate the current draft again.');return;}
    if(response.status===200&&response.data?.unsaved===true&&response.data.project?.id===project){output.innerHTML=renderDailyPreview(response.data);say(response.data.valid?'Unsaved preview validated. Nothing was published or scheduled.':'Unsaved draft needs changes. Review the reported limits.');}
    else say(response.status===409?'The source changed. Your draft remains on this page; inspect fresh source before another preview.':'Preview unavailable. Your unsaved draft remains on this page.');
  }
  function addItem(){
    if(busy||!base||!form())return;base=readPlanDraft(form(),base);if(base.items.length>=64){say('A plan has at most 64 items. Existing draft items were preserved.');return;}
    let index=1;while(base.items.some(item=>item.id===`draft-${index}`))index++;
    base.items.push({id:`draft-${index}`,title:'',kind:'triage',source:'owner',number:null,lane:'',budget:null,status:'planned',result:null});
    editor.innerHTML=renderPlanEditor(base,model.budget?.lanes);edited();form()?.querySelector(`[name="title-${base.items.length-1}"]`)?.focus();
  }
  async function copyCommand(){try{await window.navigator.clipboard.writeText(model.capabilities?.cli||'plates goodnight');say('CLI command copied. It has not been executed.');}catch{say('Copy unavailable. Select the displayed CLI command manually.');}}
  const click=event=>{const target=event.target.closest?.('button');if(!target)return;if(target.matches('[data-preview-plan]'))preview();if(target.matches('[data-add-plan-item]'))addItem();if(target.matches('[data-copy-daily-cli]'))copyCommand();};
  const input=event=>{if(event.target.closest?.('[data-evening-form]'))edited();};
  const submit=event=>{if(event.target.matches?.('[data-evening-form]')){event.preventDefault();preview();}};
  const unload=event=>{if(dirty){event.preventDefault();event.returnValue='';}};
  root.addEventListener('click',click);root.addEventListener('input',input);root.addEventListener('submit',submit);window.addEventListener('beforeunload',unload);
  return {preview,addItem,getState:()=>({base,dirty,busy}),stop(){root.removeEventListener('click',click);root.removeEventListener('input',input);root.removeEventListener('submit',submit);window.removeEventListener('beforeunload',unload);}};
}
if(typeof window!=='undefined'&&typeof document!=='undefined')startDailyClient({document,window,fetch:window.fetch.bind(window)});
