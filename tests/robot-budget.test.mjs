import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRobotBudget,robotAdmission,robotWeek } from '../practices/climb/files/scripts/keel/robot-budget.mjs';
import { robotPolicy } from '../practices/climb/files/scripts/keel/robot-policy.mjs';
const repo='acme/anvils',now='2026-10-10T12:00:00Z',sha='a'.repeat(40),policy=robotPolicy({robot:{on:true,budgetMinutes:10}});
const step=(name,seconds=52)=>({name,status:'completed',conclusion:seconds?'success':'skipped',started_at:'2026-10-10T10:00:00Z',completed_at:new Date(Date.parse('2026-10-10T10:00:00Z')+seconds*1000).toISOString()});
function api({attempts=1,jobs,run={},total=1}={}) {
 const calls=[];
 const github=async ({path})=>{
 calls.push(path);
 if(path.endsWith('/workflows/keel-robot.yml'))return {status:200,data:{id:7,path:'.github/workflows/keel-robot.yml'}};
 if(path.includes('/workflows/7/runs?'))return {status:200,data:{total_count:total,workflow_runs:[{id:11,workflow_id:7,repository:{full_name:repo},head_sha:sha,run_attempt:attempts,updated_at:now,status:'completed',...run}]}};
 const attempt=Number(/attempts\/(\d+)/.exec(path)?.[1]);
 return {status:200,data:{total_count:1,jobs:[{id:30+attempt,run_id:11,run_attempt:attempt,head_sha:sha,name:'agent',status:'completed',conclusion:'success',steps:[step('Robot build Claude',0),step('Robot build Codex')],...jobs}]}};
 };return {github,calls};
}
test('robot budget sums successful and failed model steps across attempts, skipped first is not zero usage',async()=>{
 const {github,calls}=api({attempts:2});const b=await readRobotBudget({repo,policy,now,github});
 assert.equal(b.usedSeconds,104);assert.equal(b.remainingSeconds,496);assert.equal(b.complete,true);assert.ok(calls.some(p=>p.includes('/attempts/1/')));
 const review=api({jobs:{name:'review-agent',steps:[step('Robot review Claude',0),{...step('Robot review Codex'),conclusion:'failure'},step('Post Robot review Codex',60)]}});
 assert.equal((await readRobotBudget({repo,policy,now,github:review.github})).usedSeconds,52);
});
test('robot budget fails closed on truncated pages, wrong identities and unfinished usage',async()=>{
 for(const options of [{total:2},{run:{workflow_id:8}},{jobs:{run_attempt:3}},{jobs:{head_sha:'b'.repeat(40)}},{jobs:{steps:[{...step('Robot build Claude'),status:'in_progress',completed_at:null},step('Robot build Codex',0)]}},{jobs:{steps:[]}},{run:{updated_at:'2026-10-11T00:00:00Z'}}]) {
  const b=await readRobotBudget({repo,policy,now,github:api(options).github});assert.equal(b.state,'unknown',JSON.stringify(options));assert.equal(b.usedSeconds,null);assert.equal(b.remainingSeconds,null);
 }
});
test('robot budget clips week boundaries and reserves other-provider review within the same allowance',async()=>{
 assert.equal(robotWeek(now).windowStart,'2026-10-05T00:00:00.000Z');
 const github=api({jobs:{steps:[{...step('Robot build Claude'),started_at:'2026-10-04T23:59:30Z',completed_at:'2026-10-05T00:00:30Z'},step('Robot build Codex',0)]}}).github;
 const b=await readRobotBudget({repo,policy,now,github});assert.equal(b.usedSeconds,30);
 assert.deepEqual(robotAdmission({policy,budget:b,requestedBuildSeconds:2700,reservedReviewSeconds:300}),{allowed:true,buildSeconds:240,reviewSeconds:300,reason:'serialized build and other-provider review fit the allowance'});
 assert.equal(robotAdmission({policy,budget:{...b,remainingSeconds:20},requestedBuildSeconds:60,reservedReviewSeconds:60}).allowed,false);
});

test('robot attempt endpoint accepts absent attempt only and preflight exempts only its own future model metadata',async()=>{
 const absent=api().github;
 const github=async r=>{const result=await absent(r);for(const j of result.data.jobs??[])delete j.run_attempt;return result;};
 assert.equal((await readRobotBudget({repo,policy,now,github})).usedSeconds,52);
 for(const run_attempt of [null,'1',2])assert.equal((await readRobotBudget({repo,policy,now,github:api({jobs:{run_attempt}}).github})).state,'unknown');
 const buildPending=api({run:{status:'in_progress'},jobs:{status:'in_progress',steps:[]}}).github;
 assert.equal((await readRobotBudget({repo,policy,now,github:buildPending,preflight:{runId:11,attempt:1,job:'agent'}})).usedSeconds,0);
 const pending=api({run:{status:'in_progress'},jobs:{name:'review-agent',status:'in_progress',steps:[]}}).github;
 const preflight={runId:11,attempt:1,job:'review-agent'};
 assert.equal((await readRobotBudget({repo,policy,now,github:pending,preflight})).state,'unknown');
 assert.equal((await readRobotBudget({repo,policy,now,github:pending,preflight:{...preflight,job:'agent'}})).state,'unknown');
 const withBuild=async r=>{const response=await pending(r);if(response.data.jobs){response.data.jobs.push({id:99,run_id:11,head_sha:sha,name:'agent',status:'completed',steps:[step('Robot build Claude'),step('Robot build Codex',0)]});response.data.total_count=2;}return response;};
 assert.equal((await readRobotBudget({repo,policy,now,github:withBuild,preflight})).usedSeconds,52);
 const incompleteBuild=async r=>{const response=await withBuild(r);if(response.data.jobs)response.data.jobs[1].steps=[];return response;};
 assert.equal((await readRobotBudget({repo,policy,now,github:incompleteBuild,preflight})).state,'unknown');
});

