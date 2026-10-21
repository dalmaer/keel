import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, cp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { run } from './helpers/run.mjs';
const cli=(bin,root,args)=>{const r=run(process.execPath,[bin,...args,'--json'],{cwd:root,env:{...process.env,KEEL_GH:'/acme/no-gh'}});return {code:r.status,data:JSON.parse(r.stdout),err:r.stderr};};
test('packed fresh-process lifecycle renders adopted review, validates real roadmap and refuses stale approval',async t=>{
 const home=await mkdtemp(join(tmpdir(),'acme-shaping-packed-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const pack=run('npm',['pack','--ignore-scripts','--json','--pack-destination',home],{cwd:resolve('.')});assert.equal(pack.status,0,pack.stderr);
 execFileSync('tar',['-xzf',join(home,JSON.parse(pack.stdout)[0].filename),'-C',home]);
 const bin=join(home,'package/bin/keel.mjs'),root=join(home,'Acme');
 const init=cli(bin,home,['init',root,'--description','Acme test application.','--with','shaping']);assert.equal(init.code,0,JSON.stringify(init));
 const config=JSON.parse(await readFile(join(root,'.keel/keel.json'),'utf8'));assert.ok(config.practices.includes('shaping'));assert.ok(!config.practices.includes('reconciliation'));assert.ok(!config.practices.includes('climb'));
 await cp(join(root,'docs/templates/shaping.json'),join(root,'idea.json'));
 assert.match(await readFile(join(root,'AGENTS.md'),'utf8'),/shape plan --yes --digest/);
 const help=run(process.execPath,[bin,'--agent-help','shape'],{cwd:root});assert.equal(help.status,0);assert.match(help.stdout,/12 questions and 20 work items/);
 const checked=cli(bin,root,['shape','check','idea.json']);assert.equal(checked.code,0,JSON.stringify(checked));
 await assert.rejects(readdir(join(root,'.keel/shaping')),{code:'ENOENT'});
 const rendered=cli(bin,root,['shape','render','idea.json','--output','review']);assert.equal(rendered.code,0,JSON.stringify(rendered));
 const p=cli(bin,root,['shape','plan','idea.json']);assert.equal(p.code,0,JSON.stringify(p));assert.equal(p.data.digest,rendered.data.digest);
 assert.equal(cli(bin,root,['shape','plan','idea.json','--yes']).code,2);
 const applied=cli(bin,root,['shape','plan','idea.json','--yes','--digest',p.data.digest]);assert.equal(applied.code,0,JSON.stringify(applied));
 assert.equal(await readFile(join(root,p.data.outputs[0].path),'utf8'),p.data.outputs[0].content);
 for(const args of [['scripts/roadmap.mjs'],['scripts/roadmap.mjs','--check']]) { const r=run(process.execPath,args,{cwd:root});assert.equal(r.status,0,r.stderr+r.stdout); }
 const retry=cli(bin,root,['shape','plan','idea.json','--yes','--digest',p.data.digest]);assert.equal(retry.code,0,JSON.stringify(retry));assert.deepEqual(retry.data.outputs,p.data.outputs);
 const record=JSON.parse(await readFile(join(root,'idea.json'),'utf8'));record.answers[0].text='Acme changed answer';await writeFile(join(root,'idea.json'),JSON.stringify(record));
 const stale=cli(bin,root,['shape','plan','idea.json','--yes','--digest',p.data.digest]);assert.equal(stale.code,2);assert.match(stale.data.error,/source changed/);
 // Preview-only milestone mode never seeds archived plans or calls a remote/model.
 config.phases={source:'milestones'};await writeFile(join(root,'.keel/keel.json'),JSON.stringify(config));record.items[0].depends=[];await writeFile(join(root,'idea.json'),JSON.stringify(record));await rm(join(root,'docs/phases'),{recursive:true});
 const remote=cli(bin,root,['shape','plan','idea.json']);assert.equal(remote.code,0,JSON.stringify(remote));assert.deepEqual(remote.data.outputs,[]);
 assert.equal(cli(bin,root,['shape','plan','idea.json','--yes','--digest',remote.data.digest]).data.state,'preview-only');await assert.rejects(readdir(join(root,'docs/phases')),{code:'ENOENT'});
 // Legacy init/adopt leave the optional practice off; enabling it preserves prose.
 const legacy=join(home,'Legacy');assert.equal(cli(bin,home,['init',legacy,'--description','Acme legacy project.']).code,0);
 assert.ok(!JSON.parse(await readFile(join(legacy,'.keel/keel.json'),'utf8')).practices.includes('shaping'));
 assert.equal(cli(bin,legacy,['adopt']).code,0);await assert.rejects(readFile(join(legacy,'docs/shaping.md')),{code:'ENOENT'});
 const before=await readFile(join(legacy,'AGENTS.md'),'utf8');await writeFile(join(legacy,'AGENTS.md'),before+'\nAcme owner prose stays.\n');
 const adopt=cli(bin,legacy,['adopt','--with','shaping']);assert.equal(adopt.code,0,JSON.stringify(adopt));assert.match(await readFile(join(legacy,'AGENTS.md'),'utf8'),/Acme owner prose stays/);
 await writeFile(join(legacy,'docs/templates/shaping.json'),'Acme custom template');assert.equal(cli(bin,legacy,['render']).code,0);assert.equal(await readFile(join(legacy,'docs/templates/shaping.json'),'utf8'),'Acme custom template');
});
