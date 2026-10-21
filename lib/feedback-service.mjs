import { resolve, join } from 'node:path';
import { FEEDBACK_LIMITS, FeedbackError, refuse, validateCapture, validateResolution, observationId, resultIdentity, eventFor, metadata, digestOf, feedbackHash, hashOK } from './feedback.mjs';
import { createFeedbackStore, safeRead, safeDirectory, readAuthored } from './feedback-store.mjs';
import { proposeFeedback } from './feedback-route.mjs';
function output(operation,status,exitCode,extra={}){const data={schema:1,operation:`feedback.${operation}`,status,coverage:[],...extra};return {data,exitCode,text:`feedback ${operation}: ${status}${data.item?` ${data.item.id} (${data.item.state})`:''}${data.error?` — ${data.error}`:''}${data.digest?`\nDigest: ${data.digest}`:''}${data.outbound?`\nDestination: ${data.destination}\n\n${data.outbound.title}\n\n${data.outbound.body}`:''}${data.items?.length?`\n${data.items.map(i=>`${i.id} ${i.state}${i.resolution?.reference?` ${i.resolution.reference}`:''}`).join('\n')}`:''}`};}
async function guarded(operation,work){try{return await work();}catch(e){return output(operation,'refused',2,{error:e instanceof FeedbackError?e.code:'feedback_unavailable',coverage:[{source:'private-feedback',state:'unavailable'}]});}}
async function openStore({root,env}){root=await safeDirectory(root);let config;try{config=JSON.parse((await safeRead(join(root,'.plates/plates.json'),FEEDBACK_LIMITS.record)).toString());}catch{refuse('project_unavailable');}
 if(typeof config.repo!=='string')refuse('project_unavailable');return {root,project:config.repo.toLowerCase(),store:await createFeedbackStore({root,project:config.repo.toLowerCase(),env})};}
const coverage=gaps=>[{source:'reviewed-result',state:gaps.length?'unavailable':'complete',gaps}];
async function selectedResult(root,authored,record,store,current){
 const retained=await store.snapshot(record);if(!retained.gaps.length)return retained;
 if(current)return retained;
 if(record.result.version===null||record.result.contentHash===null)return {bytes:null,gaps:['immutable_version_unavailable']};
 if(authored.result.file===undefined)return {bytes:null,gaps:['version_bytes_unavailable']};
 let bytes;try{bytes=await safeRead(resolve(root,authored.result.file),FEEDBACK_LIMITS.result);}catch(e){if(e.code==='ENOENT')return {bytes:null,gaps:['version_bytes_unavailable']};throw e;}
 if(feedbackHash(bytes)!==record.result.contentHash)refuse('result_hash_mismatch');return {bytes,gaps:[]};
}
export async function feedbackCapture(options){return guarded('capture',async()=>{
 const {root,project,store}=await openStore(options),authored=await readAuthored(root,options.file),record=validateCapture(authored,project),id=observationId(record),all=await store.inventory(),current=all.rows.find(r=>r.id===id)??null;
 for(const row of all.rows)if(resultIdentity(row.capture)===resultIdentity(record)&&row.capture.result.contentHash!==record.result.contentHash)refuse('immutable_result_changed');
 const selected=await selectedResult(root,authored,record,store,current),event=eventFor(current,'capture',record);
 if(!event)return output('capture','unchanged',0,{item:metadata(current,selected.gaps),coverage:coverage(selected.gaps)});
 const next={id,index:event.index,digest:event.digest,capture:record,resolution:null},digest=digestOf({operation:'capture',event,retained:!selected.gaps.length,gaps:selected.gaps});
 const extra={item:metadata(next,selected.gaps),digest,coverage:coverage(selected.gaps)};
 if(options.yes!==true)return output('capture','preview',3,extra);
 if(options.digest!==digest)refuse('preview_digest_mismatch');
 const saved=await store.append({kind:'capture',record,id,expected:current?.digest??null,bytes:selected.bytes});
 return output('capture','stored',0,{...extra,item:metadata(saved,selected.gaps)});
 });}
export async function feedbackList(options){return guarded('list',async()=>{
 const {store}=await openStore(options),{rows}=await store.inventory(),items=[];
 for(const row of rows)items.push(metadata(row,(await store.snapshot(row.capture)).gaps));
 const unavailable=items.some(i=>i.state==='unavailable');
 return output('list',unavailable?'unavailable':'ok',0,{items,coverage:[{source:'private-feedback',state:'complete',observations:items.length},...(unavailable?[{source:'reviewed-results',state:'unavailable'}]:[])]});
 });}
export async function feedbackResolve(options){return guarded('resolve',async()=>{
 if(!hashOK(options.id))refuse('invalid_id');const {root,store}=await openStore(options),all=await store.inventory(),current=all.rows.find(r=>r.id===options.id);if(!current)refuse('observation_unavailable');
 const record=validateResolution(await readAuthored(root,options.record));
 if(record.state==='superseded'&&(record.supersededBy===current.id||!all.rows.some(r=>r.id===record.supersededBy)))refuse('supersession_unavailable');
 const event=eventFor(current,'resolution',record),selected=await store.snapshot(current.capture),next={...current,index:event.index,digest:event.digest,resolution:record},digest=digestOf({operation:'resolve',event});
 const extra={item:metadata(next,selected.gaps),digest,coverage:coverage(selected.gaps)};
 if(options.yes!==true)return output('resolve','preview',3,extra);if(options.digest!==digest)refuse('preview_digest_mismatch');
 const saved=await store.append({kind:'resolution',record,id:current.id,expected:current.digest});return output('resolve','stored',0,{...extra,item:metadata(saved,selected.gaps)});
 });}
export async function feedbackPropose(options){return guarded('propose',async()=>{
 if(!hashOK(options.id))refuse('invalid_id');const {root,store}=await openStore(options),{rows}=await store.inventory(),current=rows.find(r=>r.id===options.id);if(!current)refuse('observation_unavailable');
 const selected=await store.snapshot(current.capture);if(selected.gaps.length)return output('propose','unavailable',2,{item:metadata(current,selected.gaps),coverage:coverage(selected.gaps)});
 const publication=await readAuthored(root,options.record),proposal=await proposeFeedback({root,current,publication,env:options.env,github:options.github,now:options.now});
 return output('propose',proposal.status,proposal.status==='preview'?3:2,proposal);
 });}
