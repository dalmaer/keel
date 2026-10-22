import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, chmod, stat, symlink, link } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectWorkspace, initializeWorkspace, validateManifest, WORKSPACE_LIMITS } from '../lib/web/workspace.mjs';
const manifest = () => ({ version: 1, id: 'acme', name: 'Acme', repo: 'acme/plates-private', projects: [{ id: 'studio', repo: 'acme/studio' }] });
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'plates-workspace-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = { appRoot: join(root, 'app'), manifest: join(root, 'private', 'workspace.json'), state: join(root, 'runtime') };
  await mkdir(options.appRoot); await mkdir(join(root, 'private'));
  await writeFile(options.manifest, JSON.stringify(manifest()));
  return { root, options };
}
const refuses = (promise, pattern) => assert.rejects(promise, error => error.exitCode === 2 && pattern.test(error.message));

test('bounded exact manifest schema accepts empty or 100 projects and rejects invalid identities without echoing values', () => {
  assert.deepEqual(validateManifest(manifest()), manifest());
  assert.equal(validateManifest({ ...manifest(), projects: [] }).projects.length, 0);
  assert.equal(validateManifest({ ...manifest(), repo: 'acme/app..archive' }).repo, 'acme/app..archive');
  const projects = Array.from({ length: 100 }, (_, i) => ({ id: `app-${i}`, repo: `acme/app-${i}` }));
  assert.equal(validateManifest({ ...manifest(), projects }).projects.length, 100);
  const fake = 'fake-secret-do-not-print';
  const invalid = [null, [], {}, { ...manifest(), version: 2 }, { ...manifest(), [fake]: fake },
    { ...manifest(), id: 'Bad' }, { ...manifest(), id: 'a'.repeat(65) }, { ...manifest(), name: ' ' },
    { ...manifest(), name: ' Acme' }, { ...manifest(), name: 'Acme\n' }, { ...manifest(), name: 'a'.repeat(121) },
    { ...manifest(), projects: [...projects, { id: 'more', repo: 'acme/more' }] },
    { ...manifest(), projects: [{ id: 'studio', repo: 'acme/studio', secret: fake }] },
    { ...manifest(), projects: [{ repo: 'acme/studio' }] },
    { ...manifest(), projects: [{ id: 'studio', repo: 'acme/studio' }, { id: 'studio', repo: 'acme/other' }] },
    { ...manifest(), projects: [{ id: 'studio', repo: 'acme/studio' }, { id: 'other', repo: 'Acme/STUDIO' }] },
    { ...manifest(), projects: [{ id: 'studio', repo: 'Acme/PLATES-PRIVATE' }] },
    ...['https://github.com/acme/app', '../app', 'acme/..', 'acme/app.git', 'acme/app?secret', `acme:${fake}/app`, 'acme/app/nested', 'ac--me/app'].map(repo => ({ ...manifest(), repo }))];
  for (const value of invalid) assert.throws(() => validateManifest(value), error => error.exitCode === 2 && !error.message.includes(fake));
});

test('manifest reads are bounded regular UTF-8 JSON files with sanitized diagnostics', async t => {
  const { options } = await fixture(t);
  for (const input of ['{"secret":"fake-secret-do-not-print",', Buffer.from([0xff]), ' '.repeat(WORKSPACE_LIMITS.bytes + 1)]) {
    await writeFile(options.manifest, input);
    await assert.rejects(inspectWorkspace(options), error => error.exitCode === 2 && !error.message.includes('fake-secret-do-not-print'));
  }
  await rm(options.manifest); await mkdir(options.manifest);
  await refuses(inspectWorkspace(options), /workspace/);
});

test('inspect is read-only and initialization has only the private ownership marker', async t => {
  const { root, options } = await fixture(t);
  const before = await readdir(root);
  const result = await inspectWorkspace(options);
  assert.equal(result.state, 'uninitialized'); assert.deepEqual(result.privacy, { state: 'unverified' });
  assert.deepEqual(await readdir(root), before);
  const initialized = await initializeWorkspace(options);
  assert.equal(initialized.state, 'ready');
  assert.deepEqual(await readdir(options.state), ['workspace.json']);
  assert.deepEqual(JSON.parse(await readFile(join(options.state, 'workspace.json'))), { version: 1, id: 'acme', repo: 'acme/plates-private' });
  if (process.platform !== 'win32') {
    assert.equal((await stat(options.state)).mode & 0o777, 0o700);
    assert.equal((await stat(join(options.state, 'workspace.json'))).mode & 0o777, 0o600);
  }
  const bytes = await readFile(join(options.state, 'workspace.json'));
  assert.deepEqual(await initializeWorkspace(options), initialized);
  assert.deepEqual(await readFile(join(options.state, 'workspace.json')), bytes);
  assert.deepEqual(await readdir(options.appRoot), []);
});

