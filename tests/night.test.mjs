// keel drain: one open PR per machine queue, the newest. gh is stubbed at the
// boundary the way real gh behaves (lesson 8): `pr list --json <fields>` prints
// a JSON array of exactly those fields, `mergeable` is MERGEABLE, CONFLICTING or
// UNKNOWN (GitHub computes it lazily, so a first ask can say UNKNOWN), `files`
// is [{path, additions, deletions}]; `pr merge` and `pr close` print a line and
// exit non-zero on failure. Fixtures are synthetic: Acme Notes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, cleanEnv } from './helpers/run.mjs';
import { plan, isData, checkPrefix, SUPERSEDED } from '../lib/night.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(KEEL, 'bin', 'keel.mjs');
const REPO = 'acme/notes';

const files = (...paths) => paths.map(path => ({ path, additions: 1, deletions: 0 }));
const pr = (number, headRefName, day, mergeable, paths, extra = {}) =>
  ({ number, headRefName, createdAt: `2026-09-${String(day).padStart(2, '0')}T07:30:00Z`, mergeable, files: files(...paths), isCrossRepository: false, ...extra });
const PAGE = d => [`docs/health/2026-09-${d}.md`, '.keel/bounds.json'];

/** The queue every test starts from: three nights, a stray, a fork, a person's PR. */
const SEED = () => [
  pr(11, 'keel-night/2026-09-27', 27, 'MERGEABLE', PAGE(27)),
  pr(12, 'keel-night/2026-09-28', 28, 'CONFLICTING', PAGE(28)),
  pr(13, 'keel-night/2026-09-29', 29, 'MERGEABLE', [...PAGE(29), 'lib/acme.mjs']),
  pr(14, 'keel-night/2026-09-30', 30, 'MERGEABLE', [...PAGE(30), 'docs/inbox/2026-09-30-acme.md', 'docs/INBOX.md']),
  pr(20, 'renovate/patch-minor', 26, 'MERGEABLE', ['package-lock.json']),
  pr(21, 'keel-night/evil', 25, 'MERGEABLE', PAGE(25), { isCrossRepository: true }),
  pr(22, 'acme/keel-night/notes', 24, 'MERGEABLE', PAGE(24)),
];

