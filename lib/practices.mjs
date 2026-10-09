// Practices are modules: practices/<name>/{README.md, practice.json, files/}.
// This file loads them, plans a render onto a project, and writes it.
//
// A target is one of three kinds (docs/design.md §1):
//   managed  keel's file; rendered every time, a difference is drift
//   block    an <!-- keel:begin id --> … <!-- keel:end id --> region of a file
//            the project owns; only the region's inside is rendered
//   seeded   the project's file; written only when it does not exist
// A managed entry may be a symlink ({ "link": target }), for doorways (§2).
//
// Templates know five placeholders, {{name}}, {{tagline}}, {{repo}}, {{check}},
// {{lessons}}, taken from the project's .keel/keel.json. {{check}} is the
// project's one gate (design §1a) and defaults to "npm run check"; {{lessons}}
// is the project's lessons table and defaults to "docs/lessons.md". Anything else in {{…}} is an
// error, and so is a placeholder a template uses whose value is missing; one no
// template uses may be absent (a project with no GitHub repo has no "repo").
//
// A seeded entry may name a `seat` (a placeholder key, e.g. "lessons"): it is
// written at the config's value for that key when one is set, else at its own
// path. So a project whose lessons live in docs/reviews/lessons.md keeps them
// there, and keel never seeds a second table beside them.
//
// An optional practice (practice.json "optional": true: loop, claude) is never
// switched on by keel init or adopt unless named with --with <practice>; a
// project turns it on later by listing it.
//
// A practice's requirement is met by a practice switched on, or by one the
// project keeps as a local variant (.keel/keel.json "local", from keel adopt).
// GitHub Actions expressions (${{ … }}) are not placeholders.
//
// A block adopt skipped (.keel/keel.json "blocksSkipped", a list of block ids)
// is one whose rule the project's AGENTS.md already states in its own words:
// render never plans it, so no markers are missing for it.
//
// A target the project has ejected (.keel/keel.json "ejected", a path or
// path#block, from keel doctor --fix eject) is the project's from then on:
// render never plans it again and the lock forgets it.
//
// Every render that writes also writes .keel/lock.json (lib/lock.mjs): the
// sha of what keel wrote for each managed file, block and link. --check never
// writes it. A target the project changed since keel wrote it (doctor's
// edited or both) is signal: render refuses to write over it, naming each one,
// until doctor's --fix restores or ejects it. A target the lock does not know
// is rendered as before, since nothing proves the project changed it.
//
// A managed file may be shaped by facts of the project beyond its config
// (phase 29): renovate.json gains a rule disabling the project's own workspace
// packages (package.json `workspaces`, and its `name`), and `timezone` from
// .keel/keel.json when set. The facts ride on the config under PROJECT, a
// non-enumerable key, so they are never written back to .keel/keel.json;
// config(root) and withProject(root, config) attach them. Without them (or
// with nothing to add) the template's bytes are the file's bytes.
//
// A block may be shaped by the config too (fill's `block`): the agents-md
// block gains the contracts table (phase 65) when .keel/keel.json sets
// "contracts", and is the template's bytes when it does not. A file entry
// with "when" (practice.json; WHEN below) is a target only while its
// condition holds: the contract hook and its .claude/settings.json.
//
// docs/keel-lessons.md (the lessons practice, phase 30) is shaped by keel's
// catalogue as this keel carries it and the config's `stack`: the rows a
// project with that stack reads (lib/stacks.mjs). An unknown tag throws.
import { readFile, readdir, writeFile, mkdir, lstat, readlink, symlink, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join, isAbsolute, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, lockKey, readLock, writeLock, driftState } from './lock.mjs';
import { settle } from './taken.mjs';
import { shapeLessonsView, VIEW } from './stacks.mjs';
import { contractProblems } from '../practices/agents-md/files/scripts/keel/contract-hook.mjs';

export const PRACTICES = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'practices');
export const KINDS = ['managed', 'block', 'seeded'];
export const PLACEHOLDERS = ['name', 'tagline', 'repo', 'check', 'lessons'];
export const DEFAULTS = { check: 'npm run check', lessons: 'docs/lessons.md' };
/** Where a config carries the project's facts (projectFacts); never serialized. */
export const PROJECT = Symbol.for('keel.project');

