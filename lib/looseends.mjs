// keel loose-ends: everything the owner started and has not finished, across
// keel and every fleet project with a local checkout (phase 24). Read fresh
// every run, never stored; only the person's marks are kept.
//
// Projects: keel's own root, plus each fleet.json `managed` repo found on
// disk — a directory under the parent of keel's checkout (or --root), or one
// of their immediate subdirectories, whose .git/config names
// github.com/<repo> as origin. A repo found nowhere is "no local checkout".
//
// Per project:
//   sessions   Claude Code transcripts in <claude>/projects/<dir, every
//              non-alphanumeric as ->/*.jsonl (and its .claude/worktrees/*),
//              <claude> being KEEL_CLAUDE_DIR or ~/.claude. The task's name
//              is the first thing the person typed. A session is listed when
//                - its last activity is newer than the project's last commit
//                  and files it wrote (Write/Edit/NotebookEdit, or its file
//                  history) are still uncommitted;
//                - or its last assistant turn asked the person (an
//                  AskUserQuestion call, or text ending in "?") — the
//                  simple rule the phase leaves deliberately open;
//                - or it stopped mid-work (the last message is a tool call
//                  with no result, or the person's message with no answer).
//              A session that wrote files, none still uncommitted, is done:
//              its work is committed, and it is never listed.
//   git        uncommitted and untracked files (with age, by mtime); local
//              branches not merged into the default branch; extra worktrees.
//   GitHub     open PRs by the gh user, or with a machine prefix (keel/,
//              keel-night/, keel-loop/), with a short timeout; offline is
//              "GitHub not checked", never an error. On keel's own row: the
//              gh user's repos made in the last NEW_REPO_DAYS days that
//              fleet.json does not list (a walk's repo left behind, say).
//              Review comments left unanswered a day or more on open PRs and
//              PRs merged in the last week (the night's reviews_unanswered
//              rule), one item per PR with `keel review <repo>#<n>`.
//   practice   partial phases whose next action names the owner (⚑, or
//              "Owner…"); the newest health page's proposal (in the
//              .keel/keel.json "health" directory, default docs/health); inbox
//              proposals waiting for a person's decision; lessons-table
//              rows not yet in .keel/sent.json (unsent-lessons, with the
//              command that sends them: keel lessons --yes).
//
// Marks are the only thing written, by `mark` alone, in the project's own
// .keel/loose-ends.json (the person commits it): {fingerprint, move, date,
// reason, until?}. drop hides an item for good, park until its date, resume
// sorts it first. A fingerprint never holds transcript text (a session is its
// id), so nothing a chat said leaves the terminal.
//
// Nothing here deletes, commits, closes or resumes anything: each item
// carries one suggested move and the commands to take it, printed.
import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, isAbsolute } from 'node:path';
import { collect } from '../practices/phases/files/scripts/roadmap.mjs';
import { proposals } from './learn.mjs';
import { unsentLessons, healthDirOf, reviewConfigOf, repoReviewArgs, readRepoReviews, unansweredPrs, REVIEW_DAYS } from '../practices/night/files/scripts/keel/lib.mjs';
import { SEND_LESSONS } from '../practices/night/files/scripts/keel/improve.mjs';

export const MARKS = '.keel/loose-ends.json';
export const MOVES = ['resume', 'park', 'drop'];
export const PR_PREFIXES = ['keel/', 'keel-night/', 'keel-loop/'];
const GH_TIMEOUT = 10_000;
export const NEW_REPO_DAYS = 14;
const NAME_WIDTH = 80;
const DAY = 86_400_000;

export class LooseEndsError extends Error {
  constructor(message, exitCode = 2) { super(message); this.exitCode = exitCode; }
}

// ---- processes ----------------------------------------------------------------

function exec(cmd, args, { env, timeout = 30_000, cwd } = {}) {
  return new Promise(done => {
    execFile(cmd, args, { env, cwd, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      done(error ? { ok: false, why: String(stderr || error.message).trim().split('\n').filter(Boolean).pop() ?? 'failed', stdout: stdout ?? '' }
        : { ok: true, stdout });
    });
  });
}
const git = (dir, args, env) => exec('git', ['-C', dir, ...args], { env });

// ---- finding checkouts --------------------------------------------------------

