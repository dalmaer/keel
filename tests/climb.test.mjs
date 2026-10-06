// The climb practice's script, scripts/keel/climb.mjs (phase 35), run where a
// project has it: beside the night's lib.mjs, test-ledger.mjs and pr-body.mjs,
// in a synthetic Acme repo whose "suite" is a script sleeping a controlled
// time, so compare's keep and revert are decided by the fixture, not the
// machine. gh is a stub (KEEL_GH); nothing here reads the live world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from './helpers/run.mjs';
import { runBlocks } from './helpers/workflows.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NIGHT = join(KEEL, 'practices/night/files/scripts/keel');
const CLIMB = join(KEEL, 'practices/climb/files/scripts/keel/climb.mjs');
const WORKFLOW = join(KEEL, 'practices/climb/files/.github/workflows/keel-climb.yml');

const git = (cwd, args) => {
  const r = run('git', args, { cwd });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

async function write(dir, files) {
  for (const [p, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, p)), { recursive: true });
    await writeFile(join(dir, p), text);
  }
}

/** Commit `files` on the current branch; returns the new sha. */
async function commit(dir, files, message) {
  await write(dir, files);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', message]);
  return git(dir, ['rev-parse', 'HEAD']);
}

/** A synthetic Acme project with the night's scripts and climb.mjs in scripts/keel, committed on main. */
async function acme(t, { climb = { jobs: ['test-time'] }, config = {}, files = {} } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-climb-acme-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'scripts/keel'), { recursive: true });
  for (const f of ['lib.mjs', 'test-ledger.mjs', 'pr-body.mjs']) await cp(join(NIGHT, f), join(dir, 'scripts/keel', f));
  await cp(CLIMB, join(dir, 'scripts/keel/climb.mjs'));
  await write(dir, { '.keel/keel.json': `${JSON.stringify({ name: 'Acme', ...(climb ? { climb } : {}), ...config }, null, 2)}\n`, ...files });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'acme']);
  return dir;
}

const climb = (dir, args, env = {}) => run(process.execPath, [join(dir, 'scripts/keel/climb.mjs'), ...args], { cwd: dir, env: { ...process.env, ...env } });
const json = r => { try { return JSON.parse(r.stdout); } catch { assert.fail(`not JSON (exit ${r.status}): ${r.stdout}${r.stderr}`); } };
const load = dir => import(pathToFileURL(join(dir, 'scripts/keel/climb.mjs')).href);

/**
 * A stub gh: `pr list --state open` prints these open heads (or exits 1 when
 * `heads` is null); `pr list --state closed` prints `closed`
 * ([{ headRefName, number, createdAt, mergedAt }]).
 */
async function stubGh(t, heads, closed = []) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-climb-gh-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const gh = join(dir, 'gh');
  const open = heads === null ? 'echo "gh: acme is unreachable" >&2\nexit 1' : `echo '${JSON.stringify(heads.map(h => ({ headRefName: h })))}'\nexit 0`;
  await writeFile(gh, `#!/bin/sh\nif [ "$1 $2 $3 $4" = "pr list --state closed" ]; then\necho '${JSON.stringify(closed)}'\nexit 0\nfi\nif [ "$1 $2" = "pr list" ]; then\n${open}\nfi\nexit 1\n`, { mode: 0o755 });
  return gh;
}

/** A health page as the night writes its table. */
const page = rows => [
  '# Health — 2026-10-05', '', '| Measure | Value | Bound | State | Detail |', '| --- | --- | --- | --- | --- |',
  ...rows.map(([id, value, bound, state]) => `| \`${id}\` — what it counts \\| with a pipe | ${value} | ${bound} | ${state} | detail |`), '',
].join('\n');

/** A "suite" that sleeps `ms`; `tag` keeps two equal sleeps different commits. */
const sleeper = (ms, tag = '') => `// acme suite ${tag}\nsetTimeout(() => {}, ${ms});\n`;
// The margin is wide (30%) and the gaps wider: the sleeps (600 ms against 10) dominate
// node's own startup even on a loaded 4-CPU runner (one took ~650 ms to start
// node; lesson 40), so the fixture decides, never the machine.
const TIMED = { jobs: ['test-time'], testCommand: 'node t.mjs', margin: 0.3 };

