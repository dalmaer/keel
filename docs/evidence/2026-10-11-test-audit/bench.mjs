import {mkdtemp, mkdir, copyFile, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const root='/Users/dionalmaer/code/plates', base='3ef01bef9dd4f4f06b8dfce425712ac118fca4dd';
const dir=await mkdtemp('/tmp/plates-test-bench-');
const archive=spawnSync('git',['archive',base],{cwd:root,maxBuffer:128*1024*1024});assert.equal(archive.status,0);
const files=['tests/improve-selftest.test.mjs','tests/workflows.test.mjs','tests/package.test.mjs','tests/helpers.test.mjs'];
for(const variant of ['before','after']) {
 const cwd=join(dir,variant);await mkdir(cwd);
 const unpack=spawnSync('tar',['xf','-','-C',cwd],{input:archive.stdout});assert.equal(unpack.status,0);
 if(variant==='after')for(const file of files)await copyFile(join(root,file),join(cwd,file));
}
const results=[];
for(const [i,variant] of ['before','after','after','before'].entries()) {
 const start=performance.now();
 const r=spawnSync(process.execPath,['--import','./tests/helpers/hermetic.mjs','--test',...files],{cwd:join(dir,variant),encoding:'utf8',maxBuffer:8e6});
 const ms=performance.now()-start;await writeFile(`/tmp/plates-test-audit/bench-${i}-${variant}.log`,r.stdout+r.stderr);
 results.push({variant,ms,status:r.status,summary:(r.stdout+r.stderr).split('\n').filter(l=>/^ℹ/.test(l))});
 await writeFile('/tmp/plates-test-audit/bench-results.json',JSON.stringify({base,dir,files,results},null,2));
 console.log(`${variant}: ${ms.toFixed(1)} ms; status ${r.status}`);assert.equal(r.status,0,`see bench-${i}-${variant}.log`);
}
