// keel improve, continued from tests/improve.test.mjs (split so the suite runs
// the two side by side): project lint, the health page, the gate's env, and
// single measures read on their own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir, chmod, mkdir, appendFile, cp, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './helpers/run.mjs';
import {
  MEASURES, selftest, measure, propose, tighten, conductCost, commandKind, exitCode, FIXTURE,
} from '../lib/improve.mjs';
import { KEEL, BIN, ENV, keel, byId, scratch, project, snapshot, ghStub, setConfig } from './helpers/improve.mjs';

test('in the project, a lessons table split by a blank line counts as lint (lessons-table-split)', async t => {
  const dir = await project(t);
  const env = { ...ENV, KEEL_GH: '/nonexistent/gh' };
  const lessons = join(dir, 'docs', 'lessons.md');
  await writeFile(lessons, '# Lessons\n\n| # | Shape | Cost | Guard |\n| --- | --- | --- | --- |\n| 1 | **Acme widgets drift.** | A day. | A test. |\n\n| 2 | **Acme gears slip.** | A week. | planned |\n');
  const mine = JSON.parse(run(process.execPath, ['scripts/keel/improve.mjs', '--json'], { cwd: dir, env }).stdout);
  assert.deepEqual(byId(mine, 'lint').facts.lint, [{ rule: 'lessons-table-split', path: 'docs/lessons.md' }]);
  assert.match(byId(mine, 'lint').detail, /lessons-table-split/);
  const full = keel(['improve', '--json'], dir, env).json();
  assert.deepEqual(byId(full, 'lint').facts.lint, [{ rule: 'lessons-table-split', path: 'docs/lessons.md' }], 'keel\'s doctor agrees');
});

