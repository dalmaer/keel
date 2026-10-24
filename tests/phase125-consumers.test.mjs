import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {updatePlan} from '../lib/fleet.mjs';
import {namesSettled,sinceOf} from '../lib/goodnight.mjs';
import {PR_PREFIXES} from '../lib/looseends.mjs';
import {createFleetProvider} from '../lib/web/fleet-provider.mjs';
import {createNightPlanGitHub} from '../lib/web/night-plan-github.mjs';
import {MEASURES} from '../scripts/plates/improve.mjs';
import {openRobotPrs} from '../lib/night-plan.mjs';
import {shouldReview} from '../scripts/plates/cross-review.mjs';
import {tendPick} from '../scripts/plates/tend.mjs';
import {run} from './helpers/run.mjs';
async function scratch(t){const root=await mkdtemp(join(tmpdir(),'plates125-consumers-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
async function ghAt(t,prs){const root=await scratch(t),gh=join(root,'gh');await writeFile(gh,`#!${process.execPath}\nif(process.argv[2]==='pr')console.log(${JSON.stringify(JSON.stringify(prs))});\n`,{mode:0o755});return {root,env:{...process.env,PLATES_GH:gh}};}
test('fleet keeps an existing update under either name; loose-ends includes both queues',()=>{
  for(const name of ['plates','keel']) {
    const branch=`${name}/update-v0.8.33`;
    const row={role:'managed',adopted:true,repo:'acme/project',practice:{version:'0.8.0'},machinePrs:{heads:[branch]}};
    const plan=updatePlan(row,'0.8.33');assert.equal(plan.open,true);assert.equal(plan.branch,branch);
    for(const head of [`${name}/robot-7`,`${name}-night/2026-10-24`,`${name}-loop/2026-10-24`])assert.equal(PR_PREFIXES.some(prefix=>head.startsWith(prefix)),true,head);
  }
});
test('fleet prefers the canonical existing update when both heads exist',()=>{
 const row={role:'managed',adopted:true,repo:'acme/project',practice:{version:'0.8.0'},machinePrs:{heads:['keel/update-v0.8.33','plates/update-v0.8.33']}};
 assert.equal(updatePlan(row,'0.8.33').branch,'plates/update-v0.8.33');
});
test('settled robot work and standalone-review exclusion recognize both names',()=>{
  for(const name of ['plates','keel']) {
    assert.match(namesSettled({lane:'robot:#7'},{prs:[{number:12,head:`${name}/robot-7`}],phases:[],findings:[]}),/merged today/);
    const result=shouldReview({config:{crossReview:{for:[`${name}/`],budget:{minutes:15}}},event:{name:'pull_request',action:'opened'},pr:{number:12,isCrossRepository:false,isDraft:false,headRefName:`${name}/robot-7`}});
    assert.equal(result.review,false);assert.match(result.why,/shared robot budget/);
  }
});
test('machine measurement, robot reservation and tend waiting combine aliases',async t=>{
  const prs=[{headRefName:'plates-night/2026-10-24'},{headRefName:'keel-night/2026-10-23'},{headRefName:'plates/robot-7'},{headRefName:'keel/robot-8'}];
  const {root,env}=await ghAt(t,prs);
  const measured=await MEASURES.find(m=>m.id==='machine_prs').run({root,env,config:{repo:'acme/project'},cache:new Map()});
  assert.equal(measured.facts.queues['plates-night/'],2);assert.equal(measured.facts.queues['plates/'],2);
  assert.deepEqual(openRobotPrs(root,{repo:'acme/project'},env),[7,8]);
  for(const name of ['plates','keel']) {
    const fixture=await ghAt(t,[{headRefName:`${name}-tend/2026-10-24`}]);
    const p=await tendPick({...fixture,config:{tend:{budget:{minutes:30}}},date:'2026-10-24'});assert.equal(p.run,false);assert.match(p.reason,/still open/);
  }
});
test('web update conflict inspection checks both CLI update names and never writes',async()=>{
  for(const name of ['plates','keel']) for(const surface of ['pull','ref']) {
    const calls=[],branch=`${name}/update-v0.8.33`;
    const provider=createFleetProvider('acme-token',{fetcher:async(url,options)=>{
      calls.push([url,options.method]);assert.ok(!options.method||options.method==='GET');
      const u=new URL(url);if(u.pathname.endsWith('/pulls'))return Response.json(surface==='pull'&&u.searchParams.get('head')===`acme:${branch}`?[{number:1}]:[]);
      return surface==='ref'&&decodeURIComponent(u.pathname).endsWith(branch)?Response.json({ref:'refs/heads/'+branch}):Response.json({},{status:404});
    }});
    await assert.rejects(provider.conflicts({repo:'acme/project',repoId:1},'0.8.33'),{code:'existing_cli_update'});assert.ok(calls.length);
  }
});
test('hosted plan reservation counts both robot issue heads, deduplicated and never forks',async()=>{
  const project={repo:'acme/project',repoId:1},source={repositoryNodeId:'R_acme',visibility:'private'};
  const provider=createNightPlanGitHub('acme-token',{fetcher:async()=>Response.json({data:{node:{id:'R_acme',databaseId:1,nameWithOwner:'acme/project',isPrivate:true,pullRequests:{totalCount:4,nodes:[{number:1,headRefName:'plates/robot-7',isCrossRepository:false},{number:2,headRefName:'keel/robot-8',isCrossRepository:false},{number:3,headRefName:'keel/robot-8',isCrossRepository:false},{number:4,headRefName:'plates/robot-9',isCrossRepository:true}],pageInfo:{hasNextPage:false,endCursor:null}}}}})});
  assert.deepEqual(await provider.openRobotPrs(project,source),[7,8]);
});
test('goodnight uses either locally observed plan history without fetching',async t=>{
  for(const name of ['plates','keel']) {
    const root=await scratch(t),git=(args,env=process.env)=>{const r=run('git',args,{cwd:root,env});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
    git(['init','-q','-b','main']);git(['remote','add','origin','/Acme-unreachable']);await writeFile(join(root,'Acme'),'Acme');git(['add','.']);
    git(['commit','-qm','Acme'],{...process.env,GIT_AUTHOR_DATE:'2026-10-24T10:00:00Z',GIT_COMMITTER_DATE:'2026-10-24T10:00:00Z'});
    git(['update-ref',`refs/remotes/origin/${name}-night-plan`,'HEAD']);
    const result=await sinceOf(root,process.env,new Date('2026-10-24T12:00:00Z'));assert.equal(result.at,'2026-10-24T10:00:00.000Z');assert.match(result.from,new RegExp(name+'-night-plan'));
  }
});

test('ledger recognizes each night and climb workflow identity without changing old receipts',async()=>{
 const {nightOnly}=await import('../practices/night/files/scripts/plates/test-ledger.mjs');
 for(const name of ['plates','keel'])for(const kind of ['night','climb'])assert.equal(nightOnly([{workflow:`${name}-${kind}`}]),true);
 assert.equal(nightOnly([{workflow:'owner-night'}]),false);
});
