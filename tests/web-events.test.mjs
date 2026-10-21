import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPollState, transitionPoll, canHydrateInitial, matchesHomeFilter, fetchHomeResponse, startHomeClient, POLL_INTERVAL, MAX_BACKOFF } from '../lib/web/home-client.mjs';
const cursor='a'.repeat(64), next='b'.repeat(64);
const snapshot=(value=next,cursorState='changed')=>({schema:1,cursor:value,cursorState,projects:[],coverage:{state:'partial',gaps:[{source:'Acme',reason:'Unavailable'}]}});
const receive=(state,data=snapshot(),fresh=false)=>transitionPoll(state,{type:'response',status:200,snapshot:data,fresh});
test('new snapshots queue without replacing displayed state; explicit apply alone consumes pending updates',()=>{
  const initial=createPollState(cursor), before=JSON.stringify(initial);
  const queued=receive(transitionPoll(initial,{type:'start'}));
  assert.equal(JSON.stringify(initial),before); assert.equal(queued.pending.cursor,next); assert.equal(queued.updates,1);
  assert.match(queued.notice,/current view is unchanged/); assert.equal(queued.pending.coverage.state,'partial');
  const unchanged=receive(queued,snapshot(next,'current')); assert.equal(unchanged.updates,1); assert.equal(unchanged.pending,queued.pending);
  const applied=transitionPoll(queued,{type:'apply'}); assert.equal(applied.pending,null); assert.equal(applied.updates,0); assert.match(applied.notice,/Recheck any open source details/);
});
test('hidden tabs stop work, overlapping requests do not start, and visibility resumes eligibility',()=>{
  let state=transitionPoll(createPollState(cursor),{type:'start'}); assert.equal(state.inFlight,true);
  assert.equal(transitionPoll(state,{type:'start'}),state);
  state=transitionPoll(state,{type:'visibility',visible:false}); assert.equal(state.inFlight,false); assert.equal(state.visible,false);
  assert.equal(transitionPoll(state,{type:'start'}),state);
  state=transitionPoll(state,{type:'visibility',visible:true}); assert.equal(transitionPoll(state,{type:'start'}).inFlight,true);
});
test('source failures retain prior pending data and exponentially back off under a five-minute bound',()=>{
  let state=receive(createPollState(cursor)), pending=state.pending;
  for(const delay of [120000,240000,300000,300000]) {
    state=transitionPoll(state,{type:'response',status:503}); assert.equal(state.delay,delay); assert.equal(state.pending,pending); assert.equal(state.status,'stale'); assert.match(state.notice,/previous view may be stale/);
  }
  assert.equal(state.delay,MAX_BACKOFF);
  state=transitionPoll(state,{type:'response',status:304}); assert.equal(state.delay,POLL_INTERVAL); assert.equal(state.failures,0); assert.equal(state.pending,pending); assert.doesNotMatch(state.notice,/unavailable/);
});
test('denied access clears queued private snapshots and is terminal until a fresh sign-in page',()=>{
  for(const status of [401,403,404]) {
    const denied=transitionPoll(receive(createPollState(cursor)),{type:'response',status});
    assert.equal(denied.pending,null); assert.equal(denied.cursor,null); assert.equal(denied.denied,true);
    assert.equal(receive(denied),denied); assert.equal(transitionPoll(denied,{type:'start'}),denied);
  }
});
test('cursor gaps request one fresh bounded view and never claim contiguous history',()=>{
  let state=receive(createPollState(cursor),snapshot(next,'gap'));
  assert.equal(state.needsFresh,true); assert.match(state.notice,/history has a gap/);
  state=receive(state,snapshot(next,'current'),true); assert.equal(state.needsFresh,false); assert.match(state.notice,/after a history gap/); assert.equal(state.pending.cursor,next);
  state=receive(state,snapshot(next,'gap'),true); assert.equal(state.needsFresh,false,'fresh response cannot create an endless immediate refresh loop');
});
test('malformed API success is an unavailable refresh, never an empty successful board',()=>{
  for(const data of [null,{},snapshot('bad'),{...snapshot(),schema:2},{...snapshot(),projects:null}]) {
    const state=receive(createPollState(cursor),data); assert.equal(state.status,'stale'); assert.equal(state.cursor,cursor); assert.equal(state.pending,null);
  }
});
test('display filters match item search/group while coverage is structurally outside filtering',async()=>{
  assert.equal(matchesHomeFilter({search:'Acme Studio · Publish',groups:'attention'},' studio ','attention'),true);
  assert.equal(matchesHomeFilter({search:'Acme Studio',groups:'attention'},'api','all'),false);
  assert.equal(matchesHomeFilter({search:'Acme Studio',groups:'attention'},'','waiting'),false);
  const code=await readFile(new URL('../lib/web/home-client.mjs',import.meta.url),'utf8');
  assert.match(code,/querySelectorAll\('\[data-filterable\]'\)/);
  assert.doesNotMatch(code,/localStorage|sessionStorage|EventSource|WebSocket|method:'POST'/);
});

