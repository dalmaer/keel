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
//   node scripts/keel/climb.mjs guard [--base r]            the gate, and no test dropped
//   node scripts/keel/climb.mjs report [--input f] [--body f] [--state]
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
import { readFile, readdir, writeFile, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { gateEnv, healthDirOf, cells, isMain, rootOf, main } from './lib.mjs';
import { readRuns } from './test-ledger.mjs';
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
 * that send a night to it first (the night's improve.mjs ids), and the
 * command its number times. Adding a job is a practice change.
 */
export const JOBS = Object.freeze({
  'test-time': Object.freeze({
    number: "the test command's wall time",
    better: 'lower',
    measures: Object.freeze(['slow_tests']),
    command: config => config?.climb?.testCommand ?? 'npm test',
  }),
});

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
  const known = ['jobs', 'budget', 'schedule', 'margin', 'attempts', 'testCommand'];
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
  };
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
 * outside its bound (broken first), else the next in rotation after `last`;
 * a job with an open PR waits. { job, by, why } or { job: null, reason }.
 */
export function choose({ jobs, rows = [], waiting = new Set(), last = null, table = JOBS }) {
  const tied = [];
  for (const r of rows) {
    if (!['outside', 'broken'].includes(r.state)) continue;
    for (const job of jobs) if (table[job]?.measures.includes(r.id) && !waiting.has(job)) tied.push({ job, r });
  }
  tied.sort((a, b) => distance(b.r) - distance(a.r));
  if (tied.length) {
    const { job, r } = tied[0];
    return { job, by: 'measure', why: `${r.id} is ${r.state} on the newest health page (${r.value ?? '—'} against ${r.op} ${r.bound})` };
  }
  const start = jobs.indexOf(last) + 1;
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[(start + i) % jobs.length];
    if (!waiting.has(job)) return { job, by: 'rotation', why: last ? `rotation, after ${last}; no measure tied to a job is outside its bound` : 'rotation, the first job; no measure tied to a job is outside its bound' };
  }
  return { job: null, reason: `every job waits for its open ${PREFIX}<job>/ PR: ${jobs.join(', ')}` };
}

function openHeads(root, env) {
  const gh = env.KEEL_GH || 'gh';
  const r = spawnSync(gh, ['pr', 'list', '--state', 'open', '--json', 'headRefName', '--limit', '200'], { cwd: root, env, encoding: 'utf8' });
  if (r.error) throw new ClimbError(`cannot read open PRs (${gh}): ${r.error.message}; pick never guesses that none are open`);
  if (r.status !== 0) throw new ClimbError(`gh pr list exited ${r.status}: ${(r.stderr || r.stdout).trim().split('\n')[0]}; pick never guesses that none are open`);
  let data;
  try { data = JSON.parse(r.stdout); } catch { throw new ClimbError('gh pr list did not print JSON'); }
  if (!Array.isArray(data)) throw new ClimbError('gh pr list did not print a JSON array');
  return data.map(p => p.headRefName).filter(h => typeof h === 'string');
}

export async function pick({ root, config, env = process.env, date = today(), force = false }) {
  const c = climbConfigOf(config);
  if (!c) return { job: null, date, reason: 'climb is off: .keel/keel.json has no "climb"' };
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (c.schedule === 'weekly' && !force && day !== WEEKLY_DAY) return { job: null, date, reason: 'not tonight: climb is weekly, on Mondays (UTC)' };
  const waiting = waitingJobs(openHeads(root, env));
  const health = await newestHealth(root, config);
  const last = (await readJson(join(root, STATE)))?.last?.job ?? null;
  const chosen = choose({ jobs: c.jobs, rows: health?.rows ?? [], waiting, last });
  const out = { ...chosen, date, health: health?.file ?? null, waiting: [...waiting].filter(j => c.jobs.includes(j)), minutes: c.minutes, margin: c.margin, attempts: c.attempts };
  if (chosen.job) Object.assign(out, { branch: `${PREFIX}${chosen.job}/${date}`, command: JOBS[chosen.job].command(config), number: JOBS[chosen.job].number });
  return out;
}

// ---- measure -------------------------------------------------------------------

