// Regression for issue 232: action success is not execution success.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { agentVerdict } from '../scripts/plates/climb.mjs';
import { acme, climb, commit, git, json } from './helpers/climb.mjs';

test('success plus permission denials cannot authorize judging an unchanged head', () => {
  const r = agentVerdict({ outcome: 'success', result: { is_error: false, num_turns: 30, duration_ms: 79452, permission_denials_count: 6 }, elapsedSec: 92, minutes: 45 });
  assert.equal(r.ok, false);
  assert.equal(r.state, 'blocked');
  assert.equal(r.denials.count, 6);
  assert.equal(r.denials.detailsAvailable, false, 'missing denied operations are not invented');
});

test('missing execution evidence fails closed on success and timeout', () => {
  for (const [outcome, result, elapsedSec] of [['success', null, 90], ['success', {}, 90], ['failure', null, 2700]]) {
    assert.equal(agentVerdict({ outcome, result, elapsedSec, minutes: 45 }).ok, false);
  }
});

test('the night starts before the baseline executes', async t => {
  const dir = await acme(t, { climb: { jobs: ['test-time'], testCommand: 'node stamp.mjs' }, files: { 'stamp.mjs': 'import {writeFileSync} from "node:fs"; writeFileSync("observed.json", JSON.stringify(Date.now()));' } });
  const before = Date.now();
  const r = climb(dir, ['measure', 'test-time', '--baseline', '--runs', '1', '--json']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const night = JSON.parse(await readFile(join(dir, '.plates/climb/night.json'), 'utf8'));
  const observed = JSON.parse(await readFile(join(dir, 'observed.json'), 'utf8'));
  assert.ok(Date.parse(night.started) >= before);
  assert.ok(Date.parse(night.started) <= observed, 'baseline time must belong to the night');
  assert.equal(night.baseline.started, night.started);
  assert.ok(Date.parse(night.baseline.ended) >= observed);
});


test('settlement retains unmeasured work across processes and retries without publishing it', async t => {
  for (const kind of ['commit', 'uncommitted', 'untouched', 'losing-trial']) {
    const dir = await acme(t, { files: { '.gitignore': '.plates/climb/\n', 'acme.txt': 'base\n' } });
    const base = git(dir, ['rev-parse', 'HEAD']);
    await mkdir(join(dir, '.plates/climb'), { recursive: true });
    const path = join(dir, '.plates/climb/night.json');
    const tried = kind === 'losing-trial' ? [{ verdict: 'revert', what: 'no gain', rounds: [{ base: 100, candidate: 99, change: -0.01 }, { base: 100, candidate: 99, change: -0.01 }] }] : [];
    await writeFile(path, JSON.stringify({ job: 'test-time', date: '2026-10-23', started: new Date().toISOString(), base, command: 'npm test', baseline: { median: 100 }, margin: 0.05, tried }));
    const discarded = kind === 'commit' || kind === 'uncommitted';
    if (kind === 'commit') await commit(dir, { 'acme.txt': 'candidate\n' }, 'acme: unmeasured candidate');
    if (kind === 'uncommitted') await writeFile(join(dir, 'acme.txt'), 'unfinished\n');
    const from = git(dir, ['rev-parse', 'HEAD']);
    const run = args => { const r = climb(dir, [...args, '--json']); assert.equal(r.status, 0, r.stdout + r.stderr); return json(r); };
    assert.equal(run(['settle', '--base', base]).dropped, discarded);
    assert.equal(git(dir, ['rev-parse', 'HEAD']), base);
    assert.equal(await readFile(join(dir, 'acme.txt'), 'utf8'), 'base\n');
    assert.equal(run(['report', '--base', base]).state, discarded ? 'incomplete' : kind === 'losing-trial' ? 'no-improvement' : 'no-candidate');
    const retained = JSON.parse(await readFile(path, 'utf8')).settlements;
    if (discarded) {
      assert.equal(retained.length, 1);
      assert.deepEqual({ ...retained[0], at: null }, { from, to: base, uncommitted: kind === 'uncommitted', at: null });
      assert.ok(Number.isFinite(Date.parse(retained[0].at)));
    }
    assert.equal(run(['settle', '--base', base]).dropped, false);
    const report = run(['report', '--base', base]);
    assert.equal(report.state, discarded ? 'incomplete' : kind === 'losing-trial' ? 'no-improvement' : 'no-candidate');
    assert.equal(report.kept, 0, 'publish receives no kept changes');
    assert.equal(report.body, null);
    assert.equal(report.text, undefined, 'report JSON exposes no publication text');
    assert.equal(report.issue, null);
    if (kind !== 'losing-trial') assert.match(report.line, /no measured attempts recorded/);
    if (discarded) assert.match(report.line, /incomplete: unmeasured work recorded at settlement/);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).settlements, retained, 'settle retry and report preserve evidence');
  }
});
