// Local, read-only worktree observations. Removal is always owner advice.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, opendir, realpath } from 'node:fs/promises';
import { resolve, join, parse } from 'node:path';
import { performance } from 'node:perf_hooks';

const exec = promisify(execFile);
const DAY = 86_400_000;
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const DEFAULTS = { maxWorktrees: 100, maxEntries: 100_000, maxMs: 10_000, gitTimeoutMs: 2_000, maxOutputBytes: 1_048_576 };
const ci = env => ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'TF_BUILD', 'BUILDKITE'].some(key => env[key] && !/^(false|0)$/i.test(env[key]));

// Check every path component, including a registered worktree replaced by a
// symlink. realpath alone would silently authorize scanning the new target.
async function noSymlinkPath(path) {
  const absolute = resolve(path);
  let cursor = parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split('/').filter(Boolean)) {
    cursor = join(cursor, part);
    if ((await lstat(cursor)).isSymbolicLink()) throw new Error('symlink in worktree path');
  }
}

async function scan(path, budget) {
  let logicalBytes = 0;
  let latest = 0;
  const seen = new Set();
  async function walk(file, top = false) {
    budget.check();
    if (++budget.entries > budget.maxEntries) throw new Error('filesystem entry bound reached');
    const stat = await lstat(file);
    latest = Math.max(latest, stat.mtimeMs, stat.ctimeMs);
    if (stat.isSymbolicLink()) return; // Count neither the target nor its activity.
    if (stat.isFile()) {
      const id = `${stat.dev}:${stat.ino}`;
      if (!seen.has(id)) logicalBytes += stat.size;
      seen.add(id);
    } else if (stat.isDirectory()) {
      // Recheck immediately before opening; this is still an observation, not
      // an atomic filesystem snapshot or authorization for future cleanup.
      if ((await lstat(file)).isSymbolicLink()) throw new Error('directory changed to symlink');
      const dir = await opendir(file);
      for await (const entry of dir) {
        budget.check();
        if (top && entry.name === '.git') continue; // shared Git storage is not held by this tree
        await walk(join(file, entry.name));
      }
    } else throw new Error('unsupported filesystem entry');
  }
  await noSymlinkPath(path);
  await walk(path, true);
  budget.check();
  return { logicalBytes, latest };
}

