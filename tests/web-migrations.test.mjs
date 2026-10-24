import { nameCandidate } from './helpers/web-name-candidate.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { NAMES, writeName } from '../lib/names.mjs';
const directory = new URL('../lib/web/migrations/', import.meta.url);
const rows = NAMES.filter(r => r.surface === 'database' && !r.keel.includes('.') && (r.keel.endsWith('_rpc') || ['keel_run_history', 'keel_model_credential_read'].includes(r.keel)));

test('renamed functions with forwarders', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  const files = (await readdir(directory)).filter(f => f.endsWith('.sql')).sort();
  for (const file of files.filter(f => !f.startsWith('014-'))) await db.exec(await readFile(new URL(file, directory), 'utf8'));
  const before = new Map();
  for (const row of rows) before.set(row.id, (await db.query(`SELECT prosrc, proargnames, proargtypes::text, proacl::text, proconfig, prosecdef, pg_get_function_arguments(oid) args FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=$1`, [row.keel])).rows[0]);
  const key = 'a'.repeat(64);
  for (const row of rows) {
    assert.equal(writeName(row.id), row.keel, `activation barrier: ${row.id}`);
    assert.equal((await db.query("SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=$1", [row.plates])).rows[0].n, 0);
  }
  const { createStore } = await import('../lib/web/store.mjs');
  const urls = [];
  let expectedName = 'keel_web_rpc';
  const adapter = async (url, options) => {
    urls.push(url);
    const name = new URL(url).pathname.split('/').at(-1);
    assert.equal(name, expectedName);
    const p = JSON.parse(options.body), entries = Object.entries(p);
    const result = await db.query(`SELECT public.${name}(${entries.map(([key], i) => `${key} => $${i+1}`).join(',')}) value`, entries.map(([, value]) => value));
    return Response.json(result.rows[0].value);
  };
  const store = createStore({ storageUrl: 'https://acme.supabase.co', storageKey: 'fake-key', encryptionKey: Buffer.alloc(32, 7) }, adapter);
  const oldKey = 'b'.repeat(64);
  await store.create('session', oldKey, { owner: 'Acme' }, 600);
  assert.deepEqual((await store.read('session', oldKey)).value, { owner: 'Acme' });
  await store.revoke(oldKey);
  assert.equal(await store.read('session', oldKey), null);
  assert.equal(urls.length, 4);

  await db.query(`SELECT public.keel_web_rpc('create','session',$1,'Acme',null,'1',600)`, [key]);
  const preserved = (await db.query('SELECT * FROM keel_private.web_records')).rows;
  const migration = await readFile(new URL('014-plates-names.sql', directory), 'utf8');
  // A late missing prerequisite must roll back every earlier alias creation.
  await db.exec('ALTER FUNCTION public.keel_run_history(text,text,text,integer) RENAME TO acme_history');
  await assert.rejects(db.exec(migration), /missing or overloaded source RPC/);
  await db.exec('ROLLBACK');
  for (const row of rows) assert.equal((await db.query("SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=$1", [row.plates])).rows[0].n, 0);
  await db.exec('ALTER FUNCTION public.acme_history(text,text,text,integer) RENAME TO keel_run_history');
  await db.exec(migration);
  for (const row of rows) {
    const current = (await db.query(`SELECT prosrc, proargnames, proargtypes::text, proacl::text, proconfig, prosecdef, pg_get_function_arguments(oid) args FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=$1`, [row.plates])).rows[0];
    assert.deepEqual(current, before.get(row.id), row.id);
    const legacy = (await db.query(`SELECT prosrc FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=$1`, [row.keel])).rows[0];
    assert.match(legacy.prosrc, new RegExp(`^SELECT public\\.${row.plates}\\(`));
    for (const name of [row.plates, row.keel]) {
      const permissions = (await db.query(`SELECT has_function_privilege('anon',oid,'EXECUTE') anon, has_function_privilege('authenticated',oid,'EXECUTE') authenticated, has_function_privilege('service_role',oid,'EXECUTE') service FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=$1`, [name])).rows[0];
      assert.deepEqual(permissions, { anon: false, authenticated: false, service: true });
    }
  }
  // The exact production store implementation selects the candidate RPC only
  // through a scratch row change, after the real migration has been applied.
  const candidate = await nameCandidate(t, { cookies: false, database: true });
  const nextStore = candidate.store.createStore({ storageUrl: 'https://acme.supabase.co', storageKey: 'fake-key', encryptionKey: Buffer.alloc(32, 7) }, adapter);
  expectedName = 'plates_web_rpc';
  await nextStore.create('session', oldKey, { owner: 'Acme candidate' }, 600);
  assert.deepEqual((await nextStore.read('session', oldKey)).value, { owner: 'Acme candidate' });
  expectedName = 'keel_web_rpc';
  assert.deepEqual((await store.read('session', oldKey)).value, { owner: 'Acme candidate' });
  await store.revoke(oldKey);
  expectedName = 'plates_web_rpc';
  assert.equal(await nextStore.read('session', oldKey), null);
  for (const row of rows) assert.equal(candidate.names.writeName(row.id), row.plates);
  for (const name of ['keel_web_rpc','plates_web_rpc']) assert.deepEqual((await db.query(`SELECT public.${name}('read','session',$1) value`, [key])).rows, [{ value: { value: 'Acme', version: 1 } }]);
  const k = `'${key}'`;
  const calls = {
    keel_model_credential_read: `${k},${k},${k},1`,
    keel_web_rpc: `'read','session',${k}`,
    keel_home_cache_rpc: `'read',${k}`,
    keel_home_quota_rpc: `'read',${k}`,
    keel_home_cursor_rpc: `${k},${k}`,
    keel_decision_rpc: `'read',${k},${k}`,
    keel_walk_rpc: `'read',${k},${k},${k}`,
    keel_media_rpc: `'list',${k},${k},1`,
    keel_connection_rpc: `'metadata',${k},${k}`,
    keel_job_rpc: `'read',${k},${k},'{}'::jsonb`,
    keel_fleet_rpc: `'read',${k},${k},1`,
    keel_model_rpc: `'read',${k},${k},1,${k},'{}'::jsonb`,
    keel_editor_draft_rpc: `'read',${k}`,
    keel_night_retry_rpc: `'read',${k},${k},'${JSON.stringify({project:key,actor:1})}'::jsonb`,
    keel_run_history: `${k},${k}`,
  };
  assert.equal(Object.keys(calls).length, rows.length);
  await db.exec('SET ROLE service_role');
  for (const row of rows) {
    const oldResult = await db.query(`SELECT public.${row.keel}(${calls[row.keel]}) value`);
    const newResult = await db.query(`SELECT public.${row.plates}(${calls[row.keel]}) value`);
    assert.deepEqual(newResult.rows, oldResult.rows, row.id);
  }
  await db.exec('RESET ROLE');
  await db.exec(migration);
  assert.deepEqual((await db.query('SELECT * FROM keel_private.web_records')).rows, preserved);
  await db.exec('SET ROLE service_role');
  await db.query(`SELECT public.plates_web_rpc('revoke','session',$1)`, [key]);
  assert.deepEqual((await db.query(`SELECT public.keel_web_rpc('read','session',$1) value`, [key])).rows, [{ value: null }]);
  await db.exec('RESET ROLE');
  await db.exec('DROP FUNCTION public.plates_web_rpc(text,text,text,text,text,text,integer,bigint)');
  await assert.rejects(db.exec(migration), /missing forwarding target/);
  await db.exec('ROLLBACK');

});


test('baseline never retries a failed or ambiguous mutation under a new RPC alias', async () => {
  const { createStore } = await import('../lib/web/store.mjs');
  for (const status of [404, 503]) {
    const requests = [];
    const store = createStore({ storageUrl: 'https://acme.supabase.co', storageKey: 'fake-key', encryptionKey: Buffer.alloc(32, 7) }, async url => {
      requests.push(url); return new Response('{}', { status });
    });
    await assert.rejects(store.create('session', 'a'.repeat(64), { owner: 'Acme' }, 600));
    assert.deepEqual(requests, ['https://acme.supabase.co/rest/v1/rpc/keel_web_rpc']);
  }
});
