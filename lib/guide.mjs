// One guide destination for rendering, drift, and adoption. Never follow a link
// outside the repository, even if a later link would bring it back inside.
import { lstatSync, readlinkSync, realpathSync, readFileSync } from 'node:fs';
import { resolve, relative, dirname, isAbsolute, sep } from 'node:path';
export const GUIDE = Symbol.for('keel.guide');
const bad = message => { throw new Error(`guide: ${message}`); };
const info = p => { try { return lstatSync(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
export function validateGuideName(path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || /[\\#\x00-\x1f]/.test(path)
      || path.split('/').some(p => !p || p === '.' || p === '..')) bad('must be a repository-relative file path without traversal');
  if (path.split('/').some(p => p === '.git' || p === '.keel')) bad(`${path} is reserved repository metadata`);
}
export function guideDestination(root, path) {
  validateGuideName(path);
  const base = realpathSync(root);
  let parts = path.split('/'), at = base, links = 0;
  while (parts.length) {
    at = resolve(at, parts.shift());
    const rel = relative(base, at);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) bad(`${path} escapes the repository`);
    if (rel.split(sep).some(p => p === '.git' || p === '.keel')) bad(`${path} resolves to reserved repository metadata`);
    const s = info(at);
    if (s?.isSymbolicLink()) {
      if (++links > 40) bad(`${path} has a cyclic or excessive symlink chain`);
      const target = readlinkSync(at);
      if (target.split('/').some((p, i, a) => p === '..' && a.slice(0, i).some(q => q && q !== '..' && q !== '.'))) bad(`${path} has an unsafe symlink traversal`);
      const next = resolve(dirname(at), target), r = relative(base, next);
      if (!r || r === '..' || r.startsWith(`..${sep}`) || isAbsolute(r)) bad(`${path} escapes the repository`);
      if (!info(next)) bad(`${path} has a dangling symlink`);
      parts = [...r.split(sep), ...parts]; at = base;
    } else if (s && (parts.length ? !s.isDirectory() : !s.isFile())) bad(`${path} is not a regular file path`);
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
  return { path, selected, doorway, aliases };
}
export const guidePath = config => config?.[GUIDE]?.path ?? config?.guide ?? 'AGENTS.md';
export const guideKey = (config, key) => config?.[GUIDE]?.aliases.get(key) ?? key;
