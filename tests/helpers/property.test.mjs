// The property runner (phase 85) proves its own two promises: a failure is
// shrunk to its smallest case, and the seed it prints reproduces it — set by
// KEEL_PROPERTY_SEED, from a fresh process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from './run.mjs';
import { prng, int, array, string, record, tuple, oneOf, element, optional, date, impossibleDate, permutation, check, property, report, seedOf, runsOf, daysIn } from './property.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('a failing property shrinks to its smallest case: the boundary integer, the one-element list, the one-character string, the record with every other field at its least', async () => {
  const n = await check(int(0, 10_000), x => x < 37, { seed: 1, runs: 200 });
  assert.equal(n.ok, false);
  assert.equal(n.value, 37, 'the smallest integer that fails');
  assert.ok(n.original >= 37 && n.shrinks > 0);

  const neg = await check(int(-5000, -1), x => x > -100, { seed: 2, runs: 200 });
  assert.equal(neg.value, -100, 'toward the bound nearer zero');

  const list = await check(array(int(0, 100), { max: 20 }), xs => xs.every(x => x < 50), { seed: 3, runs: 200 });
  assert.deepEqual(list.value, [50], 'every other element dropped, the one left at the boundary');

  const s = await check(string('abcxyz', { max: 30 }), x => !x.includes('y'), { seed: 4, runs: 200 });
  assert.equal(s.value, 'y');

  const rec = await check(record({ a: int(0, 100), b: string('pq', { max: 5 }), c: optional(int(1, 9)) }), r => !(r.a > 10 && r.b.includes('q')), { seed: 5, runs: 500 });
  assert.deepEqual(rec.value, { a: 11, b: 'q', c: null });

  // A pair whose failure needs both halves: each shrinks only as far as the failure allows.
  const pair = await check(tuple(int(0, 1000), int(0, 1000)), ([x, y]) => x + y < 100, { seed: 6, runs: 200 });
  assert.equal(pair.value[0] + pair.value[1], 100);

  // A thrown error is a failure too, and its message is kept.
  const thrown = await check(int(0, 100), x => { if (x > 3) throw new TypeError(`boom at ${x}`); }, { seed: 7, runs: 50 });
  assert.equal(thrown.value, 4);
  assert.match(thrown.error.message, /^boom at 4$/);
  // An async predicate is awaited.
  const later = await check(int(0, 100), async x => x < 9, { seed: 8, runs: 100 });
  assert.equal(later.value, 9);
});

test('the same seed makes the same inputs and the same shrunk case; the report names the seed and how to rerun it', async () => {
  const g = array(record({ k: element(['a', 'b', 'c']), n: int(0, 999) }), { max: 12 });
  const fails = xs => xs.filter(x => x.k === 'c').reduce((t, x) => t + x.n, 0) < 700;
  const one = await check(g, fails, { seed: 424242, runs: 300 });
  const two = await check(g, fails, { seed: 424242, runs: 300 });
  assert.equal(one.ok, false);
  assert.deepEqual([two.run, two.original, two.value, two.shrinks], [one.run, one.original, one.value, one.shrinks]);
  const other = await check(g, fails, { seed: 424243, runs: 300 });
  assert.notDeepEqual(other.original, one.original, 'another seed, other inputs');

  const r1 = prng(9), r2 = prng(9);
  assert.deepEqual(Array.from({ length: 20 }, () => r1.int(0, 1e6)), Array.from({ length: 20 }, () => r2.int(0, 1e6)));

  const text = report('sums stay small', one);
  assert.match(text, /^property "sums stay small" failed on input \d+ of 300 \(seed 424242; rerun with KEEL_PROPERTY_SEED=424242\)\./);
  assert.match(text, /\nSmallest failing case \(\d+ shrinks?\): \[ \{ k: 'c', n: \d+ \}/);
  await assert.rejects(property('sums stay small', g, fails, { seed: 424242, runs: 300 }), e => e.message === text && e.property.seed === 424242);

  // The env sets the seed and the count; anything else in them is refused, never read as a default.
  assert.equal(seedOf({ KEEL_PROPERTY_SEED: '77' }), 77);
  assert.equal(seedOf({}), seedOf({}), 'one fresh seed for the whole process');
  assert.throws(() => seedOf({ KEEL_PROPERTY_SEED: 'x' }), /KEEL_PROPERTY_SEED is an integer/);
  assert.equal(runsOf({ runs: 40 }, {}), 40);
  assert.equal(runsOf({ runs: 40 }, { KEEL_PROPERTY_RUNS: '1000' }), 1000);
  assert.equal(runsOf({ runs: 3, cost: 25 }, { KEEL_PROPERTY_RUNS: '1000' }), 40, 'a costly property takes its share of a larger run');
  assert.throws(() => runsOf({}, { KEEL_PROPERTY_RUNS: '0' }), /positive integer/);
});

test('a fresh process given the printed seed in KEEL_PROPERTY_SEED fails on the same case', () => {
  const url = pathToFileURL(resolve(HERE, 'property.mjs')).href;
  const script = `import { property, int, array } from ${JSON.stringify(url)};
await property('lists stay short', array(int(0, 50), { max: 30 }), xs => xs.length < 7 || xs[6] < 25, { runs: 400 }).then(() => console.log('passed'), e => console.log(e.message));`;
  const once = r => run(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, KEEL_PROPERTY_SEED: r } });
  const a = once('31337'), b = once('31337');
  assert.equal(a.status, 0, a.stderr);
  assert.match(a.stdout, /seed 31337; rerun with KEEL_PROPERTY_SEED=31337/);
  assert.match(a.stdout, /Smallest failing case \(\d+ shrinks?\): \[\s*0,\s*0,\s*0,\s*0,\s*0,\s*0,\s*25\s*\]/, 'six leading zeros and the boundary');
  assert.equal(b.stdout, a.stdout, 'the same seed, the same report');
});

test('the generators make what they say: real days, days that are no day, permutations, choices', async () => {
  const real = s => { const t = new Date(`${s}T00:00:00Z`); return Number.isFinite(t.getTime()) && t.toISOString().slice(0, 10) === s; };
  const ok = await check(date(), real, { seed: 11, runs: 2000 });
  assert.equal(ok.ok, true, ok.ok ? '' : report('date', ok));
  const never = await check(impossibleDate(), s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !real(s), { seed: 12, runs: 2000 });
  assert.equal(never.ok, true, never.ok ? '' : report('impossibleDate', never));
  assert.equal(daysIn(2024, 2), 29);
  assert.equal(daysIn(2100, 2), 28);
  assert.equal(daysIn(2000, 2), 29);
  const perm = await check(permutation([1, 2, 3, 4, 5]), p => JSON.stringify([...p].sort()) === '[1,2,3,4,5]', { seed: 13, runs: 500 });
  assert.equal(perm.ok, true);
  // oneOf reaches every branch.
  const rng = prng(14), g = oneOf(int(0, 0), int(1, 1), int(2, 2)), seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(g.make(rng).value);
  assert.deepEqual([...seen].sort(), [0, 1, 2]);
});
