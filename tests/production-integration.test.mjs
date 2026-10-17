import { run } from './helpers/run.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { collect,spec,prepareIssue,productionCandidates,status } from '../lib/production.mjs';
import { defaultPlan,validatePlan } from '../lib/night-plan.mjs';
import { renderBrief } from '../practices/night/files/scripts/keel/morning.mjs';
import { page } from '../practices/night/files/scripts/keel/improve.mjs';
import { validateRobotRubric } from '../practices/climb/files/scripts/keel/robot-rubric.mjs';
import { recoverNight,validateEnvelope } from '../practices/night/files/scripts/keel/production-night.mjs';
import { render } from '../lib/practices.mjs';
import { readState,digest,transaction } from '../practices/night/files/scripts/keel/production-store.mjs';
const start='2026-10-16T10:00:00.000Z',end='2026-10-16T11:00:00.000Z';
const config={repo:'Acme/app',production:{version:1,enabled:true,sources:[{id:'acme',provider:'json',service:'acme',environment:'production',input:'events.json',windowMinutes:60,maxEvents:10,maxBytes:10000,timeoutMs:1000,threshold:2}]}};
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'acme-production-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'.keel'));await writeFile(join(root,'.keel/keel.json'),JSON.stringify(config));await writeFile(join(root,'events.json'),JSON.stringify({version:1,source:'acme',service:'acme',environment:'production',start,end,coverage:'complete',events:['a','b'].map(id=>({id,timestamp:'2026-10-16T10:30:00Z',message:'TypeError at src/acme.mjs:12:1'}))}));await collect({root,config,start,end,now:new Date(end),yes:true});return root;}
test('deterministic spec keeps reproduction blocker and uses robot rubric; projections show candidates/gaps',async t=>{
 const root=await fixture(t),state=await readState(root),incident=Object.keys(state.incidents)[0];
 const a=await spec({root,config,incident});assert.deepEqual(a,await spec({root,config,incident}));assert.ok(validateRobotRubric(a.rubric).ok);assert.equal(a.rubric.ownerBlockers.length,1);assert.match(a.rubric.reproduction,/baseline/);
 const candidates=await productionCandidates({root,config,now:new Date('2026-10-17T13:00:00Z')});assert.ok(candidates.some(c=>c.id.startsWith('production-')&&c.kind==='triage'));assert.ok(candidates.some(c=>c.id==='production-coverage'));
 const plan=defaultPlan({date:'2026-10-17',candidates});assert.ok(validatePlan(plan).ok);assert.ok(!plan.items.some(i=>i.kind==='build'));
 const reading=await status({root,config});assert.match(renderBrief({plan,production:reading}).markdown,/Production recurring/);
 assert.match(page({config,date:'2026-10-17',results:[],tightened:[],production:reading}),/Production recurring/);
});
test('issue preparation reuses durable ambiguous-POST recovery without duplicate writes or enabling robot',async t=>{
 const root=await fixture(t),incident=Object.keys((await readState(root)).incidents)[0],draft=await spec({root,config,incident});
 const rubric={...draft.rubric,reproduction:'Synthetic Acme baseline reproduction reviewed.',ownerBlockers:[]};
 let post=0,remote=null;
 const github=async req=>{
  if(req.method==='POST'){post++;const body=req.body?.body??req.data?.body;remote={number:7,state:'open',body,html_url:'https://github.com/acme/app/issues/7',url:'https://api.github.com/repos/acme/app/issues/7',labels:[]};throw new Error('connection lost');}
  if(req.path.includes('/issues?'))return {status:200,data:remote?[remote]:[]};
  if(req.path.endsWith('/issues/7'))return {status:200,data:remote};
  return {status:404};
 };
 const preview=await prepareIssue({root,incident,rubric},{github});assert.equal(preview.data.state,'preview');assert.equal(post,0);assert.ok(!preview.data.preview.labels.includes('keel:agent'));
 const result=await prepareIssue({root,incident,rubric,yes:true},{github});assert.equal(post,1);assert.equal(result.data.state,'recovered');
 await transaction(root,async state=>{state.incidents[incident].status='regressed';return {};});
 const again=await prepareIssue({root,incident,rubric,yes:true},{github});assert.equal(post,1);assert.equal(again.data.issue.number,7);assert.equal((await readState(root)).incidents[incident].status,'regressed');
});
test('artifact recovery restores newest exact attempt, refuses missing/expired/mismatched state without fallback',async t=>{
 const root=await fixture(t),snapshot=await readState(root),repo='Acme/app';
 const env={GITHUB_REPOSITORY:repo,GITHUB_REF_NAME:'main',BASE:'main',GITHUB_EVENT_NAME:'schedule',GITHUB_RUN_ID:'3',GITHUB_RUN_ATTEMPT:'1'};
 const run={id:2,run_attempt:1,head_sha:'a'.repeat(40),head_branch:'main',head_repository:{full_name:repo},repository:{full_name:repo},path:'.github/workflows/keel-night.yml',event:'schedule',pull_requests:[],status:'completed',run_started_at:'2026-10-17T09:00:00Z'};
 const envelope={version:1,state:'retained',provenance:{repo,workflow:run.path,runId:'2',attempt:1,headSha:run.head_sha},snapshot,digest:digest(snapshot)};
 const api=async path=>path.includes('/runs?')?{workflow_runs:[run],total_count:1}:path.includes('/contents/')?{encoding:'base64',content:Buffer.from(JSON.stringify(config)).toString('base64')}:{artifacts:[{name:'keel-production-1',expired:false,size_in_bytes:1000}],total_count:1};
 assert.equal((await recoverNight({root,config,env,api,download:async()=>envelope})).state,'restored');
 assert.equal((await recoverNight({root,config,env:{...env,GITHUB_EVENT_NAME:'workflow_run'},readOnly:true,api,download:async()=>envelope})).state,'restored');
 assert.throws(()=>validateEnvelope({...envelope,state:'unavailable'},run,repo),/unavailable/);
 assert.throws(()=>validateEnvelope({...envelope,provenance:{...envelope.provenance,attempt:2}},run,repo),/provenance/);
 await assert.rejects(()=>recoverNight({root,config,env,api:async path=>path.includes('/artifacts?')?{artifacts:[],total_count:0}:api(path),download:async()=>{throw new Error('must not download');}}),/missing/);
 await assert.rejects(()=>recoverNight({root,config,env,api:async path=>path.includes('/artifacts?')?{artifacts:[{name:'keel-production-1',expired:true,size_in_bytes:10}],total_count:1}:api(path),download:async()=>envelope}),/expired/);
 await assert.rejects(()=>recoverNight({root,config,env,api:async()=>({workflow_runs:[{id:2}],total_count:1})}),/provenance/);
 assert.equal((await recoverNight({root,config,env,api:async()=>({workflow_runs:[],total_count:0})})).state,'bootstrap');
 await assert.rejects(()=>recoverNight({root,config,env,api:async()=>({workflow_runs:[],total_count:101})}),/incomplete/);
});
test('CLI status/spec/help and managed night ordering are installed contracts',async t=>{
 const root=await fixture(t),bin=join(process.cwd(),'bin/keel.mjs');
 const statusRun=run(process.execPath,[bin,'production','status','--json'],{cwd:root});assert.equal(statusRun.status,0,statusRun.stderr||statusRun.stdout);const out=JSON.parse(statusRun.stdout);assert.equal(out.state,'observed');
 const help=run(process.execPath,[bin,'--agent-help','production']);assert.equal(help.status,0,help.stderr||help.stdout);assert.match(help.stdout,/equivalentProbe/);
 const workflow=await readFile('practices/night/files/.github/workflows/keel-night.yml','utf8');assert.ok(workflow.indexOf('Collect production evidence')<workflow.indexOf('Plan the night'));assert.match(workflow,/name: keel-production-\$\{\{ github.run_attempt \}\}/);assert.match(workflow,/VERCEL_TOKEN: \$\{\{ steps.config.outputs.production_vercel == 'true' && secrets.VERCEL_API_TOKEN \|\| '' \}\}/);
 const morningWorkflow=await readFile('practices/night/files/.github/workflows/keel-morning.yml','utf8');assert.ok(morningWorkflow.indexOf('production-night.mjs --restore-only') < morningWorkflow.indexOf('name: Send the brief'));
 const manifest=JSON.parse(await readFile('practices/night/practice.json'));for(const name of ['production.mjs','production-store.mjs','production-collectors.mjs','production-night.mjs'])assert.ok(manifest.files.some(f=>f.path==='scripts/keel/'+name));
});

