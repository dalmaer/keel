// Migrations: how a project on one practice version reaches the next (design §3).
//
// migrations/NNNN-slug.mjs exports
//   id        'NNNN-slug', the file's own name
//   to        the practice version it brings a project to ('0.1.0')
//   summary   one line, for the commit and the pull request
//   applies(project) → boolean   idempotent; true while there is work to do
//   up(project) → [{ path, content | null }]   the edits; null deletes. It performs nothing.
//
// `project` is read-only: { root, config, read(path), exists(path), list(dir) }.
// Paths are relative to the root, with forward slashes. Migrations run in id
// order over an in-memory overlay, so a later one sees an earlier one's edits
// and nothing reaches the disk until every one has returned.
import { readFile, readdir, lstat } from 'node:fs/promises';
import { dirname, join, resolve, normalize, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const FILE = /^(\d{4}-[a-z0-9-]+)\.mjs$/;

// ---- versions --------------------------------------------------------------

/** [major, minor, patch] of 'x.y.z' or 'vx.y.z', or null. */
export function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? ''));
  return m ? m.slice(1).map(Number) : null;
}

/** <0, 0, >0 as a is older, equal or newer than b. Throws on a malformed version. */
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x) throw new Error(`not a version: ${a}`);
  if (!y) throw new Error(`not a version: ${b}`);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

// ---- loading ---------------------------------------------------------------

/** Every migration under `dir`, validated, in id order. */
export async function load(dir = MIGRATIONS) {
  const names = (await readdir(dir).catch(e => e.code === 'ENOENT' ? [] : Promise.reject(e))).filter(n => FILE.test(n)).sort();
  const out = [];
  for (const name of names) {
    const mod = await import(pathToFileURL(join(dir, name)).href);
    const m = mod.default && typeof mod.default === 'object' ? mod.default : mod;
    const where = `migrations/${name}`;
    const id = FILE.exec(name)[1];
    if (m.id !== id) throw new Error(`${where}: id must be ${id}`);
    if (!parseVersion(m.to)) throw new Error(`${where}: to must be a version (x.y.z)`);
    if (typeof m.summary !== 'string' || !m.summary.trim()) throw new Error(`${where}: missing summary`);
    for (const fn of ['applies', 'up']) if (typeof m[fn] !== 'function') throw new Error(`${where}: missing ${fn}()`);
    out.push({ id: m.id, to: m.to.replace(/^v/, ''), summary: m.summary, applies: m.applies, up: m.up });
  }
  return out;
}

// ---- the read-only project -------------------------------------------------

const inside = path => typeof path === 'string' && path && !isAbsolute(path)
  && !normalize(path).split(sep).includes('..');
const clean = path => normalize(path).split(sep).join('/').replace(/\/$/, '');

/**
 * A read-only view of `root` with `overlay` (path → content | null) laid over
 * it. read() returns the text or null; list() returns names in a directory.
 */
export async function view(root, overlay = new Map()) {
  const check = path => {
    if (!inside(path)) throw new Error(`a migration may only read inside the project: ${path}`);
    return clean(path);
  };
  const read = async path => {
    const p = check(path);
    if (overlay.has(p)) return overlay.get(p);
    return readFile(join(root, p), 'utf8').catch(e => ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(e.code) ? null : Promise.reject(e));
  };
  const exists = async path => {
    const p = check(path);
    if (overlay.has(p)) return overlay.get(p) !== null;
    return !!(await lstat(join(root, p)).catch(() => null));
  };
  const list = async (dir = '.') => {
    const d = dir === '.' || dir === '' ? '.' : check(dir);
    const names = new Set(await readdir(join(root, d)).catch(() => []));
    for (const [p, content] of overlay) {
      if ((p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.') !== d) continue;
      const n = p.slice(p.lastIndexOf('/') + 1);
      if (content === null) names.delete(n); else names.add(n);
    }
    return [...names].sort();
  };
  const configText = await read('.keel/keel.json');
  const config = Object.freeze(configText === null ? {} : JSON.parse(configText));
  return Object.freeze({ root, config, read, exists, list });
}

export class MigrationError extends Error {
  constructor(id, cause) {
    super(`migration ${id} failed: ${String(cause?.message ?? cause).split('\n')[0]}`);
    this.exitCode = 1;
    this.migration = id;
  }
}

/** The migrations a project on `from` takes to reach `to`: from < m.to ≤ to, in id order. */
export const between = (migrations, from, to) =>
  migrations.filter(m => compareVersions(m.to, from) > 0 && compareVersions(m.to, to) <= 0)
    .sort((a, b) => a.id.localeCompare(b.id));

/**
 * Run applies() and up() for each pending migration over an overlay. Writes
 * nothing. Returns { applied: [{id, to, summary, edits}], skipped: [id], edits: Map }.
 * Throws MigrationError naming the first migration that throws or returns bad edits.
 */
export async function collect(root, migrations, { from, to }) {
  const overlay = new Map(), applied = [], skipped = [];
  for (const m of between(migrations, from, to)) {
    let edits;
    try {
      if (!(await m.applies(await view(root, overlay)))) { skipped.push(m.id); continue; }
      edits = await m.up(await view(root, overlay));
      if (!Array.isArray(edits)) throw new Error('up() must return a list of edits');
      for (const e of edits) {
        if (!e || !inside(e.path)) throw new Error(`bad edit path: ${e?.path}`);
        if (e.content !== null && typeof e.content !== 'string') throw new Error(`${e.path}: content must be text or null`);
      }
    } catch (error) {
      throw new MigrationError(m.id, error);
    }
    const mine = edits.map(e => ({ path: clean(e.path), content: e.content }));
    for (const e of mine) overlay.set(e.path, e.content);
    applied.push({ id: m.id, to: m.to, summary: m.summary, edits: mine });
  }
  return { applied, skipped, edits: overlay };
}