/** owner/name from a GitHub remote URL, or null. */
export function repoOf(url) {
  const m = /github\.com[:/]+([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(String(url ?? '').trim());
  return m ? m[1].toLowerCase() : null;
}

/** The origin URL in <dir>/.git/config, read without spawning git (a .git file is a worktree: skipped). */
async function originOf(dir) {
  try {
    if (!(await stat(join(dir, '.git'))).isDirectory()) return null;
    const text = await readFile(join(dir, '.git', 'config'), 'utf8');
    const section = /\[remote "origin"\]([^[]*)/.exec(text)?.[1] ?? '';
    return /^\s*url\s*=\s*(.+)$/m.exec(section)?.[1]?.trim() ?? null;
  } catch { return null; }
}

/** { 'owner/name' → dir } for every checkout under `parent` and one level below. */
export async function checkouts(parent) {
  const found = new Map();
  const consider = async dir => {
    const repo = repoOf(await originOf(dir));
    if (repo && !found.has(repo)) found.set(repo, dir);
  };
  const subdirs = async dir => (await readdir(dir, { withFileTypes: true }).catch(() => []))
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules').map(e => join(dir, e.name));
  for (const dir of await subdirs(parent)) {
    await consider(dir);
    for (const sub of await subdirs(dir)) await consider(sub);
  }
  return found;
}

/** keel's root plus each managed fleet repo: [{repo, dir|null, home}]. */
async function projects(home, rootOpt) {
  const parent = rootOpt ? resolve(rootOpt) : dirname(home);
  let fleet = [];
  try { fleet = JSON.parse(await readFile(join(home, 'fleet.json'), 'utf8')); } catch (e) {
    if (e.code !== 'ENOENT') throw new LooseEndsError(`fleet.json: ${e.message}`, 1);
  }
  const homeRepo = repoOf(await originOf(home));
  let inbox = null;
  try { inbox = JSON.parse(await readFile(join(home, '.keel', 'keel.json'), 'utf8')).inbox ?? null; } catch { /* no config */ }
  const known = new Set([...fleet.map(r => String(r.repo).toLowerCase()), ...(inbox ? [inbox.toLowerCase()] : []), ...(homeRepo ? [homeRepo] : [])]);
  const out = [{ repo: homeRepo ?? basename(home), dir: home, home: true, known }];
  const managed = fleet.filter(r => r.role === 'managed' && repoOf(`github.com/${r.repo}`) !== homeRepo);
  const found = managed.length ? await checkouts(parent) : new Map();
  for (const r of managed) out.push({ repo: r.repo, dir: found.get(r.repo.toLowerCase()) ?? null });
  return out;
}

// ---- transcripts --------------------------------------------------------------

export const claudeDir = env => env.KEEL_CLAUDE_DIR || join(homedir(), '.claude');
/** Claude Code's project directory name for a path: every non-alphanumeric becomes "-". */
export const encodeDir = dir => resolve(dir).replace(/[^a-zA-Z0-9]/g, '-');

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const textOf = content => typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter(c => c?.type === 'text').map(c => c.text ?? '').join('\n') : '';
const cleanName = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * A transcript's entries, each with its 1-based line number: [{ line, entry }].
 * A torn line (a session still writing) is skipped. keel retro reads with this too.
 */
export function transcriptEntries(text) {
  const out = [];
  text.split('\n').forEach((raw, i) => {
    if (!raw.trim()) return;
    try { out.push({ line: i + 1, entry: JSON.parse(raw) }); } catch { /* a torn last line */ }
  });
  return out;
}

/**
 * One transcript → { id, cwd, name, lastAt, touched: [abs paths], ending,
 * committedInSession } or null when it has no conversation. ending is
 * 'question', 'mid-work' or 'done'. The name stays in memory and on stdout.
 */
export function parseSession(text, fallbackId) {
  const entries = transcriptEntries(text).map(e => e.entry);
  let id = null, cwd = null, name = null, lastAt = 0, branch = null;
  const touched = new Set();
  const messages = [];
  for (const e of entries) {
    id ??= e.sessionId ?? null;
    if (!cwd && typeof e.cwd === 'string') cwd = e.cwd;
    if (!branch && typeof e.gitBranch === 'string' && e.gitBranch) branch = e.gitBranch;
    const t = Date.parse(e.timestamp ?? '');
    if (t > lastAt) lastAt = t;
    if (e.type === 'file-history-snapshot') for (const p of Object.keys(e.snapshot?.trackedFileBackups ?? {})) touched.add(p);
    if ((e.type !== 'user' && e.type !== 'assistant') || !e.message || e.isSidechain) continue;
    messages.push(e);
    const content = Array.isArray(e.message.content) ? e.message.content : [];
    if (e.type === 'assistant') {
      for (const c of content) {
        if (c?.type !== 'tool_use' || !WRITE_TOOLS.has(c.name)) continue;
        const p = c.input?.file_path ?? c.input?.notebook_path;
        if (typeof p === 'string') touched.add(p);
      }
    } else if (name === null && !e.isMeta && !content.some(c => c?.type === 'tool_result')) {
      const n = cleanName(textOf(e.message.content));
      if (n) name = n;
    }
  }
  if (!messages.length) return null;
  const abs = [...new Set([...touched].map(p => isAbsolute(p) ? p : resolve(cwd ?? '/', p)))];
  return { id: id ?? fallbackId, cwd, name: name ?? '(no message)', branch, lastAt, touched: abs, ending: endingOf(messages) };
}

/** How the main thread ended: 'question', 'mid-work' or 'done'. */
function endingOf(messages) {
  const last = messages.at(-1);
  const parts = m => Array.isArray(m.message.content) ? m.message.content : [{ type: 'text', text: textOf(m.message.content) }];
  const isResult = m => parts(m).some(c => c?.type === 'tool_result');
  // The final assistant turn: every assistant entry after the person last spoke.
  let i = messages.length - 1;
  while (i >= 0 && !(messages[i].type === 'user' && !isResult(messages[i]) && !messages[i].isMeta)) i--;
  const turn = messages.slice(i + 1).filter(m => m.type === 'assistant');
  if (turn.some(m => parts(m).some(c => c?.type === 'tool_use' && c.name === 'AskUserQuestion'))) return 'question';
  if (last.type === 'assistant' && parts(last).some(c => c?.type === 'tool_use')) return 'mid-work';
  if (last.type === 'user' && !isResult(last) && !last.isMeta) return 'mid-work';
  const said = turn.flatMap(m => parts(m)).filter(c => c?.type === 'text' && c.text?.trim()).at(-1)?.text.trim() ?? '';
  if (said.endsWith('?')) return 'question';
  return 'done';
}

/** Every main-thread session of a project directory, its worktrees, and its .claude/worktrees. */
async function sessionsOf(dir, worktrees, env) {
  const base = join(claudeDir(env), 'projects');
  const enc = encodeDir(dir), wts = new Set(worktrees.map(encodeDir));
  const dirs = (await readdir(base).catch(() => [])).filter(n => n === enc || wts.has(n) || n.startsWith(`${enc}--claude-worktrees-`));
  const out = [];
  for (const d of dirs) {
    for (const f of (await readdir(join(base, d)).catch(() => [])).filter(n => n.endsWith('.jsonl'))) {
      const s = parseSession(await readFile(join(base, d, f), 'utf8').catch(() => ''), f.replace(/\.jsonl$/, ''));
      if (s) out.push(s);
    }
  }
  return out;
}

// ---- git ---------------------------------------------------------------------

/** [{path, abs, kind}] from status -z, and the files' ages. */
async function dirty(dir, env) {
  const r = await git(dir, ['status', '--porcelain=v1', '-z', '-uall'], env);
  if (!r.ok) return null;
  const out = [];
  const parts = r.stdout.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.length < 4) continue;
    const xy = p.slice(0, 2), path = p.slice(3);
    if (xy[0] === 'R' || xy[0] === 'C') i++; // the rename's source follows
    const kind = xy === '??' ? 'untracked' : xy.includes('D') ? 'deleted' : xy.includes('A') ? 'added' : xy.includes('U') ? 'conflicted' : 'modified';
    const abs = join(dir, path);
    const mtime = (await stat(abs).catch(() => null))?.mtimeMs ?? null;
    out.push({ path, abs, kind, mtime });
  }
  return out;
}

async function defaultBranch(dir, env) {
  const head = await git(dir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], env);
  if (head.ok && head.stdout.trim()) return head.stdout.trim().replace(/^origin\//, '');
  for (const b of ['main', 'master']) if ((await git(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`], env)).ok) return b;
  const cur = await git(dir, ['branch', '--show-current'], env);
  return cur.ok ? cur.stdout.trim() || null : null;
}

async function gitState(dir, env) {
  const [files, last, base, wt] = await Promise.all([
    dirty(dir, env),
    git(dir, ['log', '-1', '--format=%ct'], env),
    defaultBranch(dir, env),
    git(dir, ['worktree', 'list', '--porcelain'], env),
  ]);
  let branches = [];
  if (base) {
    const r = await git(dir, ['for-each-ref', `--no-merged=refs/heads/${base}`, '--format=%(refname:short)%09%(committerdate:unix)', 'refs/heads'], env);
    if (r.ok) branches = r.stdout.split('\n').filter(Boolean).map(l => { const [name, t] = l.split('\t'); return { name, at: Number(t) * 1000 }; });
  }
  const worktrees = [];
  if (wt.ok) {
    const blocks = wt.stdout.split('\n\n').filter(b => b.trim());
    for (const b of blocks.slice(1)) {
      const path = /^worktree (.+)$/m.exec(b)?.[1];
      if (!path) continue;
      worktrees.push({ path, branch: /^branch refs\/heads\/(.+)$/m.exec(b)?.[1] ?? null, prunable: /^prunable/m.test(b) });
    }
  }
  return { files: files ?? [], lastCommit: last.ok ? Number(last.stdout.trim()) * 1000 : 0, base, branches, worktrees, ok: files !== null };
}

// ---- GitHub ------------------------------------------------------------------

async function ghLogin(env) {
  const r = await exec(env.KEEL_GH || 'gh', ['api', 'user', '-q', '.login'], { env, timeout: GH_TIMEOUT });
  return r.ok ? { login: r.stdout.trim() } : { why: r.why };
}
async function openPrs(repo, login, env) {
  const r = await exec(env.KEEL_GH || 'gh', ['pr', 'list', '-R', repo, '--state', 'open', '--limit', '100',
    '--json', 'url,title,headRefName,author,createdAt,isDraft'], { env, timeout: GH_TIMEOUT });
  if (!r.ok) return { why: r.why };
  try {
    const prs = JSON.parse(r.stdout);
    return { prs: prs.filter(p => p.author?.login === login || PR_PREFIXES.some(x => p.headRefName?.startsWith(x))) };
  } catch { return { why: 'gh gave no JSON' }; }
}

/**
 * PRs (open, or merged in the last REVIEW_DAYS days) with review comments left
 * unanswered for a day or more: the night's reviews_unanswered rule, read live.
 */
async function unansweredReviews(repo, dir, env, now) {
  let reviewers = [];
  try { const c = reviewConfigOf(JSON.parse(await readFile(join(dir, '.keel', 'keel.json'), 'utf8'))); if (!c.problem) reviewers = c.reviewers; } catch { /* no config: no conversation comments read */ }
  const page = async vars => {
    const r = await exec(env.KEEL_GH || 'gh', repoReviewArgs(repo, vars), { env, timeout: GH_TIMEOUT });
    if (!r.ok) throw new Error(r.why);
    let out;
    try { out = JSON.parse(r.stdout); } catch { throw new Error('gh gave no JSON'); }
    return out?.data?.repository;
  };
  try { return { prs: unansweredPrs(await readRepoReviews(page, today(now)), reviewers, today(now)).prs }; } catch (e) { return { why: e.message }; }
}

/** The gh user's repos made lately that keel's fleet does not know. */
async function newRepos(login, known, env, now) {
  const r = await exec(env.KEEL_GH || 'gh', ['repo', 'list', login, '--limit', '200', '--json', 'nameWithOwner,createdAt,isArchived'], { env, timeout: GH_TIMEOUT });
  if (!r.ok) return { why: r.why };
  try {
    return { repos: JSON.parse(r.stdout).filter(x => !x.isArchived && !known.has(x.nameWithOwner.toLowerCase())
      && now - Date.parse(x.createdAt) < NEW_REPO_DAYS * DAY) };
  } catch { return { why: 'gh gave no JSON' }; }
}

// ---- the practice ------------------------------------------------------------

const OWNER = /^\s*(⚑|owner\b)/i;

async function practice(dir) {
  const items = [];
  if (!(await stat(join(dir, '.keel', 'keel.json')).catch(() => null))) return items;
  try {
    const { phases } = await collect(dir);
    for (const p of phases) {
      if (p.status !== 'partial' || !OWNER.test(p.next ?? '')) continue;
      const file = join(dir, 'docs', 'phases', p.file);
      const next = p.next.replace(/\s+/g, ' ').trim();
      items.push({ kind: 'phase', fingerprint: `phase:${p.id}`, phase: Number(p.id), title: `phase ${p.id}: ${p.title}`,
        detail: `next: ${next.length > 140 ? `${next.slice(0, 139)}…` : next}`, next,
        at: Date.parse(p.since ?? '') || null, move: 'the owner\'s step: take it, or say why not', commands: [`less ${file}`] });
    }
  } catch { /* another phases shape: nothing to read here */ }
  // The project's own health directory (.keel/keel.json "health"); a bad one is doctor's to say.
  let healthRel = null;
  try { healthRel = healthDirOf(JSON.parse(await readFile(join(dir, '.keel', 'keel.json'), 'utf8'))); } catch { healthRel = null; }
  const health = healthRel ? join(dir, healthRel) : null;
  const pages = !health ? [] : (await readdir(health).catch(() => [])).filter(n => /^\d{4}-\d{2}-\d{2}\.md$/.test(n)).sort();
  if (pages.length) {
    const page = pages.at(-1);
    const text = await readFile(join(health, page), 'utf8');
    const proposal = text.split(/^## Proposal\s*$/m)[1]?.trim() ?? '';
    const measure = /^\*\*`([a-z0-9_]+)`\*\*/.exec(proposal)?.[1];
    if (measure) {
      items.push({ kind: 'health', fingerprint: `health:${measure}`, title: `health proposal (${page.slice(0, 10)}): ${measure}`,
        at: Date.parse(page.slice(0, 10)), move: 'decide it: make it a phase, or decline it', commands: [`less ${join(health, page)}`] });
    }
  }
  try {
    const waiting = (await proposals(dir)).filter(p => p.meta.status === 'proposed');
    const inbox = await readFile(join(dir, 'docs', 'INBOX.md'), 'utf8').catch(() => '');
    const priv = Number(/^\| proposed \| (\d+) \|$/m.exec(inbox)?.[1] ?? 0);
    const n = waiting.length + priv;
    if (n) {
      items.push({ kind: 'inbox', fingerprint: 'inbox:proposed', title: `${n} inbox proposal${n === 1 ? '' : 's'} waiting for a decision`,
        at: null, move: 'decide them (a person\'s call)', commands: [`cd ${dir} && keel learn`] });
    }
  } catch { /* an unreadable inbox is not a loose end */ }
  // Lessons not yet sent home, by the fingerprint keel lessons files under.
  // The item's fingerprint ignores the count, so a mark holds as rows are added.
  try {
    const config = JSON.parse(await readFile(join(dir, '.keel', 'keel.json'), 'utf8'));
    const u = config.keel === 'self' ? { na: 'keel is home' } : await unsentLessons(dir, config);
    if (!u.na && u.unsent.length) {
      const n = u.unsent.length;
      items.push({ kind: 'lessons', fingerprint: `unsent-lessons:${u.project}`, title: `${n} lesson${n === 1 ? '' : 's'} not yet sent home`,
        detail: `#${u.unsent.map(r => r.n).join(', #')} of ${u.rows} in ${u.path}`, count: n,
        at: null, move: 'send them home (⚑ yours: it files on keel\'s inbox)',
        commands: [`cd ${dir} && npx -y github:dalmaer/keel lessons --dry-run`, `cd ${dir} && ${SEND_LESSONS}`] });
    }
  } catch { /* an unreadable config or sent.json is doctor's to say */ }
  return items;
}