/** The project's lessons table: .keel/keel.json `lessons`, else docs/lessons.md. */
export const lessonsPath = (config = {}) => typeof config.lessons === 'string' && config.lessons ? config.lessons : DEFAULTS.lessons;
const fail = message => { throw new Error(message); };
const inside = path => typeof path === 'string' && path && !isAbsolute(path)
  && !normalize(path).split(sep).includes('..');
const begin = id => `<!-- keel:begin ${id} -->`;
const end = id => `<!-- keel:end ${id} -->`;

/** Every practice under `dir`, validated, with its templates read. */
export async function load(dir = PRACTICES) {
  const names = (await readdir(dir, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort();
  // Read independent practices together; consume results in name order, including
  // errors. All reads finish before returning, and nothing survives this call.
  const loaded = await Promise.allSettled(names.map(async name => {
    const where = `practices/${name}/practice.json`;
    const spec = JSON.parse(await readFile(join(dir, name, 'practice.json'), 'utf8'));
    if (spec.name !== name) fail(`${where}: name must be ${name}`);
    if (typeof spec.summary !== 'string' || !spec.summary.trim()) fail(`${where}: missing summary`);
    if (!Array.isArray(spec.requires)) fail(`${where}: requires must be an array`);
    if (spec.optional !== undefined && typeof spec.optional !== 'boolean') fail(`${where}: optional must be true or false`);
    if (spec.source) for (const key of ['repo', 'path', 'commit', 'license']) {
      if (typeof spec.source[key] !== 'string' || !spec.source[key]) fail(`${where}: source needs ${key}`);
    }
    if (spec.secrets !== undefined && (!Array.isArray(spec.secrets) || spec.secrets.some(s => !s
        || !['name', 'why', 'workflow'].every(k => typeof s[k] === 'string' && s[k])))) fail(`${where}: secrets must be [{name, why, workflow}]`);
    if (!Array.isArray(spec.files) || !spec.files.length) fail(`${where}: no files`);
    const files = [];
    for (const f of spec.files) {
      if (!inside(f.path)) fail(`${where}: bad path ${f.path}`);
      if (!KINDS.includes(f.kind)) fail(`${where}: ${f.path}: kind must be one of ${KINDS.join(', ')}`);
      if (f.link !== undefined) {
        if (f.kind !== 'managed' || f.from !== undefined || typeof f.link !== 'string') fail(`${where}: ${f.path}: a link is managed and has no from`);
        files.push({ practice: name, path: f.path, kind: f.kind, link: f.link });
        continue;
      }
      if (f.when !== undefined && !Object.hasOwn(WHEN, f.when)) fail(`${where}: ${f.path}: "when" must be one of ${Object.keys(WHEN).join(', ')}`);
      if (!inside(f.from)) fail(`${where}: ${f.path}: bad from ${f.from}`);
      if (f.kind === 'block' ? !/^[a-z0-9-]+$/.test(f.block ?? '') : f.block !== undefined) fail(`${where}: ${f.path}: only a block entry names a block id`);
      if (f.seat !== undefined && (f.kind !== 'seeded' || !PLACEHOLDERS.includes(f.seat))) fail(`${where}: ${f.path}: only a seeded entry has a seat, and it names a placeholder`);
      const template = await readFile(join(dir, name, 'files', f.from), 'utf8')
        .catch(() => fail(`${where}: missing template files/${f.from}`));
      files.push({ practice: name, path: f.path, kind: f.kind, from: f.from, block: f.block, ...(f.seat ? { seat: f.seat } : {}), ...(f.when ? { when: f.when } : {}), template });
    }
    return [name, { name, summary: spec.summary, optional: spec.optional === true, requires: spec.requires, source: spec.source, secrets: spec.secrets ?? [], files }];
  }));
  const practices = new Map(loaded.map(result => {
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  }));
  for (const p of practices.values()) for (const r of p.requires) {
    if (!practices.has(r)) fail(`practices/${p.name}: requires unknown practice ${r}`);
  }
  claims(practices.values());
  return practices;
}

/** No target is claimed twice. A block may sit in a seeded file, never a managed one. */
export function claims(practices) {
  const whole = new Map(), blocks = new Map();
  for (const p of practices) for (const f of p.files) {
    const key = f.kind === 'block' ? `${f.path}#${f.block}` : f.path;
    const seen = f.kind === 'block' ? blocks : whole;
    if (seen.has(key)) fail(`${key} is claimed by ${seen.get(key).practice} and ${p.name}`);
    seen.set(key, { practice: p.name, kind: f.kind });
  }
  for (const [key, { practice }] of blocks) {
    const path = key.slice(0, key.lastIndexOf('#'));
    if (whole.get(path)?.kind === 'managed') fail(`${key} (${practice}) sits in a managed file`);
  }
  return { whole, blocks };
}

/** Where a file entry lands for this config: a seated seeded file at the config's value. */
export function placed(f, config = {}) {
  if (!f.seat) return f;
  const value = config[f.seat];
  if (value !== undefined && !inside(value)) fail(`.keel/keel.json: "${f.seat}" must be a path inside the project`);
  return value ? { ...f, path: value } : f;
}

/** Fill {{name}}, {{tagline}}, {{repo}}, {{check}}, {{lessons}}. JSON targets get JSON-escaped values. */
export function fill(template, config, path = '', block) {
  const text = template.replace(/(\$?)\{\{\s*([^{}]*?)\s*\}\}/g, (match, dollar, key) => {
    if (dollar) return match;
    if (!PLACEHOLDERS.includes(key)) fail(`${path}: unknown placeholder {{${key}}}`);
    const value = config[key] ?? DEFAULTS[key];
    if (typeof value !== 'string' || !value) fail(`${path}: {{${key}}} has no value in .keel/keel.json`);
    return path.endsWith('.json') ? JSON.stringify(value).slice(1, -1) : value;
  });
  if (block !== undefined) return BLOCK_SHAPES[block] ? BLOCK_SHAPES[block](text, config) : text;
  return SHAPES[path] ? SHAPES[path](text, config) : text;
}

/** Shapes a managed file takes from the project, by target path. */
const SHAPES = { 'renovate.json': shapeRenovate, [VIEW]: (text, config) => shapeLessonsView(text, config) };

/**
 * renovate.json for this project: its workspace packages are source, not
 * dependencies (a disable rule first, so no lane below re-enables them), and
 * its `timezone` beside the schedule. Nothing to add: the template unchanged.
 */
export function shapeRenovate(text, config = {}) {
  const names = config[PROJECT]?.workspaces ?? [];
  const tz = config.timezone;
  if (tz !== undefined && (typeof tz !== 'string' || !/^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+)*$/.test(tz))) {
    fail('.keel/keel.json: "timezone" must be an IANA timezone name, e.g. "America/Denver"');
  }
  if (!names.length && tz === undefined) return text;
  const json = JSON.parse(text), out = {};
  for (const [k, v] of Object.entries(json)) {
    if (k === 'schedule' && tz) out.timezone = tz;
    if (k !== 'timezone') out[k] = v;
  }
  if (tz && !('timezone' in out)) out.timezone = tz;
  if (names.length) out.packageRules = [{
    description: "The project's own workspace packages (package.json workspaces and name) are source, not dependencies. First, so no lane below turns them back on.",
    matchPackageNames: packagePatterns(names),
    enabled: false,
  }, ...(json.packageRules ?? [])];
  return `${JSON.stringify(out, null, 2)}\n`;
}

/**
 * The workspace rule's names: when every scoped name shares one scope, that
 * scope as `@scope/**` (a new package in it is covered without a render) and
 * the unscoped names; scoped names across several scopes stay exact.
 */
export function packagePatterns(names) {
  const scopes = new Set(names.filter(n => n.startsWith('@') && n.includes('/')).map(n => n.slice(0, n.indexOf('/'))));
  if (scopes.size !== 1) return names;
  const [scope] = scopes;
  return [`${scope}/**`, ...names.filter(n => !n.startsWith(`${scope}/`))];
}

/**
 * Facts of the project its managed files are shaped by: `workspaces`, the
 * names of its own workspace packages (each workspace's package.json `name`,
 * and the root's), sorted; empty without package.json `workspaces`. A pattern
 * ending in /* or /** is the directories under it; any other glob is skipped.
 */
export async function projectFacts(root) {
  let pkg = null;
  try { pkg = JSON.parse(await read(join(root, 'package.json')) ?? 'null'); } catch { pkg = null; }
  const patterns = Array.isArray(pkg?.workspaces) ? pkg.workspaces : Array.isArray(pkg?.workspaces?.packages) ? pkg.workspaces.packages : [];
  const dirs = [];
  for (const pattern of patterns.filter(p => typeof p === 'string' && inside(p.replace(/\/\*{1,2}$/, '') || '.'))) {
    const base = pattern.replace(/\/\*{1,2}$/, '');
    if (/[*?[\]{}!]/.test(base)) continue;
    if (base === pattern) { dirs.push(base); continue; }
    const kids = await readdir(join(root, base), { withFileTypes: true }).catch(() => []);
    for (const d of kids) if (d.isDirectory() && d.name !== 'node_modules') dirs.push(join(base, d.name));
  }
  const names = new Set();
  for (const dir of dirs) {
    try {
      const name = JSON.parse(await read(join(root, dir, 'package.json')) ?? 'null')?.name;
      if (typeof name === 'string' && name) names.add(name);
    } catch { /* not a package */ }
  }
  if (names.size && typeof pkg?.name === 'string' && pkg.name) names.add(pkg.name);
  return { workspaces: [...names].sort() };
}

/** `config` with the project's facts attached under PROJECT (non-enumerable), for fill. */
export async function withProject(root, config) {
  Object.defineProperty(config, PROJECT, { value: await projectFacts(root), enumerable: false, configurable: true, writable: true });
  return config;
}

const read = path => readFile(path, 'utf8').catch(e => e.code === 'ENOENT' ? null : Promise.reject(e));
const kindOf = path => lstat(path).catch(e => e.code === 'ENOENT' ? null : Promise.reject(e));

export function replaceBlock(text, id, body, path) {
  const b = text.indexOf(begin(id)), e = text.indexOf(end(id));
  if (b < 0 || e < 0 || e < b || text.indexOf(begin(id), b + 1) >= 0) return null;
  const from = text.indexOf('\n', b) + 1;
  if (!from || from > e) fail(`${path}: ${begin(id)} must end its line`);
  return text.slice(0, from) + body + text.slice(e);
}

/** The project's ejected targets (path or path#block), validated. */
export function ejected(config) {
  const list = config.ejected ?? [];
  if (!Array.isArray(list) || list.some(k => typeof k !== 'string' || !k)) fail('.keel/keel.json: "ejected" must be a list of paths');
  return list;
}

/** The block ids adopt skipped because the project's AGENTS.md already states their rule, validated. */
export function blocksSkipped(config) {
  const list = config.blocksSkipped ?? [];
  if (!Array.isArray(list) || list.some(k => typeof k !== 'string' || !k)) fail('.keel/keel.json: "blocksSkipped" must be a list of block ids');
  return list;
}

/** Every file entry of the enabled practices, requirements checked, ejected targets and skipped blocks left out. */
export function targets(config, practices) {
  if (!Array.isArray(config.practices) || !config.practices.length) fail('.keel/keel.json: "practices" must list the practices this project uses');
  const enabled = [];
  for (const name of config.practices) {
    const p = practices.get(name) ?? fail(`.keel/keel.json: unknown practice ${name}`);
    for (const r of p.requires) if (!config.practices.includes(r) && !Object.hasOwn(config.local ?? {}, r)) fail(`practice ${name} requires ${r}`);
    enabled.push(p);
  }
  const out = new Set(ejected(config)), skipped = new Set(blocksSkipped(config));
  return enabled.flatMap(p => p.files).filter(f => wanted(f, config)).map(f => placed(f, config)).filter(f => !out.has(lockKey(f)) && !(f.kind === 'block' && skipped.has(f.block)));
}

/**
 * Conditions a file entry may name (practice.json "when"): the entry is a
 * target only while the condition holds for the project's config.
 *   contracts  .keel/keel.json sets "contracts" (phase 65): the pre-edit hook
 *              script and the .claude/settings.json that runs it
 */
export const WHEN = { contracts: config => Array.isArray(config?.contracts) && config.contracts.length > 0 };

/** Whether a file entry is a target for this config (its "when", if any, holds). */
export const wanted = (f, config) => !f.when || WHEN[f.when](config);

/** The project's contracts (.keel/keel.json "contracts"), validated; [] when unset. */
export function contracts(config = {}) {
  const problems = contractProblems(config.contracts);
  if (problems.length) fail(`.keel/keel.json: ${problems.join('; ')}`);
  return config.contracts ?? [];
}

const cell = text => String(text).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/**
 * The contracts as the guide's table (phase 65), appended to the agents-md
 * block. No contracts: '' (the block's bytes are the template's).
 */
export function contractsTable(list) {
  if (!list.length) return '';
  return ['', '**Read this before touching that.** Before you edit a file these patterns match, read its document. A Claude Code hook (`scripts/keel/contract-hook.mjs`) says the same before an edit.', '',
    '| Paths | Read first | Why |', '| --- | --- | --- |',
    ...list.map(c => `| ${c.paths.map(p => `\`${cell(p)}\``).join(', ')} | \`${cell(c.read)}\` | ${cell(c.why)} |`), ''].join('\n');
}

