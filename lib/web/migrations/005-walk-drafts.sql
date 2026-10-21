-- Private encrypted guided-walk drafts and phase-92 observation histories.
begin;
create table if not exists keel_private.walk_drafts (
 id text primary key check(id ~ '^[a-f0-9]{64}$'),
 scope text not null check(scope ~ '^[a-f0-9]{64}$'),
 project text not null check(project ~ '^[a-f0-9]{64}$'),
 revision bigint not null check(revision>0),
 digest text not null check(digest ~ '^[a-f0-9]{64}$'),
 value text not null check(octet_length(value)<=1500000)
);
alter table keel_private.walk_drafts enable row level security;
revoke all on keel_private.walk_drafts from public,anon,authenticated,service_role;
create or replace function public.keel_walk_rpc(p_operation text,p_id text,p_scope text,p_project text,p_expected bigint default null,p_digest text default null,p_value text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r keel_private.walk_drafts; prior_bytes bigint:=0; now_at timestamptz:=clock_timestamp();
begin
 if p_id is null or p_id!~'^[a-f0-9]{64}$' or p_scope is null or p_scope!~'^[a-f0-9]{64}$' or p_project is null or p_project!~'^[a-f0-9]{64}$'
 or (p_digest is not null and p_digest!~'^[a-f0-9]{64}$') or (p_value is not null and octet_length(p_value)>1500000) then raise exception 'invalid walk input'; end if;
 if p_operation='read' then
  select * into r from keel_private.walk_drafts where id=p_id and scope=p_scope and project=p_project;
  if not found then return null; end if;
 elsif p_operation='save' then
  if p_expected is null or p_expected<0 or p_expected>=2147483647 or p_digest is null or p_value is null then raise exception 'invalid walk save'; end if;
  -- The same lock as decision reservation: validation cannot race a newer failure.
  perform pg_catalog.pg_advisory_xact_lock(21259,8);
  if exists(select 1 from keel_private.decision_operations where project=p_project and (state in('dispatched','uncertain') or state='prepared' and lease_until>now_at)) then return jsonb_build_object('blocked',true); end if;
  select * into r from keel_private.walk_drafts where id=p_id;
  if found then
   if r.scope<>p_scope or r.project<>p_project or r.revision<>p_expected then return jsonb_build_object('conflict',true); end if;
   prior_bytes:=octet_length(r.value);
  else
   if p_expected<>0 then return jsonb_build_object('conflict',true); end if;
   if (select count(*) from keel_private.walk_drafts)>=1000 then return jsonb_build_object('capacity',true); end if;
  end if;
  if (select coalesce(sum(octet_length(value)),0) from keel_private.walk_drafts)-prior_bytes+octet_length(p_value)>52428800 then return jsonb_build_object('capacity',true); end if;
  insert into keel_private.walk_drafts(id,scope,project,revision,digest,value) values(p_id,p_scope,p_project,p_expected+1,p_digest,p_value)
  on conflict(id) do update set revision=excluded.revision,digest=excluded.digest,value=excluded.value returning * into r;
 else raise exception 'unsupported walk operation'; end if;
 return jsonb_build_object('id',r.id,'revision',r.revision,'digest',r.digest,'value',r.value);
end;
$$;
revoke all on function public.keel_walk_rpc(text,text,text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.keel_walk_rpc(text,text,text,text,bigint,text,text) to service_role;
commit;
