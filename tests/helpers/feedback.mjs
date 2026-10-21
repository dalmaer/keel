import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { run } from './run.mjs';
export const feedbackWords = 'Acme private feedback: the second row is missing.';
export const feedbackBytes = Buffer.from('Acme immutable preview with one row.\n');
export const feedbackRubric = {version:1,problem:'Acme loses the second row.',reproduction:'Open the selected Acme preview.',acceptance:'Both rows appear in the regression.',change:'Preserve the second row.',prerequisites:[],ownerBlockers:[]};
export async function feedbackFixture(t) {
 const root=await realpath(await mkdtemp(join(tmpdir(),'plates-feedback-')));
 t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'.plates'));
 const config={version:1,repo:'acme/studio',practices:[]};
 await writeFile(join(root,'.plates/plates.json'),JSON.stringify(config));
 const git=(...args)=>{const r=run('git',args,{cwd:root});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();};
 git('init','-q');git('add','.plates/plates.json');git('commit','-qm','Create Acme fixture');
 const record={schema:1,project:config.repo,source:{id:'owner-note-1',kind:'manual'},author:{kind:'manual',name:'Acme Owner'},observedAt:'2026-10-21T12:00:00.000Z',words:feedbackWords,revision:1,previousDigest:null,result:{sourceRevision:git('rev-parse','HEAD'),artifactId:'preview',version:'v1',contentHash:createHash('sha256').update(feedbackBytes).digest('hex'),file:'preview.txt'}};
 const save=async(name,value)=>{await writeFile(join(root,name),JSON.stringify(value));return name;};
 await writeFile(join(root,'preview.txt'),feedbackBytes);await save('capture.json',record);
 const publication=digest=>({schema:1,feedbackDigest:digest,excerpt:'the second row is missing.',destination:config.repo,title:'Preserve Acme rows',rubric:structuredClone(feedbackRubric)});
 const resolution=(digest,state='declined')=>({schema:1,feedbackDigest:digest,state,actor:{kind:'manual',name:'Acme Owner'},at:'2026-10-21T13:00:00.000Z',...(state==='declined'?{reason:'Acme owner chooses to keep this result.'}:{reference:`proposal:${'a'.repeat(64)}`})});
 return {root,config,record,save,git,publication,resolution,env:{...process.env,PLATES_GH:join(root,'unavailable-gh')}};
}
