// keel review's rounds and classes (phase 71): a review that keeps going is
// brought to the owner. Rounds are counted from the read keel review already
// makes; at the limit the read exits 3 with the choice, each open finding
// sorted by the merge rule; --class records a finding's kind and leaves it
// unanswered. Against a stub gh that answers the GraphQL and REST reads, logs
// every call and refuses any write the test did not allow. Fixtures are Acme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, cleanEnv } from './helpers/run.mjs';
import { prGate, classText, classOfFlag } from '../lib/review.mjs';
// keel's own rendered copy: the practice's source sits apart from the lib.mjs it imports (render:check keeps the two the same).
import { summaryReview, MARKER } from '../scripts/keel/cross-review.mjs';
import { reviewRounds, reviewComments, reviewConfigOf, reviewRoundLimit, byMergeRule, classMark, classOf, classOnly, reviewFragment, windowFragment, REVIEW_ROUNDS } from '../practices/night/files/scripts/keel/lib.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(KEEL, 'bin', 'keel.mjs');
// Four pushes: each a head commit the reviewer saw.
const [A, B, C, D] = ['a', 'b', 'c', 'd'].map(x => `${x}1`.repeat(20));

// ---- the stub gh -----------------------------------------------------------------

/**
 * A gh for keel review with pushes. State: head, state (OPEN), me (the login
 * gh posts as), threads [{id, commit, isResolved, path, line, comments:
 * [{databaseId, author, body}]}] (commit: the push its first comment was made
 * on), comments (conversation), bodies (reviews: {id, databaseId, author,
 * body, commit, state}), reviews (REST: {user, commit_id, state}), writes
 * (posts and mutations allowed), contents (the PR's repo's .keel/keel.json;
 * absent: 404; contentsDown: the read fails). A reply is also a review with
 * no body, as on GitHub. Every call is logged; a write the test did not allow exits 1.
 */
