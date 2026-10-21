// Pure guided-walk definitions, draft transitions and phase-92 observation history.
import { fields, digestOf, feedbackHash, validateCapture, observationId, eventFor, replayEvents, safeLink } from '../feedback.mjs';
import { WebError } from './common.mjs';
const id=x=>typeof x==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(x);
const sha=(x,n)=>typeof x==='string'&&new RegExp(`^[a-f0-9]{${n}}$`).test(x);
const path=x=>typeof x==='string'&&x.length<=500&&/^[A-Za-z0-9_./-]+$/.test(x)&&x.split('/').every(p=>p&&p!=='.'&&p!=='..')&&!x.startsWith('.');
const text=(x,n=4000)=>typeof x==='string'&&x.trim()&&x.length<=n&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(x);
export function validateWalk(value){
 try{
  fields(value,['version','id','title','target','readiness','result','steps']);
  if(value.version!==1||!id(value.id)||!text(value.title,240)||Buffer.byteLength(JSON.stringify(value))>262144)throw Error();
  fields(value.target,['phase','acceptanceHash']);if(!path(value.target.phase)||!/^docs\/phases\/\d+-[a-z0-9-]+\.md$/.test(value.target.phase)||!sha(value.target.acceptanceHash,64))throw Error();
  fields(value.readiness,['state','reason']);if(!['ready','not-ready'].includes(value.readiness.state)||!text(value.readiness.reason))throw Error();
  const r=value.result;fields(r,['sourceRevision','artifactId','version','contentHash','path','environment','previewUrl'],['sourceRevision','artifactId','version','contentHash','path','environment']);
  if(!sha(r.sourceRevision,40)||!id(r.artifactId)||!id(r.version)||!sha(r.contentHash,64)||!path(r.path)||!text(r.environment,200)||r.previewUrl!==undefined&&!safeLink(r.previewUrl))throw Error();
  if(!Array.isArray(value.steps)||value.steps.length<1||value.steps.length>20||new Set(value.steps.map(s=>s.id)).size!==value.steps.length)throw Error();
  for(const s of value.steps){fields(s,['id','instruction','expected','requires']);if(!id(s.id)||s.id==='final'||!text(s.instruction)||!text(s.expected)||!Array.isArray(s.requires)||s.requires.length>20||new Set(s.requires).size!==s.requires.length||s.requires.some(r=>!id(r)||!value.steps.some(s=>s.id===r)))throw Error();}
  const active=new Set(),done=new Set();function visit(s){if(active.has(s.id))throw Error();if(done.has(s.id))return;active.add(s.id);for(const r of s.requires)visit(value.steps.find(s=>s.id===r));active.delete(s.id);done.add(s.id);}value.steps.forEach(visit);
  return structuredClone(value);
 }catch{throw new WebError('invalid_walk_definition',400);}
}
export function resultFingerprint(definition){const {previewUrl,...result}=definition.result;return digestOf(result);}
function fingerprints(definition){
 const memo=new Map();function visit(id){if(memo.has(id))return memo.get(id);const s=definition.steps.find(s=>s.id===id),hash=digestOf({...s,requires:s.requires.map(r=>[r,visit(r)]).sort()});memo.set(id,hash);return hash;}definition.steps.forEach(s=>visit(s.id));return memo;
}
export function stepFingerprint(definition,id){return fingerprints(definition).get(id);}
function contexts(value){
 const definition=value.capture.definition,prints=fingerprints(definition),memo=new Map(),latest=id=>value.observations.findLast(o=>o.stepId===id);
 function current(id){const entry=latest(id);return entry&&entry.context===context(id)?entry:null;}
 function context(id){if(memo.has(id))return memo.get(id);const step=definition.steps.find(s=>s.id===id),requires=id==='final'?definition.steps.map(s=>s.id):step.requires;
  const deps=requires.map(r=>{const entry=current(r);return [r,entry?.outcome??null,entry?.feedbackDigest??null];}).sort();
  const hash=digestOf([value.epoch,value.environment,resultFingerprint(definition),id==='final'?null:prints.get(id),value.stepEpochs[id]??0,deps]);memo.set(id,hash);return hash;
 }
 return {context,current};
}
export function newWalkDraft({actorId,project,walkId,capture,resultBytes}){
 return {schema:1,actorId,projectId:project.id,repo:project.repo,walkId,revision:1,epoch:1,stepEpochs:{},capture,environment:'',confirmation:null,choice:null,observations:[],feedback:{},snapshots:resultBytes?{[capture.definition.result.contentHash]:Buffer.from(resultBytes).toString('base64')}: {}};
}
export function refreshDraft(value,capture,resultBytes){
 const next=structuredClone(value);next.revision++;
 if(resultFingerprint(value.capture.definition)!==resultFingerprint(capture.definition)||digestOf(value.capture.definition.target)!==digestOf(capture.definition.target)){next.epoch++;next.confirmation=null;}
 const before=fingerprints(value.capture.definition),after=fingerprints(capture.definition);for(const [id,hash] of after)if(before.get(id)!==hash)next.stepEpochs[id]=(next.stepEpochs[id]??0)+1;
 next.capture=capture;
 if(resultBytes){const key=capture.definition.result.contentHash,encoded=Buffer.from(resultBytes).toString('base64');if(next.snapshots[key]&&next.snapshots[key]!==encoded)throw new WebError('immutable_result_changed',409);next.snapshots[key]=encoded;}
 return next;
}
function noteAt(value,entry){if(!entry)return '';const events=value.feedback[entry.feedbackId],event=events?.find(e=>e.digest===entry.feedbackDigest);if(!event)throw new WebError('invalid_walk_storage');return entry.hasNote?event.record.words:'';}
export function draftView(row){
 const value=row.value,definition=value.capture.definition;
 const {current}=contexts(value);
 const steps=definition.steps.map(s=>{const entry=current(s.id);return {id:s.id,outcome:entry?.outcome??'unobserved',note:noteAt(value,entry),current:!!entry,feedbackId:entry?.feedbackId??null,feedbackDigest:entry?.feedbackDigest??null};});
 const final=current('final');
 return {id:row.id,revision:row.revision,digest:row.digest,environment:value.environment,resultConfirmed:value.confirmation===digestOf([resultFingerprint(definition),value.environment]),steps,finalObservation:noteAt(value,final),choice:value.choice,
  counts:{observed:steps.filter(s=>s.outcome!=='unobserved').length,passed:steps.filter(s=>s.outcome==='pass').length,failed:steps.filter(s=>s.outcome==='fail').length,blocked:steps.filter(s=>s.outcome==='blocked').length,unobserved:steps.filter(s=>s.outcome==='unobserved').length},historyCount:value.observations.length,
  history:value.observations.map(o=>({stepId:o.stepId,outcome:o.outcome,note:noteAt(value,o),environment:o.environment,result:o.result,step:o.step,time:o.at,at:o.at,feedbackId:o.feedbackId,feedbackDigest:o.feedbackDigest}))};
}
export function editWalkDraft(row,input,at){
 try{fields(input,['expectedRevision','sourceDigest','environment','resultConfirmed','step','finalObservation','choice'],['expectedRevision','sourceDigest']);}catch{throw new WebError('invalid_walk_save',400);}
 if(input.expectedRevision!==row.revision)throw new WebError('draft_conflict',409);
 if(input.sourceDigest!==row.value.capture.sourceDigest)throw new WebError('walk_source_changed',409);
 const value=structuredClone(row.value),definition=value.capture.definition;
 if(input.environment!==undefined){if(typeof input.environment!=='string'||input.environment.length>200||/[\r\n\x00-\x1f]/.test(input.environment))throw new WebError('invalid_environment',400);const environment=input.environment.trim();if(environment!==value.environment){value.epoch++;value.confirmation=null;}value.environment=environment;}
 if(input.resultConfirmed!==undefined){if(typeof input.resultConfirmed!=='boolean')throw new WebError('invalid_confirmation',400);if(input.resultConfirmed&&!value.environment)throw new WebError('environment_required',400);value.confirmation=input.resultConfirmed?digestOf([resultFingerprint(definition),value.environment]):null;}
 if(input.choice!==undefined){if(input.choice!==null&&(typeof input.choice!=='string'||input.choice.length>500))throw new WebError('invalid_choice',400);value.choice=input.choice;}
 function observe(stepId,outcome,note){
  const context=contexts(value).context(stepId),sourceId=`walk-${digestOf([value.walkId,stepId,context])}`;
  const capture={schema:1,project:value.repo,source:{kind:'manual',id:sourceId},author:{kind:'manual',name:`GitHub user ${value.actorId}`},observedAt:at,words:note||({pass:'This works.',unobserved:'No outcome recorded.'}[outcome]),revision:1,previousDigest:null,result:{sourceRevision:definition.result.sourceRevision,artifactId:definition.result.artifactId,version:definition.result.version,contentHash:definition.result.contentHash,work:{kind:'phase',ref:String(Number(definition.target.phase.match(/\/(\d+)-/)[1]))},anchor:stepId,...(definition.result.previewUrl?{url:definition.result.previewUrl}:{})},conflicts:[]};
  const feedbackId=observationId(capture),events=value.feedback[feedbackId]??[],prior=replayEvents(events,value.repo);capture.revision=(prior?.capture.revision??0)+1;capture.previousDigest=prior?.digest??null;
  const record=validateCapture(capture,value.repo),event=eventFor(prior,'capture',record);value.feedback[feedbackId]=[...events,event];
  value.observations.push({step:stepId==='final'?null:structuredClone(definition.steps.find(s=>s.id===stepId)),stepId,outcome,feedbackId,feedbackDigest:event.digest,hasNote:!!note,context,environment:value.environment,result:definition.result,at});
 }
 if(input.step!==undefined){
  try{fields(input.step,['id','outcome','note']);}catch{throw new WebError('invalid_walk_step',400);}
  const s=input.step;if(!definition.steps.some(step=>step.id===s.id)||!['unobserved','pass','fail','blocked'].includes(s.outcome)||typeof s.note!=='string'||s.note.length>4000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s.note)||['fail','blocked'].includes(s.outcome)&&!s.note.trim())throw new WebError('invalid_walk_step',400);
  if(s.outcome==='pass'&&definition.steps.find(step=>step.id===s.id).requires.some(r=>contexts(value).current(r)?.outcome!=='pass'))throw new WebError('prerequisite_not_passed',409);
  const prior=contexts(value).current(s.id);if(prior?prior.outcome!==s.outcome||noteAt(value,prior)!==s.note:s.outcome!=='unobserved'||s.note!=='')observe(s.id,s.outcome,s.note);
 }
 if(input.finalObservation!==undefined){if(typeof input.finalObservation!=='string'||input.finalObservation.length>4000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input.finalObservation))throw new WebError('invalid_observation',400);const prior=contexts(value).current('final'),before=contexts(row.value).current('final');const replayedWithEdit=before&&noteAt(row.value,before)===input.finalObservation&&!prior;if(!replayedWithEdit&&noteAt(value,prior)!==input.finalObservation)observe('final','unobserved',input.finalObservation);}
 if(digestOf(value)===digestOf(row.value))return row.value;value.revision++;return value;
}
export function acceptanceGaps(row){
 const view=draftView(row),definition=row.value.capture.definition,gaps=[];
 if(!view.environment)gaps.push('actual_environment_required');if(!view.resultConfirmed)gaps.push('result_confirmation_required');if(!view.finalObservation.trim())gaps.push('final_observation_required');
 for(const step of definition.steps){const current=view.steps.find(s=>s.id===step.id);if(current.outcome!=='pass')gaps.push(`step_not_passed:${step.id}`);if(step.requires.some(r=>view.steps.find(s=>s.id===r).outcome!=='pass'))gaps.push(`prerequisite_not_passed:${step.id}`);}
 const bytes=row.value.snapshots[definition.result.contentHash];if(!bytes||feedbackHash(Buffer.from(bytes,'base64'))!==definition.result.contentHash)gaps.push('result_bytes_unavailable');
 return gaps;
}
