// One cooperating inbox writer lane. No automatic recovery or stale-lock reclaim.
import { constants } from 'node:fs';
import { open, lstat, readdir, mkdir, link, unlink, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { AsyncLocalStorage } from 'node:async_hooks';
import { evaluationBytes } from './evaluation-ledger.mjs';
import { safePath } from './session-ledger-io.mjs';
import { byteDigest, fingerprint } from './evaluation-records.mjs';
import { check, evaluationSection, ref, same, replay } from './evaluated-lessons.mjs';
const owners=new AsyncLocalStorage();
const identity=s=>({dev:s.dev,ino:s.ino,uid:s.uid,mode:s.mode,nlink:s.isDirectory()?null:s.nlink});
export const inboxName=/^\d{4}-\d\d-\d\d-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
export async function readInboxFile(path) {
  let stat;try{stat=await lstat(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}
  const bytes=await evaluationBytes(path,1048576),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  check(fingerprint(identity(stat))===fingerprint(identity(await lstat(path))),'inbox_changed_during_read');return {text,digest:byteDigest(bytes),identity:identity(stat)};
}
export async function inboxInventory(root) {
  const dir=join(root,'docs/inbox');check(await safePath(join(root,'docs')),'unsafe_inbox_parent');
  if(!await safePath(dir))return [];
  const names=(await readdir(dir)).filter(n=>inboxName.test(n)).sort();check(names.length<=1000,'inbox_inventory_limit');let bytes=0;const result=[];
  for(const name of names){const file=await readInboxFile(join(dir,name));check(file,'inbox_inventory_changed');bytes+=Buffer.byteLength(file.text);check(bytes<=16777216,'inbox_inventory_bytes');result.push({name,...file,evaluation:evaluationSection(file.text)?.value??null});}validateInventoryRefs(result);return result;
}
function validateInventoryRefs(inventory){
  const records=inventory.flatMap(f=>(f.evaluation?.records??[])),edges=new Map();
  const resolve=r=>{const found=records.filter(v=>same(ref(v),r));check(found.length===1,'unresolved_or_ambiguous_learning_ref');return found[0];};
  for(const f of inventory)if(f.evaluation){replay(f.evaluation,{resolveExternal:resolve});for(const r of f.evaluation.records)if(r.kind==='learning-follow-up'&&r.data.relation)resolve(r.data.relation.recordRef);for(const r of f.evaluation.records)if(r.kind==='learning-lesson')for(const relation of r.data.related){const target=resolve(relation.recordRef);const list=edges.get(r.digest)??[];list.push(target.digest);edges.set(r.digest,list);}for(const e of f.evaluation.events)if(e.action==='supersede'){const target=resolve(e.replacementRef);check(['learning-lesson','learning-proposal'].includes(target.kind),'invalid_supersession_target');const list=edges.get(e.subjectRef.digest)??[];list.push(target.digest);edges.set(e.subjectRef.digest,list);}}
  const done=new Set(),active=new Set();function visit(id,depth=0){check(depth<=128&&!active.has(id),'cyclic_learning_relation');if(done.has(id))return;active.add(id);for(const next of edges.get(id)??[])visit(next,depth+1);active.delete(id);done.add(id);}for(const key of edges.keys())visit(key);
}
export async function pendingLearningOperations(root,name,events=[]){
  const dir=join(root,'docs/inbox');if(!await safePath(dir))return [];const names=await readdir(dir);check(names.length<=1128,'inbox_inventory_limit');const prefix='.'+name+'.';const pending=[];for(const file of names)if(file.startsWith(prefix)&&file.endsWith('.pending')){const m=/([a-f0-9-]{36})\.([a-f0-9]{64})\.pending$/.exec(file);check(m,'unverifiable_pending_operation');const event=events.find(e=>e.operationId===m[1]);pending.push({operationId:m[1],requestDigest:m[2],status:event?(event.requestDigest===m[2]?'committed':'conflict'):'not-found',uncertainty:'pending bytes retained; no automatic retry or cleanup'});}return pending;
}
export async function withLearningWriter(root,work) {
  const active=owners.getStore();if(active?.root===root){await active.verify();return work(active);}
  const parent=join(root,'docs');check(await safePath(parent),'unsafe_inbox_parent');const parentIdentity=identity(await lstat(parent));const path=join(parent,'.inbox-evaluation.lock');
  const h=await open(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  const owner={id:randomUUID(),host:hostname(),uid:process.getuid?.(),pid:process.pid};const bytes=JSON.stringify(owner)+'\n';await h.writeFile(bytes);await h.sync();const id=identity(await h.stat());await h.close();
  const verify=async()=>{check(await safePath(parent)&&fingerprint(identity(await lstat(parent)))===fingerprint(parentIdentity),'inbox_parent_replaced');const stat=await lstat(path);check(fingerprint(identity(stat))===fingerprint(id)&&await safePath(path,false),'inbox_lock_replaced');check((await evaluationBytes(path,4096)).toString()===bytes,'inbox_lock_changed');};
  let uncertain=false;
  const lock={root,verify,markUncertain:()=>{uncertain=true;},clearUncertain:()=>{uncertain=false;}};
  try{const inbox=join(parent,'inbox');if(await safePath(inbox)){const names=await readdir(inbox);check(!names.some(n=>n.endsWith('.pending')),'pending_inbox_operation_requires_inspection');}return await owners.run(lock,()=>work(lock));}finally{if(!uncertain){await verify();await unlink(path);const dir=await open(parent,constants.O_RDONLY);try{await dir.sync();}finally{await dir.close();}}}
}
export async function publishInbox(root,name,prior,text,lock,operation) {
  check(inboxName.test(name)&&Buffer.byteLength(text)<=1048576,'invalid_inbox_output');await lock.verify();const dir=join(root,'docs/inbox');
  if(!await safePath(dir))await mkdir(dir,{mode:0o700});check(await safePath(dir),'unsafe_inbox');
  check(operation&&/^[a-f0-9-]{36}$/.test(operation.operationId)&&/^[a-f0-9]{64}$/.test(operation.requestDigest),'invalid_pending_identity');
  const dirIdentity=identity(await lstat(dir));
  const verifyParent=async()=>{await lock.verify();check(await safePath(dir)&&fingerprint(identity(await lstat(dir)))===fingerprint(dirIdentity),'inbox_directory_replaced');};
  const destination=join(dir,name),temp=join(dir,'.'+name+'.'+operation.operationId+'.'+operation.requestDigest+'.pending');
  await verifyParent();lock.markUncertain();
  const h=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await verifyParent();await h.writeFile(text);await h.sync();}finally{await h.close();}
  await verifyParent();const now=await readInboxFile(destination);check(prior?now&&now.digest===prior.digest&&fingerprint(now.identity)===fingerprint(prior.identity):now===null,'stale_inbox_before_publish');await verifyParent();
  if(prior)await rename(temp,destination);else{await link(temp,destination);await unlink(temp);}
  const directory=await open(dir,constants.O_RDONLY);try{await directory.sync();}finally{await directory.close();}
  await verifyParent();lock.clearUncertain();return {digest:byteDigest(Buffer.from(text)),destination};
}
export async function guardLegacyLearning(root,p) {
  check(!p.evaluation,'evaluated_record_requires_evaluate');
  if(p.file){const value=await readInboxFile(join(root,p.file));check(!value||!evaluationSection(value.text),'evaluated_record_requires_evaluate');}
}
