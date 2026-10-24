// Acme real Git objects; only the external gh process is simulated.
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { canonical, fingerprint, byteDigest } from '../../lib/evaluation-records.mjs';
export async function approvalWorld(t,{action='promote',headConfig=null,extra=false,executable=false,config={learning:{approval:{schemaVersion:1,provider:'github',ownerApproverIds:[7]}}}}={}){
 const home=await mkdtemp(join(tmpdir(),'acme-approval-'));t.after(()=>rm(home,{recursive:true,force:true}));const repo=join(home,'repo');await mkdir(repo);
 const git=(...args)=>execFileSync('git',args,{cwd:repo,env:process.env,encoding:'utf8'}).trim();git('init','-q');
 await mkdir(join(repo,'.plates'));await writeFile(join(repo,'.plates/plates.json'),JSON.stringify(config)+'\n');await writeFile(join(repo,'acme.md'),'Acme before\n');git('add','.');git('commit','-qm','Acme base');const base=git('rev-parse','HEAD');
 const payload={schemaVersion:1,kind:'acme-package',action},payloadDigest=fingerprint(payload),bytes=canonical(payload)+'\n',path=`docs/evidence/learning-packages/${payloadDigest}.json`;
 await mkdir(join(repo,'docs/evidence/learning-packages'),{recursive:true});await writeFile(join(repo,path),bytes);
 if(action==='rollback')await rm(join(repo,'acme.md'));else await writeFile(join(repo,'acme.md'),'Acme after\n');if(headConfig)await writeFile(join(repo,'.plates/plates.json'),JSON.stringify(headConfig)+'\n');if(extra)await writeFile(join(repo,'extra.md'),'Acme extra\n');git('add','-A');if(executable)git('update-index','--chmod=+x','acme.md');git('commit','-qm','Acme candidate');const head=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}'),merge=git('commit-tree',tree,'-p',base,'-p',head,'-m','Acme merge');
 const blob=bytes=>({mode:'100644',byteDigest:byteDigest(bytes),bytes});
 const expected={schemaVersion:1,repo:'Acme/widgets',prNumber:1,reviewId:11,action,payloadDigest,baseRevision:base,artifact:{path,byteDigest:byteDigest(bytes),bytes},changes:[{path:'acme.md',before:blob('Acme before\n'),after:action==='rollback'?null:blob('Acme after\n')}]};
 const routes={};const prefix='repos/Acme/widgets';routes[prefix]={id:42,full_name:'Acme/widgets',default_branch:'main'};
 routes[prefix+'/git/ref/heads/main']={ref:'refs/heads/main',object:{type:'commit',sha:merge}};
 for(const oid of [base,head,merge]){const raw=git('cat-file','-p',oid),treeSha=raw.match(/^tree (\w+)$/m)[1],parents=[...raw.matchAll(/^parent (\w+)$/gm)].map(m=>({sha:m[1]}));routes[prefix+'/git/commits/'+oid]={sha:oid,tree:{sha:treeSha},parents};
  const entries=git('ls-tree','-r','-t',treeSha).split('\n').filter(Boolean).map(line=>{const [,mode,type,sha,path]=line.match(/^(\d+) (\w+) (\w+)\t(.+)$/);return {mode,type,sha,path};});routes[prefix+`/git/trees/${treeSha}?recursive=1`]={sha:treeSha,truncated:false,tree:entries};
  for(const e of entries)if(e.type==='blob'){const b=execFileSync('git',['cat-file','blob',e.sha],{cwd:repo,env:process.env});routes[prefix+'/git/blobs/'+e.sha]={sha:e.sha,encoding:'base64',size:b.length,content:b.toString('base64')};}}
 routes[prefix+'/pulls/1']={number:1,merged:true,state:'closed',merged_at:'2026-10-24T12:00:00Z',user:{id:8},base:{repo:{id:42,full_name:'Acme/widgets'},ref:'main',sha:base},head:{sha:head},merge_commit_sha:merge};
 const reviewsKey=prefix+'/pulls/1/reviews?per_page=100&page=1';routes[reviewsKey]=[{id:11,user:{id:7,type:'User'},state:'APPROVED',commit_id:head,pull_request_url:'https://api.github.com/repos/Acme/widgets/pulls/1',body:`plates-learning-approval-v1 ${action} sha256:${payloadDigest}`,submitted_at:'2026-10-24T11:00:00Z'}];
 const routeFile=join(home,'routes.json'),log=join(home,'calls.jsonl'),counts=join(home,'counts.json'),gh=join(home,'gh');
 await writeFile(gh,`#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2);if(a.length!==4||a[0]!=='api'||a[1]!=='--hostname'||a[2]!=='github.com')process.exit(9);fs.appendFileSync(process.env.ACME_LOG,JSON.stringify(a)+'\\n');const routes=JSON.parse(fs.readFileSync(process.env.ACME_ROUTES));let counts={};try{counts=JSON.parse(fs.readFileSync(process.env.ACME_COUNTS))}catch{}const n=counts[a[3]]||0;counts[a[3]]=n+1;fs.writeFileSync(process.env.ACME_COUNTS,JSON.stringify(counts));let r=routes[a[3]];if(r===undefined)process.exit(8);if(r.responses)r=r.responses[Math.min(n,r.responses.length-1)];process.stdout.write(JSON.stringify(r));\n`,{mode:0o700});
 const env={...process.env,PLATES_GH:gh,ACME_ROUTES:routeFile,ACME_LOG:log,ACME_COUNTS:counts};
 const save=async()=>{await writeFile(routeFile,JSON.stringify(routes));await rm(counts,{force:true});};await save();
 return {home,repo,git,expected,routes,prefix,reviewsKey,base,head,merge,env,save,calls:async()=>readFile(log,'utf8')};
}
