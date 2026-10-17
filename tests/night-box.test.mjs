// A whole night in one test (keel phase 86; the design is
// docs/research/2026-10-16-verification.md, "a night in a box"). One Acme
// project with the night, climb and personas practices runs a night end to
// end, the way GitHub would run it, and the test reads what the owner would
// read: the morning's brief and the plan card.
//
//   the evening   the owner shapes tonight's plan (keel goodnight, --yes pushes it)
//   the night     keel-night.yml's own steps: Plan the night, Measure, Open the night's pull request
//   the card      keel-morning.yml after each pass: decide, then the card (the fake isocan home)
//   climb         keel-climb.yml's own steps: Read tonight's plan, Pick tonight's job, Tick tonight's plan
//   the morning   keel-morning.yml at 17:07 UTC: decide, finalize, send, the card; and once more after
//
// Each workflow step is the shipped YAML's own shell (runBlocks), run in a
// fresh clone of a bare origin with a frozen clock and no network
// (tests/helpers/night-box-preload.mjs in every node it starts), a stub gh
// on PATH (tests/helpers/night-box-gh.mjs) and the fake isocan home
// (tests/helpers/isocan.mjs) behind the card. Simulated, not run: GitHub's
// scheduling (which job follows which, each job's `if:`, artifacts between
// jobs: the test asserts the `if:` text it simulates), the climb agent and
// its judge (the publish job's tick step is handed their outcome), and the
// card's CI provisioning (pinned keel and isocan, the journal restore; that
// is tests/morning.test.mjs's): the card publishes through keel's own
// publishPlanCard from the checkout that holds the canvas manifest. The
// robot and Loop join the box once the robot's sandbox is unblocked (phase
// 54). Fixtures are synthetic (Acme Anvils).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, realpath, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { run } from './helpers/run.mjs';
import { runBlocks } from './helpers/workflows.mjs';
import { fixture as isocanHome } from './helpers/isocan.mjs';
import { goodnight } from '../lib/goodnight.mjs';
import { publishPlanCard, planCard, titleOf, PLAN_CARD, LABEL } from '../lib/morning.mjs';
import { PLAN, PLAN_BRANCH } from '../lib/night-plan.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRELOAD = pathToFileURL(join(KEEL, 'tests/helpers/night-box-preload.mjs')).href;
const GH = join(KEEL, 'tests/helpers/night-box-gh.mjs');
const NIGHT_YML = 'practices/night/files/.github/workflows/keel-night.yml';
const MORNING_YML = 'practices/night/files/.github/workflows/keel-morning.yml';
const CLIMB_YML = 'practices/climb/files/.github/workflows/keel-climb.yml';

// The frozen clock: one night, UTC.
const NIGHT = '2026-10-05';
const AT = {
  evening: '2026-10-04T21:30:00Z', // the owner's /goodnight: after 07:23 UTC, so the plan is for the next night
  night: '2026-10-05T07:23:00Z', // keel-night's cron
  afterNight: '2026-10-05T07:41:00Z', // keel-morning, started by keel-night finishing
  climb: '2026-10-05T10:17:00Z', // keel-climb's cron
  afterClimb: '2026-10-05T11:52:00Z', // keel-morning, started by keel-climb finishing
  morning: '2026-10-05T17:07:00Z', // keel-morning's own cron, just after the default readyBy
  again: '2026-10-06T03:10:00Z', // keel-morning once more: a pass finishing after midnight UTC, before the next night starts
};
const READY_BY = `${NIGHT}T17:00:00Z`;
const REPO = 'acme/anvils';
const OWNER = 'acme-owner';
const CLIMB_PR = `https://github.com/${REPO}/pull/21`;
const CLIMB_LINE = 'slow_tests 2 → 0: the two slow anvil tests share one fixture';

const digest = s => createHash('sha256').update(s).digest('hex');

/** One stage of the night: a failure in it (its run or its checks) is named by the stage. */
async function stage(name, fn) {
  const started = Date.now();
  try { return await fn(); } catch (e) { throw new Error(`[${name}] ${e.message}`, { cause: e }); }
  finally { TIMES.push([name, Date.now() - started]); }
}
const TIMES = [];

// ---- the box ------------------------------------------------------------------

