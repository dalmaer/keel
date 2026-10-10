import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fill } from '../lib/practices.mjs';
import { run } from './helpers/run.mjs';
import { shellWords, flagsIn } from '../practices/night/files/scripts/keel/test-ledger.mjs';
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

// Issue #91: Node added testId in 24.16 and parentId in 24.19. A Node 24 before
// them still says each test's file and nesting, in declaration order, where a
// test's subtests come just before it. An inventory keyed on testId kept only
// the last test of each file (`file:undefined`).
const ACME_SUITE = {
  'tests/acme.test.mjs': `import { test, describe, it } from 'node:test';
test('Acme anvil', () => {});
describe('Acme rockets', () => {
  it('launches', () => {});
  describe('stage two', () => { it('separates', () => {}); it('launches', () => {}); });
  it('lands', () => {});
});
test('Acme crate', async t => {
  await t.test('is packed', () => {});
  await t.test('is shipped', async t => { await t.test('by rail', () => {}); await t.test('by road', () => {}); });
});
test('Acme catapult', { concurrency: true }, async t => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await Promise.all([t.test('winds', () => wait(20)), t.test('fires', () => wait(1))]);
});
for (const n of ['one', 'two', 'three']) test('Acme magnet ' + n, () => {});
`,
  'tests/anvil.test.mjs': `import { test, describe, it } from 'node:test';
describe('Acme anvil', () => { for (let i = 1; i <= 5; i++) it('drops ' + i, () => {}); });
test('Acme spring', () => {});
`,
};
const ACME_HIERARCHIES = [
  'acme|Acme anvil', 'acme|Acme rockets', 'acme|Acme rockets/launches', 'acme|Acme rockets/stage two', 'acme|Acme rockets/stage two/separates',
  'acme|Acme rockets/stage two/launches', 'acme|Acme rockets/lands', 'acme|Acme crate', 'acme|Acme crate/is packed', 'acme|Acme crate/is shipped',
  'acme|Acme crate/is shipped/by rail', 'acme|Acme crate/is shipped/by road', 'acme|Acme catapult', 'acme|Acme catapult/winds', 'acme|Acme catapult/fires',
  'acme|Acme magnet one', 'acme|Acme magnet two', 'acme|Acme magnet three',
  'anvil|Acme anvil', ...[1, 2, 3, 4, 5].map(i => `anvil|Acme anvil/drops ${i}`), 'anvil|Acme spring',
].sort();

test('issue #91: the inventory is built from file, nesting and declaration order, on every Node 24', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'acme-inventory-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'tests'));
  for (const [path, text] of Object.entries(ACME_SUITE)) await writeFile(join(root, path), text);
  await writeFile(join(root, 'reporter.mjs'), `export default async function*(events) {
    for await (const e of events) if (['test:pass', 'test:fail', 'test:summary'].includes(e.type)) yield JSON.stringify(e, (k, v) => v instanceof Error ? { message: v.message } : v) + '\\n';
  }`);
  const r = run(process.execPath, ['--test', '--test-reporter=./reporter.mjs', 'tests/acme.test.mjs', 'tests/anvil.test.mjs'], {cwd: root});
  assert.equal(r.status, 0, r.stderr);
  const events = r.stdout.trim().split('\n').map(line => JSON.parse(line));
  const plan = await nodePlan({root, script: 'node --test tests/*.test.mjs', words: shellWords, flags: flagsIn});
  const finish = list => { const c = suiteCollector({root, cwd: root, plan, flagsHash: plan.executionSettings.flagsHash}); for (const e of list) c.push(structuredClone(e)); return c.finish(); };
  const without = (...keys) => events.map(e => ({...e, data: Object.fromEntries(Object.entries(e.data).filter(([k]) => !keys.includes(k)))}));
  const shapes = {'as this Node emits them': events, 'Node 24 before 24.16: no testId, no parentId': without('testId', 'parentId'), 'Node 24.16 to 24.18: no parentId': without('parentId')};
  for (const [shape, list] of Object.entries(shapes)) {
    const receipt = finish(list);
    assert.equal(receipt.complete, true, shape);
    assert.deepEqual(receipt.inventoryProblems, [], shape);
    assert.equal(receipt.inventoryComplete, true, shape);
    assert.deepEqual(receipt.observedInventory.map(i => `${i.file.slice(6, -9)}|${i.hierarchy.join('/')}`).sort(), ACME_HIERARCHIES, shape);
  }
  // Where Node names a parent, it must be the one the order says.
  const rockets = events.find(e => e.type === 'test:pass' && e.data.name === 'Acme rockets');
  if (Number.isInteger(rockets.data.testId)) {
    const crossed = events.map(e => e.type === 'test:pass' && e.data.name === 'separates' ? {...e, data: {...e.data, parentId: rockets.data.testId}} : e);
    assert.ok(finish(crossed).inventoryProblems.includes('logical identity linkage unavailable'));
  }
  // A subtest whose parent's result never came is not placed under another test.
  const orphaned = finish(without('testId', 'parentId').filter(e => e.data.name !== 'is shipped'));
  assert.equal(orphaned.inventoryComplete, false);
  assert.ok(orphaned.inventoryProblems.includes('missing parent identity'), orphaned.inventoryProblems.join(', '));
});
