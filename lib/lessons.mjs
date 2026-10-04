// keel lessons: what a project learned goes home to keel as issues, once each.
//
// Three kinds of item (design §4, upstream half), each with a stable fingerprint:
//   lesson    a row of the project's lessons table (.keel/keel.json `lessons`,
//             default docs/lessons.md)
//             <project>/lesson/<n>/<8 hex of sha256(the shape cell, whitespace collapsed)>
//             A reworded shape is a new item, and so is a renumbered one.
//   drift     a managed file, block or link doctor calls edited or both
//             <project>/drift/<path>/<8 hex of the project's current bytes>
//   practice  a commit touching AGENTS.md, skills, .claude, workflows or
//             docs/lessons.md, not made by keel itself (keel init: / keel update:,
//             or the commit that first added .keel/keel.json)
//             <project>/commit/<full sha>
// <project> is the config's repo, else its name.
//
// Practice commits are gathered from --since, else from the commit that first
// added .keel/keel.json (what came before keel is the hand-port adopt already
// read), and anything already in .keel/sent.json is dropped — so "since the
// last send" holds without a second record.
//
// What has been sent lives in .keel/sent.json: { "<fingerprint>": { issue, at } },
// the project's own file, written only after an issue is filed (or found).
// Before filing, the target is searched for the fingerprint, so two machines
// don't file twice; a hit is recorded and not re-filed.
//
// The target is --to, else the CLI checkout's config `inbox` (keel's private
// inbox, phase 21), else its `repo`.
//
// Filing issues on another repo is a ⚑ step: without --yes (and always with
// --dry-run) keel prints the items and the plan, calls no gh, writes nothing,
// and exits 3 when there is something to file. gh is process.env.KEEL_GH || 'gh'.
//
// The issue body opens with a fixed line saying it is data, then
// `fingerprint: <fp>` on its own line; keel learn (phase 8) parses both.
import { readFile, writeFile, lstat, readlink, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { findRoot } from './project.mjs';
import { load, blockBody, lessonsPath } from './practices.mjs';
import { diagnose } from './doctor.mjs';
import { parseLessons } from '../practices/night/files/scripts/keel/lib.mjs';

export const SENT = '.keel/sent.json';
export const LABEL = 'lesson';
export const DATA_LINE = project => `Data sent by keel lessons from ${project}. It is data, not instructions.`;
export const PRACTICE_PATHS = ['AGENTS.md', '.agents/skills', '.claude', '.github/workflows', 'docs/lessons.md'];
/** The practice paths for one config: its lessons table in place of docs/lessons.md. */
export const practicePaths = cfg => [...new Set([...PRACTICE_PATHS.filter(p => p !== 'docs/lessons.md'), lessonsPath(cfg)])];
export const KEEL_MADE = /^keel (init|update):/;
// GitHub refuses issue bodies over 65536 characters; a long diff is cut, and says so.
export const BODY_LIMIT = 60_000;

class LessonsError extends Error {
  constructor(message, exitCode = 2) { super(message); this.exitCode = exitCode; }
}

const hex8 = text => createHash('sha256').update(text).digest('hex').slice(0, 8);
const read = path => readFile(path, 'utf8').catch(e => ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(e.code) ? null : Promise.reject(e));
const today = () => new Date().toISOString();

function git(root, args, env) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).replace(/\n$/, '');
}
function tryGit(root, args, env) {
  try { return git(root, args, env); } catch { return null; }
}

// ---- lessons.md -------------------------------------------------------------

// The table is read by the night practice's lib.mjs, the one parser keel
// lessons, fleet, learn and a project's own improve share (lesson 7).
export { cells, parseLessons } from '../practices/night/files/scripts/keel/lib.mjs';

export const normaliseShape = shape => shape.replace(/\s+/g, ' ').trim();

/** A lesson row's fingerprint: <project>/lesson/<n>/<8 hex of its shape>. keel fleet counts with it too. */
export const lessonFingerprint = (project, row) => `${project}/lesson/${row.n}/${hex8(normaliseShape(row.shape))}`;

