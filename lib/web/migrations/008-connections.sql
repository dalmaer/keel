-- Connection credentials are runtime ciphertext. This RPC never returns ciphertext.
begin;
create table if not exists keel_private.connection_credentials (
 scope text not null check(scope ~ '^[a-f0-9]{64}$'),
 connection text not null check(connection ~ '^[a-f0-9]{64}$'),
 version bigint not null check(version between 1 and 2147483647),
 state text not null check(state in ('present','removed')),
 policy text not null check(policy ~ '^[a-f0-9]{64}$'),
 request text not null check(request ~ '^[a-f0-9]{64}$'),
 actor bigint not null check(actor > 0),
 value text,
 health jsonb,
 updated_at timestamptz not null default clock_timestamp(),
 primary key(scope,connection),
 check((state='present' and value is not null and octet_length(value) between 20 and 16384 and health is not null and octet_length(health::text)<=65536)
    or (state='removed' and value is null and health is null))
);
alter table keel_private.connection_credentials enable row level security;
revoke all on keel_private.connection_credentials from public,anon,authenticated,service_role;
create or replace function public.keel_connection_rpc(
 p_operation text,p_scope text,p_connection text,p_expected bigint default null,
 p_policy text default null,p_request text default null,p_actor bigint default null,
 p_value text default null,p_health jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r keel_private.connection_credentials%rowtype;
begin
 if p_operation is null or p_operation not in ('metadata','put','remove') or p_scope is null or p_scope!~'^[a-f0-9]{64}$'
 or p_connection is null or p_connection!~'^[a-f0-9]{64}$' then raise exception 'invalid connection input'; end if;
 if p_operation <> 'metadata' then
  if p_expected is null or p_expected<0 or p_expected>=2147483647 or p_policy is null or p_policy!~'^[a-f0-9]{64}$'
   or p_request is null or p_request!~'^[a-f0-9]{64}$' or p_actor is null or p_actor<=0 then raise exception 'invalid connection mutation'; end if;
  if p_operation='put' and p_expected>=2147483646 then raise exception 'connection generation exhausted'; end if;
  if p_operation='put' and (p_value is null or octet_length(p_value)<20 or octet_length(p_value)>16384
    or p_health is null or jsonb_typeof(p_health)<>'object' or octet_length(p_health::text)>65536) then raise exception 'invalid connection ciphertext'; end if;
  if p_operation='remove' and (p_value is not null or p_health is not null) then raise exception 'invalid connection removal'; end if;
  -- Serialize capacity and CAS in the database; no network operation holds this lock.
  perform pg_advisory_xact_lock(hashtextextended(p_scope,103));
  select * into r from keel_private.connection_credentials c where c.scope=p_scope and c.connection=p_connection for update;
  if coalesce(r.version,0)<>p_expected or r.request=p_request then return jsonb_build_object('conflict',true); end if;
  if r.version is null and (select count(*) from keel_private.connection_credentials c where c.scope=p_scope)>=1000 then raise exception 'connection capacity'; end if;
  insert into keel_private.connection_credentials(scope,connection,version,state,policy,request,actor,value,health,updated_at)
   values(p_scope,p_connection,p_expected+1,case when p_operation='put' then 'present' else 'removed' end,p_policy,p_request,p_actor,
     case when p_operation='put' then p_value else null end,case when p_operation='put' then p_health else null end,clock_timestamp())
   on conflict(scope,connection) do update set version=excluded.version,state=excluded.state,policy=excluded.policy,
    request=excluded.request,actor=excluded.actor,value=excluded.value,health=excluded.health,updated_at=excluded.updated_at
   returning * into r;
 else
  if p_expected is not null or p_policy is not null or p_request is not null or p_actor is not null or p_value is not null or p_health is not null then raise exception 'invalid metadata input'; end if;
  select * into r from keel_private.connection_credentials c where c.scope=p_scope and c.connection=p_connection;
 end if;
 if r.version is null then return null; end if;
 return jsonb_build_object('version',r.version,'state',r.state,'policy',r.policy,'request',r.request,'actor',r.actor,'updatedAt',r.updated_at,'health',r.health);
end;
$$;
revoke all on function public.keel_connection_rpc(text,text,text,bigint,text,text,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.keel_connection_rpc(text,text,text,bigint,text,text,bigint,text,jsonb) to service_role;
commit;
