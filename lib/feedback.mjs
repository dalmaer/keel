// Pure feedback records and transitions. No filesystem, provider or authority inference.
import { createHash } from 'node:crypto';
export const FEEDBACK_LIMITS=Object.freeze({record:256*1024,result:2*1024*1024,observations:1000,bytes:50*1024*1024});
export const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const feedbackHash=value=>createHash('sha256').update(value).digest('hex');
export const digestOf=value=>feedbackHash(stable(value));
export class FeedbackError extends Error { constructor(code){super(code);this.code=code;} }
export const refuse=code=>{throw new FeedbackError(code);};
export const hashOK=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const idOK=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(x);
const repoOK=x=>typeof x==='string'&&/^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/.test(x)&&x.length<=200;
const shaOK=x=>typeof x==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(x);
export function fields(value,allowed,required=allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(value,k)))refuse('invalid_record');}
const text=(x,max=4000)=>{if(typeof x!=='string'||!x.trim()||Buffer.byteLength(x)>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(x))refuse('invalid_text');};
const utc=x=>{if(typeof x!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(x)||!Number.isFinite(Date.parse(x))||new Date(x).toISOString().replace('.000Z','Z')!==x.replace('.000Z','Z'))refuse('invalid_time');};
const actor=x=>{fields(x,['kind','name']);if(x.kind!=='manual')refuse('manual_attribution_required');text(x.name,200);};
export function safeLink(x){if(typeof x!=='string')return false;try{const u=new URL(x);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&x.length<=2000&&!/[\s\x00-\x1f]/.test(x);}catch{return false;}}
export function decisionRef(x){return typeof x==='string'&&x.length<=500&&/^[A-Za-z0-9_.\/-]+#[A-Za-z0-9_.:-]+$/.test(x)&&x.split('#')[0].split('/').every(p=>p&&p!=='.'&&p!=='..');}
// This is a single verified product rename, not a general cross-project alias.
// Historical records keep their project, observation IDs and event digests.
export function feedbackProjects(project,previousProject){
 if(previousProject!==undefined&&(project!=='dalmaer/plates'||previousProject!=='dalmaer/keel'))refuse('invalid_feedback_project');
 return previousProject===undefined?[project]:[project,previousProject];
}
export function validateCapture(input,project,previousProject){
 fields(input,['schema','project','source','author','observedAt','words','revision','previousDigest','result','conflicts'],['schema','project','source','author','observedAt','words','revision','previousDigest','result']);
 if(Buffer.byteLength(stable(input))>FEEDBACK_LIMITS.record||input.schema!==1||!repoOK(input.project)||!feedbackProjects(project,previousProject).includes(input.project))refuse('invalid_capture');
 fields(input.source,['id','kind']);if(!idOK(input.source.id)||input.source.kind!=='manual')refuse('invalid_source');actor(input.author);utc(input.observedAt);text(input.words,FEEDBACK_LIMITS.record);
 if(!Number.isSafeInteger(input.revision)||input.revision<1||(input.previousDigest!==null&&!hashOK(input.previousDigest)))refuse('invalid_revision');
 const r=input.result;fields(r,['sourceRevision','artifactId','version','contentHash','file','work','anchor','url'],['sourceRevision','artifactId','version','contentHash']);
 if(!shaOK(r.sourceRevision)||!idOK(r.artifactId)||(r.version!==null&&!idOK(r.version))||(r.contentHash!==null&&!hashOK(r.contentHash)))refuse('invalid_result');
 if(r.file!==undefined&&(typeof r.file!=='string'||!r.file||r.file.length>4096||/[\x00-\x1f]/.test(r.file)))refuse('invalid_result_file');
 if(r.anchor!==undefined&&!idOK(r.anchor)||r.url!==undefined&&!safeLink(r.url))refuse('invalid_result_reference');
 if(r.work!==undefined){fields(r.work,['kind','ref']);if(typeof r.work.ref!=='string')refuse('invalid_work');if(r.work.kind==='phase'){if(!/^[1-9]\d{0,8}$/.test(r.work.ref))refuse('invalid_work');}else if(!['issue','pr'].includes(r.work.kind)||!new RegExp(`^${input.project.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}#[1-9]\\d{0,8}$`).test(r.work.ref))refuse('invalid_work');}
 const conflicts=input.conflicts??[];if(!Array.isArray(conflicts)||conflicts.length>20)refuse('invalid_conflicts');
 for(const c of conflicts){fields(c,['ref','reason']);if(!decisionRef(c.ref))refuse('invalid_conflicts');text(c.reason);}
 if(new Set(conflicts.map(c=>c.ref)).size!==conflicts.length)refuse('invalid_conflicts');
 const normalized=structuredClone({...input,conflicts});delete normalized.result.file;
 return normalized;
}
export const observationId=record=>digestOf([record.project,record.source.id,record.result.artifactId,record.result.version]);
export const resultIdentity=(record,project=record.project)=>digestOf([project,record.result.artifactId,record.result.version]);
export function validateResolution(input){
 fields(input,['schema','feedbackDigest','state','actor','at','reference','reason','supersededBy'],['schema','feedbackDigest','state','actor','at']);
 if(input.schema!==1||!hashOK(input.feedbackDigest)||!['linked','declined','superseded'].includes(input.state))refuse('invalid_resolution');actor(input.actor);utc(input.at);
 if(input.state==='linked'&&!(safeLink(input.reference)||typeof input.reference==='string'&&/^proposal:[a-f0-9]{64}$/.test(input.reference)))refuse('invalid_resolution_reference');
 if(input.state==='declined')text(input.reason);
 if(input.state==='superseded'&&!hashOK(input.supersededBy))refuse('invalid_supersession');
 if(input.reference!==undefined&&input.state!=='linked'||input.reason!==undefined&&input.state!=='declined'||input.supersededBy!==undefined&&input.state!=='superseded')refuse('invalid_resolution');
 return structuredClone(input);
}
export function eventFor(current,kind,record){
 const id=kind==='capture'?observationId(record):current?.id;if(!id)refuse('observation_unavailable');
 if(kind==='capture'){
  if(current&&stable(record)===stable(current.capture))return null;
  if(record.revision!==(current?.capture.revision??0)+1||record.previousDigest!==(current?.digest??null))refuse('stale_revision');
  if(current&&(id!==current.id||resultIdentity(record)!==resultIdentity(current.capture)||record.result.contentHash!==current.capture.result.contentHash))refuse('immutable_result_changed');
 }else{if(record.feedbackDigest!==current.digest)refuse('stale_revision');}
 const value={schema:1,id,index:(current?.index??0)+1,previousDigest:current?.digest??null,kind,record};return {...value,digest:digestOf(value)};
}
export function replayEvents(events,project,previousProject){
 let current=null;
 for(const event of events){
  fields(event,['schema','id','index','previousDigest','kind','record','digest']);
  if(!['capture','resolution'].includes(event.kind))refuse('invalid_store');
  const record=event.kind==='capture'?validateCapture(event.record,project,previousProject):validateResolution(event.record),expected=eventFor(current,event.kind,record);
  if(!expected||stable(expected)!==stable(event))refuse('invalid_store');
  current={id:event.id,index:event.index,digest:event.digest,capture:event.kind==='capture'?record:current.capture,resolution:event.kind==='resolution'?record:null};
 }
 return current;
}
export function metadata(current,gaps=[]){
 const r=current.resolution;
 return {id:current.id,project:current.capture.project,revision:current.capture.revision,digest:current.digest,state:gaps.length?'unavailable':r?.state??'pending',coverage:gaps.length?'unavailable':'complete',gaps,result:{...current.capture.result},attribution:'manual',sourceRevisionEvidence:'attributed-not-generation-verified',resolution:r?{state:r.state,at:r.at,...(r.reference?{reference:r.reference}:{}),...(r.supersededBy?{supersededBy:r.supersededBy}:{})}:null};
}
export function feedbackRoute({work,fact,conflicts,context}){
 const gaps=[];let kind='new-change';
 if(work&&work.kind!=='phase'){
  if(!fact||!['open','closed'].includes(fact.state)||fact.ref!==work.ref||fact.kind!==work.kind)gaps.push('work_state_unavailable');
  else kind=fact.state==='open'?'follow-up':'repair';
 }
 if(conflicts.length){
  if(context?.state!=='complete'||context.gaps?.length||conflicts.some(c=>!context.decisions.some(d=>d.ref===c.ref)))gaps.push('accepted_decision_unavailable');
  else kind='reopen-decision';
 }
 return {kind:gaps.length?'unavailable':kind,gaps,work:work??null,fact:fact??null,decisionRefs:conflicts.map(c=>c.ref),acceptance:'not-established'};
}
