// keel review (phase 41): a PR's review comments read deterministically,
// which are answered, waiting for the reviewer, and answering each one —
// against a stub gh that answers the GraphQL and REST calls and refuses any
// write the test does not expect. Fixtures are Acme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, cleanEnv } from './helpers/run.mjs';
import { answerOf, parseTarget, summarizedHead } from '../lib/review.mjs';
import { reviewComments, reviewConfigOf } from '../practices/night/files/scripts/keel/lib.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(KEEL, 'bin', 'keel.mjs');
const HEAD = 'abc1234abc1234abc1234abc1234abc1234abc1';
const OLD = 'def5678def5678def5678def5678def5678def5';

// ---- the stub gh -----------------------------------------------------------------

/**
 * A gh for keel review. State: head, threads [{id, isResolved, path, line,
 * comments: [{databaseId, author, body, createdAt}], more?}], comments (conversation),
 * bodies (reviews' top-level bodies, GraphQL), more{Threads,Comments,Reviews},
 * reviews [{user, commit_id, state, after?}] (a review with `after: k` appears
 * from the k-th reviews read on), contents (the repo's .keel/keel.json, or
 * absent: 404), down (every call fails), writes (posts and mutations allowed).
 * Every call is logged; a write the test did not allow exits 1.
 */
async function stubGh(t, state) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-review-gh-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'gh'), statePath = join(dir, 'state.json'), log = join(dir, 'gh.log');
  await writeFile(statePath, JSON.stringify({ head: HEAD, threads: [], comments: [], reviews: [], reviewReads: 0, ...state }));
  await writeFile(path, `#!${process.execPath}
const fs = require('node:fs');
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(argv) + '\\n');
const s = JSON.parse(fs.readFileSync(${JSON.stringify(statePath)}, 'utf8'));
const save = () => fs.writeFileSync(${JSON.stringify(statePath)}, JSON.stringify(s));
const field = k => (argv.find(a => a.startsWith(k + '=')) ?? '').slice(k.length + 1);
const deny = () => { console.error('stub gh: a write the test did not expect: ' + argv.join(' ')); process.exit(1); };
if (s.down) { console.error('error connecting to api.github.com'); process.exit(1); }
const node = c => ({ databaseId: c.databaseId, author: { login: c.author }, body: c.body, createdAt: c.createdAt, url: 'https://github.com/acme/app/pull/3#c' + c.databaseId });
if (argv[0] === 'api' && argv[1] === 'graphql') {
  const q = field('query');
  if (q.startsWith('mutation')) {
    if (!s.writes) deny();
    const t = s.threads.find(x => x.id === field('id'));
    t.isResolved = true; save();
    console.log(JSON.stringify({ data: { resolveReviewThread: { thread: { id: t.id, isResolved: true } } } }));
  } else if (s.noPr) console.log(JSON.stringify({ data: { repository: { pullRequest: null } } }));
  else console.log(JSON.stringify({ data: { repository: { pullRequest: {
    number: 3, title: 'Acme rocket skates', url: 'https://github.com/acme/app/pull/3', state: 'OPEN', mergedAt: null, headRefOid: s.head,
    author: { login: 'acme-owner' },
    reviewThreads: { pageInfo: { hasNextPage: !!s.moreThreads }, nodes: s.threads.map(t => ({ id: t.id, isResolved: !!t.isResolved, path: t.path ?? null, line: t.line ?? null, comments: { pageInfo: { hasNextPage: !!t.more }, nodes: t.comments.map(node) } })) },
    comments: { pageInfo: { hasNextPage: !!s.moreComments }, nodes: s.comments.map(c => ({ id: c.id, ...node(c) })) },
    reviews: { pageInfo: { hasNextPage: !!s.moreReviews }, nodes: (s.bodies ?? []).map(r => ({ id: r.id, databaseId: r.databaseId, author: { login: r.author }, body: r.body, state: 'COMMENTED', submittedAt: r.createdAt, url: 'https://github.com/acme/app/pull/3#pullrequestreview-' + r.databaseId })) },
  } } } }));
} else if (argv[0] === 'api' && argv[1] === '-X' && argv[2] === 'POST') {
  if (!s.writes) deny();
  const m = /comments\\/(\\d+)\\/replies$/.exec(argv[3]);
  if (m) s.threads.find(t => t.comments[0].databaseId === Number(m[1])).comments.push({ databaseId: 900 + s.threads.length, author: 'acme-owner', body: field('body'), createdAt: '2026-10-06T12:00:00Z' });
  else s.comments.push({ id: 'IC_new', databaseId: 999, author: 'acme-owner', body: field('body'), createdAt: '2026-10-06T12:00:00Z' });
  save();
  console.log('{}');
} else if (argv[0] === 'api' && /\\/pulls\\/\\d+\\/reviews/.test(argv[1])) {
  s.reviewReads++; save();
  console.log(JSON.stringify(s.reviews.filter(r => (r.after ?? 0) <= s.reviewReads).map(r => ({ user: { login: r.user }, state: r.state ?? 'COMMENTED', commit_id: r.commit_id, submitted_at: '2026-10-06T10:00:00Z' }))));
} else if (argv[0] === 'api' && argv[1].endsWith('/contents/.keel/keel.json')) {
  if (!s.contents) { console.error('gh: Not Found (HTTP 404)'); process.exit(1); }
  console.log(JSON.stringify({ content: Buffer.from(JSON.stringify(s.contents)).toString('base64') }));
} else { console.error('stub gh: unknown ' + argv.join(' ')); process.exit(1); }
`);
  await chmod(path, 0o755);
  return {
    path,
    calls: async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(l => JSON.parse(l)),
    state: async () => JSON.parse(await readFile(statePath, 'utf8')),
  };
}
const writesIn = calls => calls.filter(c => c.includes('POST') || c.some(a => a.startsWith('query=mutation')));

