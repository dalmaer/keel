// What the night shift's scripts share (keel practice `night`; managed: keel
// render rewrites it). Node built-ins only: this runs in the project's own
// checkout, with no keel anywhere (keel docs/design.md §6, "Projects run on
// their own"). keel's own CLI imports these same functions, so a rule is
// written once.
//
//   lockDrift(root)          managed files whose bytes are not what keel wrote
//                            (.keel/lock.json); `behind` needs keel's templates
//                            and is keel-side only (keel doctor)
//   phaseLints(root, parse)  a phase the roadmap parser rejects, a duplicate
//                            phase number, a goal no phase serves
//   claudeMdLint(text)       a CLAUDE.md that is more than a pointer
//   lessonsTableSplit(text, path)  a blank line inside the lessons table:
//                            the numbered rows after it render as text
//   parseLessons(text)       the lesson rows of a lessons table, and which
//                            column is the guard (keel lessons, fleet, learn
//                            and improve all read the table with this one)
//   lessonFingerprint(project, row)  a row's identity in .keel/sent.json, the
//                            one keel lessons files under and improve counts by
//   unsentLessons(root, config)  the rows of the lessons table not yet sent home
//   secondCopies(root, …)    a second copy of a managed skill (lesson 1)
//   gateEnv(env, config)     the environment the project's gate runs in:
//                            NODE_TEST_* stripped (lesson 14), .keel/keel.json
//                            `env` merged over it
//   main(meta, fn)           run a script: --json or text, and its exit code
import { createHash } from 'node:crypto';
import { readFile, readdir, lstat, readlink } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOCK = '.keel/lock.json';
export const CLAUDE_MD_LINES = 3;
const SKIP = new Set(['.git', 'node_modules']);

export const sha256 = text => createHash('sha256').update(text).digest('hex');
export const read = path => readFile(path, 'utf8').catch(e => ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(e.code) ? null : Promise.reject(e));
export const info = path => lstat(path).catch(e => ['ENOENT', 'ENOTDIR'].includes(e.code) ? null : Promise.reject(e));

/** The inside of a <!-- keel:begin id --> … <!-- keel:end id --> block, or null. */
export function blockBody(text, id) {
  if (text === null) return null;
  const begin = `<!-- keel:begin ${id} -->`, end = `<!-- keel:end ${id} -->`;
  const b = text.indexOf(begin), e = text.indexOf(end);
  if (b < 0 || e < 0 || e < b || text.indexOf(begin, b + 1) >= 0) return null;
  const from = text.indexOf('\n', b) + 1;
  return !from || from > e ? null : text.slice(from, e);
}

/** The project's .keel/lock.json, or null when it has none. */
export async function readLock(root) {
  const text = await read(join(root, LOCK));
  if (text === null) return null;
  const lock = JSON.parse(text);
  if (!lock || typeof lock.files !== 'object') throw new Error(`${LOCK}: needs "files"`);
  return lock;
}

/** A lock key, `path` or `path#block`, as { path, block }. */
export function splitKey(key) {
  const m = /^(.*)#([a-z0-9-]+)$/.exec(key);
  return m ? { path: m[1], block: m[2] } : { path: key, block: null };
}

/**
 * Drift by the lock alone: every target keel wrote whose bytes now differ
 * (`edited`; missing counts). A managed link that became a real directory or
 * file is a lint, symlink-replaced. Returns { drift, lint }, or null with no lock.
 */
export async function lockDrift(root) {
  const lock = await readLock(root);
  if (!lock) return null;
  const drift = [], lint = [];
  for (const key of Object.keys(lock.files).sort()) {
    const { practice, sha256: locked } = lock.files[key];
    const { path, block } = splitKey(key);
    const target = join(root, path);
    let now;
    if (block) now = blockBody(await read(target), block);
    else {
      const i = await info(target);
      if (!i) now = null;
      else if (i.isSymbolicLink()) now = await readlink(target);
      else if (i.isDirectory()) {
        lint.push({ rule: 'symlink-replaced', path, message: `${path} was written by keel as a symlink (${practice}); it is a real directory, so it no longer follows the managed copy` });
        continue;
      } else now = await read(target);
    }
    if (now === null || sha256(now) !== locked) drift.push({ path: key, practice, state: 'edited', ...(now === null ? { missing: true } : {}) });
  }
  return { drift, lint };
}