test('a hanging abort-aware request times out, clears in-flight and backs off before another request', async () => {
  const controller=new AbortController();
  let requested=0;
  const fetch=(_url,{signal})=>new Promise((_resolve,reject)=>{
    requested++;
    signal.addEventListener('abort',()=>reject(Object.assign(new Error('Acme timeout'),{name:'AbortError'})),{once:true});
  });
  const started=transitionPoll(createPollState(cursor),{type:'start'});
  const response=await fetchHomeResponse({fetch,url:'https://acme.test/api/home',headers:{},controller,timeout:1});
  assert.equal(requested,1); assert.equal(controller.signal.aborted,true); assert.equal(response.status,503);
  const failed=transitionPoll(started,{type:'response',...response});
  assert.equal(failed.inFlight,false); assert.equal(failed.status,'stale'); assert.equal(failed.delay,120000);
  assert.equal(transitionPoll(failed,{type:'start'}).inFlight,true);
});

test('client scheduling starts the first visible read immediately and then resumes its normal interval', async () => {
  // A scheduler/transport harness only; this makes no browser layout or focus claim.
  const scheduled=[], requests=[];
  const cards=[{dataset:{search:'Acme studio',groups:'attention'}},{dataset:{search:'Acme API',groups:'waiting'}}];
  const root={dataset:{endpoint:'/api/home',cursor,projectId:''},querySelectorAll(selector){assert.equal(selector,'[data-filterable]');return cards;}};
  const search={value:'studio',addEventListener(){},removeEventListener(){}};
  const filter={value:'all',addEventListener(){},removeEventListener(){}};
  const elements={'[data-home-root]':root,'[data-home-search]':search,'[data-home-filter]':filter};
  const document={hidden:false,querySelector:selector=>elements[selector]??null,addEventListener(){},removeEventListener(){}};
  const window={location:{origin:'https://acme.test'},setTimeout(callback,delay){ scheduled.push({callback,delay}); return scheduled.length; },clearTimeout(){}};
  const client=startHomeClient({document,window,fetch:async(url,options)=>{requests.push({url,options});return{status:304};},renderHomeSnapshot:()=>{throw new Error('An unchanged source read must not render.');}});
  assert.equal(cards[0].hidden,false); assert.equal(cards[1].hidden,true,'initial filtering applies before any source response');
  assert.equal(scheduled.length,1); assert.equal(scheduled[0].delay,0);
  await scheduled[0].callback();
  assert.equal(requests.length,1); assert.equal(requests[0].options.method,'GET');
  assert.equal(scheduled.at(-1).delay,POLL_INTERVAL); client.stop();
  document.hidden=true;
  const before=scheduled.length;
  const hidden=startHomeClient({document,window,fetch:async()=>{throw new Error('Hidden page must not read.');},renderHomeSnapshot:()=>''});
  assert.equal(scheduled.length,before); hidden.stop();
});

