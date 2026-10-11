// Focused failing variants only; source transformation is in-memory, never a repository write.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const root = '/Users/dionalmaer/code/keel';
const variants = [
 ['candidate-unchanged','tests/release.test.mjs','^a release with no change under practices/', 'rehearsal keeps the unchanged practice'],
 ['candidate-next-patch','tests/release.test.mjs','^a release with no change under practices/', 'rehearsal proposes the next CLI patch'],
 ['candidate-non-self','tests/release.test.mjs','^release refuses outside keel,', 'Missing expected exception'],
 ['transport-space','tests/canvas-sync.test.mjs','^public CLI transport uses argument arrays,', 'space admission queries the exact selected space'],
 ['transport-groups','tests/canvas-sync.test.mjs','^public CLI transport uses argument arrays,', 'group recovery lists the exact canvas'],
];
const results=[];
for (const [mutation,file,pattern,assertion] of variants) {
 const args=['--import','./tests/helpers/hermetic.mjs','--import','/tmp/keel-test-audit/boundary-mutation-loader.mjs','--test',`--test-name-pattern=${pattern}`,file];
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('NODE_TEST_')));
 const r=spawnSync(process.execPath,args,{cwd:root,env:{...env,KEEL_AUDIT_MUTATION:mutation},encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
 const output=(r.stdout??'')+(r.stderr??'');const log='/tmp/keel-test-audit/boundary-'+mutation+'.log';writeFileSync(log,output);
 const caught=r.status===1 && output.includes('AUDIT_MUTATION_APPLIED '+mutation) && output.includes(assertion) && /ERR_ASSERTION/.test(output) && /ℹ fail 1\b/.test(output);
 results.push({mutation,file,pattern,assertion,exitCode:r.status,signal:r.signal,error:r.error?.message??null,caughtAtIntendedAssertion:caught,log});
}
writeFileSync('/tmp/keel-test-audit/boundary-sensitivity.json',JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));
if(results.some(r=>!r.caughtAtIntendedAssertion))process.exitCode=1;
