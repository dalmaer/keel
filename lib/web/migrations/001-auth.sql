-- Apply once to the explicit private Supabase database using an owner SQL session.
-- Runtime callers get only this bounded RPC; browser roles get no table or function access.
begin;
create schema if not exists keel_private;
revoke all on schema keel_private from public, anon, authenticated;
create table if not exists keel_private.web_records (
  kind text not null check (kind in ('attempt', 'session', 'record')),
  key text not null check (key ~ '^[a-f0-9]{64}$'),
  value text not null check (octet_length(value) <= 16384),
  binding text,
  actor text,
  version bigint not null default 1,
  expires_at timestamptz not null,
  primary key (kind, key)
);
alter table keel_private.web_records enable row level security;
revoke all on keel_private.web_records from public, anon, authenticated, service_role;
create index if not exists web_records_expiry on keel_private.web_records (expires_at);
create index if not exists web_records_actor on keel_private.web_records (actor) where kind = 'session';
create or replace function public.keel_web_rpc(
  p_operation text, p_kind text, p_key text, p_value text default null,
  p_binding text default null, p_actor text default null,
  p_seconds integer default 0, p_version bigint default 0
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  result keel_private.web_records;
  deadline timestamptz := clock_timestamp();
begin
  if p_kind not in ('attempt', 'session', 'record') or p_seconds < 0 or p_seconds > 28800
    or p_version < 0 or (p_value is not null and octet_length(p_value) > 16384)
    or (p_binding is not null and p_binding !~ '^[a-f0-9]{64}$')
    or (p_actor is not null and p_actor !~ '^[1-9][0-9]{0,15}$') then
    raise exception 'invalid storage operation';
  end if;
  if p_operation = 'revoke_actor' and p_kind = 'session' and p_actor is not null then
    delete from keel_private.web_records where kind = 'session' and actor = p_actor;
    return null;
  end if;
  if p_key is null or p_key !~ '^[a-f0-9]{64}$' then raise exception 'invalid storage key'; end if;
  if p_operation = 'create' and p_value is not null and p_seconds > 0 then
    -- Bound public login storage across instances, including expired garbage.
    -- This lock covers only bounded local SQL, never an upstream network call.
    perform pg_catalog.pg_advisory_xact_lock(21259, case p_kind when 'attempt' then 1 when 'session' then 2 else 3 end);
    delete from keel_private.web_records where (kind, key) in (
      select kind, key from keel_private.web_records where kind = p_kind and expires_at <= deadline limit 100
    );
    if (select count(*) from keel_private.web_records where kind = p_kind) >=
      (case p_kind when 'record' then 10000 else 1000 end) then raise exception 'storage capacity reached'; end if;
    insert into keel_private.web_records(kind, key, value, binding, actor, expires_at)
      values(p_kind, p_key, p_value, p_binding, p_actor, deadline + make_interval(secs => p_seconds))
      on conflict do nothing returning * into result;
  elsif p_operation = 'read' then
    select * into result from keel_private.web_records where kind = p_kind and key = p_key and expires_at > deadline;
  elsif p_operation = 'consume' and p_kind = 'attempt' and p_binding is not null then
    delete from keel_private.web_records where kind = 'attempt' and key = p_key
      and binding = p_binding and expires_at > deadline returning * into result;
  elsif p_operation = 'renew' and p_kind = 'session' and p_seconds > 0 then
    update keel_private.web_records set expires_at = deadline + make_interval(secs => p_seconds)
      where kind = 'session' and key = p_key and version = p_version and expires_at > deadline returning * into result;
  elsif p_operation = 'cas' and p_seconds > 0 and p_value is not null then
    update keel_private.web_records set value = p_value, version = version + 1,
      expires_at = deadline + make_interval(secs => p_seconds)
      where kind = p_kind and key = p_key and version = p_version and expires_at > deadline returning * into result;
  elsif p_operation = 'revoke' and p_kind = 'session' then
    delete from keel_private.web_records where kind = 'session' and key = p_key;
    return null;
  else raise exception 'unsupported storage operation';
  end if;
  if result.key is null then return null; end if;
  return jsonb_build_object('value', result.value, 'version', result.version);
end;
$$;
revoke all on function public.keel_web_rpc(text,text,text,text,text,text,integer,bigint) from public, anon, authenticated;
grant execute on function public.keel_web_rpc(text,text,text,text,text,text,integer,bigint) to service_role;
-- No public cleanup endpoint: schedule this using the database owner's maintenance policy.
-- delete from keel_private.web_records where expires_at <= clock_timestamp();
commit;
