-- Phase 96: private shared read caches and quota observations, never session records.
begin;
create table if not exists keel_private.home_cache (
  key text primary key check (key ~ '^[a-f0-9]{64}$'),
  value text check (octet_length(value) <= 524288),
  version bigint not null default 0,
  read_at timestamptz,
  expires_at timestamptz not null default clock_timestamp() + interval '7 days',
  lease text,
  lease_until timestamptz,
  next_attempt timestamptz,
  last_error text check (last_error in ('source_unavailable','source_limit','quota_saving'))
);
alter table keel_private.home_cache enable row level security;
revoke all on keel_private.home_cache from public, anon, authenticated, service_role;
create table if not exists keel_private.home_quota (
  key text primary key check (key ~ '^[a-f0-9]{64}$'),
  remaining integer,
  reset_at timestamptz,
  observed_at timestamptz,
  unknown_probes integer not null default 0,
  probe_window timestamptz not null default clock_timestamp()
);
alter table keel_private.home_quota enable row level security;
revoke all on keel_private.home_quota from public, anon, authenticated, service_role;
create or replace function public.keel_home_cache_rpc(p_operation text, p_key text, p_value text default null,
  p_lease text default null, p_error text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r keel_private.home_cache; now_at timestamptz := clock_timestamp(); acquired boolean := false;
begin
  if p_key is null or p_key !~ '^[a-f0-9]{64}$' or (p_value is not null and octet_length(p_value) > 524288)
    or (p_lease is not null and p_lease !~ '^[a-f0-9]{64}$') then raise exception 'invalid cache input'; end if;
  if p_operation = 'claim' and p_lease is not null then
    perform pg_catalog.pg_advisory_xact_lock(21259, 4);
    delete from keel_private.home_cache where key in (select key from keel_private.home_cache where expires_at <= now_at limit 100);
    if not exists(select 1 from keel_private.home_cache where key=p_key) and (select count(*) from keel_private.home_cache) >= 1000 then raise exception 'cache capacity reached'; end if;
    insert into keel_private.home_cache(key) values(p_key) on conflict do nothing;
    update keel_private.home_cache set lease=p_lease, lease_until=now_at+interval '45 seconds', next_attempt=now_at+interval '60 seconds'
      where key=p_key and (lease_until is null or lease_until<=now_at) and (next_attempt is null or next_attempt<=now_at)
      returning * into r;
    acquired := found;
  elsif p_operation = 'finish' and p_lease is not null and p_value is not null then
    update keel_private.home_cache set value=p_value,version=version+1,read_at=now_at,expires_at=now_at+interval '7 days',lease=null,lease_until=null,last_error=null
      where key=p_key and lease=p_lease and lease_until>now_at returning * into r;
    if not found then return null; end if;
  elsif p_operation = 'fail' and p_lease is not null and p_error in ('source_unavailable','source_limit','quota_saving') then
    update keel_private.home_cache set lease=null,lease_until=null,last_error=p_error
      where key=p_key and lease=p_lease and lease_until>now_at returning * into r;
    if not found then return null; end if;
  elsif p_operation <> 'read' then raise exception 'unsupported cache operation'; end if;
  if r.key is null then select * into r from keel_private.home_cache where key=p_key and expires_at>now_at; end if;
  if r.key is null then return null; end if;
  return jsonb_build_object('value',r.value,'version',r.version,'readAt',r.read_at,'leaseAcquired',acquired,
    'refreshing',r.lease_until>now_at,'lastError',r.last_error,'nextAttempt',r.next_attempt);
end;
$$;
create or replace function public.keel_home_quota_rpc(p_operation text,p_key text,p_remaining integer default null,p_reset bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r keel_private.home_quota; now_at timestamptz := clock_timestamp(); allowed boolean := true;
begin
  if p_key is null or p_key !~ '^[a-f0-9]{64}$' or (p_remaining is not null and (p_remaining<0 or p_remaining>1000000))
    or (p_reset is not null and (p_reset<0 or p_reset>4102444800)) then raise exception 'invalid quota input'; end if;
  perform pg_catalog.pg_advisory_xact_lock(21259, 5);
  delete from keel_private.home_quota where key in (select key from keel_private.home_quota where probe_window<now_at-interval '7 days' limit 100);
  if not exists(select 1 from keel_private.home_quota where key=p_key) and (select count(*) from keel_private.home_quota)>=100 then raise exception 'quota capacity reached'; end if;
  insert into keel_private.home_quota(key) values(p_key) on conflict do nothing;
  select * into r from keel_private.home_quota where key=p_key for update;
  if p_operation='observe' and p_remaining is not null and p_reset is not null then
    if r.reset_at is null or to_timestamp(p_reset)>r.reset_at then
      r.remaining:=p_remaining; r.reset_at:=to_timestamp(p_reset);
    elsif to_timestamp(p_reset)=r.reset_at then r.remaining:=least(r.remaining,p_remaining); end if;
    r.observed_at:=now_at;
  elsif p_operation='reserve' then
    if r.reset_at>now_at and r.remaining is not null then
      allowed:=r.remaining>1000;
      if allowed then r.remaining:=r.remaining-1; end if;
    else
      if r.probe_window<=now_at-interval '60 seconds' then r.unknown_probes:=0; r.probe_window:=now_at; end if;
      allowed:=r.unknown_probes<20;
      if allowed then r.unknown_probes:=r.unknown_probes+1; end if;
    end if;
  elsif p_operation<>'read' then raise exception 'unsupported quota operation'; end if;
  update keel_private.home_quota set remaining=r.remaining,reset_at=r.reset_at,observed_at=r.observed_at,
    unknown_probes=r.unknown_probes,probe_window=r.probe_window where key=p_key;
  return jsonb_build_object('allowed',allowed,'remaining',case when r.reset_at>now_at then r.remaining else null end,
    'resetAt',case when r.reset_at>now_at then r.reset_at else null end,'observedAt',r.observed_at);
end;
$$;
revoke all on function public.keel_home_cache_rpc(text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.keel_home_quota_rpc(text,text,integer,bigint) from public,anon,authenticated;
grant execute on function public.keel_home_cache_rpc(text,text,text,text,text) to service_role;
grant execute on function public.keel_home_quota_rpc(text,text,integer,bigint) to service_role;
create table if not exists keel_private.home_cursors (
  key text primary key check (key ~ '^[a-f0-9]{64}$'),
  recent text[] not null default '{}',
  observed_at timestamptz not null default clock_timestamp()
);
alter table keel_private.home_cursors enable row level security;
revoke all on keel_private.home_cursors from public,anon,authenticated,service_role;
create or replace function public.keel_home_cursor_rpc(p_key text,p_cursor text,p_since text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare history text[]; state text; now_at timestamptz := clock_timestamp();
begin
  if p_key is null or p_key !~ '^[a-f0-9]{64}$' or p_cursor is null or p_cursor !~ '^[a-f0-9]{64}$'
    or (p_since is not null and p_since !~ '^[a-f0-9]{64}$') then raise exception 'invalid cursor input'; end if;
  perform pg_catalog.pg_advisory_xact_lock(21259,6);
  delete from keel_private.home_cursors where key in (select key from keel_private.home_cursors where observed_at<now_at-interval '7 days' limit 100);
  if not exists(select 1 from keel_private.home_cursors where key=p_key) and (select count(*) from keel_private.home_cursors)>=1000 then raise exception 'cursor capacity reached'; end if;
  insert into keel_private.home_cursors(key) values(p_key) on conflict do nothing;
  select recent into history from keel_private.home_cursors where key=p_key for update;
  state := case when p_since is null then 'initial' when p_since=p_cursor then 'current' when p_since=any(history) then 'changed' else 'gap' end;
  if not p_cursor=any(history) then history := (array_prepend(p_cursor,history))[1:8]; end if;
  update keel_private.home_cursors set recent=history,observed_at=now_at where key=p_key;
  return jsonb_build_object('state',state);
end;
$$;
revoke all on function public.keel_home_cursor_rpc(text,text,text) from public,anon,authenticated;
grant execute on function public.keel_home_cursor_rpc(text,text,text) to service_role;
commit;