test('--report writes the page to .keel/keel.json `health`; an ignored health dir is lint (health-ignored); a bad one breaks the report', async t => {
  const dir = await project(t);
  const env = { ...ENV, KEEL_GH: '/nonexistent/gh' };
  // The project ignores the default, as ledger's phase 33 did, and names its own.
  await writeFile(join(dir, '.gitignore'), '/docs/health/\n');
  await setConfig(dir, { health: '.keel/health' });
  const mine = run(process.execPath, ['scripts/keel/improve.mjs', '--report', '--json'], { cwd: dir, env });
  const data = JSON.parse(mine.stdout);
  assert.match(data.report, /^\.keel\/health\/\d{4}-\d{2}-\d{2}\.md$/, mine.stdout);
  assert.match(await readFile(join(dir, data.report), 'utf8'), /^# Health — /);
  assert.ok(!(await readdir(join(dir, 'docs'))).includes('health'), 'nothing in the default dir');
  assert.ok(!byId(data, 'lint').facts.lint.some(l => l.rule === 'health-ignored'));
  const full = keel(['improve', '--report', '--json'], dir, env).json();
  assert.equal(full.report, data.report, 'keel improve writes the same place');
  // Back to the ignored default: the night's own lint says so, and so does keel's doctor.
  await setConfig(dir, { health: 'docs/health' });
  const ignored = JSON.parse(run(process.execPath, ['scripts/keel/improve.mjs', '--json'], { cwd: dir, env }).stdout);
  assert.deepEqual(byId(ignored, 'lint').facts.lint.filter(l => l.rule === 'health-ignored'), [{ rule: 'health-ignored', path: 'docs/health' }]);
  assert.deepEqual(byId(keel(['improve', '--json'], dir, env).json(), 'lint').facts.lint.filter(l => l.rule === 'health-ignored'), [{ rule: 'health-ignored', path: 'docs/health' }]);
  // A health dir outside the repo is a broken instrument, and nothing is written.
  for (const bad of ['../acme-health', '/tmp/acme-health', 'docs/../../x', '.keel']) {
    await setConfig(dir, { health: bad });
    const r = run(process.execPath, ['scripts/keel/improve.mjs', '--report', '--json'], { cwd: dir, env });
    assert.equal(r.status, 2, `${bad}: ${r.stdout}`);
    assert.match(JSON.parse(r.stdout).error, /"health"/);
  }
});

test('the gate runs with .keel/keel.json `env`: outside without it, ok with it, and never a test runner\'s context', async t => {
  const dir = await project(t);
  // Exits 0 only with ACME_FLAG=1 and no NODE_TEST_CONTEXT (lesson 14).
  const check = 'node -e "process.exit(process.env.NODE_TEST_CONTEXT ? 5 : process.env.ACME_FLAG === \'1\' ? 0 : 4)"';
  await setConfig(dir, { check });
  const gateOnly = MEASURES.filter(m => m.id === 'gate');
  const env = { ...process.env, NODE_TEST_CONTEXT: 'child-v8' };
  const config = JSON.parse(await readFile(join(dir, '.keel', 'keel.json'), 'utf8'));
  let [g] = await measure({ root: dir, config, env, measures: gateOnly });
  assert.equal(g.state, 'outside');
  assert.match(g.detail, /exit 4/);
  [g] = await measure({ root: dir, config: { ...config, env: { ACME_FLAG: '1' } }, env, measures: gateOnly });
  assert.equal(g.state, 'ok', g.detail);
  // A bad env is a broken instrument, never a reading.
  [g] = await measure({ root: dir, config: { ...config, env: { 'acme-flag': '1' } }, env, measures: gateOnly });
  assert.equal(g.state, 'broken');
  // Through the CLI, from the config file.
  assert.equal(byId(keel(['improve', '--json'], dir).json(), 'gate').state, 'outside');
  await setConfig(dir, { env: { ACME_FLAG: '1' } });
  assert.equal(byId(keel(['improve', '--json'], dir).json(), 'gate').state, 'ok');
});

// ---- lessons_without_guard: the guard column by its header -----------------

const guardMeasure = MEASURES.filter(m => m.id === 'lessons_without_guard');
async function guardOn(t, table) {
  const dir = await scratch(t);
  await mkdir(join(dir, 'docs'));
  await writeFile(join(dir, 'docs', 'lessons.md'), `# Lessons\n\nWhat Acme learned.\n\n${table}`);
  const [r] = await measure({ root: dir, config: { name: 'Acme' }, env: {}, date: '2026-10-03', measures: guardMeasure });
  return r;
}

test('lessons_without_guard: ledger-shaped (numbered, Guard) counts the unguarded by number', async t => {
  const r = await guardOn(t, [
    '| # | The shape of it | What it cost | Guard |', '| --- | --- | --- | --- |',
    '| 1 | **Anvils fall.** | A coyote. | A net, tested. |',
    '| 2 | **Rockets leave.** | A canyon. | *to write* |',
    '| 3 | **Skates slip.** | A cliff. | *Planned:* phase 4. |', ''].join('\n'));
  assert.equal(r.state, 'outside', JSON.stringify(r));
  assert.equal(r.value, 1);
  assert.deepEqual(r.facts.ids, [2]);
});

test('lessons_without_guard: a three-column table with "Guard / status" and unnumbered rows is read, not broken', async t => {
  const r = await guardOn(t, [
    '| Shape | Evidence in Acme | Guard / status |', '|---|---|---|',
    '| **Anvils fall.** | A coyote. | `tests/anvil.test.mjs` |',
    '| **Rockets leave.** | A canyon. | planned |',
    '| **Skates slip.** | A cliff. | to write |',
    '| **Magnets pull.** | A train. | Planned in phase 7. |', ''].join('\n'));
  assert.equal(r.state, 'outside', JSON.stringify(r));
  assert.equal(r.value, 2);
  assert.deepEqual(r.facts.ids, [2, 3], 'numbered by position; "planned" without a phase and "to write" are unguarded');
  const ok = await guardOn(t, '| Shape | Evidence | Guard / status |\n|---|---|---|\n| **Anvils fall.** | A coyote. | a test |\n');
  assert.equal(ok.state, 'ok', JSON.stringify(ok));
  assert.match(ok.detail, /all 1 name a guard/);
});

test('lessons_without_guard: a table with no guard-like column is broken, never a zero', async t => {
  const r = await guardOn(t, '| Shape | Evidence | Fix |\n|---|---|---|\n| **Anvils fall.** | A coyote. | a net |\n');
  assert.equal(r.state, 'broken');
  assert.match(r.detail, /docs\/lessons\.md has no table with a Guard column/);
});

// ---- machine_prs: each queue against its own bound -------------------------

const prsMeasure = MEASURES.filter(m => m.id === 'machine_prs');
async function prsOn(t, heads, patch = {}) {
  const dir = await scratch(t);
  const KEEL_GH = await ghStub(t, { prs: JSON.stringify(heads.map(headRefName => ({ headRefName }))) });
  const [r] = await measure({ root: dir, config: { name: 'Acme', repo: 'acme/storefront', ...patch }, env: { ...ENV, KEEL_GH }, date: '2026-10-03', measures: prsMeasure });
  return r;
}

test('machine_prs: keel/, keel-night/ and keel-loop/ each hold one; a second is outside', async t => {
  for (const p of ['keel/update-v', 'keel-night/', 'keel-loop/']) {
    const one = await prsOn(t, [`${p}a`, 'wile/rocket']);
    assert.equal(one.state, 'ok', `${p}: ${JSON.stringify(one)}`);
    const two = await prsOn(t, [`${p}a`, `${p}b`]);
    assert.equal(two.state, 'outside', `${p}: ${JSON.stringify(two)}`);
    assert.equal(two.value, 2);
    assert.equal(two.bound, 1);
  }
});

test('machine_prs: renovate/ holds four, one per lane of keel\'s renovate.json; a fifth is outside', async t => {
  const lanes = n => Array.from({ length: n }, (_, i) => `renovate/lane-${i}`);
  const two = await prsOn(t, lanes(2));
  assert.equal(two.state, 'ok', JSON.stringify(two));
  assert.match(two.detail, /^keel\/ 0, keel-night\/ 0, keel-loop\/ 0, renovate\/ 2$/);
  const four = await prsOn(t, lanes(4));
  assert.equal(four.state, 'ok', JSON.stringify(four));
  assert.equal(four.value, 4);
  assert.equal(four.bound, 4);
  const five = await prsOn(t, lanes(5));
  assert.equal(five.state, 'outside', JSON.stringify(five));
  assert.equal(propose([five]).text, 'The renovate/ queue holds 5 PRs against 4 (one per lane): merge or close the 1 oldest (lesson 9).');
  // A renovate queue that is fine does not hide a keel queue that is not.
  const both = await prsOn(t, [...lanes(3), 'keel-night/a', 'keel-night/b']);
  assert.equal(both.state, 'outside');
  assert.equal(both.facts.worst, 'keel-night/');
});

test('machine_prs: a project with its own Renovate config reports renovate/ as information, not judged', async t => {
  const r = await prsOn(t, ['renovate/a', 'renovate/b', 'renovate/c', 'renovate/d', 'renovate/e', 'renovate/f', 'keel-night/a'], { local: { renovate: 'its own lanes' } });
  assert.equal(r.state, 'ok', JSON.stringify(r));
  assert.equal(r.facts.queues['renovate/'], 6);
  assert.deepEqual(r.facts.information, ['renovate/']);
  assert.match(r.detail, /renovate\/ 6 \(information/);
  const still = await prsOn(t, ['renovate/a', 'keel-night/a', 'keel-night/b'], { local: { renovate: 'its own lanes' } });
  assert.equal(still.state, 'outside', 'keel\'s own queues are still judged');
});

test('ci_red_streak counts verdicts only: cancelled and skipped runs between failures neither break nor add to the streak', async t => {
  const dir = await project(t);
  await setConfig(dir, { repo: 'acme/storefront' });
  const runs = JSON.stringify([{ conclusion: '' }, { conclusion: 'failure' }, { conclusion: 'cancelled' }, { conclusion: 'skipped' }, { conclusion: 'cancelled' },
    { conclusion: 'failure' }, { conclusion: 'cancelled' }, { conclusion: 'success' }, { conclusion: 'failure' }]);
  let m = byId(keel(['improve', '--json'], dir, { ...ENV, KEEL_GH: await ghStub(t, { runs }) }).json(), 'ci_red_streak');
  assert.equal(m.value, 2, m.detail);
  assert.match(m.detail, /2 failed runs in a row \(9 read, 4 verdicts\)/);
  // A green verdict behind cancelled runs is green; no verdict at all is said, not called green.
  m = byId(keel(['improve', '--json'], dir, { ...ENV, KEEL_GH: await ghStub(t, { runs: '[{"conclusion":"cancelled"},{"conclusion":"success"},{"conclusion":"failure"}]' }) }).json(), 'ci_red_streak');
  assert.equal(m.value, 0);
  assert.match(m.detail, /the latest verdict is green/);
  m = byId(keel(['improve', '--json'], dir, { ...ENV, KEEL_GH: await ghStub(t, { runs: '[{"conclusion":"cancelled"}]' }) }).json(), 'ci_red_streak');
  assert.match(m.detail, /no verdict yet/);
});

// ---- lessons_unsent: what has not gone home, by keel lessons' own fingerprint ----

const unsentMeasure = MEASURES.filter(m => m.id === 'lessons_unsent');
const ACME_ROWS = '| 1 | **Anvils  fall,   twice.** *(acme)* | A coyote. | a net |\n| 2 | **Rockets leave.** *(acme)* | A canyon. | a leash |\n| 3 | **Signs are believed.** *(acme)* | Tuesdays. | a sceptic |\n';
async function unsentOn(t, sent, patch = { repo: 'acme/storefront' }) {
  const dir = await project(t);
  await setConfig(dir, patch);
  await appendFile(join(dir, 'docs', 'lessons.md'), ACME_ROWS);
  if (sent) await writeFile(join(dir, '.keel', 'sent.json'), JSON.stringify(sent));
  return dir;
}
// A dry run calls no gh; a stub path that does not exist proves it.
const dryLessons = dir => keel(['lessons', '--dry-run', '--to', 'acme/keel', '--json'], dir, { ...ENV, KEEL_GH: '/nonexistent/gh' });
const unsentResult = async dir => (await measure({ root: dir, config: JSON.parse(await readFile(join(dir, '.keel', 'keel.json'), 'utf8')), measures: unsentMeasure }))[0];

test('lessons_unsent counts exactly the rows not in sent.json, and shares keel lessons\' fingerprint', async t => {
  const dir = await unsentOn(t, null);
  // keel lessons' own view of the rows (dry run: no gh, nothing written).
  const dry = dryLessons(dir);
  assert.equal(dry.code, 3, dry.out + dry.err);
  const fps = dry.json().items.filter(i => i.kind === 'lesson').map(i => i.fingerprint);
  assert.equal(fps.length, 3);
  let r = await unsentResult(dir);
  assert.equal(r.state, 'outside');
  assert.equal(r.value, 3);
  assert.deepEqual(r.facts.fingerprints, fps, 'the measure\'s set is keel lessons\' set');

  // Two sent, by the fingerprints keel lessons gave: exactly one is left.
  await writeFile(join(dir, '.keel', 'sent.json'), JSON.stringify({ [fps[0]]: { issue: 'u1', at: 'a' }, [fps[2]]: { issue: 'u3', at: 'a' }, 'acme/storefront/commit/abc': { issue: 'u', at: 'a' } }));
  r = await unsentResult(dir);
  assert.equal(r.value, 1);
  assert.deepEqual(r.facts.ids, [2]);
  assert.match(r.detail, /^#2 of 3 in docs\/lessons\.md$/);
  const again = dryLessons(dir);
  assert.deepEqual(again.json().items.filter(i => i.kind === 'lesson').map(i => i.fingerprint), r.facts.fingerprints);
  assert.equal(propose([r]).text.startsWith('Send them home: `npx -y github:dalmaer/keel lessons --yes`'), true, propose([r]).text);

  // All sent: within its bound of 0; and it never ratchets.
  await writeFile(join(dir, '.keel', 'sent.json'), JSON.stringify(Object.fromEntries(fps.map(f => [f, { issue: 'u', at: 'a' }]))));
  r = await unsentResult(dir);
  assert.equal(r.state, 'ok');
  assert.equal(r.value, 0);
  assert.equal(r.detail, 'all 3 sent');
  assert.equal(tighten([{ id: 'lessons_unsent', state: 'ok', value: 0 }], { lessons_unsent: 2 }).bounds.lessons_unsent, 2, 'a rule, not a level');
});

test('lessons_unsent: the project is the repo, else the name; n/a without a table, and on keel itself', async t => {
  const named = await unsentOn(t, null, { repo: undefined, name: 'Acme Store' });
  const dry = dryLessons(named);
  const r = await unsentResult(named);
  assert.deepEqual(r.facts.fingerprints, dry.json().items.filter(i => i.kind === 'lesson').map(i => i.fingerprint));
  assert.ok(r.facts.fingerprints.every(f => f.startsWith('Acme Store/lesson/')));

  const custom = await unsentOn(t, null, { repo: 'acme/storefront', lessons: 'notes/LESSONS.md' });
  let x = await unsentResult(custom);
  assert.equal(x.state, 'n/a');
  assert.match(x.detail, /no notes\/LESSONS\.md/);
  await mkdir(join(custom, 'notes'));
  await writeFile(join(custom, 'notes', 'LESSONS.md'), `| # | Shape | Cost | Guard |\n| --- | --- | --- | --- |\n${ACME_ROWS}`);
  x = await unsentResult(custom);
  assert.equal(x.value, 3, 'the configured table is read');

  const home = await unsentOn(t, null, { repo: 'acme/storefront', keel: 'self' });
  x = await unsentResult(home);
  assert.equal(x.state, 'n/a');
  assert.match(x.detail, /keel is home/);

  const torn = await unsentOn(t, null);
  await writeFile(join(torn, '.keel', 'sent.json'), '{ torn');
  x = await unsentResult(torn);
  assert.equal(x.state, 'broken', 'an unreadable sent.json is never a zero');
});

// ---- ledger's Codex reviews, keel's side (#61, #62, #70, #75, #77, #79, #80) ----

const one = id => MEASURES.filter(m => m.id === id);
const readConfig = async dir => JSON.parse(await readFile(join(dir, '.keel', 'keel.json'), 'utf8'));

test('a malformed .keel/bounds.json is a broken instrument (exit 2), never a measure outside its bound (exit 1)', async t => {
  const dir = await project(t);
  const env = { ...ENV, KEEL_GH: '/nonexistent/gh' };
  for (const [bounds, why] of [['{ not json', /is not JSON/], ['[1, 2]', /must be an object/], ['7', /must be an object/]]) {
    await writeFile(join(dir, '.keel', 'bounds.json'), bounds);
    const r = run(process.execPath, ['scripts/keel/improve.mjs', '--json'], { cwd: dir, env });
    assert.equal(r.status, 2, `${bounds}: ${r.stdout}${r.stderr}`);
    assert.match(JSON.parse(r.stdout).error, why);
  }
});

test('ci_red_streak reads enough runs that cancelled ones cannot hide a verdict; a full page of none is n/a, never green', async t => {
  const dir = await project(t);
  await setConfig(dir, { repo: 'acme/storefront' });
  const config = await readConfig(dir);
  const on = async runs => (await measure({ root: dir, config, env: { ...ENV, KEEL_GH: await ghStub(t, { runs: JSON.stringify(runs) }) }, measures: one('ci_red_streak') }))[0];
  const cancelled = n => Array.from({ length: n }, () => ({ conclusion: 'cancelled' }));
  // 25 cancelled runs, then the failure: a limit of 20 runs read before the filter saw no verdict and said 0.
  let m = await on([...cancelled(25), { conclusion: 'failure' }, { conclusion: 'success' }]);
  assert.equal(m.value, 1, m.detail);
  assert.equal(m.state, 'outside');
  // A whole page of cancelled runs says nothing: n/a.
  m = await on([...cancelled(150), { conclusion: 'failure' }]);
  assert.equal(m.state, 'n/a', m.detail);
  assert.match(m.detail, /no verdict in the newest 100 runs/);
  // A full page whose every verdict failed: the streak is at least that.
  m = await on(Array.from({ length: 100 }, (_, i) => ({ conclusion: i % 2 ? 'failure' : 'cancelled' })));
  assert.equal(m.value, 50);
  assert.match(m.detail, /at least 50 failed runs in a row/);
});

test('dependency_age reads each app or workspace folder with its own package-lock.json, not only the root', async t => {
  const dir = await project(t);
  const bin = await scratch(t, 'keel-npm-');
  const npm = join(bin, 'npm');
  // A stub npm: what is outdated depends on the folder it runs in.
  await writeFile(npm, `#!${process.execPath}
const cwd = process.cwd().replaceAll('\\\\', '/');
const out = cwd.endsWith('/web') ? { next: { current: '14.0.0', latest: '15.0.0' } }
  : cwd.endsWith('/packages/acme-ui') ? { react: [{ current: '18.0.0', latest: '19.0.0' }] }
  : { 'acme-left-pad': { current: '1.0.0', latest: '2.0.0' } };
console.log(JSON.stringify(out)); process.exit(1);
`);
  await chmod(npm, 0o755);
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  await writeFile(join(dir, 'package.json'), JSON.stringify({ ...pkg, workspaces: ['packages/*'] }));
  for (const d of ['.', 'web', 'packages/acme-ui', 'client']) await mkdir(join(dir, d), { recursive: true });
  for (const d of ['.', 'web', 'packages/acme-ui']) await writeFile(join(dir, d, 'package-lock.json'), '{}\n');
  const m = (await measure({ root: dir, config: await readConfig(dir), env: { ...ENV, KEEL_NPM: npm }, measures: one('dependency_age') }))[0];
  assert.equal(m.state, 'outside', m.detail);
  assert.deepEqual(m.facts.names, ['acme-left-pad', 'next (web)', 'react (packages/acme-ui)']);
  assert.deepEqual(m.facts.dirs, ['.', 'web', 'packages/acme-ui'], 'client/ has no lockfile: not read');
  // Only an app folder's lockfile: still read, not n/a.
  await rm(join(dir, 'package-lock.json'));
  const web = (await measure({ root: dir, config: await readConfig(dir), env: { ...ENV, KEEL_NPM: npm }, measures: one('dependency_age') }))[0];
  assert.deepEqual(web.facts.names, ['next (web)', 'react (packages/acme-ui)']);
});

test('the health dir: a dated-page ignore rule is health-ignored, a symlink out of the repo and pathspec magic break the report', async t => {
  const dir = await project(t);
  const env = { ...ENV, KEEL_GH: '/nonexistent/gh' };
  const lint = async () => byId(JSON.parse(run(process.execPath, ['scripts/keel/improve.mjs', '--json'], { cwd: dir, env }).stdout), 'lint').facts.lint.filter(l => l.rule.startsWith('health'));
  // #77: a rule for the pages, not the directory: an x.md probe missed it.
  await writeFile(join(dir, '.gitignore'), 'docs/health/20*.md\n');
  assert.deepEqual(await lint(), [{ rule: 'health-ignored', path: 'docs/health' }]);
  await writeFile(join(dir, '.gitignore'), '');
  // #79: a symlink that leaves the repo: lint, and --report writes nothing there.
  const elsewhere = await scratch(t, 'keel-elsewhere-');
  await mkdir(join(dir, '.keel'), { recursive: true });
  await symlink(elsewhere, join(dir, '.keel', 'health'));
  await setConfig(dir, { health: '.keel/health' });
  assert.deepEqual(await lint(), [{ rule: 'health-config', path: '.keel/health' }]);
  const r = run(process.execPath, ['scripts/keel/improve.mjs', '--report', '--json'], { cwd: dir, env });
  assert.equal(r.status, 2, r.stdout);
  assert.match(JSON.parse(r.stdout).error, /resolves outside the repo/);
  assert.deepEqual(await readdir(elsewhere), [], 'nothing written outside the repo');
  // A symlink to a folder inside the repo is the repo's.
  await rm(join(dir, '.keel', 'health'));
  await mkdir(join(dir, 'acme-pages'));
  await symlink('../acme-pages', join(dir, '.keel', 'health'));
  assert.deepEqual(await lint(), []);
  // #80: git pathspec magic in "health".
  for (const bad of [':(top)docs/health', ':!docs']) {
    await setConfig(dir, { health: bad });
    assert.deepEqual((await lint()).map(l => l.rule), ['health-config'], bad);
    const b = run(process.execPath, ['scripts/keel/improve.mjs', '--report', '--json'], { cwd: dir, env });
    assert.equal(b.status, 2, bad);
    assert.match(JSON.parse(b.stdout).error, /pathspec magic/, bad);
  }
});

test('lessons-table-split: a row an unescaped | splits into more cells than the header is lint, an escaped \\| is not', async t => {
  const dir = await project(t);
  const env = { ...ENV, KEEL_GH: '/nonexistent/gh' };
  const lessons = join(dir, 'docs', 'lessons.md');
  const table = cell => `# Lessons\n\n| # | Shape | Cost | Guard |\n| --- | --- | --- | --- |\n| 1 | **Acme reads ${cell}.** | A day. | A test. |\n| 2 | **Acme gears slip.** | A week. | planned |\n`;
  await writeFile(lessons, table('`a || b`'));
  const mine = JSON.parse(run(process.execPath, ['scripts/keel/improve.mjs', '--json'], { cwd: dir, env }).stdout);
  assert.deepEqual(byId(mine, 'lint').facts.lint, [{ rule: 'lessons-table-split', path: 'docs/lessons.md' }]);
  await writeFile(lessons, table('`a \\|\\| b`'));
  const fixed = JSON.parse(run(process.execPath, ['scripts/keel/improve.mjs', '--json'], { cwd: dir, env }).stdout);
  assert.deepEqual(byId(fixed, 'lint').facts.lint, []);
});
