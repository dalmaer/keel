// keel robot (keel practice `climb`; managed: keel render rewrites it). An
// agent works the issues it is handed: an issue labelled keel:agent that
// holds the rubric (scripts/keel/rubric.mjs) is worked through climb's
// sandbox, one at a time, and the result is a PR on keel/robot-<issue> that
// a person merges (keel phase 54; docs/research/2026-10-09-robot-and-time.md).
// This script is every choice the pass makes; the agent edits code, the
// script decides what it works, what it may spend and what is posted.
// Deterministic, no model, no dependency: Node built-ins, git and gh
// (KEEL_GH stands in for gh).
//
//   node scripts/keel/robot.mjs config                 the robot config, validated
//   node scripts/keel/robot.mjs pick --repo r [--record]   this run's action: work one issue,
//                                   triage the ones that miss the rubric, wait on the budget, or none
//   node scripts/keel/robot.mjs brief --out f          the agent's prompt, from the run's record
//   node scripts/keel/robot.mjs message --agent a --file f --out f   the agent's last message (never printed)
//   node scripts/keel/robot.mjs report --base r --issue n --title t --agent a [--body f]   the PR body, the run's line
//   node scripts/keel/robot.mjs triage --repo r --issues "n n" [--post]   name what each issue misses, once per body
//   node scripts/keel/robot.mjs post --repo r --issue n --message f [--pr url] [--judge result] [--line l] [--run url] [--read iso] [--seen ids]
//   node scripts/keel/climb.mjs guard --job robot --base r   the sandbox, the record rules, the gate
//
// Every subcommand takes --json. Exit: 0 ok; 1 a guard refused; 2 usage, a
// bad config, or GitHub unreadable (pick never guesses).
//
// The rules (keel-robot.yml carries them out):
//   - Off unless .keel/keel.json has "robot": { "on": true, "budgetMinutes": N },
//     N the minutes a week the agent may run. Past it the run waits, green,
//     and says so; the week is the ISO week (Monday 00:00 UTC), and its use is
//     the agent step's minutes in this workflow's runs, every attempt, each by
//     when its agent step started (a rerun of an older run too; this run's own
//     earlier attempts too), read as the Budget line reads them.
//   - Which issue: the oldest open one labelled keel:agent that was never
//     worked, or that has a comment from someone with write access (OWNER,
//     MEMBER, COLLABORATOR; never a bot) since its last run, or was reopened
//     or labelled again since. Its last run is the robot's own comment (its
//     RUN_MARK, posted by the workflow's bot; its cursor, read=, is when that
//     run's pick read the comments, so one made while it worked is not lost).
//   - An issue that misses part of the rubric gets one comment naming what
//     is missing, and is not worked; one per body (its TRIAGE_MARK holds
//     the body's hash), so the same state is never answered twice.
//   - The brief is .agents/climb/ROBOT.md, the issue, the comments from
//     people with write access since its last run, and the open robot PR's
//     diff when there is one (each run starts from the default branch).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { isMain, rootOf, main, passAgentProblems, agentOf, AGENTS, reviewerOf, agentGitArgs, robotAgentMark } from './lib.mjs';
import { prBody } from './pr-body.mjs';
import { sandboxProblems, recordRules, scriptsChanged, treeState, heldProblems, pathsOf, SAFE_GIT } from './tend.mjs';
import { LABEL, triage, missingText } from './rubric.mjs';

export const KEY = 'robot';
export const PREFIX = 'keel/robot-';
export const WORKFLOW = 'keel-robot.yml';
/** The agent's step in keel-robot.yml, by name (lib.mjs BUDGET_STEPS holds it equal). */
export const STEP = 'Work the issue';
export const LIMITS = Object.freeze({ budgetMinutes: [5, 2400], runMinutes: [5, 180] });
export const DEFAULTS = Object.freeze({ runMinutes: 30 });
/** A run needs at least this many minutes of the week left; less, and it waits. */
export const MIN_RUN = 5;
/** The associations the workflow's if: lets through early (a cheap pre-filter only: MEMBER is not write access; writersOf decides). */
export const ASKERS = Object.freeze(['OWNER', 'MEMBER', 'COLLABORATOR']);
/** The workflow's bot: the only author of the robot's own comments. */
export const BOT = 'github-actions[bot]';
export const RUN_MARK = '<!-- keel:robot run -->';
/**
 * The run's mark with its cursor (PR #59): when pick read the issue's
 * comments. A comment made while the run worked comes after the cursor but
 * before the mark is posted, so the next run reads from the cursor, never
 * from when the mark was posted.
 */
export const runMark = (read, seen = [], head) => {
  const parts = isInstant(read) ? [`read=${new Date(read).toISOString()}`, ...(seen.length ? [`seen=${seen.join(',')}`] : [])] : [];
  // The commit the run pushed to keel/robot-<issue> (PR #59): the next run force-pushes only over that.
  if (SHA_RE.test(head ?? '')) parts.push(`head=${head}`);
  return parts.length ? `<!-- keel:robot run ${parts.join(' ')} -->` : RUN_MARK;
};
const SHA_RE = /^[0-9a-f]{40}$/;
const RUN_RE = /<!-- keel:robot run(?: read=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)(?: seen=(\d+(?:,\d+)*))?)?(?: head=([0-9a-f]{40}))? -->/;
/**
 * The commit the robot last pushed to the issue's branch, by its own run
 * marks (the workflow's bot alone), or null (PR #59). The branch is the
 * robot's only while its tip is this commit: anything else there is someone
 * else's work, and is never force-pushed over.
 */
export function pushedHead(comments = []) {
  return comments.filter(fromRobot).map(c => RUN_RE.exec(c.body)?.[3]).filter(Boolean).at(-1) ?? null;
}
/**
 * GitHub's closing keywords and what they name (PR #59): close, fix or
 * resolve (any tense), then #N, owner/repo#N or an issue's URL. In a commit
 * message or a PR's description, merging closes what they name.
 */