test('paths reject missing arguments, parents, filesystem root, application overlap and manifest overlap', async t => {
  const { root, options } = await fixture(t);
  const bad = [ { ...options, state: undefined }, { ...options, manifest: 'relative.json' },
    { ...options, state: join(root, 'missing', 'state') }, { ...options, state: '/' },
    { ...options, state: options.appRoot }, { ...options, state: join(options.appRoot, 'runtime') },
    { ...options, state: root }, { ...options, state: join(root, 'private', 'runtime') },
    { ...options, state: join(root, 'private') } ];
  for (const input of bad) await refuses(inspectWorkspace(input), /workspace/);
  const source = join(options.appRoot, 'manifest.json'); await writeFile(source, JSON.stringify(manifest()));
  await refuses(inspectWorkspace({ ...options, manifest: source }), /outside application/);
  await writeFile(options.state, 'Acme existing data');
  await refuses(initializeWorkspace(options), /real directory/);
  assert.equal(await readFile(options.state, 'utf8'), 'Acme existing data');
});

test('canonical ancestor aliases are usable but symlink leaves and aliases into protected trees are refused', async t => {
  const { root, options } = await fixture(t);
  const alias = join(root, 'alias'); await symlink(join(root, 'private'), alias);
  assert.equal((await inspectWorkspace({ ...options, manifest: join(alias, 'workspace.json') })).state, 'uninitialized');
  await refuses(inspectWorkspace({ ...options, state: join(alias, 'runtime') }), /overlaps/);
  const parent = join(root, 'external'); await mkdir(parent); const parentAlias = join(root, 'external-alias'); await symlink(parent, parentAlias);
  const result = await initializeWorkspace({ ...options, state: join(parentAlias, 'runtime') });
  assert.equal(result.paths.state, join(await import('node:fs/promises').then(m => m.realpath(parent)), 'runtime'));
  await symlink(result.paths.state, options.state);
  await refuses(inspectWorkspace(options), /real directory/);
  await refuses(inspectWorkspace({ ...options, state: `${options.state}/` }), /real directory/);
  const appAlias = join(root, 'app-alias'); await symlink(options.appRoot, appAlias);
  await refuses(inspectWorkspace({ ...options, state: join(appAlias, 'runtime') }), /overlaps/);
});

test('Git directory, linked worktree file and aliased Git ancestors refuse state creation', async t => {
  const { root, options } = await fixture(t);
  for (const type of ['directory', 'file']) {
    const project = join(root, `project-${type}`); await mkdir(project);
    if (type === 'directory') await mkdir(join(project, '.git')); else await writeFile(join(project, '.git'), 'gitdir: /fake/acme/worktree');
    const parent = join(project, 'nested'); await mkdir(parent);
    const alias = join(root, `alias-${type}`); await symlink(parent, alias);
    for (const state of [join(project, 'runtime'), join(parent, 'runtime'), join(alias, 'runtime')]) {
      await refuses(initializeWorkspace({ ...options, state }), /outside Git/);
    }
    assert.deepEqual(await readdir(parent), []);
  }
});

test('unowned or mismatched state and malformed marker preserve every byte', async t => {
  const { options } = await fixture(t);
  await mkdir(options.state, { mode: 0o700 });
  const other = join(options.state, 'acme.txt'); await writeFile(other, 'Acme observations');
  await refuses(initializeWorkspace(options), /unowned/);
  assert.equal(await readFile(other, 'utf8'), 'Acme observations');
  const marker = join(options.state, 'workspace.json');
  for (const bytes of ['not json fake-secret-do-not-print', JSON.stringify({ version: 1, id: 'other', repo: 'acme/plates-private' }), JSON.stringify({ version: 1, id: 'acme', repo: 'acme/other' }), JSON.stringify({ version: 1, id: 'acme', repo: 'acme/plates-private', token: 'fake-secret-do-not-print' })]) {
    await writeFile(marker, bytes, { mode: 0o600 });
    await assert.rejects(initializeWorkspace(options), error => error.exitCode === 2 && !error.message.includes('fake-secret-do-not-print'));
    assert.equal(await readFile(marker, 'utf8'), bytes);
    assert.equal(await readFile(other, 'utf8'), 'Acme observations');
  }
});

test('unsafe directory and marker permissions, symlinks and hardlink aliases are refused', async t => {
  const { root, options } = await fixture(t);
  await initializeWorkspace(options);
  const marker = join(options.state, 'workspace.json');
  if (process.platform !== 'win32') {
    await chmod(options.state, 0o755); await refuses(initializeWorkspace(options), /private permissions/);
    assert.equal((await stat(options.state)).mode & 0o777, 0o755); await chmod(options.state, 0o700);
    await chmod(marker, 0o644); await refuses(inspectWorkspace(options), /private permissions/);
    assert.equal((await stat(marker)).mode & 0o777, 0o644); await chmod(marker, 0o600);
  }
  const other = join(root, 'marker-copy'); await link(marker, other);
  await refuses(inspectWorkspace(options), /unsafe/); await rm(marker); await symlink(other, marker);
  await refuses(initializeWorkspace(options), /unsafe/);
  assert.equal(JSON.parse(await readFile(other)).id, 'acme');
});

test('special files are rejected before opening instead of waiting for a FIFO writer', { skip: process.platform === 'win32', timeout: 5000 }, async t => {
  const { options } = await fixture(t);
  await rm(options.manifest);
  execFileSync('mkfifo', [options.manifest]);
  await refuses(inspectWorkspace(options), /regular file/);
});
