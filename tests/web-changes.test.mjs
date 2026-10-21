import test from 'node:test';
import assert from 'node:assert/strict';
import { changesHarness,changeDefinition,token } from './helpers/web-changes.mjs';
import { validateChange } from '../lib/web/changes-model.mjs';
import { createHomeReader } from '../lib/web/home.mjs';
const path='docs/changes/acme-search.json';
const detail=h=>h.changes.detail(h.access,token,h.project,'acme-search');
const change=(h,edit)=>{const d=JSON.parse(h.source.files[path]);edit(d);h.source.files[path]=JSON.stringify(d);};

test('strict change schema rejects malformed records, traversal, unsafe links and missing visual coverage',()=>{
 const edits=[d=>d.extra=true,d=>d.id='../acme',d=>d.paths=['../secret'],d=>d.paths=['https://acme.test'],d=>d.preview.url='javascript:alert(1)',d=>d.preview.url='https://user:password@acme.test/',d=>d.preview.url='https://acme.test/?token=secret',d=>d.preview.url=['https://acme.test'],d=>d.publishedAt='2026-02-30',d=>d.availability.observedRevision=3,d=>d.captures.pop(),d=>d.captures[1].id=d.captures[0].id,d=>d.captures[0].revision='c'.repeat(40),d=>d.captures[0].reason='',d=>d.explore=[],d=>d.walk={id:null,reason:null},d=>d.preview={url:null,reason:null}];
 for(const edit of edits){const d=changeDefinition();edit(d);assert.throws(()=>validateChange(d),e=>e.code==='invalid_change_definition');}
 assert.deepEqual(validateChange(changeDefinition()),changeDefinition());
});
test('detail resolves immutable source revision and walk while treating availability as attributed declaration',async()=>{
 const h=changesHarness(),m=await detail(h),c=m.change;
 assert.equal(c.availability.attribution,'source-declaration');assert.equal(c.availability.matchesRevision,true);assert.equal(c.acceptance,'not established');assert.equal(c.walk.state,'matching');assert.equal(c.walk.url,'/projects/studio/walks/acme-search');assert.equal(c.captures[0].capture,null);assert.match(c.sourceUrl,new RegExp(`/blob/${h.source.head}/docs/changes/acme-search.json$`));assert.match(c.paths[0].url,new RegExp(`/blob/${h.source.head}/artifacts/acme-result.txt$`));assert.equal(c.source.repositoryNodeId,h.source.repositoryNodeId);assert.deepEqual(m.gaps,[]);assert.equal(h.source.writes.length,0);
 assert.ok(h.source.changeRequests.some(r=>r.query.startsWith('query ChangeRevision')&&r.variables.oid===h.source.head));
});
test('matching walk needs exact revision and environment, not merely a valid walk ID',async()=>{
 for(const field of ['sourceRevision','environment']){const h=changesHarness(),w=JSON.parse(h.source.files['docs/walks/acme-search.json']);w.result[field]=field==='sourceRevision'?'c'.repeat(40):'Acme production';h.source.files['docs/walks/acme-search.json']=JSON.stringify(w);const c=(await detail(h)).change;assert.equal(c.walk.state,'stale');assert.equal(c.walk.url,null);assert.ok(c.gaps.some(g=>g.source==='walk'));}
 const h=changesHarness();delete h.source.files['docs/walks/acme-search.json'];assert.equal((await detail(h)).change.walk.state,'unavailable');
});
test('historical revisions resolve against repository identity; missing paths or wrong repositories cannot authorize a capture',async()=>{
 const h=changesHarness(),revision='e'.repeat(40);h.source.revisions[revision]={'artifacts/acme-result.txt':'Original Acme build'};change(h,d=>{d.revision=revision;d.captures.forEach(s=>s.revision=revision);});
 let c=(await detail(h)).change;assert.equal(c.captures[0].revisionVerified,true);assert.equal(c.walk.url,null);
 const target=await h.changes.captureTarget(h.access,token,h.project,'acme-search','desktop-after');assert.equal(target.revision,revision);assert.equal(target.source.head,h.source.head);assert.equal(target.slot.viewport,'desktop');
 delete h.source.revisions[revision]['artifacts/acme-result.txt'];await assert.rejects(h.changes.captureTarget(h.access,token,h.project,'acme-search','desktop-after'),e=>e.code==='capture_revision_unavailable');
 h.source.wrongChangeRepo=true;c=(await detail(h)).change;assert.ok(c.gaps.some(g=>g.source==='revision'));assert.equal(c.captures[0].revisionVerified,false);
});
test('capture bindings survive title and display reordering but invalidate changed capture requirements',async()=>{
 const h=changesHarness(),target=()=>h.changes.captureTarget(h.access,token,h.project,'acme-search','desktop-after'),before=await target();
 change(h,d=>{d.title='A clearer Acme title';d.captures.reverse();});const display=await target();assert.equal(display.slotDigest,before.slotDigest);assert.notEqual(display.sourceDigest,before.sourceDigest);
 change(h,d=>d.captures.find(s=>s.id==='desktop-after').scenario='Different Acme check');const changed=await target();assert.notEqual(changed.slotDigest,before.slotDigest);
 await assert.rejects(h.changes.captureTarget(h.access,token,h.project,'../acme','desktop-after'),e=>e.code==='invalid_capture_target');
 await assert.rejects(h.changes.captureTarget(h.access,token,h.project,'acme-search','missing'),e=>e.status===404);
});
test('before/after comparison requires matching viewport and scenario and retains both revision identities',async()=>{
 const h=changesHarness(),old='e'.repeat(40);h.source.revisions[old]={};change(h,d=>d.captures.push({id:'desktop-before',role:'before',revision:old,viewport:'desktop',scenario:'Acme search results',reason:'No old capture.'},{id:'mobile-before',role:'before',revision:old,viewport:'mobile',scenario:'Different Acme scenario',reason:'No old capture.'}));
 const c=(await detail(h)).change;assert.deepEqual(c.comparisons,[{before:'desktop-before',after:'desktop-after',viewport:'desktop',scenario:'Acme search results'}]);assert.equal(c.captures.find(s=>s.id==='desktop-before').revision,old);assert.equal(c.captures.find(s=>s.id==='desktop-after').revision,h.source.head);
});
test('nonvisual excerpts require exact named source provenance, and missing verification never presents the excerpt as evidence',async()=>{
 const h=changesHarness();change(h,d=>{d.kind='nonvisual';d.captures=[];d.nonvisual={path:'artifacts/acme-result.txt',excerpt:'Acme search result',reason:null};});assert.equal((await detail(h)).change.nonvisual.excerpt,'Acme search result');
 change(h,d=>d.nonvisual.excerpt='Invented Acme output');const c=(await detail(h)).change;assert.equal(c.nonvisual.excerpt,null);assert.ok(c.gaps.some(g=>g.source==='nonvisual'));
 change(h,d=>d.nonvisual={path:null,excerpt:null,reason:'Acme output is unavailable.'});assert.equal((await detail(h)).change.nonvisual.reason,'Acme output is unavailable.');
});
test('invalid and bounded partial inventories retain valid packages and explicit coverage gaps',async()=>{
 const h=changesHarness();h.source.files['docs/changes/broken.json']='{}';let m=await h.changes.list(h.access,token,h.project);assert.equal(m.items.length,1);assert.ok(m.gaps.some(g=>g.source==='changes'));
 h.source.files[path]=' '.repeat(131073);m=await h.changes.list(h.access,token,h.project);assert.equal(m.items.length,0);assert.ok(m.gaps.length);
 const many=changesHarness();for(let i=0;i<51;i++){const d=changeDefinition();d.id=`acme-${i}`;many.source.files[`docs/changes/${d.id}.json`]=JSON.stringify(d);}m=await many.changes.list(many.access,token,many.project);assert.equal(m.items.length,50);assert.ok(m.gaps.some(g=>g.reason.includes('50-package')));
});
test('source access denial refuses journal results without leaking the last readable source',async()=>{
 const h=changesHarness();await detail(h);h.source.changeDenied=true;await assert.rejects(detail(h));
});
test('Home uses the shared journal model inside its source budget and retains fallback when packages are invalid',async()=>{
 const h=changesHarness(),home=createHomeReader(h.config,{fetcher:h.fetcher,now:()=>h.state.now}),m=await home(h.access,token);
 assert.equal(m.changes[0].kind,'change');assert.equal(m.changes[0].changeId,'acme-search');assert.equal(m.changes[0].walk.state,'matching');assert.equal(m.changes[0].captures[0].capture,null);
 const bad=changesHarness();bad.source.files[path]='{}';const fallback=await createHomeReader(bad.config,{fetcher:bad.fetcher,now:()=>bad.state.now})(bad.access,token);assert.equal(fallback.changes[0].kind,'commit');assert.ok(fallback.coverage.gaps.some(g=>g.source==='changes'));
});

