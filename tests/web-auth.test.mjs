import { nameCandidate, browserJar } from './helpers/web-name-candidate.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers/web-http.mjs';

test('login binds browser, uses PKCE, consumes state once across instances and keeps credentials server-side', async () => {
  const h = harness(), attempt = await h.begin();
  const target = new URL(attempt.started.headers.get('location'));
  assert.equal(target.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(target.searchParams.get('redirect_uri'), `${h.config.origin}/api/auth/callback`);
  assert.equal((await h.service(h.request(attempt.path))).status, 400);
  const wrong = attempt.cookie.replace(/=.*/, `=${'b'.repeat(43)}`);
  assert.equal((await h.service(h.request(attempt.path, { cookie: wrong }))).status, 400);
  const responses = await Promise.all([h.service, h.makeService()].map(service => service(h.request(attempt.path, { cookie: attempt.cookie }))));
  assert.deepEqual(responses.map(r => r.status).sort(), [303, 400]);
  const success = responses.find(r => r.status === 303);
  for (const entry of success.headers.getSetCookie()) {
    assert.match(entry, /Secure; HttpOnly; SameSite=Lax/); assert.doesNotMatch(entry, /Domain=/);
    assert.doesNotMatch(entry, /fake-user|fake-client/);
  }
  assert.equal(h.state.requests.filter(r => r.url === 'https://github.com/login/oauth/access_token').length, 1);
  assert.equal((await h.service(h.request(attempt.path, { cookie: attempt.cookie }))).status, 400);
});

test('expired attempts, malformed and duplicate state, and unsafe return paths fail closed', async () => {
  for (const destination of ['//evil.test', 'https://evil.test', '/%2f%2fevil.test', '/projects/../settings', '/api/auth/callback', '/?secret=x']) {
    const h = harness(); assert.equal((await h.begin(destination)).started.status, 400, destination);
  }
  const h = harness(), attempt = await h.begin(); h.state.now += 601000;
  assert.equal((await h.service(h.request(attempt.path, { cookie: attempt.cookie }))).status, 400);
  assert.equal((await h.service(h.request(`${attempt.path}&state=duplicate`, { cookie: attempt.cookie }))).status, 400);
  assert.equal(h.state.requests.some(r => r.url.includes('/access_token')), false);
});

test('session login rotates, logout removes server state, and idle/absolute expiry are enforced', async () => {
  const h = harness(), first = await h.login(), second = await h.login(first.cookie);
  assert.notEqual(first.cookie, second.cookie);
  assert.equal((await h.service(h.request('/api/session', { cookie: first.cookie }))).status, 401);
  const logout = await h.service(h.request('/api/auth/logout', { cookie: second.cookie, body: { csrf: second.session.csrf } }));
  assert.equal(logout.status, 303);
  assert.equal((await h.service(h.request('/api/session', { cookie: second.cookie }))).status, 401);
  const third = await h.login(); h.state.now += 1801000;
  assert.equal((await h.service(h.request('/api/session', { cookie: third.cookie }))).status, 401);
  const fourth = await h.login();
  for (let i = 0; i < 15; i++) { h.state.now += 1800000 - 1000; assert.equal((await h.service(h.request('/api/session', { cookie: fourth.cookie }))).status, 200); }
  h.state.now += 1800000 + 15000;
  assert.equal((await h.service(h.request('/api/session', { cookie: fourth.cookie }))).status, 401);
});

test('revoke ends every session for that owner and privilege changes require a new session', async () => {
  const h = harness(), first = await h.login(), second = await h.login();
  assert.equal((await h.service(h.request('/api/auth/revoke', { cookie: first.cookie, body: { csrf: first.session.csrf } }))).status, 303);
  for (const cookie of [first.cookie, second.cookie]) assert.equal((await h.service(h.request('/api/session', { cookie }))).status, 401);
  const third = await h.login(); h.state.repoAccess = false;
  assert.equal((await h.service(h.request('/api/session', { cookie: third.cookie }))).status, 401);
  h.state.repoAccess = true;
  assert.equal((await h.service(h.request('/api/session', { cookie: third.cookie }))).status, 401);
});


test('compatibility baseline reads both cookie families with legacy writers and unchanged flow expiry', async () => {
  for (const prefix of ['plates', 'keel']) {
    const h = harness();
    const page = await h.service(h.request('/signin'));
    const old = h.cookieHeader(page), csrf = old.split('=')[1];
    assert.match(old, /^__Host-keel-login=/);
    const started = await h.service(h.request('/api/auth/start', { cookie: old.replace('__Host-keel-', `__Host-${prefix}-`), body: { csrf, returnTo: '/' } }));
    assert.equal(started.status, 303);
    const target = new URL(started.headers.get('location'));
    h.state.challenges.add(target.searchParams.get('code_challenge'));
    const flow = h.cookieHeader(started);
    assert.match(flow, /^__Host-keel-oauth=/);
    h.state.now += 590000;
    const completed = await h.makeService()(h.request(`/api/auth/callback?code=fake-code&state=${target.searchParams.get('state')}`, { cookie: flow.replace('__Host-keel-', `__Host-${prefix}-`) }));
    assert.equal(completed.status, 303);
    const oldSession = h.cookieHeader(completed), session = oldSession.replace('__Host-keel-', `__Host-${prefix}-`);
    assert.match(oldSession, /^__Host-keel-session=/);
    const response = await h.makeService()(h.request('/api/session', { cookie: session }));
    assert.equal(response.status, 200);
    const data = await response.json();
    const logout = await h.service(h.request('/api/auth/logout', { cookie: session, body: { csrf: data.csrf } }));
    assert.equal(logout.status, 303);
    assert.equal(logout.headers.getSetCookie().length, 6);
    for (const family of ['plates', 'keel']) {
      for (const kind of ['session', 'login', 'oauth']) assert.ok(logout.headers.getSetCookie().some(c => c.startsWith(`__Host-${family}-${kind}=`) && c.includes('Max-Age=0')));
      assert.equal((await h.service(h.request('/api/session', { cookie: oldSession.replace('__Host-keel-', `__Host-${family}-`) }))).status, 401);
    }
    const expired = await h.begin(); h.state.now += 601000;
    assert.equal((await h.makeService()(h.request(expired.path, { cookie: expired.cookie.replace('__Host-keel-', `__Host-${prefix}-`) }))).status, 400);
    const live = await h.login(); h.state.now += 1801000;
    assert.equal((await h.makeService()(h.request('/api/session', { cookie: live.cookie.replace('__Host-keel-', `__Host-${prefix}-`) }))).status, 401);
  }
});

test('identical cookie aliases consume once and conflicting aliases refuse before side effects', async () => {
  const { readCookies, COOKIES } = await import('../lib/web/auth.mjs');
  for (const kind of ['session', 'login', 'oauth']) {
    const value = 'a'.repeat(43), other = 'b'.repeat(43);
    const request = cookie => new Request('https://acme.test', { headers: { cookie } });
    assert.equal(readCookies(request(`__Host-plates-${kind}=${value}; __Host-keel-${kind}=${value}`))[COOKIES[kind]], value);
    assert.throws(() => readCookies(request(`__Host-plates-${kind}=${value}; __Host-keel-${kind}=${other}`)), /conflicting_names/);
  }
  const h = harness(), attempt = await h.begin();
  const both = `${attempt.cookie}; ${attempt.cookie.replace('__Host-keel-', '__Host-plates-')}`;
  const replies = await Promise.all([h.service, h.makeService()].map(service => service(h.request(attempt.path, { cookie: both }))));
  assert.deepEqual(replies.map(r => r.status).sort(), [303, 400]);
});


// A browser applies deletion and replacement independently by cookie name.
// Dropping cleared cookies from a response-only fixture hides surviving aliases.
for (const existingKind of ['login', 'oauth', 'session']) test(`rollback browser replaces existing plates ${existingKind} across re-login`, async () => {
  const h = harness(), jar = new Map();
  const apply = response => {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';'), index = pair.indexOf('='), name = pair.slice(0, index), value = pair.slice(index+1);
      const seconds = Number(/Max-Age=(\d+)/.exec(line)[1]);
      if (seconds === 0) jar.delete(name);
      else jar.set(name, { value, expires: h.state.now + seconds * 1000 });
    }
  };
  const header = () => [...jar].filter(([, c]) => c.expires > h.state.now).map(([name, c]) => `${name}=${c.value}`).join('; ');
  const response = async (path, body) => {
    const reply = await h.makeService()(h.request(path, { cookie: header(), ...(body ? { body } : {}) }));
    apply(reply); return reply;
  };
  if (existingKind === 'session') {
    const prior = await h.login(); apply(prior.completed);
    jar.set('__Host-plates-session', jar.get('__Host-keel-session')); jar.delete('__Host-keel-session');
  } else jar.set(`__Host-plates-${existingKind}`, { value: 'a'.repeat(43), expires: h.state.now + 500000 });
  const onlyLegacy = kind => {
    assert.equal(jar.has(`__Host-plates-${kind}`), false, `${kind}: fresh legacy issuance must clear its plates alias`);
    assert.equal(jar.has(`__Host-keel-${kind}`), true);
  };
  for (let login = 0; login < 2; login++) {
    const signin = await response('/signin'); assert.equal(signin.status, 200); onlyLegacy('login');
    const csrf = jar.get('__Host-keel-login').value;
    const started = await response('/api/auth/start', { csrf, returnTo: '/' });
    assert.equal(started.status, 303); onlyLegacy('oauth');
    assert.equal(jar.has('__Host-keel-login'), false); assert.equal(jar.has('__Host-plates-login'), false);
    const target = new URL(started.headers.get('location')); h.state.challenges.add(target.searchParams.get('code_challenge'));
    const completed = await response(`/api/auth/callback?code=fake-code&state=${target.searchParams.get('state')}`);
    assert.equal(completed.status, 303); onlyLegacy('session');
    assert.equal(jar.has('__Host-keel-oauth'), false); assert.equal(jar.has('__Host-plates-oauth'), false);
    // Simulate rollback receiving a plates session from a future build without
    // changing its value or browser deadline. The baseline must consume it.
    jar.set('__Host-plates-session', jar.get('__Host-keel-session')); jar.delete('__Host-keel-session');
    const before = structuredClone([...jar]); h.state.now += 30000;
    const current = await response('/api/session'); assert.equal(current.status, 200);
    assert.deepEqual(current.headers.getSetCookie(), []);
    assert.deepEqual([...jar], before, 'ordinary authorization must not renew browser cookie expiry');
  }
});