test('audited start boundary bootstraps a long history without claiming previous coverage',async t=>{
 const root=await fixture(t),env={GITHUB_REPOSITORY:'Acme/app',GITHUB_REF_NAME:'main',BASE:'main',GITHUB_EVENT_NAME:'schedule',GITHUB_RUN_ID:'500',GITHUB_RUN_ATTEMPT:'1'};
 const prior={id:499,run_attempt:1,head_sha:'a'.repeat(40),head_branch:'main',head_repository:{full_name:'Acme/app'},repository:{full_name:'Acme/app'},path:'.github/workflows/keel-night.yml',event:'schedule',pull_requests:[],status:'completed',run_started_at:'2026-10-16T07:23:00Z'};
 const result=await recoverNight({root,config:{...config,production:{...config.production,since:'2026-10-17T10:00:00.000Z'}},env,api:async()=>({workflow_runs:[prior],total_count:499})});
 assert.equal(result.state,'bootstrap');assert.match(result.gap,/earlier coverage unavailable/);
});
test('fresh adopted installation runs production status, collect and verify without CLI template imports',async t=>{
 const root=await fixture(t);const installed={...config,name:'Acme',tagline:'Acme synthetic application',practices:['base','agents-md','night','delivery']};
 await writeFile(join(root,'.keel/keel.json'),JSON.stringify(installed));
 await render(root);
 const installedRun=run(process.execPath,[join(root,'scripts/keel/production.mjs'),'status','--json'],{cwd:root});assert.equal(installedRun.status,0,installedRun.stderr||installedRun.stdout);const result=JSON.parse(installedRun.stdout);assert.equal(result.state,'observed');
 const incident=result.incidents[0].id;
 const preview=await import('../lib/production.mjs');
 const v=await preview.productionRun(['verify','--incident',incident,'--revision','a'.repeat(40),'--yes','--json'],{root});assert.notEqual(v.data.state,'verified');assert.ok(v.data.gaps.includes('recorded-deployment-required'));assert.ok(v.data.gaps.includes('traffic-or-approved-equivalent-probe-required'));
 assert.equal((await render(root,{check:true})).ok,true);
});

