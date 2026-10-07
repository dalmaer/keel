// keel update: bring a project to the practice this keel carries, as one
// reviewed change (design §3). The order is the rule:
//
//   1. The CLI updates itself first (a git checkout: fetch, pull --ff-only,
//      re-exec with KEEL_SELF_UPDATED=1, never twice). An old CLI must never
//      run a new migration. A dirty or diverged checkout is said and skipped.
//   2. A project on a newer practice than this CLI is refused (exit 2).
//   3. The working tree must be clean (exit 2): the update must be its own diff.
//      Doctor's diagnose runs too: an `edited` or `both` target is refused
//      (exit 1). Update never overwrites a project's edit; `behind` targets are
//      exactly what it re-renders.
//   4. Pending migrations (from < to ≤ this version, applies() true) run in id
//      order in memory. If any throws, nothing is written (exit 1, named).
//   5. The edits are written, managed files and blocks re-rendered (ejected
//      targets stay the project's), the lock and `practice` bumped, and the
//      roadmap regenerated when phases is on.
//   6. The project's `check` runs. If it fails, every path update touched is
//      restored to its recorded bytes, what it created is deleted (exit 1).
//   7. By default the change is committed on keel/update-v<version> and the
//      current branch is left as it was; ⚑ pushing and opening the PR needs
//      --yes (exit 3 with the plan until then; the same command with --yes
//      resumes from the branch). --local leaves a working-tree diff instead.
//
// git and gh are reached as processes; gh is process.env.KEEL_GH || 'gh'.
import { readFile, writeFile, mkdir, rm, lstat, readlink, symlink, chmod, rmdir, mkdtemp } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { load as loadPractices, render, config as readConfig, plan as planRender, blockBody } from './practices.mjs';
import { readLock, lockKey, LOCK } from './lock.mjs';
import { diagnose } from './doctor.mjs';
import { findRoot } from './project.mjs';
import { load as loadMigrations, collect, compareVersions, anyPending, taken, MIGRATIONS } from './migrations.mjs';
import { between as notesBetween, WHATSNEW } from './release.mjs';
import { run as roadmap } from '../practices/phases/files/scripts/roadmap.mjs';
import { gateEnv } from '../practices/night/files/scripts/keel/lib.mjs';
import { prBody as renderBody } from '../practices/night/files/scripts/keel/pr-body.mjs';

export const BRANCH = version => `keel/update-v${version}`;
const CONFIG = '.keel/keel.json';
const ROADMAP = 'docs/ROADMAP.md';

export class UpdateError extends Error {
  constructor(message, exitCode = 1, extra = {}) { super(message); this.exitCode = exitCode; Object.assign(this, extra); }
}

const exec = (cmd, args, opts) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trimEnd();
const attempt = (cmd, args, opts) => {
  try { return { ok: true, out: exec(cmd, args, opts) }; } catch (e) { return { ok: false, out: String(e.stdout ?? '').trim(), err: String(e.stderr || e.message).trim().split('\n')[0] }; }
};
const firstLine = s => String(s ?? '').trim().split('\n')[0];

// ---- 1. the CLI first ------------------------------------------------------

/**
 * Bring the CLI checkout at `cliRoot` up to its upstream. Returns
 * { state, note } with state one of: skipped (already re-executed once),
 * not-git, unreachable, no-upstream, current, dirty, diverged, updated.
 * Only `updated` means the caller must re-exec.
 */
