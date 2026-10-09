// A test that times something runs pinned to stalls or under mock timers
// (phase 55). The rule was a sleep floor (phase 40's retro, after the 6
// October CI escapes, lesson 40): a timed suite's base had to sleep 300 ms,
// then 1000. A longer sleep still judges the wall clock, only with a wider
// margin, and every run pays for it. Now a file that times a suite (it runs
// climb compare or measure) must either be pinned in .keel/keel.json
// "tests": { "stalls": [...] }, which runs it paused at random moments in
// every gate (the test ledger, scripts/keel/stalls.mjs) so a wall-clock wait
// that creeps back fails there, or give the code its clock with node:test's
// mock.timers. `keel test <file> --stalls` says whether a file is ready to pin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stallsPins } from '../practices/night/files/scripts/keel/test-ledger.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const KEEL = resolve(HERE, '..');

/** A file that times a suite: it runs climb compare or measure. */
export const timesASuite = text => /\[\s*['"](?:compare|measure)['"]/.test(text);
/** A file that gives the code its clock: node:test's mock timers. */
export const onMockTimers = text => /\bmock\.timers\.enable\(/.test(text);

/** What is wrong with one test file (`file` is repo-relative) under the rule, given the pinned files: [string]. */
export function timingProblems(file, text, pins) {
  if (!timesASuite(text) || pins.includes(file) || onMockTimers(text)) return [];
  return [`${file} times a suite (climb compare or measure) and is neither pinned to stalls nor on mock timers: run keel test ${file} --stalls, give each test it names its clock, then pin it in .keel/keel.json "tests": { "stalls": [${JSON.stringify(file)}] }`];
}

const keelPins = async () => stallsPins(JSON.parse(await readFile(join(KEEL, '.keel/keel.json'), 'utf8')));

test('every test file that times a suite is pinned to stalls or runs under mock timers, and every pin is a test file', async () => {
  const pins = await keelPins();
  const names = (await readdir(HERE)).filter(n => n.endsWith('.test.mjs') && n !== basename(fileURLToPath(import.meta.url))).sort();
  const timed = [];
  const out = [];
  for (const n of names) {
    const text = await readFile(join(HERE, n), 'utf8');
    if (timesASuite(text)) timed.push(`tests/${n}`);
    out.push(...timingProblems(`tests/${n}`, text, pins));
  }
  assert.ok(timed.includes('tests/climb.test.mjs'), `climb.test.mjs no longer times a suite; this check would read nothing (timed: ${timed.join(', ')})`);
  assert.deepEqual(out, []);
  for (const p of pins) assert.ok(existsSync(join(KEEL, p)) && p.endsWith('.test.mjs'), `${p} is pinned to stalls and is not a test file: a pin to a renamed file pins nothing`);
});

test('the escape: a 600 ms base, which passed the old 300 ms floor and failed on CI, is refused, and so is the 1500 ms that "fixed" it', () => {
  const sleeper = "const sleeper = (ms, tag = '') => `setTimeout(() => {}, ${ms});\\n`;\n";
  for (const ms of [600, 1500]) {
    const p = timingProblems('tests/acme.test.mjs', `${sleeper}const dir = await acme(t, { files: { 't.mjs': sleeper(${ms}) } });\nclimb(dir, ['compare', '--json']);\n`, []);
    assert.equal(p.length, 1, `${ms} ms: ${p.join('\n')}`);
    assert.match(p[0], /^tests\/acme\.test\.mjs times a suite .* neither pinned to stalls nor on mock timers/);
  }
});

test('mutations: unpinning climb.test.mjs fails the rule; a pin or mock timers pass it; a file that times nothing needs neither', async () => {
  const pins = await keelPins();
  const text = await readFile(join(KEEL, 'tests/climb.test.mjs'), 'utf8');
  assert.ok(pins.includes('tests/climb.test.mjs'), 'climb.test.mjs is pinned');
  const unpinned = timingProblems('tests/climb.test.mjs', text, pins.filter(p => p !== 'tests/climb.test.mjs'));
  assert.equal(unpinned.length, 1, 'unpinned, it is named');
  assert.match(unpinned[0], /keel test tests\/climb\.test\.mjs --stalls/);
  assert.deepEqual(timingProblems('tests/climb.test.mjs', `${text}\nmock.timers.enable({ apis: ['setTimeout'] });\n`, []), [], 'mock timers');
  assert.deepEqual(timingProblems('tests/acme.test.mjs', "await acme(t, { files: { 't.mjs': 'setTimeout(() => {}, 150);' } });\n", []), [], 'a file that times nothing');
  assert.deepEqual(timingProblems('tests/acme.test.mjs', "climb(dir, ['measure', '--json']);\n", ['tests/acme.test.mjs']), [], 'pinned');
  assert.equal(timingProblems('tests/acme.test.mjs', "climb(dir, ['measure', '--json']);\n// mock.timers is the fix\n", []).length, 1, 'a word about mock timers is not mock timers');
});
