// keel doctor: what the project has changed of the practice, and where it
// breaks the practice's own rules. It reports; it changes nothing unless a fix
// is chosen, and a fix needs --yes (phase 3's pattern: exit 3 with the plan).
//
// Drift (design §1: a local edit to a managed file is the most valuable signal)
// compares three hashes per managed file, block and link: the project's bytes
// now, the bytes keel wrote (.keel/lock.json), and keel's current template.
//   edited  now ≠ lock, lock = template   the project changed it
//   behind  now = lock, lock ≠ template   keel moved on (update's job, phase 6)
//   both    now ≠ lock ≠ template         both moved
// A target the lock does not know is taken as written from today's template.
// Only edited and both are findings; behind is reported for update to consume.
//
// Lints: a second copy of a managed skill outside .agents/skills/ (lesson 1),
// a CLAUDE.md that is more than a pointer, a phase the roadmap parser rejects,
// a goal with no phase, a managed symlink replaced by a real directory.
// Local variants (.keel/keel.json "local") are information, and so is a local
// practice adopt's survey would now switch on.
import { readFile, readdir, writeFile, mkdir, lstat, readlink, symlink, rm } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { load, config as readConfig, targets, bytesFor, replaceBlock, blockBody, practiceVersion } from './practices.mjs';
import { readLock, writeLock, sha256, lockKey, driftState } from './lock.mjs';

export { blockBody };
import { survey } from './adopt.mjs';
import { parsePhase } from '../practices/phases/files/scripts/roadmap.mjs';

export const RULES = ['second-copy', 'claude-md-pointer', 'phase', 'goal-without-phase', 'symlink-replaced'];
export const CLAUDE_MD_LINES = 3;
const SKIP = new Set(['.git', 'node_modules']);

class DoctorError extends Error {
  constructor(message, exitCode = 2) { super(message); this.exitCode = exitCode; }
}

const read = path => readFile(path, 'utf8').catch(e => ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(e.code) ? null : Promise.reject(e));
const info = path => lstat(path).catch(e => ['ENOENT', 'ENOTDIR'].includes(e.code) ? null : Promise.reject(e));

/**
 * A unified-style line diff from `a` (keel's) to `b` (the project's), with
 * `context` lines around each change. LCS on lines; no dependencies.
 */
export function lineDiff(a, b, { from = 'keel', to = 'project', context = 3 } = {}) {
  if (a === b) return '';
  const split = t => t === '' ? [] : t.replace(/\n$/, '').split('\n');
  const x = split(a), y = split(b);
  const n = x.length, m = y.length;
  let ops = [];
  if (n * m > 4_000_000) {
    ops = [...x.map(l => ['-', l]), ...y.map(l => ['+', l])];
  } else {
    const w = m + 1, lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = x[i] === y[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && x[i] === y[j]) { ops.push([' ', x[i]]); i++; j++; }
      else if (i < n && (j === m || lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) { ops.push(['-', x[i]]); i++; }
      else { ops.push(['+', y[j]]); j++; }
    }
  }
  // Group changes into hunks with context.
  const out = [`--- ${from}`, `+++ ${to}`];
  const changed = ops.map((o, k) => o[0] !== ' ' ? k : -1).filter(k => k >= 0);
  let k = 0;
  while (k < changed.length) {
    let start = Math.max(0, changed[k] - context), stop = changed[k];
    while (k + 1 < changed.length && changed[k + 1] - stop <= 2 * context) stop = changed[++k];
    stop = Math.min(ops.length - 1, stop + context);
    k++;
    let ai = 0, bi = 0;
    for (let q = 0; q < start; q++) { if (ops[q][0] !== '+') ai++; if (ops[q][0] !== '-') bi++; }
    const hunk = ops.slice(start, stop + 1);
    const al = hunk.filter(o => o[0] !== '+').length, bl = hunk.filter(o => o[0] !== '-').length;
    out.push(`@@ -${al ? ai + 1 : ai},${al} +${bl ? bi + 1 : bi},${bl} @@`, ...hunk.map(([s, l]) => `${s}${l}`));
  }
  if (a && !a.endsWith('\n') || b && !b.endsWith('\n')) out.push('\\ trailing newline differs or is absent');
  return `${out.join('\n')}\n`;
}

/** Every file under root, not following symlinks, skipping .git, node_modules and nested keel projects. */
async function walk(root, dir = root, found = []) {
  let names;
  try { names = await readdir(dir, { withFileTypes: true }); } catch { return found; }
  if (dir !== root && names.some(d => d.name === '.keel') && await info(join(dir, '.keel', 'keel.json'))) return found;
  for (const d of names) {
    if (SKIP.has(d.name)) continue;
    const path = join(dir, d.name);
    if (d.isDirectory()) await walk(root, path, found);
    else if (d.isFile()) found.push(relative(root, path).split(sep).join('/'));
  }
  return found;
}

