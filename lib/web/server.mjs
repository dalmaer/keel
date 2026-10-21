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
export function createWebService(config, { fetcher = fetch, now = Date.now } = {}) {
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
    let url;
    try {
      url = new URL(request.url);
      if (url.origin !== config.origin || request.headers.get('host') && request.headers.get('host') !== url.host) throw new WebError('invalid_origin', 403);
      if (!['GET', 'POST'].includes(request.method)) throw new WebError('method_not_allowed', 405);
      if (request.method === 'GET' && ['/assets/plates.css', '/assets/keel.css'].includes(url.pathname)) return respond(styles, 200, 'text/css; charset=utf-8');
      if (request.method === 'GET' && ['/assets/home-client.mjs', '/assets/home-views.mjs'].includes(url.pathname)) {
        // Literal module-relative URLs let deployment tracing include both browser assets.
        const asset = url.pathname.endsWith('home-client.mjs')
          ? await readFile(new URL('./home-client.mjs', import.meta.url), 'utf8')
          : await readFile(new URL('./views.mjs', import.meta.url), 'utf8');
        return respond(asset, 200, 'text/javascript; charset=utf-8');
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
      if (request.method === 'GET' && url.pathname === '/signin') {
        const csrf = random(); return respond(signinView(csrf), 200, 'text/html; charset=utf-8', { 'Set-Cookie': cookie(COOKIES.login, csrf, 600) });
      }
      if (request.method === 'GET' && url.pathname === '/api/auth/callback') return redirect(await auth.callback(request, url));
      if (request.method === 'POST') {
        mutationOrigin(request, config.origin);
        if (url.pathname === '/api/auth/start') return redirect(await auth.start(request, await form(request, ['csrf', 'returnTo'])));
        if (['/api/auth/logout', '/api/auth/revoke'].includes(url.pathname)) {
          const data = await form(request, ['csrf']);
          return redirect(await auth.logout(request, data.csrf, url.pathname === '/api/auth/revoke'));
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
          if (result.filename!=='plates-reviewed-lessons.txt'||result.mime!=='text/plain; charset=utf-8') throw new WebError('invalid_export',503);
          return respond(result.bytes,200,result.mime,{'Content-Disposition':'attachment; filename="plates-reviewed-lessons.txt"'});
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
