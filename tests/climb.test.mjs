// The climb practice's script, scripts/keel/climb.mjs (phase 35), run where a
// project has it: beside the night's lib.mjs, test-ledger.mjs and pr-body.mjs,
// in a synthetic Acme repo whose "suite" says how long it took through
// KEEL_CLIMB_CLOCK and waits no real time, so compare's keep and revert are
// decided by the fixture, never the machine (phase 55: these tests once slept
// 1500 ms a run and still failed on a busy runner). They are pinned to stalls
// in .keel/keel.json, so a wall-clock wait that creeps back fails the gate.
// gh is a stub (KEEL_GH); nothing here reads the live world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, cp, realpath, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from './helpers/run.mjs';
import { runBlocks } from './helpers/workflows.mjs';
import { git, commit, acme, climb, json, load, TIMED, suite } from './helpers/climb.mjs';

/**
 * A "suite" that took `ms` by the clock compare reads here (KEEL_CLIMB_CLOCK:
 * it writes its time there) and waits no real time; `tag` keeps two equal
 * suites different commits. Without the clock, it is a real run of node.
 */
const clocked = (ms, tag = '') => `// acme suite ${tag}\nimport { writeFileSync } from 'node:fs';\nif (process.env.KEEL_CLIMB_CLOCK) writeFileSync(process.env.KEEL_CLIMB_CLOCK, '${ms}');\n`;

/** The clock file the Acme suite writes its time to, beside the repo; removed after. */
const clockOf = (t, dir) => {
  const file = join(dir, '..', `${dir.split('/').pop()}-clock`);
  t.after(() => rm(file, { force: true }));
  return { KEEL_CLIMB_CLOCK: file };
};

test('compare: keep for a real gain, revert for one inside the noise, and two alternated rounds, not one', async t => {
  // Times are the suite's own (KEEL_CLIMB_CLOCK), not the wall clock: a base of 1500 ms once lost to a busy
  // runner's noise (9734581), and sleeping longer only made every run pay. Phase 55 gave climb its clock.
  const dir = await acme(t, { climb: TIMED, files: { 't.mjs': clocked(1500) } });
  const clock = clockOf(t, dir);
  const base = git(dir, ['rev-parse', 'HEAD']);
  const fast = await commit(dir, { 't.mjs': clocked(10, 'fast') }, 'acme: a faster suite');
  git(dir, ['checkout', '-q', '-b', 'noise', base]);
  const noise = await commit(dir, { 't.mjs': clocked(1400, 'noise') }, 'acme: the same suite');
  // Fast in round 1 (base first, then its first two runs), slow in round 2 (it goes first).
  git(dir, ['checkout', '-q', '-b', 'lucky', base]);
  const counter = join(dir, '..', `${dir.split('/').pop()}-count`);
  t.after(() => rm(counter, { force: true }));
  const lucky = await commit(dir, { 't.mjs': `import { readFileSync, writeFileSync } from 'node:fs';\nlet n = 0;\ntry { n = Number(readFileSync(process.env.ACME_COUNT, 'utf8')); } catch {}\nwriteFileSync(process.env.ACME_COUNT, String(n + 1));\nwriteFileSync(process.env.KEEL_CLIMB_CLOCK, String(n < 2 ? 10 : 2600));\n` }, 'acme: fast once');
  // Each compare's rounds go to the run's diagnostics, so a red run shows its numbers.
  const cmp = (candidate, env = {}) => {
    const r = json(climb(dir, ['compare', '--base', base, '--candidate', candidate, '--runs', '2', '--json'], { ...clock, ...env }));
    t.diagnostic(`${candidate.slice(0, 7)} ${r.verdict}: ${(r.rounds ?? []).map(x => `${Math.round(x.base)}→${Math.round(x.candidate)} ms`).join(', ')}`);
    return r;
  };

  const keep = cmp(fast);
  assert.equal(keep.verdict, 'keep', keep.why);
  assert.equal(keep.rounds.length, 2);
  assert.ok(keep.rounds.every(r => r.change <= -0.3), JSON.stringify(keep.rounds));
  assert.match(keep.why, /beat the base by 30% or more in all 2 rounds/);
  const same = cmp(noise);
  assert.equal(same.verdict, 'revert', same.why);
  assert.match(same.why, /inside the 30% margin/);
  // One round would have kept it; the second round, run in the other order, does not.
  const once = cmp(lucky, { ACME_COUNT: counter });
  assert.equal(once.rounds.length, 2);
  assert.ok(once.rounds[0].change <= -0.3, `round 1 is the lucky one: ${JSON.stringify(once.rounds)}`);
  assert.equal(once.verdict, 'revert', `a gain in one round only is noise: ${once.why}`);
  assert.match(once.why, /^round 2:/);
  // A single round is refused outright, and no worktree is left behind.
  const one = climb(dir, ['compare', '--base', base, '--candidate', fast, '--rounds', '1', '--json'], clock);
  assert.equal(one.status, 2);
  assert.match(json(one).error, /two alternated rounds or more/);
  assert.equal(git(dir, ['worktree', 'list']).split('\n').length, 1, 'compare removes its worktrees');
  // A suite that fails has no time: exit 2, never a number.
  const broken = await commit(dir, { 't.mjs': 'process.exit(3);\n' }, 'acme: broken');
  const b = climb(dir, ['compare', '--base', base, '--candidate', broken, '--runs', '1', '--json'], clock);
  assert.equal(b.status, 2);
  assert.match(json(b).error, /failed \(exit 3\).*a failing suite has no time/);
  // Nor does one that says no time when the clock asks for it: never a wall-clock number in its place.
  const silent = await commit(dir, { 't.mjs': '// acme: says nothing\n' }, 'acme: silent');
  const s = climb(dir, ['compare', '--base', base, '--candidate', silent, '--runs', '1', '--json'], clock);
  assert.equal(s.status, 2);
  assert.match(json(s).error, /wrote no time to KEEL_CLIMB_CLOCK/);
});

