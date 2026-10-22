import { lstat, readdir, readFile, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { updatePath, safeUpdateLink } from '../update-artifact.mjs';

export const blobOf = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
export async function scanUpdateTree(root, { maxBytes = 512 * 1024 * 1024, maxFiles = 100000 } = {}) {
  const result = new Map();
  let size = 0, entries = 0;
  async function visit(dir, prefix = '') {
    for (const name of (await readdir(dir)).sort()) {
      if (++entries > maxFiles) throw new Error('update_source_limit');
      const path = prefix ? `${prefix}/${name}` : name;
      if (!updatePath(path)) throw new Error('unsupported_update_path');
      const absolute = join(dir, name), stat = await lstat(absolute);
      if (stat.isDirectory()) { await visit(absolute, path); continue; }
      if (result.size >= maxFiles) throw new Error('update_source_limit');
      let bytes, mode;
      if (stat.isSymbolicLink()) {
        const target = await readlink(absolute);
        if (!safeUpdateLink(path, target)) throw new Error('unsafe_update_symlink');
        bytes = Buffer.from(target); mode = '120000';
      } else if (stat.isFile() && stat.nlink === 1) {
        if (stat.size > 32 * 1024 * 1024 || size + stat.size > maxBytes) throw new Error('update_source_limit');
        bytes = await readFile(absolute); mode = stat.mode & 0o111 ? '100755' : '100644';
      } else throw new Error('unsupported_update_file');
      size += bytes.length;
      if (size > maxBytes) throw new Error('update_source_limit');
      result.set(path, { mode, blob: blobOf(bytes), bytes });
    }
  }
  await visit(root);
  return result;
}
export function assertUpdateTree(expected, actual) {
  for (const [path, entry] of expected) {
    const now = actual.get(path);
    if (entry === null) {
      if (now !== undefined) throw new Error('project_command_restored_deleted_path');
      continue;
    }
    if (!now || entry.mode !== now.mode || entry.blob !== now.blob) throw new Error('project_command_changed_tracked_tree');
  }
}
/** Baseline contains only original tracked files; candidates names newly managed/migrated paths. */
export function freezeUpdatePatch(before, after, candidates = []) {
  const paths = [...new Set([...before.keys(), ...candidates])].sort();
  const files = [];
  let size = 0;
  for (const path of paths) {
    if (!updatePath(path)) throw new Error('unsupported_update_path');
    const old = before.get(path), next = after.get(path);
    if (old?.mode === next?.mode && old?.blob === next?.blob) continue;
    if (next) {
      if (next.bytes.length > 262144) throw new Error('update_patch_limit');
      size += next.bytes.length;
    }
    files.push({ path, before: old ? { mode: old.mode, blob: old.blob } : null,
      after: next ? { mode: next.mode, content: next.bytes.toString('base64') } : null });
  }
  if (files.length > 200 || size > 1048576) throw new Error('update_patch_limit');
  return structuredClone(files);
}
