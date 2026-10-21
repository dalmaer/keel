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
export function returnPath(value) {
  if(typeof value!=='string')return false;
  if(['/', '/daily', '/learning', '/setup', '/routines', '/activity'].includes(value)
    || /^\/projects\/[a-z][a-z0-9-]{0,63}(?:\/(?:daily|learning|routines|activity))?$/.test(value)
    || /^\/learning\/operations\/[a-f0-9]{64}$/.test(value))return true;
  const attempt=value.match(/^\/projects\/[a-z][a-z0-9-]{0,63}\/activity\/actions\/([1-9][0-9]{0,15})\/attempts\/([1-9][0-9]{0,15})$/);
  return !!attempt&&Number.isSafeInteger(Number(attempt[1]))&&Number.isSafeInteger(Number(attempt[2]));
}
export function mutationOrigin(request, origin) {
  if (request.headers.get('origin') !== origin || !['same-origin', null].includes(request.headers.get('sec-fetch-site'))) throw new WebError('invalid_origin', 403);
}
export function createAuth(config, store, github, now = Date.now) {
  async function session(request, refresh = false) {
    const raw = readCookies(request)[COOKIES.session];
    if (!raw) throw new WebError('sign_in_required', 401);
    const key = hash(raw), stored = await store.read('session', key);
    if (!stored || stored.value.absoluteExpiry <= now()) { await store.revoke(key); throw new WebError('sign_in_required', 401); }
    if (refresh && !await store.renew(key, stored.version, Math.max(1, Math.min(1800, Math.floor((stored.value.absoluteExpiry - now()) / 1000))))) {
      throw new WebError('sign_in_required', 401);
    }
    return { ...stored.value, key, version: stored.version };
  }
  return {
    session,
    async start(request, form) {
      mutationOrigin(request, config.origin);
      const cookies = readCookies(request);
      if (!opaque(form.csrf) || !equal(form.csrf, cookies[COOKIES.login]) || !returnPath(form.returnTo)) throw new WebError('invalid_login', 400);
      const state = random(), verifier = random(), browser = random();
      if (!await store.create('attempt', hash(state), { verifier, returnTo: form.returnTo }, 600, hash(browser))) throw new WebError('storage_conflict');
      return { location: github.authorizeUrl(state, verifier), cookies: [cookie(COOKIES.oauth, browser, 600), cookie(COOKIES.login, '', 0)] };
    },
    async callback(request, url) {
      for (const name of ['code', 'state']) if (url.searchParams.getAll(name).length !== 1) throw new WebError('invalid_callback', 400);
      const state = url.searchParams.get('state'), code = url.searchParams.get('code');
      const browser = readCookies(request)[COOKIES.oauth];
      if (!opaque(state) || !opaque(browser) || typeof code !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(code)) throw new WebError('invalid_callback', 400);
      const attempt = await store.consume(hash(state), hash(browser));
      if (!attempt || !returnPath(attempt.value.returnTo) || !opaque(attempt.value.verifier)) throw new WebError('invalid_callback', 400);
      const granted = await github.exchange(code, attempt.value.verifier);
      const access = await github.access(granted.token);
      const raw = random(), csrf = random();
      const value = { userId: access.userId, token: granted.token, csrf, absoluteExpiry: now() + granted.seconds * 1000,
        scope: hash(JSON.stringify(access.projects)) };
      if (!await store.create('session', hash(raw), value, Math.min(granted.seconds, 1800), null, String(access.userId))) throw new WebError('storage_conflict');
      const old = readCookies(request)[COOKIES.session];
      if (old) await store.revoke(hash(old));
      return { location: attempt.value.returnTo, cookies: [cookie(COOKIES.session, raw, granted.seconds), cookie(COOKIES.oauth, '', 0)] };
    },
    async authorized(request) {
      const current = await session(request);
      let access;
      try { access = await github.access(current.token, current.userId); }
      catch (error) { if (error instanceof WebError && [401, 404].includes(error.status)) await store.revoke(current.key); throw error; }
      if (current.scope !== hash(JSON.stringify(access.projects))) {
        // Privilege changes invalidate the old session; a new login rotates its identifier.
        await store.revoke(current.key); throw new WebError('sign_in_required', 401);
      }
      const seconds = Math.min(1800, Math.floor((current.absoluteExpiry - now()) / 1000));
      if (seconds <= 0 || !await store.renew(current.key, current.version, seconds)) throw new WebError('sign_in_required', 401);
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
