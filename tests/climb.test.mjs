// The climb practice's script, scripts/keel/climb.mjs (phase 35), run where a
// project has it: beside the night's lib.mjs, test-ledger.mjs and pr-body.mjs,
// in a synthetic Acme repo whose "suite" says how long it took through
// KEEL_CLIMB_CLOCK and waits no real time, so compare's keep and revert are
// decided by the fixture, never the machine (phase 55: these tests once slept
// 1500 ms a run and still failed on a busy runner). They are pinned to stalls
// in .keel/keel.json, so a wall-clock wait that creeps back fails the gate.
// gh is a stub (KEEL_GH); nothing here reads the live world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, cp, realpath, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from './helpers/run.mjs';
import { runBlocks } from './helpers/workflows.mjs';
import { git, commit, acme, climb, json, load, TIMED, suite, NIGHT, write, stubGh, page, step, setConfig } from './helpers/climb.mjs';

/**
 * A "suite" that took `ms` by the clock compare reads here (KEEL_CLIMB_CLOCK:
 * it writes its time there) and waits no real time; `tag` keeps two equal
 * suites different commits. Without the clock, it is a real run of node.
 */
const clocked = (ms, tag = '') => `// acme suite ${tag}\nimport { writeFileSync } from 'node:fs';\nif (process.env.KEEL_CLIMB_CLOCK) writeFileSync(process.env.KEEL_CLIMB_CLOCK, '${ms}');\n`;

/** The clock file the Acme suite writes its time to, beside the repo; removed after. */
const clockOf = (t, dir) => {
  const file = join(dir, '..', `${dir.split('/').pop()}-clock`);
  t.after(() => rm(file, { force: true }));
  return { KEEL_CLIMB_CLOCK: file };
};

test('compare: keep for a real gain, revert for one inside the noise, and two alternated rounds, not one', async t => {
  // Times are the suite's own (KEEL_CLIMB_CLOCK), not the wall clock: a base of 1500 ms once lost to a busy
  // runner's noise (9734581), and sleeping longer only made every run pay. Phase 55 gave climb its clock.
  const dir = await acme(t, { climb: TIMED, files: { 't.mjs': clocked(1500) } });
  const clock = clockOf(t, dir);
  const base = git(dir, ['rev-parse', 'HEAD']);
  const fast = await commit(dir, { 't.mjs': clocked(10, 'fast') }, 'acme: a faster suite');
  git(dir, ['checkout', '-q', '-b', 'noise', base]);
  const noise = await commit(dir, { 't.mjs': clocked(1400, 'noise') }, 'acme: the same suite');
  // Fast in round 1 (base first, then its first two runs), slow in round 2 (it goes first).
  git(dir, ['checkout', '-q', '-b', 'lucky', base]);
  const counter = join(dir, '..', `${dir.split('/').pop()}-count`);
  t.after(() => rm(counter, { force: true }));
  const lucky = await commit(dir, { 't.mjs': `import { readFileSync, writeFileSync } from 'node:fs';\nlet n = 0;\ntry { n = Number(readFileSync(process.env.ACME_COUNT, 'utf8')); } catch {}\nwriteFileSync(process.env.ACME_COUNT, String(n + 1));\nwriteFileSync(process.env.KEEL_CLIMB_CLOCK, String(n < 2 ? 10 : 2600));\n` }, 'acme: fast once');
  // Each compare's rounds go to the run's diagnostics, so a red run shows its numbers.
  const cmp = (candidate, env = {}) => {
    const r = json(climb(dir, ['compare', '--base', base, '--candidate', candidate, '--runs', '2', '--json'], { ...clock, ...env }));
    t.diagnostic(`${candidate.slice(0, 7)} ${r.verdict}: ${(r.rounds ?? []).map(x => `${Math.round(x.base)}→${Math.round(x.candidate)} ms`).join(', ')}`);
    return r;
  };

  const keep = cmp(fast);
  assert.equal(keep.verdict, 'keep', keep.why);
  assert.equal(keep.rounds.length, 2);
  assert.ok(keep.rounds.every(r => r.change <= -0.3), JSON.stringify(keep.rounds));
  assert.match(keep.why, /beat the base by 30% or more in all 2 rounds/);
  const same = cmp(noise);
  assert.equal(same.verdict, 'revert', same.why);
  assert.match(same.why, /inside the 30% margin/);
  // One round would have kept it; the second round, run in the other order, does not.
  const once = cmp(lucky, { ACME_COUNT: counter });
  assert.equal(once.rounds.length, 2);
  assert.ok(once.rounds[0].change <= -0.3, `round 1 is the lucky one: ${JSON.stringify(once.rounds)}`);
  assert.equal(once.verdict, 'revert', `a gain in one round only is noise: ${once.why}`);
  assert.match(once.why, /^round 2:/);
  // A single round is refused outright, and no worktree is left behind.
  const one = climb(dir, ['compare', '--base', base, '--candidate', fast, '--rounds', '1', '--json'], clock);
  assert.equal(one.status, 2);
  assert.match(json(one).error, /two alternated rounds or more/);
  assert.equal(git(dir, ['worktree', 'list']).split('\n').length, 1, 'compare removes its worktrees');
  // A suite that fails has no time: exit 2, never a number.
  const broken = await commit(dir, { 't.mjs': 'process.exit(3);\n' }, 'acme: broken');
  const b = climb(dir, ['compare', '--base', base, '--candidate', broken, '--runs', '1', '--json'], clock);
  assert.equal(b.status, 2);
  assert.match(json(b).error, /failed \(exit 3\).*a failing suite has no time/);
  // Nor does one that says no time when the clock asks for it: never a wall-clock number in its place.
  const silent = await commit(dir, { 't.mjs': '// acme: says nothing\n' }, 'acme: silent');
  const s = climb(dir, ['compare', '--base', base, '--candidate', silent, '--runs', '1', '--json'], clock);
  assert.equal(s.status, 2);
  assert.match(json(s).error, /wrote no time to KEEL_CLIMB_CLOCK/);
});