test('pick: the job tied to the worst measure, rotation when none is outside, and a job with an open PR waits', async t => {
  const dir = await acme(t, { files: { 'docs/health/2026-10-05.md': page([['gate', 0, '≤ 0', 'ok'], ['slow_tests', 3, '≤ 0', 'outside']]) } });
  const m = await load(dir);
  // Pure: a second job, so the measure and the rotation disagree.
  const table = { ...m.JOBS, 'acme-time': { measures: ['acme_slow'] } };
  const jobs = ['acme-time', 'test-time'];
  const outside = [{ id: 'slow_tests', value: 3, bound: 0, op: '≤', state: 'outside' }];
  assert.deepEqual([m.choose({ jobs, rows: outside, table }).job, m.choose({ jobs, rows: outside, table }).by], ['test-time', 'measure']);
  const both = [{ id: 'acme_slow', value: 1, bound: 0, op: '≤', state: 'outside' }, ...outside];
  assert.equal(m.choose({ jobs, rows: both, table }).job, 'test-time', 'the worst of two outside');
  assert.equal(m.choose({ jobs, rows: [{ ...both[0], state: 'broken' }, ...outside], table }).job, 'acme-time', 'broken beats outside');
  const fine = [{ ...outside[0], state: 'ok', value: 0 }];
  assert.deepEqual(['acme-time', null, 'test-time'].map(last => m.choose({ jobs, rows: fine, table, last: last === null ? 'test-time' : last }).job), ['test-time', 'acme-time', 'acme-time']);
  assert.equal(m.choose({ jobs, rows: fine, table }).job, 'acme-time', 'rotation starts at the first job');
  const waits = m.choose({ jobs, rows: outside, table, waiting: new Set(['test-time']) });
  assert.deepEqual([waits.job, waits.by], ['acme-time', 'rotation'], 'the measure\'s job has an open PR: the next in rotation');
  const all = m.choose({ jobs, rows: outside, table, waiting: new Set(jobs) });
  assert.equal(all.job, null);
  assert.match(all.reason, /every job waits for its open keel-climb\/<job>\/ PR/);
  assert.deepEqual([...m.waitingJobs(['keel-climb/test-time/2026-10-04', 'keel-night/2026-10-05', 'renovate/x'])], ['test-time']);
  // The health page's own rows, read from the table the night writes.
  assert.deepEqual(m.healthRows(page([['slow_tests', 3, '≤ 0', 'outside'], ['ci', '—', '≤ 0', 'n/a']])), [
    { id: 'slow_tests', value: 3, bound: 0, op: '≤', state: 'outside' }, { id: 'ci', value: null, bound: 0, op: '≤', state: 'n/a' }]);

  // The command line, against a stub gh.
  const none = await stubGh(t, ['keel-night/2026-10-05']);
  const p = json(climb(dir, ['pick', '--date', '2026-10-06', '--json'], { KEEL_GH: none }));
  assert.equal(p.job, 'test-time');
  assert.equal(p.by, 'measure');
  assert.match(p.why, /slow_tests is outside on the newest health page \(3 against ≤ 0\)/);
  assert.equal(p.branch, 'keel-climb/test-time/2026-10-06');
  assert.equal(p.health, 'docs/health/2026-10-05.md');
  // An open PR on the job's prefix: no climb tonight. (Mutation: pick ignoring it fails here.)
  const open = await stubGh(t, ['keel-climb/test-time/2026-10-04']);
  const w = climb(dir, ['pick', '--date', '2026-10-06', '--json'], { KEEL_GH: open });
  assert.equal(w.status, 0, w.stderr);
  assert.equal(json(w).job, null);
  assert.deepEqual(json(w).waiting, ['test-time']);
  // gh unreadable: exit 2, never a guess that nothing is open.
  const down = climb(dir, ['pick', '--json'], { KEEL_GH: await stubGh(t, null) });
  assert.equal(down.status, 2);
  assert.match(json(down).error, /pick never guesses that none are open/);
  // Weekly: Mondays (UTC) only, unless forced (a dispatch).
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ name: 'Acme', climb: { jobs: ['test-time'], schedule: 'weekly' } }));
  assert.match(json(climb(dir, ['pick', '--date', '2026-10-06', '--json'], { KEEL_GH: none })).reason, /not tonight: climb is weekly/);
  assert.equal(json(climb(dir, ['pick', '--date', '2026-10-05', '--json'], { KEEL_GH: none })).job, 'test-time');
  assert.equal(json(climb(dir, ['pick', '--date', '2026-10-06', '--force', '--json'], { KEEL_GH: none })).job, 'test-time');
});

