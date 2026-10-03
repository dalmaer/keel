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
// a goal with no phase, a managed symlink replaced by a real directory; with
// loop on, a .stitch.json that names no workspace, and a gate that never runs
// the loop check (tests/loop.test.mjs, or loop.mjs render --check).
// Local variants (.keel/keel.json "local") are information, and so is a local
// practice adopt's survey would now switch on, and — while phases or evidence
// is local — the built phases that owe evidence (migration 0003 waits on them).
// Blocks adopt skipped (.keel/keel.json "blocksSkipped": the project's AGENTS.md
// already states their rule) are information too; render never plans them.
// A `lessons` path in .keel/keel.json that does not exist is a lint
// (lessons-path). Phases in the projects shape are read (read-only) for their
// own lints: off-vocabulary and phase-status (lib/phases-projects.mjs).
//
// Notes are information that never changes the exit code and never counts as
// a lint (improve's lint measure reads `lint` only, so notes stay out of it).
// readme-behind (phase 18, lesson 16): README.md's last commit is older than
// the newest `since` of a built or lived-in phase. A README can be rightly
// unchanged after a phase, so it is a nudge, not a finding.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, lstat, readlink, symlink, rm, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { load, config as readConfig, targets, bytesFor, replaceBlock, blockBody, practiceVersion } from './practices.mjs';
import { shapeOf, readProjects } from './phases-projects.mjs';
import { readLock, writeLock, sha256, lockKey, driftState } from './lock.mjs';

export { blockBody };
import { survey, owingEvidence } from './adopt.mjs';
import { parsePhase } from '../practices/phases/files/scripts/roadmap.mjs';
// The lints a project can read on its own live with the night practice's
// shipped scripts/keel/lib.mjs; doctor and the project's night share them.
import { skillName, secondCopies, claudeMdLint, phaseLints, setupEnvProblems, CLAUDE_MD_LINES } from '../practices/night/files/scripts/keel/lib.mjs';

export const RULES = ['second-copy', 'claude-md-pointer', 'phase', 'goal-without-phase', 'symlink-replaced', 'loop-workspace', 'loop-gate', 'lessons-path', 'gate-config', 'off-vocabulary', 'phase-status'];
export { CLAUDE_MD_LINES };
/** Information doctor lists that never changes its exit code. */
export const NOTES = ['readme-behind'];

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

/**
 * The gate's text with every `npm run <x>` / `npm test` it reaches expanded
 * from package.json, so a check behind two scripts is still seen.
 */
export function expandGate(command, scripts = {}, depth = 0) {
  if (depth > 8) return command;
  let out = command;
  for (const [, run, , args] of command.matchAll(/\bnpm\s+(?:run(?:-script)?\s+([\w:.-]+)|(test|t)\b)(?:\s+--\s+([^&|;\n]*))?/g)) {
    const key = run ?? 'test';
    if (typeof scripts[key] === 'string') out += `\n${expandGate(`${scripts[key]}${args ? ` ${args.trim()}` : ''}`, scripts, depth + 1)}`;
  }
  return out;
}

