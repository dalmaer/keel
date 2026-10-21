import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, runAsync } from './helpers/run.mjs';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const bin = join(root, 'bin/keel.mjs');
const invoke = (cli, args, cwd) => run(process.execPath, [cli, ...args], { cwd });
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-workspace-cli-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'private')); await mkdir(join(dir, 'caller'));
  const manifest = join(dir, 'private', 'workspace.json'), state = join(dir, 'state');
  await writeFile(manifest, JSON.stringify({ version: 1, id: 'acme', name: 'Acme', repo: 'acme/private', projects: [] }));
  return { dir, manifest, state, cwd: join(dir, 'caller'), args: ['--manifest', manifest, '--state', state, '--json'] };
}
function json(result, status) { assert.equal(result.status, status, result.stdout + result.stderr); assert.equal(result.stderr, ''); return JSON.parse(result.stdout); }
async function lifecycle(t, cli) {
  const f = await fixture(t), before = await readdir(f.dir);
  assert.equal(json(invoke(cli, ['workspace', 'inspect', ...f.args], f.cwd), 0).state, 'uninitialized');
  assert.equal(json(invoke(cli, ['workspace', 'init', ...f.args], f.cwd), 3).mode, 'preview');
  assert.deepEqual(await readdir(f.dir), before);
  const applied = json(invoke(cli, ['workspace', 'init', ...f.args, '--yes'], f.cwd), 0);
  assert.equal(applied.state, 'ready'); assert.deepEqual(applied.privacy, { state: 'unverified' });
  const marker = join(f.state, 'workspace.json'), bytes = await readFile(marker), initial = await stat(marker);
  assert.deepEqual(json(invoke(cli, ['workspace', 'init', ...f.args, '--yes'], f.cwd), 0), applied);
  assert.deepEqual(await readFile(marker), bytes); assert.equal((await stat(marker)).mtimeMs, initial.mtimeMs);
  assert.equal(json(invoke(cli, ['workspace', 'inspect', ...f.args], f.cwd), 0).state, 'ready');
  if (process.platform !== 'win32') { assert.equal((await stat(f.state)).mode & 0o777, 0o700); assert.equal(initial.mode & 0o777, 0o600); }
  await writeFile(f.manifest, JSON.stringify({ version: 1, id: 'other', name: 'Acme', repo: 'acme/private', projects: [] }));
  assert.match(json(invoke(cli, ['workspace', 'init', ...f.args, '--yes'], f.cwd), 2).error, /does not match/);
  assert.deepEqual(await readFile(marker), bytes); assert.deepEqual(await readdir(f.cwd), []);
}
test('fresh-process CLI preview, explicit private initialization, retry and mismatch lifecycle', async t => { await lifecycle(t, bin); });
test('strict workspace arguments and rejected manifest values stay secret-free in JSON and stderr', async t => {
  const f = await fixture(t), fake = 'fake-secret-do-not-print';
  for (const args of [[], ['unknown'], ['inspect'], ['inspect', ...f.args, '--yes'], ['init', ...f.args, '--manifest', fake], ['init', ...f.args, '--unknown', fake], ['init', ...f.args, fake], ['init', '--manifest', '--state', f.state], ['init', ...f.args, '--yes', '--yes']]) {
    const r = invoke(bin, ['workspace', ...args, ...(args.includes('--json') ? [] : ['--json'])], f.cwd);
    assert.ok(json(r, 2).error); assert.ok(!r.stdout.includes(fake));
  }
  await writeFile(f.manifest, `{"token":"${fake}",`);
  const r = invoke(bin, ['workspace', 'inspect', ...f.args.filter(x => x !== '--json')], f.cwd);
  assert.equal(r.status, 2); assert.equal(r.stdout, ''); assert.ok(!r.stderr.includes(fake));
  assert.match(r.stderr, /^keel: workspace/);
});
test('workspace is announced with complete help and no project is required', async t => {
  const f = await fixture(t);
  assert.match(invoke(bin, ['help'], f.cwd).stdout, /workspace inspect\|init/);
  assert.match(invoke(bin, ['--agent-help'], f.cwd).stdout, /keel workspace inspect\|init/);
  const help = json(invoke(bin, ['--agent-help', 'workspace', '--json'], f.cwd), 0);
  assert.equal(help.slug, 'workspace'); assert.match(JSON.stringify(help), /unverified/);
});
test('competing fresh processes cannot replace workspace ownership', async t => {
  const f = await fixture(t);
  const alternate = join(f.dir, 'private', 'other.json');
  await writeFile(alternate, JSON.stringify({ version: 1, id: 'other', name: 'Acme', repo: 'acme/other', projects: [] }));
  // Exercise the shared initializer in two independent module processes; CLI
  // lifecycle checks above use the synchronous helper and its CLI guards.
  const worker = `
    import { initializeWorkspace } from ${JSON.stringify(new URL('../lib/web/workspace.mjs', import.meta.url).href)};
    try {
      const data = await initializeWorkspace({ manifest: process.argv[1], state: process.argv[2], appRoot: process.argv[3] });
      console.log(JSON.stringify(data));
    } catch (error) {
      console.log(JSON.stringify({ error: error.message }));
      process.exitCode = error.exitCode ?? 1;
    }
  `;
  const initialize = manifest => runAsync(process.execPath, ['--input-type=module', '-e', worker, manifest, f.state, root], { cwd: f.cwd });
  const results = await Promise.all([initialize(f.manifest), initialize(alternate)]);
  assert.deepEqual(results.map(r => r.status).sort(), [0, 2]);
  const winner = JSON.parse(results.find(r => r.status === 0).stdout);
  assert.equal(JSON.parse(await readFile(join(f.state, 'workspace.json'))).id, winner.workspace.id);
  assert.ok(results.every(r => r.stderr === ''));
});
test('packed CLI loads workspace runtime and completes lifecycle outside a source checkout', async t => {
  const dest = await mkdtemp(join(tmpdir(), 'keel-workspace-pack-')); t.after(() => rm(dest, { recursive: true, force: true }));
  const packed = run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', dest], { cwd: root });
  assert.equal(packed.status, 0, packed.stderr);
  const entry = JSON.parse(packed.stdout)[0]; assert.ok(entry.files.some(f => f.path === 'lib/web/workspace.mjs'));
  const unpacked = run('tar', ['-xzf', join(dest, entry.filename), '-C', dest]); assert.equal(unpacked.status, 0, unpacked.stderr);
  await lifecycle(t, resolve(dest, 'package/bin/keel.mjs'));
});
