// keel improve: measures with bounds, a ratchet, one proposal, and a grader
// that is itself graded. The selftest must fail when any one measure is made
// to say "fine" (lesson 6); an instrument that cannot run is broken, never 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir, chmod, mkdir, appendFile, cp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './helpers/run.mjs';
import {
  MEASURES, selftest, measure, propose, proposalText, tighten, conductCost, commandKind, exitCode, FIXTURE,
} from '../lib/improve.mjs';
import { KEEL, BIN, ENV, keel, byId, scratch, project, snapshot, ghStub, setConfig } from './helpers/improve.mjs';

test('selftest: every measure reports outside on the unhealthy fixture', async () => {
  const r = await selftest();
  assert.equal(r.exitCode, 0, r.text);
  assert.deepEqual(r.data.missed, []);
  assert.deepEqual(r.data.measures.map(m => m.id), MEASURES.map(m => m.id));
  assert.ok(r.data.measures.every(m => m.state === 'outside'));
  const cli = keel(['improve', '--selftest', '--json'], tmpdir());
  assert.equal(cli.code, 0, cli.err);
  assert.equal(cli.json().ok, true);
});

// The mutation test (the selftest fails when any one measure is made to say
// "fine") is tests/improve-selftest.test.mjs, so the suite runs it side by side.

test('a healthy fresh project: within bounds, exit 0, and every n/a says why', async t => {
  const dir = await project(t);
  const r = keel(['improve', '--json'], dir);
  assert.equal(r.code, 0, r.out + r.err);
  const data = r.json();
  assert.equal(data.ok, true);
  assert.equal(data.proposal, null);
  const gate = byId(data, 'gate');
  assert.equal(gate.state, 'ok');
  assert.ok(gate.facts.tests > 0, 'the spawned gate ran tests');
  for (const [id, why] of [['phases_without_issue', /no repo/], ['ci_red_streak', /no repo/], ['machine_prs', /no repo/],
    ['inbox_waiting', /keel only/], ['dependency_age', /package-lock/], ['conduct_cost', /--transcripts/]]) {
    const m = byId(data, id);
    assert.equal(m.state, 'n/a', id);
    assert.equal(m.value, null, id);
    assert.match(m.detail, why, id);
  }
  // Nothing written without --report.
  assert.equal(data.report, null);
  await assert.rejects(readFile(join(dir, '.keel', 'bounds.json')));
});

test('n/a says which: gh missing, gh not authenticated, phases a local variant', async t => {
  const dir = await project(t);
  await setConfig(dir, { repo: 'acme/storefront' });
  let r = keel(['improve', '--json'], dir, { ...ENV, KEEL_GH: '/nonexistent/gh' });
  assert.match(byId(r.json(), 'ci_red_streak').detail, /gh is not installed/);
  assert.equal(byId(r.json(), 'phases_without_issue').state, 'outside', 'with a repo, phase 0 without an issue counts');
  r = keel(['improve', '--json'], dir, { ...ENV, KEEL_GH: await ghStub(t, { auth: false }) });
  assert.match(byId(r.json(), 'machine_prs').detail, /not authenticated/);
  await setConfig(dir, { practices: ['base', 'agents-md', 'evidence', 'lessons', 'conduct', 'ci'], local: { phases: 'Acme keeps its own roadmap' } });
  r = keel(['improve', '--json'], dir, { ...ENV, KEEL_GH: '/nonexistent/gh' });
  for (const id of ['roadmap_stale', 'phases_without_issue', 'phases_stuck']) {
    assert.equal(byId(r.json(), id).state, 'n/a', id);
    assert.match(byId(r.json(), id).detail, /local variant/, id);
    assert.ok(byId(r.json(), id).detail.length < 120, `${id}: one short line, not adopt's proposal`);
    assert.doesNotMatch(byId(r.json(), id).detail, /Acme keeps its own roadmap/, `${id}: the proposal stays in doctor`);
  }
});

test('a broken instrument is broken, exits 2, and is never a zero', async t => {
  const dir = await project(t);
  let r = keel(['improve', '--transcripts', join(dir, 'no-such-dir'), '--json'], dir);
  assert.equal(r.code, 2, r.out);
  const cost = byId(r.json(), 'conduct_cost');
  assert.equal(cost.state, 'broken');
  assert.equal(cost.value, null);
  assert.equal(r.json().proposal.id, 'conduct_cost', 'broken beats outside');
  assert.match(r.json().proposal.text, /not a zero/);

  // gh that is ready but cannot read the runs.
  await setConfig(dir, { repo: 'acme/storefront' });
  r = keel(['improve', '--json'], dir, { ...ENV, KEEL_GH: await ghStub(t, { failRuns: true }) });
  assert.equal(r.code, 2);
  assert.equal(byId(r.json(), 'ci_red_streak').state, 'broken');
  assert.match(byId(r.json(), 'ci_red_streak').detail, /404/);

  // A measure that returns no number is broken, too; and exitCode ranks broken over outside.
  const config = JSON.parse(await readFile(join(dir, '.keel', 'keel.json'), 'utf8'));
  const results = await measure({ root: dir, config, measures: [{ id: 'x', what: 'x', unit: '', bound: 0, better: 'lower', run: () => ({}) }] });
  assert.equal(results[0].state, 'broken');
  assert.equal(exitCode([{ state: 'outside' }, { state: 'broken' }]), 2);
  assert.equal(exitCode([{ state: 'ok' }, { state: 'outside' }, { state: 'n/a' }]), 1);
});

