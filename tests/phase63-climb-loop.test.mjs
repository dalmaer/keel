import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, cp, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { acme, climb, json, load, stubGh, page, LOOP, STITCH, findingText, git, commit, write } from './helpers/climb.mjs';
import { treeState } from './helpers/prove.mjs';

async function project(t, phases, jobs = ['loop']) {
  const config = { practices: ['loop'], phases, check: 'touch gate-ran' };
  const dir = await acme(t, {
    climb: { jobs }, config,
    files: {
      'scripts/loop.mjs': await readFile(LOOP, 'utf8'),
      '.stitch.json': '{"workspace":"acme"}\n',
      'docs/phases/01-acme.md': '# Archived Acme plan\n',
      'docs/LOOP.md': 'Historical Acme Loop page\n',
      'docs/loop/acme.md': await findingText({ title: 'Acme finding', loop: ['acme-id'], body: '# Acme\n\n## Our read\n\nNot checked.' }),
      'docs/health/2026-10-01.md': page([['loop_untriaged', 99, '≤ 0', 'outside']]),
    },
  });
  return { dir, config: JSON.parse(await readFile(join(dir, '.keel/keel.json'), 'utf8')), module: await load(dir) };
}

for (const phases of [{ source: 'milestones' }, { source: 'unsupported' }, { source: null }, null]) {
  test(`climb Loop job is unavailable before selection, measurement or guard: ${JSON.stringify(phases)}`, async t => {
    const { dir, config, module } = await project(t, phases);
    const before = await treeState(dir);
    // No PR lookup, no local finding scan, no baseline, no candidate gate.
    const picked = climb(dir, ['pick', '--force', '--json'], { KEEL_GH: '/does-not-exist' });
    assert.equal(picked.status, 0, picked.stdout + picked.stderr);
    assert.equal(json(picked).job, null);
    assert.match(json(picked).reason, /loop job unavailable.*phases/);
    assert.deepEqual(await module.signalsOf('/does-not-exist', config, ['loop']), []);
    assert.throws(() => module.JOBS.loop.command(config), /loop job unavailable/);
    const measured = climb(dir, ['measure', 'loop', '--baseline', '--json']);
    assert.equal(measured.status, 2, measured.stdout + measured.stderr);
    assert.match(json(measured).error, /loop job unavailable/);
    assert.deepEqual(await treeState(dir), before);
    const base = git(dir, ['rev-parse', 'HEAD']);
    // A raw file edit bypasses loop.mjs propose entirely; guard must still refuse it.
    await commit(dir, { 'docs/loop/acme.md': await findingText({ title: 'Acme finding', loop: ['acme-id'], decision: 'proposed', rank: 'next', phase: 1, since: '2026-10-11', note: 'Acme evidence', body: '# Acme\n\n## Our read\n\nlib/acme.mjs:1 confirms it.' }) }, 'acme: raw proposal');
    await write(dir, { '.keel/climb/night.json': JSON.stringify({ job: 'loop', base }) });
    const candidate = await treeState(dir);
    for (const args of [['guard', '--base', base, '--job', 'loop', '--json'], ['guard', '--json']]) {
      const guarded = climb(dir, args);
      assert.equal(guarded.status, 1, guarded.stdout + guarded.stderr);
      assert.match(json(guarded).problems.join('\n'), /loop job unavailable/);
      assert.deepEqual(await treeState(dir), candidate, 'guard neither runs the gate nor rewrites the night or archives');
    }
    assert.match((await module.proposalsProblems({ root: '/does-not-exist', config, job: 'loop' })).join('\n'), /loop job unavailable/);
  });
}

test('stale Loop health rows cannot select unavailable Loop over another climb job', async t => {
  const { dir } = await project(t, { source: 'milestones' }, ['loop', 'test-time']);
  const picked = climb(dir, ['pick', '--force', '--json'], { KEEL_GH: await stubGh(t, []) });
  assert.equal(picked.status, 0, picked.stdout + picked.stderr);
  assert.equal(json(picked).job, 'test-time');
  assert.match(json(picked).unavailable[0].reason, /loop job unavailable/);
});

