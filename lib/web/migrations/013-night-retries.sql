-- Apply after 010. Native reruns and existing workers share one admission lock.
begin;
-- Serialize installer/reapplication DDL and refuse ambiguous partial states.
do $$
begin
 perform pg_advisory_xact_lock(hashtextextended('keel-job-migrations',107));
 if to_regprocedure('keel_private.job_rpc_before_night(text,text,text,jsonb)') is null then
  if to_regclass('keel_private.night_previews') is not null
     or to_regclass('keel_private.night_retries') is not null
     or to_regprocedure('public.keel_night_retry_rpc(text,text,text,jsonb)') is not null then
   raise exception 'incomplete night migration; inspect before recovery';
  end if;
  if to_regprocedure('public.keel_job_rpc(text,text,text,jsonb)') is null
     or to_regclass('keel_private.fleet_records') is null
     or to_regprocedure('public.keel_fleet_rpc(text,text,text,bigint,jsonb)') is null then
   raise exception 'migration013 requires migration010';
  end if;
 elsif to_regclass('keel_private.night_previews') is null
    or to_regclass('keel_private.night_retries') is null
    or to_regprocedure('public.keel_job_rpc(text,text,text,jsonb)') is null
    or to_regprocedure('public.keel_night_retry_rpc(text,text,text,jsonb)') is null then
  raise exception 'incomplete night migration; inspect before recovery';
 end if;
end;
$$;
create table if not exists keel_private.night_previews (
 scope text not null, id text not null, project text not null, actor bigint not null,
 digest text not null, value text not null, expires_at timestamptz not null default clock_timestamp()+interval '15 minutes',
 primary key(scope,id), check(actor>0 and octet_length(value) between 1 and 131072)
);
create table if not exists keel_private.night_retries (
 scope text not null,id text not null,project text not null,actor bigint not null,
 digest text not null,preview text not null,value text not null,
 run_id bigint not null,attempt integer not null,
 state text not null default 'prepared' check(state in('prepared','sending','request-accepted','uncertain','refused','settled')),
 minutes integer not null default 60 check(minutes=60), charged boolean not null default true,
 observation jsonb, accepted_at timestamptz,settled_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 primary key(scope,id),unique(scope,preview),foreign key(scope,preview) references keel_private.night_previews(scope,id),
 check(actor>0 and run_id>0 and attempt between 1 and 50 and octet_length(value) between 1 and 131072)
);
create unique index if not exists night_retry_lane on keel_private.night_retries(scope,project) where state not in('settled','refused');
alter table keel_private.night_previews enable row level security;
alter table keel_private.night_retries enable row level security;
revoke all on keel_private.night_previews,keel_private.night_retries from public,anon,authenticated,service_role;

-- Preserve the existing protocol and implementation, including update workers.
do $$
begin
 -- Never wrap the wrapper or replace the saved migration010 implementation.
 if to_regprocedure('keel_private.job_rpc_before_night(text,text,text,jsonb)') is null then
  alter function public.keel_job_rpc(text,text,text,jsonb) set schema keel_private;
  alter function keel_private.keel_job_rpc(text,text,text,jsonb) rename to job_rpc_before_night;
 end if;
end;
$$;
revoke all on function keel_private.job_rpc_before_night(text,text,text,jsonb) from public,anon,authenticated,service_role;
create or replace function public.keel_job_rpc(p_operation text,p_scope text,p_id text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare extra integer; local_extra integer; result jsonb;
begin
 if p_scope is null or p_scope!~'^[a-f0-9]{64}$' or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'invalid job input';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_scope,104));
 if p_operation in('reserve','budget') then
  select coalesce(sum(minutes),0),coalesce(sum(minutes) filter(where project=p_data->>'project'),0) into extra,local_extra
   from keel_private.night_retries where scope=p_scope and charged and (settled_at is null or settled_at>clock_timestamp()-interval '7 days');
  if p_operation='reserve' and not exists(select 1 from keel_private.jobs where scope=p_scope and id=p_id) then
   if exists(select 1 from keel_private.night_retries where scope=p_scope and project=p_data->>'project' and state not in('settled','refused')) then return jsonb_build_object('conflict','lane');end if;
   if jsonb_typeof(p_data->'workspaceLimit') is distinct from 'number' or jsonb_typeof(p_data->'projectLimit') is distinct from 'number'
    or not coalesce(p_data->>'workspaceLimit'~'^[1-9][0-9]{0,4}$',false) or not coalesce(p_data->>'projectLimit'~'^[1-9][0-9]{0,4}$',false)
    or (p_data->>'workspaceLimit')::integer>10080 or (p_data->>'projectLimit')::integer>10080 then raise exception 'invalid job budget';end if;
   if (p_data->>'workspaceLimit')::integer<=extra or (p_data->>'projectLimit')::integer<=local_extra then return jsonb_build_object('conflict','budget');end if;
   p_data:=p_data||jsonb_build_object('workspaceLimit',(p_data->>'workspaceLimit')::integer-extra,'projectLimit',(p_data->>'projectLimit')::integer-local_extra);
  end if;
 end if;
 result:=keel_private.job_rpc_before_night(p_operation,p_scope,p_id,p_data);
 if p_operation='budget' then result:=jsonb_build_object('workspaceMinutes',(result->>'workspaceMinutes')::integer+extra,'projectMinutes',(result->>'projectMinutes')::integer+local_extra);end if;
 return result;
