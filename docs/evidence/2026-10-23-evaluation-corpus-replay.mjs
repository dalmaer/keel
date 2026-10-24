// Conductor replay of exposed historical artifacts. No model or promotion claim.
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=resolve(process.argv[2]??'.');
const {corpusCatalog,corpusDefinition}=await import(pathToFileURL(join(root,'lib/evaluation-corpus.mjs')));
const {exportSource,validateFiles}=await import(pathToFileURL(join(root,'lib/evaluation-artifacts.mjs')));
const {preflightDocker,runDockerStage}=await import(pathToFileURL(join(root,'lib/evaluation-docker.mjs')));
const {fingerprint,byteDigest}=await import(pathToFileURL(join(root,'lib/evaluation-records.mjs')));
const {controllerIdentity}=await import(pathToFileURL(join(root,'lib/evaluation-provenance.mjs')));
const home=await realpath(await mkdtemp(join(tmpdir(),'acme-corpus-replay-')));
const controller=await controllerIdentity(), {catalog,catalogDigest}=await corpusCatalog();
console.log('Retained private workspace '+home);
const observations=[];
for(const c of catalog.cases){
 const d=await corpusDefinition(c.id), image=await preflightDocker(d.task.environment);
 const original=exportSource(root,c.start,c.sources.map(f=>f.path));
 for(const f of original){const expected=c.sources.find(s=>s.path===f.path);assert.equal(byteDigest(Buffer.from(f.base64,'base64')),expected.sha256,'curated source '+f.path);}
 const corrected=new Map(exportSource(root,c.fix,c.writable).map(f=>[f.path,f]));
 for(const witness of ['broken','corrected']) for(const mode of c.id==='canvas-retirement'?['off','remove-key']:[null]){
  const files=validateFiles([...original.map(f=>witness==='corrected'&&corrected.has(f.path)?corrected.get(f.path):f),...d.probes]);
  const name='plates-eval-acme-'+randomBytes(12).toString('hex');
  const intent={case:c.id,witness,mode,startingCommit:c.start,correctedWitness:c.fix,writable:c.writable,sourceDigest:fingerprint(original),filesDigest:fingerprint(files),caseDigest:d.task.digest,catalogDigest,controller,operation:name};
  const key=c.id+'-'+witness+(mode?'-'+mode:'');
  await writeFile(join(home,key+'-intent.json'),JSON.stringify(intent,null,2)+'\n',{flag:'wx',mode:0o400});
  const stage=await runDockerStage({name,image,files,argv:['node','/work/probes/'+c.probe,...(mode?[mode]:[])],stdin:JSON.parse(d.acceptance.content).checks[0].stdin,deadline:Date.now()+90000});
  const observation={intent,stage};
  await writeFile(join(home,key+'-result.json'),JSON.stringify(observation,null,2)+'\n',{flag:'wx',mode:0o400});
  observations.push(observation);
  console.log(JSON.stringify({case:c.id,witness,mode,setup:stage.setup,exit:stage.output?.exit,termination:stage.termination.state,record:key+'-result.json'}));
 }
}
await writeFile(join(home,'summary.json'),JSON.stringify({home,catalogDigest,controller,observations:observations.map(o=>({case:o.intent.case,witness:o.intent.witness,mode:o.intent.mode,operation:o.intent.operation,setup:o.stage.setup,exit:o.stage.output?.exit,termination:o.stage.termination.state})),scope:'scripted exposed development artifacts; no paid agent efficacy'},null,2)+'\n',{flag:'wx',mode:0o400});
for(const {intent,stage} of observations){
 const c=catalog.cases.find(c=>c.id===intent.case);
 assert.equal(stage.setup,'passed',intent.case+' setup');
 assert.equal(stage.error,null,intent.case+' infrastructure');
 assert.equal(stage.termination.state,'terminated',intent.case+' termination');
 if(intent.witness==='corrected'){
  assert.equal(stage.output.exit,0,intent.case+': '+stage.output.stderr);
  assert.equal(stage.output.stdout,c.stdout);
 }else{
  assert.notEqual(stage.output.exit,0,intent.case+' original must fail');
  assert.match(stage.output.stderr,/AssertionError|ERR_MODULE_NOT_FOUND/,intent.case+' original assertion');
  assert.doesNotMatch(stage.output.stderr,/Cannot find package|ENOENT.*spawn|SyntaxError/,intent.case+' invalid setup');
 }
}
console.log(JSON.stringify({home,observations:observations.length,status:'passed',efficacy:'unavailable'}));