const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*:?\s+((?:[\w.-]+\/[\w.-]+)?#\d+|https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+)/gi;
export const closingRefs = text => [...String(text ?? '').matchAll(CLOSING)].map(m => m[1]);
/** A comment's id list as the mark carries it: digits, comma-separated. */
const SEEN = /^\d+(?:,\d+)*$/;
/** A time to the second, as GitHub stamps a comment. */
const second = s => Math.floor(Date.parse(s ?? '') / 1000);
const isInstant = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(v) && Number.isFinite(Date.parse(v));
const TRIAGE_RE = /<!-- keel:robot triage ([0-9a-f]{12}) -->/;
export const triageMark = hash => `<!-- keel:robot triage ${hash} -->`;
/** At most this many triage comments a run. */
export const MAX_TRIAGE = 10;
/** The agent's last message is posted up to this many characters. */
export const MESSAGE_CHARS = 6000;
/** The open PR's diff in the brief, up to this many characters. */
export const DIFF_CHARS = 60_000;
/** The brief's bounds (PR #59): the issue's body, each comment, and the comments in all, in characters. */
export const BODY_CHARS = 16_000;
export const COMMENT_CHARS = 4_000;
export const COMMENTS_CHARS = 16_000;
/** Text cut at `max` characters, saying so and where the rest is. */
const cut = (text, max, what) => (text.length > max ? `${text.slice(0, max)}\n\n… (${what} is cut at ${max} of its ${text.length} characters)` : text);
export const RECORD_DIR = '.keel/robot';
export const RECORD = `${RECORD_DIR}/run.json`;
export const JUDGED = `${RECORD_DIR}/judged.json`;
const PAGE = 100, MAX_PAGES = 5;

export class RobotError extends Error {
  constructor(message, exitCode = 2) { super(`robot: ${message}`); this.exitCode = exitCode; }
}

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---- config ------------------------------------------------------------------

/** What is wrong with .keel/keel.json "robot": [string]. Absent is fine: the robot is off. */
export function robotProblems(config) {
  const r = config?.[KEY];
  if (r === undefined) return [];
  if (!isObject(r)) return ['"robot" must be an object: { "on": true, "budgetMinutes": <minutes a week> }'];
  const out = [];
  const known = ['on', 'budgetMinutes', 'runMinutes', 'agent'];
  for (const k of Object.keys(r)) if (!known.includes(k)) out.push(`"robot" has an unknown key ${k} (${known.join(', ')})`);
  if (r.on !== undefined && typeof r.on !== 'boolean') out.push(`"robot".on must be true or false (got ${JSON.stringify(r.on)})`);
  const whole = (k, [lo, hi]) => Number.isInteger(r[k]) && r[k] >= lo && r[k] <= hi;
  if (r.budgetMinutes === undefined) { if (r.on === true) out.push('"robot".budgetMinutes must say the minutes a week the agent may run: the robot spends model tokens, so it has no default'); }
  else if (!whole('budgetMinutes', LIMITS.budgetMinutes)) out.push(`"robot".budgetMinutes must be a whole number of minutes a week from ${LIMITS.budgetMinutes[0]} to ${LIMITS.budgetMinutes[1]} (got ${JSON.stringify(r.budgetMinutes)})`);
  if (r.runMinutes !== undefined && !whole('runMinutes', LIMITS.runMinutes)) out.push(`"robot".runMinutes must be a whole number from ${LIMITS.runMinutes[0]} to ${LIMITS.runMinutes[1]} (got ${JSON.stringify(r.runMinutes)})`);
  // The agent that works the issues (phase 45): listed in "agents", and one that can commit.
  return [...out, ...passAgentProblems(config, KEY)];
}

/** The robot's settings, defaults filled in; null when it is off. A bad "robot" throws (exit 2). */
export function robotConfigOf(config) {
  const problems = robotProblems(config);
  if (problems.length) throw new RobotError(`.keel/keel.json: ${problems.join('; ')}`);
  const r = config?.[KEY];
  if (!isObject(r) || r.on !== true) return null;
  return { budgetMinutes: r.budgetMinutes, runMinutes: Math.min(r.runMinutes ?? DEFAULTS.runMinutes, r.budgetMinutes), agent: agentOf(config, KEY) };
}

const OFF = 'the robot is off: .keel/keel.json has no "robot": { "on": true, "budgetMinutes": N }';

// ---- the week ------------------------------------------------------------------

/** The ISO week's start (Monday 00:00 UTC) of `now`. */
export function weekStart(now = new Date()) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
}

/** The ISO week's name: 2026-W41. */
export function isoWeek(now = new Date()) {
  const d = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - jan4) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * The agent step's use over these runs (each { jobs }, as the API gives
 * them): every run whose "Work the issue" step ran, whatever its check said
 * (an agent that stopped with an error still spent its minutes). Pure.
 * { seconds, minutes (rounded up), runs }.
 */
export function weekUse(runs, { since = null } = {}) {
  let seconds = 0, counted = 0;
  const from = since ? Date.parse(since) : -Infinity;
  for (const r of Array.isArray(runs) ? runs : []) {
    const u = agentStep(r?.jobs);
    // PR #59: an attempt counts in the week its agent step started, whenever its run was created.
    if (u && u.start >= from) { seconds += u.seconds; counted++; }
  }
  return { seconds, minutes: Math.ceil(seconds / 60), runs: counted };
}

/**
 * One attempt's agent step: { start (ms), seconds }, or null when it never
 * ran (no such step, skipped, no times). Read as lib.mjs stepUse reads it,
 * with the start kept, so an attempt is counted by its own time.
 */
export function agentStep(jobs) {
  for (const job of Array.isArray(jobs) ? jobs : []) for (const s of Array.isArray(job?.steps) ? job.steps : []) {
    if (s?.name !== STEP || s.conclusion === 'skipped') continue;
    const from = Date.parse(s.started_at ?? s.startedAt ?? ''), to = Date.parse(s.completed_at ?? s.completedAt ?? '');
    if (Number.isFinite(from) && Number.isFinite(to) && to >= from) return { start: from, seconds: (to - from) / 1000 };
  }
  return null;
}

/** How far back a run may be rerun (GitHub's limit): a run created that long ago can still spend this week. */
export const RERUN_DAYS = 30;