/** Run the job's command `runs` times in `cwd`: { median, spread, times }. A failing run throws (exit 2): a failing suite has no time. */
export function measureIn(cwd, { config, job, runs, env = process.env }) {
  if (!Object.hasOwn(JOBS, job)) throw new ClimbError(`unknown job ${JSON.stringify(job)} (known: ${Object.keys(JOBS).join(', ')})`);
  const command = JOBS[job].command(config);
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

export async function measure({ root, config, env, job, runs = DEFAULTS.runs, baseline = false }) {
  const c = on(config);
  const m = measureIn(root, { config, job, runs, env });
  if (baseline) {
    await writeNight(root, {
      job, date: today(), started: new Date().toISOString(), base: sha(root, 'HEAD'),
      command: m.command, margin: c.margin, attempts: c.attempts, rounds: DEFAULTS.rounds,
      baseline: { median: m.median, spread: m.spread, times: m.times },
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

export async function guard({ root, config, env = process.env, base }) {
  on(config);
  const night = await readNight(root);
  base ??= night?.base;
  if (!base) throw new ClimbError('guard needs --base <ref> (or an open night)');
  const head = sha(root, 'HEAD'), b = sha(root, base);
  if (head === b) return { ok: true, skipped: true, line: 'nothing kept: HEAD is the base, so there is nothing to guard', problems: [] };
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
  return { ok: true, gate, line, problems: [] };
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
    const tried = night.tried.length ? `${night.tried.length} tried, none beat the noise (margin ${pctMargin})` : 'nothing was tried';
    return { kept: 0, tried: night.tried.length, minutes, line: `climb ${night.job} ${night.date}: kept nothing; ${tried}; ${minutes} min`, input: null };
  }
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
    },
    notes: [
      reverted.length ? `Tried and reverted:\n\n${reverted.map(a => `- ${a.what}: ${a.why}`).join('\n')}` : 'Nothing was tried and reverted.',
      `Every number here is scripts/keel/climb.mjs's (\`${night.command}\`, base and candidate run alternately in one job), never the agent's own timing. Baseline: ${fmtMs(night.baseline.median)}, spread ${fmtMs(night.baseline.spread)} over ${night.baseline.times.length} runs. ${minutes} min. Nothing here merges without a person.`,
    ],
  };
  return { kept: kept.length, tried: night.tried.length, minutes, line, input };
}

export async function report({ root, config, input, body, state = false }) {
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
  night.line = r.line;
  await writeNight(root, night);
  return { job: night.job, date: night.date, kept: r.kept, tried: r.tried, minutes: r.minutes, line: r.line, body: text && body ? resolve(body) : null, text };
}

// ---- the command line ------------------------------------------------------------

const USAGE = 'usage: node scripts/keel/climb.mjs config|pick|measure <job>|compare|revert|settle|guard|report [--json]';
const FLAGS = { '--date': 'date', '--runs': 'runs', '--rounds': 'rounds', '--base': 'base', '--candidate': 'candidate', '--what': 'what', '--why': 'why', '--input': 'input', '--body': 'body' };
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
    case 'revert': {
      const r = await revert({ ...ctx, why: o.why, what: o.what });
      return { data: r, text: `reverted: ${r.what}: ${r.why}${r.stop ? `\nstop: ${r.stop}` : ''}` };
    }
    case 'settle': {
      const r = await settle(ctx);
      return { data: r, text: r.dropped ? `settled on ${r.head.slice(0, 7)}: dropped what no compare kept` : `settled: HEAD ${r.head.slice(0, 7)} is the last decision` };
    }
    case 'guard': {
      const g = await guard({ ...ctx, base: o.base });
      return { data: g, text: g.ok ? `guard: ${g.line}` : `guard failed:\n${g.problems.map(p => `  ${p}`).join('\n')}`, exitCode: g.ok ? 0 : 1 };
    }
    case 'report': {
      const r = await report({ ...ctx, input: o.input, body: o.body, state: o.state });
      return { data: { ...r, text: undefined }, text: [r.line, ...(r.text && !o.body ? ['', r.text.trimEnd()] : [])].join('\n') };
    }
    default: throw new ClimbError(o.verb ? `unknown subcommand ${o.verb}; ${USAGE}` : USAGE);
  }
}

if (isMain(import.meta)) await main(args => cli(args));
