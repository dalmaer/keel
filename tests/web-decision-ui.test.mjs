import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decisionView, previewView, operationView, renderDecisionPreview, renderDecisionOperation, decisionStyles } from '../lib/web/decision-views.mjs';
import { decisionHref, homeView } from '../lib/web/views.mjs';
import { createDecisionState, decisionTransition, validPreview, mayApplyDecision, operationRecoveryPath, decisionMessage, startDecisionClient } from '../lib/web/decision-client.mjs';
const project={id:'studio',repo:'acme/studio',name:'Acme Studio'}, access={csrf:'fake-acme-csrf',workspace:{name:'Acme'}};
const operationId='b'.repeat(64), previewId='a'.repeat(64);
const detail=()=>({schema:1,project,source:{path:'docs/reviews/2026-10-21.md',head:'c'.repeat(40),blob:'d'.repeat(40),branch:'main',visibility:'public',link:'https://github.com/acme/studio/blob/main/docs/reviews/2026-10-21.md'},target:{kind:'health',path:'docs/reviews/2026-10-21.md'},question:{title:'Accept the Acme repair proposal?',body:'A measured timeout needs review.',choices:[{id:'accept',label:'Accept'},{id:'decline',label:'Decline'}]},context:{state:'not-configured',digest:'e'.repeat(64),decisions:[{statement:'Keep user observations private.'}],proposals:[{statement:'Try a wider retry window.'}],gaps:[]},supported:true,submissionEnabled:false,reason:null});
const preview=()=>({id:previewId,operationId,operationUrl:`/projects/studio/operations/${operationId}`,expiresAt:'2099-10-21T00:00:00.000Z',project,source:detail().source,target:detail().target,contextDigest:'e'.repeat(64),choice:'decline',consequence:'Record this proposal as declined. No phase or issue is created.',content:'# Acme\r\n\nDecision: declined <not executable>\n',commitMessage:`Record Plates proposal decision\n\nKeel-Operation: ${operationId}`,visibility:'public',canSubmit:false,refusal:'Submission is disabled until the owner enables decision writes.'});

