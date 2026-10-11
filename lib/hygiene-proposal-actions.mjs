// Owner acceptance reuses robot-issues for every remote write/recovery.
import { readFile, lstat, realpath, mkdir, open, rename, rm } from 'node:fs/promises';
import { resolve, relative, join, dirname, isAbsolute, sep } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseHygieneProposal, formatHygieneProposal } from '../practices/night/files/scripts/keel/hygiene-proposals.mjs';
import { sourcePath, lineCount, largestSections, hygieneOptions, generatedSource } from '../practices/night/files/scripts/keel/hygiene-measures.mjs';
import { healthDirOf } from '../practices/night/files/scripts/keel/lib.mjs';
import { ensureRobotIssue, recoverRobotIssue, robotTargetPolicy } from './robot-issue.mjs';
import { robotGithub } from '../practices/night/files/scripts/keel/robot-delivery.mjs';
const exec=promisify(execFile);
// Reject every checkout-relative symlink, including directory components.
export async function safeHygienePath(root,path) {
  const base=await realpath(root),target=resolve(base,path),rel=relative(base,target);
  if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw new Error('unsafe hygiene path outside project');
  let current=base;const parts=rel.split(sep);
  for(let i=0;i<parts.length;i++){
    current=join(current,parts[i]);const stat=await lstat(current);
    if(stat.isSymbolicLink()||(i===parts.length-1?!stat.isFile():!stat.isDirectory()))throw new Error('unsafe hygiene symlink or nonregular path');
  }
  return target;
}
async function fresh(root,p,config) {
  const file=await safeHygienePath(root,p.file),stat=await lstat(file);
  if(stat.size>8*1024*1024)throw new Error('hygiene source exceeds read bound');
  if(!sourcePath(p.file))throw new Error('hygiene target is not eligible source');
  try {
    const lock=JSON.parse(await readFile(await safeHygienePath(root,'.keel/lock.json'),'utf8'));
    if(!lock?.files||typeof lock.files!=='object'||Array.isArray(lock.files))throw new Error('managed file inventory unavailable');
    if(Object.hasOwn(lock.files,p.file))throw new Error('managed source requires owner-led split and render');
  }catch(e){if(e.code!=='ENOENT')throw e;}
  const tracked=await exec('git',['-C',root,'ls-files','--error-unmatch','--',p.file],{timeout:5000,maxBuffer:65536});
  if(tracked.stdout.trim()!==p.file)throw new Error('hygiene target is not tracked source');
  const bytes=await readFile(file),blob=createHash(p.blob.length===64?'sha256':'sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const text=bytes.toString('utf8'),lines=lineCount(text);
  if(generatedSource(text))throw new Error('generated source requires owner-led work');
  if(bytes.includes(0)||blob!==p.blob||lines!==p.lines)throw new Error('stale hygiene source blob or line count; refresh the proposal');
  const options=hygieneOptions(config);
  if(lines<=options.longFileLines)throw new Error('source no longer exceeds the configured long-file threshold');
  const sections=largestSections(text).map(({name,start,end})=>({name,start,end}));
  if(JSON.stringify(sections)!==JSON.stringify(p.sections))throw new Error('hygiene split hints differ from current source; refresh the proposal');
}
async function atomic(file,text) {
  const temp=file+'.'+randomUUID()+'.tmp';let handle;
  try{handle=await open(temp,'wx',0o600);await handle.writeFile(text);await handle.sync();await handle.close();handle=null;await rename(temp,file);
    if(process.platform!=='win32'){const dir=await open(dirname(file),'r');try{await dir.sync();}finally{await dir.close();}}
  }finally{await handle?.close();await rm(temp,{force:true});}
}
// Same owner/reaper protocol as the existing health writer. Only ESRCH on
// this host proves a dead owner; elapsed time, unknown owners and PID reuse do not.
async function lockOwner(lock) {
  try {const file=join(lock,'owner.json');if(!(await lstat(file)).isFile())return null;const o=JSON.parse(await readFile(file,'utf8'));return o.host===hostname()&&Number.isSafeInteger(o.pid)&&o.pid>0&&typeof o.token==='string'?o:null;}catch{return null;}
}
function ownerDead(owner) {
  if(!owner||owner.pid===process.pid)return false;
  try{process.kill(owner.pid,0);return false;}catch(e){return e.code==='ESRCH';}
}
async function acquire(lock) {
  try{await mkdir(lock);return;}catch(e){if(e.code!=='EEXIST')throw e;}
  if(!(await lstat(lock)).isDirectory())throw new Error('unsafe health proposal lock');
  const owner=await lockOwner(lock);
  if(!ownerDead(owner))throw new Error('health proposal writer busy or unknown; no lock stolen');
  const reaper=join(lock,'reaper');
  try{await mkdir(reaper);}catch{throw new Error('health proposal recovery already in progress');}
  let moved=false;
  try {
    const current=await lockOwner(lock);
    if(current?.token!==owner.token||!ownerDead(current))throw new Error('health proposal lock owner changed');
    const orphan=lock+'.orphan-'+randomUUID();await rename(lock,orphan);moved=true;await rm(orphan,{recursive:true,force:true});
  }finally{if(!moved)await rm(reaper,{recursive:true,force:true});}
  try{await mkdir(lock);}catch(e){if(e.code==='EEXIST')throw new Error('health proposal writer busy');throw e;}
}
export async function decideHygieneProposal({root,path,expectedInstance,decision,reason=null,at=new Date().toISOString(),github=robotGithub}) {
  if(!['accept','decline'].includes(decision))throw new Error('hygiene proposal supports accept or decline');
  if(decision==='decline'&&!(typeof reason==='string'&&reason.trim()))throw new Error('decline requires a reason');
  if(typeof expectedInstance!=='string'||!/^[a-f0-9]{64}$/.test(expectedInstance))throw new Error('hygiene proposal requires --instance from the current page');
  const config=JSON.parse(await readFile(await safeHygienePath(root,'.keel/keel.json'),'utf8'));
  const base=await realpath(root),file=await safeHygienePath(root,path),health=resolve(base,healthDirOf(config));
  if(dirname(file)!==health||!/^\d{4}-\d{2}-\d{2}\.md$/.test(relative(health,file)))throw new Error('hygiene proposal must be a dated configured health page');
  // Serialize with the existing report writer, without a second state store.
  const lock=join(health,'.keel-time-proposals.lock');
  await acquire(lock);
  try {
    await atomic(join(lock,'owner.json'),JSON.stringify({pid:process.pid,host:hostname(),token:randomUUID()}));
    let source=await readFile(file,'utf8'),parsed=parseHygieneProposal(source),p=parsed.proposal;
    if(parsed.problems.length||!p)throw new Error(parsed.problems.join('; ')||'hygiene proposal unavailable');
    if(p.instanceId!==expectedInstance)throw new Error('stale proposal instance; refresh the page');
    if(p.repo!==config.repo?.toLowerCase())throw new Error('hygiene proposal repository differs from local repository');
    const save=async lifecycle=>{
      const next={...p,lifecycle},rendered=formatHygieneProposal(next);
      if(await safeHygienePath(root,path)!==file||await readFile(file,'utf8')!==source)throw new Error('health page changed during hygiene decision');
      const updated=source.slice(0,parsed.start)+rendered+source.slice(parsed.end);
      await atomic(file,updated);source=updated;parsed=parseHygieneProposal(source);p=parsed.proposal;return p;
    };
    const output=(ok,state,reasons=[],issue=p.lifecycle.issue)=>({ok,decision:p.lifecycle.state,state,reasons,issue,proposal:p});
    if(decision==='decline') {
      if(p.lifecycle.state==='declined')return output(true,'declined');
      if(p.lifecycle.state!=='proposed')throw new Error('accepting or accepted work cannot be declined as unfiled');
      await save({...p.lifecycle,state:'declined',decidedAt:new Date(at).toISOString(),reason:reason.trim()});return output(true,'declined');
    }
    if(p.lifecycle.state==='declined')throw new Error('proposal was declined; refresh for a new source blob');
    const stateDir=join(root,'.keel/robot-issues');
    // Recover attempted work first: changed source/policy must never cause a
    // second POST, nor prevent read-only confirmation of an earlier POST.
    if(['accepting','accepted'].includes(p.lifecycle.state)) {
      const recovered=await recoverRobotIssue({repo:p.repo,instanceId:p.instanceId,stateDir,github});
      if(!['blocked','pending'].includes(recovered.state)){
        if(recovered.state==='recovered')await save({...p.lifecycle,state:'accepted',issue:recovered.issue});
        return output(recovered.state==='recovered',recovered.state,recovered.reasons,recovered.issue);
      }
      if(p.lifecycle.state==='accepted')return output(false,recovered.state,recovered.reasons);
      // A prepared intent may safely proceed through ensureRobotIssue, which
      // verifies its contents. Invalid/attempted intents can never be reposted.
    }
    try{await fresh(root,p,config);}catch(e){return output(false,'blocked',[e.message]);}
    const policy=await robotTargetPolicy({root,repo:p.repo,github});
    if(!policy.valid||!policy.enabled||!(policy.weeklyMinutes>0))return output(false,'blocked',['robot OFF or approved robot budget unavailable',...policy.problems]);
    if(p.lifecycle.state==='proposed')await save({...p.lifecycle,state:'accepting',decidedAt:new Date(at).toISOString(),reason});
    const result=await ensureRobotIssue({repo:p.repo,...p.candidate,subjectKey:p.subjectKey,instanceId:p.instanceId,policy,yes:true,stateDir,github});
    const complete=['created','recovered'].includes(result.state);
    await save({...p.lifecycle,state:complete?'accepted':'accepting',issue:result.issue??p.lifecycle.issue,reason:result.reasons.length?result.reasons.join('; '):p.lifecycle.reason});
    return output(complete,result.state,result.reasons,result.issue??p.lifecycle.issue);
  }finally{await rm(lock,{recursive:true,force:true});}
}
