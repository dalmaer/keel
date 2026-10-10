// keel prove (phase 62): a fix is proven by its test failing without it.
//
// Every fix ships with a test, but a test that never failed without its fix
// proves nothing. keel prove runs the named test twice, each time in a fresh
// scratch copy of the current tree built the same way (a `git clone --shared`
// with the tree's changes, submodules and ignored files laid over it): once
// with the fix's files put back as they were at the base commit, once with
// the fix. Both sides see the files the test sees here. The verdict:
//
//   VERIFIED     red without the fix, and what failed then passed with it;
//   NOT WORKING  green without it (the test does not catch the bug), or red with it;
//   INCONCLUSIVE the test cannot run without the fix (it does not load, its
//                file is part of the fix), nothing to revert, no test ran
//                with the fix (no match for --name, skipped, todo), tests
//                that share a name, an exit code alone, or an environment
//                keel cannot reproduce (too many ignored files).
//
// The user's working tree is never touched, not even by the test's own
// writes, its $PWD or its git commands (lesson 54: a deliberate break is made
// in a scratch copy, never the shared checkout). Each is removed in every case.
//
// The runner, read from each side's tree: `node --test`, with the preloads
// (--import, --require) the project's package.json test script gives it, so a
// test runs as it runs in the gate. A project on another runner names its
// command in .keel/keel.json `"prove": { "command": "<command> {file}" }`
// ({name} for --name), with `"tap": true` when it prints TAP. Without TAP keel
// has only an exit code, which never proves a fix: it cannot tell a failing
// test from one that never loaded.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, lstatSync, realpathSync } from 'node:fs';
import { mkdtemp, mkdir, cp, rm, readFile, readdir, appendFile, symlink, lstat, readlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, isAbsolute, sep, dirname, basename } from 'node:path';

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
 * { kind: 'command', command, tap }. From .keel/keel.json `prove.command`, else the
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
    // "tap": true says the command prints TAP: keel reads it as it reads node --test's. Without it, only the exit code.
    return { kind: 'command', command: config.prove.command, tap: config.prove.tap === true, env, from: '.keel/keel.json prove.command' };
  }
  let script = null;
  const pkg = join(root, 'package.json');
  if (existsSync(pkg)) {
    try { script = JSON.parse(readFileSync(pkg, 'utf8')).scripts?.test ?? null; } catch { throw new ProveError('package.json does not parse'); }
  }
  if (script === null) return { kind: 'node', preloads: [], env, from: 'node --test (no package.json test script)' };
  const preloads = nodePreloads(script);
  if (preloads === null) throw new ProveError(`the package.json test script runs no node --test ("${script}"); name the runner in .keel/keel.json: "prove": { "command": "<command> {file}" }`);
  // Environment the script sets for itself (NAME=value, export, env, cross-env): keel runs node directly and
  // would drop it, so the test would not run as it runs here. Refused, never guessed at.
  const inline = inlineEnv(script);
  const refuse = inline ? `the test script sets environment inline (${inline}): keel runs node --test without it; name the runner in .keel/keel.json "prove" instead` : null;
  return { kind: 'node', preloads, env, refuse, from: 'package.json test script' };
}

