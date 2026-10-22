import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkView, walkIndexView, renderWalkDetail, renderWalkPreview, renderWalkOperation, renderWalkRepair } from '../lib/web/walk-views.mjs';
import { canPreviewWalk, validWalkPreview, startWalkClient } from '../lib/web/walk-client.mjs';
const H = letter => letter.repeat(64), operationId=H('e');
const model = () => ({schema:1,project:{id:'studio',repo:'acme/studio',name:'Acme Studio'},walk:{id:'search',title:'Test Acme search',target:{phase:'docs/phases/01-search.md',box:2,text:'The owner tests search.'},readiness:{state:'ready',reason:'Acme is ready.'},result:{sourceRevision:'a'.repeat(40),artifactId:'preview',version:'v1',contentHash:H('b'),environment:'Acme staging',verification:'bytes-verified',previewUrl:'https://acme.test/preview'},steps:[{id:'open',instruction:'Open Acme search',expected:'Both rows are visible.',requires:[]},{id:'filter',instruction:'Filter the rows',expected:'Only the matching row remains.',requires:['open']}]},source:{head:'c'.repeat(40),branch:'main',visibility:'public'},sourceDigest:H('c'),ready:true,gaps:[],choices:['Verified','Needs changes'],keepsOpen:['Needs changes'],draft:{id:H('a'),revision:1,digest:H('d'),environment:'',resultConfirmed:false,steps:[{id:'open',outcome:'unobserved',note:'',current:false},{id:'filter',outcome:'unobserved',note:'',current:false}],finalObservation:'',choice:null,historyCount:0,history:[]},submissionEnabled:false});
function complete() {const m=model();m.draft.environment='Acme staging on desktop';m.draft.resultConfirmed=true;m.draft.finalObservation='Acme showed the expected rows.';m.draft.choice='Verified';m.draft.steps=m.draft.steps.map(s=>({...s,outcome:'pass',current:true}));return m;}
const preview = m => ({schema:1,kind:'walk',id:H('f'),digest:H('a'),operationId,operationUrl:`/projects/studio/operations/${operationId}`,project:m.project,source:m.source,draftDigest:m.draft.digest,visibility:'public',expiresAt:'2099-10-21T00:00:00.000Z',canSubmit:true,consequence:'Check only the selected acceptance item.',observation:m.draft.finalObservation,files:[{path:m.walk.target.phase,content:'# Acme\r\n- [x] Reviewed\n',originalBlob:'b'.repeat(40)},{path:'docs/evidence/acme.md',content:'Acme final owner observation.\n',originalBlob:null},{path:'docs/ROADMAP.md',content:'# Acme roadmap\n',originalBlob:'c'.repeat(40)}],commitMessage:'Record Acme walk\n\nKeel-Operation: '+operationId});

