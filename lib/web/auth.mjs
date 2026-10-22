import {authEpoch,matchesAuthEpoch,recoveryQuarantined} from './recovery.mjs';
import {describeRoute} from './navigation-routes.mjs';
import { random, hash, equal, opaque, WebError } from './common.mjs';

// Existing session/OAuth cookies retain their wire names across the branding migration.
export const COOKIES = { session: '__Host-keel-session', login: '__Host-keel-login', oauth: '__Host-keel-oauth' };
export const cookie = (name, value, seconds) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
export function readCookies(request) {
  const result = {};
  const header = request.headers.get('cookie') ?? '';
  if (header.length > 8192) throw new WebError('invalid_request', 400);
  for (const part of header.split(';')) {
    const index = part.indexOf('='); if (index < 0) continue;
    const key = part.slice(0, index).trim(), value = part.slice(index + 1).trim();
    if (Object.values(COOKIES).includes(key)) {
      if (Object.hasOwn(result, key) || !opaque(value)) throw new WebError('invalid_request', 400);
      result[key] = value;
    }
  }
  return result;
}
export const returnPath = value => describeRoute(value)!==null;
export function mutationOrigin(request, origin) {
  if (request.headers.get('origin') !== origin || !['same-origin', null].includes(request.headers.get('sec-fetch-site'))) throw new WebError('invalid_origin', 403);
}
export function createAuth(config, store, github, now = Date.now) {
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
      const state = random(), verifier = random(), browser = random();
      if (!await store.create('attempt', hash(state), { verifier, returnTo: form.returnTo, authEpoch:epoch }, 600, hash(browser))) throw new WebError('storage_conflict');
      if(authEpoch(config)!==epoch)throw new WebError('invalid_login',400);
      return { location: github.authorizeUrl(state, verifier), cookies: [cookie(COOKIES.oauth, browser, 600), cookie(COOKIES.login, '', 0)] };
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
      return { location: recoveryQuarantined(config)?'/recovery':attempt.value.returnTo, cookies: [cookie(COOKIES.session, raw, granted.seconds), cookie(COOKIES.oauth, '', 0)] };
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
      return { ...access, csrf: current.csrf };
    },
    async logout(request, csrf, all = false) {
      mutationOrigin(request, config.origin);
      const current = await session(request);
      if (!opaque(csrf) || !equal(csrf, current.csrf)) throw new WebError('invalid_csrf', 403);
      if (all) await store.revokeActor(String(current.userId)); else await store.revoke(current.key);
      return { location: '/signin', cookies: [cookie(COOKIES.session, '', 0), cookie(COOKIES.oauth, '', 0)] };
    },
  };
}
