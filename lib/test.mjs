// keel test <file>... --stalls: does a test judge the code, or the machine
// (phase 55; docs/research/2026-10-09-robot-and-time.md)? The files run with
// stalls (the night practice's scripts/keel/stalls.mjs: the test's process
// group paused at seeded moments) and without, and each test that passed
// without and failed with is named: it judges the wall clock. The run
// without is a fresh one, or, when the tree is clean and nothing is
// narrowed, the test ledger's newest run of this tree within a day.
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { runFiles, judge, replay, freshSeed, seedOf, preloadsOfScript } from '../practices/night/files/scripts/keel/stalls.mjs';
import { readRuns, where, RUNS } from '../practices/night/files/scripts/keel/test-ledger.mjs';

const DAY_MS = 24 * 60 * 60_000;

class UsageError extends Error {
  constructor(message) { super(message); this.exitCode = 2; }
}

/** The project's test preloads (package.json scripts.test's --import/--require), so a file runs as the suite runs it. */
async function preloadsOf(root) {
  try { return preloadsOfScript(JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))?.scripts?.test); } catch { return []; }
}

/**
 * The ledger's newest run of this tree within a day that ran every file,
 * whole (never narrowed), on a clean tree; null when there is none or the
 * tree is dirty. Its outcomes stand in for a plain run.
 */
export async function ledgerPlain(root, files, { now = Date.now() } = {}) {
  const here = where(root);
  if (!here.tree || here.dirty !== false) return null;
  const { runs } = await readRuns(root);
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i];
    if (r.tree !== here.tree || r.dirty !== false || r.filtered || now - Date.parse(r.date) > DAY_MS) continue;
    const tests = (r.tests ?? []).filter(t => files.includes(t.file));
    if (files.every(f => tests.some(t => t.file === f))) return { run: r.id, date: r.date, tests };
  }
  return null;
}

const counts = tests => ['pass', 'fail', 'inconclusive', 'skip', 'todo']
  .map(o => [o, tests.filter(t => t.outcome === o).length]).filter(([o, n]) => n || o === 'pass' || o === 'fail')
  .map(([o, n]) => `${n} ${{ pass: 'passed', fail: 'failed', inconclusive: 'inconclusive', skip: 'skipped', todo: 'todo' }[o]}`).join(', ');

/** keel test: { data, text, exitCode }. */
export async function keelTest({ root, cwd = root, files, name, seed, stalls, env = process.env }) {
  if (!stalls) throw new UsageError('keel test runs a file with --stalls (a plain run is your own test script): keel test <file>... --stalls [--seed N]');
  if (!files.length) throw new UsageError('keel test <file>... --stalls [--name <pattern>] [--seed N]');
  const given = seed === undefined ? null : seedOf(seed);
  if (seed !== undefined && given === null) throw new UsageError('--seed needs a whole number, 0 to 4294967295');
  const rel = [];
  for (const f of files) {
    const abs = isAbsolute(f) ? f : resolve(cwd, f);
    if (!(await stat(abs).catch(() => null))?.isFile()) throw new UsageError(`no test file ${f}`);
    rel.push(relative(root, abs).split(sep).join('/'));
  }
  const preload = await preloadsOf(root);
  const run = opts => runFiles({ files: rel, cwd: root, root, name, preload, env, ...opts });
  const fromLedger = name ? null : await ledgerPlain(root, rel);
  const plain = fromLedger ? { from: 'ledger', run: fromLedger.run, date: fromLedger.date, tests: fromLedger.tests } : { from: 'run', ...(await run({})) };
  const stalled = await run({ seed: given ?? freshSeed() });
  const j = judge(plain.tests, stalled.tests);
  const again = replay(rel, stalled.seed, name);
  const failed = stalled.tests.filter(t => t.outcome === 'fail');
  const broken = stalled.timedOut || (stalled.exitCode !== 0 && !failed.length);
  const exitCode = j.named.length || failed.length || broken || plain.tests.some(t => t.outcome === 'fail') ? 1 : 0;
  const data = {
    files: rel, name: name ?? null, seed: stalled.seed, replay: again,
    plain: { from: plain.from, ...(plain.from === 'ledger' ? { run: plain.run, date: plain.date } : { wall: plain.wall }), tests: plain.tests },
    stalled: { stalls: stalled.stalls.map(({ at, ms }) => ({ at, ms })), paused: stalled.paused, wall: stalled.wall, timedOut: stalled.timedOut, exitCode: stalled.exitCode, tests: stalled.tests },
    named: j.named, both: j.both, inconclusive: j.inconclusive, missing: j.missing,
  };
  const text = [
    `keel test --stalls: ${rel.join(', ')}${name ? ` (--name ${name})` : ''}, seed ${stalled.seed}`,
    `  without stalls: ${counts(plain.tests)}${plain.from === 'ledger' ? ` (the ledger's run ${plain.run} of this tree, ${plain.date}; ${RUNS})` : ''}`,
    `  with stalls:    ${counts(stalled.tests)}; ${stalled.stalls.length} stall${stalled.stalls.length === 1 ? '' : 's'}, ${(stalled.paused / 1000).toFixed(1)} s paused of ${(stalled.wall / 1000).toFixed(1)} s`,
    ...(stalled.timedOut ? ['  it ran past its time limit (paused time not counted)'] : []),
    ...(broken && !stalled.timedOut ? [`  node --test exited ${stalled.exitCode ?? stalled.signal}: ${stalled.stderr.split('\n').slice(-3).join(' | ') || 'no output'}`] : []),
    ...(j.named.length
      ? ['', 'Judges the wall clock (passed without stalls, failed with them):', ...j.named.map(t => `  ${t.file} "${t.name}"${t.error ? `: ${t.error}` : ''}`),
        '', 'Give the code its clock (mock.timers in node:test, a clock passed in, events counted rather than waited for),',
        `then pin the file so a wall-clock wait that creeps back fails the gate: .keel/keel.json "tests": { "stalls": [${rel.map(f => JSON.stringify(f)).join(', ')}] }.`]
      : ['', failed.length || broken ? 'None passed without stalls and failed with them.' : 'No test judges the wall clock here.']),
    ...(j.both.length ? ['', 'Failed with stalls and without (a failure stalls cannot judge):', ...j.both.map(t => `  ${t.file} "${t.name}"${t.error ? `: ${t.error}` : ''}`)] : []),
    ...(j.inconclusive.length ? ['', 'Inconclusive with stalls (judges real time on purpose; the machine kept it from judging):', ...j.inconclusive.map(t => `  ${t.file} "${t.name}": ${t.inconclusive}`)] : []),
    '', `Replay these stalls: ${again}`,
  ].join('\n');
  return { data, text, exitCode };
}
