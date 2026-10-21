-- Phase 96 hosted proof. Replace keys once with new synthetic Acme SHA-256 keys.
-- Preserve A/B result timestamps and distinct backend IDs. Role block is one statement.
DO $acme_roles$
declare denied boolean; r record;
begin
  for r in select unnest(array['anon','authenticated']) as role_name loop
    execute format('set local role %I',r.role_name);
    denied:=false;
    begin perform public.keel_home_cache_rpc('read','6f88df7a93852c6759d2be0bd212e84b9462ce10d3afcd5dff1cadb1f9f43aa2'); exception when insufficient_privilege then denied:=true; end;
    if not denied then raise exception 'cache RPC unexpectedly accessible'; end if;
    denied:=false;
    begin perform public.keel_home_quota_rpc('read','a7bc5c606a52b2e5aaa20a1f6c983e8a9173e601b4a3e677e03e2b465414d69c'); exception when insufficient_privilege then denied:=true; end;
    if not denied then raise exception 'quota RPC unexpectedly accessible'; end if;
    denied:=false;
    begin perform public.keel_home_cursor_rpc('20e503484d0569a856517cdf25d8eb0e6baea868f8458291e23eb45c5bc412f4','dc9185cd823a84fb8f175636f83fbc3ce4b77758ef3c8c523b786b450bb78962'); exception when insufficient_privilege then denied:=true; end;
    if not denied then raise exception 'cursor RPC unexpectedly accessible'; end if;
    denied:=false;
    begin perform 1 from keel_private.home_cache limit 1; exception when insufficient_privilege then denied:=true; end;
    if not denied then raise exception 'cache table unexpectedly accessible'; end if;
    denied:=false;
    begin perform 1 from keel_private.home_quota limit 1; exception when insufficient_privilege then denied:=true; end;
    if not denied then raise exception 'quota table unexpectedly accessible'; end if;
    denied:=false;
    begin perform 1 from keel_private.home_cursors limit 1; exception when insufficient_privilege then denied:=true; end;
    if not denied then raise exception 'cursor table unexpectedly accessible'; end if;
    reset role;
  end loop;
  set local role service_role;
  denied:=false;
  begin perform 1 from keel_private.home_cache limit 1; exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'service role cache table unexpectedly accessible'; end if;
  denied:=false;
  begin perform 1 from keel_private.home_quota limit 1; exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'service role quota table unexpectedly accessible'; end if;
  denied:=false;
  begin perform 1 from keel_private.home_cursors limit 1; exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'service cursor table unexpectedly accessible'; end if;
  perform public.keel_home_cursor_rpc('20e503484d0569a856517cdf25d8eb0e6baea868f8458291e23eb45c5bc412f4','dc9185cd823a84fb8f175636f83fbc3ce4b77758ef3c8c523b786b450bb78962');
  perform public.keel_home_cache_rpc('read','6f88df7a93852c6759d2be0bd212e84b9462ce10d3afcd5dff1cadb1f9f43aa2');
  perform public.keel_home_quota_rpc('observe','a7bc5c606a52b2e5aaa20a1f6c983e8a9173e601b4a3e677e03e2b465414d69c',1001,extract(epoch from clock_timestamp()+interval '1 hour')::bigint);
  reset role;
end;
$acme_roles$;

-- Cache A: run, then start B immediately in a second query tab while A sleeps.
with result as materialized (select public.keel_home_cache_rpc('claim','6f88df7a93852c6759d2be0bd212e84b9462ce10d3afcd5dff1cadb1f9f43aa2',null,'7d888a42e52b815d71627cba74339cc446a961c8f2d930eaa1b29472c2cb54b3') as r),
held as materialized (select pg_sleep(8) from result)
select pg_backend_pid() as backend,transaction_timestamp() as began,clock_timestamp() as finished,result.r->>'leaseAcquired' as acquired from result,held;
-- Cache B: the finished expression is evaluated before the blocked RPC;
-- use began plus the UI query duration as overlap evidence, not this finish column.
select pg_backend_pid() as backend,transaction_timestamp() as began,clock_timestamp() as finished,
public.keel_home_cache_rpc('claim','6f88df7a93852c6759d2be0bd212e84b9462ce10d3afcd5dff1cadb1f9f43aa2',null,'c17583c93bd1975d7c833ed9bc6214bc185904b0e82741df7a486ddc921f06e8')->>'leaseAcquired' as acquired;
-- Finish the winner before its 45-second lease expires; wrong lease must return null.
select public.keel_home_cache_rpc('finish','6f88df7a93852c6759d2be0bd212e84b9462ce10d3afcd5dff1cadb1f9f43aa2','fake-acme-wrong-lease','c17583c93bd1975d7c833ed9bc6214bc185904b0e82741df7a486ddc921f06e8') is null as wrong_lease_denied,
(public.keel_home_cache_rpc('finish','6f88df7a93852c6759d2be0bd212e84b9462ce10d3afcd5dff1cadb1f9f43aa2','fake-acme-home-value','7d888a42e52b815d71627cba74339cc446a961c8f2d930eaa1b29472c2cb54b3')->>'version')::int=1 as winner_saved;

