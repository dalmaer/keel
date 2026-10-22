import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {decisionHarness,healthTarget,token} from '../../tests/helpers/web-decisions.mjs';
import {createDecisions} from '../../lib/web/decisions.mjs';
import {createOperations} from '../../lib/web/operations.mjs';
import {createWebService} from '../../lib/web/server.mjs';

// Actual SQL001/004, logical JSON snapshot and independent restored database.
// GitHub is synthetic. This does not prove hosted concurrency, provider backups,
// completeness of a historical snapshot, or an operator's real restore audit.
if (!process.env.KEEL_SQL_PROOF_MODULE) throw Error('Set KEEL_SQL_PROOF_MODULE to an absolute PGlite module path.');
const {PGlite}=await import(process.env.KEEL_SQL_PROOF_MODULE);
const databases=[],h=decisionHarness();
async function database() {
 const db=new PGlite();databases.push(db);
 await db.exec('create role anon; create role authenticated; create role service_role;');
 for(const file of ['001-auth.sql','004-decision-operations.sql'])await db.exec(await readFile(new URL('../../lib/web/migrations/'+file,import.meta.url),'utf8'));
 return db;
}
const tables=['web_records','decision_previews','decision_operations'];
async function snapshot(db) {
 await db.exec('reset role');
 const rows={};for(const table of tables)rows[table]=(await db.query('select * from keel_private.'+table)).rows;
 return JSON.parse(JSON.stringify(rows));
}
function fetchFor(db) {return async(url,options={})=>{
 const rpc=new URL(url).pathname.match(/^\/rest\/v1\/rpc\/(keel_web_rpc|keel_decision_rpc)$/);
 if(!rpc)return h.fetcher(url,options);
 const args=JSON.parse(options.body),keys=Object.keys(args);assert.ok(keys.every(k=>/^p_[a-z_]+$/.test(k)));
 await db.exec('set role service_role');
 const result=await db.query(`select public.${rpc[1]}(${keys.map((k,i)=>k+' => $'+(i+1)).join(',')}) result`,Object.values(args));
 return Response.json(result.rows[0].result);
};}
async function begin(service) {
 const page=await service(h.request('/signin')),cookie=h.cookieHeader(page),csrf=cookie.split('=')[1];
 const started=await service(h.request('/api/auth/start',{cookie,body:{csrf,returnTo:'/'}}));assert.equal(started.status,303);
 const target=new URL(started.headers.get('location'));h.state.challenges.add(target.searchParams.get('code_challenge'));
 return {cookie:h.cookieHeader(started),path:'/api/auth/callback?code=fake-code&state='+target.searchParams.get('state')};
}
async function login(service) {
 const attempt=await begin(service),response=await service(h.request(attempt.path,{cookie:attempt.cookie}));
 assert.equal(response.status,303,await response.clone().text());
 const cookie=h.cookieHeader(response),session=await service(h.request('/api/session',{cookie}));
 assert.equal(session.status,200,await session.clone().text());return cookie;
}
try {
 const original=await database(),fetcher=fetchFor(original),service=createWebService(h.config,{fetcher,now:()=>h.state.now});
 const oldCookie=await login(service),oldAttempt=await begin(service);
 const preview=await createDecisions(h.config,{fetcher,now:()=>h.state.now}).preview(h.access,token,h.project,{target:healthTarget,choice:'accept',reason:'Acme restore proof'});
 h.source.mode='lost';
 const outcome=await createOperations(h.config,{fetcher,now:()=>h.state.now}).apply(h.access,token,h.project,preview.id,{reauthorize:async()=>h.access});
 assert.equal(outcome.state,'uncertain');assert.equal(h.source.writes.length,1);
 const saved=await snapshot(original);assert.equal(saved.decision_operations.length,1);
 assert.doesNotMatch(saved.decision_operations[0].value,/Acme restore proof|fake-user-access-token/);
 const restored=await database();
 for(const table of tables)for(const row of saved[table]) {
  const keys=Object.keys(row);assert.ok(keys.every(k=>/^[a-z_]+$/.test(k)));
  await restored.query(`insert into keel_private.${table}(${keys.join(',')}) values (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));
 }
 assert.deepEqual(await snapshot(restored),saved,'logical snapshot preserves ciphertext and metadata');
 const recovery={epoch:'1'.repeat(32),startedAt:new Date(h.state.now-1000).toISOString(),reconciledAt:null};
 const restoredConfig={...h.config,recovery},restoredFetcher=fetchFor(restored);
 const quarantined=createWebService(restoredConfig,{fetcher:restoredFetcher,now:()=>h.state.now});
 assert.equal((await quarantined(h.request('/api/deployment',{cookie:oldCookie}))).status,401);
 const exchangeCount=()=>h.state.requests.filter(r=>r.url==='https://github.com/login/oauth/access_token').length;
 const beforeExchange=exchangeCount();assert.equal((await quarantined(h.request(oldAttempt.path,{cookie:oldAttempt.cookie}))).status,400);assert.equal(exchangeCount(),beforeExchange);
 const freshCookie=await login(quarantined),health=await quarantined(h.request('/api/deployment',{cookie:freshCookie}));
 assert.equal(health.status,200);assert.equal((await health.json()).recovery.state,'quarantined');
 const route='/api/projects/studio/operations/'+preview.operationId;
 const beforeQuarantine=await snapshot(restored);
 for(const path of [route,'/api/unknown-business','/projects/studio'])assert.equal((await quarantined(h.request(path,{cookie:freshCookie}))).status,503);
 const afterQuarantine=await snapshot(restored);
 assert.deepEqual(afterQuarantine.decision_operations,beforeQuarantine.decision_operations);
 assert.deepEqual(afterQuarantine.decision_previews,beforeQuarantine.decision_previews);
 assert.equal(h.source.writes.length,1,'quarantined GET cannot reconcile or replay');
 // Explicit trusted operator inspection, outside quarantined HTTP admission.
 const originalHistory=h.source.commits;h.source.commits=[];
 const auditOperations=createOperations(restoredConfig,{fetcher:restoredFetcher,now:()=>h.state.now});
 const unknown=await auditOperations.recover(h.access,token,h.project,preview.operationId);
 assert.equal(unknown.state,'uncertain');assert.equal(unknown.receipt,null);assert.equal(h.source.writes.length,1);
 h.source.commits=originalHistory;
 const audit=await auditOperations.recover(h.access,token,h.project,preview.operationId);
 assert.equal(audit.state,'committed');assert.equal(audit.receipt.acceptance,'not-established');assert.equal(h.source.writes.length,1);
 const reopened=createWebService({...restoredConfig,recovery:{...recovery,reconciledAt:new Date(h.state.now).toISOString()}},{fetcher:restoredFetcher,now:()=>h.state.now});
 assert.equal((await reopened(h.request('/api/deployment',{cookie:oldCookie}))).status,401);
 assert.equal((await reopened(h.request('/api/session',{cookie:freshCookie}))).status,200);
 const receipt=await reopened(h.request(route,{cookie:freshCookie}));assert.equal(receipt.status,200,await receipt.clone().text());
 assert.equal((await receipt.json()).receipt.acceptance,'not-established');assert.equal(h.source.writes.length,1);
 console.log('PASS SQL001/004 logical restore: ciphertext preserved; old session/callback fenced before OAuth exchange; fresh login allowed; quarantine preserves uncertain intent; explicit original-intent audit finds one synthetic commit without replay or acceptance; reopened epoch keeps old session invalid. Single connection per database; no hosted backup or real-use claim.');
} finally {for(const db of databases)await db.close();}
