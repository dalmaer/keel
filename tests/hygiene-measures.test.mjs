import './helpers/hermetic.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './helpers/run.mjs';
import { hygieneOptions, draftsWaiting, longFiles, largestSections, lineCount } from '../practices/night/files/scripts/keel/hygiene-measures.mjs';
import { rememberQuota } from '../practices/night/files/scripts/keel/quota.mjs';
import { measure, MEASURES, propose, page, tighten, selftest, improve } from '../lib/improve.mjs';
import { parseHygieneProposal } from '../practices/night/files/scripts/keel/hygiene-proposals.mjs';
const now = Date.parse('2026-10-11T12:00:00Z');
const repo = 'acme/storefront';
const measures = MEASURES.filter(m => ['stale_worktrees','drafts_waiting','long_files'].includes(m.id));
async function scratch(t) {
  const root = await mkdtemp(join(tmpdir(), 'keel-hygiene-'));
  t.after(() => rm(root, {recursive:true,force:true}));
  return root;
}
async function cacheEnv(t) {return {...process.env,KEEL_CACHE:join(await scratch(t),'cache'),KEEL_GH:'/nonexistent/acme-gh'};}
const pr = (number, hours, isDraft = true) => ({number,title:`Acme ${number}`,url:`https://github.com/${repo}/pull/${number}`,state:'OPEN',isDraft,createdAt:new Date(now-hours*3600000).toISOString(),updatedAt:new Date(now-3600000).toISOString()});
const response = (nodes=[],hasNextPage=false) => ({data:{rateLimit:{cost:2,remaining:4000,resetAt:new Date(now+3600000).toISOString()},repository:{pullRequests:{nodes,pageInfo:{hasNextPage}}}}});
async function gitProject(t) {
  const root = await scratch(t);
  const env = {...process.env,CI:'',KEEL_GIT:'git'};
  const git = args => {
    const r = run('git',args,{cwd:root,env,timeout:5000});
    assert.equal(r.status,0,r.stderr);return r.stdout.trim();
  };
  git(['init','--initial-branch=main']);
  const put = async(path,text) => {await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),text);};
  const commit = () => {git(['add','.']);git(['commit','--allow-empty','-m','Acme source']);};
  return {root,env,git,put,commit};
}
const source = count => `export function anvils() {\n${'  // Acme\n'.repeat(count)}}\n`;

test('hygiene filters validate numeric finite positive values separately from count bounds',()=>{
  assert.deepEqual(hygieneOptions({}),{draftHours:24,longFileLines:1500,worktreeDays:7});
  for(const field of ['draftHours','longFileLines','worktreeDays']) {
    for(const value of [0,-1,NaN,Infinity,null,'24',false]) assert.throws(()=>hygieneOptions({hygiene:{[field]:value}}),/positive finite/);
    assert.equal(hygieneOptions({hygiene:{[field]:0.5}})[field],0.5);
  }
  for(const hygiene of [null,[],4])assert.throws(()=>hygieneOptions({hygiene}),/object/);
  assert.deepEqual(tighten(measures.map(m=>({id:m.id,state:'ok',value:0})),{long_files:3},measures),{bounds:{stale_worktrees:0,drafts_waiting:0,long_files:3},tightened:[]});
});

test('draft reader counts creation age only while draft and reuses bounded quota cache',async t=>{
  const env=await cacheEnv(t);let calls=0,guards=0;
  const options={config:{repo},env,now,guard:async()=>{guards++;return null;},graphql:async()=>{calls++;return response([pr(1,48),pr(2,24),pr(3,96,false)]);}};
  const first=await draftsWaiting(options);
  assert.equal(first.value,1);assert.deepEqual(first.facts.prs.map(p=>p.number),[1]);
  assert.match(first.facts.ageBasis,/not continuous/);assert.equal(first.facts.github.cost,2);
  const second=await draftsWaiting({...options,now:now+60000});
  assert.equal(calls,1);assert.equal(guards,1);assert.equal(second.value,2,'age rederived even on cached read');
  assert.equal(second.facts.github.cached,true);assert.equal(second.facts.github.cost,0);assert.equal(second.facts.github.queries,0);
  assert.equal(second.facts.github.readAt,first.facts.github.readAt);
});

