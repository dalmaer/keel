// Optional isolated SQL tooling, not an application dependency or hosted proof.
// Usage: node <this-file> /absolute/tooling/node_modules/@electric-sql/pglite/dist/index.js
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.argv[2]);
const db = new PGlite();
try {
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for (const file of ['001-auth.sql','002-home-cache.sql','003-home-retry.sql','004-decision-operations.sql','005-walk-drafts.sql'])
    await db.exec(await readFile(new URL(`../../lib/web/migrations/${file}`,import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('./2026-10-21-web-walks-hosted-proof.sql',import.meta.url),'utf8'));
  console.log('PASS: RLS, direct role denial, scoped RPC reads and CAS saves, stale-tab refusal, live operation reservation, expired undispatched preparation, persistent dispatched/uncertain reservation, terminal release and synthetic rollback. Single connection; no hosted or concurrency claim.');
  // Capacity load belongs only in this isolated database, never the hosted proof.
  await db.exec(`begin;
    insert into keel_private.walk_drafts
      select lpad(to_hex(n),64,'0'),repeat('a',64),repeat('b',64),1,repeat('c',64),'Acme history'
      from generate_series(1,1000) n;
    do $$ declare r jsonb; begin
      r:=public.keel_walk_rpc('save',repeat('d',64),repeat('a',64),repeat('b',64),0,repeat('c',64),'Acme extra');
      if r->>'capacity' is distinct from 'true' then raise exception 'row capacity not enforced'; end if;
      r:=public.keel_walk_rpc('save',lpad('1',64,'0'),repeat('a',64),repeat('b',64),1,repeat('c',64),'Acme retained history');
      if r->>'revision' is distinct from '2' then raise exception 'capacity blocked existing draft'; end if;
      if (select count(*) from keel_private.walk_drafts)<>1000 then raise exception 'capacity deleted history'; end if;
    end $$;
    rollback;
    begin;
    insert into keel_private.walk_drafts
      select lpad(to_hex(n),64,'0'),repeat('a',64),repeat('b',64),1,repeat('c',64),repeat('x',1500000)
      from generate_series(1,34) n;
    do $$ declare r jsonb; begin
      r:=public.keel_walk_rpc('save',repeat('d',64),repeat('a',64),repeat('b',64),0,repeat('c',64),repeat('x',1500000));
      if r->>'capacity' is distinct from 'true' then raise exception 'byte capacity not enforced'; end if;
      if (select sum(octet_length(value)) from keel_private.walk_drafts)<>51000000 then raise exception 'byte capacity deleted history'; end if;
      begin
        perform public.keel_walk_rpc('save',repeat('d',64),repeat('a',64),repeat('b',64),0,repeat('c',64),repeat('x',1500001));
        raise exception using errcode='P0002',message='oversized value accepted';
      exception when raise_exception then
        if sqlerrm<>'invalid walk input' then raise; end if;
      end;
    end $$;
    rollback;`);
  console.log('PASS: isolated 1000-row capacity, updates at row capacity, 50MiB byte capacity, per-value bound and history preservation.');
} catch (error) {
  console.error('FAIL:',error.code,error.message,error.where ?? '');
  process.exitCode=1;
} finally { await db.close(); }