export function selfUpdate({ cliRoot, env = process.env }) {
  if (env.KEEL_SELF_UPDATED) return { state: 'skipped', note: 'this keel was just updated and re-run; not updating twice' };
  const genv = { ...env, GIT_TERMINAL_PROMPT: '0' };
  const g = (args, timeout = 60_000) => attempt('git', ['-C', cliRoot, ...args], { env: genv, timeout });
  const top = g(['rev-parse', '--show-toplevel']);
  if (!top.ok || resolve(top.out) !== resolve(cliRoot)) return { state: 'not-git', note: `keel at ${cliRoot} is not a git checkout; update it the way it was installed` };
  const upstream = g(['rev-parse', '--abbrev-ref', '@{u}']);
  if (!upstream.ok) return { state: 'no-upstream', note: `keel's checkout has no upstream branch; continuing with keel as it is` };
  const fetch = g(['fetch', '--quiet']);
  if (!fetch.ok) return { state: 'unreachable', note: `could not fetch keel (${fetch.err}); continuing with keel as it is` };
  const count = range => Number(g(['rev-list', '--count', range]).out || 0);
  const behind = count('HEAD..@{u}'), ahead = count('@{u}..HEAD');
  if (!behind) return { state: 'current', note: 'keel is current' };
  if (ahead) return { state: 'diverged', note: `keel's checkout at ${cliRoot} has ${ahead} commit(s) of its own and is ${behind} behind ${upstream.out}; continuing with keel as it is` };
  const dirty = g(['status', '--porcelain', '--untracked-files=no']);
  if (dirty.out) return { state: 'dirty', note: `keel's checkout at ${cliRoot} has local changes and is ${behind} behind ${upstream.out}; continuing with keel as it is` };
  const before = g(['rev-parse', '--short', 'HEAD']).out;
  const pull = g(['pull', '--ff-only', '--quiet'], 120_000);
  if (!pull.ok) return { state: 'diverged', note: `git pull --ff-only failed (${pull.err}); continuing with keel as it is` };
  return { state: 'updated', note: `updated keel ${before} → ${g(['rev-parse', '--short', 'HEAD']).out}`, from: before };
}

/** Run the updated CLI with the same arguments, once. Output passes through. */
export function reexec({ cliRoot, argv, cwd, env = process.env }) {
  const r = spawnSync(process.execPath, [join(cliRoot, 'bin', 'keel.mjs'), ...argv], {
    cwd, encoding: 'utf8', env: { ...env, KEEL_SELF_UPDATED: '1' }, maxBuffer: 64 * 1024 * 1024,
  });
  return { passthrough: { stdout: r.stdout ?? '', stderr: r.stderr ?? '' }, exitCode: r.status ?? 1 };
}

// ---- recording and restoring -----------------------------------------------

/** Remembers the original state of every path update touches, so a failure can put it back. */
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

// ---- the PR ----------------------------------------------------------------

/** The migrations a commit message names as rewriting the project's files: [{ id, paths }]. */
export function rewritesOf(message) {
  const out = [];
  for (const m of String(message).matchAll(/^(\d{4}-[\w-]+): .*\n {2}rewrites: (.+)$/gm)) out.push({ id: m[1], paths: m[2].split(', ') });
  return out;
}

/**
 * The PR body (scripts/keel/pr-body.mjs): the changed files as a tree, the
 * gate's line and the practice before → after, and the merge danger. A
 * migration that rewrote the project's own files makes it a one-way door for
 * that project's history; a re-render alone is two-way. WHATSNEW's entries
 * and the commit are notes; the keel-impact block stays last.
 */
export function updateBody({ from, to, message, whatsnew, check, files = [] }) {
  const notes = whatsnew ? notesBetween(whatsnew, from, to) : [];
  const rewrites = rewritesOf(message);
  const rewritten = new Map(rewrites.flatMap(r => r.paths.map(p => [p, `migration ${r.id}`])));
  return renderBody({
    summary: { lead: `keel practice ${from} → ${to}, made by \`keel update\`.`, files: files.map(path => rewritten.has(path) ? { path, note: rewritten.get(path) } : path) },
    evidence: {
      gate: `\`${check}\` exit 0 on this change, before it was committed.`,
      rows: [{ what: 'keel practice (.keel/keel.json)', before: from, after: to }],
    },
    danger: rewrites.length
      ? { door: 'one-way', why: `${rewrites.map(r => `migration ${r.id} rewrote ${r.paths.join(', ')}`).join('; ')}. These are the project's own files: a revert restores their bytes, but not what is built on them after the merge.`, surfaces: ['adopted project'] }
      : { door: 'two-way', why: "re-renders keel's own files; reverting the merge restores them.", surfaces: ['adopted project'] },
    notes: [
      // A step a migration could not take (a file keel may not edit): first, so nobody misses it.
      ...notesOf(message).map(n => `**To do by hand (migration ${n.id}):** ${n.text}`),
      ...(notes.length ? notes.map(e => `### v${e.version}\n\n${e.body}`) : ['No WHATSNEW entries between these versions.']),
      `The commit:\n\n\`\`\`\n${message.trim()}\n\`\`\``,
      "Managed files and blocks were re-rendered; nothing the project changed of them was overwritten (keel doctor).",
    ],
    impact: {
      note: 'This update maintains managed practice infrastructure. If a migration changes actual phase or decision records, review those edits and replace this declaration with their affected references and reconciliation. The impact check validates the actual diff; a bot identity grants no exemption.',
      declaration: { version: 1, phases: [], decisions: [], supersedes: [], evidence: [], reconciliation: 'none', reason: 'Managed practice infrastructure, configuration and generated views only; no phase acceptance, next action, or architecture decision is claimed by this update.' },
    },
  });
}