test('a keel session survives, and leaves as a plates one', async t => {
  const candidate = await nameCandidate(t), h = harness(), jar = browserJar(() => h.state.now);
  const baseline = await h.login(); jar.apply(baseline.completed);
  const original = structuredClone(jar.entries.get('__Host-keel-session'));
  const upgraded = candidate.server.createWebService(h.config, { fetcher: h.fetcher, now: () => h.state.now });
  h.state.now += 30123;
  const previousCalls = h.state.requests.length;
  const response = await upgraded(h.request('/api/session', { cookie: jar.header() }));
  assert.equal(response.status, 200);
  jar.apply(response);
  assert.equal(jar.entries.has('__Host-keel-session'), false);
  const current = jar.entries.get('__Host-plates-session');
  assert.equal(current.value, original.value);
  assert.equal(current.expires, h.state.now + Math.floor((original.expires-h.state.now)/1000)*1000);
  const operations = h.state.requests.slice(previousCalls).filter(r => r.url.includes('/rpc/')).map(r => JSON.parse(r.options.body).p_operation);
  assert.equal(operations.filter(op => op === 'renew').length, 1, 'migration adds no idle renewal to existing authorization');
  const before = structuredClone([...jar.entries]);
  h.state.now += 10000;
  const ordinary = await upgraded(h.request('/api/session', { cookie: jar.header() }));
  assert.equal(ordinary.status, 200); assert.deepEqual(ordinary.headers.getSetCookie(), []);
  jar.apply(ordinary); assert.deepEqual([...jar.entries], before);
  const rollback = await h.makeService()(h.request('/api/session', { cookie: jar.header() }));
  assert.equal(rollback.status, 200); assert.deepEqual(rollback.headers.getSetCookie(), []);
  // Both identical aliases are one session and remove only the legacy name.
  jar.entries.set('__Host-keel-session', structuredClone(current));
  const both = await upgraded(h.request('/api/session', { cookie: jar.header() }));
  assert.equal(both.status, 200); jar.apply(both);
  assert.equal(jar.entries.has('__Host-keel-session'), false);
  const logout = await h.makeService()(h.request('/api/auth/logout', { cookie: jar.header(), body: { csrf: baseline.session.csrf } }));
  assert.equal(logout.status, 303); jar.apply(logout); assert.equal(jar.entries.size, 0);
  for (const name of ['__Host-keel-session','__Host-plates-session']) for (const service of [h.makeService(), upgraded])
    assert.equal((await service(h.request('/api/session', { cookie: `${name}=${original.value}` }))).status, 401);
});

