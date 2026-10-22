import {createFleetUpdates} from './fleet-updates.mjs';
import {createLessonRollout} from './lesson-rollout.mjs';
import {versionsView,rolloutView,updateView,lessonTraceView,fleetStyles} from './fleet-views.mjs';
import {createJobs} from './jobs.mjs';
import {createJobOidc} from './job-oidc.mjs';
import {routineView,jobsView,jobOperationView,jobStyles} from './job-views.mjs';
import {createConnections} from './connections.mjs';
import {connectionsView,connectionOperationView,connectionRecoveryView,connectionStyles} from './connection-views.mjs';
import {createRuns,createRunBudget} from './runs.mjs';
import {createRunReceipts} from './run-receipts.mjs';
import {pageNumber,workflowPath,states as runStates,matchesWindow,deduplicate,coverage as runCoverage} from './run-model.mjs';
import {runsView,runDetailView,runStyles,runLocation} from './run-views.mjs';
import {createDaily} from './daily.mjs';
import {createLearning} from './learning.mjs';
import {createMigration} from './migration.mjs';
import {createExport} from './export.mjs';
import {dailyView,dailyProjectPicker,dailyStyles} from './daily-views.mjs';
import {learningView,migrationOperationView,setupView} from './learning-views.mjs';
import {createChanges} from './changes.mjs';
import {createMedia} from './media.mjs';
import {changeIndexView,changeDetailView,journalStyles} from './change-views.mjs';
import {mediaView} from './media-views.mjs';
import { readFile } from 'node:fs/promises';
import { createWalks } from './walks.mjs';
import { walkIndexView, walkView, walkOperationView, walkStyles } from './walk-views.mjs';
import { createDecisions } from './decisions.mjs';
import { createOperations } from './operations.mjs';
import { decisionView, operationView, decisionStyles } from './decision-views.mjs';
import { equal, opaque, record } from './common.mjs';
import { createHomeReader } from './home.mjs';
import { WebError, random, deny } from './common.mjs';
import { createStore } from './store.mjs';
import { createGitHub } from './github.mjs';
import { createAuth, cookie, COOKIES, mutationOrigin } from './auth.mjs';
import { styles, signinView, homeView, projectView, errorView } from './views.mjs';

// Native HTML form POSTs derive Origin from this policy: no-referrer makes it null.
// Keep only the origin (never OAuth query/path data), without weakening Origin/CSRF checks.
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self' blob:; form-action 'self' https://github.com; base-uri 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=31536000', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' };
function respond(body, status = 200, type = 'text/html; charset=utf-8', extra = {}) {
  return new Response(body, { status, headers: { ...headers, 'Content-Type': type, ...extra } });
}
function redirect(result) {
  const response = respond('', 303, 'text/plain; charset=utf-8', { Location: result.location });
  for (const entry of result.cookies ?? []) response.headers.append('Set-Cookie', entry);
  return response;
}
async function form(request, fields) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/x-www-form-urlencoded') throw new WebError('invalid_form', 415);
  const reader = request.body?.getReader(); if (!reader) throw new WebError('invalid_form', 400);
  const chunks = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 4096) throw new WebError('invalid_form', 413); chunks.push(value); }
  } finally { await reader.cancel().catch(() => {}); }
  const data = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  if ([...data.keys()].length !== fields.length || !fields.every(key => data.getAll(key).length === 1)) throw new WebError('invalid_form', 400);
  return Object.fromEntries(data);
}
async function jsonInput(request,limit=16384) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new WebError('invalid_json',415);
  const reader=request.body?.getReader(); if(!reader)throw new WebError('invalid_json',400);
  const chunks=[];let size=0;
  try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new WebError('input_limit',413);chunks.push(value);}}
  finally {await reader.cancel().catch(()=>{});}
  let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw new WebError('invalid_json',400);}
  if(!record(data))throw new WebError('invalid_json',400);return data;
}
const receiptRoutines=new Set(['web-decision','web-walk','web-migration','web-media','night','cli-stalls']);
function historyQuery(url,{detail=false,fleet=false}={}) {
  const allowed=['days','routine','status','page','project',...(detail?['jobsPage','artifactsPage']:fleet?['projectPage','migrationAfter']:['receiptsAfter'])];
  if([...url.searchParams.keys()].some(key=>!allowed.includes(key)||url.searchParams.getAll(key).length!==1)) throw new WebError('invalid_run_filters',400);
  const raw=Object.fromEntries(url.searchParams),days=raw.days===undefined?30:Number(raw.days);
  if(raw.days!==undefined&&!/^\d{1,2}$/.test(raw.days)||!Number.isInteger(days)||days<1||days>90) throw new WebError('invalid_run_filters',400);
  const routine=raw.routine||null,status=raw.status||null;
  if(routine&&!workflowPath(routine)&&!receiptRoutines.has(routine)||status&&!runStates.includes(status)) throw new WebError('invalid_run_filters',400);
  for(const key of ['receiptsAfter','migrationAfter'])if(raw[key]!==undefined&&(!/^[A-Za-z0-9_-]{1,4096}$/.test(raw[key]))) throw new WebError('invalid_run_cursor',400);
  return {filters:{days,routine,status},page:pageNumber(raw.page),projectPage:pageNumber(raw.projectPage),jobsPage:pageNumber(raw.jobsPage),artifactsPage:pageNumber(raw.artifactsPage),receiptsAfter:raw.receiptsAfter||null,migrationAfter:raw.migrationAfter||null,selectedProject:raw.project};
}
function sameHistoryScope(before,after) {
  const projects=access=>JSON.stringify(access.projects.map(project=>[project.id,project.repoId,project.repo]).sort((a,b)=>a[0].localeCompare(b[0])));
  return before.userId===after.userId&&before.workspace.id===after.workspace.id
    &&before.actionsPermission===after.actionsPermission&&projects(before)===projects(after);
}
function decodeRoutine(value) {
  let decoded;try{decoded=decodeURIComponent(value);}catch{throw new WebError('invalid_routine',400);}
  if(!workflowPath(decoded))throw new WebError('invalid_routine',400);
  return decoded;
}
function sameFleetScope(before,after,{source=true}={}) {
  return sameJobScope(before,after,{source}) && before.pullRequestsPermission===after.pullRequestsPermission;
}
function sameJobScope(before,after,{source=false}={}) {
  return sameConnectionScope(before,after,{source})&&before.actionsPermission===after.actionsPermission
    &&before.workflowsPermission===after.workflowsPermission;
}
function sameConnectionScope(before,after,{source=false}={}) {
  const pins=access=>JSON.stringify(access.projects.map(project=>[project.id,project.repoId,project.repo]).sort((a,b)=>a[0].localeCompare(b[0])));
  return before.userId===after.userId&&before.workspace.id===after.workspace.id
    &&before.contentsPermission===after.contentsPermission&&pins(before)===pins(after)
    &&(!source||before.sourceRevision===after.sourceRevision);
}
function historyUnavailable(error,source) {
  if(error.code==='access_denied'||error.status===401||error.status===403||error.status===404) throw error;
  if(['invalid_run_cursor','stale_run_cursor'].includes(error.code)) throw error;
  return {source,reason:error.code==='run_quota'?'Provider quota paused this bounded read.':error.code==='run_limit'?'The shared history read bound was reached. Unvisited sources remain incomplete.':'History source is unavailable in this read.',code:error.code==='run_quota'?'quota':error.code==='run_limit'?'bounded':'unavailable'};
}

