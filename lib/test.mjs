// keel test <file>... --stalls: does a test judge the code, or the machine
// (phase 55; docs/research/2026-10-09-robot-and-time.md)? The files run with
// stalls (the night practice's scripts/keel/stalls.mjs: the test's process
// group paused at seeded moments) and without, and each test that passed
// without and failed with is named: it judges the wall clock. The run
// without is a fresh one, or, when the tree is clean and nothing is
// narrowed, the test ledger's newest run of this tree within a day.
import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { platform, arch } from 'node:os';
import { runFiles, judge, replay, freshSeed, seedOf, preloadsOfScript, flagsOfScript } from '../practices/night/files/scripts/keel/stalls.mjs';
import { readRuns, where, rootOf, configHash, runnerOf, RUNS, recordStalls, failureText } from '../practices/night/files/scripts/keel/test-ledger.mjs';

import { digest, stallsEvidence } from '../practices/night/files/scripts/keel/time-receipts.mjs';

const DAY_MS = 24 * 60 * 60_000;

class UsageError extends Error {
  constructor(message) { super(message); this.exitCode = 2; }
}

/** The suite's test script (package.json scripts.test), or ''. */
async function scriptOf(dir) {
  try { return String(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))?.scripts?.test ?? ''); } catch { return ''; }
}

/**
 * The suite's folder a file is run from: the nearest folder with a
 * package.json from where keel test was run, up to the project's root (a
 * workspace's own tests run from their own folder, with their own preloads,
 * as its `npm test` runs them).
 */
async function suiteOf(root, cwd) {
  const top = resolve(root);
  for (let d = resolve(cwd); ; d = dirname(d)) {
    if ((await stat(join(d, 'package.json')).catch(() => null))?.isFile()) return d;
    if (d === top || dirname(d) === d || relative(top, d).startsWith('..')) return top;
  }
}

/** The variables .keel/keel.json says make two runs of one tree differ ("tests".configEnv). */
async function configEnvOf(root) {
  try {
    const c=JSON.parse(await readFile(join(root,'.keel','keel.json'),'utf8'));
    if(!c||typeof c!=='object'||Array.isArray(c)||c.tests!==undefined&&(!c.tests||typeof c.tests!=='object'||Array.isArray(c.tests)))return null;
    const names=c.tests?.configEnv;
    return names===undefined?[]:Array.isArray(names)&&names.every(n=>typeof n==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(n))?names:null;
  } catch(e) { return e.code==='ENOENT'?[]:null; }
}

/**
 * The ledger's newest run of this tree within a day that ran every file,
 * whole (never narrowed), on a clean tree, in this run's lane: the same
 * folder and the same config (NODE_OPTIONS, the preloads, each
 * "tests".configEnv variable), so a pass under another setting never stands
 * in for this one. Null when there is none or the tree is dirty. Its
 * outcomes stand in for a plain run.
 */
