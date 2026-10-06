// keel improve's grader, graded: the selftest must fail when any one measure
// is made to say "fine" (lesson 6). Its own file, apart from
// tests/improve.test.mjs: it runs the selftest once per measure per mutation,
// and the suite runs test files side by side.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEASURES, selftest } from '../lib/improve.mjs';

test('selftest fails when any one measure is made to report a neutral value, n/a, or to break', async () => {
  for (const m of MEASURES) {
    for (const [how, fake] of [['neutral', () => ({ value: m.bound, detail: 'fine' })], ['n/a', () => ({ na: 'mutated' })], ['throws', () => { throw new Error('mutated'); }]]) {
      const measures = MEASURES.map(x => x.id === m.id ? { ...x, run: fake } : x);
      const r = await selftest({ measures });
      assert.equal(r.exitCode, 1, `${m.id} ${how}: selftest passed`);
      assert.deepEqual(r.data.missed.map(x => x.id), [m.id], `${m.id} ${how}`);
    }
  }
});