// ---- marks -------------------------------------------------------------------

export async function readMarks(dir) {
  try {
    const m = JSON.parse(await readFile(join(dir, MARKS), 'utf8'));
    return Array.isArray(m.marks) ? m.marks : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw new LooseEndsError(`${join(dir, MARKS)}: ${e.message}`, 1);
  }
}

const today = now => new Date(now).toISOString().slice(0, 10);
/** What a mark does to an item today: 'resume', 'hidden', or null. */
function effect(mark, now) {
  if (!mark) return null;
  if (mark.move === 'drop') return 'hidden';
  if (mark.move === 'park') return mark.until && mark.until > today(now) ? 'hidden' : null;
  return mark.move === 'resume' ? 'resume' : null;
}

// ---- the scan ----------------------------------------------------------------

const idOf = (repo, fp) => createHash('sha1').update(`${repo}\0${fp}`).digest('hex').slice(0, 6);
const phaseIn = s => { const m = /\bphase[-_ /]?(\d+)\b/i.exec(s ?? ''); return m ? Number(m[1]) : null; };
const ago = (ms, now) => {
  if (!ms) return '';
  const d = Math.max(0, now - ms);
  return d < 3_600_000 ? `${Math.round(d / 60_000)}m` : d < DAY ? `${Math.round(d / 3_600_000)}h` : `${Math.round(d / DAY)}d`;
};

