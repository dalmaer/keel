// Synthetic Acme transports; source, auth, crypto, selector and provider adapters are real.
import { connectionsHarness, token, fakeKey } from './web-connections.mjs';
import { createConnectionStore } from '../../lib/web/connection-store.mjs';
import { createModelTasks } from '../../lib/web/model-tasks.mjs';
import { createModelPolicy } from '../../lib/web/model-policy.mjs';
import { createWebService } from '../../lib/web/server.mjs';
import { hash } from '../../lib/web/common.mjs';
export {token};
export const routingPolicy=()=>({version:1,enabled:true,taskClass:'planning',adapter:'project-evidence-brief-v1',automaticFallback:false,candidates:[{id:'acme-primary',connectionId:'acme-openai',model:'acme-model-2026-10-21',unknownCapacity:'allow-budgeted'}],requirements:{minimumContext:10000,privacy:'allow-temporary-provider-retention',independentReview:false},limits:{maxInputTokens:10000,maxOutputTokens:1000,attemptMicroUsd:30000,taskMicroUsd:60000,workspaceMicroUsd:120000,projectMicroUsd:120000,connectionMicroUsd:120000,concurrency:2},capacity:{maxAgeSeconds:60,reservePercent:10,cooldownSeconds:60,reentryPercent:20}});
export const modelEvidence=()=>({model:'acme-model-2026-10-21',contextTokens:32000,maxOutputTokens:4096,inputMicroUsdPerMillion:1000000,outputMicroUsdPerMillion:2000000,evidenceUrl:'https://developers.openai.com/api/docs/models/acme-fixture',observedAt:'2026-10-20T00:00:00.000Z',expiresAt:'2026-11-21T00:00:00.000Z',immutable:true,background:true,text:true,count:true});
export const sourceInput=()=>({phase:'1',paths:['docs/phases/1-acme.md','docs/evidence/acme.md'],instructions:'Keep the owner decision to retain exact matches.',taskId:null});
export async function modelHarness(){
 const h=connectionsHarness();await h.seedPolicy();
 h.source.files['docs/phases/1-acme.md']='---\nstatus: built\nsince: 2026-10-21\n---\n# Acme phase\n\n## Done when\n\nAcme can show exact matches.\n';
 h.source.files['docs/evidence/acme.md']='# Acme evidence\n\nA synthetic source record; no live acceptance claim.\n';
 h.workspace.files['routing/workspace.json']=JSON.stringify(routingPolicy(),null,2)+'\n';
 const config={...h.config,modelRouting:{enabled:true,verifiedAt:'2026-10-20T00:00:00.000Z',restoreReconciledAt:'2026-10-20T00:00:00.000Z',models:[modelEvidence()]}};
 const descriptor=JSON.parse(h.workspace.files['connections/acme-openai.json']),policyDigest=hash(h.workspace.files['connections/acme-openai.json']);
 await createConnectionStore(config,h.fetcher).put(descriptor,{expectedVersion:0,policyDigest,requestId:'1'.repeat(64),actor:1,key:fakeKey,health:{fixture:'metadata'}});
 const db={records:new Map(),attempts:new Map(),tasks:new Map(),cooldowns:new Map(),reservations:[],calls:[],before:null,after:null,malformed:null};
 const model={calls:[],count:1000,status:'queued',text:'Acme retained the owner choice. Evidence has gaps.',usage:{input_tokens:1000,output_tokens:100,total_tokens:1100},responses:new Map(),lost:false,throttle:false,before:null};
 const reply=(body,status=200)=>Response.json(body,{status});
 const fetcher=async(url,options={})=>{
  const u=new URL(url);
  if(u.hostname==='api.openai.com'&&u.pathname.startsWith('/v1/responses')){
   const body=options.body?JSON.parse(options.body):null;model.calls.push({url,method:options.method,body});if(model.before)await model.before(u,body);
   if(model.throttle)return reply({},429);
   if(u.pathname.endsWith('/input_tokens'))return reply({object:'response.input_tokens',input_tokens:model.count});
   const create=u.pathname==='/v1/responses',id=create?`resp_acme_${model.responses.size+1}`:u.pathname.split('/')[3];
   if(create)model.responses.set(id,{model:body.model});
   const saved=model.responses.get(id);if(!saved)return reply({},404);
   if(create&&model.lost){model.lost=false;throw Error('Synthetic response lost');}
   const status=u.pathname.endsWith('/cancel')?'cancelled':model.status;
   return reply({id,object:'response',model:saved.model,status,created_at:Math.floor(h.state.now/1000),output:status==='completed'?[{type:'message',role:'assistant',content:[{type:'output_text',text:model.text}]}]:[],usage:['completed','failed','cancelled','incomplete'].includes(status)?model.usage:null});
  }
  if(u.pathname==='/rest/v1/rpc/keel_model_credential_read'){
   const p=JSON.parse(options.body),r=h.vault.rows.get(JSON.stringify([p.p_scope,p.p_connection]));
   return reply(r?.state==='present'&&r.version===p.p_expected&&r.policy===p.p_policy?{version:r.version,policy:r.policy,value:r.value}:{conflict:true});
  }
  if(u.pathname==='/rest/v1/rpc/keel_model_rpc'){
   const p=JSON.parse(options.body),d=p.p_data,key=JSON.stringify([p.p_scope,p.p_id]);db.calls.push(p);if(db.before)await db.before(p);
   if(db.malformed)return reply(db.malformed);
   let output=null,row=db.attempts.get(key);const conflict=reason=>({conflict:reason});const envelope=(changed=false,granted=false)=>({row:structuredClone(row),changed,granted});const date=()=>new Date(h.state.now).toISOString();
   const all=[...db.attempts.values()].filter(r=>r.scope===p.p_scope),active=r=>!['completed','failed','cancelled','incomplete','refused'].includes(r.state),chargeable=r=>!r.settled||r.terminal_at===null||Date.parse(r.terminal_at)>h.state.now-7*86400000;
   if(p.p_operation==='record-create'){if(!db.records.has(key)){const value={scope:p.p_scope,id:p.p_id,actor:p.p_actor,project:p.p_project,kind:d.kind,value:d.value,expires_at:new Date(h.state.now+900000).toISOString()};db.records.set(key,value);output=value;}}
   else if(p.p_operation==='record-read'){const r=db.records.get(key);if(r&&r.actor===p.p_actor&&r.project===p.p_project&&r.kind===d.kind&&Date.parse(r.expires_at)>h.state.now)output=r;}
   else if(p.p_operation==='list')output={rows:all.filter(r=>r.actor===p.p_actor&&r.project===p.p_project&&(d.after===null||(()=>{const anchor=all.find(a=>a.id===d.after&&a.actor===p.p_actor&&a.project===p.p_project);if(!anchor)throw Error('invalid cursor');return r.created_at<anchor.created_at||r.created_at===anchor.created_at&&r.id<anchor.id;})())).sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id)).slice(0,21).map(({id,task,stage,state,ceiling,charged,created_at})=>({id,task,stage,state,ceiling,charged,created_at}))};
   else if(p.p_operation==='ledger')output={attempts:all.filter(r=>chargeable(r)||r.task===d.task).map(({id,project,task,connection,stage,state,ceiling,charged,settled,terminal_at})=>({id,project,task,connection,stage,state,ceiling,charged,settled,terminal_at})),cooldowns:[...db.cooldowns.values()],reservations:db.reservations};
   else if(p.p_operation==='cooldown'){const k=JSON.stringify([p.p_scope,d.connection]),old=db.cooldowns.get(k);db.cooldowns.set(k,{scope:p.p_scope,connection:d.connection,blocked_until:new Date(Math.max(Date.parse(old?.blocked_until)||0,h.state.now+d.seconds*1000)).toISOString(),observed_at:new Date(h.state.now).toISOString()});output={recorded:true};}
   else if(row&&(row.actor!==p.p_actor||row.project!==p.p_project))output=conflict('identity');
   else if(p.p_operation==='read')output=row?envelope():null;
   else if(p.p_operation==='reserve'){
    if(row)output=row.digest!==d.digest||row.quote!==d.quote||row.task!==d.task?conflict('identity'):envelope();
    else if(all.some(r=>r.task===d.task&&r.stage===d.stage))output=conflict('stage');
    else if(all.some(r=>r.project===p.p_project&&active(r))||all.filter(active).length>=d.concurrency)output=conflict('concurrency');
    else if(all.some(r=>r.connection===d.connection&&['sending','uncertain'].includes(r.state)))output=conflict('unresolved-connection');
    else if([...db.cooldowns.values()].some(c=>c.connection===d.connection&&Date.parse(c.blocked_until)>h.state.now))output=conflict('cooldown');
    else {
     const sum=predicate=>all.filter(predicate).reduce((n,r)=>n+r.charged,0),taskKey=JSON.stringify([p.p_scope,d.task]),task=db.tasks.get(taskKey);
     if(task&&(task.actor!==p.p_actor||task.project!==p.p_project||task.allowance!==d.taskLimit))output=conflict('task');
     else if(d.stage===2&&!all.some(r=>r.task===d.task&&r.stage===1&&r.state==='completed'&&r.result))output=conflict('checkpoint');
     else if(sum(chargeable)+d.ceiling>d.workspaceLimit||sum(r=>chargeable(r)&&r.project===p.p_project)+d.ceiling>d.projectLimit||sum(r=>chargeable(r)&&r.connection===d.connection)+d.ceiling>d.connectionLimit||sum(r=>r.task===d.task)+d.ceiling>d.taskLimit)output=conflict('budget');
     else {row={scope:p.p_scope,id:p.p_id,actor:p.p_actor,project:p.p_project,task:d.task,stage:d.stage,connection:d.connection,digest:d.digest,quote:d.quote,fence:d.fence,credential:d.credential,value:d.value,result:null,version:1,state:'reserved',response_id:null,settled:false,ceiling:d.ceiling,charged:d.ceiling,cancel_sent:false,created_at:date(),terminal_at:null};db.attempts.set(key,row);db.tasks.set(taskKey,{actor:p.p_actor,project:p.p_project,allowance:d.taskLimit});output=envelope(true);}
    }
   }else if(row){
    if(row.fence!==d.fence||row.version!==d.version)output=conflict('version');
    else if(p.p_operation==='begin'&&row.state==='reserved'){const c=row.credential,v=h.vault.rows.get(JSON.stringify([c.scope,c.connection]));if(!v||v.state!=='present'||v.version!==c.version||v.policy!==c.policy)return reply(conflict('credential'));row.state='sending';row.version++;output=envelope(true,true);}
    else if(p.p_operation==='refuse'&&row.state==='reserved'){row.state='refused';row.charged=0;row.settled=true;row.terminal_at=date();row.version++;output=envelope(true);}
    else if(p.p_operation==='cancel'&&row.response_id&&active(row)&&!row.cancel_sent){row.cancel_sent=true;row.version++;output=envelope(true,true);}
    else if(p.p_operation==='update'&&active(row)&&row.state!=='reserved'){
     if(row.response_id&&row.response_id!==d.responseId)output=conflict('response');else{Object.assign(row,{state:d.state,response_id:d.responseId,result:d.result,version:row.version+1});if(!active(row)){row.terminal_at=date();if(d.actual!==null){row.charged=d.actual;row.settled=true;}}output=envelope(true);}
    }else output=envelope();
   }
   if(db.after)await db.after(p,output);return reply(output);
  }
  return h.fetcher(url,options);
 };
 const opts={fetcher,now:()=>h.state.now};
 return {...h,config,fetcher,model,modelDb:db,models:createModelTasks(config,opts),modelPolicy:createModelPolicy(config,opts),service:createWebService(config,opts),reauthorize:async()=>h.refreshAccess()};
}