for (const phases of [undefined, { source: 'files' }]) {
  test(`file source still selects and measures the Loop job: ${JSON.stringify(phases)}`, async t => {
    const { dir } = await project(t, phases);
    const picked = climb(dir, ['pick', '--force', '--json'], { KEEL_GH: await stubGh(t, []) });
    assert.equal(picked.status, 0, picked.stdout + picked.stderr);
    assert.equal(json(picked).job, 'loop');
    const measured = climb(dir, ['measure', 'loop', '--json']);
    assert.equal(measured.status, 0, measured.stdout + measured.stderr);
    assert.equal(json(measured).median, 1);
  });
}

test('existing climb Loop pull can still collect under milestones without hooks, proof or archive writes', async t => {
  const { dir } = await project(t, { source: 'milestones' });
  const configPath = join(dir, '.keel/keel.json');
  const cfg = JSON.parse(await readFile(configPath, 'utf8'));
  cfg.loop = { prove: true, afterRender: 'touch hook-ran' };
  await writeFile(configPath, JSON.stringify(cfg));
  await mkdir(join(dir, '.keel/climb'), { recursive: true });
  await writeFile(join(dir, '.keel/climb/night.json'), JSON.stringify({ job: 'loop', base: git(dir, ['rev-parse', 'HEAD']) }));
  const stub = join(dir, 'stitch.mjs');
  await cp(STITCH, stub);
  await chmod(stub, 0o755);
  const harness = join(dir, 'claude');
  await writeFile(harness, '#!/bin/sh\ntouch proof-ran\n', { mode: 0o755 });
  const state = join(dir, 'stitch-state.json'), log = join(dir, 'stitch-log.jsonl');
  await writeFile(state, JSON.stringify({ insights: [{ id: 'acme-new', title: 'Acme new insight', state: 'ACTIVE', priority: 'P2' }] }));
  await writeFile(log, '');
  const archive = await Promise.all(['docs/phases/01-acme.md', 'docs/LOOP.md'].map(p => readFile(join(dir, p), 'utf8')));
  const pulled = climb(dir, ['loop-pull', '--json'], { KEEL_STITCH: stub, STITCH_API_KEY: 'fake-acme', STITCH_STUB_STATE: state, STITCH_STUB_LOG: log, ANTHROPIC_API_KEY: 'fake-acme', CLAUDE_BIN: harness });
  assert.equal(pulled.status, 0, pulled.stdout + pulled.stderr);
  assert.equal(json(pulled).pulled, true);
  assert.ok(json(pulled).untriaged.includes('acme-new-insight'));
  assert.deepEqual(await Promise.all(['docs/phases/01-acme.md', 'docs/LOOP.md'].map(p => readFile(join(dir, p), 'utf8'))), archive);
  for (const path of ['proof-ran', 'hook-ran', 'gate-ran']) assert.equal(existsSync(join(dir, path)), false);
  assert.deepEqual((await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line).args.slice(0, 2)), [['find', 'insights']]);
});

test('forced milestone Loop baseline refuses before writing its night record', async t => {
  const { dir } = await project(t, { source: 'milestones' });
  const before = await treeState(dir);
  const result = climb(dir, ['measure', 'loop', '--baseline', '--json']);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(json(result).error, /loop job unavailable/);
  assert.deepEqual(await treeState(dir), before);
});

test('milestone guard rejects a raw archived-phase proposal independently of pick and measure', async t => {
  const { dir } = await project(t, { source: 'milestones' });
  const base = git(dir, ['rev-parse', 'HEAD']);
  await commit(dir, { 'docs/loop/acme.md': await findingText({ title: 'Acme finding', loop: ['acme-id'], decision: 'proposed', rank: 'next', phase: 'new', since: '2026-10-11', note: 'Acme evidence', body: '# Acme\n\n## Our read\n\nlib/acme.mjs:1 confirms it.' }) }, 'acme: raw new phase proposal');
  const before = await treeState(dir);
  const result = climb(dir, ['guard', '--base', base, '--job', 'loop', '--json']);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(json(result).problems.join('\n'), /loop job unavailable/);
  assert.deepEqual(await treeState(dir), before);
});
