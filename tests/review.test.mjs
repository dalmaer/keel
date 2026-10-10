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
import { graphqlData, reviewComments, reviewConfigOf, fromWindow, readRepoReviews, unansweredPrs, WINDOW_TAIL, WINDOW_THREADS, WINDOW_CONVO, WINDOW_BODIES, SOLO_READS } from '../practices/night/files/scripts/keel/lib.mjs';

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
  else console.log(JSON.stringify({ data: { ...(s.rate ? { rateLimit: s.rate } : {}), repository: { pullRequest: {
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
    /** Change the PR between calls (a comment arriving): f edits the state in place. */
    change: async f => { const st = JSON.parse(await readFile(statePath, 'utf8')); f(st); await writeFile(statePath, JSON.stringify(st)); },
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
  // The read receipt goes in the project's temp dir, never the developer's cache.
  const r = run(process.execPath, [BIN, 'review', ...args], { cwd, env: { ...cleanEnv(), KEEL_GH: gh.path, KEEL_REVIEW_POLL_MS: '40', KEEL_CACHE: join(cwd, '.keel-cache'), ...env } });
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
  assert.equal(keel(dir, gh, ['acme/app#3']).code, 1, 'read first: a comment is closed only after it was read');
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

test('a GraphQL answer with errors is refused even when it carries data: a partial answer can null a page\'s flags (cajones#64)', () => {
  assert.throws(() => graphqlData(JSON.stringify({ data: { repository: { open: { pageInfo: { hasNextPage: null }, nodes: [] } } }, errors: [{ message: 'Something went wrong' }] })), /Something went wrong/);
  assert.deepEqual(graphqlData(JSON.stringify({ data: { ok: 1 }, errors: [] })), { ok: 1 });
});

test('a connection GitHub could not read (null beside other data) is refused, never an empty list (duo#91)', () => {
  const pr = { number: 7, author: { login: 'acme-owner' }, reviewThreads: { pageInfo: {}, nodes: [] }, comments: null, reviews: { pageInfo: {}, nodes: [] } };
  assert.throws(() => reviewComments(pr, ['acme-reviewer']), /without its conversation comments/);
  assert.throws(() => reviewComments({ ...pr, comments: { pageInfo: {}, nodes: [] }, reviews: null }, []), /without its reviews/);
  const windowed = { ...pr, keelWindow: 'PullRequest', reviews: { pageInfo: {}, nodes: [] } };
  assert.throws(() => reviewComments(fromWindow(windowed, ['acme-reviewer']).pr, ['acme-reviewer']), /without its conversation comments/);
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

// ---- closed only after it was read (the owner, 7 Oct: four threads posted after the last read were closed unread) ----

// No clock is compared: each comment that arrives after a read is dated before it, and must still count as new.
const arrived = () => ({ id: 'PRRT_new', path: 'hatch.js', line: 7, comments: [c(71, 'acme-reviewer', '**P1** The hatch opens inward.', '2000-01-01')] });

test('a read leaves a receipt in keel\'s cache: the ids it showed, when, and the head; the newest read replaces it', async t => {
  const dir = await project(t);
  const gh = await stubGh(t, { threads: [UNANSWERED, ANSWERED], reviews: [ON_HEAD] });
  const before = Date.now();
  assert.equal(keel(dir, gh, ['acme/app#3', '--json']).code, 1);
  const path = join(dir, '.keel-cache', 'reviews', 'acme__app__3.json');
  const first = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual([first.head, first.ids, first.threads, first.seen], [HEAD, ['PRRT_open', 'PRRT_done'], { PRRT_open: 1, PRRT_done: 2 }, []]);
  assert.ok(Date.parse(first.at) >= before - 1000 && Date.parse(first.at) <= Date.now(), first.at);
  await gh.change(s => s.threads.push(arrived()));
  keel(dir, gh, ['acme/app#3']);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).ids, ['PRRT_open', 'PRRT_done', 'PRRT_new'], 'the text read records too, and replaces the last');
});

test('--close refuses an id never read (no receipt), naming it, and posts nothing; "all" is not an id', async t => {
  const dir = await project(t);
  const gh = await stubGh(t, { threads: [UNANSWERED, SELF_REPLY], reviews: [ON_HEAD], writes: true });
  const r = keel(dir, gh, ['acme/app#3', '--close', 'PRRT_open,PRRT_self', '--fixed', 'abc1234']);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /not read yet: PRRT_open \(acme-reviewer, skates\.js:12\): run keel review acme\/app#3, validate it, then close it/);
  assert.match(r.err, /not read yet: PRRT_self \(acme-reviewer, thread\)/);
  assert.match(r.err, /nothing posted/);
  assert.equal(keel(dir, gh, ['acme/app#3', '--close', 'all', '--fixed', 'abc1234']).code, 2, 'no bulk form');
  assert.equal(writesIn(await gh.calls()).length, 0);
  // Read, then the same close posts.
  keel(dir, gh, ['acme/app#3']);
  const ok = keel(dir, gh, ['acme/app#3', '--close', 'PRRT_open,PRRT_self', '--fixed', 'abc1234']);
  assert.equal(ok.code, 0, ok.err);
  assert.equal(writesIn(await gh.calls()).filter(x => x.includes('POST')).length, 2);
});

test('--close refuses when a comment arrived since the last read, naming it, and posts nothing; a fresh read lets it through', async t => {
  const dir = await project(t);
  const gh = await stubGh(t, { threads: [UNANSWERED, SELF_REPLY], reviews: [ON_HEAD], writes: true });
  assert.equal(keel(dir, gh, ['acme/app#3']).code, 1);
  await gh.change(s => s.threads.push(arrived()));
  const r = keel(dir, gh, ['acme/app#3', '--close', 'PRRT_open,PRRT_self', '--fixed', 'abc1234', '--json']);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.json().error, /arrived since your last read \([^)]+\): PRRT_new \(acme-reviewer, hatch\.js:7\) P1 The hatch opens inward\./);
  assert.doesNotMatch(r.json().error, /not read yet/, 'the ids named were read');
  assert.equal(writesIn(await gh.calls()).length, 0, 'nothing posted');
  // Naming the new one does not get it closed either: it was never read.
  const named = keel(dir, gh, ['acme/app#3', '--close', 'PRRT_new', '--fixed', 'abc1234']);
  assert.equal(named.code, 2);
  assert.match(named.err, /not read yet: PRRT_new/);
  // A reviewer's follow-up on a thread that was read: the thread is unread again.
  keel(dir, gh, ['acme/app#3']);
  await gh.change(s => s.threads[0].comments.push(c(12, 'acme-reviewer', 'Also the left skate.', '2000-01-01')));
  const follow = keel(dir, gh, ['acme/app#3', '--close', 'PRRT_open', '--fixed', 'abc1234']);
  assert.equal(follow.code, 2);
  assert.match(follow.err, /not read yet: PRRT_open \(acme-reviewer, skates\.js:12\), a follow-up since your last read/);
  assert.equal(writesIn(await gh.calls()).length, 0);
  // Read again: now it closes, and the answers it posts are not news to the next close.
  keel(dir, gh, ['acme/app#3']);
  assert.equal(keel(dir, gh, ['acme/app#3', '--close', 'PRRT_open', '--fixed', 'abc1234']).code, 0);
  assert.equal(keel(dir, gh, ['acme/app#3', '--close', 'PRRT_self,PRRT_new', '--not-valid', 'the hatch is a door; see hatch.js:7']).code, 0);
});

test('--close refuses an id read on a different PR', async t => {
  const dir = await project(t);
  const gh = await stubGh(t, { threads: [UNANSWERED], reviews: [ON_HEAD], writes: true });
  assert.equal(keel(dir, gh, ['acme/app#4']).code, 1);
  const r = keel(dir, gh, ['acme/app#3', '--close', 'PRRT_open', '--fixed', 'abc1234']);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /not read yet: PRRT_open/);
  assert.equal(writesIn(await gh.calls()).length, 0);
});

test('arrived since is by id and count, never by clock: a comment dated before the read is still new, a review body or conversation comment too', async t => {
  const dir = await project(t);
  const gh = await stubGh(t, { threads: [UNANSWERED], reviews: [ON_HEAD], writes: true, comments: [{ id: 'IC_old', ...c(50, 'wile-e', 'Nice skates.') }] });
  assert.equal(keel(dir, gh, ['acme/app#3']).code, 1);
  const receipt = JSON.parse(await readFile(join(dir, '.keel-cache', 'reviews', 'acme__app__3.json'), 'utf8'));
  assert.deepEqual(receipt.seen, ['IC_old'], 'every conversation comment the PR had, shown or not');
  const at = Date.parse(receipt.at);
  // Dated a day before the read, posted after it.
  await gh.change(s => {
    s.bodies = [{ id: 'PRR_late', databaseId: 78, author: 'acme-reviewer', body: '**Acme Review**: the brakes squeal.', createdAt: new Date(at - 86_400_000).toISOString() }];
    s.comments.push({ id: 'IC_late', ...c(79, 'acme-reviewer', 'Codex: also the bell.', '2000-01-01') });
  });
  const r = keel(dir, gh, ['acme/app#3', '--close', 'PRRT_open', '--fixed', 'abc1234']);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /arrived since your last read \([^)]+\): PRR_late \(acme-reviewer, review\) Acme Review: the brakes squeal\./);
  assert.match(r.err, /arrived since your last read \([^)]+\): IC_late \(acme-reviewer, conversation\)/);
  assert.doesNotMatch(r.err, /IC_old/, 'a comment the read saw is not new, shown or not');
  assert.equal(writesIn(await gh.calls()).length, 0, 'nothing posted');
  // The PR author's own comments and keel's answers are not news: after a read, two closes in a row go through.
  keel(dir, gh, ['acme/app#3']);
  await gh.change(s => s.comments.push({ id: 'IC_author', ...c(80, 'acme-owner', 'Pushed a fix.', '2000-01-01') }));
  assert.equal(keel(dir, gh, ['acme/app#3', '--close', 'PRRT_open', '--fixed', 'abc1234']).code, 0);
  const r2 = keel(dir, gh, ['acme/app#3', '--close', 'PRR_late,IC_late', '--fixed', 'abc1234']);
  assert.equal(r2.code, 0, r2.err);
});

