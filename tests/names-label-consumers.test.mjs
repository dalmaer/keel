import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {labelMutant} from './helpers/names.mjs';
import {formatRobotRubric} from '../practices/climb/files/scripts/plates/robot-rubric.mjs';
import {recordText} from '../practices/night/files/scripts/plates/lib.mjs';
const sha='a'.repeat(40);
const rubric=formatRobotRubric({version:1,problem:'Acme latency',reproduction:'Open the Acme list.',acceptance:'List opens promptly.',change:'Index the list.',prerequisites:[],ownerBlockers:[]});
for(const surface of ['morning','night-plan','review']) test(`${surface} label query catches both single-name removals`,async t=>{
 const dir=await mkdtemp(join(tmpdir(),'acme-label-query-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await mkdir(join(dir,'scripts/plates'),{recursive:true});
 for(const [practice,file] of [['night','names.mjs'],['climb','robot-policy.mjs'],['climb','robot-rubric.mjs']])await cp(new URL(`../practices/${practice}/files/scripts/plates/${file}`,import.meta.url),join(dir,'scripts/plates',file));
 const file=surface==='review'?new URL('../lib/review.mjs',import.meta.url):new URL(`../practices/night/files/scripts/plates/${surface}.mjs`,import.meta.url);
 const kind=surface==='morning'?'morning':surface==='night-plan'?'agent':'review-after',id=`label:keel:${kind}`;
 const exports=surface==='night-plan'?['robotInput']:surface==='review'?['readPushIssue']:[];
 const baseline=await labelMutant(file,id,'unrelated',exports);
 const record={version:1,from:sha,to:sha,alone:true,at:'2026-10-24T00:00:00Z',agent:'codex',minutes:1,findings:[]};
 const issue={number:7,title:'Acme issue',body:surface==='review'?recordText(record):rubric,createdAt:'2026-10-24T00:00:00Z',state:'open',user:{login:'github-actions[bot]'}};
 const gh=join(dir,'gh');
 await writeFile(gh,`#!${process.execPath}
const a=process.argv.slice(2); const path=a.find(x=>x.includes('issues?'));const label=path?new URL('https://acme.invalid/'+path).searchParams.get('labels'):a[a.indexOf('--label')+1];console.log(JSON.stringify(label===process.env.ACME_LABEL?${JSON.stringify([issue])}:[]));
`,{mode:0o755});
 for(const namespace of ['plates','keel']){
  const label=`${namespace}:${kind}`,env={...process.env,PLATES_GH:gh,ACME_LABEL:label};
  const call=m=>surface==='morning'?m.morningIssues(dir,{repo:'acme/anvils'},env):surface==='night-plan'?m.robotInput(dir,{repo:'acme/anvils',robot:{on:true,budgetMinutes:60}},env):m.readPushIssue(env,{repo:'acme/anvils',sha});
  const good=await call(baseline);
  assert.equal(surface==='morning'?good[0]?.number:surface==='night-plan'?good.next?.number:good.number,7);
  const mutant=await labelMutant(file,id,label,exports);
  if(surface==='review')await assert.rejects(()=>call(mutant),/no review/);
  else {const bad=await call(mutant);assert.equal(surface==='morning'?bad.length:bad.next, surface==='morning'?0:null);}
 }
});
