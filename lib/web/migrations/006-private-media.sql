-- Ciphertext receipts and attachment CAS. Object bytes are managed only by Storage API.
begin;
create table if not exists keel_private.media_receipts(
 id text primary key check(id~'^[a-f0-9]{64}$'),scope text not null check(scope~'^[a-f0-9]{64}$'),project text not null check(project~'^[a-f0-9]{64}$'),
 actor bigint not null check(actor>0),digest text not null check(digest~'^[a-f0-9]{64}$'),
 state text not null check(state in('prepared','uploading','uncertain','verified','deleting','delete-uncertain','deleted')),
 revision bigint not null default 1 check(revision>0),bytes bigint not null check(bytes>0 and bytes<=4194304),value text not null check(octet_length(value)<=65536)
);
create table if not exists keel_private.media_slots(
 scope text not null check(scope~'^[a-f0-9]{64}$'),project text not null check(project~'^[a-f0-9]{64}$'),slot text not null check(slot~'^[a-f0-9]{64}$'),
 requirements text not null check(requirements~'^[a-f0-9]{64}$'),artifact text not null references keel_private.media_receipts(id),revision bigint not null check(revision>0),primary key(scope,project,slot)
);
alter table keel_private.media_receipts enable row level security;
alter table keel_private.media_slots enable row level security;
revoke all on keel_private.media_receipts,keel_private.media_slots from public,anon,authenticated,service_role;
create or replace function public.keel_media_rpc(p_operation text,p_scope text,p_project text,p_actor bigint,p_id text default null,p_expected bigint default null,p_value text default null,p_bytes bigint default null,p_digest text default null,p_slot text default null,p_requirements text default null,p_limit int default 30,p_after text default null,p_capacity bigint default 268435456)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r keel_private.media_receipts;s keel_private.media_slots;created boolean:=false;
begin
 if p_scope is null or p_scope!~'^[a-f0-9]{64}$' or p_project is null or p_project!~'^[a-f0-9]{64}$' or p_actor is null or p_actor<1
 or p_id is not null and p_id!~'^[a-f0-9]{64}$' or p_slot is not null and p_slot!~'^[a-f0-9]{64}$' or p_requirements is not null and p_requirements!~'^[a-f0-9]{64}$'
 or p_digest is not null and p_digest!~'^[a-f0-9]{64}$' or p_after is not null and p_after!~'^[a-f0-9]{64}$'
 or p_limit is null or p_limit<1 or p_limit>31 or p_capacity is null or p_capacity<1 or p_capacity>268435456 then raise exception 'invalid media input';end if;
 if p_operation='list' then
  return coalesce((select jsonb_agg(to_jsonb(q)) from(select id,state,revision,value,digest,actor from keel_private.media_receipts where scope=p_scope and project=p_project and (p_after is null or id>p_after) order by id limit p_limit)q),'[]'::jsonb);
 end if;
 if p_operation='slots' then
  return coalesce((select jsonb_agg(to_jsonb(q)) from(select slot,requirements,artifact,revision from keel_private.media_slots where scope=p_scope and project=p_project order by slot limit 1000)q),'[]'::jsonb);
 end if;
 if p_operation='batch' then
  if p_value is null or octet_length(p_value)>2100 or jsonb_typeof(p_value::jsonb)<>'array' or jsonb_array_length(p_value::jsonb)>30
   or exists(select 1 from jsonb_array_elements(p_value::jsonb) v where jsonb_typeof(v)<>'string' or (v#>>'{}')!~'^[a-f0-9]{64}$') then raise exception 'invalid media batch';end if;
  return coalesce((select jsonb_agg(to_jsonb(q)) from(select id,state,revision,value,digest,actor from keel_private.media_receipts where scope=p_scope and project=p_project and id in(select jsonb_array_elements_text(p_value::jsonb)) order by id)q),'[]'::jsonb);
 end if;
 if p_operation='slot' then
  select * into s from keel_private.media_slots where scope=p_scope and project=p_project and slot=p_slot;
  if not found then return null;end if;return to_jsonb(s);
 end if;
 if p_id is null then raise exception 'missing media identity';end if;
 -- All reservations, attachment changes and lifecycle transitions share one bounded lock.
 if p_operation<>'read' then perform pg_catalog.pg_advisory_xact_lock(21259,9);end if;
 select * into r from keel_private.media_receipts where id=p_id;
 if p_operation='reserve' then
  if p_digest is null or p_value is null or octet_length(p_value)>65536 or p_bytes is null or p_bytes<1 or p_bytes>4194304 then raise exception 'invalid media reservation';end if;
  if found then
   if r.scope<>p_scope or r.project<>p_project or r.actor<>p_actor then return null;end if;
   if r.digest<>p_digest then return jsonb_build_object('conflict',true);end if;
  else
   if (select count(*) from keel_private.media_receipts)>=1000 or (select coalesce(sum(octet_length(value)),0) from keel_private.media_receipts)+octet_length(p_value)>52428800
    or (select coalesce(sum(bytes),0) from keel_private.media_receipts where state<>'deleted')+p_bytes>p_capacity then return jsonb_build_object('capacity',true);end if;
   insert into keel_private.media_receipts(id,scope,project,actor,digest,state,bytes,value) values(p_id,p_scope,p_project,p_actor,p_digest,'prepared',p_bytes,p_value) returning * into r;created:=true;
  end if;
 elsif not found or r.scope<>p_scope or r.project<>p_project then return null;
 elsif p_operation='attach' then
  if r.state<>'verified' or p_slot is null or p_requirements is null or p_expected is null or p_expected<0 then return jsonb_build_object('conflict',true);end if;
  select * into s from keel_private.media_slots where scope=p_scope and project=p_project and slot=p_slot;
  if found and s.artifact=p_id and s.requirements=p_requirements then return to_jsonb(s);end if;
  if found and s.revision<>p_expected or not found and p_expected<>0 then return jsonb_build_object('conflict',true);end if;
  if not found and (select count(*) from keel_private.media_slots)>=1000 then return jsonb_build_object('capacity',true);end if;
  insert into keel_private.media_slots(scope,project,slot,requirements,artifact,revision) values(p_scope,p_project,p_slot,p_requirements,p_id,p_expected+1)
   on conflict(scope,project,slot) do update set requirements=excluded.requirements,artifact=excluded.artifact,revision=excluded.revision returning * into s;
  return to_jsonb(s);
 elsif p_operation<>'read' then
  if p_expected is null or r.revision<>p_expected then return jsonb_build_object('conflict',true);end if;
  if not ((p_operation='uploading' and r.state='prepared' and r.actor=p_actor)
   or(p_operation='uncertain' and r.state='uploading')
   or(p_operation='verified' and r.state in('uploading','uncertain'))
   or(p_operation='deleting' and r.state='verified')
   or(p_operation='delete-uncertain' and r.state='deleting')
   or(p_operation='deleted' and r.state in('deleting','delete-uncertain'))) then return jsonb_build_object('conflict',true);end if;
  update keel_private.media_receipts set state=p_operation,revision=revision+1 where id=p_id returning * into r;
 end if;
 return jsonb_build_object('id',r.id,'state',r.state,'revision',r.revision,'value',r.value,'digest',r.digest,'actor',r.actor,'created',created);
end;
$$;
revoke all on function public.keel_media_rpc(text,text,text,bigint,text,bigint,text,bigint,text,text,text,int,text,bigint) from public,anon,authenticated;
grant execute on function public.keel_media_rpc(text,text,text,bigint,text,bigint,text,bigint,text,text,text,int,text,bigint) to service_role;
commit;