test('draft read obeys shared floor without issuing optional query',async t=>{
  const env=await cacheEnv(t);await rememberQuota(env,{remaining:2,resetAt:new Date(Date.now()+3600000).toISOString()});
  const r=await draftsWaiting({config:{repo},env,now,graphql:async()=>{assert.fail('quota-floor query');}});
  assert.match(r.na,/saving your GitHub quota/);assert.equal(r.value,undefined);assert.equal(r.facts.github.queries,0);
});

test('truncated, malformed, inaccessible and future draft evidence never returns a zero',async t=>{
  const invalid=[response([pr(1,48)],true),{data:{}},response([{...pr(1,48),isDraft:undefined}]),response([pr(1,48),pr(1,48)]),response([pr(1,-1)]),{...response(),errors:[{message:'denied'}]},response()];
  delete invalid.at(-1).data.repository.pullRequests.pageInfo;
  for (const raw of invalid) {
    const r=await draftsWaiting({config:{repo},env:await cacheEnv(t),now,guard:async()=>null,graphql:async()=>raw});
    assert.ok(r.na,JSON.stringify(raw));assert.equal(r.value,undefined);assert.equal(r.facts.coverage.complete,false);
  }
  const denied=await draftsWaiting({config:{repo},env:await cacheEnv(t),now,guard:async()=>null,graphql:async()=>{throw new Error('no access');}});
  assert.match(denied.na,/no access/);
  const empty=await draftsWaiting({config:{repo},env:await cacheEnv(t),now,guard:async()=>null,graphql:async()=>response()});
  assert.equal(empty.value,0);assert.equal(empty.facts.coverage.complete,true);
});

test('failed GraphQL projection preserves reported spend and is never cached as empty',async t=>{
  const env=await cacheEnv(t);let calls=0;
  const options={config:{repo},env,now,guard:async()=>null,graphql:async()=>{calls++;return {...response(),errors:[{message:'Acme denied'}]};}};
  const first=await draftsWaiting(options),second=await draftsWaiting(options);
  assert.equal(calls,2);assert.equal(first.facts.github.cost,2);assert.equal(second.facts.github.queries,1);assert.ok(second.na);
});

test('long files use tracked original source, retain actual history and freeze working bytes',async t=>{
  const p=await gitProject(t);
  await p.put('src/anvils.mjs',source(3));p.commit();const older=p.git(['rev-parse','HEAD']);
  await p.put('src/anvils.mjs',source(14));
  await p.put('practices/acme/files/source.mjs',"// managed: keel render rewrites it.\nconst marker = '@generated';\n"+source(12));
  for(const path of ['vendor/large.js','tests/fixtures/large.js','node_modules/acme/index.js','dist/large.js','docs/manual.md','src/types.d.ts','src/auto.generated.ts'])await p.put(path,source(30));
  await p.put('src/autogen.js','// @generated\n'+source(30));
  await p.put('scripts/keel/rendered.mjs',source(30));
  await p.put('.keel/lock.json',JSON.stringify({files:{'scripts/keel/rendered.mjs':{practice:'night'}}}));
  await symlink('/does/not/exist/acme',join(p.root,'src/link.js'));
  p.commit();
  const committed=p.git(['rev-parse','HEAD:src/anvils.mjs']);
  await p.put('src/anvils.mjs',source(16));await p.put('untracked.js',source(100));
  const result=await longFiles({...p,config:{hygiene:{longFileLines:10}},now});
  assert.equal(result.value,2,JSON.stringify(result));assert.equal(result.facts.coverage.complete,true);
  const [f]=result.facts.files;assert.equal(f.path,'src/anvils.mjs');assert.equal(f.lines,18);assert.notEqual(f.blob,committed);
  assert.equal(f.blob,p.git(['hash-object','--','src/anvils.mjs']));
  assert.equal(f.history.complete,true);assert.deepEqual(f.history.entries.map(r=>r.lines),[16,5]);assert.equal(f.history.entries[1].commit,older);
  assert.equal(f.largestSections[0].end,f.lines);
  const r={id:'long_files',state:'outside',value:2,bound:0,better:'lower',facts:result.facts};
  const proposal=propose([r],{repo},{at:now});assert.equal(proposal.hygieneMetadata.file,f.path);
  const text=page({config:{repo},date:'2026-10-11',results:[r],proposal,tightened:[]});
  assert.deepEqual(parseHygieneProposal(text).problems,[]);assert.equal(parseHygieneProposal(text).proposal.blob,f.blob);
});