const PERSONA = `---
name: perf
description: Whether Acme's anvils still feel fast.
goal:
  - name: bundle size
    at most: 250000
    measured by: node -e "console.log(260000)"
---

Acme's performance lens.
`;
const REVIEW = `# perf — 2026-10-04

| Goal | Bound | Now | Verdict |
| --- | --- | --- | --- |
| bundle size | at most 250000 | 260000 | **missed** |
`;
// Last night's page, as improve wrote it: slow_tests outside, so climb's test-time job has a number.
const LAST_PAGE = `# Acme Anvils health — 2026-10-04

| Measure | Value | Bound | State | Detail |
| --- | --- | --- | --- | --- |
| \`gate\` — the check passes | 0 | ≤ 0 | ok | node -e exit 0 |
| \`slow_tests\` — tests slower than their median | 2 | ≤ 0 | outside | two anvil tests |
| \`build_time\` — the build's wall time | 52000 | ≤ 60000 | ok | the build |
`;

/**
 * Breaking one stage, as a shipped script could break it: the fixture's
 * copy of a managed script, patched before the night (the plan, the tick,
 * finalize, send), or the card's write never reaching the canvas.
 */
const BREAKS = Object.freeze({
  plan: { file: 'scripts/keel/night-plan.mjs', from: '        await writePlan(root, shaped);\n', to: '' },
  tick: { file: 'scripts/keel/night-plan.mjs', from: 'if (prUrl && isLink(prUrl)) ticks.push(', to: 'if (false) ticks.push(' },
  finalize: { file: 'scripts/keel/morning.mjs', from: 'written.push(await writeRecord(root, found.plan));', to: 'written.push(recordOf(night));' },
  send: { file: 'scripts/keel/morning.mjs', from: 'const same = issues.find(i => i.title === title);', to: 'const same = issues.find(i => i.title !== title);' },
  card: null,
});

/**
 * Acme Anvils on a bare origin: the owner's checkout is the fake isocan
 * home's root (bound, live, night-plan among its live cards, set for nightly
 * publishing), with the night, climb and personas practices' scripts, last
 * night's health page, a persona whose goal was missed, climb's test-time and
 * build-time jobs (the build is broken tonight), the robot on, and yesterday's
 * brief still open. The stub gh and a date that says tonight are first on PATH.
 */