/** Whether a gate's expanded text runs the loop check: the managed test, or render --check itself. */
export function gateRunsLoop(text) {
  if (/loop\.mjs\s+render\s+--check/.test(text) || /tests\/loop\.test\.mjs/.test(text)) return true;
  for (const [, args] of text.matchAll(/\bnode\s+--test\b([^&|;\n]*)/g)) {
    const paths = args.trim().split(/\s+/).filter(a => a && !a.startsWith('-'));
    if (!paths.length || paths.some(a => /^(\.\/)?(tests\/?|tests\/\*\*.*|tests\/\*\.test\.mjs|tests\/\*\.mjs|\*\*\/\*\.test\.mjs)$/.test(a.replace(/^['"]|['"]$/g, '')))) return true;
  }
  return false;
}

/**
 * readme-behind: README.md last committed before the newest built or lived-in
 * phase's `since`. A note or null; null too when there is no git, no README
 * commit or no such phase.
 */
export async function readmeBehind(root) {
  if (!(await info(join(root, 'README.md')))?.isFile()) return null;
  let readme;
  try {
    readme = execFileSync('git', ['-C', root, 'log', '-1', '--format=%cs', '--', 'README.md'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(readme)) return null;
  const dir = join(root, 'docs', 'phases');
  let newest = null;
  for (const file of (await readdir(dir).catch(() => [])).filter(n => n.endsWith('.md') && n !== 'README.md')) {
    let p;
    try { p = parsePhase(file, await read(join(dir, file))); } catch { continue; } // the phase lint reports it
    if (['built', 'lived-in'].includes(p.status) && (!newest || p.since > newest.since)) newest = { file, since: p.since };
  }
  if (!newest || readme >= newest.since) return null;
  return { rule: 'readme-behind', path: 'README.md', message: `README.md was last committed ${readme}, before docs/phases/${newest.file} became built on ${newest.since}; if that phase changed what a person is told, say it there (information, not a finding)` };
}

/** Diagnose `root`. Returns { drift, lint, notes, local, qualifies, owing, ejected, blocksSkipped }. Writes nothing. */
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
  lint.push(...await secondCopies(root, new Map([...skills].map(([n, f]) => [n, { path: f.path, practice: f.practice }])), { self: cfg.keel === 'self' }));

  if (files.some(f => f.path === 'CLAUDE.md' && f.kind === 'managed')) {
    const claude = claudeMdLint(await read(join(root, 'CLAUDE.md')));
    if (claude) lint.push(claude);
  }

  if (cfg.practices.includes('phases')) lint.push(...await phaseLints(root, parsePhase));
  if (shapeOf(cfg) === 'projects') lint.push(...(await readProjects(root)).lint);
  if (typeof cfg.lessons === 'string' && !(await info(join(root, cfg.lessons)))?.isFile()) {
    lint.push({ rule: 'lessons-path', path: '.keel/keel.json', message: `"lessons" names ${cfg.lessons}, which is not a file; point it at the project's lessons table, or remove it for docs/lessons.md` });
  }

  for (const message of setupEnvProblems(cfg)) lint.push({ rule: 'gate-config', path: '.keel/keel.json', message: `${message}; keel runs the gate with it (improve, update, the night's install)` });

  if (cfg.practices.includes('loop')) {
    let ws = null;
    try { ws = JSON.parse((await read(join(root, '.stitch.json'))) ?? '{}').workspace; } catch { ws = null; }
    if (typeof ws !== 'string' || !ws.trim()) lint.push({ rule: 'loop-workspace', path: '.stitch.json', message: 'loop is on, but .stitch.json names no workspace; put the Loop workspace id in "workspace" (pull, push and mine refuse to guess)' });
    const gate = cfg.check ?? 'npm run check';
    let scripts = {};
    try { scripts = JSON.parse((await read(join(root, 'package.json'))) ?? '{}').scripts ?? {}; } catch { scripts = {}; }
    if (!gateRunsLoop(expandGate(gate, scripts))) lint.push({ rule: 'loop-gate', path: 'package.json', message: `loop is on, but the gate (\`${gate}\`) never runs tests/loop.test.mjs or \`node scripts/loop.mjs render --check\`; a stale docs/LOOP.md would pass it` });
  }

  const notes = [];
  if (shapeOf(cfg) === 'files') {
    const behind = await readmeBehind(root);
    if (behind) notes.push(behind);
  }

  const local = cfg.local ?? {};
  let qualifies = [];
  if (Object.keys(local).length) {
    try {
      const s = await survey(root, { version: { practice: version }, practices });
      qualifies = s.practices.filter(p => Object.hasOwn(local, p.name) && p.state === 'on').map(p => p.name);
    } catch { qualifies = []; } // a survey that cannot run says nothing; the report stands without it
  }
  const owing = shapeOf(cfg) === 'files' && ['phases', 'evidence'].some(n => Object.hasOwn(local, n)) ? await owingEvidence(root) : [];
  // setup and env, when set: information, the way keel will run the gate here.
  const gate = cfg.setup !== undefined || cfg.env !== undefined
    ? { gate: { check: cfg.check ?? 'npm run check', ...(cfg.setup !== undefined ? { setup: cfg.setup } : {}), ...(cfg.env !== undefined ? { env: cfg.env } : {}) } }
    : {};
  return { drift, lint, notes, local, qualifies, owing, ejected: cfg.ejected ?? [], ...(cfg.blocksSkipped?.length ? { blocksSkipped: cfg.blocksSkipped } : {}), ...gate };
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
  if (r.notes?.length) lines.push('Notes (information; never changes the exit code):', ...r.notes.map(l => `  ${l.rule.padEnd(18)} ${l.path} — ${l.message}`), '');
  const locals = Object.entries(r.local);
  if (locals.length) {
    lines.push('Local variants (information, not errors):', ...locals.map(([n, why]) => `  ${n} — ${why}`));
    if (r.qualifies.length) lines.push(`  Would now be on if adopted again: ${r.qualifies.join(', ')}`);
    if (r.owing?.length) lines.push(`  Built phases owing evidence (migration 0003 waits on every one): ${r.owing.join(', ')}`,
      '    for each: write the evidence when it is next checked, or step it back to partial — never placeholder evidence');
    lines.push('');
  }
  if (r.ejected.length) lines.push(`Ejected (the project's own): ${r.ejected.join(', ')}`, '');
  if (r.blocksSkipped?.length) lines.push(`Blocks not appended (information; the project's AGENTS.md already states each rule): ${r.blocksSkipped.map(id => `AGENTS.md#${id}`).join(', ')}`, '');
  if (r.gate) {
    const env = r.gate.env && typeof r.gate.env === 'object' ? Object.entries(r.gate.env).map(([k, v]) => `${k}=${v}`).join(' ') : JSON.stringify(r.gate.env);
    lines.push(`The gate (information): \`${r.gate.check}\``,
      ...(r.gate.setup !== undefined ? [`  setup: ${r.gate.setup}   (the night's install, before the gate)`] : []),
      ...(r.gate.env !== undefined ? [`  env:   ${env}   (wherever keel runs the gate)`] : []), '');
  }
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