/** Every file under root, not following symlinks, skipping .git, node_modules and nested keel projects. */
export async function walk(root, dir = root, found = []) {
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

export const skillName = text => /^---\r?\n[\s\S]*?^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(text ?? '')?.[1] ?? null;

/**
 * A second copy of a managed skill: any SKILL.md outside .agents/skills/
 * naming one. `skills` maps a skill's name to { path, practice }. On keel
 * itself (`self`), practices/ holds the templates, the source, not copies.
 */
export async function secondCopies(root, skills, { self = false } = {}) {
  const lint = [];
  if (!skills.size) return lint;
  for (const path of await walk(root)) {
    if (!path.endsWith('SKILL.md') || path.startsWith('.agents/skills/')) continue;
    if (self && path.startsWith('practices/')) continue;
    const name = skillName(await read(join(root, path)));
    const managed = skills.get(name);
    if (managed) lint.push({ rule: 'second-copy', path, message: `a second copy of the ${name} skill (${managed.practice}); the one copy is ${managed.path}, reached by symlink — a copy ages (lesson 1)` });
  }
  return lint;
}

/** The managed skills a lock names, by their name in the project's copy. */
export async function lockedSkills(root, lock) {
  const skills = new Map();
  for (const [key, e] of Object.entries(lock?.files ?? {})) {
    const m = /^\.agents\/skills\/([^/]+)\/SKILL\.md$/.exec(key);
    if (m) skills.set(skillName(await read(join(root, key))) ?? m[1], { path: key, practice: e.practice });
  }
  return skills;
}

/** CLAUDE.md as more than a pointer to AGENTS.md: a lint, or null. */
export function claudeMdLint(text) {
  const lines = text === null ? 0 : text.split('\n').filter(l => l.trim()).length;
  return lines > CLAUDE_MD_LINES
    ? { rule: 'claude-md-pointer', path: 'CLAUDE.md', message: `CLAUDE.md has ${lines} non-empty lines; it should be a pointer to AGENTS.md (at most ${CLAUDE_MD_LINES}), so there is one guide` }
    : null;
}

/**
 * A lessons table split by a blank line: Markdown ends a table at the first
 * blank line, so every numbered row after it renders as raw text and the
 * lessons in it are hidden. One lint per split, naming its lines. `path` is
 * the configured lessons file (.keel/keel.json "lessons", default
 * docs/lessons.md).
 */
export function lessonsTableSplit(text, path = 'docs/lessons.md') {
  if (text === null || text === undefined) return [];
  const lines = text.split('\n'), lint = [];
  let last = -1; // the last line that starts with |, while only blank lines follow it
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('|')) {
      if (last >= 0 && i > last + 1 && /^\|\s*\d+\s*\|/.test(l)) {
        const blank = last + 2 === i ? `line ${i}` : `lines ${last + 2}–${i}`;
        lint.push({ rule: 'lessons-table-split', path, message: `a blank line (${blank}) splits the lessons table: the rows from line ${i + 1} on render as text, not as the table; remove the blank ${i - last - 1 === 1 ? 'line' : 'lines'}` });
      }
      last = i;
    } else if (l.trim()) last = -1;
  }
  return lint;
}

/** Cells of a markdown table row, split on unescaped pipes, trimmed. */
export function cells(line) {
  const body = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return body.split(/(?<!\\)\|/).map(c => c.trim());
}
const isSeparator = line => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line.trim());

/**
 * The lesson rows of a lessons table: the first table whose header is
 * numbered (`| # | shape | cost | guard |`), has three columns
 * (`| shape | cost | guard |`, numbered by position), or names a guard
 * column. The guard column is the header cell containing "guard", in any
 * case and position (ledger's `Guard`, cajones' `Guard / status`); `guard`
 * is its index, -1 when the table has none, and each row's guard is then
 * the last column. Returns { numbered, guard, rows: [{ n, line, shape, cost,
 * guard }] }; `line` is 1-based, for permalinks.
 */
