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
//   tend-report [--body f]          the measures again on the branch, the PR body, the line
//
// It never writes evidence, never marks built, lived-in or accepted, never
// deletes, never merges: the guard refuses the first three, naming the line;
// the workflow's rights refuse the last.
import { readFile, writeFile, mkdir, readdir, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gateEnv, healthDirOf, cells } from './lib.mjs';
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
  for (const k of Object.keys(t)) if (!['schedule', 'budget'].includes(k)) out.push(`"tend" has an unknown key ${k} (schedule, budget)`);
  if (t.schedule !== undefined && t.schedule !== 'weekly') out.push(`"tend".schedule must be "weekly" (got ${JSON.stringify(t.schedule)}; nightly is deliberately open in keel phase 38)`);
  if (t.budget !== undefined) {
    if (!t.budget || typeof t.budget !== 'object' || Array.isArray(t.budget) || Object.keys(t.budget).some(k => k !== 'minutes')) out.push('"tend".budget must be { minutes }');
    else if (!(Number.isInteger(t.budget.minutes) && t.budget.minutes >= MINUTES[0] && t.budget.minutes <= MINUTES[1])) out.push(`"tend".budget.minutes must be a whole number from ${MINUTES[0]} to ${MINUTES[1]} (got ${JSON.stringify(t.budget.minutes)})`);
  }
  return out;
}

/** The tend settings, defaults filled in; null when tend is off. A bad "tend" throws (exit 2). */
export function tendConfigOf(config) {
  const problems = tendProblems(config);
  if (problems.length) throw new TendError(`.keel/keel.json: ${problems.join('; ')}`);
  const t = config?.tend;
  if (t === undefined) return null;
  return { schedule: t.schedule ?? TEND_DEFAULTS.schedule, minutes: t.budget?.minutes ?? TEND_DEFAULTS.minutes };
}

// ---- small tools ---------------------------------------------------------------

