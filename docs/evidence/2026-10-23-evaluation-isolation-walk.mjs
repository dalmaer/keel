// Offline historical compatibility proof. No model invocation or efficacy claim.
import {readFile,writeFile,mkdir,mkdtemp,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
export async function inputs(root){
const {acmeEvaluationPlan}=await import(pathToFileURL(join(root,'tests/helpers/evaluation-plan.mjs')));
const {sealRecord,byteDigest}=await import(pathToFileURL(join(root,'lib/evaluation-records.mjs')));
const home=await realpath(await mkdtemp(join(tmpdir(),'plates-phase118-owner-'))), input=join(home,'inputs');await mkdir(input,{mode:0o700});
const manifest=join(input,'workspace.json'), admission=join(input,'managed.json');
await writeFile(manifest,JSON.stringify({version:1,id:'acme-workspace',name:'Acme',repo:'Acme/private',projects:[{id:'plates',repo:'dalmaer/plates'}]}),{mode:0o600});
await writeFile(admission,JSON.stringify([{repo:'dalmaer/plates',role:'managed'}]),{mode:0o600});
const probe=PUBLIC_PROBE;
const ref=r=>({kind:r.kind,id:r.id,digest:r.digest});
const environment={image:'sha256:6449e19d8184d84062525b6a7524def03146c2cb04a7f08b076680d0e8e4240a',platform:'linux/arm64',dependencyLock:byteDigest('no-external-dependencies'),installer:byteDigest('npm-pack-install-offline-ignore-scripts')};
const results=[];
for(const[label,revision]of [['broken','edfc56476dd4b7880d8bba83a13436b5a3887a5a'],['corrected','fa7477f2ea26bf56cb0e5f6f5a0904cf213a4e72']]){
const b=acmeEvaluationPlan(),base=b.materials[0];
const checks=sealRecord({...base,id:'acme-private-checks',mediaType:'application/json',content:JSON.stringify({schemaVersion:1,driver:'stdio-v1',checks:[{id:'installed-entrypoints',argv:['node','/work/probe.mjs'],stdin:'',stdout:JSON.stringify({cli:{status:0,stdout:'47\n'},api:{status:0,stdout:'43\n'},files:['bin/plates-command.cjs','package.json','src/plates-entry.mjs']})+'\n',exitCode:0}]})});
const publicProbe=sealRecord({...base,id:'acme-public-probe',content:probe});const submitter=sealRecord({...base,id:'acme-submitter',content:SUBMITTER});b.materials=[checks,publicProbe,submitter];
const c=sealRecord({...b.cases[0],repository:'dalmaer/plates',startingCommit:revision,environment,allowlist:{tools:['pinned-image-tools'],network:[],paths:['lib/rename.mjs']},prerequisites:[],requirements:['Existing installed CLI and module interfaces survive the rename'],acceptanceManifest:ref(checks),provenance:['Historical compatibility/package-entry: edfc5647 -> fa7477f2; scripted known-source machinery replay, not agent efficacy'],exposure:[{actor:'conductor',at:new Date().toISOString(),reason:'Public historical development replay; original fix inspected'}]});b.cases=[c];
b.configurations=b.configurations.map(x=>sealRecord({...x,environment,provider:'offline',runtime:{...x.runtime,name:'scripted-node-v1',version:'1'},context:[],overlays:[{path:'probe.mjs',material:ref(publicProbe)},{path:'submit.mjs',material:ref(submitter)}],routing:{...x.routing,provider:'offline'}}));
b.comparison=sealRecord({...b.comparison,id:`acme-historical-${label}`,repository:'dalmaer/plates',authority:{kind:'phase',ref:'118'},baseline:ref(b.configurations[0]),candidate:ref(b.configurations[1]),cases:[ref(c)],pairs:b.comparison.pairs.map(p=>({...p,case:ref(c)})),retention:{days:30,maxBytes:4194304,maxEvents:100}});
const path=join(input,`${label}.json`);await writeFile(path,JSON.stringify(b,null,2),{mode:0o600});results.push({label,revision,bundle:path,experiment:b.comparison.id});
}
return {home,manifest,admission,state:join(home,'state'),results};
}

const PUBLIC_PROBE="// Synthetic Acme consumer. Public behavior probe; expectations live in the controller.\nimport {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';\nimport {join,dirname} from 'node:path';\nimport {execFileSync,spawnSync} from 'node:child_process';\nimport {applyRename} from './lib/rename.mjs';\nconst home=await mkdtemp('/tmp/acme-consumer-'), root=join(home,'package'), consumer=join(home,'installed');\nawait mkdir(root);await mkdir(consumer);\nconst files={\n '.keel/keel.json':JSON.stringify({name:'Acme',repo:'Acme/widget',practices:[]}),\n 'package.json':JSON.stringify({name:'acme-package',version:'1.0.0',type:'module',bin:{'acme-cli':'bin/keel-command.cjs'},exports:{'.':'./src/keel-entry.mjs'},files:['bin/keel-command.cjs','src/keel-entry.mjs']}),\n 'bin/keel-command.cjs':'#!/usr/bin/env node\\nconsole.log(47);\\n',\n 'src/keel-entry.mjs':'export default 43;\\n'\n};\nfor(const[p,s]of Object.entries(files)){await mkdir(dirname(join(root,p)),{recursive:true});await writeFile(join(root,p),s);}\nconst git=(...a)=>execFileSync('git',['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false','-C',root,...a],{encoding:'utf8',stdio:['ignore','pipe','pipe']});\ngit('init','-q');git('add','.');git('-c','user.name=Acme','-c','user.email=acme@example.test','commit','-qm','Acme input');\nawait applyRename(root);\nconst command=(bin,args,cwd)=>{const r=spawnSync(bin,args,{cwd,encoding:'utf8',timeout:15000,maxBuffer:65536});return {status:r.status,stdout:r.stdout,stderr:r.stderr};};\nconst pack=command('npm',['pack','--offline','--ignore-scripts','--json'],root);\nif(pack.status!==0){console.log(JSON.stringify({stage:'pack',status:pack.status}));process.exit(0);}\nconst packed=JSON.parse(pack.stdout)[0];\nconst install=command('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund',join(root,packed.filename)],consumer);\nif(install.status!==0){console.log(JSON.stringify({stage:'install',status:install.status}));process.exit(0);}\nconst pkg=JSON.parse(await readFile(join(consumer,'node_modules/acme-package/package.json'),'utf8'));\nconst cli=command('node',[join(consumer,'node_modules/acme-package',pkg.bin['acme-cli'])],consumer);\nconst api=command('node',['--input-type=module','-e',\"import v from 'acme-package';console.log(v)\"],consumer);\nconsole.log(JSON.stringify({cli:{status:cli.status,stdout:cli.stdout},api:{status:api.status,stdout:api.stdout},files:packed.files.map(f=>f.path).sort()}));\n";
const SUBMITTER="// Synthetic offline builder: submits existing regular files without changing them.\nimport {readdir,readFile,lstat} from 'node:fs/promises';import {join} from 'node:path';\nconst files=[];async function walk(relative=''){for(const n of (await readdir(join('/work',relative))).sort()){const p=relative?relative+'/'+n:n,s=await lstat(join('/work',p));if(s.isDirectory())await walk(p);else if(s.isFile())files.push({path:p,mode:s.mode&0o111?'100755':'100644',base64:(await readFile(join('/work',p))).toString('base64')});else throw Error('nonregular submission');}}await walk();console.log(JSON.stringify({schemaVersion:1,files}));\n";
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=process.argv[2], p=await inputs(root), observations=[];
const env={...process.env,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.fsmonitor',GIT_CONFIG_VALUE_0:'false',TZ:'UTC'};
async function call(args,expected=0){
const r=spawnSync(process.execPath,[join(root,'bin/plates.mjs'),...args],{cwd:root,env,encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});
let data;try{data=JSON.parse(r.stdout)}catch{data={raw:r.stdout}};
observations.push({command:[process.execPath,join(root,'bin/plates.mjs'),...args],exit:r.status,error:r.error?.message??null,stderr:r.stderr,data});
await writeFile(join(p.home,'walk.json'),JSON.stringify({paths:p,observations},null,2),{mode:0o600});
if(r.status!==expected)throw Error(`Expected${expected}, got${r.status}: ${JSON.stringify(data)}`);return data;
}
console.log('Retained workspace '+p.home);
await call(['workspace','init','--manifest',p.manifest,'--state',p.state,'--yes','--json']);
for(const item of p.results){
const base=['retro','evaluations'];const binding=['--manifest',p.manifest,'--state',p.state];
const freeze=[...base,'freeze',...binding,'--bundle',item.bundle,'--json'];
const preview=await call(freeze,3);await call([...freeze,'--yes','--digest',preview.digest]);
const frozenPath=join(p.state,'session-trials',item.experiment,'state.json'), frozen=await readFile(frozenPath,'utf8');
const request={schemaVersion:1,pairId:'acme-pair-0',arm:'baseline',repository:root,sourcePaths:['lib/rename.mjs'],builderArgv:['node','/work/submit.mjs'],admission:{stateDir:join(p.home,'admission'),manifest:p.admission,capacity:1,weight:1,repo:'dalmaer/plates'}};
const execution=join(p.home,'inputs',item.label+'-execution.json');await writeFile(execution,JSON.stringify(request,null,2),{mode:0o600});
const run=[...base,'run',...binding,'--experiment',item.experiment,'--execution',execution,'--json'];
const proposed=await call(run,3);await call([...run,'--yes','--digest','0'.repeat(64)],2);const result=await call([...run,'--yes','--digest',proposed.digest]);
assert.equal(result.status,'terminal');assert.equal(result.verdict.acceptance,item.label==='broken'?'rejected':'accepted');assert.equal(result.result.settlement.released,true);assert.equal(result.result.resources.currencyUsd,null);
console.log(JSON.stringify({label:item.label,status:result.status,acceptance:result.verdict.acceptance,verdictDigest:result.verdict.digest,wallMs:result.result.resources.wallMs}));
const recovered=await call([...run,'--yes','--digest',proposed.digest]);assert.equal(recovered.recovered,true);assert.equal(recovered.records.verdict.digest,result.verdict.digest);assert.equal(await readFile(frozenPath,'utf8'),frozen);
await call([...base,'inspect',...binding,'--experiment',item.experiment,'--json']);
}
console.log('Retained operations '+observations.length+' in '+join(p.home,'walk.json'));