async function stubGh(t, state) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-rounds-gh-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'gh'), statePath = join(dir, 'state.json'), log = join(dir, 'gh.log');
  await writeFile(statePath, JSON.stringify({ head: D, state: 'OPEN', me: 'acme-owner', threads: [], comments: [], bodies: [], reviews: [], posted: 0, ...state }));
  await writeFile(path, `#!${process.execPath}
const fs = require('node:fs');
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(argv) + '\\n');
const s = JSON.parse(fs.readFileSync(${JSON.stringify(statePath)}, 'utf8'));
const save = () => fs.writeFileSync(${JSON.stringify(statePath)}, JSON.stringify(s));
const field = k => (argv.find(a => a.startsWith(k + '=')) ?? '').slice(k.length + 1);
const deny = () => { console.error('stub gh: a write the test did not expect: ' + argv.join(' ')); process.exit(1); };
const at = c => c.createdAt ?? '2026-10-10T09:00:00Z';
const node = (c, commit) => ({ databaseId: c.databaseId, author: { login: c.author }, body: c.body, createdAt: at(c), url: 'https://github.com/acme/app/pull/3#c' + c.databaseId, ...(commit === undefined ? {} : { originalCommit: commit ? { oid: commit } : null }) });
if (argv[0] === 'api' && argv[1] === 'graphql') {
  if (field('query').startsWith('mutation')) {
    if (!s.writes) deny();
    const t = s.threads.find(x => x.id === field('id'));
    t.isResolved = true; save();
    console.log(JSON.stringify({ data: { resolveReviewThread: { thread: { id: t.id, isResolved: true } } } }));
  } else console.log(JSON.stringify({ data: { repository: { pullRequest: {
    number: 3, title: 'Acme rocket skates', url: 'https://github.com/acme/app/pull/3', state: s.state, mergedAt: s.state === 'MERGED' ? '2026-10-11T00:00:00Z' : null, headRefOid: s.head,
    author: { login: 'acme-owner' },
    reviewThreads: { pageInfo: { hasNextPage: false }, nodes: s.threads.map(t => ({ id: t.id, isResolved: !!t.isResolved, path: t.path ?? 'skates.js', line: t.line ?? 1, comments: { pageInfo: { hasNextPage: false }, nodes: t.comments.map(c => node(c, c.commit ?? t.commit ?? null)) } })) },
    comments: { pageInfo: { hasNextPage: false }, nodes: s.comments.map(c => ({ id: c.id, ...node(c) })) },
    reviews: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: s.bodies.map(r => ({ id: r.id, databaseId: r.databaseId, author: { login: r.author }, commit: r.commit ? { oid: r.commit } : null, body: r.body, state: r.state ?? 'COMMENTED', submittedAt: at(r), url: 'https://github.com/acme/app/pull/3#pullrequestreview-' + r.databaseId })) },
  } } } }));
} else if (argv[0] === 'api' && argv[1] === '-X' && argv[2] === 'POST') {
  if (!s.writes) deny();
  const n = ++s.posted, m = /comments\\/(\\d+)\\/replies$/.exec(argv[3]);
  if (m) {
    s.threads.find(t => t.comments[0].databaseId === Number(m[1])).comments.push({ databaseId: 900 + n, author: s.me, body: field('body'), commit: s.head, createdAt: '2026-10-12T12:00:0' + n + 'Z' });
    s.bodies.push({ id: 'PRR_reply' + n, databaseId: 800 + n, author: s.me, body: '', commit: s.head, createdAt: '2026-10-12T12:00:0' + n + 'Z' });
  } else s.comments.push({ id: 'IC_new' + n, databaseId: 990 + n, author: s.me, body: field('body'), createdAt: '2026-10-12T12:00:0' + n + 'Z' });
  save();
  console.log('{}');
} else if (argv[0] === 'api' && /\\/pulls\\/\\d+\\/reviews/.test(argv[1])) {
  const pg = Number((/[?&]page=(\\d+)/.exec(argv[1]) ?? [])[1] ?? 1);
  console.log(JSON.stringify(pg > 1 ? [] : s.reviews.map(r => ({ user: { login: r.user }, state: r.state ?? 'COMMENTED', commit_id: r.commit_id, submitted_at: '2026-10-10T10:00:00Z' }))));
} else if (argv[0] === 'api' && argv[1].endsWith('/contents/.keel/keel.json')) {
  if (s.contentsDown) { console.error('gh: Server Error (HTTP 502)'); process.exit(1); }
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
const bodyOf = call => call.find(a => a.startsWith('body=')).slice(5);

/** An Acme project whose repo is acme/app, with a "review" config. */
async function project(t, review = { reviewers: ['acme-reviewer'] }) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-rounds-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, '.keel'));
  await writeFile(join(dir, '.keel', 'keel.json'), JSON.stringify({ name: 'Acme', repo: 'acme/app', ...(review === null ? {} : { review }) }));
  return dir;
}
const envOf = (cwd, gh) => ({ ...cleanEnv(), KEEL_GH: gh.path, KEEL_CACHE: join(cwd, '.keel-cache') });
const keel = (cwd, gh, args) => {
  const r = run(process.execPath, [BIN, 'review', ...args], { cwd, env: envOf(cwd, gh) });
  return { code: r.status, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
};

let db = 100;
/** A finding: a thread the reviewer opened on `commit`; `answered` adds the owner's reply. */
const finding = (id, commit, { by = 'acme-reviewer', body = `Acme finding ${id.replace('PRRT_', '')}.`, answered = false, more = [] } = {}) => ({
  id, commit, comments: [{ databaseId: ++db, author: by, body }, ...(answered ? [{ databaseId: ++db, author: 'acme-owner', body: 'Fixed in abc1234.' }] : []), ...more.map(m => ({ databaseId: ++db, ...m }))] });
const onHead = { user: 'acme-reviewer', commit_id: D };
/** Three rounds (A, B, C), every finding answered: at the default limit with nothing open. */
const threeRounds = () => [finding('PRRT_a', A, { answered: true }), finding('PRRT_b', B, { answered: true }), finding('PRRT_c', C, { answered: true })];

// ---- rounds ----------------------------------------------------------------------

test('a round is a push a reviewer answered with a finding: a push it passed is none, and two reviewers on one push are one round', async t => {
  const dir = await project(t);
  const gh = await stubGh(t, {
    threads: [
      finding('PRRT_a', A, { answered: true }),
      // Two reviewers on the push C: one round.
      finding('PRRT_c1', C), finding('PRRT_c2', C, { by: 'acme-second' }),
      // The author's own note on B is not a reviewer's finding.
      finding('PRRT_note', B, { by: 'acme-owner', body: 'Acme note to self.' }),
    ],
    bodies: [
      // B was passed: an approval, and a status board that owes no answer.
      { id: 'PRR_pass', databaseId: 1, author: 'acme-reviewer', body: '', commit: B, state: 'APPROVED' },
      { id: 'PRR_ok', databaseId: 2, author: 'acme-second', body: 'Looks good to Acme.', commit: B, state: 'APPROVED' },
      { id: 'PRR_board', databaseId: 3, author: 'acme-reviewer', body: '<!-- acme-status -->\nReviewed b1b1b1b: no findings.', commit: B },
      // A reply is a review with no body, on the head: never a round.
      { id: 'PRR_reply', databaseId: 4, author: 'acme-agent', body: '', commit: D },
      // D was passed too.
      { id: 'PRR_pass2', databaseId: 5, author: 'acme-reviewer', body: '', commit: D, state: 'APPROVED' },
    ],
    comments: [{ id: 'IC_1', databaseId: 50, author: 'acme-owner', body: '> Looks good to Acme.\n\nThanks.', createdAt: '2026-10-11T09:00:00Z' }],
    reviews: [{ user: 'acme-reviewer', commit_id: B, state: 'APPROVED' }, onHead],
  });
  const r = keel(dir, gh, ['#3', '--json']);
  assert.equal(r.code, 1, 'findings unanswered: exit 1, as before');
  const d = r.json();
  assert.deepEqual(d.rounds, { count: 2, limit: 3, reached: false, pushes: [A, C] });
  assert.equal(d.choice, null);
  assert.equal(d.unanswered, 3, 'the two findings on C, and the author\'s own note (listed as it always was)');
  // Counted from the reviews already read: the one GraphQL read and the REST reviews, nothing more.
  const calls = await gh.calls();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(c => c[1] === 'graphql' ? 'graphql' : c[1]), ['graphql', 'repos/acme/app/pulls/3/reviews?per_page=100&page=1']);
  // Under the limit the text says nothing of rounds.
  assert.doesNotMatch(keel(dir, gh, ['#3']).out, /round|Merge with the rest|Split|limit/i);
});

test('reviewRounds: a review body that owes an answer is a finding on its commit; the author\'s, an empty one and one with no commit are not', () => {
  const body = (author, text, commit, state = 'COMMENTED') => ({ id: `R_${author}_${commit?.slice(0, 2)}`, author: { login: author }, body: text, state, commit: commit ? { oid: commit } : null });
  const pr = (reviews, threads = []) => ({ author: { login: 'acme-owner' }, reviewThreads: { nodes: threads }, reviews: { nodes: reviews } });
  assert.deepEqual(reviewRounds(pr([])), { count: 0, pushes: [] });
  assert.equal(reviewRounds(pr([body('acme-reviewer', 'The fuse is short.', A)])).count, 1);
  assert.equal(reviewRounds(pr([body('acme-reviewer', 'The fuse is short.', A), body('acme-second[bot]', 'So is the wick.', A)])).count, 1, 'two reviewers, one push');
  assert.equal(reviewRounds(pr([body('acme-reviewer', 'The fuse is short.', A), body('acme-reviewer', 'Still short.', B)])).count, 2);
  assert.equal(reviewRounds(pr([body('acme-owner', 'My own summary.', A), body('acme-reviewer', '', B), body('acme-reviewer', 'No commit named.', null), body('acme-reviewer', 'Approved with a word.', C, 'APPROVED')])).count, 0);
  // A thread counts on the commit its first comment was made on, whatever commit a later reply is on.
  const thread = (author, first, reply) => ({ id: 'T', comments: { nodes: [{ author: { login: author }, body: 'x', originalCommit: first ? { oid: first } : null }, { author: { login: 'acme-owner' }, body: 'y', originalCommit: { oid: reply } }] } });
  assert.deepEqual(reviewRounds(pr([], [thread('acme-reviewer', A, D)])).pushes, [A]);
  assert.equal(reviewRounds(pr([], [thread('acme-reviewer', null, D)])).count, 0, 'no commit named: not counted, never guessed');
  // Both reads ask the commit of a thread's comments, in the read they already make.
  assert.ok(reviewFragment().includes('body createdAt url originalCommit { oid } } } } }'));
  assert.ok(/tail: comments\(last: \d+\) \{ totalCount nodes \{ [^\n]* originalCommit \{ oid \} \} \} \} \}\n/.test(windowFragment()));
  // A conversation comment has no commit: the window asks it of thread comments only.
  assert.equal(windowFragment().split('originalCommit').length, 2);
});

test('a cross-review summary that carries its findings in the body (GitHub refused them inline) is a finding on its push and owes an answer; one with none is neither', () => {
  const diff = ['diff --git a/src/lid.js b/src/lid.js', 'index 1111111..2222222 100644', '--- a/src/lid.js', '+++ b/src/lid.js', '@@ -10,2 +10,3 @@', '   const hinge = lid.hinge;', '+  if (!hinge) return;', '   return lid;', ''].join('\n');
  const message = (summary, findings) => `${summary}\n\n\`\`\`json\n${JSON.stringify(findings)}\n\`\`\`\n`;
  const found = [{ path: 'src/lid.js', line: 11, severity: 'P1', body: 'An unhinged lid returns nothing.' }];
  const posted = (commit, findings, inline) => summaryReview({ message: message('Checked the lid.', findings), agent: 'codex', pr: { headRefOid: commit }, minutes: 15, diff, inline });
  const node = (commit, review, i) => ({ id: `PRR_${i}`, databaseId: i, author: { login: 'acme-reviewer' }, body: review.body, state: 'COMMENTED', commit: { oid: commit }, submittedAt: '2026-10-10T09:00:00Z', url: `u${i}` });
  const pr = reviews => ({ number: 3, author: { login: 'acme-owner' }, reviewThreads: { pageInfo: {}, nodes: [] }, comments: { pageInfo: {}, nodes: [] }, reviews: { pageInfo: {}, nodes: reviews } });

  // Three pushes, each reviewed with findings GitHub would not take inline: no threads, the findings in the summary.
  const fallback = [A, B, C].map((commit, i) => node(commit, posted(commit, found, false), i + 1));
  for (const r of fallback) {
    assert.ok(r.body.startsWith(`${MARKER}\n`), 'still the cross-review\'s marked summary');
    assert.match(r.body, /\n<!-- keel:cross-review findings 1 -->\nGitHub refused the inline comments; the findings \(1\), to answer here:\n- `src\/lid\.js:11` \*\*P1\*\* An unhinged lid/);
  }
  assert.deepEqual(reviewRounds(pr(fallback)), { count: 3, pushes: [A, B, C] });
  // The same body in the list: owed an answer, not a status board, so the read and the rounds agree.
  assert.deepEqual(reviewComments(pr(fallback), ['acme-reviewer']).map(c => [c.kind, c.status, c.answered]), [['review', false, false], ['review', false, false], ['review', false, false]]);
  const answered = { ...pr(fallback.slice(0, 1)), comments: { pageInfo: {}, nodes: [{ id: 'IC_1', author: { login: 'acme-owner' }, body: '**Fixed** in abc1234.\n\nu1', createdAt: '2026-10-11T09:00:00Z' }] } };
  assert.deepEqual(reviewComments(answered, ['acme-reviewer']).map(c => [c.status, c.answered]), [[false, true]]);

  // A summary with no findings is a status board, inline or not: no round, nothing owed.
  for (const none of [posted(A, [], true), posted(A, [], false), posted(A, found, true)]) {
    assert.doesNotMatch(none.body, /keel:cross-review findings/);
    assert.equal(reviewRounds(pr([node(A, none, 9)])).count, 0);
    assert.deepEqual(reviewComments(pr([node(A, none, 9)]), ['acme-reviewer']).map(c => [c.status, c.answered]), [[true, true]]);
  }
  // The indicator counts only in a marked summary, on a line of its own, naming one finding or more.
  const hand = body => reviewRounds(pr([node(A, { body }, 9)])).count;
  assert.equal(hand(`${MARKER}\nSummary.\n<!-- keel:cross-review findings 0 -->\n`), 0);
  assert.equal(hand(`${MARKER}\nSummary. > <!-- keel:cross-review findings 2 --> quoted\n`), 0);
  assert.equal(hand(`${MARKER}\nSummary.\n<!-- keel:cross-review findings 2 -->\n- one\n`), 1);
});