-- Quota A then B, overlapping independent transactions.
with result as materialized (select public.keel_home_quota_rpc('reserve','a7bc5c606a52b2e5aaa20a1f6c983e8a9173e601b4a3e677e03e2b465414d69c') as r),
held as materialized (select pg_sleep(8) from result)
select pg_backend_pid() as backend,transaction_timestamp() as began,clock_timestamp() as finished,result.r->>'allowed' as allowed from result,held;
-- Quota B
with result as materialized (select public.keel_home_quota_rpc('reserve','a7bc5c606a52b2e5aaa20a1f6c983e8a9173e601b4a3e677e03e2b465414d69c') as r)
select pg_backend_pid() as backend,transaction_timestamp() as began,clock_timestamp() as finished,result.r->>'allowed' as allowed from result;
-- Final assertions
select public.keel_home_cache_rpc('read','6f88df7a93852c6759d2be0bd212e84b9462ce10d3afcd5dff1cadb1f9f43aa2')->>'value'='fake-acme-home-value' as cache_winner_retained,
(public.keel_home_quota_rpc('read','a7bc5c606a52b2e5aaa20a1f6c983e8a9173e601b4a3e677e03e2b465414d69c')->>'remaining')::int=1000 as quota_floor_retained;
-- Exact synthetic row cleanup, not general deletion.
with removed as (delete from keel_private.home_cache where key='6f88df7a93852c6759d2be0bd212e84b9462ce10d3afcd5dff1cadb1f9f43aa2' and value='fake-acme-home-value' returning 1)
select count(*) as synthetic_cache_rows_removed from removed;
with removed as (delete from keel_private.home_quota where key='a7bc5c606a52b2e5aaa20a1f6c983e8a9173e601b4a3e677e03e2b465414d69c' returning 1)
select count(*) as synthetic_quota_rows_removed from removed;

-- Cursor A then B, overlapping transactions.
with result as materialized (select public.keel_home_cursor_rpc('20e503484d0569a856517cdf25d8eb0e6baea868f8458291e23eb45c5bc412f4','81300df00471ce61d0e707cc33cfd6d0f3234d3bae1eb5016f6d7a77e1dc7e0b','dc9185cd823a84fb8f175636f83fbc3ce4b77758ef3c8c523b786b450bb78962') as r),
held as materialized (select pg_sleep(8) from result)
select pg_backend_pid() as backend,transaction_timestamp() as began,clock_timestamp() as finished,result.r->>'state' as state from result,held;
-- Cursor B
with result as materialized (select public.keel_home_cursor_rpc('20e503484d0569a856517cdf25d8eb0e6baea868f8458291e23eb45c5bc412f4','b63247f187fecfef16d61481e0058b5886c2e42d8ac6ab308a28ea0d3c61b9bb','81300df00471ce61d0e707cc33cfd6d0f3234d3bae1eb5016f6d7a77e1dc7e0b') as r)
select pg_backend_pid() as backend,transaction_timestamp() as began,clock_timestamp() as finished,result.r->>'state' as state from result;
-- Cursor assertions
select public.keel_home_cursor_rpc('20e503484d0569a856517cdf25d8eb0e6baea868f8458291e23eb45c5bc412f4','81300df00471ce61d0e707cc33cfd6d0f3234d3bae1eb5016f6d7a77e1dc7e0b','b63247f187fecfef16d61481e0058b5886c2e42d8ac6ab308a28ea0d3c61b9bb')->>'state'='changed' as both_cursors_retained;
-- Cursor cleanup
with removed as (delete from keel_private.home_cursors where key='20e503484d0569a856517cdf25d8eb0e6baea868f8458291e23eb45c5bc412f4' returning 1)
select count(*) as synthetic_cursor_rows_removed from removed;
