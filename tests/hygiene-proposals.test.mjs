import './helpers/hermetic.mjs';
import {test} from 'node:test';
import {run} from './helpers/run.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir,hostname} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {makeHygieneProposal,formatHygieneProposal,parseHygieneProposal,readHygieneProposals,hygieneRobotTargetReason} from '../practices/night/files/scripts/keel/hygiene-proposals.mjs';
import {writeHealthReport} from '../practices/night/files/scripts/keel/time-proposals.mjs';
import {decideHygieneProposal} from '../lib/hygiene-proposal-actions.mjs';
import {walkDecide,proposalOf,board} from '../lib/board.mjs';
const repo='acme/anvils',path='docs/health/2026-10-11.md',at='2026-10-11T12:00:00Z';
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
async function fixture(t,{robot={on:true,budgetMinutes:60}}={}) {
  const root=await mkdtemp(join(tmpdir(),'acme-hygiene-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'.keel'));await mkdir(join(root,'src'));
  const config={repo,robot};await writeFile(join(root,'.keel/keel.json'),JSON.stringify(config));
  await writeFile(join(root,'src/acme.mjs'),'export function acme() {\n'+Array.from({length:1500},()=> '  // Acme responsibility').join('\n')+'\n}\n');
  git(root,'init','-q','-b','main');git(root,'add','.');git(root,'commit','-qm','Acme source');
  const blob=git(root,'hash-object','src/acme.mjs');
  const proposal=makeHygieneProposal({repo,file:'src/acme.mjs',blob,lines:1502,sections:[{name:'acme',start:1,end:1502}],at});
  await writeHealthReport({root,path,generated:'# Acme health\n\n## Proposal\n\n'+formatHygieneProposal(proposal)});
  await writeFile(join(root,path),(await readFile(join(root,path),'utf8'))+'\n\n## Owner notes\n\nAcme human content.\n');
  let issue=null,posts=0,fail=false,gets=0;
  const github=async r=>{
    assert.ok(r.path.startsWith('/repos/acme/anvils/'));
    if(r.method==='POST'){
      posts++;assert.equal(parseHygieneProposal(await readFile(join(root,path),'utf8')).proposal.lifecycle.state,'accepting');
      issue={number:7,state:'open',body:r.body.body,labels:r.body.labels,html_url:`https://github.com/${repo}/issues/7`,url:`https://api.github.com/repos/${repo}/issues/7`};
      if(fail)throw Error('Acme lost response');return {status:201,data:issue};
    }
    gets++;if(fail&&issue)return {status:503};
    if(r.path.includes('/issues?'))return {status:200,data:issue?[issue]:[]};
    if(r.path.endsWith('/issues/7'))return {status:200,data:issue};
    throw Error('unexpected synthetic endpoint');
  };
  return {root,config,proposal,github,args:{root,path,expectedInstance:proposal.instanceId,decision:'accept',at,github},get issue(){return issue;},get posts(){return posts;},get gets(){return gets;},set fail(v){fail=v;}};
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
  await writeFile(join(f.root,'src/acme.mjs'),'// Acme changed after POST\n');await writeFile(join(f.root,'.keel/keel.json'),JSON.stringify({...f.config,robot:{on:false}}));
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
  await writeFile(join(f.root,'.keel/lock.json'),JSON.stringify({files:{'src/acme.mjs':{kind:'managed'}}}));assert.match((await decideHygieneProposal(f.args)).reasons.join(' '),/managed/);await rm(join(f.root,'.keel/lock.json'));
  await writeFile(join(f.root,'owner.mjs'),await readFile(join(f.root,'src/acme.mjs')));await rm(join(f.root,'src/acme.mjs'));await symlink('../owner.mjs',join(f.root,'src/acme.mjs'));
  assert.match((await decideHygieneProposal(f.args)).reasons.join(' '),/symlink/);assert.equal(f.posts,0);
});
test('robot-protected and canonical practice sources remain owner work',()=>{
  for(const file of ['scripts/keel/improve.mjs','.github/acme.mjs','.keel/acme.mjs','practices/night/files/scripts/keel/improve.mjs','.agents/acme.mjs']){
    assert.ok(hygieneRobotTargetReason(file));assert.throws(()=>makeHygieneProposal({repo,file,blob:'a'.repeat(40),lines:1600}),/owner-led/);
  }
});
test('current threshold and source-derived sections reject fabricated candidate facts',async t=>{
  const f=await fixture(t);
  await writeFile(join(f.root,'.keel/keel.json'),JSON.stringify({...f.config,hygiene:{longFileLines:2000}}));
  assert.match((await decideHygieneProposal(f.args)).reasons.join(' '),/threshold/);
  await writeFile(join(f.root,'.keel/keel.json'),JSON.stringify(f.config));
  const fabricated=makeHygieneProposal({...f.proposal,sections:[{name:'fake',start:2,end:100}],at});
  await writeFile(join(f.root,path),'## Proposal\n\n'+formatHygieneProposal(fabricated));
  assert.match((await decideHygieneProposal(f.args)).reasons.join(' '),/split hints/);assert.equal(f.posts,0);
});
test('uncertain empty recovery preserves intent and never retries a POST',async t=>{
  const f=await fixture(t);let posts=0;
  const github=async r=>{if(r.method==='POST'){posts++;throw Error('Acme transport uncertain');}return {status:200,data:[]};};
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
  const dir=join(f.root,'.keel/robot-issues',hash(repo)),subject=join(dir,'subject-'+hash(f.proposal.subjectKey)+'.json');
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
  await writeFile(state,JSON.stringify({posts:0,issue:null}));
  await writeFile(gh,`#!${process.execPath}
const fs=require('node:fs'),args=process.argv.slice(2),i=args.indexOf('--method'),method=args[i+1],path=args[i+2];
if(i<0||!path.startsWith('/repos/acme/anvils/'))throw Error('unexpected synthetic API');
const file=${JSON.stringify(state)},s=JSON.parse(fs.readFileSync(file,'utf8'));let status=200,data;
if(method==='POST'){
  if(!fs.readFileSync(${JSON.stringify(join(f.root,path))},'utf8').includes('"state":"accepting"'))throw Error('missing local intent');
  const b=JSON.parse(fs.readFileSync(0,'utf8'));s.posts++;s.issue={number:7,state:'open',body:b.body,labels:b.labels,html_url:'https://github.com/acme/anvils/issues/7',url:'https://api.github.com/repos/acme/anvils/issues/7'};status=201;data=s.issue;
}else if(method==='GET')data=path.includes('/issues?')?(s.issue?[s.issue]:[]):s.issue;
else throw Error('unsupported synthetic method');
fs.writeFileSync(file,JSON.stringify(s));process.stdout.write('HTTP/2.0 '+status+' OK\\r\\nContent-Type: application/json\\r\\n\\r\\n'+JSON.stringify(data));
`);await chmod(gh,0o755);
  const cli=new URL('../bin/keel.mjs',import.meta.url).pathname;
  const invoke=extra=>run(process.execPath,[cli,'walk','decide','--proposal',path,...extra,'--json'],{cwd:f.root,env:{...process.env,KEEL_GH:gh}});
  assert.notEqual(invoke(['--accept']).status,0);
  for(let i=0;i<2;i++){
    const result=invoke(['--instance',f.proposal.instanceId,'--accept']);assert.equal(result.status,0,result.stderr+result.stdout);
    const data=JSON.parse(result.stdout);assert.equal(data.decision,'accepted');assert.equal(data.instanceId,f.proposal.instanceId);
  }
  assert.equal(JSON.parse(await readFile(state,'utf8')).posts,1);
});
test('acceptance shares generated-header semantics with measurement, not literals inside source',async t=>{
  const f=await fixture(t),file=join(f.root,'src/acme.mjs');
  await writeFile(file,(await readFile(file,'utf8')).replace('  // Acme responsibility','  const warning = "@generated DO NOT EDIT";'));
  const p=makeHygieneProposal({...f.proposal,blob:git(f.root,'hash-object','src/acme.mjs'),at});
  await writeFile(join(f.root,path),'## Proposal\n\n'+formatHygieneProposal(p));
  assert.equal((await decideHygieneProposal({...f.args,expectedInstance:p.instanceId})).decision,'accepted');
  const g=await fixture(t),gfile=join(g.root,'src/acme.mjs');
  await writeFile(gfile,'// @generated\n'+await readFile(gfile,'utf8'));
  assert.match((await decideHygieneProposal(g.args)).reasons.join(' '),/generated source/);assert.equal(g.posts,0);
});