async function scanProject(p, { env, login, now }) {
  const result = { repo: p.repo, dir: p.dir, checkout: !!p.dir, github: null, items: [], notes: [] };
  if (!p.dir) return result;
  const dir = p.dir;
  const [g, prac, marks] = await Promise.all([gitState(dir, env), practice(dir), readMarks(dir)]);
  const sessions = await sessionsOf(dir, g.worktrees.map(w => w.path), env);
  const items = [];
  // Every dirty path this run knows of, with the session cwd's own repo read when it is elsewhere (a worktree).
  const dirtyAbs = new Set(g.files.map(f => f.abs));
  const otherRepos = new Map();
  for (const s of sessions) {
    if (!s.cwd || resolve(s.cwd) === resolve(dir)) continue;
    if (!(await stat(s.cwd).catch(() => null))) { s.gone = true; continue; }
    if (!otherRepos.has(s.cwd)) otherRepos.set(s.cwd, await gitState(s.cwd, env));
    for (const f of otherRepos.get(s.cwd).files) dirtyAbs.add(f.abs);
  }
  const owner = new Map();
  let gone = 0, committed = 0;
  for (const s of sessions) {
    if (s.gone) { gone++; continue; }
    const open = s.touched.filter(f => dirtyAbs.has(f));
    if (s.touched.length && !open.length) { committed++; continue; } // its work is committed
    const lastCommit = s.cwd && otherRepos.has(s.cwd) ? otherRepos.get(s.cwd).lastCommit : g.lastCommit;
    const why = [];
    if (open.length && s.lastAt > lastCommit) why.push(`${open.length} file${open.length === 1 ? '' : 's'} it wrote still uncommitted`);
    if (s.ending === 'question') why.push('ended on a question to you');
    if (s.ending === 'mid-work') why.push('stopped mid-work');
    if (!why.length) continue;
    const at = s.cwd ?? dir;
    for (const f of open) owner.set(f, s.id);
    const name = s.name.length > NAME_WIDTH ? `${s.name.slice(0, NAME_WIDTH - 1)}…` : s.name;
    items.push({ kind: 'session', fingerprint: `session:${s.id}`, session: s.id, ending: s.ending, title: name, name: s.name,
      phase: phaseIn(s.name) ?? phaseIn(s.branch), at: s.lastAt, detail: why.join('; '), files: open.map(f => f.startsWith(`${at}/`) ? f.slice(at.length + 1) : f),
      move: s.ending === 'question' ? 'answer it' : s.ending === 'mid-work' ? 'resume it where it stopped' : 'resume it to finish and commit',
      commands: [`cd ${at} && claude --resume ${s.id}`] });
  }
  if (gone) result.notes.push(`${gone} session${gone === 1 ? '' : 's'} in a worktree that is gone: not listed`);
  result.sessionsCommitted = committed;
  if (!g.ok) result.notes.push('git status could not be read');
  for (const f of g.files) {
    items.push({ kind: 'file', fingerprint: `file:${f.path}:${f.kind}`, title: f.path, detail: `${f.kind}${owner.has(f.abs) ? `, from session ${owner.get(f.abs)}` : ''}`,
      at: f.mtime, move: owner.has(f.abs) ? 'finish it in its session, then commit' : f.kind === 'untracked' ? 'commit it, or ask who wrote it' : 'commit it, or put it back',
      commands: [`git -C ${dir} status`, f.kind === 'untracked' ? `git -C ${dir} add ${f.path}` : `git -C ${dir} diff -- ${f.path}`] });
  }
  const inWorktree = new Set(g.worktrees.map(w => w.branch).filter(Boolean));
  for (const b of g.branches) {
    items.push({ kind: 'branch', fingerprint: `branch:${b.name}`, title: b.name, phase: phaseIn(b.name), at: b.at,
      detail: `not merged into ${g.base}${inWorktree.has(b.name) ? ', checked out in a worktree' : ''}`,
      move: 'open a PR for it, or delete it if it was squash-merged or abandoned',
      commands: [`git -C ${dir} log --oneline ${g.base}..${b.name}`, `git -C ${dir} branch -D ${b.name}   # only when it is done with`] });
  }
  for (const w of g.worktrees) {
    const t = (await stat(w.path).catch(() => null))?.mtimeMs ?? null;
    items.push({ kind: 'worktree', fingerprint: `worktree:${w.path}`, title: w.path, phase: phaseIn(w.branch) ?? phaseIn(w.path), at: t,
      detail: `${w.branch ? `on ${w.branch}` : 'detached'}${w.prunable ? ', prunable' : ''}`,
      move: 'finish the work there, or remove the worktree',
      commands: [`git -C ${w.path} status`, `git -C ${dir} worktree remove ${w.path}   # when done`] });
  }
  if (login.login) {
    const prs = await openPrs(p.repo, login.login, env);
    if (prs.why) result.github = `GitHub not checked: ${prs.why}`;
    else {
      result.github = 'checked';
      for (const pr of prs.prs) {
        items.push({ kind: 'pr', fingerprint: `pr:${pr.url}`, title: pr.title, url: pr.url, phase: phaseIn(pr.title) ?? phaseIn(pr.headRefName),
          at: Date.parse(pr.createdAt) || null, detail: `${pr.headRefName}${pr.isDraft ? ', draft' : ''}`,
          move: 'review it: merge, or close it', commands: [`gh pr view ${pr.url}`, `gh pr checks ${pr.url}`] });
      }
    }
    if (result.github === 'checked') {
      const reviews = await unansweredReviews(p.repo, dir, env, now);
      if (reviews.why) result.notes.push(`reviews not checked: ${reviews.why}`);
      for (const pr of reviews.prs ?? []) {
        items.push({ kind: 'review', fingerprint: `review:${pr.url}`, title: `${pr.unanswered} review comment${pr.unanswered === 1 ? '' : 's'} unanswered on #${pr.number}: ${pr.title}`, url: pr.url,
          phase: phaseIn(pr.title), at: Date.parse(pr.oldest) || null, count: pr.unanswered,
          detail: `${pr.state}${pr.state === 'merged' ? ` in the last ${REVIEW_DAYS} days` : ''}, the oldest from ${pr.oldest}`,
          move: 'validate each against the code, then answer it: fixed, tracked or not valid',
          commands: [`keel review ${p.repo}#${pr.number}`] });
      }
    }
    if (p.home && result.github === 'checked') {
      const fresh = await newRepos(login.login, p.known, env, now);
      if (fresh.why) result.notes.push(`new repos not checked: ${fresh.why}`);
      for (const x of fresh.repos ?? []) {
        items.push({ kind: 'repo', fingerprint: `repo:${x.nameWithOwner}`, title: x.nameWithOwner, at: Date.parse(x.createdAt),
          detail: `made in the last ${NEW_REPO_DAYS} days; not in fleet.json`, move: 'add it to fleet.json, or delete it (⚑ yours)',
          commands: [`gh repo view ${x.nameWithOwner}`, `gh repo delete ${x.nameWithOwner}   # yours to decide`] });
      }
    }
  } else result.github = `GitHub not checked: ${login.why}`;
  items.push(...prac);
  const byFp = new Map(marks.map(m => [m.fingerprint, m]));
  for (const it of items) {
    it.id = idOf(p.repo, it.fingerprint);
    it.project = p.repo;
    it.phase ??= null;
    const m = byFp.get(it.fingerprint);
    if (m) it.mark = m;
    it.state = effect(m, now);
    it.age = ago(it.at, now);
    if (it.at) it.at = new Date(it.at).toISOString();
  }
  result.items = items.sort((a, b) => (b.state === 'resume') - (a.state === 'resume') || String(b.at ?? '').localeCompare(String(a.at ?? '')));
  return result;
}

