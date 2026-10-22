// The night's plan (phase 73): one plan per night, written before it runs,
// ticked as it goes. The validator holds the design's schema and rules; plates
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
import { runBlocks } from './helpers/workflows.mjs';
import { validatePlan, admit, defaultPlan, nightOf, tickMeasures, planSection, healthProposal, safeWrite, writeRecord, MAX_BUILD, PLAN, ITEM_FIELDS, PLAN_FIELDS, CANDIDATE_SOURCES } from '../lib/night-plan.mjs';
import { isData } from '../lib/night.mjs';
import { formatRobotRubric } from '../practices/climb/files/scripts/plates/robot-rubric.mjs';

const PLATES = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(PLATES, 'bin', 'plates.mjs');
const NIGHT = '2026-10-15';

const plates = (args, cwd, env = {}) => {
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

  // readyBy is a real time (phase 85: shrunk case readyBy 2000-01-32T07:00:00Z, seed 283816414): its shape alone let
  // an impossible day through, which Date.parse reads as no time, so the night was never over by it.
  for (const readyBy of ['2000-01-32T07:00:00Z', '2026-13-01T07:00Z', '2026-02-30T07:00:00Z', '2026-10-15T24:00Z', '2026-10-15T07:60Z', '2026-10-15T07:00:60Z', '2026-10-15T07:00+24:00', '2026-10-15T07:00-03:60']) {
    assert.match(validatePlan(designPlan(undefined, { readyBy })).problems.join('\n'), /plan: "readyBy" is null or a time with its zone/, readyBy);
  }
  for (const readyBy of ['2026-10-15T07:00Z', '2026-10-15T23:59:59Z', '2024-02-29T07:00:00+02:00', '2026-10-15T00:00-07:00']) {
    assert.deepEqual(validatePlan(designPlan(undefined, { readyBy })).problems, [], readyBy);
  }

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
  // A month or day no calendar has is refused, never a RangeError.
  for (const date of ['2026-13-01', '2026-00-10', '2026-10-32', '2026-10-00']) {
    assert.match(validatePlan(designPlan(undefined, { date })).problems.join('\n'), /"date" is the night's UTC date/, date);
  }
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
  await mkdir(join(root, '.plates'), { recursive: true });
  await mkdir(join(root, 'scripts', 'plates'), { recursive: true });
  for (const p of ['night', 'climb']) await cp(join(PLATES, 'practices', p, 'files', 'scripts', 'plates'), join(root, 'scripts', 'plates'), { recursive: true });
  await cp(join(PLATES, 'practices', 'loop', 'files', 'scripts', 'loop.mjs'), join(root, 'scripts', 'loop.mjs'));
  await writeFile(join(root, '.plates', 'plates.json'), JSON.stringify({ name: 'Acme Anvils', repo: 'acme/anvils', practices: ['base', 'night', 'climb', 'loop'], climb: { jobs: ['test-time'], budget: { minutes: 40 } }, robot: { on: true, budgetMinutes: 60 }, ...config }));
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

test('plates night plan makes the same default plan from the same inputs: the measures, the health proposal, the climb job pick chooses, the robot\'s next issue, untriaged Loop findings', async t => {
  const { root, gh } = await acme(t);
  const a = plates(['night', 'plan', '--date', NIGHT, '--json'], root, { PLATES_GH: gh });
  assert.equal(a.code, 0, a.err + a.out);
  const first = await readFile(join(root, PLAN), 'utf8');
  const b = plates(['night', 'plan', '--date', NIGHT], root, { PLATES_GH: gh });
  assert.equal(b.code, 0, b.err);
  assert.equal(await readFile(join(root, PLAN), 'utf8'), first, 'the same inputs, the same bytes');
  const script = run(process.execPath, [join(root, 'scripts/plates/night-plan.mjs'), 'plan', '--date', NIGHT, '--json'], { cwd: root, env: { ...process.env, PLATES_GH: gh } });
  assert.equal(script.status, 0, script.stderr);
  assert.equal(await readFile(join(root, PLAN), 'utf8'), first, 'the project\'s own copy makes the same plan as plates\'s verb');
  assert.equal(await readFile(join(root, '.plates/night/.gitignore'), 'utf8'), '*\n', 'the working plan ignores itself');

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

test('plates night plan writes nothing when an input cannot be read, and says which (exit 2)', async t => {
  // gh cannot be read: climb's pick and the robot's PRs both need it.
  const down = await acme(t, { failGh: true });
  await mkdir(join(down.root, '.plates/night'), { recursive: true });
  await writeFile(join(down.root, PLAN), 'last night\'s plan, untouched\n');
  const r = plates(['night', 'plan', '--date', NIGHT, '--json'], down.root, { PLATES_GH: down.gh });
  assert.equal(r.code, 2, r.out);
  assert.match(r.json().error, /cannot read the climb pick: .*HTTP 502: Acme gateway/);
  assert.equal(await readFile(join(down.root, PLAN), 'utf8'), 'last night\'s plan, untouched\n', 'nothing written');
  // Climb off: then it is the robot's open PRs that cannot be read.
  const robot = await acme(t, { failGh: true, config: { climb: undefined } });
  const rr = plates(['night', 'plan', '--date', NIGHT, '--json'], robot.root, { PLATES_GH: robot.gh });
  assert.equal(rr.code, 2);
  assert.match(rr.json().error, /cannot read the open PRs: gh exited 1, HTTP 502: Acme gateway/);
  assert.ok(!existsSync(join(robot.root, PLAN)), 'no plan file at all');
  // The health page exists and cannot be read.
  const page = await acme(t);
  await chmod(join(page.root, 'docs/health/2026-10-14.md'), 0o000);
  t.after(() => chmod(join(page.root, 'docs/health/2026-10-14.md'), 0o644).catch(() => {}));
  const p = plates(['night', 'plan', '--date', NIGHT, '--json'], page.root, { PLATES_GH: page.gh });
  assert.equal(p.code, 2, p.out);
  assert.match(p.json().error, /cannot read the health page docs\/health\/2026-10-14\.md: EACCES/);
  assert.ok(!existsSync(join(page.root, PLAN)));
  // A Loop finding that cannot be read.
  const loop = await acme(t);
  await chmod(join(loop.root, 'docs/loop/slow-search.md'), 0o000);
  t.after(() => chmod(join(loop.root, 'docs/loop/slow-search.md'), 0o644).catch(() => {}));
  const l = plates(['night', 'plan', '--date', NIGHT, '--json'], loop.root, { PLATES_GH: loop.gh });
  assert.equal(l.code, 2, l.out);
  assert.match(l.json().error, /cannot read the Loop findings \(docs\/loop\)/);
  assert.ok(!existsSync(join(loop.root, PLAN)));
  // A bad date is usage.
  const bad = plates(['night', 'plan', '--date', '15/10/2026', '--json'], loop.root, { PLATES_GH: loop.gh });
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
  assert.deepEqual(CANDIDATE_SOURCES.map(s => s.name), ['productionCandidates', 'personaCandidates'], 'production triage and personas extend the existing plan');
  // A persona's missed goal, as phase 75 hands it in: a build with its number, handed to the climb job
  // that measures it (phase 78); the robot's four PRs leave room for one.
  const persona = n => ({ id: `perf-${n}`, title: `Acme bundle ${n}`, kind: 'build', source: 'persona:performance', lane: 'persona:performance', number: { measure: 'bundle_bytes', bound: 747000, better: 'lower' } });
  const jobs = { perf: { measures: ['bundle_bytes'] } };
  const shaped = defaultPlan({ ...inputs, jobs, candidates: [persona(1), persona(2), { id: 'hunch', title: 'A hunch', kind: 'build', source: 'persona:performance', lane: 'persona:performance' }] });
  assert.deepEqual(shaped.items.map(i => [i.id, i.kind, i.lane]), [['measures', 'measure', 'night'], ['perf-1', 'build', 'climb:perf'], ['hunch', 'triage', 'persona:performance']]);
  assert.match(shaped.leftOpen.join('\n'), /perf-2: waits for the next night \(at most 5 build items, counted with the robot's 4 open PRs\)/);
});

// Phase 78: no lane without a builder.
test('the validator refuses a build in lane loop, and a persona build; the default plan hands a persona build to the climb job that measures its number, or makes it triage', () => {
  const loop = validatePlan(designPlan([designItem({ id: 'loop-build', source: 'loop:slow-search', lane: 'loop' })]));
  assert.equal(loop.ok, false);
  assert.match(loop.problems.join('\n'), /items\[0\] \(loop-build\): a build item names the pass that builds it; no pass builds lane loop/);
  const persona = validatePlan(designPlan([designItem({ id: 'persona-build', lane: 'persona:performance' })]));
  assert.equal(persona.ok, false);
  assert.match(persona.problems.join('\n'), /items\[0\] \(persona-build\): a build item names the pass that builds it; a persona measures and never builds \(hand it to the climb job that measures bundle_bytes/);
  // Triage and review in those lanes are still the lanes' own.
  for (const lane of ['loop', 'persona:performance']) assert.deepEqual(validatePlan(designPlan([designItem({ kind: 'triage', lane })])).problems, [], lane);
  // The default plan never writes either: handed to its builder, or triage saying why.
  const inputs = { date: NIGHT, health: null, climb: null, robot: null, loop: [] };
  const candidates = [
    { id: 'p-handed', title: 'Acme bundle', kind: 'build', source: 'persona:performance', lane: 'persona:performance', number: { measure: 'bundle_bytes', bound: 747000, better: 'lower' } },
    { id: 'p-orphan', title: 'Acme frame', kind: 'build', source: 'persona:performance', lane: 'persona:performance', number: { measure: 'persona:performance:frame', bound: 2, better: 'lower' } },
    { id: 'l-orphan', title: 'Acme finding', kind: 'build', source: 'loop:slow-search', lane: 'loop', number: { measure: 'slow_tests', bound: 3, better: 'lower' } },
  ];
  const plan = defaultPlan({ ...inputs, jobs: { perf: { measures: ['bundle_bytes'] } }, candidates });
  assert.equal(validatePlan(plan).ok, true);
  assert.deepEqual(plan.items.slice(1).map(i => [i.id, i.kind, i.lane]), [['p-handed', 'build', 'climb:perf'], ['p-orphan', 'triage', 'persona:performance'], ['l-orphan', 'triage', 'loop']]);
  assert.match(plan.items[2].result.note, /no climb job here measures persona:performance:frame/);
  assert.match(plan.items[3].result.note, /No pass builds lane loop/);
  // No jobs at all (climb off): every persona build is triage.
  assert.deepEqual(defaultPlan({ ...inputs, candidates }).items.slice(1).map(i => i.kind), ['triage', 'triage', 'triage']);
});

test('the night\'s step uses tonight\'s plan from the plan branch, else the default plan, and says which', async t => {
  const { root, gh, base } = await acme(t);
  const tonight = (...args) => run(process.execPath, [join(root, 'scripts/plates/night-plan.mjs'), 'tonight', '--date', NIGHT, ...args, '--json'], { cwd: root, env: { ...process.env, PLATES_GH: gh } });
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
  assert.match(none.why, /plates's default plan: no plan on keel-night-plan/);
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
  // A date no calendar has (2026-13-01): refused and replaced by the default plan, never a crash.
  await writeFile(branch, JSON.stringify({ ...owner, date: '2026-13-01' }));
  const impossible = tonight('--branch-plan', branch);
  assert.equal(impossible.status, 0, impossible.stderr + impossible.stdout);
  assert.equal(JSON.parse(impossible.stdout).from, 'default');
  assert.match(JSON.parse(impossible.stdout).why, /is refused: plan: "date" is the night's UTC date/);
  // The branch could not be read: the default, saying so.
  const unread = JSON.parse(tonight('--branch-unread', 'git ls-remote exit 128').stdout);
  assert.match(unread.why, /could not be read \(git ls-remote exit 128\)/);
});

test('plates night tick changes one item\'s status with a note and a link, and refuses an unknown id or a move back from done', async t => {
  const { root, gh } = await acme(t);
  assert.equal(plates(['night', 'plan', '--date', NIGHT], root, { PLATES_GH: gh }).code, 0);
  const env = { PLATES_GH: gh };
  const running = plates(['night', 'tick', 'climb-test-time', '--status', 'running', '--json'], root, env);
  assert.equal(running.code, 0, running.err + running.out);
  assert.deepEqual([running.json().from, running.json().item.status], ['planned', 'running']);
  const done = plates(['night', 'tick', 'climb-test-time', '--status', 'done', '--note', 'Acme tests 12% faster', '--link', 'https://github.com/acme/anvils/pull/21', '--json'], root, env);
  assert.equal(done.code, 0, done.out);
  const after = JSON.parse(await readFile(join(root, PLAN), 'utf8'));
  const it = after.items.find(i => i.id === 'climb-test-time');
  assert.deepEqual([it.status, it.result], ['done', { note: 'Acme tests 12% faster', link: 'https://github.com/acme/anvils/pull/21' }]);
  assert.deepEqual(after.items.filter(i => i.id !== 'climb-test-time').map(i => i.status), after.items.filter(i => i.id !== 'climb-test-time').map(() => 'planned'), 'one item changed, and only it');
  const bytes = await readFile(join(root, PLAN), 'utf8');
  // Refused: a move back from done, an unknown id, an unknown status; the plan is untouched.
  const back = plates(['night', 'tick', 'climb-test-time', '--status', 'running', '--json'], root, env);
  assert.equal(back.code, 2);
  assert.match(back.json().error, /"climb-test-time" is done; a done item never moves back \(to running\)/);
  const unknown = plates(['night', 'tick', 'acme-nothing', '--status', 'done', '--json'], root, env);
  assert.equal(unknown.code, 2);
  assert.match(unknown.json().error, /no item "acme-nothing" in tonight's plan \(2026-10-15\); its items: measures, health-prs-stale, climb-test-time/);
  const status = plates(['night', 'tick', 'measures', '--status', 'finished', '--json'], root, env);
  assert.equal(status.code, 2);
  assert.match(status.json().error, /--status is one of planned, running, done, failed, skipped, left-alone/);
  assert.equal(plates(['night', 'tick', 'measures', '--json'], root, env).code, 2, '--status is required');
  assert.equal(await readFile(join(root, PLAN), 'utf8'), bytes, 'a refused tick writes nothing');
  // Done again mends the note; a failed item may run again.
  assert.equal(plates(['night', 'tick', 'climb-test-time', '--status', 'done', '--note', 'Acme tests 13% faster'], root, env).code, 0);
  assert.equal(plates(['night', 'tick', 'robot-12', '--status', 'failed', '--note', 'the allowance ran out'], root, env).code, 0);
  assert.equal(plates(['night', 'tick', 'robot-12', '--status', 'running'], root, env).code, 0);
  // No plan: refused, naming the verb that writes one.
  await rm(join(root, PLAN));
  assert.match(plates(['night', 'tick', 'measures', '--status', 'done', '--json'], root, env).json().error, /no plan to tick: .*plates night plan writes one/);
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
  assert.match(text, /Shaped by plates's default plan/);
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

test('with the personas practice, plates night plan runs every persona and each missed goal is an item with its number; no personas is no items, never a failure', async t => {
  const config = { practices: ['base', 'night', 'climb', 'loop', 'personas'], climb: undefined, robot: undefined };
  const { root, gh } = await acme(t, { config });
  await cp(join(PLATES, 'practices/personas/files/scripts/plates/persona.mjs'), join(root, 'scripts/plates/persona.mjs'));
  // Installed, no persona files: the plan is made as before.
  const none = plates(['night', 'plan', '--date', NIGHT, '--json'], root, { PLATES_GH: gh });
  assert.equal(none.code, 0, none.out + none.err);
  assert.ok(!none.json().plan.items.some(i => i.source.startsWith('persona:')));
  await mkdir(join(root, '.agents/personas'), { recursive: true });
  await writeFile(join(root, '.agents/personas/speed.md'), `---
name: speed
description: Whether Acme stays quick.
goal:
  - name: entry bundle
    at most: 250000
    measured by: echo 260000
  - name: cache hits
    at least: 90
    measured by: echo 95
  - name: latency
    at most: 100
    measured by: exit 3
---

Acme's lens.
`);
  const r = plates(['night', 'plan', '--date', NIGHT, '--json'], root, { PLATES_GH: gh });
  assert.equal(r.code, 0, r.out + r.err);
  const items = r.json().plan.items.filter(i => i.source === 'persona:speed');
  assert.deepEqual(items.map(i => [i.id, i.kind, i.lane, i.number]), [
    ['persona-speed--entry-bundle', 'triage', 'persona:speed', { measure: 'persona:speed:entry-bundle', bound: 250000, better: 'lower' }],
    ['persona-speed--latency', 'review', 'persona:speed', null],
  ], 'the missed goal names its number and, with no climb job measuring it, is triage (phase 78); the broken one a review, the met one nothing');
  assert.match(items[0].result.note, /no climb job here measures persona:speed:entry-bundle/);
  assert.ok(existsSync(join(root, `docs/reviews/${NIGHT}-speed.md`)), 'persona run wrote its review page');
  // Not installed (no "personas" in practices): the persona files are not run.
  await writeFile(join(root, '.plates/plates.json'), JSON.stringify({ name: 'Acme Anvils', repo: 'acme/anvils', practices: ['base', 'night'] }));
  const off = plates(['night', 'plan', '--date', NIGHT, '--json'], root, { PLATES_GH: gh });
  assert.ok(!off.json().plan.items.some(i => i.source.startsWith('persona:')));
  // A persona file that cannot be read is an input the plan cannot read: exit 2, nothing written.
  await writeFile(join(root, '.plates/plates.json'), JSON.stringify({ name: 'Acme Anvils', repo: 'acme/anvils', practices: ['base', 'night', 'personas'] }));
  await writeFile(join(root, '.agents/personas/broken.md'), 'no front matter\n');
  const before = await readFile(join(root, PLAN), 'utf8');
  const bad = plates(['night', 'plan', '--date', NIGHT, '--json'], root, { PLATES_GH: gh });
  assert.equal(bad.code, 2, bad.out);
  assert.match(bad.json().error, /cannot read a plan source \(personaCandidates\)/);
  assert.equal(await readFile(join(root, PLAN), 'utf8'), before);
});

test('plates#142: a broken persona with a long command and long stderr still makes a valid plan; the title is cut, the review page keeps them whole', async t => {
  const { root, gh } = await acme(t, { config: { practices: ['base', 'night', 'personas'], climb: undefined, robot: undefined } });
  await cp(join(PLATES, 'practices/personas/files/scripts/plates/persona.mjs'), join(root, 'scripts/plates/persona.mjs'));
  await mkdir(join(root, '.agents/personas'), { recursive: true });
  const command = `echo ${'acme-anvil-'.repeat(40)} >&2; echo ${'stderr-'.repeat(60)} >&2; exit 3`;
  await writeFile(join(root, '.agents/personas/speed.md'), `---\nname: speed\ndescription: Acme.\ngoal:\n  - name: latency\n    at most: 100\n    measured by: ${command}\n---\n\nAcme's lens.\n`);
  const r = plates(['night', 'plan', '--date', NIGHT, '--json'], root, { PLATES_GH: gh });
  assert.equal(r.code, 0, r.out + r.err);
  const item = r.json().plan.items.find(i => i.id === 'persona-speed--latency');
  assert.equal(item.kind, 'review');
  assert.ok(item.title.length <= 300 && item.title.endsWith('…'), item.title);
  assert.ok(item.title.startsWith('latency: its command is broken (`echo acme-anvil-'));
  assert.deepEqual(validatePlan(r.json().plan).problems, []);
  const page = await readFile(join(root, `docs/reviews/${NIGHT}-speed.md`), 'utf8');
  assert.ok(page.includes(`\`${command}\``), 'the review page keeps the full command');
  assert.match(page, /stderr-stderr-/);
});

test('the plan and its record are never written through a symlink: a linked directory or file pointing outside the project is refused, and its target is untouched', async t => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'plates-night-links-')));
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

  // plates night plan and tick: a symlinked .plates/night, and a symlinked plan.json, each refused (exit 2), the target untouched.
  const { root, gh } = await acme(t);
  await writeFile(join(outside, 'plan.json'), 'Acme\'s plan elsewhere\n');
  await symlink(outside, join(root, '.plates/night'));
  const linkedDir = plates(['night', 'plan', '--date', NIGHT, '--json'], root, { PLATES_GH: gh });
  assert.equal(linkedDir.code, 2, linkedDir.out);
  assert.match(linkedDir.json().error, /refusing to write \.plates\/night\/\.gitignore: \.plates\/night is a symlink/);
  assert.equal(await readFile(join(outside, 'plan.json'), 'utf8'), 'Acme\'s plan elsewhere\n');
  assert.ok(!existsSync(join(outside, '.gitignore')));
  await rm(join(root, '.plates/night'));
  await mkdir(join(root, '.plates/night'));
  await writeFile(join(outside, 'target.json'), JSON.stringify(plan));
  await symlink(join(outside, 'target.json'), join(root, PLAN));
  const linkedFile = plates(['night', 'plan', '--date', NIGHT, '--json'], root, { PLATES_GH: gh });
  assert.equal(linkedFile.code, 2, linkedFile.out);
  assert.match(linkedFile.json().error, /\.plates\/night\/plan\.json is a symlink/);
  const tick = plates(['night', 'tick', 'measures', '--status', 'done', '--json'], root, { PLATES_GH: gh });
  assert.equal(tick.code, 2, tick.out);
  assert.match(tick.json().error, /\.plates\/night\/plan\.json is a symlink/);
  assert.equal(await readFile(join(outside, 'target.json'), 'utf8'), JSON.stringify(plan), 'neither the plan nor the tick wrote through the link');
});

test('plates night is announced: both verbs are in the cold start and the guide', async () => {
  const guide = await readFile(join(PLATES, 'lib/agent-guide.md'), 'utf8');
  assert.match(guide, /- `plates night plan\|tick`/);
  assert.match(guide, /<!-- topic: night \|/);
  const names = (await readdir(join(PLATES, 'practices/night/files/scripts/plates'))).filter(n => n === 'night-plan.mjs');
  assert.deepEqual(names, ['night-plan.mjs']);
});

// ---- phase 76: each pass ticks its item on the plan branch --------------------

/**
 * A synthetic Acme project whose origin is a bare repo holding main and the
 * plan branch keel-night-plan (one file, on its own history, as /goodnight
 * pushes it), with the night practice's scripts in scripts/plates.
 * Returns { dir, origin, git, tip, show, temp }.
 */
async function planRemote(t, plan) {
  const base = await mkdtemp(join(tmpdir(), 'plates-plan-record-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const dir = join(base, 'acme'), origin = join(base, 'origin.git'), temp = join(base, 'tmp');
  const git = (args, cwd = dir) => { const r = run('git', args, { cwd }); assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
  for (const d of [dir, temp]) await mkdir(d, { recursive: true });
  git(['init', '-q', '--bare', origin], base);
  git(['init', '-q', '-b', 'main']);
  await cp(join(PLATES, 'practices/night/files/scripts/plates'), join(dir, 'scripts/plates'), { recursive: true });
  await mkdir(join(dir, '.plates'), { recursive: true });
  await writeFile(join(dir, '.plates/plates.json'), `${JSON.stringify({ name: 'Acme' })}\n`);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'acme']);
  git(['remote', 'add', 'origin', origin]);
  git(['push', '-q', 'origin', 'HEAD:refs/heads/main']);
  if (plan) {
    git(['checkout', '-q', '--orphan', 'keel-night-plan']);
    git(['rm', '-rq', '--cached', '.']);
    await mkdir(join(dir, '.keel/night'), { recursive: true });
    await writeFile(join(dir, '.keel/night/plan.json'), JSON.stringify(plan));
    git(['add', '-f', '.keel/night/plan.json']);
    git(['commit', '-q', '-m', 'acme plan']);
    git(['push', '-q', 'origin', 'HEAD:refs/heads/keel-night-plan']);
    git(['checkout', '-q', '-f', 'main']);
    await rm(join(dir, '.keel/night'), { recursive: true, force: true });
  }
  const tip = ref => git(['rev-parse', ref], origin);
  const show = () => JSON.parse(git(['show', 'refs/heads/keel-night-plan:.keel/night/plan.json'], origin));
  return { dir, origin, git, tip, show, temp };
}

const plannedTonight = () => designPlan([
  designItem({ id: 'climb-tests', lane: 'climb:test-time', budget: null, result: null }),
  designItem({ id: 'climb-build', lane: 'climb:build-time', budget: null, result: null }),
  designItem({ id: 'robot-12', source: 'robot:#12', lane: 'robot:#12', budget: null, result: null }),
  designItem({ id: 'robot-13', source: 'robot:#13', lane: 'robot:#13', budget: null, result: null }),
]);

/** Run one workflow's "Tick tonight's plan" step in `dir`, as the workflow has it. */
async function tickStep(workflow, dir, env) {
  const text = await readFile(join(PLATES, 'practices/climb/files/.github/workflows', workflow), 'utf8');
  const block = runBlocks(text).find(b => b.step === 'Tick tonight\'s plan');
  assert.ok(block, `${workflow} has a Tick tonight's plan step`);
  const r = run('bash', ['-e', '-c', block.script], { cwd: dir, env: { ...process.env, GITHUB_SERVER_URL: 'https://github.com', REPO: 'acme/anvils', RUN: 'https://github.com/acme/anvils/actions/runs/5', ...env } });
  return { status: r.status, out: r.stdout + r.stderr };
}

test('each pass ticks its item running, then done with the PR link or failed with the reason, on the plan branch', async t => {
  const { dir, git, tip, show, temp } = await planRemote(t, plannedTonight());
  const main = tip('refs/heads/main'), first = tip('refs/heads/keel-night-plan');
  await mkdir(join(temp, 'plan'), { recursive: true });
  // Climb's publish job: its item ran and opened PR 21; the other climb item was skipped, saying why.
  await writeFile(join(temp, 'plan/pick.json'), JSON.stringify({ job: 'test-time', plan: { used: true, date: NIGHT, item: 'climb-tests', skipped: [{ id: 'climb-build', note: 'climb runs one job a night, and tonight\'s plan named climb-tests first' }] } }));
  const climbTick = await tickStep('plates-climb.yml', dir, { RUNNER_TEMP: temp, DAY: NIGHT, JUDGED: 'success', OPENED: 'success', PR: '21', LINE: 'climb test-time 2026-10-15: kept 1; Acme tests 12% faster' });
  assert.equal(climbTick.status, 0, climbTick.out);
  assert.match(climbTick.out, /ticked on keel-night-plan \([0-9a-f]{7}\): climb-build planned → skipped, climb-tests planned → running, climb-tests running → done/);
  let plan = show();
  const byId = id => plan.items.find(i => i.id === id);
  assert.deepEqual([byId('climb-tests').status, byId('climb-tests').result], ['done', { note: 'climb test-time 2026-10-15: kept 1; Acme tests 12% faster', link: 'https://github.com/acme/anvils/pull/21' }]);
  assert.deepEqual([byId('climb-build').status, byId('climb-build').result.note], ['skipped', 'climb runs one job a night, and tonight\'s plan named climb-tests first']);
  assert.deepEqual(['robot-12', 'robot-13'].map(id => byId(id).status), ['planned', 'planned'], 'only climb\'s items moved');
  // One commit on top of the shaped plan: its history keeps the owner's plan, and main never moves.
  assert.equal(git(['rev-parse', 'refs/heads/keel-night-plan^'], join(dir, '..', 'origin.git')), first);
  assert.equal(tip('refs/heads/main'), main, 'the plan branch is never main');
  // The robot's publish job: its item's judge failed, so no PR; a planned issue it refused is failed with why.
  await writeFile(join(temp, 'plan/robot-plan.json'), JSON.stringify({ state: 'ready', nightPlan: { used: true, applies: true, date: NIGHT, item: 'robot-12', ticks: [{ id: 'robot-13', status: 'failed', note: 'the robot refused #13: rubric: acceptance is missing' }], willNotTouch: [] } }));
  const robotTick = await tickStep('plates-robot.yml', dir, { RUNNER_TEMP: temp, DAY: NIGHT, PUBLISHED: 'success', JUDGED: 'failure', PR: '' });
  assert.equal(robotTick.status, 0, robotTick.out);
  plan = show();
  assert.deepEqual([byId('robot-12').status, byId('robot-12').result], ['failed', { note: 'the robot built no candidate that passed its judge (the judge ended failure)', link: 'https://github.com/acme/anvils/actions/runs/5' }]);
  assert.deepEqual([byId('robot-13').status, byId('robot-13').result.note], ['failed', 'the robot refused #13: rubric: acceptance is missing']);
  assert.equal(byId('climb-tests').status, 'done', 'the robot\'s ticks sit on top of climb\'s, never over them');
  // A re-run of climb that kept nothing: running is refused for a done item and named; it stays done.
  const rerun = await tickStep('plates-climb.yml', dir, { RUNNER_TEMP: temp, DAY: NIGHT, JUDGED: 'success', OPENED: 'skipped', PR: '', LINE: 'climb test-time: kept nothing' });
  assert.equal(rerun.status, 0, rerun.out);
  assert.match(rerun.out, /::warning::climb-tests not ticked running: "climb-tests" is done; a done item never moves back/);
  plan = show();
  assert.equal(byId('climb-tests').status, 'done');
});

test('a pass never ticks another night\'s plan, records nothing without a plan branch, and retries a push that lost a race', async t => {
  const { record, passTicks } = await import('../lib/night-plan.mjs');
  const ticks = passTicks({ item: 'climb-tests', prUrl: 'https://github.com/acme/anvils/pull/21', done: 'kept 1' });
  assert.deepEqual(ticks.map(x => x.status), ['running', 'done']);
  assert.deepEqual(passTicks({ item: 'robot-12', failed: 'line one\nline two', runUrl: 'https://github.com/acme/anvils/actions/runs/5' }).at(-1), { id: 'robot-12', status: 'failed', note: 'line one line two', link: 'https://github.com/acme/anvils/actions/runs/5' });
  // No plan branch: nothing recorded, never an error.
  const bare = await planRemote(t, null);
  assert.deepEqual(await record({ root: bare.dir, date: NIGHT, ticks }), { recorded: false, why: 'no plan branch keel-night-plan: nothing to tick', ticked: [], refused: [] });
  // Tomorrow's plan, shaped since: it is not this pass's to tick.
  const later = await planRemote(t, { ...plannedTonight(), date: '2026-10-16' });
  const before = later.tip('refs/heads/keel-night-plan');
  const other = await record({ root: later.dir, date: NIGHT, ticks });
  assert.equal(other.recorded, false);
  assert.match(other.why, /dated 2026-10-16, not 2026-10-15: it is another night's/);
  assert.equal(later.tip('refs/heads/keel-night-plan'), before);
  // A race: someone pushes the plan branch between this pass's fetch and its push. The lease refuses
  // the stale push, and the pass ticks again on top of the new tip, keeping both.
  const { dir, origin, show, temp } = await planRemote(t, plannedTonight());
  const racer = join(temp, 'racer');
  assert.equal(run('git', ['clone', '-q', '-b', 'keel-night-plan', origin, racer]).status, 0);
  const owner = { ...plannedTonight(), leftOpen: ['the owner added this line during the race'] };
  await writeFile(join(racer, '.keel/night/plan.json'), JSON.stringify(owner));
  assert.equal(run('git', ['-C', racer, 'commit', '-qam', 'acme: the owner edits the plan']).status, 0);
  const bin = join(temp, 'bin'), mark = join(temp, 'raced');
  await mkdir(bin, { recursive: true });
  const real = run('sh', ['-c', 'command -v git']).stdout.trim();
  await writeFile(join(bin, 'git'), `#!/bin/sh\ncase " $* " in *" push --porcelain "*) if [ ! -f "${mark}" ]; then touch "${mark}"; "${real}" -C "${racer}" push -q origin HEAD:refs/heads/keel-night-plan || exit 7; fi;; esac\nexec "${real}" "$@"\n`, { mode: 0o755 });
  const raced = await record({ root: dir, date: NIGHT, ticks, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  assert.equal(raced.recorded, true, JSON.stringify(raced));
  assert.ok(existsSync(mark), 'the race happened');
  const after = show();
  assert.deepEqual(after.leftOpen, ['the owner added this line during the race'], 'the owner\'s push is kept (mutation: a plain force push loses it)');
  assert.equal(after.items.find(i => i.id === 'climb-tests').status, 'done');
  assert.equal(run('git', ['rev-parse', 'refs/heads/keel-night-plan^'], { cwd: origin }).stdout.trim(), run('git', ['-C', racer, 'rev-parse', 'HEAD']).stdout.trim());
});

// Review of phase 74 (PR #144): a build no pass takes. Lane night only measures.
test('the validator refuses a build item in lane night: the night measures and never builds', () => {
  const r = validatePlan(designPlan([designItem({ id: 'night-build', lane: 'night' })]));
  assert.equal(r.ok, false);
  assert.match(r.problems.join('\n'), /items\[0\] \(night-build\): a build item names the pass that builds it; lane night only measures/);
  for (const lane of ['climb:perf', 'robot:#12']) assert.deepEqual(validatePlan(designPlan([designItem({ lane })])).problems, [], lane);
  assert.deepEqual(validatePlan(designPlan([designItem({ kind: 'review', lane: 'night' })])).problems, [], 'a review in lane night is the night\'s own');
});

// Phase 78: a night that ran plates's default plan records it on the plan branch, so the passes tick it.
const defaultTonight = () => designPlan([
  designItem({ id: 'measures', kind: 'measure', source: 'default', lane: 'night', number: null, budget: null, status: 'done', result: { note: '40 ok' } }),
  designItem({ id: 'climb-tests', source: 'default', lane: 'climb:test-time', budget: null, result: null }),
], { shapedBy: 'default', readyBy: null, willNotTouch: [], settledToday: [], leftOpen: [] });

test('a night with no owner plan writes its default plan to the plan branch, and the passes tick it; an owner\'s plan, tonight\'s or later, is never replaced', async t => {
  const { publishDefault, writePlan } = await import('../lib/night-plan.mjs');
  const publish = (dir, env) => run(process.execPath, [join(dir, 'scripts/plates/night-plan.mjs'), 'publish', '--date', NIGHT, '--json'], { cwd: dir, env: { ...process.env, ...env } });
  // No plan branch: created, the default plan alone, no parent.
  const fresh = await planRemote(t, null);
  await writePlan(fresh.dir, defaultTonight());
  const made = publish(fresh.dir);
  assert.equal(made.status, 0, made.stderr + made.stdout);
  assert.equal(JSON.parse(made.stdout).written, true);
  assert.deepEqual(fresh.show(), defaultTonight());
  assert.equal(fresh.git(['rev-list', '--count', 'refs/heads/keel-night-plan'], fresh.origin), '1');
  assert.equal(fresh.git(['ls-tree', '-r', '--name-only', 'refs/heads/keel-night-plan'], fresh.origin), '.keel/night/plan.json');
  // Climb's pass ticks it, exactly as it ticks an owner's plan (mutation: no publish, and there is nothing to tick).
  await mkdir(join(fresh.temp, 'plan'), { recursive: true });
  await writeFile(join(fresh.temp, 'plan/pick.json'), JSON.stringify({ job: 'test-time', plan: { used: true, date: NIGHT, item: 'climb-tests', skipped: [] } }));
  const climbTick = await tickStep('plates-climb.yml', fresh.dir, { RUNNER_TEMP: fresh.temp, DAY: NIGHT, JUDGED: 'success', OPENED: 'success', PR: '21', LINE: 'climb test-time: kept 1' });
  assert.equal(climbTick.status, 0, climbTick.out);
  assert.deepEqual(fresh.show().items.find(i => i.id === 'climb-tests').status, 'done');
  // A rerun of the night: tonight's plan is there (with its ticks), so nothing is written over it.
  const ticked = fresh.tip('refs/heads/keel-night-plan');
  const rerun = await publishDefault({ root: fresh.dir, date: NIGHT });
  assert.deepEqual([rerun.written, fresh.tip('refs/heads/keel-night-plan')], [false, ticked]);
  assert.match(rerun.why, /holds the plan for 2026-10-15, shaped by default: never replaced/);

  // The owner's plan for tonight, or a later night: never replaced.
  for (const date of [NIGHT, '2026-10-16']) {
    const owned = await planRemote(t, { ...plannedTonight(), date });
    await writePlan(owned.dir, defaultTonight());
    const before = owned.tip('refs/heads/keel-night-plan');
    const r = await publishDefault({ root: owned.dir, date: NIGHT });
    assert.equal(r.written, false, date);
    assert.match(r.why, new RegExp(`holds the plan for ${date}, shaped by owner: never replaced`));
    assert.equal(owned.tip('refs/heads/keel-night-plan'), before);
  }
  // An earlier night's plan (that night is over and in its record): tonight's default goes on top, the old one kept as its parent.
  const old = await planRemote(t, { ...plannedTonight(), date: '2026-10-14' });
  await writePlan(old.dir, defaultTonight());
  const parent = old.tip('refs/heads/keel-night-plan');
  const over = await publishDefault({ root: old.dir, date: NIGHT });
  assert.equal(over.written, true, over.why);
  assert.equal(old.tip('refs/heads/keel-night-plan^'), parent);
  assert.equal(old.show().date, NIGHT);
  // A plan that cannot be read is left alone, never replaced.
  const unread = await planRemote(t, { ...plannedTonight(), mood: 'calm' });
  await writePlan(unread.dir, defaultTonight());
  const kept = unread.tip('refs/heads/keel-night-plan');
  assert.match((await publishDefault({ root: unread.dir, date: NIGHT })).why, /cannot be read or is refused: it is left alone/);
  assert.equal(unread.tip('refs/heads/keel-night-plan'), kept);
  // Only tonight's default plan is written: the owner's working plan, or another night's, never.
  const own = await planRemote(t, null);
  await writePlan(own.dir, { ...defaultTonight(), shapedBy: 'owner' });
  assert.match((await publishDefault({ root: own.dir, date: NIGHT })).why, /tonight's plan is the owner's/);
  await writePlan(own.dir, { ...defaultTonight(), date: '2026-10-14' });
  assert.match((await publishDefault({ root: own.dir, date: NIGHT })).why, /the working plan is for 2026-10-14, not 2026-10-15: never another night's/);
  assert.equal(run('git', ['rev-parse', '--verify', '-q', 'refs/heads/keel-night-plan'], { cwd: own.origin }).status, 1, 'nothing pushed');

  // A race: the owner's /goodnight lands tonight's plan between the night's read and its push. The lease
  // refuses the stale push; read again, the branch holds the owner's plan, which is kept.
  const raced = await planRemote(t, { ...plannedTonight(), date: '2026-10-14' });
  await writePlan(raced.dir, defaultTonight());
  const racer = join(raced.temp, 'racer');
  assert.equal(run('git', ['clone', '-q', '-b', 'keel-night-plan', raced.origin, racer]).status, 0);
  await writeFile(join(racer, '.keel/night/plan.json'), JSON.stringify(plannedTonight()));
  assert.equal(run('git', ['-C', racer, 'commit', '-qam', 'acme: the owner shapes tonight']).status, 0);
  const bin = join(raced.temp, 'bin'), mark = join(raced.temp, 'raced');
  await mkdir(bin, { recursive: true });
  const real = run('sh', ['-c', 'command -v git']).stdout.trim();
  await writeFile(join(bin, 'git'), `#!/bin/sh\ncase " $* " in *" push --porcelain "*) if [ ! -f "${mark}" ]; then touch "${mark}"; "${real}" -C "${racer}" push -q origin HEAD:refs/heads/keel-night-plan || exit 7; fi;; esac\nexec "${real}" "$@"\n`, { mode: 0o755 });
  const lost = await publishDefault({ root: raced.dir, date: NIGHT, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  assert.ok(existsSync(mark), 'the race happened');
  assert.equal(lost.written, false, 'mutation: a plain force push writes over the owner\'s plan');
  assert.deepEqual(raced.show(), plannedTonight(), 'the owner\'s plan stands');
});

// plates#147: the owner reshaped the plan while a pass ran, keeping an id; the old item's ticks never land on the new one.
test('a tick carries the item as its pass admitted it, and one whose item kept its id but changed lane or number is refused, naming why', async t => {
  const NUMBER = { measure: 'bundle_bytes', bound: 747000, better: 'lower' };
  // Reshaped since the robot admitted it: robot-12 is now issue #14's, and climb-build measures another number.
  const reshaped = designPlan([
    designItem({ id: 'climb-tests', lane: 'climb:test-time', budget: null, result: null }),
    designItem({ id: 'climb-build', lane: 'climb:build-time', number: { ...NUMBER, bound: 700000 }, budget: null, result: null }),
    designItem({ id: 'robot-12', source: 'robot:#14', lane: 'robot:#14', budget: null, result: null }),
  ]);
  const { dir, show, temp } = await planRemote(t, reshaped);
  await mkdir(join(temp, 'plan'), { recursive: true });
  await writeFile(join(temp, 'plan/robot-plan.json'), JSON.stringify({ state: 'ready', nightPlan: { used: true, applies: true, date: NIGHT, item: 'robot-12', admitted: { lane: 'robot:#12', number: NUMBER }, ticks: [], willNotTouch: [] } }));
  const robotTick = await tickStep('plates-robot.yml', dir, { RUNNER_TEMP: temp, DAY: NIGHT, PUBLISHED: 'success', JUDGED: 'success', PR: '31' });
  assert.equal(robotTick.status, 0, robotTick.out);
  assert.match(robotTick.out, /::warning::robot-12 not ticked done: "robot-12" changed since the pass admitted it \(robot:#12, `bundle_bytes` ≤ 747000; now robot:#14, `bundle_bytes` ≤ 747000\)/);
  let plan = show();
  const byId = id => plan.items.find(i => i.id === id);
  assert.deepEqual([byId('robot-12').status, byId('robot-12').result], ['planned', null], 'the new item is never ticked with #12\'s outcome, so it is still admitted');
  // Climb: its own item unchanged is ticked; the item it skipped, its number changed since, is not.
  await writeFile(join(temp, 'plan/pick.json'), JSON.stringify({ job: 'test-time', plan: { used: true, date: NIGHT, item: 'climb-tests', admitted: { lane: 'climb:test-time', number: NUMBER }, skipped: [{ id: 'climb-build', note: 'climb runs one job a night', admitted: { lane: 'climb:build-time', number: NUMBER } }] } }));
  const climbTick = await tickStep('plates-climb.yml', dir, { RUNNER_TEMP: temp, DAY: NIGHT, JUDGED: 'success', OPENED: 'success', PR: '21', LINE: 'climb test-time: kept 1' });
  assert.equal(climbTick.status, 0, climbTick.out);
  assert.match(climbTick.out, /::warning::climb-build not ticked skipped: "climb-build" changed since the pass admitted it/);
  plan = show();
  assert.deepEqual([byId('climb-tests').status, byId('climb-build').status], ['done', 'planned']);
});


test('renamed workflows read the durable legacy remote blob while working plans use Plates paths', async () => {
  const { REMOTE_PLAN, PLAN_BRANCH } = await import('../lib/night-plan.mjs');
  assert.equal(PLAN, '.plates/night/plan.json');
  assert.equal(REMOTE_PLAN, '.keel/night/plan.json');
  assert.equal(PLAN_BRANCH, 'keel-night-plan');
  for (const [practice, name] of [['night', 'night'], ['climb', 'climb'], ['climb', 'robot']]) {
    const text = await readFile(join(PLATES, `practices/${practice}/files/.github/workflows/plates-${name}.yml`), 'utf8');
    if (name === 'night') assert(text.includes('keel-night-plan:.keel/night/plan.json'));
    else assert(text.includes('contents/.keel/night/plan.json?ref=keel-night-plan'));
    assert(!text.includes('contents/.plates/night/plan.json'));
    assert(!text.includes('keel-night-plan:.plates/night/plan.json'));
  }
});
