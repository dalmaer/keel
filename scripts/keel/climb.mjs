// keel climb (keel practice `climb`; managed: keel render rewrites it). A
// climb night sends an agent to improve one number while the project sleeps;
// this script is every number it reports and every keep-or-revert it makes,
// so the numbers are the script's, never the agent's (keel phase 35;
// docs/research/2026-10-06-climb-nights.md). Deterministic, no model, no
// dependency: Node built-ins, git and gh (KEEL_GH stands in for gh).
//
//   node scripts/keel/climb.mjs config                      the climb config, validated
//   node scripts/keel/climb.mjs pick [--date d] [--force]   tonight's job, or why none
//   node scripts/keel/climb.mjs measure <job> [--runs k] [--baseline]
//   node scripts/keel/climb.mjs compare [--base r] [--candidate r] [--rounds n] [--runs k] [--decide] [--final]
//   node scripts/keel/climb.mjs revert --why "<why>"        drop HEAD's change, logged
//   node scripts/keel/climb.mjs settle                      drop what no compare kept
//   node scripts/keel/climb.mjs prove-steady --test "<file>: <name>" [--runs n] [--decide]
//   node scripts/keel/climb.mjs harmless --path p --why "<why>"   a changed build output, explained
//   node scripts/keel/climb.mjs guard [--base r] [--job j]  the gate, no test dropped, the job's own guard
//   node scripts/keel/climb.mjs report [--input f] [--body f] [--state] [--issue f]
//
// Every subcommand takes --json. Exit: 0 ok; 1 ran and found a failure (a
// failing gate, a dropped test); 2 usage, a bad config, or an instrument that
// cannot tell (no ledger, gh unreadable, a suite that fails while measured):
// a measure that cannot run says so, never a number (lesson 6).
//
// The protocol (.agents/climb/PROTOCOL.md) in five verbs: `measure --baseline`
// opens the night's record (.keel/climb/night.json, a directory that ignores
// itself); `compare --decide` runs base and candidate alternately, keeps a
// change that beats the base by the margin in every round (and writes its
// numbers into the commit) or resets it; `guard` runs the gate and checks,
// with the test ledger (scripts/keel/test-ledger.mjs), that every test the
// base ran still ran; `report` writes the PR body through
// scripts/keel/pr-body.mjs and the one line the night's history keeps.
//
// Phase 36 adds two jobs on the same protocol. `hygiene` climbs the test
// ledger's flaky count: its change is judged by `prove-steady` (the one test,
// N times on one clean worktree, N passes and no fail), never by timing, and
// its guard refuses a diff that only raises a timeout or adds a retry in the
// flaky test's file (lesson 40). With nothing proven, `report --issue` writes
// the issue the workflow files instead of a PR. `build-time` times
// "climb".build; its guard hashes "climb".buildOutput on base and candidate,
// and every changed path needs a `harmless` reason, which the PR's Merge
// danger names. A job whose last three PRs were closed unmerged retires
// itself: pick skips it until the owner removes it or reopens one.
import { readFile, readdir, writeFile, mkdir, mkdtemp, rm, symlink, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, isAbsolute, normalize, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { gateEnv, healthDirOf, cells, isMain, rootOf, main, climbRetiring } from './lib.mjs';
import { readRuns, flaky, testsConfigOf, aloneCommand, KEEP } from './test-ledger.mjs';
import { prBody } from './pr-body.mjs';

export const STATE = '.keel/climb.json';
export const NIGHT_DIR = '.keel/climb';
export const NIGHT = `${NIGHT_DIR}/night.json`;
export const PREFIX = 'keel-climb/';
export const CHECK = 'npm run check';
/** A weekly climb runs on this UTC weekday (1, Monday). */
export const WEEKLY_DAY = 1;
export const DEFAULTS = Object.freeze({ minutes: 45, schedule: 'nightly', margin: 0.05, attempts: 10, runs: 5, compareRuns: 3, rounds: 2 });
const LIMITS = Object.freeze({ minutes: [5, 180], margin: [0.01, 0.5], attempts: [1, 50] });
/** Misses in a row that end a night (protocol rule 5). */
export const MISSES = 3;

/**
 * The jobs. Each: its number, which way is better, the health-page measures
 * that send a night to it first (the night's improve.mjs ids), how its number
 * is read (`timed`: the command, timed; `ledger`: the test ledger's flaky
 * count), and the command it times. `first`: chosen ahead of every other job
 * when its measure is outside. `onlyWhenOutside`: never chosen by rotation
 * (with nothing outside there is nothing to do). Adding a job is a practice change.
 */
export const JOBS = Object.freeze({
  'test-time': Object.freeze({
    number: "the test command's wall time",
    better: 'lower',
    measures: Object.freeze(['slow_tests']),
    kind: 'timed',
    command: config => config?.climb?.testCommand ?? 'npm test',
  }),
  // A flaky test is a red waiting to happen: it goes before any number gets faster.
  hygiene: Object.freeze({
    number: 'the flaky tests the test ledger names',
    better: 'lower',
    measures: Object.freeze(['flaky_tests']),
    kind: 'ledger',
    first: true,
    onlyWhenOutside: true,
    command: () => 'the test ledger (.keel/test-runs)',
  }),
  'build-time': Object.freeze({
    number: "the build command's wall time",
    better: 'lower',
    measures: Object.freeze(['build_time']),
    kind: 'timed',
    command: config => config?.climb?.build,
  }),
});
/** prove-steady's default runs, and its most (the ledger keeps KEEP runs). */
export const STEADY_RUNS = 20;

export class ClimbError extends Error {
  constructor(message, exitCode = 2) { super(`climb: ${message}`); this.exitCode = exitCode; }
}

// ---- config ------------------------------------------------------------------

/** What is wrong with .keel/keel.json "climb": [string]. Absent is fine: climb is off. */
export function climbProblems(config) {
  const c = config?.climb;
  if (c === undefined) return [];
  if (!c || typeof c !== 'object' || Array.isArray(c)) return ['"climb" must be an object: { jobs, budget: { minutes }, schedule, margin, attempts }'];
  const out = [];
  const known = ['jobs', 'budget', 'schedule', 'margin', 'attempts', 'testCommand', 'build', 'buildOutput', 'buildBudgetMs'];
  for (const k of Object.keys(c)) if (!known.includes(k)) out.push(`"climb" has an unknown key ${k} (${known.join(', ')})`);
  if (!Array.isArray(c.jobs) || !c.jobs.length) out.push(`"climb".jobs must list one job or more (${Object.keys(JOBS).join(', ')})`);
  else {
    for (const j of c.jobs) if (!Object.hasOwn(JOBS, j)) out.push(`"climb".jobs names an unknown job ${JSON.stringify(j)} (known: ${Object.keys(JOBS).join(', ')})`);
    if (new Set(c.jobs).size !== c.jobs.length) out.push('"climb".jobs names a job twice');
  }
  const between = (v, [lo, hi]) => Number.isFinite(v) && v >= lo && v <= hi;
  if (c.budget !== undefined) {
    if (!c.budget || typeof c.budget !== 'object' || Array.isArray(c.budget) || Object.keys(c.budget).some(k => k !== 'minutes')) out.push('"climb".budget must be { minutes }');
    else if (!(Number.isInteger(c.budget.minutes) && between(c.budget.minutes, LIMITS.minutes))) out.push(`"climb".budget.minutes must be a whole number from ${LIMITS.minutes[0]} to ${LIMITS.minutes[1]} (got ${JSON.stringify(c.budget.minutes)})`);
  }
  if (c.schedule !== undefined && !['nightly', 'weekly'].includes(c.schedule)) out.push(`"climb".schedule must be "nightly" or "weekly" (got ${JSON.stringify(c.schedule)})`);
  if (c.margin !== undefined && !between(c.margin, LIMITS.margin)) out.push(`"climb".margin must be a fraction from ${LIMITS.margin[0]} to ${LIMITS.margin[1]} (got ${JSON.stringify(c.margin)}; 0.05 is 5%)`);
  if (c.attempts !== undefined && !(Number.isInteger(c.attempts) && between(c.attempts, LIMITS.attempts))) out.push(`"climb".attempts must be a whole number from ${LIMITS.attempts[0]} to ${LIMITS.attempts[1]}`);
  if (c.testCommand !== undefined && (typeof c.testCommand !== 'string' || !c.testCommand.trim())) out.push('"climb".testCommand must be a non-empty shell command');
  if (c.build !== undefined && (typeof c.build !== 'string' || !c.build.trim())) out.push('"climb".build must be a non-empty shell command');
  if (c.buildOutput !== undefined && !safeRelative(c.buildOutput)) out.push('"climb".buildOutput must be a path inside the repo (a file or directory the build writes), not absolute and never ..');
  if (c.buildBudgetMs !== undefined && !(Number.isInteger(c.buildBudgetMs) && c.buildBudgetMs > 0)) out.push('"climb".buildBudgetMs must be a whole number of milliseconds above 0');
  if (Array.isArray(c.jobs) && c.jobs.includes('build-time')) {
    if (c.build === undefined) out.push('"climb".jobs names build-time, so "climb".build must name the build command');
    if (c.buildOutput === undefined) out.push('"climb".jobs names build-time, so "climb".buildOutput must name what the build writes (its guard hashes it)');
  }
  return out;
}

/** The climb settings, defaults filled in; null when climb is off. A bad "climb" throws (exit 2). */
export function climbConfigOf(config) {
  const problems = climbProblems(config);
  if (problems.length) throw new ClimbError(`.keel/keel.json: ${problems.join('; ')}`);
  const c = config?.climb;
  if (c === undefined) return null;
  return {
    jobs: [...c.jobs],
    minutes: c.budget?.minutes ?? DEFAULTS.minutes,
    schedule: c.schedule ?? DEFAULTS.schedule,
    margin: c.margin ?? DEFAULTS.margin,
    attempts: c.attempts ?? DEFAULTS.attempts,
    testCommand: JOBS['test-time'].command(config),
    ...(c.build !== undefined ? { build: c.build } : {}),
    ...(c.buildOutput !== undefined ? { buildOutput: normalize(c.buildOutput).replace(/[\\/]+$/, '') } : {}),
    ...(c.buildBudgetMs !== undefined ? { buildBudgetMs: c.buildBudgetMs } : {}),
  };
}

function safeRelative(p) {
  if (typeof p !== 'string' || !p.trim() || isAbsolute(p)) return false;
  const n = normalize(p);
  return n !== '.' && n !== '..' && !n.startsWith(`..${sep}`) && !n.split(/[\\/]/).includes('..');
}

const on = config => climbConfigOf(config) ?? (() => { throw new ClimbError('climb is off: .keel/keel.json has no "climb"'); })();

// ---- small tools ---------------------------------------------------------------

function git(cwd, args, { allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new ClimbError(`git ${args[0]}: ${r.error.message}`);
  if (r.status !== 0 && !allowFail) throw new ClimbError(`git ${args.join(' ')} exited ${r.status}: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
  return allowFail ? r : r.stdout.trim();
}
const sha = (root, ref) => git(root, ['rev-parse', '--verify', `${ref}^{commit}`]);
const isAncestor = (root, a, b) => git(root, ['merge-base', '--is-ancestor', a, b], { allowFail: true }).status === 0;
const median = xs => { const s = [...xs].sort((a, b) => a - b), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
export const fmtMs = ms => (ms >= 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
export const fmtPct = f => `${f < 0 ? '−' : '+'}${Math.abs(Math.round(f * 1000) / 10)}%`;
const today = () => new Date().toISOString().slice(0, 10);

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw new ClimbError(`${path}: ${e.message}`); }
}
const readConfig = async root => (await readJson(join(root, '.keel/keel.json'))) ?? {};

async function readNight(root, path = join(root, NIGHT)) {
  return readJson(path);
}
async function writeNight(root, night) {
  await mkdir(join(root, NIGHT_DIR), { recursive: true });
  await writeFile(join(root, NIGHT_DIR, '.gitignore'), '*\n');
  await writeFile(join(root, NIGHT), `${JSON.stringify(night, null, 2)}\n`);
}

// ---- pick ----------------------------------------------------------------------

/** The newest health page's measure rows: { file, rows: [{ id, value, bound, op, state }] }, or null. */
export async function newestHealth(root, config) {
  const dir = healthDirOf(config);
  let names;
  try { names = (await readdir(join(root, dir))).filter(n => /^\d{4}-\d{2}-\d{2}\.md$/.test(n)).sort(); }
  catch (e) { if (['ENOENT', 'ENOTDIR'].includes(e.code)) return null; throw e; }
  if (!names.length) return null;
  const file = `${dir}/${names.at(-1)}`;
  return { file, rows: healthRows(await readFile(join(root, file), 'utf8')) };
}

/** The measure rows of a health page's table: `| \`id\` — what | value | ≤ bound | state | detail |`. */
export function healthRows(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!/^\|\s*`[a-z_]+`/.test(line)) continue;
    const [measure, value, bound, state] = cells(line);
    const id = /^`([a-z_]+)`/.exec(measure)?.[1];
    const b = /^([≤≥])\s*(-?[\d.]+)/.exec(bound ?? '');
    if (!id || !b) continue;
    out.push({ id, value: /^-?[\d.]+$/.test(value) ? Number(value) : null, bound: Number(b[2]), op: b[1], state });
  }
  return out;
}

/** How far outside its bound a row is, relative; broken is worst of all. */
const distance = r => r.state === 'broken' ? Infinity : ((r.op === '≤' ? r.value - r.bound : r.bound - r.value) / Math.max(Math.abs(r.bound), 1));

/** The open keel-climb/<job>/ PRs' jobs, from gh's headRefName list. */
export const waitingJobs = heads => new Set(heads.map(h => (h.startsWith(PREFIX) ? h.slice(PREFIX.length).split('/')[0] : null)).filter(Boolean));

/**
 * Tonight's job, pure: the job tied to the health page's worst measure
 * outside its bound (a `first` job, hygiene, ahead of every other; then broken
 * first), else the next in rotation after `last`, skipping a job that only
 * runs for its measure; a job with an open PR waits, and a retiring job
 * (its last three PRs closed unmerged) is skipped. { job, by, why } or { job: null, reason }.
 */
export function choose({ jobs, rows = [], waiting = new Set(), last = null, table = JOBS, retiring = new Set() }) {
  const free = job => !waiting.has(job) && !retiring.has(job);
  const tied = [];
  for (const r of rows) {
    if (!['outside', 'broken'].includes(r.state)) continue;
    for (const job of jobs) if (table[job]?.measures.includes(r.id) && free(job)) tied.push({ job, r });
  }
  tied.sort((a, b) => (Number(Boolean(table[b.job]?.first)) - Number(Boolean(table[a.job]?.first))) || distance(b.r) - distance(a.r));
  if (tied.length) {
    const { job, r } = tied[0];
    return { job, by: 'measure', why: `${r.id} is ${r.state} on the newest health page (${r.value ?? '—'} against ${r.op} ${r.bound})` };
  }
  const start = jobs.indexOf(last) + 1;
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[(start + i) % jobs.length];
    if (free(job) && !table[job]?.onlyWhenOutside) return { job, by: 'rotation', why: last ? `rotation, after ${last}; no measure tied to a job is outside its bound` : 'rotation, the first job; no measure tied to a job is outside its bound' };
  }
  const why = jobs.map(j => `${j} (${waiting.has(j) ? `an open ${PREFIX}${j}/ PR` : retiring.has(j) ? 'retiring: its last three PRs were closed unmerged' : 'only when its measure is outside'})`);
  return { job: null, reason: waiting.size && jobs.every(j => waiting.has(j)) ? `every job waits for its open ${PREFIX}<job>/ PR: ${jobs.join(', ')}` : `no job can run tonight: ${why.join(', ')}` };
}

function ghPrs(root, env, state, fields) {
  const gh = env.KEEL_GH || 'gh';
  const r = spawnSync(gh, ['pr', 'list', '--state', state, '--json', fields, '--limit', '200'], { cwd: root, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new ClimbError(`cannot read ${state} PRs (${gh}): ${r.error.message}; pick never guesses`);
  if (r.status !== 0) throw new ClimbError(`gh pr list --state ${state} exited ${r.status}: ${(r.stderr || r.stdout).trim().split('\n')[0]}; pick never guesses that none are ${state}`);
  let data;
  try { data = JSON.parse(r.stdout); } catch { throw new ClimbError(`gh pr list --state ${state} did not print JSON`); }
  if (!Array.isArray(data)) throw new ClimbError(`gh pr list --state ${state} did not print a JSON array`);
  return data;
}
const openHeads = (root, env) => ghPrs(root, env, 'open', 'headRefName').map(p => p?.headRefName).filter(h => typeof h === 'string');

export async function pick({ root, config, env = process.env, date = today(), force = false }) {
  const c = climbConfigOf(config);
  if (!c) return { job: null, date, reason: 'climb is off: .keel/keel.json has no "climb"' };
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (c.schedule === 'weekly' && !force && day !== WEEKLY_DAY) return { job: null, date, reason: 'not tonight: climb is weekly, on Mondays (UTC)' };
  const waiting = waitingJobs(openHeads(root, env));
  // Three closed unmerged in a row: the job proposes its own retirement (the health page says so) and waits for the owner.
  const retired = climbRetiring(ghPrs(root, env, 'closed', 'headRefName,number,createdAt,mergedAt'), c.jobs);
  const retiring = new Set(retired.map(r => r.job));
  const health = await newestHealth(root, config);
  const last = (await readJson(join(root, STATE)))?.last?.job ?? null;
  const chosen = choose({ jobs: c.jobs, rows: health?.rows ?? [], waiting, last, retiring });
  const out = { ...chosen, date, health: health?.file ?? null, waiting: [...waiting].filter(j => c.jobs.includes(j)), retiring: retired, minutes: c.minutes, margin: c.margin, attempts: c.attempts };
  if (chosen.job) Object.assign(out, { branch: `${PREFIX}${chosen.job}/${date}`, command: JOBS[chosen.job].command(config), number: JOBS[chosen.job].number });
  return out;
}

// ---- measure -------------------------------------------------------------------

/** Run the job's command `runs` times in `cwd`: { median, spread, times }. A failing run throws (exit 2): a failing suite has no time. */
export function measureIn(cwd, { config, job, runs, env = process.env }) {
  if (!Object.hasOwn(JOBS, job)) throw new ClimbError(`unknown job ${JSON.stringify(job)} (known: ${Object.keys(JOBS).join(', ')})`);
  if (JOBS[job].kind !== 'timed') throw new ClimbError(`${job} is not timed: its number is ${JOBS[job].number}, and its changes are judged by prove-steady`);
  const command = JOBS[job].command(config);
  if (!command) throw new ClimbError(`${job} has no command to time (.keel/keel.json "climb")`);
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    // Never a test runner's context (lesson 14); the project's own env over it.
    const r = spawnSync(command, { cwd, shell: true, env: gateEnv(env, config), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 60 * 60_000 });
    const ms = performance.now() - t0;
    if (r.error) throw new ClimbError(`could not run \`${command}\`: ${r.error.message}`);
    if (r.status !== 0) throw new ClimbError(`\`${command}\` failed (exit ${r.status ?? r.signal}) in ${cwd}: a failing suite has no time. ${`${r.stdout}\n${r.stderr}`.trim().split('\n').slice(-3).join(' | ')}`);
    times.push(Math.round(ms * 10) / 10);
  }
  return { job, command, runs, times, median: median(times), spread: Math.max(...times) - Math.min(...times) };
}

/**
 * The run's preload flags (--import x, --require x) from the test command, or
 * from package.json's scripts.test when the command is `npm test`: a test run
 * alone must load what the suite loads (keel's hermetic helper, say).
 */
export async function preloadsOf(root, config) {
  let source = JOBS['test-time'].command(config);
  if (/^npm\s+(?:test|t|run\s+test)\b/.test(source.trim())) source = (await readJson(join(root, 'package.json')))?.scripts?.test ?? '';
  const out = [];
  for (const m of source.matchAll(/(?:^|\s)(--(?:import|require|loader|experimental-loader)|-r)(?:=|\s+)(['"]?)([^\s'"]+)\2/g)) out.push(`${m[1]}=${m[3]}`.replace(/^-r=/, '--require='));
  return out;
}

/** The hygiene job's number: the flaky tests in the newest window of the ledger's runs. No runs: it cannot tell (exit 2). */
export async function flakyNow(root, config) {
  const { runs } = await readRuns(root);
  if (!runs.length) throw new ClimbError('no test ledger runs in .keel/test-runs: hygiene cannot tell which test is flaky (the climb workflow gathers the keel-test-runs artifacts first)');
  const opts = testsConfigOf(config);
  const recent = runs.slice(-opts.window);
  const preload = await preloadsOf(root, config);
  const found = flaky(recent).map(({ file, name, tree, passed, failed }) => ({ file, name, tree, passed, failed, alone: aloneCommand({ file, name }, preload) }));
  return { job: 'hygiene', command: JOBS.hygiene.command(config), runs: recent.length, times: [found.length], median: found.length, spread: 0, flaky: found };
}

export async function measure({ root, config, env, job, runs = DEFAULTS.runs, baseline = false }) {
  const c = on(config);
  if (!Object.hasOwn(JOBS, job)) throw new ClimbError(`unknown job ${JSON.stringify(job)} (known: ${Object.keys(JOBS).join(', ')})`);
  const m = JOBS[job].kind === 'ledger' ? await flakyNow(root, config) : measureIn(root, { config, job, runs, env });
  if (baseline) {
    await writeNight(root, {
      job, date: today(), started: new Date().toISOString(), base: sha(root, 'HEAD'),
      command: m.command, margin: c.margin, attempts: c.attempts, rounds: DEFAULTS.rounds,
      baseline: { median: m.median, spread: m.spread, times: m.times },
      ...(m.flaky ? { flaky: m.flaky } : {}),
      tried: [], gate: null, final: null,
    });
  }
  return m;
}

// ---- compare -------------------------------------------------------------------

async function worktree(root, dir, ref) {
  git(root, ['worktree', 'add', '--detach', '--quiet', dir, ref]);
  // The candidate adds no dependency (protocol rule 4), so both sides share the root's install.
  if (existsSync(join(root, 'node_modules')) && !existsSync(join(dir, 'node_modules'))) await symlink(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
}

/**
 * Base and candidate, alternately, `rounds` times (two or more: one round is
 * noise), each side `runs` runs per round. Keep only when the candidate beats
 * the base by the margin in every round. Worktrees go under the OS temp
 * directory, outside the repo's tree, and are removed after.
 */
export async function compareRefs({ root, config, env, base, candidate, rounds = DEFAULTS.rounds, runs = DEFAULTS.compareRuns, margin, job }) {
  if (!Number.isInteger(rounds) || rounds < 2) throw new ClimbError('compare needs two alternated rounds or more: one round is noise, not a gain');
  if (!Number.isInteger(runs) || runs < 1) throw new ClimbError('--runs must be a whole number, 1 or more');
  const shas = { base: sha(root, base), candidate: sha(root, candidate) };
  if (shas.base === shas.candidate) return { ...shas, same: true, rounds: [], verdict: 'same', why: 'base and candidate are the same commit' };
  const tmp = await mkdtemp(join(tmpdir(), 'keel-climb-'));
  const dirs = { base: join(tmp, 'base'), candidate: join(tmp, 'candidate') };
  const out = [];
  try {
    await worktree(root, dirs.base, shas.base);
    await worktree(root, dirs.candidate, shas.candidate);
    for (let r = 0; r < rounds; r++) {
      const m = {};
      // Alternate who goes first, so neither side always runs on a warmer machine.
      for (const side of r % 2 === 0 ? ['base', 'candidate'] : ['candidate', 'base']) m[side] = measureIn(dirs[side], { config, job, runs, env });
      out.push({ round: r + 1, base: m.base.median, candidate: m.candidate.median, baseSpread: m.base.spread, candidateSpread: m.candidate.spread, change: m.candidate.median / m.base.median - 1 });
    }
  } finally {
    for (const d of Object.values(dirs)) git(root, ['worktree', 'remove', '--force', d], { allowFail: true });
    git(root, ['worktree', 'prune'], { allowFail: true });
    await rm(tmp, { recursive: true, force: true });
  }
  const better = JOBS[job].better === 'lower' ? x => x.change <= -margin : x => x.change >= margin;
  const miss = out.find(x => !better(x));
  const verdict = miss ? 'revert' : 'keep';
  const changes = out.map(x => fmtPct(x.change)).join(', ');
  const why = miss
    ? `round ${miss.round}: ${fmtPct(miss.change)}, inside the ${Math.round(margin * 100)}% margin (rounds: ${changes})`
    : `beat the base by ${Math.round(margin * 100)}% or more in all ${rounds} rounds (${changes})`;
  return { ...shas, rounds: out, verdict, why };
}

/** The night's stopping rule: the attempt limit, or MISSES reverts in a row. */
export function stopping(night) {
  const tried = night?.tried ?? [];
  if (tried.length >= (night?.attempts ?? DEFAULTS.attempts)) return `the attempt limit (${night.attempts}) is reached`;
  const tail = tried.slice(-MISSES);
  if (tail.length === MISSES && tail.every(a => a.verdict === 'revert')) return `${MISSES} misses in a row`;
  return null;
}

const numbersLine = (job, res, margin) => `climb ${job}: ${res.rounds.map(x => `${fmtMs(x.base)} → ${fmtMs(x.candidate)} (${fmtPct(x.change)})`).join('; ')}; margin ${Math.round(margin * 100)}%, base ${res.base.slice(0, 7)}`;

/** Reset to `target`, never below the night's base, and only from a tree with no uncommitted tracked change. */
function resetTo(root, night, target) {
  if (!isAncestor(root, night.base, target)) throw new ClimbError(`will not reset to ${target.slice(0, 7)}: it is before the night's base ${night.base.slice(0, 7)}`);
  if (!isAncestor(root, target, 'HEAD')) throw new ClimbError(`will not reset to ${target.slice(0, 7)}: it is not under HEAD`);
  git(root, ['reset', '--quiet', '--hard', target]);
}

export async function compare({ root, config, env, base, candidate = 'HEAD', rounds, runs, decide = false, final = false, what }) {
  const c = on(config);
  const night = await readNight(root);
  if ((decide || final) && !night) throw new ClimbError(`no night is open (${NIGHT}): run measure <job> --baseline first`);
  const job = night?.job ?? c.jobs[0];
  if (JOBS[job]?.kind !== 'timed') {
    // Hygiene has no timing to compare: its changes were each proven steady already.
    if (final) { night.final = null; await writeNight(root, night); return { job, same: true, rounds: [], verdict: 'same', why: `${job} is judged by prove-steady, not timed` }; }
    throw new ClimbError(`${job} is judged by prove-steady, not by timing: node scripts/keel/climb.mjs prove-steady --test "<file>: <name>" --decide`);
  }
  if (final) { base ??= night.base; candidate = 'HEAD'; }
  base ??= 'HEAD~1';
  const res = await compareRefs({ root, config, env, base, candidate, rounds, runs, margin: c.margin, job });
  const subject = what ?? git(root, ['log', '-1', '--format=%s', res.candidate]);
  const out = { job, what: subject, ...res };
  if (final) {
    night.final = res.same ? null : { base: res.base, candidate: res.candidate, rounds: res.rounds };
    await writeNight(root, night);
    return out;
  }
  if (decide) {
    if (res.same) throw new ClimbError('nothing to decide: the candidate is the base');
    if (res.candidate !== sha(root, 'HEAD')) throw new ClimbError('--decide judges HEAD: commit the change, then compare --base <its parent> --decide');
    const dirty = git(root, ['status', '--porcelain', '--untracked-files=no']);
    if (dirty) throw new ClimbError('uncommitted changes: commit the one change first (protocol rule 2)');
    let kept = res.candidate;
    if (res.verdict === 'keep') {
      // The numbers go in the commit, from here: never typed by the agent.
      const message = git(root, ['log', '-1', '--format=%B', 'HEAD']).trimEnd();
      git(root, ['commit', '--quiet', '--amend', '-m', `${message}\n\n${numbersLine(job, res, c.margin)}`]);
      kept = sha(root, 'HEAD');
    } else {
      resetTo(root, night, res.base);
    }
    night.tried.push({ what: subject, verdict: res.verdict, why: res.why, base: res.base, candidate: res.verdict === 'keep' ? kept : res.candidate, rounds: res.rounds, at: new Date().toISOString() });
    await writeNight(root, night);
    out.candidate = kept;
    out.head = sha(root, 'HEAD');
    out.stop = stopping(night);
  }
  return out;
}

/** Drop HEAD's change (a gate that failed, a test the change broke), logged with why. */
export async function revert({ root, config, why, what }) {
  on(config);
  const night = await readNight(root);
  if (!night) throw new ClimbError(`no night is open (${NIGHT})`);
  if (!why?.trim()) throw new ClimbError('revert needs --why "<what went wrong>"');
  const head = sha(root, 'HEAD');
  if (head === night.base || night.tried.some(a => a.verdict === 'keep' && a.candidate === head)) throw new ClimbError('HEAD is the base or a kept change; revert drops only an undecided commit');
  const parent = sha(root, 'HEAD~1');
  const subject = what ?? git(root, ['log', '-1', '--format=%s', 'HEAD']);
  resetTo(root, night, parent);
  night.tried.push({ what: subject, verdict: 'revert', why: why.trim(), base: parent, candidate: head, rounds: [], at: new Date().toISOString() });
  await writeNight(root, night);
  return { what: subject, verdict: 'revert', why: why.trim(), head: parent, stop: stopping(night) };
}

/** The last decided state: the newest kept change, or the night's base. Everything after it (an undecided commit, a half-made edit) goes. */
export async function settle({ root, config }) {
  on(config);
  const night = await readNight(root);
  if (!night) throw new ClimbError(`no night is open (${NIGHT})`);
  const target = night.tried.filter(a => a.verdict === 'keep').at(-1)?.candidate ?? night.base;
  const head = sha(root, 'HEAD');
  const dirty = git(root, ['status', '--porcelain']);
  if (head === target && !dirty) return { head, dropped: false };
  if (!isAncestor(root, target, head)) throw new ClimbError(`HEAD ${head.slice(0, 7)} is not on top of the last decision ${target.slice(0, 7)}: the branch moved outside climb.mjs`);
  git(root, ['reset', '--quiet', '--hard', target]);
  git(root, ['clean', '--quiet', '-fd']); // never -x: ignored files (.keel/climb, the ledger) stay
  return { head: target, dropped: true, from: head };
}

// ---- hygiene: prove-steady and the diff that only waits longer -------------------

/** "<file>: <name>" → { file, name }. */
export function parseTest(spec) {
  const m = /^(.+?):\s+(.+)$/.exec(String(spec ?? '').trim());
  if (!m) throw new ClimbError('--test is "<file>: <name>", the test ledger\'s file and the test\'s full name (tests/acme.test.mjs: acme adds)');
  return { file: m[1].trim(), name: m[2].trim() };
}

/**
 * A changed line that waits longer or tries again rather than fixing a cause
 * (lesson 40): a timeout or deadline number, a setTimeout, `{ timeout: … }`,
 * a retry or another attempt, a longer sleep or delay.
 */
export const WAITS = /timeout|deadline|\bretr(?:y|ies|ied|ying)\b|\battempts?\b|\bsleep\b|\bdelay\b/i;
/**
 * Lines that change no behaviour on their own: blank, a comment, braces and
 * brackets, `try {`, `} catch … {`, `} finally {`, `break;`, `continue;`. A
 * retry wrapped around a test is a retry line and these; it is still a retry.
 */
const NEUTRAL = /^(?:$|\/\/|\/\*|\*|#|[{}()[\];,\s]+$|try\s*\{$|\}?\s*catch\b.*\{\s*\}?;?$|\}?\s*finally\s*\{$|break;?$|continue;?$)/;

/**
 * The changed lines of a `git diff -U0` of one file: [{ sign, line, text, wait }].
 * Neutral lines are left out, and a line removed and added with the same text
 * (moved, or re-indented inside a new loop) cancels out: it did not change. A
 * line edited in place (the i-th removed and i-th added of a hunk) is judged
 * by what changed in it: `() =>` becoming `{ timeout: 9000 }, () =>`, or
 * 100 becoming 5000 on a timeout's line, is a wait; anything else is not.
 */
export function changedLines(diff) {
  const hunks = [];
  let oldLine = 0, newLine = 0;
  for (const raw of diff.split('\n')) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h) { oldLine = Number(h[1]); newLine = Number(h[2]); hunks.push([]); continue; }
    if (raw.startsWith('+++') || raw.startsWith('---') || !hunks.length) continue;
    const sign = raw[0];
    if (sign !== '+' && sign !== '-') continue;
    const text = raw.slice(1).trim();
    const line = sign === '+' ? newLine++ : oldLine++;
    if (!NEUTRAL.test(text)) hunks.at(-1).push({ sign, line, text });
  }
  const all = hunks.flat();
  const removed = new Map();
  for (const l of all) if (l.sign === '-') removed.set(l.text, (removed.get(l.text) ?? 0) + 1);
  const moved = new Map();
  for (const l of all) if (l.sign === '+' && (removed.get(l.text) ?? 0) > (moved.get(l.text) ?? 0)) moved.set(l.text, (moved.get(l.text) ?? 0) + 1);
  const left = { '+': new Map(moved), '-': new Map(moved) };
  const kept = l => {
    const n = left[l.sign].get(l.text) ?? 0;
    if (n > 0) { left[l.sign].set(l.text, n - 1); return false; }
    return true;
  };
  const out = [];
  for (const hunk of hunks) {
    const lines = hunk.filter(kept).map(l => ({ ...l, wait: WAITS.test(l.text) }));
    const rem = lines.filter(l => l.sign === '-'), add = lines.filter(l => l.sign === '+');
    for (let i = 0; i < Math.min(rem.length, add.length); i++) {
      const [a, b] = [rem[i].text, add[i].text];
      let p = 0;
      while (p < a.length && p < b.length && a[p] === b[p]) p++;
      let q = 0;
      while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
      const mid = [a.slice(p, a.length - q), b.slice(p, b.length - q)];
      const numbers = mid.every(m => /^[\d\s_.,]*$/.test(m)) && (rem[i].wait || add[i].wait);
      rem[i].wait = add[i].wait = numbers || mid.some(m => WAITS.test(m));
    }
    out.push(...lines);
  }
  return out;
}

/**
 * The hygiene guard, per file: a diff that, in the flaky test's file, only
 * touches a timeout or a retry is refused, naming the line; a timeout changed
 * beside a real change passes, and says so for the person. { file, refused, line, message } or null.
 */
export function waitsOnly(file, diff) {
  const lines = changedLines(diff);
  const waits = lines.filter(l => l.wait);
  if (!waits.length) return null;
  const at = waits.find(l => l.sign === '+') ?? waits[0];
  const where = `${file}:${at.line} \`${at.text.slice(0, 120)}\``;
  const others = lines.length - waits.length;
  if (!others) return { file, refused: true, line: at.line, message: `${where}: in the flaky test's file this diff only changes a timeout or a retry, which hides the flake and does not fix it (lesson 40); find the cause` };
  return { file, refused: false, line: at.line, message: `${where} changes a timeout or a retry beside ${others} other changed line${others === 1 ? '' : 's'}: a real fix that also changes a timeout passes, so check the timeout is not the fix` };
}

/** The hygiene guard over base..head for the flaky tests' files: { refused: [..], noted: [..] }. */
export function hygieneCheck(root, base, head, files) {
  const refused = [], noted = [];
  for (const file of [...new Set(files)].filter(Boolean).sort()) {
    const diff = git(root, ['diff', '-U0', '--no-color', '--no-ext-diff', base, head, '--', file]);
    const w = waitsOnly(file, diff);
    if (w) (w.refused ? refused : noted).push(w);
  }
  return { refused, noted };
}

const nightTestFiles = (night, extra = []) => [...(night?.flaky ?? []).map(t => t.file), ...(night?.tried ?? []).map(a => a.test?.file), ...extra].filter(Boolean);

/**
 * Run one test `runs` times on one clean worktree of `candidate`, through the
 * test ledger as the reporter: steady only with `runs` passes and no fail. A
 * test that never ran (a wrong name) cannot be told, and says so (exit 2).
 */
export async function steadyIn(root, { config, env = process.env, candidate, test: t, runs }) {
  const tmp = await mkdtemp(join(tmpdir(), 'keel-climb-steady-'));
  const dir = join(tmp, 'candidate');
  const preload = await preloadsOf(root, config);
  const pattern = `^${t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
  let ran = 0, firstFail = null;
  try {
    await worktree(root, dir, candidate);
    if (!existsSync(join(dir, 'scripts/keel/test-ledger.mjs'))) throw new ClimbError('prove-steady runs the test through scripts/keel/test-ledger.mjs, and the candidate has none (the night practice ships it)');
    if (!existsSync(join(dir, t.file))) throw new ClimbError(`${t.file} is not in ${candidate.slice(0, 7)}: --test names the ledger's file, from the repo's root`);
    if (git(dir, ['status', '--porcelain', '--untracked-files=no'])) throw new ClimbError('the candidate\'s worktree is not clean');
    for (let i = 0; i < runs; i++) {
      const r = spawnSync(process.execPath, [...preload, '--test', `--test-name-pattern=${pattern}`, '--test-reporter=./scripts/keel/test-ledger.mjs', '--test-reporter-destination=stdout', t.file],
        { cwd: dir, env: gateEnv(env, config), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60_000 });
      if (r.error) throw new ClimbError(`could not run ${t.file}: ${r.error.message}`);
      ran++;
      if (r.status !== 0) { firstFail = { run: i + 1, out: `${r.stdout}\n${r.stderr}`.trim().split('\n').slice(-3).join(' | ') }; break; }
    }
    const recorded = (await readRuns(dir)).runs.filter(r => r.commit === candidate);
    if (recorded.length < ran) throw new ClimbError(`the test ledger recorded ${recorded.length} of ${ran} runs: prove-steady cannot tell`);
    let passed = 0, failed = 0;
    for (const r of recorded) for (const x of r.tests ?? []) if (x.file === t.file && x.name === t.name) { if (x.outcome === 'pass') passed++; else if (x.outcome === 'fail') failed++; }
    if (!passed && !failed) throw new ClimbError(`${t.file} "${t.name}" never ran in ${ran} run${ran === 1 ? '' : 's'}: is the name the test's full top-level name? prove-steady cannot tell`);
    if (!firstFail && failed) firstFail = { run: null, out: '' };
    const tree = git(dir, ['rev-parse', 'HEAD^{tree}']);
    return { test: t, candidate, tree, runs, ran, passed, failed, steady: passed === runs && failed === 0, firstFail, preload };
  } finally {
    git(root, ['worktree', 'remove', '--force', dir], { allowFail: true });
    git(root, ['worktree', 'prune'], { allowFail: true });
    await rm(tmp, { recursive: true, force: true });
  }
}

const steadyLine = s => `${s.test.file} "${s.test.name}" passed ${s.passed} of ${s.runs} on one clean tree ${s.tree.slice(0, 7)}`;

export async function proveSteady({ root, config, env, test: spec, runs = STEADY_RUNS, decide = false, candidate = 'HEAD' }) {
  on(config);
  const t = parseTest(spec);
  if (!Number.isInteger(runs) || runs < 1 || runs > KEEP) throw new ClimbError(`--runs must be a whole number from 1 to ${KEEP} (the ledger keeps ${KEEP} runs)`);
  const night = decide ? await readNight(root) : null;
  if (decide) {
    if (!night) throw new ClimbError(`no night is open (${NIGHT}): run measure hygiene --baseline first`);
    if (night.job !== 'hygiene') throw new ClimbError(`tonight's job is ${night.job}: its changes are judged by compare --decide`);
    if (sha(root, candidate) !== sha(root, 'HEAD')) throw new ClimbError('--decide judges HEAD: commit the fix, then prove-steady --decide');
    if (git(root, ['status', '--porcelain', '--untracked-files=no'])) throw new ClimbError('uncommitted changes: commit the one change first (protocol rule 2)');
  }
  const cand = sha(root, candidate);
  const subject = git(root, ['log', '-1', '--format=%s', cand]);
  if (decide) {
    const base = sha(root, 'HEAD~1');
    const check = hygieneCheck(root, base, cand, nightTestFiles(night, [t.file]));
    if (check.refused.length) {
      resetTo(root, night, base);
      const why = check.refused.map(r => r.message).join('; ');
      night.tried.push({ what: subject, verdict: 'revert', why, base, candidate: cand, rounds: [], test: t, at: new Date().toISOString() });
      await writeNight(root, night);
      return { what: subject, test: t, steady: false, verdict: 'revert', why, refused: check.refused, head: sha(root, 'HEAD'), stop: stopping(night) };
    }
  }
  const s = await steadyIn(root, { config, env, candidate: cand, test: t, runs });
  const why = s.steady ? steadyLine(s) : `${s.test.file} "${s.test.name}" failed${s.firstFail?.run ? ` at run ${s.firstFail.run}` : ''} of ${runs} (passed ${s.passed}, failed ${s.failed}) on one clean tree ${s.tree.slice(0, 7)}${s.firstFail?.out ? `: ${s.firstFail.out}` : ''}`;
  const out = { what: subject, test: t, candidate: cand, tree: s.tree, runs, passed: s.passed, failed: s.failed, steady: s.steady, verdict: s.steady ? 'keep' : 'revert', why };
  if (!decide) return out;
  const base = sha(root, 'HEAD~1');
  let kept = cand;
  if (s.steady) {
    const message = git(root, ['log', '-1', '--format=%B', 'HEAD']).trimEnd();
    git(root, ['commit', '--quiet', '--amend', '-m', `${message}\n\nclimb hygiene: ${steadyLine(s)}; base ${base.slice(0, 7)}`]);
    kept = sha(root, 'HEAD');
  } else {
    resetTo(root, night, base);
  }
  night.tried.push({ what: subject, verdict: out.verdict, why, base, candidate: kept, rounds: [], test: t, runs, passed: s.passed, failed: s.failed, tree: s.tree, at: new Date().toISOString() });
  await writeNight(root, night);
  return { ...out, candidate: kept, head: sha(root, 'HEAD'), stop: stopping(night) };
}

// ---- build-time: the output, byte for byte -----------------------------------------

/** Every file under `rel` in `dir` (a file or a directory), by sha-256: Map(path → hash). Absent: null. */
export async function hashOutput(dir, rel) {
  const out = new Map();
  let st;
  try { st = await stat(join(dir, rel)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const walk = async p => {
    const s = await stat(join(dir, p));
    if (s.isDirectory()) { for (const n of (await readdir(join(dir, p))).sort()) await walk(`${p}/${n}`); }
    else if (s.isFile()) out.set(p, createHash('sha256').update(await readFile(join(dir, p))).digest('hex'));
  };
  if (st.isDirectory() || st.isFile()) await walk(rel.split(sep).join('/'));
  return out;
}

/** The paths whose bytes differ between two hashed outputs: [{ path, how: changed|added|removed }]. */
export function outputChanges(base, candidate) {
  const out = [];
  for (const [p, h] of candidate) if (!base.has(p)) out.push({ path: p, how: 'added' }); else if (base.get(p) !== h) out.push({ path: p, how: 'changed' });
  for (const p of base.keys()) if (!candidate.has(p)) out.push({ path: p, how: 'removed' });
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Build base and candidate, each in its own worktree, and hash "climb".buildOutput: { files, changes }. */
export async function buildChanges(root, { config, env = process.env, base, candidate }) {
  const c = climbConfigOf(config);
  if (!c?.build || !c?.buildOutput) throw new ClimbError('the build-time guard needs "climb".build and "climb".buildOutput');
  const tmp = await mkdtemp(join(tmpdir(), 'keel-climb-build-'));
  const hashes = {};
  try {
    for (const [side, ref] of [['base', base], ['candidate', candidate]]) {
      const dir = join(tmp, side);
      await worktree(root, dir, ref);
      const r = spawnSync(c.build, { cwd: dir, shell: true, env: gateEnv(env, config), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 60 * 60_000 });
      if (r.error || r.status !== 0) throw new ClimbError(`\`${c.build}\` failed on the ${side} ${ref.slice(0, 7)} (exit ${r.status ?? r.error?.message}): the guard has no output to compare`);
      hashes[side] = await hashOutput(dir, c.buildOutput);
      if (!hashes[side]) throw new ClimbError(`\`${c.build}\` wrote nothing at ${c.buildOutput} on the ${side} ${ref.slice(0, 7)}: is "climb".buildOutput what the build writes?`);
    }
  } finally {
    for (const side of ['base', 'candidate']) git(root, ['worktree', 'remove', '--force', join(tmp, side)], { allowFail: true });
    git(root, ['worktree', 'prune'], { allowFail: true });
    await rm(tmp, { recursive: true, force: true });
  }
  return { output: c.buildOutput, files: hashes.candidate.size, changes: outputChanges(hashes.base, hashes.candidate) };
}

/** Record why a changed build output path is harmless; the PR's Merge danger names it for the person. */
export async function harmless({ root, config, path, why }) {
  on(config);
  const night = await readNight(root);
  if (!night) throw new ClimbError(`no night is open (${NIGHT})`);
  if (!path?.trim() || !why?.trim()) throw new ClimbError('harmless needs --path <changed output path> and --why "<why the difference is harmless>"');
  night.harmless = { ...(night.harmless ?? {}), [path.trim()]: why.trim() };
  await writeNight(root, night);
  return { path: path.trim(), why: why.trim(), harmless: night.harmless };
}

// ---- guard ---------------------------------------------------------------------

const key = t => `${t.file ?? ''}\u0000${t.name}`;
const ran = t => t.outcome === 'pass' || t.outcome === 'fail';

/** Tests that ran in `base` and did not run in `candidate`: [{ file, name, how: dropped|skipped }]. */
export function missingTests(base, candidate) {
  const now = new Map((candidate.tests ?? []).map(t => [key(t), t]));
  const out = [];
  for (const t of base.tests ?? []) {
    if (!ran(t)) continue;
    const c = now.get(key(t));
    if (!c) out.push({ file: t.file ?? null, name: t.name, how: 'dropped' });
    else if (!ran(c)) out.push({ file: t.file ?? null, name: t.name, how: c.outcome === 'todo' ? 'skipped (todo)' : 'skipped' });
  }
  return out;
}

const newestFor = (runs, commit) => runs.filter(r => r.commit === commit).at(-1) ?? null;

export async function guard({ root, config, env = process.env, base, job }) {
  on(config);
  const night = await readNight(root);
  base ??= night?.base;
  job ??= night?.job;
  if (!base) throw new ClimbError('guard needs --base <ref> (or an open night)');
  if (job !== undefined && !Object.hasOwn(JOBS, job)) throw new ClimbError(`unknown job ${JSON.stringify(job)} (known: ${Object.keys(JOBS).join(', ')})`);
  const head = sha(root, 'HEAD'), b = sha(root, base);
  if (head === b) return { ok: true, skipped: true, line: 'nothing kept: HEAD is the base, so there is nothing to guard', problems: [] };
  const extra = {};
  if (job === 'hygiene') {
    // Lesson 40: a longer wait or a retry around the flaky test is not a fix.
    if (!night?.flaky) throw new ClimbError('guard --job hygiene needs the night\'s record of the flaky tests (measure hygiene --baseline)');
    const check = hygieneCheck(root, b, head, nightTestFiles(night));
    if (check.refused.length) return { ok: false, job, refused: check.refused, problems: check.refused.map(r => r.message) };
    extra.noted = check.noted;
    if (night) night.hygieneNotes = check.noted.map(n => n.message);
  }
  if (job === 'build-time') {
    // The build's output byte for byte, or a reason per changed path that the PR names for the person.
    const built = await buildChanges(root, { config, env, base: b, candidate: head });
    const reasons = night?.harmless ?? {};
    const unexplained = built.changes.filter(x => !reasons[x.path]?.trim?.());
    if (unexplained.length) return { ok: false, job, build: built, problems: unexplained.map(x => `build output ${x.how}: ${x.path} differs from the base ${b.slice(0, 7)}'s and has no harmless reason (climb.mjs harmless --path ${x.path} --why "<why>"), so the change is not the same build`) };
    extra.build = built;
    if (night) night.build = { output: built.output, files: built.files, changes: built.changes.map(x => ({ ...x, why: reasons[x.path] })) };
  }
  const gate = config.check ?? CHECK;
  const r = spawnSync(gate, { cwd: root, shell: true, env: gateEnv(env, config), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 60 * 60_000 });
  if (r.error) throw new ClimbError(`could not run the gate \`${gate}\`: ${r.error.message}`);
  if (r.status !== 0) return { ok: false, gate, problems: [`the gate \`${gate}\` failed (exit ${r.status ?? r.signal}) on ${head.slice(0, 7)}`] };
  const cand = newestFor((await readRuns(root)).runs, head);
  if (!cand) throw new ClimbError(`the gate \`${gate}\` recorded no test ledger run for ${head.slice(0, 7)}: add scripts/keel/test-ledger.mjs as a second reporter to the test script; without it guard cannot tell a dropped test`);
  let baseRun = newestFor((await readRuns(root)).runs, b);
  if (!baseRun) {
    // The base's names, from its own run of the test command, in a worktree outside the tree.
    const tmp = await mkdtemp(join(tmpdir(), 'keel-climb-guard-'));
    const dir = join(tmp, 'base');
    try {
      await worktree(root, dir, b);
      const command = JOBS['test-time'].command(config);
      const t = spawnSync(command, { cwd: dir, shell: true, env: gateEnv(env, config), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 60 * 60_000 });
      if (t.error || t.status !== 0) throw new ClimbError(`the base ${b.slice(0, 7)}'s \`${command}\` did not pass (exit ${t.status}); guard has no base to compare against`);
      baseRun = newestFor((await readRuns(dir)).runs, b);
    } finally {
      git(root, ['worktree', 'remove', '--force', dir], { allowFail: true });
      git(root, ['worktree', 'prune'], { allowFail: true });
      await rm(tmp, { recursive: true, force: true });
    }
    if (!baseRun) throw new ClimbError(`the base ${b.slice(0, 7)} recorded no test ledger run: guard cannot tell a dropped test without one`);
  }
  const missing = missingTests(baseRun, cand);
  const count = (cand.tests ?? []).filter(ran).length;
  if (missing.length) return { ok: false, gate, missing, problems: missing.map(m => `${m.how}: ${m.file ?? '(no file)'} "${m.name}" ran in the base ${b.slice(0, 7)} and not in ${head.slice(0, 7)}`) };
  const line = `\`${gate}\` exit 0 on ${head.slice(0, 7)}; ${count} tests ran, none dropped or skipped against the base ${b.slice(0, 7)} (the test ledger)`;
  if (night) { night.gate = line; await writeNight(root, night); }
  return { ok: true, gate, line, problems: [], ...(job ? { job } : {}), ...extra };
}

// ---- report --------------------------------------------------------------------

/** The Real surfaces the kept changes touch: a workflow, or a published file. */
export function surfacesOf(files, pkg) {
  const out = new Set();
  if (files.some(f => f.startsWith('.github/workflows/'))) out.add('workflow shell');
  const shipped = Array.isArray(pkg?.files) ? pkg.files.map(f => f.replace(/^\.\//, '')) : [];
  if (pkg && files.some(f => f === 'package.json' || shipped.some(s => f === s || f.startsWith(s.endsWith('/') ? s : `${s}/`)))) out.add('published package');
  return [...out];
}

/** The PR body's input (scripts/keel/pr-body.mjs) and the night's line, from the night's record. */
export function reportOf(night, { files = [], pkg = null, now = new Date() } = {}) {
  const kept = night.tried.filter(a => a.verdict === 'keep');
  const reverted = night.tried.filter(a => a.verdict !== 'keep');
  const minutes = Math.max(0, Math.round((now - new Date(night.started)) / 60_000));
  const pctMargin = `${Math.round(night.margin * 100)}%`;
  if (!kept.length) {
    const none = night.job === 'hygiene' ? 'none proven steady' : `none beat the noise (margin ${pctMargin})`;
    const tried = night.tried.length ? `${night.tried.length} tried, ${none}` : 'nothing was tried';
    return { kept: 0, tried: night.tried.length, minutes, line: `climb ${night.job} ${night.date}: kept nothing; ${tried}; ${minutes} min`, input: null };
  }
  if (night.job === 'hygiene') return hygieneReport(night, { kept, reverted, minutes, files, pkg });
  const before = night.final ? mean(night.final.rounds.map(r => r.base)) : night.baseline.median;
  const after = night.final ? mean(night.final.rounds.map(r => r.candidate)) : kept.at(-1).rounds.length ? mean(kept.at(-1).rounds.map(r => r.candidate)) : night.baseline.median;
  const change = after / before - 1;
  const how = night.final ? `the night's base against its last commit, ${night.final.rounds.length} alternated rounds` : 'the baseline against the last kept change';
  const line = `climb ${night.job} ${night.date}: kept ${kept.length} of ${night.tried.length} tried; \`${night.command}\` ${fmtMs(before)} → ${fmtMs(after)} (${fmtPct(change)}); ${minutes} min`;
  const input = {
    summary: {
      lead: `climb ${night.job}, ${night.date}: ${kept.length} kept of ${night.tried.length} tried, each measured against noise (margin ${pctMargin}, alternated rounds).`,
      table: {
        head: ['Number', 'Before', 'After', 'Change'],
        rows: [[`\`${night.command}\` wall time, median (${how})`, fmtMs(before), fmtMs(after), fmtPct(change)]],
      },
    },
    evidence: {
      gate: night.gate ?? 'not run: guard did not record a gate line',
      columns: ['Base, median per round', 'Candidate, median per round'],
      rows: kept.map(a => ({ what: `${a.what} (${a.candidate.slice(0, 7)})`, before: a.rounds.map(r => fmtMs(r.base)).join(', '), after: `${a.rounds.map(r => fmtMs(r.candidate)).join(', ')} (${a.rounds.map(r => fmtPct(r.change)).join(', ')})` })),
    },
    danger: {
      door: 'two-way',
      why: 'code changes only, one commit each with its numbers; reverting the merge restores the project as it was',
      surfaces: surfacesOf(files, pkg),
      // build-time: each build output path that differs from the base's, with the reason it is harmless.
      ...(night.build?.changes?.length ? { changed: night.build.changes.map(x => ({ path: `${x.path} (${x.how})`, why: x.why ?? 'no reason recorded' })), changedLead: `The build's output (${night.build.output}) differs from the base's; each path with why it is harmless, for the person to judge:` } : {}),
    },
    notes: [
      ...(night.build && !night.build.changes?.length ? [`The build's output (${night.build.output}, ${night.build.files} files) is byte-identical to the base's (sha-256 of every file).`] : []),
      reverted.length ? `Tried and reverted:\n\n${reverted.map(a => `- ${a.what}: ${a.why}`).join('\n')}` : 'Nothing was tried and reverted.',
      `Every number here is scripts/keel/climb.mjs's (\`${night.command}\`, base and candidate run alternately in one job), never the agent's own timing. Baseline: ${fmtMs(night.baseline.median)}, spread ${fmtMs(night.baseline.spread)} over ${night.baseline.times.length} runs. ${minutes} min. Nothing here merges without a person.`,
    ],
  };
  return { kept: kept.length, tried: night.tried.length, minutes, line, input };
}

const named = t => `${t.file ?? '(no file)'} "${t.name}"`;
const sameTest = (a, b) => a && b && a.file === b.file && a.name === b.name;

/** A hygiene night's PR body input: the flaky tests before, those proven steady, and each fix's runs. */
function hygieneReport(night, { kept, reverted, minutes, files, pkg }) {
  const flakyBefore = night.flaky ?? [];
  const fixed = flakyBefore.filter(t => kept.some(a => sameTest(a.test, t)));
  const before = flakyBefore.length, after = before - fixed.length;
  const line = `climb hygiene ${night.date}: kept ${kept.length} of ${night.tried.length} tried; flaky tests ${before} → ${after} (each fix passed every run of prove-steady); ${minutes} min`;
  const input = {
    summary: {
      lead: `climb hygiene, ${night.date}: ${kept.length} fix${kept.length === 1 ? '' : 'es'} kept of ${night.tried.length} tried, each proven by the one test passing every run on one clean tree.`,
      table: {
        head: ['Flaky test (the test ledger)', 'Before', 'After'],
        rows: flakyBefore.map(t => [named(t), `passed ${t.passed}, failed ${t.failed} on ${String(t.tree).slice(0, 7)}`, fixed.includes(t) ? 'steady (prove-steady)' : 'still flaky']),
      },
    },
    evidence: {
      gate: night.gate ?? 'not run: guard did not record a gate line',
      columns: ['Test', 'prove-steady'],
      rows: kept.map(a => ({ what: `${a.what} (${a.candidate.slice(0, 7)})`, before: a.test ? named(a.test) : '—', after: `passed ${a.passed} of ${a.runs}, failed ${a.failed}, on one clean tree ${String(a.tree ?? '').slice(0, 7)}` })),
    },
    danger: {
      door: 'two-way',
      why: 'code changes only, one commit each with its runs; reverting the merge restores the project as it was',
      surfaces: surfacesOf(files, pkg),
    },
    notes: [
      ...(night.hygieneNotes?.length ? [`Read these: a timeout or a retry changed beside the fix.\n\n${night.hygieneNotes.map(n => `- ${n}`).join('\n')}`] : []),
      reverted.length ? `Tried and reverted:\n\n${reverted.map(a => `- ${a.what}: ${a.why}`).join('\n')}` : 'Nothing was tried and reverted.',
      `Every count here is scripts/keel/climb.mjs's: prove-steady ran the test alone, through the test ledger, on a fresh worktree of each fix; no timeout was raised and no retry added as the fix (guard). ${minutes} min. Nothing here merges without a person.`,
    ],
  };
  return { kept: kept.length, tried: night.tried.length, minutes, line, input };
}

/**
 * The issue a hygiene night files when it proved nothing: the flaky test, the
 * ledger's evidence, the command to run it alone, and what was tried. null
 * when the night is not hygiene, kept something, or had no flaky test.
 */
export function issueOf(night, { minutes = 0 } = {}) {
  if (night.job !== 'hygiene' || night.tried.some(a => a.verdict === 'keep') || !night.flaky?.length) return null;
  const t = night.flaky[0];
  const title = `Flaky test: ${named(t)}`;
  const body = [
    `keel climb hygiene, ${night.date}: the cause of this flaky test was not found within the budget (${minutes} min), so no pull request was opened. A person takes it from here: fix the cause, never a longer timeout or a retry (lesson 40).`, '',
    '## Evidence (the test ledger)', '',
    '| Test | Clean tree | Passed | Failed |', '| --- | --- | --- | --- |',
    ...night.flaky.map(x => `| ${named(x).replaceAll('|', '\\|')} | ${String(x.tree).slice(0, 7)} | ${x.passed} | ${x.failed} |`), '',
    'Run it alone:', '', '```sh', t.alone ?? aloneCommand(t), '```', '',
    `Prove a fix: \`node scripts/keel/climb.mjs prove-steady --test "${t.file}: ${t.name}" --runs ${STEADY_RUNS}\` (every run must pass, on one clean tree).`, '',
    '## Tried', '',
    ...(night.tried.length ? night.tried.map(a => `- ${a.what}: ${a.why}`) : ['Nothing was tried.']), '',
    'Never rerun until green: a rerun hides the flake.', '',
  ].join('\n');
  return { title, body };
}

export async function report({ root, config, input, body, state = false, issue }) {
  on(config);
  const night = await readNight(root, input ? resolve(input) : undefined);
  if (!night) throw new ClimbError(`no night record at ${input ?? NIGHT}`);
  const files = git(root, ['diff', '--name-only', night.base, 'HEAD']).split('\n').filter(Boolean);
  const pkg = await readJson(join(root, 'package.json')).catch(() => null);
  const r = reportOf(night, { files, pkg });
  let text = null;
  if (r.input) {
    text = prBody(r.input);
    if (body) await writeFile(resolve(body), text);
  }
  if (state) await writeFile(join(root, STATE), `${JSON.stringify({ last: { job: night.job, date: night.date, kept: r.kept } }, null, 2)}\n`);
  const filed = issue ? issueOf(night, { minutes: r.minutes }) : null;
  if (filed) await writeFile(resolve(issue), filed.body);
  night.line = r.line;
  await writeNight(root, night);
  return { job: night.job, date: night.date, kept: r.kept, tried: r.tried, minutes: r.minutes, line: r.line, body: text && body ? resolve(body) : null, text, issue: filed ? { title: filed.title, path: resolve(issue) } : null };
}

// ---- the command line ------------------------------------------------------------

const USAGE = 'usage: node scripts/keel/climb.mjs config|pick|measure <job>|compare|prove-steady|harmless|revert|settle|guard|report [--json]';
const FLAGS = { '--date': 'date', '--runs': 'runs', '--rounds': 'rounds', '--base': 'base', '--candidate': 'candidate', '--what': 'what', '--why': 'why', '--input': 'input', '--body': 'body', '--test': 'test', '--path': 'path', '--job': 'job', '--issue': 'issue' };
const SWITCHES = { '--force': 'force', '--baseline': 'baseline', '--decide': 'decide', '--final': 'final', '--state': 'state' };

export function parseArgs(args) {
  const [verb, ...rest] = args;
  const opts = { verb, positional: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (SWITCHES[a]) opts[SWITCHES[a]] = true;
    else if (FLAGS[a]) {
      if (rest[i + 1] === undefined) throw new ClimbError(`${a} needs a value; ${USAGE}`);
      opts[FLAGS[a]] = rest[++i];
    } else if (a.startsWith('--')) throw new ClimbError(`unknown flag ${a}; ${USAGE}`);
    else opts.positional.push(a);
  }
  for (const k of ['runs', 'rounds']) if (opts[k] !== undefined) {
    if (!/^\d+$/.test(opts[k])) throw new ClimbError(`--${k} must be a whole number`);
    opts[k] = Number(opts[k]);
  }
  if (opts.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) throw new ClimbError('--date is YYYY-MM-DD');
  return opts;
}

export async function cli(args, { root = rootOf(import.meta), env = process.env } = {}) {
  const o = parseArgs(args);
  const config = await readConfig(root);
  const ctx = { root, config, env };
  switch (o.verb) {
    case 'config': {
      const c = climbConfigOf(config);
      return { data: c ? { on: true, ...c } : { on: false }, text: c ? `climb: ${c.jobs.join(', ')}, ${c.schedule}, ${c.minutes} min, margin ${Math.round(c.margin * 100)}%, ${c.attempts} attempts` : 'climb is off: .keel/keel.json has no "climb"' };
    }
    case 'pick': {
      const p = await pick({ ...ctx, date: o.date, force: o.force });
      return { data: p, text: p.job ? `tonight: ${p.job} (${p.why}); branch ${p.branch}` : `no climb tonight: ${p.reason}` };
    }
    case 'measure': {
      const job = o.positional[0];
      if (!job) throw new ClimbError(`measure needs a job; ${USAGE}`);
      const m = await measure({ ...ctx, job, runs: o.runs, baseline: o.baseline });
      return { data: m, text: `${job}: \`${m.command}\` median ${fmtMs(m.median)}, spread ${fmtMs(m.spread)} over ${m.runs} runs${o.baseline ? `; the night's record is ${NIGHT}` : ''}` };
    }
    case 'compare': {
      const r = await compare({ ...ctx, base: o.base, candidate: o.candidate, rounds: o.rounds, runs: o.runs, decide: o.decide, final: o.final, what: o.what });
      const rows = r.rounds.map(x => `  round ${x.round}: base ${fmtMs(x.base)}  candidate ${fmtMs(x.candidate)}  ${fmtPct(x.change)}`);
      const head = r.same ? 'same commit: nothing to compare' : `${r.verdict.toUpperCase()}: ${r.what}: ${r.why}`;
      return { data: r, text: [head, ...rows, ...(r.stop ? [`stop: ${r.stop}`] : [])].join('\n') };
    }
    case 'prove-steady': {
      const r = await proveSteady({ ...ctx, test: o.test, runs: o.runs, decide: o.decide, candidate: o.candidate });
      const head = `${r.steady ? 'STEADY' : 'NOT STEADY'}${o.decide ? ` (${r.verdict.toUpperCase()})` : ''}: ${r.why}`;
      return { data: r, text: [head, ...(r.stop ? [`stop: ${r.stop}`] : [])].join('\n'), exitCode: r.steady ? 0 : 1 };
    }
    case 'harmless': {
      const r = await harmless({ ...ctx, path: o.path, why: o.why });
      return { data: r, text: `harmless: ${r.path}: ${r.why}` };
    }
    case 'revert': {
      const r = await revert({ ...ctx, why: o.why, what: o.what });
      return { data: r, text: `reverted: ${r.what}: ${r.why}${r.stop ? `\nstop: ${r.stop}` : ''}` };
    }
    case 'settle': {
      const r = await settle(ctx);
      return { data: r, text: r.dropped ? `settled on ${r.head.slice(0, 7)}: dropped what no compare kept` : `settled: HEAD ${r.head.slice(0, 7)} is the last decision` };
    }
    case 'guard': {
      const g = await guard({ ...ctx, base: o.base, job: o.job });
      const noted = (g.noted ?? []).map(n => `  note: ${n.message}`);
      return { data: g, text: g.ok ? [`guard: ${g.line}`, ...noted].join('\n') : `guard failed:\n${g.problems.map(p => `  ${p}`).join('\n')}`, exitCode: g.ok ? 0 : 1 };
    }
    case 'report': {
      const r = await report({ ...ctx, input: o.input, body: o.body, state: o.state, issue: o.issue });
      return { data: { ...r, text: undefined }, text: [r.line, ...(r.issue ? [`issue to file: ${r.issue.title} (${r.issue.path})`] : []), ...(r.text && !o.body ? ['', r.text.trimEnd()] : [])].join('\n') };
    }
    default: throw new ClimbError(o.verb ? `unknown subcommand ${o.verb}; ${USAGE}` : USAGE);
  }
}

if (isMain(import.meta)) await main(args => cli(args));