export function createWebService(config, { fetcher = fetch, now = Date.now } = {}) {
  let jobOidc=null;
  return async request => {
    const deadline = AbortSignal.timeout(55000);
    const boundedFetch = (url, options = {}) => fetcher(url, { ...options, signal: AbortSignal.any([deadline, request.signal, ...(options.signal ? [options.signal] : [])]) });
    const store = createStore(config, boundedFetch), github = createGitHub(config, boundedFetch), auth = createAuth(config, store, github, now);
    const changes=createChanges(config,{fetcher:boundedFetch,now});
    const media=createMedia(config,{fetcher:boundedFetch,now,inspectTarget:changes.captureTarget});
    const readHome = createHomeReader(config, { fetcher: boundedFetch, now, enrichChanges:media.enrich });
    const decisions=createDecisions(config,{fetcher:boundedFetch,now}),walks=createWalks(config,{fetcher:boundedFetch,now});
    const operations=createOperations(config,{fetcher:boundedFetch,now,inspectWalk:walks.inspectPreview});
    const daily=createDaily(config,{fetcher:boundedFetch,now});
    const learning=createLearning(config,{fetcher:boundedFetch,now});
    const migration=createMigration(config,{fetcher:boundedFetch,now});
    const exports=createExport(config,{fetcher:boundedFetch,now});
    const connections=createConnections(config,{fetcher:boundedFetch,now});
    const jobs=createJobs(config,{fetcher:boundedFetch,now,resolveInitiator:auth.resolveInitiator});
    const fleet=createFleetUpdates(config,{fetcher:boundedFetch,now,resolveInitiator:auth.resolveInitiator});
    const lessonRollout=createLessonRollout(config,{fetcher:boundedFetch,now});
    let url;
    try {
      url = new URL(request.url);
      if (url.origin !== config.origin || request.headers.get('host') && request.headers.get('host') !== url.host) throw new WebError('invalid_origin', 403);
      if (!['GET', 'POST'].includes(request.method)) throw new WebError('method_not_allowed', 405);
      if (request.method === 'GET' && url.pathname === '/assets/keel.css') return respond(styles, 200, 'text/css; charset=utf-8');
      if (request.method === 'GET' && ['/assets/home-client.mjs', '/assets/home-views.mjs'].includes(url.pathname)) {
        // Literal module-relative URLs let deployment tracing include both browser assets.
        const asset = url.pathname.endsWith('home-client.mjs')
          ? await readFile(new URL('./home-client.mjs', import.meta.url), 'utf8')
          : await readFile(new URL('./views.mjs', import.meta.url), 'utf8');
        return respond(asset, 200, 'text/javascript; charset=utf-8');
      }
      if (request.method==='GET' && ['/assets/fleet-client.mjs','/assets/fleet-views.mjs','/assets/fleet.css'].includes(url.pathname)) {
        const asset=url.pathname.endsWith('fleet-client.mjs')?await readFile(new URL('./fleet-client.mjs',import.meta.url),'utf8')
          :url.pathname.endsWith('fleet-views.mjs')?await readFile(new URL('./fleet-views.mjs',import.meta.url),'utf8'):fleetStyles;
        return respond(asset,200,url.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');
      }
      if(request.method==='GET'&&['/assets/decision-client.mjs','/assets/decision-views.mjs','/assets/decision.css'].includes(url.pathname)) {
        const asset=url.pathname.endsWith('decision-client.mjs')?await readFile(new URL('./decision-client.mjs',import.meta.url),'utf8')
          :url.pathname.endsWith('decision-views.mjs')?await readFile(new URL('./decision-views.mjs',import.meta.url),'utf8'):decisionStyles;
        return respond(asset,200,url.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');
      }
      if(request.method==='GET'&&['/assets/walk-client.mjs','/assets/walk-views.mjs','/assets/walk.css'].includes(url.pathname)) {
        const asset=url.pathname.endsWith('walk-client.mjs')?await readFile(new URL('./walk-client.mjs',import.meta.url),'utf8')
          :url.pathname.endsWith('walk-views.mjs')?await readFile(new URL('./walk-views.mjs',import.meta.url),'utf8'):walkStyles;
        return respond(asset,200,url.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');
      }
      if(request.method==='GET'&&['/assets/change-client.mjs','/assets/change-views.mjs','/assets/media-client.mjs','/assets/media-views.mjs','/assets/change.css'].includes(url.pathname)) {
        const asset=url.pathname.endsWith('change-client.mjs')?await readFile(new URL('./change-client.mjs',import.meta.url),'utf8')
          :url.pathname.endsWith('change-views.mjs')?await readFile(new URL('./change-views.mjs',import.meta.url),'utf8')
          :url.pathname.endsWith('media-client.mjs')?await readFile(new URL('./media-client.mjs',import.meta.url),'utf8')
          :url.pathname.endsWith('media-views.mjs')?await readFile(new URL('./media-views.mjs',import.meta.url),'utf8'):journalStyles;
        return respond(asset,200,url.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');
      }
      if (request.method === 'GET' && ['/assets/daily-client.mjs','/assets/daily-views.mjs','/assets/learning-client.mjs','/assets/learning-views.mjs','/assets/daily.css'].includes(url.pathname)) {
        const asset=url.pathname.endsWith('daily-client.mjs')?await readFile(new URL('./daily-client.mjs',import.meta.url),'utf8')
          :url.pathname.endsWith('daily-views.mjs')?await readFile(new URL('./daily-views.mjs',import.meta.url),'utf8')
          :url.pathname.endsWith('learning-client.mjs')?await readFile(new URL('./learning-client.mjs',import.meta.url),'utf8')
          :url.pathname.endsWith('learning-views.mjs')?await readFile(new URL('./learning-views.mjs',import.meta.url),'utf8'):dailyStyles;
        return respond(asset,200,url.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');
      }
      if(request.method==='GET'&&['/assets/run-client.mjs','/assets/run-views.mjs','/assets/run.css'].includes(url.pathname)) {
        const asset=url.pathname.endsWith('run-client.mjs')?await readFile(new URL('./run-client.mjs',import.meta.url),'utf8')
          :url.pathname.endsWith('run-views.mjs')?await readFile(new URL('./run-views.mjs',import.meta.url),'utf8'):runStyles;
        return respond(asset,200,url.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');
      }
      if(request.method==='GET'&&['/assets/connection-client.mjs','/assets/connection-views.mjs','/assets/connection.css'].includes(url.pathname)) {
        const asset=url.pathname.endsWith('connection-client.mjs')?await readFile(new URL('./connection-client.mjs',import.meta.url),'utf8')
          :url.pathname.endsWith('connection-views.mjs')?await readFile(new URL('./connection-views.mjs',import.meta.url),'utf8'):connectionStyles;
        return respond(asset,200,url.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');
      }
      if(request.method==='GET'&&['/assets/job-client.mjs','/assets/job-views.mjs','/assets/job.css'].includes(url.pathname)) {
        const asset=url.pathname.endsWith('job-client.mjs')?await readFile(new URL('./job-client.mjs',import.meta.url),'utf8')
          :url.pathname.endsWith('job-views.mjs')?await readFile(new URL('./job-views.mjs',import.meta.url),'utf8'):jobStyles;
        return respond(asset,200,url.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');
      }
      if (request.method === 'GET' && url.pathname === '/signin') {
        const csrf = random(); return respond(signinView(csrf), 200, 'text/html; charset=utf-8', { 'Set-Cookie': cookie(COOKIES.login, csrf, 600) });
      }
      if (request.method === 'GET' && url.pathname === '/api/auth/callback') return redirect(await auth.callback(request, url));
      const workerRoute=url.pathname.match(/^\/api\/workers\/(claim|begin|heartbeat|complete|update-output)$/);
      if(workerRoute) {
        if(request.method!=='POST')throw new WebError('method_not_allowed',405);
        if(url.search)throw new WebError('invalid_query',400);
        const authorization=request.headers.get('authorization');
        if(typeof authorization!=='string'||!/^Bearer [A-Za-z0-9_.-]{1,16384}$/.test(authorization))throw new WebError('worker_identity_required',401);
        jobOidc??=createJobOidc({audience:config.origin},{fetcher,now});
        const identity=await jobOidc.verify(authorization.slice(7));
        const data=await jsonInput(request,workerRoute[1]==='update-output'?2*1024*1024+16384:16384);
        const result=workerRoute[1]==='update-output'?await fleet.output(identity,data):await jobs[workerRoute[1]](identity,data);
        return respond(JSON.stringify(result),200,'application/json');
      }
      if (request.method === 'POST') {
        mutationOrigin(request, config.origin);
        if (url.pathname === '/api/auth/start') return redirect(await auth.start(request, await form(request, ['csrf', 'returnTo'])));
        if (['/api/auth/logout', '/api/auth/revoke'].includes(url.pathname)) {
          const data = await form(request, ['csrf']);
          return redirect(await auth.logout(request, data.csrf, url.pathname === '/api/auth/revoke'));
        }
        const rolloutMutation=url.pathname.match(/^\/api\/updates\/rollouts(?:\/([a-f0-9]{64})\/(stop))?$/);
        const updateMutation=url.pathname.match(/^\/api\/projects\/([a-z][a-z0-9-]{0,63})\/updates\/(prepare-preview|prepare|publication-preview|publish)$/);
        const updateAction=url.pathname.match(/^\/api\/updates\/([a-f0-9]{64})\/(reconcile|cancel|continue)$/);
        if (rolloutMutation||updateMutation||updateAction) {
          if (url.search) throw new WebError('invalid_query',400);
          const access=await auth.authorized(request),current=await auth.session(request);
          const data=await jsonInput(request);
          if (!opaque(data.csrf)||!equal(data.csrf,current.csrf)) throw new WebError('invalid_csrf',403);
          delete data.csrf;
          const reauthorize=async()=>{
            const fresh=await auth.authorized(request);
            if (!sameFleetScope(access,fresh)) deny();
            return fresh;
          };
          let result;
          if (rolloutMutation) result=rolloutMutation[1]
            ?await fleet.stop(access,current.token,rolloutMutation[1],data,{reauthorize})
            :await fleet.createRollout(access,current.token,data,{reauthorize});
          else if (updateAction) {
            if (Object.keys(data).length) throw new WebError('invalid_update_action',400);
            const method=updateAction[2]==='continue'?'continuePublication':updateAction[2];
            result=await fleet[method](access,current.token,updateAction[1],{reauthorize});
          } else {
            const project=access.projects.find(p=>p.id===updateMutation[1]);if(!project)deny();
            const method={'prepare-preview':'preparePreview','publication-preview':'publicationPreview',prepare:'prepare',publish:'publish'}[updateMutation[2]];
            result=await fleet[method](access,current.token,project,data,{reauthorize,sessionRef:current.key});
          }
          await reauthorize();
          return respond(JSON.stringify(result),200,'application/json');
        }
        const jobMutation=url.pathname.match(/^\/api\/projects\/([a-z][a-z0-9-]{0,63})\/(?:routines\/([^/]+)\/(preview|schedule-preview)|jobs\/([a-f0-9]{64})\/(cancel|reconcile|retry-preview)|jobs\/(start|schedule-apply))$/);
        if(jobMutation) {
          if(url.search)throw new WebError('invalid_query',400);
          const access=await auth.authorized(request),current=await auth.session(request);
          const project=access.projects.find(item=>item.id===jobMutation[1]);if(!project)deny();
          const data=await jsonInput(request);
          if(!opaque(data.csrf)||!equal(data.csrf,current.csrf))throw new WebError('invalid_csrf',403);
          delete data.csrf;
          const reauthorize=async()=>{
            const fresh=await auth.authorized(request);
            if(!sameJobScope(access,fresh))deny();
            return fresh;
          };
          let result;
          if(jobMutation[2]) {
            const routineId=decodeRoutine(jobMutation[2]);
            if(jobMutation[3]==='preview') {
              if(Object.keys(data).length)throw new WebError('invalid_input',400);
              result=await jobs.preview(access,current.token,project,{routineId,retryOf:null},{sessionRef:current.key});
            }else {
              if(Object.keys(data).some(key=>key!=='cron'))throw new WebError('invalid_input',400);
              result=await jobs.schedulePreview(access,current.token,project,{routineId,cron:data.cron});
            }
          }else if(jobMutation[6]) {
            const method=jobMutation[6]==='start'?'start':'scheduleApply';
            result=await jobs[method](access,current.token,project,data,{reauthorize});
          }else {
            if(Object.keys(data).length)throw new WebError('invalid_input',400);
            const action=jobMutation[5];
            result=action==='retry-preview'?await jobs.retryPreview(access,current.token,project,jobMutation[4],{sessionRef:current.key})
              :await jobs[action](access,current.token,project,jobMutation[4],{reauthorize});
          }
          await reauthorize();
          return respond(JSON.stringify(result),200,'application/json');
        }
        const connectionMutation=url.pathname.match(/^\/api\/connections\/(?:policy\/(preview|apply)|operations\/([a-f0-9]{64})\/(recover)|([a-z][a-z0-9-]{0,63})\/(set|remove|reconcile))$/);
        if(connectionMutation) {
          if(url.search)throw new WebError('invalid_query',400);
          const access=await auth.authorized(request),current=await auth.session(request);
          const data=await jsonInput(request,32768);
          if(!opaque(data.csrf)||!equal(data.csrf,current.csrf))throw new WebError('invalid_csrf',403);
          delete data.csrf;
          const reauthorize=async()=>{
            const fresh=await auth.authorized(request);
            if(!sameConnectionScope(access,fresh))deny();
            return fresh;
          };
          let result;
          if(connectionMutation[1]==='preview')result=await connections.policyPreview(access,current.token,data);
          else if(connectionMutation[1]==='apply') {
            if(Object.keys(data).some(key=>!['previewId','digest'].includes(key)))throw new WebError('invalid_input',400);
            result=await connections.policyApply(access,current.token,data.previewId,{digest:data.digest,reauthorize});
          } else if(connectionMutation[3]) {
            if(Object.keys(data).length)throw new WebError('invalid_input',400);
            result=await connections.recover(access,current.token,connectionMutation[2],{reauthorize});
          } else {
            const method={set:'setCredential',remove:'removeCredential',reconcile:'reconcileCredential'}[connectionMutation[5]];
            result=await connections[method](access,current.token,connectionMutation[4],data,{reauthorize});
          }
          await reauthorize();
          return respond(JSON.stringify(result),200,'application/json');
        }
        const dailyMutation=url.pathname.match(/^\/api\/projects\/([a-z][a-z0-9-]{0,63})\/daily\/preview$/);
        const learningMutation=url.pathname.match(/^\/api\/(?:projects\/([a-z][a-z0-9-]{0,63})\/)?learning\/(migration|export)\/(preview|apply|download)$/);
        if (dailyMutation || learningMutation) {
          if (url.search) throw new WebError('invalid_query',400);
          const access=await auth.authorized(request),current=await auth.session(request);
          const projectId=dailyMutation?.[1]||learningMutation?.[1];
          const project=projectId?access.projects.find(item=>item.id===projectId):null;
          if (projectId&&!project) deny();
          const data=await jsonInput(request,262144);
          if (!opaque(data.csrf)||!equal(data.csrf,current.csrf)) throw new WebError('invalid_csrf',403);
          delete data.csrf;
          if (dailyMutation) return respond(JSON.stringify(await daily.preview(access,current.token,project,data)),200,'application/json');
          const kind=learningMutation[2],action=learningMutation[3];
          if (kind==='migration'&&(!project||!['preview','apply'].includes(action))||kind==='export'&&!['preview','download'].includes(action)) deny();
          if (action==='preview'&&project&&(!Array.isArray(data.selection)||data.selection.some(item=>!record(item)||item.kind!=='project'||item.projectId!==project.id))) throw new WebError('invalid_selection',400);
          if (kind==='migration') {
            if (action==='apply'&&Object.keys(data).some(key=>!['previewId','digest'].includes(key))) throw new WebError('invalid_input',400);
            const result=action==='preview'?await migration.preview(access,current.token,data)
              :await migration.apply(access,current.token,data.previewId,{digest:data.digest,reauthorize:()=>auth.authorized(request)});
            return respond(JSON.stringify(result),200,'application/json');
          }
          if (action==='preview') return respond(JSON.stringify(await exports.preview(access,current.token,data)),200,'application/json');
          const result=await exports.download(access,current.token,data,{reauthorize:()=>auth.authorized(request)});
          if (result.filename!=='keel-reviewed-lessons.txt'||result.mime!=='text/plain; charset=utf-8') throw new WebError('invalid_export',503);
          return respond(result.bytes,200,result.mime,{'Content-Disposition':'attachment; filename="keel-reviewed-lessons.txt"'});
        }
        const mediaMutation = url.pathname.match(/^\/api\/projects\/([a-z][a-z0-9-]{0,63})\/media\/(upload|([a-f0-9]{64})\/(attach|remove|recover))$/);
        if (mediaMutation) {
            if (url.search)
                throw new WebError('invalid_query', 400);
            const access = await auth.authorized(request), current = await auth.session(request), project = access.projects.find(p => p.id === mediaMutation[1]);
            if (!project)
                deny();
            const data = await jsonInput(request, mediaMutation[2] === 'upload' ? 3 * 1024 * 1024 : 16384);
            if (!opaque(data.csrf) || !equal(data.csrf, current.csrf))
                throw new WebError('invalid_csrf', 403);
            delete data.csrf;
            let result;
            if (mediaMutation[2] === 'upload') {
                const { changeId, slotId, ...input } = data;
                result = await media.upload(access, current.token, project, changeId, slotId, input);
            }
            else if (mediaMutation[4] === 'remove')
                result = await media.remove(access, project, mediaMutation[3], data);
            else if (mediaMutation[4] === 'attach')
                result = await media.attach(access, current.token, project, mediaMutation[3], data);
            else {
                if (Object.keys(data).length)
                    throw new WebError('invalid_input', 400);
                result = await media.recover(access, current.token, project, mediaMutation[3]);
            }
            return respond(JSON.stringify(result), 200, 'application/json');
        }
        const walkMutation=url.pathname.match(/^\/api\/projects\/([a-z][a-z0-9-]{0,63})\/walks\/([a-z][a-z0-9-]{0,63})\/(draft|preview|repair)$/);
        if(walkMutation) {
          if(url.search)throw new WebError('invalid_query',400);
          const access=await auth.authorized(request),current=await auth.session(request),project=access.projects.find(p=>p.id===walkMutation[1]);if(!project)deny();
          const data=await jsonInput(request,walkMutation[3]==='repair'?262144:65536);
          if(!opaque(data.csrf)||!equal(data.csrf,current.csrf))throw new WebError('invalid_csrf',403);delete data.csrf;
          const method=walkMutation[3]==='draft'?'save':walkMutation[3];
          const result=await walks[method](access,current.token,project,walkMutation[2],data);
          return respond(JSON.stringify(result),200,'application/json');
        }
        const mutation=url.pathname.match(/^\/api\/projects\/([a-z][a-z0-9-]{0,63})\/decisions\/(preview|apply)$/);
        if(mutation) {
          if(url.search)throw new WebError('invalid_query',400);
          const access=await auth.authorized(request),current=await auth.session(request),project=access.projects.find(p=>p.id===mutation[1]);if(!project)deny();
          const data=await jsonInput(request);if(!opaque(data.csrf)||!equal(data.csrf,current.csrf))throw new WebError('invalid_csrf',403);delete data.csrf;
          let result;
          if(mutation[2]==='preview')result=await decisions.preview(access,current.token,project,data);
          else {if(Object.keys(data).some(key=>!['previewId','publicAcknowledgement'].includes(key))||!Object.hasOwn(data,'previewId'))throw new WebError('invalid_apply',400);result=await operations.apply(access,current.token,project,data.previewId,{reauthorize:()=>auth.authorized(request),publicAcknowledgement:data.publicAcknowledgement});}
          return respond(JSON.stringify(result),200,'application/json');
        }
        deny();
      }
      const access = await auth.authorized(request);
      const versionsRoute=url.pathname.match(/^\/(api\/)?(?:projects\/([a-z][a-z0-9-]{0,63})\/)?versions$/);
      const rolloutRoute=url.pathname.match(/^\/(api\/)?updates\/rollouts\/([a-f0-9]{64})$/);
      const updateRoute=url.pathname.match(/^\/(api\/)?updates\/([a-f0-9]{64})$/);
      const artifactRoute=url.pathname.match(/^\/api\/projects\/([a-z][a-z0-9-]{0,63})\/updates\/artifacts\/([a-f0-9]{64})$/);
      const traceRoute=url.pathname.match(/^\/(api\/)?learning\/trace\/(lesson-[a-f0-9]{40})$/);
      if (versionsRoute||rolloutRoute||updateRoute||artifactRoute||traceRoute) {
        if ((!versionsRoute&&url.search)||versionsRoute&&[...url.searchParams.keys()].some(k=>k!=='projectPage'||url.searchParams.getAll(k).length!==1)) throw new WebError('invalid_query',400);
        const current=await auth.session(request);
        const budget=createRunBudget(boundedFetch,{now});
        const reader=createFleetUpdates(config,{fetcher:budget.fetcher,now,resolveInitiator:auth.resolveInitiator});
        let model,isApi;
        if (versionsRoute) {
          const project=versionsRoute[2]?access.projects.find(p=>p.id===versionsRoute[2]):null;
          if (versionsRoute[2]&&!project)deny();
          if (project&&url.search)throw new WebError('invalid_query',400);
          const page=pageNumber(url.searchParams.get('projectPage')||undefined),start=(page-1)*3;
          if(!project&&start>=access.projects.length&&page!==1)throw new WebError('invalid_run_page',400);
          const selected=project?[project]:access.projects.slice(start,start+3),projects=[];
          for (const item of selected) {
            try {projects.push(await reader.comparison(access,current.token,item));}
            catch(error) {
              if([401,403,404].includes(error.status))throw error;
              projects.push({project:item,versions:{},capabilities:{prepare:false},gaps:[{reason:'Comparison unavailable in this bounded source read.'}]});
            }
          }
          const pkg=JSON.parse(await readFile(new URL('../../package.json',import.meta.url),'utf8'));
          model={schema:1,project,projects,target:config.fleetUpdates?.target||null,readAt:new Date(now()).toISOString(),
            application:{revision:/^[a-f0-9]{40}$/.test(process.env.VERCEL_GIT_COMMIT_SHA||'')?process.env.VERCEL_GIT_COMMIT_SHA:null,cliVersion:pkg.version,node:process.version},
            nextProjectPage:!project&&start+3<access.projects.length?page+1:null,gaps:budget.exhausted?[{reason:'Shared comparison read limit reached; remaining sources are unavailable.'}]:[]};
          isApi=!!versionsRoute[1];
        } else if (artifactRoute) {
          const project=access.projects.find(p=>p.id===artifactRoute[1]);if(!project)deny();
          model=await reader.artifact(access,current.token,project,artifactRoute[2]);isApi=true;
        } else if (traceRoute) {
          model=await lessonRollout.inspect(access,current.token,traceRoute[2]);isApi=!!traceRoute[1];
        } else {
          const route=rolloutRoute||updateRoute;isApi=!!route[1];
          try {model=await reader[rolloutRoute?'rollout':'operation'](access,current.token,route[2]);}
          catch(error) {
            if(isApi||error.code!=='operation_not_found')throw error;
            model=rolloutRoute?{id:route[2],kind:'rollout',state:'unconfirmed',canary:'Unconfirmed',projects:[],capabilities:{},gaps:[{reason:'No receipt is visible for this request yet. Keep this original URL; do not create a replacement.'}]}
              :{id:route[2],kind:'unknown',state:'unconfirmed',reason:'No receipt is visible for this original request yet. Keep this receipt; do not resubmit.',capabilities:{reconcile:true}};
          }
        }
        const fresh=await auth.authorized(request);if(!sameFleetScope(access,fresh))deny();
        if(isApi)return respond(JSON.stringify(model),200,'application/json');
        return respond(versionsRoute?versionsView(model,access):traceRoute?lessonTraceView(model,access):rolloutRoute?rolloutView(model,access):updateView(model,access));
      }
      const jobRoute=url.pathname.match(/^\/(api\/)?(?:projects\/([a-z][a-z0-9-]{0,63})\/)?jobs(?:\/([a-f0-9]{64}))?$/);
      const routineRoute=url.pathname.match(/^\/(api\/)?projects\/([a-z][a-z0-9-]{0,63})\/routines\/([^/]+)$/);
      if(jobRoute||routineRoute) {
        const route=jobRoute||routineRoute,project=route[2]?access.projects.find(item=>item.id===route[2]):null;
        if(route[2]&&!project||jobRoute?.[3]&&!project)deny();
        const current=await auth.session(request);let model;
        if(routineRoute) {
          if(url.search)throw new WebError('invalid_query',400);
          model=await jobs.routine(access,current.token,project,decodeRoutine(routineRoute[3]));
        }else if(jobRoute[3]) {
          if(url.search)throw new WebError('invalid_query',400);
          try{model=await jobs.operation(access,current.token,project,jobRoute[3]);}
          catch(error){
            if(jobRoute[1]||!['job_not_found','operation_not_found'].includes(error.code))throw error;
            model={schema:1,id:jobRoute[3],projectId:project.id,state:'unknown',reason:'No receipt is visible for this request yet.',provider:null,worker:null,budget:null,capabilities:{reconcile:true}};
          }
        }else {
          const allowed=project?['after']:['projectPage'];
          if([...url.searchParams.keys()].some(key=>!allowed.includes(key)||url.searchParams.getAll(key).length!==1))throw new WebError('invalid_query',400);
          const after=url.searchParams.get('after');
          if(after!==null&&!/^[A-Za-z0-9_-]{1,4096}$/.test(after))throw new WebError('invalid_cursor',400);
          if(project)model=await jobs.overview(access,current.token,project,{after});
          else {
            const page=pageNumber(url.searchParams.get('projectPage')||undefined),selected=access.projects.slice((page-1)*3,page*3),projects=[];
            for(const item of selected) {
              try{projects.push(await jobs.overview(access,current.token,item));}
              catch(error){
                if([401,403,404].includes(error.status))throw error;
                projects.push({project:item,items:[],after:null,hasMore:false,gaps:[{code:'unavailable',reason:'This project’s durable operation read is unavailable.'}]});
              }
            }
            model={schema:1,projects,gaps:access.projects.length>page*3?[{reason:'Additional projects remain unread. Continue the fleet page to inspect them.'}]:[],projectPage:page,nextProjectPage:access.projects.length>page*3?page+1:null};
          }
        }
        const fresh=await auth.authorized(request);
        if(!sameJobScope(access,fresh,{source:true}))deny();
        if(route[1])return respond(JSON.stringify(model),200,'application/json');
        return respond(routineRoute?routineView(model,access):jobRoute[3]?jobOperationView(model,project,access):jobsView(model,access));
      }
      const connectionRoute=url.pathname.match(/^\/(api\/)?(?:projects\/([a-z][a-z0-9-]{0,63})\/)?connections(?:\/([a-z][a-z0-9-]{0,63}))?$/);
      const connectionOperation=url.pathname.match(/^\/(api\/)?connections\/operations\/([a-f0-9]{64})$/);
      const connectionRecovery=url.pathname.match(/^\/connections\/([a-z][a-z0-9-]{0,63})\/requests\/([a-f0-9]{64})\/(0|[1-9][0-9]{0,15})\/([a-f0-9]{64})\/(set|remove)$/);
      if(connectionRoute||connectionOperation||connectionRecovery) {
        if(url.search)throw new WebError('invalid_query',400);
        const current=await auth.session(request);
        let model,project=null;
        if(connectionOperation) {
          try {model=await connections.operation(access,current.token,connectionOperation[2]);}
          catch(error) {
            if(connectionOperation[1]||error.code!=='operation_not_found')throw error;
            model={schema:1,id:connectionOperation[2],state:'unknown',reason:'No receipt is visible for this request yet.',receipt:null};
          }
        }
        else if(connectionRecovery) {
          if(!Number.isSafeInteger(Number(connectionRecovery[3])))throw new WebError('invalid_input',400);
          model=await connections.detail(access,current.token,connectionRecovery[1]);
          model.recovery={requestId:connectionRecovery[2],expectedVersion:Number(connectionRecovery[3]),policyDigest:connectionRecovery[4],action:connectionRecovery[5]};
        } else {
          project=connectionRoute[2]?access.projects.find(item=>item.id===connectionRoute[2]):null;
          if(connectionRoute[2]&&!project)deny();
          model=connectionRoute[3]?await connections.detail(access,current.token,connectionRoute[3],{project}):await connections.overview(access,current.token,{project});
        }
        const fresh=await auth.authorized(request);
        if(!sameConnectionScope(access,fresh,{source:true}))deny();
        if(connectionOperation)return connectionOperation[1]?respond(JSON.stringify(model),200,'application/json'):respond(connectionOperationView(model,access));
        if(connectionRecovery)return respond(connectionRecoveryView(model,access));
        if(connectionRoute[1])return respond(JSON.stringify(model),200,'application/json');
        const viewModel={...model,...(!project?{authorizedProjects:access.projects.map(({id,repoId})=>({id,repoId}))}:{})};
        return respond(connectionsView(viewModel,access,project));
      }
      const historyRoute=url.pathname.match(/^\/(api\/)?(?:projects\/([a-z][a-z0-9-]{0,63})\/)?(routines|activity)(?:\/actions\/([1-9][0-9]{0,15})\/attempts\/([1-9][0-9]{0,15}))?$/);
      if(historyRoute) {
        const project=historyRoute[2]?access.projects.find(item=>item.id===historyRoute[2]):null;
        if(historyRoute[2]&&!project||historyRoute[4]&&(!project||historyRoute[3]!=='activity')) deny();
        const query=historyQuery(url,{detail:!!historyRoute[4],fleet:!project});
        if(query.selectedProject!==undefined) {
          if(query.selectedProject&&!access.projects.some(item=>item.id===query.selectedProject)) deny();
          return respond('',303,'text/plain; charset=utf-8',{Location:runLocation(historyRoute[3],query.selectedProject,{days:query.filters.days,status:query.filters.status,...(query.selectedProject===(project?.id||'')?{routine:query.filters.routine}:{})})});
        }
        const current=await auth.session(request),budget=createRunBudget(boundedFetch,{now});
        const runs=createRuns(config,{fetcher:boundedFetch,now});
        const receipts=createRunReceipts(config,{fetcher:budget.fetcher,now});
        if(historyRoute[4]) {
          const runId=Number(historyRoute[4]),attempt=Number(historyRoute[5]);
          if(!Number.isSafeInteger(runId)||!Number.isSafeInteger(attempt)) throw new WebError('invalid_run_identity',400);
          const model=await runs.detail(access,current.token,project,runId,attempt,{jobsPage:query.jobsPage,artifactsPage:query.artifactsPage},{budget});
          if(!sameHistoryScope(access,await auth.authorized(request))) deny();
          return historyRoute[1]?respond(JSON.stringify(model),200,'application/json'):respond(runDetailView(model,access,{...query.filters,page:query.page}));
        }
        const start=(query.projectPage-1)*3;
        const selected=project?[project]:access.projects.slice(start,start+3);
        if(!project&&start>=access.projects.length&&query.projectPage!==1) throw new WebError('invalid_run_page',400);
        const projectRows=access.projects.map(item=>({project:item,state:'unvisited',coverage:null,pagination:null}));
        const items=[],routines=[],gaps=[];
        let projectPagination={page:query.page,nextPage:null,receiptsAfter:null};
        for(const selectedProject of selected) {
          const row=projectRows.find(item=>item.project.id===selectedProject.id);
          try {
            const source=await runs.source(access,current.token,selectedProject,{budget});
            const actionModel=await runs.overview(access,current.token,selectedProject,{page:query.page,days:query.filters.days},{budget,source});
            items.push(...actionModel.items);
            routines.push(...actionModel.routines.map(item=>({...item,projectId:selectedProject.id})));
            let receiptModel={pagination:{nextCursor:null}};
            const projectGaps=[...actionModel.coverage.gaps];
            try {
              receiptModel=await receipts.list(access,current.token,selectedProject,{after:project?query.receiptsAfter:null,...query.filters},{snapshot:source.snapshot,config:source.config});
              items.push(...receiptModel.items,...receiptModel.observations);projectGaps.push(...receiptModel.coverage.gaps);
            } catch(error) {projectGaps.push(historyUnavailable(error,'Private and authored receipts'));}
            gaps.push(...projectGaps.map(gap=>({...gap,source:`${selectedProject.id} · ${gap.source}`})));
            row.state=projectGaps.length?'partial':'complete-page';row.coverage=projectGaps;
            row.pagination={page:query.page,nextPage:actionModel.pagination.nextPage,receiptsAfter:receiptModel.pagination.nextCursor};
            if(project)projectPagination=row.pagination;
          } catch(error) {
            const gap=historyUnavailable(error,selectedProject.id);gaps.push(gap);row.state='unavailable';row.coverage=[gap];
          }
        }
        let migrationAfter=null;
        if(!project) {
          for(const row of projectRows.filter(item=>item.state==='unvisited'))gaps.push({source:row.project.id,reason:'This authorized project was not visited in this request. Open the project or continue to its fleet batch.',code:'unvisited'});
          try {
            const migrations=await receipts.migrations(access,current.token,{after:query.migrationAfter,...query.filters});
            items.push(...migrations.items);gaps.push(...migrations.coverage.gaps);migrationAfter=migrations.pagination.nextCursor;
          } catch(error) {gaps.push(historyUnavailable(error,'Private workspace receipts'));}
        }
        const unique=deduplicate(items,'Combined history');gaps.push(...unique.gaps);
        const filtered=unique.items.filter(item=>matchesWindow(item,query.filters,now()));
        const model={schema:1,project,projects:projectRows,readAt:new Date(now()).toISOString(),filters:query.filters,
          items:filtered,routines:routines.filter(item=>!query.filters.routine||item.id===query.filters.routine),coverage:runCoverage(filtered,gaps,query.filters,now()),
          pagination:project?projectPagination:{projectPage:query.projectPage,nextProjectPage:start+3<access.projects.length?query.projectPage+1:null,migrationAfter}};
        if(!sameHistoryScope(access,await auth.authorized(request))) deny();
        return historyRoute[1]?respond(JSON.stringify(model),200,'application/json'):respond(runsView(model,access,historyRoute[3]));
      }
      if (url.pathname==='/daily'||url.pathname==='/setup') {
        if (url.search) throw new WebError('invalid_query',400);
        return respond(url.pathname==='/daily'?dailyProjectPicker(access):setupView(access,config));
      }
      const dailyRoute=url.pathname.match(/^\/(api\/)?projects\/([a-z][a-z0-9-]{0,63})\/daily$/);
      if (dailyRoute) {
        if ([...url.searchParams.keys()].some(key=>key!=='date')||url.searchParams.getAll('date').length>1) throw new WebError('invalid_query',400);
        const project=access.projects.find(item=>item.id===dailyRoute[2]);
        if (!project) deny();
        const current=await auth.session(request);
        const model=await daily.inspect(access,current.token,project,url.searchParams.get('date')??undefined);
        return dailyRoute[1]?respond(JSON.stringify(model),200,'application/json'):respond(dailyView(model,access));
      }
      const learningRoute=url.pathname.match(/^\/(api\/)?(?:projects\/([a-z][a-z0-9-]{0,63})\/)?learning$/);
      if (learningRoute) {
        if (url.search) throw new WebError('invalid_query',400);
        const project=learningRoute[2]?access.projects.find(item=>item.id===learningRoute[2]):null;
        if (learningRoute[2]&&!project) deny();
        const current=await auth.session(request);
        const model=project?await learning.project(access,current.token,project):await learning.shared(access,current.token);
        return learningRoute[1]?respond(JSON.stringify(model),200,'application/json'):respond(learningView(model,access));
      }
      const migrationRoute=url.pathname.match(/^\/(api\/)?learning\/operations\/([a-f0-9]{64})$/);
      if (migrationRoute) {
        if (url.search) throw new WebError('invalid_query',400);
        const current=await auth.session(request);
        let model;
        try {model=await migration.recover(access,current.token,migrationRoute[2]);}
        catch(error) {
          if(migrationRoute[1]||error.code!=='operation_not_found') throw error;
          model={schema:1,kind:'migration',id:migrationRoute[2],state:'uncertain',reason:'Original receipt is not visible yet. An in-flight request may still reserve it; recheck without resubmitting.',receipt:null};
        }
        return migrationRoute[1]?respond(JSON.stringify(model),200,'application/json'):respond(migrationOperationView(model,access));
      }
      const changeRoute = url.pathname.match(/^\/(api\/)?projects\/([a-z][a-z0-9-]{0,63})\/changes(?:\/([a-z][a-z0-9-]{0,63}))?$/);
      if (changeRoute) {
          if (url.search)
              throw new WebError('invalid_query', 400);
          const project = access.projects.find(p => p.id === changeRoute[2]);
          if (!project)
              deny();
          const current = await auth.session(request);
          let model = changeRoute[3] ? await changes.detail(access, current.token, project, changeRoute[3]) : await changes.list(access, current.token, project);
          model = await media.enrich(access, project, model);
          return changeRoute[1] ? respond(JSON.stringify(model), 200, 'application/json') : respond(changeRoute[3] ? changeDetailView(model, access) : changeIndexView(model, access));
      }
      const mediaRoute = url.pathname.match(/^\/(api\/)?projects\/([a-z][a-z0-9-]{0,63})\/media(?:\/(receipts\/([a-f0-9]{64})|([a-f0-9]{64})(\/bytes)?))?$/);
      if (mediaRoute) {
          const project = access.projects.find(p => p.id === mediaRoute[2]);
          if (!project)
              deny();
          if (mediaRoute[3]) {
              if (url.search)
                  throw new WebError('invalid_query', 400);
              if (mediaRoute[6]) {
                  if (!mediaRoute[1])
                      deny();
                  const result = await media.deliver(access, project, mediaRoute[5]);
                  if (!['image/png', 'image/jpeg'].includes(result.mime))
                      throw new WebError('invalid_media', 503);
                  return respond(result.bytes, 200, result.mime);
              }
              const receipt = mediaRoute[4] ? await media.byRequest(access, project, mediaRoute[4]) : await media.detail(access, project, mediaRoute[5]);
              return mediaRoute[1] ? respond(JSON.stringify(receipt), 200, 'application/json') : respond(mediaView({ project, receipt }, access));
          }
          if ([...url.searchParams.keys()].some(k => !['after', 'change', 'request'].includes(k) || url.searchParams.getAll(k).length !== 1))
              throw new WebError('invalid_query', 400);
          const after = url.searchParams.get('after'), changeId = url.searchParams.get('change'), requestId = url.searchParams.get('request');
          if (after && !/^[a-f0-9]{64}$/.test(after) || requestId && !/^[a-f0-9]{64}$/.test(requestId) || changeId && !/^[a-z][a-z0-9-]{0,63}$/.test(changeId) || [after, changeId, requestId].filter(Boolean).length > 1)
              throw new WebError('invalid_query', 400);
          const library = await media.list(access, project, after ? { after } : {});
          if (mediaRoute[1])
              return respond(JSON.stringify(library), 200, 'application/json');
          let change = null, receipt = null;
          if (changeId) {
              const current = await auth.session(request);
              const detail = await media.enrich(access, project, await changes.detail(access, current.token, project, changeId));
              change = detail.change;
          }
          if (requestId) {
              try {
                  receipt = await media.byRequest(access, project, requestId);
              }
              catch (error) {
                  if (error.status !== 404 || error.code === 'access_denied')
                      throw error;
              }
          }
          return respond(mediaView({ project, library, change, receipt, requestId }, access));
      }
      const walkRoute=url.pathname.match(/^\/(api\/)?projects\/([a-z][a-z0-9-]{0,63})\/walks(?:\/([a-z][a-z0-9-]{0,63}))?$/);
      if(walkRoute) {
        if(url.search)throw new WebError('invalid_query',400);
        const project=access.projects.find(p=>p.id===walkRoute[2]);if(!project)deny();const current=await auth.session(request);
        const model=walkRoute[3]?await walks.detail(access,current.token,project,walkRoute[3]):await walks.list(access,current.token,project);
        return walkRoute[1]?respond(JSON.stringify(model),200,'application/json'):respond(walkRoute[3]?walkView(model,access):walkIndexView(model,access));
      }
      const decisionRoute=url.pathname.match(/^\/(api\/)?projects\/([a-z][a-z0-9-]{0,63})\/(decisions|operations\/([a-f0-9]{64}))$/);
      if(decisionRoute) {
        const project=access.projects.find(p=>p.id===decisionRoute[2]);if(!project)deny();const current=await auth.session(request);let model;
        if(decisionRoute[3]==='decisions') {
          if([...url.searchParams.keys()].some(k=>!['kind','path','question'].includes(k)||url.searchParams.getAll(k).length!==1))throw new WebError('invalid_query',400);
          model=await decisions.detail(access,current.token,project,Object.fromEntries(url.searchParams));
        }else{if(url.search)throw new WebError('invalid_query',400);
          try{model=await operations.recover(access,current.token,project,decisionRoute[4]);}
          catch(error){if(decisionRoute[1]||error.code!=='operation_not_found')throw error;model={schema:1,id:decisionRoute[4],projectId:project.id,kind:'unknown',state:'uncertain',reason:'Original operation is not visible yet; an in-flight request may still reserve it. Check the same receipt; do not resubmit.',receipt:null};}
        }
        return decisionRoute[1]?respond(JSON.stringify(model),200,'application/json'):respond(decisionRoute[3]==='decisions'?decisionView(model,access):['walk','unknown'].includes(model.kind)?walkOperationView(model,access):operationView(model,access));
      }
      const projectHome = url.pathname.match(/^\/(?:api\/projects\/([a-z][a-z0-9-]{0,63})\/home|projects\/([a-z][a-z0-9-]{0,63}))$/);
      if (['/', '/api/home'].includes(url.pathname) || projectHome) {
        if ([...url.searchParams.keys()].some(key => !['cursor','fresh'].includes(key))
          || ['cursor','fresh'].some(key => url.searchParams.getAll(key).length > 1)
          || (url.searchParams.has('fresh') && url.searchParams.get('fresh') !== '1')) throw new WebError('invalid_query', 400);
        const current = await auth.session(request);
        const selectedId = projectHome ? projectHome[1] || projectHome[2] : null;
        const snapshot = await readHome(access, current.token, { projectId: selectedId, fresh: url.searchParams.has('fresh'), since: url.searchParams.get('cursor'), cacheOnly: !url.pathname.startsWith('/api/') });
        const etag = `"${snapshot.cursor}"`;
        if (url.pathname.startsWith('/api/')) {
          if (request.headers.get('if-none-match') === etag && snapshot.cursorState !== 'gap') return respond(null, 304, 'application/json', { ETag: etag });
          return respond(JSON.stringify(snapshot), 200, 'application/json', { ETag: etag });
        }
        return respond(selectedId ? projectView(access.projects.find(p => p.id === selectedId), access, snapshot) : homeView(access, snapshot));
      }
      if (url.pathname === '/api/session') return respond(JSON.stringify({ ...access, runtime: process.version }), 200, 'application/json');
      const projectRoute = url.pathname.match(/^\/(api\/)?projects\/([a-z][a-z0-9-]{0,63})(?:\/(media\/[A-Za-z0-9_-]{1,100}|stream))?$/);
      if (projectRoute) {
        const project = access.projects.find(item => item.id === projectRoute[2]);
        if (!project) deny();
        if (projectRoute[3]) return respond(JSON.stringify({ error: 'feature_unavailable' }), 501, 'application/json');
        return projectRoute[1] ? respond(JSON.stringify({ project, sourceRevision: access.sourceRevision }), 200, 'application/json') : respond(projectView(project, access));
      }
      deny();
    } catch (error) {
      const safe = error instanceof WebError ? error : new WebError('service_unavailable');
      return url?.pathname.startsWith('/api/') ? respond(JSON.stringify({ error: safe.code }), safe.status, 'application/json')
        : respond(errorView(safe.status, safe.code), safe.status);
    }
  };
}
export function unavailableResponse() { return respond(JSON.stringify({ error: 'service_not_configured' }), 503, 'application/json'); }
