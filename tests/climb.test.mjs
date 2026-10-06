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

/** A stub gh whose `pr list` prints these open heads (or exits 1 when `heads` is null). */
async function stubGh(t, heads) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-climb-gh-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const gh = join(dir, 'gh');
  const body = heads === null ? 'echo "gh: acme is unreachable" >&2\nexit 1' : `echo '${JSON.stringify(heads.map(h => ({ headRefName: h })))}'\nexit 0`;
  await writeFile(gh, `#!/bin/sh\nif [ "$1 $2" = "pr list" ]; then\n${body}\nfi\nexit 1\n`, { mode: 0o755 });
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
    assert.match(cond, /steps\.configured\.outputs\.enabled == 'true'|steps\.pick\.outputs\.job != ''/, `step without the guard: ${s.split('\n')[0]}`);
  }
  assert.match(steps.find(s => s.includes('name: Configured?')), /if: steps\.on\.outputs\.on == 'true'/);
});
