import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesGlob } from 'node:path';
import { readFile } from 'node:fs/promises';
import { harness } from './helpers/web-http.mjs';
import { configFromEnv, webConfig, requireRuntime } from '../lib/web/config.mjs';

test('mutations reject foreign origin, absent/wrong CSRF and duplicate form inputs', async () => {
  const h = harness(), signed = await h.login();
  const signin = await h.service(h.request('/signin')), loginCookie = h.cookieHeader(signin);
  const loginCsrf = loginCookie.split('=')[1];
  for (const origin of ['https://evil.test', 'null', '']) {
    const result = await h.service(h.request('/api/auth/start', { cookie: loginCookie, origin, body: { csrf: loginCsrf, returnTo: '/' } }));
    assert.equal(result.status, 403, 'login still requires the exact trusted Origin');
  }
  for (const csrf of ['', 'x'.repeat(43)]) {
    const result = await h.service(h.request('/api/auth/start', { cookie: loginCookie, body: { csrf, returnTo: '/' } }));
    assert.equal(result.status, 400, 'login still requires the browser-bound CSRF token');
  }
  for (const route of ['/api/auth/logout', '/api/auth/revoke']) {
    for (const origin of ['https://evil.test', 'null', '']) {
      const result = await h.service(h.request(route, { cookie: signed.cookie, origin, body: { csrf: signed.session.csrf } })); assert.equal(result.status, 403);
    }
    for (const csrf of ['', 'x'.repeat(43)]) assert.equal((await h.service(h.request(route, { cookie: signed.cookie, body: { csrf } }))).status, 403);
  }
  const duplicate = new Request(`${h.config.origin}/api/auth/logout`, { method: 'POST', headers: { cookie: signed.cookie, origin: h.config.origin,
    'content-type': 'application/x-www-form-urlencoded' }, body: `csrf=${signed.session.csrf}&csrf=${signed.session.csrf}` });
  assert.equal((await h.service(duplicate)).status, 400);
  assert.equal((await h.service(new Request('https://evil.test/api/session', { headers: { cookie: signed.cookie } }))).status, 403);
  assert.equal((await h.service(h.request('/api/session', { cookie: signed.cookie }))).status, 200);
});

test('public signin/assets and signed-in scaffold are responsive, escaped and never expose tokens or config', async () => {
  const h = harness();
  for (const path of ['/signin', '/assets/plates.css', '/assets/home-client.mjs', '/assets/home-views.mjs', '/assets/decision-client.mjs', '/assets/decision-views.mjs', '/assets/decision.css']) {
    const response = await h.service(h.request(path)), content = await response.text();
    assert.equal(response.status, 200); assert.doesNotMatch(content, /fake-client|fake-service|fake-user|supabase\.co|PLATES_WEB_CONFIG/);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(response.headers.get('content-security-policy'), /form-action 'self' https:\/\/github\.com;/);
    // Browser navigation POSTs need a non-null Origin; referrers must omit paths/queries.
    // This asserts the response contract, not a simulation of browser header generation.
    assert.equal(response.headers.get('referrer-policy'), 'strict-origin');
  }
  const signin = await (await h.service(h.request('/signin'))).text();
  assert.match(signin, /name="viewport"/); assert.match(signin, /<form method="post"/); assert.match(signin, /Skip to content/);
  const signed = await h.login();
  for (const path of ['/', '/api/session', '/projects/studio']) {
    const content = await (await h.service(h.request(path, { cookie: signed.cookie }))).text();
    assert.doesNotMatch(content, /fake-user-access|fake-client-secret|fake-service-key|encryptionKey/);
  }
});

test('configuration rejects ambient, preview, non-HTTPS and identity-less bindings', async () => {
  const h = harness();
  assert.throws(() => configFromEnv({}), /invalid_service_configuration/);
  assert.throws(() => configFromEnv({ VERCEL_ENV: 'preview' }), /preview_not_configured/);
  for (const change of [value => { value.origin = 'http://localhost'; }, value => { value.origin += '/'; }, value => { value.ownerIds = ['acme']; },
    value => { value.workspace.repoId = 'acme/plates-private'; }, value => { value.workspace.manifestPath = '../workspace.json'; },
    value => { value.projectRepoIds.studio = 101; }, value => { value.unknown = true; }]) {
    const value = structuredClone(h.input); change(value); assert.throws(() => webConfig(value, h.secrets), /invalid_service_configuration/);
  }
  const config = configFromEnv({ PLATES_WEB_CONFIG: JSON.stringify(h.input), PLATES_GITHUB_CLIENT_SECRET: h.secrets.clientSecret,
    SUPABASE_URL: h.secrets.storageUrl, SUPABASE_SERVICE_ROLE_KEY: h.secrets.storageKey, PLATES_SESSION_ENCRYPTION_KEY: h.secrets.encryptionKey });
  assert.equal(config.storageUrl, h.secrets.storageUrl);
});