test('cookie cutover survives rollback to the compatibility baseline', async t => {
  const candidate = await nameCandidate(t);
  // Every transition boundary independently crosses releases in each direction.
  for (const modes of [[0,1,0], [1,0,1], [1,1,0], [0,0,1]]) {
    const h = harness(), jar = browserJar(() => h.state.now);
    const services = [h.makeService(), candidate.server.createWebService(h.config, { fetcher: h.fetcher, now: () => h.state.now })];
    const send = async (mode, path, body) => {
      const response = await services[mode](h.request(path, { cookie: jar.header(), ...(body ? { body } : {}) }));
      jar.apply(response); return response;
    };
    for (let round=0; round<2; round++) {
      const signin = await send(modes[0], '/signin'); assert.equal(signin.status, 200);
      const loginName = modes[0] ? '__Host-plates-login' : '__Host-keel-login';
      assert.equal(jar.entries.has(loginName), true);
      assert.equal(jar.entries.has(modes[0] ? '__Host-keel-login' : '__Host-plates-login'), false);
      const login = structuredClone(jar.entries.get(loginName));
      h.state.now += 15000;
      const untouched = await send(modes[1], '/assets/plates.css');
      assert.deepEqual(untouched.headers.getSetCookie(), []); assert.deepEqual(jar.entries.get(loginName), login);
      const started = await send(modes[1], '/api/auth/start', { csrf: login.value, returnTo: '/' });
      assert.equal(started.status, 303);
      for (const name of ['__Host-plates-login','__Host-keel-login']) assert.equal(jar.entries.has(name), false);
      const oauthName = modes[1] ? '__Host-plates-oauth' : '__Host-keel-oauth';
      const oauth = structuredClone(jar.entries.get(oauthName)); assert.ok(oauth);
      const target = new URL(started.headers.get('location')); h.state.challenges.add(target.searchParams.get('code_challenge'));
      const callback = `/api/auth/callback?code=fake-code&state=${target.searchParams.get('state')}`;
      h.state.now += 30000;
      const unconsumed = await send(modes[2], '/assets/plates.css');
      assert.deepEqual(unconsumed.headers.getSetCookie(), []); assert.deepEqual(jar.entries.get(oauthName), oauth);
      const completed = await send(modes[2], callback); assert.equal(completed.status, 303);
      for (const name of ['__Host-plates-oauth','__Host-keel-oauth']) assert.equal(jar.entries.has(name), false);
      const sessionName = modes[2] ? '__Host-plates-session' : '__Host-keel-session';
      assert.equal(jar.entries.has(sessionName), true);
      assert.equal(jar.entries.has(modes[2] ? '__Host-keel-session' : '__Host-plates-session'), false);
      // The consumed original flow cannot be revived using either cookie name.
      for (const name of ['__Host-plates-oauth','__Host-keel-oauth'])
        assert.equal((await services[1-modes[2]](h.request(callback, { cookie: `${name}=${oauth.value}` }))).status, 400);
      assert.equal((await send(0, '/api/session')).status, 200);
      assert.equal((await send(1, '/api/session')).status, 200);
    }
    const raw = [...jar.entries.values()][0].value;
    h.state.now += 1801000;
    for (const service of services) {
      const expired = await service(h.request('/api/session', { cookie: `__Host-plates-session=${raw}` }));
      assert.equal(expired.status, 401); assert.deepEqual(expired.headers.getSetCookie(), []);
    }
  }
});

