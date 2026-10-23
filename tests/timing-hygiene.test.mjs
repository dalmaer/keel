// A test that times something runs pinned to stalls or under mock timers
// (phase 55). The rule was a sleep floor (phase 40's retro, after the 6
// October CI escapes, lesson 40): a timed suite's base had to sleep 300 ms,
// then 1000. A longer sleep still judges the wall clock, only with a wider
// margin, and every run pays for it. Now a file that times a suite (it runs
// climb compare or measure) must be pinned in .plates/plates.json
// "tests": { "stalls": [...] }, which runs it paused at random moments in
// every gate (the test ledger, scripts/plates/stalls.mjs) so a wall-clock wait
// that creeps back fails there. Giving code its clock with node:test's
// mock.timers can make it ready to pin, but a source match cannot prove that
// every timed path (including spawned suites) uses that clock. Keep the pin
// even when mock timers appear. `plates test <file> --stalls` checks readiness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stallsPins } from '../practices/night/files/scripts/plates/test-ledger.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATES = resolve(HERE, '..');

/** A file that times a suite: it runs climb compare or measure. */
export const timesASuite = text => /\[\s*['"](?:compare|measure)['"]/.test(text);

/** What is wrong with one test file (`file` is repo-relative) under the rule, given the pinned files: [string]. */
export function timingProblems(file, text, pins) {
  if (!timesASuite(text) || pins.includes(file)) return [];
  return [`${file} times a suite (climb compare or measure) and is not pinned to stalls: source alone cannot establish mock-timer coverage of every timed path; run plates test ${file} --stalls, give each test it names its clock, then pin it in .plates/plates.json "tests": { "stalls": [${JSON.stringify(file)}] }`];
}

const platesPins = async () => stallsPins(JSON.parse(await readFile(join(PLATES, '.plates/plates.json'), 'utf8')));

test('every test file that times a suite is pinned to stalls, and every pin is a test file', async () => {
  const pins = await platesPins();
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
  for (const p of pins) assert.ok(existsSync(join(PLATES, p)) && p.endsWith('.test.mjs'), `${p} is pinned to stalls and is not a test file: a pin to a renamed file pins nothing`);
});

test('the escape: a 600 ms base, which passed the old 300 ms floor and failed on CI, is refused, and so is the 1500 ms that "fixed" it', () => {
  const sleeper = "const sleeper = (ms, tag = '') => `setTimeout(() => {}, ${ms});\\n`;\n";
  for (const ms of [600, 1500]) {
    const p = timingProblems('tests/acme.test.mjs', `${sleeper}const dir = await acme(t, { files: { 't.mjs': sleeper(${ms}) } });\nclimb(dir, ['compare', '--json']);\n`, []);
    assert.equal(p.length, 1, `${ms} ms: ${p.join('\n')}`);
    assert.match(p[0], /^tests\/acme\.test\.mjs times a suite .* not pinned to stalls/);
  }
});

test('mutations: unpinning climb.test.mjs fails even with mock timers; pins and files that time no suite remain exempt', async () => {
  const pins = await platesPins();
  const text = await readFile(join(PLATES, 'tests/climb.test.mjs'), 'utf8');
  assert.ok(pins.includes('tests/climb.test.mjs'), 'climb.test.mjs is pinned');
  const unpinned = timingProblems('tests/climb.test.mjs', text, pins.filter(p => p !== 'tests/climb.test.mjs'));
  assert.equal(unpinned.length, 1, 'unpinned, it is named');
  assert.match(unpinned[0], /plates test tests\/climb\.test\.mjs --stalls/);
  assert.equal(timingProblems('tests/climb.test.mjs', `${text}\nmock.timers.enable({ apis: ['setTimeout'] });\n`, []).length, 1, 'mock timers alone cannot establish coverage');
  assert.deepEqual(timingProblems('tests/acme.test.mjs', "await acme(t, { files: { 't.mjs': 'setTimeout(() => {}, 150);' } });\n", []), [], 'a file that times nothing');
  assert.deepEqual(timingProblems('tests/acme.test.mjs', "climb(dir, ['measure', '--json']);\n", ['tests/acme.test.mjs']), [], 'pinned');
  assert.equal(timingProblems('tests/acme.test.mjs', "climb(dir, ['measure', '--json']);\n// mock.timers is the fix\n", []).length, 1, 'a word about mock timers is not mock timers');
});

test('issue 64: a mocked test cannot exempt an unrelated real-sleep suite in the same file', () => {
  const file = 'tests/acme.test.mjs';
  const mocked = `test('Acme mocked wait', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const done = new Promise(resolve => setTimeout(resolve, 50));
    t.mock.timers.tick(50);
    await done;
  });\n`;
  assert.deepEqual(timingProblems(file, mocked, []), [], 'mocked tests that time no suite still need no pin');
  for (const verb of ['compare', 'measure']) {
    const real = `test('Acme real suite', async t => {
      const dir = await acme(t, { files: { 't.mjs': 'setTimeout(() => {}, 1500);' } });
      await climb(dir, ['${verb}', '--json']);
    });\n`;
    for (const text of [mocked + real, real + mocked]) {
      const problems = timingProblems(file, text, []);
      assert.equal(problems.length, 1, `${verb}: an unrelated mock must not hide the real sleep`);
      assert.match(problems[0], /plates test tests\/acme\.test\.mjs --stalls/);
      assert.deepEqual(timingProblems(file, text, [file]), [], 'the mixed file is allowed when pinned');
    }
  }
});
