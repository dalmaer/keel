import { nameRow, writeName } from '../names.mjs';
import { aliasValue } from './name-transition.mjs';
import {authEpoch,matchesAuthEpoch,recoveryQuarantined} from './recovery.mjs';
import {describeRoute} from './navigation-routes.mjs';
import { random, hash, equal, opaque, WebError } from './common.mjs';

// Release one: both readers, legacy writers. Activation needs a separately
// reviewed release and an owner-verified deployed compatibility rollback pin.
const COOKIE_IDS = { session: 'web:__Host-keel-session', login: 'web:__Host-keel-login', oauth: 'web:__Host-keel-oauth' };
export const COOKIES = Object.fromEntries(Object.entries(COOKIE_IDS).map(([kind, id]) => [kind, writeName(id)]));
const cookieNames = Object.values(COOKIE_IDS).flatMap(id => { const row = nameRow(id); return [row.plates, row.keel]; });
const clearCookies = (...kinds) => kinds.flatMap(kind => { const row = nameRow(COOKIE_IDS[kind]); return [row.plates, row.keel].map(name => cookie(name, '', 0)); });
export const cookie = (name, value, seconds) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
// A fresh flow replaces the alternate alias, including after rollback. This is
// not a migration of a live cookie and never runs on ordinary authorized reads.
export function issueCookies(kind, value, seconds) {
  const row = nameRow(COOKIE_IDS[kind]);
  const writer = writeName(row.id), alternate = writer === row.plates ? row.keel : row.plates;
  return [cookie(writer, value, seconds), cookie(alternate, '', 0)];
}
export function readCookies(request) {
  const result = {};
  const header = request.headers.get('cookie') ?? '';
  if (header.length > 8192) throw new WebError('invalid_request', 400);
  for (const part of header.split(';')) {
    const index = part.indexOf('='); if (index < 0) continue;
    const key = part.slice(0, index).trim(), value = part.slice(index + 1).trim();
    if (cookieNames.includes(key)) {
      if (Object.hasOwn(result, key) || !opaque(value)) throw new WebError('invalid_request', 400);
      result[key] = value;
    }
  }
  const normalized = {};
  for (const [kind, id] of Object.entries(COOKIE_IDS)) {
    const value = aliasValue(id, name => result[name]);
    if (value !== undefined) normalized[COOKIES[kind]] = value;
  }
  return normalized;
}
export const returnPath = value => describeRoute(value)!==null;
export function mutationOrigin(request, origin) {
  if (request.headers.get('origin') !== origin || !['same-origin', null].includes(request.headers.get('sec-fetch-site'))) throw new WebError('invalid_origin', 403);
}
export function createAuth(config, store, github, now = Date.now) {
  let pendingSessionAlias = null;
  const sameSession = (value, current, epoch) => matchesAuthEpoch(config,value,epoch)
    && ['userId','token','csrf','scope','absoluteExpiry'].every(key => value?.[key] === current[key]);
  async function session(request, refresh = false) {
    const epoch = authEpoch(config);
    const raw = readCookies(request)[COOKIES.session];
    if (!raw) throw new WebError('sign_in_required', 401);
    const key = hash(raw), stored = await store.read('session', key);
    if (!stored || !matchesAuthEpoch(config,stored.value,epoch) || stored.value.absoluteExpiry <= now()) { await store.revoke(key); throw new WebError('sign_in_required', 401); }
    if (refresh) {
      const renewed=await store.renew(key,stored.version,Math.max(1,Math.min(1800,Math.floor((stored.value.absoluteExpiry-now())/1000))));
      if(!renewed||!sameSession(renewed.value,stored.value,epoch))throw new WebError('sign_in_required',401);
    }
    return { ...stored.value, key, version: stored.version };
  }
  return {
    session,
    // Only authenticated candidate responses migrate a session. Compute the TTL
    // at response time; do not renew the store or invent a flow-cookie lifetime.
    responseCookies() {
      const pending = pendingSessionAlias;
      if (!pending || authEpoch(config) !== pending.epoch) return [];
      const seconds = Math.floor((pending.absoluteExpiry - now()) / 1000);
      return seconds > 0 ? issueCookies('session', pending.raw, seconds) : [];
    },
    // Worker callbacks resolve only an opaque server-side reference. They cannot
    // renew the owner's idle lifetime or disclose this result through a route.
    async resolveInitiator(sessionRef,actorId) {
      const epoch=authEpoch(config);
      if(recoveryQuarantined(config))throw new WebError('recovery_quarantine',503);
      if(typeof sessionRef!=='string'||!/^[a-f0-9]{64}$/.test(sessionRef)||!Number.isSafeInteger(actorId)||actorId<1)throw new WebError('sign_in_required',401);
      const stored=await store.read('session',sessionRef),current=stored?.value;
      if(!current||!matchesAuthEpoch(config,current,epoch)||current.userId!==actorId
        ||typeof current.token!=='string'||current.token.length<1||current.token.length>4096
        ||!Number.isSafeInteger(current.absoluteExpiry)||current.absoluteExpiry<=now()
        ||typeof current.scope!=='string'||!/^[a-f0-9]{64}$/.test(current.scope))throw new WebError('sign_in_required',401);
      const access=await github.access(current.token,current.userId);
      if(current.scope!==hash(JSON.stringify(access.projects)))throw new WebError('sign_in_required',401);
      // A concurrent logout or expiry wins even if provider authorization succeeded.
      const latest=await store.read('session',sessionRef);
      if(recoveryQuarantined(config)||!latest||!matchesAuthEpoch(config,latest.value,epoch)||latest.version!==stored.version||latest.value.absoluteExpiry<=now()
        ||latest.value.userId!==current.userId||latest.value.token!==current.token
        ||latest.value.scope!==current.scope)throw new WebError('sign_in_required',401);
      return {access,token:current.token};
    },
    async start(request, form) {
      mutationOrigin(request, config.origin);
      const cookies = readCookies(request);
      if (!opaque(form.csrf) || !equal(form.csrf, cookies[COOKIES.login]) || !returnPath(form.returnTo)) throw new WebError('invalid_login', 400);
      const epoch=authEpoch(config);
      // One bounded marker fences replay through either browser alias, including
      // concurrent starts on different releases. It outlives the original
      // remaining browser lifetime without extending that lifetime.
      if (!await store.create('record', hash(`login-csrf:${form.csrf}`), { consumed: true, authEpoch: epoch }, 600)) throw new WebError('invalid_login', 400);
      const state = random(), verifier = random(), browser = random();
      if (!await store.create('attempt', hash(state), { verifier, returnTo: form.returnTo, authEpoch:epoch }, 600, hash(browser))) throw new WebError('storage_conflict');
      if(authEpoch(config)!==epoch)throw new WebError('invalid_login',400);
      return { location: github.authorizeUrl(state, verifier), cookies: [...issueCookies('oauth', browser, 600), ...clearCookies('login')] };
    },
    async callback(request, url) {
      const epoch=authEpoch(config);
      for (const name of ['code', 'state']) if (url.searchParams.getAll(name).length !== 1) throw new WebError('invalid_callback', 400);
      const state = url.searchParams.get('state'), code = url.searchParams.get('code');
      const browser = readCookies(request)[COOKIES.oauth];
      if (!opaque(state) || !opaque(browser) || typeof code !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(code)) throw new WebError('invalid_callback', 400);
      const attempt = await store.consume(hash(state), hash(browser));
      if (!attempt || !matchesAuthEpoch(config,attempt.value,epoch) || !returnPath(attempt.value.returnTo) || !opaque(attempt.value.verifier)) throw new WebError('invalid_callback', 400);
      const granted = await github.exchange(code, attempt.value.verifier);
      if(authEpoch(config)!==epoch)throw new WebError('invalid_callback',400);
      const access = await github.access(granted.token);
      if(authEpoch(config)!==epoch)throw new WebError('invalid_callback',400);
      const raw = random(), csrf = random();
      const value = { userId: access.userId, token: granted.token, csrf, absoluteExpiry: now() + granted.seconds * 1000,
        scope: hash(JSON.stringify(access.projects)), authEpoch:epoch };
      if (!await store.create('session', hash(raw), value, Math.min(granted.seconds, 1800), null, String(access.userId))) throw new WebError('storage_conflict');
      if(authEpoch(config)!==epoch){await store.revoke(hash(raw));throw new WebError('invalid_callback',400);}
      const old = readCookies(request)[COOKIES.session];
      if (old) await store.revoke(hash(old));
      if(authEpoch(config)!==epoch)throw new WebError('invalid_callback',400);
      return { location: recoveryQuarantined(config)?'/recovery':attempt.value.returnTo, cookies: [...issueCookies('session', raw, granted.seconds), ...clearCookies('oauth')] };
    },
    async authorized(request) {
      const epoch=authEpoch(config);
      const current = await session(request);
      let access;
      try { access = await github.access(current.token, current.userId); }
      catch (error) { if (error instanceof WebError && [401, 404].includes(error.status)) await store.revoke(current.key); throw error; }
      if (!matchesAuthEpoch(config,current,epoch) || current.scope !== hash(JSON.stringify(access.projects))) {
        // Privilege changes invalidate the old session; a new login rotates its identifier.
        await store.revoke(current.key); throw new WebError('sign_in_required', 401);
      }
      const seconds = Math.min(1800, Math.floor((current.absoluteExpiry - now()) / 1000));
      if(seconds<=0)throw new WebError('sign_in_required',401);
      const renewed=await store.renew(current.key,current.version,seconds);
      if(!renewed||!sameSession(renewed.value,current,epoch))throw new WebError('sign_in_required',401);
      const row = nameRow(COOKIE_IDS.session);
      // readCookies already rejected conflicting aliases. Inspect presence only
      // to avoid reissuing a plates-only cookie on every ordinary request.
      const names = (request.headers.get('cookie') ?? '').split(';').map(part => part.slice(0, part.indexOf('=')).trim());
      if (writeName(row.id) === row.plates && names.includes(row.keel)) {
        pendingSessionAlias = { raw: readCookies(request)[COOKIES.session], absoluteExpiry: current.absoluteExpiry, epoch };
      }
      return { ...access, csrf: current.csrf };
    },
    async logout(request, csrf, all = false) {
      mutationOrigin(request, config.origin);
      const current = await session(request);
      if (!opaque(csrf) || !equal(csrf, current.csrf)) throw new WebError('invalid_csrf', 403);
      if (all) await store.revokeActor(String(current.userId)); else await store.revoke(current.key);
      return { location: '/signin', cookies: clearCookies('session', 'login', 'oauth') };
    },
  };
}
