import test from 'node:test';
import assert from 'node:assert/strict';
import {changeDetailView,changeIndexView,renderJournalCard,comparablePairs,privateImagePath,captureView,availabilityView} from '../lib/web/change-views.mjs';
import {renderMediaReceipt,renderUploadReview,renderDeleteReview} from '../lib/web/media-views.mjs';
import {journalWindow,journalMatches,readJournalVisits} from '../lib/web/change-client.mjs';
import {renderHomeSnapshot} from '../lib/web/views.mjs';
import {changesHarness,token} from './helpers/web-changes.mjs';
import {createWebService} from '../lib/web/server.mjs';
const hex=c=>c.repeat(64),access={workspace:{id:'acme',name:'Acme'},userId:1,csrf:'fake-acme-csrf'};
const receipt=()=>({schema:1,id:hex('a'),projectId:'studio',changeId:'acme-search',slotId:'desktop-after',state:'verified',availability:'current',objectCheck:'not-checked',checkedAt:null,hash:hex('b'),mime:'image/png',width:1280,height:800,bytes:900,provenance:{revision:'b'.repeat(40),environment:'Acme staging',viewport:'desktop',viewportWidth:1280,viewportHeight:800,scenario:'Search',capturedAt:'2026-10-21T12:00:00.000Z',caption:'Acme search results',alt:'Two Acme results'},source:{head:'b'.repeat(40)},expiresAt:'2026-11-21T12:00:00.000Z',uploaderId:1,attached:true,attachmentRevision:1,revision:3,deleteDigest:hex('c'),deliveryUrl:`/api/projects/studio/media/${hex('a')}/bytes`});
async function sourceModel(){const h=changesHarness();return h.changes.detail(h.access,token,h.project,'acme-search');}
test('actual authored journal result renders on Home with private capture, availability attribution and matching walk',async()=>{
 const m=await sourceModel(),c=m.change;c.captures[0].capture=receipt();c.captures[0].attachmentState='current';
 const html=renderJournalCard(c);assert.match(html,/Search and open an Acme item/);assert.match(html,/Preview available/);assert.match(html,/Declared by project source; not independently observed/);assert.match(html,/src="\/api\/projects\/studio\/media\/a{64}\/bytes"/);assert.match(html,/alt="Two Acme results"/);assert.match(html,/href="\/projects\/studio\/walks\/acme-search"/);assert.match(html,/Try it/);assert.match(html,/Explore change/);assert.doesNotMatch(html,/supabase|iframe/);
 const home=renderHomeSnapshot({projects:[],changes:[c],coverage:{state:'complete',gaps:[]},quota:{}});assert.match(home,/data-enlarge/);assert.match(home,/Find Acme things/);
});
test('empty, stale, expired and integrity gaps remain distinct and never display an unrelated image',async()=>{
 const m=await sourceModel();for(const [state,label]of [['stale','earlier requirements'],['expired','Capture expired'],['tampered','integrity'],['not-configured','not configured'],['unavailable','Capture unavailable'],['missing','Stored capture is missing'],['pending','Original capture operation is pending']]){
  const c=structuredClone(m.change);c.captures[0].capture={...receipt(),availability:state};if(['stale','not-configured','unavailable'].includes(state))c.captures[0].attachmentState=state;
  const html=renderJournalCard(c);assert.match(html,new RegExp(label));assert.doesNotMatch(html,/<img/);
 }
 const c=m.change;c.walk={id:'acme-search',state:'stale',reason:'Walk result is an earlier revision.'};assert.doesNotMatch(renderJournalCard(c),/Start guided walk/);assert.match(renderJournalCard(c),/earlier revision/);
});
test('before/after comparison requires matching actual CSS viewport, environment and scenario, independently of DPR',async()=>{
 const m=await sourceModel(),after={...m.change.captures[0],capture:receipt(),attachmentState:'current'},before={...after,id:'desktop-before',role:'before',revision:'a'.repeat(40),capture:{...receipt(),width:2560,height:1600,provenance:{...receipt().provenance,revision:'a'.repeat(40)}}};
 assert.equal(comparablePairs([before,after]).length,1);
 for(const change of [s=>s.capture.provenance.environment='Acme production',s=>s.capture.provenance.viewportWidth=1200,s=>s.scenario='Other screen',s=>s.attachmentState='stale']){const b=structuredClone(before);change(b);assert.equal(comparablePairs([b,after]).length,0);}
 m.change.captures=[{...before,capture:{...before.capture,provenance:{...before.capture.provenance,viewportWidth:1200}}},after];assert.match(changeDetailView(m,access),/shown separately/);
});
test('only same-project delivery paths render images and arbitrary authored content remains escaped',async()=>{
 const m=await sourceModel();m.change.title='<img src=x onerror=alert(1)>';m.change.captures[0].capture={...receipt(),deliveryUrl:'https://evil.test/a.png'};m.change.captures[0].attachmentState='current';m.change.preview.url='javascript:alert(1)';
 const html=changeDetailView(m,access);assert.doesNotMatch(html,/<img|href="javascript:|src="https:/);assert.match(html,/&lt;img/);
 assert.equal(privateImagePath(`/api/projects/other/media/${hex('a')}/bytes`,'studio'),null);
 assert.equal(privateImagePath(`/api/projects/studio/media/${hex('a')}/bytes?token=secret`,'studio'),null);
 assert.match(changeIndexView({...m,items:[m.change]},access),/Since last visit/);
});
test('personal date windows are bounded and preserve unknown/future/invalid preference as explicit first use',()=>{
 const now=Date.parse('2026-10-21T12:00:00Z'),first=journalWindow(null,now);assert.equal(first.first,true);assert.match(first.label,/last 7 days/);assert.equal(journalMatches('2026-10-20',first,'since'),true);assert.equal(journalMatches('2026-10-01',first,'since'),false);assert.equal(journalMatches('invalid',first,'all'),true);
 for(const value of ['garbage',String(now+1000),String(now-366*86400000)])assert.equal(journalWindow(value,now).first,true);
 const raw=JSON.stringify({version:1,visits:[{view:'studio',at:String(now-1000)},{view:'../evil',at:String(now-1000)}]});assert.deepEqual(readJournalVisits(raw,now),[{view:'studio',at:String(now-1000)}]);assert.deepEqual(readJournalVisits('x'.repeat(16385),now),[]);assert.deepEqual(readJournalVisits(JSON.stringify({version:1,visits:Array(51).fill({view:'studio',at:String(now)})}),now),[]);
});
test('library labels distinguish metadata-only receipts from live verified objects and deletion preview names exact bytes',()=>{
 const r=receipt();assert.match(renderMediaReceipt(r),/object not checked in this list/);assert.doesNotMatch(renderMediaReceipt(r),/verified now/);r.objectCheck='verified';r.checkedAt='2026-10-21T12:00:00.000Z';assert.match(renderMediaReceipt(r),/Stored bytes verified now/);
 const removal=renderDeleteReview(r);assert.match(removal,new RegExp(r.id));assert.match(removal,new RegExp(r.hash));assert.match(removal,/900 bytes/);assert.match(removal,/data-delete disabled/);assert.doesNotMatch(removal,/data-delete-confirm[^>]*checked/);
 r.state='prepared';r.availability='pending';assert.match(renderMediaReceipt(r),/cannot cancel or reclaim/);
 const upload=renderUploadReview({name:'acme.png',size:900,hash:r.hash,objectUrl:'blob:https://acme.test/abc',changeId:r.changeId,slotId:r.slotId,provenance:r.provenance});assert.match(upload,/1280 × 800 CSS pixels/);assert.match(upload,/data-upload disabled/);assert.doesNotMatch(upload,/data-upload-confirm[^>]*checked/);
});
test('actual journal/media routes preserve authentication and useful missing-config state without source writes',async()=>{
 const h=changesHarness(),service=createWebService(h.config,{fetcher:h.fetcher,now:()=>h.state.now}),signed=await h.login();
 for(const path of ['/projects/studio/changes','/projects/studio/changes/acme-search','/projects/studio/media']){
  const anon=await service(h.request(path));assert.equal(anon.status,401);
  const response=await service(h.request(path,{cookie:signed.cookie}));assert.equal(response.status,200);const html=await response.text();assert.doesNotMatch(html,/fake-user-access|fake-service-key|ciphertext|encryptionKey/);
  assert.match(html,/<title>[^<]* · Plates<\/title>/);assert.match(html,/href="\/assets\/plates\.css"/);assert.match(html,/>Plates<span>Keep your projects moving<\/span>/);assert.match(html,/<a data-project-lens="" href="\/"><span>All plates<small\b/);assert.match(html,/data-journal-scope="keel\.journal\.v1:/);
  if(path.endsWith('/media'))assert.match(html,/Private media is not configured/);
 }
 const missing=await service(h.request('/api/projects/studio/media',{cookie:signed.cookie}));assert.equal((await missing.json()).availability,'not-configured');
 assert.equal((await service(h.request('/api/projects/other/media',{cookie:signed.cookie}))).status,404);
 for(const [origin,csrf]of [['https://evil.test',signed.session.csrf],[h.config.origin,'wrong']]){
  const response=await service(new Request(h.config.origin+'/api/projects/studio/media/upload',{method:'POST',headers:{cookie:signed.cookie,origin,'content-type':'application/json'},body:JSON.stringify({csrf})}));assert.equal(response.status,403);
 }
 assert.equal(h.source.writes.length,0);
});

test('private attachment observation changes Home cursor without reading GitHub again and queues normally',async()=>{
 const {createHomeReader}=await import('../lib/web/home.mjs'),{createPollState,transitionPoll}=await import('../lib/web/home-client.mjs');
 const h=changesHarness();let attached=false,enriched=0;
 const read=createHomeReader(h.config,{fetcher:h.fetcher,now:()=>h.state.now,enrichChanges:async(_access,_project,items)=>{enriched+=items.length;return items.map(c=>({...c,captures:c.captures.map((slot,i)=>({...slot,capture:attached&&i===0?receipt():null,attachmentState:attached&&i===0?'current':'empty'}))}));}});
 const first=await read(h.access,token);assert.equal(first.changes[0].kind,'change');const requests=h.source.changeRequests.length;attached=true;
 const next=await read(h.access,token,{cacheOnly:true,since:first.cursor});assert.notEqual(next.cursor,first.cursor);assert.equal(next.projects[0].revision,first.projects[0].revision);assert.equal(h.source.changeRequests.length,requests);assert.ok(enriched<=40);
 const state=transitionPoll(createPollState(first.cursor),{type:'response',status:200,snapshot:next});assert.equal(state.pending,next);assert.equal(state.updates,1);assert.equal(state.loadingOnly,false);
});

test('actual private upload/delivery routes bind reviewed provenance, retain original receipts and deny changed access',async()=>{
 const {mediaHarness,png}=await import('./helpers/web-media.mjs');const h=mediaHarness(),signed=await h.login(),service=h.service;
 const request=(path,body,origin=h.config.origin)=>new Request(h.config.origin+path,{method:body?'POST':'GET',headers:{cookie:signed.cookie,...(body?{origin,'content-type':'application/json'}:{})},...(body?{body:JSON.stringify({csrf:signed.session.csrf,...body})}:{})});
 const input=await h.input();const response=await service(request('/api/projects/studio/media/upload',{changeId:'acme-search',slotId:'desktop-after',...input}));assert.equal(response.status,200);const saved=await response.json();assert.equal(saved.state,'verified');assert.equal(saved.attached,true);assert.equal(h.mediaState.posts,1);
 const delivered=await service(request(saved.deliveryUrl));assert.equal(delivered.status,200);assert.equal(delivered.headers.get('content-type'),'image/png');assert.equal(delivered.headers.get('cache-control'),'private, no-store');assert.equal(delivered.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await delivered.arrayBuffer()),png());
 const lookup=await service(request('/api/projects/studio/media/receipts/'+input.requestId));assert.equal((await lookup.json()).id,saved.id);const recovered=await service(request(`/api/projects/studio/media/${saved.id}/recover`,{}));assert.equal((await recovered.json()).id,saved.id);assert.equal(h.mediaState.posts,1);
 const detail=await(await service(request('/api/projects/studio/changes/acme-search'))).json();assert.equal(detail.change.captures[0].capture.id,saved.id);
 const libraryHtml=await(await service(request('/projects/studio/media/'+saved.id))).text();assert.match(libraryHtml,/Stored bytes verified now/);assert.doesNotMatch(libraryHtml,/private-key-never-public|cipherHash|fake-service-key|encryptionKey/);
 const bad=await service(request(`/api/projects/studio/media/${saved.id}/remove`,{expectedRevision:saved.revision,confirmDigest:'0'.repeat(64)}));assert.equal(bad.status,409);assert.equal(h.mediaState.deletes,0);
 const current=await(await service(request(`/api/projects/studio/media/${saved.id}`))).json();const removed=await service(request(`/api/projects/studio/media/${saved.id}/remove`,{expectedRevision:current.revision,confirmDigest:current.deleteDigest}));assert.equal((await removed.json()).state,'deleted');assert.equal(h.mediaState.deletes,1);assert.equal((await service(request(saved.deliveryUrl))).status,409);
 const still=await(await service(request(`/api/projects/studio/media/${saved.id}`))).json();assert.equal(still.availability,'deleted');
 h.state.members=[];assert.equal((await service(request(saved.deliveryUrl))).status,404);
});

