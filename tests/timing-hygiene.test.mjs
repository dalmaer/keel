// Timing tests whose margin a slow machine can swamp (phase 40's retro, after
// the 6 October CI escapes, lesson 40): a test that times a synthetic suite
// with climb compare or measure must give the base a sleep the machine cannot
// drown. A loaded 4-CPU runner took ~650 ms just to start node, so a base (or
// a noise candidate, which stands for the base) under 1000 ms is decided by the
// machine, not the fixture. A fast candidate's short sleep is the point and is
// left alone. Read as text, explicitly: a sleep is a literal `setTimeout(…, n)`
// or a call to a helper that wraps one (`sleeper(n)`); it is the base when it
// is not in a commit(…) (the fixture's first files), or when it is tagged
// 'noise' or 'base'. `// timing: measured baseline — <reason>` on the line or
// the one above opts a line out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const KEEL = resolve(HERE, '..');
// 1000, not 300: a 600 ms base passed the 300 ms floor and still failed on keel's
// CI (9734581, phase 35's escape, the health page of 2026-10-08): it must dominate
// node's ~650 ms start, not just exceed it.
export const FLOOR_MS = 1000;

/** A file that times a suite: it runs climb compare or measure. */
export const timesASuite = text => /\[\s*['"](?:compare|measure)['"]/.test(text);

/** Every base or noise sleeper under FLOOR_MS in one test file's text: [string]. */
export function timingProblems(file, text) {
  if (!timesASuite(text)) return [];
  const lines = text.split('\n');
  // Helpers that wrap a sleep: const X = (ms, …) => …setTimeout(…, ${ms})…
  const helpers = [...text.matchAll(/const\s+(\w+)\s*=\s*\(\s*(\w+)[^)]*\)\s*=>[^\n]*setTimeout\([^\n]*\$\{\2\}/g)].map(m => m[1]);
  const out = [];
  lines.forEach((line, i) => {
    const optOut = /\/\/ timing: measured baseline\s*[—–-]\s*\S/;
    if (optOut.test(line) || optOut.test(lines[i - 1] ?? '')) return;
    const sleeps = [...line.matchAll(/setTimeout\([^,]*,\s*(\d[\d_]*)\s*\)/g)].map(m => ({ ms: Number(m[1].replaceAll('_', '')), tag: '' }));
    for (const h of helpers) {
      for (const m of line.matchAll(new RegExp(`\\b${h}\\(\\s*(\\d[\\d_]*)\\s*(?:,\\s*['"]([^'"]*)['"])?\\s*\\)`, 'g'))) {
        sleeps.push({ ms: Number(m[1].replaceAll('_', '')), tag: m[2] ?? '' });
      }
    }
    for (const { ms, tag } of sleeps) {
      const base = !/\bcommit\(/.test(line) || /^(noise|base)$/.test(tag);
      if (base && ms < FLOOR_MS) {
        out.push(`${file}:${i + 1}: a ${tag || 'base'} sleep of ${ms} ms in a timed suite; under ${FLOOR_MS} ms the machine decides, not the fixture (or say why: // timing: measured baseline — <reason>)`);
      }
    }
  });
  return out;
}

test('no timing test gives its base or noise suite a sleep a slow machine can swamp', async () => {
  const names = (await readdir(HERE)).filter(n => n.endsWith('.test.mjs') && n !== basename(fileURLToPath(import.meta.url))).sort();
  const timed = [];
  const out = [];
  for (const n of names) {
    const text = await readFile(join(HERE, n), 'utf8');
    if (timesASuite(text)) timed.push(n);
    out.push(...timingProblems(`tests/${n}`, text));
  }
  assert.ok(timed.includes('climb.test.mjs'), `climb.test.mjs no longer times a suite; this check would read nothing (timed: ${timed.join(', ')})`);
  assert.deepEqual(out, []);
});

test('the escape: a 600 ms base, which passed the old 300 ms floor and failed on CI, is refused', () => {
  const sleeper = "const sleeper = (ms, tag = '') => `setTimeout(() => {}, ${ms});\\n`;\n";
  const p = timingProblems('tests/acme.test.mjs', `${sleeper}const dir = await acme(t, { files: { 't.mjs': sleeper(600) } });\nclimb(dir, ['compare', '--json']);\n`);
  assert.equal(p.length, 1, p.join('\n'));
  assert.match(p[0], /sleep of 600 ms in a timed suite/);
});

test('mutations: a 150 ms base or noise sleeper fails; a 10 ms fast one, an untimed file and a reasoned opt-out pass', async () => {
  const t = await readFile(join(KEEL, 'tests/climb.test.mjs'), 'utf8');
  for (const [why, from, to] of [
    ['a 150 ms base', "files: { 't.mjs': sleeper(1500) }", "files: { 't.mjs': sleeper(150) }"],
    ['a 150 ms noise', "sleeper(1500, 'noise')", "sleeper(150, 'noise')"],
    ['a literal 150 ms base', "files: { 't.mjs': sleeper(1500) }", "files: { 't.mjs': 'setTimeout(() => {}, 150);\\n' }"],
  ]) {
    const text = t.replace(from, to);
    assert.notEqual(text, t, `${why}: the mutation did not apply`);
    const p = timingProblems('tests/climb.test.mjs', text);
    assert.equal(p.length, 1, `${why}: ${p.join('\n')}`);
    assert.match(p[0], /sleep of 150 ms in a timed suite/);
  }
  const sleeper = "const sleeper = (ms, tag = '') => `setTimeout(() => {}, ${ms});\\n`;\n";
  const timed = `${sleeper}climb(dir, ['compare', '--json']);\n`;
  assert.deepEqual(timingProblems('a', `${timed}await commit(dir, { 't.mjs': sleeper(10, 'fast') }, 'acme: fast');\n`), [], 'a fast candidate is the point');
  assert.deepEqual(timingProblems('a', `${sleeper}await acme(t, { files: { 't.mjs': sleeper(150) } });\n`), [], 'a file that times nothing');
  assert.equal(timingProblems('a', `${timed}await acme(t, { files: { 't.mjs': sleeper(150) } }); // timing: measured baseline\n`).length, 1, 'an opt-out says why');
  assert.deepEqual(timingProblems('a', `${timed}// timing: measured baseline — Acme's runner starts node in 20 ms, measured 2026-10\nawait acme(t, { files: { 't.mjs': sleeper(150) } });\n`), []);
});
