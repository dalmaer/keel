// keel goodnight (phase 74): the owner shapes tonight's plan. The opening shows
// what was settled today, what was left open, the default plan and up to three
// things to try, and changes nothing; the shaping verbs change a draft and
// refuse what breaks the plan's rules, naming why; --yes writes the plan,
// shaped by the owner, and pushes it to the plan branch, one file, never
// touching the working tree or main. Fixtures are synthetic (Acme Anvils); gh
// is a stub at the boundary and the remote is a bare repo on disk. Nothing here
// reads the live world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, realpath, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './helpers/run.mjs';
import { goodnight, suggestionsFor, namesSettled, parseArgs, DRAFT, SUGGESTIONS } from '../lib/goodnight.mjs';
import { validatePlan, tonight, nightOf, PLAN, PLAN_BRANCH } from '../lib/night-plan.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(KEEL, 'bin', 'keel.mjs');
const HOUR = 3_600_000;

const PAGE = `# Health — 2026-10-01

| Measure | Value | Bound | State | Detail |
| --- | --- | --- | --- | --- |
| \`gate\` — the check passes | 0 | ≤ 0 | ok | npm test passed |
| \`slow_tests\` — tests slower than their median | 2 | ≤ 0 | outside | two Acme tests |
| \`prs_stale\` — open PRs older than 14 days | 3 | ≤ 1 | outside | three |

## Proposal

**\`prs_stale\`** (outside) — Merge or close PR #4 (open 20 days).
`;
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
const REVIEW = `# perf — 2026-10-01

| Goal | Bound | Now | Verdict |
| --- | --- | --- | --- |
| bundle size | at most 250000 | 260000 | **missed** |
`;
const finding = (title, extra = '') => `---\ntitle: ${title}\nloop: [acme]\n${extra}---\n\nAcme's ${title}.\n`;
const PHASE = status => `---\nstatus: ${status}\nsince: 2026-10-01\ngoal: G1\n---\n\n# Anvils weigh less\n\n## Done when\n\nAcme's anvils weigh less.\n`;

/**
 * Acme Anvils: night, climb and loop scripts, a health page, Loop findings
 * (one untriaged, one accepted that names a number, one declined today), a
 * persona with a missed goal on its review page, a phase that moved from
 * planned to built today, a bare origin holding main, and a gh stub: #41
 * merged an hour ago, #39 three days ago, #42 open.
 */