test('upload controller reviews exact inputs once, preserves request identity through response loss and never redispatches bytes',async()=>{
 const {startMediaClient}=await import('../lib/web/media-client.mjs');const {webcrypto}=await import('node:crypto');const m=await sourceModel(),requests=[],history=[],handlers={},zones={};
 const element=(values={})=>({innerHTML:'',disabled:false,checked:false,value:'',dataset:{},after(){},...values});
 const fields=Object.fromEntries(Object.entries({slotId:'desktop-after',environment:'Acme staging',viewportWidth:'1280',viewportHeight:'800',capturedAt:'2026-10-21T12:00:00Z',caption:'Acme capture',alt:'Acme result'}).map(([name,value])=>[name,element({value})]));fields.file=element({files:[{name:'acme.png',type:'image/png',size:3,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer}]});
 const form={reportValidity:()=>true,querySelector:s=>fields[s.match(/name="(.+)"/)?.[1]],querySelectorAll:()=>Object.values(fields)};
 for(const key of ['media-status','media-receipt','upload-review','delete-review','slot-requirements','upload','upload-confirm','recover-media','review-delete'])zones[key]=element();
 const root={dataset:{project:'studio'},querySelector:s=>s==='[data-media-form]'?form:s==='[data-media-model]'?{value:JSON.stringify({project:m.project,change:m.change})}:s==='[data-media-csrf]'?{value:'fake-acme'}:zones[s.match(/^\[data-(.+)\]$/)?.[1]]??null,addEventListener:(event,fn)=>handlers[event]=fn,removeEventListener(){}};
 const document={querySelector:()=>root,createElement:()=>element()},window={crypto:webcrypto,btoa:x=>Buffer.from(x,'binary').toString('base64'),URL:{createObjectURL:()=> 'blob:https://acme.test/image',revokeObjectURL(){}},history:{replaceState:(_a,_b,url)=>history.push(url)}};
 const saved=receipt();let fail=true;const fetch=async(url,options)=>{requests.push({url,method:options.method,body:options.body?JSON.parse(options.body):null});if(fail){fail=false;throw Error('Acme response lost');}return {status:200,json:async()=>saved};};
 const client=startMediaClient({document,window,fetch});try{await client.reviewUpload();assert.match(zones['upload-review'].innerHTML,/Review this exact private upload/);await client.upload();assert.equal(requests.length,0);zones['upload-confirm'].checked=true;await client.upload();assert.equal(requests.length,1);const id=client.getState().requestId;assert.match(id,/^[a-f0-9]{64}$/);assert.ok(history[0].endsWith('?request='+id));assert.equal(requests[0].body.provenance.capturedAt,'2026-10-21T12:00:00.000Z');assert.equal(requests[0].body.confirmed,true);await client.upload();assert.equal(requests.length,1);await client.recover();assert.deepEqual(requests.map(r=>r.method),['POST','GET','POST']);assert.ok(requests[1].url.endsWith('/receipts/'+id));assert.ok(requests[2].url.endsWith('/recover'));assert.equal(requests.filter(r=>r.url.endsWith('/upload')).length,1);}finally{client.stop();}
});


