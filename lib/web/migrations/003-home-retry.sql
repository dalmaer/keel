-- Preserve actual quota observations while honoring a shared provider retry deadline.
begin;
alter table keel_private.home_quota add column if not exists blocked_until timestamptz;
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
  elsif p_operation='defer' and p_reset is not null then
    if to_timestamp(p_reset)>now_at+interval '7 days 1 minute' then raise exception 'invalid retry bound'; end if;
    r.blocked_until:=greatest(r.blocked_until,to_timestamp(p_reset));
  elsif p_operation='reserve' then
    if r.blocked_until>now_at then
      allowed:=false;
    else
    if r.reset_at>now_at and r.remaining is not null then
      allowed:=r.remaining>1000;
      if allowed then r.remaining:=r.remaining-1; end if;
    else
      if r.probe_window<=now_at-interval '60 seconds' then r.unknown_probes:=0; r.probe_window:=now_at; end if;
      allowed:=r.unknown_probes<20;
      if allowed then r.unknown_probes:=r.unknown_probes+1; end if;
    end if;
    end if;
  elsif p_operation<>'read' then raise exception 'unsupported quota operation'; end if;
  update keel_private.home_quota set remaining=r.remaining,reset_at=r.reset_at,observed_at=r.observed_at,
    unknown_probes=r.unknown_probes,probe_window=r.probe_window,blocked_until=r.blocked_until where key=p_key;
  return jsonb_build_object('blockedUntil',case when r.blocked_until>now_at then r.blocked_until else null end,'allowed',allowed,'remaining',case when r.reset_at>now_at then r.remaining else null end,
    'resetAt',case when r.reset_at>now_at then r.reset_at else null end,'observedAt',r.observed_at);
end;
$$;
revoke all on function public.keel_home_quota_rpc(text,text,integer,bigint) from public,anon,authenticated;
grant execute on function public.keel_home_quota_rpc(text,text,integer,bigint) to service_role;
commit;
