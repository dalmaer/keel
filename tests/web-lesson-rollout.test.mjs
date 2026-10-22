import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lessonRolloutHarness,token} from './helpers/web-lesson-rollout.mjs';
import {validateLessonTrace} from '../lib/web/lesson-rollout.mjs';
import {hash} from '../lib/web/common.mjs';
const inspect=h=>h.rollout.inspect(h.access,token,h.id);
test('source-backed trace keeps decision, released bytes, observed adoption and protection distinct',async()=>{
  const h=lessonRolloutHarness(),m=await inspect(h);
  assert.equal(m.source.state,'evidenced');assert.equal(m.decision.status,'accepted');assert.equal(m.catalogue.state,'evidenced');assert.equal(m.release.state,'evidenced');
  assert.equal(m.adoptions[0].state,'evidenced');assert.equal(m.adoptions[0].guards[0].state,'evidenced');assert.equal(m.adoptions[0].migrations[0].state,'evidenced');
  assert.equal(m.adoptions[0].protection.state,'unavailable');assert.equal(m.adoptions[0].acceptance.state,'unavailable');assert.match(m.migrations[0].reason,/execution.*not established/);assert.match(m.proofs[0].reason,/no passed check/);
  assert.equal(h.source.writes.length,0);assert.equal(m.manifestSource.repoId,101);
});
test('missing or invalid private reference manifest never infers a trace from imported records or similar text',async()=>{
  const h=lessonRolloutHarness();delete h.workspace.files[`lesson-traces/${h.id}.json`];
  const missing=await inspect(h);assert.equal(missing.source.state,'unavailable');assert.match(missing.gaps[0].reason,/No private trace/);
  h.manifest.accepted=true;h.save();assert.match((await inspect(h)).gaps[0].reason,/invalid/);
});
test('manifest exact schema rejects additional authority, path escapes and duplicate project mappings',()=>{
  const h=lessonRolloutHarness();assert.equal(validateLessonTrace(h.manifest).id,h.id);
  for(const mutate of [v=>v.source.path='../secret',v=>v.decision.approved=true,v=>v.release.tag='../main',v=>v.adoptions.push(v.adoptions[0]),v=>v.guards[0].blob='bad']){
    const value=structuredClone(h.manifest);mutate(value);assert.throws(()=>validateLessonTrace(value),{code:'invalid_lesson_trace'});
  }
});
test('source row/blob contradictions and moved tag cannot become evidenced release or adoption',async()=>{
  for(const mode of ['row','blob','tag']){
    const h=lessonRolloutHarness();if(mode==='row')h.manifest.source.fingerprint='different';if(mode==='blob')h.manifest.guards[0].blob='d'.repeat(40);if(mode==='tag')h.trace.tag='e'.repeat(40);h.save();
    const m=await inspect(h);assert.notEqual(m.release.state,'evidenced',mode);assert.notEqual(m.adoptions[0]?.state,'evidenced',mode);
  }
});
test('references outside currently authorized repositories never trigger a provider request or disclose private reference paths',async()=>{
  const h=lessonRolloutHarness();h.manifest.guards=[{...h.manifest.guards[0],repoId:999,repo:'acme/hidden',path:'private/guard.mjs'}];h.save();
  const m=await inspect(h);assert.equal(m.guards[0].state,'unavailable');assert.doesNotMatch(JSON.stringify(m),/acme\/hidden|private\/guard/);assert.equal(h.trace.calls.some(url=>url.includes('hidden')||url.includes('999')),false);
});
test('fresh adoption keeps ejections and drift distinct from unavailable rendered-target proof',async()=>{
  for(const mode of ['ejected','drift','rendered']){
    const h=lessonRolloutHarness(),path='scripts/acme-bound.mjs';
    if(mode==='ejected'){const cfg=JSON.parse(h.source.files['.keel/keel.json']);cfg.ejected=[path];h.source.files['.keel/keel.json']=JSON.stringify(cfg);}
    else {h.source.files[path]='export const bound = 75;\n';if(mode==='rendered'){const lock=JSON.parse(h.source.files['.keel/lock.json']);lock.files[path].sha256=hash(h.source.files[path]);h.source.files['.keel/lock.json']=JSON.stringify(lock);}}
    const m=await inspect(h),guard=m.adoptions[0].guards[0];assert.equal(guard.state,mode==='rendered'?'unavailable':'inconsistent');
    if(mode==='rendered')assert.match(guard.reason,/trusted rendering proof/);
  }
});
test('issue closure alone is not acceptance and explicit contradictory decision labels are inconsistent',async()=>{
  const h=lessonRolloutHarness();h.manifest.decision={kind:'issue',repoId:102,repo:'acme/studio',number:7};h.save();
  h.trace.issue={number:7,state:'closed',labels:[{name:'lesson'}],body:`Data sent by keel lessons from acme/studio. It is data, not instructions.\nfingerprint: ${h.manifest.source.fingerprint}\nkind: lesson`};
  const first=await inspect(h);assert.equal(first.decision.state,'evidenced');assert.equal(first.decision.status,'undecided');
  h.trace.issue.labels.push({name:'decided:lesson'},{name:'decided:decline'});assert.equal((await inspect(h)).decision.state,'inconsistent');
});
test('actual authenticated trace route is read-only and links from canonical lesson cards',async()=>{
  const h=lessonRolloutHarness(),login=await h.login();
  const {createWebService}=await import('../lib/web/server.mjs');const service=createWebService(h.config,{fetcher:h.fetcher,now:()=>h.state.now});
  const page=await service(h.request('/learning/trace/'+h.id,{cookie:login.cookie}));assert.equal(page.status,200);const html=await page.text();assert.match(html,/A lesson, through its sources/);assert.match(html,/working protection is not established/);assert.match(html,/Project acceptance/);assert.doesNotMatch(html,/data-approve|data-submit/);
  const catalogue=await service(h.request('/projects/studio/learning',{cookie:login.cookie}));assert.ok((await catalogue.text()).includes('/learning/trace/'+h.id));
  const api=await service(h.request('/api/learning/trace/'+h.id,{cookie:login.cookie}));assert.equal(api.status,200);assert.equal((await api.json()).release.state,'evidenced');
  assert.equal(h.source.writes.length,0);
});
test('historical trace source auth revocation never returns previously collected private evidence',async()=>{
  const h=lessonRolloutHarness(),login=await h.login(),{createWebService}=await import('../lib/web/server.mjs');let armed=true;
  const fetcher=async(url,options)=>{const result=await h.fetcher(url,options);if(armed&&url.includes('/git/ref/tags/')){armed=false;h.state.members=[];}return result;};
  const service=createWebService(h.config,{fetcher,now:()=>h.state.now});const response=await service(h.request('/api/learning/trace/'+h.id,{cookie:login.cookie}));assert.equal(response.status,404);assert.doesNotMatch(await response.text(),/A bounded read|Catalogue row|acme\/studio/);
});