async function scratch(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'keel-night-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** Acme Notes (a keel project naming its repo) and a gh over a JSON state file. */
async function setup(t, { prs = SEED(), unknownOnce = [], failMerge = [], failClose = [] } = {}) {
  const dir = await scratch(t);
  const root = join(dir, 'acme-notes');
  await mkdir(join(root, '.keel'), { recursive: true });
  await writeFile(join(root, '.keel', 'keel.json'), JSON.stringify({ name: 'Acme Notes', repo: REPO, practice: '0.1.0', practices: ['base'] }));
  const state = join(dir, 'state.json'), log = join(dir, 'gh.log'), gh = join(dir, 'gh');
  await writeFile(state, JSON.stringify({ prs: prs.map(p => ({ ...p, state: 'OPEN' })), unknownOnce, failMerge, failClose, lists: 0 }));
  await writeFile(gh, `#!${process.execPath}
const fs = require('node:fs');
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(argv) + '\\n');
const s = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8'));
const save = () => fs.writeFileSync(${JSON.stringify(state)}, JSON.stringify(s));
const opt = f => argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined;
if (opt('--repo') !== ${JSON.stringify(REPO)}) { console.error('stub gh: expected --repo ${REPO}'); process.exit(1); }
const [a, b, n] = argv;
const find = () => s.prs.find(p => String(p.number) === n);
if (a === 'pr' && b === 'list') {
  if (opt('--state') !== 'open') { console.error('stub gh: list open PRs'); process.exit(1); }
  const fields = opt('--json').split(',');
  const first = s.lists++ === 0;
  const rows = s.prs.filter(p => p.state === 'OPEN').map(p => Object.fromEntries(fields.map(f =>
    [f, f === 'mergeable' && first && s.unknownOnce.includes(p.number) ? 'UNKNOWN' : p[f]])));
  save();
  console.log(JSON.stringify(rows));
} else if (a === 'pr' && b === 'merge') {
  const p = find();
  if (!p || p.state !== 'OPEN' || s.failMerge.includes(p.number)) { console.error('X Pull request #' + n + ' is not mergeable'); process.exit(1); }
  if (!argv.includes('--squash') || !argv.includes('--delete-branch=false')) { console.error('stub gh: squash, keep the branch'); process.exit(1); }
  p.state = 'MERGED'; save();
  console.log('✓ Squashed and merged pull request #' + n);
} else if (a === 'pr' && b === 'close') {
  const p = find();
  if (!p || s.failClose.includes(p.number)) { console.error('GraphQL: Could not resolve to a PullRequest'); process.exit(1); }
  p.state = 'CLOSED'; p.comment = opt('--comment'); save();
  console.log('✓ Closed pull request #' + n);
} else { console.error('stub gh: unknown ' + argv.join(' ')); process.exit(1); }
`);
  await chmod(gh, 0o755);
  const env = { ...cleanEnv(), KEEL_GH: gh, KEEL_DRAIN_WAIT_MS: '0' };
  return {
    root,
    keel: (args, extra = {}) => {
      const r = run(process.execPath, [BIN, ...args], { cwd: root, env: { ...env, ...extra } });
      return { code: r.status, out: r.stdout, err: r.stderr };
    },
    calls: async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(l => JSON.parse(l)),
    state: async () => JSON.parse(await readFile(state, 'utf8')),
  };
}

const writes = calls => calls.filter(c => c[0] === 'pr' && ['merge', 'close'].includes(c[1]));

test('isData and checkPrefix', () => {
  for (const p of ['docs/health/2026-09-30.md', 'docs/inbox/x.md', 'docs/INBOX.md', '.keel/bounds.json']) assert.ok(isData(p), p);
  for (const p of ['docs/healthy.md', 'docs/INBOX.md.bak', '.keel/keel.json', 'lib/acme.mjs', 'docs/health']) assert.ok(!isData(p), p);
  assert.equal(checkPrefix('keel-night/'), 'keel-night/');
  assert.equal(checkPrefix('keel/update-v'), 'keel/update-v');
  for (const bad of ['', 'keel', '/', '/x', 'a b/']) assert.throws(() => checkPrefix(bad), e => e.exitCode === 2, bad);
});

test('plan: older data PRs that merge are merged, the rest superseded; strays, forks and other prefixes untouched', () => {
  const p = plan(SEED(), 'keel-night/');
  assert.equal(p.newest, 14);
  assert.deepEqual(p.queue.map(q => q.number), [11, 12, 13, 14], 'oldest first; the fork and other prefixes are not in the queue');
  assert.deepEqual(p.actions.map(a => [a.number, a.action]), [[11, 'merge'], [12, 'close'], [13, 'close'], [14, 'leave']]);
  assert.match(p.actions[1].why, /CONFLICTING/);
  assert.match(p.actions[2].why, /lib\/acme\.mjs/);
  assert.match(p.actions[3].why, /no --gate-passed/);
  assert.deepEqual(plan(SEED(), 'keel-night/', { gatePassed: true }).actions.at(-1).action, 'merge');
});

test('plan: the newest is left when it is not data or not mergeable, even after a gate; an empty queue does nothing', () => {
  const code = [pr(1, 'keel-night/a', 1, 'MERGEABLE', ['lib/acme.mjs'])];
  assert.equal(plan(code, 'keel-night/', { gatePassed: true }).actions[0].action, 'leave');
  for (const m of ['CONFLICTING', 'UNKNOWN', undefined]) {
    assert.equal(plan([pr(1, 'keel-night/a', 1, m, PAGE(1))], 'keel-night/', { gatePassed: true }).actions[0].action, 'leave', String(m));
  }
  assert.equal(plan([pr(1, 'keel-night/a', 1, 'MERGEABLE', [])], 'keel-night/', { gatePassed: true }).actions[0].action, 'leave', 'no files is not data');
  assert.deepEqual(plan([pr(1, 'renovate/x', 1, 'MERGEABLE', PAGE(1))], 'keel-night/'), { queue: [], newest: null, actions: [] });
});

test('without --yes: the plan, exit 3, and gh only listed', async t => {
  const s = await setup(t);
  const r = s.keel(['drain', 'keel-night/', '--json']);
  assert.equal(r.code, 3, r.err || r.out);
  const out = JSON.parse(r.out);
  assert.equal(out.needs, 'yes');
  assert.equal(out.newest, 14);
  assert.deepEqual(out.actions.map(a => a.action), ['merge', 'close', 'close', 'leave']);
  assert.deepEqual(writes(await s.calls()), [], 'nothing merged or closed');
  const text = s.keel(['drain', 'keel-night/']);
  assert.equal(text.code, 3);
  assert.match(text.out, /needs a yes/);
});

test('--yes: oldest first, merge squashes and keeps the branch, close says how to recover; nothing outside the queue is touched', async t => {
  const s = await setup(t);
  const r = s.keel(['drain', 'keel-night/', '--yes', '--json']);
  assert.equal(r.code, 0, r.err || r.out);
  const out = JSON.parse(r.out);
  assert.deepEqual(out.actions.map(a => [a.number, a.action, a.done]), [[11, 'merge', true], [12, 'close', true], [13, 'close', true], [14, 'leave', false]]);
  const w = writes(await s.calls());
  assert.deepEqual(w.map(c => [c[1], c[2]]), [['merge', '11'], ['close', '12'], ['close', '13']]);
  assert.deepEqual(w[0], ['pr', 'merge', '11', '--repo', REPO, '--squash', '--delete-branch=false']);
  const st = await s.state();
  const by = n => st.prs.find(p => p.number === n);
  assert.equal(by(12).comment, SUPERSEDED(14));
  assert.equal(by(12).comment, 'Superseded by #14 (keel drain). The branch is kept: reopen to recover.');
  for (const n of [14, 20, 21, 22]) assert.equal(by(n).state, 'OPEN', `#${n} untouched`);
  const list = (await s.calls()).find(c => c[1] === 'list');
  assert.equal(list[list.indexOf('--json') + 1], 'number,headRefName,createdAt,mergeable,files,isCrossRepository');
});

test('--gate-passed merges the newest too, leaving the queue empty', async t => {
  const s = await setup(t, { prs: [pr(11, 'keel-night/2026-09-27', 27, 'MERGEABLE', PAGE(27)), pr(14, 'keel-night/2026-09-30', 30, 'MERGEABLE', PAGE(30))] });
  const r = s.keel(['drain', 'keel-night/', '--yes', '--gate-passed', '--json']);
  assert.equal(r.code, 0, r.err || r.out);
  assert.deepEqual(writes(await s.calls()).map(c => [c[1], c[2]]), [['merge', '11'], ['merge', '14']]);
  assert.ok((await s.state()).prs.every(p => p.state === 'MERGED'));
  const again = s.keel(['drain', 'keel-night/']);
  assert.equal(again.code, 0, 'nothing left: no yes needed');
  assert.match(again.out, /Nothing to drain/);
});

test('UNKNOWN mergeability is asked again once, then decided on what GitHub says', async t => {
  const s = await setup(t, { prs: [pr(11, 'keel-night/2026-09-27', 27, 'MERGEABLE', PAGE(27)), pr(14, 'keel-night/2026-09-30', 30, 'MERGEABLE', PAGE(30))], unknownOnce: [11, 14] });
  const r = s.keel(['drain', 'keel-night/', '--yes', '--gate-passed', '--json']);
  assert.equal(r.code, 0, r.err || r.out);
  assert.equal((await s.calls()).filter(c => c[1] === 'list').length, 2);
  assert.deepEqual(writes(await s.calls()).map(c => [c[1], c[2]]), [['merge', '11'], ['merge', '14']]);
});

test('still UNKNOWN: an older PR is superseded and the newest left, never merged', async t => {
  const s = await setup(t, { prs: [pr(11, 'keel-night/2026-09-27', 27, 'UNKNOWN', PAGE(27)), pr(14, 'keel-night/2026-09-30', 30, 'UNKNOWN', PAGE(30))] });
  const r = s.keel(['drain', 'keel-night/', '--yes', '--gate-passed', '--json']);
  assert.equal(r.code, 0, r.err || r.out);
  assert.deepEqual(writes(await s.calls()).map(c => [c[1], c[2]]), [['close', '11']]);
  assert.equal((await s.state()).prs.find(p => p.number === 14).state, 'OPEN');
});

test('a merge that fails: an older PR is superseded instead, the newest is left; a close that fails is exit 1', async t => {
  const s = await setup(t, { prs: [pr(11, 'keel-night/2026-09-27', 27, 'MERGEABLE', PAGE(27)), pr(14, 'keel-night/2026-09-30', 30, 'MERGEABLE', PAGE(30))], failMerge: [11, 14] });
  const r = s.keel(['drain', 'keel-night/', '--yes', '--gate-passed', '--json']);
  assert.equal(r.code, 0, r.err || r.out);
  const out = JSON.parse(r.out);
  assert.deepEqual(out.actions.map(a => [a.number, a.action, a.done]), [[11, 'close', true], [14, 'leave', false]]);
  assert.match(out.actions[1].why, /merge failed.*left for a person/);

  const f = await setup(t, { failClose: [12] });
  const bad = f.keel(['drain', 'keel-night/', '--yes', '--json']);
  assert.equal(bad.code, 1, bad.out);
  const o = JSON.parse(bad.out);
  assert.equal(o.ok, false);
  assert.match(o.actions.find(a => a.number === 12).error, /Could not resolve/);
  assert.equal(o.actions.find(a => a.number === 13).done, true, 'one failure does not stop the rest');
});

test('the update queue: older update PRs are superseded, the newest never merged (not data)', async t => {
  const s = await setup(t, { prs: [pr(31, 'keel/update-v0.1.0', 1, 'MERGEABLE', ['.keel/keel.json', 'AGENTS.md']), pr(32, 'keel/update-v0.2.0', 8, 'MERGEABLE', ['.keel/keel.json', 'AGENTS.md']), pr(33, 'keel-night/2026-09-30', 30, 'MERGEABLE', PAGE(30))] });
  const r = s.keel(['drain', 'keel/update-v', '--yes', '--gate-passed', '--json']);
  assert.equal(r.code, 0, r.err || r.out);
  assert.deepEqual(writes(await s.calls()).map(c => [c[1], c[2]]), [['close', '31']]);
});

test('usage: a prefix is required and names a namespace', async t => {
  const s = await setup(t);
  assert.equal(s.keel(['drain']).code, 2);
  assert.equal(s.keel(['drain', 'keel-night']).code, 2);
  assert.equal(s.keel(['drain', 'keel-night/', '--merge-all']).code, 2);
  assert.deepEqual(writes(await s.calls()), []);
});
