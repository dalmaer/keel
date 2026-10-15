// The night's plan (phase 73): one plan per night, written before it runs,
// ticked as it goes. The validator holds the design's schema and rules; keel
// night plan makes the same default plan from the same inputs and writes
// nothing when one cannot be read; the night uses tonight's plan from the plan
// branch or the default; a tick moves one item and never back from done; the
// record is data the drain merges. Fixtures are synthetic (Acme Anvils), and
// gh is a stub at the boundary, printing what real gh prints for the fields
// asked (lesson 8). Nothing here reads the live world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, cp, chmod, realpath, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './helpers/run.mjs';
import { validatePlan, admit, defaultPlan, nightOf, tickMeasures, planSection, healthProposal, safeWrite, writeRecord, MAX_BUILD, PLAN, ITEM_FIELDS, PLAN_FIELDS, CANDIDATE_SOURCES } from '../lib/night-plan.mjs';
import { isData } from '../lib/night.mjs';
import { formatRobotRubric } from '../practices/climb/files/scripts/keel/robot-rubric.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(KEEL, 'bin', 'keel.mjs');
const NIGHT = '2026-10-15';

const keel = (args, cwd, env = {}) => {
  const r = run(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
};

/** The design's own example, every field present. */
const designItem = (over = {}) => ({
  id: 'perf-bundle', title: 'Entry chunk back under 747 kB', kind: 'build', source: 'persona:performance',
  number: { measure: 'bundle_bytes', bound: 747000, better: 'lower' }, lane: 'climb:perf', budget: { minutes: 30 },
  status: 'planned', result: { note: 'not yet', link: 'https://github.com/acme/anvils/pull/9' }, ...over,
});
const designPlan = (items = [designItem()], over = {}) => ({
  schema: 1, date: NIGHT, shapedBy: 'owner', readyBy: '2026-10-15T07:00:00Z', willNotTouch: ['lib/anvil.mjs'], settledToday: ['#41 merged'], leftOpen: ['#42 waits for review'], items, ...over,
});
const build = n => designItem({ id: `build-${n}`, lane: `climb:job-${n}` });

test('the validator accepts the design\'s schema and refuses an unknown field, a build item with no number, and a sixth build item, each naming the problem', () => {
  assert.deepEqual(validatePlan(designPlan()), { ok: true, problems: [] });
  assert.deepEqual(Object.keys(designPlan()).sort(), [...PLAN_FIELDS].sort(), 'the fixture is exactly the plan\'s fields');
  assert.deepEqual(Object.keys(designItem()).sort(), [...ITEM_FIELDS].sort(), 'and exactly the item\'s');
  // Every kind, source and lane shape the design names; number, budget and result may be null.
  const shapes = [
    ['default', 'measure', 'night'], ['loop:slow-search', 'triage', 'loop'], ['health:issues_unnamed', 'review', 'night'],
    ['robot:#12', 'build', 'robot:#12'], ['owner', 'review', 'persona:performance'],
  ].map(([source, kind, lane], i) => designItem({ id: `shape-${i}`, kind, source, lane, ...(kind === 'build' ? {} : { number: null }), budget: null, result: null }));
  assert.deepEqual(validatePlan(designPlan(shapes)).problems, []);
  assert.equal(validatePlan(designPlan([], { readyBy: null, shapedBy: 'default' })).ok, true, 'an empty default plan');

  // An unknown field, on the plan and on an item, is refused by its name.
  const unknownPlan = validatePlan(designPlan(undefined, { mood: 'calm' }));
  assert.equal(unknownPlan.ok, false);
  assert.match(unknownPlan.problems.join('\n'), /plan: unknown field "mood"/);
  const unknownItem = validatePlan(designPlan([designItem({ owner: 'acme' })]));
  assert.match(unknownItem.problems.join('\n'), /items\[0\] \(perf-bundle\): unknown field "owner"/);
  assert.match(validatePlan(designPlan([designItem({ result: { note: 'x', when: 'now' } })])).problems.join('\n'), /unknown field "result\.when"/);
  assert.match(validatePlan(designPlan([designItem({ number: { measure: 'bundle_bytes', bound: 1, better: 'lower', unit: 'kB' } })])).problems.join('\n'), /unknown field "number\.unit"/);

  // A build item names its number first.
  for (const number of [null, undefined]) {
    const it = designItem({ id: 'no-number' });
    if (number === undefined) delete it.number; else it.number = number;
    const r = validatePlan(designPlan([it]));
    assert.equal(r.ok, false);
    assert.match(r.problems.join('\n'), /items\[0\] \(no-number\): a build item names its number first; it has no "number"/);
  }

  // At most five build items: the sixth is refused by name...
  const five = [1, 2, 3, 4, 5].map(build);
  assert.equal(validatePlan(designPlan(five)).ok, true);
  const six = validatePlan(designPlan([...five, build(6)]));
  assert.equal(six.ok, false);
  assert.deepEqual(six.problems.length, 1);
  assert.match(six.problems[0], /^items\[5\] \(build-6\): a sixth build item; at most 5 a night, counted with the robot's open PRs \(none\)/);
  // ...counted with the robot's open PRs: five builds and one open robot PR is six.
  const withRobot = validatePlan(designPlan(five), { openRobotPrs: [31] });
  assert.match(withRobot.problems.join('\n'), /items\[4\] \(build-5\): a sixth build item; .*\(#31\)/);
  // A robot PR whose issue a build item names in its lane is that item, not another.
  const named = [1, 2, 3, 4].map(build).concat(designItem({ id: 'robot-31', source: 'robot:#31', lane: 'robot:#31' }));
  assert.equal(validatePlan(designPlan(named), { openRobotPrs: [31] }).ok, true);
  assert.equal(MAX_BUILD, 5);

  // Bad values name the field too.
  for (const [over, pattern] of [
    [{ kind: 'fix' }, /"kind" is measure, build, triage, review/], [{ status: 'maybe' }, /"status" is planned/],
    [{ lane: 'main' }, /"lane" is climb:<job>/], [{ source: 'stranger' }, /"source" is default, owner/],
    [{ id: 'Perf Bundle' }, /"id" is lowercase/], [{ budget: { minutes: 0 } }, /"budget" is \{ minutes \}/],
    [{ result: { link: 'javascript:alert(1)' } }, /"result\.link" is an https URL or a repo path/],
  ]) assert.match(validatePlan(designPlan([designItem(over)])).problems.join('\n'), pattern, JSON.stringify(over));
  assert.match(validatePlan(designPlan([designItem(), designItem()])).problems.join('\n'), /"id" perf-bundle is already an item/);
  assert.match(validatePlan(designPlan(undefined, { schema: 2 })).problems.join('\n'), /"schema" is 1/);
  assert.match(validatePlan(designPlan(undefined, { date: '2026-02-30' })).problems.join('\n'), /"date" is the night's UTC date/);
  assert.match(validatePlan(designPlan(undefined, { shapedBy: 'acme' })).problems.join('\n'), /"shapedBy" is default or owner/);
});

test('admit, the default plan\'s door: a build with no number becomes triage, builds past the fifth wait for the next night, ids stay unique', () => {
  const r = admit([designItem({ id: 'robot-7', source: 'robot:#7', lane: 'robot:#7', number: null }), ...[1, 2, 3, 4, 5].map(build), build(6), designItem({ id: 'build-1', lane: 'climb:again', number: null, kind: 'review' })], { openRobotPrs: [9] });
  assert.equal(r.items[0].kind, 'triage', 'no number, no build');
  assert.match(r.items[0].result.note, /Names no number, so it is triage, not build/);
  assert.deepEqual(r.items.filter(i => i.kind === 'build').map(i => i.id), ['build-1', 'build-2', 'build-3', 'build-4'], 'four builds and the robot\'s open PR make five');
  assert.deepEqual(r.waiting.map(w => w.split(':')[0]), ['build-5', 'build-6']);
  assert.ok(r.items.some(i => i.id === 'build-1-2'), 'a repeated id gets -2');
  assert.equal(validatePlan(designPlan(r.items), { openRobotPrs: [9] }).ok, true, 'what admit returns, the validator accepts');
});

test('admission counts the builds the validator counts: five open robot PRs, the next robot issue one of them, and a numbered climb job make a valid plan', () => {
  const inputs = {
    date: NIGHT,
    health: { date: '2026-10-14', rows: [{ id: 'slow_tests', value: 2, bound: 0, better: 'lower', state: 'outside' }], proposal: null },
    climb: { job: 'test-time', by: 'measure', why: 'slow_tests is outside', minutes: 40, measures: ['slow_tests'], better: 'lower' },
    robot: { next: { number: 3, title: 'Acme: index the anvils' }, open: [1, 2, 3, 4, 5] },
  };
  const plan = defaultPlan(inputs);
  assert.deepEqual(validatePlan(plan, { openRobotPrs: [1, 2, 3, 4, 5] }).problems, []);
  // The robot's issue names no number: triage, so its open PR #3 still counts; five PRs leave no room for the climb.
  assert.equal(plan.items.find(i => i.id === 'robot-3').kind, 'triage');
  assert.ok(!plan.items.some(i => i.kind === 'build'));
  assert.match(plan.leftOpen.join('\n'), /climb-test-time: waits for the next night \(at most 5 build items, counted with the robot's 5 open PRs\)/);
  // A numbered build naming an open robot PR takes that PR's place rather than adding one.
  const named = admit([{ id: 'robot-3', title: 'Acme', kind: 'build', source: 'robot:#3', lane: 'robot:#3', number: { measure: 'slow_tests', bound: 0, better: 'lower' } }], { openRobotPrs: [1, 2, 3, 4, 5] });
  assert.deepEqual([named.items.map(i => i.kind), named.waiting], [['build'], []]);
});

test('tonight is the UTC date of the next 07:23 UTC night', () => {
  assert.equal(nightOf(new Date('2026-10-15T05:00:00Z')), '2026-10-15', '22:00 in California, before the night: that night');
  assert.equal(nightOf(new Date('2026-10-14T20:00:00Z')), '2026-10-15', '22:00 in Berlin: tomorrow morning\'s night');
  assert.equal(nightOf(new Date('2026-10-15T07:22:59Z')), '2026-10-15');
  assert.equal(nightOf(new Date('2026-10-15T07:23:00Z')), '2026-10-16', 'from 07:23 UTC, the next night');
  assert.equal(nightOf(new Date('2026-12-31T23:00:00Z')), '2027-01-01');
});

// ---- a synthetic project, its practices' scripts, and gh -------------------------

const PAGE = `# Health — 2026-10-14

| Measure | Value | Bound | State | Detail |
| --- | --- | --- | --- | --- |
| \`gate\` — the check passes | 0 | ≤ 0 | ok | npm test passed |
| \`slow_tests\` — tests slower than their median | 2 | ≤ 0 | outside | two Acme tests |
| \`prs_stale\` — open PRs older than 14 days | 3 | ≤ 1 | outside | three |
| \`cross_review_valid\` — share answered valid | 90 | ≥ 80 | ok | fine |

Ratchet: no bound moved.

## Proposal

**\`prs_stale\`** (outside) — Merge or close PR #4 (open 20 days). 2 more after it.

A person decides whether this becomes a phase, or declines it.
`;
const RUBRIC = formatRobotRubric({ version: 1, problem: 'The Acme anvil list is slow.', reproduction: 'Open the list.', acceptance: 'It opens in under a second.', change: 'Index the anvils.', prerequisites: [], ownerBlockers: [] });
const finding = (title, decision) => `---\ntitle: ${title}\nloop: [acme]\n${decision ? `decision: ${decision}\nrank: next\n` : ''}since: 2026-10-01\n---\n\nAcme's ${title}.\n`;

/** Acme Anvils with night, climb (and the robot) and loop's scripts, a health page, findings, and a gh over a JSON state. */
async function acme(t, { config = {}, prs, issues, failGh = false } = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'keel-night-plan-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'anvils');
  await mkdir(join(root, '.keel'), { recursive: true });
  await mkdir(join(root, 'scripts', 'keel'), { recursive: true });
  for (const p of ['night', 'climb']) await cp(join(KEEL, 'practices', p, 'files', 'scripts', 'keel'), join(root, 'scripts', 'keel'), { recursive: true });
  await cp(join(KEEL, 'practices', 'loop', 'files', 'scripts', 'loop.mjs'), join(root, 'scripts', 'loop.mjs'));
  await writeFile(join(root, '.keel', 'keel.json'), JSON.stringify({ name: 'Acme Anvils', repo: 'acme/anvils', practices: ['base', 'night', 'climb', 'loop'], climb: { jobs: ['test-time'], budget: { minutes: 40 } }, robot: { on: true, budgetMinutes: 60 }, ...config }));
  await mkdir(join(root, 'docs', 'health'), { recursive: true });
  await writeFile(join(root, 'docs', 'health', '2026-10-14.md'), PAGE);
  // Tonight's own page, when a rerun has one: never what the plan reads.
  await writeFile(join(root, 'docs', 'health', '2026-10-15.md'), PAGE.replace('prs_stale', 'gate'));
  await mkdir(join(root, 'docs', 'loop'), { recursive: true });
  await writeFile(join(root, 'docs', 'loop', 'slow-search.md'), finding('Slow search'));
  await writeFile(join(root, 'docs', 'loop', 'broken-link.md'), finding('Broken link'));
  await writeFile(join(root, 'docs', 'loop', 'decided.md'), finding('Decided', 'accepted'));
  const gh = join(base, 'gh'), log = join(base, 'gh.log');
  const state = {
    prs: prs ?? [
      { number: 7, headRefName: 'keel/robot-3', isCrossRepository: false, createdAt: '2026-10-10T00:00:00Z', state: 'OPEN' },
      { number: 8, headRefName: 'keel/robot-4', isCrossRepository: true, createdAt: '2026-10-10T00:00:00Z', state: 'OPEN' },
      { number: 9, headRefName: 'keel-night/2026-10-14', isCrossRepository: false, createdAt: '2026-10-14T07:30:00Z', state: 'OPEN' },
    ],
    issues: issues ?? [
      { number: 12, title: 'Acme: newer, valid', body: RUBRIC, createdAt: '2026-10-12T00:00:00Z' },
      { number: 11, title: 'Acme: no rubric', body: 'Please make anvils faster.', createdAt: '2026-10-11T00:00:00Z' },
      { number: 13, title: 'Acme: newest', body: RUBRIC, createdAt: '2026-10-13T00:00:00Z' },
    ],
  };
  await writeFile(gh, `#!${process.execPath}
const fs = require('node:fs');
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + '\\n');
if (${failGh}) { console.error('HTTP 502: Acme gateway'); process.exit(1); }
const s = ${JSON.stringify(state)};
const opt = f => a.includes(f) ? a[a.indexOf(f) + 1] : undefined;
const pick = (rows, fields) => rows.map(r => Object.fromEntries(fields.split(',').map(f => [f, r[f]])));
if (a[0] === 'pr' && a[1] === 'list') {
  const want = opt('--state');
  console.log(JSON.stringify(pick(s.prs.filter(p => want === 'all' || p.state === 'OPEN'), opt('--json'))));
} else if (a[0] === 'issue' && a[1] === 'list') {
  if (opt('--label') !== 'keel:agent' || opt('--state') !== 'open') { console.error('stub gh: open keel:agent issues only'); process.exit(1); }
  console.log(JSON.stringify(pick(s.issues, opt('--json'))));
} else { console.error('stub gh: unknown ' + a.join(' ')); process.exit(1); }
`, { mode: 0o755 });
  return { root, base, gh, log };
}

test('keel night plan makes the same default plan from the same inputs: the measures, the health proposal, the climb job pick chooses, the robot\'s next issue, untriaged Loop findings', async t => {
  const { root, gh } = await acme(t);
  const a = keel(['night', 'plan', '--date', NIGHT, '--json'], root, { KEEL_GH: gh });
  assert.equal(a.code, 0, a.err + a.out);
  const first = await readFile(join(root, PLAN), 'utf8');
  const b = keel(['night', 'plan', '--date', NIGHT], root, { KEEL_GH: gh });
  assert.equal(b.code, 0, b.err);
  assert.equal(await readFile(join(root, PLAN), 'utf8'), first, 'the same inputs, the same bytes');
  const script = run(process.execPath, [join(root, 'scripts/keel/night-plan.mjs'), 'plan', '--date', NIGHT, '--json'], { cwd: root, env: { ...process.env, KEEL_GH: gh } });
  assert.equal(script.status, 0, script.stderr);
  assert.equal(await readFile(join(root, PLAN), 'utf8'), first, 'the project\'s own copy makes the same plan as keel\'s verb');
  assert.equal(await readFile(join(root, '.keel/night/.gitignore'), 'utf8'), '*\n', 'the working plan ignores itself');

  const plan = JSON.parse(first);
  assert.deepEqual(validatePlan(plan, { openRobotPrs: [3] }).problems, []);
  assert.deepEqual([plan.schema, plan.date, plan.shapedBy, plan.readyBy], [1, NIGHT, 'default', null]);
  assert.deepEqual(plan.items.map(i => [i.id, i.kind, i.source, i.lane, i.status]), [
    ['measures', 'measure', 'default', 'night', 'planned'],
    ['health-prs-stale', 'review', 'health:prs_stale', 'night', 'planned'],
    ['climb-test-time', 'build', 'health:slow_tests', 'climb:test-time', 'planned'],
    ['robot-12', 'triage', 'robot:#12', 'robot:#12', 'planned'],
    ['loop-broken-link', 'triage', 'loop:broken-link', 'loop', 'planned'],
    ['loop-slow-search', 'triage', 'loop:slow-search', 'loop', 'planned'],
  ]);
  const by = id => plan.items.find(i => i.id === id);
  // Tonight's measures: last night's page (2026-10-14), never tonight's own (a rerun's).
  assert.match(by('measures').title, /4 measures; outside or broken on 2026-10-14: slow_tests, prs_stale/);
  assert.match(by('health-prs-stale').title, /Merge or close PR #4/);
  assert.deepEqual(by('health-prs-stale').number, { measure: 'prs_stale', bound: 1, better: 'lower' });
  // The climb job pick chooses (slow_tests outside sends it to test-time), with its number and budget.
  assert.deepEqual(by('climb-test-time').number, { measure: 'slow_tests', bound: 0, better: 'lower' });
  assert.deepEqual(by('climb-test-time').budget, { minutes: 40 });
  assert.match(by('climb-test-time').title, /slow_tests is outside/);
  // The robot's next admissible issue: the oldest whose rubric parses (#11 has none); it names no number, so triage.
  assert.match(by('robot-12').title, /^Robot: #12 Acme: newer, valid/);
  assert.match(by('robot-12').result.note, /Names no number/);
  // Untriaged Loop findings only.
  assert.ok(!plan.items.some(i => i.id === 'loop-decided'));
  assert.deepEqual(plan.leftOpen, []);
  assert.equal(a.json().plan.items[0].id, 'measures');
});

test('keel night plan writes nothing when an input cannot be read, and says which (exit 2)', async t => {
  // gh cannot be read: climb's pick and the robot's PRs both need it.
  const down = await acme(t, { failGh: true });
  await mkdir(join(down.root, '.keel/night'), { recursive: true });
  await writeFile(join(down.root, PLAN), 'last night\'s plan, untouched\n');
  const r = keel(['night', 'plan', '--date', NIGHT, '--json'], down.root, { KEEL_GH: down.gh });
  assert.equal(r.code, 2, r.out);
  assert.match(r.json().error, /cannot read the climb pick: .*HTTP 502: Acme gateway/);
  assert.equal(await readFile(join(down.root, PLAN), 'utf8'), 'last night\'s plan, untouched\n', 'nothing written');
  // Climb off: then it is the robot's open PRs that cannot be read.
  const robot = await acme(t, { failGh: true, config: { climb: undefined } });
  const rr = keel(['night', 'plan', '--date', NIGHT, '--json'], robot.root, { KEEL_GH: robot.gh });
  assert.equal(rr.code, 2);
  assert.match(rr.json().error, /cannot read the open PRs: gh exited 1, HTTP 502: Acme gateway/);
  assert.ok(!existsSync(join(robot.root, PLAN)), 'no plan file at all');
  // The health page exists and cannot be read.
  const page = await acme(t);
  await chmod(join(page.root, 'docs/health/2026-10-14.md'), 0o000);
  t.after(() => chmod(join(page.root, 'docs/health/2026-10-14.md'), 0o644).catch(() => {}));
  const p = keel(['night', 'plan', '--date', NIGHT, '--json'], page.root, { KEEL_GH: page.gh });
  assert.equal(p.code, 2, p.out);
  assert.match(p.json().error, /cannot read the health page docs\/health\/2026-10-14\.md: EACCES/);
  assert.ok(!existsSync(join(page.root, PLAN)));
  // A Loop finding that cannot be read.
  const loop = await acme(t);
  await chmod(join(loop.root, 'docs/loop/slow-search.md'), 0o000);
  t.after(() => chmod(join(loop.root, 'docs/loop/slow-search.md'), 0o644).catch(() => {}));
  const l = keel(['night', 'plan', '--date', NIGHT, '--json'], loop.root, { KEEL_GH: loop.gh });
  assert.equal(l.code, 2, l.out);
  assert.match(l.json().error, /cannot read the Loop findings \(docs\/loop\)/);
  assert.ok(!existsSync(join(loop.root, PLAN)));
  // A bad date is usage.
  const bad = keel(['night', 'plan', '--date', '15/10/2026', '--json'], loop.root, { KEEL_GH: loop.gh });
  assert.equal(bad.code, 2);
  assert.match(bad.json().error, /--date is the night's UTC date/);
});

test('the default plan is pure, and other sources plug in as candidate items through admit', () => {
  const inputs = { date: NIGHT, health: null, climb: { job: null, reason: 'climb is off' }, robot: { next: null, open: [1, 2, 3, 4] }, loop: [] };
  const plain = defaultPlan(inputs);
  assert.deepEqual(plain.items.map(i => i.id), ['measures']);
  assert.match(plain.items[0].title, /no health page yet/);
  assert.deepEqual(plain.leftOpen, ['climb: climb is off']);
  assert.deepEqual(defaultPlan(inputs), plain, 'same inputs, same plan');
  assert.deepEqual(CANDIDATE_SOURCES, [], 'keel names no other source yet');
  // A persona's missed goal, as phase 75 will hand it in: a build with its number; the robot's four PRs leave room for one.
  const persona = n => ({ id: `perf-${n}`, title: `Acme bundle ${n}`, kind: 'build', source: 'persona:performance', lane: 'persona:performance', number: { measure: 'bundle_bytes', bound: 747000, better: 'lower' } });
  const shaped = defaultPlan({ ...inputs, candidates: [persona(1), persona(2), { id: 'hunch', title: 'A hunch', kind: 'build', source: 'persona:performance', lane: 'persona:performance' }] });
  assert.deepEqual(shaped.items.map(i => [i.id, i.kind]), [['measures', 'measure'], ['perf-1', 'build'], ['hunch', 'triage']]);
  assert.match(shaped.leftOpen.join('\n'), /perf-2: waits for the next night \(at most 5 build items, counted with the robot's 4 open PRs\)/);
});

test('the night\'s step uses tonight\'s plan from the plan branch, else the default plan, and says which', async t => {
  const { root, gh, base } = await acme(t);
  const tonight = (...args) => run(process.execPath, [join(root, 'scripts/keel/night-plan.mjs'), 'tonight', '--date', NIGHT, ...args, '--json'], { cwd: root, env: { ...process.env, KEEL_GH: gh } });
  const branch = join(base, 'branch-plan.json');
  const owner = designPlan([designItem({ id: 'acme-owner', lane: 'climb:test-time' })], { willNotTouch: ['lib/anvil.mjs'] });
  await writeFile(branch, JSON.stringify(owner));
  const used = tonight('--branch-plan', branch);
  assert.equal(used.status, 0, used.stderr + used.stdout);
  assert.equal(JSON.parse(used.stdout).from, 'branch');
  assert.match(JSON.parse(used.stdout).why, /Tonight's plan \(2026-10-15\) is the one on keel-night-plan, shaped by owner/);
  assert.deepEqual(JSON.parse(await readFile(join(root, PLAN), 'utf8')), owner);
  // None on the branch: the default, saying so.
  const none = JSON.parse(tonight().stdout);
  assert.deepEqual([none.from, none.plan.shapedBy], ['default', 'default']);
  assert.match(none.why, /keel's default plan: no plan on keel-night-plan/);
  // Dated for another night: the default.
  await writeFile(branch, JSON.stringify({ ...owner, date: '2026-10-14' }));
  const old = JSON.parse(tonight('--branch-plan', branch).stdout);
  assert.equal(old.from, 'default');
  assert.match(old.why, /the plan on keel-night-plan is dated 2026-10-14, not 2026-10-15/);
  assert.equal(JSON.parse(await readFile(join(root, PLAN), 'utf8')).shapedBy, 'default');
  // Refused (an unknown field; six builds with the robot's open PR): the default, naming why.
  await writeFile(branch, JSON.stringify({ ...owner, mood: 'calm' }));
  const refused = JSON.parse(tonight('--branch-plan', branch).stdout);
  assert.equal(refused.from, 'default');
  assert.match(refused.why, /is refused: plan: unknown field "mood"/);
  await writeFile(branch, JSON.stringify(designPlan([1, 2, 3, 4, 5].map(build))));
  const crowded = JSON.parse(tonight('--branch-plan', branch).stdout);
  assert.equal(crowded.from, 'default', 'five builds and the robot\'s open PR #3 are six');
  assert.match(crowded.why, /a sixth build item.*#3/);
  // The branch could not be read: the default, saying so.
  const unread = JSON.parse(tonight('--branch-unread', 'git ls-remote exit 128').stdout);
  assert.match(unread.why, /could not be read \(git ls-remote exit 128\)/);
});

test('keel night tick changes one item\'s status with a note and a link, and refuses an unknown id or a move back from done', async t => {
  const { root, gh } = await acme(t);
  assert.equal(keel(['night', 'plan', '--date', NIGHT], root, { KEEL_GH: gh }).code, 0);
  const env = { KEEL_GH: gh };
  const running = keel(['night', 'tick', 'climb-test-time', '--status', 'running', '--json'], root, env);
  assert.equal(running.code, 0, running.err + running.out);
  assert.deepEqual([running.json().from, running.json().item.status], ['planned', 'running']);
  const done = keel(['night', 'tick', 'climb-test-time', '--status', 'done', '--note', 'Acme tests 12% faster', '--link', 'https://github.com/acme/anvils/pull/21', '--json'], root, env);
  assert.equal(done.code, 0, done.out);
  const after = JSON.parse(await readFile(join(root, PLAN), 'utf8'));
  const it = after.items.find(i => i.id === 'climb-test-time');
  assert.deepEqual([it.status, it.result], ['done', { note: 'Acme tests 12% faster', link: 'https://github.com/acme/anvils/pull/21' }]);
  assert.deepEqual(after.items.filter(i => i.id !== 'climb-test-time').map(i => i.status), after.items.filter(i => i.id !== 'climb-test-time').map(() => 'planned'), 'one item changed, and only it');
  const bytes = await readFile(join(root, PLAN), 'utf8');
  // Refused: a move back from done, an unknown id, an unknown status; the plan is untouched.
  const back = keel(['night', 'tick', 'climb-test-time', '--status', 'running', '--json'], root, env);
  assert.equal(back.code, 2);
  assert.match(back.json().error, /"climb-test-time" is done; a done item never moves back \(to running\)/);
  const unknown = keel(['night', 'tick', 'acme-nothing', '--status', 'done', '--json'], root, env);
  assert.equal(unknown.code, 2);
  assert.match(unknown.json().error, /no item "acme-nothing" in tonight's plan \(2026-10-15\); its items: measures, health-prs-stale, climb-test-time/);
  const status = keel(['night', 'tick', 'measures', '--status', 'finished', '--json'], root, env);
  assert.equal(status.code, 2);
  assert.match(status.json().error, /--status is one of planned, running, done, failed, skipped, left-alone/);
  assert.equal(keel(['night', 'tick', 'measures', '--json'], root, env).code, 2, '--status is required');
  assert.equal(await readFile(join(root, PLAN), 'utf8'), bytes, 'a refused tick writes nothing');
  // Done again mends the note; a failed item may run again.
  assert.equal(keel(['night', 'tick', 'climb-test-time', '--status', 'done', '--note', 'Acme tests 13% faster'], root, env).code, 0);
  assert.equal(keel(['night', 'tick', 'robot-12', '--status', 'failed', '--note', 'the allowance ran out'], root, env).code, 0);
  assert.equal(keel(['night', 'tick', 'robot-12', '--status', 'running'], root, env).code, 0);
  // No plan: refused, naming the verb that writes one.
  await rm(join(root, PLAN));
  assert.match(keel(['night', 'tick', 'measures', '--status', 'done', '--json'], root, env).json().error, /no plan to tick: .*keel night plan writes one/);
});

test('the record is the night\'s data: the drain merges docs/night/<date>.json and nothing else there, and the page section shows each item and its outcome', () => {
  for (const path of ['docs/night/2026-10-15.json']) assert.equal(isData(path, 'keel-night/'), true, path);
  for (const path of ['docs/night/notes.md', 'docs/night/2026-10-15.md', 'docs/night/latest.json', 'docs/night/2026-10-15.json.bak']) assert.equal(isData(path, 'keel-night/'), false, path);
  assert.equal(isData('docs/night/2026-10-15.json', 'keel-loop/'), false, 'only the night\'s queue carries it');
  // The section: every item, its kind, lane, number, status and outcome.
  const plan = tickMeasures(defaultPlan({ date: NIGHT, health: { date: '2026-10-14', rows: [{ id: 'slow_tests', bound: 0, better: 'lower', state: 'outside' }], proposal: null }, climb: { job: 'test-time', by: 'measure', why: 'slow_tests is outside', minutes: 40, measures: ['slow_tests'], better: 'lower' } }),
    { results: [{ id: 'gate', state: 'ok' }, { id: 'slow_tests', state: 'outside' }], page: 'docs/health/2026-10-15.md' });
  const text = planSection(plan, { record: 'docs/night/2026-10-15.json' }).join('\n');
  assert.match(text, /^## Tonight's plan$/m);
  assert.match(text, /Shaped by keel's default plan/);
  assert.match(text, /^\| measures: Measure the practice: 1 measures; .* \| measure \| night \| — \| done \| 1 ok, 1 outside, 0 n\/a, 0 broken — docs\/health\/2026-10-15\.md \|$/m);
  assert.match(text, /^\| climb-test-time: Climb test-time: slow_tests is outside \| build \| climb:test-time \| `slow_tests` ≤ 0 \| planned \| — \|$/m);
  assert.match(text, /The record: `docs\/night\/2026-10-15\.json`/);
  // A broken instrument fails the measure item, naming it.
  const broken = tickMeasures(plan, { results: [{ id: 'gate', state: 'broken' }], page: 'x.md' });
  assert.equal(broken.items[0].status, 'done', 'a done item stays done');
  const fresh = tickMeasures(defaultPlan({ date: NIGHT }), { results: [{ id: 'gate', state: 'broken' }], page: 'x.md' });
  assert.deepEqual([fresh.items[0].status, fresh.items[0].result.note], ['failed', '0 ok, 0 outside, 0 n/a, 1 broken (gate)']);
  assert.deepEqual(healthProposal('## Proposal\n\nNone: every measure is within its bound.\n'), null);
});

test('the plan and its record are never written through a symlink: a linked directory or file pointing outside the project is refused, and its target is untouched', async t => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'keel-night-links-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const outside = join(base, 'outside');
  await mkdir(outside, { recursive: true });
  const plan = defaultPlan({ date: NIGHT });
  const fresh = async name => { const root = join(base, name); await mkdir(join(root, 'docs'), { recursive: true }); return root; };
  // A symlinked docs/night directory: the record would land outside.
  await writeFile(join(outside, `${NIGHT}.json`), 'Acme\'s own file\n');
  const dirLink = await fresh('dir-link');
  await symlink(outside, join(dirLink, 'docs/night'));
  await assert.rejects(writeRecord(dirLink, plan), /refusing to write docs\/night\/2026-10-15\.json: docs\/night is a symlink/);
  assert.equal(await readFile(join(outside, `${NIGHT}.json`), 'utf8'), 'Acme\'s own file\n', 'the target is byte-identical');
  // A symlinked record file.
  await writeFile(join(outside, 'hosts'), 'Acme hosts\n');
  const fileLink = await fresh('file-link');
  await mkdir(join(fileLink, 'docs/night'));
  await symlink(join(outside, 'hosts'), join(fileLink, `docs/night/${NIGHT}.json`));
  await assert.rejects(writeRecord(fileLink, plan), /docs\/night\/2026-10-15\.json is a symlink/);
  assert.equal(await readFile(join(outside, 'hosts'), 'utf8'), 'Acme hosts\n');
  // A plain tree: written, and a second write replaces it.
  const plain = await fresh('plain');
  assert.equal(await writeRecord(plain, plan), `docs/night/${NIGHT}.json`);
  assert.equal(await writeRecord(plain, plan), `docs/night/${NIGHT}.json`);
  assert.deepEqual(JSON.parse(await readFile(join(plain, `docs/night/${NIGHT}.json`), 'utf8')), plan);
  await assert.rejects(safeWrite(plain, '../escape.json', 'x'), /not a plain repo path/);

  // keel night plan and tick: a symlinked .keel/night, and a symlinked plan.json, each refused (exit 2), the target untouched.
  const { root, gh } = await acme(t);
  await writeFile(join(outside, 'plan.json'), 'Acme\'s plan elsewhere\n');
  await symlink(outside, join(root, '.keel/night'));
  const linkedDir = keel(['night', 'plan', '--date', NIGHT, '--json'], root, { KEEL_GH: gh });
  assert.equal(linkedDir.code, 2, linkedDir.out);
  assert.match(linkedDir.json().error, /refusing to write \.keel\/night\/\.gitignore: \.keel\/night is a symlink/);
  assert.equal(await readFile(join(outside, 'plan.json'), 'utf8'), 'Acme\'s plan elsewhere\n');
  assert.ok(!existsSync(join(outside, '.gitignore')));
  await rm(join(root, '.keel/night'));
  await mkdir(join(root, '.keel/night'));
  await writeFile(join(outside, 'target.json'), JSON.stringify(plan));
  await symlink(join(outside, 'target.json'), join(root, PLAN));
  const linkedFile = keel(['night', 'plan', '--date', NIGHT, '--json'], root, { KEEL_GH: gh });
  assert.equal(linkedFile.code, 2, linkedFile.out);
  assert.match(linkedFile.json().error, /\.keel\/night\/plan\.json is a symlink/);
  const tick = keel(['night', 'tick', 'measures', '--status', 'done', '--json'], root, { KEEL_GH: gh });
  assert.equal(tick.code, 2, tick.out);
  assert.match(tick.json().error, /\.keel\/night\/plan\.json is a symlink/);
  assert.equal(await readFile(join(outside, 'target.json'), 'utf8'), JSON.stringify(plan), 'neither the plan nor the tick wrote through the link');
});

test('keel night is announced: both verbs are in the cold start and the guide', async () => {
  const guide = await readFile(join(KEEL, 'lib/agent-guide.md'), 'utf8');
  assert.match(guide, /- `keel night plan\|tick`/);
  assert.match(guide, /<!-- topic: night \|/);
  const names = (await readdir(join(KEEL, 'practices/night/files/scripts/keel'))).filter(n => n === 'night-plan.mjs');
  assert.deepEqual(names, ['night-plan.mjs']);
});
