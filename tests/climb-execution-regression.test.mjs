// Regression for issue 232: action success is not execution success.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agentVerdict } from '../scripts/plates/climb.mjs';
import { acme, climb } from './helpers/climb.mjs';

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
