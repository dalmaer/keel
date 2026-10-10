// keel review: read a pull request's review comments, wait for its reviewers,
// and answer each comment (keel phase 41; docs/research/2026-10-06-answering-reviews.md).
//
//   keel review <owner/repo>#<n> [--wait] [--gate] [--reviewer <login>]... [--json]
//   keel review <owner/repo>#<n> --close <id>[,<id>…] --fixed <commit> | --tracked <issue|version> | --not-valid "<why>"
//
// Not a gate (the owner, 6 Oct): nothing in keel refuses a merge for an open
// thread. What is required is an answer: every comment validated against the
// code, then answered fixed (naming the commit), tracked (naming where) or not
// valid (saying why). The read is deterministic; the judgement is the
// answerer's, recorded in the reply.
//
// Reads: the PR's review threads, conversation comments and review bodies (gh
// api graphql, reviewThreads with isResolved) and its reviews (gh api
// repos/{r}/pulls/{n}/reviews) for the head commit. The GraphQL read asks a
// window first (FIRST_WINDOW: 50 threads, 20 comments each) and the full
// fragment only when a list overflowed it; it reports what it cost (`github`)
// and warns, reading anyway, under the quota floor (lib/quota.mjs). A thread is answered by a
// reply after its reviewer's newest comment, never by resolving it alone; a
// conversation comment or review body by a later comment that quotes, links
// or names it.
// Which comments are answered is the night practice's rule (reviewComments in
// practices/night/files/scripts/keel/lib.mjs), so the night counts the same way.
// Reviewers: --reviewer, else .keel/keel.json "review" of the project here
// when its repo is the PR's, else the PR's repo's own .keel/keel.json on
// GitHub; none named means nothing to wait for, and conversation comments are
// not read (threads and review bodies are).
//
// Exit codes: 0 every comment answered; 1 one is not (or, with --gate or
// --wait, a named reviewer has not reviewed the head commit); 2 GitHub could
// not be read, or usage. Never 0 on a failed read: an unread review is not
// an answered one. --gate is for a phase that opted in to waiting for review
// (front matter `review: wait`, or the issue's keel:wait-for-review label):
// it lands through a PR, and the PR merges when --gate exits 0. keel release
// reads the same verdict in-process (prGate, phase 48), and also requires
// someone other than the PR's author to have reviewed its head.
//
// --close posts a reply on each named thread (the REST replies endpoint), or a
// conversation comment quoting and linking a review body or conversation
// comment, and resolves the thread for fixed and not valid
// (resolveReviewThread); a tracked thread stays open until its fix lands.
// Several ids go in one call, comma-separated or with --close repeated: never
// loop over them in a shell (zsh does not split words); there is no "all" and
// no wildcard: each id is named, because each was validated. gh is KEEL_GH or
// gh; KEEL_REVIEW_POLL_MS sets --wait's poll (default 30 s).
//
// A comment is closed only after it was read (the owner, 7 Oct: a --close list
// built from a query swept in four Codex threads posted after the last read,
// two of them security findings, answered "fixed" unread). Every read leaves a
// receipt of what it showed, per PR, in keel's cache outside any repo
// ($KEEL_CACHE, else $XDG_CACHE_HOME/keel, else ~/.cache/keel; then
// reviews/<owner>__<repo>__<n>.json, { at, head, ids, threads, seen }): the
// ids it showed, each thread's comment count, and every review body and
// conversation comment id the PR had; the newest read replaces the last.
// --close refuses (exit 2, posting nothing) an id the read did not show, a
// named thread that grew since, and any call while a comment it does not name
// arrived since (a new id, or a thread that grew), not counting the PR
// author's own comments or keel's posted answers. No clock is compared: `at`
// is for messages only. --close leaves the receipt as it was.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { reviewConfigOf, prReviewArgs, moreReviewsArgs, rateSpend, reviewComments, sameLogin, PUSH_LABEL, recordOf, byWorkflow } from '../practices/night/files/scripts/keel/lib.mjs';
import { quotaWarning } from './quota.mjs';

export const POLL_MS = 30_000;
export const ANSWERS = ['fixed', 'tracked', 'not-valid'];

export class ReviewError extends Error {
  constructor(message, exitCode = 2) { super(message); this.exitCode = exitCode; }
}
const usage = message => new ReviewError(message, 2);

/**
 * `owner/repo#n`, a PR URL, or `#n`/`n` with the project's repo: { repo,
 * number }. A push to main reviewed after it landed (phase 60):
 * `owner/repo@<sha>` (7 to 40 hex), or `@<sha>` with the project's repo:
 * { repo, sha }.
 */
export function parseTarget(target, fallbackRepo) {
  const s = String(target ?? '').trim();
  let m = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(s) ?? /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)\/?$/.exec(s);
  if (m) return { repo: m[1], number: Number(m[2]) };
  m = /^([\w.-]+\/[\w.-]+)@([0-9a-f]{7,40})$/i.exec(s);
  if (m) return { repo: m[1], sha: m[2].toLowerCase() };
  m = /^@([0-9a-f]{7,40})$/i.exec(s);
  if (m && fallbackRepo) return { repo: fallbackRepo, sha: m[1].toLowerCase() };
  m = /^#?(\d+)$/.exec(s);
  if (m && fallbackRepo) return { repo: fallbackRepo, number: Number(m[1]) };
  throw usage(`keel review needs <owner/repo>#<n> (or a PR URL${fallbackRepo ? ', or #<n> for ' + fallbackRepo : ''}), or <owner/repo>@<sha> for a push reviewed after it landed; got "${s}"`);
}

