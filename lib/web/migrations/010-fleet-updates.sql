-- Shared admission retains its existing scope, lanes and conservative charges.
begin;
-- A later migration owns the public admission wrapper. Replaying this body
-- would silently remove its lane and budget checks; refuse before any DDL.
do $$
begin
 perform pg_advisory_xact_lock(hashtextextended('keel-job-migrations',107));
 if to_regprocedure('keel_private.job_rpc_before_night(text,text,text,jsonb)') is not null
    or to_regclass('keel_private.night_previews') is not null
    or to_regclass('keel_private.night_retries') is not null
    or to_regprocedure('public.keel_night_retry_rpc(text,text,text,jsonb)') is not null then
  raise exception 'migration013 owns job admission; reapply013 instead of009/010';
 end if;
end;
$$;
create or replace function public.keel_job_rpc(p_operation text,p_scope text,p_id text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 r keel_private.jobs%rowtype; p keel_private.job_previews%rowtype; keys text[]; now_at timestamptz:=clock_timestamp();
 changed boolean:=false; granted boolean:=false; rows_out jsonb; used integer; local_used integer; more boolean; last_id text;
begin
 if p_operation is null or p_scope is null or p_scope!~'^[a-f0-9]{64}$' or p_id is null or p_id!~'^[a-f0-9]{64}$' or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'invalid job input'; end if;
 keys:=case p_operation
  when 'preview-create' then array['project','actor','digest','value'] when 'preview-read' then array[]::text[]
  when 'reserve' then array['project','actor','digest','preview','value','minutes','workspaceLimit','projectLimit']
  when 'read' then array[]::text[] when 'list' then array['project','after'] when 'budget' then array['project']
  when 'dispatch' then array[]::text[] when 'uncertain' then array[]::text[] when 'refuse' then array[]::text[]
  when 'pin' then array['runId'] when 'observe' then array['provider'] when 'cancel' then array[]::text[] when 'cancel-dispatch' then array[]::text[]
  when 'claim' then array['runId','jobId','nonce','fence','deadline'] when 'begin' then array['runId','jobId','nonce','fence']
  when 'heartbeat' then array['runId','jobId','nonce','fence','sequence'] when 'complete' then array['runId','jobId','nonce','fence','sequence','result'] else null end;
 if keys is null or not(p_data ?& keys) or (select count(*) from jsonb_object_keys(p_data))<>cardinality(keys) then raise exception 'invalid job operation'; end if;
 if p_data ? 'project' and (jsonb_typeof(p_data->'project')<>'string' or (p_data->>'project')!~'^[a-f0-9]{64}$') then raise exception 'invalid project'; end if;
 if p_data ? 'actor' and (jsonb_typeof(p_data->'actor')<>'number' or (p_data->>'actor')!~'^[1-9][0-9]{0,15}$') then raise exception 'invalid actor'; end if;
 if p_data ? 'digest' and (jsonb_typeof(p_data->'digest')<>'string' or (p_data->>'digest')!~'^[a-f0-9]{64}$') then raise exception 'invalid digest'; end if;
 if p_data ? 'preview' and (jsonb_typeof(p_data->'preview') is distinct from 'string' or not coalesce((p_data->>'preview')~'^[a-f0-9]{64}$',false)) then raise exception 'invalid preview'; end if;
 if p_data ? 'value' and (jsonb_typeof(p_data->'value')<>'string' or octet_length(p_data->>'value') not between 1 and 131072) then raise exception 'invalid value'; end if;
 if p_operation='preview-create' then
  perform pg_advisory_xact_lock(hashtextextended(p_scope,104));
  delete from keel_private.job_previews where scope=p_scope and id in(select v.id from keel_private.job_previews v where v.scope=p_scope and v.expires_at<=now_at and not exists(select 1 from keel_private.jobs j where j.scope=v.scope and j.preview=v.id) limit 100);
  if (select count(*) from keel_private.job_previews where scope=p_scope)>=10000 then raise exception 'preview capacity'; end if;
  insert into keel_private.job_previews(scope,id,project,actor,digest,value) values(p_scope,p_id,p_data->>'project',(p_data->>'actor')::bigint,p_data->>'digest',p_data->>'value') on conflict do nothing returning * into p;
  if p.id is null then return null; end if;
  return jsonb_build_object('preview',to_jsonb(p));
 elsif p_operation='preview-read' then
  select * into p from keel_private.job_previews where scope=p_scope and id=p_id and expires_at>now_at;
  if p.id is null then return null; end if;
  return jsonb_build_object('preview',to_jsonb(p));
 elsif p_operation in('reserve','budget','list') then
  perform pg_advisory_xact_lock(hashtextextended(p_scope,104));
  if p_operation='list' then
   if p_data->'after'<>'null'::jsonb and (jsonb_typeof(p_data->'after')<>'string' or (p_data->>'after')!~'^[a-f0-9]{64}$') then raise exception 'invalid cursor'; end if;
   select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) into rows_out from(select * from keel_private.jobs where scope=p_scope and project=p_data->>'project' and (p_data->>'after' is null or id>p_data->>'after') order by id limit 21)x;
   more:=jsonb_array_length(rows_out)>20;
   if more then rows_out:=rows_out-20;last_id:=rows_out->19->>'id';end if;
   return jsonb_build_object('rows',rows_out,'after',last_id,'hasMore',more);
  end if;
  select coalesce(sum(minutes),0),coalesce(sum(minutes) filter(where project=p_data->>'project'),0) into used,local_used from keel_private.jobs where scope=p_scope and charged and (terminal_at is null or terminal_at>now_at-interval '7 days');
  if p_operation='budget' then return jsonb_build_object('workspaceMinutes',used,'projectMinutes',local_used); end if;
  select * into r from keel_private.jobs where scope=p_scope and id=p_id;
  if r.id is not null then
   if r.project<>p_data->>'project' or r.actor<>(p_data->>'actor')::bigint or r.digest<>p_data->>'digest' or r.preview<>p_data->>'preview' then return jsonb_build_object('conflict','identity');end if;
   return jsonb_build_object('row',to_jsonb(r),'changed',false,'granted',false);
  end if;
  if (p_data->>'preview')!~'^[a-f0-9]{64}$' or jsonb_typeof(p_data->'minutes')<>'number' or (p_data->>'minutes')!~'^[1-9][0-9]?$' or (p_data->>'minutes')::integer>60
    or jsonb_typeof(p_data->'workspaceLimit')<>'number' or (p_data->>'workspaceLimit')!~'^[1-9][0-9]{0,4}$' or (p_data->>'workspaceLimit')::integer>10080
    or jsonb_typeof(p_data->'projectLimit')<>'number' or (p_data->>'projectLimit')!~'^[1-9][0-9]{0,4}$' or (p_data->>'projectLimit')::integer>10080 then raise exception 'invalid budget';end if;
  select * into p from keel_private.job_previews where scope=p_scope and id=p_data->>'preview' and project=p_data->>'project' and actor=(p_data->>'actor')::bigint and digest=p_data->>'digest' and expires_at>now_at;
  if p.id is null then return null;end if;
  if exists(select 1 from keel_private.jobs where scope=p_scope and project=p_data->>'project' and state not in('terminal','refused')) then return jsonb_build_object('conflict','lane');end if;
  if used+(p_data->>'minutes')::integer>(p_data->>'workspaceLimit')::integer or local_used+(p_data->>'minutes')::integer>(p_data->>'projectLimit')::integer then return jsonb_build_object('conflict','budget');end if;
  if(select count(*) from keel_private.jobs where scope=p_scope)>=5000 then return jsonb_build_object('conflict','capacity');end if;
  insert into keel_private.jobs(scope,id,project,actor,digest,preview,value,minutes) values(p_scope,p_id,p_data->>'project',(p_data->>'actor')::bigint,p_data->>'digest',p_data->>'preview',p_data->>'value',(p_data->>'minutes')::integer) returning * into r;
  changed:=true;
 else
  select * into r from keel_private.jobs where scope=p_scope and id=p_id for update;
  if r.id is null then return null; end if;
  if p_operation='read' then return jsonb_build_object('row',to_jsonb(r),'changed',false,'granted',false); end if;
  if p_operation='dispatch' and r.state='prepared' and not r.cancel_requested then r.state:='dispatching';changed:=true;granted:=true;
  elsif p_operation='refuse' and r.state='prepared' then r.state:='refused';r.charged:=false;changed:=true;
  elsif p_operation='uncertain' and r.state='dispatching' and r.run_id is null then r.state:='uncertain';changed:=true;
  elsif p_operation='pin' then
   if jsonb_typeof(p_data->'runId')<>'number' or (p_data->>'runId')!~'^[1-9][0-9]{0,15}$' then raise exception 'invalid run';end if;
   if r.state not in('prepared','refused','terminal') and (r.run_id is null or r.run_id=(p_data->>'runId')::bigint) then r.run_id:=(p_data->>'runId')::bigint;changed:=true;else return jsonb_build_object('conflict','identity');end if;
  elsif p_operation='observe' then
   if jsonb_typeof(p_data->'provider') is distinct from 'object'
    or not coalesce(p_data->'provider' ?& array['runId','attempt','state','conclusion','url','createdAt','updatedAt','observedAt'],false)
    or (select count(*) from jsonb_object_keys(p_data->'provider'))<>8
    or jsonb_typeof(p_data->'provider'->'runId') is distinct from 'number'
    or not coalesce((p_data->'provider'->>'runId')~'^[1-9][0-9]{0,15}$',false)
    or p_data->'provider'->'attempt' is distinct from '1'::jsonb
    or not coalesce(p_data->'provider'->>'state'=any(array['queued','requested','waiting','pending','in_progress','completed']),false)
    or jsonb_typeof(p_data->'provider'->'url') is distinct from 'string'
    or not coalesce((p_data->'provider'->>'url')~'^https://github.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/actions/runs/[1-9][0-9]*$',false)
    or not coalesce((p_data->'provider'->>'createdAt')~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T',false)
    or not coalesce((p_data->'provider'->>'updatedAt')~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T',false)
    or not coalesce((p_data->'provider'->>'observedAt')~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T',false)
    or octet_length((p_data->'provider')::text)>4096 then raise exception 'invalid provider observation';end if;
   perform (p_data->'provider'->>'createdAt')::timestamptz,(p_data->'provider'->>'updatedAt')::timestamptz,(p_data->'provider'->>'observedAt')::timestamptz;
   if p_data->'provider'->>'state'='completed' then
    if not coalesce(p_data->'provider'->>'conclusion'=any(array['success','failure','neutral','cancelled','skipped','timed_out','action_required','stale','startup_failure']),false) then raise exception 'invalid terminal observation';end if;
   elsif p_data->'provider'->'conclusion' is distinct from 'null'::jsonb then raise exception 'invalid nonterminal observation';end if;
   if r.state in('prepared','refused') or r.run_id is not null and r.run_id<>(p_data->'provider'->>'runId')::bigint then return jsonb_build_object('conflict','identity');end if;
   if r.state='terminal' then return jsonb_build_object('row',to_jsonb(r),'changed',false,'granted',false);end if;
   r.run_id:=(p_data->'provider'->>'runId')::bigint;r.provider:=p_data->'provider';changed:=true;
   if r.provider->>'state'='completed' then r.state:='terminal';r.terminal_at:=now_at;
   elsif r.state in('dispatching','uncertain') then r.state:='queued';end if;
  elsif p_operation='cancel' then
   if r.state not in('terminal','refused') then r.cancel_requested:=true;changed:=true;
    if r.state='prepared' then r.state:='refused';r.charged:=false;end if;
   end if;
  elsif p_operation='cancel-dispatch' then
   if r.cancel_requested and not r.cancel_dispatched and r.run_id is not null and r.state not in('terminal','refused','prepared') then r.cancel_dispatched:=true;changed:=true;granted:=true;end if;
  elsif p_operation in('claim','begin','heartbeat','complete') then
   if jsonb_typeof(p_data->'runId')<>'number' or (p_data->>'runId')!~'^[1-9][0-9]{0,15}$' or jsonb_typeof(p_data->'jobId')<>'number' or (p_data->>'jobId')!~'^[1-9][0-9]{0,15}$'
    or jsonb_typeof(p_data->'nonce')<>'string' or (p_data->>'nonce')!~'^[a-f0-9]{64}$' or jsonb_typeof(p_data->'fence')<>'number' or (p_data->>'fence')!~'^[1-9][0-9]{0,15}$' or (p_data->>'fence')::bigint>9007199254740991 then raise exception 'invalid worker identity';end if;
   if r.cancel_requested or r.state in('prepared','terminal','refused') or r.run_id is not null and r.run_id<>(p_data->>'runId')::bigint then return jsonb_build_object('conflict','state');end if;
   if p_operation='claim' then
    if jsonb_typeof(p_data->'deadline')<>'number' or (p_data->>'deadline')!~'^[1-9][0-9]{12,15}$' then raise exception 'invalid deadline';end if;
    if r.nonce is not null then
     if r.nonce<>p_data->>'nonce' or r.run_id<>(p_data->>'runId')::bigint or r.job_id<>(p_data->>'jobId')::bigint then return jsonb_build_object('conflict','identity');end if;
     return jsonb_build_object('row',to_jsonb(r),'changed',false,'granted',false);
    end if;
    if r.state not in('dispatching','uncertain','queued') then return jsonb_build_object('conflict','state');end if;
    r.deadline:=to_timestamp((p_data->>'deadline')::double precision/1000);
    if r.deadline<=now_at or r.deadline>now_at+make_interval(mins=>r.minutes) then return jsonb_build_object('conflict','state');end if;
    r.run_id:=(p_data->>'runId')::bigint;r.job_id:=(p_data->>'jobId')::bigint;r.nonce:=p_data->>'nonce';r.fence:=(p_data->>'fence')::bigint;r.lease_until:=least(r.deadline,now_at+interval '60 seconds');r.state:='claimed';changed:=true;
   else
    if r.nonce is null or r.nonce<>p_data->>'nonce' or r.fence<>(p_data->>'fence')::bigint or r.run_id<>(p_data->>'runId')::bigint or r.job_id<>(p_data->>'jobId')::bigint or r.deadline is null or r.lease_until is null or r.deadline<=now_at or r.lease_until<=now_at then return jsonb_build_object('conflict','state');end if;
    if p_operation='begin' then
     if r.state<>'claimed' then return jsonb_build_object('conflict','state');end if;
     r.state:='running';changed:=true;granted:=true;
    else
     if r.state<>'running' or jsonb_typeof(p_data->'sequence')<>'number' or (p_data->>'sequence')!~'^[1-9][0-9]{0,8}$' or (p_data->>'sequence')::integer<>r.sequence+1 then return jsonb_build_object('conflict','state');end if;
     r.sequence:=(p_data->>'sequence')::integer;changed:=true;
     if p_operation='heartbeat' then r.lease_until:=least(r.deadline,now_at+interval '60 seconds');
     else
      if jsonb_typeof(p_data->'result')<>'object' or not(p_data->'result' ?& array['state','exitCode']) or (select count(*) from jsonb_object_keys(p_data->'result'))<>2 or jsonb_typeof(p_data->'result'->'state') is distinct from 'string' or not coalesce(p_data->'result'->>'state'=any(array['succeeded','failed','cancelled']),false) or not(p_data->'result'->'exitCode'='null'::jsonb or jsonb_typeof(p_data->'result'->'exitCode')='number' and (p_data->'result'->>'exitCode')~'^[0-9]{1,3}$' and (p_data->'result'->>'exitCode')::integer<=255) then raise exception 'invalid worker result';end if;
      if p_data->'result'->>'state'='succeeded' and p_data->'result'->'exitCode' is distinct from '0'::jsonb then raise exception 'invalid success result';end if;
      r.worker_result:=p_data->'result';r.state:='worker-complete';
     end if;
    end if;
   end if;
  else return jsonb_build_object('conflict','state');end if;
  if changed then
   update keel_private.jobs set state=r.state,charged=r.charged,run_id=r.run_id,job_id=r.job_id,nonce=r.nonce,fence=r.fence,deadline=r.deadline,lease_until=r.lease_until,sequence=r.sequence,worker_result=r.worker_result,provider=r.provider,cancel_requested=r.cancel_requested,cancel_dispatched=r.cancel_dispatched,terminal_at=r.terminal_at,updated_at=now_at where scope=p_scope and id=p_id returning * into r;
  end if;
 end if;
 return jsonb_build_object('row',to_jsonb(r),'changed',changed,'granted',granted);
end;
$$;
revoke all on function public.keel_job_rpc(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.keel_job_rpc(text,text,text,jsonb) to service_role;

create table if not exists keel_private.fleet_records(
 scope text not null,id text not null,actor bigint not null,project text,kind text not null,
 state text not null,version integer not null default 1,digest text not null,value text not null,
 stage integer not null default 0,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 primary key(scope,id),check(scope~'^[a-f0-9]{64}$' and id~'^[a-f0-9]{64}$' and digest~'^[a-f0-9]{64}$'),
 check(actor>0 and (project is null or project~'^[a-f0-9]{64}$')),check(kind in('rollout','preview','artifact','publication','preparation')),
 check(state in('ready','dispatched','uncertain','committed','stopped')),check(version between 1 and 2147483647),
 check(stage between 0 and 2500),check(octet_length(value) between 1 and 3145728)
);
alter table keel_private.fleet_records enable row level security;
revoke all on keel_private.fleet_records from public,anon,authenticated,service_role;
create or replace function public.keel_fleet_rpc(p_operation text,p_scope text,p_id text,p_actor bigint,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r keel_private.fleet_records%rowtype;j keel_private.jobs%rowtype;keys text[];changed boolean:=false;now_at timestamptz:=clock_timestamp();
begin
 if p_operation is null or p_scope is null or p_scope!~'^[a-f0-9]{64}$' or p_id is null or p_id!~'^[a-f0-9]{64}$' or p_actor is null or p_actor<1 or p_data is null or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'invalid fleet input';end if;
 keys:=case p_operation when 'read' then array[]::text[] when 'create' then array['kind','project','digest','value'] when 'output' then array['project','digest','value','operationId','runId','jobId','nonce','fence'] when 'cas' then array['version','state','stage','value'] else null end;
 if keys is null or not(p_data ?& keys) or (select count(*) from jsonb_object_keys(p_data))<>cardinality(keys) then raise exception 'invalid fleet operation';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_scope,105));
 select * into r from keel_private.fleet_records where scope=p_scope and id=p_id for update;
 if r.id is not null and r.actor<>p_actor then return null;end if;
 if p_operation='read' then if r.id is null then return null;end if;return jsonb_build_object('row',to_jsonb(r),'changed',false);end if;
 if jsonb_typeof(p_data->'value') is distinct from 'string' or octet_length(p_data->>'value') not between 1 and 3145728 then raise exception 'invalid fleet value';end if;
 if p_operation in('create','output') then
  if jsonb_typeof(p_data->'digest') is distinct from 'string' or not coalesce((p_data->>'digest')~'^[a-f0-9]{64}$',false) or not(p_data->'project'='null'::jsonb or jsonb_typeof(p_data->'project')='string' and (p_data->>'project')~'^[a-f0-9]{64}$') then raise exception 'invalid fleet identity';end if;
  if p_operation='create' and (jsonb_typeof(p_data->'kind') is distinct from 'string' or not coalesce(p_data->>'kind'=any(array['rollout','preview','publication','preparation']),false)) then raise exception 'invalid fleet kind';end if;
  if p_operation='output' then
   if jsonb_typeof(p_data->'project') is distinct from 'string' then raise exception 'invalid output project';end if;
   if jsonb_typeof(p_data->'operationId') is distinct from 'string' or not coalesce((p_data->>'operationId')~'^[a-f0-9]{64}$',false) or jsonb_typeof(p_data->'runId') is distinct from 'number' or not coalesce((p_data->>'runId')~'^[1-9][0-9]{0,15}$',false) or jsonb_typeof(p_data->'jobId') is distinct from 'number' or not coalesce((p_data->>'jobId')~'^[1-9][0-9]{0,15}$',false) or jsonb_typeof(p_data->'fence') is distinct from 'number' or not coalesce((p_data->>'fence')~'^[1-9][0-9]{0,15}$',false) or jsonb_typeof(p_data->'nonce') is distinct from 'string' or not coalesce((p_data->>'nonce')~'^[a-f0-9]{64}$',false) then raise exception 'invalid output fence';end if;
   select * into j from keel_private.jobs where scope=p_scope and id=p_data->>'operationId' for update;
   if j.id is null or j.actor<>p_actor or j.project is distinct from p_data->>'project' or j.run_id is distinct from (p_data->>'runId')::bigint or j.job_id is distinct from (p_data->>'jobId')::bigint or j.fence is distinct from (p_data->>'fence')::bigint or j.nonce is distinct from p_data->>'nonce' then return jsonb_build_object('conflict','identity');end if;
   if r.id is null and (j.state<>'running' or j.cancel_requested or j.deadline<=now_at or j.lease_until<=now_at or j.deadline is null or j.lease_until is null) then return jsonb_build_object('conflict','state');end if;
  end if;
  if r.id is not null then
   if r.digest<>p_data->>'digest' or r.project is distinct from p_data->>'project' or r.kind<>(case when p_operation='output' then 'artifact' else p_data->>'kind' end) then return jsonb_build_object('conflict','identity');end if;
   return jsonb_build_object('row',to_jsonb(r),'changed',false);
  end if;
  if (select count(*) from keel_private.fleet_records where scope=p_scope)>=1000 then return jsonb_build_object('conflict','capacity');end if;
  insert into keel_private.fleet_records(scope,id,actor,project,kind,state,digest,value) values(p_scope,p_id,p_actor,p_data->>'project',case when p_operation='output' then 'artifact' else p_data->>'kind' end,'ready',p_data->>'digest',p_data->>'value') returning * into r;changed:=true;
 else
  if jsonb_typeof(p_data->'version') is distinct from 'number' or not coalesce((p_data->>'version')~'^[1-9][0-9]{0,9}$',false) or jsonb_typeof(p_data->'stage') is distinct from 'number' or not coalesce((p_data->>'stage')~'^[0-9]{1,4}$',false) or (p_data->>'stage')::integer>2500 or jsonb_typeof(p_data->'state') is distinct from 'string' or not coalesce(p_data->>'state'=any(array['ready','dispatched','uncertain','committed','stopped']),false) then raise exception 'invalid fleet transition';end if;
  if r.id is null then return null;end if;
  if r.version<>(p_data->>'version')::bigint or r.version>=2147483647 or r.kind in('artifact','preview') or r.state in('committed','stopped') then return jsonb_build_object('conflict','state');end if;
  if r.kind='publication' and not (
   r.state='ready' and p_data->>'state'='dispatched' and (p_data->>'stage')::integer=r.stage
   or r.state in('dispatched','uncertain') and p_data->>'state' in('ready','committed') and (p_data->>'stage')::integer=r.stage+1
   or r.state='dispatched' and p_data->>'state'='uncertain' and (p_data->>'stage')::integer=r.stage
  ) then return jsonb_build_object('conflict','state');end if;
  if r.kind in('rollout','preparation') and (p_data->>'state' not in('ready','stopped') or (p_data->>'stage')::integer<>0) then return jsonb_build_object('conflict','state');end if;
  update keel_private.fleet_records set value=p_data->>'value',state=p_data->>'state',stage=(p_data->>'stage')::integer,version=version+1,updated_at=now_at where scope=p_scope and id=p_id returning * into r;changed:=true;
 end if;
 return jsonb_build_object('row',to_jsonb(r),'changed',changed);
end;$$;
revoke all on function public.keel_fleet_rpc(text,text,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.keel_fleet_rpc(text,text,text,bigint,jsonb) to service_role;
commit;