/** An Acme project whose repo is acme/app, with a "review" config. */
async function project(t, review = { reviewers: ['acme-reviewer[bot]'], wait: 0.02 }) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-review-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, '.keel'));
  await writeFile(join(dir, '.keel', 'keel.json'), JSON.stringify({ name: 'Acme', repo: 'acme/app', ...(review === null ? {} : { review }) }));
  return dir;
}
const keel = (cwd, gh, args, env = {}) => {
  const r = run(process.execPath, [BIN, 'review', ...args], { cwd, env: { ...cleanEnv(), KEEL_GH: gh.path, KEEL_REVIEW_POLL_MS: '40', ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
};

const c = (databaseId, author, body, day = '2026-10-05') => ({ databaseId, author, body, createdAt: `${day}T09:00:00Z` });
const UNANSWERED = { id: 'PRRT_open', path: 'skates.js', line: 12, comments: [c(11, 'acme-reviewer', '**P1** The skates have no brakes.\n\nDetails follow.')] };
const ANSWERED = { id: 'PRRT_done', path: 'rocket.js', line: 3, comments: [c(21, 'acme-reviewer', 'The fuse is short.'), c(22, 'acme-owner', 'Fixed in abc1234.')] };
const RESOLVED = { id: 'PRRT_resolved', isResolved: true, comments: [c(31, 'acme-reviewer', 'Rename the anvil.'), c(32, 'acme-owner', 'Renamed in abc1234.')] };
const SELF_REPLY = { id: 'PRRT_self', comments: [c(41, 'acme-reviewer', 'Also the paint.'), c(42, 'acme-reviewer', 'And the wheels.')] };
const ON_HEAD = { user: 'acme-reviewer[bot]', commit_id: HEAD };

// ---- the read -------------------------------------------------------------------

test('one answered and one unanswered comment: exit 1, the unanswered one named with its first line', async t => {
  const dir = await project(t);
  const gh = await stubGh(t, { threads: [ANSWERED, UNANSWERED, RESOLVED, SELF_REPLY], reviews: [ON_HEAD] });
  const r = keel(dir, gh, ['acme/app#3']);
  assert.equal(r.code, 1, r.err + r.out);
  assert.match(r.out, /^ {2}UNANSWERED PRRT_open {2}acme-reviewer {2}skates\.js:12 {2}P1 The skates have no brakes\.$/m);
  assert.match(r.out, /UNANSWERED PRRT_self/, 'a reviewer replying to itself is not an answer');
  assert.match(r.out, /answered +PRRT_done  acme-reviewer  rocket\.js:3  The fuse is short\./);
  assert.match(r.out, /resolved +PRRT_resolved  acme-reviewer  thread  Rename the anvil\./);
  assert.match(r.out, /--close PRRT_open,PRRT_self --fixed <commit> \| --tracked <issue\|version> \| --not-valid "<why>"/);
  const d = keel(dir, gh, ['acme/app#3', '--json']);
  assert.equal(d.code, 1);
  const data = d.json();
  assert.deepEqual([data.unanswered, data.answered, data.ok], [2, 2, false]);
  assert.deepEqual(data.comments.filter(x => !x.answered).map(x => x.id), ['PRRT_open', 'PRRT_self']);
  assert.equal(writesIn(await gh.calls()).length, 0, 'a read writes nothing');
});

test('every comment answered: exit 0, and a reviewer\'s conversation comment counts too', async t => {
  const dir = await project(t);
  const gh = await stubGh(t, { threads: [ANSWERED, RESOLVED], reviews: [ON_HEAD],
    comments: [{ id: 'IC_1', ...c(51, 'acme-reviewer', 'Codex review: two findings.', '2026-10-05') }, { id: 'IC_2', ...c(52, 'acme-owner', '> Codex review: two findings.\n\nBoth answered.', '2026-10-06') }] });
  const r = keel(dir, gh, ['acme/app#3', '--json']);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.json().comments.map(x => [x.id, x.kind, x.answered]), [['PRRT_done', 'thread', true], ['PRRT_resolved', 'thread', true], ['IC_1', 'comment', true]]);
  // The same comment with nobody after it: unanswered.
  const alone = await stubGh(t, { threads: [], reviews: [ON_HEAD], comments: [{ id: 'IC_1', ...c(51, 'acme-reviewer', 'Codex review: two findings.') }] });
  const a = keel(dir, alone, ['acme/app#3', '--json']);
  assert.equal(a.code, 1);
  assert.deepEqual(a.json().comments.map(x => [x.id, x.answered]), [['IC_1', false]]);
  // A reviewer's status board (a sticky comment opening with a hidden marker) is listed and owes no answer.
  const board = await stubGh(t, { reviews: [ON_HEAD], threads: [{ id: 'PRRT_badge', isResolved: true, comments: [c(81, 'acme-reviewer', '**<sub><sub>![P1 Badge](https://img.acme.test/p1.svg)</sub></sub>  Close the hatch**'), c(82, 'acme-owner', 'Closed in abc1234.')] }],
    comments: [{ id: 'IC_board', ...c(91, 'acme-reviewer', '<!-- acme-review-summary -->\n\n## Acme Review Summary\n\n| Review | Status |') }] });
  const b = keel(dir, board, ['acme/app#3', '--json']);
  assert.equal(b.code, 0, b.out);
  assert.deepEqual(b.json().comments.map(x => [x.id, x.status ?? false, x.answered, x.text]), [['PRRT_badge', false, true, 'P1 Badge Close the hatch'], ['IC_board', true, true, 'Acme Review Summary']]);
  assert.match(keel(dir, board, ['acme/app#3']).out, /status +IC_board/);
  // With no reviewer named, conversation comments are not read; threads are.
  const none = await project(t, null);
  assert.equal(keel(none, alone, ['acme/app#3']).code, 0);
});

test('GitHub unreadable exits 2, never 0: gh down, no such PR, an incomplete read, a bad review config', async t => {
  const dir = await project(t);
  for (const [why, state] of [['down', { down: true }], ['no PR', { noPr: true }], ['more threads than one page', { moreThreads: true, threads: [ANSWERED] }]]) {
    const gh = await stubGh(t, state);
    const r = keel(dir, gh, ['acme/app#3', '--json']);
    assert.equal(r.code, 2, `${why}: ${r.out}${r.err}`);
    assert.match(r.json().error, /GitHub could not be read/, why);
    assert.equal(keel(dir, gh, ['acme/app#3']).code, 2, `${why} (text)`);
  }
  const bad = await project(t, { reviewers: 'acme-reviewer' });
  const r = keel(bad, await stubGh(t, {}), ['acme/app#3']);
  assert.equal(r.code, 2);
  assert.match(r.err, /"reviewers" must be a list of GitHub logins/);
  assert.equal(keel(dir, await stubGh(t, {}), ['acme/app']).code, 2, 'a target with no number is usage');
});

test('reviewers: the project here, else the PR repo\'s own .keel/keel.json, else none; [bot] is the same login', async t => {
  assert.deepEqual(reviewConfigOf({}), { reviewers: [], wait: 10 });
  for (const bad of [{ review: [] }, { review: { reviewers: [''] } }, { review: { wait: 0 } }, { review: { wait: '5' } }, { review: { reviewer: [] } }]) {
    assert.ok(reviewConfigOf(bad).problem, JSON.stringify(bad));
  }
  const elsewhere = await project(t, null); // its repo is acme/app; the PR is acme/shop's
  const gh = await stubGh(t, { contents: { name: 'Shop', review: { reviewers: ['acme-reviewer'] } }, reviews: [{ user: 'acme-reviewer[bot]', commit_id: HEAD }] });
  const d = keel(elsewhere, gh, ['acme/shop#3', '--json']).json();
  assert.deepEqual([d.reviewers, d.reviewersFrom, d.reviewed[0].head], [['acme-reviewer'], "acme/shop's .keel/keel.json", true]);
  const none = keel(elsewhere, await stubGh(t, {}), ['https://github.com/acme/shop/pull/3', '--json']).json();
  assert.deepEqual([none.reviewers, none.reviewersFrom], [[], 'acme/shop has no .keel/keel.json']);
  assert.deepEqual(parseTarget('#3', 'acme/app'), { repo: 'acme/app', number: 3 });
});

// ---- waiting ----------------------------------------------------------------------

test('--wait returns when the named reviewer\'s review on the head commit appears', async t => {
  const dir = await project(t, { reviewers: ['acme-reviewer'], wait: 0.5 });
  const gh = await stubGh(t, { threads: [ANSWERED], reviews: [{ user: 'acme-reviewer[bot]', commit_id: OLD }, { user: 'acme-reviewer[bot]', commit_id: HEAD, after: 3 }] });
  const r = keel(dir, gh, ['acme/app#3', '--wait', '--json']);
  assert.equal(r.code, 0, r.out + r.err);
  const d = r.json();
  assert.equal(d.waited.timedOut, false);
  assert.equal(d.reviewed[0].head, true);
  assert.equal((await gh.state()).reviewReads, 3, 'it polled until the review appeared, and no longer');
});

// Codex on the v0.8.5 PRs: no findings is a status board naming the commit and a 👍, never a review; --wait timed out on it.
test('--wait counts a named reviewer\'s summary that marks the head commit completed, and not one for an older commit', async t => {
  const board = sha => `<!-- acme-review-summary -->\n| Review | Status | Commit |\n| --- | --- | --- |\n| Code Review | ✅ **Completed** | \`${sha.slice(0, 7)}\` |`;
  assert.equal(summarizedHead(board(HEAD), HEAD), true);
  assert.equal(summarizedHead(board(OLD), HEAD), false, 'an older commit');
  assert.equal(summarizedHead(board(HEAD).replace('Completed', 'Running'), HEAD), false, 'still running');
  const dir = await project(t, { reviewers: ['acme-reviewer'], wait: 0.01 });
  const done = await stubGh(t, { threads: [ANSWERED], comments: [{ id: 'IC_board', databaseId: 77, author: 'acme-reviewer[bot]', body: board(HEAD), createdAt: '2026-10-06T10:00:00Z' }] });
  const r = keel(dir, done, ['acme/app#3', '--wait', '--json']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.deepEqual([r.json().waited.timedOut, r.json().reviewed[0].head], [false, true]);
  const stale = await stubGh(t, { threads: [ANSWERED], comments: [{ id: 'IC_board', databaseId: 77, author: 'acme-reviewer[bot]', body: board(OLD), createdAt: '2026-10-06T10:00:00Z' }] });
  assert.equal(keel(dir, stale, ['acme/app#3', '--wait', '--json']).json().waited.timedOut, true);
});

test('--wait on timeout says so, exit 1: a timeout is never "no comments"', async t => {
  const dir = await project(t, { reviewers: ['acme-reviewer'], wait: 0.005 });
  const gh = await stubGh(t, { reviews: [{ user: 'acme-reviewer[bot]', commit_id: OLD }] });
  const r = keel(dir, gh, ['acme/app#3', '--wait']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /Waited 0\.005 min: timed out; acme-reviewer has not reviewed abc1234\. Not "no comments"/);
  assert.match(r.out, /acme-reviewer last reviewed def5678, not the head/);
  const none = await project(t, null);
  const n = keel(none, gh, ['acme/app#3', '--wait', '--json']);
  assert.equal(n.code, 0, 'no reviewer named: nothing to wait for');
  assert.equal(n.json().waited.timedOut, false);
});

test('--gate (a phase that opted in to review: wait) exits 0 only when every comment is answered and the head was reviewed', async t => {
  const dir = await project(t);
  const notYet = keel(dir, await stubGh(t, { threads: [ANSWERED], reviews: [{ user: 'acme-reviewer[bot]', commit_id: OLD }] }), ['acme/app#3', '--gate']);
  assert.equal(notYet.code, 1);
  assert.match(notYet.out, /Gate: acme-reviewer\[bot\] has not reviewed the head commit yet/);
  assert.equal(keel(dir, await stubGh(t, { threads: [ANSWERED], reviews: [{ user: 'acme-reviewer[bot]', commit_id: OLD }] }), ['acme/app#3']).code, 0, 'without --gate, an unreviewed head is not a failure');
  assert.equal(keel(dir, await stubGh(t, { threads: [ANSWERED, UNANSWERED], reviews: [ON_HEAD] }), ['acme/app#3', '--gate']).code, 1, 'an unanswered comment holds the gate');
  assert.equal(keel(dir, await stubGh(t, { threads: [ANSWERED, RESOLVED], reviews: [ON_HEAD] }), ['acme/app#3', '--gate']).code, 0);
});

// ---- answering ---------------------------------------------------------------------

test('--close posts the reply and resolves for fixed and not-valid; posts and leaves open for tracked', async t => {
  const dir = await project(t);
  const threads = [UNANSWERED, { ...SELF_REPLY }, { id: 'PRRT_track', comments: [c(61, 'acme-reviewer', 'Anvils rust.')] }];
  const gh = await stubGh(t, { threads, reviews: [ON_HEAD], writes: true,
    comments: [{ id: 'IC_9', ...c(71, 'acme-reviewer', 'Codex: the README is wrong.') }] });
  const fixed = keel(dir, gh, ['acme/app#3', '--close', 'PRRT_open', '--fixed', 'abc1234', '--json']);
  assert.equal(fixed.code, 0, fixed.out + fixed.err);
  assert.deepEqual(fixed.json().closed, [{ id: 'PRRT_open', kind: 'thread', answer: 'fixed', replied: true, resolved: true }]);
  const tracked = keel(dir, gh, ['acme/app#3', '--close', 'PRRT_track', '--tracked', '#12']);
  assert.equal(tracked.code, 0, tracked.err);
  assert.match(tracked.out, /PRRT_track: replied, left open \(tracked\)/);
  const nv = keel(dir, gh, ['acme/app#3', '--close', 'PRRT_self,IC_9', '--not-valid', 'the wheels are steel; see skates.js:40']);
  assert.equal(nv.code, 0, nv.err);
  const calls = writesIn(await gh.calls());
  const posts = calls.filter(x => x.includes('POST'));
  assert.deepEqual(posts.map(x => x[3]), ['repos/acme/app/pulls/3/comments/11/replies', 'repos/acme/app/pulls/3/comments/61/replies', 'repos/acme/app/pulls/3/comments/41/replies', 'repos/acme/app/issues/3/comments']);
  assert.equal(posts[0].at(-1), 'body=**Fixed** in abc1234. Validated against the code first.');
  assert.equal(posts[1].at(-1), 'body=**Valid, tracked** in #12. Left open until the fix lands.');
  assert.equal(posts[2].at(-1), 'body=**Not valid:** the wheels are steel; see skates.js:40');
  assert.match(posts[3].at(-1), /^body=> Codex: the README is wrong\.\n\n\*\*Not valid:\*\*/);
  const resolved = calls.filter(x => x.some(a => a.startsWith('query=mutation'))).map(x => x.at(-1));
  assert.deepEqual(resolved, ['id=PRRT_open', 'id=PRRT_self'], 'fixed and not-valid resolve; tracked and a conversation comment do not');
  const s = await gh.state();
  assert.deepEqual(s.threads.map(x => [x.id, !!x.isResolved]), [['PRRT_open', true], ['PRRT_self', true], ['PRRT_track', false]]);
  // Read again: every comment answered now.
  assert.equal(keel(dir, gh, ['acme/app#3']).code, 0);
});

test('--close refuses a not-valid with no reason, a fixed with no commit, and an unknown id, posting nothing', async t => {
  const dir = await project(t);
  const gh = await stubGh(t, { threads: [UNANSWERED] }); // writes not allowed: a post would exit 1
  for (const args of [
    ['--close', 'PRRT_open', '--not-valid', ''],
    ['--close', 'PRRT_open', '--not-valid', 'no'],
    ['--close', 'PRRT_open', '--not-valid'],
    ['--close', 'PRRT_open', '--fixed', 'soon'],
    ['--close', 'PRRT_open', '--fixed'],
    ['--close', 'PRRT_open', '--tracked', 'later'],
    ['--close', 'PRRT_open'],
    ['--close', 'PRRT_open', '--fixed', 'abc1234', '--not-valid', 'both at once'],
    ['--close', 'PRRT_nope', '--fixed', 'abc1234'],
    ['--fixed', 'abc1234'],
  ]) {
    const r = keel(dir, gh, ['acme/app#3', ...args, '--json']);
    assert.equal(r.code, 2, `${args.join(' ')}: ${r.out}`);
    assert.equal(typeof r.json().error, 'string');
  }
  assert.equal(writesIn(await gh.calls()).length, 0, 'nothing was posted or resolved');
  assert.throws(() => answerOf({ notValid: '   ' }), /needs the reason/);
  assert.deepEqual(answerOf({ fixed: 'acme/app@abc1234' }), { kind: 'fixed', value: 'acme/app@abc1234' });
  assert.deepEqual(answerOf({ tracked: 'v0.9.0' }), { kind: 'tracked', value: 'v0.9.0' });
});

// ---- not a gate ----------------------------------------------------------------------

test('nothing in keel refuses a merge because of an open thread: drain, fleet update and update read no reviews', async () => {
  for (const file of ['practices/night/files/scripts/keel/drain.mjs', 'lib/fleet.mjs', 'lib/update.mjs', 'lib/night.mjs', 'practices/night/files/.github/workflows/keel-night.yml']) {
    const text = await readFile(join(KEEL, file), 'utf8');
    assert.doesNotMatch(text, /reviewThreads|reviewComments|keel review|review\.mjs/, `${file} reads reviews`);
  }
  // The rule's own reader never gates: an unanswered comment is a count and a name, not a refusal.
  const pr = { number: 3, reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [{ id: 'PRRT_x', isResolved: false, comments: { nodes: [{ databaseId: 1, author: { login: 'acme-reviewer' }, body: 'x', createdAt: '2026-10-05T00:00:00Z' }] } }] } };
  assert.deepEqual(reviewComments(pr).map(x => [x.id, x.answered]), [['PRRT_x', false]]);
});

// ---- what counts as an answer (Codex's review of v0.8.3) ------------------------------

/** A PR as the GraphQL read returns it, from threads, conversation comments and review bodies (the stub's shapes). */
const prOf = ({ threads = [], comments = [], bodies = [], author = 'acme-owner' } = {}) => {
  const node = x => ({ databaseId: x.databaseId, author: { login: x.author }, body: x.body, createdAt: x.createdAt, url: `https://github.com/acme/app/pull/3#c${x.databaseId}` });
  return { number: 3, author: { login: author },
    reviewThreads: { pageInfo: { hasNextPage: false }, nodes: threads.map(t => ({ id: t.id, isResolved: !!t.isResolved, path: null, line: null, comments: { pageInfo: { hasNextPage: !!t.more }, nodes: t.comments.map(node) } })) },
    comments: { pageInfo: { hasNextPage: false }, nodes: comments.map(x => ({ id: x.id, ...node(x) })) },
    reviews: { pageInfo: { hasNextPage: false }, nodes: bodies.map(r => ({ id: r.id, databaseId: r.databaseId, author: { login: r.author }, body: r.body, state: 'COMMENTED', submittedAt: r.createdAt, url: `https://github.com/acme/app/pull/3#pullrequestreview-${r.databaseId}` })) } };
};
const answered = (pr, reviewers = ['acme-reviewer[bot]']) => Object.fromEntries(reviewComments(pr, reviewers).map(x => [x.id, x.answered]));

test('a thread is answered by a reply after the reviewer\'s newest comment: resolved alone is not, a reviewer\'s follow-up reopens it', () => {
  const resolvedOnly = { id: 'T_resolved', isResolved: true, comments: [c(1, 'acme-reviewer', 'Rename the anvil.')] };
  const followUp = { id: 'T_followup', comments: [c(2, 'acme-reviewer', 'The fuse is short.'), c(3, 'acme-owner', 'Fixed in abc1234.', '2026-10-05'), c(4, 'acme-reviewer', 'Still short at line 9.', '2026-10-06')] };
  const namedLast = { id: 'T_named', comments: [c(5, 'acme-owner', 'Is this safe?'), c(6, 'acme-reviewer', 'No: the lid sticks.', '2026-10-06')] };
  const settled = { id: 'T_settled', isResolved: true, comments: [c(7, 'acme-reviewer', 'Paint it.'), c(8, 'acme-reviewer', 'Red, please.'), c(9, 'acme-owner', 'Painted red in abc1234.', '2026-10-06')] };
  assert.deepEqual(answered(prOf({ threads: [resolvedOnly, followUp, namedLast, settled] })),
    { T_resolved: false, T_followup: false, T_named: false, T_settled: true });
  // Codex on 0.8.4: a reopened thread is aged from the follow-up, so it gets its own day; one never answered, from its first comment.
  const at = Object.fromEntries(reviewComments(prOf({ threads: [resolvedOnly, followUp, settled] }), ['acme-reviewer[bot]']).map(x => [x.id, x.at]));
  assert.deepEqual(at, { T_resolved: '2026-10-05T09:00:00Z', T_followup: '2026-10-06T09:00:00Z', T_settled: '2026-10-05T09:00:00Z' });
});

test('a review\'s top-level body owes an answer: a later comment that quotes, links or names it; a status board, an empty body or the author\'s own does not', () => {
  const body = { id: 'PRR_1', databaseId: 71, author: 'acme-reviewer', body: '### Acme Review\n\nThe crate has no lid.\n\nDetails in the threads.', createdAt: '2026-10-05T09:00:00Z' };
  const others = [
    { id: 'PRR_status', databaseId: 72, author: 'acme-reviewer', body: '<!-- acme-summary -->\n## Summary', createdAt: '2026-10-05T09:00:00Z' },
    { id: 'PRR_empty', databaseId: 73, author: 'acme-reviewer', body: '  ', createdAt: '2026-10-05T09:00:00Z' },
    { id: 'PRR_own', databaseId: 74, author: 'acme-owner', body: 'Ready for another look.', createdAt: '2026-10-05T09:00:00Z' },
    { id: 'PRR_person', databaseId: 75, author: 'wile-e', body: 'Use the bigger anvil.', createdAt: '2026-10-05T09:00:00Z' },
  ];
  const read = (comments, reviewers) => reviewComments(prOf({ bodies: [body, ...others], comments }), reviewers);
  const none = read([], []);
  assert.deepEqual(none.map(x => [x.id, x.kind, x.status, x.answered]), [['PRR_1', 'review', false, false], ['PRR_status', 'review', true, true], ['PRR_person', 'review', false, false]],
    'any reviewer\'s body is read, a reviewer named or not; empty and the PR author\'s own are not');
  assert.equal(none[0].text, 'Acme Review');
  const by = (body, id = 'IC_a') => [{ id, ...c(90, 'acme-owner', body, '2026-10-06') }];
  assert.equal(read(by('> The crate has no lid.\n\nFixed in abc1234.'), [])[0].answered, true, 'a quote of a line');
  assert.equal(read(by('Answered: https://github.com/acme/app/pull/3#pullrequestreview-71'), [])[0].answered, true, 'its link');
  assert.equal(read(by('PRR_1: fixed in abc1234.'), [])[0].answered, true, 'its id');
  assert.equal(read(by('Merging now.'), [])[0].answered, false, 'an unrelated comment is not an answer');
  assert.equal(read([{ id: 'IC_r', ...c(91, 'acme-reviewer', '> The crate has no lid.\n\nStill true.', '2026-10-06') }], [])[0].answered, false, 'the reviewer quoting itself is not an answer');
});

test('a reviewer\'s conversation comment is answered only by a later comment that references it, never by an unrelated one', () => {
  const finding = { id: 'IC_find', ...c(51, 'acme-reviewer', 'Codex: the README is wrong.\nIt names the old flag.', '2026-10-05') };
  const later = body => ({ id: 'IC_later', ...c(52, 'acme-owner', body, '2026-10-06') });
  for (const [body, want] of [['Thanks, merging.', false], ['> It names the old flag.\n\nFixed in abc1234.', true], ['See https://github.com/acme/app/pull/3#c51: fixed.', true], ['IC_find is not valid: the flag is current.', true], ['> ok', false]]) {
    assert.equal(answered(prOf({ comments: [finding, later(body)] })).IC_find, want, body);
  }
  const before = { id: 'IC_before', ...c(50, 'acme-owner', '> Codex: the README is wrong.', '2026-10-04') };
  assert.equal(answered(prOf({ comments: [before, finding] })).IC_find, false, 'a quote from before it is not an answer to it');
});

test('a thread with more comments than one page is an incomplete read: keel review exits 2, never a count', async t => {
  assert.throws(() => reviewComments(prOf({ threads: [{ id: 'T_long', more: true, comments: [c(1, 'acme-reviewer', 'One.'), c(2, 'acme-owner', 'Two.')] }] })), e => e.incomplete === true && /more comments in a review thread than one page/.test(e.message));
  const dir = await project(t);
  for (const state of [{ threads: [{ ...ANSWERED, more: true }] }, { moreReviews: true }, { moreComments: true }]) {
    const r = keel(dir, await stubGh(t, { reviews: [ON_HEAD], ...state }), ['acme/app#3', '--json']);
    assert.equal(r.code, 2, JSON.stringify(state) + r.out);
    assert.match(r.json().error, /GitHub could not be read: #3 has more .* than one page; the read is incomplete/);
  }
});

test('--close on a review body posts a comment that quotes and links it, so the read sees it answered', async t => {
  const dir = await project(t);
  const gh = await stubGh(t, { reviews: [ON_HEAD], writes: true, bodies: [{ id: 'PRR_9', databaseId: 77, author: 'acme-reviewer', body: '**Acme Review**: the crate has no lid.', createdAt: '2026-10-05T09:00:00Z' }] });
  assert.equal(keel(dir, gh, ['acme/app#3']).code, 1);
  const r = keel(dir, gh, ['acme/app#3', '--close', 'PRR_9', '--fixed', 'abc1234']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /PRR_9: replied \(a review body has no thread to resolve\)/);
  const [post] = writesIn(await gh.calls());
  assert.equal(post.at(-1), 'body=> Acme Review: the crate has no lid.\n\n**Fixed** in abc1234. Validated against the code first.\n\nhttps://github.com/acme/app/pull/3#pullrequestreview-77');
  assert.equal(keel(dir, gh, ['acme/app#3']).code, 0);
});