// ---- the limit --------------------------------------------------------------------

test('at the limit keel review exits 3 with the three choices; under it the exit codes are as before', async t => {
  const dir = await project(t);
  // Three rounds, all answered: the limit, not an unanswered comment, is why it stops.
  const at = await stubGh(t, { threads: threeRounds(), reviews: [onHead] });
  const r = keel(dir, at, ['#3']);
  assert.equal(r.code, 3);
  assert.match(r.out, /Review round 3 of 3: this review has reached its limit \(\.keel\/keel\.json "review": \{"rounds": 3\}\)/);
  assert.match(r.out, /Stop pushing fixes\. The choice is the owner's \(keel merges nothing\)/);
  assert.match(r.out, /\n  1\. Merge with the rest tracked\.[^\n]*\n     no open findings\.\n  2\. Split: land what is settled, and move what is still drawing findings to its own PR\.\n  3\. Close the PR\.\n$/);
  const d = keel(dir, at, ['#3', '--json']);
  assert.equal(d.code, 3);
  assert.deepEqual([d.json().ok, d.json().rounds.count, d.json().rounds.reached, d.json().choice], [false, 3, true, { fixFirst: [], track: [], unsorted: [] }]);
  // The read still listed every comment and left its receipt.
  assert.match(r.out, /3 review comments, 0 unanswered/);
  // --wait reads the same way: the loop's own read stops at the limit.
  assert.equal(keel(dir, at, ['#3', '--wait']).code, 3);

  // Under the limit: 0 when every comment is answered, 1 when one is not, and no word of rounds.
  const under = await stubGh(t, { threads: threeRounds().slice(0, 2), reviews: [onHead] });
  const ok = keel(dir, under, ['#3']);
  assert.equal(ok.code, 0);
  assert.equal(ok.out, 'acme/app#3 — Acme rocket skates (open, head d1d1d1d)\nReviewers (.keel/keel.json): acme-reviewer reviewed d1d1d1d\n2 review comments, 0 unanswered\n  answered   PRRT_a  acme-reviewer  skates.js:1  Acme finding a.\n  answered   PRRT_b  acme-reviewer  skates.js:1  Acme finding b.\n');
  const open = await stubGh(t, { threads: [finding('PRRT_a', A, { answered: true }), finding('PRRT_b', B)], reviews: [onHead] });
  assert.equal(keel(dir, open, ['#3']).code, 1);
  // A merged PR has no loop left to stop: answered as before.
  const merged = await stubGh(t, { threads: threeRounds(), reviews: [onHead], state: 'MERGED' });
  assert.equal(keel(dir, merged, ['#3']).code, 0);
  assert.equal(keel(dir, merged, ['#3', '--json']).json().choice, null);
});

test('--wait at the limit does not wait for the reviewer: an unreviewed head exits 3 on the first read', async t => {
  // Half a minute of waiting is configured, and the head D was never reviewed.
  const dir = await project(t, { reviewers: ['acme-reviewer'], wait: 0.5 });
  const gh = await stubGh(t, { threads: threeRounds(), reviews: [] });
  const r = keel(dir, gh, ['#3', '--wait', '--json']);
  assert.equal(r.code, 3);
  const d = r.json();
  assert.deepEqual([d.rounds.reached, d.waited, d.notReviewed], [true, null, ['acme-reviewer']]);
  assert.equal((await gh.calls()).length, 2, 'one read of the PR and its reviews: no poll');
  // Under the limit --wait still waits (and times out, exit 1) as before.
  const under = await stubGh(t, { threads: threeRounds().slice(0, 2), reviews: [] });
  const w = keel(await project(t, { reviewers: ['acme-reviewer'], wait: 0.002 }), under, ['#3', '--wait', '--json']);
  assert.equal(w.code, 1);
  assert.equal(w.json().waited.timedOut, true);
});

test('keel review --gate is unchanged by the limit: 0 when answered and the head reviewed, 1 when not, and no choice', async t => {
  const dir = await project(t);
  const done = await stubGh(t, { threads: threeRounds(), reviews: [onHead] });
  const g = keel(dir, done, ['#3', '--gate']);
  assert.equal(g.code, 0);
  assert.doesNotMatch(g.out, /Review round|Merge with the rest|Split|Close the PR/);
  const j = keel(dir, done, ['#3', '--gate', '--json']).json();
  assert.deepEqual([j.ok, j.choice, j.rounds.reached], [true, null, true]);
  const open = await stubGh(t, { threads: [...threeRounds(), finding('PRRT_d', D)], reviews: [onHead] });
  assert.equal(keel(dir, open, ['#3', '--gate']).code, 1);
  const unreviewed = await stubGh(t, { threads: threeRounds(), reviews: [] });
  assert.equal(keel(dir, unreviewed, ['#3', '--gate']).code, 1);
});

test('"review": {"rounds": N} changes the limit, 3 when unset; a bad value is refused naming the key', async t => {
  assert.equal(REVIEW_ROUNDS, 3);
  assert.equal(reviewRoundLimit({}), 3);
  assert.equal(reviewRoundLimit({ review: { reviewers: [] } }), 3);
  assert.equal(reviewRoundLimit({ review: { rounds: 5 } }), 5);
  const gh = await stubGh(t, { threads: threeRounds(), reviews: [onHead] });
  // Unset, with no "review" at all: three.
  assert.equal(keel(await project(t, null), gh, ['#3']).code, 3);
  // Five: three rounds are under it.
  const five = keel(await project(t, { reviewers: ['acme-reviewer'], rounds: 5 }), gh, ['#3', '--json']);
  assert.equal(five.code, 0);
  assert.deepEqual([five.json().rounds.limit, five.json().rounds.reached], [5, false]);
  // Two: reached at two rounds.
  const two = await stubGh(t, { threads: threeRounds().slice(0, 2), reviews: [onHead] });
  const tight = keel(await project(t, { reviewers: ['acme-reviewer'], rounds: 2 }), two, ['#3']);
  assert.equal(tight.code, 3);
  assert.match(tight.out, /Review round 2 of 2: .*"review": \{"rounds": 2\}/);
  // --reviewer keeps the project's limit.
  assert.equal(keel(await project(t, { rounds: 2 }), two, ['#3', '--reviewer', 'acme-reviewer']).code, 3);
  for (const bad of [0, -1, 2.5, '3', null, true]) {
    assert.match(reviewConfigOf({ review: { rounds: bad } }).problem, /^\.keel\/keel\.json "review" "rounds" must be a whole number of review rounds, 1 or more$/, String(bad));
    const r = keel(await project(t, { reviewers: ['acme-reviewer'], rounds: bad }), gh, ['#3']);
    assert.equal(r.code, 2, String(bad));
    assert.match(r.err, /"review" "rounds" must be a whole number of review rounds, 1 or more/, String(bad));
  }
  assert.equal(reviewConfigOf({ review: { rounds: 1 } }).problem, undefined);
  assert.match(reviewConfigOf({ review: { round: 3 } }).problem, /unknown key "round" \(reviewers, wait, rounds\)/);
});

// keel#118: the limit is the PR's repository's, whoever names the reviewer and wherever keel runs.
test('with --reviewer the round limit and the wait are the PR\'s repository\'s own, never this checkout\'s; only the reviewer list is replaced', async t => {
  // This checkout (acme/app) stops at one round and waits 9 minutes; the PR is acme/other's.
  const here = await project(t, { reviewers: ['acme-local'], rounds: 1, wait: 9 });
  const five = await stubGh(t, { threads: threeRounds(), reviews: [onHead], contents: { repo: 'acme/other', review: { reviewers: ['acme-theirs'], rounds: 5, wait: 7 } } });
  const r = keel(here, five, ['acme/other#3', '--reviewer', 'acme-reviewer', '--json']);
  assert.equal(r.code, 0, 'three rounds under acme/other\'s five: not the owner\'s yet');
  const d = r.json();
  assert.deepEqual([d.rounds.limit, d.rounds.reached, d.wait, d.reviewers, d.reviewersFrom], [5, false, 7, ['acme-reviewer'], '--reviewer']);
  assert.ok((await five.calls()).some(c => c[1] === 'repos/acme/other/contents/.keel/keel.json'), 'the target\'s config was read');
  // The other way: this checkout allows five, the PR's repo two.
  const loose = await project(t, { rounds: 5 });
  const two = await stubGh(t, { threads: threeRounds().slice(0, 2), reviews: [onHead], contents: { repo: 'acme/other', review: { rounds: 2 } } });
  const tight = keel(loose, two, ['acme/other#3', '--reviewer', 'acme-reviewer']);
  assert.equal(tight.code, 3);
  assert.match(tight.out, /Review round 2 of 2/);
  // The same answer as without --reviewer.
  assert.equal(keel(loose, two, ['acme/other#3', '--json']).json().rounds.limit, 2);
  // The PR's repo has no .keel/keel.json: the defaults (three rounds, ten minutes), not this checkout's one.
  const none = await stubGh(t, { threads: threeRounds().slice(0, 2), reviews: [onHead] });
  const plain = keel(here, none, ['acme/other#3', '--reviewer', 'acme-reviewer', '--json']);
  assert.equal(plain.code, 0);
  assert.deepEqual([plain.json().rounds.limit, plain.json().wait], [3, 10]);
  // An invalid or unreadable target config is refused as it is without --reviewer: exit 2, never this checkout's limit.
  for (const flags of [[], ['--reviewer', 'acme-reviewer']]) {
    const bad = keel(loose, await stubGh(t, { threads: threeRounds(), reviews: [onHead], contents: { review: { rounds: 0 } } }), ['acme/other#3', ...flags]);
    assert.equal(bad.code, 2, flags.join(' '));
    assert.match(bad.err, /acme\/other's \.keel\/keel\.json: "review" "rounds" must be a whole number of review rounds, 1 or more/);
    const down = keel(loose, await stubGh(t, { threads: threeRounds(), reviews: [onHead], contentsDown: true }), ['acme/other#3', ...flags]);
    assert.equal(down.code, 2, flags.join(' '));
    assert.match(down.err, /GitHub could not be read \(acme\/other's \.keel\/keel\.json\)/);
  }
  // The project's own PR is read from the file here, with no call for it.
  const own = await stubGh(t, { threads: threeRounds(), reviews: [onHead] });
  assert.equal(keel(loose, own, ['#3', '--reviewer', 'acme-reviewer', '--json']).json().rounds.limit, 5);
  assert.ok(!(await own.calls()).some(c => String(c[1]).includes('/contents/')));
});

// ---- the class --------------------------------------------------------------------

test('--class alone records the class and leaves the finding unanswered: the read, --gate and the release gate still count it', async t => {
  const dir = await project(t);
  // The session posts as another login than the PR's author: its class reply must not read as news or as an answer.
  const gh = await stubGh(t, { me: 'acme-agent', writes: true, threads: [finding('PRRT_1', A)], reviews: [onHead] });
  assert.equal(keel(dir, gh, ['#3']).code, 1);
  const c = keel(dir, gh, ['#3', '--class', 'security', 'PRRT_1', '--json']);
  assert.equal(c.code, 0, c.err);
  assert.deepEqual(c.json(), { repo: 'acme/app', number: 3, class: 'security', classed: [{ id: 'PRRT_1', kind: 'thread', class: 'security', replied: true, answered: false }] });
  const writes = writesIn(await gh.calls());
  assert.equal(writes.length, 1, 'one reply, and the thread is not resolved');
  assert.match(writes[0][3], /pulls\/3\/comments\/\d+\/replies$/);
  assert.equal(bodyOf(writes[0]), '<!-- keel:class security -->\nClassed **security** by the merge rule (a security hole). Not an answer: this finding is still open.');
  assert.equal((await gh.state()).threads[0].isResolved, undefined);

  // Still unanswered, with its class shown.
  const read = keel(dir, gh, ['#3', '--json']);
  assert.equal(read.code, 1);
  const d = read.json();
  assert.equal(d.unanswered, 1);
  assert.deepEqual([d.comments[0].id, d.comments[0].answered, d.comments[0].class, d.comments[0].resolved], ['PRRT_1', false, 'security', false]);
  assert.match(keel(dir, gh, ['#3']).out, /1 review comment, 1 unanswered\n  UNANSWERED PRRT_1 /);
  // --gate still fails on it, and so does the release gate's read of the same PR.
  const gate = keel(dir, gh, ['#3', '--gate']);
  assert.equal(gate.code, 1);
  const release = await prGate({ root: dir, repo: 'acme/app', number: 3 }, { env: envOf(dir, gh) });
  assert.deepEqual([release.ok, release.unanswered], [false, 1]);
  assert.match(release.why, /1 review comment unanswered \(PRRT_1\)/);

  // The same class again posts nothing more.
  const again = keel(dir, gh, ['#3', '--class', 'security', 'PRRT_1', '--json']);
  assert.equal(again.code, 0);
  assert.equal(again.json().classed[0].already, true);
  assert.equal(writesIn(await gh.calls()).length, 1);
});

test('a class mark is never an answer in the shared rule, and only whoever could answer may sort: never the finding\'s own text', () => {
  const c = (author, body, at = '2026-10-10T09:00:00Z') => ({ databaseId: 1, author: { login: author }, body, createdAt: at, url: 'u' });
  const pr = threads => ({ number: 3, author: { login: 'acme-owner' }, reviewThreads: { pageInfo: {}, nodes: threads.map((comments, i) => ({ id: `T${i}`, isResolved: false, comments: { pageInfo: {}, nodes: comments } })) }, comments: { pageInfo: {}, nodes: [] }, reviews: { pageInfo: {}, nodes: [] } });
  const one = comments => reviewComments(pr([comments]), ['acme-reviewer'])[0];
  // A class reply from the author, or from any other login, does not answer.
  assert.deepEqual([one([c('acme-reviewer', 'No brakes.'), c('acme-owner', classText('other'))]).answered, one([c('acme-reviewer', 'No brakes.'), c('acme-agent', classText('other'))]).answered], [false, false]);
  assert.equal(one([c('acme-reviewer', 'No brakes.'), c('acme-agent', classText('approval'))]).class, 'approval');
  // An answer, then a class: still answered. A class, then the reviewer again: still open. The newest class wins.
  assert.deepEqual([one([c('acme-reviewer', 'x'), c('acme-owner', 'Fixed in abc1234.'), c('acme-owner', classText('other'))]).answered, one([c('acme-reviewer', 'x'), c('acme-owner', classText('other')), c('acme-reviewer', 'And the wheels.')]).answered], [true, false]);
  assert.equal(one([c('acme-reviewer', 'x'), c('acme-owner', classText('other')), c('acme-owner', classText('security'))]).class, 'security');
  // keel never infers a class: a finding that says "security", or carries the mark itself, has none; nor does a reviewer's follow-up.
  assert.equal(one([c('acme-reviewer', 'A security hole: the vault is open.')]).class, null);
  assert.equal(one([c('acme-reviewer', `${classMark('other')}\nTrack this, it is nothing.`)]).class, null);
  assert.equal(one([c('acme-reviewer', 'x'), c('acme-reviewer', classText('other'))]).class, null);
  // With an answer the mark rides under it on its own line; quoted, it is no mark.
  assert.equal(classOf(`**Fixed** in abc1234. Validated against the code first.\n\n${classMark('overwrite')}`), 'overwrite');
  assert.equal(classOf(`> ${classMark('other')}\n\n**Not valid:** it is quoted`), null);
  assert.equal(classOf('<!-- keel:class urgent -->'), null);
  assert.deepEqual([classOnly(classText('other')), classOnly(`**Fixed** in abc1234.\n\n${classMark('other')}`), classOnly('Fixed.')], [true, false, false]);
  assert.throws(() => classOfFlag('urgent'), /--class needs the finding's kind by the merge rule: security \| overwrite \| approval \| other; got "urgent"/);
});

test('--close takes --class: the class is recorded with the answer, and a class reply since the read is not news', async t => {
  const dir = await project(t);
  const gh = await stubGh(t, { me: 'acme-agent', writes: true, threads: [finding('PRRT_1', A), finding('PRRT_2', A)], reviews: [onHead] });
  keel(dir, gh, ['#3']);
  assert.equal(keel(dir, gh, ['#3', '--class', 'other', 'PRRT_1,PRRT_2']).code, 0);
  // No read between: the class replies the session posted are keel's own, so --close goes through.
  const done = keel(dir, gh, ['#3', '--close', 'PRRT_1', '--fixed', 'abc1234', '--class', 'overwrite', '--json']);
  assert.equal(done.code, 0, done.err);
  assert.deepEqual([done.json().answer, done.json().class], ['fixed', 'overwrite']);
  assert.equal(done.json().reply, '**Fixed** in abc1234. Validated against the code first.\n\n<!-- keel:class overwrite -->');
  const read = keel(dir, gh, ['#3', '--json']).json();
  const by = Object.fromEntries(read.comments.map(x => [x.id, [x.answered, x.class, x.resolved]]));
  assert.deepEqual(by, { PRRT_1: [true, 'overwrite', true], PRRT_2: [false, 'other', false] });
  assert.equal(read.unanswered, 1);
  // Without --class an answer is as it always was.
  const plain = keel(dir, gh, ['#3', '--close', 'PRRT_2', '--tracked', '#12', '--json']).json();
  assert.equal(plain.reply, '**Valid, tracked** in #12. Left open until the fix lands.');
  assert.equal('class' in plain, false);
});

test('--class on a review body posts a marked comment that links it and still does not answer it', async t => {
  const dir = await project(t);
  const gh = await stubGh(t, { writes: true, bodies: [{ id: 'PRR_1', databaseId: 7, author: 'acme-reviewer', body: 'The whole plan overwrites the owner\'s anvil.', commit: A }], reviews: [onHead] });
  keel(dir, gh, ['#3']);
  assert.equal(keel(dir, gh, ['#3', '--class', 'overwrite', 'PRR_1']).code, 0);
  const [post] = writesIn(await gh.calls());
  assert.equal(post[3], 'repos/acme/app/issues/3/comments');
  assert.equal(bodyOf(post), '<!-- keel:class overwrite -->\n> The whole plan overwrites the owner\'s anvil.\n\nClassed **overwrite** by the merge rule (overwrites the owner\'s files). Not an answer: this finding is still open.\n\nhttps://github.com/acme/app/pull/3#pullrequestreview-7');
  const d = keel(dir, gh, ['#3', '--json']).json();
  assert.deepEqual(d.comments.map(x => [x.id, x.kind, x.answered, x.class]), [['PRR_1', 'review', false, 'overwrite']]);
  assert.equal(keel(dir, gh, ['#3', '--gate']).code, 1);
});

test('--class again with the same kind posts nothing, on a review body and on a thread, though the classifier is in the conversation', async t => {
  const dir = await project(t);
  // The classifier (acme-agent) has already spoken in the conversation, and its class reply on a review body is one more comment there.
  const gh = await stubGh(t, { me: 'acme-agent', writes: true, reviews: [onHead], threads: [finding('PRRT_1', A)],
    bodies: [{ id: 'PRR_1', databaseId: 7, author: 'acme-reviewer', body: 'The whole plan overwrites the owner\'s anvil.', commit: A }],
    comments: [{ id: 'IC_hello', databaseId: 60, author: 'acme-agent', body: 'Acme agent here, reading the review.' }] });
  keel(dir, gh, ['#3']);
  const first = keel(dir, gh, ['#3', '--class', 'overwrite', 'PRR_1,PRRT_1', '--json']);
  assert.equal(first.code, 0, first.err);
  assert.deepEqual(first.json().classed.map(x => [x.id, x.replied, x.already]), [['PRR_1', true, undefined], ['PRRT_1', true, undefined]]);
  assert.equal(writesIn(await gh.calls()).length, 2);
  const again = keel(dir, gh, ['#3', '--class', 'overwrite', 'PRR_1,PRRT_1', '--json']);
  assert.equal(again.code, 0, again.err);
  assert.deepEqual(again.json().classed.map(x => [x.id, x.replied, x.already]), [['PRR_1', false, true], ['PRRT_1', false, true]]);
  assert.equal(writesIn(await gh.calls()).length, 2, 'no second reply on either');
  // Another kind is a new decision: it is posted, and the newest class is the one read.
  assert.equal(keel(dir, gh, ['#3', '--class', 'other', 'PRR_1']).code, 0);
  assert.equal(writesIn(await gh.calls()).length, 3);
  assert.deepEqual(keel(dir, gh, ['#3', '--json']).json().comments.map(x => [x.id, x.answered, x.class]).sort(), [['PRRT_1', false, 'overwrite'], ['PRR_1', false, 'other']]);
});

test('--class refuses a kind that is not one of the four, no ids, an id it has not read, and a push; nothing is posted', async t => {
  const dir = await project(t);
  const gh = await stubGh(t, { threads: [finding('PRRT_1', A)], reviews: [onHead] });
  // Never read: refused, as --close is.
  const unread = keel(dir, gh, ['#3', '--class', 'security', 'PRRT_1']);
  assert.equal(unread.code, 2);
  assert.match(unread.err, /not read yet: PRRT_1 .*validate it, then class it/);
  keel(dir, gh, ['#3']);
  for (const [args, re] of [
    [['#3', '--class', 'urgent', 'PRRT_1'], /--class needs the finding's kind by the merge rule: security \| overwrite \| approval \| other; got "urgent"/],
    [['#3', '--class', 'security'], /--class needs the id of each finding after the kind/],
    [['#3', '--class', 'security', 'PRRT_nope'], /not a review thread or comment on acme\/app#3: PRRT_nope/],
    [['#3', '--class', 'security', 'PRRT_1', '--gate'], /--class sorts a finding; it takes no --wait, --gate or --reviewer/],
    [['acme/app@abc1234', '--class', 'security', 'F1'], /--class sorts a PR's findings/],
    [['#3', '--close', 'PRRT_1', '--fixed', 'abc1234', '--class', 'urgent'], /got "urgent"/],
  ]) {
    const r = keel(dir, gh, args);
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.err, re, args.join(' '));
  }
  assert.deepEqual(writesIn(await gh.calls()), []);
});

// ---- the choice, sorted -----------------------------------------------------------

test('a finding that arrives in the round that reaches the limit, classed and unanswered, is listed under fix first or track; one with no class is unsorted, never track', async t => {
  const dir = await project(t);
  // Rounds A and B are settled. The third push, C, drew four findings: the limit is reached with them open.
  const gh = await stubGh(t, { writes: true, reviews: [onHead], threads: [
    finding('PRRT_a', A, { answered: true }), finding('PRRT_b', B, { answered: true }),
    finding('PRRT_vault', C, { body: 'The vault key is logged.' }),
    finding('PRRT_yes', C, { body: 'It merges without the owner\'s yes.' }),
    finding('PRRT_name', C, { body: 'Rename the anvil.' }),
    finding('PRRT_new', C, { body: 'Nobody has read this one.' }),
  ] });
  const first = keel(dir, gh, ['#3', '--json']);
  assert.equal(first.code, 3);
  // Nothing is sorted yet: every open finding is unsorted, none is "track".
  assert.deepEqual([first.json().choice.fixFirst, first.json().choice.track, first.json().choice.unsorted.map(x => x.id)], [[], [], ['PRRT_vault', 'PRRT_yes', 'PRRT_name', 'PRRT_new']]);
  // The session that read them says which kind each is; none is answered.
  assert.equal(keel(dir, gh, ['#3', '--class', 'security', 'PRRT_vault']).code, 0);
  assert.equal(keel(dir, gh, ['#3', '--class', 'approval', 'PRRT_yes']).code, 0);
  assert.equal(keel(dir, gh, ['#3', '--class', 'other', 'PRRT_name']).code, 0);
  assert.deepEqual(writesIn(await gh.calls()).filter(c => c.some(a => a.startsWith('query=mutation'))), [], 'no thread was resolved');

  const r = keel(dir, gh, ['#3']);
  assert.equal(r.code, 3);
  assert.match(r.out, /4 unanswered/);
  const tail = r.out.slice(r.out.indexOf('\nReview round 3 of 3'));
  const part = (from, to) => tail.slice(tail.indexOf(from), tail.indexOf(to));
  const fixFirst = part('     fix first (a security hole, overwrites the owner\'s files, or skips an approval):', '     track (each needs an issue with its known limit):');
  const track = part('     track (each needs an issue with its known limit):', '     unsorted (');
  const unsorted = part('     unsorted (no class yet: neither "fix first" nor "track" until someone who read it says which):', '  2. Split');
  const idsIn = text => [...text.matchAll(/PRRT_\w+/g)].map(m => m[0]);
  assert.deepEqual(idsIn(fixFirst), ['PRRT_vault', 'PRRT_yes']);
  assert.deepEqual(idsIn(track), ['PRRT_name']);
  assert.deepEqual(idsIn(unsorted), ['PRRT_new', 'PRRT_new'], 'the row, and the command that sorts it');
  assert.match(fixFirst, /PRRT_vault  security  acme-reviewer  skates\.js:1  The vault key is logged\./);
  assert.match(unsorted, /keel review acme\/app#3 --class security\|overwrite\|approval\|other PRRT_new/);
  assert.match(tail, /\n  2\. Split: [^\n]+\n  3\. Close the PR\.\n$/);
  // An answered finding is in none of the lists, whatever its class.
  assert.doesNotMatch(tail, /PRRT_a|PRRT_b/);

  const d = keel(dir, gh, ['#3', '--json']).json();
  assert.deepEqual(d.choice.fixFirst.map(x => [x.id, x.class]), [['PRRT_vault', 'security'], ['PRRT_yes', 'approval']]);
  assert.deepEqual(d.choice.track, [{ id: 'PRRT_name', class: 'other', author: 'acme-reviewer', where: 'skates.js:1', text: 'Rename the anvil.' }]);
  assert.deepEqual(d.choice.unsorted, [{ id: 'PRRT_new', class: null, author: 'acme-reviewer', where: 'skates.js:1', text: 'Nobody has read this one.' }]);
  assert.equal(d.unanswered, 4);
  // The sort is the same rule everywhere: no class is unsorted, never track.
  const sorted = byMergeRule([{ id: 'x', answered: false, class: null }, { id: 'y', answered: false }, { id: 'z', answered: false, class: 'other' }, { id: 'done', answered: true, class: 'security' }]);
  assert.deepEqual([sorted.fixFirst, sorted.track.map(x => x.id), sorted.unsorted.map(x => x.id)], [[], ['z'], ['x', 'y']]);
});
