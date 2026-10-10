// keel tend (keel practice `climb`; managed: keel render rewrites it). The
// third pass beside measure and climb: once a week an agent resolves the
// night's record findings (lost proofs, reconciliation's proposals, stale
// next actions, docs behind code, drift, loose ends) in one keel-tend/<date>
// PR a person merges (keel phase 38; docs/research/2026-10-06-tend-pass.md).
// This module is every number and every refusal the pass makes; the agent
// edits records, the script decides what counts. scripts/keel/climb.mjs
// carries its verbs:
//
//   tend-pick [--date d]            whether a pass runs, and its branch
//   tend-input [--record]           the worksheet: every record finding, or n/a with why
//   tend-note --finding id --propose "…" | --tried "…"   what tend leaves to the owner
//   guard --job tend [--base r]     the tend guard, then the gate
//   sandbox --base r --head r --job tend   the sandbox and tendCheck, git only: the publish job's recheck (#68)
//   tend-page [--base r] [--date d]   the owner's page (docs/tend/<date>.md), committed before the guard
//   tend-report [--body f] [--base r] [--date d]  the measures again on the branch, the PR body,
//                                   the line (it checks the page is committed, and writes no file of the tree)
//
// It never writes evidence, never marks built, lived-in or accepted, never
// deletes, never merges: the guard refuses the first three, naming the line;
// the workflow's rights refuse the last.
import { readFile, writeFile, mkdir, readdir, realpath } from 'node:fs/promises';
import { readFileSync, readdirSync, lstatSync, readlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gateEnv, healthDirOf, cells, passAgentProblems, agentGitArgs } from './lib.mjs';
import { prBody } from './pr-body.mjs';

export const TEND_PREFIX = 'keel-tend/';
export const TEND_DIR = '.keel/tend';
export const PASS = `${TEND_DIR}/pass.json`;
export const TEND_DEFAULTS = Object.freeze({ minutes: 30, schedule: 'weekly' });
const MINUTES = [5, 180];
/** The night's measures that are records, in the order the worksheet lists them. */
export const RECORD_MEASURES = Object.freeze(['proofs_hold', 'roadmap_stale', 'phases_stuck', 'evidence_placeholders', 'drift', 'lint']);
/** A phase status tend never writes. */
export const NEVER_STATUS = Object.freeze(['built', 'lived-in', 'accepted']);
/** Closed unmerged tend PRs in a row that make the pass propose its own retirement. */
export const TEND_RETIRE_AFTER = 3;
/** A commit's citation of the finding it resolves: a `Tend: <finding id>` line. */
export const CITE = /^Tend:\s*(\S+)\s*$/gm;

export class TendError extends Error {
  constructor(message, exitCode = 2) { super(`tend: ${message}`); this.exitCode = exitCode; }
}

// ---- config ------------------------------------------------------------------

/** What is wrong with .keel/keel.json "tend": [string]. Absent is fine: tend is off. */
export function tendProblems(config) {
  const t = config?.tend;
  if (t === undefined) return [];
  if (!t || typeof t !== 'object' || Array.isArray(t)) return ['"tend" must be an object: { schedule: "weekly", budget: { minutes } }'];
  const out = [];
  for (const k of Object.keys(t)) if (!['schedule', 'budget', 'agent'].includes(k)) out.push(`"tend" has an unknown key ${k} (schedule, budget, agent)`);
  if (t.schedule !== undefined && t.schedule !== 'weekly') out.push(`"tend".schedule must be "weekly" (got ${JSON.stringify(t.schedule)}; nightly is deliberately open in keel phase 38)`);
  if (t.budget !== undefined) {
    if (!t.budget || typeof t.budget !== 'object' || Array.isArray(t.budget) || Object.keys(t.budget).some(k => k !== 'minutes')) out.push('"tend".budget must be { minutes }');
    else if (!(Number.isInteger(t.budget.minutes) && t.budget.minutes >= MINUTES[0] && t.budget.minutes <= MINUTES[1])) out.push(`"tend".budget.minutes must be a whole number from ${MINUTES[0]} to ${MINUTES[1]} (got ${JSON.stringify(t.budget.minutes)})`);
  }
  // The agent that runs the pass (phase 45): listed in "agents", and one that can commit.
  return [...out, ...passAgentProblems(config, 'tend')];
}

/** The tend settings, defaults filled in; null when tend is off. A bad "tend" throws (exit 2). */
export function tendConfigOf(config) {
  const problems = tendProblems(config);
  if (problems.length) throw new TendError(`.keel/keel.json: ${problems.join('; ')}`);
  const t = config?.tend;
  if (t === undefined) return null;
  return { schedule: t.schedule ?? TEND_DEFAULTS.schedule, minutes: t.budget?.minutes ?? TEND_DEFAULTS.minutes };
}

// ---- the sandbox ----------------------------------------------------------------

/**
 * Paths an agent's branch (a climb night's or a tend pass's) may never change:
 * the workflows, keel's own scripts (the judge and the publish job run the
 * default branch's copy only because the branch leaves them as they were),
 * .keel/keel.json (it names the gate, the setup command and the secret
 * the Install step is given), and .keel/agent-git/ (Codex's git dir, phase
 * 47: a git dir carried as files is config and hooks). A directory ends in "/".
 */
export const OFF_LIMITS = Object.freeze(['.github/', 'scripts/keel/', '.keel/keel.json', '.keel/agent-git/']);
const offLimit = path => OFF_LIMITS.some(p => (p.endsWith('/') ? path.startsWith(p) : path === p));

/**
 * What the agent's commits may not carry, pure over git: [problem]. `head` is
 * on top of `base`, and no commit between them changes an OFF_LIMITS path.
 * It runs no code from the branch, so the job that holds the write token can
 * run it (climb.mjs sandbox), and the guards run it first.
 */
/**
 * The paths changed from base to head, as git names them: [{ status, path }].
 * Read NUL-delimited (-z, PR #59): without it git quotes and escapes a path
 * with a non-ASCII byte, a quote or a control character (core.quotePath), so
 * "docs/evidence/é.md" would come back as "\"docs/evidence/\\303\\251.md\"" and
 * slip past every rule that reads the path. Every rule here reads paths this way.
 */
export function changesOf(root, base, head) {
  const parts = git(root, ['diff', '--name-status', '-z', '--no-renames', base, head]).split('\0');
  const out = [];
  for (let i = 0; i + 1 < parts.length; i += 2) if (parts[i]) out.push({ status: parts[i], path: parts[i + 1] });
  return out;
}
/** Paths a git command lists with --name-only, NUL-delimited (-z): unquoted, whatever bytes they hold. */
export const pathsOf = (root, [cmd, ...rest]) => git(root, [cmd, '-z', ...rest]).split('\0').filter(Boolean);

