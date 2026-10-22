// Shared trusted transformation stage. Project commands and publication belong to callers.
import { readFile, writeFile, mkdir, rm, lstat, readlink, symlink, chmod, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { load as loadPractices, render, config as readConfig, plan as planRender, blockBody } from './practices.mjs';
import { readLock, lockKey, LOCK } from './lock.mjs';
import { diagnoseDrift } from './doctor.mjs';
import { collect, compareVersions, taken } from './migrations.mjs';
import { run as roadmap } from '../practices/phases/files/scripts/roadmap.mjs';
const CONFIG = '.plates/plates.json';
const ROADMAP = 'docs/ROADMAP.md';

export class UpdateError extends Error {
  constructor(message, exitCode = 1, extra = {}) { super(message); this.exitCode = exitCode; Object.assign(this, extra); }
}

class Journal {
  constructor(root) { this.root = root; this.saved = new Map(); this.dirs = new Set(); }
  async record(rel) {
    if (this.saved.has(rel)) return;
    const abs = join(this.root, rel);
    const i = await lstat(abs).catch(() => null);
    if (!i) this.saved.set(rel, null);
    else if (i.isSymbolicLink()) this.saved.set(rel, { link: await readlink(abs) });
    else if (i.isFile()) this.saved.set(rel, { bytes: await readFile(abs), mode: i.mode & 0o7777 });
    else throw new UpdateError(`${rel} is a directory where update would write a file; refusing`);
    for (let d = dirname(rel); d !== '.' && d !== '/'; d = dirname(d)) {
      if (await lstat(join(this.root, d)).catch(() => null)) break;
      this.dirs.add(d);
    }
  }
  async restore() {
    for (const [rel, s] of this.saved) {
      const abs = join(this.root, rel);
      await rm(abs, { force: true, recursive: true });
      if (!s) continue;
      await mkdir(dirname(abs), { recursive: true });
      if (s.link !== undefined) await symlink(s.link, abs);
      else { await writeFile(abs, s.bytes); await chmod(abs, s.mode); }
    }
    for (const d of [...this.dirs].sort((a, b) => b.split('/').length - a.split('/').length)) {
      await rmdir(join(this.root, d)).catch(() => {}); // only if empty: something else may live there now
    }
  }
}

export async function prepareUpdate(root, { version, practices, migrations, notes = [] }) {
  const cfg = await readConfig(root);
  if (cfg.plates === 'self') throw new UpdateError('Plates itself is not an update target', 2);
  const from = cfg.practice ?? '0.0.0';
  if (compareVersions(from, version) > 0) throw new UpdateError('Update target is older than the project practice', 2);
  migrations = migrations.filter(m => !m.to || compareVersions(m.to, version) <= 0);
  const done = taken(cfg);
  //    Doctor first: update never overwrites what the project changed.
  practices ??= await loadPractices();
  const report = await diagnoseDrift(root, { practices });
  const changed = report.drift.filter(d => d.state === 'edited' || d.state === 'both');
  if (changed.length) {
    throw new UpdateError(`the project changed plates's ${changed.map(d => `${d.path} (${d.state})`).join(', ')}; update never overwrites that. See plates doctor, then plates doctor --fix <path> restore|eject, or send it home with plates lessons; then plates update again`, 1, { changed: changed.map(d => d.path) });
  }

  // 4. Every migration's edits, in memory; nothing written if one fails.
  const { applied, edits } = await collect(root, migrations, { done });

  // 5–6. Write, re-render, bump, check; put everything back on a failure.
  const journal = new Journal(root);
  const check = cfg.check ?? 'npm run check';
  let after, rendered = [];
  try {
    for (const [path, content] of edits) {
      await journal.record(path);
      const abs = join(root, path);
      if (content === null) await rm(abs, { force: true });
      else { await mkdir(dirname(abs), { recursive: true }); await writeFile(abs, content); }
    }
    after = await readConfig(root);
    const lock = await readLock(root);
    const planned = await planRender(root, after, practices, lock);
    // A target plates never wrote is the project's until the lock says otherwise.
    const unknown = [];
    for (const e of planned) {
      if (e.kind === 'seeded' || e.status !== 'update' || lock?.files?.[lockKey(e)]) continue;
      if (e.kind === 'block' && !(blockBody(await readFile(join(root, e.path), 'utf8'), e.block) ?? '').trim()) continue; // empty markers, just placed
      unknown.push(lockKey(e));
    }
    if (unknown.length) throw new UpdateError(`render would overwrite ${unknown.join(', ')}, which plates never wrote here; move the project's version aside or eject it (plates doctor --fix <path> eject), then plates update again`);
    for (const e of planned) if (e.status === 'create' || e.status === 'update') await journal.record(e.path);
    for (const path of [LOCK, CONFIG, ROADMAP]) await journal.record(path);
    const result = await render(root, { practices, version });
    rendered = result.entries.filter(e => e.status === 'create' || e.status === 'update').map(lockKey);
    const raw = JSON.parse(await readFile(join(root, CONFIG), 'utf8'));
    raw.practice = version;
    if (applied.length) raw.migrations = [...new Set([...taken(raw), ...applied.map(m => m.id)])].sort();
    await writeFile(join(root, CONFIG), `${JSON.stringify(raw, null, 2)}\n`);
    if (raw.practices?.includes('phases') && raw.phases?.source !== 'milestones') {
      try { await roadmap({ root, mode: 'write' }); } catch (e) { notes.push(`roadmap not regenerated: ${e.message}`); }
    }
    return { from, to: version, applied, rendered, after, check, notes, restore: () => journal.restore() };
  } catch (error) {
    await journal.restore();
    throw error;
  }
}
