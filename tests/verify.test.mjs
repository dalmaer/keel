// The verifier (phase 81): scripts/keel/verify.mjs, the delivery practice's.
// Production is a stub HTTP server on 127.0.0.1 (no external network); the
// repository is a synthetic Acme clone of a bare origin, so ancestry is real
// git. The verifier runs from a scratch scripts/keel/ holding the night's
// scripts beside it, as a project has them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile, mkdir, cp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { scratch, ENV } from './helpers/improve.mjs';
import { runAsync } from './helpers/run.mjs';
import { deliveryOf, deliveryProblems } from '../practices/delivery/files/scripts/keel/delivery.mjs';
import { verifyResults, verifyFailuresFor, VERIFY_BRANCH, VERIFY_FILE } from '../practices/night/files/scripts/keel/morning.mjs';

const NIGHT = resolve('practices/night/files/scripts/keel');
const DELIVERY = resolve('practices/delivery/files/scripts/keel');
const FAST = { within: 0, every: 0.01 };

/** scripts/keel/ as a project has it: the night's scripts and the delivery practice's, side by side. */
async function scripts(t) {
  const dir = join(await scratch(t, 'keel-verify-scripts-'), 'scripts', 'keel');
  await cp(NIGHT, dir, { recursive: true });
  await cp(DELIVERY, dir, { recursive: true });
  return { dir, v: await import(pathToFileURL(join(dir, 'verify.mjs')).href) };
}

/**
 * Production, stubbed: `version` is what /api/version answers (a function of
 * the read count, or a value: { status, body, headers }), `routes` the smoke
 * paths' statuses. `close()` makes it unreachable.
 */