/** Shapes a block takes from the project's config, by block id. */
const BLOCK_SHAPES = { 'agents-md': (text, config) => text + contractsTable(contracts(config)) };

/** The inside of a block, or null when its markers are absent or broken. */
export function blockBody(text, id) {
  if (text === null) return null;
  const b = text.indexOf(begin(id)), e = text.indexOf(end(id));
  if (b < 0 || e < 0 || e < b || text.indexOf(begin(id), b + 1) >= 0) return null;
  const from = text.indexOf('\n', b) + 1;
  return !from || from > e ? null : text.slice(from, e);
}

/** What keel writes for one target: a file's text, a block's inside, a link's target. */
export const bytesFor = (f, config) => f.link !== undefined ? f.link : fill(f.template, config, f.path, f.block);

/**
 * What a render would do, without doing it. Each entry:
 * { practice, path, kind, block?, status, content?, link? }
 * status: create | update | same | kept (seeded and present) | missing (block markers absent)
 * state (an update the lock knows): behind | edited | both — see lib/lock.mjs
 */
export async function plan(root, config, practices, lock = null) {
  const files = targets(config, practices);
  const entries = [], pending = new Map();
  for (const f of files.filter(f => f.kind !== 'block')) {
    const target = join(root, f.path);
    const base = { practice: f.practice, path: f.path, kind: f.kind };
    if (f.link !== undefined) {
      const info = await kindOf(target);
      const status = !info ? 'create' : info.isSymbolicLink() && await readlink(target) === f.link ? 'same'
        : info.isSymbolicLink() ? 'update' : fail(`${f.path}: exists and is not a symlink; refusing to replace it`);
      entries.push({ ...base, link: f.link, status, ...(status === 'update' ? { now: await readlink(target) } : {}) });
      continue;
    }
    const content = fill(f.template, config, f.path);
    const current = await read(target);
    if (f.kind === 'seeded') {
      entries.push(current === null ? { ...base, status: 'create', content } : { ...base, status: 'kept' });
      if (current === null) pending.set(f.path, content);
      continue;
    }
    const status = current === null ? 'create' : current === content ? 'same' : 'update';
    entries.push({ ...base, content, status, ...(status === 'update' ? { now: current } : {}) });
  }
  for (const f of files.filter(f => f.kind === 'block')) {
    const base = { practice: f.practice, path: f.path, kind: f.kind, block: f.block };
    const current = pending.get(f.path) ?? await read(join(root, f.path));
    if (current === null) fail(`${f.path}: block ${f.block} needs the file, and nothing seeds it`);
    const body = fill(f.template, config, f.path, f.block);
    const next = replaceBlock(current, f.block, body, f.path);
    if (next === null) { entries.push({ ...base, status: 'missing' }); continue; }
    pending.set(f.path, next);
    entries.push({ ...base, body, status: next === current ? 'same' : 'update', ...(next === current ? {} : { now: blockBody(current, f.block) }) });
  }
  // What the project did to each target keel would change, against the lock.
  for (const e of entries) {
    if (e.status !== 'update') continue;
    const locked = lock?.files?.[lockKey(e)]?.sha256;
    const template = e.link ?? (e.kind === 'block' ? e.body : e.content);
    if (locked) e.state = await settle(driftState(e.now, locked, template), { now: e.now, locked, f: files.find(f => lockKey(f) === lockKey(e)), config, template, version: lock?.practice });
    delete e.now;
  }
  // A block's content is the whole file after every block in it is rendered.
  for (const e of entries) if (e.kind === 'block' && e.status !== 'missing') e.content = pending.get(e.path);
  for (const e of entries) if (e.kind === 'seeded' && e.status === 'create') e.content = pending.get(e.path);
  return entries;
}