test('migration restricts public roles and deployment routes all requests through the auth service', async () => {
  const sql = await readFile(new URL('../lib/web/migrations/001-auth.sql', import.meta.url), 'utf8');
  assert.match(sql, /enable row level security/); assert.match(sql, /security definer set search_path = ''/);
  assert.match(sql, /revoke all on function .* from public, anon, authenticated/);
  assert.match(sql, /grant execute on function .* to service_role/);
  const deployment = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(deployment.rewrites, [{ source: '/(.*)', destination: '/api' }]);
  const excluded = deployment.functions['api/index.mjs'].excludeFiles;
  for (const path of ['tests/fixtures/improve/unhealthy/.agents/skills/conduct', 'docs/lessons.md', '.plates/plates.json']) assert.ok(matchesGlob(path, excluded), path);
  for (const path of ['lib/web/home-client.mjs', 'lib/web/views.mjs', 'lib/board.mjs', 'practices/phases/files/scripts/roadmap.mjs']) assert.ok(!matchesGlob(path, excluded), path);
});

test('service enforces the supported runtime boundary', () => {
  for (const version of ['22.99.0', '24.20.9', 'invalid']) assert.throws(() => requireRuntime(version), /unsupported_runtime/);
  for (const version of ['24.21.0', '24.22.0', '26.0.0']) assert.doesNotThrow(() => requireRuntime(version));
});

test('extracted npm package launches with external config and serves through the real HTTP boundary', async t => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const { run, runAsync } = await import('./helpers/run.mjs');
  const temporary = await mkdtemp(join(tmpdir(), 'plates-web-package-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const packed = run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: resolve('.') });
  assert.equal(packed.status, 0, packed.stderr);
  const metadata = JSON.parse(packed.stdout)[0], paths = metadata.files.map(file => file.path);
  for (const path of ['lib/web/serve.mjs', 'lib/web/migrations/001-auth.sql', 'api/index.mjs', 'vercel.json']) assert.ok(paths.includes(path), path);
  assert.equal(paths.some(path => /(^|\/)(\.env|members\.json|instance\.json)$/.test(path)), false);
  assert.equal(run('tar', ['-xzf', join(temporary, metadata.filename), '-C', temporary]).status, 0);
  // Model the function's excluded development/source-data trees before loading it.
  for (const path of ['tests', 'docs', '.agents', '.claude', '.plates', '.github']) await rm(join(temporary, 'package', path), { recursive: true, force: true });
  const h = harness(), configPath = join(temporary, 'instance.json');
  await writeFile(configPath, JSON.stringify(h.input), { mode: 0o600 });
  const script = join(temporary, 'probe.mjs');
  await writeFile(script, `
import { serve } from ${JSON.stringify(pathToFileURL(join(temporary, 'package/lib/web/serve.mjs')).href)};
import { request } from 'node:http';
const server = await serve(['--config', ${JSON.stringify(configPath)}, '--port', '0', '--json']);
try {
  const responses = [];
  for (const path of ['/signin', '/assets/home-client.mjs', '/assets/home-views.mjs', '/assets/decision-client.mjs', '/assets/decision-views.mjs', '/assets/decision.css']) responses.push(await new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.address().port, path, headers: { host: 'plates.acme.test' } }, res => {
      let text = ''; res.on('data', value => { text += value; }); res.on('end', () => resolve({ status: res.statusCode, text, cookies: res.headers['set-cookie'] }));
    }); req.on('error', reject); req.end();
  }));
  process.stdout.write(JSON.stringify(responses));
} finally { await new Promise(resolve => server.close(resolve)); }
`);
  const launched = await runAsync(process.execPath, [script], { cwd: temporary, timeout: 30000, env: {
    PATH: process.env.PATH, PLATES_GITHUB_CLIENT_SECRET: h.secrets.clientSecret, SUPABASE_URL: h.secrets.storageUrl,
    SUPABASE_SERVICE_ROLE_KEY: h.secrets.storageKey, PLATES_SESSION_ENCRYPTION_KEY: h.secrets.encryptionKey,
  } });
  assert.equal(launched.status, 0, launched.stderr);
  const responses=JSON.parse(launched.stdout);
  assert.ok(responses.every(response=>response.status===200),'all packaged browser assets are served');
  const [response, client, views] = responses;
  assert.equal(client.status, 200); assert.match(client.text, /export function startHomeClient/);
  assert.equal(views.status, 200); assert.match(views.text, /export function renderHomeSnapshot/);
  assert.equal(response.status, 200); assert.match(response.text, /Continue with GitHub/);
  assert.match(response.cookies[0], /^__Host-keel-login=.*Secure; HttpOnly; SameSite=Lax/);
  assert.doesNotMatch(response.text, /fake-client-secret|fake-service-key|supabase\.co/);
});
