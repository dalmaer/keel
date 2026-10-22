// A property runner with no dependency (phase 85): generators, a seeded
// PRNG, and shrinking toward the smallest failing input. A property is a
// claim over every input a generator makes; the runner tries `runs` of them
// and, on the first that fails, shrinks it and throws a report naming the
// smallest case and the seed that reproduces it.
//
//   PLATES_PROPERTY_SEED=<n>   the run's seed (default: a fresh one, printed on failure)
//   PLATES_PROPERTY_RUNS=<n>   inputs per property (default: each property's own, small for the gate)
//
// A generator is { make(rng) → tree }; a tree is { value, shrinks() → trees },
// each shrink a smaller value of the same generator, so map and records shrink
// through what they are built from. Shrinking is greedy: the first smaller
// tree that still fails becomes the case, until none does.
import { inspect } from 'node:util';

/** mulberry32: a seeded 32-bit PRNG. rng() is in [0, 1); rng.int(lo, hi) is an integer in [lo, hi]. */
export function prng(seed) {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  return rng;
}

const tree = (value, shrinks = () => []) => ({ value, shrinks });
const gen = make => ({ make, map: f => map({ make }, f) });

/** The integers from n toward target, nearest the target first: target, then halving the distance. */
function* towards(n, target) {
  if (n === target) return;
  yield target;
  for (let d = Math.trunc((n - target) / 2); d !== 0; d = Math.trunc(d / 2)) yield n - d;
}
const intTree = (n, target) => tree(n, function* () { for (const m of towards(n, target)) yield intTree(m, target); });

/** An integer in [min, max], shrinking toward 0 when 0 is in range, else toward the bound nearer it. */
export const int = (min, max) => {
  const target = min > 0 ? min : max < 0 ? max : 0;
  return gen(rng => intTree(rng.int(min, max), target));
};

/** A constant: never shrinks. */
export const constant = v => gen(() => tree(v));

/** One of `values`, shrinking toward the first. */
export const element = values => int(0, values.length - 1).map(i => values[i]);

/** `f` of a generator's value; shrinks as the generator does. */
export function map(g, f) {
  const via = t => tree(f(t.value), function* () { for (const s of t.shrinks()) yield via(s); });
  return gen(rng => via(g.make(rng)));
}

/** A list of `g`'s values, length in [min, max]: shrinks by dropping elements (from the front), then by shrinking each. */
export function array(g, { min = 0, max = 8 } = {}) {
  const build = trees => tree(trees.map(t => t.value), function* () {
    if (trees.length > min) {
      for (let i = 0; i < trees.length; i++) yield build([...trees.slice(0, i), ...trees.slice(i + 1)]);
    }
    for (let i = 0; i < trees.length; i++) {
      for (const s of trees[i].shrinks()) yield build([...trees.slice(0, i), s, ...trees.slice(i + 1)]);
    }
  });
  return gen(rng => { const n = rng.int(min, max); return build(Array.from({ length: n }, () => g.make(rng))); });
}

/** A fixed-length tuple of generators' values, each shrinking in place. */
export function tuple(...gs) {
  const build = trees => tree(trees.map(t => t.value), function* () {
    for (let i = 0; i < trees.length; i++) {
      for (const s of trees[i].shrinks()) yield build([...trees.slice(0, i), s, ...trees.slice(i + 1)]);
    }
  });
  return gen(rng => build(gs.map(g => g.make(rng))));
}

/** An object with one generated value per key of `shape`, each shrinking in place. */
export function record(shape) {
  const keys = Object.keys(shape);
  return tuple(...keys.map(k => shape[k])).map(vs => Object.fromEntries(keys.map((k, i) => [k, vs[i]])));
}

/** A string of characters from `alphabet` (a string), length in [min, max]; shrinks shorter and toward the alphabet's first character. */
export const string = (alphabet, { min = 0, max = 12 } = {}) => array(element([...alphabet]), { min, max }).map(cs => cs.join(''));

/** One of the generators, chosen at random: shrinks within the one chosen. */
export function oneOf(...gs) {
  return gen(rng => gs[rng.int(0, gs.length - 1)].make(rng));
}

/** A value of `g`, or `absent` (default null) at roughly `rate`: shrinks toward the absent value. */
export function optional(g, options = {}) {
  // `absent` may be undefined on purpose (a field left out), so it is read as given, never defaulted over.
  const { rate = 0.3 } = options, absent = Object.hasOwn(options, 'absent') ? options.absent : null;
  return gen(rng => {
    if (rng() < rate) return tree(absent);
    const t = g.make(rng);
    return tree(t.value, function* () { yield tree(absent); yield* t.shrinks(); });
  });
}

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const daysIn = (y, m) => (m === 2 && ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 29 : DAYS[m - 1]);
const pad = (n, w = 2) => String(n).padStart(w, '0');
export const ymd = (y, m, d) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