// ---- the window: the repo-wide read asks only what "unanswered" needs ---------------

/** What GitHub answers for a PR through lib.mjs windowFragment, from the PR in the full fragment's shape. */
const windowed = pr => ({
  keelWindow: 'PullRequest', ...pr,
  reviewThreads: { pageInfo: { hasNextPage: pr.reviewThreads.nodes.length > WINDOW_THREADS }, nodes: pr.reviewThreads.nodes.slice(0, WINDOW_THREADS).map(({ comments, ...t }) =>
    ({ ...t, tail: { totalCount: comments.nodes.length, nodes: comments.nodes.slice(-WINDOW_TAIL) } })) },
  comments: { pageInfo: { hasPreviousPage: pr.comments.nodes.length > WINDOW_CONVO }, nodes: pr.comments.nodes.slice(-WINDOW_CONVO) },
  reviews: { pageInfo: { hasPreviousPage: pr.reviews.nodes.length > WINDOW_BODIES }, nodes: pr.reviews.nodes.slice(-WINDOW_BODIES) },
});
const R = ['acme-reviewer[bot]'];
const long = (id, n = WINDOW_TAIL + 2) => ({ id, comments: [c(1, 'acme-reviewer', 'Grease the skates.', '2026-10-01'), c(2, 'acme-reviewer', 'And the wheels.', '2026-10-02'), c(3, 'acme-owner', 'Greased in abc1234.', '2026-10-03'),
  ...Array.from({ length: n - 3 }, (_, i) => c(4 + i, 'acme-reviewer', `Still squeaks (${i + 1}).`, `2026-10-0${4 + i}`))] });