test('public verification lifecycle records actual delivery probe then resolves only a covering complete observation',async t=>{
 const root=await fixture(t),site='https://acme.example';
 execFileSync('git',['init','-q','-b','main'],{cwd:root});
 execFileSync('git',['-c','user.name=Acme','-c','user.email=acme@example.test','commit','-q','--allow-empty','-m','Acme baseline'],{cwd:root});
 const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 const configured={...config,name:'Acme',tagline:'Acme synthetic application',practices:['base','agents-md','night','delivery'],delivery:{site,version:'/version',smoke:['/acme-probe']},production:{...config.production,sources:config.production.sources.map(s=>({...s,site,equivalentProbe:'/acme-probe'}))}};
 await writeFile(join(root,'.keel/keel.json'),JSON.stringify(configured));await render(root);
 const incident=Object.keys((await readState(root)).incidents)[0],{verify}=await import('../lib/production.mjs');
 const requests=[];const fetch=async url=>{
  requests.push({url,at:new Date().toISOString()});
  if(url.endsWith('/acme-probe')) await new Promise(resolve=>setTimeout(resolve,5));
  return new Response(url.endsWith('/version')?JSON.stringify({sha:revision}):'',{status:200});
 };
 const args={root,config:configured,incident,revision,probe:'/acme-probe',yes:true,fetch};
 const first=await verify(args);assert.notEqual(first.state,'verified');assert.ok(first.probeReceipt);assert.deepEqual(requests.map(r=>r.url),[site+'/version',site+'/acme-probe']);
 const second=await verify(args);assert.notEqual(second.state,'verified');assert.ok(first.probeReceipt.completedAt < second.probeReceipt.startedAt,'revision proof must precede the separate probe');
 assert.ok(second.probeReceipt.startedAt <= requests[3].at);assert.ok(requests[3].at < second.probeReceipt.completedAt);
 const observe=async (start,end)=>{
  await writeFile(join(root,'events.json'),JSON.stringify({version:1,source:'acme',service:'acme',environment:'production',start,end,coverage:'complete',events:[]}));
  await collect({root,config:configured,yes:true,start,end,now:new Date(Math.max(Date.now(),Date.parse(end)))});
 };
 // This was the false positive: the window starts only when requests finished.
 const completion=second.probeReceipt.completedAt;
 await observe(completion,new Date(Date.parse(completion)+1).toISOString());
 const excluded=await verify(args);assert.equal(excluded.state,'inconclusive');assert.ok(excluded.gaps.includes('probe-outside-window'));assert.equal(excluded.usedProbe,null);
 // A separate earlier revision check plus the entire probe interval works.
 await observe(second.probeReceipt.startedAt,new Date().toISOString());
 const resolved=await verify(args);assert.equal(resolved.state,'verified');assert.equal(resolved.usedProbe,second.probeReceipt.id);assert.equal((await readState(root)).incidents[incident].status,'verified');assert.equal(requests.length,8);
 // A late recurrence archives A; a subsequent complete window verifies B without erasing A.
 const proofA=(await readState(root)).incidents[incident].verification;
 assert.equal(proofA.evidence.probe.id,second.probeReceipt.id);
 assert.equal(proofA.evidence.scope,(await readState(root)).incidents[incident].scope);
 assert.match(proofA.evidence.deployment.reference,/^[a-f0-9]{64}$/);
 assert.ok(proofA.evidence.checkedAt >= proofA.end);
 await writeFile(join(root,'events.json'),JSON.stringify({version:1,source:'acme',service:'acme',environment:'production',start:proofA.start,end:proofA.end,coverage:'complete',events:[{id:'acme-late',timestamp:proofA.start,message:'TypeError at src/acme.mjs:12:1'}]}));
 await collect({root,config:configured,yes:true,start:proofA.start,end:proofA.end});
 assert.equal((await readState(root)).incidents[incident].status,'regressed');
 const probeB=await verify(args);
 await observe(probeB.probeReceipt.startedAt,new Date().toISOString());
 const verifiedB=await verify(args);assert.equal(verifiedB.state,'verified');
 const afterB=(await readState(root)).incidents[incident];
 assert.notDeepEqual(afterB.verification,proofA);
 assert.deepEqual(afterB.verificationHistory.find(v=>v.evidence?.checkedAt===proofA.evidence.checkedAt),proofA);
 assert.equal(afterB.verification.evidence.probe.id,probeB.probeReceipt.id);
 // A different approved probe path cannot borrow the prior receipt.
 const changed={...configured,production:{...configured.production,sources:configured.production.sources.map(s=>({...s,equivalentProbe:'/other'}))}};
 const wrong=await verify({...args,config:changed,probe:'/other'});assert.notEqual(wrong.state,'verified');assert.ok(wrong.gaps.includes('traffic-or-approved-equivalent-probe-required'));
});

test('removed or reconfigured sources keep historical incidents but produce no active repair candidates',async t=>{
 const root=await fixture(t);
 const changed={...config,production:{...config.production,sources:config.production.sources.map(s=>({...s,id:'acme-replacement'}))}};
 const reading=await status({root,config:changed});assert.equal(reading.incidents[0].activity,'inactive-source');
 const candidates=await productionCandidates({root,config:changed});assert.ok(candidates.some(c=>c.id==='production-coverage'));assert.ok(!candidates.some(c=>c.title.includes('recurring')));
 const rescoped={...config,production:{...config.production,sources:config.production.sources.map(s=>({...s,service:'acme-other'}))}};
 assert.equal((await status({root,config:rescoped})).incidents[0].activity,'inactive-source');assert.ok(!(await productionCandidates({root,config:rescoped})).some(c=>c.title.includes('recurring')));
});