test('robot budget excludes router history but counts legacy worker events and old runs rerun this week', async () => {
 const worker = api({attempts:2,run:{event:'issue_comment',created_at:'2026-01-01T00:00:00Z'}});
 const github = async request => {
  assert.doesNotMatch(request.path,/created=|event=|status=|keel-robot-route/);
  // Public flood belongs to another workflow, never to the worker's ledger.
  if (request.path.includes('/workflows/8/runs?')) return {status:200,data:{total_count:600,workflow_runs:[]}};
  return worker.github(request);
 };
 const b = await readRobotBudget({repo,policy,now,github});
 assert.equal(b.state,'available');assert.equal(b.usedSeconds,104);
 assert.ok(worker.calls.some(p=>p.includes('/attempts/1/jobs')));
 assert.ok(worker.calls.some(p=>p.includes('/attempts/2/jobs')));
 assert.ok(worker.calls.every(p=>!p.includes('/actions/runs?')));
});

test('robot budget never treats more than 500 actual worker runs as complete or free', async () => {
 const calls=[];
 const github=async ({path})=>{
  calls.push(path);
  if(path.endsWith('/workflows/keel-robot.yml'))return {status:200,data:{id:7,path:'.github/workflows/keel-robot.yml'}};
  assert.match(path,/\/workflows\/7\/runs\?/);
  const page=Number(new URL(`https://api.github.com${path}`).searchParams.get('page'));
  return {status:200,data:{total_count:501,workflow_runs:Array.from({length:100},(_,i)=>({id:(page-1)*100+i+1,workflow_id:7,repository:{full_name:repo},head_sha:sha,run_attempt:1,updated_at:now,status:'completed'}))}};
 };
 const b=await readRobotBudget({repo,policy,now,github});
 assert.equal(calls.length,6);assert.equal(b.state,'unknown');assert.equal(b.complete,false);
 assert.equal(b.usedSeconds,null);assert.equal(b.remainingSeconds,null);
 assert.match(b.reasons.join(' '),/bounded coverage/);
});


test('robot review retry reuses prior attempt build while accounting every attempt and requiring current preflight', async () => {
 const preflight={runId:11,attempt:2,job:'review-agent'};
 const fixture=({build=true,latest=2,active=true,buildAttempt=1,future=false}={})=>async ({path})=>{
  if(path.endsWith('/workflows/keel-robot.yml'))return {status:200,data:{id:7,path:'.github/workflows/keel-robot.yml'}};
  if(path.includes('/runs?'))return {status:200,data:{total_count:1,workflow_runs:[{id:11,workflow_id:7,repository:{full_name:repo},head_sha:sha,run_attempt:latest,updated_at:now,status:'in_progress'}]}};
  const attempt=Number(/attempts\/(\d+)/.exec(path)[1]);
  const base={run_id:11,run_attempt:attempt,head_sha:sha};
  const jobs=attempt===1?[{...base,id:41,name:'review-agent',status:'completed',steps:[{...step('Robot review Claude',20),conclusion:'failure'},step('Robot review Codex',0)]}]
   :[{...base,id:40+attempt,name:'review-agent',status:active?'in_progress':'queued',steps:[]}];
  if(build&&attempt===buildAttempt)jobs.push({...base,id:80+attempt,name:'agent',status:'completed',steps:[{...step('Robot build Claude',40),...(future?{completed_at:'2026-10-11T00:00:00Z'}:{})},step('Robot build Codex',0)]});
  return {status:200,data:{total_count:jobs.length,jobs}};
 };
 const result=await readRobotBudget({repo,policy,now,preflight,github:fixture()});
 assert.equal(result.state,'available');assert.equal(result.complete,true);
 assert.equal(result.usedSeconds,60,'prior build and failed review both charged');assert.equal(result.remainingSeconds,540);
 for(const options of [{build:false},{active:false},{latest:3,buildAttempt:3},{future:true}]) {
  const got=await readRobotBudget({repo,policy,now,preflight,github:fixture(options)});
  assert.equal(got.state,'unknown',JSON.stringify(options));assert.equal(got.usedSeconds,null);assert.equal(got.remainingSeconds,null);
 }
 for(const changed of [{...preflight,runId:12},{...preflight,attempt:3},{...preflight,attempt:1}])assert.equal((await readRobotBudget({repo,policy,now,preflight:changed,github:fixture()})).state,'unknown');
});
