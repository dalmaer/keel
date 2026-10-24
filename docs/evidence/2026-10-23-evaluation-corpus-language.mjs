// Independent bounded-language controls; no model or arbitrary documentation execution.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
const root = resolve(process.argv[2] ?? '.');
const home = await realpath(await mkdtemp(join(tmpdir(), 'acme-corpus-language-')));
console.log('Retained private workspace ' + home);
const { preflightDocker, runDockerStage } = await import(root + '/lib/evaluation-docker.mjs');
const image = await preflightDocker({ image: 'sha256:6449e19d8184d84062525b6a7524def03146c2cb04a7f08b076680d0e8e4240a', platform: 'linux/arm64' });
const revision = '35f392620e8e06f0038e1e88370be9b0958b3f19';
const paths = ['docs/development/validation-preflight.md','scripts/validation-budget.mjs','lib/validation-budget.mjs'];
const source = Object.fromEntries(paths.map(path => [path, execFileSync('git',['show',revision+':'+path],{cwd:root,encoding:'utf8'})]));
const document = source[paths[0]];
const start = document.indexOf('For the first run,');
const end = document.indexOf('Preview a source gate', start);
assert.ok(start > 0 && end > start);
// Independently authored positive procedure, not copied from the historical fix.
const independent = `For initial use, choose a new coordinator directory that does not exist under a canonical parent directory that already exists.
Let the wrapper create the private state directory; do not create it yourself.
If a state directory already exists without \`state.json\`, leave it intact and expect refusal, including when it is empty.
If initialization races, the other caller may be refused.
Inspect the original directory and participating processes before any recovery decision; never reset, delete or repair the directory automatically.

`;
const replace = text => document.slice(0,start)+text+document.slice(end);
const cases = [
 {name:'independent-correct-procedure', doc:replace(independent), accepted:true},
 {name:'reordered-correct-obligations',doc:replace(independent.trim().split('\n').reverse().join('\n')+'\n\n'),accepted:true},
 {name:'contradictory-precreation',doc:replace(independent+'Create the state directory before running the wrapper.\n\n'), reason:'unsupported or contradictory first-use statement'},
 {name:'negated-absent-path',doc:replace(independent.replace('does not exist','already exists')),reason:'unsupported or contradictory first-use statement'},
 {name:'missing-no-precreation',doc:replace(independent.replace('Let the wrapper create the private state directory; do not create it yourself.\n','')),reason:'missing first-use obligation: no-precreation'},
 {name:'shell-command-suffix',doc:replace(independent).replace('--json -- npm run check','--json -- npm run check; node -e "process.exit(0)"'),reason:'unsupported documented command form'},
 {name:'extra-command-line',doc:replace(independent).replace('--json -- npm run check\n','--json -- npm run check\nnode -e "process.exit(0)"\n'),reason:'unsupported documented command form'},
];
const {corpusDefinition}=await import(root+'/lib/evaluation-corpus.mjs');
const definition=await corpusDefinition('coordinator-guidance');
const probe=Buffer.from(definition.probes[0].base64,'base64').toString('utf8');
const acceptanceInput=JSON.parse(definition.acceptance.content).checks[0].stdin;
// Negative controls instrument the subprocess boundary only. Any attempt to
// execute git/npm/the coordinator before refusing malformed guidance fails.
const guard="import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module'; cp.spawnSync=()=>{throw Error('ACME_UNEXPECTED_SUBPROCESS')};syncBuiltinESMExports();await import('./coordinator-guidance.mjs');\n";
const results=[];
for(const c of cases){
 const entries={...source,[paths[0]]:c.doc,'probes/coordinator-guidance.mjs':probe,...(!c.accepted?{'probes/acme-command-guard.mjs':guard}:{})};
 const files=Object.entries(entries).map(([path,body])=>({path,mode:'100644',base64:Buffer.from(body).toString('base64')}));
 const stage=await runDockerStage({name:'plates-eval-acme-'+randomBytes(8).toString('hex'),image,files,argv:['node',c.accepted?'/work/probes/coordinator-guidance.mjs':'/work/probes/acme-command-guard.mjs'],stdin:acceptanceInput,deadline:Date.now()+90000});
 await writeFile(join(home,c.name+'.json'),JSON.stringify({revision,name:c.name,accepted:c.accepted??false,reason:c.reason??null,stage},null,2)+'\n',{flag:'wx',mode:0o400});
 assert.equal(stage.setup,'passed');assert.equal(stage.termination.state,'terminated');
 if(c.accepted){assert.equal(stage.output.exit,0,stage.output.stderr);assert.equal(stage.output.stdout,'Acme coordinator guidance accepted\n');}
 else{assert.equal(stage.output.exit,1);assert.ok(stage.output.stderr.includes(c.reason),stage.output.stderr);assert.ok(!stage.output.stderr.includes('ACME_UNEXPECTED_SUBPROCESS'));}
 results.push({name:c.name,stage});console.log(JSON.stringify({name:c.name,exit:stage.output.exit,stdout:stage.output.stdout,reason:c.reason??'actual pinned CLI initialization/run and empty-state refusal passed'}));
}
await writeFile(join(home,'summary.json'),JSON.stringify({home,revision,results},null,2)+'\n',{flag:'wx',mode:0o400});
