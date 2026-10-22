import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
// Disposable actual-SQL matrix. PGlite is separately installed, never a runtime dependency.
// One connection exercises SQL semantics, not independent-connection concurrency.
import {fileURLToPath} from 'node:url';
if (!process.env.KEEL_SQL_PROOF_MODULE) throw Error('Set KEEL_SQL_PROOF_MODULE to an absolute PGlite module path.');
const {PGlite}=await import(process.env.KEEL_SQL_PROOF_MODULE);
const root=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,''),db=new PGlite(),id=n=>n.toString(16).padStart(64,'0');
const sql=await readFile(`${root}/lib/web/migrations/013-night-retries.sql`,'utf8');
await db.exec('create role anon;create role authenticated;create role service_role;create schema keel_private;');
for(const f of ['009-jobs.sql','010-fleet-updates.sql'])await db.exec(await readFile(`${root}/lib/web/migrations/${f}`,'utf8'));
await db.exec(sql);
await db.exec(sql); // Repeat before any receipts exist.
const rpc=async(domain,op,n,data={},scope=1)=>(await db.query(`select public.keel_${domain}_rpc($1,$2,$3,$4) as r`,[op,id(scope),id(n),data])).rows[0].r;
const who=(project=3,actor=1)=>({project:id(project),actor});
const preview=(n,project=3)=>rpc('night_retry','preview-create',n,{...who(project),digest:id(4),value:'encrypted-preview'});
const reserve=(n,p,project=3,workspaceLimit=120,projectLimit=120)=>rpc('night_retry','reserve',n,{...who(project),digest:id(4),preview:id(p),value:'encrypted-intent',runId:7001,attempt:2,workspaceLimit,projectLimit});
const transition=(op,n,extra={},project=3)=>rpc('night_retry',op,n,{...who(project),...extra});
const jobPreview=(n,project=3)=>rpc('job','preview-create',n,{...who(project),digest:id(4),value:'job-preview'});
const jobReserve=(n,p,project=3,workspaceLimit=120,projectLimit=120)=>rpc('job','reserve',n,{...who(project),digest:id(4),preview:id(p),value:'job-intent',minutes:15,workspaceLimit,projectLimit});
const observation={runId:7001,attempt:3,state:'completed',conclusion:'failure',url:'https://github.com/acme/studio/actions/runs/7001',observedAt:new Date().toISOString(),attribution:'unverified'};
for(const role of ['anon','authenticated']){
 await db.exec(`set role ${role}`);await assert.rejects(transition('read',5));await assert.rejects(rpc('job','read',5));await assert.rejects(db.query('select * from keel_private.night_retries'));await db.exec('reset role');
}
await db.exec('set role service_role');
await assert.rejects(db.query('select * from keel_private.night_retries'));
await assert.rejects(db.query("select keel_private.job_rpc_before_night('read',$1,$2,'{}')",[id(1),id(5)]));
await preview(2);assert.equal((await reserve(5,2)).changed,true);
assert.equal((await reserve(5,2)).changed,false);
assert.equal(await rpc('night_retry','read',5,who(3,2)),null);
assert.equal(await rpc('night_retry','read',5,who(9)),null);
await jobPreview(6);assert.equal((await jobReserve(7,6)).conflict,'lane');
await preview(8);assert.equal((await reserve(9,8)).conflict,'lane');
assert.deepEqual(await rpc('job','budget',0,{project:id(3)}),{workspaceMinutes:60,projectMinutes:60});
// Reapplying the extension preserves a live reservation and the original delegate.
await db.exec('reset role');
const delegateBefore=(await db.query("select pg_get_functiondef('keel_private.job_rpc_before_night(text,text,text,jsonb)'::regprocedure) as body")).rows[0].body;
await db.exec(sql);
assert.equal((await db.query("select pg_get_functiondef('keel_private.job_rpc_before_night(text,text,text,jsonb)'::regprocedure) as body")).rows[0].body,delegateBefore);
for(const old of ['009-jobs.sql','010-fleet-updates.sql']){
 await assert.rejects(db.exec(await readFile(`${root}/lib/web/migrations/${old}`,'utf8')),/migration013|night migration|night retr/i);
 await db.exec('rollback');
}
await db.exec('set role service_role');
assert.deepEqual(await rpc('job','budget',0,{project:id(3)}),{workspaceMinutes:60,projectMinutes:60});
assert.equal((await jobReserve(7,6)).conflict,'lane');
assert.equal((await transition('read',5)).row.state,'prepared');

assert.equal((await transition('send',5)).granted,true);assert.equal((await transition('send',5)).conflict,'state');
await transition('accepted',5);
for(const bad of [null,{}, {...observation,runId:null},{...observation,attempt:null},{...observation,state:null},{...observation,conclusion:null},{...observation,attribution:'verified'},{...observation,attempt:2},{...observation,extra:true}])await assert.rejects(transition('observe',5,{observation:bad}));
assert.equal((await transition('observe',5,{observation})).row.state,'settled');
assert.equal((await jobReserve(7,6)).row.state,'prepared');
await preview(21);assert.equal((await reserve(22,21)).conflict,'lane');
assert.equal((await jobReserve(7,6,3,1,1)).changed,false); // idempotent at exhausted/changed allowance
assert.deepEqual(await rpc('job','budget',0,{project:id(3)}),{workspaceMinutes:75,projectMinutes:75});
await preview(10,11);assert.equal((await reserve(12,10,11,120,120)).conflict,'budget');
await rpc('job','refuse',7);
assert.equal((await reserve(12,10,11)).row.state,'prepared');
assert.equal((await transition('send',12,{},11)).granted,true);await transition('uncertain',12,{},11);
assert.equal((await transition('observe',12,{observation},11)).row.state,'uncertain');
await db.exec('reset role');
await db.query("update keel_private.night_retries set settled_at=clock_timestamp()-interval '8 days' where id=$1",[id(5)]);
await db.exec('set role service_role');
assert.deepEqual(await rpc('job','budget',0,{project:id(3)}),{workspaceMinutes:60,projectMinutes:0});
await preview(13);assert.equal((await reserve(14,13)).row.state,'prepared');
await db.exec('reset role');await db.query("update keel_private.night_previews set expires_at=clock_timestamp()-interval '1 second' where id=$1",[id(13)]);await db.exec('set role service_role');
assert.equal((await transition('send',14)).conflict,'state');
const expired=await transition('read',14);assert.equal(expired.row.state,'refused');assert.equal(expired.row.charged,false);
assert.equal((await transition('read',12,{},11)).row.state,'uncertain');
for(const key of ['project','actor','digest','value']){const d={...who(),digest:id(4),value:'x',[key]:null};await assert.rejects(rpc('night_retry','preview-create',20,d));}
await assert.rejects(rpc('night_retry','read',5,null));
await assert.rejects(rpc('night_retry','read',5,{...who(),extra:true}));
await db.exec('reset role');
const privilege=(await db.query("select has_function_privilege('service_role','keel_private.job_rpc_before_night(text,text,text,jsonb)','EXECUTE') as allowed")).rows[0];assert.equal(privilege.allowed,false);
console.log('PASS: actual SQL roles/RLS, shared lanes and budget both directions, duplicate identity, single send grant, null/shape rejection, accepted-only settlement, retained uncertain charge, prepared expiry fence. Single connection only.');
console.log('PASS: repeat013 preserves its delegate and receipts; old009/010 replay refuses without losing charge or lane.');
console.log('013 SHA256',createHash('sha256').update(sql).digest('hex'));
await db.close();