const skillName = text => /^---\r?\n[\s\S]*?^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(text ?? '')?.[1] ?? null;

/** The project's bytes for one target: { now, lint? }. */
async function current(root, f) {
  const target = join(root, f.path);
  if (f.link !== undefined) {
    const i = await info(target);
    if (!i) return { now: null };
    if (!i.isSymbolicLink()) return { lint: { rule: 'symlink-replaced', path: f.path, message: `${f.path} should be a symlink to ${f.link} (${f.practice}); it is a real ${i.isDirectory() ? 'directory' : 'file'}, so it no longer follows the managed copy` } };
    return { now: await readlink(target) };
  }
  const text = await read(target);
  return { now: f.kind === 'block' ? blockBody(text, f.block) : text };
}

/** Diagnose `root`. Returns { drift, lint, local, qualifies, ejected }. Writes nothing. */
export async function diagnose(root, { practices, version = practiceVersion() } = {}) {
  practices ??= await load();
  const cfg = await readConfig(root);
  const lock = await readLock(root);
  const files = targets(cfg, practices).filter(f => f.kind !== 'seeded');
  const drift = [], lint = [];

  for (const f of files) {
    const key = lockKey(f);
    const template = bytesFor(f, cfg);
    const { now, lint: problem } = await current(root, f);
    if (problem) { lint.push(problem); continue; }
    const locked = lock?.files?.[key]?.sha256 ?? sha256(template);
    const state = driftState(now, locked, template);
    if (state === 'clean') continue;
    drift.push({
      path: key, practice: f.practice, state,
      ...(now === null ? { missing: true } : {}),
      ...(lock?.files?.[key] ? {} : { locked: false }),
      diff: lineDiff(template, now ?? '', { from: `keel ${key}`, to: `project ${key}${now === null ? ' (missing)' : ''}` }),
    });
  }

  // A second copy of a managed skill: any SKILL.md naming one, outside .agents/skills/, not through a symlink.
  const skills = new Map();
  for (const f of files) {
    const m = /^\.agents\/skills\/([^/]+)\/SKILL\.md$/.exec(f.path);
    if (m && f.kind === 'managed') skills.set(skillName(f.template) ?? m[1], f);
  }
  if (skills.size) {
    for (const path of await walk(root)) {
      if (!path.endsWith('SKILL.md') || path.startsWith('.agents/skills/')) continue;
      if (cfg.keel === 'self' && path.startsWith('practices/')) continue; // keel's templates are the source, not a copy
      const name = skillName(await read(join(root, path)));
      const managed = skills.get(name);
      if (managed) lint.push({ rule: 'second-copy', path, message: `a second copy of the ${name} skill (${managed.practice}); the one copy is ${managed.path}, reached by symlink — a copy ages (lesson 1)` });
    }
  }

  if (files.some(f => f.path === 'CLAUDE.md' && f.kind === 'managed')) {
    const text = await read(join(root, 'CLAUDE.md'));
    const lines = text === null ? 0 : text.split('\n').filter(l => l.trim()).length;
    if (lines > CLAUDE_MD_LINES) lint.push({ rule: 'claude-md-pointer', path: 'CLAUDE.md', message: `CLAUDE.md has ${lines} non-empty lines; it should be a pointer to AGENTS.md (at most ${CLAUDE_MD_LINES}), so there is one guide` });
  }

  if (cfg.practices.includes('phases')) {
    const dir = join(root, 'docs', 'phases');
    const names = (await readdir(dir).catch(() => [])).filter(n => n.endsWith('.md') && n !== 'README.md').sort();
    const phases = [];
    for (const file of names) {
      try { phases.push(parsePhase(file, await read(join(dir, file)))); }
      catch (e) { lint.push({ rule: 'phase', path: `docs/phases/${file}`, message: e.message }); }
    }
    let goals = [];
    try { goals = JSON.parse((await read(join(root, 'docs', 'goals.json'))) ?? '[]'); } catch { goals = []; }
    if (Array.isArray(goals)) for (const g of goals) {
      if (g?.id && !phases.some(p => p.goal === g.id)) lint.push({ rule: 'goal-without-phase', path: 'docs/goals.json', message: `${g.id}: no phase serves this goal` });
    }
  }

  const local = cfg.local ?? {};
  let qualifies = [];
  if (Object.keys(local).length) {
    try {
      const s = await survey(root, { version: { practice: version }, practices });
      qualifies = s.practices.filter(p => Object.hasOwn(local, p.name) && p.state === 'on').map(p => p.name);
    } catch { qualifies = []; } // a survey that cannot run says nothing; the report stands without it
  }
  return { drift, lint, local, qualifies, ejected: cfg.ejected ?? [] };
}

export const findings = r => r.drift.filter(d => d.state === 'edited' || d.state === 'both').length + r.lint.length;

