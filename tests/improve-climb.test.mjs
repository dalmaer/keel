// The health page's climb line (phase 35): improve --report reads the newest
// climb night's record, which the night fetched from the keel-climb artifact
// into .keel/climb/night.json, and writes one line: kept N and the PR, or kept
// nothing and why; nothing when climb is off or never ran. Not a measure.
// Phase 36: a line when a climb job's last three PRs were closed unmerged (it
// proposes its own retirement), and build_time, the build timed once a night.
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

/** A gh that answers `pr list --state closed` with these PRs (and fails anything else). */
async function closedGh(t, prs, { fail = false } = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'keel-improve-climb-gh-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const gh = join(dir, 'gh');
  await writeFile(gh, `#!/bin/sh\nif [ "$1 $2" = "pr list" ] && [ ${fail ? 1 : 0} = 0 ]; then echo '${JSON.stringify(prs)}'; exit 0; fi\necho "gh: acme is unreachable" >&2\nexit 1\n`, { mode: 0o755 });
  return gh;
}

test('the health page says when a climb job proposes its own retirement: its last three PRs closed unmerged, read from gh', async t => {
  const pr = (n, job, merged = false) => ({ headRefName: `keel-climb/${job}/2026-10-0${n}`, number: n, createdAt: `2026-10-0${n}T10:00:00Z`, mergedAt: merged ? `2026-10-0${n}T11:00:00Z` : null });
  const at = async (prs, opts) => {
    const dir = await acme(t, { climb: { jobs: ['test-time', 'hygiene'] } });
    const config = JSON.parse(await readFile(join(dir, '.keel/keel.json'), 'utf8'));
    await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ ...config, repo: 'acme/anvils' }));
    const r = await improve({ root: dir, report: true, date: '2026-10-07' }, { env: { ...ENV, KEEL_GH: await closedGh(t, prs, opts) }, measures: [] });
    return { data: r.data, text: await readFile(join(dir, 'docs/health/2026-10-07.md'), 'utf8') };
  };
  const three = await at([pr(1, 'test-time'), pr(2, 'test-time'), pr(3, 'test-time'), pr(4, 'hygiene', true)]);
  assert.match(three.text, /^Climb: `test-time` proposes its own retirement: its last 3 keel-climb\/test-time\/ PRs \(#3, #2, #1\) were closed unmerged\. Remove it from "climb"\.jobs, or reopen one; until then climb nights skip it\.$/m);
  assert.doesNotMatch(three.text, /`hygiene` proposes/);
  assert.equal(three.data.retire.length, 1);
  assert.doesNotMatch((await at([pr(1, 'test-time'), pr(2, 'test-time', true), pr(3, 'test-time')])).text, /proposes its own retirement/, 'one merged: no retirement');
  assert.match((await at([], { fail: true })).text, /^Climb: whether a job should retire is unread tonight \(gh pr list --state closed: exit 1\)\.$/m, 'unread is said, never red');
  // No repo, or climb off: no line and no gh.
  assert.deepEqual((await pageOf(await acme(t))).data.retire, []);
});

test('build_time: the build timed once when "climb".build names it; outside over buildBudgetMs, recorded only without one, n/a without a build, broken when it fails', async t => {
  const { measure, page: pageText } = await import('../practices/night/files/scripts/keel/improve.mjs');
  const { MEASURES } = await import('../practices/night/files/scripts/keel/improve.mjs');
  const only = MEASURES.filter(m => m.id === 'build_time');
  const at = async climb => {
    const dir = await acme(t, { climb });
    const [r] = await measure({ root: dir, config: { name: 'Acme', climb }, env: ENV, measures: only });
    return r;
  };
  const over = await at({ jobs: ['build-time'], build: 'node -e ""', buildOutput: 'dist', buildBudgetMs: 1 });
  assert.deepEqual([over.state, over.bound, over.facts.command, over.facts.budget], ['outside', 1, 'node -e ""', 1]);
  assert.ok(over.value >= 1, JSON.stringify(over));
  assert.match(over.detail, /^`node -e ""` \d+ ms against a budget of 1 ms$/);
  const within = await at({ jobs: ['build-time'], build: 'node -e ""', buildOutput: 'dist', buildBudgetMs: 3_600_000 });
  assert.equal(within.state, 'ok');
  const free = await at({ jobs: ['build-time'], build: 'node -e ""', buildOutput: 'dist' });
  assert.deepEqual([free.state, free.bound], ['ok', null], 'no budget: recorded, never outside');
  assert.match(free.detail, /no "climb"\.buildBudgetMs, so recorded only$/);
  assert.match(pageText({ config: { name: 'Acme' }, date: '2026-10-07', results: [free], proposal: null, tightened: [] }), /^\| `build_time` — .* \| \d+ \| — \| ok \|/m);
  assert.equal((await at({ jobs: ['test-time'] })).state, 'n/a');
  const failing = await at({ jobs: ['build-time'], build: 'node -e "process.exit(4)"', buildOutput: 'dist' });
  assert.equal(failing.state, 'broken');
  assert.match(failing.detail, /failed \(exit 4\): a failing build has no time/);
});
