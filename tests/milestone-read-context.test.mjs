import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { run } from './helpers/run.mjs';
import { milestoneConfig, milestone, issue, response } from './helpers/milestones.mjs';
import { looseEnds } from '../lib/looseends.mjs';
import { board } from '../lib/board.mjs';
import { rememberQuota } from '../lib/quota.mjs';

const cli = resolve('bin/keel.mjs');
async function fixture(t, config = milestoneConfig) {
  const base = await mkdtemp(join(tmpdir(), 'keel-milestone-context-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'acme');
  await mkdir(join(root, '.keel'), { recursive: true });
  await writeFile(join(root, '.keel/keel.json'), JSON.stringify(config));
  const log = join(base, 'gh.log'), source = join(base, 'source.json'), gh = join(base, 'gh');
  await writeFile(log, '');
  await writeFile(gh, `#!${process.execPath}
import { appendFileSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.ACME_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'auth') process.exit(0);
if (args[0] === 'api' && args[1] === 'graphql') {
  console.log(readFileSync(process.env.ACME_SOURCE, 'utf8')); process.exit(0);
}
console.error('Acme: other GitHub reads unavailable'); process.exit(1);
`, { mode: 0o755 });
  const env = { ...process.env, KEEL_GH: gh, KEEL_CACHE: join(base, 'cache'), KEEL_CLAUDE_DIR: join(base, 'claude'), ACME_LOG: log, ACME_SOURCE: source };
  delete env.KEEL_MILESTONES_OFFLINE;
  const setSource = async (nodes, more) => {
    const data = response(nodes, more); data.data.rateLimit.cost = 7;
    await writeFile(source, JSON.stringify(data));
  };
  await setSource([milestone(1, 'OPEN', [issue(10, 'OPEN', ['keel:owner'])])]);
  await rememberQuota(env, { remaining: 4000, resetAt: '2099-01-01T00:00:00Z' });
  const calls = async () => (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const invoke = (...args) => run(process.execPath, [cli, ...args], { cwd: root, env });
  return { base, root, env, calls, setSource, invoke };
}
function json(f, ...args) {
  const r = f.invoke(...args, '--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(r.stdout);
}

test('local doctor and night diagnostic do not discover milestones; explicit GitHub and adoption do', async t => {
  const f = await fixture(t, { name: 'Acme', repo: 'acme/anvils', practices: ['base'], local: { phases: 'Acme planning' } });
  const local = f.invoke('doctor', '--json');
  assert.ok([0, 1].includes(local.status), local.stdout + local.stderr);
  assert.ok(Array.isArray(JSON.parse(local.stdout).qualifies), local.stdout);
  // Run the night's actual local instruments, without its intentional remote measures.
  const night = run(process.execPath, ['--input-type=module', '-e', `
    import { measure, MEASURES } from ${JSON.stringify(pathToFileURL(resolve('lib/improve.mjs')).href)};
    const results = await measure({ root: process.cwd(), config: ${JSON.stringify({ name: 'Acme', practices: ['base'] })}, measures: MEASURES.filter(m => ['drift', 'lint'].includes(m.id)) });
    console.log(JSON.stringify(results));
  `], { cwd: f.root, env: f.env });
  assert.equal(night.status, 0, night.stderr);
  assert.deepEqual(JSON.parse(night.stdout).map(m => m.state), ['ok', 'ok']);
  assert.deepEqual(await f.calls(), [], 'ordinary diagnostics must not invoke gh, including auth');
  const remote = f.invoke('doctor', '--github', '--json');
  assert.ok([0, 1].includes(remote.status), remote.stdout + remote.stderr);
  assert.ok((await f.calls()).some(a => a[0] === 'auth'));
  assert.ok((await f.calls()).some(a => a[1] === 'graphql'));
  const adoption = json(f, 'adopt', '--dry-run', '--check', 'node --version');
  assert.equal(adoption.config.phases.source, 'milestones');
});

test('update reaches migration planning through a local diagnostic without GitHub discovery', async t => {
  const f = await fixture(t, { name: 'Acme', repo: 'acme/anvils', practice: '0.0.0', practices: ['base'], local: { phases: 'Acme planning' } });
  for (const args of [['init'], ['add', '.'], ['commit', '-m', 'Acme fixture']]) {
    const r = run('git', args, { cwd: f.root, env: f.env }); assert.equal(r.status, 0, r.stderr);
  }
  const result = run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { update } from ${JSON.stringify(pathToFileURL(resolve('lib/update.mjs')).href)};
    await assert.rejects(update({ dir: process.cwd(), local: true, selfUpdate: false }, {
      version: '0.0.1', cliRoot: ${JSON.stringify(resolve('.'))},
      migrations: [{ id: '9999-acme', applies: () => true, up: () => { throw new Error('Acme reached migration planning'); } }],
    }), /Acme reached migration planning/);
  `], { cwd: f.root, env: f.env });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await f.calls(), []);
});

test('loose-ends CLI refresh changes cached milestone issues and accounts for the query', async t => {
  const f = await fixture(t);
  const first = json(f, 'loose-ends');
  assert.ok(first.projects[0].items.some(i => i.title === 'Acme issue 10'));
  assert.equal(first.github.cost, 7); assert.equal(first.github.queries, 1);
  assert.ok(Number.isFinite(Date.parse(first.github.readAt)));
  await f.setSource([milestone(1, 'OPEN', [issue(11, 'OPEN', ['keel:owner'])])]);
  const cached = json(f, 'loose-ends');
  assert.ok(cached.projects[0].items.some(i => i.title === 'Acme issue 10'));
  assert.equal(cached.github.cost, 0); assert.equal(cached.github.queries, 0);
  assert.equal(cached.github.readAt, first.github.readAt);
  const fresh = json(f, 'loose-ends', '--fresh');
  assert.ok(fresh.projects[0].items.some(i => i.title === 'Acme issue 11'));
  assert.ok(!fresh.projects[0].items.some(i => i.title === 'Acme issue 10'));
  assert.equal(fresh.github.cost, 7); assert.equal(fresh.github.queries, 1);
  assert.equal((await f.calls()).filter(a => a[1] === 'graphql').length, 2);
});

test('loose-ends milestone cache uses the caller clock and preserves the original read time', async t => {
  const f = await fixture(t), now = Date.now();
  const read = at => looseEnds({ home: f.root, env: f.env, now: at });
  const first = (await read(now)).data;
  assert.equal(first.github.readAt, new Date(now).toISOString());
  await f.setSource([milestone(1, 'OPEN', [issue(12, 'OPEN', ['keel:owner'])])]);
  assert.equal((await read(now + 60_000)).data.github.readAt, first.github.readAt);
  const expired = (await read(now + 11 * 60_000)).data;
  assert.equal(expired.github.readAt, new Date(now + 11 * 60_000).toISOString());
  assert.equal(expired.github.cost, 7);
  assert.ok(expired.projects[0].items.some(i => i.title === 'Acme issue 12'));
});

test('board refresh propagates freshness and accounting to a fleet checkout milestone read', async t => {
  const f = await fixture(t);
  const git = args => { const r = run('git', ['-C', f.root, ...args], { env: f.env }); assert.equal(r.status, 0, r.stderr); };
  git(['init']); git(['remote', 'add', 'origin', 'https://github.com/acme/anvils.git']);
  const home = join(f.base, 'home');
  await mkdir(join(home, '.keel'), { recursive: true });
  await writeFile(join(home, '.keel/keel.json'), JSON.stringify({ name: 'Acme home', keel: 'self', practices: [] }));
  await writeFile(join(home, 'fleet.json'), JSON.stringify([{ repo: 'acme/anvils', role: 'managed' }]));
  const deps = { env: f.env, roadmap: async () => ({ config: {}, phases: [], goals: [] }), reviews: async () => ({ items: [] }), fleet: async () => ({ repos: [] }), robotStatus: async () => ({ policy: { enabled: false }, budget: { state: 'off' } }) };
  const first = await board({ root: home }, deps);
  assert.ok(first.items.some(i => i.title === 'acme/anvils: Acme issue 10'));
  assert.equal(first.github.cost, 7); assert.equal(first.github.queries, 1);
  assert.ok(first.github.readAt);
  await f.setSource([milestone(1, 'OPEN', [issue(13, 'OPEN', ['keel:owner'])])]);
  const cached = await board({ root: home }, deps);
  assert.ok(cached.items.some(i => i.title === 'acme/anvils: Acme issue 10')); assert.equal(cached.github.cost, 0);
  assert.equal(cached.github.readAt, first.github.readAt);
  const fresh = await board({ root: home }, { ...deps, fresh: true });
  assert.ok(fresh.items.some(i => i.title === 'acme/anvils: Acme issue 13'));
  assert.equal(fresh.github.cost, 7); assert.equal(fresh.github.queries, 1);
  assert.equal((await f.calls()).filter(a => a[1] === 'graphql').length, 2);
});

test('status text names next milestone and action, and distinguishes complete empty from unknown', async t => {
  for (const [nodes, more, expected] of [
    [[milestone(2, 'OPEN', [issue(1, 'CLOSED')])], {}, /Next: 2\. Acme release \[partial\].*https:\/\/github.com\/acme\/anvils\/milestone\/2/],
    [[], {}, /No open milestones in the complete source read\./],
    [[], { open: true }, /Next work is unknown outside this bounded read\./],
  ]) {
    const f = await fixture(t); await f.setSource(nodes, more);
    const status = f.invoke('status'); assert.equal(status.status, 0, status.stdout + status.stderr);
    assert.match(status.stdout, expected);
    if (nodes.length) assert.match(status.stdout, /Next action: Read the milestone and its issues on GitHub:/);
  }
});
