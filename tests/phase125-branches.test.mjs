import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './helpers/run.mjs';
import { plan as drain, isData, extraData } from '../practices/night/files/scripts/plates/drain.mjs';
import { selectNightPlan, readRemoteNightPlan, readApiNightPlan, validatePlan } from '../practices/night/files/scripts/plates/night-plan.mjs';
import { finalPlan, finalBranchOf, readVerify, healthAround } from '../practices/night/files/scripts/plates/morning.mjs';
import { recoverNightVerification } from '../practices/night/files/scripts/plates/verification.mjs';
import { waitingJobs } from '../scripts/plates/climb.mjs';
import { climbRetiring } from '../practices/night/files/scripts/plates/lib.mjs';
import { tendRetiring } from '../scripts/plates/tend.mjs';
import { robotPulls } from '../practices/night/files/scripts/plates/robot-delivery.mjs';
import { robotIssueOf, writeName } from '../lib/names.mjs';
const date='2026-10-24';
const plan=()=>({schema:1,date,shapedBy:'owner',readyBy:null,willNotTouch:[],settledToday:[],leftOpen:[],items:[]});
const git=(cwd,...args)=>{const r=run('git',args,{cwd});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
async function repository(t) {
  const root=await mkdtemp(join(tmpdir(),'plates125-acme-')); t.after(()=>rm(root,{recursive:true,force:true}));
  const origin=join(root,'origin.git'); git(root,'init','--bare','-q','-b','main',origin);
  const work=join(root,'work');await mkdir(work);git(work,'init','-q','-b','main');git(work,'remote','add','origin',origin);
  await writeFile(join(work,'Acme.txt'),'Acme');git(work,'add','.');git(work,'commit','-qm','Acme base');git(work,'push','-q','origin','main');
  async function publish(branch,path,body) {
    git(work,'checkout','-q','-B',branch,'main');await mkdir(join(work,path,'..'),{recursive:true});await writeFile(join(work,path),body);
    git(work,'add','-f',path);git(work,'commit','-qm','Acme record');git(work,'push','-q','--force','origin',branch);git(work,'checkout','-q','main');
  }
  return {root:work,origin,publish};
}
for (const family of ['night','loop']) test(`mixed ${family} prefixes drain as one queue`,()=>{
  const file=family==='night'?`docs/health/${date}.md`:`docs/loop/${date}.md`;
  const prs=['keel','plates'].map((name,i)=>({number:i+1,headRefName:`${name}-${family}/${date}`,createdAt:`2026-10-${20+i}T00:00:00Z`,mergeable:'MERGEABLE',files:[{path:file}],isCrossRepository:false}));
  for(const prefix of [`plates-${family}/`,`keel-${family}/`]) {
    const result=drain(prs,prefix,{gatePassed:true});assert.deepEqual(result.actions.map(a=>[a.number,a.action]),[[1,'merge'],[2,'merge']]);assert.equal(result.newest,2);
    assert.equal(isData(file,prefix),true);assert.equal(isData('docs/phases/125.md',prefix),false);
  }
  assert.deepEqual(drain(prs.map(p=>({...p,isCrossRepository:true})),`plates-${family}/`).queue,[]);
  assert.deepEqual(drain(prs,'owner-night/').queue,[]);
  if(family==='loop')for(const prefix of ['keel-loop/','plates-loop/'])assert.deepEqual(extraData({loop:{afterRenderWrites:['docs/INDEX.md']}},prefix),['docs/INDEX.md']);
});
test('two plans for one night: plates wins, and says so',()=>{
  const candidates=['plates','keel'].map(name=>({branch:`${name}-night-plan`,path:`.${name}/night/plan.json`,text:JSON.stringify({...plan(),settledToday:[name]})}));
  const selected=selectNightPlan(candidates,date);assert.equal(selected.branch,'plates-night-plan');assert.deepEqual(selected.plan.settledToday,['plates']);assert.deepEqual(selected.skipped,['keel-night-plan:.keel/night/plan.json']);assert.match(selected.plan.leftOpen.join(' '),/skipped keel-night-plan/);assert.equal(validatePlan(selected.plan).ok,true);
  for(const candidate of candidates)assert.equal(selectNightPlan([candidate],date).branch,candidate.branch);
  candidates[0].text=JSON.stringify({...plan(),date:'2026-10-23'});assert.equal(selectNightPlan(candidates,date).branch,'keel-night-plan');
});
for(const name of ['plates','keel'])test(`remote ${name} plan, morning record, verification and original final branch`,async t=>{
  const repo=await repository(t);const branch=`${name}-night/${date}`;
  await repo.publish(`${name}-night-plan`,`.${name}/night/plan.json`,JSON.stringify(plan()));
  assert.equal(readRemoteNightPlan({...repo,date}).branch,`${name}-night-plan`);
  const planOnly=await finalPlan({...repo,date});assert.equal(planOnly.plan?.date,date);
  await repo.publish(branch,`docs/health/${date}.md`,'# Acme health\n');
  const recovered=await recoverNightVerification({...repo,date,config:{repo:'acme/project'}});assert.equal(recovered.branch,branch);assert.match(recovered.head,/^[a-f0-9]{40}$/);
  assert.equal(finalBranchOf(date,branch),`${branch}-final`);
  await repo.publish(branch,`docs/night/${date}.json`,JSON.stringify(plan()));
  const found=await finalPlan({...repo,date});assert.equal(found.branch,branch);assert.equal(found.plan.date,date);
});
test('verify history across both branches is sorted by actual time, preserving each site',async t=>{
  const repo=await repository(t), result=(ok,at,site='https://acme.test')=>({sha:'a'.repeat(40),ok,at,site,failures:ok?[]:['Acme failure']});
  const failed=result(false,'2026-10-24T07:00:00Z'),passed=result(true,'2026-10-24T08:00:00Z');
  await repo.publish('keel-verify','verify.json',JSON.stringify({results:[failed]}));assert.equal(readVerify(repo.root).results[0].ok,false);
  await repo.publish('plates-verify','verify.json',JSON.stringify({results:[passed]}));assert.deepEqual(readVerify(repo.root).results.map(r=>r.ok),[true,false]);
  await repo.publish('keel-verify','verify.json',JSON.stringify({results:[result(false,'2026-10-24T09:00:00Z')]}));assert.equal(readVerify(repo.root).results[0].ok,false);
});
test('climb and tend retirement and waiting combine both exact families',()=>{
  assert.deepEqual([...waitingJobs(['plates-climb/alpha/1','keel-climb/beta/2','owner-climb/gamma/3'])].sort(),['alpha','beta']);
  for(const family of ['climb/job','tend']) {
    const prs=['plates','keel','plates'].map((name,i)=>({number:i+1,headRefName:`${name}-${family}/${i}`,createdAt:`2026-10-${20+i}`,mergedAt:null,state:'CLOSED'}));
    assert.deepEqual(family==='tend'?tendRetiring(prs):climbRetiring(prs,['job'])[0]?.prs,[3,2,1]);
  }
});
test('robot exact heads read both names without duplicate PRs or accepting lookalikes',async()=>{
  const calls=[];const github=async({path})=>{calls.push(path);return {status:200,data:path.includes('plates%2Frobot-7')?[{number:1},{number:3}]:[{number:2},{number:3}],headers:{}};};
  const rows=await robotPulls(github,'acme/project',7);assert.deepEqual(rows.map(r=>r.number),[1,3,2]);assert.equal(calls.length,2);
  for(const name of ['plates','keel'])assert.equal(robotIssueOf(`${name}/robot-7`),7);
  for(const branch of ['owner/robot-7','plates/robot-7-human','plates/robot-07','plates/robot-0'])assert.equal(robotIssueOf(branch),null);
  assert.equal(writeName('git ref:keel/robot-'),'plates/robot-');
});

for(const name of ['plates','keel'])test(`API reads the ${name} dated plan without writes`,async t=>{
 const root=await mkdtemp(join(tmpdir(),'plates125-api-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const gh=join(root,'gh');await writeFile(gh,`#!${process.execPath}\nconst a=process.argv.slice(2);if(a[0]!=='api'||!a.at(-1).includes('/contents/'))process.exit(9);if(a.at(-1).endsWith('ref=${name}-night-plan'))console.log(${JSON.stringify(JSON.stringify(plan()))});else {console.error('HTTP 404');process.exit(1);}`,{mode:0o755});
 assert.equal(readApiNightPlan({root,repo:'acme/project',date,env:{...process.env,PLATES_GH:gh}}).branch,`${name}-night-plan`);
});

for(const name of ['plates','keel'])test(`morning never treats the ${name} plan branch as a health branch`,async t=>{
 const repo=await repository(t);
 await assert.doesNotReject(()=>healthAround(repo.root,{},date,{branch:`${name}-night-plan`}));
 await assert.rejects(()=>healthAround(repo.root,{},date,{branch:'owner-plan'}),/cannot list/);
});