/** Ordinary improve instrument result; incomplete reads never become zero. */
export async function staleWorktrees({ root, env = process.env, now = new Date(), staleDays = 7, limits = {} } = {}) {
  const timestamp = new Date(now).getTime();
  const facts = { schema: 1, observedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
    staleDays, mainRef: null, mainCommit: null, complete: false, sizeKind: 'logical-bytes',
    activityBasis: 'latest HEAD commit timestamp and filesystem mtime/ctime, including ignored files; excludes Git administrative storage',
    advice: 'Owner-only: inspect again before running. Clean worktrees may contain ignored data. Logical bytes are not guaranteed reclaimable physical space. Local reachability is not PR acceptance.',
    worktrees: [], gaps: [] };
  const unavailable = reason => ({ na: reason, facts });
  if (ci(env)) return unavailable('stale_worktrees is local-machine only (n/a in CI)');
  if (!Number.isFinite(timestamp) || !Number.isFinite(staleDays) || staleDays <= 0) return unavailable('invalid worktree age or observation time');
  const bounds = { ...DEFAULTS, ...limits };
  if (Object.values(bounds).some(value => !Number.isSafeInteger(value) || value <= 0)) return unavailable('invalid worktree audit bounds');
  const deadline = performance.now() + bounds.maxMs;
  const budget = { entries: 0, maxEntries: bounds.maxEntries, check() {
    if (performance.now() >= deadline) throw new Error('worktree audit time bound reached');
  } };
  async function git(cwd, args) {
    budget.check();
    const result = await exec(env.KEEL_GIT || 'git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', cwd, ...args], {
      env: { ...env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }, encoding: 'utf8',
      timeout: Math.max(1, Math.min(bounds.gitTimeoutMs, Math.floor(deadline - performance.now()))), maxBuffer: bounds.maxOutputBytes,
    });
    budget.check();
    return result.stdout;
  }
  let current;
  let records;
  try {
    current = await realpath((await git(root, ['rev-parse', '--show-toplevel'])).trim());
    const listing = await git(root, ['worktree', 'list', '--porcelain', '-z']);
    records = listing.split('\0\0').filter(Boolean).map(block => Object.fromEntries(block.split('\0').filter(Boolean).map(line => {
      const split = line.indexOf(' ');
      return split < 0 ? [line, true] : [line.slice(0, split), line.slice(split + 1)];
    })));
    if (!records.length || records.some(record => typeof record.worktree !== 'string')) throw new Error('invalid worktree listing');
    if (records.length > bounds.maxWorktrees) throw new Error('worktree output count bound reached');
    for (const ref of ['refs/heads/main', 'refs/remotes/origin/main']) {
      try {
        const hash = (await git(root, ['rev-parse', '--verify', `${ref}^{commit}`])).trim();
        if (!/^[a-f0-9]{40,64}$/.test(hash)) throw new Error('invalid main commit');
        facts.mainRef = ref; facts.mainCommit = hash; break;
      } catch { /* An absent main remains unknown, never merged. */ }
    }
    if (!facts.mainCommit) facts.gaps.push('main commit unavailable; merge reachability unknown');
  } catch (error) {
    facts.gaps.push(error.message.slice(0, 300));
    return unavailable('worktree listing unavailable or incomplete');
  }
  for (const [index, record] of records.entries()) {
    const item = { path: record.worktree, branch: record.branch || null, head: record.HEAD || null,
      primary: index === 0, current: false, locked: Object.hasOwn(record, 'locked'), dirty: null, merged: null,
      lastActivityAt: null, logicalBytes: null, complete: false, stale: null, reasons: [], protectedReasons: [], command: null };
    facts.worktrees.push(item);
    try {
      await noSymlinkPath(item.path);
      item.current = (await realpath(item.path)) === current;
      if (item.primary) item.protectedReasons.push('primary');
      if (item.current) item.protectedReasons.push('current');
      if (item.locked) item.protectedReasons.push('locked');
      if (record.bare || record.prunable) throw new Error('bare or prunable worktree');
      item.dirty = (await git(item.path, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'])).length > 0;
      if (item.dirty) item.protectedReasons.push('dirty');
      const head = (await git(item.path, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
      if (head !== item.head) throw new Error('worktree HEAD changed during audit');
      const committed = Number((await git(item.path, ['show', '-s', '--format=%ct', head])).trim()) * 1000;
      if (!Number.isFinite(committed) || committed <= 0) throw new Error('HEAD timestamp unavailable');
      if (facts.mainCommit) {
        try { await git(root, ['merge-base', '--is-ancestor', head, facts.mainCommit]); item.merged = true; }
        catch (error) { if (error.code === 1) item.merged = false; else throw error; }
      }
      const size = await scan(item.path, budget);
      item.logicalBytes = size.logicalBytes;
      item.lastActivityAt = new Date(Math.max(committed, size.latest)).toISOString();
      if (item.merged) item.reasons.push('merged-into-main');
      if (timestamp - Math.max(committed, size.latest) >= staleDays * DAY) item.reasons.push('inactive');
      item.stale = item.reasons.length > 0;
      item.complete = item.merged !== null;
      if (!item.complete) item.protectedReasons.push('unknown');
      if (item.complete && item.stale && !item.protectedReasons.length) {
        item.command = `git -C ${quote(current)} worktree remove -- ${quote(item.path)}`;
      }
    } catch (error) {
      item.protectedReasons.push('unknown');
      item.logicalBytes = null;
      facts.gaps.push(`${item.path}: ${error.message.slice(0, 300)}`);
    }
  }
  facts.complete = !facts.gaps.length && facts.worktrees.every(item => item.complete);
  if (!facts.complete) return unavailable('worktree audit incomplete; unknown observations are protected');
  const candidates = facts.worktrees.filter(item => item.command);
  return { value: candidates.length, detail: `${candidates.length} stale worktrees eligible for owner review; ${candidates.reduce((sum, item) => sum + item.logicalBytes, 0)} logical bytes (not physical reclaimable space)`, facts };
}
