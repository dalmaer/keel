import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from './helpers/run.mjs';
import { SHA, NOW, source, observation, results, readFixture } from './helpers/verification.mjs';
import { recoverNightVerification, observeVerification, verificationReceipt, parseVerifications, formatVerification, verificationGit } from '../scripts/plates/verification.mjs';
import { improve, MEASURES } from '../scripts/plates/improve.mjs';
import { writeHealthReport, rewriteHealthBody } from '../scripts/plates/time-proposals.mjs';
import { isData } from '../scripts/plates/drain.mjs';
import { withPlanSection } from '../scripts/plates/morning.mjs';

async function scratch(t) {
  const root=await mkdtemp(join(tmpdir(),'acme-verification-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'.plates'));
  await mkdir(join(root,'docs/health'),{recursive:true});
  return root;
}

test('producer binds identity and preserves ended claims, all PR ownership and unknown activity', async()=>{
  const calls=[];
  const read=readFixture({
    'repos/acme/plate/git/matching-refs/heads/claims/phase-?per_page=100':[{ref:'refs/heads/claims/phase-7',object:{sha:SHA}}],
    'repos/acme/plate/pulls?state=open&per_page=100':[{number:1,state:'open',head:{ref:'codex/phase-7'}},{number:2,state:'open',head:{ref:'claude/phase-7'}},{number:3,state:'open',head:{ref:'codex/phase-8'}}],
    [`repos/acme/plate/contents/docs/phases?ref=${SHA}`]:[{name:'07-acme.md'}],
    [`repos/acme/plate/contents/docs/phases/07-acme.md?ref=${SHA}`]:{encoding:'base64',content:Buffer.from('---\nstatus: built\n---\n').toString('base64')},
    [`repos/acme/plate/commits/${SHA}`]:{commit:{committer:{date:'2026-10-01T00:00:00Z'}}},
  },calls);
  const o=await observeVerification({root:'.',config:{repo:'acme/plate'},now:NOW,read,git:async()=>source});
  assert.deepEqual(o.remote,{branch:'trunk',sha:SHA});
  assert.equal(o.claims[0].status,'built');
  assert.deepEqual(o.claims[0].prs,[1,2]);
  assert.deepEqual(o.claims[0].findings,['completed-phase-leftover','explicit-and-open-pr-ownership','duplicate-open-pr-ownership','old-claim-observation']);
  assert.equal(o.claims[0].activity,'unknown');
  assert.deepEqual(o.claims[1].findings,['open-pr-ownership']);
  assert.ok(calls.filter(c=>c.includes('/contents/')).every(c=>c.endsWith(`ref=${SHA}`)));
});

test('bounded or malformed API pages, failed permissions and future claim times stay gaps',async()=>{
  for(const data of [[null],Array(100).fill({ref:'refs/heads/claims/phase-7',object:{sha:SHA}}),{},[{ref:'bad'}],new Error('403')]) {
    const o=await observeVerification({root:'.',config:{repo:'acme/plate'},now:NOW,git:async()=>source,read:readFixture({'repos/acme/plate/git/matching-refs/heads/claims/phase-?per_page=100':data})});
    assert.ok(o.gaps.length);
  }
  const o=await observeVerification({root:'.',config:{repo:'acme/plate'},now:NOW,git:async()=>source,read:readFixture({'repos/acme/plate/pulls?state=open&per_page=100':[{}]})});
  assert.ok(o.gaps.includes('open PRs incomplete or capped'));
  for (const phaseSource of [undefined,'milestones']) {
    const current=await observeVerification({root:'.',config:{repo:'acme/plate',phases:{source:phaseSource}},now:NOW,git:async()=>source,read:readFixture({
      'repos/acme/plate/git/matching-refs/heads/claims/phase-?per_page=100':[{ref:'refs/heads/claims/phase-7',object:{sha:SHA}}],
      [`repos/acme/plate/commits/${SHA}`]:{commit:{committer:{date:'2027-01-01T00:00:00Z'}}},
      [`repos/acme/plate/contents/docs/phases?ref=${SHA}`]:[],
    })});
    assert.equal(current.claims[0].lastObservedAt,null);
    assert.ok(current.gaps.includes('phase 7 last observation unavailable'));
    assert.ok(current.gaps.includes('phase 7 status unavailable'));
    if(phaseSource)assert.ok(current.gaps.includes('milestone phase acceptance unavailable'));
  }

});

test('receipt attributes reuse, does not turn missing reconciliation or changing checkout into success',()=>{
  const rs=results();rs[0].facts={reused:true,status:0,sha:SHA,workflow:'check',completedAt:NOW};
  assert.equal(verificationReceipt(observation(),rs).gate.source,'reused-ci');
  const r=verificationReceipt(observation(),rs.slice(0,1),{sha:'b'.repeat(40),dirty:true});
  assert.ok(r.gaps.includes('reconciliation coverage unavailable'));
  assert.ok(r.gaps.includes('checkout changed during measurement'));
});

test('same-day failed and passing attempts survive writer and morning body finalization',async t=>{
  const root=await scratch(t),path='docs/health/2026-10-23.md';
  const a=verificationReceipt(observation(),[{id:'gate',state:'outside',facts:{source:'local-command',status:1}}]);
  const b=verificationReceipt(observation(),results());b.observedAt='2026-10-23T12:01:00.000Z';
  const page=r=>`# Acme\n\n## Tonight's plan\n\nPending.\n\n## Verification\n\n${formatVerification(r)}\n`;
  await writeHealthReport({root,path,generated:page(a)});
  await writeHealthReport({root,path,generated:page(b)});
  const before=await readFile(join(root,path),'utf8');
  assert.equal(isData(path,'keel-night/'),true);
  assert.equal(run('git',['init'],{cwd:root}).status,0);
  assert.equal(run('git',['add','--',path],{cwd:root}).status,0);
  assert.equal(parseVerifications(run('git',['show',`:${path}`],{cwd:root}).stdout).length,2);
  assert.deepEqual(new Set(parseVerifications(before).map(r=>r.attempt)),new Set([a.attempt,b.attempt]));
  const after=rewriteHealthBody(before,body=>withPlanSection(body,["## Tonight's plan",'','Finished.','']));
  await writeFile(join(root,path),after);
  assert.equal(parseVerifications(after).length,2);
  const c=verificationReceipt(observation(),results());
  await writeHealthReport({root,path,generated:page(c)});
  assert.equal(parseVerifications(await readFile(join(root,path),'utf8')).length,3);
});

test('real improve report runs gate once, snapshots before mutation, and adds only home fleet instrument',async t=>{
  const root=await scratch(t);
  const config={repo:'acme/plate',practices:[],plates:'self',check:`${process.execPath} -e "require('fs').appendFileSync('gate-count','x'); console.log('# tests 1')"`};
  await writeFile(join(root,'.plates/plates.json'),JSON.stringify(config));
  assert.equal(run('git',['init'],{cwd:root}).status,0);
  assert.equal(run('git',['add','.'],{cwd:root}).status,0);
  assert.equal(run('git',['commit','-m','Acme'],{cwd:root}).status,0);
  let fleet=0;
  const deps={measures:MEASURES.filter(m=>m.id==='gate'),verificationRead:readFixture(),plates:{fleetVerification:async()=>{fleet++;return {rows:[{repo:'acme/other',verification:{state:'missing',reason:'not adopted'}}],gaps:[]};}}};
  const result=await improve({root,report:true,date:'2026-10-23'},deps);
  assert.equal(await readFile(join(root,'gate-count'),'utf8'),'x');
  assert.equal(result.data.verification.source.dirty,false);
  assert.ok(result.data.verification.gaps.includes('checkout changed during measurement'));
  assert.ok(result.data.verification.gaps.includes('reconciliation coverage unavailable'));
  assert.equal(result.exitCode,0);
  assert.equal(fleet,1);
  assert.match(await readFile(join(root,result.data.report),'utf8'),/acme\/other: missing/);
  delete config.plates;await writeFile(join(root,'.plates/plates.json'),JSON.stringify(config));
  await improve({root}, {...deps,measures:[]});
  assert.equal(fleet,1,'adopter never invokes fleet reader');
  assert.equal((await verificationGit({root})).dirty,true);
});


test('PR-only owners are grouped and ended/unknown phase records cannot look healthy',async()=>{
  for (const [status,owes,finding] of [['built',null,'completed-phase-open-pr'],['partial','walk','completed-phase-open-pr'],['invented',null,null],['partial',null,null]]) {
    const o=await observeVerification({root:'.',config:{repo:'acme/plate'},now:NOW,git:async()=>source,read:readFixture({
      'repos/acme/plate/pulls?state=open&per_page=100':[{number:1,state:'open',head:{ref:'codex/phase-7'}},{number:2,state:'open',head:{ref:'claude/phase-7'}}],
      [`repos/acme/plate/contents/docs/phases?ref=${SHA}`]:[{name:'07-acme.md'}],
      [`repos/acme/plate/contents/docs/phases/07-acme.md?ref=${SHA}`]:{encoding:'base64',content:Buffer.from(`---\nstatus: ${status}\nowes: ${owes ?? ''}\n---\n`).toString('base64')},
    })});
    assert.equal(o.claims.length,1);assert.deepEqual(o.claims[0].prs,[1,2]);
    assert.ok(o.claims[0].findings.includes('duplicate-open-pr-ownership'));
    if(finding)assert.ok(o.claims[0].findings.includes(finding));
    if(status==='invented')assert.ok(o.gaps.includes('phase 7 status unavailable'));
  }
});

test('two fresh night checkouts retain an unmerged failing attempt and lease publication refuses stale writers',async t=>{
  const seed=await scratch(t),date='2026-10-23',path=`docs/health/${date}.md`;
  const config={repo:'acme/plate',practices:[]};
  await writeFile(join(seed,'.plates/plates.json'),JSON.stringify(config));
  const git=(root,args)=>{const r=run('git',args,{cwd:root});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  git(seed,['init','-b','main']);git(seed,['add','.plates']);git(seed,['commit','-m','Acme']);
  const origin=join(seed,'origin.git');git(seed,['init','--bare',origin]);git(seed,['remote','add','origin',origin]);git(seed,['push','origin','main']);
  const workflow=await readFile(new URL('../practices/night/files/.github/workflows/plates-night.yml',import.meta.url),'utf8');
  const push=workflow.split('\n').find(l=>l.trim().startsWith('git push --force-with-lease='));
  assert.ok(push);assert.match(workflow,/PLATES_NIGHT_RECOVERY: "1"/);
  const attempts=[],clones=[];
  for(let i=0;i<2;i++){
    const root=join(seed,`checkout-${i}`);git(seed,['clone','--branch','main',origin,root]);clones.push(root);
    const result=await improve({root,report:true,date},{env:{...process.env,PLATES_NIGHT_RECOVERY:'1'},verificationRead:readFixture(),verificationSource:async()=>source,
      measures:[{id:'gate',what:'Acme gate',unit:'0/1',bound:0,better:'lower',run:async()=>({value:i===0?1:0,facts:{source:'local-command',status:i===0?1:0}})}]});
    attempts.push(result.data.verification.attempt);
    assert.equal(result.data.nightRecovery.attempts,i);
    const page=await readFile(join(root,path),'utf8');assert.equal(parseVerifications(page).length,i+1);
    git(root,['checkout','-b',`keel-night/${date}`]);git(root,['add','--',path,'.plates/bounds.json']);git(root,['commit','-m',`Acme attempt ${i}`]);
    const pushed=run('bash',['-e','-c',push],{cwd:root,env:{...process.env,DAY:date,EXPECTED:result.data.nightRecovery.head}});assert.equal(pushed.status,0,pushed.stderr);
  }
  const retained=await recoverNightVerification({root:clones[1],config,date});
  assert.deepEqual(new Set(parseVerifications(retained.report).map(r=>r.attempt)),new Set(attempts));
  const old=git(clones[0],['rev-parse','HEAD']);
  const refused=run('bash',['-e','-c',push],{cwd:clones[0],env:{...process.env,DAY:date,EXPECTED:old}});assert.notEqual(refused.status,0,'an advanced remote branch cannot be blindly overwritten');
  const fresh=join(seed,'conflict');git(seed,['clone','--branch','main',origin,fresh]);await mkdir(join(fresh,'docs/health'),{recursive:true});
  await writeFile(join(fresh,path),'Acme owner text\n');
  await assert.rejects(writeHealthReport({root:fresh,path,generated:'new',recovered:retained.report}),/differ/);
  assert.equal(await readFile(join(fresh,path),'utf8'),'Acme owner text\n');
});