/** Every project's loose ends: { projects, hidden, shown }. */
export async function scan({ home, root, env = process.env, now = Date.now() }) {
  const list = await projects(home, root);
  const login = await ghLogin(env);
  return Promise.all(list.map(p => scanProject(p, { env, login, now })));
}

// ---- the verb ----------------------------------------------------------------

const KIND_ORDER = ['session', 'phase', 'health', 'inbox', 'lessons', 'review', 'pr', 'repo', 'worktree', 'branch', 'file'];

function itemText(it) {
  const mark = it.mark ? `  [${it.mark.move}${it.mark.until ? ` until ${it.mark.until}` : ''}: ${it.mark.reason}]` : '';
  const head = `  ${it.id}  ${it.kind.padEnd(8)} ${it.kind === 'session' ? `"${it.title}"` : it.title}${it.age ? `  (${it.age})` : ''}${mark}`;
  return [head, ...(it.detail ? [`          ${it.detail}${it.files?.length ? `: ${it.files.slice(0, 4).join(', ')}${it.files.length > 4 ? ', …' : ''}` : ''}`] : []),
    `          → ${it.move}`, ...it.commands.map(c => `            $ ${c}`)].join('\n');
}

export async function looseEnds({ home, root, all = false, phase, env = process.env, now = Date.now() }) {
  const results = await scan({ home, root, env, now });
  let hidden = 0;
  for (const r of results) {
    r.items = r.items.filter(it => {
      if (phase !== undefined && it.phase !== phase) return false;
      if (it.state === 'hidden' && !all) { hidden++; return false; }
      return true;
    });
  }
  const lines = [];
  for (const r of results) {
    if (!r.checkout) { lines.push(`${r.repo} — no local checkout`, ''); continue; }
    lines.push(`${r.repo} — ${r.dir}${r.github === 'checked' ? '' : `  (${r.github})`}`);
    if (!r.items.length) lines.push('  nothing loose');
    const resumed = r.items.filter(i => i.state === 'resume');
    const rest = r.items.filter(i => i.state !== 'resume');
    if (resumed.length) lines.push(' resume first:', ...resumed.map(itemText));
    const phases = [...new Set(rest.map(i => i.phase).filter(n => n !== null))].sort((a, b) => b - a);
    for (const n of phases) lines.push(` phase ${n}:`, ...rest.filter(i => i.phase === n).sort(byKind).map(itemText));
    const loose = rest.filter(i => i.phase === null).sort(byKind);
    if (loose.length && phases.length) lines.push(' other:');
    lines.push(...loose.map(itemText));
    for (const n of r.notes) lines.push(`  note: ${n}`);
    lines.push('');
  }
  const shown = results.reduce((n, r) => n + r.items.length, 0);
  lines.push(`${shown} loose end${shown === 1 ? '' : 's'}${hidden ? `; ${hidden} parked or dropped (--all shows them)` : ''}. Nothing was changed: run the commands you choose.`,
    'Mark one: keel loose-ends mark <id> resume|park|drop --reason "…" [--until YYYY-MM-DD]');
  return { data: { projects: results, shown, hidden }, text: lines.join('\n') };
}
const byKind = (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);

