-- Optional private editor drafts; never source approval or a dispatch queue.
begin;
create sequence if not exists keel_private.editor_draft_generation as bigint minvalue 1 maxvalue 9007199254740991 no cycle;
revoke all on sequence keel_private.editor_draft_generation from public,anon,authenticated,service_role;
create table if not exists keel_private.editor_drafts (
 scope text primary key check(scope ~ '^[a-f0-9]{64}$'),
 revision bigint not null check(revision between 1 and 9007199254740991),
 state text not null check(state in ('empty','saved','expired','deleted')),
 digest text check(digest ~ '^[a-f0-9]{64}$'),
 request text check(request ~ '^[a-f0-9]{64}$'),
 request_digest text check(request_digest ~ '^[a-f0-9]{64}$'),
 value text check(octet_length(value)<=200000),
 saved_at timestamptz not null,
 expires_at timestamptz not null,
 check((state='saved' and value is not null and digest is not null) or (state<>'saved' and value is null and digest is null))
);
alter table keel_private.editor_drafts enable row level security;
revoke all on keel_private.editor_drafts from public,anon,authenticated,service_role;
create or replace function public.keel_editor_draft_rpc(p_operation text,p_scope text,p_expected bigint default null,p_request text default null,p_request_digest text default null,p_digest text default null,p_value text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r keel_private.editor_drafts; stamp timestamptz:=clock_timestamp(); prior bigint:=0;
begin
 if p_operation is null or p_operation not in('read','save','delete') or p_scope is null or p_scope!~'^[a-f0-9]{64}$' then raise exception 'invalid editor input'; end if;
 if p_operation='read' then
  if p_expected is not null or p_request is not null or p_request_digest is not null or p_digest is not null or p_value is not null then raise exception 'invalid editor read'; end if;
 else
  if p_expected is null or p_expected<1 or p_expected>9007199254740991 or p_request is null or p_request!~'^[a-f0-9]{64}$' or p_request_digest is null or p_request_digest!~'^[a-f0-9]{64}$' then raise exception 'invalid editor mutation'; end if;
  if p_operation='save' and (p_digest is null or p_digest!~'^[a-f0-9]{64}$' or p_value is null or octet_length(p_value)>200000) then raise exception 'invalid editor save'; end if;
  if p_operation='delete' and (p_digest is not null or p_value is not null) then raise exception 'invalid editor deletion'; end if;
 end if;
 perform pg_catalog.pg_advisory_xact_lock(21259,12);
 -- Expire abandoned payloads as well as the requested target. No user visit is required.
 update keel_private.editor_drafts set revision=pg_catalog.nextval('keel_private.editor_draft_generation'),state='expired',digest=null,value=null
 where scope in(select scope from keel_private.editor_drafts where state='saved' and expires_at<=stamp limit 100);
 -- Instance-wide1000 rows/50MiB encrypted payload; expired tombstones are bounded garbage.
 delete from keel_private.editor_drafts where scope in(select scope from keel_private.editor_drafts where state<>'saved' and expires_at<=stamp-interval '30 days' limit 100);
 select * into r from keel_private.editor_drafts where scope=p_scope;
 if not found then
  if p_operation<>'read' then return jsonb_build_object('conflict',true); end if;
  if (select count(*) from keel_private.editor_drafts)>=1000 then return jsonb_build_object('capacity',true); end if;
  insert into keel_private.editor_drafts(scope,revision,state,saved_at,expires_at)
  values(p_scope,pg_catalog.nextval('keel_private.editor_draft_generation'),'empty',stamp,stamp+interval '30 days') returning * into r;
 end if;
 -- Expiry is a new generation. Keep its tombstone so an old save cannot resurrect it.
 if found and r.state='saved' and r.expires_at<=stamp then
  update keel_private.editor_drafts set revision=pg_catalog.nextval('keel_private.editor_draft_generation'),state='expired',digest=null,value=null where scope=p_scope returning * into r;
 end if;
 if p_operation<>'read' then
  if r.scope is not null and r.request=p_request then
   if r.request_digest<>p_request_digest then return jsonb_build_object('conflict',true); end if;
   -- Repeated identity can only read its original result, never renew expiry.
  else
   if coalesce(r.revision,0)<>p_expected then return jsonb_build_object('conflict',true); end if;
   if r.scope is null and (select count(*) from keel_private.editor_drafts)>=1000 then return jsonb_build_object('capacity',true); end if;
   prior:=coalesce(octet_length(r.value),0);
   if p_operation='save' and (select coalesce(sum(octet_length(value)),0) from keel_private.editor_drafts)-prior+octet_length(p_value)>52428800 then return jsonb_build_object('capacity',true); end if;
   insert into keel_private.editor_drafts(scope,revision,state,digest,request,request_digest,value,saved_at,expires_at)
   values(p_scope,pg_catalog.nextval('keel_private.editor_draft_generation'),case when p_operation='save' then 'saved' else 'deleted' end,p_digest,p_request,p_request_digest,p_value,stamp,stamp+interval '30 days')
   on conflict(scope) do update set revision=excluded.revision,state=excluded.state,digest=excluded.digest,request=excluded.request,request_digest=excluded.request_digest,value=excluded.value,saved_at=excluded.saved_at,expires_at=excluded.expires_at returning * into r;
  end if;
 end if;
 return jsonb_build_object('revision',r.revision,'state',r.state,'digest',r.digest,'saveId',r.request,'savedAt',to_char(r.saved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'expiresAt',to_char(r.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'value',r.value);
end;
$$;
revoke all on function public.keel_editor_draft_rpc(text,text,bigint,text,text,text,text) from public,anon,authenticated;
grant execute on function public.keel_editor_draft_rpc(text,text,bigint,text,text,text,text) to service_role;
commit;