async function production(t) {
  const state = { reads: 0, version: { status: 200, body: '' }, routes: {}, log: [] };
  const server = createServer((req, res) => {
    state.log.push(req.url);
    if (req.url === '/api/version') {
      const v = typeof state.version === 'function' ? state.version(++state.reads) : (++state.reads, state.version);
      res.writeHead(v.status ?? 200, { 'content-type': v.type ?? 'application/json', ...(v.headers ?? {}) });
      return res.end(v.body);
    }
    const s = state.routes[req.url];
    if (s === undefined) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(s, s >= 300 && s < 400 ? { location: '/elsewhere' } : {});
    res.end('ok');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const site = `http://127.0.0.1:${server.address().port}`;
  let open = true;
  const close = () => new Promise(r => { if (!open) return r(); open = false; server.closeAllConnections?.(); server.close(() => r()); });
  t.after(close);
  return { site, state, close, serve: sha => { state.version = { status: 200, body: JSON.stringify({ commit: sha }) }; } };
}

/** A bare origin and a clone: main is A → B → C; D is a sibling of B (not on main's line past A). */
async function acme(t, config) {
  const dir = await scratch(t, 'keel-verify-');
  const origin = join(dir, 'origin.git'), root = join(dir, 'acme');
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8' }).trim();
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  git(dir, 'init', '-q', '-b', 'main', root);
  git(root, 'remote', 'add', 'origin', origin);
  await mkdir(join(root, '.keel'));
  await writeFile(join(root, '.keel/keel.json'), JSON.stringify(config));
  const commit = async (name, body) => { await writeFile(join(root, `${name}.mjs`), body); git(root, 'add', '-A'); git(root, 'commit', '-qm', `Acme ${name}`); return git(root, 'rev-parse', 'HEAD'); };
  const A = await commit('anvil', 'export const a = 1;\n');
  const B = await commit('anvil-b', 'export const b = 2;\n');
  const C = await commit('anvil-c', 'export const c = 3;\n');
  git(root, 'push', '-q', 'origin', 'main');
  git(root, 'checkout', '-q', '-b', 'acme-side', A);
  const D = await commit('anvil-d', 'export const d = 4;\n');
  git(root, 'checkout', '-q', 'main');
  return { root, origin, A, B, C, D, git: (...a) => git(root, ...a) };
}

const config = (site, extra = {}) => ({ name: 'Acme', repo: 'acme/anvils', practices: ['night', 'delivery'], delivery: { site, version: '/api/version', ...extra } });
async function setup(t, extra) {
  const prod = await production(t);
  const repo = await acme(t, config(prod.site, extra));
  const { dir, v } = await scripts(t);
  return { prod, repo, dir, v, cfg: config(prod.site, extra) };
}

/** The script, as a deploy step runs it: cwd the project, no network but the stub. */
const script = async (dir, root, args) => {
  const r = await runAsync(process.execPath, [join(dir, 'verify.mjs'), ...args], { cwd: root, env: { ...ENV, GITHUB_ACTIONS: '' } });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

// ---- verify: the commit or a descendant, then the smoke checks ----------------------------

test('verify passes when production reports the commit or a descendant and every smoke check matches, and fails, naming which, otherwise', async t => {
  const { prod, repo, v, cfg } = await setup(t, { smoke: ['/', { path: '/login', status: 307 }, { path: '/health', status: [200, 204] }] });
  prod.state.routes = { '/': 200, '/login': 307, '/health': 204 };
  const run = sha => v.verify({ root: repo.root, config: cfg, sha, ...FAST });
  prod.serve(repo.B);
  let r = await run(repo.B);
  assert.equal(r.ok, true, JSON.stringify(r.failures));
  assert.equal(r.serving, repo.B);
  assert.deepEqual(r.smoke.map(s => [s.path, s.got, s.matched]), [['/', 200, true], ['/login', 307, true], ['/health', 204, true]], 'a redirect is its own status, never followed');
  assert.ok(!prod.state.log.includes('/elsewhere'), 'the redirect was not followed');
  prod.serve(repo.C);
  assert.equal((await run(repo.A)).ok, true, 'a descendant contains the commit');
  // An ancestor, or a commit off main's line, does not contain it: the version check is named.
  prod.serve(repo.A);
  r = await run(repo.C);
  assert.equal(r.ok, false);
  assert.match(r.failures[0], new RegExp(`production serves ${repo.A.slice(0, 7)}, which does not contain ${repo.C.slice(0, 7)}`));
  assert.equal(r.failures.length, 1, 'the smoke checks still ran, and held');
  prod.serve(repo.D);
  assert.match((await run(repo.B)).failures[0], /does not contain/, 'a sibling');
  // A smoke check that does not match fails the verify, naming the path, the expected and the got.
  prod.serve(repo.C);
  prod.state.routes['/login'] = 200;
  delete prod.state.routes['/health'];
  r = await run(repo.C);
  assert.equal(r.ok, false);
  assert.deepEqual(r.failures, ['GET /login: expected 307, got 200', 'GET /health: expected 200 or 204, got 404']);
});

test('verify retries within its bound: a deploy that lands on the third read passes; one that never lands fails after a bounded time', async t => {
  const { prod, repo, v, cfg } = await setup(t);
  prod.state.version = n => ({ status: 200, body: JSON.stringify({ commit: n < 3 ? repo.A : repo.C }) });
  let r = await v.verify({ root: repo.root, config: cfg, sha: repo.C, within: 5, every: 0.02 });
  assert.equal(r.ok, true, JSON.stringify(r.failures));
  assert.equal(r.attempts, 3);
  // Never lands: bounded by --within, the reads counted, and the last reason kept.
  prod.state.reads = 0;
  prod.state.version = () => ({ status: 200, body: JSON.stringify({ commit: repo.A }) });
  const started = Date.now();
  r = await v.verify({ root: repo.root, config: cfg, sha: repo.C, within: 1, every: 0.1 });
  const took = Date.now() - started;
  assert.equal(r.ok, false);
  assert.ok(r.attempts >= 2 && r.attempts <= 11, `attempts ${r.attempts}`);
  assert.ok(took < 15_000, `bounded: ${took} ms`);
  assert.match(r.failures[0], /does not contain .*, after \d+ reads over \d+s$/);
  // A fake clock: within 600 s and every 10 s is 61 reads, never more.
  let clock = 0, slept = 0;
  r = await v.verify({ root: repo.root, config: cfg, sha: repo.C, now: () => clock, sleep: async ms => { clock += ms; slept++; } });
  assert.equal(r.attempts, 61);
  assert.equal(slept, 60);
  assert.equal(r.waited, 600);
});

test('verify never reports success it did not see: unreachable, an error status, a redirect, a body it cannot read, a short hash, a commit the repository lacks', async t => {
  const { prod, repo, v, cfg } = await setup(t, { smoke: ['/'] });
  prod.state.routes = { '/': 200 };
  const run = () => v.verify({ root: repo.root, config: cfg, sha: repo.A, ...FAST });
  const cases = [
    [{ status: 500, body: JSON.stringify({ commit: repo.A }) }, /answered HTTP 500/],
    [{ status: 302, body: '', headers: { location: '/v2' } }, /answered HTTP 302 \(a redirect; keel does not follow one\)/],
    [{ status: 200, body: '<html>Acme</html>', type: 'text/html' }, /is not a commit hash/],
    [{ status: 200, body: '{"commit": ' }, /not JSON/],
    [{ status: 200, body: JSON.stringify({ version: '1.2.3' }) }, /no "sha" or "commit" field/],
    [{ status: 200, body: JSON.stringify({ commit: repo.A.slice(0, 7) }) }, /is a short hash/],
    [{ status: 200, body: JSON.stringify({ sha: repo.A, commit: repo.C }) }, /disagree/],
    [{ status: 200, body: JSON.stringify({ commit: 'f'.repeat(40) }) }, /a commit this repository does not have \(even after fetching origin\)/],
    [{ status: 200, body: JSON.stringify([repo.A]) }, /not an object/],
    [{ status: 200, body: 'x'.repeat(70 * 1024), type: 'text/plain' }, /larger than 65536 bytes/],
  ];
  for (const [answer, why] of cases) {
    prod.state.version = answer;
    const r = await run();
    assert.equal(r.ok, false, `${why}: ${JSON.stringify(r)}`);
    assert.equal(r.contained, false);
    assert.match(r.failures[0], why);
  }
  // Unreachable: the version and every smoke check say so.
  await prod.close();
  const r = await run();
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /\/api\/version no answer/);
  assert.match(r.failures[1], /^GET \/: expected 200, got no answer/);
});

test('the version shapes it accepts: a JSON sha or commit field, a JSON string, or the plain hash; each a full hash, any case', async t => {
  const { v } = await scripts(t);
  const sha = 'a1b2c3d4'.repeat(5);
  for (const body of [JSON.stringify({ sha }), JSON.stringify({ commit: sha, status: 'ok' }), JSON.stringify({ sha, commit: sha }), JSON.stringify(sha), sha, `  ${sha.toUpperCase()}\n`]) {
    assert.deepEqual(v.servingOf(body), { sha }, body);
  }
  assert.deepEqual(v.servingOf('b'.repeat(64)), { sha: 'b'.repeat(64) }, 'SHA-256');
  for (const body of ['', 'a1b2c3d', JSON.stringify({ commit: 7 }), 'null', JSON.stringify({ revision: sha })]) assert.ok(v.servingOf(body).error, body);
});

// ---- live: skip a deploy production already has ----------------------------------------

test('verify live says yes for the commit or a descendant and no otherwise; the script exits 0 for yes and 1 for no', async t => {
  const { prod, repo, dir, v, cfg } = await setup(t);
  const live = sha => v.live({ root: repo.root, config: cfg, sha });
  prod.serve(repo.B);
  assert.equal((await live(repo.B)).live, true, 'the commit');
  assert.equal((await live(repo.A)).live, true, 'production serves a descendant');
  assert.equal((await live(repo.C)).live, false, 'production serves an ancestor: deploy');
  assert.equal((await live(repo.D)).live, false, 'production serves another line: deploy');
  prod.state.version = { status: 503, body: 'down' };
  const down = await live(repo.B);
  assert.equal(down.live, false, 'cannot read: never yes');
  assert.match(down.why, /answered HTTP 503: not shown to be live, so deploy/);
  prod.serve(repo.C);
  let s = await script(dir, repo.root, ['live', repo.B]);
  assert.equal(s.code, 0, s.err + s.out);
  assert.match(s.out, /^keel verify live: yes\./);
  s = await script(dir, repo.root, ['live', repo.D, '--json']);
  assert.equal(s.code, 1, s.err + s.out);
  assert.equal(JSON.parse(s.out).live, false);
  // The verify itself, as a script: 0 passed, 1 failed, naming it.
  s = await script(dir, repo.root, [repo.A, '--within', '0']);
  assert.equal(s.code, 0, s.err + s.out);
  s = await script(dir, repo.root, [repo.D, '--within', '0', '--every', '0.01']);
  assert.equal(s.code, 1);
  assert.match(s.out, /^keel verify: FAILED for [0-9a-f]{7} at http:\/\/127\.0\.0\.1:\d+:\n {2}- production serves/);
});

// ---- configuration: each error names its key ---------------------------------------------

test('"delivery".site, version and smoke are validated, each error naming its key; the script refuses (exit 2) naming it', async t => {
  for (const [delivery, key] of [
    [{ site: 'http://anvils.acme.example', version: '/v' }, /"delivery"\.site must be https/],
    [{ site: 'https://anvils.acme.example/app', version: '/v' }, /"delivery"\.site must be an origin alone/],
    [{ site: 'https://u:p@anvils.acme.example', version: '/v' }, /"delivery"\.site must be an origin alone/],
    [{ site: 42 }, /"delivery"\.site must be the production origin/],
    [{ site: 'https://anvils.acme.example', version: 'api/version' }, /"delivery"\.version must be a path starting with "\/"/],
    [{ site: 'https://anvils.acme.example', version: '//evil.example/x' }, /"delivery"\.version must be a path/],
    [{ version: '/api/version' }, /"delivery"\.site is required with "delivery"\.version/],
    [{ site: 'https://anvils.acme.example', smoke: '/' }, /"delivery"\.smoke must be a list/],
    [{ site: 'https://anvils.acme.example', smoke: ['/', 'nope'] }, /"delivery"\.smoke\[1\] must be a path/],
    [{ site: 'https://anvils.acme.example', smoke: [{ path: '/', status: 999 }] }, /"delivery"\.smoke\[0\] status must be an HTTP status code/],
    [{ site: 'https://anvils.acme.example', smoke: [{ path: '/', expect: 200 }] }, /"delivery"\.smoke\[0\] takes path and status only/],
    [{ site: 'https://anvils.acme.example', smoke: Array(51).fill('/') }, /"delivery"\.smoke must be a list of at most 50/],
  ]) {
    assert.match(deliveryProblems({ delivery }).join('\n'), key, JSON.stringify(delivery));
    assert.throws(() => deliveryOf({ delivery }), e => e.exitCode === 2 && key.test(e.message), JSON.stringify(delivery));
  }
  assert.deepEqual(deliveryProblems({ delivery: { site: 'http://127.0.0.1:8080', version: '/v', smoke: ['/', { path: '/a', status: [301, 302] }] } }), [], 'http on this machine (a local preview)');
  assert.deepEqual(deliveryOf({ delivery: { site: 'https://anvils.acme.example/', version: '/v', smoke: ['/', { path: '/a', status: 307 }] } }), { tested: 'green', gateWorkflow: null, site: 'https://anvils.acme.example', version: '/v', smoke: [{ path: '/', status: [200] }, { path: '/a', status: [307] }] });
  // The script: a bad key, no version, a bad --site, a short sha; each exit 2, naming it.
  const { prod, repo, dir } = await setup(t);
  await writeFile(join(repo.root, '.keel/keel.json'), JSON.stringify(config(prod.site, { smoke: ['nope'] })));
  let s = await script(dir, repo.root, [repo.A]);
  assert.equal(s.code, 2);
  assert.match(s.err, /"delivery"\.smoke\[0\]/);
  await writeFile(join(repo.root, '.keel/keel.json'), JSON.stringify({ name: 'Acme', practices: ['delivery'], delivery: { site: prod.site } }));
  s = await script(dir, repo.root, [repo.A]);
  assert.equal(s.code, 2);
  assert.match(s.err, /no "delivery"\.version/);
  await writeFile(join(repo.root, '.keel/keel.json'), JSON.stringify(config(prod.site)));
  s = await script(dir, repo.root, [repo.A, '--site', 'http://preview.acme.example']);
  assert.equal(s.code, 2);
  assert.match(s.err, /--site must be https/);
  s = await script(dir, repo.root, [repo.A.slice(0, 7)]);
  assert.equal(s.code, 2);
  assert.match(s.err, /must be a full hash/);
  s = await script(dir, repo.root, ['live', repo.A, '--within', '3']);
  assert.equal(s.code, 2, 'live reads once: no --within');
});

// ---- recording: where the board and the morning brief read it -------------------------------

test('--record adds the result to keel-verify:verify.json, newest first; a file there that is not a record is left alone (exit 1)', async t => {
  const { prod, repo, dir, v } = await setup(t);
  prod.serve(repo.A);
  let s = await script(dir, repo.root, [repo.C, '--within', '0', '--record']);
  assert.equal(s.code, 1, s.err + s.out);
  assert.match(s.out, /Recorded on keel-verify/);
  prod.serve(repo.C);
  s = await script(dir, repo.root, [repo.C, '--within', '0', '--record', '--json']);
  assert.equal(s.code, 0, s.err + s.out);
  assert.equal(JSON.parse(s.out).recorded.recorded, true);
  const shown = () => execFileSync('git', ['--git-dir', repo.origin, 'show', `refs/heads/${VERIFY_BRANCH}:${VERIFY_FILE}`], { env: ENV, encoding: 'utf8' });
  const results = verifyResults(shown());
  assert.deepEqual(results.map(r => [r.sha, r.ok]), [[repo.C, true], [repo.C, false]], 'newest first');
  assert.match(results[1].failures[0], /does not contain/);
  // Its history keeps the last 30, and the failure above (too recent for its brief to have read it).
  const result = { sha: repo.C, ok: true, at: new Date().toISOString(), site: prod.site, serving: repo.C, failures: [] };
  for (let i = 0; i < 30; i++) v.record({ root: repo.root, result: { ...result, at: new Date(Date.now() + (i + 1) * 1000).toISOString() }, env: ENV });
  assert.equal(verifyResults(shown()).length, 31);
  // Not a record: refused, and the branch left as it was.
  const tip = () => execFileSync('git', ['--git-dir', repo.origin, 'rev-parse', `refs/heads/${VERIFY_BRANCH}`], { env: ENV, encoding: 'utf8' }).trim();
  const before = tip();
  repo.git('checkout', '-q', '--orphan', 'scratch-verify');
  repo.git('rm', '-q', '-rf', '--cached', '.');
  await writeFile(join(repo.root, VERIFY_FILE), '{"results": "Acme"}\n');
  repo.git('add', '-f', VERIFY_FILE); repo.git('commit', '-qm', 'Acme: not a record');
  repo.git('push', '-q', '--force', 'origin', `HEAD:refs/heads/${VERIFY_BRANCH}`);
  repo.git('checkout', '-q', '-f', 'main');
  const broken = tip();
  assert.notEqual(broken, before);
  assert.throws(() => v.record({ root: repo.root, result, env: ENV }), e => e.exitCode === 1 && /is not a verify record .* left alone/.test(e.message));
  assert.equal(tip(), broken);
});

// PR #182 review: a failure at 08:00 followed by 30 passes that day fell out of the last 30 before the next night's brief read it.
test('a burst of passes never drops a failure before its brief has read it; an old failure still ages out', async t => {
  const { prod, repo, v } = await setup(t);
  const at = h => new Date(Date.parse('2026-10-04T08:00:00Z') + h * 3600 * 1000).toISOString();
  const base = { sha: repo.C, site: prod.site, serving: repo.C };
  const failure = { ...base, ok: false, at: at(0), failures: ['GET /: expected 200, got 500'] };
  v.record({ root: repo.root, result: failure, env: ENV, now: Date.parse(at(0)) });
  for (let i = 1; i <= 30; i++) v.record({ root: repo.root, result: { ...base, ok: true, at: at(i * 0.5), failures: [] }, env: ENV, now: Date.parse(at(i * 0.5)) });
  const shown = () => verifyResults(execFileSync('git', ['--git-dir', repo.origin, 'show', `refs/heads/${VERIFY_BRANCH}:${VERIFY_FILE}`], { env: ENV, encoding: 'utf8' }));
  const results = shown();
  assert.equal(results.length, 31, 'the 30 newest, and the failure');
  assert.deepEqual(verifyFailuresFor(results, '2026-10-05').map(r => r.at), [failure.at], 'the next night\'s brief still reads it');
  // Three days on, the failure has had its brief: the next record lets it go.
  v.record({ root: repo.root, result: { ...base, ok: true, at: at(80), failures: [] }, env: ENV, now: Date.parse(at(80)) });
  assert.equal(shown().length, 30);
  assert.ok(shown().every(r => r.ok));
});

// PR #182 review, round two: a four-day-old production failure fell out once 30 newer preview passes were recorded,
// and the board, finding no production verify, dropped the owner's item though production never passed.
test('the latest result of each site is kept whatever its age: an unresolved production failure outlives any number of preview passes', async t => {
  const { prod, repo, v } = await setup(t);
  const preview = 'https://preview-7.anvils.acme.example';
  const at = h => new Date(Date.parse('2026-10-04T08:00:00Z') + h * 3600 * 1000).toISOString();
  const base = { sha: repo.C, serving: repo.C };
  const failure = { ...base, site: prod.site, ok: false, at: at(0), failures: ['GET /: expected 200, got 500'] };
  v.record({ root: repo.root, result: failure, env: ENV, now: Date.parse(at(0)), production: prod.site });
  for (let i = 0; i < 31; i++) v.record({ root: repo.root, result: { ...base, site: preview, ok: true, at: at(96 + i * 0.1), failures: [] }, env: ENV, now: Date.parse(at(96 + i * 0.1)), production: prod.site });
  const results = verifyResults(execFileSync('git', ['--git-dir', repo.origin, 'show', `refs/heads/${VERIFY_BRANCH}:${VERIFY_FILE}`], { env: ENV, encoding: 'utf8' }));
  const production = results.filter(r => r.site === prod.site);
  assert.deepEqual(production.map(r => [r.at, r.ok]), [[failure.at, false]], 'production\'s last verify is still there, and still failed');
  assert.equal(results.filter(r => r.site === preview).length, 30, 'the previews keep their usual 30');
});

// PR #182 review, round two: recording replaced keel-verify's whole tree with verify.json alone, and overwrote a
// branch that held no verify record at all.
test('recording keeps every other file on keel-verify, and refuses a keel-verify branch that holds no verify record', async t => {
  const { prod, repo, v } = await setup(t);
  const result = { sha: repo.C, ok: true, at: '2026-10-04T08:00:00.000Z', site: prod.site, serving: repo.C, failures: [] };
  const remoteTip = () => execFileSync('git', ['--git-dir', repo.origin, 'rev-parse', `refs/heads/${VERIFY_BRANCH}`], { env: ENV, encoding: 'utf8' }).trim();
  const files = () => execFileSync('git', ['--git-dir', repo.origin, 'ls-tree', '-r', '--name-only', `refs/heads/${VERIFY_BRANCH}`], { env: ENV, encoding: 'utf8' }).trim().split('\n');
  const branch = async entries => {
    repo.git('checkout', '-q', '--orphan', `acme-verify-${Object.keys(entries).length}`);
    repo.git('rm', '-q', '-rf', '--cached', '.');
    for (const [p, body] of Object.entries(entries)) { await mkdir(join(repo.root, p, '..'), { recursive: true }); await writeFile(join(repo.root, p), body); repo.git('add', '-f', p); }
    repo.git('commit', '-qm', 'Acme: the branch');
    repo.git('push', '-q', '--force', 'origin', `HEAD:refs/heads/${VERIFY_BRANCH}`);
    repo.git('checkout', '-q', '-f', 'main');
  };
  // A keel-verify that is someone else's (no verify.json): refused, left exactly as it was.
  await branch({ 'README.md': '# Acme notes\n' });
  const theirs = remoteTip();
  assert.throws(() => v.record({ root: repo.root, result, env: ENV }), e => e.exitCode === 1 && /holds no verify\.json: it is not keel's verify record, so it is left alone/.test(e.message));
  assert.equal(remoteTip(), theirs);
  // A record beside other files: verify.json is updated, every other file kept.
  await branch({ [VERIFY_FILE]: JSON.stringify({ results: [] }), 'README.md': '# Acme notes\n', 'notes/anvils.md': 'Anvils.\n' });
  v.record({ root: repo.root, result, env: ENV });
  assert.deepEqual(files().sort(), ['README.md', 'notes/anvils.md', VERIFY_FILE]);
  assert.equal(verifyResults(execFileSync('git', ['--git-dir', repo.origin, 'show', `refs/heads/${VERIFY_BRANCH}:${VERIFY_FILE}`], { env: ENV, encoding: 'utf8' })).length, 1);
});
