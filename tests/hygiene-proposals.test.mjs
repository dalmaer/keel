import './helpers/hermetic.mjs';
import {test} from 'node:test';
import {run} from './helpers/run.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,chmod,rename,lstat} from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';
import {tmpdir,hostname} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {makeHygieneProposal,formatHygieneProposal,parseHygieneProposal,readHygieneProposals,hygieneRobotTargetReason} from '../practices/night/files/scripts/plates/hygiene-proposals.mjs';
import {writeHealthReport} from '../practices/night/files/scripts/plates/time-proposals.mjs';
import {decideHygieneProposal} from '../lib/hygiene-proposal-actions.mjs';
import {walkDecide,proposalOf,board} from '../lib/board.mjs';
const repo='acme/anvils',path='docs/health/2026-10-11.md',at='2026-10-11T12:00:00Z';
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
async function fixture(t,{robot={on:true,budgetMinutes:60}}={}) {
  const root=await mkdtemp(join(tmpdir(),'acme-hygiene-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'.plates'));await mkdir(join(root,'src'));
  const config={repo,robot};await writeFile(join(root,'.plates/plates.json'),JSON.stringify(config));
  await writeFile(join(root,'src/acme.mjs'),'export function acme() {\n'+Array.from({length:1500},()=> '  // Acme responsibility').join('\n')+'\n}\n');
  git(root,'init','-q','-b','main');git(root,'add','.');git(root,'commit','-qm','Acme source');
  const blob=git(root,'hash-object','src/acme.mjs');
  const proposal=makeHygieneProposal({repo,file:'src/acme.mjs',blob,lines:1502,sections:[{name:'acme',start:1,end:1502}],at});
  await writeHealthReport({root,path,generated:'# Acme health\n\n## Proposal\n\n'+formatHygieneProposal(proposal)});
  await writeFile(join(root,path),(await readFile(join(root,path),'utf8'))+'\n\n## Owner notes\n\nAcme human content.\n');
  let issue=null,posts=0,fail=false,gets=0;
  let contents={status:200,data:{type:'file',path:proposal.file,sha:proposal.blob}};
  const requests=[];
  const github=async r=>{
    requests.push({method:r.method,path:r.path});
    assert.ok(r.path.startsWith('/repos/acme/anvils/'));
    if(r.method==='POST'){
      posts++;assert.equal(parseHygieneProposal(await readFile(join(root,path),'utf8')).proposal.lifecycle.state,'accepting');
      issue={number:7,state:'open',body:r.body.body,labels:r.body.labels,html_url:`https://github.com/${repo}/issues/7`,url:`https://api.github.com/repos/${repo}/issues/7`};
      if(fail)throw Error('Acme lost response');return {status:201,data:issue};
    }
    gets++;if(fail&&issue)return {status:503};
    if(r.path===`/repos/${repo}/contents/${proposal.file}`)return contents;
    if(r.path.includes('/issues?'))return {status:200,data:issue?[issue]:[]};
    if(r.path.endsWith('/issues/7'))return {status:200,data:issue};
    throw Error('unexpected synthetic endpoint');
  };
  return {root,config,proposal,github,requests,set contents(v){contents=v;},args:{root,path,expectedInstance:proposal.instanceId,decision:'accept',at,github},get issue(){return issue;},get posts(){return posts;},get gets(){return gets;},set fail(v){fail=v;}};
}
test('canonical proposal derives rubric and identity, rejects arbitrary body/rubric/policy',async t=>{
  const f=await fixture(t),page=await readFile(join(f.root,path),'utf8');
  assert.equal(parseHygieneProposal(page).proposal.instanceId,f.proposal.instanceId);
  assert.equal(proposalOf(page).measure,'long_files');
  for(const edit of [p=>p.candidate.rubric.change='Run arbitrary command',p=>p.policy={enabled:true},p=>p.repo='acme/foreign',p=>p.subjectKey='foreign']){
    const p=structuredClone(f.proposal);edit(p);assert.throws(()=>formatHygieneProposal(p));
  }
  assert.ok(parseHygieneProposal(page.replace('Split long source file','Execute something')).problems.length);
  assert.ok(parseHygieneProposal(page+formatHygieneProposal(f.proposal)).problems.length);
});
test('acceptance requires explicit instance, fresh tracked blob, approved robot budget',async t=>{
  const f=await fixture(t);
  await assert.rejects(decideHygieneProposal({...f.args,expectedInstance:undefined}),/instance/);
  await assert.rejects(decideHygieneProposal({...f.args,expectedInstance:'0'.repeat(64)}),/stale/);
  await writeFile(join(f.root,'src/acme.mjs'),'// Acme changed\n');
  assert.match((await decideHygieneProposal(f.args)).reasons.join(' '),/stale/);assert.equal(f.posts,0);
  for(const robot of [{on:false,budgetMinutes:60},{on:true},{on:true,budgetMinutes:0}]){
    const x=await fixture(t,{robot}),r=await decideHygieneProposal(x.args);
    assert.equal(r.state,'blocked');assert.equal(r.proposal.lifecycle.state,'proposed');assert.equal(x.posts,0);assert.equal(x.gets,0);
  }
});
test('decline is local, retained across report refresh and visible to history',async t=>{
  const f=await fixture(t),r=await decideHygieneProposal({...f.args,decision:'decline',reason:'Acme stays cohesive'});
  assert.equal(r.decision,'declined');assert.equal(f.posts,0);assert.equal(f.gets,0);
  await assert.rejects(decideHygieneProposal(f.args),/declined/);
  await writeHealthReport({root:f.root,path,generated:'# Acme refreshed\n\n## Proposal\n\n'+formatHygieneProposal(f.proposal)});
  const page=await readFile(join(f.root,path),'utf8');assert.match(page,/Acme human content/);assert.equal(parseHygieneProposal(page).proposal.lifecycle.state,'declined');
  const history=await readHygieneProposals({root:f.root});assert.equal(history.proposals[0].instanceId,f.proposal.instanceId);assert.deepEqual(history.gaps,[]);
});
test('uncertain POST recovers after refresh/source changes/robot off with no duplicate; repeat acceptance reads back',async t=>{
  const f=await fixture(t);f.fail=true;
  const first=await decideHygieneProposal(f.args);assert.equal(first.decision,'accepting');assert.equal(first.state,'ambiguous');assert.equal(f.posts,1);
  await writeHealthReport({root:f.root,path,generated:'# Acme refreshed\n\n## Proposal\n\n'+formatHygieneProposal(f.proposal)});
  let page=await readFile(join(f.root,path),'utf8');assert.equal(parseHygieneProposal(page).proposal.lifecycle.state,'accepting');assert.match(page,/Acme human content/);
  await writeFile(join(f.root,'src/acme.mjs'),'// Acme changed after POST\n');await writeFile(join(f.root,'.plates/plates.json'),JSON.stringify({...f.config,robot:{on:false}}));
  f.fail=false;const recovered=await decideHygieneProposal(f.args);assert.equal(recovered.decision,'accepted');assert.equal(f.posts,1);assert.deepEqual(f.issue.labels,['keel:agent']);
  assert.equal((await decideHygieneProposal(f.args)).state,'recovered');assert.equal(f.posts,1);
  await writeHealthReport({root:f.root,path,generated:'# Acme refreshed again\n\n## Proposal\n\n'+formatHygieneProposal(f.proposal)});
  page=await readFile(join(f.root,path),'utf8');assert.equal(parseHygieneProposal(page).proposal.lifecycle.state,'accepted');assert.match(page,/Acme human content/);
});
test('walk decide routes structured hygiene with instance and generic work stays local',async t=>{
  const f=await fixture(t),r=await walkDecide({root:f.root,proposal:path,instance:f.proposal.instanceId,accept:'Acme approved',github:f.github,at});
  assert.equal(r.exitCode,0);assert.equal(r.data.decision,'accepted');assert.equal(f.posts,1);
  for(const measure of ['stale_worktrees','drafts_waiting','legacy']) {
    await writeFile(join(f.root,path),`# Acme health\n\n## Proposal\n\n**\`${measure}\`** Owner advice\n\n## Notes\nKeep Acme text\n`);
    const result=await walkDecide({root:f.root,proposal:path,accept:'Acme noted',github:()=>{throw Error('must remain local');}});
    assert.equal(result.data.decision,'accepted');assert.match(await readFile(join(f.root,path),'utf8'),/Keep Acme text/);
  }
});
test('symlink/escaping pages and source, untracked or managed source cannot issue',async t=>{
  const f=await fixture(t);
  await assert.rejects(decideHygieneProposal({...f.args,path:'../outside.md'}),/unsafe/);
  const page=await readFile(join(f.root,path),'utf8');await writeFile(join(f.root,'owner.md'),page);await rm(join(f.root,path));await symlink(join(f.root,'owner.md'),join(f.root,path));
  await assert.rejects(decideHygieneProposal(f.args),/symlink/);assert.equal(await readFile(join(f.root,'owner.md'),'utf8'),page);
  assert.ok((await readHygieneProposals({root:f.root})).gaps.length);
  await rm(join(f.root,path));await writeFile(join(f.root,path),page);
  git(f.root,'rm','--cached','src/acme.mjs');assert.equal((await decideHygieneProposal(f.args)).state,'blocked');git(f.root,'add','src/acme.mjs');
  await writeFile(join(f.root,'.plates/lock.json'),JSON.stringify({files:{'src/acme.mjs':{kind:'managed'}}}));assert.match((await decideHygieneProposal(f.args)).reasons.join(' '),/managed/);await rm(join(f.root,'.plates/lock.json'));
  await writeFile(join(f.root,'owner.mjs'),await readFile(join(f.root,'src/acme.mjs')));await rm(join(f.root,'src/acme.mjs'));await symlink('../owner.mjs',join(f.root,'src/acme.mjs'));
  assert.match((await decideHygieneProposal(f.args)).reasons.join(' '),/symlink/);assert.equal(f.posts,0);
});
test('robot-protected and canonical practice sources remain owner work',()=>{
  for(const file of ['scripts/plates/improve.mjs','.github/acme.mjs','.plates/acme.mjs','practices/night/files/scripts/plates/improve.mjs','.agents/acme.mjs']){
    assert.ok(hygieneRobotTargetReason(file));assert.throws(()=>makeHygieneProposal({repo,file,blob:'a'.repeat(40),lines:1600}),/owner-led/);
  }
});
test('current threshold and source-derived sections reject fabricated candidate facts',async t=>{
  const f=await fixture(t);
  await writeFile(join(f.root,'.plates/plates.json'),JSON.stringify({...f.config,hygiene:{longFileLines:2000}}));
  assert.match((await decideHygieneProposal(f.args)).reasons.join(' '),/threshold/);
  await writeFile(join(f.root,'.plates/plates.json'),JSON.stringify(f.config));
  const fabricated=makeHygieneProposal({...f.proposal,sections:[{name:'fake',start:2,end:100}],at});
  await writeFile(join(f.root,path),'## Proposal\n\n'+formatHygieneProposal(fabricated));
  assert.match((await decideHygieneProposal(f.args)).reasons.join(' '),/split hints/);assert.equal(f.posts,0);
});
test('uncertain empty recovery preserves intent and never retries a POST',async t=>{
  const f=await fixture(t);let posts=0;
  const github=async r=>{if(r.path.includes('/contents/'))return f.github(r);if(r.method==='POST'){posts++;throw Error('Acme transport uncertain');}return {status:200,data:[]};};
  const first=await decideHygieneProposal({...f.args,github});assert.equal(first.state,'pending');
  const second=await decideHygieneProposal({...f.args,github});assert.equal(second.state,'pending');assert.equal(posts,1);
});
test('board retains acceptance action and verified issue from older health pages',async t=>{
  const f=await fixture(t);
  await writeHealthReport({root:f.root,path:'docs/health/2026-10-12.md',generated:'# Acme today\n\n## Proposal\n\nNone.\n'});
  const deps={looseEnds:async()=>({projects:[]}),reviews:async()=>({items:[]}),robotStatus:async()=>({policy:{enabled:false},budget:{state:'off'}}),today:'2026-10-12'};
  let data=await board({root:f.root},deps),item=data.items.find(i=>i.instanceId===f.proposal.instanceId);
  assert.ok(item);assert.deepEqual(item.actions[0].args,['--proposal',path,'--instance',f.proposal.instanceId,'--accept']);
  await decideHygieneProposal(f.args);data=await board({root:f.root},deps);item=data.items.find(i=>i.instanceId===f.proposal.instanceId);
  assert.equal(item.waits,'external');assert.equal(item.link,f.issue.html_url);assert.deepEqual(item.actions,[]);
});
test('prepared issue intent resumes after storage failure without losing the owner decision',async t=>{
  const f=await fixture(t),hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
  const dir=join(f.root,'.plates/robot-issues',hash(repo)),subject=join(dir,'subject-'+hash(f.proposal.subjectKey)+'.json');
  let sabotage=true;
  const github=async r=>{
    // The first lookup happens after initial storage validation, but before
    // prepared is persisted. A broken subject reservation then prevents POST.
    if(sabotage&&r.path.includes('/issues?')){sabotage=false;await mkdir(subject);}
    return f.github(r);
  };
  const first=await decideHygieneProposal({...f.args,github});assert.equal(first.state,'blocked');assert.equal(first.decision,'accepting');assert.equal(f.posts,0);
  const journal=JSON.parse(await readFile(join(dir,hash(f.proposal.instanceId)+'.json'),'utf8'));assert.equal(journal.state,'prepared');
  await rm(subject,{recursive:true});
  const resumed=await decideHygieneProposal(f.args);assert.equal(resumed.decision,'accepted');assert.equal(f.posts,1);
});
test('a dead health writer is recovered while active or unknown locks are never stolen',async t=>{
  const f=await fixture(t),lock=join(f.root,'docs/health/.keel-time-proposals.lock');
  await mkdir(lock);
  await assert.rejects(decideHygieneProposal(f.args),/busy or unknown/);
  await writeFile(join(lock,'owner.json'),JSON.stringify({host:hostname(),pid:process.pid,token:'acme-active'}));
  await assert.rejects(decideHygieneProposal(f.args),/busy or unknown/);
  // Obtain an exited child's real PID, rather than assuming an arbitrary PID dead.
  const child=run(process.execPath,['-e','console.log(process.pid)']);
  assert.equal(child.status,0,child.stderr);
  const pid=Number(child.stdout.trim());
  await writeFile(join(lock,'owner.json'),JSON.stringify({host:hostname(),pid,token:'acme-dead'}));
  const resumed=await decideHygieneProposal(f.args);assert.equal(resumed.decision,'accepted');assert.equal(f.posts,1);
});
test('CLI accepts hygiene --instance with synthetic GitHub and resumes without another issue',async t=>{
  const f=await fixture(t),gh=join(f.root,'acme-gh'),state=join(f.root,'acme-api.json');
  await writeFile(state,JSON.stringify({posts:0,issue:null,contentsReads:0}));
  await writeFile(gh,`#!${process.execPath}
const fs=require('node:fs'),args=process.argv.slice(2),i=args.indexOf('--method'),method=args[i+1],path=args[i+2];
if(i<0||!path.startsWith('/repos/acme/anvils/'))throw Error('unexpected synthetic API');
const file=${JSON.stringify(state)},s=JSON.parse(fs.readFileSync(file,'utf8'));let status=200,data;
if(method==='POST'){
  if(!fs.readFileSync(${JSON.stringify(join(f.root,path))},'utf8').includes('"state":"accepting"'))throw Error('missing local intent');
  const b=JSON.parse(fs.readFileSync(0,'utf8'));s.posts++;s.issue={number:7,state:'open',body:b.body,labels:b.labels,html_url:'https://github.com/acme/anvils/issues/7',url:'https://api.github.com/repos/acme/anvils/issues/7'};status=201;data=s.issue;
}else if(method==='GET'&&path==='/repos/acme/anvils/contents/src/acme.mjs'){s.contentsReads++;data={type:'file',path:'src/acme.mjs',sha:${JSON.stringify(f.proposal.blob)}};}
else if(method==='GET')data=path.includes('/issues?')?(s.issue?[s.issue]:[]):s.issue;
else throw Error('unsupported synthetic method');
fs.writeFileSync(file,JSON.stringify(s));process.stdout.write('HTTP/2.0 '+status+' OK\\r\\nContent-Type: application/json\\r\\n\\r\\n'+JSON.stringify(data));
`);await chmod(gh,0o755);
  const cli=new URL('../bin/plates.mjs',import.meta.url).pathname;
  const invoke=extra=>run(process.execPath,[cli,'walk','decide','--proposal',path,...extra,'--json'],{cwd:f.root,env:{...process.env,PLATES_GH:gh}});
  assert.notEqual(invoke(['--accept']).status,0);
  for(let i=0;i<2;i++){
    const result=invoke(['--instance',f.proposal.instanceId,'--accept']);assert.equal(result.status,0,result.stderr+result.stdout);
    const data=JSON.parse(result.stdout);assert.equal(data.decision,'accepted');assert.equal(data.instanceId,f.proposal.instanceId);
  }
  const saved=JSON.parse(await readFile(state,'utf8'));assert.equal(saved.posts,1);assert.equal(saved.contentsReads,1);
});
test('acceptance shares generated-header semantics with measurement, not literals inside source',async t=>{
  const f=await fixture(t),file=join(f.root,'src/acme.mjs');
  await writeFile(file,(await readFile(file,'utf8')).replace('  // Acme responsibility','  const warning = "@generated DO NOT EDIT";'));
  const p=makeHygieneProposal({...f.proposal,blob:git(f.root,'hash-object','src/acme.mjs'),at});
  f.contents={status:200,data:{type:'file',path:p.file,sha:p.blob}}; // Acme publishes these bytes.
  await writeFile(join(f.root,path),'## Proposal\n\n'+formatHygieneProposal(p));
  assert.equal((await decideHygieneProposal({...f.args,expectedInstance:p.instanceId})).decision,'accepted');
  const g=await fixture(t),gfile=join(g.root,'src/acme.mjs');
  await writeFile(gfile,'// @generated\n'+await readFile(gfile,'utf8'));
  assert.match((await decideHygieneProposal(g.args)).reasons.join(' '),/generated source/);assert.equal(g.posts,0);
});

async function blockedSource(f,args=f.args) {
  const before=await readFile(join(f.root,path),'utf8');
  const result=await decideHygieneProposal(args);
  assert.equal(result.ok,false);assert.equal(result.state,'blocked');assert.equal(result.decision,'proposed');
  assert.match(result.reasons.join(' '),/source availability:/);assert.equal(result.issue,null);assert.equal(f.posts,0);
  assert.equal(await readFile(join(f.root,path),'utf8'),before,'blocking must not save an accepting intent');
  await assert.rejects(readFile(join(f.root,'.plates/robot-issues')),{code:'ENOENT'});
  return result;
}
test('source availability: matching default-branch metadata is read before acceptance intent and POST',async t=>{
  const f=await fixture(t);let checked=false;
  const github=async r=>{
    if(r.path.includes('/contents/')){
      assert.equal(r.method,'GET');assert.equal(r.path,'/repos/acme/anvils/contents/src/acme.mjs');
      assert.equal(parseHygieneProposal(await readFile(join(f.root,path),'utf8')).proposal.lifecycle.state,'proposed');checked=true;
    }
    if(r.method==='POST')assert.equal(checked,true);
    return f.github(r);
  };
  assert.equal((await decideHygieneProposal({...f.args,github})).decision,'accepted');assert.equal(checked,true);assert.equal(f.posts,1);
});
test('source availability: missing default-branch file blocks delivery',async t=>{
  const f=await fixture(t);f.contents={status:404,data:{message:'Acme missing'}};
  assert.match((await blockedSource(f)).reasons.join(' '),/404/);
});
test('source availability: unpublished worktree and feature-branch-only blobs block delivery',async t=>{
  for(const committed of [false,true])await t.test(committed?'feature branch commit':'uncommitted worktree',async t=>{
    const f=await fixture(t),file=join(f.root,'src/acme.mjs');
    if(committed)git(f.root,'checkout','-qb','acme-feature');
    await writeFile(file,(await readFile(file,'utf8')).replace('Acme responsibility','Acme unpublished responsibility'));
    if(committed){git(f.root,'add','src/acme.mjs');git(f.root,'commit','-qm','Acme unpublished feature');}
    const p=makeHygieneProposal({...f.proposal,blob:git(f.root,'hash-object','src/acme.mjs'),at});
    await writeFile(join(f.root,path),'## Proposal\n\n'+formatHygieneProposal(p));
    assert.match((await blockedSource(f,{...f.args,expectedInstance:p.instanceId})).reasons.join(' '),/differs from GitHub default branch/);
  });
});
test('source availability: different default-branch blob blocks a locally unchanged proposal',async t=>{
  const f=await fixture(t);f.contents={status:200,data:{type:'file',path:f.proposal.file,sha:'f'.repeat(40)}};
  assert.match((await blockedSource(f)).reasons.join(' '),/differs from GitHub default branch/);
});
test('source availability: malformed contents cannot authorize delivery',async t=>{
  const good={type:'file',path:'src/acme.mjs',sha:'a'.repeat(40)};
  for(const [name,data] of [
    ['null',null],['directory array',[]],['directory type',{...good,type:'dir'}],
    ['wrong path',{...good,path:'src/foreign.mjs'}],['missing sha',{type:'file',path:good.path}],
    ['symlink',{...good,type:'symlink'}],['symlink target',{...good,target:'../acme.mjs'}],
    ['submodule',{...good,submodule_git_url:'https://github.com/acme/module'}],
  ])await t.test(name,async t=>{const f=await fixture(t);f.contents={status:200,data};assert.match((await blockedSource(f)).reasons.join(' '),/invalid default-branch file metadata/);});
});
test('source availability: remote unavailable and failed transport preserve the proposal',async t=>{
  for(const status of [403,503])await t.test(`HTTP ${status}`,async t=>{
    const f=await fixture(t);f.contents={status};assert.match((await blockedSource(f)).reasons.join(' '),/unavailable/);
  });
  const f=await fixture(t),github=async r=>{if(r.path.includes('/contents/'))throw Error('Acme network unavailable');return f.github(r);};
  assert.match((await blockedSource(f,{...f.args,github})).reasons.join(' '),/read unavailable/);
});
test('source availability: attempted recovery bypasses unavailable source without another POST',async t=>{
  const f=await fixture(t);f.fail=true;
  assert.equal((await decideHygieneProposal(f.args)).state,'ambiguous');assert.equal(f.posts,1);
  f.fail=false;await writeFile(join(f.root,'src/acme.mjs'),'// Acme source moved after POST\n');
  await writeFile(join(f.root,'.plates/plates.json'),JSON.stringify({...f.config,robot:{on:false}}));
  let contentsReads=0;
  const github=async r=>{if(r.path.includes('/contents/')){contentsReads++;throw Error('Acme source unavailable');}return f.github(r);};
  for(let i=0;i<2;i++)assert.equal((await decideHygieneProposal({...f.args,github})).state,'recovered');
  assert.equal(contentsReads,0);assert.equal(f.posts,1);
});

async function healthAlias(f) {
  await rename(join(f.root,'docs/health'),join(f.root,'acme-health'));
  await symlink('../acme-health',join(f.root,'docs/health'));
  await writeFile(join(f.root,'.plates/plates.json'),JSON.stringify({...f.config,health:'docs/health'}));
  return 'acme-health/2026-10-11.md';
}
test('configured health alias: acceptance and report refresh share the canonical page',async t=>{
  const f=await fixture(t),canonical=await healthAlias(f);
  const accepted=await walkDecide({root:f.root,proposal:path,instance:f.proposal.instanceId,accept:'Acme approved',github:f.github,at});
  assert.equal(accepted.data.decision,'accepted');assert.equal(f.posts,1);
  await writeHealthReport({root:f.root,path,generated:'# Acme refreshed\n\n## Proposal\n\n'+formatHygieneProposal(f.proposal)});
  const text=await readFile(join(f.root,canonical),'utf8');
  assert.equal(parseHygieneProposal(text).proposal.lifecycle.state,'accepted');assert.match(text,/Acme human content/);
  assert.equal(await readFile(join(f.root,path),'utf8'),text);assert.ok((await lstat(join(f.root,'docs/health'))).isSymbolicLink());
  assert.equal((await decideHygieneProposal({...f.args,path:canonical})).state,'recovered');assert.equal(f.posts,1);
});
test('configured health alias: canonical and configured paths use the report writer lock',async t=>{
  const f=await fixture(t),canonical=await healthAlias(f),lock=join(f.root,'acme-health/.keel-time-proposals.lock');
  await mkdir(lock);
  for(const page of [path,canonical])await assert.rejects(decideHygieneProposal({...f.args,path:page,decision:'decline',reason:'Acme keep'}),/writer busy or unknown/);
  await rm(lock,{recursive:true});
  const declined=await decideHygieneProposal({...f.args,path:canonical,decision:'decline',reason:'Acme keep'});
  assert.equal(declined.decision,'declined');assert.equal(f.gets,0);
  await writeHealthReport({root:f.root,path,generated:'# Acme refreshed\n\n## Proposal\n\n'+formatHygieneProposal(f.proposal)});
  assert.equal(parseHygieneProposal(await readFile(join(f.root,path),'utf8')).proposal.lifecycle.state,'declined');
});
test('configured health alias: external directory and page symlinks remain refused',async t=>{
  const f=await fixture(t),canonical=await healthAlias(f),original=await readFile(join(f.root,canonical),'utf8');
  const outside=await mkdtemp(join(tmpdir(),'acme-outside-health-'));t.after(()=>rm(outside,{recursive:true,force:true}));
  await writeFile(join(outside,'2026-10-11.md'),original);
  await rm(join(f.root,'docs/health'));await symlink(outside,join(f.root,'docs/health'));
  await assert.rejects(decideHygieneProposal(f.args),/outside project/);
  assert.equal(await readFile(join(outside,'2026-10-11.md'),'utf8'),original);
  await rm(join(f.root,'docs/health'));await symlink('../acme-health',join(f.root,'docs/health'));
  await writeFile(join(f.root,'owner.md'),original);await rm(join(f.root,canonical));await symlink('../owner.md',join(f.root,canonical));
  await assert.rejects(decideHygieneProposal(f.args),/symlink/);
  assert.equal(await readFile(join(f.root,'owner.md'),'utf8'),original);assert.equal(f.gets,0);assert.equal(f.posts,0);
});
test('configured health alias: unconfigured aliases and mid-decision retargets are refused',async t=>{
  const f=await fixture(t),canonical=await healthAlias(f);
  await symlink('acme-health',join(f.root,'other-health'));
  await assert.rejects(decideHygieneProposal({...f.args,path:'other-health/2026-10-11.md'}),/configured health page/);
  const original=await readFile(join(f.root,canonical),'utf8');await mkdir(join(f.root,'acme-other'));
  await writeFile(join(f.root,'acme-other/2026-10-11.md'),original);
  const github=async r=>{
    if(r.path.includes('/contents/')){await rm(join(f.root,'docs/health'));await symlink('../acme-other',join(f.root,'docs/health'));}
    return f.github(r);
  };
  await assert.rejects(decideHygieneProposal({...f.args,github}),/health page changed/);
  assert.equal(await readFile(join(f.root,canonical),'utf8'),original);
  assert.equal(await readFile(join(f.root,'acme-other/2026-10-11.md'),'utf8'),original);assert.equal(f.posts,0);
});

test('canonical source freshness: legacy proposals accept CRLF bytes with the published filtered blob',async t=>{
  const f=await fixture(t),file=join(f.root,'src/acme.mjs');
  await writeFile(join(f.root,'.gitattributes'),'src/*.mjs text eol=crlf\n');
  git(f.root,'config','core.safecrlf','false');
  await writeFile(file,(await readFile(file,'utf8')).replaceAll('\n','\r\n'));
  assert.equal(git(f.root,'hash-object','--path=src/acme.mjs','src/acme.mjs'),f.proposal.blob);
  const result=await decideHygieneProposal(f.args);
  assert.equal(result.decision,'accepted');assert.equal(f.posts,1);
});
test('canonical source freshness: legacy raw blob cannot stand in for filtered Git identity',async t=>{
  const f=await fixture(t),file=join(f.root,'src/acme.mjs');
  await writeFile(join(f.root,'.gitattributes'),'src/*.mjs text eol=crlf\n');
  git(f.root,'config','core.safecrlf','false');
  await writeFile(file,(await readFile(file,'utf8')).replaceAll('\n','\r\n'));
  const rawBlob=git(f.root,'hash-object','--no-filters','src/acme.mjs');assert.notEqual(rawBlob,f.proposal.blob);
  const p=makeHygieneProposal({...f.proposal,blob:rawBlob,at});
  await writeFile(join(f.root,path),'## Proposal\n\n'+formatHygieneProposal(p));
  f.contents={status:200,data:{type:'file',path:p.file,sha:p.blob}};
  const result=await decideHygieneProposal({...f.args,expectedInstance:p.instanceId});
  assert.equal(result.state,'blocked');assert.match(result.reasons.join(' '),/stale/);assert.equal(f.posts,0);assert.equal(f.gets,0);
});

test('canonical source freshness: optional rawDigest round-trips without changing legacy records',async t=>{
  const f=await fixture(t),legacy=formatHygieneProposal(f.proposal),digest=createHash('sha256').update(await readFile(join(f.root,'src/acme.mjs'))).digest('hex');
  assert.deepEqual(parseHygieneProposal('## Proposal\n\n'+legacy).proposal,f.proposal);
  assert.equal(Object.hasOwn(f.proposal,'rawDigest'),false);
  const p=makeHygieneProposal({...f.proposal,rawDigest:digest,at});
  assert.equal(parseHygieneProposal('## Proposal\n\n'+formatHygieneProposal(p)).proposal.rawDigest,digest);
  assert.notEqual(p.instanceId,f.proposal.instanceId);assert.equal(p.subjectKey,f.proposal.subjectKey);
  for(const rawDigest of [null,'bad','f'.repeat(40),23])assert.throws(()=>makeHygieneProposal({...f.proposal,rawDigest}),/digest/);
  await writeFile(join(f.root,path),'## Proposal\n\n'+formatHygieneProposal(p));
  assert.equal((await decideHygieneProposal({...f.args,expectedInstance:p.instanceId})).decision,'accepted');assert.equal(f.posts,1);
});
test('canonical source freshness: rawDigest blocks changed bytes even when canonical blob stays equal',async t=>{
  const f=await fixture(t),file=join(f.root,'src/acme.mjs'),bytes=await readFile(file);
  await writeFile(join(f.root,'.gitattributes'),'src/*.mjs text eol=crlf\n');git(f.root,'config','core.safecrlf','false');
  const p=makeHygieneProposal({...f.proposal,rawDigest:createHash('sha256').update(bytes).digest('hex'),at});
  await writeFile(join(f.root,path),'## Proposal\n\n'+formatHygieneProposal(p));
  await writeFile(file,bytes.toString('utf8').replaceAll('\n','\r\n'));
  assert.equal(git(f.root,'hash-object','--path=src/acme.mjs','src/acme.mjs'),p.blob);
  const result=await decideHygieneProposal({...f.args,expectedInstance:p.instanceId});
  assert.equal(result.state,'blocked');assert.match(result.reasons.join(' '),/working-byte digest/);assert.equal(f.gets,0);assert.equal(f.posts,0);
});

test('configured health alias: history retains old proposals and board actions without coverage gaps',async t=>{
  const f=await fixture(t);await healthAlias(f);
  await symlink('../acme-health',join(f.root,'.plates/health'));
  await writeFile(join(f.root,'.plates/plates.json'),JSON.stringify({...f.config,health:'.plates/health'}));
  const configured='.plates/health/2026-10-11.md';
  await writeHealthReport({root:f.root,path:'.plates/health/2026-10-12.md',generated:'# Acme today\n\n## Proposal\n\nNone.\n'});
  const history=await readHygieneProposals({root:f.root});assert.deepEqual(history.gaps,[]);
  assert.equal(history.proposals.length,1);assert.equal(history.proposals[0].path,configured);assert.equal(history.proposals[0].instanceId,f.proposal.instanceId);
  assert.deepEqual((await readHygieneProposals({root:f.root,healthDir:'acme-health'})).gaps,[]);
  const deps={looseEnds:async()=>({projects:[]}),reviews:async()=>({items:[]}),robotStatus:async()=>({policy:{enabled:false},budget:{state:'off'}}),today:'2026-10-12'};
  const data=await board({root:f.root},deps),item=data.items.find(i=>i.instanceId===f.proposal.instanceId);
  assert.ok(item);assert.deepEqual(item.actions[0].args,['--proposal',configured,'--instance',f.proposal.instanceId,'--accept']);
  assert.equal(data.sources.find(s=>s.source==='health').state,'ok');
});
test('configured health alias: history rejects alternate aliases, escaping directories and symlink pages',async t=>{
  const f=await fixture(t),canonical=await healthAlias(f),page=await readFile(join(f.root,canonical),'utf8');
  await symlink('acme-health',join(f.root,'other-health'));
  assert.match((await readHygieneProposals({root:f.root,healthDir:'other-health'})).gaps.join(' '),/configured health directory/);
  await rm(join(f.root,canonical));await writeFile(join(f.root,'owner.md'),page);await symlink('../owner.md',join(f.root,canonical));
  let result=await readHygieneProposals({root:f.root});assert.equal(result.proposals.length,0);assert.match(result.gaps.join(' '),/unsafe/);
  const outside=await mkdtemp(join(tmpdir(),'acme-history-outside-'));t.after(()=>rm(outside,{recursive:true,force:true}));
  await writeFile(join(outside,'2026-10-11.md'),page);await rm(join(f.root,'docs/health'));await symlink(outside,join(f.root,'docs/health'));
  result=await readHygieneProposals({root:f.root});assert.equal(result.proposals.length,0);assert.match(result.gaps.join(' '),/outside project/);
  await writeFile(join(f.root,'.plates/plates.json'),JSON.stringify({...f.config,health:'docs/health/missing'}));
  assert.match((await readHygieneProposals({root:f.root})).gaps.join(' '),/outside project/);
});
test('configured health alias: history preserves page, count and total read bounds',async t=>{
  const f=await fixture(t);await healthAlias(f);
  await writeFile(join(f.root,path),'x'.repeat(1024*1024+1));
  assert.match((await readHygieneProposals({root:f.root})).gaps.join(' '),/oversized/);
  await rm(join(f.root,path));
  for(let i=1;i<=9;i++)await writeFile(join(f.root,'acme-health',`2026-11-${String(i).padStart(2,'0')}.md`),'x'.repeat(1024*1024));
  assert.match((await readHygieneProposals({root:f.root})).gaps.join(' '),/8 MiB/);
  await Promise.all(Array.from({length:367},(_,i)=>writeFile(join(f.root,'acme-health',new Date(Date.UTC(2028,0,i+1)).toISOString().slice(0,10)+'.md'),'')));
  assert.match((await readHygieneProposals({root:f.root})).gaps.join(' '),/truncated at 366/);
});
test('configured health alias: ordinary walk decide accepts and declines through the configured alias',async t=>{
  for(const decision of ['accept','decline'])await t.test(decision,async t=>{
    const f=await fixture(t),canonical=await healthAlias(f);
    await writeFile(join(f.root,canonical),'# Acme health\n\n## Proposal\n\n**`drafts_waiting`** Finish Acme draft\n\n## Owner notes\n\nAcme keep this.\n');
    const result=await walkDecide({root:f.root,proposal:path,[decision]:'Acme choice'});
    assert.equal(result.data.decision,decision==='accept'?'accepted':'declined');
    const saved=await readFile(join(f.root,canonical),'utf8');assert.match(saved,/Acme choice/);assert.match(saved,/Acme keep this/);
    assert.ok((await lstat(join(f.root,'docs/health'))).isSymbolicLink());
    await writeHealthReport({root:f.root,path,generated:'# Acme refreshed\n\n## Proposal\n\n**`drafts_waiting`** New advice\n'});
    assert.match(await readFile(join(f.root,canonical),'utf8'),/Acme choice/);assert.equal(f.gets,0);
  });
});
test('configured health alias: ordinary walk decide refuses escaping directories and page symlinks',async t=>{
  const f=await fixture(t),canonical=await healthAlias(f),text='## Proposal\n\n**`drafts_waiting`** Acme advice\n';
  const outside=await mkdtemp(join(tmpdir(),'acme-ordinary-outside-'));t.after(()=>rm(outside,{recursive:true,force:true}));
  await writeFile(join(outside,'2026-10-11.md'),text);await rm(join(f.root,'docs/health'));await symlink(outside,join(f.root,'docs/health'));
  await assert.rejects(walkDecide({root:f.root,proposal:path,accept:''}),/outside project/);
  assert.equal(await readFile(join(outside,'2026-10-11.md'),'utf8'),text);
  await rm(join(f.root,'docs/health'));await symlink('../acme-health',join(f.root,'docs/health'));
  await writeFile(join(f.root,'owner.md'),text);await rm(join(f.root,canonical));await symlink('../owner.md',join(f.root,canonical));
  await assert.rejects(walkDecide({root:f.root,proposal:path,decline:'Acme keep'}),/symlink/);
  assert.equal(await readFile(join(f.root,'owner.md'),'utf8'),text);
});

test('ordinary proposal paths: non-health regular files remain decidable while other aliases are refused',async t=>{
  const f=await fixture(t),text='## Proposal\n\n**`legacy`** Acme advice\n\n## Notes\nAcme owner text.\n';
  for(const [file,decision] of [['proposal.md','accept'],['docs/acme-proposal.md','decline']]){
    await writeFile(join(f.root,file),text);
    const result=await walkDecide({root:f.root,proposal:file,[decision]:'Acme decision'});
    assert.equal(result.data.decision,decision==='accept'?'accepted':'declined');
    const saved=await readFile(join(f.root,file),'utf8');assert.match(saved,/Acme decision/);assert.match(saved,/Acme owner text/);
  }
  await writeFile(join(f.root,'owner-proposal.md'),text);
  await symlink('owner-proposal.md',join(f.root,'aliased-proposal.md'));
  await assert.rejects(walkDecide({root:f.root,proposal:'aliased-proposal.md',accept:''}),/configured health page/);
  await symlink('docs',join(f.root,'aliased-docs'));
  await assert.rejects(walkDecide({root:f.root,proposal:'aliased-docs/acme-proposal.md',decline:'Acme keep'}),/configured health page/);
  assert.equal(await readFile(join(f.root,'owner-proposal.md'),'utf8'),text);assert.equal(f.gets,0);
});

// Intercept the actual filesystem boundary, preserving the real read and its
// bytes. This also exercises the unfixed implementation during plates prove.
function afterOrdinaryPageRead(t,paths,change) {
  const original=fsPromises.readFile,seen=[];
  t.mock.method(fsPromises,'readFile',async(...args)=>{
    const bytes=await original(...args);
    if(paths.includes(String(args[0]))&&seen.length===0){seen.push(String(args[0]));await change();}
    return bytes;
  });
  syncBuiltinESMExports();
  t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
  return seen;
}
test('ordinary canonical snapshot: retarget after reading cannot overwrite either health page',async t=>{
  const f=await fixture(t),canonical=await healthAlias(f),canonicalAbs=await fsPromises.realpath(join(f.root,canonical));
  const original='## Proposal\n\n**`legacy`** Acme original proposal\n',other='## Proposal\n\n**`legacy`** Acme different proposal\n\nAcme human notes.\n';
  await writeFile(canonicalAbs,original);await mkdir(join(f.root,'acme-other'));
  const otherFile=join(f.root,'acme-other/2026-10-11.md');await writeFile(otherFile,other);
  const seen=afterOrdinaryPageRead(t,[canonicalAbs,join(f.root,path)],async()=>{
    await rm(join(f.root,'docs/health'));await symlink('../acme-other',join(f.root,'docs/health'));
  });
  await assert.rejects(walkDecide({root:f.root,proposal:path,accept:'Acme approved'}),/page changed/);
  assert.deepEqual(seen,[canonicalAbs],'resolve the canonical page before the first content read');
  assert.equal(await readFile(canonicalAbs,'utf8'),original);assert.equal(await readFile(otherFile,'utf8'),other);
});
test('ordinary canonical snapshot: a concurrent edit is preserved instead of overwritten',async t=>{
  const f=await fixture(t),canonical=await healthAlias(f),canonicalAbs=await fsPromises.realpath(join(f.root,canonical));
  const original='## Proposal\n\n**`legacy`** Acme proposal\n',edited=original+'\nAcme owner added context.\n';
  await writeFile(canonicalAbs,original);
  const seen=afterOrdinaryPageRead(t,[canonicalAbs,join(f.root,path)],()=>writeFile(canonicalAbs,edited));
  await assert.rejects(walkDecide({root:f.root,proposal:path,decline:'Acme keep'}),/page changed/);
  assert.deepEqual(seen,[canonicalAbs]);assert.equal(await readFile(canonicalAbs,'utf8'),edited);
});
test('ordinary canonical snapshot: non-health regular page edits are protected too',async t=>{
  const f=await fixture(t),file=join(f.root,'acme-proposal.md'),original='## Proposal\n\nAcme plan\n';await writeFile(file,original);
  const canonicalAbs=await fsPromises.realpath(file),edited=original+'\nAcme additional evidence.\n';
  const seen=afterOrdinaryPageRead(t,[canonicalAbs,file],()=>writeFile(canonicalAbs,edited));
  await assert.rejects(walkDecide({root:f.root,proposal:'acme-proposal.md',accept:''}),/page changed/);
  assert.equal(seen.length,1);assert.equal(await readFile(canonicalAbs,'utf8'),edited);
});
test('ordinary canonical diff: alias acceptance and decline report the tracked target changes',async t=>{
  for(const decision of ['accept','decline'])await t.test(decision,async t=>{
    const f=await fixture(t),canonical=await healthAlias(f);
    await writeFile(join(f.root,canonical),'## Proposal\n\n**`legacy`** Acme plan\n');
    git(f.root,'add','-A');git(f.root,'commit','-qm','Acme tracked health alias');
    const result=await walkDecide({root:f.root,proposal:path,[decision]:'Acme owner choice'});
    assert.equal(result.data.proposal,path,'retain the requested path for display');
    assert.match(result.data.diff,/diff --git a\/acme-health\/2026-10-11\.md b\/acme-health\/2026-10-11\.md/);
    assert.match(result.data.diff,/\+\*\*Decided .*Acme owner choice/);
    assert.match(await readFile(join(f.root,canonical),'utf8'),/Acme owner choice/);
    assert.equal(f.gets,0);
  });
});

test('hygiene current-first sections preserve original offsets and each fallback fails both one-name mutations', async t => {
  const { markerMutant } = await import('./helpers/names.mjs');
  const consumer = new URL('../practices/night/files/scripts/plates/hygiene-proposals.mjs', import.meta.url);
  const f = await fixture(t);
  const current = formatHygieneProposal(f.proposal);
  const old = current.replaceAll('plates:hygiene-proposal:v1', 'keel:hygiene-proposal:v1').replaceAll('plates:hygiene-data', 'keel:hygiene-data');
  for (const blocks of [current, old, old + '\n' + current, current + '\n' + old]) {
    const body = '## Proposal\n\n' + blocks;
    const result = parseHygieneProposal(body);
    assert.deepEqual(result.proposal, f.proposal, JSON.stringify(result.problems));
    assert.equal(body.slice(result.start, result.end), blocks.includes(current) ? current : old);
  }
  assert.ok(parseHygieneProposal('## Proposal\n\n' + old + '\n' + current.replace('Split long source file', 'Invalid display')).problems.length);
  for (const family of ['hygiene-proposal:v1', 'hygiene-data']) for (const namespace of ['plates', 'keel']) {
    const body = '## Proposal\n\n' + (namespace === 'plates' ? current : old);
    const mutant = await markerMutant(consumer, `marker:keel:${family}`, `${namespace}:${family}`);
    assert.equal(mutant.parseHygieneProposal(body).proposal, null, `${namespace}:${family}`);
  }
});
