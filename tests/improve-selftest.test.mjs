// keel improve's grader, graded: the selftest must fail when any one measure
// is made to say "fine" (lesson 6). Its own file, apart from
// tests/improve.test.mjs: it runs the selftest once per measure per mutation,
// and the suite runs test files side by side. The runs read the fixture and
// write nothing, so they go 8 at a time (2026-10-09: 41 s one after another;
// the suite cannot finish before its longest test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEASURES, selftest } from '../lib/improve.mjs';

test('selftest fails when any one measure is made to report a neutral value, n/a, or to break', async () => {
  const cases = MEASURES.flatMap(m => [['neutral', () => ({ value: m.bound, detail: 'fine' })], ['n/a', () => ({ na: 'mutated' })], ['throws', () => { throw new Error('mutated'); }]]
    .map(([how, fake]) => ({ m, how, measures: MEASURES.map(x => x.id === m.id ? { ...x, run: fake } : x) })));
  const results = new Array(cases.length);
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < cases.length) { const i = next++; results[i] = await selftest({ measures: cases[i].measures }); }
  }));
  cases.forEach(({ m, how }, i) => {
    assert.equal(results[i].exitCode, 1, `${m.id} ${how}: selftest passed`);
    assert.deepEqual(results[i].data.missed.map(x => x.id), [m.id], `${m.id} ${how}`);
  });
  assert.equal(cases.length, MEASURES.length * 3, 'every measure, every mutation');
});
