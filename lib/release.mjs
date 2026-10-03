// keel release: cut a practice version of keel itself (design §3).
//
// The practice version is package.json's `version`, released as the git tag
// v<version>. A release prepends a WHATSNEW.md entry written for the person
// whose project `keel update` brings to it (the notes, required), bumps
// package.json and keel's own practice (.keel/keel.json and the lock, since
// keel runs on what it ships), commits `release v<version>` and tags it
// locally. It never pushes; it prints the push command.
//
// Bare `keel release` reports the current version, whether it is tagged, and
// the newest entry. `--dry-run` shows the entry and the plan and writes nothing.
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { parseVersion, compareVersions } from './migrations.mjs';
import { readLock, writeLock } from './lock.mjs';

export const WHATSNEW = 'WHATSNEW.md';
export const WHATSNEW_HEADER = `# What's new in keel

Each entry is for the person whose project \`keel update\` brings to that
practice version: what changes in your repo, and anything you need to do.
Newest first. \`keel release\` writes them; \`keel update\` puts the entries
between your version and the new one into its pull request.
`;

class ReleaseError extends Error {
  constructor(message, exitCode = 2) { super(message); this.exitCode = exitCode; }
}

const read = path => readFile(path, 'utf8').catch(e => e.code === 'ENOENT' ? null : Promise.reject(e));
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const ENTRY = /^## v(\d+\.\d+\.\d+)\b.*$/gm;

/** WHATSNEW's entries: [{version, heading, body}], newest first as written. */
export function entries(text) {
  const marks = [...(text ?? '').matchAll(ENTRY)];
  return marks.map((m, i) => ({
    version: m[1], heading: m[0],
    body: text.slice(m.index + m[0].length, marks[i + 1]?.index ?? text.length).trim(),
  }));
}

/** The entries a project on `from` receives on its way to `to`: from < v ≤ to, newest first. */
export const between = (text, from, to) =>
  entries(text).filter(e => compareVersions(e.version, from) > 0 && compareVersions(e.version, to) <= 0);

/** WHATSNEW.md with the entry for `version` added above the newest one. */
export function prepend(text, version, notes, date = today()) {
  const entry = `## v${version} — ${date}\n\n${notes.trim()}\n`;
  const base = text ?? WHATSNEW_HEADER;
  const at = base.search(/^## v\d/m);
  if (at < 0) return `${base.replace(/\n*$/, '\n')}\n${entry}`;
  return `${base.slice(0, at)}${entry}\n${base.slice(at)}`;
}

function git(root, args, env) {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
  } catch (error) {
    throw new ReleaseError(`git ${args.join(' ')} failed: ${String(error.stderr || error.message).trim().split('\n')[0]}`, 1);
  }
}
const tagged = (root, tag, env) => {
  try { execFileSync('git', ['-C', root, 'rev-parse', '-q', '--verify', `refs/tags/${tag}`], { env, stdio: 'ignore' }); return true; } catch { return false; }
};

/**
 * opts: { root, version?, notes?, dryRun? }. deps: { env, date }.
 * Returns { data, text, exitCode? }.
 */
export async function release({ root, version, notes, dryRun = false }, { env = process.env, date = today() } = {}) {
  const configPath = join(root, '.keel', 'keel.json');
  const configText = await read(configPath) ?? '{}';
  const config = JSON.parse(configText);
  if (config.keel !== 'self') throw new ReleaseError('keel release runs only in keel itself (.keel/keel.json "keel": "self"); projects take a release with keel update');
  const pkgPath = join(root, 'package.json');
  const pkgText = await read(pkgPath);
  const current = JSON.parse(pkgText).version;
  const whatsnew = await read(join(root, WHATSNEW));

  if (version === undefined) {
    if (notes !== undefined || dryRun) throw new ReleaseError('keel release needs a version: keel release <x.y.z> --notes <file|->');
    const newest = entries(whatsnew)[0] ?? null;
    const isTagged = tagged(root, `v${current}`, env);
    return {
      data: { version: current, tag: `v${current}`, tagged: isTagged, newest },
      text: [`keel ${current} (${isTagged ? `tagged v${current}` : 'not tagged'})`,
        newest ? `Newest WHATSNEW entry: v${newest.version}` : 'WHATSNEW.md has no entries yet.',
        'Cut the next: keel release <x.y.z> --notes <file|-> [--dry-run]'].join('\n'),
    };
  }

  const next = String(version).replace(/^v/, '');
  if (!parseVersion(next)) throw new ReleaseError(`${version} is not a version (x.y.z)`);
  if (compareVersions(next, current) <= 0) throw new ReleaseError(`v${next} must be newer than the current version ${current}`);
  if (typeof notes !== 'string' || !notes.trim()) throw new ReleaseError('--notes is required and must not be empty: write what a project receiving this version gets, for the person reading its update PR');
  if (entries(whatsnew).some(e => e.version === next)) throw new ReleaseError(`${WHATSNEW} already has an entry for v${next}`);
  if (tagged(root, `v${next}`, env)) throw new ReleaseError(`tag v${next} already exists`);
  const dirty = git(root, ['status', '--porcelain'], env);
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'], env);

  const files = {
    [WHATSNEW]: prepend(whatsnew, next, notes, date),
    'package.json': pkgText.replace(/("version"\s*:\s*")[^"]*(")/, `$1${next}$2`),
    // Replaced in place, so the files keep their own formatting.
    '.keel/keel.json': configText.replace(/("practice"\s*:\s*")[^"]*(")/, `$1${next}$2`),
  };
  const push = `git push origin ${branch} v${next}`;
  const plan = {
    version: next, from: current, tag: `v${next}`, commit: `release v${next}`,
    files: [...Object.keys(files), '.keel/lock.json'], entry: entries(files[WHATSNEW])[0], push,
  };
  if (dryRun) {
    return {
      data: { ok: true, dryRun: true, ...plan, clean: !dirty },
      text: [`Dry run: nothing written. keel release v${next} (from ${current}) would:`,
        `  - prepend this entry to ${WHATSNEW}:`, '', ...`${plan.entry.heading}\n\n${plan.entry.body}`.split('\n').map(l => `    ${l}`), '',
        `  - set version ${next} in package.json, and practice ${next} in .keel/keel.json and .keel/lock.json`,
        `  - commit "release v${next}" and tag v${next} locally; it never pushes. Then: ${push}`,
        ...(dirty ? [`The working tree is not clean, so the real release would refuse:\n${dirty.split('\n').map(l => `    ${l}`).join('\n')}`] : [])].join('\n'),
    };
  }
  if (dirty) throw new ReleaseError(`the working tree is not clean; commit or stash first:\n${dirty}`);
  for (const [path, content] of Object.entries(files)) await writeFile(join(root, path), content);
  const lock = await readLock(root);
  if (lock) await writeLock(root, { ...lock, practice: next });
  git(root, ['add', '--', ...plan.files.filter(f => f !== '.keel/lock.json' || lock)], env);
  git(root, ['commit', '-q', '-m', `release v${next}`], env);
  git(root, ['tag', '-a', `v${next}`, '-m', `keel v${next}`], env);
  const commit = git(root, ['rev-parse', '--short', 'HEAD'], env);
  return {
    data: { ok: true, dryRun: false, ...plan, commitSha: commit },
    text: `Released keel v${next} (from ${current}): committed ${commit} "release v${next}" and tagged v${next}. Nothing was pushed.\nPush it: ${push}`,
  };
}
