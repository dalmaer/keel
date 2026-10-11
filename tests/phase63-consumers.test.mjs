import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, readdir, chmod, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { run, testsRan } from './helpers/run.mjs';
import { render as installPractices } from '../lib/practices.mjs';
import { phaseZero } from '../lib/init.mjs';
import { run as roadmap } from '../practices/phases/files/scripts/roadmap.mjs';
import { acmeRepo, treeState, ENV } from './helpers/prove.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const BIN = join(ROOT, 'bin/keel.mjs');
const LOOP = join(ROOT, 'practices/loop/files');
async function temporary(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'keel-consumers-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function config(dir, value) {
  await mkdir(join(dir, '.keel'), { recursive: true });
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify(value));
}

for (const phases of [{ source: 'milestones' }, { source: 'unsupported' }, { source: null }, { shape: 'projects' }]) {
  test(`prove refuses evidence before running the proof: ${JSON.stringify(phases)}`, async t => {
    const dir = await acmeRepo(join(await temporary(t), 'acme'));
    await mkdir(join(dir, 'docs/phases'), { recursive: true });
    await mkdir(join(dir, 'docs/evidence'), { recursive: true });
    await writeFile(join(dir, 'docs/phases/01-acme.md'), '---\nevidence: ["evidence/acme.md"]\n---\n# Acme archive\n');
    await writeFile(join(dir, 'docs/evidence/acme.md'), 'Historical proof\n');
    // A runner outside scratch records any execution, even if the final write is refused.
    const marker = join(dir, 'ran-proof');
    await config(dir, { phases, prove: { command: `touch '${marker}'` } });
    const before = await treeState(dir);
    const result = run(process.execPath, [BIN, 'prove', 'tests/add.test.mjs', '--fix', 'lib/add.mjs', '--evidence', '1', '--json'], { cwd: dir, env: ENV });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(JSON.parse(result.stdout).error, /phases.source|numbered file phases/);
    assert.deepEqual(await treeState(dir), before, 'no proof ran and every archived byte is unchanged');
  });
}

for (const phases of [undefined, { source: 'milestones' }, { shape: 'projects' }]) {
  test(`prove without evidence still verifies: ${JSON.stringify(phases)}`, async t => {
    const dir = await acmeRepo(join(await temporary(t), 'acme'));
    if (phases) await config(dir, { phases });
    const before = await treeState(dir);
    const result = run(process.execPath, [BIN, 'prove', 'tests/add.test.mjs', '--fix', 'lib/add.mjs', '--json'], { cwd: dir, env: ENV });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).verdict, 'VERIFIED');
    assert.deepEqual(await treeState(dir), before);
  });
}

async function installed(t, withNight) {
  const base = await temporary(t), dir = join(base, 'acme');
  await cp(join(ROOT, 'tests/fixtures/loop/acme'), dir, { recursive: true });
  for (const path of ['scripts/loop.mjs', 'tests/loop.test.mjs']) {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await cp(join(LOOP, path), join(dir, path));
  }
  if (withNight) {
    await mkdir(join(dir, 'scripts/keel'), { recursive: true });
    await cp(join(ROOT, 'practices/night/files/scripts/keel/planning-config.mjs'), join(dir, 'scripts/keel/planning-config.mjs'));
  }
  await writeFile(join(dir, 'docs/LOOP.md'), 'Historical Loop page, preserved verbatim.\n');
  await config(dir, { phases: { source: 'milestones' }, loop: { prove: true, afterRender: 'touch after-render-ran' } });
  const stub = join(base, 'stitch.mjs');
  await cp(join(ROOT, 'tests/fixtures/loop/stitch.mjs'), stub);
  await chmod(stub, 0o755);
  const harness = join(base, 'claude');
  await writeFile(harness, '#!/bin/sh\ntouch proof-ran\nexit 1\n');
  await chmod(harness, 0o755);
  const state = join(base, 'state.json'), calls = join(base, 'calls.jsonl');
  await writeFile(state, JSON.stringify({ insights: [{ id: 'acme-insight', title: 'Acme new insight', state: 'ACTIVE', priority: 'P2', description: 'Acme data' }] }));
  await writeFile(calls, '');
  const env = { ...process.env, KEEL_STITCH: stub, STITCH_STUB_STATE: state, STITCH_STUB_LOG: calls, STITCH_WORKSPACE: 'acme', ANTHROPIC_API_KEY: 'fake-acme', CLAUDE_BIN: harness };
  const loop = (...args) => run(process.execPath, [join(dir, 'scripts/loop.mjs'), ...args], { cwd: dir, env });
  return { dir, env, loop, calls };
}
async function bytes(dir) {
  const result = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    result[entry.name] = entry.isDirectory() ? await bytes(path) : (await readFile(path)).toString('base64');
  }
  return result;
}
for (const withNight of [false, true]) {
  test(`installed Loop source switch preserves archives and gate (night validator: ${withNight})`, async t => {
    const { dir, env, loop, calls } = await installed(t, withNight);
    const before = await bytes(dir);
    for (const args of [
      ['propose', 'widget-cache-ignores-expiry', '--rank', 'next', '--phase', '1', '--note', 'Acme', '--read', 'lib/acme.mjs:1 confirms this'],
      ['propose', 'widget-cache-ignores-expiry', '--phase', 'new', '--no-render'],
      ['decide', 'widget-cache-ignores-expiry', 'accepted', '--no-push'],
      ['decide', 'widget-cache-ignores-expiry', 'accepted', '--phase', 'new', '--yes'],
      ['prove'], ['push', '--yes'],
    ]) {
      const result = loop(...args);
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.match(result.stderr, /unsupported.*phases.source milestones/);
      assert.deepEqual(await bytes(dir), before);
    }
    for (const args of [['render'], ['render', '--check']]) {
      const result = loop(...args);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /inactive/);
      assert.deepEqual(await bytes(dir), before);
    }
    const gate = run('npm', ['run', 'check'], { cwd: dir, env });
    assert.equal(gate.status, 0, gate.stdout + gate.stderr);
    assert.equal(testsRan(gate.stdout), 2, 'the installed Loop guards actually ran');
    assert.deepEqual(await bytes(dir), before);
    assert.equal(await readFile(calls, 'utf8'), '', 'refused commands never contacted Loop');
    const listing = loop('list', '--json');
    assert.equal(listing.status, 0, listing.stderr);
    assert.ok(JSON.parse(listing.stdout).length);
    const mined = loop('mine', 'acme-priority', '--yes');
    assert.equal(mined.status, 0, mined.stdout + mined.stderr);
    assert.deepEqual(await bytes(dir), before, 'mine does not prove, render or run hooks');
    const pulled = loop('pull');
    assert.equal(pulled.status, 0, pulled.stdout + pulled.stderr);
    assert.match(pulled.stdout, /inactive/);
    const after = await bytes(dir);
    assert.deepEqual(after.docs.phases, before.docs.phases);
    assert.equal(after.docs['LOOP.md'], before.docs['LOOP.md']);
    assert.equal(after['after-render-ran'], undefined);
    assert.equal(after['proof-ran'], undefined);
    assert.ok(Object.keys(after.docs.loop).length > Object.keys(before.docs.loop).length);
    assert.equal(JSON.parse(loop('list', '--json').stdout).find(f => f.title === 'Acme new insight').decision, 'untriaged');
  });
}

