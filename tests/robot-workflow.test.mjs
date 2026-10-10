import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile,mkdtemp,writeFile,mkdir,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { run } from './helpers/run.mjs';
import { runBlocks,shellProblems } from './helpers/workflows.mjs';
const workflow=resolve('practices/climb/files/.github/workflows/keel-robot.yml');
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
