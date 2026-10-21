import { run } from './helpers/run.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, cp, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { decisionContext, decisionBrief } from '../practices/reconciliation/files/scripts/plates/decision-context.mjs';
import { formatRobotRubric } from '../practices/climb/files/scripts/plates/robot-rubric.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const record=owner=>`# Acme\n<a id="store"></a>\n## Store\nKeep Acme storage.\n\`\`\`keel-decision\n${JSON.stringify({version:1,id:'store',status:'accepted',scope:['storage'],decided_by:owner,decided_at:'2026-01-01',supersedes:[],superseded_by:[]})}\n\`\`\`\n<a id="proposal"></a>\n## Proposal\nTry an Acme alternative.\n\`\`\`keel-decision\n${JSON.stringify({version:1,id:'proposal',status:'proposed',scope:['cache'],supersedes:[],superseded_by:[]})}\n\`\`\`\n`;
async function world(t) {
 const home=await mkdtemp(join(tmpdir(),'acme-decision-brief-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const root=join(home,'project');for(const p of ['.plates','docs/phases','docs/decisions','.agents/robot'])await mkdir(join(root,p),{recursive:true});
 await writeFile(join(root,'.plates/plates.json'),JSON.stringify({name:'Acme',tagline:'Acme decision proof',repo:'acme/app',practices:['base','reconciliation'],check:'node --test'}));
 await writeFile(join(root,'docs/phases/00-acme.md'),'# Acme\n## Reconciliation\n```keel-reconciliation\n{"version":1,"decisions":["docs/decisions/store.md#store"]}\n```\n');
 await writeFile(join(root,'docs/decisions/store.md'),record('Acme owner'));
 await cp('practices/climb/files/.agents/robot/PROTOCOL.md',join(root,'.agents/robot/PROTOCOL.md'));
 execFileSync('git',['init','-q'],{cwd:root});execFileSync('git',['add','.'],{cwd:root});execFileSync('git',['commit','-qm','Acme'],{cwd:root});
 return {home,root};
}
const cli=(bin,root,args)=>{const r=run(process.execPath,[bin,...args,'--json'],{cwd:root});assert.ok(r.stdout,r.stderr);return {code:r.status,data:JSON.parse(r.stdout)};};
test('packed CLI and adopted runtime expose the guide contract; standalone reconcile still runs alone',async t=>{
 const {home,root}=await world(t);
 const pack=run('npm',['pack','--ignore-scripts','--json','--pack-destination',home]);assert.equal(pack.status,0,pack.stderr);
 const packed=JSON.parse(pack.stdout)[0];
 execFileSync('tar',['-xzf',join(home,packed.filename),'-C',home]);const bin=join(home,'package/bin/plates.mjs');
 const out=cli(bin,root,['decision','context','--phase','0']);assert.equal(out.code,0);assert.equal(out.data.state,'complete');
 const help=run(process.execPath,[bin,'--agent-help','decision'],{cwd:root});assert.equal(help.status,0);assert.match(help.stdout,/100 decision records/);
 const rendered=cli(bin,root,['render']);assert.equal(rendered.code,0,JSON.stringify(rendered.data));
 const climbRoot=join(home,'climb-only');
 const initialized=cli(bin,home,['init',climbRoot,'--description','Acme compatibility.','--with','climb']);assert.equal(initialized.code,0,JSON.stringify(initialized.data));
 const addedRoot=join(home,'added-climb');
 assert.equal(cli(bin,home,['init',addedRoot,'--description','Acme adoption.']).code,0);
 const adopted=cli(bin,addedRoot,['adopt','--with','climb']);assert.equal(adopted.code,0,JSON.stringify(adopted.data));
 assert.ok(!adopted.data.config.practices.includes('reconciliation'));
 for(const path of ['scripts/plates/reconcile.mjs','scripts/plates/decision-context.mjs']) {
   assert.ok(adopted.data.files.some(f=>f.path===path));
   assert.ok((await readFile(join(addedRoot,path),'utf8')).length);
   assert.equal(JSON.parse(await readFile(join(addedRoot,'.plates/lock.json'),'utf8')).files[path].practice,'reconciliation');
 }
 await assert.rejects(readFile(join(addedRoot,'.github/workflows/plates-impact.yml')),{code:'ENOENT'});
 const config=JSON.parse(await readFile(join(climbRoot,'.plates/plates.json'),'utf8'));
 assert.ok(config.practices.includes('climb'));assert.ok(!config.practices.includes('reconciliation'));
 await assert.rejects(readFile(join(climbRoot,'.github/workflows/plates-impact.yml')), {code:'ENOENT'});
 const imported=await import(pathToFileURL(join(climbRoot,'scripts/plates/decision-context.mjs')));
 assert.equal((await imported.decisionContext({root:climbRoot,phase:'0'})).state,'not-configured');
 const runtimePaths=['scripts/plates/reconcile.mjs','scripts/plates/decision-context.mjs'];
 const originalRuntime=await Promise.all(runtimePaths.map(p=>readFile(join(climbRoot,p),'utf8')));
 const cfgPath=join(climbRoot,'.plates/plates.json');
 await writeFile(join(climbRoot,'tests/acme-runtime.test.mjs'),`import {test} from 'node:test';\nimport assert from 'node:assert/strict';\nimport {decisionContext} from '../scripts/plates/decision-context.mjs';\ntest('Acme imported runtime works',async()=>assert.equal((await decisionContext({root:process.cwd(),phase:'0'})).state,'not-configured'));\n`);
 for(let pass=0;pass<2;pass++) {
   const before=JSON.parse(await readFile(cfgPath,'utf8'));
   before.practice='0.0.0';before.check='node --test tests/acme-runtime.test.mjs';
   await writeFile(cfgPath,JSON.stringify(before,null,2)+'\n');
   execFileSync('git',['add','-A'],{cwd:climbRoot});execFileSync('git',['commit','-qm',`Acme update input ${pass}`],{cwd:climbRoot});
   const updated=cli(bin,climbRoot,['update','--local','--no-self-update']);assert.equal(updated.code,0,JSON.stringify(updated.data));assert.equal(updated.data.changed,true);
   const after=JSON.parse(await readFile(cfgPath,'utf8'));assert.ok(!after.practices.includes('reconciliation'));
   const lock=JSON.parse(await readFile(join(climbRoot,'.plates/lock.json'),'utf8'));
   for(const [i,path] of runtimePaths.entries()) {assert.equal(lock.files[path].practice,'reconciliation');assert.equal(await readFile(join(climbRoot,path),'utf8'),originalRuntime[i]);}
   await assert.rejects(readFile(join(climbRoot,'.github/workflows/plates-impact.yml')), {code:'ENOENT'});
 }
 const managedConfig=JSON.parse(await readFile(cfgPath,'utf8'));
 for(const mode of ['local','ejected']) {
   const cfg={...managedConfig,...(mode==='local'?{local:{reconciliation:'Acme-owned runtime'}}:{ejected:[runtimePaths[1]]})};
   await writeFile(cfgPath,JSON.stringify(cfg));await rm(join(climbRoot,runtimePaths[1]));
   const rendered=cli(bin,climbRoot,['render']);assert.equal(rendered.code,0,JSON.stringify(rendered.data));
   await assert.rejects(readFile(join(climbRoot,runtimePaths[1])),{code:'ENOENT'});
   const temp=join(home,`refused-${mode}`);await mkdir(temp);await writeFile(join(temp,'robot-plan.json'),'Acme unchanged plan');
   const refused=run(process.execPath,[join(climbRoot,'scripts/plates/robot.mjs'),'context','--json'],{cwd:climbRoot,env:{...process.env,GITHUB_WORKSPACE:climbRoot,GITHUB_REPOSITORY:'acme/app',RUNNER_TEMP:temp,PLATES_GH:join(home,'no-gh')}});
   assert.notEqual(refused.status,0);assert.match(refused.stderr,/ERR_MODULE_NOT_FOUND/);assert.match(refused.stderr,/decision-context/);
   assert.equal(await readFile(join(temp,'robot-plan.json'),'utf8'),'Acme unchanged plan');
   await writeFile(cfgPath,JSON.stringify(managedConfig));assert.equal(cli(bin,climbRoot,['render']).code,0);
 }

 const runtime=await import(pathToFileURL(join(root,'scripts/plates/decision-context.mjs')));
 assert.equal((await runtime.decisionContext({root,phase:'0'})).digest,out.data.digest);
 assert.match(await readFile(join(root,'docs/reconciliation.md'),'utf8'),/before dispatch and resume/);
 const alone=join(home,'standalone.mjs');await cp(join(root,'scripts/plates/reconcile.mjs'),alone);
 const standalone=run(process.execPath,[alone,'--root',root,'--json'],{});assert.ok([0,1].includes(standalone.status),standalone.stderr+standalone.stdout);
 await writeFile(join(root,'docs/decisions/store.md'),record('Acme revised owner'));
 const changed=cli(bin,root,['decision','context','--phase','0']);assert.notEqual(changed.data.digest,out.data.digest);
 await rm(join(root,'docs/decisions/store.md'));assert.equal(cli(bin,root,['decision','context','--phase','0']).code,2);
});
test('conductor and robot separate choices from proposals and require digest in report',async t=>{
 const {root}=await world(t);const b=await decisionContext({root,phase:'0'});const text=decisionBrief(b);
 assert.match(text,/Accepted choices:/);assert.match(text,/Proposals \(not approval\):/);assert.match(text,/Unresolved choices:/);assert.ok(text.includes(b.digest));
 const guide=await readFile('practices/conduct/files/.agents/skills/spin/SKILL.md','utf8');assert.match(guide,/before every resume/);assert.match(guide,/digest used/);
 const protocol=await readFile('practices/climb/files/.agents/robot/PROTOCOL.md','utf8');assert.match(protocol,/decision digest used/);
 assert.throws(()=>decisionBrief({...b,state:'unavailable',gaps:[{code:'missing'}]}),/Required decision context/);
});
test('workflow shell refresh binds the pre-agent immutable plan and brief to current bytes',async t=>{
 const {home,root}=await world(t);const temp=join(home,'runner');const trusted=join(temp,'trusted');await mkdir(trusted,{recursive:true});
 for(const practice of ['night','climb','reconciliation'])for(const name of await readdir(`practices/${practice}/files/scripts/plates`))if(name.endsWith('.mjs'))await cp(`practices/${practice}/files/scripts/plates/${name}`,join(trusted,name));
 const body=formatRobotRubric({version:1,problem:'Acme failure',reproduction:'node --test',acceptance:'Acme passes',change:'Repair Acme',prerequisites:[],ownerBlockers:[],decisions:['docs/decisions/store.md#store']});
 const bundle=await decisionContext({root,issue:'acme/app#1',issueBody:body});
 await writeFile(join(temp,'robot-plan.json'),JSON.stringify({state:'ready',repo:'acme/app',issueNumber:1,issueHash:hash(body),decisionBundle:bundle,decisionDigest:bundle.digest}));
 const gh=join(home,'gh');await writeFile(gh,`#!${process.execPath}\nif(process.argv.at(-1)!=='/repos/acme/app/issues/1')process.exit(9);\nconsole.log('HTTP/2.0 200 OK\\ncontent-type: application/json\\n\\n'+JSON.stringify(${JSON.stringify({number:1,html_url:'https://github.com/acme/app/issues/1',body})}));\n`);await chmod(gh,0o700);
 await writeFile(join(root,'docs/decisions/store.md'),record('Acme changed owner'));
 const env={...process.env,GITHUB_WORKSPACE:root,GITHUB_REPOSITORY:'acme/app',RUNNER_TEMP:temp,PLATES_GH:gh};
 const refresh=()=>run(process.execPath,[join(trusted,'robot.mjs'),'context','--json'],{cwd:root,env});
 const r=refresh();assert.equal(r.status,0,r.stderr);const plan=JSON.parse(await readFile(join(temp,'robot-plan.json'),'utf8'));assert.notEqual(plan.decisionDigest,bundle.digest);
 assert.equal(plan.decisionDigest,JSON.parse(r.stdout).decisionDigest);
 assert.ok((await readFile(join(temp,'robot-brief/robot-prompt.md'),'utf8')).includes(plan.decisionDigest));
 const workflow=await readFile('practices/climb/files/.github/workflows/plates-robot.yml','utf8');
 assert.equal(workflow.split('name: Refresh required decisions').length,2);
 assert.ok(workflow.indexOf('robot.mjs" context --json')<workflow.indexOf('name: robot-plan'));
 assert.ok(workflow.indexOf('name: robot-plan')<workflow.indexOf('name: Robot build Claude'));
 await rm(join(root,'docs/decisions/store.md'));assert.equal(refresh().status,1);
});
