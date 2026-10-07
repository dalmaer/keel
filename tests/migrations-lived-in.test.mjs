// 0006: an update keeps a project's lived-in; a project started on 0.8.15 starts without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { view } from '../lib/migrations.mjs';
import * as m0006 from '../migrations/0006-lived-in-kept.mjs';

async function acme(t, config) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'keel-0006-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, '.keel'), { recursive: true });
  await writeFile(join(dir, '.keel', 'keel.json'), `${JSON.stringify({ name: 'Acme', ...config }, null, 2)}\n`);
  return dir;
}
const run = async dir => {
  const project = await view(dir);
  if (!(await m0006.applies(project))) return null;
  return JSON.parse((await m0006.up(project)).find(e => e.path === '.keel/keel.json').content);
};

test('0006: a project updating from before 0.8.15 with keel\'s phases keeps lived-in on, and the update says how to drop it', async t => {
  const config = await run(await acme(t, { practice: '0.8.14', practices: ['base', 'phases'], phases: { shape: 'files' } }));
  assert.deepEqual(config.phases, { shape: 'files', livedIn: true }, 'kept, beside what phases already held');
  assert.equal(config.practice, '0.8.14', 'nothing else changes');
  assert.match((await m0006.notes())[0], /delete that line to count built only/);
});

test('0006: a project started on 0.8.15, one that chose, one with its own phases, or none: untouched', async t => {
  assert.equal(await run(await acme(t, { practice: '0.8.15', practices: ['base', 'phases'] })), null, 'started without lived-in');
  assert.equal(await run(await acme(t, { practice: '0.8.2', practices: ['base', 'phases'], phases: { livedIn: false } })), null, 'its own choice stands');
  assert.equal(await run(await acme(t, { practice: '0.8.2', practices: ['base'], local: { phases: 'its own roadmap' } })), null, 'its own roadmap keeps its own policy');
  assert.equal(await run(await acme(t, { practice: '0.8.2', practices: ['base'], phases: { shape: 'projects' } })), null, 'the projects shape');
});
