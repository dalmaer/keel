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
// Templates know four placeholders, {{name}}, {{tagline}}, {{repo}}, {{check}},
// taken from the project's .keel/keel.json. {{check}} is the project's one gate
// (design §1a) and defaults to "npm run check". Anything else in {{…}} is an
// error, and so is a placeholder a template uses whose value is missing; one no
// template uses may be absent (a project with no GitHub repo has no "repo").
//
// A practice's requirement is met by a practice switched on, or by one the
// project keeps as a local variant (.keel/keel.json "local", from keel adopt).
// GitHub Actions expressions (${{ … }}) are not placeholders.
import { readFile, readdir, writeFile, mkdir, lstat, readlink, symlink, rm } from 'node:fs/promises';
import { dirname, resolve, join, isAbsolute, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRACTICES = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'practices');
export const KINDS = ['managed', 'block', 'seeded'];
export const PLACEHOLDERS = ['name', 'tagline', 'repo', 'check'];
export const DEFAULTS = { check: 'npm run check' };
const fail = message => { throw new Error(message); };
const inside = path => typeof path === 'string' && path && !isAbsolute(path)
  && !normalize(path).split(sep).includes('..');
const begin = id => `<!-- keel:begin ${id} -->`;
const end = id => `<!-- keel:end ${id} -->`;

/** Every practice under `dir`, validated, with its templates read. */
export async function load(dir = PRACTICES) {
  const names = (await readdir(dir, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort();
  const practices = new Map();
  for (const name of names) {
    const where = `practices/${name}/practice.json`;
    const spec = JSON.parse(await readFile(join(dir, name, 'practice.json'), 'utf8'));
    if (spec.name !== name) fail(`${where}: name must be ${name}`);
    if (typeof spec.summary !== 'string' || !spec.summary.trim()) fail(`${where}: missing summary`);
    if (!Array.isArray(spec.requires)) fail(`${where}: requires must be an array`);
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
      if (!inside(f.from)) fail(`${where}: ${f.path}: bad from ${f.from}`);
      if (f.kind === 'block' ? !/^[a-z0-9-]+$/.test(f.block ?? '') : f.block !== undefined) fail(`${where}: ${f.path}: only a block entry names a block id`);
      const template = await readFile(join(dir, name, 'files', f.from), 'utf8')
        .catch(() => fail(`${where}: missing template files/${f.from}`));
      files.push({ practice: name, path: f.path, kind: f.kind, from: f.from, block: f.block, template });
    }
    practices.set(name, { name, summary: spec.summary, requires: spec.requires, source: spec.source, secrets: spec.secrets ?? [], files });
  }
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

/** Fill {{name}}, {{tagline}}, {{repo}}, {{check}}. JSON targets get JSON-escaped values. */
export function fill(template, config, path = '') {
  return template.replace(/(\$?)\{\{\s*([^{}]*?)\s*\}\}/g, (match, dollar, key) => {
    if (dollar) return match;
    if (!PLACEHOLDERS.includes(key)) fail(`${path}: unknown placeholder {{${key}}}`);
    const value = config[key] ?? DEFAULTS[key];
    if (typeof value !== 'string' || !value) fail(`${path}: {{${key}}} has no value in .keel/keel.json`);
    return path.endsWith('.json') ? JSON.stringify(value).slice(1, -1) : value;
  });
}

const read = path => readFile(path, 'utf8').catch(e => e.code === 'ENOENT' ? null : Promise.reject(e));
const kindOf = path => lstat(path).catch(e => e.code === 'ENOENT' ? null : Promise.reject(e));

function replaceBlock(text, id, body, path) {
  const b = text.indexOf(begin(id)), e = text.indexOf(end(id));
  if (b < 0 || e < 0 || e < b || text.indexOf(begin(id), b + 1) >= 0) return null;
  const from = text.indexOf('\n', b) + 1;
  if (!from || from > e) fail(`${path}: ${begin(id)} must end its line`);
  return text.slice(0, from) + body + text.slice(e);
}

/**
 * What a render would do, without doing it. Each entry:
 * { practice, path, kind, block?, status, content?, link? }
 * status: create | update | same | kept (seeded and present) | missing (block markers absent)
 */
export async function plan(root, config, practices) {
  if (!Array.isArray(config.practices) || !config.practices.length) fail('.keel/keel.json: "practices" must list the practices this project uses');
  const enabled = [];
  for (const name of config.practices) {
    const p = practices.get(name) ?? fail(`.keel/keel.json: unknown practice ${name}`);
    for (const r of p.requires) if (!config.practices.includes(r) && !Object.hasOwn(config.local ?? {}, r)) fail(`practice ${name} requires ${r}`);
    enabled.push(p);
  }
  const files = enabled.flatMap(p => p.files);
  const entries = [], pending = new Map();
  for (const f of files.filter(f => f.kind !== 'block')) {
    const target = join(root, f.path);
    const base = { practice: f.practice, path: f.path, kind: f.kind };
    if (f.link !== undefined) {
      const info = await kindOf(target);
      const status = !info ? 'create' : info.isSymbolicLink() && await readlink(target) === f.link ? 'same'
        : info.isSymbolicLink() ? 'update' : fail(`${f.path}: exists and is not a symlink; refusing to replace it`);
      entries.push({ ...base, link: f.link, status });
      continue;
    }
    const content = fill(f.template, config, f.path);
    const current = await read(target);
    if (f.kind === 'seeded') {
      entries.push(current === null ? { ...base, status: 'create', content } : { ...base, status: 'kept' });
      if (current === null) pending.set(f.path, content);
      continue;
    }
    entries.push({ ...base, content, status: current === null ? 'create' : current === content ? 'same' : 'update' });
  }
  for (const f of files.filter(f => f.kind === 'block')) {
    const base = { practice: f.practice, path: f.path, kind: f.kind, block: f.block };
    const current = pending.get(f.path) ?? await read(join(root, f.path));
    if (current === null) fail(`${f.path}: block ${f.block} needs the file, and nothing seeds it`);
    const next = replaceBlock(current, f.block, fill(f.template, config, f.path), f.path);
    if (next === null) { entries.push({ ...base, status: 'missing' }); continue; }
    pending.set(f.path, next);
    entries.push({ ...base, status: next === current ? 'same' : 'update' });
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
  return JSON.parse(text);
}

/**
 * Render the enabled practices onto `root`. With check, write nothing and
 * return what differs: managed files and blocks only; seeded files are never
 * compared.
 */
export async function render(root, { check = false, practices } = {}) {
  practices ??= await load();
  const entries = await plan(root, await config(root), practices);
  const differs = entries.filter(e => e.kind !== 'seeded' && e.status !== 'same');
  if (check) return { ok: !differs.length, entries, differs };
  const missing = entries.filter(e => e.status === 'missing');
  if (missing.length) fail(`missing block markers: ${missing.map(e => `${e.path}#${e.block}`).join(', ')}`);
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
  return { ok: true, entries, differs };
}
