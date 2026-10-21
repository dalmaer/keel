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