test('the window decides every comment as the full read does: a reopened thread, a follow-up, a review body and a conversation comment answered by reference', () => {
  const reopened = { id: 'T_reopened', comments: [c(2, 'acme-reviewer', 'The fuse is short.', '2026-10-01'), c(3, 'acme-owner', 'Fixed in abc1234.', '2026-10-02'), c(4, 'acme-reviewer', 'Still short at line 9.', '2026-10-03'), c(5, 'acme-reviewer', 'And line 10.', '2026-10-04')] };
  const followed = { id: 'T_followup', comments: [c(6, 'acme-reviewer', 'Paint it.'), c(7, 'acme-owner', 'Painted.', '2026-10-06'), c(8, 'acme-reviewer', 'Red, please.', '2026-10-06')] };
  const settled = { id: 'T_settled', isResolved: true, comments: [c(9, 'acme-reviewer', 'Lid.'), c(10, 'acme-owner', 'Lidded in abc1234.', '2026-10-06')] };
  const body = { id: 'PRR_1', databaseId: 71, author: 'acme-reviewer', body: 'Acme Review: the crate has no lid.', createdAt: '2026-10-05T09:00:00Z' };
  const finding = { id: 'IC_find', ...c(51, 'acme-reviewer', 'Codex: the README is wrong.', '2026-10-05') };
  const answers = [{ id: 'IC_a1', ...c(52, 'acme-owner', '> the crate has no lid.\n\nFixed in abc1234.', '2026-10-06') }, { id: 'IC_a2', ...c(53, 'acme-owner', 'IC_find: not valid, the README is current.', '2026-10-06') }];
  for (const [what, pr, reviewers] of [
    ['threads', prOf({ threads: [reopened, followed, settled] }), R],
    ['a review body answered by a quote', prOf({ bodies: [body], comments: answers }), []],
    ['a named reviewer\'s comment answered by its id', prOf({ comments: [finding, ...answers] }), R],
    ['unanswered ones', prOf({ threads: [{ id: 'T_open', comments: [c(11, 'acme-reviewer', 'Brakes.')] }], bodies: [body], comments: [finding] }), R],
  ]) {
    const w = fromWindow(windowed(pr), reviewers);
    assert.equal(w.whole, true, what);
    assert.deepEqual(reviewComments(w.pr, reviewers), reviewComments(pr, reviewers), what);
  }
  // The reopened thread: unanswered, aged from the first comment after the answer.
  const t = reviewComments(fromWindow(windowed(prOf({ threads: [reopened] })), R).pr, R)[0];
  assert.deepEqual([t.answered, t.at, t.author], [false, '2026-10-03T09:00:00Z', 'acme-reviewer']);
});

