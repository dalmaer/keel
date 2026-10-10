import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile,mkdtemp,writeFile,mkdir,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { run } from './helpers/run.mjs';
import { runBlocks,shellProblems } from './helpers/workflows.mjs';
const workflow=resolve('practices/climb/files/.github/workflows/keel-robot.yml');
const router=resolve('practices/climb/files/.github/workflows/keel-robot-route.yml');
const git=(dir,...args)=>execFileSync('git',['-C',dir,...args],{encoding:'utf8'}).trim();
test('robot workflow keeps build agent judge publisher boundaries and explicitly reviews within the same queue',async()=>{
 const text=await readFile(workflow,'utf8');assert.deepEqual(await shellProblems('robot',text),[]);
 const section=name=>text.split(`\n  ${name}:\n`)[1].split(/\n  [a-z-]+:\n/)[0];
 for(const name of ['agent','judge','review-agent']) {assert.doesNotMatch(section(name),/\b(?:contents|issues|pull-requests): write/);assert.match(section(name),/persist-credentials: false/);}
 for(const name of ['publish','review-post'])assert.doesNotMatch(section(name),/uses: (?:anthropics|openai)\//);
 assert.match(section('publish'),/ref: \$\{\{ github.sha \}\}/);assert.doesNotMatch(section('publish'),/git (?:switch|checkout)|npm ci/);
 assert.match(text,/group: keel-robot\n  cancel-in-progress: false/);
 assert.match(section('review-agent'),/needs: publish/);assert.match(section('review-agent'),/ROBOT_HEAD: \$\{\{ needs.publish.outputs.head \}\}/);
 assert.match(section('review-agent'),/sandbox: read-only/);assert.match(section('agent'),/sandbox: workspace-write/);
 assert.doesNotMatch(text,/danger-full-access|safety-strategy: unsafe|gh pr merge/);
 assert.ok(section('agent').indexOf('name: robot-plan')<section('agent').indexOf('name: Robot build Claude'));
});
test('robot workflow object-only handoff executes without loading agent git hooks or config',async t=>{
 const root=await mkdtemp(join(tmpdir(),'acme-robot-shell-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const temp=join(root,'temp');await mkdir(temp);
 git(root,'init','-q','-b','main');await writeFile(join(root,'acme.txt'),'base');git(root,'add','acme.txt');git(root,'commit','-qm','base');
 const base=git(root,'rev-parse','HEAD');git(root,'switch','-qc','keel/robot-1');
 await mkdir(join(root,'.keel'));git(root,'clone','-q','--bare',join(root,'.git'),join(root,'.keel/agent-git'));
 const a=(...args)=>git(root,'--git-dir=.keel/agent-git','--work-tree=.',...args);
 a('config','user.name','Acme');a('config','user.email','acme@example.test');await writeFile(join(root,'acme.txt'),'fixed');a('add','acme.txt');a('commit','-qm','fixed');
 // Config is syntactically invalid: any git command reading the agent directory would fail.
 await writeFile(join(root,'.keel/agent-git/config'),'[broken\n');await writeFile(join(temp,'message.txt'),'Acme corrected.');
 const script=runBlocks(await readFile(workflow,'utf8')).find(b=>b.step==='Take agent commits as objects only').script;
 const r=run('bash',['-e','-o','pipefail','-c',script],{cwd:root,env:{...process.env,RUNNER_TEMP:temp,GITHUB_SHA:base,ISSUE:'1'}});
 assert.equal(r.status,0,r.stdout+r.stderr);
 git(root,'fetch','-q',join(temp,'handoff/robot.bundle'),'refs/heads/keel/robot-1');
 assert.equal(git(root,'show','FETCH_HEAD:acme.txt'),'fixed');assert.equal(await readFile(join(temp,'handoff/message.txt'),'utf8'),'Acme corrected.');
});


test('robot recovery explicitly schedules review after successful publication despite skipped judge',async()=>{
 const text=await readFile(workflow,'utf8');
 const review=text.split('\n  review-agent:\n')[1].split(/\n  [a-z-]+:\n/)[0];
 // A recovered publication can succeed with judge skipped. Without an explicit
 // status function, Actions inserts success() and suppresses its downstream review.
 assert.match(review,/^    if: always\(\) && needs\.publish\.result == 'success' && needs\.publish\.outputs\.pr != ''$/m);
 assert.match(review,/^    needs: publish$/m);
});

test('robot public events cannot enter serialized worker history before trusted routing', async () => {
 const worker = await readFile(workflow, 'utf8');
 const triggers = worker.split('\non:\n')[1].split('\nconcurrency:')[0];
 assert.doesNotMatch(triggers, /^  (?:issues|issue_comment|pull_request|workflow_run|repository_dispatch):/m);
 assert.match(triggers, /^  schedule:/m);
 assert.match(triggers, /^  workflow_dispatch:/m);
 assert.match(triggers, /^      robot_trigger:/m);
 const text = await readFile(router, 'utf8');
 assert.deepEqual(await shellProblems('robot-router', text), []);
 assert.match(text,/^concurrency:\n  group: keel-robot-route-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}\n  cancel-in-progress: false$/m);
 assert.match(text, /issue_comment:\n    types: \[created\]/);
 assert.doesNotMatch(text, /uses: (?:anthropics|openai|actions\/checkout)|secrets\.|contents: write|issues: write/);
 assert.match(text, /actions: write/);
 assert.match(text, /github\.event\.issue\.pull_request == null/);
});

test('robot router dispatches only fresh writer-authorized issue events, preserving the trigger for runtime revalidation', async t => {
 const dir = await mkdtemp(join(tmpdir(), 'acme-robot-router-'));
 t.after(() => rm(dir, { recursive: true, force: true }));
 const script = runBlocks(await readFile(router, 'utf8')).find(b => b.step === 'Verify current writer and route one issue event').script;
 const stub = join(dir, 'fetch.mjs'), fixtures = join(dir, 'responses.json'), log = join(dir, 'calls.jsonl'), eventFile = join(dir, 'event.json');
 await writeFile(stub, `import {readFileSync,appendFileSync} from 'node:fs';
globalThis.fetch=async (url,options)=>{const u=new URL(url),path=u.pathname+u.search;const calls={path,method:options.method,body:options.body?JSON.parse(options.body):null};appendFileSync(process.env.ACME_CALLS,JSON.stringify(calls)+'\\n');const responses=JSON.parse(readFileSync(process.env.ACME_RESPONSES,'utf8'));const r=responses[path];if(!r)throw Error('unexpected API path '+path);return {status:r.status,json:async()=>r.data};};`);
 const repo = 'acme/anvils', user = { login: 'acme-owner', type: 'User' };
 const issue = { number: 7, html_url: `https://github.com/${repo}/issues/7`, state: 'open', labels: [{name:'keel:agent'}] };
 const comment = { id: 23, user, issue_url: `https://api.github.com/repos/${repo}/issues/7` };
 const event = { repository:{full_name:repo}, action:'created', issue, sender:user, comment };
 const permissionPath = `/repos/${repo}/collaborators/${user.login}/permission`, issuePath = `/repos/${repo}/issues/7`, commentPath = `/repos/${repo}/issues/comments/23`;
 const dispatchPath = `/repos/${repo}/actions/workflows/keel-robot.yml/dispatches`;
 const configPath = `/repos/${repo}/contents/.keel/keel.json?ref=release%2Facme`;
 const policyFile = config => ({status:200,data:{type:'file',path:'.keel/keel.json',encoding:'base64',content:Buffer.from(JSON.stringify(config)).toString('base64')}});
 const responses = {
  [permissionPath]:{status:200,data:{user,permission:'write'}},
  [issuePath]:{status:200,data:issue}, [commentPath]:{status:200,data:comment},
  [`/repos/${repo}`]:{status:200,data:{full_name:repo,default_branch:'release/acme'}},
  [configPath]:policyFile({robot:{on:true,budgetMinutes:10}}),
  [dispatchPath]:{status:204},
 };
 const invoke = async ({ payload=event, eventName='issue_comment', overrides={} }={}) => {
  await writeFile(eventFile, JSON.stringify(payload)); await writeFile(fixtures, JSON.stringify({...responses,...overrides})); await writeFile(log,'');
  const result=run('bash',['-e','-o','pipefail','-c',script],{cwd:dir,env:{...process.env,GITHUB_EVENT_PATH:eventFile,GITHUB_REPOSITORY:repo,GITHUB_EVENT_NAME:eventName,GITHUB_API_URL:'https://api.github.com',NODE_OPTIONS:`--import=${stub}`,ACME_CALLS:log,ACME_RESPONSES:fixtures,GH_TOKEN:'acme-synthetic-token'}});
  const calls=(await readFile(log,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  return {...result,calls,posts:calls.filter(c=>c.method==='POST')};
 };
 for (const permission of ['write','maintain','admin']) {
  const out=await invoke({overrides:{[permissionPath]:{status:200,data:{user,permission}}}});
  assert.equal(out.status,0,out.stderr); assert.equal(out.posts.length,1);
  assert.equal(out.calls[0].path,permissionPath);
  assert.ok(out.calls.findIndex(c=>c.path===configPath)<out.calls.findIndex(c=>c.path===dispatchPath));
  assert.deepEqual(out.posts[0],{path:dispatchPath,method:'POST',body:{ref:'release/acme',inputs:{robot_trigger:JSON.stringify({version:1,repo,eventName:'issue_comment',action:'created',issueNumber:7,commentId:23,sender:user.login})}}});
 }
 for (const action of ['labeled','reopened']) {
  const out=await invoke({eventName:'issues',payload:{...event,action,label:{name:'keel:agent'}}});
  assert.equal(out.status,0,out.stderr);assert.equal(out.posts.length,1);
  const trigger=JSON.parse(out.posts[0].body.inputs.robot_trigger);
  assert.equal(trigger.action,action);assert.equal(trigger.commentId,null);assert.equal(trigger.eventName,'issues');
 }
 const rejected = [
  {payload:{...event,sender:{...user,type:'Bot'}}},
  {payload:{...event,issue:{...issue,pull_request:{url:'acme'}}}},
  {payload:{...event,comment:{...comment,user:{...user,login:'acme-other'}}}},
  {eventName:'issues',payload:{...event,action:'labeled',label:{name:'other'}}},
  ...['read','triage',null].map(permission=>({overrides:{[permissionPath]:{status:200,data:{user,permission}}}})),
  {overrides:{[permissionPath]:{status:403,data:{}}}},
  {overrides:{[permissionPath]:{status:200,data:{user:{login:'acme-other'},permission:'admin'}}}},
  ...[{...issue,labels:[]},{...issue,state:'closed'},{...issue,pull_request:{}},{...issue,number:8}].map(data=>({overrides:{[issuePath]:{status:200,data}}})),
  ...[{...comment,issue_url:`https://api.github.com/repos/${repo}/issues/8`},{...comment,user:{...user,type:'Bot'}},{...comment,user:{...user,login:'acme-other'}},{...comment,id:24}].map(data=>({overrides:{[commentPath]:{status:200,data}}})),
  {overrides:{[commentPath]:{status:404,data:{}}}},
  {overrides:{[`/repos/${repo}`]:{status:200,data:{full_name:'acme/other',default_branch:'main'}}}},
  ...[{}, {robot:{on:false}}, {robot:{on:'true'}}, null].map(config=>({overrides:{[configPath]:policyFile(config)}})),
  {overrides:{[configPath]:{status:404,data:{}}}},
 ];
 for (const input of rejected) {
  const out=await invoke(input);
  assert.equal(out.posts.length,0,JSON.stringify(input));
 }
});