test('a failing gate is outside, and so is lessons.md without a Guard column broken', async t => {
  const dir = await project(t);
  await setConfig(dir, { check: 'node -e "process.exit(3)"' });
  await writeFile(join(dir, 'docs', 'lessons.md'), '# Lessons\n\nNo table here.\n');
  const r = keel(['improve', '--json'], dir);
  assert.equal(r.code, 2);
  assert.equal(byId(r.json(), 'gate').value, 1);
  assert.match(byId(r.json(), 'gate').detail, /exit 3/);
  assert.equal(byId(r.json(), 'lessons_without_guard').state, 'broken');
});

test('the ratchet tightens to a better value and never loosens', async t => {
  const m = [{ id: 'low', bound: 5, better: 'lower' }, { id: 'high', bound: 2, better: 'higher' }, { id: 'out', bound: 1, better: 'lower' }, { id: 'na', bound: 4, better: 'lower' }];
  const results = [{ id: 'low', state: 'ok', value: 3 }, { id: 'high', state: 'ok', value: 7 }, { id: 'out', state: 'outside', value: 9 }, { id: 'na', state: 'n/a', value: null }];
  const { bounds, tightened } = tighten(results, { low: 4 }, m);
  assert.deepEqual(bounds, { low: 3, high: 7, out: 1, na: 4 });
  assert.deepEqual(tightened, [{ id: 'low', from: 4, to: 3 }, { id: 'high', from: 2, to: 7 }]);
  // A bound that is a rule, not a level, does not ratchet: the night shift's one open PR stays allowed.
  assert.equal(tighten([{ id: 'machine_prs', state: 'ok', value: 0 }], {}).bounds.machine_prs, 1);

  // End to end: a loose project bound tightens; a worse value later stays outside it.
  const dir = await project(t);
  await writeFile(join(dir, '.keel', 'bounds.json'), JSON.stringify({ lessons_without_guard: 5 }));
  let r = keel(['improve', '--report', '--json'], dir);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.json().tightened, [{ id: 'lessons_without_guard', from: 5, to: 0 }]);
  const seeded = JSON.parse(await readFile(join(dir, '.keel', 'bounds.json'), 'utf8'));
  assert.deepEqual(Object.keys(seeded), MEASURES.map(x => x.id), 'the first report seeds every bound');
  assert.equal(seeded.lessons_without_guard, 0);
  await appendFile(join(dir, 'docs', 'lessons.md'), '| 1 | **Anvils fall.** *(acme)* | A coyote. | |\n| 2 | **Rockets leave.** *(acme)* | A canyon. | to write |\n');
  r = keel(['improve', '--report', '--json'], dir);
  assert.equal(r.code, 1);
  assert.equal(byId(r.json(), 'lessons_without_guard').state, 'outside');
  assert.deepEqual(r.json().tightened, []);
  assert.equal(JSON.parse(await readFile(join(dir, '.keel', 'bounds.json'), 'utf8')).lessons_without_guard, 0, 'never loosens');
});