end;$$;
revoke all on function public.keel_job_rpc(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.keel_job_rpc(text,text,text,jsonb) to service_role;

create or replace function public.keel_night_retry_rpc(p_operation text,p_scope text,p_id text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r keel_private.night_retries%rowtype;p keel_private.night_previews%rowtype;keys text[];k text;used integer;local_used integer;
 changed boolean:=false;granted boolean:=false;at timestamptz:=clock_timestamp();o jsonb;
begin
 if p_scope is null or p_scope!~'^[a-f0-9]{64}$' or p_id is null or p_id!~'^[a-f0-9]{64}$' or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'invalid retry input';end if;
 keys:=case p_operation
  when 'preview-create' then array['project','actor','digest','value']
  when 'preview-read' then array['project','actor'] when 'read' then array['project','actor']
  when 'reserve' then array['project','actor','digest','preview','value','runId','attempt','workspaceLimit','projectLimit']
  when 'send' then array['project','actor'] when 'accepted' then array['project','actor']
  when 'uncertain' then array['project','actor'] when 'refuse' then array['project','actor']
  when 'observe' then array['project','actor','observation'] else null end;
 if keys is null or not(p_data ?& keys) or (select count(*) from jsonb_object_keys(p_data))<>cardinality(keys) then raise exception 'invalid retry operation';end if;
 foreach k in array array['project','digest','preview'] loop
  if p_data?k and (jsonb_typeof(p_data->k) is distinct from 'string' or not coalesce(p_data->>k~'^[a-f0-9]{64}$',false)) then raise exception 'invalid retry identity';end if;
 end loop;
 foreach k in array array['actor','runId','attempt','workspaceLimit','projectLimit'] loop
  if p_data?k and (jsonb_typeof(p_data->k) is distinct from 'number' or not coalesce(p_data->>k~'^[1-9][0-9]{0,15}$',false) or (p_data->>k)::numeric>9007199254740991) then raise exception 'invalid retry number';end if;
 end loop;
 if p_data?'value' and (jsonb_typeof(p_data->'value') is distinct from 'string' or octet_length(p_data->>'value') not between 1 and 131072) then raise exception 'invalid retry value';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_scope,104));
 if p_operation='preview-create' then
  delete from keel_private.night_previews where scope=p_scope and id in(select x.id from keel_private.night_previews x where x.scope=p_scope and x.expires_at<=at and not exists(select 1 from keel_private.night_retries n where n.scope=x.scope and n.preview=x.id) limit 100);
  if(select count(*) from keel_private.night_previews where scope=p_scope)>=10000 then raise exception 'retry capacity';end if;
  insert into keel_private.night_previews(scope,id,project,actor,digest,value) values(p_scope,p_id,p_data->>'project',(p_data->>'actor')::bigint,p_data->>'digest',p_data->>'value') on conflict do nothing returning * into p;
  if p.id is null then return null;end if;
  return jsonb_build_object('preview',to_jsonb(p));
 elsif p_operation='preview-read' then
  select * into p from keel_private.night_previews where scope=p_scope and id=p_id and project=p_data->>'project' and actor=(p_data->>'actor')::bigint and expires_at>at;
  if p.id is null then return null;end if;
  return jsonb_build_object('preview',to_jsonb(p));
 end if;
 select * into r from keel_private.night_retries where scope=p_scope and id=p_id for update;
 if r.id is not null and (r.project<>p_data->>'project' or r.actor<>(p_data->>'actor')::bigint) then return null;end if;
 -- Prepared is the only state known to have no send grant. Its original
 -- preview deadline fences a late sender before releasing this reservation.
 if r.id is not null and r.state='prepared' and not exists(select 1 from keel_private.night_previews v where v.scope=r.scope and v.id=r.preview and v.expires_at>at) then
  update keel_private.night_retries set state='refused',charged=false,updated_at=at where scope=p_scope and id=p_id returning * into r;
 end if;
 if p_operation='reserve' then
  if r.id is not null then
   if r.digest<>p_data->>'digest' or r.preview<>p_data->>'preview' or r.run_id<>(p_data->>'runId')::bigint or r.attempt<>(p_data->>'attempt')::integer then return jsonb_build_object('conflict','identity');end if;
  else
   if (p_data->>'attempt')::numeric>50 or (p_data->>'workspaceLimit')::numeric>10080 or (p_data->>'projectLimit')::numeric>10080 then raise exception 'invalid retry limits';end if;
   select * into p from keel_private.night_previews where scope=p_scope and id=p_data->>'preview' and project=p_data->>'project' and actor=(p_data->>'actor')::bigint and digest=p_data->>'digest' and expires_at>at;
   if p.id is null then return null;end if;
   if exists(select 1 from keel_private.jobs where scope=p_scope and project=p.project and state not in('terminal','refused')) or exists(select 1 from keel_private.night_retries where scope=p_scope and project=p.project and state not in('settled','refused')) then return jsonb_build_object('conflict','lane');end if;
   select coalesce(sum(minutes),0),coalesce(sum(minutes) filter(where project=p.project),0) into used,local_used from (
    select project,minutes from keel_private.jobs where scope=p_scope and charged and (terminal_at is null or terminal_at>at-interval '7 days')
    union all select project,minutes from keel_private.night_retries where scope=p_scope and charged and (settled_at is null or settled_at>at-interval '7 days')) charges;
   if used+60>(p_data->>'workspaceLimit')::integer or local_used+60>(p_data->>'projectLimit')::integer then return jsonb_build_object('conflict','budget');end if;
   if(select count(*) from keel_private.night_retries where scope=p_scope)>=5000 then return jsonb_build_object('conflict','capacity');end if;
   insert into keel_private.night_retries(scope,id,project,actor,digest,preview,value,run_id,attempt) values(p_scope,p_id,p.project,p.actor,p.digest,p.id,p_data->>'value',(p_data->>'runId')::bigint,(p_data->>'attempt')::integer) returning * into r;
   changed:=true;
  end if;
 elsif r.id is null then return null;
 elsif p_operation='read' then null;
 elsif p_operation='send' and r.state='prepared' then r.state:='sending';changed:=true;granted:=true;
 elsif p_operation='accepted' and r.state='sending' then r.state:='request-accepted';r.accepted_at:=at;changed:=true;
 elsif p_operation='uncertain' and r.state='sending' then r.state:='uncertain';changed:=true;
 elsif p_operation='refuse' and r.state='prepared' then r.state:='refused';r.charged:=false;changed:=true;
 elsif p_operation='observe' then
  o:=p_data->'observation';
  if jsonb_typeof(o) is distinct from 'object' or not coalesce(o?&array['runId','attempt','state','conclusion','url','observedAt','attribution'],false) or (select count(*) from jsonb_object_keys(o))<>7
   or jsonb_typeof(o->'runId') is distinct from 'number' or o->'runId' is distinct from to_jsonb(r.run_id)
   or jsonb_typeof(o->'attempt') is distinct from 'number' or not coalesce(o->>'attempt'~'^[1-9][0-9]?$',false) or (o->>'attempt')::integer>51 or (o->>'attempt')::integer<=r.attempt
   or not coalesce(o->>'state'=any(array['queued','requested','waiting','pending','in_progress','completed']),false)
   or not coalesce(o->>'url'~'^https://github.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/actions/runs/[1-9][0-9]*$',false)
   or jsonb_typeof(o->'observedAt') is distinct from 'string' or not coalesce(o->>'observedAt'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T',false)
   or o->'attribution' is distinct from '"unverified"'::jsonb then raise exception 'invalid retry observation';end if;
  perform (o->>'observedAt')::timestamptz;
  if o->>'state'='completed' then
   if not coalesce(o->>'conclusion'=any(array['success','failure','neutral','cancelled','skipped','timed_out','action_required','stale','startup_failure']),false) then raise exception 'invalid retry conclusion';end if;
  elsif o->'conclusion' is distinct from 'null'::jsonb then raise exception 'invalid retry conclusion';end if;
  if r.state in('prepared','refused','settled') then return jsonb_build_object('conflict','state');end if;
  if r.observation is not null and (r.observation->>'attempt')::integer>(o->>'attempt')::integer then return jsonb_build_object('conflict','state');end if;
  r.observation:=o;changed:=true;
  if r.state='request-accepted' and o->>'state'='completed' then r.state:='settled';r.settled_at:=at;end if;
 else return jsonb_build_object('conflict','state');end if;
 if changed then update keel_private.night_retries set state=r.state,charged=r.charged,observation=r.observation,accepted_at=r.accepted_at,settled_at=r.settled_at,updated_at=at where scope=p_scope and id=p_id returning * into r;end if;
 return jsonb_build_object('row',to_jsonb(r),'changed',changed,'granted',granted);
end;$$;
revoke all on function public.keel_night_retry_rpc(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.keel_night_retry_rpc(text,text,text,jsonb) to service_role;
commit;
