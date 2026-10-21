-- Synthetic Acme rows. The inner rollback removes all proof data.
-- Run as migration owner after 001–005. No GitHub request is made.
do $proof$
declare
 draft_id text:=repeat('1',64); other_id text:=repeat('2',64);
 scope_key text:=repeat('a',64); other_scope text:=repeat('b',64);
 project_key text:=repeat('c',64); other_project text:=repeat('d',64);
 preview_id text:=repeat('3',64); operation_id text:=repeat('4',64); fence_key text:=repeat('e',64);
 digest_one text:=repeat('5',64); digest_two text:=repeat('6',64);
 r jsonb; role_name text;
begin
 if exists(select 1 from keel_private.walk_drafts where id in(draft_id,other_id))
 or exists(select 1 from keel_private.decision_previews where id=preview_id)
 or exists(select 1 from keel_private.decision_operations where id=operation_id) then raise exception 'Acme proof keys already present'; end if;
 if not (select relrowsecurity from pg_class where oid='keel_private.walk_drafts'::regclass) then raise exception 'RLS absent'; end if;
 begin
  foreach role_name in array array['anon','authenticated','service_role'] loop
   execute format('set local role %I',role_name);
   begin
    perform 1 from keel_private.walk_drafts;
    raise exception 'direct draft read allowed';
   exception when insufficient_privilege then null; end;
   begin
    insert into keel_private.walk_drafts values(draft_id,scope_key,project_key,1,digest_one,'Acme forbidden');
    raise exception 'direct draft write allowed';
   exception when insufficient_privilege then null; end;
   if role_name<>'service_role' then
    begin
     perform public.keel_walk_rpc('read',draft_id,scope_key,project_key);
     raise exception 'client RPC allowed';
    exception when insufficient_privilege then null; end;
   end if;
   reset role;
  end loop;
  set local role service_role;
  if public.keel_walk_rpc('read',draft_id,scope_key,project_key) is not null then raise exception 'missing draft invented'; end if;
  r:=public.keel_walk_rpc('save',draft_id,scope_key,project_key,0,digest_one,'Acme first encrypted history');
  if r->>'revision' is distinct from '1' or r->>'digest' is distinct from digest_one then raise exception 'first revision lost'; end if;
  if public.keel_walk_rpc('read',draft_id,other_scope,project_key) is not null
  or public.keel_walk_rpc('read',draft_id,scope_key,other_project) is not null then raise exception 'draft scope leaked'; end if;
  r:=public.keel_walk_rpc('save',draft_id,other_scope,project_key,1,digest_two,'Acme wrong actor');
  if r->>'conflict' is distinct from 'true' then raise exception 'wrong actor overwrote draft'; end if;
  r:=public.keel_walk_rpc('save',draft_id,scope_key,other_project,1,digest_two,'Acme wrong project');
  if r->>'conflict' is distinct from 'true' then raise exception 'wrong project overwrote draft'; end if;
  r:=public.keel_walk_rpc('save',draft_id,scope_key,project_key,0,digest_two,'Acme stale tab');
  if r->>'conflict' is distinct from 'true' then raise exception 'stale tab overwrote draft'; end if;
  r:=public.keel_walk_rpc('save',other_id,scope_key,project_key,1,digest_two,'Acme invented revision');
  if r->>'conflict' is distinct from 'true' then raise exception 'missing prior revision accepted'; end if;
  r:=public.keel_walk_rpc('save',draft_id,scope_key,project_key,1,digest_two,'Acme second encrypted history');
  if r->>'revision' is distinct from '2' then raise exception 'CAS update failed'; end if;
  perform public.keel_decision_rpc('preview-create',preview_id,scope_key,p_value=>'Acme walk preview');
  perform public.keel_decision_rpc('reserve',operation_id,scope_key,project_key,preview_id,fence_key,'Acme walk intent');
  r:=public.keel_walk_rpc('save',draft_id,scope_key,project_key,2,digest_one,'Acme racing failure');
  if r->>'blocked' is distinct from 'true' then raise exception 'prepared operation allowed draft mutation'; end if;
  reset role;
  update keel_private.decision_operations set lease_until=clock_timestamp()-interval '1 second' where id=operation_id;
  set local role service_role;
  r:=public.keel_walk_rpc('save',draft_id,scope_key,project_key,2,digest_one,'Acme after expired preparation');
  if r->>'revision' is distinct from '3' then raise exception 'expired undispatched preparation blocked draft'; end if;
  reset role;
  update keel_private.decision_operations set state='dispatched' where id=operation_id;
  set local role service_role;
  r:=public.keel_walk_rpc('save',draft_id,scope_key,project_key,3,digest_two,'Acme after expired dispatch');
  if r->>'blocked' is distinct from 'true' then raise exception 'expired dispatched operation allowed mutation'; end if;
  perform public.keel_decision_rpc('uncertain',operation_id,scope_key,p_fence=>fence_key,p_value=>'Acme uncertain write');
  r:=public.keel_walk_rpc('save',draft_id,scope_key,project_key,3,digest_two,'Acme after uncertainty');
  if r->>'blocked' is distinct from 'true' then raise exception 'uncertain operation allowed mutation'; end if;
  perform public.keel_decision_rpc('committed',operation_id,scope_key,p_fence=>fence_key,p_value=>'Acme exact receipt');
  r:=public.keel_walk_rpc('save',draft_id,scope_key,project_key,3,digest_two,'Acme final encrypted history');
  if r->>'revision' is distinct from '4' then raise exception 'terminal operation blocked draft'; end if;
  r:=public.keel_walk_rpc('read',draft_id,scope_key,project_key);
  if r->>'value' is distinct from 'Acme final encrypted history' or r->>'digest' is distinct from digest_two then raise exception 'current history lost'; end if;
  reset role;
  raise exception using errcode='P0002',message='Acme proof passed; rollback all synthetic rows';
 exception when no_data_found then null;
 end;
 if exists(select 1 from keel_private.walk_drafts where id in(draft_id,other_id))
 or exists(select 1 from keel_private.decision_previews where id=preview_id)
 or exists(select 1 from keel_private.decision_operations where id=operation_id) then raise exception 'proof rows survived rollback'; end if;
end $proof$;