/** A migration's notes in the commit: each `  note: <first line>`, its other lines indented under it. */
export const noteLines = (notes = []) => notes.map(n => n.split('\n').map((l, i) => i ? `    ${l}` : `  note: ${l}`).join('\n'));

/** The migrations' notes in a commit message: [{ id, text }], each a step the person takes by hand. */
export function notesOf(message) {
  const out = [];
  let id = null, cur = null;
  for (const line of String(message).split('\n')) {
    const head = /^(\d{4}-[\w-]+): /.exec(line);
    if (head) { id = head[1]; cur = null; continue; }
    const n = /^ {2}note: (.*)$/.exec(line);
    if (n && id) { cur = { id, text: n[1] }; out.push(cur); continue; }
    if (cur && /^ {4}/.test(line)) { cur.text += `\n${line.slice(4)}`; continue; }
    cur = null;
  }
  return out;
}

const publishPlan = ({ branch, base, title }) => [
  { what: `git push -u origin ${branch}`, command: ['git', 'push', '-u', 'origin', branch] },
  { what: `gh pr create --head ${branch} --base ${base} --title "${title}" --body <Summary, Evidence, Merge danger (scripts/keel/pr-body.mjs)>`, command: ['pr', 'create', '--head', branch, '--base', base, '--title', title] },
];

async function publish({ root, branch, base, title, body, env }) {
  const push = attempt('git', ['-C', root, 'push', '-u', 'origin', branch], { env, timeout: 120_000 });
  if (!push.ok) throw new UpdateError(`git push -u origin ${branch} failed: ${push.err}`);
  const gh = env.KEEL_GH || 'gh';
  const temp = await mkdtemp(join(tmpdir(), 'keel-update-body-'));
  try {
    const file = join(temp, 'body.md');
    await writeFile(file, body);
    const pr = attempt(gh, ['pr', 'create', '--head', branch, '--base', base, '--title', title, '--body-file', file], { cwd: root, env, timeout: 120_000 });
    if (!pr.ok) throw new UpdateError(`${gh} pr create failed: ${pr.err}; the branch ${branch} is pushed`);
    return firstLine(pr.out);
  } finally { await rm(temp, { recursive: true, force: true }); }
}

// ---- update ----------------------------------------------------------------

/**
 * opts: { dir, local?, yes?, selfUpdate? (default true), argv?, cwd? }
 * deps: { version, cliRoot, migrationsDir?, whatsnew? (path), env?, practices?, migrations? }
 * Returns { data, text, exitCode? } or { passthrough, exitCode } after a re-exec.
 */