export function parseLessons(text) {
  const lines = (text ?? '').split('\n');
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!lines[i].trim().startsWith('|') || !isSeparator(lines[i + 1])) continue;
    const head = cells(lines[i]);
    const numbered = head.length >= 4 && /^(#|n|no\.?)$/i.test(head[0]);
    const guard = head.findIndex(c => /guard/i.test(c));
    if (!numbered && head.length !== 3 && guard < 0) continue;
    const from = numbered ? 1 : 0; // the shape's column
    const at = guard >= 0 ? guard : from + 2;
    const rows = [];
    for (let j = i + 2; j < lines.length && lines[j].trim().startsWith('|'); j++) {
      const c = cells(lines[j]);
      if (numbered && !/^\d+$/.test(c[0])) continue;
      if (c.length < Math.max(at, from + 2) + 1 || (!numbered && !c[from])) continue;
      // An unescaped pipe in the last column splits it; the guard keeps the rest.
      const g = at === head.length - 1 ? c.slice(at).join(' | ') : c[at];
      rows.push({ n: numbered ? Number(c[0]) : rows.length + 1, line: j + 1, shape: c[from], cost: c[from + 1], guard: g });
    }
    return { numbered, guard, rows };
  }
  return { numbered: false, guard: -1, rows: [] };
}

/** What keel lessons has sent home: { "<fingerprint>": { issue, at } }. */
export const SENT = '.keel/sent.json';
/** The project's lessons table: .keel/keel.json `lessons`, else docs/lessons.md. */
export const lessonsPathOf = config => typeof config?.lessons === 'string' && config.lessons ? config.lessons : 'docs/lessons.md';
/** The project in a fingerprint: the config's repo (owner/name), else its name. */
export const lessonProject = config => /^[\w.-]+\/[\w.-]+$/.test(config?.repo ?? '') ? config.repo : config?.name ?? null;
export const normaliseShape = shape => shape.replace(/\s+/g, ' ').trim();
/**
 * A lesson row's fingerprint: <project>/lesson/<n>/<8 hex of sha256(its shape,
 * whitespace collapsed)>. keel lessons files under it, fleet and improve count
 * by it: one definition (lesson 7). A reworded or renumbered row is new.
 */
export const lessonFingerprint = (project, row) => `${project}/lesson/${row.n}/${sha256(normaliseShape(row.shape)).slice(0, 8)}`;

/**
 * The lesson rows not yet in .keel/sent.json: { path, rows, unsent:
 * [{ n, fingerprint }] }, or { na } when there is no lessons table or no
 * project to name. A sent.json that is not JSON throws (a broken instrument).
 */
export async function unsentLessons(root, config) {
  const path = lessonsPathOf(config);
  const text = await read(join(root, path));
  if (text === null) return { na: `no ${path}: no lessons table to send from` };
  const project = lessonProject(config);
  if (!project) return { na: '.keel/keel.json names neither repo nor name, so a lesson has no fingerprint' };
  const raw = await read(join(root, SENT));
  let sent = {};
  if (raw !== null) {
    try { sent = JSON.parse(raw); } catch { throw new Error(`${SENT} is not JSON`); }
    if (!sent || typeof sent !== 'object' || Array.isArray(sent)) throw new Error(`${SENT} must be an object of fingerprint → { issue, at }`);
  }
  const { rows } = parseLessons(text);
  const unsent = rows.map(r => ({ n: r.n, fingerprint: lessonFingerprint(project, r) })).filter(r => !Object.hasOwn(sent, r.fingerprint));
  return { path, project, rows: rows.length, unsent };
}

/** Phases the roadmap's parser rejects, duplicate numbers, and goals with no phase. */
export async function phaseLints(root, parsePhase) {
  const lint = [];
  const dir = join(root, 'docs', 'phases');
  const names = (await readdir(dir).catch(() => [])).filter(n => n.endsWith('.md') && n !== 'README.md').sort();
  const phases = [];
  for (const file of names) {
    try { phases.push(parsePhase(file, await read(join(dir, file)))); }
    catch (e) { lint.push({ rule: 'phase', path: `docs/phases/${file}`, message: e.message }); }
  }
  let goals = [];
  try { goals = JSON.parse((await read(join(root, 'docs', 'goals.json'))) ?? '[]'); } catch { goals = []; }
  const seen = new Map();
  for (const p of phases) {
    if (seen.has(p.id)) lint.push({ rule: 'phase', path: `docs/phases/${p.file}`, message: `duplicate phase number ${p.id}: ${seen.get(p.id)} and ${p.file}; renumber one` });
    else seen.set(p.id, p.file);
  }
  if (Array.isArray(goals)) for (const g of goals) {
    if (g?.id && !g.retired && !phases.some(p => p.goal === g.id)) lint.push({ rule: 'goal-without-phase', path: 'docs/goals.json', message: `${g.id}: no phase serves this goal` });
  }
  return lint;
}