function git(cwd, args, { allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
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
  const project = mine.find(({ p, dir }) => (config.repo && p.repo === config.repo) || dir === here)?.p;
  if (!project) return { state: 'n/a', why: `keel loose-ends lists no project for ${config.repo ?? here}`, findings: [] };
  const findings = (project.items ?? []).map(it => ({ id: `loose:${it.fingerprint ?? it.id}`, measure: 'loose-ends', what: `${it.kind}: ${it.title}${it.move ? ` → ${it.move}` : ''}${it.commands?.length ? ` (${it.commands.join('; ')})` : ''}` }));
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

const frontStatus = text => {
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
  String(text ?? '').split('\n').forEach((l, i) => {
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
 * The tend guard over base..head: { refused: [string] }. Refuses, naming the
 * line: any file added or edited under docs/evidence/; a front-matter status
 * changed to built, lived-in or accepted; an acceptance box ticked; any
 * tracked file deleted (a rename is a deletion here); and a commit that cites
 * no finding (`Tend: <id>`) from the worksheet.
 */
export function tendCheck(root, base, head, { findings = null } = {}) {
  const refused = [];
  const changes = git(root, ['diff', '--name-status', '--no-renames', base, head]).split('\n').filter(Boolean).map(l => { const [s, ...p] = l.split('\t'); return { status: s, path: p.join('\t') }; });
  for (const { status, path } of changes) {
    if (status.startsWith('D')) { refused.push(`${path}: deleted; tend never deletes a tracked file (a branch, a PR or data alike): propose it for the owner instead`); continue; }
    if (path.startsWith('docs/evidence/')) { refused.push(`${path}:${firstAdded(root, base, head, path)}: ${status.startsWith('A') ? 'adds' : 'edits'} evidence; tend never writes evidence (what was checked is a person's or the conductor's record)`); continue; }
    if (!path.endsWith('.md')) continue;
    const before = showAt(root, base, path), after = showAt(root, head, path);
    const a = frontStatus(after), b = frontStatus(before);
    if (a && NEVER_STATUS.includes(a.status) && a.status !== b?.status) refused.push(`${path}:${a.line}: status ${b?.status ?? '(none)'} → ${a.status}; tend never marks a phase built, lived-in or accepted (it may only propose a step back to partial)`);
    const was = new Set(ticked(before).map(x => x.text));
    for (const x of ticked(after)) if (!was.has(x.text)) refused.push(`${path}:${x.line}: ticks an acceptance box ("${x.text.slice(0, 80)}"); tend never accepts a phase`);
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
  base ??= pass?.base;
  if (!base) throw new TendError('guard --job tend needs --base <ref> (or an open pass: tend-input --record)');
  const head = sha(root, 'HEAD'), b = sha(root, base);
  if (head === b) return { ok: true, skipped: true, line: 'nothing changed: HEAD is the base, so there is nothing to guard', problems: [] };
  const { refused } = tendCheck(root, b, head, { findings: pass?.worksheet?.findings ?? null });
  if (refused.length) return { ok: false, job: 'tend', refused, problems: refused };
  const gate = config.check ?? check;
  const r = spawnSync(gate, { cwd: root, shell: true, env: gateEnv(env, config), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 60 * 60_000 });
  if (r.error) throw new TendError(`could not run the gate \`${gate}\`: ${r.error.message}`);
  if (r.status !== 0) return { ok: false, job: 'tend', problems: [`the gate \`${gate}\` failed (exit ${r.status ?? r.signal}) on ${head.slice(0, 7)}`] };
  const line = `\`${gate}\` exit 0 on ${head.slice(0, 7)}; the tend guard passed (no evidence written, no status marked built, lived-in or accepted, no box ticked, nothing deleted, every commit cites a finding)`;
  if (pass) { pass.gate = line; await writePass(root, pass); }
  return { ok: true, job: 'tend', line, problems: [] };
}

// ---- the report -------------------------------------------------------------------

/** The commits since the base, each with the findings it cites: [{ sha, subject, cites }]. */
export function tendCommits(root, base, head = 'HEAD') {
  return git(root, ['log', '--reverse', '--format=%H%x00%B%x01', `${base}..${head}`]).split('\x01').map(s => s.trim()).filter(Boolean).map(c => {
    const [id, body] = c.split('\x00');
    return { sha: id, subject: (body ?? '').split('\n')[0], cites: [...(body ?? '').matchAll(CITE)].map(m => m[1]) };
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

/**
 * The PR body's input (scripts/keel/pr-body.mjs) and the pass's line, from the
 * pass record, its commits, the files they change, and the record measures
 * run again on the branch (`after`, the same shape as the worksheet's).
 */
export function tendReportOf(pass, { commits = [], files = [], after = null, now = new Date() } = {}) {
  const w = pass.worksheet;
  const minutes = Math.max(0, Math.round((now - new Date(pass.started)) / 60_000));
  const byId = new Map(w.findings.map(f => [f.id, f]));
  const resolved = new Map();
  for (const c of commits) for (const id of c.cites) if (byId.has(id)) resolved.set(id, [...(resolved.get(id) ?? []), c]);
  const notes = pass.notes ?? [];
  const proposed = notes.filter(n => n.kind === 'proposed' && !resolved.has(n.finding));
  const tried = new Map(notes.filter(n => n.kind === 'tried').map(n => [n.finding, n.text]));
  const unresolved = w.findings.filter(f => !resolved.has(f.id) && !proposed.some(p => p.finding === f.id)).map(f => ({ id: f.id, what: f.what, tried: tried.get(f.id) ?? null }));
  const before = w.count, afterCount = after ? recordCount(after) : null;
  const countText = `record count ${before} → ${afterCount ?? '?'}`;
  const line = `Tend ${pass.date}: resolved ${resolved.size} of ${w.findings.length} finding${w.findings.length === 1 ? '' : 's'} (${countText}); ${proposed.length} proposed for the owner; ${unresolved.length} unresolved${unresolved.length ? `: ${unresolved.slice(0, 5).map(u => u.id).join(', ')}${unresolved.length > 5 ? ', …' : ''}` : ''}; ${minutes} min`;
  const summary = { pass: { date: pass.date, resolved: [...resolved.keys()], proposed: proposed.map(p => ({ finding: p.finding, text: p.text })), unresolved, before, after: afterCount } };
  if (!commits.length) return { ...summary, minutes, line, input: null };
  const measureRows = w.measures.map(m => {
    const a = after?.measures.find(x => x.id === m.id);
    const show = x => (x ? (x.state === 'n/a' ? 'n/a' : String(x.value)) : '—');
    return { what: `\`${m.id}\``, before: show(m), after: show(a) };
  });
  const rec = s => (s?.state === 'ok' ? String(s.findings.length) : 'n/a');
  const input = {
    summary: {
      lead: `tend ${pass.date}: ${resolved.size} of ${w.findings.length} record findings resolved, each commit citing its finding; the owner merges.`,
      table: {
        head: ['Finding', 'What was done'],
        rows: [...resolved].map(([id, cs]) => [`\`${id}\`: ${byId.get(id).what}`, cs.map(c => `${c.subject} (${c.sha.slice(0, 7)})`).join('; ')]),
      },
    },
    evidence: {
      gate: pass.gate ?? 'not run: the tend guard did not record a gate line',
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

export async function tendReport({ root, config, env = process.env, body, input }) {
  const pass = await readPass(root, input);
  if (!pass) throw new TendError(`no pass record at ${input ?? PASS}`);
  const commits = tendCommits(root, pass.base);
  const files = git(root, ['diff', '--name-only', '--no-renames', pass.base, 'HEAD']).split('\n').filter(Boolean);
  const after = commits.length ? { measures: await recordMeasures(root, config, env), reconciliation: reconciliationOf(root, config, env) } : null;
  const r = tendReportOf(pass, { commits, files, after });
  let text = null;
  if (r.input) {
    text = prBody(r.input);
    if (body) await writeFile(body, text);
  }
  Object.assign(pass, { line: r.line, resolved: r.pass.resolved, proposed: r.pass.proposed, unresolved: r.pass.unresolved, after: r.pass.after, commits: commits.length });
  await writePass(root, pass);
  return { date: pass.date, commits: commits.length, line: r.line, text, body: text && body ? body : null, ...r.pass };
}
