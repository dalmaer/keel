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
// (lessons-path), and so is a lessons table a blank line splits, which hides
// every row after it (lessons-table-split). The same rule names the other
// ways a table ends early (phase 29, isocan's lessons on 5 Oct 2026): prose
// between numbered rows, a second header row (a second table, which no reader
// counts), and a numbered row stranded under a later heading. With the night on (or a `health`
// set), a `health` that is not a plain directory in the repo is a lint
// (health-config), and so is a health directory git ignores (health-ignored):
// the night writes its page there and its PR never carries it. Phases in the projects shape are read (read-only) for their
// own lints: off-vocabulary and phase-status (lib/phases-projects.mjs).
//
// Notes are information that never changes the exit code and never counts as
// a lint (improve's lint measure reads `lint` only, so notes stay out of it).
// readme-behind (phase 18, lesson 16): README.md's last commit is older than
// the newest `since` of a built or lived-in phase. A README can be rightly
// unchanged after a phase, so it is a nudge, not a finding.
// acceptance-unchecked (phase 32): a built phase from before `spec: 2` whose
// boxes name no check. Old phases are never rewritten to satisfy it.
// The stack (phase 30, lib/stacks.mjs): a `stack` naming a tag outside keel's
// vocabulary is a finding (stack-unknown); one the evidence disagrees with,
// either way, is a finding (stack-evidence: declared with no evidence, or
// evidence with no declaration); no `stack` at all is a stack-evidence note
// naming what the files show.
// Phase 65: a tracked test file that runs a macOS-only (or Windows-only) tool
// with no skip for that platform is a finding (platform-guard; the rule is the
// night lib's platformLints, so the night's lint measure reads it too). With
// "contracts" set, a contract's document that is not a file, a pattern no
// tracked file matches, and a .claude/settings.json that never runs the hook
// are notes (contract-doc-missing, contract-unmatched, contract-hook);
// contracts keel cannot read are a finding (contracts-config).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, lstat, readlink, symlink, rm, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { load, config as readConfig, targets, bytesFor, replaceBlock, blockBody, practiceVersion, lessonsPath, PROJECT } from './practices.mjs';
import { shapeOf, readProjects } from './phases-projects.mjs';
import { readLock, writeLock, sha256, lockKey, driftState } from './lock.mjs';
import { settle } from './taken.mjs';
import { detect as detectStack, disagreement, stackProblems, tags as stackTags, VIEW } from './stacks.mjs';

export { blockBody };
import { survey, owingEvidence } from './adopt.mjs';
import { parsePhase, specProblems, uncheckedBoxes } from '../practices/phases/files/scripts/roadmap.mjs';
// The lints a project can read on its own live with the night practice's
// shipped scripts/keel/lib.mjs; doctor and the project's night share them.
import { skillName, secondCopies, claudeMdLint, phaseLints, setupEnvProblems, lessonsTableSplit, lessonsTableShapes, healthLints, platformLints, trackedFiles, CLAUDE_MD_LINES } from '../practices/night/files/scripts/keel/lib.mjs';
import { testsConfigProblems } from '../practices/night/files/scripts/keel/test-ledger.mjs';
import { globRegex, contractProblems } from '../practices/agents-md/files/scripts/keel/contract-hook.mjs';
// The lessons-table shapes live in the night's lib, so a project's own improve lints them the same way.
export { lessonsTableShapes };

export const RULES = ['second-copy', 'claude-md-pointer', 'phase', 'goal-without-phase', 'symlink-replaced', 'loop-workspace', 'loop-gate', 'lessons-path', 'lessons-table-split', 'gate-config', 'off-vocabulary', 'phase-status', 'stack-unknown', 'stack-evidence', 'contracts-config', 'platform-guard'];
export { CLAUDE_MD_LINES };
/** Information doctor lists that never changes its exit code. */
export const NOTES = ['readme-behind', 'acceptance-unchecked', 'stack-evidence', 'contract-doc-missing', 'contract-unmatched', 'contract-hook'];

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

// ---- which tests a gate runs ------------------------------------------------

/** node --test's own default when it names no path: these file names, anywhere. */
const NODE_TEST_DEFAULT = /(^|\/)(test\/.*\.[cm]?js|[^/]*[.\-_]test\.[cm]?js|test-[^/]*\.[cm]?js|test\.[cm]?js)$/;
/** node flags whose value may be the next word (`--import x`), so it is not a path. */
const NODE_VALUE_FLAGS = new Set(['--import', '--require', '-r', '--loader', '--experimental-loader', '--test-reporter', '--test-reporter-destination', '--test-concurrency', '--test-name-pattern', '--test-skip-pattern', '--test-timeout', '--test-shard', '--test-isolation', '--test-coverage-include', '--test-coverage-exclude', '--test-global-setup', '--env-file', '--conditions', '-C']);