test('config: a bad climb is an error naming each key; the defaults fill the rest', async t => {
  const dir = await acme(t, { climb: { jobs: ['test-time', 'acme-time'], budget: { minutes: 4 }, margin: 0.6, schedule: 'hourly', acme: 1 } });
  const bad = climb(dir, ['config', '--json']);
  assert.equal(bad.status, 2);
  for (const m of [/unknown job "acme-time"/, /budget\.minutes must be a whole number from 5 to 180/, /margin must be a fraction from 0\.01 to 0\.5/, /schedule must be "nightly" or "weekly"/, /unknown key acme/]) assert.match(json(bad).error, m);
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ name: 'Acme', climb: { jobs: ['test-time'] } }));
  assert.deepEqual(json(climb(dir, ['config', '--json'])), { on: true, jobs: ['test-time'], minutes: 45, schedule: 'nightly', margin: 0.05, attempts: 10, testCommand: 'npm test' });
});

test('compare: keep for a real gain, revert for one inside the noise, and two alternated rounds, not one', async t => {
  const dir = await acme(t, { climb: TIMED, files: { 't.mjs': sleeper(600) } });
  const base = git(dir, ['rev-parse', 'HEAD']);
  const fast = await commit(dir, { 't.mjs': sleeper(10, 'fast') }, 'acme: a faster suite');
  git(dir, ['checkout', '-q', '-b', 'noise', base]);
  const noise = await commit(dir, { 't.mjs': sleeper(600, 'noise') }, 'acme: the same suite');
  // Fast in round 1 (base first, then its first two runs), slow in round 2 (it goes first).
  git(dir, ['checkout', '-q', '-b', 'lucky', base]);
  const counter = join(dir, '..', `${dir.split('/').pop()}-count`);
  t.after(() => rm(counter, { force: true }));
  const lucky = await commit(dir, { 't.mjs': `import { readFileSync, writeFileSync } from 'node:fs';\nlet n = 0;\ntry { n = Number(readFileSync(process.env.ACME_COUNT, 'utf8')); } catch {}\nwriteFileSync(process.env.ACME_COUNT, String(n + 1));\nsetTimeout(() => {}, n < 2 ? 10 : 1100);\n` }, 'acme: fast once');
  // Each compare's rounds go to the run's diagnostics, so a red run on a slow machine shows its numbers.
  const cmp = (candidate, env = {}) => {
    const r = json(climb(dir, ['compare', '--base', base, '--candidate', candidate, '--runs', '2', '--json'], env));
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
  const one = climb(dir, ['compare', '--base', base, '--candidate', fast, '--rounds', '1', '--json']);
  assert.equal(one.status, 2);
  assert.match(json(one).error, /two alternated rounds or more/);
  assert.equal(git(dir, ['worktree', 'list']).split('\n').length, 1, 'compare removes its worktrees');
  // A suite that fails has no time: exit 2, never a number.
  const broken = await commit(dir, { 't.mjs': 'process.exit(3);\n' }, 'acme: broken');
  const b = climb(dir, ['compare', '--base', base, '--candidate', broken, '--runs', '1', '--json']);
  assert.equal(b.status, 2);
  assert.match(json(b).error, /failed \(exit 3\).*a failing suite has no time/);
});

test('compare --decide, revert, settle and report: the numbers go in the commit, a miss resets, and the PR body says it all', async t => {
  const dir = await acme(t, { climb: TIMED, files: { 't.mjs': sleeper(600), 'package.json': '{ "name": "acme", "files": ["lib/"] }\n' } });
  const base = git(dir, ['rev-parse', 'HEAD']);
  const m = await load(dir);
  const baseline = json(climb(dir, ['measure', 'test-time', '--baseline', '--runs', '1', '--json']));
  assert.equal(baseline.times.length, 1);
  const night = () => readFile(join(dir, '.keel/climb/night.json'), 'utf8').then(JSON.parse);
  assert.equal((await night()).base, base);
  assert.equal(git(dir, ['status', '--porcelain']), '', 'the night\'s record ignores itself');

  await commit(dir, { 't.mjs': sleeper(10, 'fast') }, 'acme: share one fixture');
  const kept = json(climb(dir, ['compare', '--decide', '--runs', '1', '--json']));
  assert.equal(kept.verdict, 'keep', kept.why);
  const message = git(dir, ['log', '-1', '--format=%B']);
  assert.match(message, /^acme: share one fixture\n\nclimb test-time: \d+ ms → \d+ ms \(−[\d.]+%\); \d+ ms → \d+ ms \(−[\d.]+%\); margin 30%, base [0-9a-f]{7}$/);
  const keptSha = git(dir, ['rev-parse', 'HEAD']);
  assert.equal(kept.head, keptSha);

  await commit(dir, { 't.mjs': sleeper(100, 'slower') }, 'acme: nothing really');
  const missed = json(climb(dir, ['compare', '--decide', '--runs', '1', '--json']));
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
  await commit(dir, { 't.mjs': sleeper(5, 'late') }, 'acme: undecided');
  await writeFile(join(dir, 'scratch.txt'), 'half-made\n');
  assert.equal(json(climb(dir, ['settle', '--json'])).head, keptSha);
  assert.equal(git(dir, ['rev-parse', 'HEAD']), keptSha);
  assert.equal(git(dir, ['status', '--porcelain']), '');

  const final = json(climb(dir, ['compare', '--final', '--runs', '1', '--json']));
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

/** An Acme suite under node --test with the test ledger as its second reporter. */
const LEDGER_TEST = 'node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=./scripts/keel/test-ledger.mjs --test-reporter-destination=stdout acme.test.mjs';
const suite = (...names) => `import { test } from 'node:test';\n${names.map(n => (typeof n === 'string' ? `test('${n}', () => {});` : n.text)).join('\n')}\n`;

test('guard: fails when a test that ran in the base did not run in the candidate (dropped or skipped), and passes a refactor', async t => {
  const dir = await acme(t, { climb: { jobs: ['test-time'], testCommand: LEDGER_TEST }, config: { check: LEDGER_TEST }, files: { 'acme.test.mjs': suite('acme adds', 'acme subtracts') } });
  const base = git(dir, ['rev-parse', 'HEAD']);
  const at = async (branch, files) => { git(dir, ['checkout', '-q', '-b', branch, base]); return commit(dir, files, `acme: ${branch}`); };
  const guard = () => climb(dir, ['guard', '--base', base, '--json']);

  await at('drop', { 'acme.test.mjs': suite('acme adds') });
  const dropped = guard();
  assert.equal(dropped.status, 1, dropped.stdout);
  assert.deepEqual(json(dropped).missing, [{ file: 'acme.test.mjs', name: 'acme subtracts', how: 'dropped' }]);
  assert.match(json(dropped).problems[0], /^dropped: acme\.test\.mjs "acme subtracts" ran in the base [0-9a-f]{7}/);

  await at('skip', { 'acme.test.mjs': suite('acme adds', { text: "test('acme subtracts', { skip: true }, () => {});" }) });
  const skipped = guard();
  assert.equal(skipped.status, 1, skipped.stdout);
  assert.deepEqual(json(skipped).missing.map(m => m.how), ['skipped']);

  await at('refactor', { 'acme.test.mjs': `${suite('acme adds', 'acme subtracts')}// shared fixture\n` });
  const ok = guard();
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(json(ok).line, /exit 0 on [0-9a-f]{7}; 2 tests ran, none dropped or skipped against the base/);

  await at('red', { 'acme.test.mjs': suite('acme adds', { text: "test('acme subtracts', () => { throw new Error('acme'); });" }) });
  const red = guard();
  assert.equal(red.status, 1);
  assert.match(json(red).problems[0], /the gate `.*` failed \(exit 1\)/);

  // No ledger: guard cannot tell, and says so (exit 2), never a pass.
  git(dir, ['checkout', '-q', '-f', 'refactor']);
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ name: 'Acme', check: 'node --test acme.test.mjs', climb: { jobs: ['test-time'], testCommand: 'node --test acme.test.mjs' } }));
  git(dir, ['commit', '-q', '-am', 'acme: no ledger']);
  const blind = climb(dir, ['guard', '--base', base, '--json']);
  assert.equal(blind.status, 2);
  assert.match(json(blind).error, /recorded no test ledger run/);
});

