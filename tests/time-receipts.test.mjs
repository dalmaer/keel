import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fill } from '../lib/practices.mjs';
import { nodePlan, readReceiptPlan, suiteCollector, isStallsReceipt } from '../practices/night/files/scripts/keel/time-receipts.mjs';

test('receipt JSON boundary round-trips producer plans and rejects malformed claims', async t => {
  const root = await mkdtemp(join(tmpdir(), 'acme-receipt-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'tests'));
  await writeFile(join(root, 'tests/acme.test.mjs'), '');
  const options = {root, words: s => s.split(' '), flags: words => words.filter(s => s.startsWith('--')).map(s => ({words: [s]}))};
  const plan = await nodePlan({...options, script: 'node --test tests/acme.test.mjs'});
  const read = value => readReceiptPlan({KEEL_SUITE_PLAN: JSON.stringify(value)});
  assert.equal(plan.available, true);
  assert.deepEqual(await read(plan), plan);
  const globPlan = await nodePlan({...options, script: 'node --test tests/*.test.mjs'});
  assert.equal(globPlan.available, true);
  assert.deepEqual(await read(globPlan), globPlan);
  // The existing literal grammar refuses absolute selectors, even inside root.
  const absolutePlan = await nodePlan({...options, script: `node --test ${join(root, 'tests/acme.test.mjs')}`});
  assert.equal(absolutePlan.available, false);
  assert.deepEqual(await read(absolutePlan), absolutePlan);
  for (const nesting of [undefined, null, '1', -1, 0.5]) {
    const collector = suiteCollector({root, plan, flagsHash: plan.executionSettings.flagsHash});
    collector.push({type: 'test:pass', data: {file: join(root, 'tests/acme.test.mjs'), name: 'Acme', testId: 1, nesting, details: {type: 'test', duration_ms: 1}}});
    for (const file of [join(root, 'tests/acme.test.mjs'), undefined]) collector.push({type: 'test:summary', data: {file, duration_ms: 1, success: true, counts: {tests: 1, suites: 0}}});
    const receipt = collector.finish();
    assert.equal(receipt.complete, true);
    assert.equal(receipt.inventoryComplete, false);
    assert.ok(receipt.inventoryProblems.includes('logical nesting unavailable'));
  }
  const absent = await nodePlan({...options, script: 'npm test && echo Acme'});
  assert.deepEqual(await read(absent), absent);
  const malformed = [null, [], {}, {...plan, version: 2}, {...plan, invocationId: 1},
    {...plan, expectedFiles: ['../outside.mjs']}, {...plan, expectedFiles: [null]},
    {...plan, executionSettings: null}, {...plan, executionSettings: {...plan.executionSettings, filtered: 'false'}},
    {...plan, executionSettings: {...plan.executionSettings, selection: [1]}},
    {...absent, expectedFiles: []}, {...absent, reason: null}];
  for (const value of malformed) assert.equal(await read(value), null, JSON.stringify(value));
  assert.equal(await readReceiptPlan({KEEL_SUITE_PLAN: '{'}), null);
  assert.equal(await readReceiptPlan({}), null);
});

test('unknown collector events cannot establish measured completion', () => {
  const collector = suiteCollector({root: '/acme', plan: null, flagsHash: 'acme'});
  for (const event of [null, [], false, {type: 'test:summary', data: {duration_ms: '0', success: true, counts: []}}]) collector.push(event);
  const receipt = collector.finish();
  assert.equal(receipt.complete, false);
  assert.equal(receipt.inventoryComplete, false);
  assert.notEqual(receipt.aggregate.durationMs, 0);
  for (const value of [null, [], {}, {identity: null}, {identity: {target: []}}]) assert.equal(isStallsReceipt(value), false);
});


test('checked production templates survive adopter interpolation byte for byte', async () => {
  const config = JSON.parse(await readFile(new URL('../tsconfig.json', import.meta.url), 'utf8'));
  const sources = config.include.filter(path => path.startsWith('practices/') && path.endsWith('.mjs'));
  assert.ok(sources.length > 0);
  for (const path of sources) {
    const source = await readFile(new URL('../' + path, import.meta.url), 'utf8');
    const target = path.split('/files/')[1];
    // The actual renderer must leave checked source intact: the same bytes
    // typechecked by contributors are installed as directly executable JS.
    assert.equal(fill(source, {name: 'Acme', repo: 'acme/anvils'}, target), source, path);
  }
});