const quote = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** The first environment a shell command sets for itself (NAME=value, export, env, cross-env), or null. */
export function inlineEnv(script) {
  const m = /(?:^|[\s;&|(])((?:[A-Za-z_][A-Za-z0-9_]*=\S*)|export\s+\S+|env\s+\S+|cross-env\b)/.exec(String(script ?? ''));
  return m ? m[1] : null;
}

/** Run one test file in `cwd`: { exit, output, argv }. Never a test runner's context (lesson 14). */
function runTest(cwd, runner, file, name) {
  // PWD is the scratch tree's too: a test that writes under $PWD must not reach the user's checkout.
  const env = { ...process.env, ...runner.env, PWD: cwd };
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

/**
 * Each `ok`/`not ok` in a TAP stream, with its directive and YAML block:
 * [{ ok, name, id, depth, directive, error, failureType, exitCode }]. The id is
 * the test's whole identity: its suites' names (from `# Subtest:` headers,
 * which open before their children), its own, and its place among tests of
 * that same path, so two tests named alike are never mistaken for each other.
 */
export function tapEntries(text) {
  const lines = String(text ?? '').split('\n');
  const out = [];
  const stack = [];
  const seen = new Map();
  for (let i = 0; i < lines.length; i++) {
    const sub = /^( *)# Subtest: (.*)$/.exec(lines[i]);
    if (sub) { stack.length = sub[1].length / 4; stack.push(sub[2]); continue; }
    const m = /^( *)(not ok|ok) \d+ - (.*?)(?: # (SKIP|TODO)\b.*)?$/i.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    const name = m[3].replace(/\\#/g, '#');
    // The hierarchy as a JSON list, never joined text: a test named 'a > b' and test 'b' in suite 'a' differ.
    const names = [...stack.slice(0, indent / 4), name];
    const path = JSON.stringify(names);
    const n = (seen.get(path) ?? 0) + 1;
    seen.set(path, n);
    const e = { ok: m[2] === 'ok', name, path, id: JSON.stringify([names, n]), label: `${names.join(' > ')}${n > 1 ? ` #${n}` : ''}`, depth: indent / 4, directive: m[4]?.toUpperCase() ?? null, type: null, error: null, failureType: null, exitCode: false };
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
        if (key === 'type') e.type = value.replace(/^'|'$/g, '');
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
 * What a node --test run of one file showed: { red, ran, passed, skipped, failures, loadError, reason }.
 * A file-level failure with an exit code and no failing test is a load error
 * (the file did not import, or crashed outside any test). A skipped or todo
 * test did not run: it is never counted as run, passed or failed.
 */
export function readNodeRun(run, file) {
  const entries = tapEntries(run.output);
  const own = e => e.depth === 0 && e.name === file;
  const all = entries.filter(e => !own(e) && !e.exitCode);
  // A test is a record of type 'test' (TAP without the field: every record). A suite, or a test cancelled
  // before it ran, is not one: an empty suite that passes has run nothing.
  const tests = all.filter(e => (e.type ?? 'test') === 'test');
  const ran = tests.filter(e => !e.directive && e.failureType !== 'cancelledByParent');
  const failures = all.filter(e => !e.ok && !e.directive && !['subtestsFailed', 'cancelledByParent'].includes(e.failureType));
  const passed = ran.filter(e => e.ok).map(e => e.id);
  // How many records share each path, suites included: a path held by more than one is told apart only by place.
  const counts = {};
  for (const e of all) counts[e.path] = (counts[e.path] ?? 0) + 1;
  const skipped = tests.length - ran.length;
  const fileFailed = entries.some(e => !e.ok && (e.exitCode || own(e)));
  const red = run.exit !== 0;
  if (red && !failures.length) {
    const said = String(run.output).split('\n').map(l => l.replace(/^# ?/, '')).find(l => /^(?:[A-Z]\w*Error|Error \[[A-Z_]+\]):/.test(l.trim()));
    return { red, ran: ran.length, passed, counts, skipped, failures, loadError: true, reason: (said ?? (fileFailed ? 'the test file failed before any test ran' : `exit ${run.exit}`)).trim() };
  }
  return { red, ran: ran.length, passed, counts, skipped, failures, loadError: false, reason: null };
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

/** The submodules (gitlinks) in the index: [path]. */
const gitlinks = root => zlist(git(root, ['ls-files', '-s', '-z']).stdout).filter(l => l.startsWith('160000 ')).map(l => l.slice(l.indexOf('\t') + 1));

/** Copy one path of the real tree over the scratch one. A directory is a submodule's checkout: its files, never its .git. */
async function overlay(from, to) {
  await mkdir(dirname(to), { recursive: true });
  await rm(to, { recursive: true, force: true });
  await cp(from, to, { recursive: true, verbatimSymlinks: true, filter: src => basename(src) !== '.git' });
}

/** The most of the ignored files keel copies into a scratch tree; past it the environment is not reproduced. */
export const IGNORED_BUDGET = 256 * 1024 * 1024;

/** Bytes under a path (links count nothing), or Infinity once past `budget`. */
async function sizeOf(path, budget) {
  const st = await lstat(path).catch(() => null);
  if (!st || st.isSymbolicLink()) return 0;
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const entry of await readdir(path)) {
    if (entry === '.git') continue;
    total += await sizeOf(join(path, entry), budget - total);
    if (total > budget) return Infinity;
  }
  return total;
}

/**
 * The ignored files and directories a test may read (a .env, a generated
 * fixture), relative to the root: every one but node_modules, which is linked.
 * Throws ProveError when they are more than IGNORED_BUDGET: keel cannot then
 * reproduce the test's environment, and does not judge it.
 */
export async function ignoredInputs(root) {
  const entries = zlist(git(root, ['ls-files', '-o', '-i', '--exclude-standard', '--directory', '-z']).stdout)
    .map(e => e.replace(/\/$/, '')).filter(e => !e.split('/').includes('node_modules'));
  // KEEL_PROVE_IGNORED_BYTES is a test seam, like KEEL_GH: a test sets a small budget instead of writing 256 MB.
  const budget = Number(process.env.KEEL_PROVE_IGNORED_BYTES) || IGNORED_BUDGET;
  let total = 0;
  for (const e of entries) {
    total += await sizeOf(join(root, e), budget - total);
    if (total > budget) throw new ProveError(`the ignored files are more than ${budget} bytes, so keel cannot give the test the environment it has here`, 1);
  }
  return entries;
}

/**
 * A scratch copy of the current tree: a clone of the repository sharing its
 * objects (`git clone --shared`), so the test's own git commands (config,
 * tags, stash) change the clone, never the user's repository; checked out at
 * HEAD, with the working tree's changes (staged, unstaged, untracked), its
 * submodules' checkouts and its ignored files laid over it, and node_modules
 * linked. Both sides of a proof run in one of these, built the same way, from
 * the same files the test sees here.
 */
async function scratchTree(root, ignored) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-prove-'));
  const tree = join(dir, 'tree');
  try {
    const head = git(root, ['rev-parse', 'HEAD']).stdout.trim();
    git(root, ['clone', '--quiet', '--shared', '--no-checkout', root, tree]);
    git(tree, ['checkout', '--quiet', '--detach', head]);
    const changed = new Set([...zlist(git(root, ['diff', '--name-only', '--no-renames', '-z', 'HEAD']).stdout),
      ...zlist(git(root, ['ls-files', '-o', '--exclude-standard', '-z']).stdout), ...gitlinks(root), ...ignored]);
    for (const f of changed) {
      const from = join(root, f), to = join(tree, f);
      if (existsSync(from) || isLink(from)) await overlay(from, to);
      else await rm(to, { recursive: true, force: true });
    }
    await linkModules(root, tree);
  } catch (error) {
    await removeScratch(root, { dir, tree });
    throw error;
  }
  return { dir, tree };
}
const isLink = p => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };

/**
 * The scratch tree's node_modules: its own directory, holding a link to each
 * entry of the real one. What a run creates there (a .cache, a .vite) stays in
 * the scratch tree, so neither run sees the other's, and the user's
 * node_modules gains nothing.
 */
async function linkModules(root, tree) {
  const real = join(root, 'node_modules'), mine = join(tree, 'node_modules');
  if (!existsSync(real) || existsSync(mine) || isLink(mine)) return;
  const top = realpathSync(root), modules = realpathSync(real);
  const inside = (p, dir) => p === dir || p.startsWith(`${dir}${sep}`);
  const link = async (from, to) => {
    let target = null;
    if (isLink(from)) { try { target = realpathSync(from); } catch { target = null; } }
    // A workspace package links into the repository itself: point it at the scratch copy's own, so the
    // test loads the scratch source and never writes the user's.
    if (target && inside(target, top) && !inside(target, modules)) {
      const here = join(tree, relative(top, target));
      if (!existsSync(here)) throw new ProveError(`${relative(root, from)} links into the repository at ${relative(top, target)}, which the scratch copy does not hold`, 1);
      await symlink(here, to);
    } else await symlink(from, to);
  };
  await mkdir(mine);
  for (const entry of await readdir(real)) {
    const from = join(real, entry), to = join(mine, entry);
    // A scope (@acme) and .bin hold links of their own, each of which may point into the repository.
    if ((entry.startsWith('@') || entry === '.bin') && !isLink(from) && lstatSync(from).isDirectory()) {
      await mkdir(to);
      for (const each of await readdir(from)) await link(join(from, each), join(to, each));
    } else await link(from, to);
  }
}

async function removeScratch(root, { dir, tree }) {
  // Links only, never what they point at (fs.rm does not follow them).
  await rm(join(tree, 'node_modules'), { recursive: true, force: true }).catch(() => {});
  await rm(dir, { recursive: true, force: true });
}

/** Whether two paths hold the same thing as git sees it: both absent, or the same type, bytes (or link target) and executable bit. */
export async function samePath(a, b) {
  const sa = await lstat(a).catch(() => null), sb = await lstat(b).catch(() => null);
  if (!sa || !sb) return !sa && !sb;
  if (sa.isSymbolicLink() || sb.isSymbolicLink()) return sa.isSymbolicLink() && sb.isSymbolicLink() && await readlink(a) === await readlink(b);
  if (sa.isDirectory() || sb.isDirectory()) return sa.isDirectory() && sb.isDirectory();
  return (sa.mode & 0o100) === (sb.mode & 0o100) && (await readFile(a)).equals(await readFile(b));
}

/** Put each fix path back as it was at `base` in the scratch tree: [path] that differ from the real tree. */
async function revert(root, tree, base, fix) {
  for (const path of fix) {
    const atBase = new Set(zlist(git(root, ['ls-tree', '-r', '-z', '--name-only', base, '--', path]).stdout));
    const now = zlist(git(tree, ['ls-files', '-co', '--exclude-standard', '-z', '--', path]).stdout);
    for (const f of now) if (!atBase.has(f)) await rm(join(tree, f), { recursive: true, force: true });
    if (atBase.size) git(tree, ['checkout', base, '--', path]);
  }
  const differs = [];
  for (const path of fix) {
    const files = new Set([...zlist(git(tree, ['ls-files', '-co', '--exclude-standard', '-z', '--', path]).stdout),
      ...zlist(git(root, ['ls-files', '-co', '--exclude-standard', '-z', '--', path]).stdout)]);
    let same = true;
    for (const f of files) if (!(await samePath(join(tree, f), join(root, f)))) { same = false; break; }
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
  // A runner that cannot pick one test runs the whole file, and would still claim the named one.
  if (name !== undefined && runner.kind === 'command' && !runner.command.includes('{name}')) {
    throw new ProveError('--name needs {name} in .keel/keel.json "prove".command: without it the whole file runs, not the named test');
  }
  // The base: as given; else HEAD's parent when the fix is committed (its files are clean), else HEAD.
  // Committed or not is judged file by file: a directory in --fix is the files under it (tracked, or new), so one
  // argument holding a committed part and a dirty part is seen as both.
  const files = [...new Set([...zlist(git(root, ['ls-files', '-z', '--', ...paths]).stdout),
    ...zlist(git(root, ['ls-files', '-o', '--exclude-standard', '-z', '--', ...paths]).stdout)])].sort();
  const dirty = new Set(zlist(git(root, ['diff', '--name-only', '--no-renames', '-z', 'HEAD', '--', ...paths]).stdout)
    .concat(zlist(git(root, ['ls-files', '-o', '--exclude-standard', '-z', '--', ...paths]).stdout)));
  for (const f of dirty) if (!files.includes(f)) files.push(f);
  const dirtyFiles = files.filter(f => dirty.has(f)).sort(), cleanFiles = files.filter(f => !dirty.has(f)).sort();
  // Part committed, part not: HEAD would leave the committed part in place, HEAD~1 might not be before it. Say which.
  if (base === undefined && dirtyFiles.length && cleanFiles.length) {
    const some = xs => xs.length > 4 ? `${xs.slice(0, 4).join(', ')} and ${xs.length - 4} more` : xs.join(', ');
    throw new ProveError(`some --fix paths are committed (${some(cleanFiles)}) and some are not (${some(dirtyFiles)}): name the commit before the whole fix with --base <ref> (HEAD when none of it is committed)`);
  }
  const baseRef = base ?? (dirtyFiles.length ? 'HEAD' : 'HEAD~1');
  const resolved = git(root, ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`], { ok: false });
  if (resolved.status !== 0) throw new ProveError(`no base ${baseRef}${base ? '' : ': the fix is committed and HEAD has no parent; name one with --base <ref>'}`);
  const baseSha = resolved.stdout.trim();
  const short = baseSha.slice(0, 7);

  // A runner keel reads structurally: node --test, or a command that prints TAP ("tap": true).
  const structured = r => r.kind === 'node' || r.tap === true;
  const read = (r, run) => structured(r) ? readNodeRun(run, file) : { red: run.exit !== 0, ran: null, passed: [], skipped: 0, failures: [], loadError: false, reason: null };
  const failure = (r, run, seen) => structured(r) ? failureOf(seen.failures) : failureOfText(run.output);
  /** Run the test in a fresh scratch tree, with the fix reverted or not; never in the user's checkout. */
  const judge = async withoutFix => {
    let scratch;
    try { scratch = await scratchTree(root, ignored); } catch (e) { if (e instanceof ProveError) return { ran: false, reason: e.message }; throw e; }
    try {
      if (withoutFix) {
        if (!(await revert(root, scratch.tree, baseSha, paths)).length) {
          return { ran: false, reason: `the fix's files are the same at ${short} as in the tree: nothing to revert (name the base with --base <ref>)` };
        }
        if (!existsSync(join(scratch.tree, file))) return { ran: false, reason: `${file} does not exist without the fix (at ${short})` };
        // A test reverted with the fix is the old test: it says nothing about the fix.
        if (!(await samePath(join(scratch.tree, file), join(root, file)))) {
          return { ran: false, reason: `${file} is part of the fix: without it the old test would run; name only the fixed code in --fix` };
        }
      }
      // The runner as this tree configures it: a fix to package.json or .keel/keel.json is reverted with the rest.
      let here;
      try { here = runnerOf(scratch.tree); } catch (e) { return { ran: false, reason: `${withoutFix ? 'without' : 'with'} the fix, ${e.message}` }; }
      if (here.refuse) return { ran: false, reason: here.refuse };
      if (name !== undefined && here.kind === 'command' && !here.command.includes('{name}')) {
        return { ran: false, reason: `${withoutFix ? 'without' : 'with'} the fix, .keel/keel.json "prove".command has no {name}: the whole file would run` };
      }
      const run = runTest(scratch.tree, here, file, name);
      const seen = read(here, run);
      const f = failure(here, run, seen);
      const real = realpathSync(scratch.tree);
      const clean = s => String(s).split(real).join('.').split(scratch.tree).join('.');
      return { ran: true, runner: here.from, structured: structured(here), exit: run.exit, red: seen.red, loadError: seen.loadError, tests: seen.ran, skipped: seen.skipped, passed: seen.passed,
        failed: seen.failures.map(x => x.id), failedPaths: seen.failures.map(x => x.path), counts: seen.counts ?? {}, reason: seen.reason && clean(seen.reason), failure: f.lines.map(clean), first: f.first && clean(f.first) };
    } finally {
      await removeScratch(root, scratch);
    }
  };
  let ignored = null, unreproduced = null;
  // A sparse checkout holds part of the tree; a scratch clone would hold all of it. Not the test's environment.
  if (git(root, ['config', '--bool', 'core.sparseCheckout'], { ok: false }).stdout.trim() === 'true') {
    unreproduced = 'this checkout is sparse (core.sparseCheckout): a scratch copy would hold files this one does not, so the test would not run as it runs here';
  }
  if (!unreproduced) try { ignored = await ignoredInputs(root); } catch (e) { if (!(e instanceof ProveError)) throw e; unreproduced = e.message; }
  const without = unreproduced ? { ran: false, reason: unreproduced } : await judge(true);
  const withFix = unreproduced ? { ran: false, reason: unreproduced } : await judge(false);
  // What failed without the fix and did not pass with it (skipped, todo, or not run): it was never seen green.
  const unpassed = without.ran && without.structured && withFix.structured && without.red && !without.loadError
    ? [...new Set(without.failed)].filter(n => !withFix.passed.includes(n)) : [];

  const labelOf = id => { const [names, n] = JSON.parse(id); return `${names.join(' > ')}${n > 1 ? ` #${n}` : ''}`; };
  let verdict, reason;
  const where = ' (run in a scratch copy of the tree)';
  // A failed test whose path more than one test holds, in either run: its place could have shifted between them.
  const shared = without.ran && withFix.ran ? [...new Set((without.failedPaths ?? []).filter(p => (without.counts[p] ?? 0) > 1 || (withFix.counts[p] ?? 0) > 1))] : [];
  if (!withFix.ran) [verdict, reason] = ['INCONCLUSIVE', withFix.reason];
  else if (withFix.red && withFix.loadError) [verdict, reason] = ['NOT WORKING', `red with the fix: the test does not load (${withFix.reason})${where}`];
  else if (withFix.red) [verdict, reason] = ['NOT WORKING', `red with the fix: ${withFix.first ?? `exit ${withFix.exit}`}${where}`];
  else if (withFix.tests === 0) [verdict, reason] = ['INCONCLUSIVE', withFix.skipped ? `no test ran with the fix: ${withFix.skipped} skipped or todo` : name ? `no test matched --name ${name}` : 'the file ran no test'];
  else if (!without.ran) [verdict, reason] = ['INCONCLUSIVE', without.reason];
  else if (without.red && without.loadError) [verdict, reason] = ['INCONCLUSIVE', `the test cannot run without the fix: ${without.reason}`];
  else if (!without.red) [verdict, reason] = ['NOT WORKING', 'green without the fix: the test does not catch the bug'];
  // An exit code alone cannot tell a failing test from one that never loaded: never a proof.
  else if (!without.structured || !withFix.structured) [verdict, reason] = ['INCONCLUSIVE', 'red without the fix and green with it, but read by exit code alone, which cannot tell a failing test from one that never loaded: make the command print TAP and set "tap": true in .keel/keel.json "prove"'];
  else if (shared.length) [verdict, reason] = ['INCONCLUSIVE', `more than one test is named ${shared.map(p => JSON.parse(p).join(' > ')).join(', ')}, or the count changed with the fix: keel cannot tell them apart across runs; give each its own name`];
  else if (unpassed.length) [verdict, reason] = ['INCONCLUSIVE', `what failed without the fix did not pass with it (skipped, todo or not run): ${unpassed.map(labelOf).join(', ')}`];
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