/** Run one named step of keel-climb.yml in `dir`, as the workflow has it: { status, out, outputs }. */
async function step(t, dir, name, env = {}) {
  const block = runBlocks(await readFile(WORKFLOW, 'utf8')).find(b => b.step === name);
  assert.ok(block, `keel-climb.yml has a step "${name}"`);
  const out = join(dir, '..', `${dir.split('/').pop()}-${name.replace(/\W/g, '')}-out`);
  t.after(() => rm(out, { force: true }));
  await writeFile(out, '');
  const r = run('bash', ['-e', '-c', block.script], { cwd: dir, env: { ...process.env, GITHUB_OUTPUT: out, ...env } });
  const outputs = Object.fromEntries((await readFile(out, 'utf8')).split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  return { status: r.status, out: r.stdout + r.stderr, outputs };
}

test('off: with no climb key the workflow does nothing; with no secret the run ends green with a notice', async t => {
  const off = await acme(t, { climb: null });
  const o = await step(t, off, 'Is climb on?');
  assert.equal(o.status, 0, o.out);
  assert.match(o.out, /climb is off: \.keel\/keel\.json has no "climb", so this run does nothing\./);
  assert.equal(o.outputs.on, 'false');
  assert.deepEqual(json(climb(off, ['config', '--json'])), { on: false });
  const p = climb(off, ['pick', '--json'], { KEEL_GH: await stubGh(t, null) });
  assert.equal(p.status, 0, 'climb off never asks gh');
  assert.match(json(p).reason, /climb is off/);

  const on = await acme(t);
  assert.equal((await step(t, on, 'Is climb on?')).outputs.on, 'true');
  const unset = await step(t, on, 'Configured?', { OAUTH: '', API_KEY: '' });
  assert.equal(unset.status, 0, unset.out);
  assert.match(unset.out, /^::notice::Skipped: add the CLAUDE_CODE_OAUTH_TOKEN \(or ANTHROPIC_API_KEY\) secret/m);
  assert.equal(unset.outputs.enabled, 'false');
  assert.equal((await step(t, on, 'Configured?', { OAUTH: 'acme-token', API_KEY: '' })).outputs.enabled, 'true');

  // Every step after those two waits on them: nothing runs when climb is off or unconfigured.
  const text = await readFile(WORKFLOW, 'utf8');
  const steps = text.split(/\n(?= {6}- )/).filter(s => /^ {6}- /.test(s));
  const after = steps.slice(steps.findIndex(s => s.includes('name: Configured?')) + 1);
  assert.ok(after.length >= 8);
  for (const s of after) {
    const cond = /(?:^ {6}- |\n {8})if: (.+)/.exec(s)?.[1] ?? '';
    // A step for one job (hygiene's gather, its issue) runs only when that job was picked: a job, so climb is on.
    assert.match(cond, /steps\.configured\.outputs\.enabled == 'true'|steps\.pick\.outputs\.job != ''|steps\.pick\.outputs\.job == '[a-z-]+'/, `step without the guard: ${s.split('\n')[0]}`);
  }
  assert.match(steps.find(s => s.includes('name: Configured?')), /if: steps\.on\.outputs\.on == 'true'/);
});

// ---- phase 36: hygiene and build-time ---------------------------------------------

/** Synthetic test ledger runs (the ledger's record shape) for `tree`, written under dir's .keel/test-runs. */
async function ledgerRuns(dir, { commit, tree, outcomes, file = 'acme.test.mjs', name = 'acme waits', others = ['acme adds'] }) {
  await mkdir(join(dir, '.keel/test-runs'), { recursive: true });
  await writeFile(join(dir, '.keel/test-runs/.gitignore'), '*\n');
  for (const [i, outcome] of outcomes.entries()) {
    const run = { commit, tree, dirty: false, machine: { os: 'linux', arch: 'x64', cpus: 4 }, node: 'v24.0.0', date: `2026-10-05T0${i}:00:00.000Z`, tests: [...others.map(n => ({ file, name: n, outcome: 'pass', ms: 1 })), { file, name, outcome, ms: 2 }] };
    await writeFile(join(dir, `.keel/test-runs/2026-10-05T0${i}-00-00-000Z-${i}.json`), JSON.stringify(run));
  }
}

test('pick: hygiene goes ahead of every other job when the ledger names a flaky test, never by rotation, and waits like any job', async t => {
  const dir = await acme(t, { climb: { jobs: ['test-time', 'build-time', 'hygiene'], build: 'node -e ""', buildOutput: 'dist' } });
  const m = await load(dir);
  const jobs = ['test-time', 'build-time', 'hygiene'];
  const flakyRow = { id: 'flaky_tests', value: 1, bound: 0, op: '≤', state: 'outside' };
  // Every other measure further outside, one even broken: a flaky test still goes first. (Mutation: pick not preferring hygiene fails here.)
  const worse = [{ id: 'slow_tests', value: null, bound: 0, op: '≤', state: 'broken' }, { id: 'build_time', value: 90000, bound: 1000, op: '≤', state: 'outside' }, flakyRow];
  assert.deepEqual([m.choose({ jobs, rows: worse }).job, m.choose({ jobs, rows: worse }).by], ['hygiene', 'measure']);
  assert.match(m.choose({ jobs, rows: worse }).why, /^flaky_tests is outside/);
  assert.equal(m.choose({ jobs, rows: worse.slice(0, 2) }).job, 'test-time', 'with no flaky test, broken beats outside as before');
  assert.equal(m.choose({ jobs, rows: [worse[1]] }).job, 'build-time', 'build_time outside sends the night to build-time');
  assert.equal(m.choose({ jobs, rows: worse, waiting: new Set(['hygiene']) }).job, 'test-time', 'hygiene with an open PR waits');
  // Rotation never lands on hygiene: with no flaky test there is nothing to fix.
  assert.equal(m.choose({ jobs, rows: [], last: 'build-time' }).job, 'test-time');
  assert.equal(m.choose({ jobs: ['hygiene'], rows: [] }).job, null);
  assert.match(m.choose({ jobs: ['hygiene'], rows: [] }).reason, /hygiene \(only when its measure is outside\)/);

  // The command line, from the health page the night writes.
  await write(dir, { 'docs/health/2026-10-05.md': page([['slow_tests', 9, '≤ 0', 'outside'], ['flaky_tests', 1, '≤ 0', 'outside'], ['build_time', 4000, '≤ 1000', 'outside']]) });
  const p = json(climb(dir, ['pick', '--date', '2026-10-06', '--json'], { KEEL_GH: await stubGh(t, []) }));
  assert.equal(p.job, 'hygiene', JSON.stringify(p));
  assert.equal(p.branch, 'keel-climb/hygiene/2026-10-06');
  assert.equal(p.command, 'the test ledger (.keel/test-runs)');
  // A build_time with no bound (recorded only) is a dash on the page: never a reason to climb.
  assert.deepEqual(m.healthRows(page([['build_time', 4000, '—', 'ok']])), []);
});

test('retirement: a job whose last three PRs were closed unmerged is skipped by pick until one is reopened or merged', async t => {
  const { climbRetiring, retireLine } = await import(pathToFileURL(join(NIGHT, 'lib.mjs')).href);
  const pr = (n, job, merged = false) => ({ headRefName: `keel-climb/${job}/2026-10-0${n}`, number: n, createdAt: `2026-10-0${n}T10:00:00Z`, mergedAt: merged ? `2026-10-0${n}T12:00:00Z` : null });
  const three = [pr(1, 'test-time'), pr(2, 'test-time'), pr(3, 'test-time'), pr(4, 'build-time')];
  assert.deepEqual(climbRetiring(three, ['test-time', 'build-time']), [{ job: 'test-time', prs: [3, 2, 1] }]);
  assert.deepEqual(climbRetiring([pr(1, 'test-time'), pr(2, 'test-time', true), pr(3, 'test-time')], ['test-time']), [], 'one merged among the last three');
  assert.deepEqual(climbRetiring([pr(1, 'test-time', true), pr(2, 'test-time'), pr(3, 'test-time'), pr(4, 'test-time')], ['test-time']).map(r => r.prs), [[4, 3, 2]], 'an older merge does not save it');
  assert.deepEqual(climbRetiring(three.slice(0, 2), ['test-time']), [], 'two is not three');
  assert.match(retireLine({ job: 'test-time', prs: [3, 2, 1] }), /^Climb: `test-time` proposes its own retirement: its last 3 keel-climb\/test-time\/ PRs \(#3, #2, #1\) were closed unmerged\. Remove it from "climb"\.jobs, or reopen one/);

  // pick, against gh's closed list: test-time is skipped, the rotation goes on. (Mutation: ignoring three closed PRs fails here.)
  const dir = await acme(t, { climb: { jobs: ['test-time', 'build-time'], build: 'node -e ""', buildOutput: 'dist' }, files: { 'docs/health/2026-10-05.md': page([['slow_tests', 3, '≤ 0', 'outside']]) } });
  const p = json(climb(dir, ['pick', '--date', '2026-10-06', '--json'], { KEEL_GH: await stubGh(t, [], three) }));
  assert.equal(p.job, 'build-time', JSON.stringify(p));
  assert.deepEqual(p.retiring, [{ job: 'test-time', prs: [3, 2, 1] }]);
  // The owner removes build-time too, or both retire: nothing runs, and pick says why.
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ name: 'Acme', climb: { jobs: ['test-time'] } }));
  const none = json(climb(dir, ['pick', '--date', '2026-10-06', '--json'], { KEEL_GH: await stubGh(t, [], three) }));
  assert.equal(none.job, null);
  assert.match(none.reason, /test-time \(retiring: its last three PRs were closed unmerged\)/);
  // Reopened: the PR is open, so the job waits for the person, and is not retired.
  const reopened = json(climb(dir, ['pick', '--date', '2026-10-06', '--json'], { KEEL_GH: await stubGh(t, ['keel-climb/test-time/2026-10-03'], three.slice(0, 2)) }));
  assert.deepEqual([reopened.job, reopened.waiting, reopened.retiring], [null, ['test-time'], []]);
});

