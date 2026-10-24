// Shared session ledger primitives; schema-specific replay remains with each reader.
import { constants } from 'node:fs';
import { lstat, open, rename, unlink } from 'node:fs/promises';
import { join, resolve, parse, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
const STATE_LIMIT = 4 * 1024 * 1024;
const check = (ok, message) => { if (!ok) fail(message); };
const fail = message => { throw Object.assign(new Error(`session trials: ${message}`), { exitCode: 2 }); };
// Roots and explicit input paths are canonicalized first; managed storage rejects
// symlinks in every component. Read handles
// use O_NOFOLLOW and bounded reads; lock contention never triggers stale reclaim.
export async function safePath(path, directory = true) {
  const full = resolve(path), base = parse(full).root;
  let current = base;
  for (const part of full.slice(base.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    let stat;
    try { stat = await lstat(current); } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
    check(!stat.isSymbolicLink() && (current === full && !directory ? stat.isFile() : stat.isDirectory()), 'unsafe storage path');
  }
  return true;
}
export async function readJson(path, limit) {
  await safePath(path, false);
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    check(stat.isFile() && stat.size <= limit, 'record exceeds size bound');
    const buf = Buffer.alloc(limit + 1);
    let bytesRead = 0;
    while (bytesRead < buf.length) {
      const chunk = await handle.read(buf, bytesRead, buf.length - bytesRead, bytesRead);
      if (!chunk.bytesRead) break;
      bytesRead += chunk.bytesRead;
    }
    check(bytesRead <= limit, 'record exceeds size bound');
    try { return JSON.parse(buf.subarray(0, bytesRead).toString('utf8')); } catch { fail('invalid JSON record'); }
  } finally { await handle?.close(); }
}
export async function store(path, ledger) {
  const data = JSON.stringify(ledger, null, 2) + '\n';
  check(Buffer.byteLength(data) <= STATE_LIMIT, 'ledger exceeds size bound');
  const temp = `${path}.${randomUUID()}.pending`;
  const handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
  // A failed/uncertain replacement retains its pending file for owner inspection.
  await rename(temp, path);
  const directory = await open(resolve(path, '..'), constants.O_RDONLY);
  try { await directory.sync(); } finally { await directory.close(); }
}

export async function ledgerLock(home) {
  let lock;
  try { lock = await open(join(home, '.lock'), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); }
  catch (e) { if (e.code === 'EEXIST' || e.code === 'ELOOP') fail('storage locked; inspect interrupted write; no automatic reclaim'); throw e; }
  return async () => { await lock.close(); await unlink(join(home, '.lock')); };
}

// Immutable publication. Partial writes remain evidence of uncertainty and are
// never overwritten by a retry.
export async function storeImmutable(path, record) {
  const data = JSON.stringify(record) + '\n';
  check(Buffer.byteLength(data) <= STATE_LIMIT, 'immutable record exceeds size bound');
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(data); await handle.chmod(0o400); await handle.sync(); } finally { await handle.close(); }
  const directory = await open(resolve(path, '..'), constants.O_RDONLY);
  try { await directory.sync(); } finally { await directory.close(); }
}