const COMMIT = /^(?:[\w.-]+\/[\w.-]+@)?(?:[0-9a-f]{7,40}|v?\d+\.\d+\.\d+)$/i;
const TRACKED = /^(?:(?:[\w.-]+\/[\w.-]+)?#\d+|https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:issues|pull)\/\d+|v?\d+\.\d+\.\d+)$/i;

/** The answer from the flags, refused when it names nothing: { kind, value }. */
export function answerOf({ fixed, tracked, notValid }) {
  const given = [['fixed', fixed], ['tracked', tracked], ['not-valid', notValid]].filter(([, v]) => v !== undefined);
  if (given.length !== 1) throw usage('--close needs exactly one answer: --fixed <commit> | --tracked <issue|version> | --not-valid "<why>"');
  const [[kind, raw]] = given;
  const value = String(raw).trim();
  if (kind === 'fixed' && !COMMIT.test(value)) throw usage(`--fixed needs the commit (or release) that fixed it: a sha of 7-40 hex, owner/repo@sha, or vX.Y.Z; got "${value}"`);
  if (kind === 'tracked' && !TRACKED.test(value)) throw usage(`--tracked needs where it is tracked: #<issue>, owner/repo#<issue>, an issue URL, or the version vX.Y.Z; got "${value}"`);
  if (kind === 'not-valid' && value.split(/\s+/).filter(Boolean).length < 2) throw usage('--not-valid needs the reason, citing the code: "<why>" (a few words, never empty)');
  return { kind, value };
}

/** The reply's text: what was decided, in the form a reader can check. */
export function replyText({ kind, value }) {
  if (kind === 'fixed') return `**Fixed** in ${value}. Validated against the code first.`;
  if (kind === 'tracked') return `**Valid, tracked** in ${value}. Left open until the fix lands.`;
  return `**Not valid:** ${value}`;
}

// ---- gh ------------------------------------------------------------------------

function gh(env, args) {
  return new Promise(done => {
    execFile(env.KEEL_GH || 'gh', args, { env, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      done(error ? { ok: false, code: typeof error.code === 'number' ? error.code : null, why: String(stderr || error.message).trim().split('\n').filter(Boolean).pop() ?? 'failed', stdout: stdout ?? '' }
        : { ok: true, stdout });
    });
  });
}
export async function ghJson(env, args, what) {
  const r = await gh(env, args);
  if (!r.ok) throw new ReviewError(`GitHub could not be read (${what}): ${r.why}`);
  try { return JSON.parse(r.stdout); } catch { throw new ReviewError(`GitHub could not be read (${what}): gh did not print JSON`); }
}

/** The first read's window: most PRs fit it; one that does not is read again with the full fragment. */
export const FIRST_WINDOW = Object.freeze({ threads: 50, replies: 20 });

async function readOnce(env, { repo, number }, sizes, spend) {
  const out = await ghJson(env, prReviewArgs(repo, number, sizes), 'review threads');
  if (Array.isArray(out?.errors) && out.errors.length) throw new ReviewError(`GitHub could not be read (review threads): ${out.errors[0]?.message ?? 'an error'}`);
  spend?.add(out?.data?.rateLimit);
  const pr = out?.data?.repository?.pullRequest;
  if (!pr) throw new ReviewError(`GitHub could not be read: no pull request ${repo}#${number}`);
  return pr;
}

/** The most pages of reviews a read follows (100 each): past it, the read is incomplete and says so. */
export const MAX_REVIEW_PAGES = 20;

/**
 * The PR through FIRST_WINDOW, and again with the full fragment only when a thread list or a thread overflowed it;
 * then every page of review bodies past the first (a PR answered reply by reply passes 100 reviews).
 */
async function readPr(env, at, spend) {
  let pr = await readOnce(env, at, FIRST_WINDOW, spend);
  const over = pr.reviewThreads?.pageInfo?.hasNextPage || (pr.reviewThreads?.nodes ?? []).some(t => t?.comments?.pageInfo?.hasNextPage);
  if (over) pr = await readOnce(env, at, {}, spend);
  // The first read was page 1 (keel#78): MAX_REVIEW_PAGES in all, as the REST read counts them.
  for (let n = 1; pr.reviews?.pageInfo?.hasNextPage && pr.reviews.pageInfo.endCursor && n < MAX_REVIEW_PAGES; n++) {
    const out = await ghJson(env, moreReviewsArgs(at.repo, at.number, pr.reviews.pageInfo.endCursor), 'review bodies');
    if (Array.isArray(out?.errors) && out.errors.length) throw new ReviewError(`GitHub could not be read (review bodies): ${out.errors[0]?.message ?? 'an error'}`);
    spend?.add(out?.data?.rateLimit);
    const page = out?.data?.repository?.pullRequest?.reviews;
    if (!page || !Array.isArray(page.nodes)) throw new ReviewError('GitHub could not be read (review bodies): no page came back');
    pr = { ...pr, reviews: { pageInfo: page.pageInfo ?? {}, nodes: [...pr.reviews.nodes, ...page.nodes] } };
  }
  return pr;
}

async function readReviews(env, { repo, number }) {
  // Every page (100 a page): a PR answered reply by reply passes 100 reviews. Past MAX_REVIEW_PAGES, incomplete.
  const reviews = [];
  for (let page = 1; ; page++) {
    const got = await ghJson(env, ['api', `repos/${repo}/pulls/${number}/reviews?per_page=100&page=${page}`], 'reviews');
    if (!Array.isArray(got)) throw new ReviewError('GitHub could not be read (reviews): not a list');
    // The page past the cap is read too (keel#78): exactly MAX_REVIEW_PAGES full pages end with an empty one.
    if (page > MAX_REVIEW_PAGES) { if (got.length) throw new ReviewError(`GitHub could not be read (reviews): more than ${MAX_REVIEW_PAGES * 100} reviews; the read is incomplete`); break; }
    reviews.push(...got);
    if (got.length < 100) break;
  }
  return reviews.map(r => ({ reviewer: r?.user?.login ?? 'ghost', state: r?.state ?? null, commit: r?.commit_id ?? null, at: r?.submitted_at ?? null }));
}

/** The reviewers to read for: --reviewer, the project here when it is the PR's repo, else the PR's repo's own config. */
async function reviewersFor({ root, repo, reviewer }, env) {
  if (reviewer?.length) return { reviewers: reviewer, wait: (await localConfig(root))?.wait ?? reviewConfigOf({}).wait, from: '--reviewer' };
  const local = root ? JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8').catch(() => '{}')) : {};
  if (String(local.repo ?? '').toLowerCase() === repo.toLowerCase()) return fromConfig(local, '.keel/keel.json');
  const r = await gh(env, ['api', `repos/${repo}/contents/.keel/keel.json`]);
  if (!r.ok) {
    if (/\b404\b|Not Found/i.test(r.why)) return { reviewers: [], wait: reviewConfigOf({}).wait, from: `${repo} has no .keel/keel.json` };
    throw new ReviewError(`GitHub could not be read (${repo}'s .keel/keel.json): ${r.why}`);
  }
  let config;
  try { config = JSON.parse(Buffer.from(JSON.parse(r.stdout).content ?? '', 'base64').toString('utf8')); } catch { throw new ReviewError(`GitHub could not be read: ${repo}'s .keel/keel.json is not JSON`); }
  return fromConfig(config, `${repo}'s .keel/keel.json`);
}
async function localConfig(root) {
  if (!root) return null;
  try { const c = reviewConfigOf(JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8'))); return c.problem ? null : c; } catch { return null; }
}
function fromConfig(config, from) {
  const c = reviewConfigOf(config);
  if (c.problem) throw usage(`${from}: ${c.problem.replace(/^\.keel\/keel\.json /, '')}`);
  return { ...c, from };
}

// ---- the receipt -------------------------------------------------------------------

/** keel's cache: $KEEL_CACHE, else $XDG_CACHE_HOME/keel, else ~/.cache/keel (every platform, macOS too). */
export const cacheDir = env => env.KEEL_CACHE || join(env.XDG_CACHE_HOME || join(env.HOME || homedir(), '.cache'), 'keel');
/** Where a PR's read receipt lives. */
export const receiptPath = (env, { repo, number }) => join(cacheDir(env), 'reviews', `${repo.replace('/', '__')}__${number}.json`);

/** The newest read's receipt for this PR, or null when it was never read here. */
export async function readReceipt(env, at) {
  try {
    const r = JSON.parse(await readFile(receiptPath(env, at), 'utf8'));
    return typeof r?.at === 'string' && Array.isArray(r.ids) && Array.isArray(r.seen) && r.threads && typeof r.threads === 'object' ? r : null;
  } catch { return null; }
}
async function writeReceipt(env, at, receipt) {
  const path = receiptPath(env, at);
  await mkdir(join(cacheDir(env), 'reviews'), { recursive: true });
  await writeFile(`${path}.${process.pid}.tmp`, JSON.stringify(receipt, null, 2) + '\n');
  await rename(`${path}.${process.pid}.tmp`, path);
}

// ---- the read ------------------------------------------------------------------

/** reviewComments, its incomplete read reported as GitHub unreadable (exit 2), never as answered. */
function commentsOf(pr, reviewers) {
  try { return reviewComments(pr, reviewers); } catch (e) { throw new ReviewError(`GitHub could not be read: ${e.message}`); }
}

/**
 * Whether a reviewer's own conversation comment says it finished reviewing the
 * head: one line naming the head commit (its short sha in backticks) and
 * "completed". Codex finishes a review with no findings this way (a status
 * board and a 👍), posting no review, so waiting for a review would time out.
 */
export const summarizedHead = (body, head) => {
  const sha = String(head ?? '').slice(0, 7);
  return /^[0-9a-f]{7}$/.test(sha) && String(body ?? '').split('\n').some(l => l.includes(`\`${sha}`) && /\bcompleted\b/i.test(l));
};

/** Each named reviewer's newest review, and whether it reviewed the head commit (a review on it, or its summary saying so). */
function reviewedHead(reviewers, reviews, head, convo = []) {
  return reviewers.map(name => {
    const mine = reviews.filter(r => sameLogin(r.reviewer, name));
    const newest = mine.at(-1) ?? null;
    const summary = convo.some(c => sameLogin(c?.author?.login, name) && summarizedHead(c.body, head));
    return { reviewer: name, head: mine.some(r => r.commit === head) || summary, newest: newest && { state: newest.state, commit: newest.commit, at: newest.at } };
  });
}

const short = sha => String(sha ?? '').slice(0, 7);
const where = c => c.path ? `${c.path}${c.line ? `:${c.line}` : ''}` : c.kind === 'comment' ? 'conversation' : c.kind;

function readText(d) {
  const lines = [`${d.repo}#${d.number} — ${d.title} (${d.state.toLowerCase()}, head ${short(d.head)})`];
  if (d.warning) lines.push(`Warning: ${d.warning}`);
  lines.push(d.reviewers.length
    ? `Reviewers (${d.reviewersFrom}): ${d.reviewed.map(r => `${r.reviewer} ${r.head ? `reviewed ${short(d.head)}` : r.newest ? `last reviewed ${short(r.newest.commit)}, not the head` : 'has not reviewed'}`).join('; ')}`
    : `Reviewers: none named (${d.reviewersFrom}); threads and review bodies only`);
  if (d.waited) lines.push(d.waited.timedOut ? `Waited ${d.waited.minutes} min: timed out; ${d.waited.missing.join(', ')} has not reviewed ${short(d.head)}. Not "no comments": read again later.` : `Waited ${d.waited.seconds} s: every named reviewer has reviewed ${short(d.head)}.`);
  const open = d.comments.filter(c => !c.answered);
  lines.push(`${d.comments.length} review comment${d.comments.length === 1 ? '' : 's'}, ${open.length} unanswered`);
  for (const c of [...open, ...d.comments.filter(c => c.answered)]) {
    lines.push(`  ${!c.answered ? 'UNANSWERED' : c.resolved ? 'resolved  ' : c.status ? 'status    ' : 'answered  '} ${c.id}  ${c.author}  ${where(c)}  ${c.text}`);
  }
  if (d.gate && d.notReviewed.length) lines.push(`Gate: ${d.notReviewed.join(', ')} has not reviewed the head commit yet.`);
  if (open.length) {
    lines.push('', 'Validate each against the code, then answer it (several ids: comma-separated, one call):',
      `  keel review ${d.repo}#${d.number} --close ${open.map(c => c.id).join(',')} --fixed <commit> | --tracked <issue|version> | --not-valid "<why>"`);
  }
  return lines.join('\n');
}

const sleepFor = ms => new Promise(done => setTimeout(done, ms));

/** keel review: the read (and, with --wait, the wait first). */
export async function review({ root = null, target, wait = false, gate = false, reviewer = [] }, { env = process.env, sleep = sleepFor, now = () => Date.now() } = {}) {
  const local = root ? JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8').catch(() => '{}')) : {};
  const at = parseTarget(target, local.repo);
  if (at.sha) {
    if (wait || gate || reviewer.length) throw usage('keel review <repo>@<sha> reads a push\'s review after it landed: nothing waits on it, so it takes no --wait, --gate or --reviewer');
    return reviewPush(at, { env });
  }
  const named = await reviewersFor({ root, repo: at.repo, reviewer }, env);
  let readAt = new Date().toISOString();
  const spend = rateSpend();
  let pr = await readPr(env, at, spend);
  let reviews = await readReviews(env, at);
  let waited = null;
  if (wait) {
    const started = now();
    const poll = Number(env.KEEL_REVIEW_POLL_MS) > 0 ? Number(env.KEEL_REVIEW_POLL_MS) : POLL_MS;
    for (;;) {
      const missing = reviewedHead(named.reviewers, reviews, pr.headRefOid, pr.comments?.nodes ?? []).filter(r => !r.head).map(r => r.reviewer);
      if (!missing.length) { waited = { timedOut: false, seconds: Math.round((now() - started) / 1000), missing }; break; }
      if (now() - started >= named.wait * 60_000) { waited = { timedOut: true, minutes: named.wait, missing }; break; }
      await sleep(Math.min(poll, Math.max(1, named.wait * 60_000 - (now() - started))));
      readAt = new Date().toISOString();
      pr = await readPr(env, at, spend);
      reviews = await readReviews(env, at);
    }
  }
  const comments = commentsOf(pr, named.reviewers);
  const reviewed = reviewedHead(named.reviewers, reviews, pr.headRefOid, pr.comments?.nodes ?? []);
  const notReviewed = reviewed.filter(r => !r.head).map(r => r.reviewer);
  const unanswered = comments.filter(c => !c.answered).length;
  const ok = unanswered === 0 && ((!gate && !wait) || notReviewed.length === 0);
  try { await writeReceipt(env, at, { at: readAt, head: pr.headRefOid, ids: comments.map(c => c.id), ...shownOf(pr) }); }
  catch (e) { throw new ReviewError(`keel review could not record what it read (${receiptPath(env, at)}): ${e.message}`); }
  const data = {
    repo: at.repo, number: at.number, title: pr.title, url: pr.url, state: pr.state, head: pr.headRefOid,
    reviewers: named.reviewers, reviewersFrom: named.from, wait: named.wait, reviewed, notReviewed, waited, gate,
    comments: comments.map(({ databaseId, ...c }) => c), unanswered, answered: comments.length - unanswered, ok,
    // What the read cost of the owner's GraphQL allowance, and what is left; a warning under the floor (it read anyway: it was asked for).
    github: spend.toJSON(), warning: quotaWarning(spend, env),
  };
  return { data, text: readText(data), exitCode: ok ? 0 : 1 };
}

/**
 * keel review --gate's verdict on one PR, read in-process for keel release
 * (phase 48): every comment answered, each named reviewer has reviewed the
 * head, and someone other than the PR's author has reviewed the head (a
 * review on that commit, or a named reviewer's summary of it). Reads the PR
 * and its reviews as review does, and writes no receipt (nothing is closed
 * from it). A failed read throws ReviewError (exit 2): an unread review never
 * passes. { repo, number, url, merged, head, author, unanswered, notReviewed, reviewedBy, ok, why }.
 */
export async function prGate({ root = null, repo, number }, { env = process.env } = {}) {
  const at = { repo, number };
  const named = await reviewersFor({ root, repo, reviewer: [] }, env);
  const pr = await readPr(env, at, null);
  const reviews = await readReviews(env, at);
  const head = pr.headRefOid;
  const author = pr.author?.login ?? '';
  const comments = commentsOf(pr, named.reviewers);
  const reviewed = reviewedHead(named.reviewers, reviews, head, pr.comments?.nodes ?? []);
  const notReviewed = reviewed.filter(r => !r.head).map(r => r.reviewer);
  const reviewedBy = [...new Set([
    ...reviews.filter(r => head && r.commit === head).map(r => r.reviewer),
    ...reviewed.filter(r => r.head).map(r => r.reviewer),
  ].filter(login => !sameLogin(login, author)))];
  const unanswered = comments.filter(c => !c.answered).map(c => c.id);
  const why = [
    ...(unanswered.length ? [`${unanswered.length} review comment${unanswered.length === 1 ? '' : 's'} unanswered (${unanswered.join(', ')})`] : []),
    ...(reviewedBy.length ? [] : [`nobody but its author${author ? ` (${author})` : ''} reviewed its head ${short(head)}`]),
    ...(notReviewed.length ? [`${notReviewed.join(', ')} has not reviewed its head ${short(head)}`] : []),
  ];
  return { repo, number, url: pr.url, merged: !!pr.mergedAt, head, author, unanswered: unanswered.length, notReviewed, reviewedBy, ok: !why.length, why: why.join('; ') };
}

/** What the PR had: each thread's comment count, and every review body's and conversation comment's id. */
function shownOf(pr) {
  return {
    contentVersion: 1,
    content: contentOf(pr),
    threads: Object.fromEntries((pr.reviewThreads?.nodes ?? []).map(t => [t.id, (t.comments?.nodes ?? []).length])),
    seen: [...(pr.reviews?.nodes ?? []), ...(pr.comments?.nodes ?? [])].map(n => n?.id).filter(Boolean),
  };
}
// Bind every full body, including replies and content beyond the display excerpt.
// Resolution is deliberately excluded: answering one thread can resolve it.
function contentOf(pr) {
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const identity = n => [n.id ?? null, n.databaseId ?? null, n.body ?? null,
    n.author?.login ?? null, n.updatedAt ?? null,
    n.commit?.oid ?? n.commitOid ?? null, n.state ?? null];
  return Object.fromEntries([
    ...(pr.reviewThreads?.nodes ?? []).map(t => [t.id, (t.comments?.nodes ?? []).map(n => hash([t.path ?? null, t.line ?? null, identity(n)]))]),
    ...[...(pr.reviews?.nodes ?? []), ...(pr.comments?.nodes ?? [])].map(n => [n.id, [hash(identity(n))]]),
  ]);
}
/** A comment that is itself a keel answer (replyText, alone or under a quote): an answer, not news. */
const KEEL_ANSWER = /^(?:[\s\S]*\n\n)?\*\*(?:Fixed\*\* in |Valid, tracked\*\* in |Not valid:\*\* )/;
/** Not news to the reader: the PR author's own comment, or keel's posted answer. */
const notNews = (pr, login, body) => sameLogin(login, pr.author?.login ?? '') || KEEL_ANSWER.test(String(body ?? ''));
/**
 * What changed since the receipt, by full content, id and count (no clock): a thread whose
 * comments grew by anyone's but the PR author's or keel's answers, and a review
 * body or conversation comment the read never saw (likewise).
 */
function newSince(pr, receipt) {
  const fresh = new Map();
  const content = contentOf(pr);
  for (const [id, hashes] of Object.entries(receipt.content)) {
    if (!Array.isArray(hashes) || hashes.some((hash, i) => content[id]?.[i] !== hash)) fresh.set(id, 'edited');
  }
  if (fresh.size) return fresh;
  for (const t of pr.reviewThreads?.nodes ?? []) {
    const nodes = t.comments?.nodes ?? [];
    const before = receipt.threads?.[t.id] ?? 0;
    if (nodes.slice(before).some(n => !notNews(pr, n?.author?.login, n?.body))) fresh.set(t.id, before > 0 ? 'follow-up' : 'new');
  }
  const seen = new Set([...(receipt.seen ?? []), ...receipt.ids]);
  for (const n of [...(pr.reviews?.nodes ?? []), ...(pr.comments?.nodes ?? [])]) {
    if (n?.id && !seen.has(n.id) && !notNews(pr, n?.author?.login, n?.body)) fresh.set(n.id, 'new');
  }
  return fresh;
}

/** keel review --close: reply to each named comment, and resolve the thread unless it is tracked. */
export async function close({ root = null, target, ids, fixed, tracked, notValid, fileAgentIssue = false, title, rubricFile, yes = false }, { env = process.env, github } = {}) {
  if (fileAgentIssue && (tracked !== true || fixed !== undefined || notValid !== undefined || !title || !rubricFile || ids?.length !== 1 || String(ids[0]).includes(','))) throw usage('--file-agent-issue requires one --close, bare --tracked, --title and --rubric');
  let answer = fileAgentIssue ? null : answerOf({ fixed, tracked, notValid });
  const list = [...new Set((ids ?? []).flatMap(i => String(i).split(',')).map(i => i.trim()).filter(Boolean))];
  if (!list.length) throw usage('--close needs the id of a thread or comment (keel review <repo>#<n> lists them)');
  const local = root ? JSON.parse(await readFile(join(root, '.keel', 'keel.json'), 'utf8').catch(() => '{}')) : {};
  const at = parseTarget(target, local.repo);
  if (at.sha) return closePush(at, list, answer, { env });
  const pr = await readPr(env, at, rateSpend());
  // Every comment, whoever wrote it: a conversation comment is closed by id, named reviewer or not.
  const all = commentsOf(pr, [...new Set((pr.comments?.nodes ?? []).map(c => c?.author?.login).filter(Boolean))]);
  const found = list.map(id => all.find(c => c.id === id) ?? id);
  const unknown = found.filter(c => typeof c === 'string');
  if (unknown.length) throw usage(`not a review thread or comment on ${at.repo}#${at.number}: ${unknown.join(', ')} (keel review ${at.repo}#${at.number} lists them)`);
  // Closed only after it was read: each id shown by this PR's newest read, with nothing on it since; nothing else arrived since either.
  const receipt = await readReceipt(env, at);
  if (receipt && (receipt.contentVersion !== 1 || !receipt.content || typeof receipt.content !== 'object' || Array.isArray(receipt.content))) {
    throw usage(`read receipt lacks content identity; nothing posted: read with keel review ${at.repo}#${at.number} again`);
  }
  const fresh = receipt ? newSince(pr, receipt) : new Map();
  if ([...fresh.values()].includes('edited')) throw usage(`review content changed since your last read; nothing posted: read with keel review ${at.repo}#${at.number} again`);
  const unread = found.filter(c => !receipt?.ids.includes(c.id) || fresh.has(c.id));
  const arrived = all.filter(c => fresh.has(c.id) && !list.includes(c.id));
  if (unread.length || arrived.length) {
    const cmd = `keel review ${at.repo}#${at.number}`;
    throw usage([
      ...unread.map(c => `not read yet: ${c.id} (${c.author}, ${where(c)})${fresh.get(c.id) === 'follow-up' ? ', a follow-up since your last read' : ''}: run ${cmd}, validate it, then close it`),
      ...arrived.map(c => `arrived since your last read (${receipt.at}): ${c.id} (${c.author}, ${where(c)})${fresh.get(c.id) === 'follow-up' ? ', a follow-up on' : ''} ${c.text}`),
      `nothing posted: read with ${cmd}, validate, then close (each id named; there is no "all")`,
    ].join('\n'));
  }
  let filed = null;
  if (fileAgentIssue) {
    if (!root) throw usage('agent issue creation needs a local project for its durable intent');
    if (receipt.head !== pr.headRefOid) throw usage('PR head changed since the last read; read the review again before creating an issue');
    const m = await import('./robot-issue.mjs');
    const rubric = await m.robotRubricFile(rubricFile);
    const policy = await m.robotTargetPolicy({ root, repo: at.repo, github });
    const subjectKey = `review:${at.repo.toLowerCase()}#${at.number}:${list[0]}`;
    const instanceId = m.robotIssueInstance(subjectKey, title, rubric);
    filed = await m.ensureRobotIssue({ repo: at.repo, title, rubric, policy, subjectKey, instanceId, yes,
      stateDir: join(root, '.keel', 'robot-issues'), github });
    if (!filed.issue || !['created', 'recovered'].includes(filed.state)) return m.robotIssueOutput(filed);
    // Recheck the receipt after issue I/O, before making an answered-review claim.
    const latest = await readPr(env, at, rateSpend());
    if (latest.headRefOid !== receipt.head || newSince(latest, receipt).size) throw usage(`issue ${filed.issue.url} exists, but the review changed; read it again before replying`);
    answer = answerOf({ tracked: filed.issue.url });
  }
  const body = replyText(answer);
  const closed = [];
  for (const c of found) {
    const done = { id: c.id, kind: c.kind, answer: answer.kind, replied: false, resolved: c.resolved };
    try {
      // A lost reply response is recoverable without another identical comment.
      const existing = c.kind === 'thread' ? pr.reviewThreads?.nodes?.find(t => t.id === c.id)?.comments?.nodes : pr.comments?.nodes;
      const replied = fileAgentIssue && existing?.some(n => n.body === body || (n.body?.includes(body) && c.url && n.body.endsWith(c.url)));
      if (replied) { done.replied = true; closed.push(done); continue; }
      if (c.kind === 'thread') {
        await ghJson(env, ['api', '-X', 'POST', `repos/${at.repo}/pulls/${at.number}/comments/${c.databaseId}/replies`, '-f', `body=${body}`], 'posting the reply');
      } else {
        // A review body or conversation comment has no thread: the answer quotes and links it, so the read sees it answered.
        await ghJson(env, ['api', '-X', 'POST', `repos/${at.repo}/issues/${at.number}/comments`, '-f', `body=> ${c.text}\n\n${body}${c.url ? `\n\n${c.url}` : ''}`], 'posting the reply');
      }
      done.replied = true;
      if (c.kind === 'thread' && answer.kind !== 'tracked' && !c.resolved) {
        const out = await ghJson(env, ['api', 'graphql', '-f', 'query=mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { id isResolved } } }', '-f', `id=${c.id}`], 'resolving the thread');
        if (!out?.data?.resolveReviewThread?.thread?.isResolved) throw new ReviewError(`GitHub did not resolve ${c.id}${out?.errors?.[0]?.message ? `: ${out.errors[0].message}` : ''}`);
        done.resolved = true;
      }
    } catch (e) {
      closed.push(done);
      const said = closed.map(x => `${x.id} ${x.replied ? 'replied' : 'not replied'}${x.resolved ? ', resolved' : ''}`).join('; ');
      throw new ReviewError(`${e.message} — so far: ${said}`, e.exitCode ?? 2);
    }
    closed.push(done);
  }
  const verb = answer.kind === 'tracked' ? 'replied, left open (tracked)' : 'replied and resolved';
  return {
    data: { repo: at.repo, number: at.number, answer: answer.kind, value: answer.value, reply: body, closed, ...(filed ? { issue: filed } : {}) },
    text: closed.map(x => `${x.id}: ${x.kind === 'thread' ? verb : `replied (a ${x.kind === 'review' ? 'review body' : 'conversation comment'} has no thread to resolve)`}`).join('\n'),
    exitCode: 0,
  };
}

// ---- after the push (phase 60) ------------------------------------------------------
//
// A project that ships to main ("crossReview": { "after": "push" }) has each
// push reviewed after it lands: its findings are commit comments on the head
// and, all of them, one tracking issue per push (label keel:review-after),
// whose first line is a hidden record of its findings (lib.mjs recordOf: ids
// F1, F2, …). `keel review <repo>@<sha>` reads that issue and its comments,
// leaving a receipt as for a PR; `--close` answers each finding with a
// comment on the issue (`**F1** \`path:line\`: **Fixed** in …`) and closes
// the issue once every finding is answered. A finding is answered by such a
// comment, whoever posts it; tracked counts as answered (it is tracked
// elsewhere).

/** A comment that answers a push's finding: its id in bold, then keel's answer (replyText). */
const PUSH_ANSWER = /^\*\*(F\d+)\*\*[^\n]*?(\*\*Fixed\*\* in |\*\*Valid, tracked\*\* in |\*\*Not valid:\*\* )/;
const ANSWER_KIND = { '**Fixed** in ': 'fixed', '**Valid, tracked** in ': 'tracked', '**Not valid:** ': 'not-valid' };
const oneLine = (text, n = 120) => { const t = String(text ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** At most this many pages of 100 tracking issues are read looking for a push's (a push a day is years of them). */
export const ISSUE_PAGES = 50;

/**
 * The push's tracking issue: the one the workflow opened whose record ends
 * at `sha` (7 hex or more). Every page of keel:review-after issues, newest
 * first, until one records it or the list ends (keel#65: a fixed window lost
 * an older push's unanswered findings once newer pushes filled it).
 */
async function readPushIssue(env, at) {
  const found = [], started = [];
  let page = 1, full = false;
  for (; page <= ISSUE_PAGES; page++) {
    const list = await ghJson(env, ['api', `repos/${at.repo}/issues?labels=${encodeURIComponent(PUSH_LABEL)}&state=all&per_page=100&page=${page}`], 'the review issues');
    if (!Array.isArray(list)) throw new ReviewError('GitHub could not be read (the review issues): not a list');
    for (const i of list) {
      if (i?.pull_request) continue;
      const issue = { number: i?.number, title: i?.title ?? null, body: i?.body ?? '', state: String(i?.state ?? '').toUpperCase(), url: i?.html_url ?? null, createdAt: i?.created_at ?? null, author: { login: i?.user?.login ?? '' } };
      const record = byWorkflow(issue) ? recordOf(issue.body) : null;
      if (!record?.to.startsWith(at.sha)) continue;
      // A start records where reviews begin, and reviews nothing (keel#65): never a review with no findings.
      (record.start ? started : found).push({ ...issue, record });
    }
    full = list.length >= 100;
    if (found.length || !full) break;
  }
  if (!found.length && full) throw new ReviewError(`GitHub could not be read (the review issues): ${ISSUE_PAGES * 100} or more ${PUSH_LABEL} issues, and none of them records ${at.sha}; the read is incomplete`);
  if (!found.length && started.length) throw new ReviewError(`${at.repo}@${at.sha} was not reviewed: the review after the push started its record there (#${started[0].number}), so the commits up to it are not reviewed; the next push is reviewed from it`, 1);
  if (!found.length) throw new ReviewError(`no review after the push ends at ${at.sha} on ${at.repo}: no ${PUSH_LABEL} issue records it (the push may be waiting for the day's budget, or for its run)`);
  if (new Set(found.map(i => i.record.to)).size > 1) throw usage(`${at.sha} names more than one reviewed push on ${at.repo}: give more of the sha`);
  return found[0];
}

/** The tracking issue's comments: [{ id, author, body, at, url }]. A page that may hold more is an incomplete read. */
async function readIssueComments(env, at, number) {
  const list = await ghJson(env, ['api', `repos/${at.repo}/issues/${number}/comments?per_page=100`], 'the review issue\'s comments');
  if (!Array.isArray(list)) throw new ReviewError('GitHub could not be read (the review issue\'s comments): not a list');
  if (list.length >= 100) throw new ReviewError('GitHub could not be read (the review issue\'s comments): 100 or more; the read is incomplete');
  return list.map(c => ({ id: String(c?.id ?? ''), author: c?.user?.login ?? 'ghost', body: String(c?.body ?? ''), at: c?.created_at ?? null, url: c?.html_url ?? null }));
}

/** The issue's findings, each answered or not by the newest comment that answers it. */
function pushFindings(issue, comments) {
  const answers = new Map();
  for (const c of comments) {
    const m = PUSH_ANSWER.exec(c.body.trim());
    if (m) answers.set(m[1], { kind: ANSWER_KIND[m[2]], by: c.author, url: c.url });
  }
  return (issue.record.findings ?? []).map(f => ({
    kind: 'finding', id: f.id, severity: f.severity, path: f.path, line: f.line, text: `${f.severity} ${f.text}`, url: f.url ?? null,
    answered: answers.has(f.id), answer: answers.get(f.id)?.kind ?? null,
  }));
}

/**
 * Whether a comment is an answer pushFindings applied: answer-shaped and
 * naming one of the issue's findings. One naming no finding (`**F9**` where
 * only F1 and F2 exist) answered nothing, so it is news like any comment
 * (keel#65).
 */
const appliedAnswer = (c, ids) => { const m = PUSH_ANSWER.exec(c.body.trim()); return Boolean(m) && ids.includes(m[1]); };
/**
 * Not news to the reader: an answer that was applied, or the workflow's own comment, known by its keel
 * marker (keel#65): any workflow's comment is github-actions', so the login alone would hide another's.
 */
const notPushNews = (c, ids) => appliedAnswer(c, ids) || (byWorkflow({ author: { login: c.author } }) && /^<!-- keel:/.test(String(c.body ?? '').trim()));
/** The issue's comments that are neither an applied answer nor the workflow's own: shown whole by a read, which marks them read. */
const followUpsOf = (comments, ids) => comments.filter(c => !notPushNews(c, ids))
  .map(c => ({ id: c.id, author: c.author, at: c.at, url: c.url, body: c.body }));

/**
 * The reply to a push's finding: keel's reply, but a tracked one says the
 * review issue may close, since the finding is answered and its work is
 * tracked elsewhere (keel#65: "left open" read wrong as the issue closed).
 */
export const pushReplyText = answer => (answer.kind === 'tracked' ? `**Valid, tracked** in ${answer.value}: the fix is tracked there, so this finding is answered and this review's issue can close.` : replyText(answer));

/** Where a push's read receipt lives: by its full head sha, so a short and a long sha share it. */
const pushKey = (at, issue) => ({ repo: at.repo, number: `after-${issue.record.to}` });

function pushText(d) {
  const lines = [`${d.repo}@${short(d.sha)} — the review after the push, by ${d.reviewer ?? 'its reviewer'} (${d.alone ? `${short(d.sha)} alone` : `${short(d.from)}..${short(d.sha)}`}): #${d.issue} (${String(d.state).toLowerCase()}) ${d.url ?? ''}`.trimEnd()];
  const open = d.comments.filter(c => !c.answered);
  lines.push(`${d.comments.length} finding${d.comments.length === 1 ? '' : 's'}, ${open.length} unanswered`);
  for (const c of [...open, ...d.comments.filter(c => c.answered)]) lines.push(`  ${c.answered ? c.answer.padEnd(10) : 'UNANSWERED'} ${c.id}  ${c.path}:${c.line}  ${oneLine(c.text)}`);
  // Every other comment on the issue, whole: the receipt marks each one read, so each is shown (keel#65).
  if (d.followUps.length) {
    lines.push('', `${d.followUps.length} other comment${d.followUps.length === 1 ? '' : 's'} on #${d.issue}, read before closing:`);
    for (const f of d.followUps) lines.push(`  ${f.id}  ${f.author}  ${f.at ?? ''}`.trimEnd(), ...f.body.split('\n').map(l => `    ${l}`));
  }
  if (open.length) {
    lines.push('', 'Validate each against the code, then answer it (several ids: comma-separated, one call):',
      `  keel review ${d.repo}@${short(d.sha)} --close ${open.map(c => c.id).join(',')} --fixed <commit> | --tracked <issue|version> | --not-valid "<why>"`);
  }
  return lines.join('\n');
}

/** keel review <repo>@<sha>: the push's findings, which are answered; a receipt of what it showed. */
async function reviewPush(at, { env }) {
  const readAt = new Date().toISOString();
  const issue = await readPushIssue(env, at);
  const comments = await readIssueComments(env, at, issue.number);
  const findings = pushFindings(issue, comments);
  const unanswered = findings.filter(f => !f.answered).length;
  const key = pushKey(at, issue);
  try { await writeReceipt(env, key, { at: readAt, head: issue.record.to, ids: findings.map(f => f.id), threads: {}, seen: comments.map(c => c.id) }); }
  catch (e) { throw new ReviewError(`keel review could not record what it read (${receiptPath(env, key)}): ${e.message}`); }
  const data = {
    repo: at.repo, sha: issue.record.to, from: issue.record.from, alone: Boolean(issue.record.alone), reviewer: issue.record.agent ?? null,
    issue: issue.number, url: issue.url ?? null, state: issue.state ?? null, title: issue.title ?? null,
    comments: findings, unanswered, answered: findings.length - unanswered, ok: unanswered === 0,
    followUps: followUpsOf(comments, findings.map(f => f.id)),
  };
  return { data, text: pushText(data), exitCode: data.ok ? 0 : 1 };
}

/**
 * Phase 54's seam: the keel:agent issue a finding answered tracked becomes.
 * keel review only drafts it (`work` in --close --json); filing it is the
 * robot's (phase 54), never this command's. Pure.
 */
export function trackedWork({ repo, sha, issue, finding }) {
  return {
    title: `${finding.severity} ${finding.path}:${finding.line}: ${oneLine(finding.text.replace(/^P\d /, ''), 80)}`,
    labels: ['keel:agent'],
    body: [
      `A finding of the review after ${short(sha)} (${issue.url ?? `#${issue.number}`}), answered tracked.`, '',
      `- Where: \`${finding.path}:${finding.line}\` at ${sha}`,
      `- Priority: ${finding.severity}`, '',
      finding.text, '',
      `Done when the fix lands and the finding is answered: \`keel review ${repo}@${short(sha)} --close ${finding.id} --fixed <commit>\`.`,
    ].join('\n'),
  };
}

/** keel review <repo>@<sha> --close: a reply on the issue per finding, and the issue closed once every finding is answered. */
async function closePush(at, list, answer, { env }) {
  const issue = await readPushIssue(env, at);
  const comments = await readIssueComments(env, at, issue.number);
  const findings = pushFindings(issue, comments);
  const cmd = `keel review ${at.repo}@${short(issue.record.to)}`;
  const unknown = list.filter(id => !findings.some(f => f.id === id));
  if (unknown.length) throw usage(`not a finding of the review after ${short(issue.record.to)} on ${at.repo}: ${unknown.join(', ')} (${cmd} lists them)`);
  // Closed only after it was read: each id shown by this push's newest read, and no comment since but keel's answers and the workflow's own.
  const key = pushKey(at, issue);
  const receipt = await readReceipt(env, key);
  const seen = new Set(receipt?.seen ?? []);
  const fresh = receipt ? comments.filter(c => !seen.has(c.id) && !notPushNews(c, findings.map(f => f.id))) : [];
  const unread = list.filter(id => !receipt?.ids.includes(id));
  if (unread.length || fresh.length) {
    throw usage([
      ...unread.map(id => `not read yet: ${id}: run ${cmd}, validate it, then close it`),
      ...fresh.map(c => `arrived since your last read (${receipt.at}): comment ${c.id} (${c.author}) ${oneLine(c.body)}`),
      `nothing posted: read with ${cmd}, validate, then close (each id named; there is no "all")`,
    ].join('\n'));
  }
  const reply = pushReplyText(answer);
  const closed = [];
  for (const id of list) {
    const f = findings.find(x => x.id === id);
    try {
      await ghJson(env, ['api', '-X', 'POST', `repos/${at.repo}/issues/${issue.number}/comments`, '-f', `body=**${id}** \`${f.path}:${f.line}\`: ${reply}`], 'posting the reply');
    } catch (e) {
      throw new ReviewError(`${e.message} — so far: ${closed.map(x => `${x.id} replied`).join('; ') || 'nothing replied'}`, e.exitCode ?? 2);
    }
    closed.push({ id, kind: 'finding', answer: answer.kind, replied: true });
  }
  const left = findings.filter(f => !f.answered && !list.includes(f.id)).map(f => f.id);
  let issueClosed = String(issue.state ?? '').toUpperCase() === 'CLOSED';
  if (!left.length && !issueClosed) {
    await ghJson(env, ['api', '-X', 'PATCH', `repos/${at.repo}/issues/${issue.number}`, '-f', 'state=closed', '-f', 'state_reason=completed'], 'closing the review issue');
    issueClosed = true;
  }
  const work = answer.kind === 'tracked' ? list.map(id => ({ id, draft: trackedWork({ repo: at.repo, sha: issue.record.to, issue, finding: findings.find(x => x.id === id) }) })) : [];
  return {
    data: { repo: at.repo, sha: issue.record.to, issue: issue.number, answer: answer.kind, value: answer.value, reply, closed, left, issueClosed, work },
    text: [...closed.map(x => `${x.id}: replied on #${issue.number}`), left.length ? `#${issue.number} stays open: ${left.join(', ')} unanswered` : `#${issue.number} closed: every finding is answered`].join('\n'),
    exitCode: 0,
  };
}