/** What the budget allows this run: { wait, minutes, used, left, line }. Pure. */
export function budgetFor({ budgetMinutes, runMinutes }, use, now = new Date()) {
  const week = isoWeek(now);
  const left = budgetMinutes - use.minutes;
  if (left < MIN_RUN) {
    const next = new Date(weekStart(now).getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
    return { wait: true, minutes: 0, used: use.minutes, left: Math.max(0, left), line: `the robot waits: it used ${use.minutes} of its ${budgetMinutes} minutes in ${week} (${use.runs} run${use.runs === 1 ? '' : 's'}), less than ${MIN_RUN} are left; it starts again on ${next}` };
  }
  const minutes = Math.min(runMinutes, Math.floor(left));
  return { wait: false, minutes, used: use.minutes, left, line: `${use.minutes} of ${budgetMinutes} minutes used in ${week}; this run may use ${minutes}` };
}

// ---- an issue's state --------------------------------------------------------------

const isBot = c => c?.user?.type === 'Bot' || /\[bot\]$/i.test(c?.user?.login ?? '');
const fromRobot = c => c?.user?.login === BOT && typeof c.body === 'string';
const at = s => Date.parse(s ?? '');
export const bodyHash = body => createHash('sha256').update(String(body ?? '').replace(/\r\n/g, '\n').trim()).digest('hex').slice(0, 12);
/**
 * Write access, as GitHub's permission says it (PR #59): admin, maintain or
 * write. author_association is not that (MEMBER is anyone in the org, with
 * whatever access), so the workflow's if: uses it only to skip early, and
 * the script asks GitHub (writersOf). A writer predicate takes a login.
 */
export const WRITE = Object.freeze(['admin', 'maintain', 'write']);
/** Nobody: the default of every pure rule here, so a caller that forgets to ask GitHub fails closed. */
const NOBODY = () => false;
/** A comment that may start a run and reaches the brief: a person with write access (`writer`), never a bot. */
export const fromWriter = (c, writer = NOBODY) => !isBot(c) && writer(c?.user?.login);
/** The writer predicate pick and the triage use: each login's permission, read once from GitHub. */
export function writersOf(github, repo) {
  const known = new Map();
  return login => {
    if (typeof login !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(login)) return false;
    const k = login.toLowerCase();
    if (!known.has(k)) known.set(k, WRITE.includes(github.permission(repo, login)));
    return known.get(k);
  };
}

/**
 * One issue's state, pure, from its REST shape and its comments (oldest
 * first): { number, title, kind, … }. kind is
 *   triage        it misses part of the rubric, and this body has no triage comment yet;
 *   waits-rubric  it misses part, and this body was answered already;
 *   work          never worked, or a writer commented since its last run;
 *   worked        worked, and nobody with write access has said more since.
 * `comments` on work are the writers' comments since the last run.
 */
export function issueState(issue, comments = [], { writer = NOBODY } = {}) {
  const base = { number: issue.number, title: String(issue.title ?? ''), url: issue.html_url ?? null, created: issue.created_at ?? null, hash: bodyHash(issue.body) };
  const mine = comments.filter(fromRobot);
  // The last run: its mark's cursor (when that run read the comments), else when the mark was posted.
  const mark = mine.map(c => ({ c, m: RUN_RE.exec(c.body) })).filter(x => x.m).at(-1);
  const lastRun = mark ? (mark.m[1] && at(mark.m[1]) <= at(mark.c.created_at) ? mark.m[1] : mark.c.created_at) ?? null : null;
  // The comments that run read in its cursor's own second (seen=): GitHub stamps a comment to the second, so
  // that second is read again (>=), and these, already read, are left out by id (PR #59).
  const seen = new Set(mark?.m[2] ? mark.m[2].split(',') : []);
  const missing = triage(issue.body);
  if (missing.length) {
    const hash = bodyHash(issue.body);
    const answered = mine.some(c => TRIAGE_RE.exec(c.body)?.[1] === hash);
    return { ...base, kind: answered ? 'waits-rubric' : 'triage', missing, hash };
  }
  const writers = comments.filter(c => fromWriter(c, writer));
  const since = lastRun ? writers.filter(c => second(c.created_at) >= second(lastRun) && !seen.has(String(c.id))) : writers;
  if (!lastRun) return { ...base, kind: 'work', fresh: true, lastRun, comments: since };
  if (since.length) return { ...base, kind: 'work', fresh: false, lastRun, comments: since };
  return { ...base, kind: 'worked', lastRun };
}

/**
 * A worked issue reopened, or labelled keel:agent again, since its last run
 * by a person with write access (`writer`, PR #59: anyone who wrote an
 * issue can close and reopen it; a bot's event never counts) is work again,
 * with no new comment. `events` is the issue's events API list. Pure.
 */
export function againSince(state, events = [], { writer = NOBODY } = {}) {
  if (state.kind !== 'worked') return state;
  const again = events.find(e => at(e?.created_at) > at(state.lastRun) && e?.actor?.type !== 'Bot' && !/\[bot\]$/i.test(e?.actor?.login ?? '') && writer(e?.actor?.login)
    && (e.event === 'reopened' || (e.event === 'labeled' && e.label?.name === LABEL)));
  return again ? { ...state, kind: 'work', fresh: false, again: again.event, comments: [] } : state;
}

/** What a run does with these states (oldest issue first): every triage to post, and the one issue to work. Pure. */
export function choose(states) {
  return {
    triage: states.filter(s => s.kind === 'triage' || s.kind === 'unapproved').slice(0, MAX_TRIAGE).map(s => s.number),
    work: states.find(s => s.kind === 'work') ?? null,
    waiting: states.filter(s => s.kind === 'worked' || s.kind === 'waits-rubric' || s.kind === 'waits-approval').map(s => s.number),
  };
}

// ---- who approved the body --------------------------------------------------------------
//
// PR #59: the label is the approval. Only someone who can label issues puts keel:agent on one, but anyone
// who wrote the issue can edit its body after. So the body worked is one a person approved: unedited since
// a person with write access (never a bot) last put keel:agent on it, or last edited by a person with write
// access (GitHub's permission, writersOf). Otherwise one comment asks a writer to put the label on again,
// and the issue is not worked.

const APPROVE_RE = /<!-- keel:robot approve ([0-9a-f]{12}) -->/;
export const approveMark = hash => `<!-- keel:robot approve ${hash} -->`;

/**
 * Whether the body as it stands was approved, pure: { ok, why }. `a` is
 * what GitHub says of the issue: { author, authorAssociation, lastEditedAt,
 * editor, labels: [{ at, actor, bot }] } (the keel:agent labelled events).
 */
export function approvalOf(a, { writer = NOBODY } = {}) {
  const label = (a?.labels ?? []).filter(l => l?.actor && !l.bot && Number.isFinite(at(l.at)) && writer(l.actor)).sort((x, y) => at(x.at) - at(y.at)).at(-1);
  if (!label) return { ok: false, why: `no ${LABEL} label put on it by a person with write access was found` };
  // Strictly after (PR #59): an edit GitHub dates the same second as the label may have come after it.
  if (!a.lastEditedAt || at(a.lastEditedAt) < at(label.at)) return { ok: true, why: `${label.actor} put ${LABEL} on it after its last edit` };
  if (writer(a.editor)) return { ok: true, why: `last edited by ${a.editor}, who has write access` };
  return { ok: false, why: `its body was last edited ${a.lastEditedAt}${a.editor ? ` by ${a.editor}` : ''}, after ${label.actor} put ${LABEL} on it (${label.at}), and that editor has no write access` };
}

/** A state that would be worked, held to its approval (PR #59): unapproved, answered once per body. Pure. */
export function withApproval(state, approval, comments = [], { writer = NOBODY } = {}) {
  if (state.kind !== 'work') return state;
  const v = approvalOf(approval, { writer });
  if (v.ok) return { ...state, approved: v.why };
  const answered = comments.some(c => fromRobot(c) && APPROVE_RE.exec(c.body)?.[1] === state.hash);
  return { ...state, kind: answered ? 'waits-approval' : 'unapproved', unapproved: v.why };
}

/** The comment an unapproved issue gets, once per body. */
export const approvalText = (hash, why) => `${approveMark(hash)}\nThis issue is labelled \`${LABEL}\`, but ${why}. So the robot will not work it as it stands: a person with write access reads the body and puts \`${LABEL}\` on it again (remove it, then add it), which approves this body.\n`;

const APPROVAL_QUERY = `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) {
  author { login } authorAssociation lastEditedAt editor { login }
  timelineItems(itemTypes: [LABELED_EVENT], last: 100) { nodes { ... on LabeledEvent { createdAt label { name } actor { __typename login } } } } } } }`;

// ---- reading GitHub ------------------------------------------------------------------

function ghRun(env, args, input) {
  const gh = env.KEEL_GH || 'gh';
  const r = spawnSync(gh, args, { env, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new RobotError(`gh ${args[0]}: ${r.error.code === 'ENOENT' ? `gh is not installed (${gh})` : r.error.message}; the robot never guesses`);
  if (r.status !== 0) throw new RobotError(`gh ${args.slice(0, 2).join(' ')} exited ${r.status}${(r.stderr || r.stdout || '').trim() ? `: ${(r.stderr || r.stdout).trim().split('\n')[0]}` : ''}; the robot never guesses`);
  return r.stdout;
}

/** GitHub through gh: the reads pick needs, every list read whole or not at all. */
export function githubOf(env = process.env) {
  const api = path => {
    const out = ghRun(env, ['api', path]);
    try { return JSON.parse(out); } catch { throw new RobotError(`gh api ${path.split('?')[0]} did not print JSON`); }
  };
  const pages = (path, key, max = MAX_PAGES) => {
    const all = [];
    for (let p = 1; p <= max; p++) {
      const got = api(`${path}${path.includes('?') ? '&' : '?'}per_page=${PAGE}&page=${p}`);
      const list = key ? got?.[key] : got;
      if (!Array.isArray(list)) throw new RobotError(`gh api ${path.split('?')[0]} did not come back as a list`);
      all.push(...list);
      if (list.length < PAGE) return all;
    }
    throw new RobotError(`gh api ${path.split('?')[0]}: more than ${PAGE * max} entries; the read is incomplete, and the robot never guesses`);
  };
  return {
    issues: repo => pages(`repos/${repo}/issues?labels=${encodeURIComponent(LABEL)}&state=open&sort=created&direction=asc`).filter(i => !i.pull_request),
    issue: (repo, n) => api(`repos/${repo}/issues/${n}`),
    comments: (repo, n) => pages(`repos/${repo}/issues/${n}/comments`),
    events: (repo, n) => pages(`repos/${repo}/issues/${n}/events`),
    runs: (repo, since) => pages(`repos/${repo}/actions/workflows/${WORKFLOW}/runs?status=completed&created=${encodeURIComponent(`>=${since}`)}`, 'workflow_runs', 20),
    // One attempt's jobs: the run's own jobs endpoint answers only its latest attempt (PR #59).
    jobs: (repo, id, attempt = 1) => {
      const j = api(`repos/${repo}/actions/runs/${id}/attempts/${attempt}/jobs?per_page=100`)?.jobs;
      if (!Array.isArray(j)) throw new RobotError(`gh api: run ${id} attempt ${attempt} came back without its jobs`);
      return j;
    },
    openPr: (repo, branch) => {
      const [owner] = repo.split('/');
      const list = api(`repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`);
      if (!Array.isArray(list)) throw new RobotError('gh api pulls did not come back as a list');
      return list[0] ? { number: list[0].number, url: list[0].html_url } : null;
    },
    prDiff: (repo, n) => ghRun(env, ['pr', 'diff', String(n), '--repo', repo]),
    // A login's permission on the repo (PR #59): admin, maintain, write, triage, read, or none (not a collaborator).
    permission: (repo, login) => {
      const gh = env.KEEL_GH || 'gh';
      const r = spawnSync(gh, ['api', `repos/${repo}/collaborators/${encodeURIComponent(login)}/permission`], { env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      if (r.error) throw new RobotError(`gh api: ${r.error.code === 'ENOENT' ? `gh is not installed (${gh})` : r.error.message}; the robot never guesses`);
      if (r.status !== 0) {
        if (/\b404\b|not found|is not a user/i.test(`${r.stderr}${r.stdout}`)) return 'none';
        throw new RobotError(`gh api repos/${repo}/collaborators/${login}/permission exited ${r.status}: ${(r.stderr || r.stdout || '').trim().split('\n')[0]}; the robot never guesses`);
      }
      let v;
      try { v = JSON.parse(r.stdout); } catch { throw new RobotError('gh api collaborators permission did not print JSON'); }
      // role_name tells maintain and triage apart, but an organization's custom role names itself (PR #59):
      // then the base permission (admin, write, read, none) is the level it grants.
      return ['admin', 'maintain', 'write', 'triage', 'read'].includes(v?.role_name) ? v.role_name : String(v?.permission || 'none');
    },
    // Who wrote and edited the body, and who labelled it when (PR #59): GraphQL, read whole or not at all.
    approval: (repo, n) => {
      const [owner, name] = repo.split('/');
      const out = ghRun(env, ['api', 'graphql', '-f', `query=${APPROVAL_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${n}`]);
      let data;
      try { data = JSON.parse(out); } catch { throw new RobotError('gh api graphql did not print JSON'); }
      if (data?.errors?.length) throw new RobotError(`gh api graphql: ${String(data.errors[0]?.message ?? 'an error').split('\n')[0]}; the robot never guesses`);
      const i = data?.data?.repository?.issue;
      if (!i || !Array.isArray(i.timelineItems?.nodes)) throw new RobotError(`gh api graphql: issue #${n} came back without its edits and labels`);
      return {
        author: i.author?.login ?? null, authorAssociation: i.authorAssociation ?? null, lastEditedAt: i.lastEditedAt ?? null, editor: i.editor?.login ?? null,
        labels: i.timelineItems.nodes.filter(e => e?.label?.name === LABEL).map(e => ({ at: e.createdAt, actor: e.actor?.login ?? null, bot: e.actor?.__typename === 'Bot' || /\[bot\]$/i.test(e.actor?.login ?? '') })),
      };
    },
    comment: (repo, n, body) => { ghRun(env, ['issue', 'comment', String(n), '--repo', repo, '--body-file', '-'], body); },
  };
}

const REPO = /^[\w.-]+\/[\w.-]+$/;
const repoOf = (repo, env) => {
  const r = repo ?? env.GITHUB_REPOSITORY;
  if (!REPO.test(r ?? '')) throw new RobotError('needs --repo <owner/name> (or GITHUB_REPOSITORY)');
  return r;
};

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw new RobotError(`${path}: ${e.message}`); }
}
async function writeRecord(root, path, data) {
  await mkdir(join(root, RECORD_DIR), { recursive: true });
  await writeFile(join(root, RECORD_DIR, '.gitignore'), '*\n');
  await writeFile(join(root, path), `${JSON.stringify(data, null, 2)}\n`);
}

// ---- pick ----------------------------------------------------------------------------

/**
 * This run's action: { on, action, … }. action is
 *   work    one issue, with its branch, its title and the minutes this run may use;
 *   triage  only issues to answer (each misses part of the rubric);
 *   wait    an issue to work, but the week's budget is spent (green, said);
 *   none    nothing to do.
 * `triage` lists the issues to answer whatever the action. With `record`,
 * a work run writes .keel/robot/run.json for brief. gh is never asked when
 * the robot is off.
 */
export async function pick({ root, config, env = process.env, repo, record = false, now = new Date(), github = githubOf(env) }) {
  const c = robotConfigOf(config);
  if (!c) return { on: false, action: 'none', triage: [], reason: OFF };
  repo = repoOf(repo, env);
  const states = [];
  let work = null;
  const writer = writersOf(github, repo);
  for (const issue of github.issues(repo)) {
    const comments = github.comments(repo, issue.number);
    let s = issueState(issue, comments, { writer });
    if (!work && s.kind === 'worked') s = againSince(s, github.events(repo, issue.number), { writer });
    // PR #59: only a body a person approved is worked; an unapproved one is answered once, not worked.
    if (!work && s.kind === 'work') s = withApproval(s, github.approval(repo, issue.number), comments, { writer });
    if (!work && s.kind === 'work') work = { state: s, issue };
    states.push(s);
  }
  const plan = choose(states);
  const triaged = plan.triage;
  const tail = triaged.length ? `; ${triaged.length} to answer for the rubric (${triaged.map(n => `#${n}`).join(', ')})` : '';
  if (!work) return { on: true, action: triaged.length ? 'triage' : 'none', triage: triaged, waiting: plan.waiting, reason: `no issue to work${states.length ? `: ${plan.waiting.length} wait on the owner` : `: none open is labelled ${LABEL}`}${tail}` };
  // The week's spend (PR #59): every attempt of every run that could have spent this week, each job in its
  // own attempt only, each attempt counted by when its agent step started. A run created up to RERUN_DAYS
  // ago can be rerun this week; one not touched since Monday spent nothing in it. This run's own earlier
  // attempts (a rerun) are still in progress, so the completed list never holds them: read them by id.
  const monday = weekStart(now);
  const attemptsOf = (id, n) => Array.from({ length: n }, (_, i) => ({ id, attempt: i + 1, jobs: github.jobs(repo, id, i + 1).filter(j => j?.run_attempt === undefined || j.run_attempt === i + 1) }));
  const touched = r => { const t = Date.parse(r?.updated_at ?? r?.created_at ?? ''); return !(Number.isFinite(t) && t < monday.getTime()); };
  const here = /^\d+$/.test(String(env.GITHUB_RUN_ID ?? '')) ? Number(env.GITHUB_RUN_ID) : null;
  const listed = github.runs(repo, new Date(monday.getTime() - RERUN_DAYS * 86_400_000).toISOString().slice(0, 10)).filter(r => r?.conclusion !== 'skipped' && touched(r) && r.id !== here);
  const runs = listed.flatMap(r => attemptsOf(r.id, Math.max(1, Number.isInteger(r.run_attempt) ? r.run_attempt : 1)));
  const attempt = Number(env.GITHUB_RUN_ATTEMPT);
  if (here !== null && Number.isInteger(attempt) && attempt > 1) runs.push(...attemptsOf(here, attempt - 1));
  const budget = budgetFor(c, weekUse(runs, { since: monday.toISOString() }), now);
  const s = work.state;
  if (budget.wait) return { on: true, action: 'wait', triage: triaged, issue: s.number, budget, reason: `${budget.line}; #${s.number} is next${tail}` };
  const branch = `${PREFIX}${s.number}`;
  const pr = github.openPr(repo, branch);
  // `read`: when this run read the comments (the time pick began), the cursor its mark carries (PR #59).
  const out = { on: true, action: 'work', triage: triaged, issue: s.number, title: oneLine(s.title), branch, minutes: budget.minutes, agent: c.agent, budget, pr, read: new Date(now).toISOString(), seen: s.comments.filter(cm => second(cm.created_at) >= second(new Date(now).toISOString()) && Number.isInteger(cm.id)).map(cm => cm.id), reason: `#${s.number} (${s.fresh ? 'never worked' : s.again ? `${s.again} since its last run` : `${s.comments.length} comment${s.comments.length === 1 ? '' : 's'} since its last run`}); ${budget.line}${tail}` };
  if (record) {
    let diff = null;
    if (pr) {
      const d = github.prDiff(repo, pr.number);
      diff = d.length > DIFF_CHARS ? `${d.slice(0, DIFF_CHARS)}\n… (cut at ${DIFF_CHARS} characters of ${d.length})\n` : d;
    }
    await writeRecord(root, RECORD, {
      date: new Date(now).toISOString(), repo, branch,
      issue: { number: s.number, title: s.title, url: s.url, body: String(work.issue.body ?? '') },
      fresh: s.fresh, again: s.again ?? null, lastRun: s.lastRun ?? null,
      comments: s.comments.map(cm => ({ login: cm.user?.login ?? null, association: cm.author_association, at: cm.created_at, url: cm.html_url ?? null, body: String(cm.body ?? '') })),
      pr, diff,
    });
  }
  return out;
}

const oneLine = s => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);

// ---- the brief -----------------------------------------------------------------------

/** The agent's prompt, pure: the brief (ROBOT.md), the issue, the writers' comments since the last run, and the open PR. */
export function briefText(brief, run) {
  const i = run.issue;
  const where = i.url ? ` (read it whole on the issue: ${i.url})` : ' (read it whole on the issue)';
  const out = [brief.trimEnd(), '', `## The issue: #${i.number} ${i.title}`, '', i.url ? `${i.url}\n` : '', cut(i.body.trim(), BODY_CHARS, `the issue's body${where}`) || '(no body)', ''];
  if (run.comments.length) {
    // PR #59: bounded, each comment and all of them, and what was cut is said. The newest are kept: they are the latest word.
    const shown = [];
    let total = 0;
    for (const c of [...run.comments].reverse()) {
      const text = cut(c.body.trim(), COMMENT_CHARS, `this comment${c.url ? ` (${c.url})` : ''}`);
      if (shown.length && total + text.length > COMMENTS_CHARS) break;
      shown.unshift({ c, text });
      total += text.length;
    }
    const left = run.comments.length - shown.length;
    out.push(`## ${run.fresh ? 'Comments on it' : 'Comments since your last run'} (people with write access, oldest first)`, '');
    if (left) out.push(`(${left} earlier comment${left === 1 ? ' is' : 's are'} left out: the comments here are cut at ${COMMENTS_CHARS} characters in all, the newest kept${where}.)`, '');
    for (const { c, text } of shown) out.push(`### ${c.login ?? 'someone'} (${c.association}), ${c.at}`, '', text, '');
  } else if (!run.fresh) out.push(`## Since your last run`, '', run.again ? `The issue was ${run.again === 'reopened' ? 'reopened' : 'labelled again'} with no comment: what you did last time did not hold. Read your last message on the issue, and the PR below if there is one.` : 'Nothing new.', '');
  if (run.pr) {
    out.push(`## Your open pull request: #${run.pr.number}`, '', `${run.pr.url ?? ''}`, '', `Your branch (\`${run.branch}\`) starts from the default branch, not from #${run.pr.number}: what you commit replaces its commits when it is pushed. Carry over what still holds from its diff, and change what the comments ask.`, '', '```diff', (run.diff ?? '').trimEnd(), '```', '');
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

export async function brief({ root, out }) {
  const run = await readJson(join(root, RECORD));
  if (!run) throw new RobotError(`no run record at ${RECORD}: pick --record writes it`);
  const text = await readFile(join(root, '.agents/climb/ROBOT.md'), 'utf8').catch(() => { throw new RobotError('.agents/climb/ROBOT.md is missing: keel render writes it'); });
  const prompt = briefText(text, run);
  if (out) await writeFile(out, prompt);
  return { issue: run.issue.number, chars: prompt.length, comments: run.comments.length, pr: run.pr?.number ?? null, out: out ?? null, ...(out ? {} : { prompt }) };
}

// ---- the agent's last message ----------------------------------------------------------

/**
 * The last "result" message of Claude's execution file (a JSON array, or one
 * message a line), as climb.mjs lastResult reads it. Its own copy: climb.mjs
 * loads this module for `guard --job robot`, so this one never imports it
 * (a cycle under climb.mjs's top-level await never settles).
 */
export function lastResult(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  let msgs;
  try { const v = JSON.parse(text); msgs = Array.isArray(v) ? v : [v]; }
  catch { msgs = text.split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  return msgs.filter(m => m && typeof m === 'object' && m.type === 'result').at(-1) ?? null;
}

/**
 * The agent's last message, as climb and tend read the agent's output:
 * Claude's from its execution file (the last "result" message's text),
 * Codex's from its final-message file. '' when there is none. Never printed:
 * it goes on the issue, where the owner reads it.
 */
export async function lastMessage({ agent, file }) {
  if (agent !== 'claude' && agent !== 'codex') throw new RobotError(`message --agent must be claude or codex (got ${agent})`);
  let text = '';
  if (file) try { text = await readFile(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw new RobotError(`${file}: ${e.message}`); }
  if (agent === 'codex') return text.trim();
  const r = lastResult(text);
  return r && !r.is_error && typeof r.result === 'string' ? r.result.trim() : '';
}

// ---- the judge ---------------------------------------------------------------------------

// SAFE_GIT (tend.mjs, PR #59): the report runs after the gate, so no hook or fsmonitor it planted runs.
function git(root, args, { allowFail = false } = {}) {
  const r = spawnSync('git', [...SAFE_GIT, ...agentGitArgs(root), ...args], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new RobotError(`git ${args[0]}: ${r.error.message}`);
  if (r.status !== 0 && !allowFail) throw new RobotError(`git ${args.join(' ')} exited ${r.status}: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
  return allowFail ? r : r.stdout.replace(/\n$/, '');
}
const sha = (root, ref) => git(root, ['rev-parse', '--verify', `${ref}^{commit}`]);

/**
 * guard --job robot: the agent's branch from the run's commit (`base`,
 * never a record's) changes nothing off limits (climb.mjs sandbox), keeps
 * the record rules (no evidence, no status marked built, lived-in or
 * accepted, no acceptance box ticked), and passes the gate. { ok, problems, line? }.
 */
export async function robotGuard({ root, config, env = process.env, base, check = 'npm run check', ledger }) {
  if (!base) throw new RobotError('guard --job robot needs --base <the run\'s commit>');
  const head = sha(root, 'HEAD'), b = sha(root, base);
  if (head === b) return { ok: true, job: KEY, skipped: true, line: 'nothing changed: HEAD is the base, so there is nothing to guard', problems: [] };
  const off = sandboxProblems(root, b, head);
  if (off.length) return { ok: false, job: KEY, refused: off, problems: off };
  const records = recordRules(root, b, head, 'the robot');
  if (records.length) return { ok: false, job: KEY, refused: records, problems: records };
  // PR #59: the gate's ledger records are written while the branch's scripts run, so a branch that changed
  // them would write the records that judge it. The robot works an issue, never the gate's scripts.
  const scripts = scriptsChanged(root, b, head).map(s => `${s.path}: changes "scripts" (${s.keys.map(k => `"${k}"`).join(', ')}); the robot never changes the scripts that run the gate, whose records judge its branch`);
  if (scripts.length) return { ok: false, job: KEY, refused: scripts, problems: scripts };
  const gate = config.check ?? check;
  // The gate is the agent's code: what was checked is HEAD now, and it must still be HEAD after (PR #59).
  const before = treeState(root);
  // Judged by what it ran, not its exit alone (PR #59): climb's ledger comparison against the base's own
  // gate, so a gate script the branch rewrote (`"check": "true"`, `|| true`) is refused. climb.mjs hands
  // its ledgerCheck in (it loads this module, so this one never imports it back at load).
  const check_ = ledger ?? (await import('./climb.mjs')).ledgerCheck;
  const l = await check_({ root, config, env, gate, base: b, head });
  if (!l.ok) return { ok: false, job: KEY, problems: l.problems, ...(l.missing ? { missing: l.missing } : {}) };
  const moved = heldProblems(root, before, `the gate \`${gate}\``);
  if (moved.length) return { ok: false, job: KEY, refused: moved, problems: moved };
  const line = `\`${gate}\` exit 0 on ${head.slice(0, 7)}; ${l.count} tests ran, none dropped, skipped or failed against the base ${b.slice(0, 7)}'s own gate (the test ledger); the robot's guard passed (nothing off limits changed, no evidence written, nothing marked built, lived-in or accepted, no box ticked)`;
  await writeRecord(root, JUDGED, { base: b, head, gate: line });
  return { ok: true, job: KEY, head, line, problems: [] };
}

/** The impact declaration a robot PR carries (phase 26): the records it edits, or none. */
export function robotImpact(files, issue) {
  const phases = files.filter(p => (/^docs\/phases\/.*\.md$/.test(p) && !/\/README\.md$/i.test(p)) || /^docs\/projects\/.*\/phases\.md$/.test(p)).sort();
  const decisions = files.filter(p => /^docs\/decisions\/.*\.md$/.test(p) && !/\/README\.md$/i.test(p)).sort();
  return phases.length || decisions.length
    ? { version: 1, phases, decisions, supersedes: [], evidence: [], reconciliation: 'updated', reason: `The robot's change for #${issue} edits these records; a person merges it.` }
    : { version: 1, phases: [], decisions: [], supersedes: [], evidence: [], reconciliation: 'none', reason: `The robot's change for #${issue} edits no phase or decision record.` };
}

/**
 * The PR body and the run's line, from git alone (the commits since the run's
 * commit) and the judge's gate line: { commits, files, line, text }. text is
 * null with no commit (nothing is pushed). Pure but for git and the files it reads.
 */
export async function report({ root, config, base, head, issue, title, agent, body }) {
  if (!base) throw new RobotError('report needs --base <the run\'s commit>');
  if (!/^\d+$/.test(String(issue ?? ''))) throw new RobotError('report needs --issue <number>');
  if (agent !== 'claude' && agent !== 'codex') throw new RobotError(`report --agent must be claude or codex (got ${agent})`);
  const b = sha(root, base);
  // The commit the judge took (--head, PR #59), never whatever HEAD is after the gate ran.
  const h = sha(root, head || 'HEAD');
  const commits = git(root, ['log', '--reverse', '--format=%H%x00%s', `${b}..${h}`]).split('\n').filter(Boolean).map(l => { const [id, subject] = l.split('\x00'); return { sha: id, subject, message: git(root, ['show', '-s', '--format=%B', id]) }; });
  // A closing keyword in a commit closes what it names on merge (PR #59): the robot closes its own issue alone.
  const closes = commits.flatMap(c => closingRefs(c.message).filter(r => r !== `#${issue}`).map(r => `${c.sha.slice(0, 7)} ("${oneLine(c.subject).slice(0, 60)}") would close ${r}`));
  // The issue's title goes into the PR's description too (PR #59): a closing keyword there closes on merge as well.
  for (const r of closingRefs(title).filter(r => r !== `#${issue}`)) closes.push(`the issue's title ("${oneLine(title).slice(0, 60)}") would close ${r}`);
  if (closes.length) throw new RobotError(`the agent's commits or the issue's title name issues to close besides #${issue}: ${closes.join('; ')}. Merging would close them, and the robot was handed #${issue} alone; nothing is published`);
  // NUL-delimited (PR #59): the PR's impact declaration names a phase file whatever bytes its path holds.
  const files = pathsOf(root, ['diff', '--name-only', '--no-renames', b, h]);
  const branch = `${PREFIX}${issue}`;
  const line = `Robot #${issue}: ${commits.length} commit${commits.length === 1 ? '' : 's'} on ${branch}, ${files.length} file${files.length === 1 ? '' : 's'} changed, by ${AGENTS[agent].name}`;
  if (!commits.length) return { commits: 0, files, line, text: null };
  const judged = await readJson(join(root, JUDGED));
  // Who wrote it goes in the body (PR #59): a later /review reads it there, whatever "robot".agent says by then.
  const mark = robotAgentMark(agent);
  const who = reviewerOf({ config, head: branch, body: mark });
  const input = {
    summary: { lead: `keel robot: #${issue}${title ? ` (${oneLine(title)})` : ''}, worked by ${AGENTS[agent].name} on its own; a person merges.`, files },
    evidence: { gate: judged?.gate ?? 'not run: the judge recorded no gate line' },
    danger: { door: 'two-way', why: 'one issue\'s change, on its own branch; reverting the merge restores everything', surfaces: [], within: 'files' },
    notes: [
      `Closes #${issue}`,
      `Commits:\n\n${commits.map(c => `- ${c.subject} (${c.sha.slice(0, 7)})`).join('\n')}`,
      `Review: ${who.reviewer ? `${who.why}.` : 'no provider is listed to review it.'} A pull request the workflow's token opens starts no other workflow, so cross-review runs when someone with write access comments \`/review\` here (its "for" must name \`${PREFIX}\`).`,
      'The robot never merges. Comment on the issue to start its next run on this branch.',
    ],
    impact: { declaration: robotImpact(files, issue) },
  };
  const text = `${mark}\n${prBody(input)}`;
  if (body) await writeFile(body, text);
  return { commits: commits.length, files, line, text, body: body ?? null };
}

// ---- what is posted ------------------------------------------------------------------------

/** The robot's comment on the issue, pure: its mark, the agent's last message as it wrote it, then keel's line. */
export function runComment({ message, pr, judge, line, run, read, seen = [], head }) {
  let said = String(message ?? '').replace(/<!--\s*keel:[\s\S]*?-->/g, '').trim();
  if (said.length > MESSAGE_CHARS) said = `${said.slice(0, MESSAGE_CHARS)}\n\n… (cut at ${MESSAGE_CHARS} characters)`;
  const status = pr ? `The pull request: ${pr}`
    : judge === 'failure' ? `No pull request: the judge refused the branch${run ? ` (${run})` : ''}.`
      : `No pull request${line ? `: ${line}` : ': the agent committed nothing'}.`;
  return [
    runMark(read, seen, head),
    '**keel robot**: the agent\'s last message, as it wrote it.',
    '',
    said || '(The agent left no message.)',
    '',
    '---',
    '',
    status,
    '',
    'A comment here from someone with write access starts the next run on this issue, with the comment in its brief.',
    '',
  ].join('\n');
}

export async function post({ env = process.env, repo, issue, message, pr, judge, line, run, read, seen, head, github = githubOf(env) }) {
  repo = repoOf(repo, env);
  if (!/^\d+$/.test(String(issue ?? ''))) throw new RobotError('post needs --issue <number>');
  if (read !== undefined && read !== '' && !isInstant(read)) throw new RobotError(`post --read must be the pick's ISO time (got ${JSON.stringify(read)})`);
  let text = '';
  if (message) try { text = await readFile(message, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw new RobotError(`${message}: ${e.message}`); }
  if (seen !== undefined && seen !== '' && !SEEN.test(seen)) throw new RobotError(`post --seen must be comment ids, comma-separated (got ${JSON.stringify(seen)})`);
  if (head !== undefined && head !== '' && !SHA_RE.test(head)) throw new RobotError(`post --head must be the pushed commit's full sha (got ${JSON.stringify(head)})`);
  const body = runComment({ message: text, pr, judge, line, run, read: read || undefined, seen: seen ? seen.split(',') : [], head: head || undefined });
  github.comment(repo, Number(issue), body);
  return { issue: Number(issue), chars: body.length, pr: pr || null };
}

/**
 * Answer each named issue that misses part of the rubric, read again here
 * (the publish job's own read, never anything the agent's job handed on):
 * one comment per body, naming what is missing. [{ issue, posted, why }].
 */
export async function triagePost({ env = process.env, repo, issues, postIt = false, github = githubOf(env) }) {
  repo = repoOf(repo, env);
  const numbers = String(issues ?? '').split(/[\s,]+/).filter(Boolean);
  if (numbers.some(n => !/^\d+$/.test(n))) throw new RobotError('triage --issues takes issue numbers');
  const out = [];
  const writer = writersOf(github, repo);
  for (const n of numbers.slice(0, MAX_TRIAGE).map(Number)) {
    const issue = github.issue(repo, n);
    if (issue?.state !== 'open' || !(issue.labels ?? []).some(l => (l?.name ?? l) === LABEL) || issue.pull_request) { out.push({ issue: n, posted: false, why: `not an open issue labelled ${LABEL}` }); continue; }
    const comments = github.comments(repo, n);
    let s = issueState(issue, comments, { writer });
    // PR #59: a body edited since a person approved it is answered once, as pick found it.
    if (s.kind === 'work') s = withApproval(s, github.approval(repo, n), comments, { writer });
    if (s.kind === 'unapproved') {
      const body = approvalText(s.hash, s.unapproved);
      if (postIt) github.comment(repo, n, body);
      out.push({ issue: n, posted: postIt, unapproved: s.unapproved, why: `not approved: ${s.unapproved}`, ...(postIt ? {} : { body }) });
      continue;
    }
    if (s.kind !== 'triage') { out.push({ issue: n, posted: false, why: s.kind === 'waits-rubric' || s.kind === 'waits-approval' ? 'this body was answered already' : 'it holds the rubric' }); continue; }
    const body = `${triageMark(s.hash)}\n${missingText(s.missing)}\n`;
    if (postIt) github.comment(repo, n, body);
    out.push({ issue: n, posted: postIt, missing: s.missing.map(m => m.id), why: `misses ${s.missing.map(m => m.id).join(', ')}`, ...(postIt ? {} : { body }) });
  }
  return out;
}

// ---- the command line ---------------------------------------------------------------------

const USAGE = 'usage: node scripts/keel/robot.mjs config|pick|brief|message|report|triage|post|pushed [--json]';
const FLAGS = { '--repo': 'repo', '--out': 'out', '--agent': 'agent', '--file': 'file', '--base': 'base', '--head': 'head', '--issue': 'issue', '--title': 'title', '--body': 'body', '--issues': 'issues', '--message': 'message', '--pr': 'pr', '--judge': 'judge', '--line': 'line', '--run': 'run', '--read': 'read', '--seen': 'seen' };
const SWITCHES = { '--record': 'record', '--post': 'post' };

export function parseArgs(args) {
  const [verb, ...rest] = args;
  const o = { verb };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (SWITCHES[a]) o[SWITCHES[a]] = true;
    else if (FLAGS[a]) {
      if (rest[i + 1] === undefined) throw new RobotError(`${a} needs a value; ${USAGE}`);
      o[FLAGS[a]] = rest[++i];
    } else throw new RobotError(`unexpected ${a}; ${USAGE}`);
  }
  return o;
}

export async function cli(args, { root = rootOf(import.meta), env = process.env } = {}) {
  const o = parseArgs(args);
  let config = {};
  try { config = JSON.parse(await readFile(join(root, '.keel/keel.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw new RobotError(`.keel/keel.json: ${e.message}`); }
  switch (o.verb) {
    case 'config': {
      const c = robotConfigOf(config);
      return { data: c ? { on: true, ...c } : { on: false }, text: c ? `the robot is on: ${c.budgetMinutes} min a week, up to ${c.runMinutes} a run, by ${c.agent}` : OFF };
    }
    case 'pick': {
      const p = await pick({ root, config, env, repo: o.repo, record: o.record });
      const text = p.action === 'work' ? `work #${p.issue} on ${p.branch}: ${p.reason}` : p.action === 'wait' ? `::notice::${p.reason}` : p.action === 'triage' ? `triage only: ${p.reason}` : `nothing to do: ${p.reason}`;
      return { data: p, text };
    }
    case 'brief': {
      const b = await brief({ root, out: o.out ? resolve(o.out) : undefined });
      return { data: b, text: b.out ? `the brief for #${b.issue}: ${b.chars} characters, ${b.comments} comment${b.comments === 1 ? '' : 's'}${b.pr ? `, PR #${b.pr}` : ''} → ${b.out}` : b.prompt };
    }
    case 'message': {
      const m = await lastMessage({ agent: o.agent, file: o.file ? resolve(o.file) : undefined });
      if (o.out) await writeFile(resolve(o.out), m ? `${m}\n` : '');
      return { data: { chars: m.length, out: o.out ?? null }, text: m ? `the agent's last message: ${m.length} characters${o.out ? ` → ${o.out}` : ''} (never printed: it goes on the issue)` : 'the agent left no last message' };
    }
    case 'report': {
      const r = await report({ root, config, base: o.base, head: o.head, issue: o.issue, title: o.title, agent: o.agent, body: o.body ? resolve(o.body) : undefined });
      return { data: { ...r, text: undefined }, text: [r.line, ...(r.text && !o.body ? ['', r.text.trimEnd()] : [])].join('\n') };
    }
    case 'triage': {
      const t = await triagePost({ env, repo: o.repo, issues: o.issues, postIt: o.post });
      return { data: t, text: t.length ? t.map(x => `#${x.issue}: ${x.posted ? 'answered: ' : o.post ? 'nothing posted: ' : ''}${x.why}`).join('\n') : 'no issue to triage' };
    }
    case 'post': {
      const p = await post({ env, repo: o.repo, issue: o.issue, message: o.message ? resolve(o.message) : undefined, pr: o.pr, judge: o.judge, line: o.line, run: o.run, read: o.read, seen: o.seen, head: o.head });
      return { data: p, text: `posted the agent's last message on #${p.issue} (${p.chars} characters)` };
    }
    case 'pushed': {
      if (!/^\d+$/.test(String(o.issue ?? ''))) throw new RobotError('pushed needs --issue <number>');
      const head = pushedHead(githubOf(env).comments(repoOf(o.repo, env), Number(o.issue)));
      return { data: { head }, text: head ?? '' };
    }
    default: throw new RobotError(o.verb ? `unknown subcommand ${o.verb}; ${USAGE}` : USAGE);
  }
}

if (isMain(import.meta)) await main(args => cli(args));