test('candidate responses never issue an expired alias or refresh an unconsumed OAuth flow', async t => {
  const candidate = await nameCandidate(t), h = harness(), baseline = await h.login();
  const upgraded = candidate.server.createWebService(h.config, { fetcher: h.fetcher, now: () => h.state.now });
  h.state.now += 28800001;
  const expired = await upgraded(h.request('/api/session', { cookie: baseline.cookie }));
  assert.equal(expired.status, 401); assert.deepEqual(expired.headers.getSetCookie(), []);
  const attempt = await h.begin(); h.state.now += 601000;
  const callback = await upgraded(h.request(attempt.path, { cookie: attempt.cookie }));
  assert.equal(callback.status, 400); assert.deepEqual(callback.headers.getSetCookie(), []);
});


test('login CSRF consumes once across aliases and baseline/candidate instances', async t => {
  const candidate = await nameCandidate(t);
  for (const issuer of [0,1]) {
    const h = harness(), services = [h.makeService(), candidate.server.createWebService(h.config, { fetcher: h.fetcher, now: () => h.state.now })];
    const page = await services[issuer](h.request('/signin'));
    const raw = h.cookieHeader(page).split('=')[1];
    const calls = [0,1].map(index => services[index](h.request('/api/auth/start', {
      cookie: `__Host-${index ? 'plates' : 'keel'}-login=${raw}`, body: { csrf: raw, returnTo: '/' },
    })));
    const responses = await Promise.all(calls);
    assert.deepEqual(responses.map(r => r.status).sort(), [303,400]);
    assert.equal([...h.state.records.keys()].filter(key => key.startsWith('attempt:')).length, 1);
    assert.deepEqual(responses.find(r => r.status === 400).headers.getSetCookie(), []);
  }
});

