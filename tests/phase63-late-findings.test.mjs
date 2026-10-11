import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adopt } from '../lib/adopt.mjs';
import { MEASURES, measure, propose, exitCode } from '../practices/night/files/scripts/keel/improve.mjs';
import { rememberQuota } from '../practices/night/files/scripts/keel/quota.mjs';
import { milestoneConfig, milestone, response } from './helpers/milestones.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'acme-late-findings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.keel'));
  await mkdir(join(root, 'docs'));
  return { root, env: { ...process.env, KEEL_CACHE: join(root, 'cache'), KEEL_CI_OFFLINE: '1', KEEL_MILESTONES_OFFLINE: '0' } };
}

for (const file of ['goals.json', 'milestones.json']) {
  for (const contents of ['[]\n', '', 'Acme unfinished JSON']) {
    test(`actual adoption preserves local ${file} (${JSON.stringify(contents)}) without auth or discovery`, async t => {
      const { root, env } = await fixture(t);
      const path = join(root, 'docs', file);
      await writeFile(path, contents);
      await writeFile(join(root, '.keel/keel.json'), JSON.stringify({ name: 'Acme', repo: 'acme/anvils' }));
      const calls = join(root, 'gh-calls');
      await writeFile(calls, '');
      const gh = join(root, 'gh');
      await writeFile(gh, `#!${process.execPath}\nimport { appendFileSync } from 'node:fs';\nappendFileSync(process.env.ACME_CALLS, JSON.stringify(process.argv.slice(2)) + '\\n');\nprocess.exit(1);\n`);
      await chmod(gh, 0o755);
      const deps = { version: { cli: '0.0.0', practice: '0.0.0', commit: null }, ciEnv: { ...env, KEEL_GH: gh, ACME_CALLS: calls } };
      const { data } = await adopt({ dir: root, check: 'node --test' }, deps);
      assert.equal(await readFile(calls, 'utf8'), '', 'no gh auth, quota probe or query');
      assert.notEqual(data.config.phases?.source, 'milestones');
      assert.equal(await readFile(path, 'utf8'), contents);
      const why = data.practices.find(p => p.name === 'phases').why;
      assert.match(why, /existing local planning files preserved; milestone discovery skipped/);
      assert.doesNotMatch(why, /complete milestone discovery found no described milestones/);
      assert.equal(data.milestoneDiscovery.state, 'unavailable');

      // An explicitly chosen remote source still wins over these same local bytes.
      await writeFile(join(root, '.keel/keel.json'), JSON.stringify({ name: 'Acme', repo: 'acme/anvils', phases: { source: 'milestones' } }));
      const selected = await adopt({ dir: root, dryRun: true }, deps);
      assert.equal(selected.data.config.phases.source, 'milestones');
      assert.equal(await readFile(calls, 'utf8'), '');
      assert.equal(await readFile(path, 'utf8'), contents);
    });
  }
}

const measures = MEASURES.filter(m => ['phases_without_issue', 'phases_stuck'].includes(m.id));
test('night quota saving is unknown, exits zero and proposes no instrument repair', async t => {
  const { root, env } = await fixture(t);
  env.KEEL_QUOTA_FLOOR = '1000';
  await rememberQuota(env, { remaining: 12, resetAt: new Date(Date.now() + 3600000).toISOString() });
  let calls = 0;
  const results = await measure({ root, env, config: milestoneConfig, measures,
    keel: { milestones: { graphql: async () => { calls++; throw new Error('unexpected query'); } } } });
  assert.equal(calls, 0);
  assert.equal(results.length, 2);
  for (const r of results) {
    assert.equal(r.state, 'n/a');
    assert.equal(r.value, null);
    assert.match(r.detail, /saving your GitHub quota \(12 left/);
  }
  assert.equal(exitCode(results), 0);
  assert.equal(propose(results, milestoneConfig), null);
});

for (const kind of ['reader', 'programming', 'missing data']) {
  test(`night ${kind} failures remain broken with exit two and a repair proposal`, async t => {
    const { root, env } = await fixture(t);
    const graphql = async () => {
      if (kind === 'missing data') return {};
      if (kind === 'programming') throw new TypeError('Acme programming failure');
      throw new Error('saving your GitHub quota: unexpected reader error, not Saving');
    };
    const results = await measure({ root, env, config: milestoneConfig, measures,
      keel: { milestones: { guard: async () => null, graphql } } });
    assert.ok(results.every(r => r.state === 'broken' && r.value === null));
    assert.equal(exitCode(results), 2);
    assert.match(propose(results, milestoneConfig).text, /Fix the .* instrument/);
  });
}

test('night incomplete milestone coverage stays unknown', async t => {
  const { root, env } = await fixture(t);
  const results = await measure({ root, env, config: milestoneConfig, measures,
    keel: { milestones: { guard: async () => null, graphql: async () => response([{ ...milestone(1), description: '' }]) } } });
  assert.ok(results.every(r => r.state === 'n/a' && r.value === null));
  assert.match(results[0].detail, /coverage incomplete/);
  assert.equal(exitCode(results), 0);
  assert.equal(propose(results, milestoneConfig), null);
});
