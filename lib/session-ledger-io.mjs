// Shared session ledger primitives; schema-specific replay remains with each reader.
import { constants } from 'node:fs';
import { lstat, open, rename, unlink, mkdir, rmdir }  from 'node:fs/promises';
import { join, resolve, parse, sep } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { hostname } from 'node:os';
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

export async function ledgerLock(home, options = {}) {
  if (options.harness) return harnessLock(home, options);
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

// Harness-only lock mutation fence. An interrupted fence is deliberately not
// reclaimed: no recursive stale-lock algorithm or age-based ownership inference.
const lockHash = bytes => createHash('sha256').update(bytes).digest('hex');
async function lockFence(home, operation) {
  const path = join(home, '.harness-lock-guard');
  await mkdir(path, { mode: 0o700 });
  const identity = await lstat(path);
  try { return await operation(); }
  finally {
    const current = await lstat(path);
    check(current.dev === identity.dev && current.ino === identity.ino, 'lock fence replaced');
    await rmdir(path);
  }
}
async function syncLockHome(home) {
  const f = await open(home, constants.O_RDONLY);
  try { await f.sync(); } finally { await f.close(); }
}
export async function inspectHarnessLock(home) {
  const path = join(home, '.lock');
  let file;
  try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  try {
    const stat = await file.stat();
    check(stat.isFile() && stat.nlink === 1 && stat.size <= 4096 && stat.uid === process.getuid?.() && !(stat.mode & 0o077), 'unsafe lock');
    const bytes = await file.readFile();
    let owner;
    try { owner = JSON.parse(bytes); } catch { return { status: 'blocked', reason: 'legacy-or-partial-lock' }; }
    if (owner.schema !== 1 || owner.kind !== 'harness-lock' || owner.host !== hostname() || owner.uid !== process.getuid?.()
      || !Number.isSafeInteger(owner.pid) || owner.pid < 1 || !/^[a-f0-9-]{36}$/.test(owner.id)) return { status: 'blocked', reason: 'unverifiable-lock-owner' };
    let dead = false;
    try { process.kill(owner.pid, 0); } catch (e) { dead = e.code === 'ESRCH'; }
    return { status: dead ? 'recoverable' : 'active-or-unverifiable', owner, identity: { dev: stat.dev, ino: stat.ino, digest: lockHash(bytes) } };
  } finally { await file.close(); }
}
async function harnessLock(home, { recover } = {}) {
  let acquired;
  await lockFence(home, async () => {
    const existing = await inspectHarnessLock(home);
    if (recover) {
      check(existing?.status === 'recoverable' && JSON.stringify(existing) === JSON.stringify(recover), 'original lock changed or writer death unverified');
      // Every harness acquisition/release/recovery holds the same fence. Legacy
      // writers use O_EXCL and cannot replace an extant lock. Archive before
      // reopening admission; a crash here strands the fence, never loses bytes.
      check(!await safePath(join(home, '.harness-recovered-' + existing.owner.id), false), 'recovery archive already exists');
      await rename(join(home, '.lock'), join(home, '.harness-recovered-' + existing.owner.id));
      await syncLockHome(home);
    } else check(!existing, 'storage locked; explicit recovery required');
    const owner = { schema: 1, kind: 'harness-lock', id: randomUUID(), host: hostname(), uid: process.getuid?.(), pid: process.pid, createdAt: new Date().toISOString() };
    const file = await open(join(home, '.lock'), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(JSON.stringify(owner)); await file.sync(); } finally { await file.close(); }
    await syncLockHome(home);
    acquired = await inspectHarnessLock(home);
    check(acquired?.owner?.id === owner.id, 'lock ownership changed');
  });
  return async () => lockFence(home, async () => {
    const current = await inspectHarnessLock(home);
    check(current?.owner?.id === acquired.owner.id && JSON.stringify(current.identity) === JSON.stringify(acquired.identity), 'lock ownership changed');
    await unlink(join(home, '.lock')); await syncLockHome(home);
  });
}
