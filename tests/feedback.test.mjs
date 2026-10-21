import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, lstat, mkdir, rm, symlink, link, chmod, open } from 'node:fs/promises';
import { join } from 'node:path';
import { feedbackFixture, feedbackWords, feedbackBytes } from './helpers/feedback.mjs';
import { feedbackCapture, feedbackList, feedbackResolve, feedbackPropose } from '../lib/feedback-service.mjs';
import { FEEDBACK_LIMITS, feedbackHash, observationId, validateCapture, validateResolution, safeLink, eventFor } from '../lib/feedback.mjs';
import { createFeedbackStore } from '../lib/feedback-store.mjs';
import { run } from './helpers/run.mjs';
const opts=h=>({root:h.root,env:h.env});
async function capture(h){const p=await feedbackCapture({...opts(h),file:'capture.json'});assert.equal(p.exitCode,3,JSON.stringify(p.data));const saved=await feedbackCapture({...opts(h),file:'capture.json',yes:true,digest:p.data.digest});assert.equal(saved.exitCode,0,JSON.stringify(saved.data));return saved.data.item;}
test('capture preview writes nothing, retains verified immutable bytes privately and exposes only metadata',async t=>{
 const h=await feedbackFixture(t),exclude=await readFile(join(h.root,'.git/info/exclude'),'utf8');
 const p=await feedbackCapture({...opts(h),file:'capture.json'});assert.equal(p.exitCode,3);assert.equal(p.data.item.attribution,'manual');assert.equal(p.data.item.sourceRevisionEvidence,'attributed-not-generation-verified');
 await assert.rejects(lstat(join(h.root,'.keel/feedback')),{code:'ENOENT'});assert.equal(await readFile(join(h.root,'.git/info/exclude'),'utf8'),exclude);
 assert.equal((await feedbackCapture({...opts(h),file:'capture.json',yes:true,digest:'a'.repeat(64)})).exitCode,2);
 const item=await capture(h),dir=join(h.root,'.keel/feedback');
 assert.equal((await lstat(dir)).mode&0o777,0o700);assert.equal((await lstat(join(dir,item.id,'00000001.json'))).mode&0o777,0o600);
 assert.deepEqual(await readFile(join(dir,'snapshots',`${h.record.result.contentHash}.bin`)),feedbackBytes);
 await rm(join(h.root,'preview.txt'));const listed=await feedbackList(opts(h));assert.equal(listed.data.items[0].state,'pending');
 for(const output of [p,listed]){assert.doesNotMatch(JSON.stringify(output),/Acme private feedback|Acme Owner|preview\.txt/);}
 const publication=h.publication(item.digest);await h.save('publication.json',publication);assert.equal((await feedbackPropose({...opts(h),id:item.id,record:'publication.json'})).exitCode,3);
 assert.equal(h.git('check-ignore','.keel/feedback/anything'),'.keel/feedback/anything');
 // User-authored inputs are outside Keel's privacy guarantee; stage only project code.
 h.git('add','.keel');assert.equal(h.git('diff','--cached','--name-only'),'');assert.doesNotMatch(h.git('ls-files'),/feedback/);
});
test('replay deduplicates, explicit revisions preserve prior words/resolutions, and versions remain distinct',async t=>{
 const h=await feedbackFixture(t),first=await capture(h);
 assert.equal((await feedbackCapture({...opts(h),file:'capture.json',yes:true})).data.status,'unchanged');
 await h.save('resolution.json',h.resolution(first.digest));const rp=await feedbackResolve({...opts(h),id:first.id,record:'resolution.json'});assert.equal(rp.exitCode,3);
 const resolved=await feedbackResolve({...opts(h),id:first.id,record:'resolution.json',yes:true,digest:rp.data.digest});assert.equal(resolved.data.item.state,'declined');
 h.record.words='Acme revised private feedback.';h.record.revision=2;h.record.previousDigest=resolved.data.item.digest;await h.save('capture.json',h.record);
 const edited=await capture(h);assert.equal(edited.id,first.id);assert.equal(edited.state,'pending');assert.equal(edited.revision,2);
 const history=join(h.root,'.keel/feedback',first.id);assert.equal((await readdir(history)).length,3);assert.match(await readFile(join(history,'00000001.json'),'utf8'),/Acme private feedback/);assert.match(await readFile(join(history,'00000002.json'),'utf8'),/declined/);
 h.record.result.version='v2';h.record.revision=1;h.record.previousDigest=null;await h.save('capture.json',h.record);const second=await capture(h);assert.notEqual(second.id,first.id);
 assert.equal((await feedbackList(opts(h))).data.items.length,2);
});
test('stale or raced capture and resolution revisions never overwrite the winning history',async t=>{
 const h=await feedbackFixture(t),first=await capture(h);
 const drafts=['Acme edit A.','Acme edit B.'];const previews=[];
 for(let i=0;i<2;i++){const file=`capture-${i}.json`;await h.save(file,{...h.record,words:drafts[i],revision:2,previousDigest:first.digest});previews.push(await feedbackCapture({...opts(h),file}));}
 const raced=await Promise.all(previews.map((p,i)=>feedbackCapture({...opts(h),file:`capture-${i}.json`,yes:true,digest:p.data.digest})));
 assert.equal(raced.filter(r=>r.exitCode===0).length,1);assert.equal(raced.filter(r=>r.exitCode===2).length,1);
 assert.equal((await readdir(join(h.root,'.keel/feedback',first.id))).length,2);
 const current=(await feedbackList(opts(h))).data.items[0];await h.save('resolution.json',h.resolution(current.digest));const p=await feedbackResolve({...opts(h),id:first.id,record:'resolution.json'});
 const rs=await Promise.all([1,2].map(()=>feedbackResolve({...opts(h),id:first.id,record:'resolution.json',yes:true,digest:p.data.digest})));
 assert.equal(rs.filter(r=>r.exitCode===0).length,1);assert.equal(rs.filter(r=>r.exitCode===2).length,1);
});
test('one artifact version cannot change bytes across sources and changed source bytes invalidate approval',async t=>{
 const h=await feedbackFixture(t),p=await feedbackCapture({...opts(h),file:'capture.json'});
 await writeFile(join(h.root,'preview.txt'),'Acme changed bytes');assert.equal((await feedbackCapture({...opts(h),file:'capture.json',yes:true,digest:p.data.digest})).data.error,'result_hash_mismatch');
 await writeFile(join(h.root,'preview.txt'),feedbackBytes);await capture(h);
 h.record.source.id='another-note';h.record.result.contentHash=feedbackHash('Acme different bytes');await writeFile(join(h.root,'preview.txt'),'Acme different bytes');await h.save('capture.json',h.record);
 assert.equal((await feedbackCapture({...opts(h),file:'capture.json'})).data.error,'immutable_result_changed');
});
test('missing provider versions and missing or corrupted retained bytes remain explicit proposal-blocking gaps',async t=>{
 for(const mode of ['provider','null','missing','corrupt']){
  const h=await feedbackFixture(t);if(['provider','null'].includes(mode)){delete h.record.result.file;h.record.result.url='https://acme.test/previews/one';if(mode==='null'){h.record.result.version=null;h.record.result.contentHash=null;}await h.save('capture.json',h.record);}
  const item=await capture(h);if(['missing','corrupt'].includes(mode)){const path=join(h.root,'.keel/feedback/snapshots',`${h.record.result.contentHash}.bin`);if(mode==='missing')await rm(path);else await writeFile(path,'Acme corruption');}
  const listed=await feedbackList(opts(h));assert.equal(listed.data.items[0].state,'unavailable',mode);assert.ok(listed.data.items[0].gaps.length);
  await h.save('publication.json',h.publication(item.digest));assert.equal((await feedbackPropose({...opts(h),id:item.id,record:'publication.json'})).exitCode,2);
 }
});
test('tracked, symlinked, hardlinked and permissive private storage refuse without leaking source words or paths',async t=>{
 for(const mode of ['tracked','directory-link','record-link','record-hardlink','directory-mode','file-mode','input-hardlink','result-link']){
  const h=await feedbackFixture(t);let operation=()=>feedbackCapture({...opts(h),file:'capture.json'});
  if(mode==='input-hardlink'){await link(join(h.root,'capture.json'),join(h.root,'copy.json'));}
  else if(mode==='result-link'){await rm(join(h.root,'preview.txt'));await symlink(join(h.root,'capture.json'),join(h.root,'preview.txt'));}
  else if(mode==='directory-link'){await mkdir(join(h.root,'outside'),{mode:0o700});await symlink(join(h.root,'outside'),join(h.root,'.keel/feedback'));}
  else if(mode==='tracked'){await mkdir(join(h.root,'.keel/feedback'),{mode:0o700});await writeFile(join(h.root,'.keel/feedback/raw'),'Acme private');h.git('add','-f','.keel/feedback/raw');}
  else{const item=await capture(h),file=join(h.root,'.keel/feedback',item.id,'00000001.json');operation=()=>feedbackList(opts(h));
   if(mode==='record-link'){await rm(file);await symlink(join(h.root,'capture.json'),file);}
   if(mode==='record-hardlink')await link(file,join(h.root,'alias.json'));
   if(mode==='directory-mode')await chmod(join(h.root,'.keel/feedback'),0o755);
   if(mode==='file-mode')await chmod(file,0o644);
  }
  const r=await operation();assert.equal(r.exitCode,2,mode);assert.doesNotMatch(JSON.stringify(r),/Acme private|capture\.json|preview\.txt|outside/);
 }
});
test('capacity counts existing snapshots/revisions and refuses without deleting stored observations',async t=>{
 const h=await feedbackFixture(t),item=await capture(h),dir=join(h.root,'.keel/feedback/snapshots');
 const filler=await open(join(dir,'capacity.bin'),'wx',0o600);await filler.truncate(FEEDBACK_LIMITS.bytes);await filler.close();
 h.record.source.id='new-note';await h.save('capture.json',h.record);const r=await feedbackCapture({...opts(h),file:'capture.json'});assert.equal(r.exitCode,2);assert.equal(r.data.error,'capacity_exceeded');
 assert.match(await readFile(join(h.root,'.keel/feedback',item.id,'00000001.json'),'utf8'),/Acme private feedback/);
});
test('record and result bounds reject before storage, resolution references cannot expose local paths',async t=>{
 const h=await feedbackFixture(t);h.record.words='x'.repeat(FEEDBACK_LIMITS.record);await h.save('capture.json',h.record);assert.equal((await feedbackCapture({...opts(h),file:'capture.json'})).exitCode,2);
 h.record.words=feedbackWords;await h.save('capture.json',h.record);const file=await open(join(h.root,'preview.txt'),'w');await file.truncate(FEEDBACK_LIMITS.result+1);await file.close();assert.equal((await feedbackCapture({...opts(h),file:'capture.json'})).exitCode,2);
 await writeFile(join(h.root,'preview.txt'),feedbackBytes);const item=await capture(h);
 for(const reference of ['/private/owner/notes','https://user:secret@acme.test/issue','https://acme.test/issue?token=secret']){await h.save('resolution.json',{...h.resolution(item.digest,'linked'),reference});const r=await feedbackResolve({...opts(h),id:item.id,record:'resolution.json'});assert.equal(r.exitCode,2);assert.doesNotMatch(JSON.stringify(r),/secret|\/private\/owner/);}
});
test('superseded resolution names an existing same-project observation and preserves private actor/reason',async t=>{
 const h=await feedbackFixture(t),first=await capture(h);h.record.result.version='v2';await h.save('capture.json',h.record);const second=await capture(h);
 const record={schema:1,feedbackDigest:first.digest,state:'superseded',actor:{kind:'manual',name:'Acme private actor'},at:'2026-10-21T13:00:00.000Z',supersededBy:second.id};await h.save('resolution.json',record);
 const p=await feedbackResolve({...opts(h),id:first.id,record:'resolution.json'});const r=await feedbackResolve({...opts(h),id:first.id,record:'resolution.json',yes:true,digest:p.data.digest});assert.equal(r.exitCode,0);assert.equal(r.data.item.resolution.supersededBy,second.id);assert.doesNotMatch(JSON.stringify(r),/Acme private actor/);
});
test('pure validation and store replay preserve deterministic observation and content identities',async t=>{
 const h=await feedbackFixture(t),record=validateCapture(h.record,h.config.repo);assert.equal(observationId(record),observationId({...record,words:'another observation revision'}));
 const item=await capture(h),store=await createFeedbackStore(opts(h));
 // A store opened without the project identity cannot reinterpret another project's records.
 await assert.rejects(store.inventory());
 const actual=await createFeedbackStore({...opts(h),project:h.config.repo});const {rows}=await actual.inventory();assert.equal(rows[0].digest,item.digest);assert.equal(rows[0].capture.words,feedbackWords);
});
test('actual snapshot, revision and temporary Git destinations resist higher-priority ignore negations',async t=>{
 for(const suffix of ['snapshots/','snapshots/*.bin','snapshots/.tmp-*','*/00000001.json','*/.tmp-*']){
  const h=await feedbackFixture(t);await writeFile(join(h.root,'.gitignore'),`.keel/feedback/*\n!.keel/feedback/snapshots/\n!.keel/feedback/${suffix}\n`);
  const p=await feedbackCapture({...opts(h),file:'capture.json'});assert.equal(p.exitCode,3);
  const r=await feedbackCapture({...opts(h),file:'capture.json',yes:true,digest:p.data.digest});assert.equal(r.exitCode,2,suffix);
  assert.doesNotMatch(h.git('status','--porcelain','--untracked-files=all'),/\.bin|00000001\.json|\.tmp-/);
 }
});
test('store-local npm ignore excludes private retained copies in a default adopted package and conflicting rules refuse',async t=>{
 const h=await feedbackFixture(t);await h.save('package.json',{name:'acme-feedback-fixture',version:'1.0.0'});await capture(h);
 const packed=run('npm',['pack','--dry-run','--json','--ignore-scripts'],{cwd:h.root,env:h.env});assert.equal(packed.status,0,packed.stderr);
 const paths=JSON.parse(packed.stdout)[0].files.map(f=>f.path);assert.ok(paths.includes('package.json'));assert.ok(!paths.some(p=>p.startsWith('.keel/feedback/')),JSON.stringify(paths));
 await writeFile(join(h.root,'.keel/feedback/.npmignore'),'!snapshots/\n');const r=await feedbackList(opts(h));assert.equal(r.exitCode,2);assert.equal(r.data.error,'unsafe_package_ignore');
});
test('authored and retained JSON reject invalid UTF-8; selected result bytes stay binary-exact',async t=>{
 const h=await feedbackFixture(t),raw=JSON.stringify(h.record),needle='Acme private feedback';
 await writeFile(join(h.root,'capture.json'),Buffer.concat([Buffer.from(raw.slice(0,raw.indexOf(needle))),Buffer.from([255]),Buffer.from(raw.slice(raw.indexOf(needle)))]));
 const invalid=await feedbackCapture({...opts(h),file:'capture.json'});assert.equal(invalid.exitCode,2);assert.equal(invalid.data.error,'input_unavailable');
 const bytes=Buffer.from([0,255,128,1,2]);h.record.result.contentHash=feedbackHash(bytes);await writeFile(join(h.root,'preview.txt'),bytes);await h.save('capture.json',h.record);const item=await capture(h);
 assert.deepEqual(await readFile(join(h.root,'.keel/feedback/snapshots',`${h.record.result.contentHash}.bin`)),bytes);
 const path=join(h.root,'.keel/feedback',item.id,'00000001.json'),saved=await readFile(path);await writeFile(path,Buffer.concat([saved.subarray(0,10),Buffer.from([255]),saved.subarray(10)]));assert.equal((await feedbackList(opts(h))).data.error,'invalid_store');
});
test('unknown nested directories and non-Git projects report explicit unavailable coverage',async t=>{
 const h=await feedbackFixture(t);await capture(h);await mkdir(join(h.root,'.keel/feedback/snapshots/unexpected'),{mode:0o700});assert.equal((await feedbackList(opts(h))).data.error,'invalid_store');
 await rm(join(h.root,'.git'),{recursive:true});const r=await feedbackList(opts(h));assert.equal(r.exitCode,2);assert.equal(r.data.error,'git_unavailable');assert.equal(r.data.coverage[0].state,'unavailable');
});
test('structured schema references reject coercible arrays and numbers without becoming owner links or work IDs',async t=>{
 const h=await feedbackFixture(t);
 for(const reference of [['https://github.com/acme/studio/issues/1'],[`proposal:${'a'.repeat(64)}`],42,{}]){
  assert.equal(safeLink(reference),false);assert.throws(()=>validateResolution({...h.resolution('a'.repeat(64),'linked'),reference}),/invalid_resolution_reference/);
 }
 for(const work of [{kind:'phase',ref:92},{kind:'phase',ref:['92']},{kind:'issue',ref:['acme/studio#12']},{kind:'pr',ref:['acme/studio#12']}])assert.throws(()=>validateCapture({...h.record,result:{...h.record.result,work}},h.config.repo),/invalid_work/);
 assert.throws(()=>validateCapture({...h.record,result:{...h.record.result,url:['https://acme.test/preview']}},h.config.repo),/invalid_result_reference/);
});
test('observation capacity rejects the next record while preserving all one thousand histories',async t=>{
 const h=await feedbackFixture(t);await capture(h);
 for(let offset=1;offset<1000;offset+=50)await Promise.all(Array.from({length:Math.min(50,1000-offset)},async(_,i)=>{
  const record=validateCapture({...h.record,source:{kind:'manual',id:`acme-${offset+i}`}},h.config.repo),id=observationId(record),dir=join(h.root,'.keel/feedback',id);await mkdir(dir,{mode:0o700});await writeFile(join(dir,'00000001.json'),JSON.stringify(eventFor(null,'capture',record)),{mode:0o600});
 }));
 h.record.source.id='acme-over-capacity';await h.save('capture.json',h.record);const p=await feedbackCapture({...opts(h),file:'capture.json'});assert.equal(p.exitCode,3);const r=await feedbackCapture({...opts(h),file:'capture.json',yes:true,digest:p.data.digest});assert.equal(r.exitCode,2);assert.equal(r.data.error,'capacity_exceeded');assert.equal((await readdir(join(h.root,'.keel/feedback'))).filter(x=>/^[a-f0-9]{64}$/.test(x)).length,1000);
});
test('ordinary canvas and local night artifacts exclude raw feedback and retained snapshots',async t=>{
 const h=await feedbackFixture(t);await capture(h);h.config.canvas={enabled:true,cadence:'nightly',projectKey:'acme-feedback'};await h.save('.keel/keel.json',h.config);
 const {snapshot}=await import('../lib/canvas-snapshot.mjs'),{night}=await import('../lib/canvas-night.mjs');
 const captured=await snapshot({...opts(h),now:'2026-10-21T14:00:00.000Z'});assert.doesNotMatch(JSON.stringify(captured),/Acme private feedback|Acme immutable preview|\.keel\/feedback/);
 const output=join(h.root,'night-output'),result=await night({...opts(h),now:'2026-10-21T14:00:00.000Z',output,report:{date:'2026-10-21',measures:[]}});
 assert.equal(result.exitCode,0,JSON.stringify(result));
 async function inspect(path){for(const item of await readdir(path,{withFileTypes:true})){const file=join(path,item.name);if(item.isDirectory())await inspect(file);else assert.doesNotMatch(await readFile(file,'utf8'),/Acme private feedback|Acme immutable preview|\.keel\/feedback/);}}
 await inspect(output);
});