async function acme(t) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'keel-goodnight-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'anvils'), origin = join(base, 'origin.git');
  const now = Date.now(), today = new Date(now).toISOString().slice(0, 10);
  const git = (args, cwd = root, env = {}) => { const r = run('git', args, { cwd, env: { ...process.env, ...env } }); assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
  for (const d of ['.keel', 'scripts/keel', 'docs/health', 'docs/loop', 'docs/phases', 'docs/reviews', '.agents/personas']) await mkdir(join(root, d), { recursive: true });
  for (const p of ['night', 'climb']) await cp(join(KEEL, 'practices', p, 'files', 'scripts', 'keel'), join(root, 'scripts', 'keel'), { recursive: true });
  await cp(join(KEEL, 'practices', 'loop', 'files', 'scripts', 'loop.mjs'), join(root, 'scripts', 'loop.mjs'));
  await writeFile(join(root, '.keel', 'keel.json'), JSON.stringify({ name: 'Acme Anvils', repo: 'acme/anvils', practices: ['base', 'night', 'climb', 'loop', 'personas'], climb: { jobs: ['test-time'], budget: { minutes: 40 } } }));
  await writeFile(join(root, 'docs/health/2026-10-01.md'), PAGE);
  await writeFile(join(root, 'docs/loop/slow-search.md'), finding('Slow search'));
  await writeFile(join(root, 'docs/loop/lighter-anvils.md'), finding('Lighter anvils', 'decision: accepted\nrank: next\nphase: 1\nsince: 2026-10-01\nnote: Brings `slow_tests` back within its bound.\n'));
  await writeFile(join(root, 'docs/loop/heavy-anvils.md'), finding('Heavy anvils', `decision: declined\nsince: ${today}\nnote: Acme wants them light.\n`));
  await writeFile(join(root, '.agents/personas/perf.md'), PERSONA);
  await writeFile(join(root, 'docs/reviews/2026-10-01-perf.md'), REVIEW);
  await writeFile(join(root, 'docs/phases/01-anvils-weigh-less.md'), PHASE('planned'));
  git(['init', '-q', '--bare', origin], base);
  git(['init', '-q', '-b', 'main']);
  git(['add', '-A']);
  const twoDays = new Date(now - 48 * HOUR).toISOString();
  git(['commit', '-q', '-m', 'Acme Anvils'], root, { GIT_AUTHOR_DATE: twoDays, GIT_COMMITTER_DATE: twoDays });
  await writeFile(join(root, 'docs/phases/01-anvils-weigh-less.md'), PHASE('built'));
  git(['commit', '-q', '-am', 'phase 1 built']);
  git(['remote', 'add', 'origin', origin]);
  git(['push', '-q', 'origin', 'main']);
  const gh = join(base, 'gh'), log = join(base, 'gh.log');
  const prs = [
    { number: 39, title: 'Acme: older work', url: 'https://github.com/acme/anvils/pull/39', mergedAt: new Date(now - 72 * HOUR).toISOString(), headRefName: 'acme/older', state: 'MERGED', isDraft: false },
    { number: 41, title: 'Acme: anvils weigh less', url: 'https://github.com/acme/anvils/pull/41', mergedAt: new Date(now - HOUR).toISOString(), headRefName: 'acme/lighter', state: 'MERGED', isDraft: false },
    { number: 42, title: 'Acme: sharper anvils', url: 'https://github.com/acme/anvils/pull/42', mergedAt: null, headRefName: 'acme/sharper', state: 'OPEN', isDraft: true },
  ];
  await writeFile(gh, `#!${process.execPath}
const fs = require('node:fs');
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + '\\n');
const prs = ${JSON.stringify(prs)};
const opt = f => a.includes(f) ? a[a.indexOf(f) + 1] : undefined;
const pick = rows => rows.map(r => Object.fromEntries(opt('--json').split(',').map(f => [f, r[f]])));
if (a[0] === 'pr' && a[1] === 'list') {
  const want = opt('--state');
  console.log(JSON.stringify(pick(prs.filter(p => want === 'all' || p.state === want.toUpperCase()))));
} else { console.error('stub gh: not here: ' + a.join(' ')); process.exit(1); }
`, { mode: 0o755 });
  const env = { ...process.env, KEEL_GH: gh };
  const keel = args => { const r = run(process.execPath, [BIN, ...args], { cwd: root, env }); return { code: r.status, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) }; };
  return { root, origin, env, git, keel, log, base };
}

/** The board's answer, injected: an unanswered review, a walk that is the owner's, and an agent's item that is not. */
const board = async () => ({
  items: [
    { source: 'reviews', waits: 'broken', title: 'acme/anvils#42: 2 review comments unanswered', read: 'keel review acme/anvils#42' },
    { source: 'roadmap', waits: 'owner', title: 'phase 2: Acme anvils ring', why: 'walk owed: ring one', read: 'docs/phases/02-ring.md' },
    { source: 'roadmap', waits: 'agent', title: 'phase 3: Acme anvils shine', why: 'planned' },
  ],
  sources: [],
});

/** Everything a run could leave behind: the tree (ignored files too), every local ref, and the origin's refs. */
function footprint(f) {
  return [f.git(['status', '--porcelain', '--ignored', '--untracked-files=all']), f.git(['for-each-ref']), f.git(['for-each-ref'], f.origin)].join('\n--\n');
}