for (const withNight of [false, true]) {
  test(`Loop refuses unknown planning source before writes (night validator: ${withNight})`, async t => {
    const { dir, loop, calls } = await installed(t, withNight);
    await config(dir, { phases: { source: 'unsupported' } });
    const before = await bytes(dir);
    for (const args of [['pull'], ['render', '--check'], ['propose', 'widget-cache-ignores-expiry', '--phase', 'new']]) {
      const result = loop(...args);
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.match(result.stderr, /phases.source must be files or milestones/);
      assert.deepEqual(await bytes(dir), before);
    }
    assert.equal(await readFile(calls, 'utf8'), '');
  });
}


test('standalone Loop planning validator matches the shared validator exactly', async () => {
  const canonical = await readFile(join(ROOT, 'practices/night/files/scripts/keel/planning-config.mjs'), 'utf8');
  const loop = await readFile(join(LOOP, 'scripts/loop.mjs'), 'utf8');
  const body = canonical.slice(canonical.indexOf('export function planningConfig'), canonical.indexOf('export const milestoneSource'))
    .replace('export function planningConfig', 'function standalonePlanningConfig').trim();
  assert.ok(loop.includes(body), 'standalone validator must match the shared function body');
});

test('normal seeded gate with optional Loop survives a milestone source switch', async t => {
  const dir = await temporary(t);
  const cfg = { name: 'Acme', tagline: 'Acme ships anvils.', repo: 'acme/anvils', practices: ['base', 'agents-md', 'phases', 'evidence', 'lessons', 'conduct', 'ci', 'night', 'renovate'] };
  await config(dir, cfg);
  await installPractices(dir);
  cfg.practices.push('loop');
  await config(dir, cfg);
  const guide = join(dir, 'AGENTS.md');
  await writeFile(guide, await readFile(guide, 'utf8') + '\n<!-- keel:begin loop -->\n<!-- keel:end loop -->\n');
  await installPractices(dir);
  const template = await readFile(join(dir, 'docs/templates/phase.md'), 'utf8');
  await writeFile(join(dir, 'docs/phases/00-acme.md'), phaseZero(template, { name: 'Acme', kind: 'node', since: '2026-10-10' }));
  await roadmap({ root: dir });
  const loop = (...args) => run(process.execPath, [join(dir, 'scripts/loop.mjs'), ...args], { cwd: dir });
  assert.equal(loop('render').status, 0);
  const gate = () => run('npm', ['run', 'check'], { cwd: dir, timeout: 120000 });
  const local = gate();
  assert.equal(local.status, 0, local.stdout + local.stderr);
  cfg.phases = { source: 'milestones' };
  await config(dir, cfg);
  await writeFile(join(dir, 'docs/LOOP.md'), 'Acme archival page, no longer generated.\n');
  const before = await bytes(join(dir, 'docs'));
  const remote = gate();
  assert.equal(remote.status, 0, remote.stdout + remote.stderr);
  assert.ok(testsRan(remote.stdout) >= 3, 'installed Loop and generated-file guards actually ran');
  assert.deepEqual(await bytes(join(dir, 'docs')), before);
});
