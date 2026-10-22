-- Hosted proof: execute statements separately; each A/B pair overlaps on distinct SQL connections.

-- Synthetic Acme records only; 600-second TTL.

select kind, public.keel_web_rpc('create',kind,k,'synthetic-acme-proof',case when kind='attempt' then '58b0a1a69f1fa9334d15466c338a875a47a68dad55056530006001bd5b541846' else null end,case when kind='session' then '123' else null end,600,0) is not null as created from (values ('attempt','7cb736b69fb0ea461b973ae1e5f6c17dfc25186259e984e37b9b0ab8346b5f50'),('record','79042950e63d2480b7e0bcc501c5396684c162a5b92341f97a4305ba21b763ca'),('session','f64517e757daef4e24b2a34804a1917331038e74b5a9786fc0df81622afd80f3')) as v(kind,k);


-- Consume race: A first, then B while A holds its transaction.

with action as materialized (select pg_backend_pid() as pid, transaction_timestamp() as started_at, public.keel_web_rpc('consume','attempt','7cb736b69fb0ea461b973ae1e5f6c17dfc25186259e984e37b9b0ab8346b5f50',null,'58b0a1a69f1fa9334d15466c338a875a47a68dad55056530006001bd5b541846') as result), held as materialized (select pg_sleep(8) from action) select 'consume_A' as probe, pid, started_at, clock_timestamp() as finished_at, result is not null as changed, result->>'version' as version from action cross join held;

with action as materialized (select pg_backend_pid() as pid, transaction_timestamp() as started_at, public.keel_web_rpc('consume','attempt','7cb736b69fb0ea461b973ae1e5f6c17dfc25186259e984e37b9b0ab8346b5f50',null,'58b0a1a69f1fa9334d15466c338a875a47a68dad55056530006001bd5b541846') as result), held as materialized (select pg_sleep(0) from action) select 'consume_B' as probe, pid, started_at, clock_timestamp() as finished_at, result is not null as changed, result->>'version' as version from action cross join held;


-- CAS race:

with action as materialized (select pg_backend_pid() as pid, transaction_timestamp() as started_at, public.keel_web_rpc('cas','record','79042950e63d2480b7e0bcc501c5396684c162a5b92341f97a4305ba21b763ca','synthetic-acme-A',null,null,600,1) as result), held as materialized (select pg_sleep(8) from action) select 'cas_A' as probe, pid, started_at, clock_timestamp() as finished_at, result is not null as changed, result->>'version' as version from action cross join held;

with action as materialized (select pg_backend_pid() as pid, transaction_timestamp() as started_at, public.keel_web_rpc('cas','record','79042950e63d2480b7e0bcc501c5396684c162a5b92341f97a4305ba21b763ca','synthetic-acme-B',null,null,600,1) as result), held as materialized (select pg_sleep(0) from action) select 'cas_B' as probe, pid, started_at, clock_timestamp() as finished_at, result is not null as changed, result->>'version' as version from action cross join held;


-- Renewal and revocation race:

with action as materialized (select pg_backend_pid() as pid, transaction_timestamp() as started_at, public.keel_web_rpc('renew','session','f64517e757daef4e24b2a34804a1917331038e74b5a9786fc0df81622afd80f3',null,null,null,600,1) as result), held as materialized (select pg_sleep(8) from action) select 'renew_A' as probe, pid, started_at, clock_timestamp() as finished_at, result is not null as changed, result->>'version' as version from action cross join held;

with action as materialized (select pg_backend_pid() as pid, transaction_timestamp() as started_at, public.keel_web_rpc('revoke','session','f64517e757daef4e24b2a34804a1917331038e74b5a9786fc0df81622afd80f3') as result), held as materialized (select pg_sleep(0) from action) select 'revoke_B' as probe, pid, started_at, clock_timestamp() as finished_at, result is not null as changed, result->>'version' as version from action cross join held;


-- Four assertions must all return true:

select public.keel_web_rpc('read','attempt','7cb736b69fb0ea461b973ae1e5f6c17dfc25186259e984e37b9b0ab8346b5f50') is null as consumed_attempt_absent, public.keel_web_rpc('read','record','79042950e63d2480b7e0bcc501c5396684c162a5b92341f97a4305ba21b763ca')->>'value' = 'synthetic-acme-A' as winning_value_preserved, public.keel_web_rpc('read','session','f64517e757daef4e24b2a34804a1917331038e74b5a9786fc0df81622afd80f3') is null as revoked_session_absent, public.keel_web_rpc('renew','session','f64517e757daef4e24b2a34804a1917331038e74b5a9786fc0df81622afd80f3',null,null,null,600,1) is null as late_renewal_denied;


-- Role assertions: success only if actual denials occur.

DO $plates_role_proof$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP EXECUTE format('set local role %I',r); BEGIN PERFORM public.keel_web_rpc('read','record','79042950e63d2480b7e0bcc501c5396684c162a5b92341f97a4305ba21b763ca'); RAISE EXCEPTION 'unexpected RPC access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; BEGIN PERFORM 1 FROM keel_private.web_records LIMIT 1; RAISE EXCEPTION 'unexpected table access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; RESET ROLE; END LOOP; SET LOCAL ROLE service_role; IF public.keel_web_rpc('read','record','79042950e63d2480b7e0bcc501c5396684c162a5b92341f97a4305ba21b763ca')->>'value' IS DISTINCT FROM 'synthetic-acme-A' THEN RAISE EXCEPTION 'service RPC failed'; END IF; BEGIN PERFORM 1 FROM keel_private.web_records LIMIT 1; RAISE EXCEPTION 'unexpected service table access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; RESET ROLE; END $plates_role_proof$;


-- Remove only this proof's remaining synthetic row:

with removed as (delete from keel_private.web_records where kind='record' and key='79042950e63d2480b7e0bcc501c5396684c162a5b92341f97a4305ba21b763ca' and value='synthetic-acme-A' returning 1) select count(*) as synthetic_rows_removed from removed;