// globRegex (a simple glob as a whole-path RegExp) lives with the contract
// hook, which a project runs without keel; doctor matches with the same one.
export { globRegex };

/** Each `node … --test …` in a command's text, with the paths it names (none: node's default). [{ paths }] */
export function nodeTestRuns(text) {
  const out = [];
  for (const [segment] of String(text).matchAll(/\bnode\s[^&|;\n]*/g)) {
    const words = segment.trim().split(/\s+/).slice(1).map(w => w.replace(/^['"]|['"]$/g, ''));
    if (!words.includes('--test')) continue;
    const paths = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w.startsWith('-')) { if (NODE_VALUE_FLAGS.has(w)) i++; continue; }
      paths.push(w.replace(/^\.\//, ''));
    }
    out.push({ paths });
  }
  return out;
}

/**
 * Whether a command's text runs the test file `path` (relative to the root):
 * true or false, or null when it holds no `node --test` (another runner, or
 * none: keel cannot tell). A named path is a file, a simple glob, or a
 * directory (node's default file names under it).
 */
export function runsTest(text, path) {
  const runs = nodeTestRuns(text);
  if (!runs.length) return null;
  const named = p => /[*?{]/.test(p) ? globRegex(p).test(path)
    : /\.[cm]?[jt]s$/.test(p) ? p === path
    : path.startsWith(`${p.replace(/\/$/, '')}/`) && NODE_TEST_DEFAULT.test(path);
  return runs.some(r => r.paths.length ? r.paths.some(named) : NODE_TEST_DEFAULT.test(path));
}

/**
 * The tests a practice ships for the project's own gate to run (keel's
 * generated-file and workflow checks, the roadmap's). tests/loop.test.mjs is
 * the loop-gate lint's.
 */
export const shippedTests = files => files.filter(f => f.kind === 'managed' && /^tests\/[^/]+\.test\.mjs$/.test(f.path) && f.path !== 'tests/loop.test.mjs').map(f => f.path);

/**
 * readme-behind: README.md last committed before the newest built or lived-in
 * phase's `since`. A note or null; null too when there is no git, no README
 * commit or no such phase.
 */
export async function readmeBehind(root) {
  if (!(await info(join(root, 'README.md')))?.isFile()) return null;
  let readme;
  try {
    readme = (await promisify(execFile)('git', ['-C', root, 'log', '-1', '--format=%cs', '--', 'README.md'], { encoding: 'utf8' })).stdout.trim();
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

/**
 * acceptance-unchecked (phase 32): a built or lived-in phase written before
 * `spec: 2` whose acceptance boxes name no check (a tests/ path, a command in
 * backticks, ⚑ by hand). A note per phase; the phase is never rewritten, and
 * is brought up to date when it is next edited.
 */
export async function acceptanceUnchecked(root) {
  const dir = join(root, 'docs', 'phases'), notes = [];
  for (const file of (await readdir(dir).catch(() => [])).filter(n => n.endsWith('.md') && n !== 'README.md').sort()) {
    const raw = await read(join(dir, file));
    let p;
    try { p = parsePhase(file, raw); } catch { continue; } // the phase lint reports it
    const count = ['built', 'lived-in'].includes(p.status) ? uncheckedBoxes(raw) : null;
    if (count?.unchecked) notes.push({ rule: 'acceptance-unchecked', path: `docs/phases/${file}`, message: `${count.unchecked} of ${count.boxes} acceptance box${count.boxes === 1 ? '' : 'es'} name no check (a tests/ path, a command in backticks, or ⚑ by hand); bring it up to date when the phase is next edited (information, not a finding)` });
  }
  return notes;
}

/**
 * The stack's lints and notes: { lint, notes }. Read when the lessons practice
 * is on or a `stack` is declared.
 */
export async function stackLints(root, cfg) {
  const lint = [], notes = [];
  const where = '.keel/keel.json';
  const problems = stackProblems(cfg.stack);
  for (const message of problems) lint.push({ rule: 'stack-unknown', path: where, message: `${message}; ${VIEW} cannot be rendered until it is fixed` });
  if (problems.length) return { lint, notes };
  const detected = await detectStack(root);
  const said = detected.map(d => `${d.tag} (${d.evidence.join(', ')})`).join(', ') || 'nothing';
  if (cfg.stack === undefined) {
    notes.push({ rule: 'stack-evidence', path: where, message: `no "stack" declared; the files show ${said} — declare it, and ${VIEW} carries the lessons tagged for it (information, not a finding)` });
    return { lint, notes };
  }
  const { missing, unbacked } = disagreement(cfg.stack, detected);
  if (unbacked.length) lint.push({ rule: 'stack-evidence', path: where, message: `"stack" declares ${unbacked.join(', ')}, and nothing in the repo shows it (practices/lessons/stacks.json names the evidence); a wrong tag shows this project lessons that are not its own` });
  if (missing.length) lint.push({ rule: 'stack-evidence', path: where, message: `the files show ${detected.filter(d => missing.includes(d.tag)).map(d => `${d.tag} (${d.evidence.join(', ')})`).join(', ')}, and "stack" does not declare ${missing.length === 1 ? 'it' : 'them'}; the lessons tagged for ${missing.length === 1 ? 'it' : 'them'} never reach ${VIEW}` });
  return { lint, notes };
}

/**
 * The contracts' notes (phase 65): a "read" document that is not a file
 * (contract-doc-missing), a pattern no tracked file matches
 * (contract-unmatched), and a .claude/settings.json the project already had
 * that never runs the hook (contract-hook). Information: a contract can name
 * code that is not written yet.
 */
export async function contractNotes(root, cfg) {
  const list = Array.isArray(cfg.contracts) && !contractProblems(cfg.contracts).length ? cfg.contracts : [];
  if (!list.length) return [];
  const notes = [], where = '.keel/keel.json';
  const tracked = await trackedFiles(root);
  for (const c of list) {
    if (!(await info(join(root, c.read)))?.isFile()) notes.push({ rule: 'contract-doc-missing', path: where, message: `a contract says to read ${c.read}, which is not a file; write it, or point "read" at the document (information, not a finding)` });
    for (const p of c.paths) {
      const re = globRegex(p.replace(/^\.\//, ''));
      if (!tracked.some(t => re.test(t))) notes.push({ rule: 'contract-unmatched', path: where, message: `the contract pattern ${p} (read ${c.read}) matches no tracked file; fix the pattern, or drop it (information, not a finding)` });
    }
  }
  const settings = await read(join(root, '.claude', 'settings.json'));
  const gap = settings === null ? null : hookGap(settings);
  if (gap) {
    notes.push({ rule: 'contract-hook', path: '.claude/settings.json', message: `${gap}, so Claude Code is not pointed to the contracts before an edit; add a PreToolUse hook with matcher "Edit|Write|MultiEdit" running \`node "$CLAUDE_PROJECT_DIR"/scripts/keel/contract-hook.mjs\` (keel seeds this file only when it is absent) (information, not a finding)` });
  }
  return notes;
}

/** The tools a pre-edit hook must cover. */
const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit'];

/**
 * Why a .claude/settings.json does not run the contract hook before an edit,
 * or null when it does: a hooks.PreToolUse entry whose matcher covers Edit,
 * Write and MultiEdit, with a command hook running scripts/keel/contract-hook.mjs,
 * and hooks not switched off (disableAllHooks). The script's path named
 * anywhere else (a permission, another event) does not count.
 */
export function hookGap(text) {
  let settings;
  try { settings = JSON.parse(text); } catch { return 'the project\'s .claude/settings.json is not JSON keel can read'; }
  if (settings?.disableAllHooks === true) return 'the project\'s settings switch every hook off (disableAllHooks)';
  const covers = matcher => {
    if (matcher === undefined || matcher === '' || matcher === '*') return true;
    if (typeof matcher !== 'string') return false;
    try { const re = new RegExp(`^(?:${matcher})$`); return EDIT_TOOLS.every(t => re.test(t)); } catch { return false; }
  };
  const entries = Array.isArray(settings?.hooks?.PreToolUse) ? settings.hooks.PreToolUse : [];
  const runs = entries.some(e => e && covers(e.matcher) && Array.isArray(e.hooks)
    && e.hooks.some(h => h?.type === 'command' && typeof h.command === 'string' && /(^|[\s"'/])scripts\/keel\/contract-hook\.mjs(?=$|[\s"';&|])/.test(h.command)));
  return runs ? null : 'the project\'s own settings never run the contract hook as a PreToolUse hook on Edit, Write and MultiEdit';
}

/** Diagnose `root`. Returns { drift, lint, notes, local, qualifies, owing, ejected, blocksSkipped }. Writes nothing. */
export async function diagnose(root, { practices, version = practiceVersion(), github = false, env = process.env } = {}) {
  practices ??= await load();
  const cfg = await readConfig(root);
  const lock = await readLock(root);
  const files = targets(cfg, practices).filter(f => f.kind !== 'seeded');
  const drift = [], lint = [];
  // readme-behind and the health lints ask git; started now, git runs while the rest is read.
  const behindP = shapeOf(cfg) === 'files' ? readmeBehind(root) : null;
  behindP?.catch(() => {}); // awaited below, where a failure still throws
  const healthP = healthLints(root, cfg); // git check-ignore, the same way
  healthP.catch(() => {});

  // A stack keel cannot read is a finding below (stack-unknown); drift reads past it.
  const known = stackTags();
  // Contracts keel cannot read are a finding below (contracts-config); drift reads the block without them.
  const badContracts = contractProblems(cfg.contracts);
  const shaped = stackProblems(cfg.stack, known).length || badContracts.length
    ? Object.defineProperty({
      ...cfg,
      ...(stackProblems(cfg.stack, known).length ? { stack: Array.isArray(cfg.stack) ? cfg.stack.filter(t => known.includes(t)) : [] } : {}),
      ...(badContracts.length ? { contracts: [] } : {}),
    }, PROJECT, { value: cfg[PROJECT], enumerable: false })
    : cfg;
  for (const message of badContracts) lint.push({ rule: 'contracts-config', path: '.keel/keel.json', message: `${message}; render cannot write the guide's contracts table until it is fixed` });
  for (const f of files) {
    const key = lockKey(f);
    const template = bytesFor(f, shaped);
    const { now, lint: problem } = await current(root, f);
    if (problem) { lint.push(problem); continue; }
    const locked = lock?.files?.[key]?.sha256 ?? sha256(template);
    // A file keel never wrote here (no lock entry) and that is not here yet is new in this practice
    // version: behind, for update to create. A missing file the lock knows is the project's removal.
    const state = now === null && lock && !lock.files?.[key] ? 'behind'
      : await settle(driftState(now, locked, template), { now, locked, f, config: cfg, template, version: lock?.practice });
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

  if (cfg.practices.includes('phases')) lint.push(...await phaseLints(root, parsePhase, specProblems));
  if (shapeOf(cfg) === 'projects') lint.push(...(await readProjects(root)).lint);
  if (typeof cfg.lessons === 'string' && !(await info(join(root, cfg.lessons)))?.isFile()) {
    lint.push({ rule: 'lessons-path', path: '.keel/keel.json', message: `"lessons" names ${cfg.lessons}, which is not a file; point it at the project's lessons table, or remove it for docs/lessons.md` });
  }
  if (cfg.practices.includes('lessons') || typeof cfg.lessons === 'string') {
    const text = await read(join(root, lessonsPath(cfg)));
    lint.push(...lessonsTableSplit(text, lessonsPath(cfg)), ...lessonsTableShapes(text, lessonsPath(cfg)));
  }

  let stackNotes = [];
  if (cfg.practices.includes('lessons') || cfg.stack !== undefined) {
    const stack = await stackLints(root, cfg);
    lint.push(...stack.lint);
    stackNotes = stack.notes;
  }

  for (const message of setupEnvProblems(cfg)) lint.push({ rule: 'gate-config', path: '.keel/keel.json', message: `${message}; keel runs the gate with it (improve, update, the night's install)` });
  // "tests" is the test ledger's: its window and bounds, the zero-tests gate, and the runner and JUnit file (phase 59).
  for (const message of testsConfigProblems(cfg)) lint.push({ rule: 'tests-config', path: '.keel/keel.json', message: `${message}; the test ledger reads it (scripts/keel/test-ledger.mjs, flaky_tests, slow_tests)` });
  // The night's health directory: a bad "health" (health-config), or one git
  // ignores (health-ignored), where the night writes a page nobody commits.
  lint.push(...await healthP);
  // A test that runs a macOS-only (or Windows-only) tool with no platform skip (phase 65).
  lint.push(...await platformLints(root, cfg));

  // A test keel ships that the project's gate never runs proves nothing (cajones: `node --test tests/*.test.js tests/roadmap.test.mjs`).
  {
    const gate = cfg.check ?? 'npm run check';
    let scripts = {};
    try { scripts = JSON.parse((await read(join(root, 'package.json'))) ?? '{}').scripts ?? {}; } catch { scripts = {}; }
    const text = expandGate(gate, scripts);
    for (const path of shippedTests(files)) {
      if ((cfg.ejected ?? []).includes(path) || (await read(join(root, path))) === null) continue;
      if (runsTest(text, path) === false) lint.push({ rule: 'shipped-test-unrun', path, message: `keel ships ${path}, and the gate (\`${gate}\`) never runs it: its node --test names paths that do not match. Add ${path} to the test script (migration 0005 does, in an update PR), or the check it carries proves nothing` });
    }
  }

  if (cfg.practices.includes('loop')) {
    let ws = null;
    try { ws = JSON.parse((await read(join(root, '.stitch.json'))) ?? '{}').workspace; } catch { ws = null; }
    if (typeof ws !== 'string' || !ws.trim()) lint.push({ rule: 'loop-workspace', path: '.stitch.json', message: 'loop is on, but .stitch.json names no workspace; put the Loop workspace id in "workspace" (pull, push and mine refuse to guess)' });
    const gate = cfg.check ?? 'npm run check';
    let scripts = {};
    try { scripts = JSON.parse((await read(join(root, 'package.json'))) ?? '{}').scripts ?? {}; } catch { scripts = {}; }
    if (!gateRunsLoop(expandGate(gate, scripts))) lint.push({ rule: 'loop-gate', path: 'package.json', message: `loop is on, but the gate (\`${gate}\`) never runs tests/loop.test.mjs or \`node scripts/loop.mjs render --check\`; a stale docs/LOOP.md would pass it` });
  }

  const { reconcile } = await import('../practices/reconciliation/files/scripts/keel/reconcile.mjs');
  const reconciliation = await reconcile({ root, github, env });
  const recordChecks = cfg.practices.includes('reconciliation') || github || reconciliation.findings.length > 0;
  lint.push(...reconciliation.findings);
  const notes = recordChecks ? [...reconciliation.notes] : [];
  if (behindP) {
    const behind = await behindP;
    if (behind) notes.push(behind);
  }
  if (cfg.practices.includes('phases') && shapeOf(cfg) === 'files') notes.push(...await acceptanceUnchecked(root));
  notes.push(...stackNotes);
  notes.push(...await contractNotes(root, cfg));

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
  // setupToken is a secret's name, never its value, so it is safe to show.
  const gate = cfg.setup !== undefined || cfg.env !== undefined || cfg.setupToken !== undefined
    ? { gate: { check: cfg.check ?? 'npm run check', ...(cfg.setup !== undefined ? { setup: cfg.setup } : {}), ...(cfg.setupToken !== undefined ? { setupToken: cfg.setupToken } : {}), ...(cfg.env !== undefined ? { env: cfg.env } : {}) } }
    : {};
  return { drift, lint, notes, ...(recordChecks ? { reconciliation } : {}), local, qualifies, owing, ejected: cfg.ejected ?? [], ...(cfg.blocksSkipped?.length ? { blocksSkipped: cfg.blocksSkipped } : {}), ...gate };
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
  if (r.reconciliation?.unknown.length) lines.push('Reconciliation unknown:', ...r.reconciliation.unknown.map(x => `  ${x.message ?? JSON.stringify(x)}`), '');
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
      ...(r.gate.setupToken !== undefined ? [`  setupToken: secrets.${r.gate.setupToken}   (GH_TOKEN for setup in the night's install only; the repo secret must exist)`] : []),
      ...(r.gate.env !== undefined ? [`  env:   ${env}   (wherever keel runs the gate)`] : []), '');
  }
  const n = findings(r);
  lines.push(r.reconciliation?.unknown.length ? 'Incomplete: remote observations are unknown.' : n ? `${n} finding${n === 1 ? '' : 's'}.` : 'Clean: nothing the project changed, no practice rule broken.');
  return lines.join('\n');
}

/**
 * keel doctor. opts: { root, fix?: [path, action], yes? }. Returns { data, text, exitCode }.
 */
export async function doctor({ root, fix, yes, github = false }, { practices, version = practiceVersion(), env = process.env } = {}) {
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
    const after = await diagnose(root, { practices, version, github, env });
    return { data: { ok: !after.reconciliation?.unknown.length, fixed: plan, ...after }, text: `Fixed: ${plan.what}.\n\n${report(after)}`, exitCode: after.reconciliation?.unknown.length ? 2 : 0 };
  }
  const r = await diagnose(root, { practices, version, github, env });
  return { data: r, text: report(r), exitCode: r.reconciliation?.unknown.length ? 2 : findings(r) ? 1 : 0 };
}