export async function update(opts, deps) {
  const { version, cliRoot, env = process.env } = deps;
  const root = await findRoot(resolve(opts.dir ?? '.'));
  const cfg = await readConfig(root);
  if (cfg.keel === 'self') {
    return { data: { ok: true, root, self: true, practice: cfg.practice }, text: 'This is keel itself: its practice is what it ships, cut with keel release, not taken with keel update.' };
  }

  // 1. The CLI first.
  let self = { state: 'off', note: '--no-self-update' };
  if (opts.selfUpdate !== false) {
    self = selfUpdate({ cliRoot, env });
    if (self.state === 'updated') return reexec({ cliRoot, argv: opts.argv ?? ['update'], cwd: opts.cwd ?? root, env });
  }
  const notes = self.state === 'current' || self.state === 'off' || self.state === 'skipped' ? [] : [self.note];

  // 2. An old CLI refuses a newer project.
  const from = cfg.practice ?? '0.0.0';
  if (compareVersions(from, version) > 0) {
    throw new UpdateError(`update keel first: ${cfg.name ?? root} is on practice ${from}, and this keel carries ${version}. Run git -C ${cliRoot} pull --ff-only (or keel update without --no-self-update), then keel update again`, 2);
  }
  const base = { root, from, to: version, selfUpdate: self };
  const migrations = deps.migrations ?? await loadMigrations(deps.migrationsDir ?? MIGRATIONS);
  const done = taken(cfg);
  if (compareVersions(from, version) === 0 && !(await anyPending(root, migrations, done))) {
    return { data: { ok: true, ...base, changed: false }, text: [...notes, `Already on practice ${version}; nothing to change.`].join('\n') };
  }

  // 3. A git work tree, clean; the branch, unless it holds this update already.
  const git = (args, o = {}) => exec('git', ['-C', root, ...args], { env, ...o });
  const top = attempt('git', ['-C', root, 'rev-parse', '--show-toplevel'], { env });
  if (!top.ok) throw new UpdateError(`${root} is not a git work tree; keel update makes its change as a commit or a diff`, 2);
  const branch = BRANCH(version);
  const current = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const title = from === version ? `keel update: practice ${version}, pending migrations` : `keel update: practice ${from} → ${version}`;
  const hasBranch = attempt('git', ['-C', root, 'rev-parse', '-q', '--verify', `refs/heads/${branch}`], { env }).ok;
  if (hasBranch && !opts.local) return finish({ ...base, root, branch, base: current, title, yes: opts.yes, env, git, whatsnew: deps.whatsnew, notes, check: cfg.check ?? 'npm run check', resumed: true });
  const dirty = git(['status', '--porcelain']);
  if (dirty) throw new UpdateError(`the working tree is not clean; commit or stash first, so the update is its own change:\n${dirty}`, 2);

  //    Doctor first: update never overwrites what the project changed.
  const practices = deps.practices ?? await loadPractices();
  const report = await diagnose(root, { practices, version });
  const changed = report.drift.filter(d => d.state === 'edited' || d.state === 'both');
  if (changed.length) {
    throw new UpdateError(`the project changed keel's ${changed.map(d => `${d.path} (${d.state})`).join(', ')}; update never overwrites that. See keel doctor, then keel doctor --fix <path> restore|eject, or send it home with keel lessons; then keel update again`, 1, { changed: changed.map(d => d.path) });
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
    // A target keel never wrote is the project's until the lock says otherwise.
    const unknown = [];
    for (const e of planned) {
      if (e.kind === 'seeded' || e.status !== 'update' || lock?.files?.[lockKey(e)]) continue;
      if (e.kind === 'block' && !(blockBody(await readFile(join(root, e.path), 'utf8'), e.block) ?? '').trim()) continue; // empty markers, just placed
      unknown.push(lockKey(e));
    }
    if (unknown.length) throw new UpdateError(`render would overwrite ${unknown.join(', ')}, which keel never wrote here; move the project's version aside or eject it (keel doctor --fix <path> eject), then keel update again`);
    for (const e of planned) if (e.status === 'create' || e.status === 'update') await journal.record(e.path);
    for (const path of [LOCK, CONFIG, ROADMAP]) await journal.record(path);
    const result = await render(root, { practices, version });
    rendered = result.entries.filter(e => e.status === 'create' || e.status === 'update').map(lockKey);
    const raw = JSON.parse(await readFile(join(root, CONFIG), 'utf8'));
    raw.practice = version;
    if (applied.length) raw.migrations = [...new Set([...taken(raw), ...applied.map(m => m.id)])].sort();
    await writeFile(join(root, CONFIG), `${JSON.stringify(raw, null, 2)}\n`);
    if (raw.practices?.includes('phases')) {
      try { await roadmap({ root, mode: 'write' }); } catch (e) { notes.push(`roadmap not regenerated: ${e.message}`); }
    }
    // Never a test runner's context (lesson 14); the project's .keel/keel.json `env` over it.
    const r = spawnSync(check, { cwd: root, env: gateEnv(env, after), shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) {
      const tail = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-12).join('\n');
      throw new UpdateError(`the project's check failed after the update (\`${check}\`, exit ${r.status}); the project is as it was. Its output ended:\n${tail}`, 1, { check: { command: check, ok: false, exit: r.status } });
    }
  } catch (error) {
    await journal.restore();
    const left = attempt('git', ['-C', root, 'status', '--porcelain'], { env }).out;
    if (left) error.message += `\nAfter restoring, git still shows changes (made by the check itself?):\n${left}`;
    throw error;
  }

  // A migration's edits are named under it: the PR's merge danger reads them (rewritesOf).
  const message = [title, '', ...applied.flatMap(m => [`${m.id}: ${m.summary}`, ...(m.edits.length ? [`  rewrites: ${m.edits.map(e => e.path).join(', ')}`] : []), ...noteLines(m.notes)]),
    ...(rendered.length ? [`re-rendered: ${rendered.join(', ')}`] : [])].join('\n');
  const data = { ...base, changed: true, migrations: applied.map(m => ({ id: m.id, to: m.to, summary: m.summary, edits: m.edits.map(e => ({ path: e.path, action: e.content === null ? 'delete' : 'write' })), ...(m.notes?.length ? { notes: m.notes } : {}) })),
    rendered, check: { command: check, ok: true }, notes };
  const summaryLines = [...notes, `Updated ${cfg.name ?? root} from practice ${from} to ${version}.`,
    applied.length ? `Migrations:\n${applied.map(m => [`  ${m.id} — ${m.summary}`, ...(m.notes ?? []).map(n => n.split('\n').map((l, i) => `${i ? '      ' : '    ⚑ '}${l}`).join('\n'))].join('\n')).join('\n')}` : 'Migrations: none pending.',
    rendered.length ? `Re-rendered: ${rendered.join(', ')}` : 'Re-rendered: nothing differed.',
    `Check passed: ${check}`];

  // 7. --local: a diff. Otherwise: a branch, then ⚑ push and PR.
  if (opts.local) {
    return { data: { ok: true, ...data, mode: 'local' }, text: [...summaryLines, '', 'Left as a working-tree diff on the current branch (--local):', git(['status', '--short']), 'Review it with git diff, then commit.'].join('\n') };
  }
  git(['checkout', '-q', '-b', branch]);
  try {
    git(['add', '-A']);
    git(['commit', '-q', '-m', message]);
  } finally {
    git(['checkout', '-q', current]);
  }
  const sha = git(['rev-parse', '--short', branch]);
  return finish({ ...base, root, branch, base: current, title, yes: opts.yes, env, git, whatsnew: deps.whatsnew, notes: [], check, data: { ...data, commit: sha }, lead: [...summaryLines, '', `Committed ${sha} on ${branch}; ${current} is as it was.`, git(['show', '--stat', '--format=', branch])] });
}