test('stale capture keeps its original viewport and scenario apart from current slot requirements',()=>{
 const saved=receipt();saved.provenance.scenario='Original Acme desktop results';saved.provenance.environment='Original Acme preview';
 const slot={id:'desktop-after',role:'before',viewport:'mobile',scenario:'New Acme compact results',revision:'c'.repeat(40),capture:saved,attachmentState:'stale'};
 const html=captureView(slot,'studio'),caption=html.match(/<figcaption>([\s\S]+)<\/figcaption>/)[1],original=caption.split('<strong>Current slot requirements</strong>')[0];
 assert.match(original,/Saved capture · desktop/);assert.match(original,/Original Acme desktop results/);assert.match(original,/Original Acme preview/);assert.match(original,/b{12}/);assert.doesNotMatch(original,/mobile|New Acme compact|c{12}|before/);
 assert.match(caption,/Current slot requirements<\/strong><br>before · mobile · New Acme compact results/);assert.match(caption,/c{40}/);assert.doesNotMatch(html,/<img/);
});
test('availability explicitly binds source observation to implementation, with neutral mismatch and unknown states',()=>{
 const revision='b'.repeat(40);
 for(const state of ['preview','serving','verified']){
  const change={revision,availability:{state,environment:'Acme staging',observedAt:'2026-10-21T12:00:00Z',observedRevision:'a'.repeat(40),matchesRevision:false}};
  let html=availabilityView(change);assert.match(html,/<strong>Availability observed on a different revision<\/strong>/);assert.match(html,/a{40}/);assert.match(html,/b{40}/);assert.match(html,/does not establish availability of this implementation/);assert.doesNotMatch(html,/<strong>(Serving|Verified|Preview available)/);
  change.availability.observedRevision=null;html=availabilityView(change);assert.match(html,/<strong>Availability revision not established<\/strong>/);assert.match(html,/Observed revision: <code>Unknown<\/code>/);
  change.availability.observedRevision=revision;change.availability.matchesRevision=true;html=availabilityView(change);assert.doesNotMatch(html,/different revision|revision not established/);assert.match(html,/Declared by project source; not independently observed/);
 }
});


test('since-last-visit includes new same-day additions instead of comparing publication midnight to a visit time',()=>{
 const previous=Date.parse('2026-10-21T09:00:00Z'),now=Date.parse('2026-10-21T17:00:00Z'),range=journalWindow(String(previous),now);
 assert.equal(range.since,Date.parse('2026-10-21T00:00:00Z'));assert.equal(journalMatches('2026-10-21',range,'since'),true);assert.equal(journalMatches('2026-10-20',range,'since'),false);assert.match(range.label,/whole day is included because additions have dates, not times/);assert.match(range.label,/some may already be familiar/);
 const first=journalWindow(null,now);assert.equal(journalMatches('2026-10-15',first,'since'),true);assert.equal(journalMatches('2026-10-14',first,'since'),false);
});