export function sandboxProblems(root, base, head) {
  const b = sha(root, base), h = sha(root, head);
  if (git(root, ['merge-base', '--is-ancestor', b, h], { allowFail: true }).status !== 0) return [`${h.slice(0, 7)} is not on top of the base ${b.slice(0, 7)}: the agent's branch must start where the run did`];
  const out = [];
  // Each commit as well as the whole (PR #59): a file added in one commit and taken out in a later one is
  // not in base..head, yet the branch's history carries it into main on any merge but a squash.
  // rev-list's own lines (PR #59): its -z applies only to --objects and kin, so commits are one a line.
  const changes = changesOf(root, b, h), whole = new Set(changes.map(x => x.path));
  for (const c of git(root, ['rev-list', '--reverse', `${b}..${h}`]).split('\n').filter(Boolean)) {
    for (const { path } of changesOf(root, `${c}^`, c)) {
      // A package.json's install keys, commit by commit (#82): a dependency or an install script added and taken out later.
      if (basename(path) === 'package.json') {
        // The whole branch's own check names it when the change stands at its head; this is for one taken back.
        if (whole.has(path) && packageProblem(showAt(root, b, path), showAt(root, h, path))) continue;
        const why = packageProblem(showAt(root, `${c}^`, path), showAt(root, c, path));
        if (why) out.push(`${path}: ${why} in ${c.slice(0, 7)} on the agent's branch; the branch's history would carry it, so the branch is refused whole (ledger#92)`);
        continue;
      }
      if (whole.has(path)) continue;
      if (offLimit(path) || INSTALL_FILES.includes(basename(path)) || path.startsWith('docs/evidence/')) out.push(`${path}: changed in ${c.slice(0, 7)} on the agent's branch and changed back later; the branch's history would still carry it (${path.startsWith('docs/evidence/') ? 'evidence is never the agent\'s to write' : 'it is off limits to the agent'}), so the branch is refused whole`);
    }
  }
  for (const { path } of changes) {
    if (offLimit(path)) out.push(`${path}: changed on the agent's branch; ${OFF_LIMITS.join(', ')} are off limits to it (the workflows, keel's scripts that judge it, and the config that names the gate and the secrets)`);
    else if (INSTALL_FILES.includes(basename(path))) out.push(`${path}: changed on the agent's branch; an install's own files (${INSTALL_FILES.join(', ')}) are off limits to it: the judge installs the base's, with the setup token, before it takes the agent's commits, and no dependency is added (ledger#92)`);
    else if (basename(path) === 'package.json') {
      const why = packageProblem(showAt(root, b, path), showAt(root, h, path));
      if (why) out.push(`${path}: ${why}; the judge installs the base's dependencies, with the setup token, before it takes the agent's commits, and no dependency is added (ledger#92)`);
    }
  }
  return out;
}

/**
 * The files an install reads besides package.json, at any depth: lockfiles
 * and the package manager's config. The agent's branch changes none of them.
 */
export const INSTALL_FILES = Object.freeze(['package-lock.json', 'npm-shrinkwrap.json', '.npmrc', 'yarn.lock', '.yarnrc', '.yarnrc.yml', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'bun.lock', 'bun.lockb',
  // The runtime the setup picks (PR #59): setup-node reads it from the base's checkout, before the agent's commits are taken.
  '.nvmrc', '.node-version', '.tool-versions']);
/** The scripts npm runs on an install (or a pack), never on `npm run <name>` alone. */
export const INSTALL_SCRIPTS = Object.freeze(['preinstall', 'install', 'postinstall', 'preprepare', 'prepare', 'postprepare', 'prepack', 'postpack', 'prepublish', 'dependencies']);

/**
 * Why a package.json change is refused, or null. A climb night may change a
 * script it runs (the test or build command is often the change that pays),
 * so "scripts" may change but for the install's own; any other key (the
 * dependencies, overrides, workspaces, engines) may not.
 */
export function packageProblem(before, after) {
  let a, b;
  try { b = before === null ? null : JSON.parse(before); a = after === null ? null : JSON.parse(after); }
  catch { return 'not JSON on one side, so what it installs cannot be told'; }
  if (b === null || a === null) return b === null ? 'added on the agent\'s branch' : 'deleted on the agent\'s branch';
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(k => k !== 'scripts' && JSON.stringify(b[k]) !== JSON.stringify(a[k]));
  if (keys.length) return `changes ${keys.map(k => `"${k}"`).join(', ')}; only "scripts" may change`;
  const s = [b.scripts ?? {}, a.scripts ?? {}];
  const lifecycle = INSTALL_SCRIPTS.filter(k => s[0][k] !== s[1][k]);
  if (lifecycle.length) return `changes the install script${lifecycle.length === 1 ? '' : 's'} ${lifecycle.map(k => `"${k}"`).join(', ')}`;
  return null;
}

/**
 * The base a judge trusts: the run's own commit (`given`, the workflow's
 * $GITHUB_SHA), never the one the agent's record names. A record (the
 * pass's or the night's) comes back from the agent's job, so the agent could
 * name an intermediate commit and slip what came before it past the guard,
 * while the bundle still carries it to the PR (ledger#92). With `given`, a
 * record naming any other base is a problem; without it (a person's own run),
 * the record's base stands. { base, problem }.
 */
export function recordBase(root, given, recorded, record) {
  if (!given) return { base: recorded ?? null, problem: null };
  const g = sha(root, given);
  if (recorded === undefined || recorded === null || recorded === g) return { base: g, problem: null };
  return { base: g, problem: `${record} names its base ${String(recorded).slice(0, 12)}, not the run's commit ${g.slice(0, 7)} (--base): a record's base is the agent's to write, so the judge trusts only the run's, and every commit since it is guarded` };
}

/**
 * What a tend pass may change at all: its surfaces, as .agents/climb/TEND.md's
 * "You may" names them (ledger#92). Records and agent-facing text only: any
 * Markdown under docs/ but docs/evidence/ (the phases, the roadmap, the
 * decisions and research reconciliation reads, docs/projects), a README in
 * any directory, AGENTS.md, CLAUDE.md, and Markdown under .agents/. A change
 * anywhere else is refused, whether or not a commit cites a finding.
 */
export const TEND_SURFACES = Object.freeze(['docs/**/*.md (never docs/evidence/)', 'README.md', 'AGENTS.md', 'CLAUDE.md', '.agents/**/*.md']);
export const tendSurface = path => (/^docs\/.+\.md$/.test(path) && !path.startsWith('docs/evidence/'))
  || /(^|\/)README\.md$/.test(path) || path === 'AGENTS.md' || path === 'CLAUDE.md' || /^\.agents\/.+\.md$/.test(path);

// ---- small tools ---------------------------------------------------------------

// Under Codex (phase 47), KEEL_AGENT_GIT points the checkout's commands at .keel/agent-git, as climb.mjs's.
/**
 * The options every keel git command runs with (PR #59): the agent's code (a
 * gate, a build) can write the checkout's git dir, so no hook it planted and
 * no fsmonitor it named ever runs from a command of keel's, and no replace
 * ref it planted changes what a commit is. climb.mjs runs git with these too.
 */
