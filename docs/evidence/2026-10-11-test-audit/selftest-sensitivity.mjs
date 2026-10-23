import {mkdtemp, mkdir, readFile, writeFile, symlink, readdir, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root='/Users/dionalmaer/code/plates';
const tmp=await mkdtemp('/tmp/plates-selftest-sensitivity-');
try {
 await mkdir(join(tmp,'lib')); await mkdir(join(tmp,'tests'));
 for(const name of await readdir(join(root,'lib'))) if(name!=='improve.mjs') await symlink(join(root,'lib',name),join(tmp,'lib',name));
 await symlink(join(root,'practices'),join(tmp,'practices'));
 await symlink(join(root,'tests/fixtures'),join(tmp,'tests/fixtures'));
 await writeFile(join(tmp,'tests/improve-selftest.test.mjs'),await readFile(join(root,'tests/improve-selftest.test.mjs')));
 const source=await readFile(join(root,'lib/improve.mjs'),'utf8');
 const old="const missed = results.filter(r => r.state !== 'outside');";
 assert.ok(source.includes(old));
 for(const [name, replacement, expected] of [
  ['first-miss-only',"const missed = results.filter(r => r.state !== 'outside').slice(0, 1);",'all misses, in declared order'],
  ['ignore-unavailable',"const missed = results.filter(r => r.state !== 'outside' && r.state !== 'n/a');",'n/a: selftest passed'],
  ['ignore-broken',"const missed = results.filter(r => r.state !== 'outside' && r.state !== 'broken');",'throws: selftest passed'],
 ]) {
  await writeFile(join(tmp,'lib/improve.mjs'),source.replace(old,replacement));
  const r=spawnSync(process.execPath,['--import',join(root,'tests/helpers/hermetic.mjs'),'--test',join(tmp,'tests/improve-selftest.test.mjs')],{encoding:'utf8',maxBuffer:4e6});
  await writeFile(`/tmp/plates-test-audit/mutation-${name}.log`,r.stdout+r.stderr);
  assert.equal(r.status,1,name); assert.ok((r.stdout+r.stderr).includes(expected),`${name}: wrong failure`);
  console.log(`${name}: rejected at intended assertion`);
 }
} finally {await rm(tmp,{recursive:true,force:true});}
