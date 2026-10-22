import { createHash } from 'node:crypto';
import { posix } from 'node:path';

const record = v => v && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys) => record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const hex = (v, n) => typeof v === 'string' && new RegExp(`^[a-f0-9]{${n}}$`).test(v);
const positive = v => Number.isSafeInteger(v) && v > 0;
const text = (v, n = 8192) => typeof v === 'string' && Buffer.byteLength(v) <= n;
const fail = () => { throw new Error('invalid_update_output'); };
export const updatePath = v => text(v, 1024) && v.length > 0 && !v.includes('\\') && !/[\x00-\x1f\x7f]/.test(v)
  && !posix.isAbsolute(v) && v === posix.normalize(v) && v !== '.'
  && v.split('/').every(p => p !== '..' && p.toLowerCase() !== '.git');
export function safeUpdateLink(path, value) {
  if (!text(value, 4096) || !value || value.includes('\\') || /[\x00-\x1f\x7f]/.test(value) || posix.isAbsolute(value)) return false;
  return updatePath(posix.normalize(posix.join(posix.dirname(path), value)));
}
export function validateUpdateTarget(v) {
  if (!exact(v, ['repoId', 'repositoryNodeId', 'repo', 'commit', 'cliVersion', 'practiceVersion', 'bundleDigest'])
    || !positive(v.repoId) || !text(v.repositoryNodeId, 200) || !v.repositoryNodeId
    || typeof v.repo !== 'string' || !/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(v.repo)
    || !hex(v.commit, 40) || !hex(v.bundleDigest, 64)
    || ![v.cliVersion, v.practiceVersion].every(s => typeof s === 'string' && /^\d+\.\d+\.\d+$/.test(s))) fail();
  return v;
}
const mode = v => ['100644', '100755', '120000'].includes(v);
const iso = v => text(v, 30) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
function check(v) {
  if (!exact(v, ['command', 'exit', 'signal', 'startedAt', 'completedAt', 'tail'])
    || !text(v.command, 8192) || !v.command.trim() || !text(v.tail)
    || !(v.exit === null || Number.isInteger(v.exit) && v.exit >= 0 && v.exit <= 255)
    || !(v.signal === null || typeof v.signal === 'string' && /^SIG[A-Z0-9]{1,12}$/.test(v.signal))
    || v.exit === null && v.signal === null || v.exit !== null && v.signal !== null
    || !iso(v.startedAt) || !iso(v.completedAt) || Date.parse(v.completedAt) < Date.parse(v.startedAt)) fail();
}

export function validateUpdateOutput(input) {
  if (!exact(input, ['schema', 'base', 'target', 'files', 'migrations', 'checks', 'coverage', 'cleanup'])
    || input.schema !== 1 || !exact(input.base, ['repoId', 'repositoryNodeId', 'commit'])
    || !positive(input.base.repoId) || !text(input.base.repositoryNodeId, 200) || !input.base.repositoryNodeId
    || !hex(input.base.commit, 40) || !Array.isArray(input.files) || input.files.length > 200
    || !Array.isArray(input.migrations) || input.migrations.length > 200
    || !exact(input.checks, ['setup', 'updated', 'base', 'baseSetup'])
    || !exact(input.coverage, ['complete', 'gaps']) || input.coverage.complete !== true
    || !Array.isArray(input.coverage.gaps) || input.coverage.gaps.length
    || !exact(input.cleanup, ['state', 'containerIds']) || input.cleanup.state !== 'verified'
    || !Array.isArray(input.cleanup.containerIds) || input.cleanup.containerIds.length < 1 || input.cleanup.containerIds.length > 3
    || input.cleanup.containerIds.some(id => !hex(id, 64))
    || new Set(input.cleanup.containerIds).size !== input.cleanup.containerIds.length) fail();
  validateUpdateTarget(input.target);
  let size = 0;
  const paths = new Set();
  for (const file of input.files) {
    if (!exact(file, ['path', 'before', 'after']) || !updatePath(file.path) || paths.has(file.path)
      || file.before === null && file.after === null) fail();
    paths.add(file.path);
    if (file.before !== null && (!exact(file.before, ['mode', 'blob']) || !mode(file.before.mode) || !hex(file.before.blob, 40))) fail();
    if (file.after !== null) {
      if (!exact(file.after, ['mode', 'content']) || !mode(file.after.mode) || typeof file.after.content !== 'string'
        || file.after.content.length > 350000) fail();
      const bytes = Buffer.from(file.after.content, 'base64');
      if (bytes.toString('base64') !== file.after.content || bytes.length > 262144) fail();
      size += bytes.length;
      const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      if (file.before?.mode === file.after.mode && file.before.blob === blob) fail();
      if (file.after.mode === '120000') {
        let value;
        try { value = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail(); }
        if (!safeUpdateLink(file.path, value)) fail();
      }
    }
  }
  const finalPaths = input.files.filter(file => file.after !== null).map(file => file.path);
  for (const path of finalPaths) if (finalPaths.some(other => other !== path && other.startsWith(`${path}/`))) fail();
  if (size > 1048576 || Buffer.byteLength(JSON.stringify(input)) > 2 * 1024 * 1024) fail();
  const migrations = new Set();
  for (const m of input.migrations) {
    if (!exact(m, ['id', 'summary', 'paths', 'notes']) || typeof m.id !== 'string'
      || !/^\d{4}-[a-z0-9-]+$/.test(m.id) || migrations.has(m.id) || !text(m.summary)
      || !Array.isArray(m.paths) || m.paths.length > 200 || m.paths.some(p => !updatePath(p))
      || !Array.isArray(m.notes) || m.notes.length > 100 || m.notes.some(n => !text(n))) fail();
    migrations.add(m.id);
  }
  if (input.checks.setup !== null) check(input.checks.setup);
  check(input.checks.updated);
  if (input.checks.base !== null) check(input.checks.base);
  if (input.checks.baseSetup !== null) check(input.checks.baseSetup);
  return structuredClone(input);
}
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  return record(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
}
export const patchDigest = output => createHash('sha256').update(JSON.stringify(canonical(validateUpdateOutput(output)))).digest('hex');
