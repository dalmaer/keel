// keel prove (phase 62): a fix is proven by its test failing without it.
//
// Every fix ships with a test, but a test that never failed without its fix
// proves nothing. keel prove runs the named test twice: once in a scratch
// git worktree of the current tree with the fix's files put back as they were
// at the base commit, and once in the real tree, with the fix. The verdict:
//
//   VERIFIED     red without the fix, green with it;
//   NOT WORKING  green without it (the test does not catch the bug), or red with it;
//   INCONCLUSIVE the test cannot run without the fix (it does not load, its
//                file is part of the fix), or no test matched --name.
//
// The user's working tree is never touched (lesson 54: a deliberate break is
// made in a scratch worktree, never the shared checkout). The scratch tree is
// removed in every case.
//
// The runner: `node --test`, with the preloads (--import, --require) the
// project's package.json test script gives it, so a test runs as it runs in
// the gate. A project on another runner names its command in .keel/keel.json
// `"prove": { "command": "<command> {file}" }` ({name} for --name); keel then
// reads its exit code alone.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, lstatSync, realpathSync } from 'node:fs';
import { mkdtemp, mkdir, cp, rm, readFile, readdir, appendFile, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, isAbsolute, sep } from 'node:path';

export const VERDICTS = ['VERIFIED', 'NOT WORKING', 'INCONCLUSIVE'];

export class ProveError extends Error {
  constructor(message, exitCode = 2) { super(message); this.exitCode = exitCode; }
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function git(cwd, args, { ok = true } = {}) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (ok && r.status !== 0) throw new ProveError(`git ${args.join(' ')} exited ${r.status}: ${(r.stderr || '').trim().split('\n')[0]}`, 1);
  return r;
}
const zlist = out => out.split('\0').filter(Boolean);

// ---- the runner -------------------------------------------------------------

const PRELOAD = ['--import', '--require', '-r', '--loader', '--experimental-loader'];

