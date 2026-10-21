-- Immutable encrypted previews and fenced durable decision operations.
begin;
create table if not exists keel_private.decision_previews (
 id text primary key check(id ~ '^[a-f0-9]{64}$'), scope text not null,
 value text not null check(octet_length(value)<=1048576), expires_at timestamptz not null default clock_timestamp()+interval '15 minutes'
);
create table if not exists keel_private.decision_operations (
 id text primary key check(id ~ '^[a-f0-9]{64}$'), scope text not null, project text not null,
 preview text unique not null references keel_private.decision_previews(id), fence text not null,
 state text not null check(state in ('prepared','dispatched','uncertain','committed','refused')),
 value text not null check(octet_length(value)<=1048576), lease_until timestamptz not null default clock_timestamp()+interval '60 seconds'
);
create unique index if not exists decision_project_reserved on keel_private.decision_operations(project) where state in ('prepared','dispatched','uncertain');
alter table keel_private.decision_previews enable row level security;
alter table keel_private.decision_operations enable row level security;
revoke all on keel_private.decision_previews,keel_private.decision_operations from public,anon,authenticated,service_role;
create or replace function public.keel_decision_rpc(p_operation text,p_id text,p_scope text,p_project text default null,p_preview text default null,p_fence text default null,p_value text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r keel_private.decision_operations; preview_row keel_private.decision_previews; now_at timestamptz:=clock_timestamp(); created boolean:=false;
begin
 if p_id is null or p_id!~'^[a-f0-9]{64}$' or p_scope is null or p_scope!~'^[a-f0-9]{64}$'
 or (p_project is not null and p_project!~'^[a-f0-9]{64}$') or (p_preview is not null and p_preview!~'^[a-f0-9]{64}$')
 or (p_fence is not null and p_fence!~'^[a-f0-9]{64}$') or (p_value is not null and octet_length(p_value)>1048576) then raise exception 'invalid decision input'; end if;
 if p_operation='preview-create' then
  perform pg_catalog.pg_advisory_xact_lock(21259,7);
  delete from keel_private.decision_previews where id in(select id from keel_private.decision_previews p where expires_at<=now_at and not exists(select 1 from keel_private.decision_operations o where o.preview=p.id) limit 100);
  if (select count(*) from keel_private.decision_previews)>=10000 then raise exception 'preview capacity'; end if;
  insert into keel_private.decision_previews(id,scope,value) values(p_id,p_scope,p_value) on conflict do nothing returning * into preview_row;
  if not found then return null; end if;
  return jsonb_build_object('value',preview_row.value);
 elsif p_operation='preview-read' then
  select * into preview_row from keel_private.decision_previews where id=p_id and scope=p_scope and expires_at>now_at;
  if not found then return null; end if;
  return jsonb_build_object('value',preview_row.value);
 elsif p_operation='reserve' then
  perform pg_catalog.pg_advisory_xact_lock(21259,8);
  select * into r from keel_private.decision_operations where preview=p_preview and scope=p_scope;
  if found then return jsonb_build_object('id',r.id,'state',r.state,'value',r.value,'created',false,'leaseUntil',r.lease_until); end if;
  if p_project is null or p_fence is null or not exists(select 1 from keel_private.decision_previews where id=p_preview and scope=p_scope and expires_at>now_at) then return null; end if;
  -- Expiry can free only an intent which was never dispatched. Dispatched/uncertain reservations persist.
  update keel_private.decision_operations set state='refused' where project=p_project and state='prepared' and lease_until<=now_at;
  if exists(select 1 from keel_private.decision_operations where project=p_project and state in('prepared','dispatched','uncertain')) then return jsonb_build_object('conflict',true); end if;
  if(select count(*) from keel_private.decision_operations)>=5000 then raise exception 'operation capacity'; end if;
  insert into keel_private.decision_operations(id,scope,project,preview,fence,state,value) values(p_id,p_scope,p_project,p_preview,p_fence,'prepared',p_value) returning * into r;
  created:=true;
 elsif p_operation='read' then
  select * into r from keel_private.decision_operations where id=p_id and scope=p_scope;
 elsif p_operation='dispatched' then
  update keel_private.decision_operations set state='dispatched' where id=p_id and scope=p_scope and fence=p_fence and state='prepared' and lease_until>now_at returning * into r;
 elsif p_operation in('uncertain','committed','refused') then
  update keel_private.decision_operations set state=p_operation,value=p_value where id=p_id and scope=p_scope and fence=p_fence
   and (state in('dispatched','uncertain') or (state='prepared' and p_operation='refused')) returning * into r;
 else raise exception 'unsupported decision operation'; end if;
 if r.id is null then return null; end if;
 return jsonb_build_object('id',r.id,'state',r.state,'value',r.value,'created',created,'leaseUntil',r.lease_until);
end;
$$;
revoke all on function public.keel_decision_rpc(text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.keel_decision_rpc(text,text,text,text,text,text,text) to service_role;
commit;
