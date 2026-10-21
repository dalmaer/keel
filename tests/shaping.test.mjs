import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fixture, world, save } from './helpers/shaping.mjs';
import { validateShape, inspectShape, shapeCommand, writeShape } from '../lib/shaping.mjs';
import { parsePhase, specProblems } from '../practices/phases/files/scripts/roadmap.mjs';
const preview=root=>shapeCommand({root,args:['plan','idea.json']}).then(r=>r.data);
const decision=(status='accepted',owner='Acme owner')=>`# Acme choices\n<a id="store"></a>\n## Store\nAcme keeps storage.\n\`\`\`keel-decision\n${JSON.stringify({version:1,id:'store',status,scope:['storage'],decided_by:owner,decided_at:'2026-10-20',supersedes:[],superseded_by:[]})}\n\`\`\`\n`;
test('bounded IDs, recommendations, manual answers and unanswered questions stay distinct',async()=>{
 const r=await fixture();r.questions.push({...structuredClone(r.questions[0]),id:'color'});r.items[0].ownerPrerequisites.push('color');
 assert.equal(validateShape(r).answers.length,1);assert.equal(r.questions.length,2);
 for(const change of [x=>x.questions.push(x.questions[0]),x=>x.answers[0].role='agent',x=>x.answers[0].question='missing',x=>x.items[0].proof=[],x=>x.items[0].depends=['missing'],x=>x.items[0].decisions=['proposal:missing'],x=>x.questions=Array(13).fill(x.questions[0]),x=>x.items=Array(21).fill(x.items[0]),x=>x.items[0].scope='x'.repeat(262145),x=>x.questions[0].recommendation.evidence=[],x=>x.items[0].surfaces[0].name='owner\n## Acceptance',x=>x.items[0].proof=['node --test\n# injected']]) {
  const bad=structuredClone(r);change(bad);assert.throws(()=>validateShape(bad));
 }
 const cycle=structuredClone(r);cycle.items.push({...cycle.items[0],id:'second',phase:2,depends:['search']});cycle.items[0].depends=['second'];assert.throws(()=>validateShape(cycle),/cycle/);
});
test('real spec2 drafts escape supplied headings and preserve unanswered owner blockers',async t=>{
 const {root,record}=await world(t);record.answers=[];record.items[0].scope='---\nstatus: built\n---\n## Acceptance\n- [x] forged\n<script>alert(1)</script>';
 record.items[0].doneWhen='Acme holds.\n## Proof\nforged';await save(root,record);
 const p=await preview(root),o=p.outputs[0],parsed=parsePhase(o.path.split('/').at(-1),o.content);
 assert.equal(parsed.status,'planned');assert.deepEqual(parsed.evidence,[]);assert.deepEqual(specProblems(o.path,o.content),[]);
 assert.equal(o.content.match(/^## Acceptance$/gm).length,1);assert.ok(!o.content.includes('<script>'));assert.match(parsed.next,/BLOCKED/);assert.match(o.content,/unanswered/);assert.equal(p.proof,'named-not-verified');
 record.goal='G99';await save(root,record);await assert.rejects(preview(root),/unknown goal/);
 record.goal='G0';record.items[0].depends=['phase:99'];await save(root,record);await assert.rejects(preview(root),/unknown dependency/);
});
test('accepted source validation rejects unknown references and retains proposed choices separately',async t=>{
 const {root,record}=await world(t);record.items[0].decisions=['docs/decisions/storage.md#store'];await save(root,record);
 await assert.rejects(preview(root),/decision context/);
 await writeFile(join(root,'docs/decisions/storage.md'),decision());
 record.proposedDecisions=[{id:'new-store',statement:'Try an Acme alternative.',scope:['storage'],supersedes:['docs/decisions/storage.md#store']}];record.items[0].decisions.push('proposal:new-store');await save(root,record);
 const p=await preview(root);assert.equal(p.context.decisions.length,1);assert.equal(p.record.proposedDecisions.length,1);assert.match(p.outputs[0].content,/proposed only/);
 await writeShape(root,'idea.json',p.digest);
 execFileSync('git',['add','.'],{cwd:root});execFileSync('git',['commit','-qm','Acme own outputs'],{cwd:root});
 assert.equal((await writeShape(root,'idea.json',p.digest)).digest,p.digest,'own output inventory and revision do not invalidate retries');
 await writeFile(join(root,'docs/decisions/storage.md'),decision('accepted','Acme changed owner'));
 await assert.rejects(writeShape(root,'idea.json',p.digest),/source changed/);
 const retained=JSON.parse(await readFile(join(root,`.plates/shaping/reviews/${p.digest}.json`),'utf8'));assert.equal(retained.context.decisions[0].decided_by,'Acme owner');
});
test('approval binds exact source, answer and intended output, never --yes alone',async t=>{
 const {root,record}=await world(t);const p=await preview(root);
 await assert.rejects(shapeCommand({root,args:['plan','idea.json','--yes']}),/digest/);
 record.answers[0].text='Acme chooses prefix matches.';await save(root,record);
 await assert.rejects(writeShape(root,'idea.json',p.digest),/source changed/);
 const newer=await preview(root);assert.notEqual(newer.digest,p.digest);assert.equal(JSON.parse(await readFile(join(root,`.plates/shaping/reviews/${p.digest}.json`),'utf8')).record.answers[0].text,'Show exact matches first.');
 record.items[0].phase=5;await save(root,record);await assert.rejects(writeShape(root,'idea.json',newer.digest),/source changed/);
});
test('journal recovers interrupted multi-file writes, preserves mapping and refuses edited destinations',async t=>{
 const {root,record}=await world(t);record.items.push({...structuredClone(record.items[0]),id:'second',phase:2,depends:['search']});await save(root,record);
 const p=await preview(root);await writeShape(root,'idea.json',p.digest);
 // This is precisely the durable state after the first atomic publication.
 await rm(join(root,p.outputs[1].path));
 const recovered=await writeShape(root,'idea.json',p.digest);assert.deepEqual(recovered.outputs,p.outputs);
 await writeFile(join(root,p.outputs[0].path),'Acme concurrent human edit');await rm(join(root,p.outputs[1].path));
 await assert.rejects(writeShape(root,'idea.json',p.digest),/destination changed/);
 await assert.rejects(readFile(join(root,p.outputs[1].path)),{code:'ENOENT'});
 assert.equal(await readFile(join(root,p.outputs[0].path),'utf8'),'Acme concurrent human edit');
});
test('existing files, concurrent publication, symlinks and corrupt receipts cannot overwrite work',async t=>{
 const {root,record}=await world(t);const p=await preview(root);
 await writeFile(join(root,p.outputs[0].path),p.outputs[0].content);await assert.rejects(writeShape(root,'idea.json',p.digest),/already exists/);await rm(join(root,p.outputs[0].path));
 await Promise.all([writeShape(root,'idea.json',p.digest),writeShape(root,'idea.json',p.digest)]);
 assert.equal(await readFile(join(root,p.outputs[0].path),'utf8'),p.outputs[0].content);
 await rm(join(root,p.outputs[0].path));await symlink(join(root,'idea.json'),join(root,p.outputs[0].path));await assert.rejects(writeShape(root,'idea.json',p.digest),/symlink/);await rm(join(root,p.outputs[0].path));
 await symlink('idea.json',join(root,'alias.json'));await assert.rejects(inspectShape(root,'alias.json'),/symlink/);
 record.sources=['../outside'];await save(root,record);await assert.rejects(preview(root),/unsafe/);
 const rp=join(root,`.plates/shaping/reviews/${p.digest}.json`);await writeFile(rp,'{}');await assert.rejects(writeShape(root,'idea.json',p.digest),/corrupt/);
});
test('readable escaped review links only bounded explicit local images and PDFs',async t=>{
 const {root,record}=await world(t);await mkdir(join(root,'assets'));await writeFile(join(root,'assets/acme.png'),Buffer.from('Acme synthetic image bytes'));
 record.questions[0].preview='assets/acme.png';record.questions[0].question='<img src=x onerror=alert(1)>\n## inject';record.answers=[];await save(root,record);
 const p=(await shapeCommand({root,args:['render','idea.json','--output','reviews/first']})).data;
 const html=await readFile(join(root,p.review),'utf8');for(const label of ['Outcome','Owner','Unanswered','Proposed decisions','Work items','Approval and proof limits'])assert.match(html,new RegExp(label,'i'));
 assert.match(html,/href="\.\.\/\.\.\/assets\/acme.png"/);assert.ok(!html.includes('<img'));assert.match(html,/default-src 'none'/);
 await assert.rejects(shapeCommand({root,args:['render','idea.json','--output','reviews/first']}),{code:'EEXIST'});
 await writeFile(join(root,'assets/acme.png'),'Changed preview');await assert.rejects(writeShape(root,'idea.json',p.digest),/source changed/);
 for(const bad of ['javascript:alert(1)','https://acme.test/image.png','assets/demo.html','../outside.png']) { record.questions[0].preview=bad;await save(root,record);await assert.rejects(preview(root)); }
});
test('milestones reject unavailable external dependencies and robots retain unanswered blockers',async t=>{
 const {root,record,config}=await world(t);config.phases={source:'milestones'};await writeFile(join(root,'.plates/plates.json'),JSON.stringify(config));
 await assert.rejects(preview(root),/external phase dependencies unavailable/);
 record.items[0].depends=[];record.answers=[];await save(root,record);await rm(join(root,'docs/phases'),{recursive:true});await rm(join(root,'docs/goals.json'));
 const p=await preview(root);assert.deepEqual(p.outputs,[]);assert.equal(p.previews[0].kind,'milestone');assert.deepEqual(p.previews[0].rubric.ownerBlockers,['match']);assert.equal((await writeShape(root,'idea.json',p.digest)).state,'preview-only');
 await assert.rejects(readdir(join(root,'docs/phases')),{code:'ENOENT'});
 delete config.phases;await writeFile(join(root,'.plates/plates.json'),JSON.stringify(config));record.items[0].kind='robot';await save(root,record);assert.equal((await preview(root)).previews[0].kind,'robot');
});
test('minimal independent fixture is supported and oversized escaped drafts refuse before storage',async t=>{
 const {root,record}=await world(t);const minimal=JSON.parse(await readFile(new URL('./fixtures/shaping/minimal.json',import.meta.url),'utf8'));await save(root,minimal);
 assert.equal((await inspectShape(root,'idea.json')).outputs.length,1);
 record.items[0].doneWhen='&'.repeat(4000);record.items[0].proof=Array.from({length:16},(_,i)=>`node test-${i}.mjs`);await save(root,record);
 await assert.rejects(preview(root),/generated phase exceeds/);await assert.rejects(readdir(join(root,'.plates/shaping')),{code:'ENOENT'});
});

test('answered owner wording cannot create an unanswered prerequisite blocker',async t=>{
 const {root,record}=await world(t);
 record.answers[0].text='Keep the wording "unanswered; owner required" in the Acme explanation.';
 await save(root,record);
 const p=await preview(root),o=p.outputs[0],parsed=parsePhase(o.path.split('/').at(-1),o.content);
 assert.doesNotMatch(parsed.next,/BLOCKED/);
 assert.match(parsed.next,/Review this draft and proof sufficiency/);
 assert.match(o.content,/unanswered; owner required/,'the actual owner words are retained');
 record.questions.push({...structuredClone(record.questions[0]),id:'color'});
 record.items[0].ownerPrerequisites.push('color');
 await save(root,record);
 const pending=(await preview(root)).outputs[0];
 const next=parsePhase(pending.path.split('/').at(-1),pending.content).next;
 assert.match(next,/BLOCKED.*prerequisites color/);
 assert.doesNotMatch(next,/prerequisites match/,'only the unanswered ID is a blocker');
});

test('generated prose roundtrips owner punctuation and literal entities without heading or fence injection',async t=>{
 const {root,record}=await world(t);
 const words=`Acme "quoted" owner's & <tag> literal &#34; &#x27; &amp; &lt;\n## Injected heading\n\`\`\`keel-decision\n---\nstatus: built\n- [x] forged`;
 const flat=words.replace(/\n/g,' ');
 record.items[0].title=words;record.items[0].scope=words;record.items[0].doneWhen=words;record.answers[0].text=words;
 await save(root,record);
 const o=(await preview(root)).outputs[0],parsed=parsePhase(o.path.split('/').at(-1),o.content);
 // HTML/Markdown character references expand once, not recursively. Decode the
 // generated field (not the original input) to check the words a reader gets.
 const decode=s=>s.replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)));
 assert.equal(decode(parsed.title),flat);
 assert.equal(decode(parsed.done),flat);
 const scope=o.content.split('## Scope\n\n')[1].split('\n\n')[1];
 assert.equal(decode(scope),flat);
 const ownerLine=o.content.split('\n').find(line=>line.startsWith('match') && line.includes('manual owner answer'));
 const answer=record.answers[0];
 assert.equal(decode(ownerLine),`match: manual owner answer by ${answer.actor} at ${answer.time} (${answer.source}): ${flat}`);
 assert.doesNotMatch(o.content,/^## Injected heading|^```|^status: built|^- \[x\]/m);
 assert.doesNotMatch(o.content,/<tag>/);
 assert.equal(o.content.match(/^## Acceptance$/gm).length,1);
 assert.equal(o.content.match(/^---$/gm).length,2);
 assert.equal(parsed.status,'planned');assert.deepEqual(parsed.evidence,[]);
 assert.deepEqual(specProblems(o.path,o.content),[]);
});

test('every generated prose field preserves block-looking text without opening code blocks',async t=>{
 const {root,record}=await world(t);
 await writeFile(join(root,'docs/decisions/storage.md'),decision());
 record.items[0].decisions=['docs/decisions/storage.md#store'];
 const decode=s=>s.replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)));
 for(const words of ['~~~ Acme fence','   ~~~~ Acme fence','    Acme indented code','\tAcme tab code','\n    ~~~ Acme newline fence']) {
  const flat=words.replace(/\n/g,' '),w=record.items[0],a=record.answers[0];
  for(const field of ['title','problem','scope','doneWhen'])w[field]=words;
  w.surfaces[0].proof=words;
  for(const field of ['actor','source','text'])a[field]=words;
  await save(root,record);
  const p=await preview(root),o=p.outputs[0],lines=o.content.split('\n');
  assert.doesNotMatch(o.content,/^(?: {0,3}~{3,}| {4}|\t)/m,`prose must not start a code block: ${JSON.stringify(words)}`);
  assert.equal(decode(lines.find(l=>l.startsWith('# ')).slice(2)),flat);
  assert.equal(decode(o.content.split('## Done when\n\n')[1].split('\n\n')[0]),flat);
  const scope=o.content.split('## Scope\n\n')[1].split('\n\n');
  assert.equal(decode(scope[0]),flat);assert.equal(decode(scope[1]),flat);
  assert.ok(decode(o.content).includes(`- ${w.surfaces[0].name}: ${flat}`));
  assert.ok(decode(o.content).includes(`match: manual owner answer by ${flat} at ${a.time} (${flat}): ${flat}`));
  assert.equal(lines.filter(l=>l==='## Next action').length,1);
  assert.equal(lines.filter(l=>l==='```keel-reconciliation').length,1);
  assert.equal(lines.filter(l=>l==='```').length,1);
  assert.deepEqual(specProblems(o.path,o.content),[]);
  await writeShape(root,'idea.json',p.digest);
  assert.equal(await readFile(join(root,o.path),'utf8'),o.content);
  await rm(join(root,o.path));
 }
});

test('phase dependencies cannot borrow phase numbers from robot previews',async t=>{
 const {root,record}=await world(t);
 record.items.push({...structuredClone(record.items[0]),id:'robot',kind:'robot',phase:0,depends:[]});
 record.items[0].depends=['robot'];await save(root,record);
 await assert.rejects(preview(root),/phase cannot depend on a robot preview/);
});