test('--report writes that day\'s page and the bounds, nothing else; the one proposal is deterministic', async t => {
  const dir = await project(t);
  await setConfig(dir, { repo: 'acme/storefront' });
  // Opened today: none is stale (prs_stale), so the proposal is machine_prs.
  const prs = JSON.stringify(['keel-night/a', 'keel-night/b', 'keel-night/c', 'renovate/a', 'renovate/b'].map((headRefName, i) => ({ number: i + 1, title: headRefName, createdAt: new Date().toISOString(), headRefName })));
  const env = { ...ENV, KEEL_GH: await ghStub(t, { runs: '[{"conclusion":"failure"},{"conclusion":"success"}]', prs }) };
  await mkdir(join(dir, 'docs', 'health'));
  await writeFile(join(dir, 'docs', 'health', '2020-01-01.md'), 'an older page\n');
  // The gate's own run lands in .keel/test-runs (the test ledger's, git-ignored by itself): not improve's writing.
  const ours = new Set(['.git', 'test-runs']);
  const before = await snapshot(dir, ours);
  const r1 = keel(['improve', '--report', '--json'], dir, env);
  assert.equal(r1.code, 1, r1.out);
  const d1 = r1.json();
  // machine_prs is keel-night/ 3 against 1 (margin 2); ci 1 against 0 and phase 0 without an issue (margin 1).
  assert.deepEqual(d1.proposal, { id: 'machine_prs', state: 'outside', text: 'Drain the keel-night/ queue to its newest PR: close the 2 older ones (lesson 9).' });
  const after = await snapshot(dir, ours);
  const changed = Object.keys(after).filter(k => after[k] !== before[k]).sort();
  assert.deepEqual(changed, ['.keel/bounds.json', d1.report].sort());
  assert.equal(after['docs/health/2020-01-01.md'], 'an older page\n');
  const pageText = after[d1.report];
  assert.match(pageText, /^<!-- keel:health-report:begin [a-f0-9]{64} -->\n# Health — \d{4}-\d{2}-\d{2}/);
  assert.match(pageText, /\| `machine_prs` — .* \| 3 \| ≤ 1 \| outside \| keel\/ 0, keel-night\/ 3, keel-loop\/ 0, renovate\/ 2 \|/);
  assert.match(pageText, /## Proposal\n\n\*\*`machine_prs`\*\* \(outside\) — Drain the keel-night\/ queue/);
  assert.equal(pageText.match(/^## Proposal$/gm).length, 1);
  // The same history as the first reading: the gate's run is one more record each time (the test ledger).
  await rm(join(dir, '.keel', 'test-runs'), { recursive: true, force: true });
  const r2 = keel(['improve', '--report', '--json'], dir, env);
  assert.deepEqual(r2.json().proposal, d1.proposal);
  assert.equal(await readFile(join(dir, d1.report), 'utf8'), pageText, 'the same day overwrites its own page, identically');
  assert.equal((await readdir(join(dir, 'docs', 'health'))).length, 2);
});

test('the proposal: broken first, then the largest relative margin, ties by measure order', () => {
  const r = (id, state, value, bound, facts = {}) => ({ id, state, value, bound, better: 'lower', detail: 'd', facts });
  assert.equal(propose([r('drift', 'outside', 2, 0, { paths: ['a', 'b'] }), r('lint', 'outside', 2, 0, { lint: [{ rule: 'phase', path: 'p' }] })]).id, 'drift');
  assert.equal(propose([r('drift', 'outside', 2, 0, { paths: ['a'] }), r('machine_prs', 'outside', 5, 1, { worst: 'keel/', queues: { 'keel/': 5 } })]).id, 'machine_prs');
  assert.equal(propose([r('drift', 'outside', 9, 0, { paths: ['a'] }), r('gate', 'broken', null, 0)]).id, 'gate');
  assert.equal(propose([r('drift', 'ok', 0, 0)]), null);
  assert.equal(propose([r('phases_without_issue', 'outside', 2, 0, { ids: [3, 4] })], { repo: 'acme/x' }).text,
    'Open issues on acme/x for phases 3, 4 and set `issue:` in each one\'s front matter.');
});

test('conduct_cost reads a tiny synthetic transcript: whole runs, minutes per kind, unparseable lines counted', async t => {
  const c = await conductCost(join(FIXTURE, 'transcripts'), "node --test 'tests/*.test.mjs'");
  assert.equal(c.transcripts, 1);
  assert.equal(c.wholeRuns, 2);
  assert.equal(c.skipped, 1);
  assert.deepEqual(c.kinds, {
    'whole check': { minutes: 10, calls: 1 }, 'whole suite': { minutes: 5, calls: 1 },
    'targeted tests': { minutes: 1, calls: 1 }, reading: { minutes: 0.5, calls: 1 }, other: { minutes: 0, calls: 0 },
  });
  const empty = await scratch(t);
  await writeFile(join(empty, 'notes.output'), 'plain text, not a transcript\n');
  await assert.rejects(conductCost(empty), /no readable/);
  for (const [cmd, kind] of [
    ['cd /x && npm run check 2>&1 | tail -5', 'whole check'], ['npm test', 'whole suite'], ['node --test tests/*.test.mjs', 'whole suite'],
    ['node --test tests/improve.test.mjs tests/cli.test.mjs', 'targeted tests'], ['npm test -- tests/a.test.mjs', 'targeted tests'],
    ['grep -n x lib/a.mjs | head', 'reading'], ['node bin/keel.mjs improve', 'other'], ['make all', 'other'],
  ]) assert.equal(commandKind(cmd, 'npm run check'), kind, cmd);
  // With the project root: another directory's gate, a heredoc's text and a quoted script are not this project's whole check.
  for (const [cmd, kind] of [
    ['cd /acme && npm run check', 'whole check'], ['cd /acme && env -u NODE_TEST_CONTEXT npm test 2>&1 | tail', 'whole suite'], ['cd /acme/tests/fixtures/x && npm run check', 'other'], ['cd $S/clone && npm test', 'other'],
    ["cat > notes.md <<'EOF'\nnpm run check\nEOF", 'reading'], ["node -e 'run(\"npm test\")'", 'other'], ["node --test 'tests/*.test.mjs'", 'whole suite'],
  ]) assert.equal(commandKind(cmd, 'npm run check', '/acme'), kind, cmd);
});

test('moved away from keel: a fresh project runs its own night steps, improve --report and the drain, with no keel anywhere', async t => {
  const made = await project(t);
  const away = await realpath(await mkdtemp(join(tmpdir(), 'acme-away-')));
  t.after(() => rm(away, { recursive: true, force: true }));
  const dir = join(away, 'storefront');
  await cp(made, dir, { recursive: true, verbatimSymlinks: true }); // a link stays relative, as git would check it out
  assert.doesNotMatch(dir, /keel/i, 'no keel anywhere on its path');
  // Nothing the project runs may resolve to keel: no keel on PATH, no NODE_PATH.
  const env = { ...ENV, KEEL_GH: await ghStub(t), PATH: (process.env.PATH ?? '').split(':').filter(p => !/keel/i.test(p)).join(':') };
  delete env.NODE_PATH;
  const improve = run(process.execPath, ['scripts/keel/improve.mjs', '--report', '--json'], { cwd: dir, env });
  assert.equal(improve.status, 0, improve.stdout + improve.stderr);
  const data = JSON.parse(improve.stdout);
  assert.ok(data.report.startsWith('docs/health/'), 'the page is written');
  assert.match(await readFile(join(dir, data.report), 'utf8'), /`node scripts\/keel\/improve\.mjs --report` on Acme/);
  assert.equal(byId(data, 'gate').state, 'ok');
  assert.equal(byId(data, 'roadmap_stale').state, 'ok', 'the project\'s own scripts/roadmap.mjs');
  assert.equal(byId(data, 'drift').value, 0);
  assert.match(byId(data, 'drift').detail, /by \.keel\/lock\.json; behind is keel-side/);
  assert.match(byId(data, 'lint').detail, /keel doctor reads the rest/);
  assert.match(byId(data, 'inbox_waiting').detail, /keel only/);
  await rm(join(dir, '.keel', 'bounds.json'));
  await rm(join(dir, 'docs', 'health'), { recursive: true });
  const drain = run(process.execPath, ['scripts/keel/drain.mjs', 'keel-night/', '--json'], { cwd: dir, env });
  assert.equal(drain.status, 0, drain.stdout + drain.stderr);
  assert.deepEqual(JSON.parse(drain.stdout), { ok: true, prefix: 'keel-night/', repo: null, newest: null, actions: [] });
  const usage = run(process.execPath, ['scripts/keel/drain.mjs'], { cwd: dir, env });
  assert.equal(usage.status, 2);
  // The tree is as the project left it: the scripts wrote only what they say.
  const ours = new Set(['.git', 'test-runs']); // the gate's recorded runs (the test ledger) differ by time
  assert.deepEqual(await snapshot(dir, ours), await snapshot(made, ours));
});

test('in the project, drift and lint read its own files; from keel, the full set; a measure that needs keel is never a zero', async t => {
  const dir = await project(t);
  const env = { ...ENV, KEEL_GH: '/nonexistent/gh' };
  await appendFile(join(dir, 'scripts', 'keel', 'drain.mjs'), '// Acme was here\n');
  await writeFile(join(dir, 'CLAUDE.md'), 'Read AGENTS.md.\nAnd also\nthese\nfour lines.\n');
  await mkdir(join(dir, 'tools', 'conduct'), { recursive: true });
  await writeFile(join(dir, 'tools', 'conduct', 'SKILL.md'), '---\nname: conduct\n---\nA copy.\n');
  const local = run(process.execPath, ['scripts/keel/improve.mjs', '--json'], { cwd: dir, env });
  const mine = JSON.parse(local.stdout);
  assert.deepEqual(byId(mine, 'drift').facts.paths, ['CLAUDE.md', 'scripts/keel/drain.mjs']);
  assert.deepEqual(byId(mine, 'lint').facts.lint.map(l => l.rule).sort(), ['claude-md-pointer', 'second-copy']);
  const full = keel(['improve', '--json'], dir, env).json();
  assert.deepEqual(byId(full, 'drift').facts.paths, ['CLAUDE.md', 'scripts/keel/drain.mjs'], 'keel\'s doctor agrees on an edit');
  assert.doesNotMatch(byId(full, 'drift').detail, /keel-side/);
  assert.deepEqual(byId(full, 'lint').facts.lint.map(l => l.rule).sort(), ['claude-md-pointer', 'second-copy']);
  // No lock: drift and lint cannot be read here, and say so.
  await rm(join(dir, '.keel', 'lock.json'));
  const bare = JSON.parse(run(process.execPath, ['scripts/keel/improve.mjs', '--json'], { cwd: dir, env }).stdout);
  for (const id of ['drift', 'lint']) {
    assert.equal(byId(bare, id).state, 'n/a', id);
    assert.equal(byId(bare, id).value, null, id);
  }
  // keel itself, by its own rendered script: the inbox is read through keel's instruments, never a zero by default.
  const config = JSON.parse(await readFile(join(dir, '.keel', 'keel.json'), 'utf8'));
  const { measure: bareMeasure } = await import('../practices/night/files/scripts/keel/improve.mjs');
  const [inbox] = await bareMeasure({ root: dir, config: { ...config, keel: 'self' }, env, measures: MEASURES.filter(m => m.id === 'inbox_waiting') });
  assert.equal(inbox.state, 'n/a');
  assert.match(inbox.detail, /keel-side only/);
});
// lessons-table-split, health, the gate's env and the single measures are
// tests/improve-measures.test.mjs, so the suite runs them side by side.

test('proofs_hold: a built phase whose cited test or evidence is gone is outside; it changes no file, and the ledger half reads the gate\'s recorded run', async t => {
  const dir = await project(t);
  const zero = await readFile(join(dir, 'docs', 'phases', '00-first-thing-that-runs.md'), 'utf8');
  const phase = (evidence, cite) => zero.replace(/^---\n[\s\S]*?\n---\n/, ['---', 'status: built', 'since: 2026-10-01', 'goal: G0', 'depends: [0]', 'note: "Acme orders work."', `evidence: ${JSON.stringify(evidence)}`, '---', ''].join('\n'))
    .replace(/## Acceptance\n\n[\s\S]*?(?=## )/, `## Acceptance\n\n- [x] An anvil is ordered. \`${cite}\`\n\n`);
  await mkdir(join(dir, 'docs', 'evidence'), { recursive: true });
  await writeFile(join(dir, 'docs', 'evidence', '2026-10-01-acme-orders.md'), '# Acme orders\n\nOrdered one; it arrived.\n');
  await writeFile(join(dir, 'tests', 'acme-orders.test.mjs'), "import { test } from 'node:test';\ntest('orders', () => {});\n");
  await writeFile(join(dir, 'docs', 'phases', '01-acme-orders.md'), phase(['evidence/2026-10-01-acme-orders.md'], 'tests/acme-orders.test.mjs: "orders"'));
  // In the project, with its own scripts/roadmap.mjs, and from keel: the same reading.
  const own = () => JSON.parse(run(process.execPath, ['scripts/keel/improve.mjs', '--json'], { cwd: dir, env: ENV }).stdout);
  const home = () => keel(['improve', '--json'], dir).json();
  for (const read of [own, home]) {
    const m = byId(read(), 'proofs_hold');
    assert.equal(m.state, 'ok', m.detail);
    assert.equal(m.value, 0);
    // Each read ran the gate, and the gate's npm test recorded itself (the test ledger): "orders" passed there.
    assert.match(m.detail, /cited tests read against \d+ recorded runs?$/);
  }
  // The test deleted, and the evidence named a path that is not there.
  await rm(join(dir, 'tests', 'acme-orders.test.mjs'));
  await writeFile(join(dir, 'docs', 'phases', '01-acme-orders.md'), phase(['evidence/2026-10-01-acme-orders.md', 'evidence/2026-10-02-gone.md'], 'tests/acme-orders.test.mjs: "orders"'));
  // The gate's own runs land in .keel/test-runs (ignored by its own .gitignore): the ledger's, not this measure's.
  const files = () => snapshot(dir, new Set(['.git', 'test-runs']));
  const before = await files();
  for (const read of [own, home]) {
    const data = read();
    const m = byId(data, 'proofs_hold');
    assert.equal(m.state, 'outside', m.detail);
    assert.equal(m.value, 1);
    assert.deepEqual(m.facts.found, [{ id: 1, file: '01-acme-orders.md', missing: ['tests/acme-orders.test.mjs', 'docs/evidence/2026-10-02-gone.md'] }]);
    assert.match(m.detail, /^proof lost: phase 1 \(tests\/acme-orders\.test\.mjs, docs\/evidence\/2026-10-02-gone\.md missing\); cited tests read against/);
    assert.match(proposalText(m, {}), /re-point the reference if it moved, or step the phase back to partial with the reason\. Never write evidence/);
  }
  assert.deepEqual(await files(), before, 'proofs_hold changes no file');
  // Not built: not owed yet.
  await writeFile(join(dir, 'docs', 'phases', '01-acme-orders.md'), phase([], 'tests/acme-orders.test.mjs').replace('status: built', 'status: partial').replace('- [x]', '- [ ]'));
  assert.equal(byId(own(), 'proofs_hold').value, 0);
});

// ---- reviews_unanswered (phase 41): every review comment answered -----------

const reviewsMeasure = MEASURES.filter(m => m.id === 'reviews_unanswered');
const at = day => `${day}T09:00:00Z`;
const comment = (id, author, body, day) => ({ databaseId: id, author: { login: author }, body, createdAt: at(day), url: `https://github.com/acme/storefront/pull/1#c${id}` });
const thread = (id, comments, isResolved = false) => ({ id, isResolved, path: 'anvil.js', line: 1, comments: { nodes: comments } });
const pr = (number, state, threads, { mergedAt = null, comments = [] } = {}) => ({ number, title: `Acme ${number}`, url: `https://github.com/acme/storefront/pull/${number}`, state, mergedAt, headRefOid: 'abc1234',
  reviewThreads: { pageInfo: { hasNextPage: false }, nodes: threads }, comments: { pageInfo: { hasNextPage: false }, nodes: comments } });
const reviewsOn = async (t, open, merged = [], patch = {}) => {
  const reviews = JSON.stringify({ data: { repository: { open: { pageInfo: { hasNextPage: false }, nodes: open }, merged: { nodes: merged } } } });
  const KEEL_GH = await ghStub(t, { reviews });
  const [r] = await measure({ root: await scratch(t), config: { name: 'Acme', repo: 'acme/storefront', ...patch }, env: { ...ENV, KEEL_GH }, date: '2026-10-06', measures: reviewsMeasure });
  return r;
};

test('reviews_unanswered counts review comments with no reply, older than a day, on open and recently merged PRs', async t => {
  const r = await reviewsOn(t, [
    pr(1, 'OPEN', [
      thread('T1', [comment(1, 'acme-reviewer', 'P1: the anvil falls.', '2026-10-04')]), // unanswered, two days old: counted
      thread('T2', [comment(2, 'acme-reviewer', 'Rename it.', '2026-10-04'), comment(3, 'acme-owner', 'Fixed in abc1234.', '2026-10-05')]), // answered
      thread('T3', [comment(4, 'acme-reviewer', 'Paint it.', '2026-10-03')], true), // resolved with no reply: counted, resolving is not an answer
      thread('T4', [comment(5, 'acme-reviewer', 'Too new to owe.', '2026-10-06')]), // today: not yet
      thread('T5', [comment(6, 'acme-reviewer', 'One.', '2026-10-01'), comment(7, 'acme-reviewer', 'Two.', '2026-10-02')]), // the reviewer to itself: unanswered
    ]),
  ], [
    pr(2, 'MERGED', [thread('T6', [comment(8, 'acme-reviewer', 'Merged unread.', '2026-10-02')])], { mergedAt: at('2026-10-02') }), // merged 4 days ago: counted
    pr(3, 'MERGED', [thread('T7', [comment(9, 'acme-reviewer', 'Long ago.', '2026-09-01')])], { mergedAt: at('2026-09-01') }), // merged a month ago: not read
  ]);
  assert.equal(r.state, 'outside', JSON.stringify(r));
  assert.equal(r.value, 4);
  assert.equal(r.bound, 0);
  assert.deepEqual(r.facts.prs.map(p => [p.number, p.state, p.unanswered]), [[1, 'open', 3], [2, 'merged', 1]]);
  assert.match(r.detail, /^#1 3 \(open, since 2026-10-01\), #2 1 \(merged, since 2026-10-02\)$/);
  assert.match(propose([r]).text, /^Answer the review comments on #1, #2: read them \(`keel review acme\/storefront#1`\), validate each against the code, then answer it fixed, tracked or not valid/);
  // A named reviewer's conversation comment counts, until someone else answers it: quoting, linking or naming it.
  const conv = { id: 'IC_1', ...comment(10, 'acme-reviewer', 'Codex: one finding.', '2026-10-04') };
  const named = { review: { reviewers: ['acme-reviewer[bot]'] } };
  assert.equal((await reviewsOn(t, [pr(4, 'OPEN', [], { comments: [conv] })], [], named)).value, 1);
  assert.equal((await reviewsOn(t, [pr(4, 'OPEN', [], { comments: [conv, { id: 'IC_2', ...comment(11, 'acme-owner', 'Merging.', '2026-10-05') }] })], [], named)).value, 1, 'an unrelated later comment is not an answer');
  assert.equal((await reviewsOn(t, [pr(4, 'OPEN', [], { comments: [conv, { id: 'IC_2', ...comment(11, 'acme-owner', '> Codex: one finding.\n\nFixed in abc1234.', '2026-10-05') }] })], [], named)).value, 0);
  // A thread the reviewer followed up in after the reply: counted again.
  const followed = thread('T8', [comment(12, 'acme-reviewer', 'Lid.', '2026-10-01'), comment(13, 'acme-owner', 'Fixed.', '2026-10-02'), comment(14, 'acme-reviewer', 'Still loose.', '2026-10-03')]);
  assert.equal((await reviewsOn(t, [pr(5, 'OPEN', [followed])])).value, 1);
  // A review's top-level body is owed an answer too, reviewer named or not.
  const body = { id: 'PRR_1', databaseId: 15, author: { login: 'acme-reviewer' }, body: 'Acme Review: the crate has no lid.', state: 'COMMENTED', submittedAt: at('2026-10-04'), url: 'https://github.com/acme/storefront/pull/6#pullrequestreview-15' };
  assert.equal((await reviewsOn(t, [{ ...pr(6, 'OPEN', []), reviews: { pageInfo: { hasNextPage: false }, nodes: [body] } }])).value, 1);
  assert.equal((await reviewsOn(t, [pr(4, 'OPEN', [], { comments: [conv] })])).value, 0, 'no reviewer named: conversation comments are not counted');
  // None left: ok, and it says what it read; no ratchet.
  const ok = await reviewsOn(t, [pr(1, 'OPEN', [])]);
  assert.deepEqual([ok.state, ok.value], ['ok', 0]);
  assert.match(ok.detail, /^none on 1 open PR and 0 merged in 7 days$/);
  assert.equal(reviewsMeasure[0].ratchet, false);
});

const page = (open, { more = false, cursor = null, merged = [], mergedMore = false } = {}) => JSON.stringify({ data: { repository: {
  open: { pageInfo: { hasNextPage: more, endCursor: cursor }, nodes: open }, merged: { pageInfo: { hasNextPage: mergedMore, endCursor: mergedMore ? 'm1' : null }, nodes: merged } } } });
const counted = (n, day = '2026-10-04') => pr(n, 'OPEN', [thread(`T${n}`, [comment(n, 'acme-reviewer', `Finding ${n}.`, day)])]);

test('reviews_unanswered reads every page of open PRs, and is n/a when pages are left unread, never a number', async t => {
  const read = async reviews => {
    const KEEL_GH = await ghStub(t, { reviews });
    const [r] = await measure({ root: await scratch(t), config: { name: 'Acme', repo: 'acme/storefront' }, env: { ...ENV, KEEL_GH }, date: '2026-10-06', measures: reviewsMeasure });
    const calls = (await readFile(`${KEEL_GH}.log`, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    return { r, calls };
  };
  // Two pages: the second asked for by its cursor, and only for open PRs; both counted.
  let { r, calls } = await read([page([counted(1)], { more: true, cursor: 'o1' }), page([counted(2)])]);
  assert.deepEqual([r.state, r.value], ['outside', 2], JSON.stringify(r));
  assert.deepEqual(r.facts.prs.map(p => p.number), [1, 2]);
  assert.deepEqual(calls.map(c => c.filter(x => /^(open|merged|openAfter|mergedAfter)=/.test(x))), [['open=true', 'merged=true'], ['open=true', 'merged=false', 'openAfter=o1']]);
  // Merged PRs updated before the window: no need to read on.
  ({ r } = await read([page([], { merged: [{ ...counted(3), state: 'MERGED', mergedAt: at('2026-09-01'), updatedAt: at('2026-09-01') }], mergedMore: true })]));
  assert.deepEqual([r.state, r.value], ['ok', 0]);
  // Every page says there is another: n/a after REVIEW_PAGES, never the count so far.
  ({ r, calls } = await read([page([counted(1)], { more: true, cursor: 'o1' })]));
  assert.deepEqual([r.state, r.value], ['n/a', null], JSON.stringify(r));
  const { REVIEW_PAGES } = await import('../practices/night/files/scripts/keel/improve.mjs');
  assert.match(r.detail, new RegExp(`more than ${REVIEW_PAGES} open pull requests; the read is incomplete`));
  assert.equal(calls.length, REVIEW_PAGES);
  // Recently merged PRs left unread: n/a too.
  ({ r } = await read([page([], { merged: [{ ...counted(4), state: 'MERGED', mergedAt: at('2026-10-05'), updatedAt: at('2026-10-05') }], mergedMore: true })]));
  assert.deepEqual([r.state, r.value], ['n/a', null], JSON.stringify(r));
});

test('reviews_unanswered reads alone, with the full fragment, a PR whose thread is longer than the window, and counts it as the full read does', async t => {
  // Five comments: the window (the newest four) cannot say whose the thread is.
  const five = [comment(1, 'acme-reviewer', 'Lid.', '2026-10-01'), comment(2, 'acme-owner', 'Fixed.', '2026-10-02'), comment(3, 'acme-reviewer', 'Still loose.', '2026-10-03'),
    comment(4, 'acme-reviewer', 'Really.', '2026-10-03'), comment(5, 'acme-reviewer', 'Truly.', '2026-10-04')];
  const full = pr(1, 'OPEN', [thread('T1', five)]);
  const win = { ...full, keelWindow: 'PullRequest', reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [{ id: 'T1', isResolved: false, path: 'anvil.js', line: 1, tail: { totalCount: 5, nodes: five.slice(-4) } }] },
    comments: { pageInfo: { hasPreviousPage: false }, nodes: [] }, reviews: { pageInfo: { hasPreviousPage: false }, nodes: [] } };
  const KEEL_GH = await ghStub(t, { reviews: [page([win]), JSON.stringify({ data: { repository: { pullRequest: full } } })] });
  const [r] = await measure({ root: await scratch(t), config: { name: 'Acme', repo: 'acme/storefront' }, env: { ...ENV, KEEL_GH }, date: '2026-10-06', measures: reviewsMeasure });
  assert.deepEqual([r.state, r.value], ['outside', 1], JSON.stringify(r));
  assert.deepEqual(r.facts.prs, [{ number: 1, state: 'open', url: 'https://github.com/acme/storefront/pull/1', author: null, unanswered: 1, oldest: '2026-10-03' }]);
  const calls = (await readFile(`${KEEL_GH}.log`, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes('number=1'), 'the second read is that PR alone');
});

test('reviews_unanswered is n/a when GitHub cannot be read, broken when the read fails, never a zero', async t => {
  const config = { name: 'Acme', repo: 'acme/storefront' };
  const dir = await scratch(t);
  const read = async (env, c = config) => (await measure({ root: dir, config: c, env: { ...ENV, ...env }, date: '2026-10-06', measures: reviewsMeasure }))[0];
  let r = await read({ KEEL_GH: '/nonexistent/gh' });
  assert.deepEqual([r.state, r.value], ['n/a', null]);
  assert.match(r.detail, /gh is not installed/);
  r = await read({ KEEL_GH: await ghStub(t, { auth: false }) });
  assert.equal(r.state, 'n/a');
  assert.match(r.detail, /not authenticated/);
  r = await read({}, { name: 'Acme' });
  assert.match(r.detail, /no repo/);
  // Ready but the read fails, or comes back without the repository: broken.
  for (const reviews of ['not json', JSON.stringify({ data: { repository: null } })]) {
    r = await read({ KEEL_GH: await ghStub(t, { reviews }) });
    assert.equal(r.state, 'broken', reviews);
    assert.equal(r.value, null);
  }
  // Incomplete: more threads, or more comments in a thread, than one page: n/a, never a count.
  const long = thread('T1', [comment(1, 'acme-reviewer', 'One.', '2026-10-01'), comment(2, 'acme-owner', 'Two.', '2026-10-02')]);
  for (const open of [[{ ...pr(1, 'OPEN', []), reviewThreads: { pageInfo: { hasNextPage: true }, nodes: [] } }], [pr(1, 'OPEN', [{ ...long, comments: { pageInfo: { hasNextPage: true }, nodes: long.comments.nodes } }])]]) {
    r = await read({ KEEL_GH: await ghStub(t, { reviews: page(open) }) });
    assert.deepEqual([r.state, r.value], ['n/a', null], JSON.stringify(r));
    assert.match(r.detail, /the read is incomplete/);
  }
  r = await read({ KEEL_GH: await ghStub(t) }, { ...config, review: { reviewers: 'acme-reviewer' } });
  assert.equal(r.state, 'broken', 'a bad "review" config is a broken instrument');
});

// ---- cross_review_valid (phase 42): is the cross-review worth answering? -----

test('cross_review_valid: the share of Claude\'s cross-review comments answered valid among those answered, on crossReview branches; n/a below ten; one read with reviews_unanswered', async t => {
  const { CROSS_REVIEW_VALID, CROSS_REVIEW_ANSWERS, crossReviewTally } = await import('../practices/night/files/scripts/keel/improve.mjs');
  const { replyText } = await import('../lib/review.mjs');
  // The forms are keel review --close's replies, exactly.
  for (const [kind, value, as] of [['fixed', 'abc1234', 'fixed'], ['tracked', '#57', 'tracked'], ['not-valid', 'the lid is checked in anvil.js', 'notValid']]) {
    assert.deepEqual(CROSS_REVIEW_ANSWERS.filter(([, re]) => re.test(replyText({ kind, value }))).map(([k]) => k), [as], kind);
  }
  const answer = { fixed: '**Fixed** in abc1234. Validated against the code first.', tracked: '**Valid, tracked** in #57. Left open until the fix lands.', notValid: '**Not valid:** the lid is checked in anvil.js' };
  let id = 100;
  const finding = (reply, { by = 'claude', day = '2026-10-04' } = {}) => thread(`T${++id}`, [comment(id, by, `P2: the lid opens (${id}).`, day), ...(reply ? [comment(++id, 'acme-owner', reply, '2026-10-05')] : [])]);
  const codexPr = (number, threads, over = {}) => ({ ...pr(number, 'OPEN', threads), headRefName: 'codex/anvil-lid', ...over });
  const ten = [...Array(6)].map(() => finding(answer.fixed)).concat([finding(answer.tracked), finding(answer.notValid), finding(answer.notValid), finding(answer.notValid)]);
  const open = [
    codexPr(1, ten.slice(0, 5)),
    codexPr(2, [...ten.slice(5), finding(null), finding('Thanks, will look.'), finding(answer.notValid, { by: 'codex' })]), // unanswered, free text, and someone else's thread
    { ...pr(3, 'OPEN', [finding(answer.notValid)]), headRefName: 'claude/lid' }, // not a cross-review branch
  ];
  const merged = [codexPr(4, [finding(answer.notValid)], { state: 'MERGED', mergedAt: at('2026-09-01'), updatedAt: at('2026-09-01') })]; // merged before the window
  const repository = { open: { pageInfo: { hasNextPage: false }, nodes: open }, merged: { pageInfo: { hasNextPage: false }, nodes: merged } };
  assert.deepEqual(crossReviewTally(repository, { prefixes: ['codex/'], date: '2026-10-06' }), { prs: 2, comments: 12, fixed: 6, tracked: 1, valid: 7, notValid: 3, unanswered: 2 });
  // A reviewer's own follow-up is not an answer; the first answer in keel's form decides.
  const followed = thread('TF', [comment(1, 'claude[bot]', 'P1: the anvil falls.', '2026-10-04'), comment(2, 'claude[bot]', 'Still falls.', '2026-10-04'), comment(3, 'acme-owner', answer.notValid, '2026-10-05'), comment(4, 'acme-owner', answer.fixed, '2026-10-05')]);
  assert.deepEqual(crossReviewTally({ open: { nodes: [codexPr(5, [followed])] }, merged: { nodes: [] } }, { prefixes: ['codex/'], date: '2026-10-06' }), { prs: 1, comments: 1, fixed: 0, tracked: 0, valid: 0, notValid: 1, unanswered: 0 });
  // Phase 45: keel's own step posts the findings, as the workflow's bot, each opening with the marker; its other comments are not findings.
  const { CROSS_REVIEW_FINDING } = await import('../practices/night/files/scripts/keel/improve.mjs');
  const posted = (body, reply) => thread(`T${++id}`, [comment(id, 'github-actions', body, '2026-10-04'), ...(reply ? [comment(++id, 'acme-owner', reply, '2026-10-05')] : [])]);
  const keelPosted = codexPr(6, [posted(`${CROSS_REVIEW_FINDING}\n**P2** the lid opens.`, answer.fixed), posted(`${CROSS_REVIEW_FINDING}\n**P1** the anvil falls.`, answer.notValid), posted(`${CROSS_REVIEW_FINDING}\n**P3** a name.`, null), posted('Deploy preview ready.', answer.fixed)]);
  assert.deepEqual(crossReviewTally({ open: { nodes: [keelPosted, codexPr(7, [finding(answer.tracked)])] }, merged: { nodes: [] } }, { prefixes: ['codex/'], date: '2026-10-06' }), { prs: 2, comments: 4, fixed: 1, tracked: 1, valid: 2, notValid: 1, unanswered: 1 });

  // As a measure: 7 of 10 answered valid is 70%, recorded with no bound; reviews_unanswered reads the same pages, once.
  const reviews = JSON.stringify({ data: { repository } });
  const KEEL_GH = await ghStub(t, { reviews });
  const config = { name: 'Acme', repo: 'acme/storefront', crossReview: { for: ['codex/'] } };
  const both = MEASURES.filter(m => m.id === 'reviews_unanswered').concat([CROSS_REVIEW_VALID]);
  const [unanswered, r] = await measure({ root: await scratch(t), config, env: { ...ENV, KEEL_GH }, date: '2026-10-06', measures: both });
  assert.equal(unanswered.id, 'reviews_unanswered');
  assert.deepEqual([r.state, r.value, r.bound, r.unit], ['ok', 70, null, '%'], JSON.stringify(r));
  assert.match(r.detail, /^7 of 10 answered valid \(fixed 6, tracked 1\), 3 not valid; 2 not answered in keel's form; 12 comments on 2 PRs$/);
  assert.equal((await readFile(`${KEEL_GH}.log`, 'utf8')).trim().split('\n').length, 1, 'one read for both measures');
  assert.equal(CROSS_REVIEW_VALID.ratchet, false);
  // Below ten answered: n/a, saying how many; off: n/a; a read left incomplete: n/a, never a share.
  const nine = { ...repository, open: { ...repository.open, nodes: [codexPr(1, ten.slice(0, 9))] } };
  const one = async (repo, c = config) => (await measure({ root: await scratch(t), config: c, env: { ...ENV, KEEL_GH: await ghStub(t, { reviews: JSON.stringify({ data: { repository: repo } }) }) }, date: '2026-10-06', measures: [CROSS_REVIEW_VALID] }))[0];
  const few = await one(nine);
  assert.deepEqual([few.state, few.value], ['n/a', null]);
  assert.match(few.detail, /^7 of 9 answered valid .*: the share waits for 10 answered$/);
  assert.match((await one(repository, { name: 'Acme', repo: 'acme/storefront' })).detail, /cross-review is off/);
  const more = await one({ ...repository, open: { pageInfo: { hasNextPage: true, endCursor: 'o1' }, nodes: open } });
  assert.deepEqual([more.state, more.value], ['n/a', null]);
  assert.match(more.detail, /the read is incomplete/);
  assert.equal((await one(repository, { ...config, crossReview: { for: [] } })).state, 'broken', 'a bad config is a broken instrument');
});
