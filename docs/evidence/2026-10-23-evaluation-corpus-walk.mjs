// Real public CLI and installed-package corpus walk; no agent trials or network.
import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(process.argv[2]);
const home=await realpath(await mkdtemp(join(tmpdir(),'acme-corpus-walk-')));
const observations=[];
const env={...process.env,TZ:'UTC',npm_config_cache:join(home,'npm-cache'),GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.fsmonitor',GIT_CONFIG_VALUE_0:'false'};
async function call(command,args,expected=0){
 const r=spawnSync(command,args,{cwd:root,env,encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
 let data;try{data=JSON.parse(r.stdout);}catch{data={raw:r.stdout};}
 observations.push({command,args,exit:r.status,signal:r.signal,error:r.error?.message??null,stderr:r.stderr,data});
 await writeFile(join(home,'observations.json'),JSON.stringify({home,observations},null,2)+'\n',{mode:0o600});
 assert.equal(r.status,expected,JSON.stringify(data));return data;
}
console.log('Retained private workspace '+home);
const cli=join(root,'bin/plates.mjs');
const inventory=await call(process.execPath,[cli,'retro','evaluations','corpus','inspect','--json']);
assert.equal(inventory.development,6); assert.equal(inventory.heldOut,0);
assert.equal(inventory.execution,'not-run'); assert.equal(inventory.efficacy,'unavailable');
assert.deepEqual(new Set(inventory.cases.map(c=>c.taskClass)),new Set(['compatibility','recovery','initialization','scoped-repair','integration','control']));
for(const c of inventory.cases){
 const destination=join(home,c.id);
 const args=[cli,'retro','evaluations','corpus','export','--case',c.id,'--repository',root,'--destination',destination,'--json'];
 const preview=await call(process.execPath,args,3);
 await call(process.execPath,[...args,'--yes','--digest','0'.repeat(64)],2);
 const written=await call(process.execPath,[...args,'--yes','--digest',preview.digest]);
 assert.equal(written.written,true); assert.equal(written.digest,preview.digest);
 for(const f of preview.input.files){
  assert.ok(!f.path.startsWith('/')&&!f.path.split('/').includes('..'));
  const bytes=await readFile(join(destination,f.path));
  assert.equal(bytes.length,f.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256);
 }
 await call(process.execPath,[...args,'--yes','--digest',preview.digest],2);
 for(const f of preview.input.files) assert.equal(createHash('sha256').update(await readFile(join(destination,f.path))).digest('hex'),f.sha256);
}
const consumer=join(home,'consumer');await mkdir(consumer,{mode:0o700});
await writeFile(join(consumer,'package.json'),JSON.stringify({name:'acme-corpus-consumer',version:'1.0.0',private:true}));
const packed=await call('npm',['pack','--ignore-scripts','--json','--pack-destination',home]);
assert.equal(packed.length,1);
await call('npm',['install','--prefix',consumer,'--offline','--ignore-scripts','--no-audit','--no-fund','--json',join(home,packed[0].filename)]);
const installed=join(consumer,'node_modules/plates/bin/plates.mjs');
const packaged=await call(process.execPath,[installed,'retro','evaluations','corpus','inspect','--json']);
assert.equal(packaged.catalogDigest,inventory.catalogDigest);
assert.deepEqual(packaged.cases.map(c=>({id:c.id,digest:c.caseDigest})),inventory.cases.map(c=>({id:c.id,digest:c.caseDigest})));
assert.equal(packaged.heldOut,0);
console.log(JSON.stringify({home,package:packed[0].filename,observations:observations.length}));