/** The project's config, read from <root>/.keel/keel.json. */
export async function config(root) {
  const text = await read(join(root, '.keel/keel.json'));
  if (text === null) fail(`${root}: no .keel/keel.json`);
  return withProject(root, JSON.parse(text));
}

/**
 * Render the enabled practices onto `root`. With check, write nothing and
 * return what differs: managed files and blocks only; seeded files are never
 * compared.
 */
export async function render(root, { check = false, practices, version = practiceVersion() } = {}) {
  practices ??= await load();
  const entries = await plan(root, await config(root), practices, await readLock(root));
  const differs = entries.filter(e => e.kind !== 'seeded' && e.status !== 'same');
  const changed = entries.filter(e => e.state === 'edited' || e.state === 'both');
  if (check) return { ok: !differs.length, entries, differs, changed };
  const missing = entries.filter(e => e.status === 'missing');
  if (missing.length) fail(`missing block markers: ${missing.map(e => `${e.path}#${e.block}`).join(', ')}`);
  if (changed.length) {
    const error = new Error(`refusing to overwrite what the project changed (${changed.map(e => `${lockKey(e)} ${e.state}`).join(', ')}); see keel doctor, then keel doctor --fix <path> restore|eject`);
    error.exitCode = 1;
    error.changed = changed.map(lockKey);
    throw error;
  }
  for (const e of entries) {
    if (e.status !== 'create' && e.status !== 'update') continue;
    const target = join(root, e.path);
    await mkdir(dirname(target), { recursive: true });
    if (e.link !== undefined) {
      if (e.status === 'update') await rm(target);
      await symlink(e.link, target);
    } else {
      await writeFile(target, e.content); // blocks in one file all carry its final text
    }
  }
  await writeLock(root, lockOf(entries, version));
  return { ok: true, entries, differs };
}

/** The lock for a plan once it is written: every managed file, block and link. */
export function lockOf(entries, version) {
  const files = {};
  for (const e of entries) {
    if (e.kind === 'seeded') continue;
    const bytes = e.link !== undefined ? e.link : e.kind === 'block' ? e.body : e.content;
    files[lockKey(e)] = { practice: e.practice, sha256: sha256(bytes) };
  }
  return { practice: version, files };
}

/**
 * The practice version this keel carries: practices/VERSION, one line, x.y.z.
 * It is not the CLI's version (package.json): keel release moves it only when
 * practices/ or migrations/ changed (phase 22). Every reader goes through here.
 */
export function practiceVersion(dir = PRACTICES) {
  const v = readFileSync(join(dir, 'VERSION'), 'utf8').trim();
  if (!/^\d+\.\d+\.\d+$/.test(v)) fail(`${join(dir, 'VERSION')}: not a version (x.y.z): ${v}`);
  return v;
}
