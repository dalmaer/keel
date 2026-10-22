import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
// Run with KEEL_SQL_PROOF_MODULE pointing to an externally installed PGlite module.
// This disposable local proof does not activate hosted storage or prove multi-connection races.
import {fileURLToPath} from 'node:url';
if (!process.env.KEEL_SQL_PROOF_MODULE) throw Error('Set KEEL_SQL_PROOF_MODULE to an absolute PGlite module path.');
const {PGlite}=await import(process.env.KEEL_SQL_PROOF_MODULE);
const root=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,''),db=new PGlite(),id=n=>n.toString(16).padStart(64,'0');
const sql=await readFile(root+'/lib/web/migrations/012-editor-drafts.sql','utf8');
const rpc=async(op,scope,expected=null,request=null,requestDigest=null,digest=null,value=null)=>(await db.query('select public.keel_editor_draft_rpc($1,$2,$3,$4,$5,$6,$7) r',[op,id(scope),expected,request===null?null:id(request),requestDigest===null?null:id(requestDigest),digest===null?null:id(digest),value])).rows[0].r;
const save=(scope,revision,n,text='Acme encrypted draft placeholder')=>rpc('save',scope,revision,n,n+1000,n+2000,text);
try{
 await db.exec('create role anon;create role authenticated;create role service_role;');
 await db.exec(await readFile(root+'/lib/web/migrations/001-auth.sql','utf8'));await db.exec(sql);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(rpc('read',1));await assert.rejects(db.query('select * from keel_private.editor_drafts'));await db.exec('reset role');}
 await db.exec('set role service_role');await assert.rejects(db.query('select * from keel_private.editor_drafts'));await assert.rejects(db.query("select nextval('keel_private.editor_draft_generation')"));
 await assert.rejects(rpc(null,1));await assert.rejects(rpc('read',1,1));await assert.rejects(rpc('save',1,0,1,2,3,'x'));await assert.rejects(rpc('save',1,1,1,2,3,'x'.repeat(200001)));
 const initial=await rpc('read',1);assert.equal(initial.state,'empty');assert.ok(Number.isSafeInteger(initial.revision)&&initial.revision>0);assert.deepEqual(await rpc('read',1),initial);
 const first=await save(1,initial.revision,10);assert.equal(first.state,'saved');assert.ok(first.revision>initial.revision);assert.equal(first.value,'Acme encrypted draft placeholder');
 assert.deepEqual(await save(1,initial.revision,10),first);assert.deepEqual(await save(1,initial.revision,11),{conflict:true});assert.deepEqual(await rpc('save',1,initial.revision,10,99,2010,'Changed Acme body'),{conflict:true});
 assert.deepEqual(await save(99,first.revision,12),{conflict:true});
 const contenders=await Promise.all([save(1,first.revision,13),save(1,first.revision,14)]);assert.equal(contenders.filter(v=>v.state==='saved').length,1);assert.equal(contenders.filter(v=>v.conflict).length,1);
 const winner=await rpc('read',1);assert.deepEqual(await rpc('delete',1,first.revision,15,1015),{conflict:true});
 const deleted=await rpc('delete',1,winner.revision,16,1016);assert.equal(deleted.state,'deleted');assert.equal(deleted.value,null);assert.ok(deleted.revision>winner.revision);
 const second=await rpc('read',2),saved2=await save(2,second.revision,20);
 await db.exec('reset role');await db.query("update keel_private.editor_drafts set expires_at=clock_timestamp()-interval '1 day' where scope=$1",[id(2)]);await db.exec('set role service_role');
 await rpc('read',3);const expired=await rpc('read',2);assert.equal(expired.state,'expired');assert.equal(expired.value,null);assert.ok(expired.revision>saved2.revision);assert.deepEqual(await save(2,saved2.revision,21),{conflict:true});
 // Expired/deleted scopes reclaimed in a different read must never reuse generations.
 await db.exec('reset role');await db.query("update keel_private.editor_drafts set expires_at=clock_timestamp()-interval '90 days' where scope in($1,$2)",[id(1),id(2)]);await db.exec('set role service_role');await rpc('read',4);
 const regenerated=await rpc('read',1);assert.equal(regenerated.state,'empty');assert.ok(regenerated.revision>deleted.revision);assert.deepEqual(await save(1,deleted.revision,22),{conflict:true});
 // Capacity at1000 rows and reclamation of never-revisited saved drafts.
 await db.exec('reset role');await db.exec('delete from keel_private.editor_drafts');
 await db.query("insert into keel_private.editor_drafts(scope,revision,state,digest,request,request_digest,value,saved_at,expires_at) select lpad(to_hex(g),64,'0'),nextval('keel_private.editor_draft_generation'),'saved',repeat('a',64),repeat('b',64),repeat('c',64),'Acme encrypted abandoned draft',clock_timestamp()-interval '120 days',clock_timestamp()-interval '90 days' from generate_series(10000,10999)g");
 await db.exec('set role service_role');const reclaimed=await rpc('read',20000);assert.equal(reclaimed.state,'empty');
 await db.exec('reset role');await db.exec('delete from keel_private.editor_drafts');
 await db.query("insert into keel_private.editor_drafts(scope,revision,state,saved_at,expires_at) select lpad(to_hex(g),64,'0'),nextval('keel_private.editor_draft_generation'),'empty',clock_timestamp(),clock_timestamp()+interval '30 days' from generate_series(10000,10999)g");
 await db.exec('set role service_role');assert.deepEqual(await rpc('read',20001),{capacity:true});
 // Encrypted payload capacity is atomic and a refusal leaves previous revision intact.
 await db.exec('reset role');await db.exec('delete from keel_private.editor_drafts');
 await db.query("insert into keel_private.editor_drafts(scope,revision,state,digest,value,saved_at,expires_at) select lpad(to_hex(g),64,'0'),nextval('keel_private.editor_draft_generation'),'saved',repeat('a',64),repeat('x',200000),clock_timestamp(),clock_timestamp()+interval '30 days' from generate_series(10000,10261)g");
 await db.exec('set role service_role');const bounded=await rpc('read',20002);assert.deepEqual(await save(20002,bounded.revision,30,'x'.repeat(100000)),{capacity:true});assert.equal((await rpc('read',20002)).revision,bounded.revision);
 await db.exec('reset role');const rls=await db.query("select relrowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='keel_private' and relname='editor_drafts'");assert.equal(rls.rows[0].relrowsecurity,true);
 console.log('PASS independent SQL012 roles/RLS, bounded inputs, never-reused generations, one CAS winner (single connection), repeated/lost identity, expired/deleted readback, stale resurrection refusal, abandoned expiry reclamation, row/payload capacity; SHA256 '+createHash('sha256').update(sql).digest('hex'));
}finally{await db.close();}
