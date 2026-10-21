// Private local adapter. Domain transitions are shared with future hosted stores.
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rm, link, unlink } from 'node:fs/promises';
import { resolve, join, dirname, parse, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { FEEDBACK_LIMITS, FeedbackError, refuse, feedbackHash, hashOK, replayEvents, resultIdentity, eventFor, stable } from './feedback.mjs';
const exec=promisify(execFile),missing=e=>e.code==='ENOENT';
// The fixed macOS /tmp alias is environmental, not a user-controlled path alias.
async function absolute(path){let p=resolve(path);if(process.platform==='darwin')for(const alias of ['/tmp','/var','/etc'])if(p===alias||p.startsWith(`${alias}/`)){if(await realpath(alias)!==`/private${alias}`)refuse('unsafe_path');p=`/private${p}`;break;}return p;}
export async function safeDirectory(path,{create=false,privateMode=false}={}){
 path=await absolute(path);let current=parse(path).root;
 for(const part of path.slice(current.length).split(sep).filter(Boolean)){
  current=join(current,part);let stat;
  try{stat=await lstat(current);}catch(e){if(!missing(e)||!create)throw e;await mkdir(current,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});stat=await lstat(current);}
  if(!stat.isDirectory()||stat.isSymbolicLink())refuse('unsafe_directory');
  if(current===path&&privateMode&&(stat.mode&0o777)!==0o700)refuse('unsafe_permissions');
 }
 return path;
}
export async function safeRead(file,limit,{privateMode=false}={}){
 file=await absolute(file);await safeDirectory(dirname(file));const before=await lstat(file);
 if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1)refuse('unsafe_file');
 if(before.size>limit)refuse('capacity_exceeded');
 if(privateMode&&(before.mode&0o777)!==0o600)refuse('unsafe_permissions');
 const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await handle.stat();if(stat.dev!==before.dev||stat.ino!==before.ino||stat.nlink!==1||stat.size>limit)refuse('unsafe_file');
  const buffer=Buffer.alloc(Math.min(stat.size+1,limit+1));let length=0;
  while(length<buffer.length){const {bytesRead}=await handle.read(buffer,length,buffer.length-length,null);if(!bytesRead)break;length+=bytesRead;}
  const after=await handle.stat();if(length!==stat.size||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)refuse('source_changed');return buffer.subarray(0,length);
 }finally{await handle.close();}
}
export async function readAuthored(root,file,limit=FEEDBACK_LIMITS.record){
 if(typeof file!=='string'||!file||file.length>4096||/[\x00-\x1f]/.test(file))refuse('invalid_input_file');
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await safeRead(resolve(root,file),limit)));}catch(e){if(e instanceof FeedbackError)throw e;refuse('input_unavailable');}
}
async function atomicNew(file,bytes,verify){
 const temp=join(dirname(file),`.tmp-${randomUUID()}`);let handle;
 try{await verify([file,temp]);handle=await open(temp,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
  // link is atomic and refuses existing names, unlike rename's overwrite behavior.
  await link(temp,file);await unlink(temp);
  if(process.platform!=='win32'){const directory=await open(dirname(file),'r');try{await directory.sync();}finally{await directory.close();}}
 }finally{await handle?.close();await rm(temp,{force:true});}
}
export async function createFeedbackStore({root,project,env=process.env}){
 root=await safeDirectory(root);const dir=join(root,'.keel/feedback');
 const git=async args=>(await exec('git',['-C',root,...args],{env,timeout:10000,maxBuffer:1024*1024})).stdout.trim();
 async function ignored(paths){
  for(let i=0;i<paths.length;i+=100){const selected=paths.slice(i,i+100),relative=selected.map(p=>p.slice(root.length+1));let output;
   try{output=await git(['check-ignore','--no-index','--',...relative]);}catch{refuse('unprotected_private_store');}
   const protectedPaths=new Set(output.split('\n'));if(relative.some(p=>!protectedPaths.has(p)))refuse('unprotected_private_store');
  }
 }
 async function packagePrivacy(create){
  const path=join(dir,'.npmignore');
  try{if((await safeRead(path,1024,{privateMode:true})).toString()!=='*\n')refuse('unsafe_package_ignore');}
  catch(e){if(!missing(e)||!create)throw e;const h=await open(path,'wx',0o600);try{await h.writeFile('*\n');await h.sync();}finally{await h.close();}}
 }
 async function privacy(create=false){
  let toplevel;try{toplevel=await git(['rev-parse','--show-toplevel']);}catch{refuse('git_unavailable');}
  if(toplevel!==root)refuse('project_root_mismatch');
  if(await git(['ls-files','--','.keel/feedback']))refuse('tracked_private_store');
  try{await safeDirectory(dir,{privateMode:true});}catch(e){if(!missing(e))throw e;}
  let ignored=false;
  try{await git(['check-ignore','--no-index','-q','--','.keel/feedback/__privacy_probe__']);ignored=true;}catch(e){if(e.code!==1)throw e;}
  if(!ignored&&create){
   const exclude=resolve(root,await git(['rev-parse','--git-path','info/exclude']));await safeDirectory(dirname(exclude),{create:true});
   let previous=Buffer.alloc(0);try{previous=await safeRead(exclude,1024*1024);}catch(e){if(!missing(e))throw e;}
   const h=await open(exclude,constants.O_WRONLY|constants.O_APPEND|constants.O_CREAT|constants.O_NOFOLLOW,0o600);
   try{const s=await h.stat();if(!s.isFile()||s.nlink!==1)refuse('unsafe_exclude');await h.writeFile(`${previous.length&&!previous.toString().endsWith('\n')?'\n':''}/.keel/feedback/\n`);await h.sync();}finally{await h.close();}
   await git(['check-ignore','--no-index','-q','--','.keel/feedback/__privacy_probe__']);
  }else if(!ignored){try{await lstat(dir);refuse('unprotected_private_store');}catch(e){if(!missing(e))throw e;}}
  if(create)await safeDirectory(dir,{create:true,privateMode:true});
  try{await lstat(dir);await packagePrivacy(create);}catch(e){if(!missing(e))throw e;if(create)throw e;
   try{await lstat(dir);refuse('package_privacy_unavailable');}catch(e){if(!missing(e))throw e;}
  }
 }
 async function inventory(){
  await privacy();let names;try{names=await readdir(dir);}catch(e){if(missing(e))return {rows:[],bytes:0};throw e;}
  if(names.some(n=>!hashOK(n)&&!['snapshots','.lock','.npmignore'].includes(n)))refuse('invalid_store');
  let bytes=0,entries=0;const rows=[],privatePaths=[];
  async function count(path,depth=0){if(depth>1)refuse('invalid_store');if(++entries>100000)refuse('capacity_exceeded');const stat=await lstat(path);if(stat.isDirectory()){if(depth!==0)refuse('invalid_store');await safeDirectory(path,{privateMode:true});const children=await readdir(path);if(children.length+entries>100000)refuse('capacity_exceeded');for(const name of children)await count(join(path,name),depth+1);}else{if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||(stat.mode&0o777)!==0o600)refuse('unsafe_file');privatePaths.push(path);bytes+=stat.size;if(bytes>FEEDBACK_LIMITS.bytes)refuse('capacity_exceeded');}}
  for(const name of names){if(name==='.lock'){await safeDirectory(join(dir,name),{privateMode:true});continue;}await count(join(dir,name));}
  await ignored(privatePaths);
  for(const name of names){
   if(name==='snapshots'||name==='.lock'||name==='.npmignore')continue;if(!hashOK(name))refuse('invalid_store');
   const path=join(dir,name);await safeDirectory(path,{privateMode:true});const entries=(await readdir(path)).sort();
   if(entries.some(n=>!/^\d{8}\.json$/.test(n)))refuse('incomplete_store');
   const events=[];for(const file of entries){try{events.push(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await safeRead(join(path,file),FEEDBACK_LIMITS.record+8192,{privateMode:true}))));}catch(e){if(e instanceof FeedbackError)throw e;refuse('invalid_store');}}
   const current=replayEvents(events,project);if(!current||current.id!==name)refuse('invalid_store');rows.push(current);if(rows.length>FEEDBACK_LIMITS.observations)refuse('capacity_exceeded');
  }
  return {rows,bytes};
 }
 async function snapshot(record){
  const {version,contentHash}=record.result;if(version===null||contentHash===null)return {bytes:null,gaps:['immutable_version_unavailable']};
  try{const bytes=await safeRead(join(dir,'snapshots',`${contentHash}.bin`),FEEDBACK_LIMITS.result,{privateMode:true});if(feedbackHash(bytes)!==contentHash)return {bytes:null,gaps:['snapshot_corrupt']};return {bytes,gaps:[]};}
  catch(e){if(e instanceof FeedbackError&&['unsafe_file','unsafe_directory','unsafe_permissions'].includes(e.code))throw e;return {bytes:null,gaps:[missing(e)?'snapshot_unavailable':'snapshot_unreadable']};}
 }
 async function lock(action){
  await privacy(true);const path=join(dir,'.lock');
  try{await mkdir(path,{mode:0o700});}catch(e){if(e.code==='EEXIST')refuse('writer_busy');throw e;}
  try{return await action();}finally{await rm(path,{recursive:true});}
 }
 async function append({kind,record,id,expected,bytes=null}){return lock(async()=>{
  const all=await inventory(),current=all.rows.find(r=>r.id===id)??null;
  if((current?.digest??null)!==expected)refuse('stale_revision');
  if(kind==='capture')for(const row of all.rows)if(resultIdentity(row.capture)===resultIdentity(record)&&row.capture.result.contentHash!==record.result.contentHash)refuse('immutable_result_changed');
  if(kind==='resolution'&&record.state==='superseded'&&(!all.rows.some(r=>r.id===record.supersededBy)||id===record.supersededBy))refuse('supersession_unavailable');
  const event=eventFor(current,kind,record);if(!event)return current;
  if(!current&&all.rows.length>=FEEDBACK_LIMITS.observations)refuse('capacity_exceeded');
  const serialized=Buffer.from(stable(event));let snapshotBytes=null;
  if(bytes){if(record.result.version===null||feedbackHash(bytes)!==record.result.contentHash||bytes.length>FEEDBACK_LIMITS.result)refuse('invalid_snapshot');
   const existing=await snapshot(record);if(existing.gaps.length){if(!existing.gaps.includes('snapshot_unavailable'))refuse('snapshot_corrupt');snapshotBytes=bytes;}}
  if(all.bytes+serialized.length+(snapshotBytes?.length??0)>FEEDBACK_LIMITS.bytes)refuse('capacity_exceeded');
  if(snapshotBytes){await safeDirectory(join(dir,'snapshots'),{create:true,privateMode:true});await atomicNew(join(dir,'snapshots',`${record.result.contentHash}.bin`),snapshotBytes,ignored);}
  const target=join(dir,id);await safeDirectory(target,{create:true,privateMode:true});await atomicNew(join(target,`${String(event.index).padStart(8,'0')}.json`),serialized,ignored);
  return {id,index:event.index,digest:event.digest,capture:kind==='capture'?record:current.capture,resolution:kind==='resolution'?record:null};
 });}
 return {inventory,snapshot,append,privacy,dir};
}