/** Apply one fix. Returns the plan; writes only with yes. */
async function applyFix(root, key, action, { practices, version, yes }) {
  if (!['restore', 'eject'].includes(action)) throw new DoctorError('--fix takes <path> restore|eject');
  const cfg = await readConfig(root);
  if ((cfg.ejected ?? []).includes(key)) throw new DoctorError(`${key} is already ejected; it is the project's`);
  const f = targets(cfg, practices).find(t => t.kind !== 'seeded' && lockKey(t) === key);
  if (!f) throw new DoctorError(`${key} is not a managed file, block or link of this project's practices`);
  const plan = {
    path: key, action, practice: f.practice,
    what: action === 'restore'
      ? `rewrite ${key} from keel's ${f.practice} template and record it in .keel/lock.json`
      : `remove ${key} from .keel/lock.json and add it to .keel/keel.json "ejected"; render will never touch it again`,
  };
  if (!yes) return { plan, done: false };
  const lock = (await readLock(root)) ?? { practice: version, files: {} };
  const template = bytesFor(f, cfg);
  const target = join(root, f.path);
  if (action === 'restore') {
    if (f.link !== undefined) {
      const i = await info(target);
      if (i && !i.isSymbolicLink()) throw new DoctorError(`${f.path} is a real ${i.isDirectory() ? 'directory' : 'file'}; move it aside (it may hold the project's work), then restore`, 1);
      if (i) await rm(target);
      await mkdir(dirname(target), { recursive: true });
      await symlink(template, target);
    } else if (f.kind === 'block') {
      const text = await read(target);
      const next = text === null ? null : replaceBlock(text, f.block, template, f.path);
      if (next === null) throw new DoctorError(`${f.path}: the ${f.block} block's markers are missing; put them back, then restore`, 1);
      await writeFile(target, next);
    } else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, template);
    }
    lock.files[key] = { practice: f.practice, sha256: sha256(template) };
  } else {
    delete lock.files[key];
    const raw = JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8'));
    raw.ejected = [...new Set([...(raw.ejected ?? []), key])].sort();
    await writeFile(join(root, '.keel', 'keel.json'), `${JSON.stringify(raw, null, 2)}\n`);
  }
  await writeLock(root, lock);
  return { plan, done: true };
}

function report(r) {
  const lines = [];
  const signal = r.drift.filter(d => d.state !== 'behind'), behind = r.drift.filter(d => d.state === 'behind');
  if (signal.length) {
    lines.push('Changed by the project (drift is signal):');
    for (const d of signal) {
      lines.push(`  ${d.state.padEnd(6)} ${d.path} (${d.practice})${d.missing ? ' — missing' : ''}`,
        `         send it home with keel lessons (phase 7), keep it (keel doctor --fix ${d.path} eject), or take keel's (keel doctor --fix ${d.path} restore)`,
        ...d.diff.trimEnd().split('\n').map(l => `    ${l}`));
    }
    lines.push('');
  }
  if (behind.length) lines.push('Behind keel (update brings these, phase 6):', ...behind.map(d => `  behind ${d.path} (${d.practice})`), '');
  if (r.lint.length) lines.push('Practice rules:', ...r.lint.map(l => `  ${l.rule.padEnd(18)} ${l.path} — ${l.message}`), '');
  const locals = Object.entries(r.local);
  if (locals.length) {
    lines.push('Local variants (information, not errors):', ...locals.map(([n, why]) => `  ${n} — ${why}`));
    if (r.qualifies.length) lines.push(`  Would now be on if adopted again: ${r.qualifies.join(', ')}`);
    lines.push('');
  }
  if (r.ejected.length) lines.push(`Ejected (the project's own): ${r.ejected.join(', ')}`, '');
  const n = findings(r);
  lines.push(n ? `${n} finding${n === 1 ? '' : 's'}.` : 'Clean: nothing the project changed, no practice rule broken.');
  return lines.join('\n');
}

/**
 * keel doctor. opts: { root, fix?: [path, action], yes? }. Returns { data, text, exitCode }.
 */
export async function doctor({ root, fix, yes }, { practices, version = practiceVersion() } = {}) {
  practices ??= await load();
  if (yes && !fix) throw new DoctorError('--yes only answers --fix');
  if (fix) {
    const { plan, done } = await applyFix(root, fix[0], fix[1], { practices, version, yes });
    if (!done) {
      return {
        data: { ok: false, needs: 'yes', plan },
        text: [`keel doctor --fix needs a yes. It will:`, `  - ${plan.what}`, 'Nothing was changed. Re-run with --yes to go ahead.'].join('\n'),
        exitCode: 3,
      };
    }
    const after = await diagnose(root, { practices, version });
    return { data: { ok: true, fixed: plan, ...after }, text: `Fixed: ${plan.what}.\n\n${report(after)}`, exitCode: 0 };
  }
  const r = await diagnose(root, { practices, version });
  return { data: r, text: report(r), exitCode: findings(r) ? 1 : 0 };
}