test('long-file history truncation is an explicit gap while measured size stays known',async t=>{
  const p=await gitProject(t);
  for(let i=1;i<=3;i++){await p.put('large.py',`def anvils():\n${'  pass\n'.repeat(i+10)}`);p.commit();}
  const r=await longFiles({...p,config:{hygiene:{longFileLines:5}},limits:{historyCommits:1},now});
  assert.equal(r.value,1);assert.equal(r.facts.files[0].history.complete,false);assert.match(r.facts.files[0].history.gaps.join(' '),/truncated/);
  assert.equal(r.facts.files[0].history.entries.length,1);
});

test('long-file bounds and symlinked parent preserve unknown coverage',async t=>{
  const p=await gitProject(t);await p.put('src/large.js',source(10));p.commit();
  for(const limits of [{files:0},{fileBytes:10},{totalBytes:10},{ms:0},{findings:0}]){
    const r=await longFiles({...p,config:{hygiene:{longFileLines:1}},limits,now});assert.ok(r.na,JSON.stringify(limits));assert.equal(r.value,undefined);
  }
  await rm(join(p.root,'src'),{recursive:true});const external=await scratch(t);await writeFile(join(external,'large.js'),source(100));await symlink(external,join(p.root,'src'));
  const r=await longFiles({...p,config:{hygiene:{longFileLines:1}},now});assert.match(r.na,/symlink/);assert.equal(r.facts.coverage.bytes,0);assert.equal(r.value,undefined);
});

test('missing tracked source and parent Git are unavailable instead of healthy',async t=>{
  const p=await gitProject(t);await p.put('large.js',source(10));p.commit();await rm(join(p.root,'large.js'));
  assert.ok((await longFiles({...p,config:{},now})).na);
  await mkdir(join(p.root,'child'));
  assert.match((await longFiles({...p,root:join(p.root,'child'),config:{},now})).na,/parent Git/);
});

test('section hints are top-level physical line ranges, including newline and empty boundaries',()=>{
  for(const text of ['', 'export function a() {}', 'export function a() {}\n', 'export function a() {}\n\nexport function b() {}\n'])for(const s of largestSections(text))assert.ok(s.end<=lineCount(text));
  const hints=largestSections('export function a() {\n  function nested() {}\n}\nexport const b = 3;\n');
  assert.deepEqual(hints.map(s=>s.name),['a','b']);assert.equal(hints[0].lines,3);
});

test('registry: stale worktrees are keel-side and CI-inapplicable, invalid filters are broken',async t=>{
  const root=await scratch(t);
  const [na]=await measure({root,config:{},env:{CI:''},measures:[measures[0]],keel:{}});assert.equal(na.state,'n/a');
  const [ci]=await measure({root,config:{},env:{CI:'true'},measures:[measures[0]],keel:{staleWorktrees:()=>assert.fail('CI touched worktrees')}});assert.equal(ci.state,'n/a');
  const results=await measure({root,config:{hygiene:{draftHours:0}},env:{CI:''},measures});
  assert.ok(results.every(r=>r.state==='broken'));assert.ok(results.every(r=>r.value===null));
});

test('selection respects same-blob decisions, history gaps, and robot-protected candidates',()=>{
  const file=(path,blob='a'.repeat(40))=>({path,blob,lines:1600,largestSections:[{name:'anvils',start:1,end:1600}]});
  const row=files=>({id:'long_files',state:'outside',value:files.length,bound:0,better:'lower',facts:{files}});
  const first=propose([row([file('practices/acme/file.mjs'),file('src/anvils.mjs')])],{repo},{at:now});
  assert.equal(first.hygieneMetadata.file,'src/anvils.mjs');
  for(const state of ['proposed','declined','accepting','accepted'])assert.equal(propose([row([file('src/anvils.mjs')])],{repo},{at:now,hygieneHistory:{proposals:[{...first.hygieneMetadata,lifecycle:{state}}],gaps:[]}}),null);
  assert.equal(propose([row([file('src/anvils.mjs')])],{repo},{at:now,hygieneHistory:{proposals:[],gaps:['unreadable']}}),null);
  const manual=propose([row([file('practices/acme/file.mjs')])],{repo},{at:now});assert.equal(manual.hygieneMetadata,undefined);assert.match(manual.text,/owner-led/);assert.doesNotMatch(manual.text,/can enter the robot/);
  const changed=propose([row([file('src/anvils.mjs','b'.repeat(40))])],{repo},{at:now,hygieneHistory:{proposals:[first.hygieneMetadata],gaps:[]}});assert.ok(changed.hygieneMetadata);
});

