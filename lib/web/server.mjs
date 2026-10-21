import { readFile } from 'node:fs/promises';
import { createHomeReader } from './home.mjs';
import { WebError, random, deny } from './common.mjs';
import { createStore } from './store.mjs';
import { createGitHub } from './github.mjs';
import { createAuth, cookie, COOKIES, mutationOrigin } from './auth.mjs';
import { styles, signinView, homeView, projectView, errorView } from './views.mjs';

// Native HTML form POSTs derive Origin from this policy: no-referrer makes it null.
// Keep only the origin (never OAuth query/path data), without weakening Origin/CSRF checks.
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self'; form-action 'self' https://github.com; base-uri 'none'; frame-ancestors 'none'",
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
export function createWebService(config, { fetcher = fetch, now = Date.now } = {}) {
  return async request => {
    const deadline = AbortSignal.timeout(55000);
    const boundedFetch = (url, options = {}) => fetcher(url, { ...options, signal: AbortSignal.any([deadline, request.signal, ...(options.signal ? [options.signal] : [])]) });
    const store = createStore(config, boundedFetch), github = createGitHub(config, boundedFetch), auth = createAuth(config, store, github, now);
    const readHome = createHomeReader(config, { fetcher: boundedFetch, now });
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
        deny();
      }
      const access = await auth.authorized(request);
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