/** A real calendar day, YYYY-MM-DD, years in [from, to]; shrinks toward the first of January of `from`. */
export const date = ({ from = 2000, to = 2099 } = {}) =>
  tuple(int(from, to), int(1, 12), int(1, 31)).map(([y, m, d]) => ymd(y, m, Math.min(d, daysIn(y, m))));

/**
 * A YYYY-MM-DD string that names no day: a month of 00 or 13–99, a day of 00,
 * or a day past its month's last (2026-02-30, 2026-04-31, 2025-02-29).
 */
export const impossibleDate = ({ from = 2000, to = 2099 } = {}) => oneOf(
  tuple(int(from, to), oneOf(constant(0), int(13, 99)), int(1, 28)).map(([y, m, d]) => ymd(y, m, d)),
  tuple(int(from, to), int(1, 12)).map(([y, m]) => ymd(y, m, 0)),
  tuple(int(from, to), int(1, 12), int(1, 68)).map(([y, m, over]) => ymd(y, m, Math.min(99, daysIn(y, m) + over))),
);

/** Every ordering of `xs`'s elements, as a shrinkable permutation (shrinks toward the identity order). */
export function permutation(xs) {
  // A Lehmer code: digit i is in [0, n-1-i]; all zeros is the identity.
  return tuple(...xs.map((_, i) => int(0, xs.length - 1 - i))).map(code => {
    const pool = [...xs];
    return code.map(k => pool.splice(k, 1)[0]);
  });
}

// ---- running ------------------------------------------------------------------

/** The run's seed: PLATES_PROPERTY_SEED, else one chosen now (the same for every property in the process). */
const FRESH = (Date.now() ^ (process.pid << 16)) >>> 0;
export function seedOf(env = process.env) {
  const s = env.PLATES_PROPERTY_SEED;
  if (s === undefined || s === '') return FRESH;
  if (!/^\d+$/.test(s) || Number(s) > 0xffffffff) throw new Error(`PLATES_PROPERTY_SEED is an integer in [0, 4294967295] (got ${JSON.stringify(s)})`);
  return Number(s);
}

/** How many inputs: PLATES_PROPERTY_RUNS divided by the property's `cost` (at least 1), else its own `runs`. */
export function runsOf({ runs = 100, cost = 1 } = {}, env = process.env) {
  const r = env.PLATES_PROPERTY_RUNS;
  if (r === undefined || r === '') return runs;
  if (!/^[1-9]\d*$/.test(r)) throw new Error(`PLATES_PROPERTY_RUNS is a positive integer (got ${JSON.stringify(r)})`);
  return Math.max(1, Math.round(Number(r) / cost));
}

const show = v => inspect(v, { depth: 8, breakLength: 100, maxArrayLength: 50, maxStringLength: 400 });

/** Does `predicate` fail on `value`? { failed, error }: a throw, a rejection or a false result is a failure. */
async function attempt(predicate, value) {
  try {
    const r = await predicate(value);
    return r === false ? { failed: true, error: new Error('the property returned false') } : { failed: false };
  } catch (error) { return { failed: true, error }; }
}

/**
 * Try `predicate` on `runs` values of `g`, from `seed`. Returns { ok, seed,
 * runs } or, on a failure, { ok: false, seed, run, value (the shrunk case),
 * original, shrinks, error } — never throws for a failing property.
 */
export async function check(g, predicate, { seed = seedOf(), runs = runsOf(), maxShrinks = 500 } = {}) {
  const rng = prng(seed);
  for (let run = 1; run <= runs; run++) {
    let t = g.make(rng);
    const first = await attempt(predicate, t.value);
    if (!first.failed) continue;
    const original = t.value;
    let error = first.error, shrinks = 0;
    outer: while (shrinks < maxShrinks) {
      for (const s of t.shrinks()) {
        const r = await attempt(predicate, s.value);
        if (r.failed) { t = s; error = r.error; shrinks++; continue outer; }
      }
      break;
    }
    return { ok: false, seed, run, runs, value: t.value, original, shrinks, error };
  }
  return { ok: true, seed, runs };
}

/** A failure as the report a person reads: the smallest case, the seed, how to rerun it. */
export function report(name, r) {
  return [
    `property "${name}" failed on input ${r.run} of ${r.runs} (seed ${r.seed}; rerun with PLATES_PROPERTY_SEED=${r.seed}).`,
    `Smallest failing case (${r.shrinks} shrink${r.shrinks === 1 ? '' : 's'}): ${show(r.value)}`,
    `It failed with: ${r.error?.message ?? show(r.error)}`,
    `Original case: ${show(r.original)}`,
  ].join('\n');
}

/** Check a property and throw its report when it fails: the form a test uses. Options as check, plus { runs, cost } for runsOf. */
export async function property(name, g, predicate, { seed = seedOf(), runs, cost, maxShrinks } = {}) {
  const r = await check(g, predicate, { seed, runs: runsOf({ runs, cost }), maxShrinks });
  if (!r.ok) throw Object.assign(new Error(report(name, r)), { property: r });
  return r;
}
