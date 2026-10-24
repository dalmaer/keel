// Synthetic Acme setup only; no test registration and no execution authority.
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm, cp, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { run, cleanEnv } from './run.mjs';
import { acmeEvaluationPlan } from './evaluation-plan.mjs';
import { byteDigest, sealRecord } from '../../lib/evaluation-records.mjs';
const ROOT=resolve(fileURLToPath(new URL('../..',import.meta.url))),AT='2026-10-24T00:00:00.000Z',BODY='Acme private selected review evidence. Keep its complete body private.';
const reference=r=>({kind:r.kind,id:r.id,digest:r.digest});
async function temp(t){const root=await realpath(await mkdtemp(join(tmpdir(),'acme-learning-')));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
export async function evaluatedLearningWorld(t, { realDocker = false, screeningCriteria = null, resolvedModel = null, retention = {days:30,maxBytes:64*1024*1024,maxEvents:1000} } = {}) {
  const root=await temp(t),app=join(root,'app'),repo=join(root,'repo');await mkdir(app);await mkdir(repo);await cp(join(ROOT,'bin'),join(app,'bin'),{recursive:true});await cp(join(ROOT,'package.json'),join(app,'package.json'));
  await cp(join(ROOT,'lib'),join(app,'lib'),{recursive:true});await cp(join(ROOT,'migrations'),join(app,'migrations'),{recursive:true});await cp(join(ROOT,'practices'),join(app,'practices'),{recursive:true});
  await mkdir(join(repo,'.plates'));await mkdir(join(repo,'docs/phases'),{recursive:true});await mkdir(join(repo,'docs/inbox'));
  await writeFile(join(repo,'.plates/plates.json'),JSON.stringify({plates:'self',repo:'Acme/widget'}));
  await writeFile(join(repo,'docs/phases/1-acme.md'),'---\nstatus: designed\n---\n# Acme behavior\n\n## Done when\n\nAcme behavior is checked.\n');
  await writeFile(join(repo,'acme.mjs'),'export default 1;\n');
  const git=args=>{const r=run('git',['-c','core.fsmonitor=false','-C',repo,...args]);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  git(['init','-q']);git(['add','.']);git(['commit','-qm','Acme source']);git(['remote','add','origin','https://github.com/Acme/widget.git']);const sha=git(['rev-parse','HEAD']);
  // A synthetic installed corpus, verified through the production catalog/closure reader.
  // No real project incident or identity is copied into the test fixtures.
  const catalog={schemaVersion:1,createdAt:AT,repository:'Acme/widget',license:'Apache-2.0',image:realDocker?'sha256:6449e19d8184d84062525b6a7524def03146c2cb04a7f08b076680d0e8e4240a':'sha256:'+'a'.repeat(64),platform:'linux/arm64',probeHeaders:{},cases:[]};
  for(let i=0;i<6;i++){const probe='acme-probe.mjs',header='// Acme synthetic protected check. Apache-2.0.\n';await writeFile(join(app,'lib/evaluation-corpus/probes',probe),header+'console.log("Acme");\n');catalog.probeHeaders[probe]=header;catalog.cases.push({id:`acme-case-${i}`,version:1,taskClass:i===1?'control':'compatibility',start:sha,fix:'f'.repeat(40),sources:[{path:'acme.mjs',blob:git(['rev-parse',sha+':acme.mjs']),bytes:18,sha256:byteDigest('export default 1;\n')}],writable:['acme.mjs'],probe,support:[],stdout:'Acme\n',brief:'Check Acme behavior.',requirements:['Acme stays correct.'],coverageLimits:['Synthetic development case.'],closure:{sourcePaths:['acme.mjs']}});}
  await writeFile(join(app,'lib/evaluation-corpus/catalog.json'),JSON.stringify(catalog));
  const load=name=>import(pathToFileURL(join(app,'lib',name+'.mjs'))),corpus=await load('evaluation-corpus'),ledger=await load('evaluation-ledger'),workspace=await load('web/workspace'),learning=await load('evaluated-learning'),review=await load('review');
  const d0=await corpus.corpusDefinition('acme-case-0'),d1=await corpus.corpusDefinition('acme-case-1'),b=acmeEvaluationPlan();b.cases=[d0.task,d1.task];b.materials=[...new Map([...d0.materials,...d1.materials].map(m=>[m.id,m])).values()];
  const extra=sealRecord({schemaVersion:2,kind:'material',id:'acme-public-check',createdAt:AT,mediaType:'text/plain',content:'console.log("Acme public material");\n'});b.materials.push(extra);
  const overlays=[...new Map([...d0.probes,...d1.probes].map(p=>[p.path,p])).values()].map(p=>{const m=b.materials.find(m=>m.content===Buffer.from(p.base64,'base64').toString());return {path:p.path,material:reference(m)};});
  if(realDocker){
    const builder=sealRecord({schemaVersion:2,kind:'material',id:'acme-builder',createdAt:AT,mediaType:'text/plain',content:'import {readFileSync} from "node:fs";console.log(JSON.stringify({schemaVersion:1,files:[{path:"acme.mjs",mode:"100644",base64:readFileSync("acme.mjs").toString("base64")}]}));'});
    b.materials.push(builder);overlays.push({path:'acme-builder.mjs',material:reference(builder)});
    b.configurations=b.configurations.map(c=>({...c,provider:'offline',model:resolvedModel?{requested:resolvedModel,resolved:resolvedModel,unresolvedReason:null}:c.model,runtime:{...c.runtime,name:'scripted-node-v1'},routing:{...c.routing,provider:'offline'}}));
  }
  b.configurations=b.configurations.map((c,i)=>sealRecord({...c,harnessCommit:sha,environment:d0.task.environment,overlays:[...overlays,...(i?[{path:'acme-checks/entry.mjs',material:reference(extra)}]:[])]}));
  b.comparison=sealRecord({...b.comparison,authority:{kind:'phase',ref:'1'},baseline:reference(b.configurations[0]),candidate:reference(b.configurations[1]),cases:b.cases.map(reference),pairs:b.cases.flatMap(c=>Array.from({length:5},(_,i)=>({id:c.id+'-pair-'+i,case:reference(c),order:i%2?'BA':'AB'}))),allowance:{minutes:50,currencyUsd:null},retention,promotion:{automatic:false,criteria:screeningCriteria}});
  const inputs=join(root,'inputs');await mkdir(inputs,{mode:0o700});const manifest=join(inputs,'workspace.json'),bundle=join(inputs,'bundle.json'),state=join(root,'state');await writeFile(manifest,JSON.stringify({version:1,id:'acme',name:'Acme',repo:'Acme/private',projects:[{id:'widget',repo:'Acme/widget'}]}));await writeFile(bundle,JSON.stringify(b));const options={manifest,state,appRoot:app};await workspace.initializeWorkspace(options);const draft=await ledger.evaluations({...options,bundle,action:'freeze'});await ledger.evaluations({...options,bundle,action:'freeze',yes:true,digest:draft.digest});
  const managed=join(inputs,'managed.json'),execution=join(inputs,'execution.json');
  await writeFile(managed,JSON.stringify([{repo:'Acme/widget',role:'managed'}]),{mode:0o600});
  const executionRequest={schemaVersion:1,pairId:b.comparison.pairs[0].id,arm:'baseline',repository:repo,sourcePaths:['acme.mjs'],builderArgv:['node','/work/acme-builder.mjs'],admission:{stateDir:join(root,'host-budget'),manifest:managed,capacity:1,weight:1,repo:'Acme/widget'}};
  await writeFile(execution,JSON.stringify(executionRequest),{mode:0o600});
  const conn=nodes=>({pageInfo:{hasNextPage:false,endCursor:null},nodes});const remote={pr:{number:3,title:'Acme change',state:'OPEN',mergedAt:null,url:'https://github.com/Acme/widget/pull/3',headRefOid:'b'.repeat(40),author:{login:'acme'},reviewThreads:conn([]),comments:conn([]),reviews:conn([{id:'PRR_acme',databaseId:11,author:{login:'acme'},body:BODY,commit:{oid:sha},state:'COMMENTED',submittedAt:AT,url:'https://github.com/Acme/widget/pull/3#pullrequestreview-11'}])},reviews:[{id:11,node_id:'PRR_acme',user:{login:'acme'},body:BODY,state:'COMMENTED',submitted_at:AT,commit_id:sha,pull_request_url:'https://api.github.com/repos/Acme/widget/pulls/3'}]};
  const transport=join(root,'github.json'),exe=join(root,'gh');await writeFile(transport,JSON.stringify(remote));await writeFile(exe,`#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2),d=JSON.parse(fs.readFileSync(${JSON.stringify(transport)}));if(a[1]==='graphql')console.log(JSON.stringify({data:{repository:{pullRequest:d.pr}}}));else if(a[1].startsWith('repos/Acme/widget/pulls/3/reviews?'))console.log(JSON.stringify(d.reviews));else process.exit(90);\n`);await chmod(exe,0o700);const env={...cleanEnv(),PLATES_GH:exe,PLATES_CACHE:join(root,'cache')};await review.review({root:repo,target:'Acme/widget#3'},{env});
  const contentPath=join(inputs,'public.mjs');await writeFile(contentPath,extra.content,{mode:0o600});
  const selector={kind:'github-review',repo:'Acme/widget',prNumber:3,reviewId:11,threadId:null,commentId:null,reviewedHead:sha,expectedBodySha256:byteDigest(BODY)};
  const classification={value:'reviewer-statement',attribution:'manual',actor:'Acme reviewer',rationale:'Acme selected finding'};
  const scope={repositories:['Acme/widget'],paths:['acme-checks/entry.mjs'],taskClasses:['compatibility']};
  const lesson={failure:'Acme check omitted.',scope,applicability:'Acme entry work.',reviewCondition:'Review after Acme entry changes.',existingProtections:[{repo:'Acme/widget',revision:sha,path:'acme.mjs',sha256:byteDigest('export default 1;\n'),assessment:'Acme existing behavior is narrower.'}],hypothesisOfFailure:'Acme validation missed consumers.',related:[]};
  const call=async(action,payload,{apply=false,previous=null,slug='2026-10-24-acme',request:provided=null}={})=>{const request=provided??{schemaVersion:1,operationId:randomUUID(),expected:{fileDigest:previous?.outputDigest??null,generation:previous?.generation??0},actor:'Acme owner',at:AT,reason:'Acme explicit evaluation',action,payload,decisionTarget:{kind:'phase',ref:'1'}};const input=join(inputs,request.operationId+'.json');await writeFile(input,JSON.stringify(request),{mode:0o600});const opts={...options,dir:repo,slug,input,env,action:['bind-plan','register-screening'].includes(action)?'plan':['reject','supersede','evaluate'].includes(action)?'decide':'propose'};const preview=await learning.evaluatedLearning(opts);return {request,opts,preview,result:apply?await learning.evaluatedLearning({...opts,yes:true,digest:preview.digest}):null};};
  const proposal=lessonRef=>({lessonRef,hypothesis:'Acme consumer check prevents omissions.',candidate:{kind:'scoped-material-overlay-v1',repository:'Acme/widget',baseRevision:sha,changes:[{path:'acme-checks/entry.mjs',contentPath,expectedContentSha256:byteDigest(extra.content)}],scope:structuredClone(scope)},expectedBenefit:'Acme omissions detected.',downside:'Acme check adds latency.',mechanism:'check',owner:'Acme owner',baselineSelection:{experimentId:b.comparison.id,expectedPlanDigest:draft.digest,configurationRef:reference(b.configurations[0])}});
  const capture={inbox:{title:'Acme scoped finding',sanitizedClaim:'Acme entry validation needs a consumer check.'},selections:[{selector,classification}],lesson};
  return {root,repo,app,options,env,sha,b,draft,transport,call,capture,proposal,learning,contentPath,load,execution,executionRequest,managed};
}