/** A flaky test with a timeout, as a person might first write it. */
const WAITING = `import { test } from 'node:test';
test('acme adds', () => {});
test('acme waits', { timeout: 100 }, async () => {
  const id = Math.random().toString(36).slice(2, 6);
  if (id.length > 4) throw new Error('acme');
});
`;

test('hygiene guard: refuses a diff that only raises a timeout or wraps a retry around the flaky test, naming the line; a real fix that also changes a timeout passes, with a note', async t => {
  const dir = await acme(t, { climb: { jobs: ['hygiene'], testCommand: LEDGER_TEST }, config: { check: LEDGER_TEST }, files: { 'acme.test.mjs': WAITING } });
  const base = git(dir, ['rev-parse', 'HEAD']);
  await ledgerRuns(dir, { commit: base, tree: git(dir, ['rev-parse', 'HEAD^{tree}']), outcomes: ['pass', 'fail', 'pass'] });
  const baseline = json(climb(dir, ['measure', 'hygiene', '--baseline', '--json']));
  assert.equal(baseline.median, 1);
  assert.deepEqual(baseline.flaky.map(f => [f.file, f.name, f.passed, f.failed]), [['acme.test.mjs', 'acme waits', 2, 1]]);
  assert.match(baseline.flaky[0].alone, /^node --test --test-name-pattern='\^acme waits\$' acme\.test\.mjs$/);
  const at = async (branch, text) => { git(dir, ['checkout', '-q', '-b', branch, base]); return commit(dir, { 'acme.test.mjs': text }, `acme: ${branch}`); };
  const guard = () => climb(dir, ['guard', '--json']);

  // A longer timeout and nothing else: refused, naming the line. (Mutation: removing the refusal fails here.)
  await at('longer', WAITING.replace('{ timeout: 100 }', '{ timeout: 5000 }'));
  const longer = guard();
  assert.equal(longer.status, 1, longer.stdout + longer.stderr);
  assert.match(json(longer).problems[0], /^acme\.test\.mjs:3 `test\('acme waits', \{ timeout: 5000 \}, async \(\) => \{`: in the flaky test's file this diff only changes a timeout or a retry/);
  assert.equal(json(longer).refused[0].line, 3);

  // A retry wrapped around the body (its lines re-indented): still only a retry.
  await at('retry', WAITING.replace("  const id = Math.random().toString(36).slice(2, 6);\n  if (id.length > 4) throw new Error('acme');\n",
    "  for (let attempt = 0; attempt < 3; attempt++) {\n    try {\n      const id = Math.random().toString(36).slice(2, 6);\n      if (id.length > 4) throw new Error('acme');\n      break;\n    } catch {}\n  }\n"));
  const retry = guard();
  assert.equal(retry.status, 1, retry.stdout);
  assert.match(json(retry).problems[0], /^acme\.test\.mjs:4 `for \(let attempt = 0; attempt < 3; attempt\+\+\) \{`: .*only changes a timeout or a retry/);

  // The cause fixed, and the timeout changed too: it passes, and says so for the person.
  await at('fixed', WAITING.replace('{ timeout: 100 }', '{ timeout: 500 }').replace('.slice(2, 6)', '.slice(2, 6).padEnd(4, "0").slice(0, 4)'));
  const fixed = guard();
  assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr);
  assert.match(json(fixed).noted[0].message, /^acme\.test\.mjs:3 .*changes a timeout or a retry beside 2 other changed lines: a real fix that also changes a timeout passes/);
  assert.match(fixed.stdout, /"line": "`node --test/);
  assert.deepEqual(JSON.parse(await readFile(join(dir, '.keel/climb/night.json'), 'utf8')).hygieneNotes.length, 1);
  // The same check by name, against an explicit base.
  assert.equal(climb(dir, ['guard', '--job', 'hygiene', '--base', base, '--json']).status, 0);
});

test('build guard: fails when the build output changes and no harmless reason names the path; passes byte-identical, or explained, and the PR names each reason', async t => {
  const build = text => `import { mkdirSync, writeFileSync } from 'node:fs';\nmkdirSync('dist/css', { recursive: true });\nwriteFileSync('dist/app.txt', ${JSON.stringify(text)});\nwriteFileSync('dist/css/acme.css', 'body{}\\n');\n`;
  const cfg = { jobs: ['build-time'], build: 'node build.mjs', buildOutput: 'dist/', testCommand: LEDGER_TEST };
  const dir = await acme(t, { climb: cfg, config: { check: LEDGER_TEST }, files: { 'build.mjs': build('acme anvils\n'), '.gitignore': 'dist/\n', 'acme.test.mjs': suite('acme adds') } });
  const base = git(dir, ['rev-parse', 'HEAD']);
  const m = await load(dir);
  json(climb(dir, ['measure', 'build-time', '--baseline', '--runs', '1', '--json']));
  const at = async (branch, text) => { git(dir, ['checkout', '-q', '-b', branch, base]); return commit(dir, { 'build.mjs': text }, `acme: ${branch}`); };

  await at('same', `// one pass, not two\n${build('acme anvils\n')}`);
  const same = climb(dir, ['guard', '--json']);
  assert.equal(same.status, 0, same.stdout + same.stderr);
  assert.deepEqual([json(same).build.output, json(same).build.files, json(same).build.changes], ['dist', 2, []]);

  // The output changed and nothing says why: the guard fails, naming the path. (Mutation: accepting it fails here.)
  await at('changed', build('acme anvils, faster\n'));
  const changed = climb(dir, ['guard', '--json']);
  assert.equal(changed.status, 1, changed.stdout + changed.stderr);
  assert.deepEqual(json(changed).build.changes, [{ path: 'dist/app.txt', how: 'changed' }]);
  assert.match(json(changed).problems[0], /^build output changed: dist\/app\.txt differs from the base [0-9a-f]{7}'s and has no harmless reason \(climb\.mjs harmless --path dist\/app\.txt/);
  // A reason for another path is not a reason for this one.
  climb(dir, ['harmless', '--path', 'dist/css/acme.css', '--why', 'acme']);
  assert.equal(climb(dir, ['guard', '--json']).status, 1);
  const h = climb(dir, ['harmless', '--path', 'dist/app.txt', '--why', 'the banner text only; no code changes', '--json']);
  assert.equal(h.status, 0, h.stderr);
  const explained = climb(dir, ['guard', '--json']);
  assert.equal(explained.status, 0, explained.stdout + explained.stderr);
  const night = JSON.parse(await readFile(join(dir, '.keel/climb/night.json'), 'utf8'));
  assert.deepEqual(night.build.changes, [{ path: 'dist/app.txt', how: 'changed', why: 'the banner text only; no code changes' }]);

  // The PR names it under Merge danger, for the person to judge.
  const { prBody } = await import(pathToFileURL(join(NIGHT, 'pr-body.mjs')).href);
  const kept = { what: 'acme: one pass', verdict: 'keep', why: 'beat', candidate: 'a'.repeat(40), rounds: [{ base: 2000, candidate: 1000, change: -0.5 }] };
  const body = prBody(m.reportOf({ ...night, tried: [kept], final: null }).input);
  const danger = body.slice(body.indexOf('## Merge danger'));
  assert.match(danger, /^The build's output \(dist\) differs from the base's; each path with why it is harmless, for the person to judge:\n\n- `dist\/app\.txt \(changed\)`: the banner text only; no code changes$/m);
  const identical = prBody(m.reportOf({ ...night, build: { output: 'dist', files: 2, changes: [] }, tried: [kept], final: null }).input);
  assert.match(identical, /^The build's output \(dist, 2 files\) is byte-identical to the base's/m);
  assert.doesNotMatch(identical.slice(identical.indexOf('## Merge danger')), /harmless/);

  // build-time needs its command and what it writes.
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ name: 'Acme', climb: { jobs: ['build-time'], buildOutput: '../x', buildBudgetMs: 0 } }));
  const bad = climb(dir, ['config', '--json']);
  assert.equal(bad.status, 2);
  for (const re of [/build-time, so "climb"\.build must name the build command/, /buildOutput must be a path inside the repo/, /buildBudgetMs must be a whole number/]) assert.match(json(bad).error, re);
});