test('health choices are unselected, context separates accepted choices from recommendations, and JS starts with disabled preview',()=>{
  const html=decisionView(detail(),access);
  assert.match(html,/Accepted choices/); assert.match(html,/Recommendations and proposals/);
  assert.match(html,/Keep user observations private/); assert.match(html,/Try a wider retry window/);
  assert.match(html,/not verified coverage/); assert.match(html,/name="choice" value="accept" required/);
  assert.match(html,/name="choice" value="decline" required/); assert.doesNotMatch(html,/\schecked(?:\s|>)/);
  assert.match(html,/<input type="text" name="reason" maxlength="4000" aria-describedby="reason-hint">/);
  assert.match(html,/Required when declining; optional when accepting/);assert.doesNotMatch(html,/<textarea name="reason"/);
  assert.match(html,/data-preview-button disabled/); assert.match(html,/submission is disabled/);
  assert.match(html,/data-decision-csrf value="fake-acme-csrf"/);
  assert.doesNotMatch(html,/<script(?![^>]*src=)|\sonclick=/);
});
test('shaping shows advice and evidence without pre-filling or accepting the owner answer',()=>{
  const model=detail();model.target={kind:'shaping',path:'docs/shaping/next.json',question:'scope'};
  model.question={title:'Which scope should we build?',body:'The owner chooses.',choices:[],recommendation:{text:'Build the broader scope.',evidence:['docs/evidence/acme.md'],alternatives:['Keep this release small.']}};
  const html=decisionView(model,access);
  assert.match(html,/Author’s recommendation/); assert.match(html,/Build the broader scope/); assert.match(html,/Supporting evidence/); assert.match(html,/Keep this release small/);
  assert.match(html,/<textarea name="answer" required maxlength="4000" rows="5"><\/textarea>/);
  assert.doesNotMatch(html,/name="choice"|name="reason"/); assert.match(html,/does not accept proposed architecture or generate a plan/);
});
test('unsupported writers have no choice form or preview button',()=>{
  const html=decisionView({...detail(),supported:false,reason:'Use the existing policy-bound writer.'},access);
  assert.match(html,/Inspect only/); assert.match(html,/policy-bound writer/);
  assert.doesNotMatch(html,/data-decision-form|data-preview-button|name="choice"/);
});
test('public preview includes complete exact outbound text, message, destination, consequence and disabled explicit acknowledgement',()=>{
  const model=preview();model.content+='Acme full content '.repeat(6000)+'END-OF-ACME-FILE\n';
  const html=previewView(model,access);
  assert.match(html,/This change will be public/); assert.match(html,/Record this proposal as declined/);
  assert.match(html,/END-OF-ACME-FILE/); assert.match(html,/# Acme&#13;\n\nDecision: declined &lt;not executable&gt;/);
  assert.match(html,/Complete outbound file/); assert.match(html,/Exact commit message/); assert.match(html,new RegExp(`Keel-Operation: ${operationId}`));
  assert.match(html,/Destination: <strong>acme\/studio<\/strong>, branch <strong>main/);
  assert.match(html,/data-preview-ack disabled/); assert.match(html,/data-apply-decision disabled/); assert.doesNotMatch(html,/\schecked(?:\s|>)/);
  assert.match(html,/Submission is blocked/); assert.match(html,/data-reserved-operation="b{64}"/);
  assert.match(renderDecisionPreview({...model,visibility:'private'}),/This change stays in the private repository/);
});
test('all source/preview/receipt text is escaped and operation links remain local or HTTPS GitHub',()=>{
  const attack='<img src=x onerror="alert(1)">', model=detail();model.question.title=attack;model.source.link='javascript:alert(1)';model.context.decisions=[{statement:attack}];
  for(const html of [decisionView(model,access),renderDecisionPreview({...preview(),content:attack,commitMessage:attack,consequence:attack}),renderDecisionOperation({id:operationId,state:'committed',reason:attack,receipt:{commit:'f'.repeat(40),url:'https://github.com.evil.test/acme',path:attack}},'studio')]) {
    assert.doesNotMatch(html,/<img|href="javascript:|href="https:\/\/github\.com\.evil/); assert.match(html,/&lt;img/);
  }
});
test('receipts distinguish committed, refused, expired and uncertain source outcomes from acceptance',()=>{
  const committed={id:operationId,projectId:'studio',previewId,state:'committed',receipt:{commit:'f'.repeat(40),url:`https://github.com/acme/studio/commit/${'f'.repeat(40)}`,path:'docs/reviews/2026-10-21.md',actorId:123,recordedAt:'2026-10-21T16:00:00.000Z',acceptance:'not-established'}};
  const html=operationView(committed,access);
  assert.match(html,/Decision recorded/); assert.match(html,/human acceptance remain separate/); assert.match(html,/Authenticated actor<\/dt><dd>123/); assert.match(html,/Inspect recorded source/); assert.match(html,/Changed source/);
  assert.match(renderDecisionOperation({...committed,state:'refused',reason:'stale_preview',receipt:null},'studio'),/source or context changed/);
  assert.match(renderDecisionOperation({...committed,state:'refused',reason:'preview_expired',receipt:null},'studio'),/preview expired/);
  const uncertain=renderDecisionOperation({...committed,state:'uncertain',receipt:null},'studio');
  assert.match(uncertain,/Do not resubmit/); assert.match(uncertain,/data-recover-operation/); assert.doesNotMatch(uncertain,/Decision recorded|data-apply-decision/);
});
test('Home decision links require explicit health targets and never infer a writer from phase/source strings',()=>{
  const action={projectId:'studio',id:'health:docs/reviews/acme.md',link:'https://github.com/acme/studio/blob/main/docs/reviews/acme.md'};
  assert.equal(decisionHref(action),null);
  const href=decisionHref({...action,decisionTarget:{kind:'health',path:'docs/reviews/2026-10-21.md'}});
  assert.equal(href,'/projects/studio/decisions?kind=health&path=docs%2Freviews%2F2026-10-21.md');
  for(const target of [{kind:'shaping',path:'docs/question.json'},{kind:'health',path:'../secret'},{kind:'health',path:'/etc/passwd'},{kind:'health',path:'docs\\secret'}]) assert.equal(decisionHref({...action,decisionTarget:target}),null);
  const html=homeView({...access,projects:[]},{schema:1,cursor:'c'.repeat(64),projects:[],decisions:[{...action,projectName:'Acme',title:'A real question',why:'A person chooses',decisionTarget:{kind:'health',path:'docs/reviews/2026-10-21.md'}}],walks:[],waiting:[],changes:[],coverage:{state:'complete',gaps:[]},quota:{state:'unavailable'}});
  assert.match(html,/Review decision →/); assert.match(html,/kind=health&amp;path=/);
});
test('preview eligibility requires reserved identity, unexpired approval and a fresh explicit acknowledgement',()=>{
  const p={...preview(),canSubmit:true};assert.equal(validPreview(p,'studio'),true);
  for(const changed of [{operationId:null},{operationUrl:'/projects/api/operations/'+operationId},{content:null},{commitMessage:null},{project:{id:'other'}},{canSubmit:'yes'},{visibility:'unknown'}]) assert.equal(validPreview({...p,...changed},'studio'),false);
  let state=decisionTransition(createDecisionState(),{type:'preview',preview:p}); assert.equal(mayApplyDecision(state),false);
  state=decisionTransition(state,{type:'acknowledge',checked:true});assert.equal(mayApplyDecision(state),true);
  assert.equal(mayApplyDecision({...state,preview:{...p,canSubmit:false}}),false); assert.equal(mayApplyDecision(state,Date.parse(p.expiresAt)),false);
  state=decisionTransition(state,{type:'edit'});assert.equal(state.preview,null);assert.equal(mayApplyDecision(state),false);
});
test('uncertain submission cannot be edited/reposted and recovery stays bound to its original reserved ID',()=>{
  let state=decisionTransition(createDecisionState(),{type:'preview',preview:{...preview(),canSubmit:true}});
  state=decisionTransition(state,{type:'acknowledge',checked:true});state=decisionTransition(state,{type:'apply-start'});state=decisionTransition(state,{type:'uncertain'});
  assert.equal(mayApplyDecision(state),false);assert.equal(decisionTransition(state,{type:'edit'}),state);
  assert.equal(operationRecoveryPath('studio',state),`/api/projects/studio/operations/${operationId}`);
  assert.match(decisionMessage('operation_not_found'),/may still reserve/);
  assert.match(decisionStyles,/@media\(max-width:600px\)/);
});
function clientHarness({kind='health',choice='decline',reason='Keep the scope bounded.',enabled=true,responses=[]}={}) {
  // A transport/controller model, not proof of browser layout or native focus.
  const handlers={},formHandlers={},requests=[],history=[],rendered=[], timers=[];
  const control=(extra={})=>({dataset:{},disabled:false,checked:false,addEventListener(){},removeEventListener(){},...extra});
  const ack=control(),applyButton=control(),recovery=control(),status=control(),fieldset=control(),previewButton=control();
  const selectedChoice={value:choice},reasonInput={value:reason,required:false};
  const initial={...preview(),canSubmit:enabled};
  const initialNode=control({dataset:{previewId:initial.id,reservedOperation:operationId,operationUrl:initial.operationUrl,expiresAt:initial.expiresAt,canSubmit:String(enabled)}});
  const previewZone={innerHTML:'',replaceChildren(){this.innerHTML='';},querySelector(){return null;}},operationZone={innerHTML:'',querySelector(){return null;}};
  const form=control({dataset:{kind,path:kind==='health'?'docs/reviews/2026-10-21.md':'docs/shaping/acme.json',...(kind==='shaping'?{question:'scope'}:{})},addEventListener(type,fn){formHandlers[type]=fn;},reportValidity:()=>!(reasonInput.required && !reasonInput.value),querySelector(selector){return selector==='fieldset'?fieldset:selector==='[data-preview-button]'?previewButton:selector==='input[name="choice"]:checked'?selectedChoice:selector==='[name="reason"]'?reasonInput:selector==='[name="answer"]'?{value:'Choose the smaller scope, contrary to the recommendation.'}:null;}});
  const elements={'[data-decision-csrf]':{value:'fake-acme-csrf'},'[data-decision-form]':form,'[data-decision-preview]':previewZone,'[data-decision-operation]':operationZone,'[data-decision-status]':status,'[data-preview-id]':initialNode,'[data-preview-ack]':ack,'[data-apply-decision]':applyButton,'[data-recover-operation]':recovery};
  const root={dataset:{project:'studio'},querySelector:selector=>elements[selector]??null,addEventListener(type,fn){handlers[type]=fn;},removeEventListener(){}};
  const document={querySelector:selector=>selector==='[data-decision-root]'?root:null};
  const window={location:{pathname:'/projects/studio/decisions',search:'?kind=health&path=docs%2Freviews%2F2026-10-21.md'},history:{replaceState(_state,_title,path){history.push(path);}},setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(){}};
  const fetch=async(url,options)=>{requests.push({url,...options,body:options.body?JSON.parse(options.body):null});const next=responses.shift();if(next instanceof Error)throw next;return {status:next?.status??200,json:async()=>next?.data??initial};};
  const client=startDecisionClient({document,window,fetch,renderDecisionPreview:model=>{rendered.push({preview:model});return 'Acme preview';},renderDecisionOperation:model=>{rendered.push({operation:model});return 'Acme operation';}});
  return {client,requests,history,rendered,status,ack,applyButton,reasonInput,choose(value){selectedChoice.value=value;formHandlers.change();},acknowledge(){ack.checked=true;handlers.change({target:{checked:true,matches:()=>true}});}};
}
test('lost apply response is followed only by GET recovery, including operation-not-found and mismatched receipts',async()=>{
  const h=clientHarness({responses:[new Error('Acme lost response'),{status:404,data:{error:'operation_not_found'}},{status:200,data:{id:'f'.repeat(64),state:'committed'}},{status:200,data:{id:operationId,previewId,state:'committed',receipt:{commit:'e'.repeat(40)}}}]});
  try {
    await h.client.apply();assert.equal(h.requests.length,0,'no implicit acknowledgement');h.acknowledge();await h.client.apply();
    assert.deepEqual(h.history,[`/projects/studio/operations/${operationId}`]);assert.equal(h.client.getState().operation.state,'uncertain');
    await h.client.apply();assert.equal(h.requests.length,1,'uncertain POST is never repeated');
    await h.client.recover();assert.match(h.status.textContent,/may still reserve/);assert.equal(h.client.getState().operation.state,'uncertain');
    await h.client.recover();assert.equal(h.client.getState().operation.id,operationId);assert.equal(h.client.getState().operation.state,'uncertain');
    await h.client.recover();assert.equal(h.client.getState().operation.state,'committed');
    assert.deepEqual(h.requests.map(r=>r.method),['POST','GET','GET','GET']);assert.deepEqual(h.requests[0].body,{csrf:'fake-acme-csrf',previewId});
    assert.ok(h.requests.slice(1).every(r=>r.url===`/api/projects/studio/operations/${operationId}`));
  } finally {h.client.stop();}
});
test('blocked submission makes no POST even after an acknowledgement event, while preview stays available',async()=>{
  const h=clientHarness({enabled:false});try{h.acknowledge();await h.client.apply();assert.equal(h.requests.length,0);assert.equal(h.applyButton.disabled,true);await h.client.preview({preventDefault(){}});assert.equal(h.requests[0].url,'/api/projects/studio/decisions/preview');assert.equal(h.requests[0].body.choice,'decline');assert.equal(h.client.getState().acknowledged,false);}finally{h.client.stop();}
});
test('shaping preview sends the explicit owner answer without selecting the recommendation or adding health fields',async()=>{
  const h=clientHarness({kind:'shaping',enabled:false});try{await h.client.preview({preventDefault(){}});assert.deepEqual(h.requests[0].body,{csrf:'fake-acme-csrf',target:{kind:'shaping',path:'docs/shaping/acme.json',question:'scope'},answer:'Choose the smaller scope, contrary to the recommendation.'});}finally{h.client.stop();}
});
test('a definitive pre-dispatch expiry disables the old preview and requires another preview without claiming a receipt',async()=>{
  const h=clientHarness({responses:[{status:410,data:{error:'preview_expired'}}]});try{h.acknowledge();await h.client.apply();assert.equal(h.client.getState().preview,null);assert.equal(h.client.getState().operation,null);assert.equal(h.applyButton.disabled,true);assert.match(h.status.textContent,/preview expired/);assert.equal(h.history.length,2);await h.client.apply();assert.equal(h.requests.length,1);}finally{h.client.stop();}
});

test('health reason is single-line and conditionally required only for a decline, allowing empty acceptance',async()=>{
  const h=clientHarness({choice:'decline',reason:''});
  try {
    assert.equal(h.reasonInput.required,true);await h.client.preview({preventDefault(){}});assert.equal(h.requests.length,0);
    h.choose('accept');assert.equal(h.reasonInput.required,false);await h.client.preview({preventDefault(){}});
    assert.equal(h.requests.length,1);assert.equal(h.requests[0].body.choice,'accept');assert.equal(h.requests[0].body.reason,'');
    h.choose('decline');assert.equal(h.reasonInput.required,true);assert.equal(h.client.getState().preview,null);
  } finally {h.client.stop();}
});