test('synthetic selftest exercises all three hygiene measures without developer Git or GitHub',async()=>{
  const result=await selftest({measures,env:{...process.env,CI:'true',KEEL_GIT:'/nonexistent/developer-git',KEEL_GH:'/nonexistent/developer-gh'}});
  assert.equal(result.exitCode,0,JSON.stringify(result.data));assert.deepEqual(result.data.measures.map(m=>m.state),['outside','outside','outside']);
});

test('draft URL identity accepts GitHub canonical casing but dates and cached payload remain bounded',async t=>{
  const env=await cacheEnv(t);
  const canonical={...pr(1,48),url:'https://github.com/Acme/StoreFront/pull/1'};
  const options={config:{repo:'ACME/storefront'},env,now,guard:async()=>null,graphql:async()=>response([canonical])};
  const first=await draftsWaiting(options);assert.equal(first.value,1);assert.equal(first.facts.prs[0].url,canonical.url);
  const cached=await draftsWaiting({...options,config:{repo},graphql:()=>assert.fail('same identity missed cache')});assert.equal(cached.facts.github.cached,true);
  for(const field of ['createdAt','updatedAt'])for(const value of [0,12345,'12345','2026-02-31T12:00:00Z',null]){
    const r=await draftsWaiting({...options,env:await cacheEnv(t),graphql:async()=>response([{...pr(1,48),[field]:value}])});assert.ok(r.na,`${field}:${value}`);
  }
  for(const url of ['https://evil.test/Acme/StoreFront/pull/1','https://github.com/acme/other/pull/1','https://github.com/acme/storefront/pull/1?redirect=evil']){
    const r=await draftsWaiting({...options,env:await cacheEnv(t),graphql:async()=>response([{...pr(1,48),url}])});assert.ok(r.na,url);
  }
  const {readdir}=await import('node:fs/promises');
  const file=(await readdir(join(env.KEEL_CACHE,'github'))).find(n=>n.startsWith('hygiene-drafts-'));
  const path=join(env.KEEL_CACHE,'github',file);const data=JSON.parse(await readFile(path,'utf8'));
  data.value.padding='x'.repeat(1024*1024);await writeFile(path,JSON.stringify(data));
  const oversized=await draftsWaiting(options);assert.match(oversized.na,/byte bound/);assert.equal(oversized.value,undefined);
});


test('local improve report keeps manual split advice without repo and skips longest protected robot target',async t=>{
  const p=await gitProject(t);
  await p.put('practices/acme/files/original.mjs',source(40));
  await p.put('src/anvils.mjs',source(12));
  const config={name:'Acme',hygiene:{longFileLines:10}};
  await p.put('.keel/keel.json',JSON.stringify(config));p.commit();
  const options={env:p.env,measures:MEASURES.filter(m=>m.id==='long_files')};
  const local=await improve({root:p.root,report:true,date:'2026-10-11'},options);
  assert.equal(local.exitCode,1);assert.equal(local.data.measures[0].value,2);
  assert.equal(local.data.proposal.hygieneMetadata,undefined);
  assert.match(local.data.proposal.text,/Split practices\/acme\/files\/original.mjs/);
  assert.match(local.data.proposal.text,/owner-led/);
  assert.match(await readFile(join(p.root,local.data.report),'utf8'),/largest sections/);
  await p.put('.keel/keel.json',JSON.stringify({...config,repo}));
  const connected=await improve({root:p.root,report:true,date:'2026-10-12'},options);
  assert.equal(connected.data.proposal.hygieneMetadata.file,'src/anvils.mjs');
  const parsed=parseHygieneProposal(await readFile(join(p.root,connected.data.report),'utf8'));
  assert.deepEqual(parsed.problems,[]);assert.equal(parsed.proposal.file,'src/anvils.mjs');
});