test('authored instruction, expected result and actual note are distinct with no preselected success',()=>{
  const m=model(),html=walkView(m,{csrf:'fake-acme-csrf'});
  assert.match(html,/Open Acme search/);assert.match(html,/Expected result/);assert.match(html,/Both rows are visible/);assert.match(html,/Your actual observation/);
  assert.match(html,/This works/);assert.match(html,/Doesn’t work/);assert.match(html,/Can’t test yet/);
  assert.doesNotMatch(html,/type="radio"[^>]+checked|An earlier outcome belongs|Earlier result; observe again/);
  assert.match(html,/name="environment" maxlength="200"/);assert.match(html,/data-save-walk disabled/);
  assert.match(html,/0 observed · 0 failed · 0 blocked/);assert.match(html,/confirmation|confirmed/);assert.doesNotMatch(html,/<script(?![^>]*src=)/);
  m.walk.result.verification='unavailable';assert.match(renderWalkDetail(m),/Exact result bytes are not verified/);
});
test('stale outcomes and private history retain exact original instructions, time, result and environment',()=>{
  const m=model();m.draft.historyCount=1;m.draft.history=[{stepId:'open',outcome:'fail',time:'2026-10-21T18:00:00.000Z',note:'Acme lost a row.',environment:'Acme old staging',result:{version:'v0',sourceRevision:'f'.repeat(40),contentHash:H('e')},step:{instruction:'Original Acme instruction',expected:'Original Acme expectation'}}];
  const html=renderWalkDetail(m);for(const text of ['Earlier result; observe again','Original Acme instruction','Original Acme expectation','Acme old staging','2026-10-21T18:00:00.000Z','v0','f'.repeat(40),'Acme lost a row.'])assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/type="radio"[^>]+checked/);
});
test('successful preview gates reject incomplete, failed, blocked, stale, wrong environment and keeps-open choices',()=>{
  assert.equal(canPreviewWalk(complete()),true);assert.equal(canPreviewWalk(model()),false);
  for(const change of [m=>m.ready=false,m=>m.draft.resultConfirmed=false,m=>m.draft.environment='',m=>m.draft.finalObservation='',m=>m.draft.choice='Needs changes',m=>m.draft.choice=null,...['fail','blocked','unobserved'].map(outcome=>m=>m.draft.steps[0].outcome=outcome),m=>m.draft.steps[0].current=false]){const m=complete();change(m);assert.equal(canPreviewWalk(m),false);}
});
test('final preview shows all complete exact files, selected public observation and an unchecked acknowledgement',()=>{
  const m=complete(),p=preview(m);p.files[1].content+='Acme full evidence '.repeat(4000)+'ACME-END';
  const html=renderWalkPreview(p);for(const file of p.files)assert.ok(html.includes(file.path));
  assert.match(html,/# Acme&#13;\n- \[x\] Reviewed/);assert.match(html,/ACME-END/);assert.match(html,/your selected observation will be public/);assert.match(html,/Acme showed the expected rows/);
  assert.match(html,/data-walk-ack >|data-walk-ack >/);assert.doesNotMatch(html,/data-walk-ack[^>]*checked/);assert.match(html,/data-apply-walk disabled/);
  assert.equal(validWalkPreview(p,'studio',m.draft.digest),true);assert.equal(validWalkPreview({...p,draftDigest:H('0')},'studio',m.draft.digest),false);
});
test('all authored text is escaped and neither a preview nor a committed label without receipt claims source success',()=>{
  const m=model();m.walk.title='<img src=x onerror=alert(1)>';m.walk.result.previewUrl='javascript:alert(1)';
  const html=renderWalkDetail(m);assert.doesNotMatch(html,/<img|href="javascript:/);assert.match(html,/&lt;img/);
  assert.match(renderWalkOperation({id:operationId,state:'committed',receipt:null},'studio'),/Source outcome not yet confirmed/);
  assert.match(renderWalkOperation({id:operationId,state:'uncertain',receipt:null},'studio'),/Do not resubmit/);
  const receipt=renderWalkOperation({id:operationId,state:'committed',receipt:{commit:'a'.repeat(40),url:'https://github.com/acme/studio/commit/'+ 'a'.repeat(40),paths:['docs/phases/01-search.md','docs/evidence/acme.md'],recordedAt:'2026-10-21T18:00:00.000Z'}},'studio');
  assert.match(receipt,/Source commit verified/);assert.match(receipt,/docs\/evidence\/acme.md/);
  assert.match(walkIndexView({project:m.project,items:[],gaps:['unavailable']},{csrf:'fake-acme'}),/No known authored walks in this incomplete read/);
});

// A real controller/transport model. Native layout and focus are separately walked in a browser.
function controller(initial,{responses=[]}={}) {
  const handlers={},windowHandlers={},requests=[],history=[],modelValue=structuredClone(initial),controls=new Map();let rendered='';
  const element=(extra={})=>({disabled:false,checked:false,value:'',dataset:{},focus(){},reportValidity(){return true;},...extra});
  const env=element({name:'environment',value:modelValue.draft.environment}),confirmed=element({name:'resultConfirmed',checked:modelValue.draft.resultConfirmed}),final=element({value:modelValue.draft.finalObservation});
  const outcomes=Object.fromEntries(modelValue.draft.steps.map(s=>[s.id,element({value:s.outcome})])),notes=Object.fromEntries(modelValue.draft.steps.map(s=>[s.id,element({value:s.note})]));
  const choice=element({value:modelValue.draft.choice}),fieldset=element(),save=element(),review=element(),ack=element(),apply=element(),reload=element(),status=element();
  const zone=()=>({innerHTML:'',replaceChildren(){this.innerHTML='';}}),previewZone=zone(),operationZone=zone();
  const form={querySelector:()=>fieldset};
  const root={dataset:{project:'studio',walk:'search'},innerHTML:'',querySelector(selector){
    const exact={'[data-walk-csrf]':{value:'fake-acme-csrf'},'[data-walk-model]':{value:JSON.stringify(modelValue)},'[data-walk-content]':{set innerHTML(value){rendered=value;}},'[data-walk-preview]':previewZone,'[data-walk-operation]':operationZone,'[data-walk-status]':status,'[data-walk-form]':form,'[data-preview-walk]':review,'[data-walk-ack]':ack,'[data-apply-walk]':apply,'[data-reload-walk]':reload,'[name="environment"]':env,'[name="resultConfirmed"]':confirmed,'[name="finalObservation"]':final,'input[name="choice"]:checked':choice};
    if(selector in exact)return exact[selector];
    const out=selector.match(/^input\[name="outcome-(.+)"\]:checked$/);if(out)return outcomes[out[1]].value==='unobserved'?null:outcomes[out[1]];
    const note=selector.match(/^\[name="note-(.+)"\]$/);if(note)return notes[note[1]];
    return null;
  },querySelectorAll(selector){if(selector==='[data-save-walk]')return [save];if(selector==='input[type="radio"]')return [...Object.values(outcomes),choice];return [];},addEventListener(type,fn){handlers[type]=fn;},removeEventListener(){}};
  const document={querySelector:selector=>selector==='[data-walk-root]'?root:null};
  const window={location:{pathname:'/projects/studio/walks/search',search:''},history:{replaceState(_a,_b,path){history.push(path);}},setTimeout(){return 1;},clearTimeout(){},addEventListener(name,fn){windowHandlers[name]=fn;},removeEventListener(name){delete windowHandlers[name];}};
  const fetch=async(url,options)=>{requests.push({url,method:options.method,body:options.body?JSON.parse(options.body):null});const next=responses.shift();if(next instanceof Error)throw next;return {status:next?.status??200,json:async()=>next?.data??modelValue};};
  const client=startWalkClient({document,window,fetch,renderWalkDetail:()=>'<Acme rendered walk>',renderWalkPreview:()=>'<Acme exact preview>',renderWalkOperation:operation=>JSON.stringify(operation)});
  return {client,requests,history,root,windowHandlers,notes,env,final,status,save,review,apply,ack,previewZone,rendered:()=>rendered,edit(step='open'){handlers.input({target:{name:`note-${step}`,closest:selector=>selector==='[data-walk-form]'?form:null}});},acknowledge(){ack.checked=true;handlers.change({target:{checked:true,matches:()=>true}});}};
}
test('CAS conflict retains unsaved actual notes and disables overwrite until explicit saved-draft reload',async()=>{
  const m=complete(),fresh=complete();fresh.draft.revision=3;fresh.draft.digest=H('9');
  const h=controller(m,{responses:[{status:409,data:{error:'draft_conflict'}},{status:200,data:fresh}]});
  try {h.notes.open.value='Acme unsaved observation';h.edit();await h.client.save();assert.equal(h.notes.open.value,'Acme unsaved observation');assert.equal(h.client.getState().conflict,true);assert.match(h.status.textContent,/Another tab/);assert.equal(h.requests[0].body.expectedRevision,1);assert.equal(h.requests[0].body.step.note,'Acme unsaved observation');
    await h.client.save();assert.equal(h.requests.length,1);await h.client.reload();assert.equal(h.requests[1].method,'GET');assert.equal(h.client.getState().model.draft.revision,3);assert.equal(h.client.getState().dirty,false);
  }finally{h.client.stop();}
});
test('failure requires actual detail while partially typed unobserved notes save without inventing a pass',async()=>{
  const m=model(),h=controller(m);try{h.notes.open.value='Acme partial notes';h.edit();await h.client.save();assert.equal(h.requests[0].body.step.outcome,'unobserved');assert.equal(h.requests[0].body.step.note,'Acme partial notes');assert.equal(h.requests[0].body.resultConfirmed,false);}finally{h.client.stop();}
  const f=complete();f.draft.steps[0].outcome='fail';const failed=controller(f);try{await failed.client.save();assert.equal(failed.requests.length,0);assert.match(failed.status.textContent,/Describe what happened/);}finally{failed.client.stop();}
});
test('preview edits invalidate approval; public dispatch carries exact acknowledged digest and lost responses recover GET-only',async()=>{
  const m=complete(),p=preview(m),h=controller(m,{responses:[{status:200,data:p},new Error('Acme lost apply response'),{status:404,data:{error:'operation_not_found'}},{status:200,data:{id:operationId,kind:'walk',state:'committed',receipt:{commit:'a'.repeat(40)}}}]});
  try{await h.client.review();await h.client.apply();assert.equal(h.requests.length,1);h.acknowledge();await h.client.apply();assert.equal(h.requests[1].body.publicAcknowledgement,p.digest);assert.equal(h.history[0],p.operationUrl);assert.equal(h.client.getState().operation.state,'uncertain');await h.client.apply();assert.equal(h.requests.length,2);await h.client.recover();assert.match(h.status.textContent,/may still reserve/);await h.client.recover();assert.deepEqual(h.requests.map(r=>r.method),['POST','POST','GET','GET']);assert.equal(h.client.getState().operation.state,'committed');}finally{h.client.stop();}
  const edited=controller(m,{responses:[{status:200,data:p}]});try{await edited.client.review();edited.acknowledge();edited.edit();await edited.client.apply();assert.equal(edited.requests.length,1);assert.equal(edited.client.getState().preview,null);}finally{edited.client.stop();}
});
test('access loss clears private rendered draft and disabled publication never dispatches',async()=>{
  const m=complete(),denied=controller(m,{responses:[{status:403,data:{error:'submission_disabled'}}]});try{await denied.client.review();assert.match(denied.status.textContent,/disabled/);await denied.client.apply();assert.equal(denied.requests.length,1);}finally{denied.client.stop();}
  const h=controller(m,{responses:[{status:401,data:{error:'access_denied'}}]});try{await h.client.reload();assert.match(h.root.innerHTML,/Sign in and return/);assert.ok(h.root.innerHTML.includes('/signin?returnTo='+encodeURIComponent('/projects/studio/walks/search')));assert.doesNotMatch(h.root.innerHTML,/data-walk-form|data-final-observation/);assert.equal(h.client.getState().locked,true);}finally{h.client.stop();}
});

test('repair preview leads with exact readable destination and body while machine handoff stays optional',()=>{
  const html=renderWalkRepair({status:'preview',destination:'acme/studio',outbound:{title:'Repair Acme search',body:'### Actual observation\nAcme shows <missing> row.'},links:{source:'https://github.com/acme/studio/commit/'+ 'a'.repeat(40)},handoff:{instanceId:H('a')}});
  assert.match(html,/<h3 tabindex="-1">Repair Acme search/);assert.match(html,/Destination: <strong>acme\/studio/);assert.match(html,/Not created. No work started./);assert.match(html,/Acme shows &lt;missing&gt; row/);
  assert.ok(html.indexOf('Exact outbound body')<html.indexOf('Advanced: exact machine handoff'));assert.match(html,/<details><summary>Advanced/);assert.doesNotMatch(html,/<button[^>]*>.*Create/);
  assert.match(renderWalkRepair({status:'unavailable'}),/Required source or routing facts are unavailable/);
});


test('saving unchanged controls does not recapture step or final evidence, and editing a step clears the prior final observation',async()=>{
  const m=complete(),h=controller(m);
  try{await h.client.save();assert.equal(Object.hasOwn(h.requests[0].body,'step'),false);assert.equal(Object.hasOwn(h.requests[0].body,'finalObservation'),false);
    h.notes.open.value='Acme revised actual observation';h.edit();assert.equal(h.final.value,'');await h.client.save();
    assert.equal(h.requests[1].body.step.note,'Acme revised actual observation');assert.equal(h.requests[1].body.finalObservation,'');
  }finally{h.client.stop();}
});
test('source change refusal preserves typed notes and identifies the source rather than inventing another tab',async()=>{
  const h=controller(complete(),{responses:[{status:409,data:{error:'walk_source_changed'}}]});
  try{h.notes.open.value='Acme retained note';h.edit();await h.client.save();assert.equal(h.notes.open.value,'Acme retained note');assert.match(h.status.textContent,/captured source changed/);assert.doesNotMatch(h.status.textContent,/Another tab/);assert.equal(h.client.getState().conflict,true);}finally{h.client.stop();}
});

test('walk access loss drops its dirty unload guard after private content is cleared',async()=>{
  const h=controller(complete(),{responses:[{status:401,data:{error:'access_denied'}}]});
  try {
    h.notes.open.value='Acme unsaved observation';h.edit();
    let warnings=0;h.windowHandlers.beforeunload({preventDefault(){warnings++;}});assert.equal(warnings,1);
    await h.client.reload();assert.equal(h.client.getState().locked,true);
    warnings=0;h.windowHandlers.beforeunload?.({preventDefault(){warnings++;}});assert.equal(warnings,0);
    assert.equal(h.client.getState().dirty,false);assert.match(h.root.innerHTML,/Unsaved text was not saved/);
  } finally {h.client.stop();}
});
