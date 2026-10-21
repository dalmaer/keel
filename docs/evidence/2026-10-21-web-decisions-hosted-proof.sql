-- Synthetic Acme rows; the inner rollback removes all rows even on success.
-- Run as the migration owner. No GitHub request is made by this SQL proof.
do $proof$
declare
 p1 text:=repeat('1',64); p2 text:=repeat('2',64); p3 text:=repeat('3',64);
 o1 text:=repeat('4',64); o2 text:=repeat('5',64); o3 text:=repeat('6',64);
 scope_key text:=repeat('a',64); other_scope text:=repeat('b',64);
 project_key text:=repeat('c',64); fence_key text:=repeat('d',64); wrong_fence text:=repeat('e',64);
 r jsonb; role_name text; table_name text;
begin
 if exists(select 1 from keel_private.decision_previews where id in(p1,p2,p3))
 or exists(select 1 from keel_private.decision_operations where id in(o1,o2,o3)) then raise exception 'Acme proof keys already present'; end if;
 if (select count(*) from pg_class where oid in('keel_private.decision_previews'::regclass,'keel_private.decision_operations'::regclass) and relrowsecurity)<>2 then raise exception 'RLS absent'; end if;
 begin
  foreach role_name in array array['anon','authenticated','service_role'] loop
   execute format('set local role %I',role_name);
   foreach table_name in array array['decision_previews','decision_operations'] loop
    begin
     execute format('select 1 from keel_private.%I',table_name);
     raise exception 'direct table access unexpectedly allowed';
    exception when insufficient_privilege then null; end;
   end loop;
   if role_name<>'service_role' then
    begin
     perform public.keel_decision_rpc('read',o1,scope_key);
     raise exception 'client RPC unexpectedly allowed';
    exception when insufficient_privilege then null; end;
   end if;
   reset role;
  end loop;
  set local role service_role;
  r:=public.keel_decision_rpc('preview-create',p1,scope_key,p_value=>'Acme immutable preview');
  if r->>'value' is distinct from 'Acme immutable preview' then raise exception 'preview not stored'; end if;
  if public.keel_decision_rpc('preview-create',p1,scope_key,p_value=>'Acme replacement') is not null then raise exception 'preview mutable'; end if;
  if public.keel_decision_rpc('preview-read',p1,other_scope) is not null then raise exception 'preview scope leaked'; end if;
  perform public.keel_decision_rpc('preview-create',p2,scope_key,p_value=>'Acme second preview');
  perform public.keel_decision_rpc('preview-create',p3,scope_key,p_value=>'Acme third preview');
  r:=public.keel_decision_rpc('reserve',o1,scope_key,project_key,p1,fence_key,'Acme intent');
  if r->>'state' is distinct from 'prepared' or r->>'created' is distinct from 'true' then raise exception 'intent not reserved'; end if;
  r:=public.keel_decision_rpc('reserve',o2,scope_key,project_key,p1,wrong_fence,'Acme replay');
  if r->>'id' is distinct from o1 or r->>'created' is distinct from 'false' or r->>'value' is distinct from 'Acme intent' then raise exception 'replay changed original'; end if;
  r:=public.keel_decision_rpc('reserve',o2,scope_key,project_key,p2,fence_key,'Acme second intent');
  if r->>'conflict' is distinct from 'true' then raise exception 'project not reserved'; end if;
  if public.keel_decision_rpc('dispatched',o1,scope_key,p_fence=>wrong_fence) is not null then raise exception 'wrong fence dispatched'; end if;
  reset role;
  update keel_private.decision_operations set lease_until=clock_timestamp()-interval '1 second' where id=o1;
  set local role service_role;
  if public.keel_decision_rpc('dispatched',o1,scope_key,p_fence=>fence_key) is not null then raise exception 'expired worker dispatched'; end if;
  r:=public.keel_decision_rpc('reserve',o2,scope_key,project_key,p2,fence_key,'Acme second intent');
  if r->>'created' is distinct from 'true' then raise exception 'prepared expiry did not free reservation'; end if;
  r:=public.keel_decision_rpc('read',o1,scope_key);
  if r->>'state' is distinct from 'refused' then raise exception 'expired intent not refused'; end if;
  r:=public.keel_decision_rpc('dispatched',o2,scope_key,p_fence=>fence_key);
  if r->>'state' is distinct from 'dispatched' then raise exception 'dispatch not retained'; end if;
  reset role;
  update keel_private.decision_operations set lease_until=clock_timestamp()-interval '1 second' where id=o2;
  set local role service_role;
  r:=public.keel_decision_rpc('reserve',o3,scope_key,project_key,p3,fence_key,'Acme third intent');
  if r->>'conflict' is distinct from 'true' then raise exception 'dispatch expiry freed reservation'; end if;
  r:=public.keel_decision_rpc('uncertain',o2,scope_key,p_fence=>fence_key,p_value=>'Acme uncertain receipt');
  if r->>'state' is distinct from 'uncertain' then raise exception 'uncertainty lost'; end if;
  r:=public.keel_decision_rpc('reserve',o3,scope_key,project_key,p3,fence_key,'Acme third intent');
  if r->>'conflict' is distinct from 'true' then raise exception 'uncertain reservation freed'; end if;
  if public.keel_decision_rpc('read',o2,other_scope) is not null then raise exception 'operation scope leaked'; end if;
  if public.keel_decision_rpc('committed',o2,scope_key,p_fence=>wrong_fence,p_value=>'Acme wrong receipt') is not null then raise exception 'wrong fence committed'; end if;
  r:=public.keel_decision_rpc('committed',o2,scope_key,p_fence=>fence_key,p_value=>'Acme exact receipt');
  if r->>'state' is distinct from 'committed' then raise exception 'receipt not retained'; end if;
  if public.keel_decision_rpc('refused',o2,scope_key,p_fence=>fence_key,p_value=>'Acme overwrite') is not null then raise exception 'terminal receipt mutable'; end if;
  reset role;
  update keel_private.decision_previews set expires_at=clock_timestamp()-interval '1 second' where id=p2;
  set local role service_role;
  if public.keel_decision_rpc('preview-read',p2,scope_key) is not null then raise exception 'expired preview readable'; end if;
  r:=public.keel_decision_rpc('read',o2,scope_key);
  if r->>'value' is distinct from 'Acme exact receipt' then raise exception 'receipt expired with preview'; end if;
  r:=public.keel_decision_rpc('reserve',o3,scope_key,project_key,p3,fence_key,'Acme third intent');
  if r->>'created' is distinct from 'true' then raise exception 'terminal operation kept reservation'; end if;
  reset role;
  raise exception using errcode='P0002',message='Acme proof passed; rollback all synthetic rows';
 exception when no_data_found then null;
 end;
 if exists(select 1 from keel_private.decision_previews where id in(p1,p2,p3))
 or exists(select 1 from keel_private.decision_operations where id in(o1,o2,o3)) then raise exception 'proof rows survived rollback'; end if;
end $proof$;
