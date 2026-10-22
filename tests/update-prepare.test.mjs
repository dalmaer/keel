import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readlink, chmod, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareUpdate } from '../lib/update-prepare.mjs';

const acmePractices = () => new Map([['acme', { name: 'acme', requires: [], files: [{ practice: 'acme', path: 'acme.txt', kind: 'seeded', template: 'Acme seed' }] }]]);

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'acme-update-prepare-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.keel'));
  await writeFile(join(root, '.keel/keel.json'), JSON.stringify({ name: 'Acme', practices: ['acme'], practice: '1.0.0', check: 'this-command-must-never-run' }));
  await writeFile(join(root, '.keel/lock.json'), JSON.stringify({ practice: '1.0.0', files: {} }));
  return root;
}
test('shared preparation consumes setup-generated inputs, runs equal-version pending migrations, and never executes check', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'generated.txt'), 'Acme generated input');
  const migration = { id: '9000-acme', to: '1.0.0', summary: 'Acme consumes generated setup input',
    applies: async p => await p.exists('generated.txt'),
    up: async p => [{ path: 'result.txt', content: await p.read('generated.txt') }] };
  const result = await prepareUpdate(root, { version: '1.0.0', practices: acmePractices(), migrations: [migration] });
  assert.equal(await readFile(join(root, 'result.txt'), 'utf8'), 'Acme generated input');
  assert.deepEqual(JSON.parse(await readFile(join(root, '.keel/keel.json'))).migrations, ['9000-acme']);
  assert.equal(result.check, 'this-command-must-never-run');
  await result.restore();
  await assert.rejects(readFile(join(root, 'result.txt')), { code: 'ENOENT' });
  assert.equal(JSON.parse(await readFile(join(root, '.keel/keel.json'))).migrations, undefined);
});
test('shared preparation restores original file bytes, executable mode and symlink after caller refusal', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'executable'), 'old'); await chmod(join(root, 'executable'), 0o755);
  await symlink('executable', join(root, 'alias'));
  const migration = { id: '9001-acme', to: '1.0.0', summary: 'Acme edits', applies: async () => true,
    up: async () => [{ path: 'executable', content: 'new' }, { path: 'alias', content: null }] };
  const result = await prepareUpdate(root, { version: '1.0.0', practices: acmePractices(), migrations: [migration] });
  await result.restore();
  assert.equal(await readFile(join(root, 'executable'), 'utf8'), 'old');
  assert.equal((await lstat(join(root, 'executable'))).mode & 0o777, 0o755);
  assert.equal(await readlink(join(root, 'alias')), 'executable');
});
test('shared preparation migration failure writes nothing and rejects newer-project and self targets', async t => {
  const root = await fixture(t);
  const before = await readFile(join(root, '.keel/keel.json'), 'utf8');
  await assert.rejects(prepareUpdate(root, { version: '1.0.0', practices: acmePractices(), migrations: [
    { id: '9002-acme', to: '1.0.0', summary: 'Acme failure', applies: async () => true, up: async () => { throw Error('Acme refuses'); } },
  ] }), /Acme refuses/);
  assert.equal(await readFile(join(root, '.keel/keel.json'), 'utf8'), before);
  await assert.rejects(prepareUpdate(root, { version: '0.9.0', practices: acmePractices(), migrations: [] }), /older/);
  await writeFile(join(root, '.keel/keel.json'), JSON.stringify({ ...JSON.parse(before), keel: 'self' }));
  await assert.rejects(prepareUpdate(root, { version: '1.0.0', practices: acmePractices(), migrations: [] }), /itself/);
});
