import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = name => readFile(new URL(`../lib/web/migrations/${name}`, import.meta.url), 'utf8');

// This guards the packaged migration deployment contract. PostgreSQL behavior,
// grants, existing receipts and shared charges are exercised by the retained SQL
// proof; these source assertions do not claim to execute or parse PostgreSQL.
test('older job migration packages fence installed night admission before replacing its RPC', async () => {
  for (const name of ['009-jobs.sql', '010-fleet-updates.sql']) {
    const sql = await migration(name);
    const fence = sql.match(/do \$\$([\s\S]*?)\$\$;/);
    assert.ok(fence, `${name}: missing atomic replay fence`);
    assert.ok(sql.indexOf('begin;') < fence.index, `${name}: fence must be inside the migration transaction`);
    assert.ok(fence.index + fence[0].length < sql.indexOf('create or replace function public.keel_job_rpc'), `${name}: refusal must precede public admission replacement`);
    assert.match(fence[1], /pg_advisory_xact_lock\(hashtextextended\('keel-job-migrations',107\)\)/);
    for (const artifact of ['job_rpc_before_night', 'night_previews', 'night_retries', 'keel_night_retry_rpc']) {
      assert.ok(fence[1].includes(artifact), `${name}: missing partial-extension guard ${artifact}`);
    }
    assert.match(fence[1], /raise exception 'migration013 owns job admission/);
  }
});

test('night migration package retains its original delegate and reapplies wrapper privileges', async () => {
  const sql = await migration('013-night-retries.sql');
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('keel-job-migrations',107\)\)/);
  assert.match(sql, /create table if not exists keel_private\.night_previews/);
  assert.match(sql, /create table if not exists keel_private\.night_retries/);
  assert.match(sql, /if to_regprocedure\('keel_private\.job_rpc_before_night\(text,text,text,jsonb\)'\) is null then\s+alter function public\.keel_job_rpc\(text,text,text,jsonb\) set schema keel_private;\s+alter function keel_private\.keel_job_rpc\(text,text,text,jsonb\) rename to job_rpc_before_night;/);
  assert.match(sql, /raise exception 'incomplete night migration/);
  assert.match(sql, /revoke all on function keel_private\.job_rpc_before_night\(text,text,text,jsonb\) from public,anon,authenticated,service_role;/);
  for (const name of ['keel_job_rpc', 'keel_night_retry_rpc']) {
    assert.ok(sql.includes(`create or replace function public.${name}(`));
    assert.ok(sql.includes(`revoke all on function public.${name}(text,text,text,jsonb) from public,anon,authenticated;`));
    assert.ok(sql.includes(`grant execute on function public.${name}(text,text,text,jsonb) to service_role;`));
  }
});
