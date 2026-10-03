// .keel/lock.json: what keel wrote, so a later difference can be told apart
// from keel moving on (design §1; lesson 7, store a copy of a fact).
//
//   { "practice": "<version>",
//     "files": { "<path>" | "<path>#<block>": { "practice": "<name>", "sha256": "<hex>" } } }
//
// The sha is of the bytes keel wrote for that target: a managed file's whole
// text, a block's inside (blocks are hashed one by one, so a project's own lines
// around them never count), a symlink's target string. Seeded files are the
// project's and are never locked. Keys are sorted and nothing time-dependent is
// stored, so a render that changes nothing leaves the lock byte-identical.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export const LOCK = '.keel/lock.json';

export const sha256 = text => createHash('sha256').update(text).digest('hex');
export const lockKey = e => e.block ? `${e.path}#${e.block}` : e.path;

/**
 * Drift of one target from the project's bytes now (null if absent), the sha
 * keel wrote, and keel's template today:
 *   clean   now = lock = template, or the project already took the template
 *   behind  now = lock ≠ template   keel moved on (update's job)
 *   edited  now ≠ lock = template   the project changed it
 *   both    now ≠ lock ≠ template
 */
export function driftState(now, locked, template) {
  const n = now === null || now === undefined ? null : sha256(now), t = sha256(template);
  if (n === locked) return locked === t ? 'clean' : 'behind';
  if (n === t) return 'clean';
  return locked === t ? 'edited' : 'both';
}

/** The project's lock, or null when it has none. */
export async function readLock(root) {
  const text = await readFile(join(root, LOCK), 'utf8').catch(e => e.code === 'ENOENT' ? null : Promise.reject(e));
  if (text === null) return null;
  const lock = JSON.parse(text);
  if (!lock || typeof lock.files !== 'object') throw new Error(`${LOCK}: needs "files"`);
  return lock;
}

export const formatLock = lock => {
  const files = Object.fromEntries(Object.keys(lock.files).sort().map(k => [k, { practice: lock.files[k].practice, sha256: lock.files[k].sha256 }]));
  return `${JSON.stringify({ practice: lock.practice, files }, null, 2)}\n`;
};

/** Write the lock if its bytes would change. Returns true when it wrote. */
export async function writeLock(root, lock) {
  const text = formatLock(lock);
  const path = join(root, LOCK);
  if ((await readFile(path, 'utf8').catch(() => null)) === text) return false;
  await mkdir(join(root, '.keel'), { recursive: true });
  await writeFile(path, text);
  return true;
}
