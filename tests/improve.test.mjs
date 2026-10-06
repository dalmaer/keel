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
  const before = await snapshot(dir);
  const r1 = keel(['improve', '--report', '--json'], dir, env);
  assert.equal(r1.code, 1, r1.out);
  const d1 = r1.json();
  // machine_prs is keel-night/ 3 against 1 (margin 2); ci 1 against 0 and phase 0 without an issue (margin 1).
  assert.deepEqual(d1.proposal, { id: 'machine_prs', state: 'outside', text: 'Drain the keel-night/ queue to its newest PR: close the 2 older ones (lesson 9).' });
  const after = await snapshot(dir);
  const changed = Object.keys(after).filter(k => after[k] !== before[k]).sort();
  assert.deepEqual(changed, ['.keel/bounds.json', d1.report].sort());
  assert.equal(after['docs/health/2020-01-01.md'], 'an older page\n');
  const pageText = after[d1.report];
  assert.match(pageText, /^# Health — \d{4}-\d{2}-\d{2}/);
  assert.match(pageText, /\| `machine_prs` — .* \| 3 \| ≤ 1 \| outside \| keel\/ 0, keel-night\/ 3, keel-loop\/ 0, renovate\/ 2 \|/);
  assert.match(pageText, /## Proposal\n\n\*\*`machine_prs`\*\* \(outside\) — Drain the keel-night\/ queue/);
  assert.equal(pageText.match(/^## Proposal$/gm).length, 1);
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
  assert.deepEqual(await snapshot(dir), await snapshot(made));
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

test('proofs_hold: a built phase whose cited test or evidence is gone is outside; it changes no file, and the ledger half says n/a', async t => {
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
    assert.match(m.detail, /ledger half .* is n\/a until phase 33/);
  }
  // The test deleted, and the evidence named a path that is not there.
  await rm(join(dir, 'tests', 'acme-orders.test.mjs'));
  await writeFile(join(dir, 'docs', 'phases', '01-acme-orders.md'), phase(['evidence/2026-10-01-acme-orders.md', 'evidence/2026-10-02-gone.md'], 'tests/acme-orders.test.mjs: "orders"'));
  const before = await snapshot(dir);
  for (const read of [own, home]) {
    const data = read();
    const m = byId(data, 'proofs_hold');
    assert.equal(m.state, 'outside', m.detail);
    assert.equal(m.value, 1);
    assert.deepEqual(m.facts.found, [{ id: 1, file: '01-acme-orders.md', missing: ['tests/acme-orders.test.mjs', 'docs/evidence/2026-10-02-gone.md'] }]);
    assert.match(m.detail, /^proof lost: phase 1 \(tests\/acme-orders\.test\.mjs, docs\/evidence\/2026-10-02-gone\.md missing\); the ledger half .* n\/a/);
    assert.match(proposalText(m, {}), /re-point the reference if it moved, or step the phase back to partial with the reason\. Never write evidence/);
  }
  assert.deepEqual(await snapshot(dir), before, 'proofs_hold changes no file');
  // Not built: not owed yet.
  await writeFile(join(dir, 'docs', 'phases', '01-acme-orders.md'), phase([], 'tests/acme-orders.test.mjs').replace('status: built', 'status: partial').replace('- [x]', '- [ ]'));
  assert.equal(byId(own(), 'proofs_hold').value, 0);
});