test('Home bounds journal payload while preserving a complete-source link to the full list',async()=>{
 const h=changesHarness();
 h.access.quota={remaining:5000,reset:Math.floor(h.state.now/1000)+3600};
 for(let i=0;i<30;i++){
  const d=changeDefinition();d.id=`acme-${i}`;
  for(let n=0;n<10;n++)d.captures.push({...d.captures[0],id:`extra-${n}`,scenario:'Acme '.repeat(100),reason:'Acme '.repeat(400)});
  h.source.files[`docs/changes/${d.id}.json`]=JSON.stringify(d);
 }
 const m=await createHomeReader(h.config,{fetcher:h.fetcher,now:()=>h.state.now})(h.access,token),project=m.projects[0];
 assert.ok(project.changes.length>0&&project.changes.length<20);assert.ok(Buffer.byteLength(JSON.stringify(project.changes))<=200*1024);
 assert.equal(project.sourceComplete,true);assert.equal(project.changeJournal.total,31);assert.equal(project.changeJournal.url,'/projects/studio/changes');assert.ok(project.gaps.some(g=>g.source==='journal window'));
});
test('all source and revision reads share a request budget and never fetch supplied preview URLs',async()=>{
 const h=changesHarness();
 for(let i=0;i<50;i++){
  const d=changeDefinition();d.id=`acme-${i}`;
  for(let n=0;n<10;n++){const revision=(i*10+n+1).toString(16).padStart(40,'0');h.source.revisions[revision]={};d.captures.push({...d.captures[0],id:`before-${n}`,role:'before',revision});}
  h.source.files[`docs/changes/${d.id}.json`]=JSON.stringify(d);
 }
 const {createChanges}=await import('../lib/web/changes.mjs');let calls=0;
 const fetcher=(url,options)=>{assert.equal(new URL(url).origin,'https://api.github.com');calls++;return h.fetcher(url,options);};
 const m=await createChanges(h.config,{fetcher}).list(h.access,token,h.project);
 assert.equal(calls,200);assert.ok(m.items.length>0);assert.ok(m.gaps.some(g=>g.source==='revision'||g.source==='changes'));
});
test('source-declared awaiting deployment remains current source data and does not invent serving verification',async()=>{
 const h=changesHarness();change(h,d=>{d.availability.state='awaiting-deploy';d.availability.observedRevision=null;d.preview={url:null,reason:'Acme deployment has not been observed.'};});
 const m=await createHomeReader(h.config,{fetcher:h.fetcher,now:()=>h.state.now})(h.access,token),c=m.changes[0];
 assert.equal(m.projects[0].sourceComplete,true);assert.equal(c.availability.matchesRevision,false);assert.equal(c.availability.attribution,'source-declaration');assert.equal(c.previewUrl,null);assert.ok(c.gaps.some(g=>g.source==='availability'));
});
