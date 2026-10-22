-- Model calls have independent monetary accounting; no Actions minute authority.
begin;
create table if not exists keel_private.model_records (
 scope text not null, id text not null, actor bigint not null, project text not null,
 kind text not null check(kind in('preview','quote')), value text not null,
 expires_at timestamptz not null, primary key(scope,id),
 check(scope~'^[a-f0-9]{64}$' and id~'^[a-f0-9]{64}$' and project~'^[a-f0-9]{64}$' and actor>0 and octet_length(value) between 20 and 1048576)
);
create table if not exists keel_private.model_tasks (
 scope text not null,id text not null,actor bigint not null,project text not null,
 allowance bigint not null check(allowance between 1 and 1000000000000),
 primary key(scope,id),check(id~'^[a-f0-9]{64}$')
);
create table if not exists keel_private.model_attempts (
 scope text not null,id text not null,actor bigint not null,project text not null,task text not null,
 stage integer not null check(stage in(1,2)),connection text not null,digest text not null,quote text not null,
 fence text not null,credential jsonb not null,value text not null,result text,version integer not null default 1,
 state text not null default 'reserved' check(state in('reserved','sending','uncertain','queued','in_progress','completed','failed','cancelled','incomplete','refused')),
 response_id text,settled boolean not null default false,ceiling bigint not null,charged bigint not null,cancel_sent boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),terminal_at timestamptz,
 primary key(scope,id),unique(scope,task,stage),
 check(scope~'^[a-f0-9]{64}$' and id~'^[a-f0-9]{64}$' and project~'^[a-f0-9]{64}$' and task~'^[a-f0-9]{64}$' and connection~'^[a-f0-9]{64}$' and digest~'^[a-f0-9]{64}$' and quote~'^[a-f0-9]{64}$' and fence~'^[a-f0-9]{64}$'),
 check(actor>0 and ceiling between 1 and 1000000000000 and charged between 0 and ceiling and version>0),
 check(octet_length(value) between 20 and 1048576 and (result is null or octet_length(result) between 20 and 524288)),
 check(response_id is null or response_id~'^resp_[A-Za-z0-9_-]{1,200}$')
);
create table if not exists keel_private.model_reservations (
 scope text not null,attempt text not null,pool text not null,amount bigint not null check(amount>0),
 primary key(scope,attempt,pool)
);
create table if not exists keel_private.model_cooldowns (
 scope text not null,connection text not null,blocked_until timestamptz not null,observed_at timestamptz not null,primary key(scope,connection)
);
alter table keel_private.model_records enable row level security;
alter table keel_private.model_tasks enable row level security;
alter table keel_private.model_attempts enable row level security;
alter table keel_private.model_reservations enable row level security;
alter table keel_private.model_cooldowns enable row level security;
revoke all on keel_private.model_records,keel_private.model_tasks,keel_private.model_attempts,keel_private.model_reservations,keel_private.model_cooldowns from public,anon,authenticated,service_role;
create or replace function public.keel_model_rpc(p_operation text,p_scope text,p_id text,p_actor bigint,p_project text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r keel_private.model_attempts%rowtype;t keel_private.model_tasks%rowtype;q keel_private.model_records%rowtype;
 keys text[];n timestamptz:=clock_timestamp();w jsonb;used bigint;workspace_used bigint;project_used bigint;connection_used bigint;task_used bigint;
 granted boolean:=false;changed boolean:=false;out_rows jsonb;
begin
 if p_operation is null or p_scope is null or p_scope!~'^[a-f0-9]{64}$' or p_id is null or p_id!~'^[a-f0-9]{64}$' or p_actor is null or p_actor<=0 or p_project is null or p_project!~'^[a-f0-9]{64}$' or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'invalid model input';end if;
 keys:=case p_operation when 'record-create' then array['kind','value'] when 'record-read' then array['kind'] when 'read' then array[]::text[] when 'ledger' then array['task','connection'] when 'list' then array['after']
 when 'reserve' then array['task','stage','connection','digest','quote','fence','value','ceiling','taskLimit','workspaceLimit','projectLimit','connectionLimit','concurrency','windows','credential']
 when 'begin' then array['fence','version'] when 'refuse' then array['fence','version'] when 'cancel' then array['fence','version']
 when 'update' then array['fence','version','state','responseId','result','actual'] when 'cooldown' then array['connection','seconds'] else null end;
 if keys is null or not(p_data ?& keys) or (select count(*) from jsonb_object_keys(p_data))<>cardinality(keys) then raise exception 'invalid model fields';end if;
 for w in select to_jsonb(k) from unnest(array['task','connection','digest','quote','fence'])k loop
  if p_data ? (w#>>'{}') and (jsonb_typeof(p_data->(w#>>'{}')) is distinct from 'string' or not coalesce((p_data->>(w#>>'{}'))~'^[a-f0-9]{64}$',false)) then raise exception 'invalid model identity';end if;
 end loop;
 if p_data ? 'value' and (jsonb_typeof(p_data->'value') is distinct from 'string' or octet_length(p_data->>'value') not between 20 and 1048576) then raise exception 'invalid model value';end if;
 if p_data ? 'version' and (jsonb_typeof(p_data->'version') is distinct from 'number' or not coalesce((p_data->>'version')~'^[1-9][0-9]{0,8}$',false)) then raise exception 'invalid model version';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_scope,106));
 if p_operation in('record-create','record-read') then
  if not coalesce(p_data->>'kind'=any(array['preview','quote']),false) then raise exception 'invalid record kind';end if;
  if p_operation='record-create' then
   delete from keel_private.model_records where scope=p_scope and id in(select x.id from keel_private.model_records x where x.scope=p_scope and x.expires_at<n limit 100);
   if(select count(*) from keel_private.model_records where scope=p_scope)>=10000 then raise exception 'record capacity';end if;
   insert into keel_private.model_records values(p_scope,p_id,p_actor,p_project,p_data->>'kind',p_data->>'value',n+interval '15 minutes') on conflict do nothing returning * into q;
  else select * into q from keel_private.model_records where scope=p_scope and id=p_id and actor=p_actor and project=p_project and kind=p_data->>'kind' and expires_at>n;end if;
  if q.id is null then return null;end if;return to_jsonb(q);
 elsif p_operation='list' then
  if not(p_data->'after'='null'::jsonb or jsonb_typeof(p_data->'after')='string' and (p_data->>'after')~'^[a-f0-9]{64}$') then raise exception 'invalid history cursor';end if;
  if p_data->>'after' is not null and not exists(select 1 from keel_private.model_attempts where scope=p_scope and id=p_data->>'after' and actor=p_actor and project=p_project) then raise exception 'invalid history cursor';end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb) into out_rows from(select id,task,stage,state,ceiling,charged,created_at from keel_private.model_attempts where scope=p_scope and actor=p_actor and project=p_project and (p_data->>'after' is null or (created_at,id)<(select a.created_at,a.id from keel_private.model_attempts a where a.scope=p_scope and a.id=p_data->>'after' and a.actor=p_actor and a.project=p_project)) order by created_at desc,id desc limit 21)x;
  return jsonb_build_object('rows',out_rows);
 elsif p_operation='ledger' then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into out_rows from(select id,project,task,connection,stage,state,ceiling,charged,settled,terminal_at from keel_private.model_attempts where scope=p_scope and (not settled or terminal_at is null or terminal_at>n-interval '7 days' or task=p_data->>'task') order by id limit 5001)x;
  return jsonb_build_object('attempts',out_rows,'cooldowns',(select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) from keel_private.model_cooldowns c where c.scope=p_scope),'reservations',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from keel_private.model_reservations x where x.scope=p_scope));
 elsif p_operation='cooldown' then
  if jsonb_typeof(p_data->'seconds') is distinct from 'number' or not coalesce((p_data->>'seconds')~'^[1-9][0-9]{0,4}$',false) or (p_data->>'seconds')::integer>86400 then raise exception 'invalid cooldown';end if;
  insert into keel_private.model_cooldowns values(p_scope,p_data->>'connection',n+make_interval(secs=>(p_data->>'seconds')::integer),n) on conflict(scope,connection) do update set blocked_until=greatest(keel_private.model_cooldowns.blocked_until,excluded.blocked_until),observed_at=greatest(keel_private.model_cooldowns.observed_at,excluded.observed_at);
  return jsonb_build_object('recorded',true);
 end if;
 select * into r from keel_private.model_attempts where scope=p_scope and id=p_id for update;
 if r.id is not null and (r.actor<>p_actor or r.project<>p_project) then return jsonb_build_object('conflict','identity');end if;
 if p_operation='read' then if r.id is null then return null;end if;return jsonb_build_object('row',to_jsonb(r),'changed',false,'granted',false);end if;
 if p_operation='reserve' then
  if r.id is not null then
   if r.digest<>p_data->>'digest' or r.quote<>p_data->>'quote' or r.task<>p_data->>'task' then return jsonb_build_object('conflict','identity');end if;
   return jsonb_build_object('row',to_jsonb(r),'changed',false,'granted',false);
  end if;
  if not coalesce(p_data->'stage' in('1'::jsonb,'2'::jsonb),false) then raise exception 'invalid stage';end if;
  for w in select to_jsonb(k) from unnest(array['ceiling','taskLimit','workspaceLimit','projectLimit','connectionLimit','concurrency'])k loop
   if jsonb_typeof(p_data->(w#>>'{}')) is distinct from 'number' or not coalesce((p_data->>(w#>>'{}'))~'^[1-9][0-9]{0,12}$',false) or (p_data->>(w#>>'{}'))::bigint>1000000000000 then raise exception 'invalid budget';end if;
  end loop;
  if (p_data->>'concurrency')::integer>20 or (p_data->>'ceiling')::bigint>(p_data->>'taskLimit')::bigint or jsonb_typeof(p_data->'windows') is distinct from 'array' or jsonb_array_length(p_data->'windows')>16 then raise exception 'invalid reservation';end if;
  select * into q from keel_private.model_records where scope=p_scope and id=p_data->>'quote' and actor=p_actor and project=p_project and kind='quote' and expires_at>n;
  if q.id is null then return jsonb_build_object('conflict','quote');end if;
  select * into t from keel_private.model_tasks where scope=p_scope and id=p_data->>'task';
  if t.id is not null and (t.actor<>p_actor or t.project<>p_project or t.allowance<>(p_data->>'taskLimit')::bigint) then return jsonb_build_object('conflict','task');end if;
  if p_data->'stage'='2'::jsonb and (t.id is null or not exists(select 1 from keel_private.model_attempts where scope=p_scope and task=t.id and stage=1 and state='completed' and result is not null)) then return jsonb_build_object('conflict','checkpoint');end if;
  if exists(select 1 from keel_private.model_attempts where scope=p_scope and task=p_data->>'task' and stage=(p_data->>'stage')::integer) then return jsonb_build_object('conflict','stage');end if;
  if exists(select 1 from keel_private.model_attempts where scope=p_scope and project=p_project and terminal_at is null and state<>'refused') or (select count(*) from keel_private.model_attempts where scope=p_scope and terminal_at is null and state<>'refused')>=(p_data->>'concurrency')::integer then return jsonb_build_object('conflict','concurrency');end if;
  if exists(select 1 from keel_private.model_attempts where scope=p_scope and connection=p_data->>'connection' and state in('sending','uncertain')) then return jsonb_build_object('conflict','unresolved-connection');end if;
  if exists(select 1 from keel_private.model_cooldowns where scope=p_scope and connection=p_data->>'connection' and blocked_until>n) then return jsonb_build_object('conflict','cooldown');end if;
  select coalesce(sum(charged),0),coalesce(sum(charged) filter(where project=p_project),0),coalesce(sum(charged) filter(where connection=p_data->>'connection'),0) into workspace_used,project_used,connection_used from keel_private.model_attempts where scope=p_scope and (not settled or terminal_at is null or terminal_at>n-interval '7 days');
  select coalesce(sum(charged),0) into task_used from keel_private.model_attempts where scope=p_scope and task=p_data->>'task';
  if workspace_used+(p_data->>'ceiling')::bigint>(p_data->>'workspaceLimit')::bigint or project_used+(p_data->>'ceiling')::bigint>(p_data->>'projectLimit')::bigint or connection_used+(p_data->>'ceiling')::bigint>(p_data->>'connectionLimit')::bigint or task_used+(p_data->>'ceiling')::bigint>(p_data->>'taskLimit')::bigint then return jsonb_build_object('conflict','budget');end if;
  for w in select * from jsonb_array_elements(p_data->'windows') loop
   if jsonb_typeof(w) is distinct from 'object' or not(w ?& array['pool','amount','available','expiresAt']) or (select count(*) from jsonb_object_keys(w))<>4
    or jsonb_typeof(w->'pool') is distinct from 'string' or not coalesce((w->>'pool')~'^[a-f0-9]{64}$',false)
    or jsonb_typeof(w->'amount') is distinct from 'number' or not coalesce((w->>'amount')~'^[1-9][0-9]{0,12}$',false)
    or jsonb_typeof(w->'available') is distinct from 'number' or not coalesce((w->>'available')~'^(0|[1-9][0-9]{0,12})$',false)
    or jsonb_typeof(w->'expiresAt') is distinct from 'string' then raise exception 'invalid capacity window';end if;
   if (w->>'expiresAt')::timestamptz<=n then return jsonb_build_object('conflict','stale-capacity');end if;
   select coalesce(sum(amount),0) into used from keel_private.model_reservations where scope=p_scope and pool=w->>'pool';
   if used+(w->>'amount')::bigint>(w->>'available')::bigint then return jsonb_build_object('conflict','capacity');end if;
  end loop;
  if(select count(distinct x->>'pool') from jsonb_array_elements(p_data->'windows')x)<>jsonb_array_length(p_data->'windows') then raise exception 'duplicate capacity window';end if;
  if jsonb_typeof(p_data->'credential') is distinct from 'object' or not(p_data->'credential' ?& array['scope','connection','policy','version']) or (select count(*) from jsonb_object_keys(p_data->'credential'))<>4 then raise exception 'invalid credential binding';end if;
  for w in select to_jsonb(k) from unnest(array['scope','connection','policy'])k loop
   if jsonb_typeof(p_data->'credential'->(w#>>'{}')) is distinct from 'string' or not coalesce((p_data->'credential'->>(w#>>'{}'))~'^[a-f0-9]{64}$',false) then raise exception 'invalid credential binding';end if;
  end loop;
  if jsonb_typeof(p_data->'credential'->'version') is distinct from 'number' or not coalesce((p_data->'credential'->>'version')~'^[1-9][0-9]{0,9}$',false) or (p_data->'credential'->>'version')::bigint>2147483647 then raise exception 'invalid credential binding';end if;
  if(select count(*) from keel_private.model_attempts where scope=p_scope)>=5000 then return jsonb_build_object('conflict','storage');end if;
  insert into keel_private.model_tasks values(p_scope,p_data->>'task',p_actor,p_project,(p_data->>'taskLimit')::bigint) on conflict do nothing;
  insert into keel_private.model_attempts(scope,id,actor,project,task,stage,connection,digest,quote,fence,credential,value,ceiling,charged) values(p_scope,p_id,p_actor,p_project,p_data->>'task',(p_data->>'stage')::integer,p_data->>'connection',p_data->>'digest',p_data->>'quote',p_data->>'fence',p_data->'credential',p_data->>'value',(p_data->>'ceiling')::bigint,(p_data->>'ceiling')::bigint) returning * into r;
  insert into keel_private.model_reservations select p_scope,p_id,x->>'pool',(x->>'amount')::bigint from jsonb_array_elements(p_data->'windows')x;
  return jsonb_build_object('row',to_jsonb(r),'changed',true,'granted',false);
 end if;
 if r.id is null then return null;end if;
 if r.fence<>p_data->>'fence' or r.version<>(p_data->>'version')::integer then return jsonb_build_object('conflict','version');end if;
 if p_operation='begin' and r.state='reserved' then
  perform 1 from keel_private.connection_credentials c where c.scope=r.credential->>'scope' and c.connection=r.credential->>'connection' and c.policy=r.credential->>'policy' and c.version=(r.credential->>'version')::bigint and c.state='present' for update;
  if not found then return jsonb_build_object('conflict','credential');end if;
  r.state:='sending';changed:=true;granted:=true;
 elsif p_operation='refuse' and r.state='reserved' then r.state:='refused';r.charged:=0;r.settled:=true;r.terminal_at:=n;changed:=true;delete from keel_private.model_reservations where scope=p_scope and attempt=p_id;
 elsif p_operation='cancel' and r.response_id is not null and r.terminal_at is null and not r.cancel_sent then r.cancel_sent:=true;changed:=true;granted:=true;
 elsif p_operation='update' then
  if not coalesce(p_data->>'state'=any(array['uncertain','queued','in_progress','completed','failed','cancelled','incomplete']),false)
   or not(p_data->'responseId'='null'::jsonb or jsonb_typeof(p_data->'responseId')='string' and (p_data->>'responseId')~'^resp_[A-Za-z0-9_-]{1,200}$')
   or not(p_data->'result'='null'::jsonb or jsonb_typeof(p_data->'result')='string' and octet_length(p_data->>'result') between 20 and 524288)
   or not(p_data->'actual'='null'::jsonb or jsonb_typeof(p_data->'actual')='number' and (p_data->>'actual')~'^(0|[1-9][0-9]{0,12})$') then raise exception 'invalid model result';end if;
  if r.state in('reserved','refused') or r.terminal_at is not null then return jsonb_build_object('conflict','state');end if;
  if r.response_id is not null and r.response_id is distinct from p_data->>'responseId' then return jsonb_build_object('conflict','response');end if;
  if p_data->>'state'<>'uncertain' and p_data->>'responseId' is null then raise exception 'missing response';end if;
  if p_data->>'state'='completed' and p_data->>'result' is null then raise exception 'missing artifact';end if;
  if p_data->>'actual' is not null and ((p_data->>'actual')::bigint>r.ceiling or p_data->>'state' not in('completed','failed','cancelled','incomplete')) then raise exception 'invalid settlement';end if;
  r.state:=p_data->>'state';r.response_id:=p_data->>'responseId';r.result:=p_data->>'result';changed:=true;
  if r.state in('completed','failed','cancelled','incomplete') then r.terminal_at:=n;if p_data->>'actual' is not null then r.charged:=(p_data->>'actual')::bigint;r.settled:=true;end if;end if;
 end if;
 if changed then r.version:=r.version+1;update keel_private.model_attempts set state=r.state,response_id=r.response_id,result=r.result,version=r.version,charged=r.charged,settled=r.settled,cancel_sent=r.cancel_sent,terminal_at=r.terminal_at where scope=p_scope and id=p_id;end if;
 return jsonb_build_object('row',to_jsonb(r),'changed',changed,'granted',granted);
end;$$;
revoke all on function public.keel_model_rpc(text,text,text,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.keel_model_rpc(text,text,text,bigint,text,jsonb) to service_role;
-- Plaintext never crosses RPC: caller decrypts authenticated ciphertext only after fresh authorization.
create or replace function public.keel_model_credential_read(p_scope text,p_connection text,p_policy text,p_expected bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r keel_private.connection_credentials%rowtype;
begin
 if p_scope is null or p_scope!~'^[a-f0-9]{64}$' or p_connection is null or p_connection!~'^[a-f0-9]{64}$' or p_policy is null or p_policy!~'^[a-f0-9]{64}$' or p_expected is null or p_expected<1 or p_expected>2147483647 then raise exception 'invalid credential binding';end if;
 select * into r from keel_private.connection_credentials where scope=p_scope and connection=p_connection;
 if r.version is null or r.state<>'present' or r.version<>p_expected or r.policy<>p_policy then return jsonb_build_object('conflict',true);end if;
 return jsonb_build_object('version',r.version,'policy',r.policy,'value',r.value);
end;$$;
revoke all on function public.keel_model_credential_read(text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.keel_model_credential_read(text,text,text,bigint) to service_role;
commit;