test('compare --decide, revert, settle and report: the numbers go in the commit, a miss resets, and the PR body says it all', async t => {
  const dir = await acme(t, { climb: TIMED, files: { 't.mjs': clocked(1500), 'package.json': '{ "name": "acme", "files": ["lib/"] }\n' } });
  const clock = clockOf(t, dir);
  const base = git(dir, ['rev-parse', 'HEAD']);
  const m = await load(dir);
  // The baseline is a real run, timed by the wall clock: a number, never judged.
  const baseline = json(climb(dir, ['measure', 'test-time', '--baseline', '--runs', '1', '--json']));
  assert.equal(baseline.times.length, 1);
  assert.ok(baseline.times[0] > 0, JSON.stringify(baseline));
  const night = () => readFile(join(dir, '.keel/climb/night.json'), 'utf8').then(JSON.parse);
  assert.equal((await night()).base, base);
  assert.equal(git(dir, ['status', '--porcelain']), '', 'the night\'s record ignores itself');

  await commit(dir, { 't.mjs': clocked(10, 'fast') }, 'acme: share one fixture');
  const kept = json(climb(dir, ['compare', '--decide', '--runs', '1', '--json'], clock));
  assert.equal(kept.verdict, 'keep', kept.why);
  const message = git(dir, ['log', '-1', '--format=%B']);
  assert.match(message, /^acme: share one fixture\n\nclimb test-time: \d+ ms → \d+ ms \(−[\d.]+%\); \d+ ms → \d+ ms \(−[\d.]+%\); margin 30%, base [0-9a-f]{7}$/);
  const keptSha = git(dir, ['rev-parse', 'HEAD']);
  assert.equal(kept.head, keptSha);

  await commit(dir, { 't.mjs': clocked(100, 'slower') }, 'acme: nothing really');
  const missed = json(climb(dir, ['compare', '--decide', '--runs', '1', '--json'], clock));
  assert.equal(missed.verdict, 'revert');
  assert.equal(git(dir, ['rev-parse', 'HEAD']), keptSha, 'a revert resets to the base');

  await commit(dir, { 'lib/acme.mjs': 'export const x = 1;\n' }, 'acme: breaks the gate');
  const r = json(climb(dir, ['revert', '--why', 'the gate failed: acme.test.mjs', '--json']));
  assert.equal(r.head, keptSha);
  assert.equal(r.stop, null, 'a keep, then two misses: not yet three in a row');
  const tried = (await night()).tried.map(a => a.verdict);
  assert.deepEqual(tried, ['keep', 'revert', 'revert']);
  assert.equal(m.stopping({ attempts: 10, tried: [{ verdict: 'revert' }, { verdict: 'revert' }, { verdict: 'revert' }] }), '3 misses in a row');
  assert.equal(m.stopping({ attempts: 2, tried: [{ verdict: 'keep' }, { verdict: 'revert' }] }), 'the attempt limit (2) is reached');
  assert.equal(m.stopping({ attempts: 10, tried: [{ verdict: 'revert' }, { verdict: 'keep' }, { verdict: 'revert' }] }), null);
  // A kept change is never reverted by hand.
  assert.equal(climb(dir, ['revert', '--why', 'x', '--json']).status, 2);

  // Undecided work when the box closes: settle drops it, back to the last kept change.
  await commit(dir, { 't.mjs': clocked(5, 'late') }, 'acme: undecided');
  await writeFile(join(dir, 'scratch.txt'), 'half-made\n');
  assert.equal(json(climb(dir, ['settle', '--json'])).head, keptSha);
  assert.equal(git(dir, ['rev-parse', 'HEAD']), keptSha);
  assert.equal(git(dir, ['status', '--porcelain']), '');

  const final = json(climb(dir, ['compare', '--final', '--runs', '1', '--json'], clock));
  assert.equal(final.base, base);
  const rep = climb(dir, ['report', '--state', '--body', join(dir, '..', `${dir.split('/').pop()}-body.md`), '--json']);
  t.after(() => rm(join(dir, '..', `${dir.split('/').pop()}-body.md`), { force: true }));
  assert.equal(rep.status, 0, rep.stderr);
  const out = json(rep);
  assert.equal(out.kept, 1);
  assert.match(out.line, /^climb test-time \d{4}-\d{2}-\d{2}: kept 1 of 3 tried; `node t\.mjs` \d+ ms → \d+ ms \(−[\d.]+%\); \d+ min$/);
  const body = await readFile(out.body, 'utf8');
  const at = ['## Summary', '## Evidence', '## Merge danger', '## Notes'].map(h => body.indexOf(`${h}\n`));
  assert.ok(at[0] === 0 && at.every((x, i) => i === 0 || x > at[i - 1]), body);
  assert.match(body, /^\| Number \| Before \| After \| Change \|$/m);
  assert.match(body, /^\| `node t\.mjs` wall time, median \(the night's base against its last commit, 2 alternated rounds\) \| \d+ ms \| \d+ ms \| −[\d.]+% \|$/m);
  assert.match(body, /^Gate: not run: guard did not record a gate line$/m, 'guard never ran here: the body says so, it does not invent a gate');
  assert.match(body, /^\| acme: share one fixture \([0-9a-f]{7}\) \| \d+ ms, \d+ ms \| \d+ ms, \d+ ms \(−[\d.]+%, −[\d.]+%\) \|$/m);
  assert.match(body, /^- acme: nothing really: round 1: .*inside the 30% margin/m);
  assert.match(body, /^- acme: breaks the gate: the gate failed: acme\.test\.mjs$/m);
  assert.match(body, /^Two-way door: code changes only/m);
  assert.match(body, /^Blast radius: this repo's files only\.$/m);
  assert.match(body, /never the agent's own timing/);
  assert.deepEqual(JSON.parse(await readFile(join(dir, '.keel/climb.json'), 'utf8')).last.job, 'test-time');

  // The danger names a surface only when a shipped file changed; nothing kept is a line, no body.
  assert.deepEqual(m.surfacesOf(['tests/a.test.mjs'], { files: ['lib/'] }), []);
  assert.deepEqual(m.surfacesOf(['lib/a.mjs', '.github/workflows/check.yml'], { files: ['lib/'] }).sort(), ['published package', 'workflow shell']);
  const nothing = m.reportOf({ job: 'test-time', date: '2026-10-06', started: '2026-10-06T09:41:00Z', margin: 0.05, tried: [{ what: 'a', verdict: 'revert', why: 'round 1: −1%' }, { what: 'b', verdict: 'revert', why: 'round 2: +2%' }] }, { now: new Date('2026-10-06T10:20:00Z') });
  assert.equal(nothing.input, null);
  assert.equal(nothing.line, 'climb test-time 2026-10-06: kept nothing; 2 tried, none beat the noise (margin 5%); 39 min');
});

// ---- phase 76: the night builds what the plan names, and only that ---------------

/** A plan item as the design has it: a build in climb's lane, its number named first. */
const planItem = (id, lane, over = {}) => ({ id, title: `Acme ${id}`, kind: 'build', source: 'owner', number: { measure: 'slow_tests', bound: 0, better: 'lower' }, lane, budget: null, status: 'planned', result: null, ...over });
const acmePlan = (items, over = {}) => ({ schema: 1, date: '2026-10-06', shapedBy: 'owner', readyBy: null, willNotTouch: [], settledToday: [], leftOpen: [], items, ...over });

/** Tonight's plan as the workflow fetched it, beside the repo (never in it); returns its path. */
async function planFile(t, dir, plan, name = 'plan') {
  const file = join(dir, '..', `${dir.split('/').pop()}-${name}.json`);
  t.after(() => rm(file, { force: true }));
  await writeFile(file, JSON.stringify(plan));
  return file;
}

/** An Acme repo with the night's plan module beside climb.mjs (climb requires night), and slow_tests outside. */
async function plannedAcme(t, climbConfig = { jobs: ['test-time', 'build-time'], build: 'node -e ""', buildOutput: 'dist' }) {
  const dir = await acme(t, { climb: climbConfig, files: { 'docs/health/2026-10-05.md': page([['slow_tests', 3, '≤ 0', 'outside']]) } });
  await cp(join(NIGHT, 'night-plan.mjs'), join(dir, 'scripts/keel/night-plan.mjs'));
  return dir;
}

test('with a plan, pick runs the plan\'s climb item and nothing else; with no climb item it runs nothing; without a plan it picks as before', async t => {
  const dir = await plannedAcme(t);
  const gh = await stubGh(t, []);
  const open = await stubGh(t, ['keel-climb/test-time/2026-10-04']);
  const pickWith = (args = [], stub = gh) => {
    const r = climb(dir, ['pick', '--date', '2026-10-06', ...args, '--json'], { KEEL_GH: stub });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    return json(r);
  };
  // Without a plan: the health page's worst measure, as before (test-time, for slow_tests).
  const before = pickWith();
  assert.deepEqual([before.job, before.by, before.plan], ['test-time', 'measure', undefined]);
  // The plan names build-time: that, not the health page's choice. (Mutation: pick ignoring --plan runs test-time.)
  const named = pickWith(['--plan', await planFile(t, dir, acmePlan([planItem('measure-it', 'night', { kind: 'measure', number: null }), planItem('faster-build', 'climb:build-time')]))]);
  assert.deepEqual([named.job, named.by, named.branch], ['build-time', 'plan', 'keel-climb/build-time/2026-10-06']);
  assert.match(named.why, /tonight's plan names it: faster-build, Acme faster-build/);
  assert.deepEqual(named.plan, { used: true, date: '2026-10-06', shapedBy: 'owner', item: 'faster-build', skipped: [], willNotTouch: [] });
  // Only the first climb item that may run: one not in "climb".jobs, or waiting on its open PR, is skipped, saying why.
  const second = pickWith(['--plan', await planFile(t, dir, acmePlan([planItem('perf-x', 'climb:perf'), planItem('tests-x', 'climb:test-time'), planItem('build-x', 'climb:build-time'), planItem('build-y', 'climb:build-time')]))], open);
  assert.deepEqual([second.job, second.plan.item], ['build-time', 'build-x']);
  assert.deepEqual(second.plan.skipped.map(s => s.id), ['perf-x', 'tests-x', 'build-y']);
  assert.match(second.plan.skipped[0].note, /perf is not a job "climb"\.jobs names \(test-time, build-time\)/);
  assert.match(second.plan.skipped[1].note, /test-time waits for its open keel-climb\/test-time\/ PR/);
  assert.match(second.plan.skipped[2].note, /climb runs one job a night, and tonight's plan named build-x first/);
  // A plan with no climb item: climb does not run tonight, green, saying so. (Mutation: falling back to choose runs test-time.)
  const robotOnly = await planFile(t, dir, acmePlan([planItem('robot-7', 'robot:#7')]));
  const none = climb(dir, ['pick', '--date', '2026-10-06', '--plan', robotOnly], { KEEL_GH: gh });
  assert.equal(none.status, 0, none.stderr);
  assert.match(none.stdout, /^no climb tonight: tonight's plan \(2026-10-06\) names no climb item, so climb does not run tonight$/m);
  const noneJson = pickWith(['--plan', robotOnly]);
  assert.deepEqual([noneJson.job, noneJson.plan.item, noneJson.plan.skipped], [null, null, []]);
  // Its only climb item done already, or a triage item in climb's lane: nothing open to build, so nothing runs.
  assert.equal(pickWith(['--plan', await planFile(t, dir, acmePlan([planItem('build-x', 'climb:build-time', { status: 'done' }), planItem('tests-x', 'climb:test-time', { kind: 'triage', number: null })]))]).job, null);
  // Every climb item blocked: none runs, and each says why.
  const blocked = pickWith(['--plan', await planFile(t, dir, acmePlan([planItem('tests-x', 'climb:test-time')]))], open);
  assert.equal(blocked.job, null);
  assert.match(blocked.reason, /no climb item in tonight's plan \(2026-10-06\) can run: tests-x \(test-time waits for its open keel-climb\/test-time\/ PR\)/);
  assert.deepEqual(blocked.plan.skipped.map(s => s.id), ['tests-x']);
  // A plan for another night, or a refused one, is no plan: pick as before, saying why.
  const old = pickWith(['--plan', await planFile(t, dir, acmePlan([planItem('build-x', 'climb:build-time')], { date: '2026-10-05' }))]);
  assert.deepEqual([old.job, old.by, old.plan.used], ['test-time', 'measure', false]);
  assert.match(old.plan.why, /dated 2026-10-05, not 2026-10-06, so there is no plan tonight/);
  const refused = pickWith(['--plan', await planFile(t, dir, acmePlan([planItem('build-x', 'climb:build-time', { number: null })]))]);
  assert.deepEqual([refused.job, refused.plan.used], ['test-time', false]);
  assert.match(refused.plan.why, /is refused \(.*names its number first/);
  // A plan file that cannot be read: exit 2, never a guess that there is none.
  const missing = climb(dir, ['pick', '--date', '2026-10-06', '--json', '--plan', join(dir, '..', 'no-such-plan.json')], { KEEL_GH: gh });
  assert.equal(missing.status, 2);
  assert.match(json(missing).error, /cannot read the plan on keel-night-plan.*pick never guesses there is no plan/);
  // Weekly, on its off day: the plan's climb items are skipped, saying why.
  await setConfig(dir, { climb: { jobs: ['test-time'], schedule: 'weekly' } });
  const weekly = pickWith(['--plan', await planFile(t, dir, acmePlan([planItem('tests-x', 'climb:test-time')]))]);
  assert.equal(weekly.job, null);
  assert.deepEqual(weekly.plan.skipped, [{ id: 'tests-x', note: 'climb did not run it: climb is weekly, on Mondays (UTC)' }]);
});

test('a plan budget lowers a pass\'s minutes and never raises them', async t => {
  const dir = await plannedAcme(t, { jobs: ['test-time'], budget: { minutes: 45 } });
  const gh = await stubGh(t, []);
  const minutesFor = async budget => {
    const p = json(climb(dir, ['pick', '--date', '2026-10-06', '--json', '--plan', await planFile(t, dir, acmePlan([planItem('tests-x', 'climb:test-time', { budget })]))], { KEEL_GH: gh }));
    assert.equal(p.job, 'test-time');
    return [p.minutes, p.budget];
  };
  assert.deepEqual(await minutesFor({ minutes: 10 }), [10, { config: 45, plan: 10 }], 'lowered to the plan\'s');
  assert.deepEqual(await minutesFor({ minutes: 90 }), [45, { config: 45, plan: 90 }], 'never raised past climb\'s own (mutation: Math.max raises it to 90)');
  assert.deepEqual(await minutesFor({ minutes: 2.7 }), [2, { config: 45, plan: 2.7 }], 'whole minutes, rounded down');
  assert.deepEqual(await minutesFor({ minutes: 0.5 }), [1, { config: 45, plan: 0.5 }], 'at least one minute, still under climb\'s own');
  assert.deepEqual(await minutesFor(null), [45, { config: 45, plan: null }], 'no plan budget: climb\'s own');
  // The workflow's pick step hands that budget to the agent's time box (steps.pick.outputs.minutes).
  const temp = await mkdtemp(join(tmpdir(), 'keel-climb-plan-step-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  await mkdir(join(temp, 'night-plan'), { recursive: true });
  await writeFile(join(temp, 'night-plan/branch.json'), JSON.stringify(acmePlan([planItem('tests-x', 'climb:test-time', { budget: { minutes: 12 } })], { date: new Date().toISOString().slice(0, 10) })));
  const s = await step(t, dir, "Pick tonight's job", { RUNNER_TEMP: temp, EVENT: 'workflow_dispatch', KEEL_GH: gh });
  assert.equal(s.status, 0, s.out);
  assert.deepEqual([s.outputs.job, s.outputs.minutes, s.outputs.plan_used, s.outputs.plan_ticks], ['test-time', '12', 'true', 'true']);
  assert.match(s.out, /climb runs tests-x/);
  // The plan and the pick are kept for the judge and the publisher, before any agent runs.
  assert.equal(JSON.parse(await readFile(join(temp, 'plan-handoff/pick.json'), 'utf8')).plan.item, 'tests-x');
  assert.ok(existsSync(join(temp, 'plan-handoff/night-plan.json')));
});

test('a change that touches a willNotTouch path is refused by the judge', async t => {
  const dir = await plannedAcme(t, { jobs: ['test-time'] });
  await commit(dir, { 'lib/anvil.mjs': 'export const anvil = 1;\n', 'lib/anvils.mjs': 'export const anvils = 2;\n', 'docs/guide/acme.md': '# Acme\n' }, 'acme: lib');
  const base = git(dir, ['rev-parse', 'HEAD']);
  const plan = await planFile(t, dir, acmePlan([planItem('tests-x', 'climb:test-time')], { willNotTouch: ['lib/anvil.mjs', './docs/guide/', 'the billing module'] }));
  const sandbox = (head, args = ['--plan', plan]) => climb(dir, ['sandbox', '--base', base, '--head', head, '--json', ...args]);
  // Pure: exact path or directory prefix, literal, never a sibling with the same start.
  const m = await load(dir);
  const { paths, ignored } = m.touchRules(['lib/anvil', './docs/guide/', '/etc/passwd', '../up', 'a/./b', '', 'src/*.js']);
  assert.deepEqual(paths.map(r => r.path), ['lib/anvil', 'docs/guide', 'src/*.js']);
  assert.deepEqual(ignored, ['/etc/passwd', '../up', 'a/./b', '']);
  assert.deepEqual(['lib/anvil', 'lib/anvil/x.mjs', 'lib/anvils.mjs', 'lib', 'docs/guide/a.md', 'docs/guides.md', 'src/a.js', 'src/*.js'].map(p => m.touchedBy(p, paths)?.path ?? null),
    ['lib/anvil', 'lib/anvil', null, null, 'docs/guide', null, null, 'src/*.js']);
  // A change to a listed file is refused whole, naming it; a sibling with the same start is not.
  git(dir, ['checkout', '-q', '-b', 'keel-climb/test-time/2026-10-06']);
  const sibling = await commit(dir, { 'lib/anvils.mjs': 'export const anvils = 3;\n' }, 'acme: anvils');
  const ok = sandbox(sibling);
  assert.equal(ok.status, 0, ok.stdout);
  assert.deepEqual(json(ok).willNotTouch, ['lib/anvil.mjs', './docs/guide/', 'the billing module']);
  const touched = await commit(dir, { 'lib/anvil.mjs': 'export const anvil = 2;\n' }, 'acme: anvil');
  const refusedFile = sandbox(touched);
  assert.equal(refusedFile.status, 1, refusedFile.stdout);
  assert.match(json(refusedFile).problems.join('\n'), /^lib\/anvil\.mjs: changed on the agent's branch; tonight's plan will not touch lib\/anvil\.mjs \(its willNotTouch\), so the branch is refused whole$/m);
  // The same change without the plan passes the sandbox: the refusal is the plan's. (Mutation: sandbox ignoring --plan passes here.)
  assert.equal(sandbox(touched, []).status, 0);
  // Under a listed directory, changed then changed back: the branch's history would still carry it.
  git(dir, ['checkout', '-q', '-B', 'keel-climb/test-time/2026-10-06', sibling]);
  await commit(dir, { 'docs/guide/acme.md': '# Acme, edited\n' }, 'acme: guide');
  const back = await commit(dir, { 'docs/guide/acme.md': '# Acme\n' }, 'acme: guide back');
  const refusedDir = sandbox(back);
  assert.equal(refusedDir.status, 1);
  assert.match(json(refusedDir).problems.join('\n'), /^docs\/guide\/acme\.md: changed in [0-9a-f]{7} on the agent's branch; tonight's plan will not touch \.\/docs\/guide\//m);
  // A merge that only brings in the agent's own checked commits adds nothing; one that edits a listed path itself is refused.
  git(dir, ['checkout', '-q', '-b', 'side', sibling]);
  const side = await commit(dir, { 'lib/other.mjs': 'export const other = 1;\n' }, 'acme: other');
  git(dir, ['checkout', '-q', '-B', 'keel-climb/test-time/2026-10-06', sibling]);
  git(dir, ['merge', '-q', '--no-ff', '-m', 'acme: merge side', side]);
  assert.equal(sandbox(git(dir, ['rev-parse', 'HEAD'])).status, 0, 'a clean merge of the agent\'s own work');
  git(dir, ['reset', '-q', '--hard', sibling]);
  git(dir, ['merge', '-q', '--no-ff', '--no-commit', side]);
  await write(dir, { 'lib/anvil.mjs': 'export const anvil = 9;\n' });
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'acme: an evil merge']);
  const evil = sandbox(git(dir, ['rev-parse', 'HEAD']));
  assert.equal(evil.status, 1);
  assert.match(json(evil).problems.join('\n'), /lib\/anvil\.mjs: changed/);
  // A plan the judge cannot read, or one that is refused: exit 2, never "touches nothing".
  assert.equal(sandbox(sibling, ['--plan', join(dir, '..', 'no-such-plan.json')]).status, 2);
  assert.equal(sandbox(sibling, ['--plan', await planFile(t, dir, { schema: 1 }, 'bad')]).status, 2);
});