// ---- the gate's environment -------------------------------------------------

export const ENV_KEY = /^[A-Z_][A-Z0-9_]*$/;

/**
 * What is wrong with .keel/keel.json `setup` (a shell command, run before the
 * gate by the night's workflows), `setupToken` (the NAME of a repo secret the
 * night's Install step hands `setup` as GH_TOKEN, for a `gh repo clone` of a
 * private repo; never a value) and `env` (a flat map applied wherever keel
 * runs the gate). All are optional. Returns a list of messages.
 */
export function setupEnvProblems(config) {
  const problems = [];
  if (config?.setup !== undefined && (typeof config.setup !== 'string' || !config.setup.trim())) problems.push('"setup" must be a non-empty shell command');
  const token = config?.setupToken;
  if (token !== undefined) {
    if (typeof token !== 'string' || !ENV_KEY.test(token)) problems.push(`"setupToken" must name a repo secret (${ENV_KEY.source}), never hold a token`);
    else if (token.startsWith('GITHUB_')) problems.push('"setupToken" cannot start with GITHUB_ (GitHub reserves those secret names; the default token is used when setupToken is absent)');
    if (config?.setup === undefined) problems.push('"setupToken" is set but there is no "setup" to hand it to');
  }
  const env = config?.env;
  if (env === undefined) return problems;
  if (!env || typeof env !== 'object' || Array.isArray(env)) return [...problems, '"env" must be an object of NAME: "value"'];
  for (const [k, v] of Object.entries(env)) {
    if (!ENV_KEY.test(k)) problems.push(`"env" key ${JSON.stringify(k)} is not an environment variable name (${ENV_KEY.source})`);
    if (typeof v !== 'string') problems.push(`"env" ${k} must be a string`);
  }
  return problems;
}

/**
 * The environment the project's gate runs in. Never a test runner's context:
 * its node --test would skip every file and pass (lesson 14). The project's
 * `env` goes over it, so a gate that must not sync or push (ledger's
 * LEDGER_AUTOSYNC=0) never does from a keel run. A bad `env` throws.
 */
export function gateEnv(env, config) {
  const problems = setupEnvProblems({ env: config?.env });
  if (problems.length) throw new Error(`.keel/keel.json: ${problems.join('; ')}`);
  const base = Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('NODE_TEST_')));
  return { ...base, ...(config?.env ?? {}) };
}

// ---- running a script --------------------------------------------------------

/** True when `meta` is the module node was started with. */
export function isMain(meta) {
  if (!process.argv[1]) return false;
  const real = p => { try { return realpathSync(p); } catch { return resolve(p); } };
  return real(process.argv[1]) === real(fileURLToPath(meta.url));
}

/** The project root of a script at scripts/keel/<name>.mjs. */
export const rootOf = meta => resolve(fileURLToPath(meta.url), '..', '..', '..');

/**
 * Run fn(args) → { data, text, exitCode? }; print data under --json, text
 * otherwise. An error prints and exits with its exitCode (default 1).
 */
export async function main(fn, argv = process.argv.slice(2)) {
  const json = argv.includes('--json');
  try {
    const r = await fn(argv.filter(a => a !== '--json'));
    process.stdout.write(json ? `${JSON.stringify(r.data, null, 2)}\n` : `${r.text}\n`);
    process.exitCode = r.exitCode ?? 0;
  } catch (error) {
    const message = String(error?.message ?? error).split('\n')[0];
    if (json) process.stdout.write(`${JSON.stringify({ error: message })}\n`);
    else process.stderr.write(`${message}\n`);
    process.exitCode = error?.exitCode ?? 1;
  }
}
