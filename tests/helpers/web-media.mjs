// Synthetic Acme Storage/RPC adapters; no remote resources or writes.
import { deflateSync } from 'node:zlib';
import { changesHarness,token } from './web-changes.mjs';
import { createMedia } from '../../lib/web/media.mjs';
import { createWebService } from '../../lib/web/server.mjs';
export {token};
const table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function pngChunk(type,data){let crc=0xffffffff;const payload=Buffer.concat([Buffer.from(type),data]);for(const byte of payload)crc=table[(crc^byte)&255]^(crc>>>8);const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);payload.copy(out,4);out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;}
export function png(width=2,height=2){const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;const rows=Buffer.alloc((width*3+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){rows[y*(width*3+1)+1+x*3]=30;rows[y*(width*3+1)+2+x*3]=150;rows[y*(width*3+1)+3+x*3]=220;}return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),pngChunk('IDAT',deflateSync(rows)),pngChunk('IEND',Buffer.alloc(0))]);}
export function jpeg(){const segment=(marker,data)=>{const out=Buffer.alloc(data.length+4);out[0]=255;out[1]=marker;out.writeUInt16BE(data.length+2,2);data.copy(out,4);return out;};return Buffer.concat([Buffer.from([255,216]),segment(219,Buffer.from([0,...Array(64).fill(1)])),segment(192,Buffer.from([8,0,1,0,1,1,1,17,0])),segment(196,Buffer.from([0,1,...Array(15).fill(0),0,16,1,...Array(15).fill(0),0])),segment(218,Buffer.from([1,1,0,0,63,0])),Buffer.from([63,255,217])]);}
export function mediaHarness(){
 const h=changesHarness(),config={...h.config,ownerIds:[1,2],media:{bucket:'acme-private-captures',retentionDays:30,capacityBytes:268435456}},receipts=new Map(),slots=new Map(),objects=new Map();
 const mediaState={public:false,mode:'success',removeMode:'success',posts:0,deletes:0,requests:[],holdUpload:null,holdDelete:null,failRead:false,failDB:false};
 const fetcher=async(url,options={})=>{
  const path=new URL(url).pathname;
  if(path.endsWith('/rpc/keel_media_rpc')){
   if(mediaState.failDB)throw Error('Synthetic DB unavailable');const p=JSON.parse(options.body);mediaState.requests.push(p);const row=receipts.get(p.p_id),out=r=>r?{id:r.id,state:r.state,revision:r.revision,value:r.value,digest:r.digest,actor:r.actor}:null,json=Response.json;
   const rows=[...receipts.values()].filter(r=>r.scope===p.p_scope&&r.project===p.p_project).sort((a,b)=>a.id.localeCompare(b.id)),slotKey=`${p.p_scope}:${p.p_project}:${p.p_slot}`;
   if(p.p_operation==='list')return json(rows.filter(r=>!p.p_after||r.id>p.p_after).slice(0,p.p_limit).map(out));
   if(p.p_operation==='batch')return json(rows.filter(r=>JSON.parse(p.p_value).includes(r.id)).map(out));
   if(p.p_operation==='slots')return json([...slots.values()].filter(s=>s.scope===p.p_scope&&s.project===p.p_project));
   if(p.p_operation==='slot')return json(slots.get(slotKey)??null);
   if(p.p_operation==='reserve'){
    if(row){if(row.scope!==p.p_scope||row.project!==p.p_project||row.actor!==p.p_actor)return json(null);if(row.digest!==p.p_digest)return json({conflict:true});return json({...out(row),created:false});}
    if(receipts.size>=1000||[...receipts.values()].filter(r=>r.state!=='deleted').reduce((n,r)=>n+r.bytes,0)+p.p_bytes>p.p_capacity||[...receipts.values()].reduce((n,r)=>n+Buffer.byteLength(r.value),0)+Buffer.byteLength(p.p_value)>52428800)return json({capacity:true});
    const saved={id:p.p_id,scope:p.p_scope,project:p.p_project,actor:p.p_actor,digest:p.p_digest,value:p.p_value,bytes:p.p_bytes,state:'prepared',revision:1};receipts.set(saved.id,saved);return json({...out(saved),created:true});
   }
   if(!row||row.scope!==p.p_scope||row.project!==p.p_project)return json(null);
   if(p.p_operation==='read')return json(out(row));
   if(p.p_operation==='attach'){
    const s=slots.get(slotKey);if(row.state!=='verified')return json({conflict:true});if(s&&s.artifact===row.id&&s.requirements===p.p_requirements)return json(s);if((s?.revision??0)!==p.p_expected)return json({conflict:true});const saved={scope:p.p_scope,project:p.p_project,slot:p.p_slot,artifact:row.id,requirements:p.p_requirements,revision:p.p_expected+1};slots.set(slotKey,saved);return json(saved);
   }
   const allowed={uploading:['prepared'],uncertain:['uploading'],verified:['uploading','uncertain'],deleting:['verified'],'delete-uncertain':['deleting'],deleted:['deleting','delete-uncertain']};
   if(row.revision!==p.p_expected||!allowed[p.p_operation]?.includes(row.state)||p.p_operation==='uploading'&&row.actor!==p.p_actor)return json({conflict:true});row.state=p.p_operation;row.revision++;return json(out(row));
  }
  if(path.startsWith('/storage/v1/')){
   mediaState.requests.push({path,method:options.method??'GET'});
   if(path.startsWith('/storage/v1/bucket/'))return Response.json({id:config.media.bucket,name:config.media.bucket,public:mediaState.public});
   const key=path.split('/').at(-1);
   if(options.method==='POST'){
    mediaState.posts++;mediaState.onPost?.();if(mediaState.holdUpload)await mediaState.holdUpload;if(mediaState.mode==='never')throw Error('Synthetic lost upload before object');if(objects.has(key))return Response.json({}, {status:409});objects.set(key,Buffer.from(options.body));if(mediaState.mode==='lost')throw Error('Synthetic upload response lost');return Response.json({Key:'private-key-never-public'});
   }
   if(options.method==='DELETE'){
    mediaState.deletes++;mediaState.onDelete?.();if(mediaState.holdDelete)await mediaState.holdDelete;const keys=JSON.parse(options.body).prefixes;if(mediaState.removeMode==='never')throw Error('Synthetic uncertain delete');keys.forEach(k=>objects.delete(k));if(mediaState.removeMode==='lost')throw Error('Synthetic delete response lost');return Response.json([]);
   }
   if(mediaState.failRead)throw Error('Synthetic object unavailable');return objects.has(key)?new Response(objects.get(key),{headers:{'Content-Type':'application/octet-stream'}}):Response.json({code:'NoSuchKey',message:'Object not found'}, {status:404});
  }
  return h.fetcher(url,options);
 };
 const media=createMedia(config,{fetcher,now:()=>h.state.now,inspectTarget:h.changes.captureTarget});
 async function input(requestId='a'.repeat(64),slotId='desktop-after'){const t=await h.changes.captureTarget(h.access,token,h.project,'acme-search',slotId);return {requestId,sourceDigest:t.sourceDigest,slotDigest:t.slotDigest,expectedRevision:0,bytes:png().toString('base64'),confirmed:true,provenance:{revision:t.slot.revision,environment:'Acme private preview',viewport:t.slot.viewport,viewportWidth:1280,viewportHeight:800,scenario:t.slot.scenario,capturedAt:new Date(h.state.now).toISOString(),caption:'Acme search results',alt:'Acme anvil result appears in the search list.'}};}
 return {...h,config,fetcher,media,mediaState,receipts,slots,objects,input,service:createWebService(config,{fetcher,now:()=>h.state.now})};
}
