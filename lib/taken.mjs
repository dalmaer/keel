// A change the project made that keel has since made too is not the
// project's change. Renovate bumps an action in a project's keel-night.yml on
// Monday; keel's own Renovate bumps the same action in the template, and keel
// releases it. The project's file then differs from what keel wrote (the lock)
// and from keel's template today, which reads as `both`, and update would
// refuse it forever. Laid over the template keel wrote, the project's edit
// gives exactly keel's template today: so the file is only `behind`, and
// taking keel's loses nothing.
//
// The template keel wrote is found by the lock's practice version, in keel's
// own tags, and must hash to the lock's sha256; where keel cannot tell (an npx
// install with no git history, no tag, a hash that does not match), the state
// stays `both`. Never guessed.
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './lock.mjs';
import { fill } from './practices.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const git = (args, root = KEEL) => {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
};

const tags = new Map();
/** The newest of keel's tags whose practices/VERSION is `version`, or null. */
export function tagFor(version, root = KEEL) {
  const key = `${root}\n${version}`;
  if (tags.has(key)) return tags.get(key);
  let found = null;
  for (const tag of (git(['tag', '-l', 'v*', '--sort=-v:refname'], root) ?? '').split('\n').filter(Boolean)) {
    if (git(['show', `${tag}:practices/VERSION`], root)?.trim() === version) { found = tag; break; }
  }
  tags.set(key, found);
  return found;
}

/**
 * Template text of one managed file entry `f` ({ practice, from }) as keel
 * shipped it at practice `version`, or null. KEEL_PREVIOUS_PRACTICES names a
 * directory standing in for that tag's tree (tests).
 */
export function templateAt(version, f, env = process.env) {
  if (!f.from) return null;
  const rel = `practices/${f.practice}/files/${f.from}`;
  if (env.KEEL_PREVIOUS_PRACTICES) {
    try { return readFileSync(join(env.KEEL_PREVIOUS_PRACTICES, rel), 'utf8'); } catch { return null; }
  }
  const tag = tagFor(version);
  return tag ? git(['show', `${tag}:${rel}`]) : null;
}

/** True when merging `now` (from `base`) into `template` is clean and gives exactly `template`. */
export async function subsumed(now, base, template) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-taken-'));
  try {
    const [ours, b, theirs] = ['ours', 'base', 'theirs'].map(n => join(dir, n));
    await Promise.all([writeFile(ours, now), writeFile(b, base), writeFile(theirs, template)]);
    const r = spawnSync('git', ['merge-file', '-p', '-q', ours, b, theirs], { encoding: 'utf8' });
    return r.status === 0 && r.stdout === template;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * The drift state, with `both` settled to `behind` when the project's change
 * is already keel's. Only whole managed files: a block or a link stays as it is.
 */
export async function settle(state, { now, locked, f, config, template, version, env = process.env }) {
  if (state !== 'both' || now === null || now === undefined || !version || f.kind !== 'managed' || f.link !== undefined) return state;
  const old = templateAt(version, f, env);
  if (old === null) return state;
  const base = fill(old, config, f.path);
  if (sha256(base) !== locked) return state;
  return await subsumed(now, base, template) ? 'behind' : state;
}
