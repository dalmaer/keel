// keel release: cut a version of keel itself (design §3).
//
// Two versions. The CLI's is package.json's `version`, released as the git
// tag v<version>. The practice's is practices/VERSION: what projects record
// and update, fleet and init compare. A release always bumps the CLI; it bumps
// the practice only when practices/, migrations/ or docs/lessons.md changed since the last
// practice release (the last commit that changed practices/VERSION, else the
// tag v<practice>), so a keel-side-only release leaves every project current
// (phase 22). The practice goes to the CLI's new version, or `--practice <v>`.
//
// A release prepends a WHATSNEW.md entry headed with which kind it was
// (the notes, required), bumps package.json and, for a practice release,
// practices/VERSION and keel's own practice (.keel/keel.json and the lock,
// since keel runs on what it ships), commits `release v<version>` and tags it
// locally. It never pushes; it prints the push command.
//
// Between writing and committing it runs the project's gate (config `check`,
// default npm run check). A failing gate puts every file back byte for byte,
// names the check, and exits 1: no commit, no tag.
//
// Bare `keel release` reports the current version, whether it is tagged, and
// the newest entry. `--dry-run` shows the entry and the plan and writes nothing.
import { readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { parseVersion, compareVersions } from './migrations.mjs';
import { readLock, writeLock } from './lock.mjs';
import { practiceVersion } from './practices.mjs';
import { gateEnv } from '../practices/night/files/scripts/keel/lib.mjs';

export const WHATSNEW = 'WHATSNEW.md';
export const WHATSNEW_HEADER = `# What's new in keel

Each entry is for the person whose project \`keel update\` brings to that
practice version: what changes in your repo, and anything you need to do.
An entry headed "keel only" changed the CLI, not the practice: no project
needs an update for it. Newest first. \`keel release\` writes them; \`keel update\` puts the entries
between your version and the new one into its pull request.
`;

class ReleaseError extends Error {
  constructor(message, exitCode = 2, extra = {}) { super(message); this.exitCode = exitCode; Object.assign(this, extra); }
}

const read = path => readFile(path, 'utf8').catch(e => e.code === 'ENOENT' ? null : Promise.reject(e));
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const ENTRY = /^## v(\d+\.\d+\.\d+)\b.*$/gm;

const KEEL_ONLY = /— keel only; practice unchanged at (\d+\.\d+\.\d+)/;
const PRACTICE = /— practice (\d+\.\d+\.\d+)/;

/**
 * WHATSNEW's entries: [{version, practice, keelOnly, heading, body}], newest
 * first as written. `version` is the CLI's; `practice` is the practice version
 * the entry brings (an entry from before the split names none: it is `version`).
 */
export function entries(text) {
  const marks = [...(text ?? '').matchAll(ENTRY)];
  return marks.map((m, i) => {
    const only = m[0].match(KEEL_ONLY);
    return {
      version: m[1], practice: only?.[1] ?? m[0].match(PRACTICE)?.[1] ?? m[1], keelOnly: !!only, heading: m[0],
      body: text.slice(m.index + m[0].length, marks[i + 1]?.index ?? text.length).trim(),
    };
  });
}

/** The entries a project on practice `from` receives on its way to `to`: practice releases with from < practice ≤ to, newest first. */
export const between = (text, from, to) =>
  entries(text).filter(e => !e.keelOnly && compareVersions(e.practice, from) > 0 && compareVersions(e.practice, to) <= 0);

/** The heading's kind: "keel only; practice unchanged at <p>" or "practice <p>". */
const kindOf = ({ practice, changed }) => changed ? `practice ${practice}` : `keel only; practice unchanged at ${practice}`;

/** WHATSNEW.md with the entry for `version` added above the newest one; `kind` ({practice, changed}) says which kind of release. */
export function prepend(text, version, notes, date = today(), kind = null) {
  const entry = `## v${version} — ${kind ? `${kindOf(kind)} (${date})` : date}\n\n${notes.trim()}\n`;
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

// docs/lessons.md is keel's catalogue, which every project's docs/keel-lessons.md is rendered from
// (phase 30): a lessons-only release moves the practice, or the views never reach the fleet.
const SCOPE = ['practices', 'migrations', 'docs/lessons.md', ':(exclude)practices/VERSION'];

/**
 * Whether the practice changed since its last release: { since, changed, files }.
 * The last release is the last commit that changed practices/VERSION, else the
 * tag v<practice>; with neither, everything is a change.
 */
export function practiceChange(root, practice, env) {
  const last = git(root, ['log', '-1', '--format=%h', '--', 'practices/VERSION'], env);
  const since = last || (tagged(root, `v${practice}`, env) ? `v${practice}` : null);
  if (!since) return { since: null, changed: true, files: [] };
  const files = git(root, ['diff', '--name-only', since, 'HEAD', '--', ...SCOPE], env).split('\n').filter(Boolean);
  return { since, changed: files.length > 0, files };
}

function readPractice(root) {
  try { return practiceVersion(join(root, 'practices')); } catch (error) {
    throw new ReleaseError(error.code === 'ENOENT' ? `${root}/practices/VERSION is missing: it holds the practice version (one line, x.y.z)` : error.message);
  }
}

/**
 * opts: { root, version?, notes?, dryRun?, practice? }. deps: { env, date }.
 * Returns { data, text, exitCode? }.
 */
export async function release({ root, version, notes, dryRun = false, practice: asked }, { env = process.env, date = today() } = {}) {
  const configPath = join(root, '.keel', 'keel.json');
  const configText = await read(configPath) ?? '{}';
  const config = JSON.parse(configText);
  if (config.keel !== 'self') throw new ReleaseError('keel release runs only in keel itself (.keel/keel.json "keel": "self"); projects take a release with keel update');
  const pkgPath = join(root, 'package.json');
  const pkgText = await read(pkgPath);
  const current = JSON.parse(pkgText).version;
  const practice = readPractice(root);
  const whatsnew = await read(join(root, WHATSNEW));

  if (version === undefined) {
    if (notes !== undefined || dryRun || asked !== undefined) throw new ReleaseError('keel release needs a version: keel release <x.y.z> --notes <file|->');
    const newest = entries(whatsnew)[0] ?? null;
    const isTagged = tagged(root, `v${current}`, env);
    return {
      data: { version: current, practice, tag: `v${current}`, tagged: isTagged, newest },
      text: [`keel ${current} (${isTagged ? `tagged v${current}` : 'not tagged'}) practice ${practice}`,
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
  const change = practiceChange(root, practice, env);
  let to = practice;
  if (change.changed) {
    to = asked === undefined ? next : String(asked).replace(/^v/, '');
    if (!parseVersion(to)) throw new ReleaseError(`--practice ${asked} is not a version (x.y.z)`);
    if (compareVersions(to, practice) <= 0) throw new ReleaseError(`the practice changed, so practice ${to} must be newer than the current practice ${practice}; pass --practice <x.y.z>`);
  } else if (asked !== undefined) {
    throw new ReleaseError(`--practice ${asked}: nothing under practices/, migrations/ or docs/lessons.md changed since ${change.since}, so the practice stays at ${practice}`);
  }
  const dirty = git(root, ['status', '--porcelain'], env);
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'], env);

  const files = {
    [WHATSNEW]: prepend(whatsnew, next, notes, date, { practice: to, changed: change.changed }),
    'package.json': pkgText.replace(/("version"\s*:\s*")[^"]*(")/, `$1${next}$2`),
    // Replaced in place, so the files keep their own formatting.
    ...(change.changed ? {
      'practices/VERSION': `${to}\n`,
      '.keel/keel.json': configText.replace(/("practice"\s*:\s*")[^"]*(")/, `$1${to}$2`),
    } : {}),
  };
  const push = `git push origin ${branch} v${next}`;
  const plan = {
    version: next, from: current, tag: `v${next}`, commit: `release v${next}`,
    practice: { from: practice, to, changed: change.changed, since: change.since, files: change.files },
    files: [...Object.keys(files), ...(change.changed ? ['.keel/lock.json'] : [])], entry: entries(files[WHATSNEW])[0], push,
  };
  const why = change.changed
    ? `practice ${practice} → ${to}: ${change.since ? `${change.files.length} file(s) under practices/, migrations/ or docs/lessons.md changed since ${change.since} (${change.files.slice(0, 5).join(', ')}${change.files.length > 5 ? ', …' : ''})` : 'no earlier practice release to compare with'}`
    : `practice unchanged at ${practice}: nothing under practices/, migrations/ or docs/lessons.md changed since ${change.since}; projects stay current`;
  if (dryRun) {
    return {
      data: { ok: true, dryRun: true, ...plan, clean: !dirty },
      text: [`Dry run: nothing written. keel release v${next} (from ${current}) is ${change.changed ? 'a practice release' : 'keel only'}; ${why}. It would:`,
        `  - prepend this entry to ${WHATSNEW}:`, '', ...`${plan.entry.heading}\n\n${plan.entry.body}`.split('\n').map(l => `    ${l}`), '',
        change.changed ? `  - set version ${next} in package.json, and practice ${to} in practices/VERSION, .keel/keel.json and .keel/lock.json`
          : `  - set version ${next} in package.json, and leave the practice (practices/VERSION, .keel/keel.json, .keel/lock.json) at ${practice}`,
        `  - run the gate (\`${config.check ?? 'npm run check'}\`); if it fails, put every file back and stop`,
        `  - commit "release v${next}" and tag v${next} locally; it never pushes. Then: ${push}`,
        ...(dirty ? [`The working tree is not clean, so the real release would refuse:\n${dirty.split('\n').map(l => `    ${l}`).join('\n')}`] : [])].join('\n'),
    };
  }
  if (dirty) throw new ReleaseError(`the working tree is not clean; commit or stash first:\n${dirty}`);
  // Every file the release writes, as it was: a failing gate puts them back byte for byte.
  const saved = new Map();
  for (const path of plan.files) saved.set(path, await readFile(join(root, path)).catch(e => e.code === 'ENOENT' ? null : Promise.reject(e)));
  const restore = async () => {
    for (const [path, bytes] of saved) {
      if (bytes === null) await rm(join(root, path), { force: true });
      else await writeFile(join(root, path), bytes);
    }
  };
  const check = config.check ?? 'npm run check';
  let lock;
  try {
    for (const [path, content] of Object.entries(files)) await writeFile(join(root, path), content);
    lock = change.changed ? await readLock(root) : null;
    if (lock) await writeLock(root, { ...lock, practice: to });
    // The gate runs on the release as it will be committed. Never hand it a test
    // runner's context: its node --test would skip every file and pass (lesson 4).
    const r = spawnSync(check, { cwd: root, env: gateEnv(env, config), shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) {
      const tail = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-12).join('\n');
      throw new ReleaseError(`the gate failed on v${next} (\`${check}\`, exit ${r.status ?? r.signal}); nothing was committed or tagged and every file is as it was. Its output ended:\n${tail}`, 1,
        { check: { command: check, ok: false, exit: r.status } });
    }
  } catch (error) {
    await restore();
    const left = git(root, ['status', '--porcelain'], env);
    if (left) error.message += `\nAfter restoring, git still shows changes (made by the check itself?):\n${left}`;
    throw error;
  }
  git(root, ['add', '--', ...plan.files.filter(f => f !== '.keel/lock.json' || lock)], env);
  git(root, ['commit', '-q', '-m', `release v${next}`], env);
  git(root, ['tag', '-a', `v${next}`, '-m', `keel v${next}`], env);
  const commit = git(root, ['rev-parse', '--short', 'HEAD'], env);
  return {
    data: { ok: true, dryRun: false, ...plan, commitSha: commit, check: { command: check, ok: true } },
    text: `Check passed: ${check}\nReleased keel v${next} (from ${current}), ${why}: committed ${commit} "release v${next}" and tagged v${next}. Nothing was pushed.\nPush it: ${push}`,
  };
}
