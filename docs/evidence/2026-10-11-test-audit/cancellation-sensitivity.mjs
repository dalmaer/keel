import {mkdtemp, mkdir, readFile, writeFile, symlink, readdir, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root='/Users/dionalmaer/code/plates';
const tmp=await mkdtemp('/tmp/plates-cancellation-sensitivity-');
try {
 await mkdir(join(tmp,'lib')); await mkdir(join(tmp,'tests'));
 for(const name of await readdir(join(root,'lib'))) if(name!=='evidence.mjs') await symlink(join(root,'lib',name),join(tmp,'lib',name));
 await symlink(join(root,'practices'),join(tmp,'practices'));
 await symlink(join(root,'tests/fixtures'),join(tmp,'tests/fixtures'));
 await symlink(join(root,'tests/helpers'),join(tmp,'tests/helpers'));
 await writeFile(join(tmp,'tests/evidence.test.mjs'),await readFile(join(root,'tests/evidence.test.mjs')));
 const source=await readFile(join(root,'lib/evidence.mjs'),'utf8');
 for(const [name, old, replacement, expected] of [
  ['signal-not-registered', "for (const [sig, fn] of handlers) process.on(sig, fn);", "// registration removed", 'cancellation must settle before the command deadline'],
  ['signal-listener-leak', "for (const [sig, fn] of handlers) process.off(sig, fn);", "// cleanup removed", 'leaked SIGINT listener'],
 ]) {
  assert.ok(source.includes(old));
  await writeFile(join(tmp,'lib/evidence.mjs'),source.replace(old,replacement));
  const r=spawnSync(process.execPath,['--import',join(root,'tests/helpers/hermetic.mjs'),'--test','--test-name-pattern=measurement cancellation',join(tmp,'tests/evidence.test.mjs')],{encoding:'utf8',maxBuffer:4e6});
  await writeFile(`/tmp/plates-test-audit/mutation-${name}.log`,r.stdout+r.stderr);
  assert.equal(r.status,1,name); assert.ok((r.stdout+r.stderr).includes(expected),`${name}: wrong failure`);
  console.log(`${name}: rejected at intended assertion`);
 }
} finally {await rm(tmp,{recursive:true,force:true});}
