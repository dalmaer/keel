// Bounded regular-file exports and artifact envelopes. No archive is extracted on the host.
import { spawnSync } from 'node:child_process';
import { checkEvaluation as check, relativeFile, fields, fingerprint } from './evaluation-records.mjs';
export const ARTIFACT_BYTES = 256 * 1024;
export const FILE_LIMIT = 128;
export function filePath(path) {
  relativeFile(path);
  check(Buffer.byteLength(path) <= 100 && !path.startsWith('-'), 'unsupported artifact path');
}
export function validateFiles(files) {
  check(Array.isArray(files) && files.length <= FILE_LIMIT, 'artifact file count exceeded');
  let bytes = 0; const paths = new Set();
  for (const file of files) {
    fields(file, ['path', 'mode', 'base64']); filePath(file.path);
    check(!paths.has(file.path) && ['100644', '100755'].includes(file.mode), 'duplicate or nonregular artifact');
    check(typeof file.base64 === 'string' && Buffer.from(file.base64, 'base64').toString('base64') === file.base64, 'invalid file encoding');
    bytes += Buffer.byteLength(file.base64, 'base64'); paths.add(file.path);
  }
  check(bytes <= ARTIFACT_BYTES, 'artifact byte limit exceeded');
  for (const path of paths) check(![...paths].some(other => other.startsWith(path + '/')), 'file/directory collision');
  return [...files].sort((a, b) => a.path.localeCompare(b.path, 'en'));
}
export function exportSource(repository, revision, paths) {
  check(Array.isArray(paths) && paths.length > 0 && paths.length <= FILE_LIMIT && new Set(paths).size === paths.length, 'sourcePaths required and unique');
  const env = { PATH: process.env.PATH, HOME: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1' };
  const git = args => {
    const r = spawnSync('/usr/bin/git', ['--no-pager', '-c', 'core.fsmonitor=false', '-C', repository, ...args], { env, timeout: 10000, maxBuffer: ARTIFACT_BYTES + 1 });
    check(!r.error && r.status === 0, 'source export unavailable or oversized'); return r.stdout;
  };
  const files = paths.map(path => {
    filePath(path);
    const entry = git(['ls-tree', '-z', revision, '--', `:(literal)${path}`]).toString();
    const match = /^(100644|100755) blob ([a-f0-9]{40,64})\t([^\0]+)\0$/.exec(entry);
    check(match && match[3] === path, 'source must be an exact regular Git blob');
    return { path, mode: match[1], base64: git(['cat-file', 'blob', match[2]]).toString('base64') };
  });
  return validateFiles(files);
}
export function validateArtifact(before, after, allowlist, protectedPaths = []) {
  const original = new Map(validateFiles(before).map(f => [f.path, f]));
  const result = validateFiles(after), submitted = new Map(result.map(f => [f.path, f]));
  for (const path of new Set([...original.keys(), ...submitted.keys()])) {
    if (fingerprint(original.get(path) ?? null) !== fingerprint(submitted.get(path) ?? null))
      check(allowlist.includes(path) && !protectedPaths.includes(path), `artifact change outside allowlist: ${path}`);
  }
  return result;
}
// Submission is a patch-like list of regular-file replacements, not a disk snapshot.
export function submittedArtifact(stdout, before, allowlist, protectedPaths) {
  check(typeof stdout === 'string' && Buffer.byteLength(stdout) <= 384 * 1024, 'submission output exceeds bound');
  let envelope; try { envelope = JSON.parse(stdout); } catch { check(false, 'invalid artifact JSON submission'); }
  fields(envelope, ['schemaVersion', 'files']); check(envelope.schemaVersion === 1, 'unsupported artifact schema');
  const submitted = validateFiles(envelope.files), reconstructed = new Map(before.map(f => [f.path, f]));
  for (const f of submitted) reconstructed.set(f.path, f);
  return validateArtifact(before, [...reconstructed.values()], allowlist, protectedPaths);
}
