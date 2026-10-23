import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
// Disposable actual-SQL proof; GitHub transport is synthetic and connection concurrency is not established.
import {fileURLToPath} from 'node:url';
if (!process.env.KEEL_SQL_PROOF_MODULE) throw Error('Set KEEL_SQL_PROOF_MODULE to an absolute PGlite module path.');
const {PGlite}=await import(process.env.KEEL_SQL_PROOF_MODULE);
import {nightPlanHarness,previewPlan,token} from '../../tests/helpers/web-night-plan.mjs';
import {createNightPlan} from '../../lib/web/night-plan.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,''),db=new PGlite();
try {
 await db.exec('create role anon; create role authenticated; create role service_role;');
 for(const f of ['001-auth.sql','004-decision-operations.sql'])await db.exec(await readFile(root+'/lib/web/migrations/'+f,'utf8'));
 await db.exec('set role service_role');
 const h=nightPlanHarness(),fetcher=async(url,o={})=>{
  if(new URL(url).pathname==='/rest/v1/rpc/keel_decision_rpc'){
   const p=JSON.parse(o.body),keys=Object.keys(p);assert.ok(keys.every(k=>/^p_[a-z_]+$/.test(k)));
   const r=await db.query(`select public.keel_decision_rpc(${keys.map((k,i)=>k+' => $'+(i+1)).join(',')}) r`,Object.values(p));
   return Response.json(r.rows[0].r);
  }return h.fetcher(url,o);
 };
 h.nightPlan=createNightPlan(h.config,{fetcher,now:()=>h.state.now});
 const p=await previewPlan(h);h.planState.mode='lost';
 const apply=()=>h.nightPlan.apply(h.access,token,h.project,p.id,{reauthorize:async()=>h.access,publicAcknowledgement:p.digest});
 const pair=await Promise.all([apply(),apply()]);assert.ok(pair.some(r=>r.state==='uncertain'));assert.equal(h.planState.writes.length,1);
 const recovered=await h.nightPlan.recover(h.access,token,h.project,p.operationId);assert.equal(recovered.state,'committed');assert.equal(recovered.receipt.execution,'not-started');
 assert.equal((await apply()).state,'committed');assert.equal(h.planState.writes.length,1);
 await db.exec('reset role');const rows=(await db.query('select value from keel_private.decision_operations')).rows;assert.equal(rows.length,1);assert.doesNotMatch(rows[0].value,/Acme follow-up|keel-night-plan/);
 console.log('PASS actual SQL004 + night-plan service: one conditional provider request, encrypted typed intent, lost-response recovery and duplicate refusal (single PostgreSQL connection; external GitHub transport synthetic).');
} finally {await db.close();}
