// keel's test ledger (keel practice `night`; managed: keel render rewrites
// it). Every test run is remembered, and a flaky or slower test becomes
// hygiene work (keel phase 33; docs/research/2026-10-06-spec-rigor.md, lever 2).
//
// A node test reporter, used as a SECOND reporter beside the usual one:
//
//   node --test --test-reporter=spec --test-reporter-destination=stdout \
//     --test-reporter=./scripts/keel/test-ledger.mjs --test-reporter-destination=stdout …
//
// It writes the run's record itself, to .keel/test-runs/<iso-time>-<pid>.json
// at the REPO's root (git's top level, so a workspace or app folder's own
// `node --test`, run from web/ say, lands beside the root's runs; outside git,
// the working directory), a directory that ignores itself (it holds a
// .gitignore of `*`), and keeps the
// newest runs of each lane (a suite's folder and config: KEEP, or the window
// and ten more when that is larger, reserved first; TOTAL in all prunes only
// the rest), and yields one thing to stdout, at the end: the hygiene
// block. A clean run is one line. It never changes the other reporter's
// output, and whatever goes wrong here is a line, never a throw. It changes
// the run's exit code in one case only: a run that executed no test (none
// passed or failed; a file with no test in it is reported as the file, and
// is not a test; a describe() is a suite, and only a test inside it counts)
// exits 1, "no tests ran" — a gate that ran nothing would
// pass anything (keel's lessons 14 and 38). A project with no tests yet
// says so in .keel/keel.json: "tests": { "allowEmpty": true }.
//
// A record: { commit, tree, dirty, machine: { os, arch, cpus }, node, dir,
// config, setting: { env, preload }, filtered?, date, tests: [{ file, name,
// outcome, ms }] } for each top-level test. `dir` is the folder `node --test`
// ran in, relative to the repo's root ('.' at the root); a test's `file` is
// root-relative wherever it ran. `dirty` ignores git-ignored files and keel's machine directories
// (.keel/test-runs, .keel/climb, .keel/tend: the night writes or gathers them).
// `config` is a short stable hash of what makes two runs of one tree differ
// on purpose: NODE_OPTIONS, the run's preloads (--import, --require), and each
// variable .keel/keel.json names in "tests": { "configEnv": [..] }; `setting`
// is what it hashes, never a configEnv value (records are uploaded): each
// configEnv variable as { name, set, hash } (a short sha256 of its value),
// NODE_OPTIONS's value (null when unset; hashed the same way when it looks
// secret: token=, secret=, key=, password=), and the preloads, so a finding's
// run-alone command reproduces it (a set variable as
// NAME="${NAME:?set NAME as it was in the run}", an unset one as env -u NAME). `filtered`
// is true when the run was narrowed (--test-name-pattern, --test-skip-pattern,
// --test-only): a test absent from it was not run, not renamed. `workflow`
// is the GitHub Actions workflow that ran it (none outside Actions), so the
// night can tell its own runs from CI's.
//
// bun test and vitest (keel phase 59) write JUnit XML instead, and the
// ledger reads it after the run, as its own command in the gate:
//
//   keel_status=0; rm -f .keel/test-runs/junit.xml; mkdir -p .keel/test-runs && \
//     bun test --reporter=junit --reporter-outfile=.keel/test-runs/junit.xml || keel_status=$?; \
//     node scripts/keel/test-ledger.mjs --junit .keel/test-runs/junit.xml --runner bun --status $keel_status
//
// (vitest: --reporter=default --reporter=junit --outputFile.junit=<file>.)
// The runner's exit code is kept by `|| keel_status=$?`, so a shell under
// set -e (GitHub's bash -e) still reaches the ledger after a red run, and the
// old file is removed first, so a run that writes none is "no tests ran".
// The record is a node run's, plus `runner` ("bun" or "vitest"; a record
// without one is node's), and `junit`, a short hash of the file's path and
// bytes: the same bytes at the same path again are stale (the runner wrote
// nothing new, as bun does when no test ran) and are not recorded again;
// two packages' identical reports at their own paths are two runs. `node` is the
// version of node that read it; the preloads are none. Each top-level test
// is the file's own testcase, or one top-level describe() with every
// testcase in it (failed if any failed): bun names a testcase's describes in
// its classname, innermost first, escaped twice; vitest in its name,
// outermost first, joined by " > "; a nested <testsuite> is a describe too.
// "No tests ran" is the same rule (a missing file, or one with no testcase
// that passed or failed, is a run of nothing; vitest's testcase for a file
// that would not load is the file's, not a test). The exit code: 1 when no
// tests ran (unless allowEmpty), else --status (the runner's own exit code,
// $?: bun leaves a file that would not load out of its JUnit), else 1 when a
// testcase failed. A file that is not JUnit is 1, never recorded. The runner
// is part of the config hash and the lane, so runs of two runners are never
// compared. .keel/keel.json "tests": { "runner", "junit" } names the runner
// and the file (default .keel/test-runs/junit.xml); the flags win, but a
// runner that contradicts the one the file names is refused (exit 1). A
// describe is recorded with `describe: true`, so its run-alone filter is a
// prefix of its tests' names, and a test's is its whole name.
//
// The analysis is here too, so the reporter and the night's improve.mjs
// (flaky_tests, slow_tests, proofs_hold) read history one way:
//   flaky   a test that both passed and failed on the same clean tree in
//           the same lane (suite folder and config), among the newest `window` runs. A fact, no threshold.
//   slower  a passing test whose time is above factor × the median of its
//           last `window` passing runs on the same machine class and lane,
//           AND more than floorMs above it, so noise on a fast test is not news.
// window 20, factor 2, floorMs 200; .keel/keel.json "tests" overrides each
// (and "allowEmpty", above, and "configEnv").
//
// Adapted ideas, not code: isocan's test profile and shard weights, and
// nerd's pass history (docs/research/2026-10-06-spec-rigor.md).
import { readFile, readdir, writeFile, mkdir, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, relative, resolve, sep, posix, isAbsolute } from 'node:path';
import { platform, arch, availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

export const RUNS = '.keel/test-runs';
/** Runs kept on disk per lane (a suite's folder and config), at least; older ones are pruned. */
export const KEEP = 50;
/** Runs kept on disk in all, whatever the lanes: a safety bound. */
export const TOTAL = 400;
/** The largest window: the total grows with lanes × (window + 10), so it is bounded. */
export const MAX_WINDOW = 200;
export const DEFAULTS = Object.freeze({ window: 20, factor: 2, floorMs: 200 });
export const LABEL = 'keel test ledger';
/** keel's machine directories: the night writes or gathers them, so they never make a tree dirty. */
export const MACHINE_DIRS = Object.freeze([RUNS, '.keel/climb', '.keel/tend']);
/** The test runners the ledger reads: node's own reporter, and bun's and vitest's JUnit. */
export const RUNNERS = Object.freeze(['node', 'bun', 'vitest']);
/** Where a JUnit file is written and read by default: in the ledger's own directory, which ignores itself. */
export const JUNIT = `${RUNS}/junit.xml`;
const OTHER_KEYS = ['allowEmpty', 'configEnv', 'runner', 'junit'];

// ---- config ------------------------------------------------------------------

/** What is wrong with .keel/keel.json "tests": [string]. */
export function testsConfigProblems(config) {
  const t = config?.tests;
  if (t === undefined) return [];
  if (!t || typeof t !== 'object' || Array.isArray(t)) return ['"tests" must be an object of window, factor, floorMs'];
  const out = [];
  for (const k of Object.keys(t)) if (!Object.hasOwn(DEFAULTS, k) && !OTHER_KEYS.includes(k)) out.push(`"tests" has an unknown key ${k} (window, factor, floorMs, ${OTHER_KEYS.join(', ')})`);
  if (t.runner !== undefined && !RUNNERS.includes(t.runner)) out.push(`"tests".runner must be one of ${RUNNERS.join(', ')}`);
  // keel writes it into the gate's shell line as it is (adopt's proposal), so it holds no character a shell reads: never quoted, never wrong.
  if (t.junit !== undefined && !(typeof t.junit === 'string' && /^[A-Za-z0-9_.][A-Za-z0-9_./-]*\.xml$/.test(t.junit) && !t.junit.split('/').includes('..'))) out.push('"tests".junit must be a .xml file inside the repo, relative to its root, of letters, digits, _ . / and - only');
  if (t.configEnv !== undefined && !(Array.isArray(t.configEnv) && t.configEnv.every(v => typeof v === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(v)))) out.push('"tests".configEnv must be a list of environment variable names');
  if (t.allowEmpty !== undefined && typeof t.allowEmpty !== 'boolean') out.push('"tests".allowEmpty must be true or false');
  if (t.window !== undefined && !(Number.isInteger(t.window) && t.window >= 2 && t.window <= MAX_WINDOW)) out.push(`"tests".window must be a whole number of runs, 2 to ${MAX_WINDOW}`);
  if (t.factor !== undefined && !(Number.isFinite(t.factor) && t.factor > 1)) out.push('"tests".factor must be a number above 1');
  if (t.floorMs !== undefined && !(Number.isFinite(t.floorMs) && t.floorMs >= 0)) out.push('"tests".floorMs must be a number of milliseconds, 0 or more');
  return out;
}

/** The ledger's settings for this project; throws on a bad "tests". */
export function testsConfigOf(config) {
  const problems = testsConfigProblems(config);
  if (problems.length) throw new Error(`.keel/keel.json: ${problems.join('; ')}`);
  return { ...DEFAULTS, ...(config?.tests ?? {}) };
}

// ---- history -----------------------------------------------------------------

const isRun = r => r && typeof r === 'object' && typeof r.date === 'string' && Array.isArray(r.tests);

/** Every recorded run under root, oldest first: { runs, skipped }. No directory: no runs. */
export async function readRuns(root, dir = RUNS) {
  let names;
  try { names = (await readdir(join(root, dir))).filter(n => n.endsWith('.json')); }
  catch (e) { if (['ENOENT', 'ENOTDIR'].includes(e.code)) return { runs: [], skipped: 0 }; throw e; }
  const runs = [];
  let skipped = 0;
  for (const name of names) {
    try {
      const r = JSON.parse(await readFile(join(root, dir, name), 'utf8'));
      if (isRun(r)) runs.push({ ...r, id: name.slice(0, -5) }); else skipped++;
    } catch { skipped++; }
  }
  runs.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { runs, skipped };
}

/** The workflows that are keel's own nights; a history of only their runs means CI keeps none. */
export const NIGHT_WORKFLOWS = Object.freeze(['keel-night', 'keel-climb']);
/** True when every run came from a keel night: no CI (or local) run was read. */
export const nightOnly = runs => runs.length > 0 && runs.every(r => NIGHT_WORKFLOWS.includes(r.workflow));
export const NIGHT_ONLY = 'nightly runs only: CI does not upload keel-test-runs';

/** A machine's class: what makes two durations comparable. */
export const machineClass = m => m ? `${m.os}-${m.arch}-${m.cpus}cpu` : 'unknown';
const key = t => `${t.file ?? ''}\u0000${t.name}`;
/** A run's config identity; a record from before configs is its own (null) class. */
const configOf = r => r?.config ?? null;
/** The folder a run's `node --test` ran in, relative to the repo's root; a record from before folders ran at the root. */
const dirOf = r => r?.dir ?? '.';
/** The runner that ran a run: a record without one is node's (the reporter's own records). */
export const runnerOf = r => r?.runner ?? 'node';
/** A run's lane: its suite's folder, its config and its runner (node's lane is as it was). Retention keeps each lane's own newest runs. */
export const laneOf = r => `${dirOf(r)}\u0000${configOf(r)}${runnerOf(r) === 'node' ? '' : `\u0000${runnerOf(r)}`}`;
/** A JUnit describe() recorded as one top-level test: its run-alone filter is a prefix, not a whole name. */
const suiteOf = t => t?.describe === true ? { describe: true } : {};
/** What a finding carries of the run it was seen in, so its run-alone command reproduces that run. */
const seenUnder = r => ({ dir: dirOf(r), config: configOf(r), setting: r?.setting ?? null, ...(runnerOf(r) === 'node' ? {} : { runner: runnerOf(r) }) });
const median = xs => { const s = [...xs].sort((a, b) => a - b), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

/**
 * Flaky: a test with both a pass and a fail on one clean tree in one lane
 * (suite folder and config). A dirty tree, or a mix across different trees,
 * is not flaky: the code moved. A mix across lanes is not either: the
 * setting moved.
 * [{ file, name, tree, passed, failed, dir, config, setting, runs }]
 */
export function flaky(runs) {
  const seen = new Map();
  for (const r of runs) {
    if (r.dirty !== false || !r.tree) continue;
    for (const t of r.tests ?? []) {
      if (!['pass', 'fail'].includes(t.outcome)) continue;
      const k = `${r.tree}\u0000${laneOf(r)}\u0000${key(t)}`;
      const s = seen.get(k) ?? { file: t.file ?? null, name: t.name, ...suiteOf(t), tree: r.tree, passed: 0, failed: 0, ...seenUnder(r) };
      s[t.outcome === 'pass' ? 'passed' : 'failed']++;
      seen.set(k, s);
    }
  }
  return [...seen.values()].filter(s => s.passed && s.failed).map(s => ({ ...s, runs: runs.length }))
    .sort((a, b) => b.failed - a.failed || String(a.file).localeCompare(String(b.file)) || a.name.localeCompare(b.name));
}

/**
 * Slower: in `current` (default the newest run), each passing test above
 * factor × the median of its last `window` passing runs before it on the
 * same machine class, and more than floorMs above that median. A test with
 * fewer than `window` such runs is not judged yet.
 * [{ file, name, ms, median, over, window, machine, dir, config, setting }]
 */
export function slower(runs, { window = DEFAULTS.window, factor = DEFAULTS.factor, floorMs = DEFAULTS.floorMs } = {}, current = runs.at(-1)) {
  if (!current) return [];
  const machine = machineClass(current.machine);
  const before = comparable(runs, current);
  const out = [];
  for (const t of current.tests ?? []) {
    if (t.outcome !== 'pass' || !Number.isFinite(t.ms)) continue;
    const past = [];
    for (let i = before.length - 1; i >= 0 && past.length < window; i--) {
      const p = before[i].tests?.find(x => key(x) === key(t));
      if (p?.outcome === 'pass' && Number.isFinite(p.ms)) past.push(p.ms);
    }
    if (past.length < window) continue;
    const m = median(past);
    if (t.ms > factor * m && t.ms - m > floorMs) out.push({ file: t.file ?? null, name: t.name, ...suiteOf(t), ms: t.ms, median: Math.round(m), over: Math.round(t.ms - m), window, machine, ...seenUnder(current) });
  }
  return out.sort((a, b) => b.over - a.over);
}

/** The runs before `current` that its times are judged against: the same machine class and the same lane (suite folder and config). */
export function comparable(runs, current) {
  const machine = machineClass(current.machine);
  return runs.filter(r => r !== current && r.date <= current.date && machineClass(r.machine) === machine && laneOf(r) === laneOf(current));
}

/**
 * A phase's cited test (`name` is the test's name or a part of it) in `file`:
 * the newest run where it passed or failed, and those outcomes. A run where it
 * was only skipped or todo, or absent from a narrowed run (a targeted
 * --test-name-pattern run), says nothing about it and is passed over. Absent
 * from a full run of the file is `matched: []` (renamed or gone: proof lost);
 * only ever skipped is those skips. No run of it at all: null.
 */
export function lastOutcome(runs, file, name) {
  const want = String(name).toLowerCase();
  let fallback = null;
  for (let i = runs.length - 1; i >= 0; i--) {
    const inFile = (runs[i].tests ?? []).filter(t => t.file === file);
    if (!inFile.length) continue;
    const matched = inFile.filter(t => t.name.toLowerCase() === want || t.name.toLowerCase().includes(want));
    const at = { run: runs[i].id ?? runs[i].date, date: runs[i].date };
    const decided = matched.filter(t => t.outcome === 'pass' || t.outcome === 'fail');
    if (decided.length) return { ...at, matched: decided };
    if (!matched.length && !runs[i].filtered) return fallback ?? { ...at, matched };
    if (matched.length) fallback ??= { ...at, matched };
  }
  return fallback;
}

// ---- the hygiene block -------------------------------------------------------

const RE_SPECIAL = /[.*+?^${}()|[\]\\]/g;
const quote = s => `'${s.replaceAll("'", "'\\''")}'`;

/**
 * The command that runs one test alone as it ran when it was seen: the
 * finding's own setting (each config variable that was set, as
 * `NAME="${NAME:?set NAME as it was in the run}"` since its value is never
 * recorded: it runs when the person's shell has it set, and stops with that
 * message when not; NODE_OPTIONS's
 * own value; each that was unset as `env -u NAME`; then its
 * --import/--require preloads; `preload` is for a finding that carries none),
 * from the folder its suite ran in. `here` is where the command is printed,
 * relative to the repo's root: from anywhere else it first changes to that
 * folder (git's top level, then the suite's folder), and the file is said
 * relative to it.
 */
/** Whether a recorded variable was set: a value (NODE_OPTIONS, or a record from before hashes) or { set: true }. */
const isSet = v => typeof v === 'string' || (v !== null && typeof v === 'object' && v.set === true);

export function aloneCommand(test, preload = [], { here = '.' } = {}) {
  const runner = runnerOf(test);
  const escaped = test.name.replace(RE_SPECIAL, '\\$&');
  // bun and vitest match -t against the full name, describes joined by spaces (bun's with a leading one).
  // A describe is the start of its tests' names; a test is its whole name, so `save` never runs `save draft` too.
  const pattern = runner === 'node' ? `^${escaped}$` : test.describe ? `^ ?${escaped}( |$)` : `^ ?${escaped}$`;
  const dir = test.dir ?? '.';
  const vars = Object.entries(test.setting?.env ?? {});
  // A value is printed for NODE_OPTIONS only (never a secret: one that looks like one is recorded as a hash);
  // any other set variable is taken from the person's shell, or the command stops and says to set it,
  // so a configEnv value never reaches a printed command and the command still runs as printed.
  const env = vars.filter(([, v]) => isSet(v)).map(([k, v]) => k === 'NODE_OPTIONS' && typeof v === 'string' ? `${k}=${quote(v)}` : `${k}="\${${k}?set ${k} as it was in the run}"`);
  const unset = vars.filter(([, v]) => !isSet(v)).map(([k]) => `-u ${k}`);
  const file = test.file ? posix.relative(dir === '.' ? '' : dir, test.file) || test.file : '';
  const run = runner === 'bun' ? ['bun', 'test', file, '-t', quote(pattern)]
    : runner === 'vitest' ? ['npx', 'vitest', 'run', file, '-t', quote(pattern)]
    : ['node', ...(test.setting?.preload ?? preload), '--test', `--test-name-pattern=${quote(pattern)}`, file];
  const command = [...env, ...(unset.length ? ['env', ...unset] : []), ...run].filter(Boolean).join(' ');
  return dir === here ? command : `cd "$(git rev-parse --show-toplevel)"${dir === '.' ? '' : `/${quote(dir)}`} && ${command}`;
}

/** The run's preload flags (--import x, --require x), so a test runs alone as it ran here. */
export function preloads(execArgv = process.execArgv) {
  const out = [];
  for (let i = 0; i < execArgv.length; i++) {
    const a = execArgv[i];
    if (/^--(import|require|loader|experimental-loader)=/.test(a)) out.push(a);
    else if (['--import', '--require', '-r', '--loader', '--experimental-loader'].includes(a) && execArgv[i + 1] !== undefined) out.push(a, execArgv[++i]);
  }
  return out;
}

const shortTree = t => String(t ?? '').slice(0, 7);
const named = t => `${t.file ?? '(no file)'} "${t.name}"`;

/** The block printed at the end of a run: [line]. One line when clean. */
export function hygiene(runs, opts = DEFAULTS, { preload = [], skipped = 0, here = '.' } = {}) {
  const recent = runs.slice(-opts.window);
  const f = flaky(recent), s = slower(runs, opts);
  const of = `${runs.length} run${runs.length === 1 ? '' : 's'} in ${RUNS}${skipped ? `, ${skipped} unreadable` : ''}`;
  if (!f.length && !s.length) return [`${LABEL}: no flaky or slower test (${of}).`];
  const items = f.length + s.length;
  return [
    `${LABEL}: ${items} hygiene item${items === 1 ? '' : 's'} (${of}). Each is work: fix it or file it; never rerun until green.`,
    ...f.flatMap(t => [
      `  flaky   ${named(t)}: passed ${t.passed}, failed ${t.failed} on one clean tree (${shortTree(t.tree)}) in the last ${recent.length} runs`,
      `          ${aloneCommand(t, preload, { here })}`,
    ]),
    ...s.flatMap(t => [
      `  slower  ${named(t)}: ${Math.round(t.ms)} ms against a median of ${t.median} ms over its last ${t.window} passing runs (${t.machine}), +${t.over} ms`,
      `          ${aloneCommand(t, preload, { here })}`,
    ]),
  ];
}

// ---- recording ---------------------------------------------------------------

function gitOut(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 10_000, maxBuffer: 16 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

/** The repo's root (git's top level), so every package's runs land in one ledger; outside git, `cwd`. */
export function rootOf(cwd = process.cwd()) {
  return gitOut(cwd, ['rev-parse', '--show-toplevel'])?.trim() || cwd;
}

/**
 * Where this run happened: commit, tree, dirty, machine, node. Dirty reads
 * the whole repo (from its top), git-ignored files aside (porcelain never
 * lists them) and keel's machine directories aside, and `exclude` (root-relative
 * paths: the JUnit file a run wrote, wherever it was told to).
 */
export function where(cwd = process.cwd(), { exclude = [] } = {}) {
  const commit = gitOut(cwd, ['rev-parse', 'HEAD'])?.trim() || null;
  const tree = commit ? gitOut(cwd, ['rev-parse', 'HEAD^{tree}'])?.trim() || null : null;
  const status = commit ? gitOut(cwd, ['status', '--porcelain', '--', ':/', ...[...MACHINE_DIRS, ...exclude].map(d => `:(top,exclude)${d}`)]) : null;
  return {
    commit, tree, dirty: status === null ? null : status.trim() !== '',
    machine: { os: platform(), arch: arch(), cpus: availableParallelism() },
    node: process.version,
  };
}

/**
 * Write one run, keep the newest `keep` of each lane (a suite's folder and
 * config: one pass of a project with four lanes writes four runs, and each
 * lane needs its own window of history), reserving each lane's newest
 * max(KEEP, window + 10) first, then prune only the rest (unreadable records,
 * and runs past the reserve when `keep` is larger) down to `total` in all
 * (TOTAL, or lanes × (window + 10) when that is larger): many runs of one lane
 * never evict another lane's baseline. Make the directory ignore itself.
 * Returns the file name.
 */
export async function record(root, run, { window = DEFAULTS.window, keep = Math.max(KEEP, window + 10), total } = {}) {
  const dir = join(root, RUNS);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, '.gitignore'), '*\n');
  const name = `${run.date.replaceAll(':', '-').replace('.', '-')}-${process.pid}.json`;
  await writeFile(join(dir, name), `${JSON.stringify(run)}\n`);
  const names = (await readdir(dir)).filter(n => n.endsWith('.json')).sort();
  const lanes = new Map(), drop = new Set();
  for (const n of names) {
    let lane;
    try { lane = laneOf(JSON.parse(await readFile(join(dir, n), 'utf8'))); } catch { continue; } // unreadable: only the total prunes it
    lanes.set(lane, [...(lanes.get(lane) ?? []), n]);
  }
  // Each lane's newest max(KEEP, window + 10) are reserved first: no other lane's runs, however many, evict them.
  const reserve = Math.min(keep, Math.max(KEEP, window + 10)), reserved = new Set();
  for (const ns of lanes.values()) {
    for (const n of ns.slice(0, Math.max(0, ns.length - keep))) drop.add(n);
    for (const n of ns.slice(Math.max(0, ns.length - reserve))) reserved.add(n);
  }
  // The total prunes only the rest (oldest first): it grows with the lanes, and never reaches a reserved run.
  const cap = total ?? Math.max(TOTAL, lanes.size * (window + 10));
  const kept = names.filter(n => !drop.has(n));
  const spare = kept.filter(n => !reserved.has(n));
  for (const n of spare.slice(0, Math.max(0, Math.min(spare.length, kept.length - cap)))) drop.add(n);
  for (const old of drop) await rm(join(dir, old), { force: true });
  return name;
}

async function projectConfig(root) {
  try { return JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8')); } catch { return {}; }
}

/**
 * The run's config identity: a short stable hash of NODE_OPTIONS, the run's
 * preloads, and each variable named in "tests".configEnv (absent and empty
 * differ), and the runner when it is not node (node's hash is as it was).
 * Two runs under different configs never make a test flaky or slower.
 */
export function configHash({ env = process.env, preload = preloads(), configEnv = [], runner = 'node' } = {}) {
  const vars = Object.fromEntries(settingNames(configEnv).map(n => [n, env[n] ?? null]));
  return createHash('sha256').update(JSON.stringify({ vars, preload, ...(runner === 'node' ? {} : { runner }) })).digest('hex').slice(0, 12);
}

const settingNames = configEnv => [...new Set(['NODE_OPTIONS', ...configEnv])].sort();
/** A NODE_OPTIONS that carries something secret-looking (token=, secret=, key=, password=) is hashed like a configEnv variable. */
const SECRETISH = /(token|secret|key|password)=/i;
const sha12 = v => createHash('sha256').update(v).digest('hex').slice(0, 12);
/** A variable recorded without its value: { name, set, hash } (hash null when unset). */
const hidden = (name, v) => ({ name, set: v !== undefined, hash: v === undefined ? null : sha12(v) });

/**
 * What the config hash is a hash of, recorded beside it, never a configEnv
 * value (records are uploaded, and findings print): { env: { NODE_OPTIONS:
 * value or null (or hidden, when it looks secret), NAME: { name, set, hash } },
 * preload }.
 */
export function settingOf({ env = process.env, preload = preloads(), configEnv = [] } = {}) {
  return {
    env: Object.fromEntries(settingNames(configEnv).map(n => {
      const v = env[n];
      if (n === 'NODE_OPTIONS' && !configEnv.includes(n)) return [n, v === undefined ? null : SECRETISH.test(v) ? hidden(n, v) : v];
      return [n, hidden(n, v)];
    })),
    preload,
  };
}

/** Whether a run was narrowed to some of its tests (node's execArgv). */
export const narrowed = (execArgv = process.execArgv) => execArgv.some(a => /^--test-(name-pattern|skip-pattern|only)(=|$)/.test(a));

/** A path with its links resolved (git's top level is resolved; a test file's path may not be). */
const real = p => { try { return realpathSync(p); } catch { return p; } };

/** A top-level entry that is a test file's own (node reports a file with no test in it as the file), not a test. */
export const fileOwn = (root, d) => Boolean(d?.file) && resolve(root, String(d.name)) === d.file;

export const NO_TESTS = `${LABEL}: no tests ran. A gate that ran nothing passes anything, so this run fails. Add a test, or say there are none yet with "tests": { "allowEmpty": true } in .keel/keel.json.`;

/**
 * The zero-tests gate: the line to say and whether the run fails, for a run
 * that executed `ran` tests. allowEmpty is read as written, even beside a bad
 * window or factor, so a typo elsewhere never turns the gate on or off.
 */
export function emptyRun(ran, config) {
  if (ran > 0 || config?.tests?.allowEmpty === true) return null;
  return NO_TESTS;
}

/** An event's outcome: skip, todo, pass or fail. */
const outcomeOf = e => {
  const d = e.data;
  return d.skip !== undefined && d.skip !== false ? 'skip' : d.todo !== undefined && d.todo !== false ? 'todo' : e.type === 'test:pass' ? 'pass' : 'fail';
};

/** Whether an event is a test that executed: a test (never a suite: an empty describe() runs nothing), passed or failed, not a file's own entry. */
export const executed = (cwd, e) => (e.type === 'test:pass' || e.type === 'test:fail') && e.data?.details?.type === 'test'
  && ['pass', 'fail'].includes(outcomeOf(e)) && !fileOwn(cwd, e.data);

/** The reporter: records each top-level test, then yields the hygiene block; a run that executed no test fails. */
export default async function* ledger(source) {
  const cwd = process.cwd();
  const root = rootOf(cwd);
  const tests = [];
  let ran = 0;
  for await (const e of source) {
    if (executed(cwd, e)) ran++;
    if ((e.type !== 'test:pass' && e.type !== 'test:fail') || e.data?.nesting !== 0) continue;
    const d = e.data;
    const outcome = outcomeOf(e);
    tests.push({
      file: d.file ? relative(root, real(d.file)).split(sep).join('/') : null,
      name: String(d.name),
      outcome,
      ms: Math.round((d.details?.duration_ms ?? 0) * 10) / 10,
    });
  }
  const config = await projectConfig(root);
  const empty = emptyRun(ran, config);
  if (empty && !process.exitCode) process.exitCode = 1;
  if (!tests.length) { if (empty) yield `${empty}\n`; return; } // nothing reported: nothing to remember
  try {
    const configEnv = Array.isArray(config?.tests?.configEnv) ? config.tests.configEnv.filter(v => typeof v === 'string') : [];
    const workflow = process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_WORKFLOW ? { workflow: process.env.GITHUB_WORKFLOW } : {};
    const here = relative(root, real(cwd)).split(sep).join('/') || '.';
    const run = { ...where(root), dir: here, config: configHash({ configEnv }), setting: settingOf({ configEnv }), ...(narrowed() ? { filtered: true } : {}), ...workflow, date: new Date().toISOString(), tests };
    const w = config?.tests?.window;
    await record(root, run, { window: Number.isInteger(w) && w >= 2 && w <= MAX_WINDOW ? w : DEFAULTS.window });
    let opts;
    try { opts = testsConfigOf(config); }
    catch (e) { yield `${LABEL}: recorded; not judged: ${e.message}\n`; return; }
    const { runs, skipped } = await readRuns(root);
    yield `${hygiene(runs, opts, { preload: preloads(), skipped, here }).join('\n')}\n`;
  } catch (e) {
    yield `${LABEL}: could not record this run (${String(e?.message ?? e).split('\n')[0]}).\n`;
  } finally {
    if (empty) yield `${empty}\n`;
  }
}

// ---- JUnit: bun test and vitest (phase 59) ----------------------------------

const ENTITIES = Object.freeze({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" });

/** XML text with its entities read: the five named ones and character references; any other stays as written. */
export function xmlText(s) {
  return String(s).replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (m, e) => {
    if (e[0] !== '#') return Object.hasOwn(ENTITIES, e) ? ENTITIES[e] : m;
    const n = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });
}

const XNAME = '[A-Za-z_:][\\w:.-]*';
const OPEN = new RegExp(`<(${XNAME})`, 'y');
const ATTR = new RegExp(`\\s+(${XNAME})\\s*=\\s*(?:"([^"<]*)"|'([^'<]*)')`, 'y');
const OPEN_END = /\s*(\/?)>/y;
const END = new RegExp(`</(${XNAME})\\s*>`, 'y');

/**
 * A small XML reader, enough for JUnit: elements, their attributes (entities
 * read) and children. Text is dropped (a failure's message body is not kept);
 * comments, CDATA, the declaration, processing instructions and a DOCTYPE are
 * skipped. What is not well formed throws: a tag left open, an end tag that
 * does not match, an attribute without a quoted value or given twice, a second
 * root, no root. Returns the root element: { name, attrs, children }.
 */
export function readXml(text) {
  const doc = { name: '#document', attrs: Object.create(null), children: [] };
  const stack = [doc];
  let i = 0;
  const fail = what => { throw new Error(`${what} (at character ${i})`); };
  const past = (end, what) => { const j = text.indexOf(end, i); if (j < 0) fail(`an unterminated ${what}`); i = j + end.length; };
  for (;;) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    i = lt;
    if (text.startsWith('<!--', i)) past('-->', 'comment');
    else if (text.startsWith('<![CDATA[', i)) past(']]>', 'CDATA section');
    else if (text.startsWith('<?', i)) past('?>', 'declaration');
    else if (text.startsWith('<!', i)) {
      const close = text.indexOf('>', i), bracket = text.indexOf('[', i);
      if (close < 0) fail('an unterminated DOCTYPE');
      if (bracket >= 0 && bracket < close) past(']>', 'DOCTYPE'); else i = close + 1;
    } else if (text[i + 1] === '/') {
      END.lastIndex = i;
      const m = END.exec(text);
      if (!m) fail('a malformed end tag');
      const open = stack.at(-1);
      if (stack.length === 1 || open.name !== m[1]) fail(`</${m[1]}> closes ${stack.length === 1 ? 'nothing' : `<${open.name}>`}`);
      stack.pop();
      i = END.lastIndex;
    } else {
      OPEN.lastIndex = i;
      const m = OPEN.exec(text);
      if (!m) fail('a malformed tag');
      const el = { name: m[1], attrs: Object.create(null), children: [] };
      i = OPEN.lastIndex;
      for (;;) {
        ATTR.lastIndex = i;
        const a = ATTR.exec(text);
        if (!a) break;
        if (Object.hasOwn(el.attrs, a[1])) fail(`<${el.name}> repeats ${a[1]}`);
        el.attrs[a[1]] = xmlText(a[2] ?? a[3]);
        i = ATTR.lastIndex;
      }
      OPEN_END.lastIndex = i;
      const c = OPEN_END.exec(text);
      if (!c) fail(`a malformed <${el.name}> (each attribute needs a quoted value)`);
      i = OPEN_END.lastIndex;
      if (stack.length === 1 && doc.children.length) fail('a second root element');
      stack.at(-1).children.push(el);
      if (!c[1]) stack.push(el);
    }
  }
  if (stack.length > 1) fail(`<${stack.at(-1).name}> is never closed`);
  if (!doc.children.length) fail('no root element');
  return doc.children[0];
}

/** The runner a JUnit document came from, by the <testsuites name> each writes ("bun test", "vitest tests"); else null. */
export function junitRunner(root) {
  const name = root?.attrs?.name;
  return name === 'bun test' ? 'bun' : name === 'vitest tests' ? 'vitest' : null;
}

/** A testcase's outcome: fail (a failure or an error), todo (bun's skipped message="TODO"), skip, or pass. */
const caseOutcome = c => {
  if (c.children.some(x => x.name === 'failure' || x.name === 'error')) return 'fail';
  const s = c.children.find(x => x.name === 'skipped');
  return s ? (s.attrs.message === 'TODO' ? 'todo' : 'skip') : 'pass';
};
const msOf = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n * 1000 : 0; };
const casesIn = el => el.children.flatMap(c => c.name === 'testcase' ? [c] : c.name === 'testsuite' ? casesIn(c) : []);

/**
 * Where a testcase sits at the top of its file: { name, describe }, its own
 * name, or its outermost describe's. bun names the describes in classname,
 * innermost first, joined by " > " and escaped twice; vitest in name,
 * outermost first, joined by " > ".
 */
export function topOf(c, runner) {
  const name = c.attrs.name ?? '';
  if (runner === 'bun') {
    const cls = c.attrs.classname ?? '';
    if (!cls) return { name, describe: false };
    const parts = cls.includes(' &gt; ') ? cls.split(' &gt; ') : cls.split(' > ');
    return { name: xmlText(parts.at(-1)), describe: true };
  }
  if (runner === 'vitest') {
    const parts = name.split(' > ');
    if (parts.length > 1) return { name: parts[0], describe: true };
  }
  return { name, describe: false };
}

/** One top-level test's outcome from its testcases': any fail fails it, else any pass passes it. */
const groupOutcome = os => os.length === 1 ? os[0] : os.includes('fail') ? 'fail' : os.includes('pass') ? 'pass' : os.every(o => o === 'todo') ? 'todo' : 'skip';

/**
 * A JUnit document's top-level tests, as the node reporter records them:
 * { tests: [{ file, name, outcome, ms }], ran, failed }. `ran` counts the
 * testcases that passed or failed (a file's own entry, vitest's for a file
 * that would not load, aside: it is recorded as the file, not a test),
 * `failed` every testcase that failed. A nested <testsuite> is a describe.
 * `fileOf` turns a JUnit path into the record's (root-relative).
 */
export function junitTests(root, runner, fileOf = f => f) {
  if (root?.name !== 'testsuites' && root?.name !== 'testsuite') throw new Error(`its root is <${root?.name}>, not <testsuites>`);
  const suites = root.name === 'testsuite' ? [root] : root.children.filter(e => e.name === 'testsuite');
  const tests = [];
  let ran = 0, failed = 0;
  const count = (c, own) => {
    const o = caseOutcome(c);
    if (o === 'fail') failed++;
    if (!own && (o === 'pass' || o === 'fail')) ran++;
    return o;
  };
  for (const suite of suites) {
    const groups = new Map();
    const add = (key, file, name) => groups.get(key) ?? groups.set(key, { file, name, describe: key.split('\u0000')[1] === 'd', outcomes: [], ms: 0 }).get(key);
    for (const child of suite.children) {
      const raw = child.attrs.file ?? suite.attrs.file ?? suite.attrs.name ?? '';
      const file = raw ? fileOf(raw) : null;
      if (child.name === 'testcase') {
        // vitest's entry for a file that would not load: named for the file, and failed. A test that merely shares
        // its file's name and passes is a test (bun writes no such entry at all).
        const own = runner === 'vitest' && Boolean(raw) && child.attrs.name === raw && caseOutcome(child) === 'fail';
        const top = own ? { name: file, describe: false } : topOf(child, runner);
        const g = add(`${file}\u0000${top.describe ? 'd' : 't'}\u0000${top.name}`, file, top.name);
        g.outcomes.push(count(child, own));
        g.ms += msOf(child.attrs.time);
      } else if (child.name === 'testsuite') {
        const name = child.attrs.name ?? '';
        const g = add(`${file}\u0000d\u0000${name}`, file, name);
        for (const c of casesIn(child)) { g.outcomes.push(count(c, false)); g.ms += msOf(c.attrs.time); }
        if (child.attrs.time !== undefined) g.ms = msOf(child.attrs.time);
      }
    }
    for (const g of groups.values()) {
      if (g.outcomes.length) tests.push({ file: g.file, name: g.name, ...(g.describe ? { describe: true } : {}), outcome: groupOutcome(g.outcomes), ms: Math.round(g.ms * 10) / 10 });
    }
  }
  return { tests, ran, failed };
}

/**
 * Read a JUnit file into the ledger, as the reporter records a node run, and
 * say the hygiene block: { lines, code }. `junit` is relative to `cwd` (the
 * folder the tests ran in), else .keel/keel.json "tests".junit, else JUNIT,
 * relative to the repo's root; `runner` is bun or vitest, else "tests".runner,
 * else what the file says; `status` is the runner's own exit code, or null.
 */
export async function junitRun({ junit, runner, status = null, cwd = process.cwd() } = {}) {
  const root = rootOf(cwd);
  const config = await projectConfig(root);
  const lines = [];
  const at = junit !== undefined ? resolve(cwd, junit) : resolve(root, typeof config?.tests?.junit === 'string' ? config.tests.junit : JUNIT);
  const inside = relative(root, at).split(sep).join('/');
  const shown = inside && !inside.startsWith('../') && !isAbsolute(inside) ? inside : at;
  const done = (ran, failed) => {
    const empty = emptyRun(ran, config);
    if (empty) lines.push(empty);
    return { lines, code: empty ? 1 : status || (failed ? 1 : 0) };
  };
  let xml;
  try { xml = await readFile(at, 'utf8'); }
  catch (e) {
    if (e.code !== 'ENOENT') { lines.push(`${LABEL}: could not read ${shown} (${e.code ?? e.message}); nothing recorded.`); return { lines, code: status || 1 }; }
    lines.push(`${LABEL}: no JUnit file at ${shown}: the tests did not run, or wrote it elsewhere.`);
    return done(0, 0);
  }
  let parsed, kind;
  try {
    const doc = readXml(xml);
    const configured = RUNNERS.includes(config?.tests?.runner) && config.tests.runner !== 'node' ? config.tests.runner : undefined;
    const says = junitRunner(doc);
    kind = runner ?? configured ?? says;
    // A file that names its runner is read as that runner's: a stale "tests".runner or a wrong --runner would misread every name.
    if (says && kind !== says) throw new Error(`it is ${says}'s JUnit, but the runner is ${kind} (${runner ? '--runner' : '.keel/keel.json "tests".runner'}); say ${says}`);
    if (kind !== 'bun' && kind !== 'vitest') throw new Error('its runner is not known: pass --runner bun or --runner vitest');
    parsed = junitTests(doc, kind, f => relative(root, real(resolve(cwd, f))).split(sep).join('/'));
  } catch (e) {
    lines.push(`${LABEL}: ${shown} is not JUnit the ledger can read (${e.message}); nothing recorded.`);
    return { lines, code: status || 1 };
  }
  // The file's own identity: its path and its bytes. Two packages' identical reports at their own paths are two runs;
  // the same bytes at the same path again are one report read twice (stale).
  const hash = sha12(`${shown}\u0000${xml}`);
  let history = null;
  try { history = await readRuns(root); } catch { /* record() below says what is wrong with the directory */ }
  if (history?.runs.some(r => r.junit === hash)) {
    lines.push(`${LABEL}: ${shown} is one already recorded: the tests wrote no new one (bun writes none when no test ran), so this run is not counted.`);
    return done(0, 0);
  }
  if (!parsed.tests.length) return done(parsed.ran, parsed.failed); // nothing reported: nothing to remember
  try {
    const configEnv = Array.isArray(config?.tests?.configEnv) ? config.tests.configEnv.filter(v => typeof v === 'string') : [];
    const workflow = process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_WORKFLOW ? { workflow: process.env.GITHUB_WORKFLOW } : {};
    const here = relative(root, real(cwd)).split(sep).join('/') || '.';
    const run = {
      ...where(root, { exclude: shown === at ? [] : [shown] }), runner: kind, dir: here,
      config: configHash({ configEnv, preload: [], runner: kind }), setting: settingOf({ configEnv, preload: [] }),
      ...workflow, junit: hash, date: new Date().toISOString(), tests: parsed.tests,
    };
    const w = config?.tests?.window;
    await record(root, run, { window: Number.isInteger(w) && w >= 2 && w <= MAX_WINDOW ? w : DEFAULTS.window });
    let opts;
    try { opts = testsConfigOf(config); }
    catch (e) { lines.push(`${LABEL}: recorded; not judged: ${e.message}`); return done(parsed.ran, parsed.failed); }
    const { runs, skipped } = await readRuns(root);
    lines.push(...hygiene(runs, opts, { preload: [], skipped, here }));
  } catch (e) {
    lines.push(`${LABEL}: could not record this run (${String(e?.message ?? e).split('\n')[0]}).`);
  }
  return done(parsed.ran, parsed.failed);
}

export const USAGE = 'usage: node scripts/keel/test-ledger.mjs --junit <file> [--runner bun|vitest] [--status <exit code>]';

/** The command line's { junit, runner?, status? }; throws on anything else. */
export function junitArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const eq = argv[i].indexOf('=');
    const flag = eq > 0 ? argv[i].slice(0, eq) : argv[i];
    const value = () => { const v = eq > 0 ? argv[i].slice(eq + 1) : argv[++i]; if (v === undefined || v === '') throw new Error(`${flag} needs a value`); return v; };
    if (flag === '--junit') out.junit = value();
    else if (flag === '--runner') out.runner = value();
    else if (flag === '--status') out.status = value();
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (out.junit === undefined) throw new Error('--junit <file> is required');
  if (out.runner !== undefined && out.runner !== 'bun' && out.runner !== 'vitest') throw new Error('--runner must be bun or vitest');
  if (out.status !== undefined) {
    if (!/^\d{1,3}$/.test(out.status) || Number(out.status) > 255) throw new Error('--status must be an exit code, 0 to 255');
    out.status = Number(out.status);
  }
  return out;
}

// Run as a command (node scripts/keel/test-ledger.mjs --junit …), never when node loads it as a reporter.
if (process.argv[1] && real(resolve(process.argv[1])) === real(fileURLToPath(import.meta.url))) {
  let args = null;
  try { args = junitArgs(process.argv.slice(2)); }
  catch (e) { process.stderr.write(`${LABEL}: ${e.message}\n${USAGE}\n`); process.exitCode = 2; }
  if (args) {
    const { lines, code } = await junitRun(args);
    process.stdout.write(`${lines.join('\n')}\n`);
    process.exitCode = code;
  }
}
