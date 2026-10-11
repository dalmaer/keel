import { readMilestones, milestoneSource } from '../practices/night/files/scripts/keel/milestones.mjs';
// keel adopt: bring an existing project under keel without losing what is its own.
//
// The rule is design §1a. A practice is switched on only where the project
// already satisfies it; where the project has its own version, the practice is
// a *local variant*: nothing is installed for it, and .keel/keel.json records
// why and how it could converge. The project's gate is config (`check`), not
// an assumption.
//
// Per practice: on (render it) | local (the project's own version; a proposal)
// | off (nothing there, not wanted by default).
// Per file: create | same | keep-local (the project's bytes stay) | conflict
// (a shape adopt cannot touch, e.g. a directory where keel wants a symlink).
// A keep-local or conflict on a managed file or block makes its practice local,
// so render never overwrites a project's bytes. AGENTS.md keeps every byte;
// missing practice blocks are appended under "## The keel practice".
//
// The dry run is the default output shape; without --dry-run the same plan is
// written: .keel/keel.json, the AGENTS.md markers, the on practices' render,
// and docs/keel-adoption.md for the person reading the PR. A target the
// project ejected (.keel/keel.json "ejected") is skipped: it is neither
// keep-local nor a reason to make its practice local. Re-running is a
// no-op: the existing config's name, tagline and check win over detection.
//
// The gate is never invented (phase 16): --check, else package.json's
// check:all, else its check, else none — a dry run says so and a write run
// exits 2 asking for --check. The lessons table is found where it is: a
// docs/**/lessons.md with a numbered table, when docs/lessons.md is absent,
// becomes `lessons` in .keel/keel.json and nothing is seeded beside it. A
// project that keeps its phases as docs/projects/<p>/phases.md gets
// `"phases": {"shape": "projects"}`: keel reads them (next, status), never
// writes them, and phases stays local. A practice whose upstream source is this
// very repo (practice.json `source.path` is a real file here) stays local: keel
// never installs its copy of a project's own original.
//
// Optional practices (loop, claude) are off unless named with --with, or
// already on in .keel/keel.json; a project with its own version is still local.
// A block whose first bold sentence the project's AGENTS.md already states, in
// its own prose outside keel markers, is not appended: it is listed in
// .keel/keel.json "blocksSkipped", which render and doctor honour.
//
// On a project already adopted (.keel/keel.json lists its practices), `--with
// <p>` naming a practice that is not on yet only adds it: the practice must
// survey as on (a project's own version keeps it local, and adopt says why
// and writes nothing); then its row goes into "practices" (and out of
// "local"), its block markers are appended to AGENTS.md, and only its files
// are rendered and locked. Every other byte stays: the config's other fields,
// the practice version, other practices' files and blocks, and
// docs/keel-adoption.md (the record of the adoption itself).
//
// `repo` is recorded only when it can be known safely: the directory is its
// own git top level and its origin is a github.com remote (https or ssh). An
// existing `repo` is never overwritten; otherwise it stays unset, and adopt says why.
//
// The stack (phase 30): an existing `stack` stands; otherwise the tags the
// files show (lib/stacks.mjs, practices/lessons/stacks.json) are recorded as
// `stack`, and the dry run says which evidence held. None shown, none written.
//
// The test runner (phase 59): the gate, and each package.json script it
// reaches, is read for `bun test`, vitest or `node --test`. bun or vitest is
// recorded as "tests": { runner, junit } (an existing runner stands), and the
// test ledger's part is PROPOSED, never written: the runner's JUnit flags,
// its exit code kept as `|| keel_status=$?`, then `node
// scripts/keel/test-ledger.mjs --junit <file> --runner <r> --status
// $keel_status` (ledgerCommand), and only while the night practice is on (or
// the ledger is already there). The dry run, the text and docs/keel-adoption.md say it.
import { GUIDE, guidePath, guideKey } from './guide.mjs';
import { adoptionCost, adoptionCostLines } from './ci-adoption.mjs';
import { readFile, readdir, writeFile, mkdir, lstat, readlink, realpath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { basename, dirname, extname, join, resolve, posix } from 'node:path';
import { validateGuideTargets, load, fill, render, placed, plan, targets, replaceBlock, lockOf, withProject, wanted as targetWanted, DEFAULTS } from './practices.mjs';
import { detect as detectProjects } from './phases-projects.mjs';
import { detect as detectStack, VIEW as STACK_VIEW } from './stacks.mjs';
import { LOCK, readLock, writeLock } from './lock.mjs';
import { firstSentence, secretsNeeded, withOptional } from './init.mjs';
import { parsePhase, validateGraph, DONE } from '../practices/phases/files/scripts/roadmap.mjs';
import { setupEnvProblems } from '../practices/night/files/scripts/keel/lib.mjs';
import { JUNIT, JUNIT_PATH } from '../practices/night/files/scripts/keel/test-ledger.mjs';

export const ORDER = ['base', 'agents-md', 'phases', 'evidence', 'lessons', 'conduct', 'ci', 'night', 'claude', 'renovate', 'loop'];
export const HEADING = '## The keel practice';
export const REPORT = 'docs/keel-adoption.md';
const begin = id => `<!-- keel:begin ${id} -->`;
const end = id => `<!-- keel:end ${id} -->`;

class AdoptError extends Error {
  constructor(message, exitCode = 2) { super(message); this.exitCode = exitCode; }
}

const read = path => readFile(path, 'utf8').catch(e => ['ENOENT', 'ENOTDIR'].includes(e.code) ? null : Promise.reject(e));
const info = path => lstat(path).catch(e => ['ENOENT', 'ENOTDIR'].includes(e.code) ? null : Promise.reject(e));
const list = dir => readdir(dir).catch(e => ['ENOENT', 'ENOTDIR'].includes(e.code) ? [] : Promise.reject(e));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The first prose line of a README, markdown stripped, cut to its first sentence. */
export function readmeTagline(text) {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^([#[!<|>`\-*+=]|\d+\.\s)/.test(line) && !/^\*\*/.test(line)) continue;
    const flat = line.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').trim();
    if (flat) return firstSentence(flat);
  }
  return null;
}

/** The project's gate: check:all if present, else check, else none (never a script that is not there). */
export function detectCheck(pkg) {
  const scripts = pkg?.scripts ?? {};
  if (scripts['check:all']) return { check: 'npm run check:all', from: 'package.json scripts.check:all' };
  if (scripts.check) return { check: 'npm run check', from: 'package.json scripts.check' };
  return { check: null, from: 'none found' };
}
export const NO_GATE = 'Gate: none found — pass --check "<command>"';

/**
 * The gate and every package.json script it reaches ((npm|pnpm|yarn|bun) run
 * <s>, and npm, pnpm or yarn test), in the order they run: [{ where, text }].
 * `bun test` is bun's test runner, not a script.
 */
export function gateScripts(gate, scripts = {}) {
  const out = [], seen = new Set();
  const walk = (text, where, depth) => {
    out.push({ where, text });
    if (depth > 8) return;
    for (const m of text.matchAll(/\b(?:(?:npm|pnpm|yarn|bun)\s+run(?:-script)?\s+([\w:.-]+)|(?:npm|pnpm|yarn)\s+(?:test|t)\b)/g)) {
      const name = m[1] ?? 'test';
      if (typeof scripts[name] !== 'string' || seen.has(name)) continue;
      seen.add(name);
      walk(scripts[name], `package.json scripts.${name}`, depth + 1);
    }
  };
  if (typeof gate === 'string' && gate.trim()) walk(gate, 'the gate', 0);
  return out;
}

const RUNNER_AT = { bun: /\bbun\s+test\b/, vitest: /\bvitest\b/, node: /\bnode\b[^&|;\n]*\s--test\b/ };

/**
 * The test runner the gate runs (phase 59): { runner, from, command } for
 * the first of `bun test`, vitest or `node --test` in the gate or a script it
 * reaches, else null. `command` is that script's text.
 */
export function detectRunner(gate, scripts = {}) {
  return detectRunners(gate, scripts)[0] ?? null;
}

/** Every runner the gate or a script it reaches runs: [{ runner, from, command }], one per script that runs one. */
export function detectRunners(gate, scripts = {}) {
  const out = [];
  for (const s of gateScripts(gate, scripts)) {
    // A script's name is not its body: `npm run vitest:unit` is followed into scripts["vitest:unit"], never read as vitest here.
    const text = s.text.replace(/\b(?:npm|pnpm|yarn|bun)\s+run(?:-script)?\s+[\w:.-]+/g, m => ' '.repeat(m.length));
    const found = Object.entries(RUNNER_AT).map(([runner, re]) => ({ runner, at: text.search(re) })).filter(f => f.at >= 0).sort((a, b) => a.at - b.at)[0];
    if (found) out.push({ runner: found.runner, from: s.where, command: s.text, all: Object.entries(RUNNER_AT).filter(([, re]) => re.test(text)).map(([r]) => r) });
  }
  return out;
}

export const LEDGER_SCRIPT = 'scripts/keel/test-ledger.mjs';

/**
 * Where a shell command's top-level operators are (&&, ||, ;, |, and & or a
 * newline), outside quotes and escapes: [{ at, end }], with `quoted`, a
 * function telling whether a position is inside a quote or escape. Null when
 * the command holds what keel will not split by hand: an unclosed quote, a
 * substitution ($( or a backtick), a subshell or group, or a redirection.
 */
export function shellSteps(command) {
  const ops = [], inside = new Set();
  let q = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (q) {
      inside.add(i);
      if (c === q) q = null;
      else if (q === '"' && c === '\\') inside.add(++i);
      else if (q === '"' && (c === '`' || (c === '$' && command[i + 1] === '('))) return null;
      continue;
    }
    if (c === "'" || c === '"') { q = c; inside.add(i); continue; }
    if (c === '\\') { inside.add(i); inside.add(++i); continue; }
    if (c === '`' || c === '(' || c === ')' || c === '{' || c === '}' || c === '<' || c === '>' || c === '#') return null;
    const two = command.slice(i, i + 2);
    if (two === '&&' || two === '||') { ops.push({ at: i, end: i + 2 }); i++; }
    else if (c === ';' || c === '|' || c === '&' || c === '\n') ops.push({ at: i, end: i + 1 });
  }
  if (q) return null;
  return { ops, quoted: i => inside.has(i) };
}

/** The runner as its step's own command (vitest through npx, bunx, pnpm [exec] or yarn). */
const RUNNER_STEP = { bun: /^bun\s+test\b/, vitest: /^(?:(?:npx|bunx|pnpm\s+exec|pnpm|yarn)\s+)?vitest(?:\s+run\b)?(?![\w:.-])/ };

/** A JUnit path keel writes into a shell command as it is: a .xml file in .keel/test-runs/ (which ignores itself), no character a shell reads. */
export const safeJunit = p => typeof p === 'string' && JUNIT_PATH.test(p);

/**
 * `command` with the test ledger reading `runner`'s JUnit. The runner's step
 * becomes: the old JUnit file removed (a run that writes none is then "no
 * tests ran", never the last run read again); bun's directory made (bun
 * makes none); the runner with its reporter flags, its exit code kept by
 * `|| keel_status=$?` (a shell under set -e, as GitHub's bash -e, would
 * otherwise stop there and never record a red run); then the ledger, handed
 * that code. When a step before it changes directory (cd, pushd), the paths
 * start from git's top level ($keel_root), where the ledger is installed.
 * When the runner is one step of several, its step goes in braces, so the
 * steps around it run as they did. A proposal only: adopt never rewrites
 * the gate, and a person reads the line, so keel rewrites one small shape
 * and declines the rest (SHAPE): plain steps joined by && or ;, an optional
 * cd or pushd before, and the runner as its step's own command. Null for
 * node (the reporter goes in the node --test line; migration 0004), no
 * match, any other shape, or a JUnit path keel cannot write as it is.
 */
export function ledgerCommand(command, runner, junit = JUNIT) {
  if (!safeJunit(junit)) return null;
  const steps = shellSteps(command);
  if (!steps) return null; // a command keel cannot split safely gets no proposal, never a broken one
  // ||, a pipe, & or a newline would change what the runner's status means to the steps after it: not keel's to rewrite.
  if (steps.ops.some(o => !['&&', ';'].includes(command.slice(o.at, o.end)))) return null;
  const list = [0, ...steps.ops.map(o => o.end)].map((s, i) => {
    let a = s, b = i < steps.ops.length ? steps.ops[i].at : command.length;
    while (a < b && /\s/.test(command[a])) a++;
    while (b > a && /\s/.test(command[b - 1])) b--;
    return { a, b, text: command.slice(a, b) };
  });
  // The runner is its step's own command, so a step's first word is the runner: never inside a control clause
  // (if, while, !: its status would mean something else), after an inline variable (the ledger would not see it), `time`, `env` or a script name.
  const re = RUNNER_STEP[runner];
  const i = re ? list.findIndex(x => re.test(x.text)) : -1;
  if (i < 0) return null;
  const { a: start, b: end, text } = list[i];
  const head = re.exec(text)[0], args = text.slice(head.length);
  // The step already chooses a reporter or its output file: keel's flags would fight it (the last one wins), so it is the person's.
  if (/(?:^|\s)--(?:reporter|reporter-outfile|outputFile)(?:[=.\s]|$)/.test(args)) return null;
  // A step before the runner's that changes directory: the ledger and the JUnit file are then found from the repo's root.
  const moved = list.slice(0, i).some(x => /^(?:cd|pushd)(?:\s|$)/.test(x.text));
  const at = p => moved ? `"$keel_root/${p}"` : p;
  const file = at(junit), dir = posix.dirname(junit);
  const flags = runner === 'bun' ? `--reporter=junit --reporter-outfile=${file}` : `--reporter=default --reporter=junit --outputFile.junit=${file}`;
  const step = [
    ...(moved ? ['keel_root="$(git rev-parse --show-toplevel)" || exit 1'] : []),
    'keel_status=0',
    `rm -f ${file}`,
    `keel_start="$(node ${at(LEDGER_SCRIPT)} --sample)" || keel_start=`,
    `${runner === 'bun' && dir !== '.' ? `mkdir -p ${at(dir)} && ` : ''}${head} ${flags}${args} || keel_status=$?`,
    `node ${at(LEDGER_SCRIPT)} --junit ${file} --runner ${runner} --status $keel_status --start "$keel_start"`,
  ].join('; ');
  const before = command.slice(0, start), after = command.slice(end);
  return before.trim() || after.trim() ? `${before}{ ${step}; }${after}` : step;
}

/**
 * The project's test runner and the ledger's part in it: { runner, from,
 * junit, proposal: { where, now, to } | null }, or null when the gate runs
 * none keel knows. An existing "tests".runner stands. The proposal is the
 * gate's runner step with the JUnit flags and the ledger (ledgerCommand),
 * only for bun or vitest, and only while no script the gate reaches runs
 * the ledger on a JUnit file already.
 */
export function testsPlan(existing, gate, scripts = {}) {
  const runners = detectRunners(gate, scripts);
  const found = runners[0] ?? null;
  const own = ['node', 'bun', 'vitest'].includes(existing?.tests?.runner) ? existing.tests.runner : null;
  // More than one runner (`npm test && npx vitest run`): which runs first, and which the ledger should read, is the person's call.
  const kinds = [...new Set(runners.flatMap(r => r.all))];
  if (!own && kinds.length > 1) {
    return { runner: null, from: runners.map(r => `${r.from}: ${r.all.join(', ')}`).join('; '), junit: null, proposal: null,
      declined: `the gate runs more than one test runner (${kinds.join(', ')}); keel records none and proposes no line: set "tests".runner, then add the ledger by hand` };
  }
  const runner = own ?? found?.runner ?? null;
  if (!runner) return null;
  const junit = typeof existing?.tests?.junit === 'string' ? existing.tests.junit : JUNIT;
  const wired = gateScripts(gate, scripts).some(s => /test-ledger\.mjs"?\s+--junit\b/.test(s.text));
  const asked = runner !== 'node' && found?.runner === runner && !wired;
  const to = asked ? ledgerCommand(found.command, runner, junit) : null;
  return {
    runner, from: own ? '.keel/keel.json' : found.from, junit: runner === 'node' ? null : junit,
    proposal: to ? { where: found.from, now: found.command, to } : null,
    // No proposal rather than a broken one: say why, so the person adds the flags by hand.
    ...(asked && !to ? { declined: !safeJunit(junit)
      ? `"tests".junit (${junit}) is not a .xml file in .keel/test-runs/ of letters, digits, _ . and - only`
      : `${found.from} is not the shape keel rewrites (plain steps joined by && or ;, an optional cd, the runner as its step's own command: no inline variable, if, !, ||, pipe, substitution, group, redirection, or reporter flags of its own); add the flags yourself` } : {}),
  };
}

/** A numbered lessons table: a `| # | … | … | … |` header, its separator, and a numbered row. */
export const numberedLessons = text => /^\|\s*(#|n|no\.?)\s*\|[^\n]*\|[^\n]*\|[^\n]*\|\s*\n\|?\s*:?-{3,}[^\n]*\n(?:[^\n]*\n)*?\|\s*\d+\s*\|/im.test(text ?? '');

/** Where the project keeps its lessons: docs/lessons.md, else the first docs/**\/lessons.md with a numbered table. */
export async function detectLessons(root) {
  if (await info(join(root, DEFAULTS.lessons))) return { path: DEFAULTS.lessons, from: 'docs/lessons.md' };
  const found = [];
  const walk = async (dir, depth) => {
    if (depth > 4) return;
    for (const d of await readdir(join(root, dir), { withFileTypes: true }).catch(() => [])) {
      if (d.name === 'node_modules' || d.name.startsWith('.')) continue;
      const rel = `${dir}/${d.name}`;
      if (d.isDirectory()) await walk(rel, depth + 1);
      else if (d.isFile() && d.name === 'lessons.md' && numberedLessons(await read(join(root, rel)))) found.push(rel);
    }
  };
  await walk('docs', 0);
  found.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  return found.length ? { path: found[0], from: `found: ${found[0]} holds a numbered lessons table` } : { path: DEFAULTS.lessons, from: 'none found; keel seeds docs/lessons.md' };
}

/** Front matter as loose key/value pairs, for projects whose phases keel cannot parse. */
function looseFront(raw) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  const meta = {};
  for (const line of block?.[1].split(/\r?\n/) ?? []) {
    const pair = /^([a-zA-Z_-]+):\s*(.*)$/.exec(line);
    if (pair) meta[pair[1]] = pair[2].trim();
  }
  return meta;
}

/** What the project's phases look like to keel. */
async function readPhases(root) {
  const names = (await list(join(root, 'docs', 'phases'))).filter(n => n.endsWith('.md') && n !== 'README.md').sort();
  const phases = [], errors = [], loose = [];
  for (const file of names) {
    const raw = await read(join(root, 'docs', 'phases', file));
    loose.push({ file, ...looseFront(raw) });
    try { phases.push(parsePhase(file, raw)); } catch (e) { errors.push(e.message); }
  }
  const goalsText = await read(join(root, 'docs', 'goals.json'));
  if (!errors.length && names.length && goalsText !== null) {
    try { validateGraph(phases.sort((a, b) => a.id - b.id), JSON.parse(goalsText)); } catch (e) { errors.push(e.message); }
  }
  return { names, errors, loose, goals: goalsText !== null, milestones: (await read(join(root, 'docs', 'milestones.json'))) !== null };
}

/** Built and lived-in phase files (docs/phases/) that name no evidence, in phase order. */
export async function owingEvidence(root) {
  const { loose } = await readPhases(root);
  return loose.filter(p => DONE.includes(p.status) && !/\S/.test((p.evidence ?? '').replace(/[[\]\s"']/g, '')))
    .sort((a, b) => (parseInt(a.file, 10) - parseInt(b.file, 10)) || a.file.localeCompare(b.file)).map(p => p.file);
}

/** A block's rule: its first bold sentence, without the ** markers, or null. */
export const blockRule = body => /\*\*([^*]+?)\*\*/.exec(body ?? '')?.[1].trim() ?? null;
const norm = text => text.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
/** AGENTS.md without the regions between keel markers: the project's own prose. */
export const ownProse = text => text.replace(/<!-- keel:begin ([a-z0-9-]+) -->[\s\S]*?<!-- keel:end \1 -->/g, '');
/** True when the project's AGENTS.md already states `body`'s rule in its own prose. */
export const statesRule = (agents, body) => {
  const rule = blockRule(body);
  return !!rule && typeof agents === 'string' && norm(ownProse(agents)).includes(norm(rule));
};
export const STATED = 'the project\'s AGENTS.md already states this rule';
const stated = config => STATED.replace('AGENTS.md', guidePath(config));
export const SKIPPED = 'listed in .keel/keel.json "blocksSkipped": the project states this rule in its own words';

/** owner/name from a github.com remote URL (https or ssh, with or without .git), else null. */
export function githubRepo(url) {
  const m = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec((url ?? '').trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/** The project's GitHub repo, when `root` is its own git top level with a github.com origin. */
export async function detectRepo(root) {
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  let top;
  try { top = git(['rev-parse', '--show-toplevel']); } catch { return { repo: null, from: 'not a git repository' }; }
  if ((await realpath(top).catch(() => top)) !== (await realpath(root))) return { repo: null, from: `not its own git repository (inside ${top})` };
  let url;
  try { url = git(['remote', 'get-url', 'origin']); } catch { return { repo: null, from: 'no origin remote' }; }
  const repo = githubRepo(url);
  return repo ? { repo, from: 'git remote origin' } : { repo: null, from: 'origin is not a github.com remote' };
}

function blockState(text, id, body) {
  const b = text.indexOf(begin(id)), e = text.indexOf(end(id));
  if (b < 0 && e < 0) return { status: 'create' };
  if (b < 0 || e < 0 || e < b || text.indexOf(begin(id), b + 1) >= 0 || text.indexOf(end(id), e + 1) >= 0) {
    return { status: 'conflict', note: 'its keel markers are unpaired or repeated' };
  }
  const from = text.indexOf('\n', b) + 1;
  if (!from || from > e) return { status: 'conflict', note: 'its begin marker does not end its line' };
  return text.slice(from, e) === body ? { status: 'same' } : { status: 'keep-local', note: 'the block holds the project\'s own text' };
}

/** The events that can carry a mention: a workflow on one of them answers people. */
export const MENTIONS = ['issue_comment', 'pull_request_review_comment', 'pull_request_review', 'issues', 'discussion', 'discussion_comment'];

/**
 * A workflow's trigger events, read from its top-level `on:` without a YAML
 * parser: `on: push`, `on: [a, b]`, or a block of keys or list items.
 */
export function workflowTriggers(text) {
  const lines = text.split('\n');
  const at = lines.findIndex(l => /^(on|"on"|'on'):(\s|$)/.test(l));
  if (at < 0) return [];
  const inline = lines[at].replace(/^[^:]*:/, '').replace(/\s#.*$/, '').trim();
  if (inline) return inline.replace(/^\[|\]$/g, '').split(',').map(t => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  const out = [];
  let indent = null;
  for (const l of lines.slice(at + 1)) {
    if (!l.trim() || /^\s*#/.test(l)) continue;
    const m = /^(\s+)(?:-\s+)?["']?([A-Za-z_]+)["']?\s*(:|$)/.exec(l);
    if (!/^\s/.test(l)) break;
    if (!m) continue;
    indent ??= m[1].length;
    if (m[1].length === indent) out.push(m[2]);
  }
  return out;
}

/** One file entry of a practice, against the project. */
async function fileState(root, f, config, agents) {
  const target = join(root, f.path);
  const base = { practice: f.practice, path: f.path, kind: f.kind, ...(f.block ? { block: f.block } : {}) };
  if (f.kind === 'block') {
    // A block the project's config already skips stays skipped (render and doctor honour the list too).
    if (Array.isArray(config.blocksSkipped) && config.blocksSkipped.includes(f.block)) return { ...base, status: 'skip', note: SKIPPED };
    if (agents === null) return { ...base, status: 'create' };
    if (agents === false) return { ...base, status: 'conflict', note: `${f.path} is not a file` };
    const body = fill(f.template, config, f.path, f.block);
    const state = blockState(agents, f.block, body);
    return state.status === 'create' && statesRule(agents, body) ? { ...base, status: 'skip', note: stated(config) } : { ...base, ...state };
  }
  const now = await info(target);
  if (f.link !== undefined) {
    if (!now) return { ...base, status: 'create' };
    if (!now.isSymbolicLink()) return { ...base, status: 'conflict', note: `exists and is not a symlink; keel's is a link to ${f.link}` };
    return (await readlink(target)) === f.link ? { ...base, status: 'same' } : { ...base, status: 'keep-local', note: `links to ${await readlink(target)}, keel's to ${f.link}` };
  }
  if (!now) return { ...base, status: 'create' };
  if (!now.isFile()) return { ...base, status: 'conflict', note: 'exists and is not a regular file' };
  const same = (await readFile(target, 'utf8')) === fill(f.template, config, f.path);
  return { ...base, status: same ? 'same' : 'keep-local', ...(same || f.kind === 'seeded' ? {} : { note: 'differs from keel\'s' }) };
}

/** Same-stem siblings of a managed file (scripts/roadmap.ts beside keel's scripts/roadmap.mjs). */
async function siblings(root, f) {
  if (f.kind !== 'managed' || f.link !== undefined) return [];
  const dir = dirname(f.path), own = basename(f.path);
  const stem = own.slice(0, own.length - extname(own).length);
  return (await list(join(root, dir))).filter(n => n !== own && n.startsWith(`${stem}.`) && n.slice(stem.length + 1).split('.').length === 1)
    .map(n => ({ practice: f.practice, path: dir === '.' ? n : `${dir}/${n}`, kind: 'managed', status: 'keep-local', note: `the project's own ${stem}; keel's ${f.path} is not installed beside it` }));
}

/**
 * Classify `root`. Returns { config, practices: [{name, state, why}], files,
 * check: {check, from} } and writes nothing.
 */
export async function survey(root, { check, setup, env, guide, version, practices, with: asked = [], milestoneRead, sourceEnv = process.env }) {
  const existing = JSON.parse((await read(join(root, '.keel', 'keel.json'))) ?? '{}');
  const pkgText = await read(join(root, 'package.json'));
  let pkg = null;
  try { pkg = pkgText === null ? null : JSON.parse(pkgText); } catch { throw new AdoptError(`${root}/package.json is not JSON`, 1); }
  const readme = await read(join(root, 'README.md'));
  const detected = check ? { check, from: '--check' } : existing.check ? { check: existing.check, from: '.keel/keel.json' } : detectCheck(pkg);
  const name = existing.name ?? pkg?.name ?? basename(root);
  const tagline = existing.tagline ?? (readme && readmeTagline(readme)) ?? (pkg?.description && firstSentence(pkg.description)) ?? name;
  const lessons = existing.lessons ? { path: existing.lessons, from: '.keel/keel.json' } : await detectLessons(root);
  const repo = existing.repo ? { repo: existing.repo, from: '.keel/keel.json' } : await detectRepo(root);
  // The test runner (phase 59): bun test or vitest is recorded, and the ledger's flags are proposed, never written.
  const tests = testsPlan(existing, detected.check, pkg?.scripts ?? {});
  const values = { ...existing, ...(guide !== undefined ? { guide } : {}), name, tagline, ...(detected.check ? { check: detected.check } : {}), ...(lessons.path !== DEFAULTS.lessons ? { lessons: lessons.path } : {}) };
  await withProject(root, values); // renovate.json is shaped by the project's workspaces
  validateGuideTargets(values, practices);
  // docs/keel-lessons.md is shaped by the stack: the files on disk show it
  // before the practices are read (a project init made compares as keel's);
  // the files adopt will write are added below, for the config.
  if (values.stack === undefined) {
    const shown = (await detectStack(root)).map(d => d.tag);
    if (shown.length) values.stack = shown;
  }

  const agentsInfo = await info(join(root, guidePath(values)));
  const agents = !agentsInfo ? null : agentsInfo.isFile() ? await readFile(join(root, guidePath(values)), 'utf8') : false;
  const phases = await readPhases(root);
  const projects = existing.phases?.shape === 'projects' || !phases.names.length ? await detectProjects(root) : null;
  // Never probe GitHub when local plans already exist. Discovery needs a repo and auth.
  let milestoneDiscovery = null;
  let milestones = milestoneSource(existing);
  if (!milestones && !projects && !phases.names.length) {
    if (!repo.repo) milestoneDiscovery = { state: 'unavailable', why: 'no known GitHub repository' };
    else if (!milestoneRead && sourceEnv.KEEL_MILESTONES_OFFLINE === '1') milestoneDiscovery = { state: 'unavailable', why: 'milestone discovery is offline' };
    else {
      try {
        if (!milestoneRead) execFileSync(sourceEnv.KEEL_GH || 'gh', ['auth', 'status'], { env: sourceEnv, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
        const plan = await (milestoneRead ?? readMilestones)({ ...existing, repo: repo.repo, phases: { source: 'milestones' } }, { env: sourceEnv });
        milestones = plan.phases.some(p => p.done?.trim());
        milestoneDiscovery = { state: plan.coverage.complete ? 'complete' : 'partial', described: milestones, coverage: plan.coverage, github: plan.github };
      } catch (e) { milestoneDiscovery = { state: 'unavailable', why: `milestones unavailable: ${e.message}` }; }
    }
  }
  const workflows = (await list(join(root, '.github', 'workflows'))).filter(n => /\.ya?ml$/.test(n)).sort();

  const ejected = new Set((Array.isArray(existing.ejected) ? existing.ejected : []).map(k => guideKey(values, k)));
  const names = [...practices.keys()].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));
  const rows = new Map();
  for (const n of names) {
    const p = practices.get(n);
    const files = [];
    for (const f of p.files) {
      const at = placed(f, values);
      if (ejected.has(at.block ? `${at.path}#${at.block}` : at.path)) continue; // the project's own by choice, never a reason to go local
      if (!targetWanted(f, values)) continue; // a target only while its condition holds (practice.json "when")
      files.push(await fileState(root, at, values, agents));
      files.push(...await siblings(root, at));
    }
    rows.set(n, { name: n, state: 'on', why: [], files });
  }
  const local = (n, why) => { const r = rows.get(n); if (r.state !== 'off') r.state = 'local'; r.why.push(why); };
  // A workflow that is keel's own, byte for byte (a re-run of adopt), is not the project's: it never makes a practice local.
  const keels = new Set([...rows.values()].flatMap(r => r.files).filter(f => f.path.startsWith('.github/workflows/') && f.status === 'same').map(f => f.path.split('/').pop()));
  const theirs = workflows.filter(n => !keels.has(n));
  const off = (n, why) => { const r = rows.get(n); r.state = 'off'; r.why = [why]; };

  // Project-specific detection, one rule per practice.
  if (rows.has('base') && !pkg) off('base', 'no package.json; keel\'s gate is an npm script');
  const bare = phases.loose.filter(p => DONE.includes(p.status) && !/\S/.test((p.evidence ?? '').replace(/[[\]\s"']/g, '')))
    .sort((a, b) => (parseInt(a.file, 10) - parseInt(b.file, 10)) || a.file.localeCompare(b.file));
  const owing = bare.map(p => p.file).join(', ');
  if (rows.has('phases')) {
    if (milestones) local('phases', 'GitHub milestones are read-only planning records; source: milestones; no managed phase files or roadmap installed');
    else if (projects) local('phases', `phases live in docs/projects/<project>/phases.md (${plural(projects.projects, 'project')}) with **Status:** lines; keel reads them read-only (keel next --project <p>, keel status) and never writes them or a roadmap; keel's docs/phases/ is not installed`);
    else if (!phases.names.length) off('phases', `no docs/phases/*.md; ${milestoneDiscovery?.why ?? (milestoneDiscovery?.state === 'partial' ? 'milestone discovery truncated; no described milestone observed' : 'complete milestone discovery found no described milestones')}`);
    else if (phases.loose.some(p => 'milestone' in p) || phases.milestones) {
      local('phases', `phase files name a milestone${phases.milestones ? ' and docs/milestones.json holds them' : ''}; proposal: migrate milestone→goal (phase 6 migration)`);
    } else if (phases.errors.length || !phases.goals) {
      const missing = [...new Set(phases.errors.map(e => /missing (\w+)$/.exec(e)?.[1]).filter(Boolean))];
      const converge = missing.includes('goal') && !phases.goals
        ? `migration 0003 adds goal, docs/goals.json and keel's missing sections (marked as added), and applies only once every built phase names evidence${bare.length ? ` — ${plural(bare.length, 'built phase')} owe it (${owing}): write the evidence when each is next checked, or step it back to partial; 0003 never writes placeholder evidence` : ''}`
        : 'a migration that adds the fields keel\'s format needs, shown as a diff — never by inventing evidence';
      local('phases', `${plural(phases.errors.length, 'phase file')} of ${phases.names.length} fail keel's parser (${missing.length ? `missing ${missing.join(', ')}` : phases.errors[0]})${phases.goals ? '' : '; no docs/goals.json'}; proposal: ${converge}`);
    }
  }
  if (rows.has('evidence')) {
    if (milestones) local('evidence', 'GitHub closure is planning state, not verified acceptance or production evidence');
    else if (projects) local('evidence', 'phases are in the projects shape: each phase\'s **Status:** line carries its proof; keel\'s evidence files serve docs/phases/');
    else if (!phases.names.length) off('evidence', 'no phases to carry evidence');
    else if (bare.length) local('evidence', `${plural(bare.length, 'built phase')} name no evidence (${owing}); proposal: write evidence when each is next checked, or step it back to partial — never invent it`);
  }
  // A practice whose upstream source is this repo: the project's file is the original, keel's the copy.
  const upstream = new Set();
  for (const r of rows.values()) {
    const src = practices.get(r.name).source;
    if (!src || r.state === 'off') continue;
    const dir = await info(join(root, dirname(src.path)));
    if (dir?.isDirectory() && (await info(join(root, src.path)))?.isFile()) {
      upstream.add(r.name);
      local(r.name, `this repo is ${r.name}'s upstream source (${src.repo} ${src.path}); keel never seeds a copy of it here, and never installs ${r.files.filter(f => f.kind !== 'block').map(f => f.path).join(' or ')} beside it`);
    }
  }
  if (rows.has('ci') && !detected.check) off('ci', 'no gate found; pass --check "<command>" and adopt again');
  if (rows.has('ci') && detected.check && theirs.length) {
    const ours = rows.get('ci').files.find(f => f.path === '.github/workflows/check.yml');
    if (ours?.status !== 'same') {
      let runs = null;
      for (const w of theirs) if ((await read(join(root, '.github', 'workflows', w)))?.includes(values.check)) { runs = w; break; }
      local('ci', `the project has workflows (${theirs.join(', ')})${runs ? ` and ${runs} already runs \`${values.check}\`` : ''}; keel's check.yml is not added beside them, since that would run the gate twice; proposal: ${runs ? 'keep it, or let keel manage it as check.yml' : `point the workflow that gates pushes at \`${values.check}\`, or replace it with keel's check.yml`}`);
    }
  }
  // The night shift's three practices, like ci: a project already doing the job
  // in its own file keeps it, and keel's is not added beside it to do it twice.
  const own = async (names, pattern) => {
    for (const w of names) if (pattern.test((await read(join(root, '.github', 'workflows', w))) ?? '')) return w;
    return null;
  };
  // An optional practice is asked for by --with, or by being on already (a re-run).
  const wanted = n => asked.includes(n) || (Array.isArray(existing.practices) && existing.practices.includes(n));
  if (rows.has('reconciliation') && !wanted('reconciliation')) off('reconciliation', 'optional; --with reconciliation to add it');
  // A climb night spends model tokens each night it runs: only ever asked for (phase 35).
  if (rows.has('climb') && !wanted('climb')) off('climb', 'optional, and each climb night spends model tokens; --with climb to add it');
  // A cross-review spends model tokens on each PR it reviews: only ever asked for (phase 42).
  if (rows.has('cross-review') && !wanted('cross-review')) off('cross-review', 'optional, and each reviewed PR spends model tokens; --with cross-review to add it');
  // claude's job is answering mentions: a workflow running claude-code-action
  // is the project's own version of it only when a mention can start it. A
  // scheduled writer (a nightly changelog) answers nobody (phase 29).
  if (rows.has('claude')) {
    const runs = [];
    for (const n of theirs.filter(n => n !== 'claude.yml')) {
      const text = (await read(join(root, '.github', 'workflows', n))) ?? '';
      if (/anthropics\/claude-code-action/.test(text)) runs.push({ name: n, on: workflowTriggers(text) });
    }
    const w = runs.find(r => r.on.some(t => MENTIONS.includes(t)));
    const quiet = runs.filter(r => r !== w).map(r => `${r.name} runs anthropics/claude-code-action on ${r.on.length ? r.on.join(', ') : 'no trigger keel can read'}, not on a mention`);
    const mine = rows.get('claude').files.some(f => f.kind !== 'seeded' && ['keep-local', 'conflict'].includes(f.status));
    if (w) local('claude', `${w.name} already runs anthropics/claude-code-action on ${w.on.filter(t => MENTIONS.includes(t)).join(', ')}; keel's claude.yml is not added beside it, so one mention gets one answer; proposal: keep it, or let keel manage it as claude.yml`);
    else if (!mine && !wanted('claude')) off('claude', `optional; --with claude to add it${quiet.length ? ` (${quiet.join('; ')})` : ''}`);
  }
  if (rows.has('night')) {
    const w = await own(theirs.filter(n => !['keel-night.yml', 'keel-update.yml'].includes(n)), /\bkeel (improve|update|drain)\b/);
    if (w) local('night', `${w} already runs keel's night shift; proposal: keep it, or let keel manage keel-night.yml and scripts/keel/`);
    else {
      const script = typeof pkg?.scripts?.night === 'string' ? 'npm run night' : null;
      const file = (await list(join(root, 'scripts'))).find(n => /^night\.(mjs|cjs|js|ts)$/.test(n));
      if (script || file) local('night', `the project runs its own night shift (${[file && `scripts/${file}`, script].filter(Boolean).join(', ')}); keel's keel-night.yml and scripts/keel/ are not added beside it; proposal: keep yours, or compare its measures with keel's improve and retire one`);
    }
  }
  // Loop is optional: on only where the project has a Loop workspace and no
  // triage of its own; local where it already triages (its findings are left
  // exactly as they are); off otherwise.
  if (rows.has('loop')) {
    const script = rows.get('loop').files.find(f => /^scripts\/loop\.[^/]+$/.test(f.path) && f.status === 'keep-local');
    const flow = await own(theirs.filter(n => n !== 'keel-loop.yml'), /scripts\/loop\.\w+ pull\b|run loop -- pull\b/);
    if (script || flow) {
      local('loop', `the project triages Loop with its own ${script ? script.path : `.github/workflows/${flow}`}; proposal: render docs/LOOP.md with keel's scripts/loop.mjs in a copy and compare it with yours (only the generated-by line should differ), keep your wording with .keel/keel.json "loop" {run, insights}, then retire yours for keel's`);
    } else if (!wanted('loop') && !(await info(join(root, '.stitch.json')))) {
      off('loop', 'optional, and there is no .stitch.json: no Loop workspace to triage');
    }
  }
  if (rows.has('renovate')) {
    const configs = ['renovate.json5', '.github/renovate.json', '.github/renovate.json5', '.gitlab/renovate.json', '.renovaterc', '.renovaterc.json', '.github/dependabot.yml', '.github/dependabot.yaml'];
    const found = [];
    for (const c of configs) if (await info(join(root, c))) found.push(c);
    if (found.length) local('renovate', `the project configures its dependency updates already (${found.join(', ')}); proposal: keep it, or move to keel's four lanes in renovate.json`);
  }
  // A managed file or block the project has its own version of, or cannot take, keeps its practice local.
  for (const r of rows.values()) {
    if (r.state === 'off' || upstream.has(r.name)) continue;
    const own = r.files.filter(f => f.kind !== 'seeded' && (f.status === 'keep-local' || f.status === 'conflict'));
    if (own.length) local(r.name, `${own.map(f => f.block ? `${f.path}#${f.block}` : f.path).join(', ')} ${own.length === 1 ? 'is' : 'are'} the project's own (${own.map(f => f.note).filter(Boolean)[0]}); proposal: keep yours (eject), take keel's, or send yours upstream as a lesson`);
    if (r.state === 'on' && agents === null && r.files.some(f => f.kind === 'block') && rows.get('agents-md')?.state !== 'on' && r.name !== 'agents-md') {
      local(r.name, `${guidePath(values)} is missing and agents-md is not switched on to seed it; proposal: write ${guidePath(values)}, then adopt again`);
    }
  }
  // Requirements: met by on or local; a practice whose requirement is off is off.
  for (let changed = true; changed;) {
    changed = false;
    for (const r of rows.values()) {
      if (r.state === 'off') continue;
      const gone = practices.get(r.name).requires.find(q => rows.get(q)?.state === 'off');
      if (gone) { off(r.name, `needs ${gone}, which is off`); changed = true; }
    }
  }
  // The proposed line runs scripts/keel/test-ledger.mjs, which only the night practice installs:
  // with night local or off and no ledger already there, the line would break the gate, so none is proposed.
  if (tests?.proposal && rows.get('night')?.state !== 'on' && !(await info(join(root, LEDGER_SCRIPT)))?.isFile()) {
    tests.proposal = null;
    tests.declined = `the night practice is ${rows.get('night')?.state ?? 'not available'} here, so keel does not install ${LEDGER_SCRIPT}, which the line would run; once night is on, adopt again for the line`;
  }

  const files = [];
  for (const r of rows.values()) {
    if (r.state === 'off') continue;
    for (const f of r.files) {
      if (r.state === 'local' && ['create', 'skip'].includes(f.status)) continue; // nothing installed for a local variant
      files.push(f);
    }
  }
  // The stack (phase 30): a declared one stands (doctor lints it against the
  // evidence); else what the files show once adopted, keel's own among them
  // (check.yml is github-actions evidence), so doctor agrees the next minute.
  const planned = new Map();
  for (const f of files) if (f.kind !== 'block' && f.status === 'create' && !f.path.endsWith('/')) {
    const t = practices.get(f.practice).files.find(x => placed(x, values).path === f.path && x.kind === f.kind);
    if (!t || t.link !== undefined || t.path === STACK_VIEW) continue;
    try { planned.set(f.path, fill(t.template, values, f.path)); } catch { /* render names a template it cannot fill */ }
  }
  const found = await detectStack(root, undefined, planned);
  const stack = existing.stack !== undefined ? { stack: existing.stack, from: '.keel/keel.json', detected: found }
    : { stack: found.map(d => d.tag), from: found.length ? `detected: ${found.map(d => `${d.tag} (${d.evidence.join(', ')})`).join(', ')}` : 'detected: nothing', detected: found };
  if (stack.stack.length) values.stack = stack.stack; else delete values.stack;

  const config = {
    ...existing, guide: values[GUIDE].selected, name, tagline, ...(repo.repo ? { repo: repo.repo } : {}), ...(detected.check ? { check: detected.check } : {}),
    ...(setup !== undefined ? { setup } : {}),
    ...(env && Object.keys(env).length ? { env: { ...(existing.env ?? {}), ...env } } : {}),
    ...(values.lessons ? { lessons: values.lessons } : {}),
    ...(values.stack ? { stack: values.stack } : {}),
    ...(milestones ? { phases: { ...(existing.phases ?? {}), source: 'milestones' } } : projects ? { phases: { shape: 'projects' } } : {}),
    ...(tests?.runner && tests.runner !== 'node' ? { tests: { ...(existing.tests ?? {}), runner: tests.runner, junit: tests.junit } } : {}),
    practice: version.practice,
    practices: names.filter(n => rows.get(n).state === 'on'),
  };
  const localMap = Object.fromEntries(names.filter(n => rows.get(n).state === 'local').map(n => [n, rows.get(n).why.join('; ')]));
  if (Object.keys(localMap).length) config.local = localMap; else delete config.local;
  const skipped = [...new Set(names.filter(n => rows.get(n).state === 'on').flatMap(n => rows.get(n).files.filter(f => f.status === 'skip').map(f => f.block)))].sort();
  if (skipped.length) config.blocksSkipped = skipped; else delete config.blocksSkipped;

  await withProject(root, config);
  return {
    config, check: detected, lessons, repo, stack, files, tests, milestoneDiscovery,
    practices: [...rows.values()].map(r => ({ name: r.name, state: r.state, why: r.why.join('; ') || (r.state === 'on' ? 'the project satisfies it' : '') })),
  };
}

/** AGENTS.md with the on practices' missing block markers appended; every existing byte kept. */
export function appendBlocks(text, ids) {
  if (!ids.length) return text;
  let out = text.length && !text.endsWith('\n') ? `${text}\n` : text;
  if (!out.includes(`\n${HEADING}\n`) && !out.startsWith(`${HEADING}\n`)) {
    out += `${out.length ? '\n' : ''}${HEADING}\n\nThe regions between keel markers are rendered by keel; the rest of this file is the project's own.\n`;
  }
  for (const id of ids) out += `\n${begin(id)}\n${end(id)}\n`;
  return out;
}

/** What adopt says about the test runner: [line]; none when the gate runs no runner keel knows. */
export function testsLines(tests) {
  if (!tests) return [];
  if (!tests.runner) return [`Tests: none recorded (${tests.from}); ${tests.declined}`];
  if (tests.runner === 'node') return [`Tests: node --test (${tests.from}); the test ledger is a node reporter there`];
  return [
    `Tests: ${tests.runner} (${tests.from}); the test ledger reads its JUnit from ${tests.junit}`,
    ...(tests.proposal ? [`  Proposal for ${tests.proposal.where} (adopt never rewrites the gate): ${tests.proposal.to}`] : []),
    ...(tests.declined ? [`  No proposal: ${tests.declined}`] : []),
  ];
}

/** docs/keel-adoption.md: every local variant and its proposal, for the person reading the PR. */
export function adoptionReport({ config, practices, files, tests = null }) {
  const label = f => `\`${f.block ? `${f.path}#${f.block}` : f.path}\``;
  const kept = files.filter(f => f.status === 'keep-local'), conflicts = files.filter(f => f.status === 'conflict');
  const locals = practices.filter(p => p.state === 'local');
  return [
    `# ${config.name} under keel: what stayed its own`, '',
    `Written by \`keel adopt\` on practice ${config.practice}. Keel switched on only the practices this project already satisfies; where it has its own version, nothing was installed and a proposal is recorded here and in \`.keel/keel.json\` (\`local\`). The project's gate is \`${config.check}\`.`, '',
    'Decide each proposal in review: keep yours (eject), take keel\'s, or send yours upstream as a lesson.', '',
    '## Practices', '',
    '| Practice | State | Why |', '| --- | --- | --- |',
    ...practices.map(p => `| ${p.name} | ${p.state} | ${(p.why || '—').replaceAll('|', '&#124;')} |`), '',
    '## Local variants and proposals', '',
    ...(locals.length ? locals.flatMap(p => [`### ${p.name}`, '', p.why, '']) : ['None.', '']),
    '## Files kept as the project\'s own', '',
    ...(kept.length ? kept.map(f => `- ${label(f)} (${f.practice})${f.note ? ` — ${f.note}` : ''}`) : ['None.']), '',
    '## Blocks not appended', '',
    ...(config.blocksSkipped?.length ? config.blocksSkipped.map(id => `- \`${guidePath(config)}#${id}\` — ${stated(config)} (\`blocksSkipped\` in \`.keel/keel.json\`)`) : ['None.']), '',
    '## Conflicts', '',
    ...(conflicts.length ? conflicts.map(f => `- ${label(f)} (${f.practice}) — ${f.note}`) : ['None.']), '',
    ...(tests?.proposal ? [
      '## The test ledger', '',
      `The tests run on ${tests.runner}, so keel's test ledger reads the JUnit file it writes (\`${tests.junit}\`) after each run. Adopt does not change the gate. To turn the ledger on, change ${tests.proposal.where} from`, '',
      '```sh', tests.proposal.now, '```', '', 'to', '', '```sh', tests.proposal.to, '```', '',
      'The ledger is handed the runner\'s exit code (`--status $keel_status`), so the gate fails exactly when it did, and also when no test ran. `|| keel_status=$?` keeps that code even where the shell runs under `set -e`, so a red run is still recorded.', '',
    ] : []),
  ].join('\n');
}

/**
 * Adopt `opts.dir`. opts: { dir, dryRun, check, setup?, env? ({NAME: value}), with? ([optional practice names]) }. deps: { version }.
 * Returns { data, text }.
 */
async function addedWorkflowCost(root, config, files, practices, ciEnv, now) {
  const created = new Set(files.filter(f => f.status === 'create' && /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f.path)).map(f => f.path));
  const workflows = targets(config, practices).filter(f => created.has(f.path)).map(f => {
    const text = fill(f.template, config, f.path);
    return { path: f.path, text, triggers: workflowTriggers(text) };
  });
  return adoptionCost({ root, config, workflows, env: ciEnv, now });
}

export async function adopt(opts, { version, practices, ciEnv = process.env, now = Date.now(), milestoneRead }) {
  const root = resolve(opts.dir);
  if (!(await info(root))?.isDirectory()) throw new AdoptError(`${root} is not a directory`);
  if (opts.check !== undefined && !opts.check.trim()) throw new AdoptError('--check needs a command');
  practices ??= await load();
  const setup = opts.setup?.trim();
  if (opts.setup !== undefined && !setup) throw new AdoptError('--setup needs a command');
  const bad = setupEnvProblems({ setup, env: opts.env });
  if (bad.length) throw new AdoptError(bad.join('; '));
  let asked;
  try { asked = withOptional(practices, opts.with); } catch (e) { throw new AdoptError(e.message); }
  const result = await survey(root, { check: opts.check?.trim(), setup, env: opts.env, guide: opts.guide, version, practices, with: asked, milestoneRead, sourceEnv: ciEnv });
  let existing = null;
  try { existing = JSON.parse((await read(join(root, '.keel', 'keel.json'))) ?? 'null'); } catch { existing = null; }
  const adding = existing && Array.isArray(existing.practices) && typeof existing.practice === 'string' ? asked.filter(n => !existing.practices.includes(n)) : [];
  if (adding.length) return addPractices(root, adding, existing, result, opts, { practices, ciEnv, now });
  if (!opts.dryRun && !result.check.check) throw new AdoptError(`${NO_GATE}; adopt never invents one (it writes nothing without a gate)`);
  const ciCost = await addedWorkflowCost(root, result.config, result.files, practices, ciEnv, now);
  const written = [];
  if (!opts.dryRun) {
    const put = async (path, content) => {
      const target = join(root, path);
      if ((await read(target)) === content) return;
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
      written.push(path);
    };
    await put('.keel/keel.json', `${JSON.stringify(result.config, null, 2)}\n`);
    const agentsPath = join(root, guidePath(result.config));
    const agents = await read(agentsPath);
    if (agents !== null) {
      const ids = result.files.filter(f => f.kind === 'block' && f.status === 'create').map(f => f.block);
      const next = appendBlocks(agents, ids);
      if (!next.startsWith(agents)) throw new AdoptError('the selected guide would lose bytes; refusing', 1);
      await put(guidePath(result.config), next);
    }
    // The stop rule, checked rather than trusted: render may only create files and fill blocks.
    const dry = await render(root, { check: true, practices });
    const over = dry.entries.filter(e => e.kind !== 'block' && e.status === 'update');
    if (over.length) throw new AdoptError(`render would overwrite the project's ${over.map(e => e.path).join(', ')}; refusing`, 1);
    const lockBefore = await read(join(root, LOCK));
    const done = await render(root, { practices });
    for (const e of done.entries) if (e.status === 'create' || (e.status === 'update' && !written.includes(e.path))) written.push(e.path);
    if ((await read(join(root, LOCK))) !== lockBefore) written.push(LOCK);
    await put(REPORT, adoptionReport(result));
  }
  const secrets = secretsNeeded(practices, result.config.practices);
  const data = { dir: root, dryRun: !!opts.dryRun, check: result.check, lessons: result.lessons, repo: result.repo, stack: result.stack, tests: result.tests, milestoneDiscovery: result.milestoneDiscovery, config: result.config, practices: result.practices, files: result.files, written, secrets, ciCost };
  const label = f => f.block ? `${f.path}#${f.block}` : f.path;
  const text = [
    `${opts.dryRun ? 'Dry run: nothing written.' : `Adopted ${result.config.name} on practice ${version.practice}: ${written.length ? `wrote ${written.join(', ')}` : 'nothing to change'}.`}`,
    result.check.check ? `Gate: ${result.check.check} (${result.check.from})` : NO_GATE,
    `Guide: ${result.config.guide} (destination: ${guidePath(result.config)})`,
    `Lessons: ${result.lessons.path} (${result.lessons.from})`,
    `Stack: ${result.stack.stack.length ? `${result.stack.stack.join(', ')} (${result.stack.from}; docs/keel-lessons.md carries the lessons tagged for it)` : `none (${result.stack.from}; docs/keel-lessons.md carries keel's universal lessons)`}`,
    result.repo.repo ? `Repo: ${result.repo.repo} (${result.repo.from})` : `Repo: unset — ${result.repo.from}; keel records one only from a github.com origin of the project's own git repository`,
    ...(result.config.setup !== undefined ? [`Setup: ${result.config.setup} (the night's install, before the gate)`] : []),
    ...(result.config.env ? [`Env: ${Object.entries(result.config.env).map(([k, v]) => `${k}=${v}`).join(' ')} (wherever keel runs the gate)`] : []),
    ...(result.config.phases?.shape === 'projects' ? ['Phases: the projects shape (docs/projects/<p>/phases.md), read-only'] : []),
    ...testsLines(result.tests),
    '', 'Practices:',
    ...result.practices.map(p => `  ${p.state.padEnd(5)} ${p.name}${p.state === 'on' ? '' : ` — ${p.why}`}`), '', 'Files:',
    ...result.files.map(f => `  ${f.status.padEnd(10)} ${label(f)} (${f.practice})${f.note ? ` — ${f.note}` : ''}`),
    ...adoptionCostLines(ciCost),
    '', `Secrets needed (⚑ each is the owner's to set): ${secrets.length ? '' : 'none'}`,
    ...secrets.map(s => `  ${s.name} — ${s.workflow}: ${s.why}`),
    ...(opts.dryRun ? [] : ['', `Local variants and proposals: ${REPORT}`]),
  ].join('\n');
  return { data, text };
}

/**
 * `--with <p>` on a project already adopted: add only <p>. Returns { data, text }.
 * Writes .keel/keel.json (practices, local, blocksSkipped only), the new
 * blocks in AGENTS.md, the practice's own files, and their lock entries.
 */
async function addPractices(root, adding, existing, result, opts, { practices, ciEnv, now }) {
  for (const n of adding) {
    const row = result.practices.find(p => p.name === n);
    if (row?.state !== 'on') throw new AdoptError(`--with ${n}: ${n} would be ${row?.state ?? 'unknown'} here — ${row?.why || 'no reason given'}; nothing written`, 1);
  }
  const order = n => ORDER.indexOf(n) + 1 || 99;
  const config = { ...existing, ...(opts.guide !== undefined || result.config.guide !== 'AGENTS.md' ? { guide: result.config.guide } : {}), practices: [...existing.practices, ...adding].sort((a, b) => order(a) - order(b) || a.localeCompare(b)) };
  await withProject(root, config);
  if (config.local) {
    config.local = Object.fromEntries(Object.entries(config.local).filter(([n]) => !adding.includes(n)));
    if (!Object.keys(config.local).length) delete config.local;
  }
  const mine = result.files.filter(f => adding.includes(f.practice));
  const skip = mine.filter(f => f.kind === 'block' && f.status === 'skip').map(f => f.block);
  if (skip.length) config.blocksSkipped = [...new Set([...(existing.blocksSkipped ?? []), ...skip])].sort();
  const files = mine.filter(f => f.status !== 'same');
  const ciCost = await addedWorkflowCost(root, config, mine, practices, ciEnv, now);
  const written = [];
  if (!opts.dryRun) {
    const put = async (path, content) => {
      const target = join(root, path);
      if ((await read(target)) === content) return;
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
      if (!written.includes(path)) written.push(path);
    };
    const agentsPath = join(root, guidePath(config));
    const agents = await read(agentsPath);
    const ids = mine.filter(f => f.kind === 'block' && f.status === 'create').map(f => f.block);
    if (ids.length && agents === null) throw new AdoptError(`--with ${adding.join(', ')}: ${guidePath(config)} is missing, and its ${ids.join(', ')} block needs it; nothing written`, 1);
    const lock = (await readLock(root)) ?? { practice: existing.practice, files: {} };
    // Only the added practices' entries: every other target keeps its bytes, even one behind keel.
    // A block's markers are appended below, so plan sees them missing: its body comes from the template.
    const bodies = new Map(targets(config, practices).filter(f => f.kind === 'block').map(f => [f.block, fill(f.template, config, f.path, f.block)]));
    const entries = (await plan(root, config, practices, lock)).filter(e => adding.includes(e.practice))
      .map(e => e.kind === 'block' ? { ...e, body: bodies.get(e.block) } : e);
    const over = entries.filter(e => e.kind !== 'block' && e.status === 'update');
    if (over.length) throw new AdoptError(`render would overwrite the project's ${over.map(e => e.path).join(', ')}; refusing`, 1);
    await put('.keel/keel.json', `${JSON.stringify(config, null, 2)}\n`);
    let text = ids.length ? appendBlocks(agents, ids) : agents;
    if (agents !== null && !text.startsWith(agents)) throw new AdoptError('the selected guide would lose bytes; refusing', 1);
    for (const e of entries) {
      if (e.kind === 'block') { text = replaceBlock(text, e.block, e.body, e.path); continue; }
      if (e.status === 'create') await put(e.path, e.content);
    }
    if (text !== null && text !== agents) await put(guidePath(config), text);
    const added = lockOf(entries, lock.practice).files;
    if (await writeLock(root, { ...lock, files: { ...lock.files, ...added } })) written.push(LOCK);
  }
  const secrets = secretsNeeded(practices, adding);
  const label = f => f.block ? `${f.path}#${f.block}` : f.path;
  const data = { dir: root, dryRun: !!opts.dryRun, added: adding, config, files: mine, written, secrets, ciCost };
  const text = [
    opts.dryRun ? `Dry run: nothing written. ${existing.name ?? basename(root)} is adopted; --with adds ${adding.join(', ')} and leaves everything else as it is.`
      : `Added ${adding.join(', ')} to ${existing.name ?? basename(root)} (practice ${existing.practice} kept): wrote ${written.join(', ')}.`,
    '', 'Files:',
    ...mine.map(f => `  ${f.status.padEnd(10)} ${label(f)} (${f.practice})${f.note ? ` — ${f.note}` : ''}`),
    ...(files.length ? [] : ['  (nothing to write)']),
    ...adoptionCostLines(ciCost),
    '', `Secrets needed (⚑ each is the owner's to set): ${secrets.length ? '' : 'none'}`,
    ...secrets.map(x => `  ${x.name} — ${x.workflow}: ${x.why}`),
  ].join('\n');
  return { data, text };
}
