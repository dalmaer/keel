import test from 'node:test';
import assert from 'node:assert/strict';
import { decisionHarness,healthTarget,shapingTarget,token } from './helpers/web-decisions.mjs';
import { createDecisions } from '../lib/web/decisions.mjs';
import { decideLegacyProposal } from '../lib/board.mjs';
const service=h=>createDecisions(h.config,{fetcher:h.fetcher,now:()=>h.state.now});
test('legacy health preview uses the exact CLI transform, explicit choice and complete public outbound message',async()=>{
 const h=decisionHarness(),d=service(h),detail=await d.detail(h.access,token,h.project,healthTarget);
 assert.equal(detail.supported,true);assert.equal(detail.context.state,'not-configured');assert.equal(detail.question.choices.length,2);
 await assert.rejects(d.preview(h.access,token,h.project,{target:healthTarget}),e=>e.status===400);
 const preview=await d.preview(h.access,token,h.project,{target:healthTarget,choice:'decline',reason:'The owner prefers another order.'});
 assert.equal(preview.content,decideLegacyProposal(h.source.files[healthTarget.path],{decision:'decline',reason:'The owner prefers another order.',today:new Date(h.state.now).toISOString().slice(0,10)}).content);
 assert.equal(preview.visibility,'public');assert.equal(preview.canSubmit,true);assert.match(preview.commitMessage,new RegExp(`Keel-Operation: ${preview.operationId}$`));
 assert.equal(preview.operationUrl,`/projects/studio/operations/${preview.operationId}`);assert.equal(h.source.writes.length,0);
 const encrypted=[...h.db.previews.values()][0].value;assert.doesNotMatch(encrypted,/owner prefers|Acme|proposal/);
 assert.equal(h.source.files[healthTarget.path].includes('Decided'),false);
});
test('shaping answer preserves recommendations, proposals and prior answers and increments exactly one revision',async()=>{
 const h=decisionHarness(),d=service(h),detail=await d.detail(h.access,token,h.project,shapingTarget);
 assert.match(detail.question.recommendation.text,/exact matches/);
 const preview=await d.preview(h.access,token,h.project,{target:shapingTarget,answer:'Show prefix matches first.'}),result=JSON.parse(preview.content),original=JSON.parse(h.source.files[shapingTarget.path]);
 assert.equal(result.revision,2);assert.deepEqual(result.questions,original.questions);assert.deepEqual(result.proposedDecisions,original.proposedDecisions);
 assert.equal(result.answers[0].actor,'GitHub user 1');assert.equal(result.answers[0].text,'Show prefix matches first.');assert.match(result.answers[0].source,/Authenticated/);
 h.source.files[shapingTarget.path]=preview.content;
 assert.equal((await d.detail(h.access,token,h.project,shapingTarget)).supported,false);
});
test('submission defaults disabled and explicit target/input validation refuses unsupported mutations',async()=>{
 const h=decisionHarness(),d=createDecisions({...h.config,decisionWrites:undefined},{fetcher:h.fetcher,now:()=>h.state.now});
 const preview=await d.preview(h.access,token,h.project,{target:healthTarget,choice:'accept'});assert.equal(preview.canSubmit,false);
 for(const target of [{...healthTarget,path:'../outside.md'},{...shapingTarget,path:'.github/workflows/decision.yml'},{...healthTarget,question:'x'},{...shapingTarget,question:'missing'}])await assert.rejects(d.detail(h.access,token,h.project,target));
 await assert.rejects(d.preview(h.access,token,h.project,{target:healthTarget,choice:'decline',reason:''}));
 await assert.rejects(d.preview(h.access,token,h.project,{target:shapingTarget,answer:'yes',choice:'accept'}));
 h.source.files[healthTarget.path]+='\n**Decided 2026-10-21: accepted**\n';
 // An explicit source decision is retained; it is never silently overwritten.
 h.source.files[healthTarget.path]=decideLegacyProposal('# Acme\n\n## Proposal\n\nTry another order.\n',{decision:'accept'}).content;
 assert.equal((await d.detail(h.access,token,h.project,healthTarget)).supported,false);
});
test('missing required decision context disables shaping submission without accepting its recommendation',async()=>{
 const h=decisionHarness(),shape=JSON.parse(h.source.files[shapingTarget.path]);shape.items[0].decisions=['docs/decisions/missing.md#choice'];h.source.files[shapingTarget.path]=JSON.stringify(shape);
 const detail=await service(h).detail(h.access,token,h.project,shapingTarget);
 assert.equal(detail.supported,false);assert.ok(detail.context.gaps.length);assert.deepEqual(detail.context.decisions,[]);
});
test('a preview cannot create a source larger than the hosted reader can reopen',async()=>{
 const h=decisionHarness();h.source.files[healthTarget.path]='# Acme\n\n## Proposal\n\n'+'x'.repeat(262000)+'\n';
 await assert.rejects(service(h).preview(h.access,token,h.project,{target:healthTarget,choice:'accept',reason:'r'.repeat(1000)}),e=>e.code==='output_limit');
 assert.equal(h.db.previews.size,0);assert.equal(h.source.writes.length,0);
});
test('canonical accepted choices and proposals remain distinct from a shaping recommendation',async()=>{
 const h=decisionHarness(),shape=JSON.parse(h.source.files[shapingTarget.path]);
 shape.items[0].decisions=['docs/decisions/accepted.md#accepted'];h.source.files[shapingTarget.path]=JSON.stringify(shape);
 for(const status of ['accepted','proposed'])h.source.files[`docs/decisions/${status}.md`]=`<a id="${status}"></a>\n# ${status}\nAcme choice.\n\`\`\`keel-decision\n${JSON.stringify({version:1,id:status,status,scope:['search'],decided_by:'Acme owner',decided_at:'2026-10-21',supersedes:status==='proposed'?['docs/decisions/accepted.md#accepted']:[],superseded_by:status==='accepted'?['docs/decisions/proposed.md#proposed']:[]})}\n\`\`\`\n`;
 const detail=await service(h).detail(h.access,token,h.project,shapingTarget);
 assert.equal(detail.context.state,'complete',JSON.stringify(detail.context.gaps));assert.equal(detail.context.decisions.length,1);assert.equal(detail.context.proposals.length,1);
 assert.match(detail.context.decisions[0].ref,/accepted\.md/);assert.match(detail.context.proposals[0].ref,/proposed\.md/);assert.match(detail.question.recommendation.text,/exact matches/);
});

test('renamed web decisions read legacy config only when canonical config is absent',async()=>{
 const h=decisionHarness(),d=service(h);
 h.source.files['.keel/keel.json']=h.source.files['.plates/plates.json'];delete h.source.files['.plates/plates.json'];
 assert.equal((await d.detail(h.access,token,h.project,healthTarget)).supported,true);
 h.source.files['.plates/plates.json']='invalid canonical config';
 await assert.rejects(d.detail(h.access,token,h.project,healthTarget),e=>e.code==='invalid_source');
 assert.equal(h.source.writes.length,0);
});
