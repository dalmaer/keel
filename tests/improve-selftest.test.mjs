// keel improve's grader, graded: the selftest must fail when any one measure
// is made to say "fine" (lesson 6). Its own file, apart from
// tests/improve.test.mjs: it runs the selftest once per measure per mutation,
// and the suite runs test files side by side. The full real-measure baseline
// lives in improve.test.mjs. Here each mutant has two outside sentinels:
// rerunning every unchanged instrument for every mutant adds quadratic work
// without adding an independent assertion. Mixed home/project routing and
// aggregation still run for every mutant, including null-bound measures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEASURES, selftest } from '../lib/improve.mjs';

const outside = (id, projectOnly) => ({ id, projectOnly, what: 'Acme outside sentinel', unit: 'items', bound: 0, better: 'lower', run: () => ({ value: 1 }) });

test('selftest fails when any one measure is made to report a neutral value, n/a, or to break', async () => {
  const cases = MEASURES.flatMap(m => [['neutral', () => ({ value: m.bound ?? 0, detail: 'fine' })], ['n/a', () => ({ na: 'mutated' })], ['throws', () => { throw new Error('mutated'); }]]
    .map(([how, fake]) => ({ m, how, measures: [outside('acme-home', false), { ...m, run: fake }, outside('acme-project', true)] })));
  const results = new Array(cases.length);
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < cases.length) { const i = next++; results[i] = await selftest({ measures: cases[i].measures }); }
  }));
  cases.forEach(({ m, how }, i) => {
    assert.deepEqual(results[i].data.measures.map(x => [x.id, x.state]), [
      ['acme-home', 'outside'], [m.id, how === 'neutral' ? 'ok' : how === 'n/a' ? 'n/a' : 'broken'], ['acme-project', 'outside'],
    ], `${m.id} ${how}: routing, order and exact state`);
    assert.equal(results[i].exitCode, 1, `${m.id} ${how}: selftest passed`);
    assert.deepEqual(results[i].data.missed.map(x => x.id), [m.id], `${m.id} ${how}`);
  });
  assert.equal(cases.length, MEASURES.length * 3, 'every measure, every mutation');
  // A grader must report all misses, not just the first one it finds.
  const all = await selftest({ measures: MEASURES.map((m, i) => cases[i * 3 + i % 3].measures[1]) });
  assert.equal(all.exitCode, 1);
  assert.deepEqual(all.data.missed.map(x => x.id), MEASURES.map(m => m.id), 'all misses, in declared order across home and project measures');
});
