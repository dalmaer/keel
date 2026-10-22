import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
// Actual durable SQL snapshot semantics, with opaque synthetic ciphertext.
// No provider call, encryption claim or hosted/multiconnection proof.
if(!process.env.KEEL_SQL_PROOF_MODULE)throw Error('Set KEEL_SQL_PROOF_MODULE to an absolute PGlite module path.');
const {PGlite}=await import(process.env.KEEL_SQL_PROOF_MODULE);
const databases=[],id=n=>n.toString(16).padStart(64,'0'),scope=id(1),cipher='Acme opaque ciphertext placeholder';
const files=['001-auth.sql','008-connections.sql','009-jobs.sql','010-fleet-updates.sql','011-model-routing.sql','013-night-retries.sql'];
const tables=['connection_credentials','job_previews','jobs','fleet_records','model_records','model_tasks','model_attempts','model_reservations','model_cooldowns','night_previews','night_retries'];
async function freshDatabase(){const db=new PGlite();databases.push(db);await db.exec('create role anon;create role authenticated;create role service_role;');for(const f of files)await db.exec(await readFile(new URL('../../lib/web/migrations/'+f,import.meta.url),'utf8'));return db;}
function api(db){
 const query=async(sql,args)=>(await db.query(sql,args)).rows[0].r;
 return {
  job:(op,n,data={})=>query('select public.keel_job_rpc($1,$2,$3,$4) r',[op,scope,id(n),data]),
  night:(op,n,data={})=>query('select public.keel_night_retry_rpc($1,$2,$3,$4) r',[op,scope,id(n),data]),
  fleet:(op,n,data={})=>query('select public.keel_fleet_rpc($1,$2,$3,$4,$5) r',[op,scope,id(n),1,data]),
  model:(op,n,data={},project=5)=>query('select public.keel_model_rpc($1,$2,$3,$4,$5,$6) r',[op,scope,id(n),1,id(project),data]),
  vault:()=>query('select public.keel_connection_rpc($1,$2,$3,$4,$5,$6,$7,$8,$9) r',['put',scope,id(60),0,id(61),id(62),1,cipher,{}]),
 };
}
async function snapshot(db){await db.exec('reset role');const out={};for(const table of tables)out[table]=(await db.query('select * from keel_private.'+table+' order by 1,2')).rows;return JSON.parse(JSON.stringify(out));}
const who=project=>({project:id(project),actor:1}),preview=project=>({...who(project),digest:id(6),value:cipher});
const jobReservation=(project,p)=>({...preview(project),preview:id(p),minutes:15,workspaceLimit:90,projectLimit:90});
const modelSpec=(task,q)=>({task:id(task),stage:1,connection:id(60),digest:id(6),quote:id(q),fence:id(63),value:cipher,ceiling:100,taskLimit:200,workspaceLimit:500,projectLimit:500,connectionLimit:500,concurrency:5,windows:[{pool:id(64),amount:2,available:3,expiresAt:new Date(Date.now()+600000).toISOString()}],credential:{scope,connection:id(60),policy:id(61),version:1}});
try{
 const original=await freshDatabase(),a=api(original);await original.exec('set role service_role');
 await a.job('preview-create',10,preview(3));assert.equal((await a.job('reserve',11,jobReservation(3,10))).changed,true);
 assert.equal((await a.job('dispatch',11)).granted,true);await a.job('uncertain',11);
 await a.night('preview-create',20,preview(4));await a.night('reserve',21,{...preview(4),preview:id(20),runId:7001,attempt:2,workspaceLimit:90,projectLimit:90});
 assert.equal((await a.night('send',21,who(4))).granted,true);await a.night('uncertain',21,who(4));
 let publication=await a.fleet('create',30,{kind:'publication',project:id(3),digest:id(6),value:cipher});
 publication=await a.fleet('cas',30,{version:publication.row.version,state:'dispatched',stage:0,value:cipher});
 publication=await a.fleet('cas',30,{version:publication.row.version,state:'uncertain',stage:0,value:cipher});
 await a.vault();await a.model('record-create',40,{kind:'quote',value:cipher});
 let attempt=await a.model('reserve',41,modelSpec(42,40));assert.equal(attempt.changed,true);
 attempt=await a.model('begin',41,{fence:attempt.row.fence,version:attempt.row.version});assert.equal(attempt.granted,true);
 attempt=await a.model('update',41,{fence:attempt.row.fence,version:attempt.row.version,state:'uncertain',responseId:null,result:null,actual:null});
 assert.equal(attempt.row.charged,100);assert.equal(attempt.row.settled,false);
 const backup=await snapshot(original),restored=await freshDatabase();
 for(const table of tables)for(const row of backup[table]){
  const keys=Object.keys(row);assert.ok(keys.every(k=>/^[a-z_]+$/.test(k)));
  await restored.query(`insert into keel_private.${table}(${keys.join(',')}) values (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));
 }
 assert.deepEqual(await snapshot(restored),backup,'snapshot preserves every copied durable field');
 const r=api(restored);
 for(const role of ['anon','authenticated']){await restored.exec('set role '+role);await assert.rejects(r.job('read',11));await assert.rejects(r.model('read',41));await assert.rejects(r.fleet('read',30));await assert.rejects(restored.query('select * from keel_private.night_retries'));await restored.exec('reset role');}
 // Advance source ages only in the disposable restore; unresolved work cannot
 // become free money/minutes merely because seven days or a lease elapsed.
 for(const table of ['jobs','night_retries','model_attempts'])await restored.exec(`update keel_private.${table} set created_at=clock_timestamp()-interval '8 days'`);
 await restored.exec("update keel_private.jobs set lease_until=clock_timestamp()-interval '1 day'");
 await restored.exec('set role service_role');
 assert.deepEqual(await r.job('budget',0,{project:id(3)}),{workspaceMinutes:75,projectMinutes:15});
 const job=await r.job('read',11);assert.equal(job.row.state,'uncertain');assert.equal(job.row.charged,true);assert.equal((await r.job('dispatch',11)).conflict,'state');
 const night=await r.night('read',21,who(4));assert.equal(night.row.state,'uncertain');assert.equal(night.row.charged,true);assert.equal((await r.night('send',21,who(4))).conflict,'state');
 await r.job('preview-create',12,preview(4));assert.equal((await r.job('reserve',13,jobReservation(4,12))).conflict,'lane');
 await r.job('preview-create',14,preview(7));assert.equal((await r.job('reserve',15,{...jobReservation(7,14),minutes:30})).conflict,'budget');
 const fleetBefore=await r.fleet('read',30);assert.equal(fleetBefore.row.state,'uncertain');assert.equal(fleetBefore.row.stage,0);
 assert.equal((await r.fleet('cas',30,{version:1,state:'dispatched',stage:0,value:cipher})).conflict,'state');
 assert.deepEqual(await r.fleet('read',30),fleetBefore,'stale send cannot advance publication');
 const model=await r.model('read',41);assert.equal(model.row.state,'uncertain');assert.equal(model.row.charged,100);assert.equal(model.row.response_id,null);
 assert.equal((await r.model('begin',41,{fence:model.row.fence,version:model.row.version})).granted,false);
 const ledger=await r.model('ledger',0,{task:id(42),connection:id(60)});assert.equal(ledger.attempts[0].charged,100);assert.equal(ledger.reservations[0].amount,2);
 await r.model('record-create',43,{kind:'quote',value:cipher},8);assert.equal((await r.model('reserve',44,modelSpec(45,43),8)).conflict,'unresolved-connection');
 assert.equal(await r.model('read',44,{},8),null);
 assert.deepEqual(await snapshot(original),backup,'source backup was not modified by restore inspection');
 console.log('PASS SQL008–011/013 logical restore: opaque payloads and original rows preserved; role denial; uncertain worker/night shared 75-minute charge and lanes retained after age/lease advance; no repeat send grant; uncertain publication stage and CAS preserved; model no-ID uncertainty retains ceiling/pool and blocks another send. Single connection per database; no provider, encryption, hosted backup completeness or owner acceptance claim.');
}finally{for(const db of databases)await db.close();}
