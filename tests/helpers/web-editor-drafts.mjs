// Synthetic Acme transport; actual auth, typed service and encryption run unchanged.
import {modelHarness} from './web-model-tasks.mjs';
import {createWebService} from '../../lib/web/server.mjs';
export async function editorHarness() {
 const h=await modelHarness(),rows=new Map();let generation=0;
 const db={rows,lost:false,before:null,calls:[]};
 const fetcher=async(url,options={})=>{
  if(new URL(url).pathname!=='/rest/v1/rpc/keel_editor_draft_rpc')return h.fetcher(url,options);
  const p=JSON.parse(options.body);db.calls.push(p);if(db.before)await db.before(p);
  let r=rows.get(p.p_scope);if(!r){if(p.p_operation!=='read')return Response.json({conflict:true});r={revision:++generation,state:'empty',digest:null,saveId:null,savedAt:null,expiresAt:null,value:null};rows.set(p.p_scope,r);}
  if(r.state==='saved'&&Date.parse(r.expiresAt)<=h.state.now){r={...r,revision:++generation,state:'expired',digest:null,value:null};rows.set(p.p_scope,r);}
  if(p.p_operation!=='read') {
   if(r.saveId===p.p_request){if(r.requestDigest!==p.p_request_digest)return Response.json({conflict:true});}
   else {if(r.revision!==p.p_expected)return Response.json({conflict:true});r={revision:++generation,state:p.p_operation==='save'?'saved':'deleted',digest:p.p_digest,saveId:p.p_request,savedAt:new Date(h.state.now).toISOString(),expiresAt:new Date(h.state.now+30*86400000).toISOString(),value:p.p_value,requestDigest:p.p_request_digest};rows.set(p.p_scope,r);}
   if(db.lost){db.lost=false;throw Error('Acme lost response after commit');}
  }
  const {requestDigest,...safe}=r;return Response.json(safe);
 };
 const config={...h.config,drafts:{enabled:true,verifiedAt:'2026-10-20T00:00:00.000Z'}};
 return {...h,config,fetcher,editorDb:db,editorService:createWebService(config,{fetcher,now:()=>h.state.now})};
}