async function box(t, { broken = null } = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'keel-night-box-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const f = await isocanHome(t);
  await f.attach();
  await f.goLive({ cards: ['pulse', PLAN_CARD] });
  const root = await realpath(f.root);
  // Every version the card took, as its source reached the canvas.
  const versions = [];
  f.remote.beforeAdd = async card => { if (card.properties?.['keel.key'] === PLAN_CARD) versions.push({ via: 'add', source: await readFile(card.sourcePath, 'utf8') }); };
  f.remote.afterEdit = async sent => { versions.push({ via: 'edit', source: await readFile(sent.sourcePath, 'utf8') }); };

  const config = JSON.parse(await readFile(join(root, '.keel/keel.json'), 'utf8'));
  await writeFile(join(root, '.keel/keel.json'), `${JSON.stringify({
    name: 'Acme Anvils', repo: REPO, practices: ['base', 'night', 'climb', 'personas'],
    check: 'node -e "process.exit(0)"',
    climb: { jobs: ['test-time', 'build-time'], testCommand: 'node -e ""', build: 'node -e "process.exit(3)"', buildOutput: 'dist', budget: { minutes: 40 } },
    robot: { on: true, budgetMinutes: 60 },
    morning: { assignee: OWNER },
    canvas: { ...config.canvas, cadence: 'nightly' },
  }, null, 2)}\n`);
  await mkdir(join(root, 'scripts/keel'), { recursive: true });
  for (const p of ['night', 'climb', 'personas']) await cp(join(KEEL, 'practices', p, 'files', 'scripts', 'keel'), join(root, 'scripts', 'keel'), { recursive: true });
  for (const [path, text] of Object.entries({
    '.gitignore': '.keel/canvas/\n.isocan/\n',
    '.agents/personas/perf.md': PERSONA,
    'docs/reviews/2026-10-04-perf.md': REVIEW,
    'docs/health/2026-10-04.md': LAST_PAGE,
  })) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text); }
  const brk = broken ? BREAKS[broken] : null;
  if (broken && !(broken in BREAKS)) throw new Error(`no stage ${broken} to break`);
  if (brk) {
    const p = join(root, brk.file), text = await readFile(p, 'utf8');
    assert.ok(text.includes(brk.from), `the ${broken} break still applies to ${brk.file}`);
    await writeFile(p, text.replace(brk.from, brk.to));
  }
  const origin = join(base, 'origin.git');
  const git = (cwd, ...args) => { const r = run('git', args, { cwd }); assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
  git(base, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'Acme Anvils');
  git(root, 'remote', 'add', 'origin', origin);
  git(root, 'push', '-q', 'origin', 'main');

  // GitHub: yesterday's brief open, nothing else; the next PR is #20 (the night's), then #21 (climb's).
  const state = join(base, 'gh-state.json'), log = join(base, 'gh.log');
  await writeFile(state, JSON.stringify({ issues: [{ number: 30, title: titleOf('2026-10-04'), state: 'OPEN', label: LABEL, assignee: OWNER }], prs: [], nextIssue: 31, nextPr: 20 }));
  await writeFile(log, '');
  const bin = join(base, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'gh'), `#!/bin/sh\nexec "${process.execPath}" "${GH}" "$@"\n`);
  // keel-night's Plan the night dates the night with `date -u +%F`: the frozen day.
  await writeFile(join(bin, 'date'), '#!/bin/sh\nif [ "$1 $2" = "-u +%F" ]; then echo "$KEEL_BOX_DAY"; exit 0; fi\nexec /bin/date "$@"\n');
  await chmod(join(bin, 'gh'), 0o755);
  await chmod(join(bin, 'date'), 0o755);

  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GITHUB_|RUNNER_|KEEL_GH$|NODE_OPTIONS$)/.test(k)));
  /** The world at `now`: a runner's environment, the stub gh, the frozen clock, no network. */
  const world = now => ({
    ...clean, PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH}`, TZ: 'UTC', CI: 'true',
    KEEL_GH: join(bin, 'gh'), KEEL_BOX_GH_STATE: state, KEEL_BOX_GH_LOG: log, KEEL_BOX_ORIGIN: origin,
    KEEL_BOX_NOW: now, KEEL_BOX_DAY: now.slice(0, 10), NODE_OPTIONS: `--import=${PRELOAD}`,
    GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: REPO, GITHUB_SERVER_URL: 'https://github.com', GITHUB_RUN_ID: '7001', GITHUB_RUN_ATTEMPT: '1',
  });
  let jobs = 0;
  /** A job's fresh checkout of main and its runner temp. */
  const job = async name => {
    const at = join(base, `${String(++jobs).padStart(2, '0')}-${name}`);
    git(base, 'clone', '-q', origin, at);
    const temp = join(base, `${String(jobs).padStart(2, '0')}-${name}-temp`);
    await mkdir(temp);
    return { dir: at, temp };
  };
  const texts = {};
  /** One named step of a shipped workflow, its own shell, in `j`'s checkout at `now`: { status, out, outputs }. */
  const step = async (yml, name, j, now, env = {}) => {
    texts[yml] ??= await readFile(join(KEEL, yml), 'utf8');
    const blocks = runBlocks(texts[yml]).filter(b => b.step === name);
    assert.equal(blocks.length, 1, `${yml} has one step "${name}"`);
    const output = join(j.temp, `output-${Math.random().toString(36).slice(2)}`);
    await writeFile(output, '');
    const r = run('bash', ['-e', '-c', blocks[0].script], { cwd: j.dir, env: { ...world(now), RUNNER_TEMP: j.temp, GITHUB_OUTPUT: output, GITHUB_ENV: join(j.temp, 'env'), ...env } });
    const outputs = Object.fromEntries((await readFile(output, 'utf8')).split('\n').filter(l => /^\w+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    return { status: r.status, out: r.stdout + r.stderr, outputs };
  };
  const ghState = async () => JSON.parse(await readFile(state, 'utf8'));
  const ghCalls = async () => (await readFile(log, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l).a);
  /** A file on a branch of the origin, or null. */
  const onOrigin = (branch, path) => { const r = run('git', ['--git-dir', origin, 'show', `refs/heads/${branch}:${path}`]); return r.status === 0 ? r.stdout : null; };
  const planOn = branch => JSON.parse(onOrigin(branch, branch === PLAN_BRANCH ? PLAN : `docs/night/${NIGHT}.json`) ?? 'null');
  return { base, root, origin, f, versions, broken, world, job, step, ghState, ghCalls, onOrigin, planOn, texts };
}

// ---- the night ----------------------------------------------------------------

const item = (plan, id) => plan?.items.find(i => i.id === id);
const statusOf = plan => Object.fromEntries((plan?.items ?? []).map(i => [i.id, i.status]));
/** A markdown document's sections by their ## heading: { heading: body }. */
const sections = md => Object.fromEntries(md.split(/^## /m).slice(1).map(s => [s.slice(0, s.indexOf('\n')).trim(), s.slice(s.indexOf('\n') + 1).trim()]));
/** The plan card's row for an item: its status and outcome cells. */
const row = (source, id) => { const l = source.split('\n').find(x => x.startsWith(`| ${id}: `)); if (!l) return null; const c = l.split(' | '); return { status: c.at(-2), outcome: c.at(-1).replace(/ \|$/, '') }; };

/**
 * keel-morning.yml, as GitHub runs it at `now`: decide, then each job its
 * `if:` lets run. Returns what each did. The card is keel's own publishPlanCard
 * on the owner's checkout (the one the fake isocan home's manifest lives in).
 */
async function morning(b, now, label) {
  // decide, send and the card's gate only read their checkout, so they share one; finalize, which commits, has its own.
  const reads = await b.job(`${label}-decide`);
  const decide = await b.step(MORNING_YML, 'Is the night over?', reads, now);
  assert.equal(decide.status, 0, `decide: ${decide.out}`);
  const o = decide.outputs;
  const text = b.texts[MORNING_YML];
  // The scheduling this simulates is the workflow's own: each condition is asserted to be what the YAML says.
  for (const cond of ["if: needs.decide.outputs.ready == 'true'\n", "if: needs.decide.outputs.ready == 'true' && needs.decide.outputs.sent != 'true' && needs.decide.outputs.assignee == 'set'\n", "if: needs.decide.outputs.plan == 'found' && (github.event_name != 'workflow_run' || github.event.workflow_run.head_branch == github.event.repository.default_branch)\n"]) {
    assert.ok(text.includes(cond), `keel-morning.yml still says ${cond.trim()}`);
  }
  const did = { decide: o };
  if (o.ready === 'true') {
    did.finalize = await b.step(MORNING_YML, 'Open the night\'s final pull request', await b.job(`${label}-finalize`), now, { DAY: o.day, BASE: 'main' });
    if (o.sent !== 'true' && o.assignee === 'set') did.send = await b.step(MORNING_YML, 'Send the brief', reads, now, { DAY: o.day });
  }
  if (o.plan === 'found') {
    const gate = await b.step(MORNING_YML, 'Is the card set up?', reads, now);
    assert.equal(gate.status, 0, gate.out);
    assert.equal(gate.outputs.enabled, 'true', `the card is set up: ${gate.out}`);
    did.card = await publishPlanCard({ root: b.root, date: o.day, yes: true, dryRun: b.broken === 'card', env: b.world(now), now: new Date(now) }, { transport: b.f.transport });
  }
  return did;
}

/** The last version the plan card took, checked against what the canvas holds. */
async function lastCard(b) {
  const manifest = JSON.parse(await readFile(join(b.root, '.keel/canvas/manifest.json'), 'utf8'));
  const id = manifest.items[PLAN_CARD]?.itemId;
  assert.ok(id, 'the canvas has the plan card');
  const card = b.f.remote.items.get(id);
  const last = b.versions.at(-1);
  assert.ok(last, 'the plan card has a version');
  assert.equal(card.versions.at(-1).blobHash, digest(last.source), 'the canvas holds the version the card was sent');
  return { card, source: last.source };
}

/** The whole night, stage by stage; each stage's checks run as it ends. Returns what the owner sees. */
async function night(t, options) {
  const b = await box(t, options);
  const started = Date.now();

  // The evening and the night's plan: the owner shapes tonight's plan and says it; the night reads it from the branch and writes it.
  await stage('plan', async () => {
    const env = b.world(AT.evening);
    const deps = { now: new Date(AT.evening), board: async () => ({ items: [], sources: [] }) };
    const say = args => goodnight({ root: b.root, args, env }, deps);
    const opening = await say([]);
    assert.equal(opening.data.night, NIGHT, 'the evening shapes the next night');
    assert.ok(item(opening.data.plan, 'climb-test-time'), 'keel\'s default plan names the climb job pick would choose');
    assert.equal(item(opening.data.plan, 'persona-perf--bundle-size')?.kind, 'triage', 'the persona\'s missed goal is triage: no climb job measures it');
    await say(['drop', 'persona-perf--bundle-size']);
    await say(['add', '--title', 'Builds back under a minute', '--measure', 'build_time', '--bound', '60000', '--id', 'climb-build-time']);
    await say(['add', '--title', 'Robot: #12 faster anvil search', '--measure', 'slow_tests', '--bound', '0', '--lane', 'robot:#12', '--id', 'robot-12']);
    const said = await say(['--yes']);
    assert.equal(said.data.pushed.branch, PLAN_BRANCH);
    const shaped = b.planOn(PLAN_BRANCH);
    assert.deepEqual([shaped.date, shaped.shapedBy], [NIGHT, 'owner'], 'the owner\'s plan is on the plan branch');

    const j = await b.job('night');
    b.night = j;
    const planned = await b.step(NIGHT_YML, 'Plan the night', j, AT.night);
    assert.equal(planned.status, 0, planned.out);
    assert.deepEqual([planned.outputs.code, planned.outputs.day], ['0', NIGHT], planned.out);
    assert.match(planned.out, /Tonight's plan \(2026-10-05\) is the one on keel-night-plan, shaped by owner\./);
    assert.ok(existsSync(join(j.dir, PLAN)), `the night wrote tonight's plan to ${PLAN} before anything ran`);
    const written = JSON.parse(await readFile(join(j.dir, PLAN), 'utf8'));
    assert.deepEqual(written, shaped, 'the night runs the owner\'s plan, as it was said');
    assert.deepEqual(statusOf(written), { measures: 'planned', 'climb-test-time': 'planned', 'climb-build-time': 'planned', 'robot-12': 'planned' });
  });

  // The night measures (the build is broken: an instrument that breaks fails the measure item) and opens its data-only PR.
  await stage('measure', async () => {
    const measured = await b.step(NIGHT_YML, 'Measure', b.night, AT.night);
    assert.equal(measured.outputs.day, NIGHT, measured.out);
    const pr = await b.step(NIGHT_YML, 'Open the night\'s pull request', b.night, AT.night, { DAY: measured.outputs.day, PLAN_DAY: NIGHT, BASE: 'main', HEALTH: 'docs/health' });
    assert.equal(pr.status, 0, pr.out);
    assert.match(pr.out, /the default plan is not written to keel-night-plan: tonight's plan is the owner's/);
    const record = b.planOn(`keel-night/${NIGHT}`);
    assert.ok(record, `the night's PR branch carries docs/night/${NIGHT}.json`);
    assert.equal(item(record, 'measures').status, 'failed', 'a broken instrument fails the measure item');
    assert.match(item(record, 'measures').result.note, /broken \(.*build_time.*\)/, 'and says which one');
    assert.ok(b.onOrigin(`keel-night/${NIGHT}`, `docs/health/${NIGHT}.md`), 'with tonight\'s health page');
    assert.deepEqual((await b.ghState()).prs.map(p => [p.number, p.headRefName]), [[20, `keel-night/${NIGHT}`]], 'one night PR');
  });

  // keel-morning after the night: not over, so nothing is sent; the card is made from the plan as it stands.
  await stage('card', async () => {
    const did = await morning(b, AT.afterNight, 'after-night');
    assert.deepEqual([did.decide.ready, did.decide.plan, did.finalize, did.send], ['false', 'found', undefined, undefined], 'the night is not over');
    assert.equal(did.card.exitCode ?? 0, 0, JSON.stringify(did.card.data));
    const { source } = await lastCard(b);
    assert.equal(row(source, 'measures')?.status, 'failed', 'the card shows the night\'s measure item failed');
    assert.equal(row(source, 'climb-test-time')?.status, 'planned');
  });

  // Climb: it reads tonight's plan through the contents API, runs the plan's first climb item, and its publish job ticks it.
  await stage('tick', async () => {
    const j = await b.job('climb');
    const read = await b.step(CLIMB_YML, 'Read tonight\'s plan', j, AT.climb, { REPO });
    assert.equal(read.status, 0, read.out);
    assert.match(read.out, /tonight's plan: read from keel-night-plan/);
    const picked = await b.step(CLIMB_YML, 'Pick tonight\'s job', j, AT.climb, { EVENT: 'schedule' });
    assert.equal(picked.status, 0, picked.out);
    assert.deepEqual([picked.outputs.job, picked.outputs.plan_used, picked.outputs.plan_ticks, picked.outputs.day], ['test-time', 'true', 'true', NIGHT], picked.out);
    // The agent and its judge (simulated): a change kept, and the publish job opened its PR, #21.
    const s = JSON.parse(await readFile(join(b.base, 'gh-state.json'), 'utf8'));
    s.prs.push({ number: s.nextPr++, headRefName: `keel-climb/test-time/${NIGHT}`, baseRefName: 'main', title: 'keel climb: test-time', state: 'OPEN', isCrossRepository: false, isDraft: false, createdAt: AT.climb, mergedAt: null });
    await writeFile(join(b.base, 'gh-state.json'), JSON.stringify(s));
    // The plan and the pick travel to the publish job as the artifact keel-climb-plan.
    await cp(join(j.temp, 'plan-handoff'), join(j.temp, 'plan'), { recursive: true });
    const ticked = await b.step(CLIMB_YML, 'Tick tonight\'s plan', j, AT.climb, { DAY: NIGHT, JUDGED: 'success', LINE: CLIMB_LINE, OPENED: 'success', PR: '21', REPO, RUN: `https://github.com/${REPO}/actions/runs/7002` });
    assert.equal(ticked.status, 0, ticked.out);
    const plan = b.planOn(PLAN_BRANCH);
    assert.equal(item(plan, 'climb-test-time').status, 'done', `climb ticked its item done on the plan branch: ${ticked.out}`);
    assert.deepEqual(item(plan, 'climb-test-time').result, { note: CLIMB_LINE, link: CLIMB_PR }, 'with its PR');
    assert.equal(item(plan, 'climb-build-time').status, 'skipped', 'the other climb item is skipped: one job a night');
    assert.match(item(plan, 'climb-build-time').result.note, /climb runs one job a night/);
    assert.equal(item(plan, 'robot-12').status, 'planned', 'climb never ticks the robot\'s item');
  });

  // keel-morning after climb: still not over (the robot's item is open, readyBy not passed); the card ticks in place.
  await stage('card', async () => {
    const before = b.versions.length;
    const did = await morning(b, AT.afterClimb, 'after-climb');
    assert.deepEqual([did.decide.ready, did.send], ['false', undefined], 'not over: the robot\'s item is open and readyBy has not passed');
    assert.equal(did.card.data.state, 'published', JSON.stringify(did.card.data));
    assert.equal(b.versions.length, before + 1, 'one new version');
    assert.equal(b.versions.at(-1).via, 'edit', 'the same card, edited in place');
    const { source } = await lastCard(b);
    assert.deepEqual(row(source, 'climb-test-time'), { status: 'done', outcome: `${CLIMB_LINE} — ${CLIMB_PR}` }, 'the card shows climb\'s item done, with its PR');
  });

  // The morning, at 17:07 UTC: readyBy has passed, so the night is over; finalize, send and the card.
  const at17 = await stage('finalize', async () => {
    const did = await morning(b, AT.morning, 'morning');
    assert.deepEqual([did.decide.day, did.decide.ready, did.decide.sent, did.decide.assignee], [NIGHT, 'true', 'false', 'set'], 'over at readyBy, not yet sent');
    assert.equal(did.finalize.status, 0, did.finalize.out);
    const final = b.planOn(`keel-night/${NIGHT}-final`);
    assert.ok(final, `finalize pushed keel-night/${NIGHT}-final with the night's record: ${did.finalize.out}`);
    assert.deepEqual(statusOf(final), { measures: 'failed', 'climb-test-time': 'done', 'climb-build-time': 'skipped', 'robot-12': 'planned' }, 'the record holds each item\'s final outcome');
    assert.match(b.onOrigin(`keel-night/${NIGHT}-final`, `docs/health/${NIGHT}.md`), /^\| climb-test-time: .* \| done \| .*pull\/21 \|$/m, 'and so does the health page\'s Tonight\'s plan');
    assert.ok((await b.ghState()).prs.some(p => p.headRefName === `keel-night/${NIGHT}-final` && p.state === 'OPEN'), 'as one data-only PR in the night\'s queue');
    return did;
  });

  await stage('send', async () => {
    assert.ok(at17.send, 'the send job runs');
    assert.equal(at17.send.status, 0, at17.send.out);
    const issues = (await b.ghState()).issues;
    const sent = issues.filter(i => i.title === titleOf(NIGHT));
    assert.equal(sent.length, 1, 'one brief for the night');
    assert.deepEqual([sent[0].state, sent[0].assignee, sent[0].label, sent[0].repo], ['OPEN', OWNER, LABEL, REPO], 'assigned to the owner, so GitHub emails them');
    assert.deepEqual([issues.find(i => i.number === 30).state, issues.find(i => i.number === 30).comment], ['CLOSED', `Superseded by #${sent[0].number} (keel morning).`], 'yesterday\'s brief is closed');
  });

  await stage('card', async () => {
    assert.equal(at17.card.data.state, 'unchanged', `nothing ticked since climb: no new version (${JSON.stringify(at17.card.data)})`);
  });

  // keel-morning once more: the brief is sent, so nothing is sent again; finalize finds nothing new.
  await stage('send', async () => {
    const creates = (await b.ghCalls()).filter(a => a[0] === 'issue' && a[1] === 'create').length;
    const did = await morning(b, AT.again, 'again');
    assert.deepEqual([did.decide.ready, did.decide.sent], ['true', 'true'], 'decide reads the brief as sent');
    assert.equal(did.send, undefined, 'the send job does not run');
    assert.equal(did.finalize.status, 0, did.finalize.out);
    // Its branch is pushed and the PR unmerged: nothing is committed, and the one PR is kept, never a second.
    assert.match(did.finalize.out, new RegExp(`Nothing changed since keel-night/${NIGHT}-final was pushed; making sure its PR is open\\.`));
    assert.equal((await b.ghState()).prs.filter(p => p.headRefName === `keel-night/${NIGHT}-final`).length, 1, 'one final PR');
    assert.equal(did.card.data.state, 'unchanged');
    // The 17:07 run's send job re-run by hand (GitHub keeps that run's decide, which said unsent): send's own check holds.
    const rerun = await b.step(MORNING_YML, 'Send the brief', await b.job('rerun-send'), AT.again, { DAY: NIGHT });
    assert.equal(rerun.status, 0, rerun.out);
    assert.match(rerun.out, /already sent as #31; nothing sent again\./);
    assert.equal((await b.ghCalls()).filter(a => a[0] === 'issue' && a[1] === 'create').length, creates, 'no issue is created');
  });

  const seconds = (Date.now() - started) / 1000;
  const issues = (await b.ghState()).issues;
  return { b, seconds, brief: issues.find(i => i.title === titleOf(NIGHT))?.body ?? null, issues, final: b.planOn(`keel-night/${NIGHT}-final`), card: await lastCard(b) };
}

// ---- what the owner sees --------------------------------------------------------

/**
 * The machine's pace now: ten node starts (with the box's preload) and ten
 * gits, the work the box is made of, in ms. QUIET_PACE_MS is the fastest the
 * same sample ran on a 14-core laptop (2026-10-17, docs/evidence/2026-10-17-night-in-a-box.md).
 */
const QUIET_PACE_MS = 400;
function pace() {
  const env = { ...process.env, KEEL_BOX_NOW: AT.night, NODE_OPTIONS: `--import=${PRELOAD}` };
  const started = Date.now();
  for (let i = 0; i < 10; i++) { run(process.execPath, ['-e', '0'], { env }); run('git', ['--version'], { env }); }
  return Date.now() - started;
}

test('a whole night: the brief says what was done, what failed and why, and what was not finished; one issue is sent; the card shows each item\'s final status; under 30 seconds, with no network', async t => {
  const paceBefore = pace();
  TIMES.length = 0;
  const started = Date.now();
  const n = await night(t);
  const { brief, card, final } = n;
  assert.ok(brief, 'the brief was sent');
  const s = sections(brief);
  assert.equal(brief.split('\n')[0], `# ${titleOf(NIGHT)}`);
  assert.match(brief, new RegExp(`^The night of ${NIGHT} \\(UTC\\), shaped by the owner: 1 done, 0 tried, 1 failed, 1 left alone, 1 not finished by ${READY_BY}\\.$`, 'm'));
  // Its links: the canvas, and the night's health page on GitHub where the night's record was read
  // (its PRs are unmerged, so the page is on the morning's own final branch).
  assert.match(brief, new RegExp(`^Canvas: https://acme\\.test/p/prj_acme · Health page: https://github\\.com/${REPO}/blob/keel-night/${NIGHT}-final/docs/health/${NIGHT}\\.md$`, 'm'));
  assert.deepEqual(Object.keys(s), ['Done', 'Tried', 'Failed, and why', 'Left alone', `Not finished by ${READY_BY}`, 'Your next'], 'isocan\'s order');
  // Done: climb's item, with its note and its PR.
  assert.deepEqual(s.Done.split('\n'), [`- **${item(final, 'climb-test-time').title}** (\`climb-test-time\`) — \`slow_tests\` ≤ 0 (not measured on a health page) — ${CLIMB_LINE} — ${CLIMB_PR}`]);
  assert.equal(s.Tried, 'Nothing.');
  // Failed, with its reason: the measure item, and the instrument that broke.
  assert.equal(s['Failed, and why'].split('\n').length, 1);
  assert.match(s['Failed, and why'], new RegExp(`^- \\*\\*Measure the practice: .*\\*\\* \\(\`measures\`\\) — \\d+ ok, \\d+ outside, \\d+ n/a, 1 broken \\(build_time\\) — docs/health/${NIGHT}\\.md$`));
  // Left alone: climb's other item, saying why.
  assert.deepEqual(s['Left alone'].split('\n'), ['- **Builds back under a minute** (`climb-build-time`) — `build_time` ≤ 60000 (not measured on a health page) — climb runs one job a night, and tonight\'s plan named climb-test-time first — skipped']);
  // Not finished by readyBy: the robot's item, never done.
  assert.deepEqual(s[`Not finished by ${READY_BY}`].split('\n'), [`- **Robot: #12 faster anvil search** (\`robot-12\`) — \`slow_tests\` ≤ 0 (not measured on a health page) — not finished by ${READY_BY} (still planned)`]);
  assert.deepEqual(s['Your next'].split('\n'), [
    `- Review and merge ${CLIMB_PR} (\`climb-test-time\`): a person merges.`,
    `- Look at why \`measures\` failed: ${item(final, 'measures').result.note}.`,
    `- \`robot-12\` was not finished by ${READY_BY}: its pass may still finish it, or tomorrow's plan takes it up.`,
    ...final.leftOpen.map(l => `- Left open: ${l}`),
  ]);
  // Exactly one morning issue for the night.
  assert.equal(n.issues.filter(i => i.label === LABEL && i.title === titleOf(NIGHT)).length, 1);
  assert.deepEqual(n.issues.filter(i => i.label === LABEL && i.state === 'OPEN').map(i => i.title), [titleOf(NIGHT)], 'one brief open at a time');
  // The card's last version: the plan as it finished, every item's final status, and nothing else.
  assert.equal(card.source, planCard(final).source, 'the card is the final plan');
  assert.deepEqual(Object.fromEntries(final.items.map(i => [i.id, row(card.source, i.id)?.status])), { measures: 'failed', 'climb-test-time': 'done', 'climb-build-time': 'skipped', 'robot-12': 'planned' });
  assert.equal(card.card.versions.length, 2, 'two versions: the night, then climb\'s tick (the morning changed nothing)');
  // No network: every node the night started refused the network (the preload), and the box's own probe is refused too.
  const probe = run(process.execPath, ['-e', 'require("node:net").connect(443, "github.com")'], { env: n.b.world(AT.night) });
  assert.notEqual(probe.status, 0);
  assert.match(probe.stderr, /night box: no network \(connect github\.com:443\)/);
  const seconds = (Date.now() - started) / 1000;
  // Under 30 seconds on a machine at its quiet pace: the box is processes and nothing that waits, so a
  // loaded machine (the gate's 32 files at once) slows it as it slows the pace sample, taken either side.
  const load = Math.max(1, ((paceBefore + pace()) / 2) / QUIET_PACE_MS);
  t.diagnostic(`the whole night ran in ${seconds.toFixed(1)} s, ${(seconds / load).toFixed(1)} s at the quiet pace (this machine ran ×${load.toFixed(1)} slower); stages: ${TIMES.map(([s, ms]) => `${s} ${(ms / 1000).toFixed(1)}`).join(', ')}`);
  assert.ok(seconds / load < 30, `the night runs in under 30 seconds at the quiet pace (took ${seconds.toFixed(1)} s at ×${load.toFixed(1)})`);
});

test('breaking any one stage (the plan write, the tick, finalize, send, the card) fails the night, naming the stage', async t => {
  for (const broken of Object.keys(BREAKS)) {
    await assert.rejects(night(t, { broken }), e => {
      assert.match(e.message, new RegExp(`^\\[${broken}\\] `), `breaking ${broken} is named ${broken}, not: ${e.message.slice(0, 300)}`);
      t.diagnostic(`${broken} broken: ${e.message.split('\n')[0].slice(0, 240)}`);
      return true;
    }, `breaking ${broken} fails the night`);
  }
});