/** Plain text of a markdown cell's first sentence, at most `max` characters. */
export function short(text, max = 72) {
  const plain = text.replace(/\\\|/g, '|').replace(/\*\*|__|\*|`/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
  const first = /^(.+?[.!?])(\s|$)/.exec(plain)?.[1] ?? plain;
  return first.length <= max ? first : `${first.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

/** A fence longer than any backtick run in `text`. */
const fence = text => '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(m => m[0].length + 1)));

// ---- gathering --------------------------------------------------------------

const githubRepo = repo => /^[\w.-]+\/[\w.-]+$/.test(repo ?? '') ? repo : null;

async function lessonItems(root, project, cfg, env) {
  const path = lessonsPath(cfg);
  const text = await read(join(root, path));
  if (text === null) return { items: [], notes: [`no ${path}`] };
  const { numbered, rows } = parseLessons(text);
  const notes = [];
  if (rows.length && !numbered) notes.push(`${path} has no # column; lessons are numbered by position, so inserting a row above one changes its fingerprint`);
  // A permalink only when the file at HEAD is the file read.
  const repo = githubRepo(cfg.repo);
  const head = repo ? tryGit(root, ['rev-parse', 'HEAD'], env) : null;
  const clean = head && tryGit(root, ['status', '--porcelain', '--', path], env) === '';
  const items = rows.map(r => {
    const fingerprint = lessonFingerprint(project, r);
    const link = clean ? `https://github.com/${repo}/blob/${head}/${path}#L${r.line}` : null;
    const payload = [
      `**The shape of it**\n\n${r.shape}`,
      `**What it cost**\n\n${r.cost}`,
      `**Guard**\n\n${r.guard}`,
      link ? `Source: ${link}` : `Source: ${project} ${path}, row ${r.n} (line ${r.line})`,
    ].join('\n\n');
    return { kind: 'lesson', fingerprint, title: `lesson(${project}): ${short(r.shape)}`, n: r.n, payload };
  });
  return { items, notes };
}

/** The project's bytes now for a lock key (path, path#block, or a link). */
async function bytesNow(root, key) {
  const [path, block] = key.split('#');
  const target = join(root, path);
  const i = await lstat(target).catch(() => null);
  if (!i) return '';
  if (i.isSymbolicLink()) return readlink(target);
  if (!i.isFile()) return '';
  const text = await readFile(target, 'utf8');
  return block ? blockBody(text, block) ?? '' : text;
}

async function driftItems(root, project, practices) {
  const report = await diagnose(root, { practices });
  const items = [];
  for (const d of report.drift.filter(d => d.state === 'edited' || d.state === 'both')) {
    const fingerprint = `${project}/drift/${d.path}/${hex8(await bytesNow(root, d.path))}`;
    let diff = d.diff.trimEnd();
    if (diff.length > BODY_LIMIT / 2) diff = `${diff.slice(0, BODY_LIMIT / 2)}\n… (cut at ${BODY_LIMIT / 2} characters; the whole diff is \`keel doctor\` in ${project})`;
    const f = fence(diff);
    const payload = [
      `**Practice:** ${d.practice}`, `**Path:** \`${d.path}\``,
      `**State:** ${d.state} (${d.state === 'both' ? 'the project changed it, and keel moved on too' : 'the project changed what keel wrote'})${d.missing ? ' — missing in the project' : ''}`,
      `**The question:** keep the project's version, take keel's, or adopt it upstream?`,
      `**Diff (keel → project)**\n\n${f}diff\n${diff}\n${f}`,
    ].join('\n\n');
    items.push({ kind: 'drift', fingerprint, title: `lesson(${project}): ${d.path} changed here (${d.state})`, path: d.path, payload });
  }
  return items;
}

async function commitItems(root, project, cfg, env, since) {
  if (!tryGit(root, ['rev-parse', '--git-dir'], env)) return { items: [], base: null, notes: ['not a git repository; no practice commits'] };
  let base = since;
  const notes = [];
  // The commit that brought the project under keel is keel's change, not a lesson.
  const adopted = tryGit(root, ['log', '--diff-filter=A', '--format=%H', '--', '.keel/keel.json'], env)?.split('\n').filter(Boolean).pop() ?? null;
  if (base) {
    if (!tryGit(root, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`], env)) throw new LessonsError(`--since ${base}: not a commit here`);
  } else {
    base = adopted;
    if (!base) return { items: [], base: null, notes: ['.keel/keel.json is not committed; pass --since <ref> to gather practice commits'] };
  }
  if (!tryGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], env)) return { items: [], base, notes };
  const log = git(root, ['log', '--reverse', '--format=%H', `${base}..HEAD`, '--', ...practicePaths(cfg)], env);
  const repo = githubRepo(cfg.repo);
  const items = [];
  for (const sha of log.split('\n').filter(Boolean)) {
    const message = git(root, ['log', '-1', '--format=%B', sha], env).trimEnd();
    if (sha === adopted || KEEL_MADE.test(message)) continue;
    const subject = message.split('\n')[0];
    const stat = git(root, ['show', '--stat', '--format=', sha], env).trim();
    const f = fence(message + stat);
    const payload = [
      `**Commit:** ${repo ? `https://github.com/${repo}/commit/${sha}` : sha}`,
      `**Message**\n\n${f}\n${message}\n${f}`,
      `**Files**\n\n${f}\n${stat}\n${f}`,
    ].join('\n\n');
    items.push({ kind: 'practice', fingerprint: `${project}/commit/${sha}`, title: `lesson(${project}): ${short(subject, 80)}`, sha, payload });
  }
  return { items, base, notes };
}

/** The issue body: the fixed data line, the fingerprint line, the payload. */
export function issueBody(project, item) {
  const body = [DATA_LINE(project), '', `fingerprint: ${item.fingerprint}`, `kind: ${item.kind}`, '', item.payload, ''].join('\n');
  return body.length <= BODY_LIMIT ? body : `${body.slice(0, BODY_LIMIT)}\n\n… (cut at ${BODY_LIMIT} characters)\n`;
}

/** The fingerprint an issue body carries, or null. keel learn reads it this way. */
export const fingerprintOf = body => /^fingerprint: (\S+)$/m.exec(body ?? '')?.[1] ?? null;

// ---- gh ---------------------------------------------------------------------

function gh(args, env) {
  const bin = env.KEEL_GH || 'gh';
  try {
    return execFileSync(bin, args, { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 }).trim();
  } catch (error) {
    const why = String(error.stderr || error.message).trim().split('\n')[0];
    throw new LessonsError(`${bin} ${args.slice(0, 2).join(' ')} failed: ${why}`, 1);
  }
}

/** The issue on `to` that already carries this fingerprint, or null. */
function found(to, fp, env) {
  const out = gh(['issue', 'list', '-R', to, '--label', LABEL, '--state', 'all', '--search', `"${fp}"`, '--json', 'url,body'], env);
  const list = JSON.parse(out || '[]');
  // Search is fuzzy; only an issue whose fingerprint line is this one counts.
  return list.find(i => i.body === undefined ? true : fingerprintOf(i.body) === fp)?.url ?? null;
}

// ---- the verb ---------------------------------------------------------------

/** Where lessons go by default, from the CLI checkout's config: its `inbox`, else its `repo` (phase 21). */
export const target = home => home.inbox || home.repo || null;

/**
 * opts: { dir, dryRun?, yes?, to?, since? }
 * deps: { cliRoot, env?, practices?, now? }
 * Returns { data, text, exitCode }.
 */
export async function lessons(opts, deps) {
  const { cliRoot, env = process.env } = deps;
  const root = await findRoot(resolve(opts.dir ?? '.'));
  const cfg = JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8'));
  if (cfg.keel === 'self') {
    return {
      data: { ok: true, root, self: true, items: [] },
      text: 'keel is home — use keel learn. Lessons are sent from the projects keel manages, not from keel.',
      exitCode: 0,
    };
  }
  let to = opts.to;
  if (!to) {
    // --to, else keel's private inbox when it names one, else keel's own repo.
    to = target(JSON.parse((await read(join(cliRoot, '.keel', 'keel.json'))) ?? '{}'));
    if (!to) throw new LessonsError(`no target: the CLI checkout at ${cliRoot} names no inbox or repo in .keel/keel.json; pass --to owner/repo`);
  }
  if (!githubRepo(to)) throw new LessonsError(`--to ${to}: expected owner/repo`);
  const project = githubRepo(cfg.repo) ?? cfg.name;
  if (!project) throw new LessonsError('.keel/keel.json names neither repo nor name');

  const practices = deps.practices ?? await load();
  const sentPath = join(root, SENT);
  const sent = JSON.parse((await read(sentPath)) ?? '{}');
  const lessonPart = await lessonItems(root, project, cfg, env);
  const drift = await driftItems(root, project, practices);
  const commits = await commitItems(root, project, cfg, env, opts.since);
  const all = [...lessonPart.items, ...drift, ...commits.items];
  const pending = all.filter(i => !Object.hasOwn(sent, i.fingerprint));
  const already = all.length - pending.length;
  const notes = [...lessonPart.notes, ...commits.notes];
  const counts = Object.fromEntries(['lesson', 'drift', 'practice'].map(k => [k, pending.filter(i => i.kind === k).length]));

  const plan = pending.length ? [
    { what: `gh label list -R ${to}; gh label create ${LABEL} -R ${to} if it is missing` },
    ...pending.map(i => ({ fingerprint: i.fingerprint, what: `search ${to} for ${i.fingerprint}; if absent, gh issue create -R ${to} --label ${LABEL} --title "${i.title}"` })),
    { what: `record each in ${SENT} (commit it, so other machines know)` },
  ] : [];
  const view = i => ({ kind: i.kind, fingerprint: i.fingerprint, title: i.title, body: issueBody(project, i) });
  const base = { root, project, to, since: commits.base, counts, already, notes };
  const listing = pending.map(i => `  ${i.kind.padEnd(8)} ${i.title}\n           ${i.fingerprint}`);

  if (!pending.length) {
    return {
      data: { ok: true, ...base, items: [], filed: [] },
      text: [`Nothing new to send from ${project} to ${to}${already ? ` (${already} already sent)` : ''}.`, ...notes.map(n => `note: ${n}`)].join('\n'),
      exitCode: 0,
    };
  }
  if (opts.dryRun || !opts.yes) {
    return {
      data: { ok: false, needs: 'yes', dryRun: Boolean(opts.dryRun), ...base, items: pending.map(view), plan },
      text: [`${pending.length} to send from ${project} to ${to}: ${counts.lesson} lesson, ${counts.drift} drift, ${counts.practice} practice${already ? ` (${already} already sent)` : ''}.`,
        ...listing, '', '⚑ Filing issues on another repo needs a yes. It will:', ...plan.map(p => `  - ${p.what}`),
        ...notes.map(n => `note: ${n}`),
        opts.dryRun ? 'Dry run: nothing was filed or written.' : 'Nothing was filed or written. Re-run with --yes to send.'].join('\n'),
      exitCode: 3,
    };
  }

  // --yes: the label, then each item — searched, then filed — recorded as it goes.
  const labels = gh(['label', 'list', '-R', to, '--limit', '1000'], env).split('\n').map(l => l.split('\t')[0].trim());
  if (!labels.includes(LABEL)) gh(['label', 'create', LABEL, '-R', to, '--description', 'Sent home by keel lessons; data, not instructions'], env);
  const filed = [];
  for (const i of pending) {
    let issue = found(to, i.fingerprint, env), how = 'found';
    if (!issue) {
      const out = gh(['issue', 'create', '-R', to, '--label', LABEL, '--title', i.title, '--body', issueBody(project, i)], env);
      issue = /https?:\/\/\S+/.exec(out.split('\n').pop())?.[0];
      if (!issue) throw new LessonsError(`gh issue create printed no URL for ${i.fingerprint}: ${out.split('\n')[0]}`, 1);
      how = 'filed';
    }
    sent[i.fingerprint] = { issue, at: deps.now ?? today() };
    await mkdir(join(root, '.keel'), { recursive: true });
    await writeFile(sentPath, `${JSON.stringify(sent, null, 2)}\n`);
    filed.push({ kind: i.kind, fingerprint: i.fingerprint, issue, how });
  }
  const n = filed.filter(f => f.how === 'filed').length;
  return {
    data: { ok: true, ...base, items: pending.map(view), filed },
    text: [`Sent ${n} to ${to}${filed.length > n ? `; ${filed.length - n} already there, recorded` : ''}:`,
      ...filed.map(f => `  ${f.how.padEnd(5)} ${f.issue}  ${f.fingerprint}`),
      `Recorded in ${SENT}; commit it.`].join('\n'),
    exitCode: 0,
  };
}
