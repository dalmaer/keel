-- Phase 127: explicit public RPC identities from the canonical names table.
-- Internal schema, tables and migration lock remain unchanged. Apply only after
-- 001–013 with owner approval. No historical migration is rewritten.
begin;
do $migration$
declare
 pair record; permission record; old record; target oid; definition text; forward text; args text;
begin
 perform pg_advisory_xact_lock(hashtextextended('keel-job-migrations',107));
 for pair in select * from (values
    ('keel_model_credential_read', 'plates_model_credential_read'),
    ('keel_web_rpc', 'plates_web_rpc'),
    ('keel_home_cache_rpc', 'plates_home_cache_rpc'),
    ('keel_home_quota_rpc', 'plates_home_quota_rpc'),
    ('keel_home_cursor_rpc', 'plates_home_cursor_rpc'),
    ('keel_decision_rpc', 'plates_decision_rpc'),
    ('keel_walk_rpc', 'plates_walk_rpc'),
    ('keel_media_rpc', 'plates_media_rpc'),
    ('keel_connection_rpc', 'plates_connection_rpc'),
    ('keel_job_rpc', 'plates_job_rpc'),
    ('keel_fleet_rpc', 'plates_fleet_rpc'),
    ('keel_model_rpc', 'plates_model_rpc'),
    ('keel_editor_draft_rpc', 'plates_editor_draft_rpc'),
    ('keel_night_retry_rpc', 'plates_night_retry_rpc'),
    ('keel_run_history', 'plates_run_history')
 ) as names(legacy,current) loop
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=pair.legacy) <> 1 then
   raise exception 'missing or overloaded source RPC: %', pair.legacy;
  end if;
  select p.* into strict old from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname=pair.legacy;
  if old.prorettype <> 'jsonb'::regtype or old.proretset or not old.prosecdef then
   raise exception 'unexpected source contract: %', pair.legacy;
  end if;
  select string_agg(format('$%s',i),', ' order by i) into args from generate_series(1,old.pronargs) i;
  forward := format('SELECT public.%I(%s)',pair.current,args);
  target := to_regprocedure(format('public.%I(%s)',pair.current,oidvectortypes(old.proargtypes)));
  if target is not null then
   if old.prosrc <> forward then raise exception 'ambiguous existing target: %',pair.current; end if;
   continue;
  end if;
  if old.prosrc = forward then raise exception 'missing forwarding target: %', pair.current; end if;
  definition := pg_get_functiondef(old.oid);
  -- Only the declared function name changes; its body, defaults, security and
  -- configuration are copied verbatim, including private implementation calls.
  definition := overlay(definition placing format('CREATE OR REPLACE FUNCTION public.%I(',pair.current)
    from 1 for length(format('CREATE OR REPLACE FUNCTION public.%I(',pair.legacy)));
  execute definition;
  target := to_regprocedure(format('public.%I(%s)',pair.current,oidvectortypes(old.proargtypes)));
  execute format('ALTER FUNCTION public.%I(%s) OWNER TO %I',pair.current,pg_get_function_identity_arguments(old.oid),pg_get_userbyid(old.proowner));
  -- Remove default-privilege grants too, then reproduce the source ACL exactly.
  for permission in select distinct grantee from pg_proc p,
    lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=target loop
   execute format('REVOKE ALL ON FUNCTION public.%I(%s) FROM %s',pair.current,pg_get_function_identity_arguments(old.oid),
     case when permission.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(permission.grantee)) end);
  end loop;
  for permission in select * from aclexplode(coalesce(old.proacl,acldefault('f',old.proowner))) loop
   execute format('GRANT %s ON FUNCTION public.%I(%s) TO %s%s',permission.privilege_type,pair.current,pg_get_function_identity_arguments(old.oid),
     case when permission.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(permission.grantee)) end,
     case when permission.is_grantable then ' WITH GRANT OPTION' else '' end);
  end loop;
  execute format('CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = %L AS %L',
   pair.legacy,pg_get_function_arguments(old.oid),'',forward);
 end loop;
end;
$migration$;
commit;