test('candidate refuses conflicting sessions before effects and revoke clears both releases', async t => {
  const candidate = await nameCandidate(t), h = harness(), login = await h.login();
  const service = candidate.server.createWebService(h.config, { fetcher: h.fetcher, now: () => h.state.now });
  const oldRaw = login.cookie.split('=')[1], count = h.state.requests.length;
  const conflict = await service(h.request('/api/session', { cookie: `${login.cookie}; __Host-plates-session=${'x'.repeat(43)}` }));
  assert.equal(conflict.status, 400); assert.deepEqual(conflict.headers.getSetCookie(), []); assert.equal(h.state.requests.length, count);
  const migrated = await service(h.request('/api/session', { cookie: login.cookie }));
  const newer = h.cookieHeader(migrated);
  const second = await h.login();
  const revoke = await service(h.request('/api/auth/revoke', { cookie: newer, body: { csrf: login.session.csrf } }));
  assert.equal(revoke.status, 303); assert.equal(revoke.headers.getSetCookie().length, 6);
  for (const raw of [oldRaw,second.cookie.split('=')[1]]) for (const name of ['__Host-keel-session','__Host-plates-session']) for (const reader of [h.makeService(),service])
    assert.equal((await reader(h.request('/api/session', { cookie: `${name}=${raw}` }))).status, 401);
});


for (const kind of ['login','oauth','session']) test(`candidate fresh ${kind} clears existing legacy alias`, async t => {
  const candidate = await nameCandidate(t), h = harness(), jar = browserJar(() => h.state.now);
  if (kind === 'session') jar.apply((await h.login()).completed);
  else jar.entries.set(`__Host-keel-${kind}`, { value: 'a'.repeat(43), expires: h.state.now+500000 });
  const service = candidate.server.createWebService(h.config, { fetcher: h.fetcher, now: () => h.state.now });
  const send = async (path, body) => {
    const reply = await service(h.request(path, { cookie: jar.header(), ...(body ? { body } : {}) })); jar.apply(reply); return reply;
  };
  const page = await send('/signin'); assert.equal(page.status, 200);
  assert.equal(jar.entries.has('__Host-keel-login'), false); assert.ok(jar.entries.get('__Host-plates-login'));
  const start = await send('/api/auth/start', { csrf: jar.entries.get('__Host-plates-login').value, returnTo: '/' });
  assert.equal(start.status, 303); assert.equal(jar.entries.has('__Host-keel-oauth'), false); assert.ok(jar.entries.get('__Host-plates-oauth'));
  const target = new URL(start.headers.get('location')); h.state.challenges.add(target.searchParams.get('code_challenge'));
  const done = await send(`/api/auth/callback?code=fake-code&state=${target.searchParams.get('state')}`);
  assert.equal(done.status, 303); assert.equal(jar.entries.has('__Host-keel-session'), false); assert.ok(jar.entries.get('__Host-plates-session'));
});

test('pending candidate alias uses response time and never emits after expiry or epoch change', async t => {
  const { createStore } = await import('../lib/web/store.mjs');
  const { createGitHub } = await import('../lib/web/github.mjs');
  const candidate = await nameCandidate(t), h = harness(), login = await h.login();
  const auth = candidate.auth.createAuth(h.config, createStore(h.config,h.fetcher), createGitHub(h.config,h.fetcher), () => h.state.now);
  const absoluteExpiry = h.state.now+28800000;
  h.state.now += 10000;
  await auth.authorized(h.request('/api/session', { cookie: login.cookie }));
  const count = h.state.requests.length;
  h.state.now += 10234;
  const entries = auth.responseCookies();
  assert.match(entries[0], new RegExp(`Max-Age=${Math.floor((absoluteExpiry-h.state.now)/1000)}$`));
  h.config.recovery = { epoch: 'b'.repeat(32), startedAt: new Date(h.state.now).toISOString(), reconciledAt: null };
  assert.deepEqual(auth.responseCookies(), []);
  delete h.config.recovery;
  h.state.now = absoluteExpiry+1;
  assert.deepEqual(auth.responseCookies(), []); assert.equal(h.state.requests.length, count);
});
