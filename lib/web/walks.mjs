import { writeName } from '../names.mjs';
import { operationMarker } from './name-transition.mjs';
// Hosted walks use immutable source readers and pure plans. No project code runs.
import { openBoxes, yourPartIn, partsByBox, walkWritePlan } from '../board.mjs';
import { parsePhase, validateGraph, render, DONE, dated, waitsOf, satisfies } from '../../practices/phases/files/scripts/roadmap.mjs';
import { decisionContext } from '../../practices/reconciliation/files/scripts/plates/decision-context.mjs';
import { robotPolicy } from '../../practices/climb/files/scripts/plates/robot-policy.mjs';
import { proposeFeedback } from '../feedback-route.mjs';
import { digestOf, feedbackHash, replayEvents, fields } from '../feedback.mjs';
import { hash, random, WebError } from './common.mjs';
import { createDecisionGitHub, intentFiles } from './decision-github.mjs';
import { createOperationStore } from './operation-store.mjs';
import { createWalkStore } from './walks-store.mjs';
import { validateWalk, newWalkDraft, refreshDraft, editWalkDraft, draftView, acceptanceGaps } from './walks-model.mjs';
const utf8=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
const validId=id=>typeof id==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(id);
const day=now=>new Date(now()).toISOString().slice(0,10);
const checkId=id=>{if(!validId(id))throw new WebError('invalid_walk',400);};
const read=async(reader,path)=>utf8(await reader.readFile(path));
async function readConfig(reader){
 let raw;
 try{raw=await read(reader,'.plates/plates.json');}
 catch(error){if(error.code!=='ENOENT')throw error;raw=await read(reader,'.keel/keel.json');}
 return JSON.parse(raw);
}
function context(reader,repo,refs){return decisionContext({reader,issue:`${repo}#1`,issueBody:'```'+writeName('fence:keel-impact')+'\n'+JSON.stringify({version:1,decisions:refs})+'\n```'});}
export function createWalks(config,{fetcher=fetch,now=Date.now}={}){
 const store=createWalkStore(config,fetcher),operations=createOperationStore(config,fetcher);
 async function inspect(access,token,project,id){
  checkId(id);
  const provider=createDecisionGitHub(token,{fetcher}),snapshot=await provider.snapshot(project),{reader,entries,source}=snapshot;
  const cfg=await readConfig(reader),path=`docs/walks/${id}.json`,definition=validateWalk(JSON.parse(await read(reader,path)));
  if(definition.id!==id)throw new WebError('invalid_walk_definition',400);
  const gaps=[],raw=await read(reader,definition.target.phase),file=definition.target.phase.split('/').at(-1),phase=parsePhase(file,raw);
  const candidates=openBoxes(raw).filter(box=>box.walk&&feedbackHash(box.text)===definition.target.acceptanceHash),box=candidates.length===1?candidates[0]:null;
  if(!box)gaps.push('acceptance_target_unavailable');
  const names=(await reader.readdir('docs/phases')).filter(name=>name.endsWith('.md')&&name!=='README.md');
  if(names.length>180)throw new WebError('phase_inventory_limit',413);
  const raws=[];for(const name of names)raws.push([name,await read(reader,`docs/phases/${name}`)]);
  const phases=raws.map(([name,text])=>parsePhase(name,text)).sort((a,b)=>a.id-b.id),goals=JSON.parse(await read(reader,'docs/goals.json'));
  try{validateGraph(phases,goals);}catch{throw new WebError('invalid_phase_inventory',409);}
  for(const p of phases)for(const file of p.evidence){const stat=await reader.stat(`docs/${file}`);if(stat.type!=='file'||!stat.size)throw new WebError('evidence_unavailable',409);}
  if(cfg.phases?.source==='milestones')gaps.push('milestone_planning_inspect_only');
  if(cfg.local?.includes('phases')||!cfg.practices?.includes('phases'))gaps.push('managed_phase_renderer_required');
  if(DONE.includes(phase.status)||phase.status==='superseded')gaps.push('phase_not_open');
  if(dated(phase,day(now)))gaps.push('phase_date_not_ready');
  if(waitsOf(phase)!=='owner')gaps.push('phase_not_waiting_for_owner');
  if(phase.depends.some(id=>!satisfies(phases.find(p=>p.id===id))))gaps.push('phase_dependencies_not_ready');
  if(definition.readiness.state!=='ready')gaps.push('authored_readiness_not_ready');
  const parts=partsByBox(yourPartIn(raw),raw),part=parts.find(p=>p.n===box?.n)?.part;
  if(part?.ready!==undefined&&part.ready!==null&&part.ready!==true)gaps.push('your_part_not_ready');
  const bundle=await decisionContext({reader,phase:String(phase.id)});
  if(bundle.gaps.length)gaps.push('decision_context_unavailable');
  let resultBytes=null;
  try{const result=await provider.readResult(project,definition.result.sourceRevision,definition.result.path);if(feedbackHash(result.bytes)!==definition.result.contentHash)gaps.push('result_hash_mismatch');else resultBytes=result.bytes;}
  catch(error){if([401,404].includes(error.status))throw error;gaps.push('result_bytes_unavailable');}
  const definitionDigest=digestOf(definition),sourceDigest=digestOf({source,definitionDigest,context:bundle.digest,day:day(now)});
  const capture={definition,definitionDigest,sourceDigest,source,target:{...definition.target,box:box?.n??null,text:box?.text??null},gaps,choices:part?.choices??[],keepsOpen:part?.keepsOpen??[],context:{state:bundle.state,digest:bundle.digest},project:{...project,name:typeof cfg.name==='string'?cfg.name:project.id},verified:!!resultBytes,canWrite:snapshot.canWrite&&access.contentsPermission==='write'};
  return {capture,provider,reader,entries,raw,phase,phases,goals,cfg,resultBytes};
 }
 function model(row){
  const c=row.value.capture,d=c.definition;
  return {schema:1,project:c.project,walk:{id:d.id,title:d.title,definitionPath:`docs/walks/${d.id}.json`,definitionDigest:c.definitionDigest,target:c.target,readiness:d.readiness,result:{...d.result,verification:c.verified?'bytes-verified':'unavailable',servingEvidence:'owner-observation'},steps:d.steps},source:c.source,sourceDigest:c.sourceDigest,ready:c.gaps.length===0,gaps:c.gaps,choices:c.choices,keepsOpen:c.keepsOpen,context:c.context,draft:draftView(row),submissionEnabled:config.decisionWrites===true,canWrite:c.canWrite};
 }
 async function detail(access,token,project,id){
  const current=await inspect(access,token,project,id);let row=await store.read(access.userId,project,id);
  if(!row)row=await store.save(access.userId,project,id,0,newWalkDraft({actorId:access.userId,project,walkId:id,capture:current.capture,resultBytes:current.resultBytes}));
  else if(row.value.capture.sourceDigest!==current.capture.sourceDigest||digestOf(row.value.capture)!==digestOf(current.capture))row=await store.save(access.userId,project,id,row.revision,refreshDraft(row.value,current.capture,current.resultBytes));
  return model(row);
 }
 async function list(access,token,project){
  const provider=createDecisionGitHub(token,{fetcher}),{reader}=await provider.snapshot(project),items=[],gaps=[];let names;
  try{names=await reader.readdir('docs/walks');}catch(error){if(error.code!=='ENOENT')throw error;return {schema:1,project,items,gaps:['authored_walks_missing']};}
  const selected=names.filter(name=>/^[a-z][a-z0-9-]{0,63}\.json$/.test(name));if(selected.length>50)gaps.push('walk_inventory_limit');
  for(const name of selected.slice(0,50)){
   try{const d=validateWalk(JSON.parse(await read(reader,`docs/walks/${name}`)));if(`${d.id}.json`!==name)throw Error();items.push({id:d.id,title:d.title,path:`docs/walks/${name}`,phase:d.target.phase,stepCount:d.steps.length,ready:false,gaps:['detail_readiness_required']});}
   catch{gaps.push(`invalid_walk:${name}`);}
  }
  if(!selected.length)gaps.push('authored_walks_missing');return {schema:1,project,items,gaps};
 }
 async function save(access,token,project,id,input){
  checkId(id);const row=await store.read(access.userId,project,id);if(!row)throw new WebError('draft_not_found',404);
  const value=editWalkDraft(row,input,new Date(now()).toISOString());if(value.revision===row.revision)return model(row);const saved=await store.save(access.userId,project,id,row.revision,value);return model(saved);
 }
 async function plan(access,token,project,id,draftDigest){
  const checked=await inspect(access,token,project,id),row=await store.read(access.userId,project,id);
  if(!row||row.digest!==draftDigest)throw new WebError('stale_draft',409);
  if(row.value.capture.sourceDigest!==checked.capture.sourceDigest)throw new WebError('walk_source_changed',409);
  if(checked.capture.gaps.length||acceptanceGaps(row).length)throw new WebError('walk_not_ready',409);
  const view=draftView(row),c=checked.capture;
  const canonicalChoice=c.choices.find(choice=>choice.trim().toLowerCase()===view.choice?.trim().toLowerCase());
  if(c.choices.length&&!canonicalChoice||!c.choices.length&&view.choice!==null&&view.choice!=='')throw new WebError('invalid_choice',400);
  if(c.keepsOpen.some(choice=>choice.trim().toLowerCase()===canonicalChoice?.trim().toLowerCase()))throw new WebError('choice_keeps_open',409);
  const evidence=checked.phase.evidence[0],evidencePath=evidence?`docs/${evidence}`:null;
  if(evidencePath&&!/^docs\/evidence\/[^/]+\.md$/.test(evidencePath))throw new WebError('unsupported_evidence_path',409);
  const evidenceText=evidencePath?await read(checked.reader,evidencePath):undefined;
  const write=walkWritePlan({file:c.definition.target.phase.split('/').at(-1),raw:checked.raw,evidenceText,note:view.finalObservation,box:c.target.box,choice:canonicalChoice,today:day(now)});
  if(write.data.keepsOpen)throw new WebError('choice_keeps_open',409);
  const replacements=new Map(write.writes),phases=checked.phases.map(p=>replacements.has(`docs/phases/${p.file}`)?parsePhase(p.file,replacements.get(`docs/phases/${p.file}`)):p);
  try{validateGraph(phases,checked.goals);}catch{throw new WebError('invalid_phase_inventory',409);}
  const links=[];for(const [label,file] of [['Design','design.md'],['Lessons','lessons.md']])if(checked.entries.has(`docs/${file}`)&&(await checked.reader.stat(`docs/${file}`)).type==='file')links.push([label,file]);
  const roadmap=render({config:checked.cfg,phases,goals:checked.goals,links});
  const priorRoadmap=checked.entries.has('docs/ROADMAP.md')?await read(checked.reader,'docs/ROADMAP.md'):null;
  if(roadmap!==priorRoadmap)write.writes.push(['docs/ROADMAP.md',roadmap]);
  for(const [path] of write.writes)if(path!==c.definition.target.phase&&path!==write.data.evidence&&path!=='docs/ROADMAP.md')throw new WebError('invalid_write_files',400);
  // A newly named evidence record must never overwrite an unrelated existing file.
  for(const path of write.created)if(checked.entries.has(path))throw new WebError('evidence_destination_exists',409);
  const files=intentFiles({files:write.writes.map(([path,content])=>({path,content,originalBlob:checked.entries.get(path)?.sha??null}))});
  return {...checked,row,view,files,consequence:write.what};
 }
 async function preview(access,token,project,id,input){
  try{fields(input,['draftDigest']);}catch{throw new WebError('invalid_preview',400);}
  const checked=await plan(access,token,project,id,input.draftDigest),c=checked.capture;
  const previewId=hash(random()),operationId=hash(`walk-operation:${previewId}`),commitMessage=`Record Plates guided walk\n\n${operationMarker(operationId)}`;
  const result={schema:1,kind:'walk',id:previewId,operationId,operationUrl:`/projects/${project.id}/operations/${operationId}`,expiresAt:new Date(now()+900000).toISOString(),project:c.project,source:c.source,target:{kind:'walk',id},draftId:checked.row.id,draftDigest:checked.row.digest,sourceDigest:c.sourceDigest,contextDigest:c.context.digest,files:checked.files,observation:checked.view.finalObservation,consequence:checked.consequence,commitMessage,visibility:c.source.visibility,canSubmit:config.decisionWrites===true&&c.canWrite,refusal:config.decisionWrites!==true?'Submission is disabled until the owner enables decision writes.':!c.canWrite?'Current App and user Contents write permission is unavailable.':null};
  result.digest=digestOf(result);
  const saved={...result,actorId:access.userId,sourceRevision:access.sourceRevision};
  if(!await operations.createPreview(previewId,operations.scopeFor(access.userId,project),saved))throw new WebError('preview_conflict',409);
  return result;
 }
 async function inspectPreview(access,token,project,preview){
  const checked=await plan(access,token,project,preview.target.id,preview.draftDigest);
  if(checked.capture.sourceDigest!==preview.sourceDigest)throw new WebError('stale_preview',409);
  return {model:{supported:true,source:checked.capture.source,context:checked.capture.context},canWrite:checked.capture.canWrite,provider:checked.provider,files:checked.files};
 }
 async function repair(access,token,project,id,input){
  try{fields(input,['stepId','feedbackDigest','publication']);}catch{throw new WebError('invalid_repair',400);}
  checkId(id);const row=await store.read(access.userId,project,id);if(!row)throw new WebError('draft_not_found',404);
  const entry=row.value.observations.find(o=>o.stepId===input.stepId&&o.feedbackDigest===input.feedbackDigest&&['fail','blocked'].includes(o.outcome));if(!entry)throw new WebError('observation_not_found',404);
  const bytes=row.value.snapshots[entry.result.contentHash];if(!bytes||feedbackHash(Buffer.from(bytes,'base64'))!==entry.result.contentHash)throw new WebError('result_bytes_unavailable',409);
  const events=row.value.feedback[entry.feedbackId],index=events.findIndex(e=>e.digest===input.feedbackDigest),current=replayEvents(events.slice(0,index+1),project.repo);
  const provider=createDecisionGitHub(token,{fetcher}),{reader}=await provider.snapshot(project),cfg=await readConfig(reader);
  const publication=structuredClone(input.publication);
  if(publication?.rubric&&typeof publication.rubric.problem==='string')publication.rubric.problem+=`\n\nOriginal guided-walk observation:\nStep ${entry.step.id}: ${entry.step.instruction}\nExpected: ${entry.step.expected}\nPrerequisites: ${entry.step.requires.join(', ')||'none'}\nActual environment: ${entry.environment||'not supplied'}\nOutcome: ${entry.outcome}\nAuthored result path: ${entry.result.path}\nIntended environment: ${entry.result.environment}`;
  return proposeFeedback({current,publication,adapter:{context:refs=>context(reader,project.repo,refs),workFact:async work=>{if(work?.kind!=='phase')throw new WebError('work_fact_unavailable');return null;},policy:async()=>robotPolicy(cfg)}});
 }
 return {list,detail,save,preview,repair,inspectPreview};
}