test('what the window cannot see whole is never decided from it: a longer thread, more threads, older comments or bodies', () => {
  // Six comments: the newest four alone would make the owner the thread's author and date it from the answer.
  const pr = prOf({ threads: [long('T_long')] });
  assert.deepEqual(reviewComments(pr, R).map(x => [x.answered, x.at, x.author]), [[false, '2026-10-04T09:00:00Z', 'acme-reviewer']]);
  const w = fromWindow(windowed(pr), R);
  assert.equal(w.whole, false);
  assert.throws(() => reviewComments(w.pr, R), e => e.incomplete === true, 'refused, never a count');
  // Exactly the window: whole.
  assert.equal(fromWindow(windowed(prOf({ threads: [long('T_four', WINDOW_TAIL)] })), R).whole, true);
  const many = Array.from({ length: WINDOW_THREADS + 1 }, (_, i) => ({ id: `T${i}`, comments: [c(100 + i, 'acme-reviewer', `Bolt ${i}.`)] }));
  assert.equal(fromWindow(windowed(prOf({ threads: many })), R).whole, false, 'more threads than the window');
  const chatter = Array.from({ length: WINDOW_CONVO + 1 }, (_, i) => ({ id: `IC_${i}`, ...c(200 + i, 'acme-owner', `Note ${i}.`) }));
  assert.equal(fromWindow(windowed(prOf({ comments: chatter })), R).whole, false, 'older conversation comments, a reviewer named');
  assert.equal(fromWindow(windowed(prOf({ comments: chatter })), []).whole, true, 'older conversation comments matter only to a named reviewer or a review body');
  const bodies = Array.from({ length: WINDOW_BODIES + 1 }, (_, i) => ({ id: `PRR_${i}`, databaseId: 300 + i, author: 'acme-reviewer', body: `Body ${i}.`, createdAt: '2026-10-05T09:00:00Z' }));
  assert.equal(fromWindow(windowed(prOf({ bodies })), []).whole, false, 'older review bodies');
  // The full fragment's shape passes through untouched.
  assert.deepEqual(fromWindow(pr, R), { pr, whole: true });
});

test('each unanswered PR names its author; a bot author is marked app/', () => {
  const at = (n, author) => ({ ...prOf({ threads: [{ id: `T${n}`, comments: [c(500 + n, 'acme-reviewer', 'Oil.', '2026-10-01')] }] }), number: n, title: `Acme ${n}`, url: `https://github.com/acme/app/pull/${n}`, state: 'OPEN', mergedAt: null, author });
  const got = unansweredPrs({ open: { pageInfo: {}, nodes: [at(1, { __typename: 'User', login: 'acme-owner' }), at(2, { __typename: 'Bot', login: 'renovate' }), at(3, null)] }, merged: { pageInfo: {}, nodes: [] } }, R, '2026-10-08');
  assert.deepEqual(got.prs.map(p => p.author), ['acme-owner', 'app/renovate', null]);
});

