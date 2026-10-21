-- Read-only projection over existing encrypted operations. No recovery or purge.
begin;
create index if not exists decision_history_scope on keel_private.decision_operations(scope,project,id);
create or replace function public.keel_run_history(p_scope text,p_project text,p_after text default null,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 r record; cursor_at timestamptz; cursor_id text; rows_out jsonb:='[]'::jsonb;
 bytes_read integer:=0; rows_read integer:=0; more boolean:=false; last_id text:=null;
begin
 if p_scope is null or p_scope!~'^[a-f0-9]{64}$' or p_project is null or p_project!~'^[a-f0-9]{64}$'
 or (p_after is not null and p_after!~'^[a-f0-9]{64}$') or p_limit is null or p_limit<1 or p_limit>20 then
  raise exception 'invalid history input';
 end if;
 if p_after is not null then
  select p.expires_at,o.id into cursor_at,cursor_id
   from keel_private.decision_operations o join keel_private.decision_previews p on p.id=o.preview and p.scope=o.scope
   where o.id=p_after and o.scope=p_scope and o.project=p_project;
  if not found then raise exception 'invalid history cursor'; end if;
 end if;
 for r in
  select o.id,o.state,o.value,o.preview,p.expires_at
   from keel_private.decision_operations o join keel_private.decision_previews p on p.id=o.preview and p.scope=o.scope
   where o.scope=p_scope and o.project=p_project
    and (p_after is null or p.expires_at<cursor_at or (p.expires_at=cursor_at and o.id>cursor_id))
   order by p.expires_at desc,o.id asc limit p_limit+1
 loop
  if rows_read>=p_limit or bytes_read+octet_length(r.value)>2090000 then more:=true; exit; end if;
  rows_out:=rows_out||jsonb_build_array(jsonb_build_object('id',r.id,'state',r.state,'value',r.value,
   'previewId',r.preview,'recordedAt',r.expires_at-interval '15 minutes','timeBasis','inferred-preview-created-at'));
  rows_read:=rows_read+1; bytes_read:=bytes_read+octet_length(r.value); last_id:=r.id;
 end loop;
 return jsonb_build_object('rows',rows_out,'after',case when more then last_id else null end,'hasMore',more);
end;
$$;
revoke all on function public.keel_run_history(text,text,text,integer) from public,anon,authenticated;
grant execute on function public.keel_run_history(text,text,text,integer) to service_role;
commit;