/** Record a mark in the item's project's .keel/loose-ends.json. */
export async function mark({ home, root, id, move, reason, until, env = process.env, now = Date.now() }) {
  if (!MOVES.includes(move)) throw new LooseEndsError(`a mark is one of ${MOVES.join(', ')}`);
  if (!reason || !reason.trim()) throw new LooseEndsError('--reason "…" is required: say why');
  if (until !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new LooseEndsError('--until is a date, YYYY-MM-DD');
  if (move === 'park' && !until) throw new LooseEndsError('park needs --until YYYY-MM-DD');
  if (move !== 'park' && until) throw new LooseEndsError('--until goes with park');
  const results = await scan({ home, root, env, now });
  const hits = results.flatMap(r => r.items.map(it => ({ r, it }))).filter(({ it }) => it.id === id || (id.length >= 4 && it.id.startsWith(id)));
  if (!hits.length) throw new LooseEndsError(`no loose end ${id}; keel loose-ends --all lists them`);
  if (hits.length > 1) throw new LooseEndsError(`${id} matches ${hits.length} loose ends; give more of the id`);
  const { r, it } = hits[0];
  const marks = (await readMarks(r.dir)).filter(m => m.fingerprint !== it.fingerprint);
  const entry = { fingerprint: it.fingerprint, kind: it.kind, move, date: today(now), reason: reason.trim(), ...(until ? { until } : {}) };
  marks.push(entry);
  await mkdir(join(r.dir, '.keel'), { recursive: true });
  await writeFile(join(r.dir, MARKS), `${JSON.stringify({ marks }, null, 2)}\n`);
  return {
    data: { ok: true, id: it.id, project: r.repo, file: join(r.dir, MARKS), mark: entry },
    text: `${it.id} (${it.kind}) marked ${move}${until ? ` until ${until}` : ''} in ${join(r.dir, MARKS)}. Commit it so other machines see it.`,
  };
}