test('the repo-wide read reads alone, with the full fragment, each PR the window did not cover, and at most SOLO_READS of them', async () => {
  const at = (n, threads, extra = {}) => ({ ...prOf({ threads }), number: n, title: `Acme ${n}`, url: `https://github.com/acme/app/pull/${n}`, state: 'OPEN', mergedAt: null, ...extra });
  const full = new Map([[1, at(1, [long('T_long1')])], [2, at(2, [{ id: 'T_short', comments: [c(400, 'acme-reviewer', 'Oil.', '2026-10-01')] }])],
    [3, at(3, [long('T_long3')], { state: 'MERGED', mergedAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' })]]);
  const page = prs => async () => ({ open: { pageInfo: { hasNextPage: false }, nodes: prs.filter(p => p.state === 'OPEN').map(windowed) }, merged: { pageInfo: { hasNextPage: false }, nodes: prs.filter(p => p.state === 'MERGED').map(windowed) } });
  const asked = [];
  const readPr = async n => { asked.push(n); return full.get(n); };
  const read = await readRepoReviews(page([...full.values()]), '2026-10-08', { readPr, reviewers: R });
  assert.deepEqual(asked, [1], 'only the open PR with a longer thread; never one merged outside the window');
  assert.deepEqual(unansweredPrs(read, R, '2026-10-08'), unansweredPrs({ open: { pageInfo: {}, nodes: [full.get(1), full.get(2)] }, merged: { pageInfo: {}, nodes: [full.get(3)] } }, R, '2026-10-08'));
  // Without readPr: refused, never a count.
  await assert.rejects(async () => unansweredPrs(await readRepoReviews(page([...full.values()]), '2026-10-08'), R, '2026-10-08'), e => e.incomplete === true);
  // Bounded: past SOLO_READS the read is incomplete.
  const busy = Array.from({ length: SOLO_READS + 1 }, (_, i) => at(10 + i, [long(`T_${i}`)]));
  asked.length = 0;
  const many = await readRepoReviews(page(busy), '2026-10-08', { readPr: async n => { asked.push(n); return busy.find(p => p.number === n); }, reviewers: R });
  assert.equal(asked.length, SOLO_READS);
  assert.throws(() => unansweredPrs(many, R, '2026-10-08'), e => e.incomplete === true);
});

test('keel review reads a window first and the full fragment only when a list overflows it; it says what the read cost, and warns under the quota floor', async t => {
  const dir = await project(t);
  const queries = async gh => (await gh.calls()).filter(x => x[1] === 'graphql').map(x => x.find(a => a.startsWith('query=')));
  let gh = await stubGh(t, { reviews: [ON_HEAD], threads: [UNANSWERED, ANSWERED], rate: { cost: 1, remaining: 4321, resetAt: '2026-10-08T22:00:00Z' } });
  let r = keel(dir, gh, ['acme/app#3', '--json']);
  assert.equal(r.code, 1, r.err);
  let q = await queries(gh);
  assert.equal(q.length, 1, 'one read');
  assert.match(q[0], /reviewThreads\(first: 50\)[\s\S]*comments\(first: 20\)/);
  assert.match(q[0], /rateLimit \{ cost remaining resetAt \}/);
  assert.deepEqual(r.json().github, { cost: 1, queries: 1, remaining: 4321, resetAt: '2026-10-08T22:00:00Z' });
  assert.equal(r.json().warning, null);
  // A thread longer than the window: read again, with the full fragment.
  gh = await stubGh(t, { reviews: [ON_HEAD], threads: [{ ...ANSWERED, more: true }] });
  keel(dir, gh, ['acme/app#3', '--json']);
  q = await queries(gh);
  assert.equal(q.length, 2);
  assert.match(q[1], /reviewThreads\(first: 100\)[\s\S]*comments\(first: 100\)/);
  // Under the floor it still reads (it was asked for) and says so.
  gh = await stubGh(t, { reviews: [ON_HEAD], threads: [ANSWERED], rate: { cost: 1, remaining: 900, resetAt: '2026-10-08T22:00:00Z' } });
  r = keel(dir, gh, ['acme/app#3', '--json']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.json().warning, /your GitHub quota is low: 900 left until \d\d:\d\d/);
  assert.match(keel(dir, gh, ['acme/app#3']).out, /Warning: your GitHub quota is low: 900 left/);
});

// ---- phase 60: a push reviewed after it landed, read and answered as <repo>@<sha> -------

const PUSHED = 'b'.repeat(8) + 'c0ffee00'.repeat(4);
const FROM = 'a'.repeat(40);
const pushRecord = (findings, to = PUSHED) => `<!-- keel:review-after ${JSON.stringify({ from: FROM, to, alone: false, agent: 'codex', findings })} -->\n**Review after the push** by Codex …`;
const F1 = { id: 'F1', severity: 'P1', path: 'src/lid.js', line: 12, text: 'The hinge is never checked.', url: 'https://github.com/acme/app/commit/x#commitcomment-701' };
const F2 = { id: 'F2', severity: 'P2', path: 'src/latch.js', line: 3, text: 'The latch defaults open.' };
const ic = (id, login, body) => ({ id, user: { login }, body, created_at: '2026-10-09T12:00:00Z', html_url: `https://github.com/acme/app/issues/12#issuecomment-${id}` });

/**
 * A gh for a push's review: `issue list` prints the keel:review-after issues
 * (`issues`), the API lists issue 12's comments (`comments`); with `writes`,
 * a comment POST appends to them and a PATCH closes the issue. Anything else,
 * or a write not allowed, exits 1. Every call is logged.
 */
async function pushGh(t, state) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-review-push-gh-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'gh'), statePath = join(dir, 'state.json'), log = join(dir, 'gh.log');
  await writeFile(statePath, JSON.stringify({ comments: [], ...state }));
  await writeFile(path, `#!${process.execPath}
const fs = require('node:fs');
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(argv) + '\\n');
const s = JSON.parse(fs.readFileSync(${JSON.stringify(statePath)}, 'utf8'));
const save = () => fs.writeFileSync(${JSON.stringify(statePath)}, JSON.stringify(s));
const field = k => (argv.find(a => a.startsWith(k + '=')) ?? '').slice(k.length + 1);
const deny = () => { console.error('stub gh: a write the test did not expect: ' + argv.join(' ')); process.exit(1); };
const page = /^repos\\/acme\\/app\\/issues\\?labels=keel%3Areview-after&state=all&per_page=100&page=(\\d+)$/.exec(argv[0] === 'api' ? argv[1] : '');
if (page) {
  const n = Number(page[1]);
  console.log(JSON.stringify(s.issues.slice((n - 1) * 100, n * 100).map(i => ({ number: i.number, title: i.title, body: i.body, state: i.state.toLowerCase(), html_url: i.url, created_at: i.createdAt, user: { login: i.author.login === 'app/github-actions' ? 'github-actions[bot]' : i.author.login } }))));
  process.exit(0);
}
if (argv[0] === 'api' && argv[1] === 'repos/acme/app/issues/12/comments?per_page=100') { console.log(JSON.stringify(s.comments)); process.exit(0); }
if (argv[0] === 'api' && argv[1] === '-X' && argv[2] === 'POST' && argv[3] === 'repos/acme/app/issues/12/comments') {
  if (!s.writes) deny();
  s.comments.push({ id: 900 + s.comments.length, user: { login: 'acme-owner' }, body: field('body'), created_at: '2026-10-09T13:00:00Z', html_url: 'https://github.com/acme/app/issues/12#new' }); save();
  console.log('{}'); process.exit(0);
}
if (argv[0] === 'api' && argv[1] === '-X' && argv[2] === 'PATCH' && argv[3] === 'repos/acme/app/issues/12') {
  if (!s.writes) deny();
  s.issues[0].state = 'CLOSED'; save();
  console.log('{}'); process.exit(0);
}
console.error('stub gh: unknown ' + argv.join(' ')); process.exit(1);
`);
  await chmod(path, 0o755);
  return {
    path,
    calls: async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(l => JSON.parse(l)),
    state: async () => JSON.parse(await readFile(statePath, 'utf8')),
  };
}
const pushIssue = (findings, over = {}) => ({ number: 12, title: `keel review after ${PUSHED.slice(0, 7)}`, state: 'OPEN', url: 'https://github.com/acme/app/issues/12', createdAt: '2026-10-09T10:00:00Z', author: { login: 'app/github-actions', is_bot: true }, body: pushRecord(findings), ...over });

test('phase 60: keel review <repo>@<sha> reads the push\'s tracking issue: its findings by id, which are answered, and a receipt of what it showed', async t => {
  assert.deepEqual(parseTarget('acme/app@BBBBBBBB'), { repo: 'acme/app', sha: 'bbbbbbbb' });
  assert.deepEqual(parseTarget('@bbbbbbb', 'acme/app'), { repo: 'acme/app', sha: 'bbbbbbb' });
  assert.deepEqual(parseTarget('#3', 'acme/app'), { repo: 'acme/app', number: 3 }, 'a PR is still a PR');
  assert.throws(() => parseTarget('acme/app@bbb'), /<owner\/repo>@<sha>/);
  const dir = await project(t);
  // A person's issue carrying the same record is not the push's review; a review of another push is not either.
  const forged = pushIssue([F1, F2], { number: 13, author: { login: 'acme-owner' }, body: pushRecord([]) });
  const other = pushIssue([], { number: 11, body: pushRecord([], 'd'.repeat(40)) });
  const gh = await pushGh(t, { issues: [pushIssue([F1, F2]), forged, other], comments: [ic(501, 'acme-owner', '**F2** `src/latch.js:3`: **Not valid:** the latch closes in open(), line 8.'), ic(502, 'acme-owner', 'Looking at F1 now.')] });
  const r = keel(dir, gh, [`acme/app@${PUSHED.slice(0, 7)}`]);
  assert.equal(r.code, 1, r.err + r.out);
  assert.match(r.out, /^acme\/app@bbbbbbb — the review after the push, by codex \(aaaaaaa\.\.bbbbbbb\): #12 \(open\) https:\/\/github\.com\/acme\/app\/issues\/12$/m);
  assert.match(r.out, /^2 findings, 1 unanswered$/m);
  assert.match(r.out, /^ {2}UNANSWERED F1 {2}src\/lid\.js:12 {2}P1 The hinge is never checked\.$/m);
  assert.match(r.out, /^ {2}not-valid {2}F2 {2}src\/latch\.js:3 {2}P2 The latch defaults open\.$/m);
  assert.match(r.out, /keel review acme\/app@bbbbbbb --close F1 --fixed <commit>/);
  const d = keel(dir, gh, [`acme/app@${PUSHED}`, '--json']).json();
  assert.deepEqual([d.sha, d.from, d.issue, d.unanswered, d.answered, d.ok], [PUSHED, FROM, 12, 1, 1, false]);
  assert.deepEqual(d.comments.map(c => [c.id, c.answered, c.answer, c.url]), [['F1', false, null, F1.url], ['F2', true, 'not-valid', null]]);
  // keel#65: every comment the receipt marks read is shown, whole, in prose and JSON: here a follow-up that is no answer.
  assert.deepEqual(d.followUps.map(f => [f.id, f.author, f.body]), [['502', 'acme-owner', 'Looking at F1 now.']]);
  assert.match(r.out, /^1 other comment on #12, read before closing:\n {2}502 {2}acme-owner {2}\S+\n {4}Looking at F1 now\.$/m);
  // The receipt: by the full sha, the findings shown and every comment the issue had.
  const receipt = JSON.parse(await readFile(join(dir, '.keel-cache', 'reviews', `acme__app__after-${PUSHED}.json`), 'utf8'));
  assert.deepEqual([receipt.head, receipt.ids, receipt.seen], [PUSHED, ['F1', 'F2'], ['501', '502']]);
  assert.equal((await gh.calls()).filter(c => c.includes('POST') || c.includes('PATCH')).length, 0, 'a read writes nothing');
  // Every finding answered: exit 0. No review recorded for a sha: exit 2, never "nothing to answer".
  const all = await pushGh(t, { issues: [pushIssue([F2])], comments: [ic(501, 'acme-owner', '**F2** `src/latch.js:3`: **Fixed** in abc1234. Validated against the code first.')] });
  assert.equal(keel(dir, all, [`acme/app@${PUSHED.slice(0, 10)}`]).code, 0);
  const none = keel(dir, all, ['acme/app@1234567']);
  assert.equal(none.code, 2);
  assert.match(none.err, /no review after the push ends at 1234567 on acme\/app/);
  assert.equal(keel(dir, all, [`acme/app@${PUSHED.slice(0, 7)}`, '--wait']).code, 2, 'nothing waits on a push');
});

test('phase 60: a finding keeps its whole text, from the record to keel review\'s JSON and a tracked finding\'s keel:agent draft (keel#65)', async t => {
  const dir = await project(t);
  const long = { ...F1, text: `The hinge is never checked.\n\nRepro: open a lid whose hinge is null; open() throws.\n\nFix: ${'guard the hinge before turning it. '.repeat(12)}`.trim() };
  assert.ok(long.text.length > 300);
  const gh = await pushGh(t, { issues: [pushIssue([long, F2])], writes: true });
  const at = `acme/app@${PUSHED.slice(0, 7)}`;
  const d = keel(dir, gh, [at, '--json']).json();
  assert.equal(d.comments[0].text, `P1 ${long.text}`, 'whole, not a one-line excerpt');
  const r = keel(dir, gh, [at]);
  assert.match(r.out, /^ {2}UNANSWERED F1 {2}src\/lid\.js:12 {2}P1 The hinge is never checked\. Repro: .*…$/m, 'the list shows one line of it');
  const draft = keel(dir, gh, [at, '--close', 'F1', '--tracked', '#40', '--json']).json().work[0].draft;
  assert.ok(draft.body.includes(long.text), 'the draft carries the whole finding');
});

test('phase 60: an older push\'s review is found however many newer ones there are: every page until it is, and an incomplete read is never "no review" (keel#65)', async t => {
  const dir = await project(t);
  const newer = Array.from({ length: 249 }, (_, i) => pushIssue([F2], { number: 1000 - i, body: pushRecord([F2], (i + 1).toString(16).padStart(40, 'd')) }));
  const gh = await pushGh(t, { issues: [...newer, pushIssue([F1])] });
  const r = keel(dir, gh, [`acme/app@${PUSHED.slice(0, 7)}`, '--json']);
  assert.equal(r.code, 1, r.err);
  assert.deepEqual(r.json().comments.map(c => c.id), ['F1'], 'the 250th issue, on the third page');
  const pages = (await gh.calls()).filter(c => c[0] === 'api' && c[1].includes('labels=')).map(c => /page=(\d+)$/.exec(c[1])[1]);
  assert.deepEqual(pages, ['1', '2', '3']);
  // Found on the first page: no more is read.
  const first = await pushGh(t, { issues: [pushIssue([F1]), ...newer] });
  assert.equal(keel(dir, first, [`acme/app@${PUSHED.slice(0, 7)}`]).code, 1);
  assert.equal((await first.calls()).filter(c => c[0] === 'api' && c[1].includes('labels=')).length, 1);
  // The list ends without it: no review recorded, exit 2.
  const absent = await pushGh(t, { issues: newer });
  const none = keel(dir, absent, [`acme/app@${PUSHED.slice(0, 7)}`]);
  assert.equal(none.code, 2);
  assert.match(none.err, /no review after the push ends at bbbbbbb/);
});

test('phase 60: keel review <repo>@<sha> --close answers each finding it read with a comment on the issue, and closes the issue once every finding is answered; tracked drafts a keel:agent issue', async t => {
  const dir = await project(t);
  const gh = await pushGh(t, { issues: [pushIssue([F1, F2])], writes: true });
  const at = `acme/app@${PUSHED.slice(0, 7)}`;
  // Never read: refused, nothing posted.
  const unread = keel(dir, gh, [at, '--close', 'F1', '--fixed', 'abc1234']);
  assert.equal(unread.code, 2);
  assert.match(unread.err, /not read yet: F1: run keel review acme\/app@bbbbbbb, validate it, then close it/);
  assert.match(keel(dir, gh, [at, '--close', 'F9', '--fixed', 'abc1234']).err, /not a finding of the review after bbbbbbb on acme\/app: F9/);
  assert.equal((await gh.calls()).filter(c => c.includes('POST')).length, 0);
  // Read, then F1 tracked: a reply on the issue, the issue stays open (F2 is unanswered), and a keel:agent draft.
  assert.equal(keel(dir, gh, [at]).code, 1);
  const tracked = keel(dir, gh, [at, '--close', 'F1', '--tracked', '#40', '--json']);
  assert.equal(tracked.code, 0, tracked.err);
  const td = tracked.json();
  assert.deepEqual([td.closed.map(c => c.id), td.left, td.issueClosed], [['F1'], ['F2'], false]);
  assert.deepEqual(td.work[0].draft.labels, ['keel:agent']);
  assert.match(td.work[0].draft.title, /^P1 src\/lid\.js:12: The hinge is never checked\.$/);
  assert.match(td.work[0].draft.body, /keel review acme\/app@bbbbbbb --close F1 --fixed <commit>/);
  let s = await gh.state();
  // keel#65: the push's tracked reply says the finding is answered and the issue may close, never "left open".
  assert.equal(s.comments.at(-1).body, '**F1** `src/lid.js:12`: **Valid, tracked** in #40: the fix is tracked there, so this finding is answered and this review\'s issue can close.');
  assert.doesNotMatch(s.comments.at(-1).body, /Left open/);
  assert.equal(s.issues[0].state, 'OPEN');
  // A comment arrives from someone else: closing refuses until it is read.
  s.comments.push(ic(777, 'acme-reviewer', 'F2 is worse than it looks.'));
  await writeFile(join(dirname(gh.path), 'state.json'), JSON.stringify(s));
  const arrived = keel(dir, gh, [at, '--close', 'F2', '--not-valid', 'the latch closes in open()']);
  assert.equal(arrived.code, 2);
  assert.match(arrived.err, /arrived since your last read \(.*\): comment 777 \(acme-reviewer\) F2 is worse than it looks\./);
  // Read again: the read shows that comment whole before it marks it read (keel#65); keel's own answer (F1's) is not news.
  const reread = keel(dir, gh, [at]);
  assert.equal(reread.code, 1);
  assert.match(reread.out, /^1 other comment on #12, read before closing:\n {2}777 {2}acme-reviewer {2}\S+\n {4}F2 is worse than it looks\.$/m);
  // F2 answered: every finding is, so the issue closes.
  const last = keel(dir, gh, [at, '--close', 'F2', '--not-valid', 'the latch closes in open(), line 8']);
  assert.equal(last.code, 0, last.err);
  assert.match(last.out, /^#12 closed: every finding is answered$/m);
  s = await gh.state();
  assert.equal(s.issues[0].state, 'CLOSED');
  assert.ok((await gh.calls()).some(c => c.join(' ') === 'api -X PATCH repos/acme/app/issues/12 -f state=closed -f state_reason=completed'));
  // Read after: nothing unanswered.
  assert.equal(keel(dir, gh, [at]).code, 0);
});