test('compare --decide, revert, settle and report: the numbers go in the commit, a miss resets, and the PR body says it all', async t => {
  const dir = await acme(t, { climb: TIMED, files: { 't.mjs': clocked(1500), 'package.json': '{ "name": "acme", "files": ["lib/"] }\n' } });
  const clock = clockOf(t, dir);
  const base = git(dir, ['rev-parse', 'HEAD']);
  const m = await load(dir);
  // The baseline is a real run, timed by the wall clock: a number, never judged.
  const baseline = json(climb(dir, ['measure', 'test-time', '--baseline', '--runs', '1', '--json']));
  assert.equal(baseline.times.length, 1);
  assert.ok(baseline.times[0] > 0, JSON.stringify(baseline));
  const night = () => readFile(join(dir, '.keel/climb/night.json'), 'utf8').then(JSON.parse);
  assert.equal((await night()).base, base);
  assert.equal(git(dir, ['status', '--porcelain']), '', 'the night\'s record ignores itself');

  await commit(dir, { 't.mjs': clocked(10, 'fast') }, 'acme: share one fixture');
  const kept = json(climb(dir, ['compare', '--decide', '--runs', '1', '--json'], clock));
  assert.equal(kept.verdict, 'keep', kept.why);
  const message = git(dir, ['log', '-1', '--format=%B']);
  assert.match(message, /^acme: share one fixture\n\nclimb test-time: \d+ ms → \d+ ms \(−[\d.]+%\); \d+ ms → \d+ ms \(−[\d.]+%\); margin 30%, base [0-9a-f]{7}$/);
  const keptSha = git(dir, ['rev-parse', 'HEAD']);
  assert.equal(kept.head, keptSha);

  await commit(dir, { 't.mjs': clocked(100, 'slower') }, 'acme: nothing really');
  const missed = json(climb(dir, ['compare', '--decide', '--runs', '1', '--json'], clock));
  assert.equal(missed.verdict, 'revert');
  assert.equal(git(dir, ['rev-parse', 'HEAD']), keptSha, 'a revert resets to the base');

  await commit(dir, { 'lib/acme.mjs': 'export const x = 1;\n' }, 'acme: breaks the gate');
  const r = json(climb(dir, ['revert', '--why', 'the gate failed: acme.test.mjs', '--json']));
  assert.equal(r.head, keptSha);
  assert.equal(r.stop, null, 'a keep, then two misses: not yet three in a row');
  const tried = (await night()).tried.map(a => a.verdict);
  assert.deepEqual(tried, ['keep', 'revert', 'revert']);
  assert.equal(m.stopping({ attempts: 10, tried: [{ verdict: 'revert' }, { verdict: 'revert' }, { verdict: 'revert' }] }), '3 misses in a row');
  assert.equal(m.stopping({ attempts: 2, tried: [{ verdict: 'keep' }, { verdict: 'revert' }] }), 'the attempt limit (2) is reached');
  assert.equal(m.stopping({ attempts: 10, tried: [{ verdict: 'revert' }, { verdict: 'keep' }, { verdict: 'revert' }] }), null);
  // A kept change is never reverted by hand.
  assert.equal(climb(dir, ['revert', '--why', 'x', '--json']).status, 2);

  // Undecided work when the box closes: settle drops it, back to the last kept change.
  await commit(dir, { 't.mjs': clocked(5, 'late') }, 'acme: undecided');
  await writeFile(join(dir, 'scratch.txt'), 'half-made\n');
  assert.equal(json(climb(dir, ['settle', '--json'])).head, keptSha);
  assert.equal(git(dir, ['rev-parse', 'HEAD']), keptSha);
  assert.equal(git(dir, ['status', '--porcelain']), '');

  const final = json(climb(dir, ['compare', '--final', '--runs', '1', '--json'], clock));
  assert.equal(final.base, base);
  const rep = climb(dir, ['report', '--state', '--body', join(dir, '..', `${dir.split('/').pop()}-body.md`), '--json']);
  t.after(() => rm(join(dir, '..', `${dir.split('/').pop()}-body.md`), { force: true }));
  assert.equal(rep.status, 0, rep.stderr);
  const out = json(rep);
  assert.equal(out.kept, 1);
  assert.match(out.line, /^climb test-time \d{4}-\d{2}-\d{2}: kept 1 of 3 tried; `node t\.mjs` \d+ ms → \d+ ms \(−[\d.]+%\); \d+ min$/);
  const body = await readFile(out.body, 'utf8');
  const at = ['## Summary', '## Evidence', '## Merge danger', '## Notes'].map(h => body.indexOf(`${h}\n`));
  assert.ok(at[0] === 0 && at.every((x, i) => i === 0 || x > at[i - 1]), body);
  assert.match(body, /^\| Number \| Before \| After \| Change \|$/m);
  assert.match(body, /^\| `node t\.mjs` wall time, median \(the night's base against its last commit, 2 alternated rounds\) \| \d+ ms \| \d+ ms \| −[\d.]+% \|$/m);
  assert.match(body, /^Gate: not run: guard did not record a gate line$/m, 'guard never ran here: the body says so, it does not invent a gate');
  assert.match(body, /^\| acme: share one fixture \([0-9a-f]{7}\) \| \d+ ms, \d+ ms \| \d+ ms, \d+ ms \(−[\d.]+%, −[\d.]+%\) \|$/m);
  assert.match(body, /^- acme: nothing really: round 1: .*inside the 30% margin/m);
  assert.match(body, /^- acme: breaks the gate: the gate failed: acme\.test\.mjs$/m);
  assert.match(body, /^Two-way door: code changes only/m);
  assert.match(body, /^Blast radius: this repo's files only\.$/m);
  assert.match(body, /never the agent's own timing/);
  assert.deepEqual(JSON.parse(await readFile(join(dir, '.keel/climb.json'), 'utf8')).last.job, 'test-time');

  // The danger names a surface only when a shipped file changed; nothing kept is a line, no body.
  assert.deepEqual(m.surfacesOf(['tests/a.test.mjs'], { files: ['lib/'] }), []);
  assert.deepEqual(m.surfacesOf(['lib/a.mjs', '.github/workflows/check.yml'], { files: ['lib/'] }).sort(), ['published package', 'workflow shell']);
  const nothing = m.reportOf({ job: 'test-time', date: '2026-10-06', started: '2026-10-06T09:41:00Z', margin: 0.05, tried: [{ what: 'a', verdict: 'revert', why: 'round 1: −1%' }, { what: 'b', verdict: 'revert', why: 'round 2: +2%' }] }, { now: new Date('2026-10-06T10:20:00Z') });
  assert.equal(nothing.input, null);
  assert.equal(nothing.line, 'climb test-time 2026-10-06: kept nothing; 2 tried, none beat the noise (margin 5%); 39 min');
});
