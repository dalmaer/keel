// Acme actual phase files/Git repository; only external GitHub transport is fake.
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {run,cleanEnv} from './run.mjs';
export async function repairWorld(t){
  const root=await realpath(await mkdtemp(join(tmpdir(),'acme-repair-')));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'docs/phases'),{recursive:true});
  const phasePath=join(root,'docs/phases/1-acme.md');
  const phase=(status='planned',note='Acme original repair')=>`---\nstatus: ${status}\nsince: 2026-10-24\ngoal: G1\nnote: ${note}\nevidence: ${status==='built'?'["evidence/acme.md"]':'[]'}\n---\n# Acme repair\n\n## Done when\n\nAcme behavior holds.\n\n## Scope\n\nAcme only.\n\n## Acceptance\n\n- [${status==='built'?'x':' '}] Acme checked.\n\n## Proof\n\nnode --test\n\n## Deliberately open\n\nNo broader claim.\n\n## Next action\n\nObserve Acme.\n`;
  await writeFile(phasePath,phase());const git=args=>{const result=run('git',args,{cwd:root});assert.equal(result.status,0,result.stderr);};git(['init','-q']);git(['add','.']);git(['commit','-qm','Acme repair source']);
  const responsePath=join(root,'issue.json'),gh=join(root,'gh');
  const issue={id:73,number:4,state:'open',html_url:'https://github.com/Acme/widget/issues/4',body:'Acme repair work.',updated_at:'2026-10-24T00:00:00Z'};
  await writeFile(responsePath,JSON.stringify(issue));await writeFile(gh,`#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);if(JSON.stringify(args)!==JSON.stringify(['api','--hostname','github.com','repos/Acme/widget/issues/4']))process.exit(9);const data=JSON.parse(fs.readFileSync(process.env.ACME_REPAIR_RESPONSE));if(data===null)process.exit(8);process.stdout.write(JSON.stringify(data));\n`,{mode:0o700});
  const env={...cleanEnv(),PLATES_GH:gh,ACME_REPAIR_RESPONSE:responsePath};
  return {root,phasePath,phase,issue,options:{root,repository:'Acme/widget',cfg:{},env},saveIssue:value=>writeFile(responsePath,JSON.stringify(value))};
}
