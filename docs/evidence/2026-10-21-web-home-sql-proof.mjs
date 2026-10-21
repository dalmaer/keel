// Optional SQL verification tooling; no application dependency. Synthetic Acme rows.
// Usage: node <this-file> /absolute/tooling/node_modules/@electric-sql/pglite/dist/index.js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.argv[2]);
const db = new PGlite();
try {
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for (const file of ['001-auth.sql', '002-home-cache.sql', '003-home-retry.sql']) await db.exec(await readFile(new URL(`../../lib/web/migrations/${file}`, import.meta.url), 'utf8'));
  const key = n => n.repeat(64);
  const cache = async (operation, k = key('a'), value = null, lease = null, error = null) =>
    (await db.query('select public.keel_home_cache_rpc($1,$2,$3,$4,$5) as result', [operation,k,value,lease,error])).rows[0].result;
  const quota = async (operation, remaining = null, reset = null, k = key('b')) =>
    (await db.query('select public.keel_home_quota_rpc($1,$2,$3,$4) as result', [operation,k,remaining,reset])).rows[0].result;
  const cursor = async (value, since = null, k = key('f')) => (await db.query('select public.keel_home_cursor_rpc($1,$2,$3) as result',[k,value,since])).rows[0].result;
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(() => cache('read'), e => e.code === '42501');
    await assert.rejects(() => quota('read'), e => e.code === '42501');
    await assert.rejects(() => cursor(key('a')), e => e.code === '42501');
    await assert.rejects(() => db.query('select * from keel_private.home_cursors'), e => e.code === '42501');
    await assert.rejects(() => db.query('select * from keel_private.home_cache'), e => e.code === '42501');
    await assert.rejects(() => db.query('select * from keel_private.home_quota'), e => e.code === '42501');
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  for (const table of ['home_cache','home_quota','home_cursors']) await assert.rejects(() => db.query(`select * from keel_private.${table}`), e => e.code === '42501');
  assert.equal((await cache('claim',key('a'),null,key('c'))).leaseAcquired,true);
  assert.equal((await cache('claim',key('a'),null,key('d'))).leaseAcquired,false);
  assert.equal(await cache('finish',key('a'),'fake-acme-wrong-lease',key('d')),null);
  assert.equal((await cache('finish',key('a'),'fake-acme-v1',key('c'))).version,1);
  assert.equal((await cache('read')).value,'fake-acme-v1');
  assert.equal((await cache('claim',key('a'),null,key('d'))).leaseAcquired,false);
  await db.exec('reset role');
  await db.query("update keel_private.home_cache set next_attempt=clock_timestamp()-interval '1 second' where key=$1",[key('a')]);
  await db.exec('set role service_role');
  assert.equal((await cache('claim',key('a'),null,key('d'))).leaseAcquired,true);
  assert.equal((await cache('fail',key('a'),null,key('d'),'source_unavailable')).value,'fake-acme-v1');
  assert.equal((await cache('read')).lastError,'source_unavailable');
  assert.equal(await cache('finish',key('a'),'fake-acme-late',key('c')),null);
  assert.equal((await cursor(key('a'))).state,'initial');
  assert.equal((await cursor(key('a'),key('a'))).state,'current');
  assert.equal((await cursor(key('b'),key('a'))).state,'changed');
  assert.equal((await cursor(key('b'),key('c'))).state,'gap');
  for (const char of ['1','2','3','4','5','6','7','8']) await cursor(key(char));
  assert.equal((await cursor(key('8'),key('a'))).state,'gap');
  assert.equal((await cursor(key('8'),key('7'))).state,'changed');
  const reset = Math.floor(Date.now()/1000)+3600;
  assert.equal((await quota('observe',1001,reset)).remaining,1001);
  assert.equal((await quota('reserve')).allowed,true);
  assert.equal((await quota('reserve')).allowed,false);
  assert.equal((await quota('observe',9000,reset)).remaining,1000);
  assert.equal((await quota('observe',5000,reset+3600)).remaining,5000);
  const until = Math.floor(Date.now()/1000)+180;
  assert.equal((await quota('defer',null,until)).remaining,5000);
  assert.equal((await quota('reserve')).allowed,false);
  await quota('observe',5000,reset+3600);
  assert.equal((await quota('reserve')).allowed,false);
  assert.equal(Date.parse((await quota('defer',null,until-60)).blockedUntil),until*1000);
  await assert.rejects(() => quota('defer',null,until+8*86400),/invalid retry bound/);
  await db.exec('reset role');
  await db.query("update keel_private.home_quota set blocked_until=clock_timestamp()-interval '1 second' where key=$1",[key('b')]);
  await db.exec('set role service_role');
  assert.equal((await quota('reserve')).allowed,true);
  assert.equal((await quota('read')).remaining,4999);
  for (let i=0;i<20;i++) assert.equal((await quota('reserve',null,null,key('e'))).allowed,true);
  const unknown=await quota('reserve',null,null,key('e')); assert.equal(unknown.allowed,false); assert.equal(unknown.remaining,null);
  await assert.rejects(() => cache('claim','unsafe',null,key('c')), /invalid cache input/);
  await assert.rejects(() => cache('finish',key('a'),'x'.repeat(524289),key('c')), /invalid cache input/);
  await db.exec('reset role');
  const rows=(await db.query("select relname,relrowsecurity from pg_class where oid in ('keel_private.home_cache'::regclass,'keel_private.home_quota'::regclass,'keel_private.home_cursors'::regclass)")).rows;
  assert.equal(rows.length,3); assert(rows.every(r=>r.relrowsecurity));
  await db.query("update keel_private.home_cache set expires_at=clock_timestamp()-interval '1 second' where key=$1",[key('a')]);
  await db.exec('set role service_role'); assert.equal(await cache('read'),null);
  console.log('PASS: migration, actual role denial, RLS, lease fencing/cooldown, stale retention, expiry, bounded cursor history/gaps, quota floor/monotonic observation, bounded unknown probes, persistent monotonic retry pause/resume and payload bounds. Single connection only; no hosted/concurrency claim.');
} finally { await db.close(); }