export async function ledgerPlain(root, files, { now = Date.now(), env = process.env, preload = [], flags = preload, configEnv = [], suite = root } = {}) {
  const here = where(root);
  if (!here.tree || here.dirty !== false) return null;
  const top = rootOf(root);
  const { runs } = await readRuns(top);
  const dir = relative(top, suite).split(sep).join('/') || '.';
  const config = configHash({ env, preload, configEnv });
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i];
    if (r.commit !== here.commit || r.tree !== here.tree || r.dirty !== false || r.filtered || now - Date.parse(r.date) > DAY_MS) continue;
    if ((r.dir ?? '.') !== dir || r.config !== config || runnerOf(r) !== 'node') continue;
    // The same node flags too (conditions, setup): a record from before they were recorded is never reused.
    if (!Array.isArray(r.flags) || JSON.stringify(r.flags) !== JSON.stringify(flags)) continue;
    // A pass on another node, OS or architecture is not a pass here.
    if (r.node !== process.version || r.machine?.os !== platform() || r.machine?.arch !== arch()) continue;
    const tests = (r.tests ?? []).filter(t => files.includes(t.file));
    // The ledger's files are the repo's; this run's are the project's (the same, unless keel's project is a folder of it).
    if (files.every(f => tests.some(t => t.file === f))) return { run: r.id, revision:r.commit, date: r.date, tests: tests.map(t => ({ ...t, file: relative(root, join(top, t.file)).split(sep).join('/') })) };
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
  const posixOf = p => p.split(sep).join('/');
  const abs = [];
  for (const f of files) {
    const a = isAbsolute(f) ? f : resolve(cwd, f);
    if (!(await stat(a).catch(() => null))?.isFile()) throw new UsageError(`no test file ${f}`);
    abs.push(a);
  }
  const rel = abs.map(a => posixOf(relative(root, a))); // as reported: the project's root
  const asRun = abs.map(a => posixOf(relative(cwd, a)) || a); // as replayed: from where keel test was run
  const suite = await suiteOf(root, cwd);
  const script = await scriptOf(suite);
  const preload = preloadsOfScript(script), flags = flagsOfScript(script);
  const configEnv = await configEnvOf(root);
  const run = opts => runFiles({ files: abs.map(a => posixOf(relative(suite, a))), cwd: suite, root, name, preload: flags, env, ...opts });
  const fromLedger = name || configEnv === null ? null : await ledgerPlain(root, abs.map(a => posixOf(relative(rootOf(root), a))), { env, preload, flags, configEnv, suite });
  const receiptIdentity = where(root), receiptStart = new Date().toISOString();
  const plain = fromLedger ? { from: 'ledger', run: fromLedger.run, revision:fromLedger.revision, date: fromLedger.date, tests: fromLedger.tests } : { from: 'run', ...(await run({})) };
  const stalled = await run({ seed: given ?? freshSeed() });
  const receiptEndIdentity=where(root);
  if(receiptEndIdentity.commit!==receiptIdentity.commit||receiptEndIdentity.dirty!==false)receiptIdentity.dirty=true;
  let receiptCoverage = { recorded: true };
  try { if(configEnv===null)throw new Error('redaction config unavailable'); await recordStalls(root, stallsEvidence({ sanitize:value=>failureText(value,env,{configEnv}), identity: receiptIdentity, plain, stalled, pinned: false, startedAt: receiptStart, completedAt: new Date().toISOString(), configHash: configHash({env,preload,configEnv}), flagsHash:digest(flags), scope: relative(root,suite).split(sep).join('/') || '.' })); } catch { receiptCoverage = {recorded:false,reason:'stalls receipt storage unavailable'}; }
  const j = judge(plain.tests, stalled.tests);
  const again = replay(asRun, stalled.seed, name);
  const failed = stalled.tests.filter(t => t.outcome === 'fail');
  const broken = stalled.timedOut || (stalled.exitCode !== 0 && !failed.length);
  // A fresh run without stalls that died (its time limit, a signal, a crash) gave no comparison: never a clean 0.
  const plainBroken = plain.from === 'run' && (plain.timedOut || (plain.exitCode !== 0 && !plain.tests.some(t => t.outcome === 'fail')));
  // A run that executed no test (an empty file, only suites, a --name that matches none) judged nothing: never a clean 0.
  const none = stalled.ran === 0 || (plain.from === 'run' && plain.ran === 0);
  const exitCode = j.named.length || failed.length || broken || plainBroken || none || plain.tests.some(t => t.outcome === 'fail') ? 1 : 0;
  const data = {
    receiptCoverage, files: rel, name: name ?? null, seed: stalled.seed, replay: again, ran: { plain: plain.from === 'run' ? plain.ran : null, stalled: stalled.ran },
    plain: { from: plain.from, ...(plain.from === 'ledger' ? { run: plain.run, date: plain.date } : { wall: plain.wall, timedOut: plain.timedOut, exitCode: plain.exitCode }), tests: plain.tests },
    stalled: { stalls: stalled.stalls.map(({ at, ms }) => ({ at, ms })), paused: stalled.paused, wall: stalled.wall, timedOut: stalled.timedOut, exitCode: stalled.exitCode, tests: stalled.tests },
    named: j.named, both: j.both, unbased: j.unbased, inconclusive: j.inconclusive, missing: j.missing,
  };
  const text = [
    `keel test --stalls: ${rel.join(', ')}${name ? ` (--name ${name})` : ''}, seed ${stalled.seed}`,
    `  without stalls: ${counts(plain.tests)}${plain.from === 'ledger' ? ` (the ledger's run ${plain.run} of this tree, ${plain.date}; ${RUNS})` : ''}`,
    ...(plainBroken ? [`  without stalls, node --test ${plain.timedOut ? 'ran past its time limit' : `exited ${plain.exitCode ?? plain.signal}`}: ${plain.stderr.split('\n').slice(-3).join(' | ') || 'no output'}; there is nothing to compare with`] : []),
    `  with stalls:    ${counts(stalled.tests)}; ${stalled.stalls.length} stall${stalled.stalls.length === 1 ? '' : 's'}, ${(stalled.paused / 1000).toFixed(1)} s paused of ${(stalled.wall / 1000).toFixed(1)} s`,
    ...(stalled.timedOut ? ['  it ran past its time limit (paused time not counted)'] : []),
    ...(none ? [`  no test ran${name ? ` (--name ${name} matches none)` : ''}: nothing was judged`] : []),
    ...(broken && !stalled.timedOut ? [`  node --test exited ${stalled.exitCode ?? stalled.signal}: ${stalled.stderr.split('\n').slice(-3).join(' | ') || 'no output'}`] : []),
    ...(j.named.length
      ? ['', 'Judges the wall clock (passed without stalls, failed with them):', ...j.named.map(t => `  ${t.file} "${t.name}"${t.error ? `: ${t.error}` : ''}`),
        '', 'Give the code its clock (mock.timers in node:test, a clock passed in, events counted rather than waited for),',
        `then pin the file so a wall-clock wait that creeps back fails the gate: .keel/keel.json "tests": { "stalls": [${rel.map(f => JSON.stringify(f)).join(', ')}] }.`]
      : ['', failed.length || broken || none ? 'None passed without stalls and failed with them.' : 'No test judges the wall clock here.']),
    ...(j.unbased.length ? ['', 'Failed with stalls, and inconclusive or absent without them (no pass to compare with):', ...j.unbased.map(t => `  ${t.file} "${t.name}"${t.error ? `: ${t.error}` : ''}`)] : []),
    ...(j.both.length ? ['', 'Failed with stalls and without (a failure stalls cannot judge):', ...j.both.map(t => `  ${t.file} "${t.name}"${t.error ? `: ${t.error}` : ''}`)] : []),
    ...(j.inconclusive.length ? ['', 'Inconclusive with stalls (judges real time on purpose; the machine kept it from judging):', ...j.inconclusive.map(t => `  ${t.file} "${t.name}": ${t.inconclusive}`)] : []),
    '', `Replay these stalls: ${again}`,
  ].join('\n');
  return { data, text, exitCode };
}