export const SAFE_GIT = Object.freeze(['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.useReplaceRefs=false']);
function git(cwd, args, { allowFail = false } = {}) {
  const r = spawnSync('git', [...SAFE_GIT, ...agentGitArgs(cwd), ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new TendError(`git ${args[0]}: ${r.error.message}`);
  if (r.status !== 0 && !allowFail) throw new TendError(`git ${args.join(' ')} exited ${r.status}: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
  return allowFail ? r : r.stdout.replace(/\n$/, '');
}
const sha = (root, ref) => git(root, ['rev-parse', '--verify', `${ref}^{commit}`]);
const today = () => new Date().toISOString().slice(0, 10);
async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw new TendError(`${path}: ${e.message}`); }
}
export const readPass = (root, path = join(root, PASS)) => readJson(path);
export async function writePass(root, pass) {
  await mkdir(join(root, TEND_DIR), { recursive: true });
  await writeFile(join(root, TEND_DIR, '.gitignore'), '*\n');
  await writeFile(join(root, PASS), `${JSON.stringify(pass, null, 2)}\n`);
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---- pick ----------------------------------------------------------------------

/** Whether the last TEND_RETIRE_AFTER keel-tend/ PRs (newest by createdAt) were all closed unmerged: their numbers, or null. */
export function tendRetiring(prs) {
  const mine = prs.filter(p => typeof p?.headRefName === 'string' && p.headRefName.startsWith(TEND_PREFIX))
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))).slice(0, TEND_RETIRE_AFTER);
  return mine.length === TEND_RETIRE_AFTER && mine.every(p => !p.mergedAt) ? mine.map(p => p.number) : null;
}

function ghList(root, env, state, fields) {
  const gh = env.KEEL_GH || 'gh';
  const r = spawnSync(gh, ['pr', 'list', '--state', state, '--json', fields, '--limit', '200'], { cwd: root, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new TendError(`cannot read ${state} PRs (${gh}): ${r.error.message}; tend-pick never guesses`);
  if (r.status !== 0) throw new TendError(`gh pr list --state ${state} exited ${r.status}: ${(r.stderr || r.stdout).trim().split('\n')[0]}; tend-pick never guesses`);
  let data;
  try { data = JSON.parse(r.stdout); } catch { throw new TendError(`gh pr list --state ${state} did not print JSON`); }
  if (!Array.isArray(data)) throw new TendError(`gh pr list --state ${state} did not print a JSON array`);
  return data;
}

/** This week's pass, or why none: { run, reason?, date, branch?, minutes? }. With tend off, gh is never asked. */
export async function tendPick({ root, config, env = process.env, date = today() }) {
  const t = tendConfigOf(config);
  if (!t) return { run: false, date, reason: 'tend is off: .keel/keel.json has no "tend"' };
  const open = ghList(root, env, 'open', 'headRefName').map(p => p?.headRefName).filter(h => typeof h === 'string' && h.startsWith(TEND_PREFIX));
  if (open.length) return { run: false, date, reason: `the last tend PR (${open[0]}) is still open: a person reads it before the next pass` };
  const retiring = tendRetiring(ghList(root, env, 'closed', 'headRefName,number,createdAt,mergedAt'));
  if (retiring) return { run: false, date, retiring, reason: `tend proposes its own retirement: its last ${TEND_RETIRE_AFTER} ${TEND_PREFIX} PRs (${retiring.map(n => `#${n}`).join(', ')}) were closed unmerged. Remove "tend" from .keel/keel.json, or reopen one` };
  return { run: true, date, branch: `${TEND_PREFIX}${date}`, minutes: t.minutes, schedule: t.schedule };
}

// ---- the worksheet -------------------------------------------------------------

/** The newest health page's rows for the record measures: { file, rows: { id: { value, state, detail } } }, or null. */
export async function healthRecords(root, config) {
  const dir = healthDirOf(config);
  let names;
  try { names = (await readdir(join(root, dir))).filter(n => /^\d{4}-\d{2}-\d{2}\.md$/.test(n)).sort(); }
  catch (e) { if (['ENOENT', 'ENOTDIR'].includes(e.code)) return null; throw e; }
  if (!names.length) return null;
  const file = `${dir}/${names.at(-1)}`;
  const rows = {};
  for (const line of (await readFile(join(root, file), 'utf8')).split('\n')) {
    const [measure, value, , state, detail] = cells(line);
    const id = /^`([a-z_]+)`/.exec(measure ?? '')?.[1];
    if (id && RECORD_MEASURES.includes(id)) rows[id] = { value: /^-?\d+$/.test(value) ? Number(value) : null, state, detail: detail ?? '' };
  }
  return { file, rows };
}

/** One measure's findings, from its facts: [{ id, measure, what }]. A count with no facts is one finding naming the count. */
export function findingsOf(r) {
  const f = r.facts ?? {};
  const one = (key, what) => ({ id: key ? `${r.id}:${key}` : r.id, measure: r.id, what });
  if (!(r.value > 0)) return [];
  switch (r.id) {
    case 'proofs_hold': if (Array.isArray(f.found)) return f.found.map(x => one(x.id, `phase ${x.id} (docs/phases/${x.file}): proof lost: ${[x.missing?.length ? `${x.missing.join(', ')} missing` : '', x.failing?.length ? `${x.failing.join(', ')} did not pass in the last recorded run` : ''].filter(Boolean).join('; ')}`)); break;
    case 'roadmap_stale': return [one(null, `the roadmap check fails: ${f.message ?? r.detail}`)];
    case 'phases_stuck': if (Array.isArray(f.stuck)) return f.stuck.map(x => one(x.id, `phase ${x.id} ${x.status} since ${x.since} (${x.days}d)${x.path ? `, ${x.path}` : ''}`)); break;
    case 'evidence_placeholders': if (Array.isArray(f.found)) return f.found.map(x => one(x.id, `phase ${x.id}: docs/${x.evidence} is the blank template`)); break;
    case 'drift': if (Array.isArray(f.paths)) return f.paths.map(p => one(p, `${p}: a keel-managed file changed here (keep: eject; restore; or send home)`)); break;
    case 'lint': if (Array.isArray(f.lint)) return f.lint.map(l => one(`${l.rule}:${l.path}`, `${l.rule} in ${l.path}`)); break;
  }
  return [one(null, `${r.value}: ${r.detail}`)];
}

/** The project's own instruments where keel is home (lib/improve.mjs), as improve's script finds them. */
async function improveOf(root) {
  const path = join(root, 'scripts/keel/improve.mjs');
  if (!existsSync(path)) throw new TendError('scripts/keel/improve.mjs is missing: tend reads the night practice\'s measures');
  return import(pathToFileURL(path).href);
}

/**
 * The record measures, run now on this tree (deterministic: files, git, the
 * test ledger; no network): [{ id, state, value, detail, findings, why? }].
 * One that could not run, or does not apply, is n/a with why, never a zero.
 */
export async function recordMeasures(root, config, env = process.env) {
  const improve = await improveOf(root);
  const measures = improve.MEASURES.filter(m => RECORD_MEASURES.includes(m.id));
  const keel = typeof improve.instrumentsFor === 'function' ? await improve.instrumentsFor(root) : undefined;
  const results = await improve.measure({ root, config, env, measures, keel });
  return RECORD_MEASURES.map(id => {
    const r = results.find(x => x.id === id);
    if (!r) return { id, state: 'n/a', value: null, why: 'this project\'s scripts/keel/improve.mjs has no such measure (keel update brings it)', findings: [] };
    if (r.state === 'n/a') return { id, state: 'n/a', value: null, why: r.detail || 'does not apply here', findings: [] };
    if (r.state === 'broken') return { id, state: 'n/a', value: null, why: `could not run: ${r.detail || 'the instrument failed'}`, findings: [] };
    return { id, state: r.state, value: r.value, detail: r.detail, findings: findingsOf(r) };
  });
}

/** Reconciliation's findings and proposals when the practice is on: { state, why?, findings }. */
export function reconciliationOf(root, config, env = process.env) {
  if (!(config.practices ?? []).includes('reconciliation')) return { state: 'n/a', why: 'the reconciliation practice is off here', findings: [] };
  const script = join(root, 'scripts/keel/reconcile.mjs');
  if (!existsSync(script)) return { state: 'n/a', why: 'scripts/keel/reconcile.mjs is missing (keel update brings it)', findings: [] };
  const r = spawnSync(process.execPath, [script, '--json'], { cwd: root, env: Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('NODE_TEST_'))), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let out;
  try { out = JSON.parse(r.stdout); } catch { return { state: 'n/a', why: `reconcile.mjs --json printed no JSON (exit ${r.status ?? r.error?.message})`, findings: [] }; }
  if (out.error) return { state: 'n/a', why: `reconcile.mjs could not run: ${out.error}`, findings: [] };
  const proposals = Array.isArray(out.proposals) ? out.proposals : [];
  const findings = (out.findings ?? []).map(f => {
    const p = proposals.find(x => x.rule === f.rule && x.path === f.path);
    return { id: `reconcile:${f.rule}:${f.path || '-'}`, measure: 'reconciliation', what: `${f.rule}${f.path ? ` in ${f.path}` : ''}: ${f.message}${p?.proposed_edit ? `; proposed: ${typeof p.proposed_edit === 'string' ? p.proposed_edit : JSON.stringify(p.proposed_edit)}` : ''}` };
  });
  const unknown = (out.unknown ?? []).length;
  return { state: 'ok', value: findings.length, findings, ...(unknown ? { note: `${plural(unknown, 'reference')} reconciliation could not check` } : {}) };
}

/** The keel CLI to ask for loose ends: KEEL_CLI (a command line), keel's own bin where keel is home, else `keel`. */
function keelCli(root, config, env) {
  if (env.KEEL_CLI !== undefined) return env.KEEL_CLI.trim().split(/\s+/).filter(Boolean);
  if (config.keel === 'self' && existsSync(join(root, 'bin/keel.mjs'))) return [process.execPath, join(root, 'bin/keel.mjs')];
  return ['keel'];
}

/** `keel loose-ends` items for this repo, when keel is installed: { state, why?, items }. Never red: a CLI that cannot answer is n/a. */
export async function looseEndsOf(root, config, env = process.env) {
  const [cmd, ...pre] = keelCli(root, config, env);
  if (!cmd) return { state: 'n/a', why: 'KEEL_CLI is empty: no keel to ask', findings: [] };
  const r = spawnSync(cmd, [...pre, 'loose-ends', '--json'], { cwd: root, env: Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('NODE_TEST_'))), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
  if (r.error) return { state: 'n/a', why: r.error.code === 'ENOENT' ? `keel is not installed here (${cmd} loose-ends)` : `keel loose-ends could not run: ${r.error.message}`, findings: [] };
  let data;
  try { data = JSON.parse(r.stdout); } catch { return { state: 'n/a', why: `keel loose-ends --json printed no JSON (exit ${r.status})`, findings: [] }; }
  if (data?.error) return { state: 'n/a', why: `keel loose-ends: ${data.error}`, findings: [] };
  const here = await realpath(root).catch(() => root);
  const mine = [];
  for (const p of data?.projects ?? []) mine.push({ p, dir: p.dir ? await realpath(p.dir).catch(() => p.dir) : null });
  const found = mine.find(({ p, dir }) => (config.repo && p.repo === config.repo) || dir === here);
  const project = found?.p;
  if (!project) return { state: 'n/a', why: `keel loose-ends lists no project for ${config.repo ?? here}`, findings: [] };
  // Paths relative to the repo: the PR is read on GitHub, where the runner's checkout path means nothing.
  const roots = [...new Set([found.dir, project.dir, here, root].filter(Boolean))].sort((a, b) => b.length - a.length);
  const rel = text => roots.reduce((t, r) => t.split(`${r}/`).join(''), String(text));
  const findings = (project.items ?? []).map(it => ({ id: `loose:${it.fingerprint ?? it.id}`, measure: 'loose-ends', what: rel(`${it.kind}: ${it.title}${it.move ? ` → ${it.move}` : ''}${it.commands?.length ? ` (${it.commands.join('; ')})` : ''}`) }));
  return { state: 'ok', value: findings.length, findings, ...(project.github && project.github !== 'checked' ? { note: project.github } : {}) };
}

/**
 * The worksheet: every record finding the pass may resolve, from the record
 * measures (run on this tree, beside the newest health page's row for each),
 * reconciliation's proposals, and keel loose-ends. Deterministic but for
 * loose-ends, which reads the machine. A source that could not run is n/a with why.
 */
export async function tendInput({ root, config, env = process.env, date = today() }) {
  const health = await healthRecords(root, config);
  const measures = (await recordMeasures(root, config, env)).map(m => ({ ...m, night: health?.rows[m.id] ?? null }));
  const reconciliation = reconciliationOf(root, config, env);
  const looseEnds = await looseEndsOf(root, config, env);
  const findings = [...measures.flatMap(m => m.findings), ...reconciliation.findings, ...looseEnds.findings];
  return {
    date, base: sha(root, 'HEAD'), health: health?.file ?? null,
    measures, reconciliation, looseEnds,
    count: recordCount({ measures, reconciliation }),
    findings: findings.map(({ id, measure, what }) => ({ id, measure, what })),
  };
}

/** The night's record count: every record measure's value, and reconciliation's findings (loose ends are the machine's, not the records'). */
export const recordCount = ({ measures, reconciliation }) => measures.reduce((n, m) => n + (Number.isFinite(m.value) ? m.value : 0), 0) + (reconciliation?.state === 'ok' ? reconciliation.findings.length : 0);

export function worksheetText(w) {
  const src = (name, s) => s.state === 'n/a' ? `${name}: n/a: ${s.why}` : `${name}: ${plural(s.findings.length, 'finding')}${s.note ? ` (${s.note})` : ''}`;
  return [
    `tend worksheet ${w.date} on ${w.base.slice(0, 7)}${w.health ? ` (the night's page: ${w.health})` : ' (no health page yet)'}: ${plural(w.findings.length, 'finding')}; record count ${w.count}`,
    ...w.measures.map(m => `  ${src(m.id, m)}${m.night ? `; the night said ${m.night.value ?? '—'} (${m.night.state})` : ''}`),
    `  ${src('reconciliation', w.reconciliation)}`,
    `  ${src('loose-ends', w.looseEnds)}`,
    ...w.findings.map(f => `- ${f.id}: ${f.what}`),
  ].join('\n');
}

/** tend-input --record: the worksheet opens the pass's record (.keel/tend/pass.json). */
export async function openPass({ root, config, env, date }) {
  const t = tendConfigOf(config);
  if (!t) throw new TendError('tend is off: .keel/keel.json has no "tend"');
  const worksheet = await tendInput({ root, config, env, date });
  await writePass(root, { date: worksheet.date, started: new Date().toISOString(), base: worksheet.base, minutes: t.minutes, worksheet, notes: [], gate: null });
  return worksheet;
}

/** Record what tend leaves to the owner (a proposal) or could not resolve (tried), for a finding on the worksheet. */
export async function tendNote({ root, finding, propose, tried }) {
  const pass = await readPass(root);
  if (!pass) throw new TendError(`no pass is open (${PASS}): tend-input --record opens it`);
  if (!finding?.trim()) throw new TendError('tend-note needs --finding <id from the worksheet>');
  if (!pass.worksheet.findings.some(f => f.id === finding.trim())) throw new TendError(`${finding} is not on the worksheet: name a finding tend-input listed`);
  if (Boolean(propose?.trim()) === Boolean(tried?.trim())) throw new TendError('tend-note takes one of --propose "<what the owner chooses>" or --tried "<what was tried, and why it is unresolved>"');
  const note = { finding: finding.trim(), kind: propose?.trim() ? 'proposed' : 'tried', text: (propose ?? tried).trim() };
  pass.notes = [...pass.notes.filter(n => n.finding !== note.finding), note];
  await writePass(root, pass);
  return note;
}

// ---- the guard ------------------------------------------------------------------

/** Text as the rules read it (PR #59): a BOM dropped, CRLF and lone CR as LF, so a file converted on the way reads the same. */
const plain = text => (typeof text === 'string' ? text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n') : text);
const frontStatus = raw => {
  const text = plain(raw);
  if (typeof text !== 'string' || !text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 4);
  if (end < 0) return null;
  const lines = text.slice(0, end).split('\n');
  const i = lines.findIndex(l => /^status:\s*/.test(l));
  return i < 0 ? null : { status: lines[i].replace(/^status:\s*/, '').replace(/^["']|["']$/g, '').trim(), line: i + 1 };
};

/** The ticked boxes under an Acceptance heading: [{ text, line }]. */
const ticked = text => {
  const out = [];
  let inAcceptance = false;
  String(plain(text) ?? '').split('\n').forEach((l, i) => {
    const h = /^#{1,6}\s+(.*)$/.exec(l);
    if (h) { inAcceptance = /acceptance/i.test(h[1]); return; }
    const m = /^\s*[-*]\s+\[[xX]\]\s+(.*)$/.exec(l);
    if (inAcceptance && m) out.push({ text: m[1].trim(), line: i + 1 });
  });
  return out;
};

const showAt = (root, ref, path) => { const r = git(root, ['show', `${ref}:${path}`], { allowFail: true }); return r.status === 0 ? r.stdout : null; };
const firstAdded = (root, base, head, path) => {
  const diff = git(root, ['diff', '-U0', '--no-color', '--no-ext-diff', base, head, '--', path]);
  const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/m.exec(diff);
  return h ? Math.max(1, Number(h[1])) : 1;
};

/**
 * What a guard checked, before any code of the agent's runs (PR #59): HEAD,
 * and the tracked tree and index as git status says them. The gate, a perf
 * check or a build is the agent's code, and could commit or stage after the
 * checks passed; heldProblems says so, so a guard never passes a commit it
 * did not check.
 */
export function treeState(root) {
  const gitDir = git(root, ['rev-parse', '--absolute-git-dir']);
  // A linked worktree's own git dir, and the common one its config, hooks, attributes and refs live in (#82).
  const gitDirs = [...new Set([gitDir, git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])])];
  const head = sha(root, 'HEAD');
  return { head, status: git(root, ['status', '--porcelain', '--untracked-files=no']), gitDir, gitDirs, pointer: gitPointer(root, gitDir), gitFiles: gitDirsPrint(gitDirs), flags: indexFlags(root), files: trackedPrint(root, head) };
}
/**
 * Where the checkout's git dir is, as the disk says (#82): the .git entry (a
 * linked worktree's pointer file, or that it is the git dir itself) and the
 * git dir's commondir. Code that rewrote either would have keel's next git
 * read another git dir, its config and filters with it.
 */
export function gitPointer(root, gitDir) {
  const read = p => { try { const st = lstatSync(p); return st.isDirectory() ? 'dir' : st.isSymbolicLink() ? `link:${readlinkSync(p)}` : `file:${readFileSync(p, 'utf8')}`; } catch (e) { if (e.code === 'ENOENT') return 'missing'; throw e; } };
  return `${read(join(root, '.git'))}\0${read(join(gitDir, 'commondir'))}`;
}
/** Each git dir's print (gitDirPrint), the worktree's and the common one. */
const gitDirsPrint = dirs => dirs.map(gitDirPrint).join(',');
/**
 * The index entries git status is told not to look at (PR #59): an
 * assume-unchanged (a lower-case tag in ls-files -v) or skip-worktree (S)
 * entry hides an edit from status, so the guard reads the flags, and the
 * files themselves (trackedPrint), apart from it.
 */
export function indexFlags(root) {
  return pathsOf(root, ['ls-files', '-v']).filter(e => !e.startsWith('H ')).sort().join('\0');
}
/**
 * Every file HEAD's tree names, as its bytes are on disk (PR #59), read from
 * disk, never through git status or the index: a hash of each path and what
 * is there (the bytes, a link's target, or that it is missing).
 */
export function trackedPrint(root, head) {
  const h = createHash('sha256');
  for (const rel of pathsOf(root, ['ls-tree', '-r', '--name-only', head])) {
    const p = join(root, rel);
    let v;
    // The bytes themselves, length first (PR #59): never a string of them, which a large file cannot be.
    let bytes = null;
    try { const st = lstatSync(p); if (st.isSymbolicLink()) v = `link:${readlinkSync(p)}`; else if (st.isFile()) { bytes = readFileSync(p); v = `file:${bytes.length}`; } else v = `kind:${st.mode}`; }
    catch (e) { if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e; v = 'missing'; }
    h.update(`${rel}\0${v}\0`);
    if (bytes) h.update(bytes);
  }
  return h.digest('hex');
}
/**
 * The git dir's files that make git run a command (PR #59), read from disk,
 * never through git: its config (core.hooksPath, fsmonitor, a filter's
 * clean command, an alias), its hooks, and info/attributes (which names the
 * filters), and its replace refs (refs/replace/, which change what a commit
 * is to every git command that does not set core.useReplaceRefs=false, and
 * packed-refs, which can hold them). A hash of each path and its bytes,
 * length first, as trackedPrint's.
 */
export function gitDirPrint(gitDir) {
  const h = createHash('sha256');
  const add = rel => { const p = join(gitDir, rel); try { const st = lstatSync(p); if (st.isDirectory()) { for (const n of readdirSync(p).sort()) add(join(rel, n)); return; } if (st.isSymbolicLink()) { h.update(`${rel}\0link:${readlinkSync(p)}\0`); return; } const bytes = readFileSync(p); h.update(`${rel}\0file:${bytes.length}\0`); h.update(bytes); } catch (e) { if (e.code !== 'ENOENT') throw e; } };
  for (const rel of ['config', 'config.worktree', 'hooks', 'info/attributes', 'refs/replace', 'packed-refs']) add(rel);
  return h.digest('hex');
}
/** What moved since `before` (treeState): [problem]. `what` names the code that ran. */
export function heldProblems(root, before, what) {
  // The git dir first, from disk: a hook or a config it planted must never run, so no git is asked until it is clean.
  // Where it is, before what is in it (#82): a .git or commondir pointed elsewhere is another git dir altogether.
  if (before.pointer !== undefined && gitPointer(root, before.gitDir) !== before.pointer) return [`${what} changed where the checkout's git dir is (its .git entry or the git dir's commondir) after the guard's checks: nothing is taken, and no git command of keel's runs on it`];
  if (gitDirsPrint(before.gitDirs ?? [before.gitDir]) !== before.gitFiles) return [`${what} changed the git dir's config, hooks or attributes, or its replace refs (${(before.gitDirs ?? [before.gitDir]).join(', ')}) after the guard's checks: nothing is taken, and no git command of keel's runs on it`];
  const now = treeState(root), out = [];
  if (now.head !== before.head) out.push(`${what} moved HEAD from ${before.head.slice(0, 7)} to ${now.head.slice(0, 7)} after the guard's checks: only ${before.head.slice(0, 7)} was checked, so nothing is taken`);
  if (now.status !== before.status) out.push(`${what} changed the tracked tree or the index after the guard's checks (git status: ${now.status.split('\n').filter(Boolean).slice(0, 3).join('; ') || 'clean'}): nothing is taken`);
  else if (now.flags !== before.flags) out.push(`${what} set or cleared an index flag after the guard's checks (assume-unchanged or skip-worktree: ${now.flags.split('\0').filter(Boolean).slice(0, 3).join('; ') || 'none now'}); git status cannot see an edit behind one, so nothing is taken`);
  else if (now.files !== before.files) out.push(`${what} changed a tracked file after the guard's checks (read from disk, though git status says nothing changed): nothing is taken`);
  return out;
}

/**
 * The package.json files whose "scripts" the branch changed (PR #59):
 * [{ path, keys }]. The gate's test ledger records are written while those
 * scripts run, so a branch that changed them wrote the records that judge it.
 */
export function scriptsChanged(root, base, head) {
  const out = [];
  for (const { path } of changesOf(root, base, head)) {
    if (basename(path) !== 'package.json') continue;
    let b, a;
    try { b = JSON.parse(showAt(root, base, path) ?? '{}')?.scripts ?? {}; a = JSON.parse(showAt(root, head, path) ?? '{}')?.scripts ?? {}; }
    catch { out.push({ path, keys: ['(not JSON)'] }); continue; }
    const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(k => b[k] !== a[k]).sort();
    if (keys.length) out.push({ path, keys });
  }
  return out;
}

/**
 * The items of `after` that `before` does not have, by occurrence (PR #59):
 * each item of `before` covers one item of `after` with the same key, so an
 * identical line ticked elsewhere never covers a box newly ticked.
 */
export function added(before, after, key) {
  const left = new Map();
  for (const x of before) left.set(key(x), (left.get(key(x)) ?? 0) + 1);
  return after.filter(x => { const n = left.get(key(x)) ?? 0; if (n) { left.set(key(x), n - 1); return false; } return true; });
}

/**
 * The tend guard over base..head: { refused: [string] }. Refuses, naming the
 * line: any file added or edited under docs/evidence/; a front-matter status
 * changed to built, lived-in or accepted; an acceptance box ticked; any
 * tracked file deleted (a rename is a deletion here); any file outside
 * TEND_SURFACES; and a commit that cites no finding (`Tend: <id>`) from the
 * worksheet.
 */
export function tendCheck(root, base, head, { findings = null } = {}) {
  const refused = [];
  const changes = changesOf(root, base, head);
  for (const { status, path } of changes) {
    if (status.startsWith('D')) { refused.push(`${path}: deleted; tend never deletes a tracked file (a branch, a PR or data alike): propose it for the owner instead`); continue; }
    if (path.startsWith('docs/evidence/')) { refused.push(`${path}:${firstAdded(root, base, head, path)}: ${status.startsWith('A') ? 'adds' : 'edits'} evidence; tend never writes evidence (what was checked is a person's or the conductor's record)`); continue; }
    if (!tendSurface(path)) { refused.push(`${path}: outside tend's surfaces (${TEND_SURFACES.join(', ')}); tend changes records and agent-facing text only, cited or not`); continue; }
    const before = showAt(root, base, path), after = showAt(root, head, path);
    const a = frontStatus(after), b = frontStatus(before);
    if (a && NEVER_STATUS.includes(a.status) && a.status !== b?.status) refused.push(`${path}:${a.line}: status ${b?.status ?? '(none)'} → ${a.status}; tend never marks a phase built, lived-in or accepted (it may only propose a step back to partial)`);
    for (const x of added(ticked(before), ticked(after), x => x.text)) refused.push(`${path}:${x.line}: ticks an acceptance box ("${x.text.slice(0, 80)}"); tend never accepts a phase`);
  }
  const known = findings ? new Set(findings.map(f => f.id)) : null;
  for (const c of git(root, ['log', '--format=%H%x00%B%x01', `${base}..${head}`]).split('\x01').map(s => s.trim()).filter(Boolean)) {
    const [id, body] = c.split('\x00');
    const cited = [...(body ?? '').matchAll(CITE)].map(m => m[1]);
    const subject = (body ?? '').split('\n')[0];
    if (!cited.length) refused.push(`${id.slice(0, 7)} "${subject}": cites no finding; every tend commit carries a "Tend: <finding id>" line from the worksheet`);
    else if (known) for (const f of cited.filter(f => !known.has(f))) refused.push(`${id.slice(0, 7)} "${subject}": cites ${f}, which is not on the worksheet`);
  }
  return { refused, files: changes.map(c => c.path) };
}

/** guard --job tend: the tend guard, then the project's gate. { ok, problems, line? }. */
export async function tendGuard({ root, config, env = process.env, base, check = 'npm run check' }) {
  const pass = await readPass(root);
  const trusted = recordBase(root, base, pass?.base, PASS);
  if (trusted.problem) return { ok: false, job: 'tend', refused: [trusted.problem], problems: [trusted.problem] };
  base = trusted.base;
  if (!base) throw new TendError('guard --job tend needs --base <ref> (or an open pass: tend-input --record)');
  const head = sha(root, 'HEAD'), b = sha(root, base);
  if (head === b) return { ok: true, skipped: true, line: 'nothing changed: HEAD is the base, so there is nothing to guard', problems: [] };
  const off = sandboxProblems(root, b, head);
  if (off.length) return { ok: false, job: 'tend', refused: off, problems: off };
  const { refused } = tendCheck(root, b, head, { findings: pass?.worksheet?.findings ?? null });
  if (refused.length) return { ok: false, job: 'tend', refused, problems: refused };
  const gate = config.check ?? check;
  const before = treeState(root);
  const r = spawnSync(gate, { cwd: root, shell: true, env: gateEnv(env, config), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 60 * 60_000 });
  if (r.error) throw new TendError(`could not run the gate \`${gate}\`: ${r.error.message}`);
  if (r.status !== 0) return { ok: false, job: 'tend', problems: [`the gate \`${gate}\` failed (exit ${r.status ?? r.signal}) on ${head.slice(0, 7)}`] };
  const moved = heldProblems(root, before, `the gate \`${gate}\``);
  if (moved.length) return { ok: false, job: 'tend', refused: moved, problems: moved };
  const line = `\`${gate}\` exit 0 on ${head.slice(0, 7)}; the tend guard passed (no evidence written, no status marked built, lived-in or accepted, no box ticked, nothing deleted, nothing outside its surfaces, every commit cites a finding)`;
  if (pass) { pass.gate = line; await writePass(root, pass); }
  return { ok: true, job: 'tend', line, problems: [] };
}

// ---- the report -------------------------------------------------------------------

/** The trailer tend-page's commit carries: the judge's page, not a fix. */
export const PAGE_TRAILER = 'keel-tend-page';
const PAGE_SUBJECT = /^keel tend: (\d{4}-\d{2}-\d{2}), \d+ proposals? for the owner$/;

/**
 * The commits since the base, each with the findings it cites: [{ sha,
 * subject, cites, page? }]. The judge's own page commit (tend-page's: its
 * subject, its trailer naming the date, and nothing changed but that date's
 * page) cites what it proposes so the guard accepts it, but it resolves
 * nothing: it is marked `page` and its cites are not counted (ledger#95: a
 * proposed loose end, an owner's step, was reported resolved and dropped).
 */
export function tendCommits(root, base, head = 'HEAD') {
  return git(root, ['log', '--reverse', '--format=%H%x00%B%x01', `${base}..${head}`]).split('\x01').map(s => s.trim()).filter(Boolean).map(c => {
    const [id, body] = c.split('\x00');
    const subject = (body ?? '').split('\n')[0];
    const cites = [...(body ?? '').matchAll(CITE)].map(m => m[1]);
    const day = PAGE_SUBJECT.exec(subject)?.[1];
    if (day && new RegExp(`^${PAGE_TRAILER}: ${day}$`, 'm').test(body ?? '')) {
      const files = pathsOf(root, ['diff-tree', '--no-commit-id', '--name-only', '--no-renames', '-r', id]);
      if (files.length === 1 && files[0] === proposalsPageOf(day)) return { sha: id, subject, cites: [], page: true };
    }
    return { sha: id, subject, cites };
  });
}

/** The impact declaration a tend PR carries (phase 26): the records it edits, or none. */
export function tendImpact(files) {
  const phases = files.filter(p => (/^docs\/phases\/.*\.md$/.test(p) && !/\/README\.md$/i.test(p)) || /^docs\/projects\/.*\/phases\.md$/.test(p)).sort();
  const decisions = files.filter(p => /^docs\/decisions\/.*\.md$/.test(p) && !/\/README\.md$/i.test(p)).sort();
  return phases.length || decisions.length
    ? { version: 1, phases, decisions, supersedes: [], evidence: [], reconciliation: 'updated', reason: 'The weekly tend pass brings these records in line with the night\'s findings; a person merges it.' }
    : { version: 1, phases: [], decisions: [], supersedes: [], evidence: [], reconciliation: 'none', reason: 'The weekly tend pass edits no phase or decision record.' };
}

/** Where a pass's proposals for the owner go: a dated page the PR carries, so a pass that only proposes still reaches a person. */
export const TEND_PAGES = 'docs/tend';
/** A pass's date: exactly YYYY-MM-DD, a real day. */
export const isDay = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
/**
 * The page's path, directly under docs/tend/. The date is the pass record's,
 * which the agent's job hands back, so it is held to a day (ledger#94: a date
 * of "../evidence/x" would write evidence), and the judge passes the run's
 * own (--date) and refuses a record naming another.
 */
export function proposalsPageOf(date) {
  if (!isDay(date)) throw new TendError(`the pass's date ${JSON.stringify(date)} is not a day (YYYY-MM-DD): no page is written from it`);
  return `${TEND_PAGES}/${date}.md`;
}
/** The pass's date, held to a day and, with `given` (the run's), to the run's. */
export function passDate(pass, given, record = PASS) {
  if (given !== undefined && given !== null && !isDay(given)) throw new TendError(`--date ${JSON.stringify(given)} is not a day (YYYY-MM-DD)`);
  if (!isDay(pass.date)) throw new TendError(`${record} names its date ${JSON.stringify(pass.date)}, which is not a day (YYYY-MM-DD)`);
  if (given && pass.date !== given) throw new TendError(`${record} names its date ${pass.date}, not the run's ${given} (--date): a record's date is the agent's to write, so the judge trusts only the run's`);
  return pass.date;
}
/** What the page carries: every proposal the pass's notes make, in their order. */
export const pageProposals = pass => (pass.notes ?? []).filter(n => n.kind === 'proposed');

/**
 * The finding ids the re-run on the branch still reports, and whether it
 * could tell for a finding: { still: Set, ran(finding) }. A source that did
 * not run after (n/a, or no re-run) cannot tell, so nothing it owns is resolved.
 */
function remeasured(after) {
  const still = new Set();
  const told = new Set();
  for (const m of after?.measures ?? []) {
    if (m.state === 'n/a') continue;
    const fs = m.findings ?? (m.value > 0 ? null : []);
    if (!fs) continue;
    told.add(m.id);
    for (const f of fs) still.add(f.id);
  }
  if (after?.reconciliation?.state === 'ok') { told.add('reconciliation'); for (const f of after.reconciliation.findings ?? []) still.add(f.id); }
  return { still, ran: f => told.has(f.measure) };
}

/**
 * The PR body's input (scripts/keel/pr-body.mjs) and the pass's line, from the
 * pass record, its commits, the files they change, and the record measures
 * run again on the branch (`after`, the same shape as the worksheet's). A
 * finding is resolved when a commit cites it and the re-run no longer reports
 * it; cited but still reported, it was tried (ledger#92). Loose ends are the
 * machine's, not re-measured: citing one resolves it. `page` is the proposals
 * page this pass committed, when it proposed anything.
 */
export function tendReportOf(pass, { commits = [], files = [], after = null, now = new Date(), page = null } = {}) {
  const w = pass.worksheet;
  const minutes = Math.max(0, Math.round((now - new Date(pass.started)) / 60_000));
  const byId = new Map(w.findings.map(f => [f.id, f]));
  const cited = new Map();
  for (const c of commits) for (const id of c.cites) if (byId.has(id)) cited.set(id, [...(cited.get(id) ?? []), c]);
  const { still, ran } = remeasured(after);
  const resolved = new Map(), stillThere = new Map();
  for (const [id, cs] of cited) {
    const f = byId.get(id);
    if (f.measure === 'loose-ends' || (ran(f) && !still.has(id))) resolved.set(id, cs);
    else stillThere.set(id, cs);
  }
  const notes = pass.notes ?? [];
  const proposed = notes.filter(n => n.kind === 'proposed' && !resolved.has(n.finding));
  const tried = new Map(notes.filter(n => n.kind === 'tried').map(n => [n.finding, n.text]));
  const triedText = id => {
    const cs = stillThere.get(id);
    const by = cs ? `${cs.map(c => `${c.sha.slice(0, 7)} ("${c.subject}")`).join(', ')} cited it, but ${ran(byId.get(id)) ? 'the re-run on the branch still reports it' : 'its measure did not run again on the branch, so it is not shown resolved'}.` : null;
    return [by, tried.get(id)].filter(Boolean).join(' ') || null;
  };
  const unresolved = w.findings.filter(f => !resolved.has(f.id) && !proposed.some(p => p.finding === f.id)).map(f => ({ id: f.id, what: f.what, tried: triedText(f.id) }));
  const before = w.count, afterCount = after ? recordCount(after) : null;
  const countText = `record count ${before} → ${afterCount ?? '?'}`;
  const line = `Tend ${pass.date}: resolved ${resolved.size} of ${w.findings.length} finding${w.findings.length === 1 ? '' : 's'} (${countText}); ${proposed.length} proposed for the owner; ${unresolved.length} unresolved${unresolved.length ? `: ${unresolved.slice(0, 5).map(u => u.id).join(', ')}${unresolved.length > 5 ? ', …' : ''}` : ''}; ${minutes} min`;
  const summary = { pass: { date: pass.date, resolved: [...resolved.keys()], proposed: proposed.map(p => ({ finding: p.finding, text: p.text })), unresolved, before, after: afterCount, ...(page ? { page } : {}) } };
  if (!commits.length) return { ...summary, minutes, line, input: null };
  const measureRows = w.measures.map(m => {
    const a = after?.measures.find(x => x.id === m.id);
    const show = x => (x ? (x.state === 'n/a' ? 'n/a' : String(x.value)) : '—');
    return { what: `\`${m.id}\``, before: show(m), after: show(a) };
  });
  const rec = s => (s?.state === 'ok' ? String(s.findings.length) : 'n/a');
  const input = {
    summary: {
      lead: `tend ${pass.date}: ${resolved.size} of ${w.findings.length} record findings resolved (each cited by its commit and gone from the re-run)${proposed.length ? `, ${proposed.length} proposed for the owner${page ? ` in ${page}` : ''}` : ''}; the owner merges.`,
      table: {
        head: ['Finding', 'What was done'],
        rows: [
          ...[...resolved].map(([id, cs]) => [`\`${id}\`: ${byId.get(id).what}`, cs.map(c => `${c.subject} (${c.sha.slice(0, 7)})`).join('; ')]),
          ...[...stillThere].map(([id, cs]) => [`\`${id}\`: ${byId.get(id).what}`, `tried, not resolved: ${cs.map(c => `${c.subject} (${c.sha.slice(0, 7)})`).join('; ')}; the re-run still reports it`]),
          ...(page ? proposed.map(p => [`\`${p.finding}\`: ${byId.get(p.finding)?.what ?? p.finding}`, `proposed for the owner in ${page}`]) : []),
        ],
      },
    },
    evidence: {
      gate: pass.gate ?? (commits.some(c => c.cites.length) ? 'not run: the tend guard did not record a gate line' : 'not run: the agent committed nothing, so there was nothing to gate'),
      columns: ['Before (the worksheet)', 'After (this branch)'],
      rows: [...measureRows, { what: 'reconciliation findings', before: rec(w.reconciliation), after: rec(after?.reconciliation) }, { what: '**record count**', before: String(before), after: afterCount === null ? '—' : String(afterCount) }],
    },
    danger: {
      door: 'two-way',
      why: 'records and docs only (phases, roadmap, README, agent-facing text); no evidence written, nothing marked built, nothing deleted; reverting the merge restores them',
      surfaces: [],
      within: 'records and docs',
    },
    notes: [
      proposed.length ? `For the owner to choose (tend only proposes these):\n\n${proposed.map(p => `- [ ] \`${p.finding}\`: ${p.text}`).join('\n')}` : 'Nothing was left to the owner to choose.',
      unresolved.length ? `Unresolved (they stay on the health page, with what tend tried):\n\n${unresolved.map(u => `- \`${u.id}\`: ${u.what}${u.tried ? ` Tried: ${u.tried}` : ''}`).join('\n')}` : 'Every finding on the worksheet was resolved or proposed.',
      `Every count here is scripts/keel/climb.mjs tend-input's: the night's record measures run on the base and again on this branch. ${minutes} min. Nothing here merges without a person.`,
    ],
    impact: { declaration: tendImpact(files) },
  };
  return { ...summary, minutes, line, input };
}

/** The proposals page a pass commits: what tend leaves to the owner, as a checklist. */
export function proposalsPage(pass, proposed) {
  const what = new Map(pass.worksheet.findings.map(f => [f.id, f.what]));
  return [
    `# Tend ${pass.date}: for the owner`, '',
    'The weekly tend pass found these on its worksheet and may only propose them (`.agents/climb/TEND.md`): each is yours to choose. `scripts/keel/climb.mjs tend-page` wrote this page from the pass\'s notes; the pass\'s pull request carries it.', '',
    ...proposed.map(p => `- [ ] \`${p.finding}\`: ${what.get(p.finding) ?? ''}\n  Proposed: ${p.text.replace(/\s*\n\s*/g, ' ')}`), '',
  ].join('\n');
}

/**
 * tend-page: what tend leaves to the owner reaches the owner. The judge
 * (never the agent) commits it as docs/tend/<date>.md, before the guard, so
 * the tend guard and the gate see the tree that is pushed (ledger#94), and a
 * pass that only proposed opens a PR too. The commit cites each finding it
 * proposes for. { page, committed, proposed }.
 */
export async function tendPage({ root, input, base, date }) {
  const pass = await readPass(root, input);
  if (!pass) throw new TendError(`no pass record at ${input ?? PASS}`);
  const trusted = recordBase(root, base, pass.base, input ?? PASS);
  if (trusted.problem) throw new TendError(trusted.problem);
  const day = passDate(pass, date, input ?? PASS);
  const proposed = pageProposals(pass);
  if (!proposed.length) return { page: null, committed: false, proposed: 0 };
  const page = proposalsPageOf(day);
  await mkdir(join(root, TEND_PAGES), { recursive: true });
  await writeFile(join(root, page), proposalsPage(pass, proposed));
  let committed = false;
  if (git(root, ['status', '--porcelain', '--', page])) {
    git(root, ['add', '--', page]);
    const cites = [...new Set(proposed.map(p => p.finding))].map(f => `Tend: ${f}`).join('\n');
    git(root, ['commit', '-q', '-m', `keel tend: ${day}, ${plural(proposed.length, 'proposal')} for the owner\n\n${cites}\n${PAGE_TRAILER}: ${day}`, '--', page]);
    committed = true;
  }
  return { page, committed, proposed: proposed.length };
}

export async function tendReport({ root, config, env = process.env, body, input, base, date }) {
  const pass = await readPass(root, input);
  if (!pass) throw new TendError(`no pass record at ${input ?? PASS}`);
  const trusted = recordBase(root, base, pass.base, input ?? PASS);
  if (trusted.problem) throw new TendError(trusted.problem);
  pass.base = trusted.base;
  const day = passDate(pass, date, input ?? PASS);
  // The page is tend-page's, committed before the guard: the report writes
  // nothing to the tree, so what is pushed is what was gated.
  let page = null;
  if (pageProposals(pass).length) {
    page = proposalsPageOf(day);
    if (showAt(root, 'HEAD', page) !== proposalsPage(pass, pageProposals(pass))) throw new TendError(`${page} is not committed as the pass's notes say: climb.mjs tend-page runs before the guard`);
  }
  const changed = () => pathsOf(root, ['diff', '--name-only', '--no-renames', pass.base, 'HEAD']);
  const commits = tendCommits(root, pass.base);
  const proposing = Boolean(page);
  const after = commits.length || proposing ? { measures: await recordMeasures(root, config, env), reconciliation: reconciliationOf(root, config, env) } : null;
  const r = tendReportOf(pass, { commits, files: changed(), after, page });
  let text = null;
  if (r.input) {
    text = prBody(r.input);
    if (body) await writeFile(body, text);
  }
  Object.assign(pass, { line: r.line, resolved: r.pass.resolved, proposed: r.pass.proposed, unresolved: r.pass.unresolved, after: r.pass.after, commits: commits.length, ...(page ? { page } : {}) });
  await writePass(root, pass);
  return { date: pass.date, commits: commits.length, line: r.line, text, body: text && body ? body : null, ...r.pass };
}