test('keel goodnight shows settled today, left open, the default plan and up to three things to try, from a stubbed gh and a fixture project, and changes nothing', async t => {
  const f = await acme(t);
  const before = footprint(f);
  const r = await goodnight({ root: f.root, args: [], env: f.env }, { board });
  const d = r.data;
  assert.equal(d.night, nightOf(new Date()));
  // Settled today: #41 merged an hour ago (#39, three days ago, is not today), phase 1 moved, the Loop finding declined today.
  assert.deepEqual(d.settled.prs.map(p => p.number), [41]);
  assert.deepEqual(d.settled.phases.map(p => [p.phase, p.from, p.to]), [[1, 'planned', 'built']]);
  assert.deepEqual(d.settled.findings.map(x => [x.slug, x.decision]), [['heavy-anvils', 'declined']]);
  assert.match(d.since.from, /the last 24 hours/, 'no plan pushed yet: the last 24 hours');
  // Left open: the open PR, the board's unanswered review and its "yours" item (not the agent's).
  assert.deepEqual(d.leftOpen.prs.map(p => [p.number, p.draft]), [[42, true]]);
  assert.deepEqual(d.leftOpen.reviews.map(x => x.title), ['acme/anvils#42: 2 review comments unanswered']);
  assert.deepEqual(d.leftOpen.yours.map(x => x.title), ['phase 2: Acme anvils ring']);
  // The default plan, phase 73's, with the persona's missed goal read from its review page (never run).
  assert.equal(d.from, 'default');
  assert.deepEqual(validatePlan(d.plan).problems, []);
  assert.deepEqual(d.plan.items.map(i => [i.id, i.kind]), [
    ['measures', 'measure'], ['health-prs-stale', 'review'], ['climb-test-time', 'build'], ['loop-slow-search', 'triage'], ['persona-perf--bundle-size', 'build'],
  ]);
  assert.deepEqual(d.plan.items.at(-1).number, { measure: 'persona:perf:bundle-size', bound: 250000, better: 'lower' });
  // Things to try: the accepted Loop finding that names a number (the persona's goal is already in the plan).
  assert.deepEqual(d.suggestions.map(s => [s.id, s.kind, s.lane, s.number?.measure]), [['loop-lighter-anvils', 'build', 'loop', 'slow_tests']]);
  for (const line of ['Settled today', 'merged #41: Acme: anvils weigh less', 'phase 1: planned → built', 'Loop finding heavy-anvils: declined',
    'Left open', 'open PR #42 (draft): Acme: sharper anvils', 'review: acme/anvils#42', 'yours: phase 2: Acme anvils ring',
    "Tonight's plan (keel's default plan)", 'climb-test-time', 'Things to try (keel goodnight add <id>)', 'loop-lighter-anvils', 'keel goodnight --yes']) assert.ok(r.text.includes(line), `the opening says: ${line}\n${r.text}`);
  assert.doesNotMatch(r.text, /#39/);
  assert.equal(footprint(f), before, 'the opening writes nothing and pushes nothing');
  assert.equal(existsSync(join(f.root, 'docs/reviews/2026-10-01-perf.md')) && (await readFile(join(f.root, 'docs/reviews/2026-10-01-perf.md'), 'utf8')), REVIEW, 'no persona was run');

  // At most three things to try: many candidates are cut to SUGGESTIONS, none already in the plan, none settled today.
  const many = [1, 2, 3, 4, 5].map(n => ({ id: `persona-perf--goal-${n}`, title: `goal ${n}`, kind: 'build', source: 'persona:perf', number: { measure: `persona:perf:goal-${n}`, bound: 1, better: 'lower' }, lane: 'persona:perf' }));
  const cut = await suggestionsFor({ root: f.root, config: {}, plan: d.plan, personaItems: [...many, { ...many[0], id: 'climb-test-time' }], health: null, settled: d.settled });
  assert.equal(cut.length, SUGGESTIONS);
  assert.equal(SUGGESTIONS, 3);
  assert.ok(!cut.some(s => s.id === 'climb-test-time'));

  // Through the CLI, with the real board: the same opening; what the board cannot read is said, never empty.
  const cli = f.keel(['goodnight', '--json']);
  assert.equal(cli.code, 0, cli.err + cli.out);
  const c = cli.json();
  assert.deepEqual([c.settled.prs.map(p => p.number), c.leftOpen.prs.map(p => p.number), c.plan.items.length, c.suggestions.length], [[41], [42], 5, 1]);
  // The stub gh answers no GraphQL: the reviews could not be read, and the opening says so.
  assert.ok(c.leftOpen.gaps.some(g => /^unanswered reviews: /.test(g)), c.leftOpen.gaps.join('\n'));
  assert.match(f.keel(['goodnight']).out, /not read: unanswered reviews: /);
  assert.equal(footprint(f), before, 'the CLI opening writes nothing either');
});

test('add, drop, edit, budget and skip change the draft; a sixth build item, a build with no number, or an item naming something settled today is refused, naming why', async t => {
  const f = await acme(t);
  const say = async (...args) => (await goodnight({ root: f.root, args, env: f.env }, { board })).data;
  const draft = async () => JSON.parse(await readFile(join(f.root, DRAFT), 'utf8'));
  const refused = async (args, re) => {
    const was = existsSync(join(f.root, DRAFT)) ? await readFile(join(f.root, DRAFT), 'utf8') : null;
    await assert.rejects(goodnight({ root: f.root, args, env: f.env }, { board }), e => { assert.equal(e.exitCode, 2); assert.match(e.message, re); return true; });
    assert.equal(existsSync(join(f.root, DRAFT)) ? await readFile(join(f.root, DRAFT), 'utf8') : null, was, 'a refused change leaves the draft as it was');
  };

  // add: one of the things to try. The draft starts from the default plan, shaped by the owner.
  assert.equal(existsSync(join(f.root, DRAFT)), false);
  assert.match((await say('add', 'loop-lighter-anvils')).said, /added loop-lighter-anvils/);
  let d = await draft();
  assert.equal(d.shapedBy, 'owner');
  assert.deepEqual(d.items.map(i => i.id), ['measures', 'health-prs-stale', 'climb-test-time', 'loop-slow-search', 'persona-perf--bundle-size', 'loop-lighter-anvils']);
  assert.equal(await readFile(join(f.root, '.keel/night/.gitignore'), 'utf8'), '*\n', 'the draft ignores itself');
  // add: the owner's own item, in their words; a build with no --lane takes the climb job that measures its number.
  await say('add', '--title', 'Acme: the search tests, tonight', '--measure', 'slow_tests', '--bound', '0', '--budget', '25');
  d = await draft();
  assert.deepEqual(d.items.at(-1), { id: 'acme-the-search-tests-tonight', title: 'Acme: the search tests, tonight', kind: 'build', source: 'owner', number: { measure: 'slow_tests', bound: 0, better: 'lower' }, lane: 'climb:test-time', budget: { minutes: 25 }, status: 'planned', result: null });
  // edit keeps the owner's words exactly; budget sets the minutes; drop takes one out.
  await say('edit', 'loop-slow-search', '--title', 'Acme search: just look, don\'t fix');
  await say('budget', 'climb-test-time', '30');
  await say('drop', 'health-prs-stale');
  d = await draft();
  assert.equal(d.items.find(i => i.id === 'loop-slow-search').title, 'Acme search: just look, don\'t fix');
  assert.deepEqual(d.items.find(i => i.id === 'climb-test-time').budget, { minutes: 30 });
  assert.ok(!d.items.some(i => i.id === 'health-prs-stale'));
  // skip: a path goes on will-not-touch; an item's id does too, and that item leaves the draft.
  await say('skip', 'lib/anvil.mjs');
  await say('skip', 'loop-slow-search');
  d = await draft();
  assert.deepEqual(d.willNotTouch, ['lib/anvil.mjs', 'loop-slow-search']);
  assert.ok(!d.items.some(i => i.id === 'loop-slow-search'));
  assert.deepEqual(validatePlan(d).problems, []);

  // Refused, naming why. A build with no number:
  await refused(['add', '--title', 'Acme: make anvils better', '--kind', 'build', '--lane', 'climb:test-time'], /a build item names its number first/);
  await refused(['edit', 'measures', '--kind', 'build', '--lane', 'climb:test-time'], /\(measures\): a build item names its number first/);
  // An item naming something settled today: a merged PR, a moved phase, a decided Loop finding.
  await refused(['add', '--title', 'Acme: follow up #41'], /names something settled today \(#41 merged today\)/);
  await refused(['add', '--title', 'Acme: polish phase 1'], /names something settled today \(phase 1 moved today\)/);
  await refused(['edit', 'measures', '--title', 'Measure what #41 did'], /settled today \(#41 merged today\)/);
  assert.match(namesSettled({ id: 'loop-heavy-anvils', source: 'loop:heavy-anvils', lane: 'loop', title: 'Heavy anvils' }, { prs: [], phases: [], findings: [{ slug: 'heavy-anvils' }] }), /decided today/);
  // A sixth build item: four are in (climb, persona, the Loop finding, the owner's); a fifth is fine, a sixth is not.
  await say('add', '--title', 'Acme: fifth', '--measure', 'slow_tests', '--bound', '0', '--id', 'fifth');
  await refused(['add', '--title', 'Acme: sixth', '--measure', 'slow_tests', '--bound', '0', '--id', 'sixth'], /\(sixth\): a sixth build item; at most 5 a night/);
  // Unknown ids and words are refused too.
  await refused(['drop', 'no-such-item'], /no item "no-such-item"/);
  await refused(['add', 'no-such-suggestion'], /no thing to try named "no-such-suggestion"/);
  await refused(['budget', 'fifth', '0'], /a budget is minutes above 0/);
  await refused(['add', '--title', 'Acme: no lane', '--measure', 'gate', '--bound', '0'], /a build item names the pass that builds it/);
  assert.throws(() => parseArgs(['add', 'x', '--yes']), /shape it first/);
  assert.throws(() => parseArgs(['edit', 'x']), /needs a change/);

  // Through the CLI: a refusal is exit 2 with the reason; a change prints the draft.
  const cli = f.keel(['goodnight', 'add', '--title', 'Acme: sixth', '--measure', 'slow_tests', '--bound', '0', '--id', 'sixth']);
  assert.equal(cli.code, 2);
  assert.match(cli.err, /^keel: refused: .*a sixth build item/);
  const ok = f.keel(['goodnight', 'drop', 'fifth', '--json']);
  assert.equal(ok.code, 0, ok.err);
  assert.equal(ok.json().said, 'dropped fifth');

  // The draft is never written through a link.
  const elsewhere = join(f.base, 'elsewhere');
  await mkdir(elsewhere);
  await rm(join(f.root, '.keel/night'), { recursive: true });
  await symlink(elsewhere, join(f.root, '.keel/night'));
  await assert.rejects(goodnight({ root: f.root, args: ['budget', 'climb-test-time', '20'], env: f.env }, { board }), /refusing to write .*\.keel\/night is a symlink/);
  assert.equal(existsSync(join(elsewhere, 'draft.json')), false);
});

test('--yes writes the plan with shapedBy owner and pushes it to the plan branch of a bare origin, one file, main untouched; without --yes nothing is written or pushed', async t => {
  const f = await acme(t);
  const mainBefore = f.git(['rev-parse', 'refs/heads/main'], f.origin);
  const head = f.git(['rev-parse', 'HEAD']);
  // Without --yes: the opening and a shaped draft write no plan and push nothing.
  assert.equal(f.keel(['goodnight']).code, 0);
  await goodnight({ root: f.root, args: ['skip', 'lib/anvil.mjs'], env: f.env }, { board });
  assert.equal(existsSync(join(f.root, PLAN)), false, 'no plan without --yes');
  assert.equal(run('git', ['rev-parse', '--verify', '-q', `refs/heads/${PLAN_BRANCH}`], { cwd: f.origin }).status, 1, 'nothing pushed without --yes');
  const status = f.git(['status', '--porcelain']);

  // --yes: "that's the plan".
  const r = await goodnight({ root: f.root, args: ['--yes'], env: f.env }, { board });
  const plan = JSON.parse(await readFile(join(f.root, PLAN), 'utf8'));
  assert.deepEqual(r.data.plan, plan);
  assert.equal(plan.shapedBy, 'owner');
  assert.equal(plan.date, nightOf(new Date()));
  assert.deepEqual(plan.willNotTouch, ['lib/anvil.mjs']);
  assert.deepEqual(validatePlan(plan).problems, []);
  // Settled today and left open travel with the plan, for the morning.
  assert.ok(plan.settledToday.includes('merged #41: Acme: anvils weigh less'), plan.settledToday.join('\n'));
  assert.ok(plan.leftOpen.includes('open PR #42 (draft): Acme: sharper anvils'));
  assert.ok(plan.leftOpen.includes('yours: phase 2: Acme anvils ring'));
  // On the origin: the plan branch holds one commit with no parent and one file, the plan, byte for byte.
  const tip = f.git(['rev-parse', `refs/heads/${PLAN_BRANCH}`], f.origin);
  assert.equal(tip, r.data.pushed.commit);
  assert.equal(f.git(['rev-list', '--count', tip], f.origin), '1', 'no history: never merged, never based on main');
  assert.equal(f.git(['ls-tree', '-r', '--name-only', tip], f.origin), '.keel/night/plan.json');
  assert.equal(`${f.git(['show', `${tip}:.keel/night/plan.json`], f.origin)}\n`, await readFile(join(f.root, PLAN), 'utf8'));
  // main is untouched, on the origin and here; the working tree and index too.
  assert.equal(f.git(['rev-parse', 'refs/heads/main'], f.origin), mainBefore);
  assert.equal(f.git(['rev-parse', 'HEAD']), head);
  assert.equal(f.git(['symbolic-ref', '--short', 'HEAD']), 'main');
  assert.equal(f.git(['status', '--porcelain']), status, 'the working tree and index are as they were (the plan ignores itself)');
  assert.match(r.text, /That's the plan for the night of .*pushed to origin\/keel-night-plan/);

  // The night reads it: phase 73's step takes the branch's plan, shaped by the owner.
  const branchPlan = join(f.base, 'branch-plan.json');
  await writeFile(branchPlan, f.git(['show', `${tip}:.keel/night/plan.json`], f.origin));
  const night = await tonight({ root: f.root, date: plan.date, env: f.env, branchPlan });
  assert.equal(night.data.from, 'branch');
  assert.match(night.data.why, /shaped by owner/);

  // Said again later: force-pushed, still one commit, one file; "today" is now since that plan.
  await goodnight({ root: f.root, args: ['budget', 'climb-test-time', '15'], env: f.env }, { board });
  const again = await goodnight({ root: f.root, args: ['--yes'], env: f.env }, { board });
  const tip2 = f.git(['rev-parse', `refs/heads/${PLAN_BRANCH}`], f.origin);
  assert.equal(tip2, again.data.pushed.commit);
  assert.equal(f.git(['rev-list', '--count', tip2], f.origin), '1');
  assert.match((await goodnight({ root: f.root, args: [], env: f.env }, { board })).data.since.from, /the last plan \(keel-night-plan\)/);

  // A refused plan is never written or pushed: with no remote, nothing is written.
  f.git(['remote', 'remove', 'origin']);
  await rm(join(f.root, PLAN));
  await assert.rejects(goodnight({ root: f.root, args: ['--yes'], env: f.env }, { board }), e => e.exitCode === 2 && /no git remote here/.test(e.message));
  assert.equal(existsSync(join(f.root, PLAN)), false);
});

// Review of phase 74 (PR #144): edit --kind build on an item in lane night kept that lane, and --yes would publish a build no pass takes.
test('edit that makes an item a build gives it the pass that builds its number, or is refused; a build in lane night never reaches the draft', async t => {
  const f = await acme(t);
  const edit = (...args) => goodnight({ root: f.root, args: ['edit', 'health-prs-stale', ...args], env: f.env }, { board });
  // health-prs-stale is a review in lane night; no climb job measures prs_stale.
  await assert.rejects(edit('--kind', 'build'), e => e.exitCode === 2 && /a build item names the pass that builds it: --lane climb:<job> or robot:#<issue> \(lane night only measures\)/.test(e.message));
  await assert.rejects(edit('--kind', 'build', '--lane', 'night'), e => e.exitCode === 2 && /lane night only measures/.test(e.message));
  await assert.rejects(goodnight({ root: f.root, args: ['add', '--title', 'Acme: a night build', '--measure', 'slow_tests', '--bound', '0', '--lane', 'night'], env: f.env }, { board }), /lane night only measures/);
  assert.equal(existsSync(join(f.root, DRAFT)), false, 'nothing refused reaches the draft');
  // Its number measured by a climb job: the build goes to that job, as add does.
  await edit('--kind', 'build', '--measure', 'slow_tests', '--bound', '0');
  const d = JSON.parse(await readFile(join(f.root, DRAFT), 'utf8'));
  const it = d.items.find(i => i.id === 'health-prs-stale');
  assert.deepEqual([it.kind, it.lane, it.number.measure], ['build', 'climb:test-time', 'slow_tests']);
  // A lane the owner names is theirs.
  await edit('--lane', 'robot:#12');
  assert.equal(JSON.parse(await readFile(join(f.root, DRAFT), 'utf8')).items.find(i => i.id === 'health-prs-stale').lane, 'robot:#12');
});
