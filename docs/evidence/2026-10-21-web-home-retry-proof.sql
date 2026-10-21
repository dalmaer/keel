-- Synthetic Acme proof. Inner rollback removes every proof row even on success.
do $proof$
declare k text := '74d031b32064e48b15cac3abec89995102a353eb3c3ad0dc615b67b71ff0c0ec';
  r jsonb; deadline bigint := extract(epoch from clock_timestamp())::bigint+180;
  reset_at bigint := extract(epoch from clock_timestamp())::bigint+3600;
begin
  begin
    set local role service_role;
    r := public.keel_home_quota_rpc('observe',k,4500,reset_at);
    r := public.keel_home_quota_rpc('defer',k,null,deadline);
    if (r->>'remaining')::int <> 4500 then raise exception 'pause changed quota'; end if;
    r := public.keel_home_quota_rpc('reserve',k);
    if (r->>'allowed')::boolean then raise exception 'pause allowed reservation'; end if;
    r := public.keel_home_quota_rpc('observe',k,4500,reset_at);
    r := public.keel_home_quota_rpc('defer',k,null,deadline-60);
    if extract(epoch from (r->>'blockedUntil')::timestamptz)::bigint <> deadline then raise exception 'pause shortened'; end if;
    r := public.keel_home_quota_rpc('reserve',k);
    if (r->>'allowed')::boolean then raise exception 'observation removed pause'; end if;
    reset role;
    update keel_private.home_quota set blocked_until=clock_timestamp()-interval '1 second' where key=k;
    set local role service_role;
    r := public.keel_home_quota_rpc('reserve',k);
    if not (r->>'allowed')::boolean or (r->>'remaining')::int <> 4499 then raise exception 'resume failed'; end if;
    reset role;
    set local role anon;
    begin
      perform public.keel_home_quota_rpc('defer',k,null,deadline);
      raise exception 'anon unexpectedly allowed';
    exception when insufficient_privilege then null;
    end;
    reset role;
    set local role authenticated;
    begin
      perform public.keel_home_quota_rpc('defer',k,null,deadline);
      raise exception 'authenticated unexpectedly allowed';
    exception when insufficient_privilege then null;
    end;
    reset role;
    raise exception using errcode='P0002',message='proof complete: rollback synthetic data';
  exception when no_data_found then null;
  end;
  if exists(select 1 from keel_private.home_quota where key=k) then raise exception 'proof data survived rollback'; end if;
end $proof$;
