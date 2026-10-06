// The health page's climb line (phase 35): improve --report reads the newest
// climb night's record, which the night fetched from the keel-climb artifact
// into .keel/climb/night.json, and writes one line: kept N and the PR, or kept
// nothing and why; nothing when climb is off or never ran. Not a measure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { improve } from '../practices/night/files/scripts/keel/improve.mjs';
import { climbLine } from '../practices/night/files/scripts/keel/lib.mjs';
import { ENV } from './helpers/improve.mjs';

/** An Acme repo with a config and, when given, a synthetic climb record as the artifact unpacks it. */
async function acme(t, { climb = { jobs: ['test-time'] }, night } = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'keel-improve-climb-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, '.keel/climb'), { recursive: true });
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ name: 'Acme', practices: ['base', 'night', 'climb'], ...(climb ? { climb } : {}) }));
  if (night !== undefined) await writeFile(join(dir, '.keel/climb/night.json'), typeof night === 'string' ? night : JSON.stringify(night));
  return dir;
}

const pageOf = async dir => {
  const r = await improve({ root: dir, report: true, date: '2026-10-07' }, { env: ENV, measures: [] });
  return { data: r.data, text: await readFile(join(dir, 'docs/health/2026-10-07.md'), 'utf8') };
};
const tried = (...verdicts) => verdicts.map((verdict, i) => ({ what: `acme change ${i}`, verdict, why: 'numbers' }));

test('the health page says what the newest climb night kept and its PR, or that it kept nothing and why, and nothing when climb is off or never ran', async t => {
  const kept = await pageOf(await acme(t, { night: { job: 'test-time', date: '2026-10-06', margin: 0.05, tried: tried('keep', 'revert', 'keep'), gate: 'ok', pr: 21 } }));
  assert.match(kept.text, /^Ratchet: no bound moved\.\n\nClimb: 2026-10-06 test-time: kept 2, PR #21\.\n/m);
  assert.equal(kept.data.climb, 'Climb: 2026-10-06 test-time: kept 2, PR #21.');
  assert.doesNotMatch(kept.text, /\| `climb/, 'a line, never a measure row');

  const nothing = await pageOf(await acme(t, { night: { job: 'test-time', date: '2026-10-06', margin: 0.05, tried: tried('revert', 'revert') } }));
  assert.match(nothing.text, /^Climb: 2026-10-06 test-time: kept nothing \(2 tried, none beat the noise \(margin 5%\)\)\.$/m);
  const idle = await pageOf(await acme(t, { night: { job: 'test-time', date: '2026-10-06', tried: [] } }));
  assert.match(idle.text, /^Climb: 2026-10-06 test-time: kept nothing \(nothing was tried\)\.$/m);

  for (const [why, opts] of [['climb off', { climb: null, night: { job: 'test-time', date: '2026-10-06', tried: tried('keep'), pr: 3 } }], ['never ran', {}]]) {
    const p = await pageOf(await acme(t, opts));
    assert.doesNotMatch(p.text, /Climb:/, why);
    assert.equal(p.data.climb, null, why);
  }
  const torn = await pageOf(await acme(t, { night: '{ "job": ' }));
  assert.match(torn.text, /^Climb: the newest record \(\.keel\/climb\/night\.json\) is unreadable/m, 'a torn record is said, never dropped');

  // Kept with no PR (the guard failed, or Actions may not open PRs): said, not invented.
  assert.equal(climbLine({ climb: {} }, { job: 'test-time', date: '2026-10-06', tried: tried('keep') }), 'Climb: 2026-10-06 test-time: kept 1, no PR opened (the guard did not pass).');
});