test('only the first real response to an entirely loading shell is eligible for automatic hydration', () => {
  const loading={...snapshot(),projects:[{id:'studio',state:'loading'}]};
  let state=receive(createPollState(cursor,{loadingOnly:true}),loading);
  assert.equal(canHydrateInitial(state),false);
  state=transitionPoll(state,{type:'apply'}); assert.equal(state.loadingOnly,true,'applying another loading shell still permits first real hydration');
  state=receive(state,{...snapshot('c'.repeat(64)),projects:[{id:'studio',state:'partial'}]});
  assert.equal(canHydrateInitial(state),true);
  state=transitionPoll(state,{type:'apply',automatic:true});
  assert.equal(state.loadingOnly,false); assert.match(state.notice,/Project sources loaded/);
  state=receive(state,{...snapshot('d'.repeat(64)),projects:[{id:'studio',state:'complete'}]});
  assert.equal(canHydrateInitial(state),false); assert.ok(state.pending);
  assert.equal(canHydrateInitial(receive(createPollState(cursor),snapshot())),false,'existing partial or complete renders keep explicit apply');
});
function hydrationHarness({loadingOnly=true,insideFocus=false}={}) {
  // Models DOM integration calls only; real focus/layout remains a browser walk.
  const scheduled=[], renders=[], scrolls=[], focused=[];
  const element=(props={})=>({dataset:{},addEventListener(){},removeEventListener(){},closest(){return null;},...props});
  let detail=element({dataset:{detail:'source-studio'},open:true}), summary;
  const search=element({value:'studio'}), filter=element({value:'all'}), apply=element(), message=element(), filterStatus=element();
  const refresh=element({focus(){focused.push('refresh');document.activeElement=refresh;}});
  const cards=[element({dataset:{search:'Acme studio',groups:'attention'}}),element({dataset:{search:'Acme api',groups:'waiting'}})];
  const newSummary=()=>element({dataset:{focus:'source-studio'},focus(){focused.push('source-studio');document.activeElement=this;}});
  summary=newSummary();
  const root={dataset:{endpoint:'/api/home',cursor,projectId:'',initialLoading:String(loadingOnly)},
    contains(node){return node===summary;},
    querySelectorAll(selector){return selector==='details[open][data-detail]'?(detail.open?[detail]:[]):selector==='details[data-detail]'?[detail]:selector==='[data-filterable]'?cards:selector==='[data-focus]'?[summary]:[];},
    set innerHTML(value){renders.push(value);detail=element({dataset:{detail:'source-studio'},open:false});summary=newSummary();}};
  const elements={'[data-home-root]':root,'[data-refresh]':refresh,'[data-apply-updates]':apply,'[data-refresh-status]':message,'[data-home-search]':search,'[data-home-filter]':filter,'[data-filter-status]':filterStatus};
  const document={hidden:false,activeElement:insideFocus?summary:search,querySelector:selector=>elements[selector]??null,addEventListener(){},removeEventListener(){}};
  const window={location:{origin:'https://acme.test'},scrollX:12,scrollY:345,scrollTo(value){scrolls.push(value);},setTimeout(callback,delay){scheduled.push({callback,delay});return scheduled.length;},clearTimeout(){}};
  let calls=0;
  const client=startHomeClient({document,window,fetch:async()=>({status:200,json:async()=>({...snapshot((++calls===1?'b':'c').repeat(64)),projects:[{id:'studio',state:'partial'}]})}),renderHomeSnapshot:data=>`rendered-${data.cursor}`});
  return {client,scheduled,renders,scrolls,focused,search,filter,apply,message,cards,document,root,detail:()=>detail};
}
test('first hydration renders immediately while retaining search, disclosure, outside focus and scroll; later changes queue',async()=>{
  const h=hydrationHarness();
  try {
    await h.scheduled[0].callback();
    assert.equal(h.renders.length,1); assert.equal(h.apply.hidden,true); assert.equal(h.root.dataset.initialLoading,'false');
    assert.equal(h.search.value,'studio'); assert.equal(h.filter.value,'all'); assert.equal(h.document.activeElement,h.search);
    assert.deepEqual(h.focused,[],'an open disclosure must not steal search focus'); assert.equal(h.detail().open,true);
    assert.deepEqual(h.scrolls,[{left:12,top:345}]); assert.equal(h.cards[0].hidden,false); assert.equal(h.cards[1].hidden,true);
    await h.client.poll();
    assert.equal(h.renders.length,1); assert.equal(h.apply.hidden,false); assert.match(h.apply.textContent,/1 new update/);
  } finally {h.client.stop();}
});
test('first hydration restores a stable source focus key, while preexisting partial content never autoapplies',async()=>{
  const cold=hydrationHarness({insideFocus:true}), partial=hydrationHarness({loadingOnly:false});
  try {
    await cold.scheduled[0].callback(); assert.deepEqual(cold.focused,['source-studio']); assert.equal(cold.document.activeElement.dataset.focus,'source-studio');
    await partial.scheduled[0].callback(); assert.equal(partial.renders.length,0); assert.equal(partial.apply.hidden,false); assert.deepEqual(partial.scrolls,[]);
  } finally {cold.client.stop();partial.client.stop();}
});
