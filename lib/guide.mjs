// One guide destination for rendering, drift, and adoption. Never follow a link
// outside the repository, even if a later link would bring it back inside.
import { lstatSync, readlinkSync, realpathSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, dirname, basename, isAbsolute, sep } from 'node:path';
export const GUIDE = Symbol.for('keel.guide');
class GuidePathError extends Error {
  constructor(message) { super(message); this.exitCode = 2; }
}
const bad = message => { throw new GuidePathError(`guide: ${message}`); };
const info = p => { try { return lstatSync(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
export function validateGuideName(path, root) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || /[\\#\x00-\x1f]/.test(path)
      || path.split('/').some(p => !p || p === '.' || p === '..')) bad('must be a repository-relative file path without traversal');
  validateGuideMetadata(path, root);
}
function validateGuideMetadata(path, root) {
  const parts = path.split('/');
  for (const [i, part] of parts.entries()) {
    const lower = part.toLowerCase();
    if (lower !== '.git' && lower !== '.keel') continue;
    const prefix = parts.slice(0, i);
    if (part === lower || (root && guideTargetsOverlap(root, [...prefix, part].join('/'), [...prefix, lower].join('/')))) {
      bad(`${path} is reserved repository metadata`);
    }
  }
}
export const guideDestination = (root, path) => destination(root, path, false);
// Probe entries inside this directory, never its name in the parent. A
// directory without a case-testable entry is unknown (null), not sensitive.
function foldsCase(directory) {
  let names;
  try { names = readdirSync(directory); }
  catch (e) { if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(e.code)) return null; throw e; }
  for (const name of names) {
    const alternate = name.replace(/[a-zA-Z]/, c => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase());
    if (alternate === name) continue;
    // Two stored spellings are distinct entries, even if they are hardlinks.
    if (names.includes(alternate)) return false;
    const original = info(resolve(directory, name)), other = info(resolve(directory, alternate));
    if (!original) continue; // The entry disappeared during the read.
    return !!other && original.dev === other.dev && original.ino === other.ino;
  }
  return null;
}
function collisionKey(root, path) {
  if (!root) return path;
  let directory = resolve(root);
  const keys = [directory.split(sep).join('/')];
  for (const part of relative(directory, resolve(root, path)).split(sep).filter(Boolean)) {
    // Unknown directories (including absent ones) cannot establish that case
    // variants are safe distinct targets. Conservatively reserve both until
    // entries demonstrate sensitivity. Never inherit a parent's answer.
    keys.push(foldsCase(directory) === false ? part : part.toLowerCase());
    directory = resolve(directory, part);
  }
  return keys.join('/');
}
export function guideTargetsOverlap(root, guide, target) {
  const left = collisionKey(root, guide), right = collisionKey(root, target);
  if (root) {
    try {
      const a = info(resolve(root, guide)), b = info(resolve(root, target));
      if (a?.isFile() && b?.isFile() && a.dev === b.dev && a.ino === b.ino) return true;
    } catch (e) { if (!['ENOTDIR', 'ELOOP'].includes(e.code)) throw e; }
  }
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}
// Practice targets can be directories (including managed directory aliases).
// Collision lookup is not validation of every practice's existing files: survey
// may preserve/localize unsupported targets. For collision comparison only,
// an existing target may leave and re-enter the repo; never authorize that as
// a guide path. Resolve its nearest existing ancestor before calling it unknown.
export function targetDestination(root, path) {
  try { return destination(root, path, true); }
  catch (e) {
    if (!(e instanceof GuidePathError) && !['ENOTDIR', 'ELOOP'].includes(e.code)) throw e;
    const base = realpathSync(root), suffix = [];
    let at = resolve(root, path);
    while (true) {
      try {
        const physical = resolve(realpathSync(at), ...suffix), rel = relative(base, physical);
        return rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) ? rel.split(sep).join('/') : null;
      } catch (err) {
        if (['ELOOP', 'ENOTDIR'].includes(err.code)) return null;
        if (err.code !== 'ENOENT' || dirname(at) === at) throw err;
        suffix.unshift(basename(at)); at = dirname(at);
      }
    }
  }
}
function destination(root, path, allowDirectory) {
  validateGuideName(path, root);
  const base = realpathSync(root);
  let parts = path.split('/'), at = base, links = 0;
  while (parts.length) {
    at = resolve(at, parts.shift());
    const rel = relative(base, at);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) bad(`${path} escapes the repository`);
    if (rel.split(sep).some(p => p === '.git' || p === '.keel')) bad(`${path} resolves to reserved repository metadata`);
    const s = info(at);
    if (s) {
      // realpath preserves input casing on some insensitive filesystems.
      // Use the stored directory entry so lock keys keep one spelling.
      const names = readdirSync(dirname(at)), name = basename(at);
      if (!names.includes(name)) at = resolve(dirname(at), names.find(n => n.toLowerCase() === name.toLowerCase()) ?? name);
    }
    // Recheck the spelling actually found, including aliases introduced by a
    // symlink. The pre-lookup lexical spelling is not the destination identity.
    validateGuideMetadata(relative(base, at).split(sep).join('/'), base);
    if (s?.isSymbolicLink()) {
      if (++links > 40) bad(`${path} has a cyclic or excessive symlink chain`);
      const target = readlinkSync(at).split(sep).join('/');
      if (target.split('/').some((p, i, a) => p === '..' && a.slice(0, i).some(q => q && q !== '..' && q !== '.'))) bad(`${path} has an unsafe symlink traversal`);
      if (!isAbsolute(target)) {
        let depth = relative(base, dirname(at)).split(sep).filter(Boolean).length;
        for (const component of target.split('/')) {
          if (component === '..') { if (--depth < 0) bad(`${path} leaves the repository before re-entering`); }
          else if (component && component !== '.') depth++;
        }
      }
      const next = resolve(dirname(at), target), r = relative(base, next);
      if ((!r && !parts.length) || r === '..' || r.startsWith(`..${sep}`) || isAbsolute(r)) bad(`${path} escapes the repository`);
      if (!allowDirectory && !info(next)) bad(`${path} has a dangling symlink`);
      parts = [...(r ? r.split(sep) : []), ...parts]; at = base;
    } else if (s && (parts.length ? !s.isDirectory() : !(s.isFile() || (allowDirectory && s.isDirectory())))) bad(`${path} is not a regular file path`);
  }
  return relative(base, at).split(sep).join('/');
}
// Derive guide ownership from shipped manifests, not every lock key with '#'.
export function guideBlock(key, row) {
  if (!key.includes('#') || !/^[a-z0-9-]+$/.test(row?.practice ?? '')) return false;
  let spec;
  try { spec = JSON.parse(readFileSync(new URL(`../practices/${row.practice}/practice.json`, import.meta.url), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
  return spec.files.some(f => f.path === 'AGENTS.md' && f.kind === 'block' && f.block === key.split('#')[1]);
}
export function guideFacts(root, config = {}) {
  let lock = null;
  try { lock = JSON.parse(readFileSync(resolve(root, '.keel/lock.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const canonicalLocks = new Map();
  for (const [key, row] of Object.entries(lock?.files ?? {})) {
    const [source, block] = key.split('#');
    const canonical = guideBlock(key, row) ? `${guideDestination(root, source)}#${block}` : key;
    const prior = canonicalLocks.get(canonical);
    if (prior && (prior.sha256 !== row.sha256 || prior.practice !== row.practice)) bad(`conflicting guide locks: ${canonical}`);
    canonicalLocks.set(canonical, row);
  }
  const locked = Object.entries(lock?.files ?? {}).filter(([k, row]) => guideBlock(k, row)).map(([k]) => k.split('#')[0]);
  const selected = config.guide !== undefined ? config.guide : locked[0] ?? (info(resolve(root, 'AGENTS.md')) ? 'AGENTS.md' : info(resolve(root, 'CLAUDE.md')) ? 'CLAUDE.md' : 'AGENTS.md');
  const path = guideDestination(root, selected);
  if (lock?.files?.[path]) bad(`${selected} collides with a locked whole-file target`);
  for (const old of locked) if (guideDestination(root, old) !== path) bad(`locked blocks belong to ${old}; refusing to move them to ${selected}`);
  const claude = info(resolve(root, 'CLAUDE.md'));
  if (claude?.isSymbolicLink() && lock?.files?.['CLAUDE.md']) bad('locked CLAUDE.md doorway was replaced by a symlink; reconcile its whole-file lock before rendering');
  // Existing managed doorways retain their lock and drift checks. An unowned
  // CLAUDE.md (including an alias) is the project's, never replaced.
  const pointer = claude?.isFile() && readFileSync(resolve(root, 'CLAUDE.md'), 'utf8') === readFileSync(new URL('../practices/agents-md/files/CLAUDE.md', import.meta.url), 'utf8').replaceAll('{{guide}}', path);
  const doorway = path !== 'CLAUDE.md' && !claude?.isSymbolicLink() && (!!lock?.files?.['CLAUDE.md'] || pointer || (!claude && selected === 'AGENTS.md'));
  const aliases = new Map();
  for (const k of config.ejected ?? []) if (typeof k === 'string' && k.includes('#')) {
    const [p, id] = k.split('#'); aliases.set(k, `${guideDestination(root, p)}#${id}`);
  }
  return { root, path, selected, doorway, aliases };
}
export const guidePath = config => config?.[GUIDE]?.path ?? config?.guide ?? 'AGENTS.md';
export const guideKey = (config, key) => config?.[GUIDE]?.aliases.get(key) ?? key;
