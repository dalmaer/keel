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
// Before it writes anything it runs the review gate (phase 48; design
// research/2026-10-07-review-hardening.md §3): each commit since the last
// release tag that touches SCOPE (practices/, migrations/, docs/lessons.md)
// must have arrived through a merged PR whose review passes `keel review
// --gate` (every comment answered, and someone other than its author reviewed
// the head). One GitHub call per commit (`gh api repos/<repo>/commits/<sha>/pulls`,
// through KEEL_GH), two per PR, at most GATE_CAP commits. A commit pushed
// straight to main fails it, named. There is no --yes past it; only the
// owner's `--unreviewed "<why>"`, which the commit message and the WHATSNEW
// entry carry.
//
// After its gate passes and before it commits, it rehearses the update on
// every managed fleet project (phase 53; lib/fleet.mjs rehearse): clone,
// install, update to the candidate practice (this checkout's practices/ and
// migrations/ at the version the release carries), the project's check, and
// main's check when it fails; nothing pushed. A project that passes on main
// and fails with the release refuses it: every file back byte for byte, exit
// 1, the project and its tail named. Main already red, and a project that
// could not be cloned or installed, are said, never a refusal. The owner's
// `--despite <repo> "<why>"` (repeatable, a managed fleet repo) releases
// anyway, and the reason goes in the commit and the WHATSNEW entry. No
// managed project in fleet.json: the rehearsal is skipped, and said.
//
// Bare `keel release` reports the current version, whether it is tagged, and
// the newest entry. `--dry-run` shows the entry and the plan and writes nothing
// (and reads no GitHub: it lists the commits the gate will check).
import { readFile, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { parseVersion, compareVersions } from './migrations.mjs';
import { readLock, writeLock } from './lock.mjs';
import { practiceVersion } from './practices.mjs';
import { gateEnv } from '../practices/night/files/scripts/keel/lib.mjs';
import { ghJson, prGate } from './review.mjs';

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

/** The most commits the review gate reads (one GitHub call each); past it, release more often or pass --unreviewed. */
export const GATE_CAP = 40;
/** How many commit lookups run at once. */
const GATE_BATCH = 8;

/** The newest release tag (v<x.y.z>) reachable from HEAD, or null. */
function lastTag(root, env) {
  try {
    return execFileSync('git', ['-C', root, 'describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', 'HEAD'], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { return null; }
}

/**
 * The commits the review gate checks: { since, commits: [{sha, short, subject}] },
 * oldest first, every commit since the last release tag (else since the last
 * practice release, else all of history) that touches SCOPE.
 */
export function scopeCommits(root, fallback, env) {
  const since = lastTag(root, env) ?? fallback ?? null;
  const out = git(root, ['log', '--reverse', '--format=%H%x09%s', ...(since ? [`${since}..HEAD`] : ['HEAD']), '--', ...SCOPE], env);
  const commits = out.split('\n').filter(Boolean).map(l => {
    const [sha, ...subject] = l.split('\t');
    return { sha, short: sha.slice(0, 7), subject: subject.join('\t') };
  });
  return { since, commits };
}

/**
 * The review gate: for each commit, the merged PR that brought it and that
 * PR's `keel review --gate` verdict (prGate, in-process). Each PR is read once.
 * { ok, checked: [{sha, short, subject, pr, ok, why}], failures }. A GitHub read
 * that fails throws (exit 2): never a pass.
 */
export async function reviewGate({ root, repo, commits }, { env = process.env } = {}) {
  if (commits.length > GATE_CAP) {
    throw new ReleaseError(`${commits.length} commits under practices/, migrations/ or docs/lessons.md since the last release; the review gate reads at most ${GATE_CAP} (one GitHub call each). Release more often, or pass --unreviewed "<why>". Nothing was written.`, 1);
  }
  if (!repo) throw new ReleaseError('the review gate needs .keel/keel.json "repo" (owner/name) to find the pull requests; nothing was written');
  const read = async (args, what) => {
    try { return await ghJson(env, args, what); } catch (e) { throw new ReleaseError(`${e.message}; the review gate cannot pass on an unread review, and nothing was written`, 2); }
  };
  const prs = new Map();
  const verdict = n => {
    if (!prs.has(n)) prs.set(n, prGate({ root, repo, number: n }, { env }).catch(e => { throw new ReleaseError(`${e.message}; the review gate cannot pass on an unread review, and nothing was written`, 2); }));
    return prs.get(n);
  };
  const checked = [];
  for (let i = 0; i < commits.length; i += GATE_BATCH) {
    checked.push(...await Promise.all(commits.slice(i, i + GATE_BATCH).map(async c => {
      const pulls = await read(['api', `repos/${repo}/commits/${c.sha}/pulls`], `the pull requests of ${c.short}`);
      if (!Array.isArray(pulls)) throw new ReleaseError(`GitHub could not be read (the pull requests of ${c.short}): not a list; nothing was written`, 2);
      const merged = pulls.find(p => p?.merged_at);
      if (!merged) {
        const open = pulls.map(p => p?.number).filter(Boolean);
        return { ...c, pr: null, ok: false, why: open.length ? `only in unmerged #${open.join(', #')}: it reached main outside a PR` : 'pushed straight to main: no merged pull request brought it' };
      }
      const g = await verdict(merged.number);
      return { ...c, pr: merged.number, ok: g.ok, why: g.ok ? `#${merged.number}, reviewed by ${g.reviewedBy.join(', ')}` : `#${merged.number}: ${g.why}` };
    })));
  }
  const failures = checked.filter(c => !c.ok);
  return { ok: failures.length === 0, checked, failures };
}

function readPractice(root) {
  try { return practiceVersion(join(root, 'practices')); } catch (error) {
    throw new ReleaseError(error.code === 'ENOENT' ? `${root}/practices/VERSION is missing: it holds the practice version (one line, x.y.z)` : error.message);
  }
}

/**
 * The practice version the next release of the checkout at `root` would
 * carry, for keel fleet update --rehearse: practices/VERSION when nothing
 * under practices/, migrations/ or docs/lessons.md changed since the last
 * practice release, else the next patch of package.json's version (what
 * keel release <that> gives the practice by default). { version, changed }.
 */
export function candidatePractice(root, env = process.env) {
  const config = JSON.parse(readFileSync(join(root, '.keel', 'keel.json'), 'utf8'));
  if (config.keel !== 'self') throw new ReleaseError('the rehearsal runs at home, on keel. It rehearses the projects listed in keel\'s fleet.json.');
  const practice = readPractice(root);
  if (!practiceChange(root, practice, env).changed) return { version: practice, changed: false };
  const [major, minor, patch] = parseVersion(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version) ?? [0, 0, 0];
  const next = `${major}.${minor}.${patch + 1}`;
  return { version: compareVersions(next, practice) > 0 ? next : practice, changed: true };
}

/**
 * opts: { root, version?, notes?, dryRun?, practice?, unreviewed?, despite? }. deps: { env, date, rehearse? }.
 * `unreviewed` is the owner's reason to release past the review gate;
 * `despite` ([{repo, why}]) the owner's reasons to release past a project the
 * fleet rehearsal says fails. `rehearse` stands in for lib/fleet.mjs's (tests).
 * Returns { data, text, exitCode? }.
 */
export async function release({ root, version, notes, dryRun = false, practice: asked, unreviewed, despite = [] }, { env = process.env, date = today(), rehearse } = {}) {
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
    if (notes !== undefined || dryRun || asked !== undefined || unreviewed !== undefined || despite.length) throw new ReleaseError('keel release needs a version: keel release <x.y.z> --notes <file|->');
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
  // The review gate's commits (phase 48): practice-scope commits since the last release tag.
  const scope = scopeCommits(root, change.since, env);
  const skip = unreviewed === undefined ? null : String(unreviewed).trim().replace(/\s+/g, ' ');
  if (skip !== null && skip.split(' ').filter(Boolean).length < 2) throw new ReleaseError('--unreviewed needs the reason, in a few words: --unreviewed "<why>" (it goes in the release commit and WHATSNEW)');
  if (skip !== null && !scope.commits.length) throw new ReleaseError(`--unreviewed: no commit under practices/, migrations/ or docs/lessons.md since ${scope.since ?? 'the start'}, so there is no review to skip`);
  const unreviewedLine = skip && `Released without the review gate (${scope.commits.length} practice commit${scope.commits.length === 1 ? '' : 's'} unchecked): ${skip}`;
  // The fleet rehearsal (phase 53): which projects it runs, and the owner's reasons to release past one.
  const fleetMod = await import('./fleet.mjs');
  const managed = await fleetMod.managedRepos(root);
  const despiteBy = new Map();
  for (const d of despite) {
    const why = String(d?.why ?? '').trim().replace(/\s+/g, ' ');
    if (!managed.includes(d?.repo)) throw new ReleaseError(`--despite ${d?.repo}: not a managed project in fleet.json, so the rehearsal never runs it; nothing was written`);
    if (despiteBy.has(d.repo)) throw new ReleaseError(`--despite ${d.repo} is given twice`);
    if (why.split(' ').filter(Boolean).length < 2) throw new ReleaseError(`--despite ${d.repo} needs the reason, in a few words: --despite ${d.repo} "<why>" (it goes in the release commit and WHATSNEW)`);
    despiteBy.set(d.repo, why);
  }
  const despiteLine = despiteBy.size ? `Released despite the fleet rehearsal: ${[...despiteBy].map(([repo, why]) => `${repo} (${why})`).join('; ')}` : null;
  const owned = [unreviewedLine, despiteLine].filter(Boolean);
  const dirty = git(root, ['status', '--porcelain'], env);
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'], env);

  const files = {
    [WHATSNEW]: prepend(whatsnew, next, owned.length ? `${notes.trim()}\n\n${owned.join('\n\n')}\n` : notes, date, { practice: to, changed: change.changed }),
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
    review: { since: scope.since, commits: scope.commits.map(({ short, subject }) => ({ sha: short, subject })), unreviewed: skip },
    rehearsal: { projects: managed, despite: [...despiteBy].map(([repo, why]) => ({ repo, why })) },
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
        !scope.commits.length ? `  - check no review: no commit under practices/, migrations/ or docs/lessons.md since ${scope.since ?? 'the start'}`
          : skip ? `  - skip the review gate for ${scope.commits.length} practice commit(s), writing why in the commit and the entry: ${skip}`
            : `  - before writing anything, check that each of ${scope.commits.length} practice commit(s) since ${scope.since ?? 'the start'} came through a merged PR whose review passes keel review --gate (a dry run reads no GitHub): ${scope.commits.map(c => c.short).join(', ')}`,
        `  - run the gate (\`${config.check ?? 'npm run check'}\`); if it fails, put every file back and stop`,
        managed.length
          ? `  - rehearse the update on the ${managed.length} managed fleet project(s) (clone, install, update to practice ${to}, check; nothing pushed); if one passes on main and fails with the release, put every file back and stop${despiteBy.size ? `, except ${[...despiteBy.keys()].join(', ')} (--despite)` : ''}`
          : '  - skip the fleet rehearsal: no managed project in fleet.json',
        `  - commit "release v${next}" and tag v${next} locally; it never pushes. Then: ${push}`,
        ...(dirty ? [`The working tree is not clean, so the real release would refuse:\n${dirty.split('\n').map(l => `    ${l}`).join('\n')}`] : [])].join('\n'),
    };
  }
  if (dirty) throw new ReleaseError(`the working tree is not clean; commit or stash first:\n${dirty}`);
  // The review gate, before anything is written: a refusal leaves every file and ref as it was.
  if (scope.commits.length && !skip) {
    const gate = await reviewGate({ root, repo: config.repo, commits: scope.commits }, { env });
    plan.review.checked = gate.checked.map(({ short, subject, pr, ok, why }) => ({ sha: short, subject, pr, ok, why }));
    if (!gate.ok) {
      throw new ReleaseError([`the review gate refused v${next}: ${gate.failures.length} of ${gate.checked.length} practice commit(s) since ${scope.since ?? 'the start'} did not come through a merged PR whose review passes keel review --gate. Nothing was written.`,
        ...gate.failures.map(c => `  ${c.short} ${c.subject} — ${c.why}`),
        'Land each through a reviewed PR (every comment answered, its head reviewed by someone other than its author), or, as the owner, pass --unreviewed "<why>".'].join('\n'), 1,
      { review: { failures: gate.failures } });
    }
  }
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
  let lock, rehearsalLines = null;
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
    // The fleet rehearsal, after keel's own gate and before the commit (phase 53): a refusal puts every file back too.
    if (!managed.length) plan.rehearsal.skipped = 'no managed project in fleet.json';
    else {
      const rehearsed = await (rehearse ?? fleetMod.rehearse)({ dir: root }, { env, cli: to, practicesDir: join(root, 'practices'), migrationsDir: join(root, 'migrations'), cliRoot: root });
      const { rows, resting = [], ms = 0, skipped } = rehearsed.data;
      Object.assign(plan.rehearsal, { ms, rows, resting, ...(skipped ? { skipped } : {}) });
      rehearsalLines = skipped ? fleetMod.rehearsalText({ skipped }) : fleetMod.rehearsalText({ cli: to, rows, resting, ms });
      const refused = rows.filter(x => x.status === 'fails' && !despiteBy.has(x.repo));
      if (refused.length) {
        throw new ReleaseError([`the fleet rehearsal refused v${next}: ${refused.map(x => x.repo).join(', ')} pass${refused.length === 1 ? 'es' : ''} its check on main and fail${refused.length === 1 ? 's' : ''} it with this release. Nothing was committed or tagged and every file is as it was.`,
          rehearsalLines,
          'Fix it in keel (or in the project) before the tag, or, as the owner, pass --despite <repo> "<why>".'].join('\n'), 1,
        { rehearsal: plan.rehearsal });
      }
    }
  } catch (error) {
    await restore();
    const left = git(root, ['status', '--porcelain'], env);
    if (left) error.message += `\nAfter restoring, git still shows changes (made by the check itself?):\n${left}`;
    throw error;
  }
  git(root, ['add', '--', ...plan.files.filter(f => f !== '.keel/lock.json' || lock)], env);
  // Each --despite with what the rehearsal found for that project.
  const found = repo => {
    const x = plan.rehearsal.rows?.find(r => r.repo === repo);
    if (!x) return 'not rehearsed';
    if (x.status === 'fails') return `fails with the release: \`${x.check.command}\` exit ${x.check.exit}`;
    return x.status === 'error' ? `not rehearsed: ${x.step} failed` : x.status;
  };
  const despiteMessage = despiteBy.size ? ['-m', `Despite the fleet rehearsal:\n${[...despiteBy].map(([repo, why]) => `${repo}: ${why} (${found(repo)})`).join('\n')}`] : [];
  git(root, ['commit', '-q', '-m', `release v${next}`, ...(unreviewedLine ? ['-m', `Unreviewed: ${skip}\n\n${scope.commits.map(c => `${c.short} ${c.subject}`).join('\n')}`] : []), ...despiteMessage], env);
  git(root, ['tag', '-a', `v${next}`, '-m', `keel v${next}`], env);
  const commit = git(root, ['rev-parse', '--short', 'HEAD'], env);
  return {
    data: { ok: true, dryRun: false, ...plan, commitSha: commit, check: { command: check, ok: true } },
    text: `${plan.review.checked ? `Review gate passed: ${plan.review.checked.length} practice commit(s), each through a reviewed PR.\n` : skip ? `Review gate skipped (--unreviewed): ${skip}\n` : ''}Check passed: ${check}\n${plan.rehearsal.skipped ? `Rehearsal skipped: ${plan.rehearsal.skipped}.\n` : rehearsalLines ? `${rehearsalLines}\n` : ''}${despiteLine ? `${despiteLine}\n` : ''}Released keel v${next} (from ${current}), ${why}: committed ${commit} "release v${next}" and tagged v${next}. Nothing was pushed.\nPush it: ${push}`,
  };
}