/** Step 7's ⚑ half: the plan without --yes (exit 3), push and PR with it. */
async function finish({ root, from, to, branch, base, title, yes, env, git, whatsnew, notes, check, data, lead, resumed, selfUpdate: self }) {
  const steps = publishPlan({ branch, base, title });
  const head = resumed ? [...notes, `${branch} already holds the update from practice ${from} to ${to} (${git(['rev-parse', '--short', branch])}); ${base} is as it was.`] : lead;
  const out = { root, from, to, selfUpdate: self, mode: 'branch', branch, base, ...(data ?? { changed: false, commit: git(['rev-parse', '--short', branch]), resumed: true }) };
  if (!yes) {
    return {
      data: { ...out, ok: false, needs: 'yes', plan: { steps: steps.map(s => s.what) } },
      text: [...head, '', '⚑ Opening the pull request needs a yes. keel update --yes will:', ...steps.map(s => `  - ${s.what}`),
        'Nothing was pushed. Re-run with --yes to go ahead (it resumes from the branch).'].join('\n'),
      exitCode: 3,
    };
  }
  const message = git(['log', '-1', '--format=%B', branch]);
  const text = whatsnew ? await readFile(whatsnew, 'utf8').catch(() => null) : null;
  const files = git(['diff', '--name-only', `${branch}^`, branch]).split('\n').filter(Boolean);
  const url = await publish({ root, branch, base, title, body: updateBody({ from, to, message, whatsnew: text, check, files }), env });
  return {
    data: { ...out, ok: true, pushed: true, pr: url },
    text: [...head, '', `Pushed ${branch} and opened the pull request: ${url}`].join('\n'),
  };
}

export { WHATSNEW };
