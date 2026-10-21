// Synthetic RPC protocol; actual SQL roles, locking and durability are verified separately.
export function decisionDatabase(now) {
 const previews=new Map(),operations=new Map();
 const json=value=>Response.json(value);
 const out=(row,created=false)=>row?{id:row.id,state:row.state,value:row.value,created,leaseUntil:new Date(row.leaseUntil).toISOString()}:null;
 return {previews,operations,handle(url,options){
  if(!new URL(url).pathname.endsWith('/rpc/keel_decision_rpc'))return null;
  const p=JSON.parse(options.body);let row=operations.get(p.p_id);
  if(p.p_operation==='preview-create'){if(previews.has(p.p_id))return json(null);previews.set(p.p_id,{scope:p.p_scope,value:p.p_value,expires:now()+900000});return json({value:p.p_value});}
  if(p.p_operation==='preview-read'){const r=previews.get(p.p_id);return json(r&&r.scope===p.p_scope&&r.expires>now()?{value:r.value}:null);}
  if(p.p_operation==='reserve'){
   const prior=[...operations.values()].find(r=>r.preview===p.p_preview&&r.scope===p.p_scope);if(prior)return json(out(prior));
   const preview=previews.get(p.p_preview);if(!preview||preview.scope!==p.p_scope||preview.expires<=now())return json(null);
   for(const r of operations.values())if(r.project===p.p_project&&r.state==='prepared'&&r.leaseUntil<=now())r.state='refused';
   if([...operations.values()].some(r=>r.project===p.p_project&&['prepared','dispatched','uncertain'].includes(r.state)))return json({conflict:true});
   row={id:p.p_id,scope:p.p_scope,project:p.p_project,preview:p.p_preview,fence:p.p_fence,state:'prepared',value:p.p_value,leaseUntil:now()+60000};operations.set(row.id,row);return json(out(row,true));
  }
  if(!row||row.scope!==p.p_scope)return json(null);
  if(p.p_operation==='read')return json(out(row));
  if(row.fence!==p.p_fence)return json(null);
  if(p.p_operation==='dispatched'){if(row.state!=='prepared'||row.leaseUntil<=now())return json(null);row.state='dispatched';return json(out(row));}
  if(['committed','refused','uncertain'].includes(p.p_operation)&&(['dispatched','uncertain'].includes(row.state)||row.state==='prepared'&&p.p_operation==='refused')){row.state=p.p_operation;row.value=p.p_value;return json(out(row));}
  return json(null);
 }};
}