/** The preload flags of the first `node … --test …` in a command's text: ['--import', 'x', …]. */
export function nodePreloads(text) {
  for (const [segment] of String(text ?? '').matchAll(/\bnode\s[^&|;\n]*/g)) {
    const words = segment.trim().split(/\s+/).slice(1).map(w => w.replace(/^['"]|['"]$/g, ''));
    if (!words.includes('--test')) continue;
    const out = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (/^--(import|require|loader|experimental-loader)=/.test(w)) out.push(w);
      else if (PRELOAD.includes(w) && words[i + 1] !== undefined) out.push(w, words[++i]);
    }
    return out;
  }
  return null;
}

/**
 * How this project runs one test file: { kind: 'node', preloads } or
 * { kind: 'command', command }. From .keel/keel.json `prove.command`, else the
 * package.json test script's node --test (or plain node --test without one).
 */
export function runnerOf(root) {
  let config = {};
  const keelJson = join(root, '.keel', 'keel.json');
  if (existsSync(keelJson)) {
    try { config = JSON.parse(readFileSync(keelJson, 'utf8')); } catch { throw new ProveError('.keel/keel.json does not parse'); }
  }
  const env = config.env && typeof config.env === 'object' ? config.env : {};
  if (config.prove?.command !== undefined) {
    if (typeof config.prove.command !== 'string' || !config.prove.command.trim()) throw new ProveError('.keel/keel.json "prove".command must be a command, with {file} where the test goes');
    return { kind: 'command', command: config.prove.command, env, from: '.keel/keel.json prove.command' };
  }
  let script = null;
  const pkg = join(root, 'package.json');
  if (existsSync(pkg)) {
    try { script = JSON.parse(readFileSync(pkg, 'utf8')).scripts?.test ?? null; } catch { throw new ProveError('package.json does not parse'); }
  }
  if (script === null) return { kind: 'node', preloads: [], env, from: 'node --test (no package.json test script)' };
  const preloads = nodePreloads(script);
  if (preloads === null) throw new ProveError(`the package.json test script runs no node --test ("${script}"); name the runner in .keel/keel.json: "prove": { "command": "<command> {file}" }`);
  return { kind: 'node', preloads, env, from: 'package.json test script' };
}

const quote = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** Run one test file in `cwd`: { exit, output, argv }. Never a test runner's context (lesson 14). */
function runTest(cwd, runner, file, name) {
  const env = { ...process.env, ...runner.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST')) delete env[k];
  let r, argv;
  if (runner.kind === 'node') {
    argv = [process.execPath, ...runner.preloads, '--test', '--test-reporter=tap', ...(name ? [`--test-name-pattern=${name}`] : []), file];
    r = spawnSync(argv[0], argv.slice(1), { cwd, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 15 * 60 * 1000 });
  } else {
    let command = runner.command.includes('{file}') ? runner.command.replaceAll('{file}', quote(file)) : `${runner.command} ${quote(file)}`;
    if (name) command = command.replaceAll('{name}', quote(name));
    argv = ['sh', '-c', command];
    r = spawnSync('sh', ['-c', command], { cwd, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 15 * 60 * 1000 });
  }
  const output = `${r.stdout ?? ''}${r.stderr ? `\n${r.stderr}` : ''}`;
  return { exit: r.status ?? (r.signal ? 128 : 1), signal: r.signal ?? null, output };
}

// ---- reading node --test's TAP ---------------------------------------------

/** Each `ok`/`not ok` in a TAP stream, with its YAML block: [{ ok, name, depth, error, failureType, exitCode }]. */
export function tapEntries(text) {
  const lines = String(text ?? '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^( *)(not ok|ok) \d+ - (.*?)(?: # (?:SKIP|TODO)\b.*)?$/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    const e = { ok: m[2] === 'ok', name: m[3].replace(/\\#/g, '#'), depth: indent / 4, error: null, failureType: null, exitCode: false };
    if (lines[i + 1]?.trim() === '---') {
      let j = i + 2;
      const pad = ' '.repeat(indent + 2);
      for (; j < lines.length && lines[j].trim() !== '...'; j++) {
        const line = lines[j];
        if (!line.startsWith(pad) || line.startsWith(`${pad} `)) continue;
        const kv = /^(\w+):\s*(.*)$/.exec(line.slice(pad.length));
        if (!kv) continue;
        const [, key, value] = kv;
        if (key === 'failureType') e.failureType = value.replace(/^'|'$/g, '');
        if (key === 'exitCode') e.exitCode = true;
        if (key === 'error') {
          if (/^\|/.test(value)) {
            const body = [];
            for (let k = j + 1; k < lines.length && (lines[k].startsWith(`${pad}  `) || lines[k].trim() === ''); k++) body.push(lines[k].trim());
            e.error = body.filter(Boolean);
          } else e.error = [value.replace(/^'(.*)'$/, '$1').replace(/''/g, "'")];
        }
      }
      i = j;
    }
    out.push(e);
  }
  return out;
}

/**
 * What a node --test run of one file showed: { red, ran, failures, loadError, reason }.
 * A file-level failure with an exit code and no failing test is a load error
 * (the file did not import, or crashed outside any test).
 */
export function readNodeRun(run, file) {
  const entries = tapEntries(run.output);
  const own = e => e.depth === 0 && e.name === file;
  const failures = entries.filter(e => !e.ok && e.failureType !== 'subtestsFailed' && !e.exitCode && !own(e));
  const ran = entries.filter(e => !own(e) && !e.exitCode).length;
  const fileFailed = entries.some(e => !e.ok && (e.exitCode || own(e)));
  const red = run.exit !== 0;
  if (red && !failures.length) {
    const said = String(run.output).split('\n').map(l => l.replace(/^# ?/, '')).find(l => /^(?:[A-Z]\w*Error|Error \[[A-Z_]+\]):/.test(l.trim()));
    return { red, ran, failures, loadError: true, reason: (said ?? (fileFailed ? 'the test file failed before any test ran' : `exit ${run.exit}`)).trim() };
  }
  return { red, ran, failures, loadError: false, reason: null };
}

/** The first lines of a failure: the test's name, then its error. And its one line, for a trailer. */
function failureOf(failures) {
  const f = failures[0];
  if (!f) return { lines: [], first: null };
  const error = f.error ?? [];
  return { lines: [`not ok - ${f.name}`, ...error.slice(0, 6)], first: oneLine(error.length ? `${error.join(' ')} (${f.name})` : f.name) };
}
const oneLine = s => { const t = String(s).replace(/\s+/g, ' ').replace(/"/g, "'").trim(); return t.length > 160 ? `${t.slice(0, 157)}...` : t; };
/** A runner keel cannot read: the first lines that look like a failure, else the last lines. */
function failureOfText(output) {
  const lines = String(output).split('\n').map(l => l.trimEnd()).filter(l => l.trim());
  const at = lines.findIndex(l => /\b(fail|failed|failure|error|assert)/i.test(l));
  const picked = at >= 0 ? lines.slice(at, at + 6) : lines.slice(-6);
  return { lines: picked, first: picked.length ? oneLine(picked[0]) : null };
}

// ---- the scratch tree -------------------------------------------------------

/** Paths relative to the root, from paths as given (relative to cwd); refused outside the root. */
function inRoot(root, cwd, path) {
  const abs = resolve(cwd, path);
  const rel = relative(root, abs);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new ProveError(`${path} is outside the repository (${root})`);
  return rel.split(sep).join('/');
}

/**
 * A scratch worktree of the current tree: HEAD, with the working tree's
 * changes (staged, unstaged, untracked) laid over it, and node_modules linked.
 */
async function scratchTree(root) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-prove-'));
  const tree = join(dir, 'tree');
  try {
    git(root, ['worktree', 'add', '--detach', '--quiet', tree, 'HEAD']);
    const changed = [...zlist(git(root, ['diff', '--name-only', '--no-renames', '-z', 'HEAD']).stdout),
      ...zlist(git(root, ['ls-files', '-o', '--exclude-standard', '-z']).stdout)];
    for (const f of changed) {
      const from = join(root, f), to = join(tree, f);
      if (existsSync(from) || isLink(from)) {
        await mkdir(join(to, '..'), { recursive: true });
        await rm(to, { recursive: true, force: true });
        await cp(from, to, { verbatimSymlinks: true });
      } else await rm(to, { force: true });
    }
    if (existsSync(join(root, 'node_modules')) && !existsSync(join(tree, 'node_modules'))) await symlink(join(root, 'node_modules'), join(tree, 'node_modules'));
  } catch (error) {
    await removeScratch(root, { dir, tree });
    throw error;
  }
  return { dir, tree };
}
const isLink = p => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };

async function removeScratch(root, { dir, tree }) {
  if (isLink(join(tree, 'node_modules'))) await unlink(join(tree, 'node_modules')).catch(() => {});
  git(root, ['worktree', 'remove', '--force', tree], { ok: false });
  await rm(dir, { recursive: true, force: true });
  git(root, ['worktree', 'prune'], { ok: false });
}

/** Put each fix path back as it was at `base` in the scratch tree: [path] that differ from the real tree. */
async function revert(root, tree, base, fix) {
  for (const path of fix) {
    const atBase = new Set(zlist(git(root, ['ls-tree', '-r', '-z', '--name-only', base, '--', path]).stdout));
    const now = zlist(git(tree, ['ls-files', '-co', '--exclude-standard', '-z', '--', path]).stdout);
    for (const f of now) if (!atBase.has(f)) await rm(join(tree, f), { force: true });
    if (atBase.size) git(tree, ['checkout', base, '--', path]);
  }
  const differs = [];
  for (const path of fix) {
    const a = zlist(git(tree, ['ls-files', '-co', '--exclude-standard', '-z', '--', path]).stdout).sort();
    const b = zlist(git(root, ['ls-files', '-co', '--exclude-standard', '-z', '--', path]).stdout).sort();
    const same = a.length === b.length && (await Promise.all(a.map(async (f, i) => f === b[i]
      && (await readFile(join(tree, f)).catch(() => null))?.equals(await readFile(join(root, f)).catch(() => Buffer.alloc(0)))))).every(Boolean);
    if (!same) differs.push(path);
  }
  return differs;
}

// ---- prove ------------------------------------------------------------------

/**
 * Prove a fix: { verdict, reason, test, name, fix, base, without, with, trailer, evidence }.
 * exitCode 0 when VERIFIED, 1 otherwise.
 */
export async function prove({ cwd, test, name, fix, base, trailer = false, evidence, date = today() }) {
  if (!test) throw new ProveError('keel prove needs the test file: keel prove <test file> --fix <path>...');
  if (!fix?.length) throw new ProveError('keel prove needs the fix: --fix <path>... (the files the fix changed)');
  const top = git(cwd, ['rev-parse', '--show-toplevel'], { ok: false });
  if (top.status !== 0) throw new ProveError('keel prove runs in a git repository: the fix is reverted against a commit');
  const root = top.stdout.trim();
  const file = inRoot(root, cwd, test);
  const paths = [...new Set(fix.map(p => inRoot(root, cwd, p)))];
  if (!existsSync(join(root, file))) throw new ProveError(`no test file ${file}`);
  if (git(root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { ok: false }).status !== 0) throw new ProveError('no commits yet: there is no base to revert the fix to');
  const runner = runnerOf(root);
  // The base: as given; else HEAD's parent when the fix is committed (its files are clean), else HEAD.
  const dirty = git(root, ['status', '--porcelain', '--untracked-files=all', '--', ...paths]).stdout.trim() !== '';
  const baseRef = base ?? (dirty ? 'HEAD' : 'HEAD~1');
  const resolved = git(root, ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`], { ok: false });
  if (resolved.status !== 0) throw new ProveError(`no base ${baseRef}${base ? '' : ': the fix is committed and HEAD has no parent; name one with --base <ref>'}`);
  const baseSha = resolved.stdout.trim();
  const short = baseSha.slice(0, 7);

  const read = (run) => runner.kind === 'node' ? readNodeRun(run, file) : { red: run.exit !== 0, ran: null, failures: [], loadError: false, reason: null };
  const failure = (run, seen) => runner.kind === 'node' ? failureOf(seen.failures) : failureOfText(run.output);

  let without;
  const scratch = await scratchTree(root);
  try {
    const differs = await revert(root, scratch.tree, baseSha, paths);
    if (!differs.length) {
      without = { ran: false, reason: `the fix's files are the same at ${short} as in the tree: nothing to revert (name the base with --base <ref>)` };
    } else if (!existsSync(join(scratch.tree, file))) {
      without = { ran: false, reason: `${file} does not exist without the fix (at ${short})` };
    } else {
      const run = runTest(scratch.tree, runner, file, name);
      const seen = read(run);
      const f = failure(run, seen);
      const real = realpathSync(scratch.tree);
      const clean = s => String(s).split(real).join('.').split(scratch.tree).join('.');
      without = { ran: true, exit: run.exit, red: seen.red, loadError: seen.loadError, tests: seen.ran,
        reason: seen.reason && clean(seen.reason), failure: f.lines.map(clean), first: f.first && clean(f.first) };
    }
  } finally {
    await removeScratch(root, scratch);
  }
  const runWith = runTest(root, runner, file, name);
  const seenWith = read(runWith);
  const fw = failure(runWith, seenWith);
  const withFix = { ran: true, exit: runWith.exit, red: seenWith.red, loadError: seenWith.loadError, tests: seenWith.ran, reason: seenWith.reason, failure: fw.lines, first: fw.first };

  let verdict, reason;
  if (withFix.red && withFix.loadError) [verdict, reason] = ['NOT WORKING', `red with the fix: the test does not load (${withFix.reason})`];
  else if (withFix.red) [verdict, reason] = ['NOT WORKING', `red with the fix: ${withFix.first ?? `exit ${withFix.exit}`}`];
  else if (withFix.tests === 0) [verdict, reason] = ['INCONCLUSIVE', name ? `no test matched --name ${name}` : 'the file ran no test'];
  else if (!without.ran) [verdict, reason] = ['INCONCLUSIVE', without.reason];
  else if (without.red && without.loadError) [verdict, reason] = ['INCONCLUSIVE', `the test cannot run without the fix: ${without.reason}`];
  else if (!without.red) [verdict, reason] = ['NOT WORKING', `green without the fix: the test does not catch the bug`];
  else [verdict, reason] = ['VERIFIED', 'red without the fix, green with it'];

  const label = name ? `${file} (${name})` : file;
  const said = verdict === 'VERIFIED' ? without.first ?? `exit ${without.exit}` : reason;
  const line = `Proven-by: ${label} — ${verdict} — "${oneLine(said)}"`;
  const data = { verdict, reason, test: file, name: name ?? null, fix: paths, base: short, runner: runner.from, without, with: withFix, line,
    trailer: trailer ? line : null, evidence: null };

  if (evidence !== undefined) data.evidence = await toEvidence(root, evidence, `- **${date}** — ${line} (fix: ${paths.join(', ')}; base ${short})`);

  const text = [`${verdict}: ${label} — ${reason}`,
    without.ran
      ? `  without the fix (${paths.join(', ')} at ${short}): ${without.red ? 'red' : 'green'}${without.first ? ` — ${without.first}` : without.reason ? ` — ${without.reason}` : ''}`
      : `  without the fix: not run — ${without.reason}`,
    `  with the fix: ${withFix.red ? 'red' : 'green'}${withFix.red && withFix.first ? ` — ${withFix.first}` : ''}`,
    ...(trailer ? ['', line] : []),
    ...(data.evidence ? [`  appended to ${data.evidence}`] : [])].join('\n');
  return { data, text, exitCode: verdict === 'VERIFIED' ? 0 : 1 };
}

/** Append a line to a phase's evidence file (its front matter's first `evidence:`): the path written. */
async function toEvidence(root, phase, entry) {
  const n = Number(phase);
  if (!Number.isInteger(n) || n < 0) throw new ProveError(`--evidence needs a phase number; got "${phase}"`);
  if (!existsSync(join(root, '.keel', 'keel.json'))) throw new ProveError('--evidence writes to a phase\'s evidence: not in a keel project (no .keel/keel.json)');
  // The phase's front matter only: a problem elsewhere in the roadmap is not this command's to refuse.
  const phases = join(root, 'docs', 'phases');
  const file = existsSync(phases) ? (await readdir(phases)).find(f => { const m = /^(\d+)-[^/]*\.md$/.exec(f); return m && Number(m[1]) === n; }) : undefined;
  if (!file) throw new ProveError(`no phase ${n} in docs/phases/`);
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(await readFile(join(phases, file), 'utf8'))?.[1] ?? '';
  let listed = [];
  const line = /^evidence:\s*(.+)$/m.exec(front);
  if (line) { try { listed = JSON.parse(line[1]); } catch { throw new ProveError(`docs/phases/${file}: evidence is not a JSON list`); } }
  const first = Array.isArray(listed) ? listed.find(p => typeof p === 'string' && /^evidence\/[\w.-]+\.md$/.test(p)) : undefined;
  if (!first) throw new ProveError(`phase ${n} names no evidence file: create one from docs/templates/evidence.md and list it in docs/phases/${file} (evidence: ["evidence/<date>-<slug>.md"])`);
  const path = join('docs', first);
  const abs = join(root, path);
  if (!existsSync(abs)) throw new ProveError(`phase ${n}'s evidence ${path} does not exist`);
  const text = await readFile(abs, 'utf8');
  await appendFile(abs, `${text.endsWith('\n') || !text ? '' : '\n'}${entry}\n`);
  return path;
}

export const usage = 'keel prove <test file> [--name <pattern>] --fix <path>... [--base <ref>] [--trailer] [--evidence <phase>] [--json]';
