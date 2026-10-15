// The morning (phase 77): when the night is over, one message says what it
// did. The brief is rendered in isocan's order from the plan as it finished
// (its record, the plan branch, each item at its furthest tick) and the health
// pages; --send opens one assigned, labelled issue, closes the previous one
// and never sends twice; the night is over when every build item is terminal
// or readyBy passed, never sooner; finalization puts the final outcomes in
// the night's record and health page (keel#137); the plan card is refused
// without a live binding that lists it. Fixtures are synthetic (Acme Anvils);
// gh is a stub at the boundary and origin is a local bare repo. Nothing here
// reads the live world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { run } from './helpers/run.mjs';
import { renderBrief, readiness, lastNight, finalPlan, healthAround, linksOf, withPlanSection, readyByOf, titleOf, LABEL, planCard, PLAN_CARD } from '../lib/morning.mjs';
import * as morningModule from '../lib/morning.mjs';
import { planSection, validatePlan, PLAN } from '../lib/night-plan.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(KEEL, 'bin', 'keel.mjs');
const NIGHT = '2026-10-05';
const READY_BY = `${NIGHT}T15:00:00Z`;
const BEFORE = new Date(`${NIGHT}T12:00:00Z`), AFTER = new Date(`${NIGHT}T16:00:00Z`);
const PR = 'https://github.com/acme/anvils/pull/21';

// Hermetic: on GitHub Actions the runner sets GITHUB_REPOSITORY (keel's own repo) and
// GITHUB_ACTIONS; a fixture's repo comes from its config, so neither leaks in.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !['GITHUB_REPOSITORY', 'GITHUB_ACTIONS'].includes(k)));
const keel = (args, cwd, env = {}) => {
  const r = run(process.execPath, [BIN, ...args], { cwd, env: { ...ENV, ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const item = over => ({ number: null, budget: null, status: 'planned', result: null, ...over });
/** The night as its passes left it, every outcome a brief must show. */
const finished = () => ({
  schema: 1, date: NIGHT, shapedBy: 'owner', readyBy: READY_BY, willNotTouch: ['lib/anvil.mjs'], settledToday: ['#40 merged'], leftOpen: ['#42 waits for review'],
  items: [
    item({ id: 'measures', title: 'Measure the practice', kind: 'measure', source: 'default', lane: 'night', status: 'done', result: { note: '9 ok, 1 outside, 0 n/a, 0 broken', link: `docs/health/${NIGHT}.md` } }),
    item({ id: 'perf-bundle', title: 'Entry chunk back under 747 kB', kind: 'build', source: 'persona:performance', lane: 'climb:perf', number: { measure: 'bundle_bytes', bound: 747000, better: 'lower' }, status: 'done', result: { note: 'Split the vendor chunk', link: PR } }),
    item({ id: 'robot-12', title: 'Robot: #12 faster anvil search', kind: 'build', source: 'robot:#12', lane: 'robot:#12', number: { measure: 'slow_tests', bound: 5, better: 'lower' }, status: 'failed', result: { note: 'the gate failed: two anvil tests red' } }),
    item({ id: 'climb-docs', title: 'Climb docs: fewer dead links', kind: 'build', source: 'default', lane: 'climb:docs', number: { measure: 'dead_links', bound: 0, better: 'lower' }, status: 'running' }),
    item({ id: 'health-proposal', title: 'Proposal from 2026-10-04: tighten slow_tests', kind: 'review', source: 'health:slow_tests', lane: 'night', status: 'done', result: { note: 'Read; the bound holds' } }),
    item({ id: 'loop-search', title: 'Triage the Loop finding: search is slow', kind: 'triage', source: 'loop:search-is-slow', lane: 'loop', status: 'skipped', result: { note: 'A person triages Loop findings' } }),
  ],
});
/** The same plan as the night recorded it, before the builds ran. */
const asRecorded = () => {
  const p = finished();
  return { ...p, items: p.items.map(i => (i.kind === 'build' ? { ...i, status: 'planned', result: null } : i)) };
};
const page = (date, bundle) => `# Acme Anvils health, ${date}\n\n| Measure | Value | Bound | State | Detail |\n| --- | --- | --- | --- | --- |\n| \`bundle_bytes\` — the entry chunk | ${bundle} | ≤ 747000 | ${bundle > 747000 ? 'outside' : 'ok'} | |\n| \`slow_tests\` — tests over a second | 4 | ≤ 5 | ok | |\n\n## Tonight's plan\n\nWhat the night recorded.\n\n## Proposal\n\nNone.\n`;
const HEALTH = { before: { date: NIGHT, file: `docs/health/${NIGHT}.md`, rows: [{ id: 'bundle_bytes', value: 760000 }, { id: 'slow_tests', value: 4 }] }, after: { date: '2026-10-06', file: 'docs/health/2026-10-06.md', rows: [{ id: 'bundle_bytes', value: 741000 }] } };
const LINKS = { canvas: 'https://canvas.acme.test/p/prj_acme', health: `https://github.com/acme/anvils/blob/HEAD/docs/health/${NIGHT}.md` };
const CONFIG = { name: 'Acme Anvils', practices: ['night'], repo: 'acme/anvils', morning: { assignee: 'acme-owner' }, canvas: { provider: 'isocan', home: 'https://canvas.acme.test', canvasId: 'prj_acme', projectKey: 'acme' } };

/**
 * A project with an origin: its default branch holds the night's record as
 * the night wrote it (builds planned) and the night's health page; the plan
 * branch keel-night-plan holds the builds' ticks; the next night's page is
 * the "after". gh is a stub with a state file.
 */
async function project(t, { config = CONFIG, issues = [], failCreate = false, branch = finished() } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'keel-morning-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'acme'), origin = join(base, 'origin.git');
  git(base, 'init', '-q', '--bare', '-b', 'main', origin);
  await mkdir(join(root, '.keel'), { recursive: true });
  await mkdir(join(root, 'docs/night'), { recursive: true });
  await mkdir(join(root, 'docs/health'), { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'remote', 'add', 'origin', origin);
  await writeFile(join(root, '.keel/keel.json'), `${JSON.stringify(config, null, 2)}\n`);
  await writeFile(join(root, `docs/night/${NIGHT}.json`), `${JSON.stringify(asRecorded(), null, 2)}\n`);
  await writeFile(join(root, `docs/health/${NIGHT}.md`), page(NIGHT, 760000));
  await writeFile(join(root, 'docs/health/2026-10-06.md'), page('2026-10-06', 741000));
  // The night practice's scripts, as a project carries them.
  await mkdir(join(root, 'scripts/keel'), { recursive: true });
  for (const f of ['morning.mjs', 'night-plan.mjs', 'lib.mjs']) await cp(join(KEEL, 'practices/night/files/scripts/keel', f), join(root, 'scripts/keel', f));
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'Acme: the night');
  git(root, 'push', '-q', 'origin', 'main');
  if (branch) {
    git(root, 'checkout', '-q', '--orphan', 'keel-night-plan');
    git(root, 'rm', '-q', '-rf', '--cached', '.');
    await mkdir(join(root, '.keel/night'), { recursive: true });
    await writeFile(join(root, PLAN), `${JSON.stringify(branch, null, 2)}\n`);
    git(root, 'add', '-f', PLAN); git(root, 'commit', '-q', '-m', 'Acme: the plan, ticked');
    git(root, 'push', '-q', 'origin', 'keel-night-plan');
    git(root, 'checkout', '-q', '-f', 'main');
    await rm(join(root, '.keel/night'), { recursive: true, force: true });
  }
  const state = join(base, 'gh-state.json'), log = join(base, 'gh.log'), gh = join(base, 'gh');
  await writeFile(state, JSON.stringify({ issues, next: 31 }));
  await writeFile(gh, `#!${process.execPath}
const fs = require('node:fs');
const a = process.argv.slice(2);
const input = a.includes('-') ? fs.readFileSync(0, 'utf8') : null;
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ a, input }) + '\\n');
const s = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8'));
const save = () => fs.writeFileSync(${JSON.stringify(state)}, JSON.stringify(s));
const opt = f => a.includes(f) ? a[a.indexOf(f) + 1] : undefined;
if (a[0] === 'issue' && a[1] === 'list') {
  if (opt('--label') !== ${JSON.stringify(LABEL)} || opt('--state') !== 'all') { console.error('stub gh: keel:morning issues, all states'); process.exit(1); }
  console.log(JSON.stringify(s.issues.map(i => ({ number: i.number, title: i.title, state: i.state }))));
} else if (a[0] === 'label' && a[1] === 'create') {
  process.exit(0);
} else if (a[0] === 'issue' && a[1] === 'create') {
  if (${failCreate}) { console.error('HTTP 502: Acme gateway'); process.exit(1); }
  const n = s.next++;
  s.issues.push({ number: n, title: opt('--title'), state: 'OPEN', assignee: opt('--assignee'), label: opt('--label'), body: input });
  save();
  console.log('https://github.com/acme/anvils/issues/' + n);
} else if (a[0] === 'issue' && a[1] === 'close') {
  const i = s.issues.find(i => i.number === Number(a[2]));
  i.state = 'CLOSED'; i.comment = opt('--comment'); save();
} else { console.error('stub gh: unexpected ' + a.join(' ')); process.exit(1); }
`);
  await chmod(gh, 0o755);
  const calls = async () => (existsSync(log) ? (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
  const issuesNow = async () => JSON.parse(await readFile(state, 'utf8')).issues;
  return { base, root, origin, gh, calls, issuesNow };
}

test('lastNight is the night that last started (07:23 UTC); readyBy defaults to 17:00 UTC on the night\'s date', () => {
  assert.equal(lastNight(new Date('2026-10-05T07:22:00Z')), '2026-10-04');
  assert.equal(lastNight(new Date('2026-10-05T07:23:00Z')), NIGHT);
  assert.equal(lastNight(new Date('2026-10-05T23:59:00Z')), NIGHT);
  assert.equal(readyByOf({ ...finished(), readyBy: null }), `${NIGHT}T17:00:00Z`);
  assert.equal(readyByOf(finished()), READY_BY);
});

test('the night is over only when every build item is terminal, or at readyBy; then what is unfinished is not done', () => {
  const plan = finished();
  assert.deepEqual(readiness(plan, BEFORE), { ready: false, late: false, readyBy: READY_BY, open: ['climb-docs'], why: `not finished: climb-docs; readyBy ${READY_BY} has not passed` });
  assert.equal(readiness(plan, AFTER).ready, true);
  assert.equal(readiness(plan, AFTER).late, true);
  assert.deepEqual(readiness(plan, AFTER).open, ['climb-docs']);
  // Every build terminal (done, failed, skipped, left alone): over before readyBy; non-build items never hold it.
  for (const status of ['done', 'failed', 'skipped', 'left-alone']) {
    const all = { ...plan, items: plan.items.map(i => (i.id === 'climb-docs' ? { ...i, status } : i.kind === 'triage' ? { ...i, status: 'planned' } : i)) };
    assert.deepEqual([readiness(all, BEFORE).ready, readiness(all, BEFORE).late], [true, false], status);
  }
  // planned and running both hold it.
  assert.equal(readiness({ ...plan, items: plan.items.map(i => (i.id === 'climb-docs' ? { ...i, status: 'planned' } : i)) }, BEFORE).ready, false);
});

test('keel morning renders the brief in isocan\'s order, with every link and each item\'s terminal outcome, from a fixture plan and health pages; deterministic', () => {
  const b = renderBrief({ plan: finished(), now: AFTER, health: HEALTH, links: LINKS });
  assert.equal(b.markdown, renderBrief({ plan: finished(), now: AFTER, health: HEALTH, links: LINKS }).markdown, 'the same inputs make the same bytes');
  const heads = b.markdown.split('\n').filter(l => /^#{1,2} /.test(l));
  assert.deepEqual(heads, [`# Good morning, ${NIGHT}`, '## Done', '## Tried', '## Failed, and why', '## Left alone', `## Not finished by ${READY_BY}`, '## Your next']);
  const md = b.markdown;
  assert.match(md, new RegExp(`^The night of ${NIGHT} \\(UTC\\), shaped by the owner: 1 done, 2 tried, 1 failed, 1 left alone, 1 not finished by ${READY_BY}\\.$`, 'm'));
  assert.match(md, /^Canvas: https:\/\/canvas\.acme\.test\/p\/prj_acme · Health page: https:\/\/github\.com\/acme\/anvils\/blob\/HEAD\/docs\/health\/2026-10-05\.md$/m);
  const section = head => md.split(`${head}\n\n`)[1].split('\n\n')[0];
  // Done: the number before and after, the note, the PR.
  assert.equal(section('## Done'), `- **Entry chunk back under 747 kB** (\`perf-bundle\`) — \`bundle_bytes\` ≤ 747000: 760000 before → 741000 after — Split the vendor chunk — ${PR}`);
  assert.equal(section('## Tried'), [
    `- **Measure the practice** (\`measures\`) — 9 ok, 1 outside, 0 n/a, 0 broken — docs/health/${NIGHT}.md`,
    '- **Proposal from 2026-10-04: tighten slow_tests** (`health-proposal`) — Read; the bound holds',
  ].join('\n'));
  // Failed, and why: the reason; a number measured before and not yet after says so.
  assert.equal(section('## Failed, and why'), '- **Robot: #12 faster anvil search** (`robot-12`) — `slow_tests` ≤ 5: 4 before → not measured yet (the next night measures it) after — the gate failed: two anvil tests red');
  assert.equal(section('## Left alone'), '- **Triage the Loop finding: search is slow** (`loop-search`) — A person triages Loop findings — skipped\n- Will not touch: lib/anvil.mjs');
  assert.equal(section(`## Not finished by ${READY_BY}`), `- **Climb docs: fewer dead links** (\`climb-docs\`) — \`dead_links\` ≤ 0 (not measured on a health page) — not finished by ${READY_BY} (still running)`);
  assert.doesNotMatch(section('## Done'), /climb-docs/, 'an unfinished item is never done');
  assert.deepEqual(b.next, [
    `Review and merge ${PR} (\`perf-bundle\`): a person merges.`,
    'Look at why `robot-12` failed: the gate failed: two anvil tests red.',
    `\`climb-docs\` was not finished by ${READY_BY}: its pass may still finish it, or tomorrow's plan takes it up.`,
    'Left open: #42 waits for review',
  ]);
  assert.deepEqual(b.sections, { done: ['perf-bundle'], tried: ['measures', 'health-proposal'], failed: ['robot-12'], leftAlone: ['loop-search'], unfinished: ['climb-docs'] });
  // Before readyBy the unfinished section says still going, never "not finished by".
  const early = renderBrief({ plan: finished(), now: BEFORE, health: HEALTH, links: LINKS }).markdown;
  assert.match(early, /^## Still going$/m);
  assert.doesNotMatch(early, /not finished by/);
  // No canvas bound: no canvas link; no repo: the page's path.
  assert.deepEqual(linksOf({}, { page: `docs/health/${NIGHT}.md` }), { canvas: null, health: `docs/health/${NIGHT}.md` });
  assert.deepEqual(linksOf(CONFIG, { repo: 'acme/anvils', page: `docs/health/${NIGHT}.md` }), LINKS);
  const quiet = renderBrief({ plan: { ...finished(), items: [], willNotTouch: [], leftOpen: [] }, now: AFTER }).markdown;
  assert.match(quiet, /## Done\n\nNothing\.\n/);
  assert.match(quiet, /## Your next\n\nNothing waits for you this morning\.\n/);
});

test('the brief reads tonight\'s plan as it finished: the night\'s record from origin and the checkout, each item at its furthest tick from the plan branch', async t => {
  const p = await project(t);
  const found = await finalPlan({ root: p.root, date: NIGHT });
  assert.equal(found.from, `docs/night/${NIGHT}.json`);
  assert.deepEqual(found.sources.map(s => [s.from, s.state]), [
    ['keel-night-plan:.keel/night/plan.json', 'read'],
    [`keel-night/${NIGHT}-final:docs/night/${NIGHT}.json`, 'absent'],
    [`keel-night/${NIGHT}:docs/night/${NIGHT}.json`, 'absent'],
    [`docs/night/${NIGHT}.json`, 'read'],
    ['.keel/night/plan.json', 'absent'],
  ]);
  assert.deepEqual(found.plan.items.map(i => [i.id, i.status]), finished().items.map(i => [i.id, i.status]), 'the ticks on the plan branch reach the brief');
  assert.equal(validatePlan(found.plan).ok, true);
  // Another night's plan on the branch is not tonight's: the record alone, nothing ticked.
  const other = await project(t, { branch: { ...finished(), date: '2026-10-04' } });
  const recorded = await finalPlan({ root: other.root, date: NIGHT });
  assert.equal(recorded.sources[0].state, 'another night (2026-10-04)');
  assert.equal(recorded.plan.items.find(i => i.id === 'perf-bundle').status, 'planned');
  // A terminal tick is never undone by a place that still says planned or running.
  const back = await project(t, { branch: { ...finished(), items: finished().items.map(i => (i.id === 'perf-bundle' ? { ...i, status: 'running', result: null } : i)) } });
  await writeFile(join(back.root, `docs/night/${NIGHT}.json`), `${JSON.stringify(finished(), null, 2)}\n`);
  assert.equal((await finalPlan({ root: back.root, date: NIGHT })).plan.items.find(i => i.id === 'perf-bundle').status, 'done');
  // The numbers: the night's own page before, the next night's after.
  const h = await healthAround(p.root, CONFIG, NIGHT);
  assert.deepEqual([h.before.file, h.after.file], [`docs/health/${NIGHT}.md`, 'docs/health/2026-10-06.md']);

  // The CLI, end to end: the same brief, its links on GitHub and the canvas.
  const r = keel(['morning', '--date', NIGHT, '--json'], p.root, { KEEL_GH: p.gh });
  assert.equal(r.code, 0, r.err + r.out);
  const data = r.json();
  assert.equal(data.title, `Good morning, ${NIGHT}`);
  assert.deepEqual(data.links, LINKS);
  assert.equal(data.markdown, renderBrief({ plan: found.plan, now: new Date(), health: h, links: LINKS }).markdown);
  assert.match(data.markdown, /760000 before → 741000 after/);
  assert.deepEqual(await p.calls(), [], 'rendering the brief never calls gh');
  const text = keel(['morning', '--date', NIGHT], p.root, { KEEL_GH: p.gh });
  assert.equal(text.out.trim(), data.markdown.trim());
  // No plan for the night: exit 2, naming where it looked.
  const none = keel(['morning', '--date', '2026-09-01', '--json'], p.root, { KEEL_GH: p.gh });
  assert.equal(none.code, 2);
  assert.match(none.json().error, /^no plan for the night of 2026-09-01: keel-night-plan:\.keel\/night\/plan\.json another night \(2026-10-05\)/);
  assert.equal(keel(['morning', '--date', '5/10/2026', '--json'], p.root, { KEEL_GH: p.gh }).code, 2);
  assert.equal(keel(['morning', '--send', '--card', '--json'], p.root, { KEEL_GH: p.gh }).code, 2);
  assert.equal(keel(['morning', '--yes', '--json'], p.root, { KEEL_GH: p.gh }).code, 2);
});

test('--send opens one assigned, labelled issue, closes the previous one, and a second send for the same night does nothing', async t => {
  const p = await project(t, { issues: [{ number: 20, title: 'Good morning, 2026-10-03', state: 'CLOSED' }, { number: 30, title: 'Good morning, 2026-10-04', state: 'OPEN' }] });
  const brief = keel(['morning', '--date', NIGHT, '--json'], p.root, { KEEL_GH: p.gh }).json().markdown;
  const r = keel(['morning', '--send', '--date', NIGHT, '--json'], p.root, { KEEL_GH: p.gh });
  assert.equal(r.code, 0, r.err + r.out);
  assert.deepEqual({ ...r.json(), readiness: undefined }, { ok: true, sent: true, date: NIGHT, issue: 31, url: 'https://github.com/acme/anvils/issues/31', assignee: 'acme-owner', closed: [30], readiness: undefined });
  const issues = await p.issuesNow();
  const sent = issues.find(i => i.number === 31);
  assert.deepEqual([sent.title, sent.state, sent.assignee, sent.label], [titleOf(NIGHT), 'OPEN', 'acme-owner', 'keel:morning']);
  assert.equal(sent.body, brief, 'the issue body is the brief');
  assert.deepEqual(issues.filter(i => i.state === 'OPEN').map(i => i.number), [31], 'one open at a time');
  assert.equal(issues.find(i => i.number === 30).comment, 'Superseded by #31 (keel morning).');
  const calls = (await p.calls()).map(c => c.a);
  assert.ok(calls.every(a => a.includes('--repo') && a[a.indexOf('--repo') + 1] === 'acme/anvils'), 'every call names the repo');
  assert.deepEqual(calls.map(a => a.slice(0, 2).join(' ')), ['issue list', 'label create', 'issue create', 'issue close']);
  // Again, the same night: nothing.
  const again = keel(['morning', '--send', '--date', NIGHT, '--json'], p.root, { KEEL_GH: p.gh });
  assert.equal(again.code, 0);
  assert.deepEqual(again.json(), { ok: true, sent: false, date: NIGHT, issue: 31, why: 'already sent' });
  assert.deepEqual((await p.calls()).slice(4).map(c => c.a.slice(0, 2).join(' ')), ['issue list'], 'nothing is created or closed');
  // Closed since: still this night's brief, never sent again.
  const closed = await project(t, { issues: [{ number: 31, title: titleOf(NIGHT), state: 'CLOSED' }] });
  assert.equal(keel(['morning', '--send', '--date', NIGHT, '--json'], closed.root, { KEEL_GH: closed.gh }).json().sent, false);
});

test('--send with no morning.assignee refuses, naming the key, and calls no gh; a failed create is exit 1', async t => {
  const { morning, ...rest } = CONFIG;
  for (const config of [rest, { ...rest, morning: {} }, { ...rest, morning: { assignee: 'not a login!' } }]) {
    const p = await project(t, { config });
    const r = keel(['morning', '--send', '--date', NIGHT, '--json'], p.root, { KEEL_GH: p.gh });
    assert.equal(r.code, 2);
    assert.match(r.json().error, /^morning\.assignee is not set in \.keel\/keel\.json/);
    assert.deepEqual(await p.calls(), []);
  }
  assert.equal(morning.assignee, 'acme-owner');
  const down = await project(t, { failCreate: true });
  const r = keel(['morning', '--send', '--date', NIGHT, '--json'], down.root, { KEEL_GH: down.gh });
  assert.equal(r.code, 1, 'a send that fails is red');
  assert.match(r.json().error, /cannot open the issue "Good morning, 2026-10-05": gh exited 1, HTTP 502/);
});

test('the workflow\'s decision: over and unsent, or not yet; already sent; no assignee is said, never sent', async t => {
  const p = await project(t);
  // decide reads the clock: in-process, with a fixed now (the script is the same module).
  const { decide: decideFn } = await import('../lib/morning.mjs');
  const out = join(p.base, 'out-before');
  const before = await decideFn({ root: p.root, env: { ...ENV, KEEL_GH: p.gh }, now: BEFORE, githubOutput: out });
  assert.deepEqual([before.data.day, before.data.ready, before.data.sent, before.data.assignee], [NIGHT, false, false, 'set']);
  assert.equal(await readFile(out, 'utf8'), `day=${NIGHT}\nready=false\nsent=false\nassignee=set\n`);
  assert.deepEqual(await p.calls(), [], 'a night not over asks GitHub nothing');
  const after = await decideFn({ root: p.root, env: { ...ENV, KEEL_GH: p.gh }, now: AFTER });
  assert.deepEqual([after.data.ready, after.data.sent], [true, false]);
  // Every build terminal: over before readyBy.
  const done = await project(t, { branch: { ...finished(), items: finished().items.map(i => (i.id === 'climb-docs' ? { ...i, status: 'done', result: { link: 'https://github.com/acme/anvils/pull/22' } } : i)) } });
  assert.equal((await decideFn({ root: done.root, env: { ...ENV, KEEL_GH: done.gh }, now: BEFORE })).data.ready, true);
  // Sent: the workflow does nothing more.
  const sent = await project(t, { issues: [{ number: 31, title: titleOf(NIGHT), state: 'OPEN' }] });
  const s = await decideFn({ root: sent.root, env: { ...ENV, KEEL_GH: sent.gh }, now: AFTER });
  assert.deepEqual([s.data.ready, s.data.sent, s.data.why], [true, true, 'already sent as #31']);
  const { morning: _, ...rest } = CONFIG;
  const unset = await project(t, { config: rest });
  assert.equal((await decideFn({ root: unset.root, env: { ...ENV, KEEL_GH: unset.gh }, now: AFTER })).data.assignee, 'unset');
  // The project's own script, as keel-morning.yml runs it: its output lines.
  const lines = join(p.base, 'out-script');
  const r = run(process.execPath, [join(p.root, 'scripts/keel/morning.mjs'), 'decide', '--github-output', lines, '--json'], { cwd: p.root, env: { ...ENV, KEEL_GH: p.gh } });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(await readFile(lines, 'utf8'), /^day=\d{4}-\d{2}-\d{2}\nready=(true|false)\nsent=(true|false)\nassignee=set\n$/);
});

test('keel#137: finalization puts a later build outcome in the night\'s record and its health page, keeping the rest of the page', async t => {
  const p = await project(t);
  const pageBefore = await readFile(join(p.root, `docs/health/${NIGHT}.md`), 'utf8');
  // The project's own script, as keel-morning.yml's finalize job runs it.
  const r = run(process.execPath, [join(p.root, 'scripts/keel/morning.mjs'), 'finalize', '--date', NIGHT, '--pr-input', join(p.base, 'pr.json'), '--json'], { cwd: p.root, env: { ...ENV, KEEL_GH: p.gh } });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(JSON.parse(r.stdout).written, [`docs/night/${NIGHT}.json`, `docs/health/${NIGHT}.md`]);
  assert.deepEqual(await p.calls(), [], 'finalizing calls no gh');
  const { finalize } = await import('../lib/morning.mjs');
  const record = JSON.parse(await readFile(join(p.root, `docs/night/${NIGHT}.json`), 'utf8'));
  assert.equal(record.items.find(i => i.id === 'perf-bundle').status, 'done', 'the record holds the later outcome');
  assert.equal(record.items.find(i => i.id === 'perf-bundle').result.link, PR);
  const pageAfter = await readFile(join(p.root, `docs/health/${NIGHT}.md`), 'utf8');
  assert.match(pageAfter, new RegExp(`\\| perf-bundle: Entry chunk back under 747 kB \\| build \\| climb:perf \\| \`bundle_bytes\` ≤ 747000 \\| done \\| Split the vendor chunk — ${PR.replaceAll('/', '\\/').replaceAll('.', '\\.')} \\|`), 'the page holds the later outcome');
  assert.doesNotMatch(pageAfter, /What the night recorded\./, 'the old section is replaced');
  assert.equal(pageAfter.split('## Tonight\'s plan')[0], pageBefore.split('## Tonight\'s plan')[0], 'what came before it is kept');
  assert.equal(pageAfter.split('## Proposal')[1], pageBefore.split('## Proposal')[1], 'and what came after it');
  assert.equal(withPlanSection(pageAfter, planSection(record, { record: `docs/night/${NIGHT}.json` })), pageAfter, 'finalizing again changes nothing');
  // keel-morning finalizes on every run once the night is over, sent or not: a repeat with nothing new writes the same bytes.
  const recordBytes = await readFile(join(p.root, `docs/night/${NIGHT}.json`), 'utf8');
  await finalize({ root: p.root, date: NIGHT });
  assert.equal(await readFile(join(p.root, `docs/night/${NIGHT}.json`), 'utf8'), recordBytes);
  assert.equal(await readFile(join(p.root, `docs/health/${NIGHT}.md`), 'utf8'), pageAfter);
  const body = JSON.parse(await readFile(join(p.base, 'pr.json'), 'utf8'));
  assert.equal(body.danger.door, 'two-way');
  assert.deepEqual(body.evidence.rows.find(x => x.what === 'perf-bundle'), { what: 'perf-bundle', before: 'build', after: 'done' });
  // A page with no section gets one at its end; no page: the record alone.
  assert.match(withPlanSection('# Acme\n\nNothing else.\n', ['## Tonight\'s plan', '', 'x', '']), /^# Acme\n\nNothing else\.\n\n## Tonight's plan\n\nx\n$/);
  await rm(join(p.root, `docs/health/${NIGHT}.md`));
  assert.deepEqual((await finalize({ root: p.root, date: NIGHT })).data.written, [`docs/night/${NIGHT}.json`]);
});

test('the plan card is the plan alone (no clock), and --card is refused, naming the command, unless the binding is live and lists night-plan', async t => {
  const card = planCard(finished());
  assert.deepEqual([card.key, card.title, card.region], [PLAN_CARD, `Tonight's plan · ${NIGHT}`, 'health']);
  assert.equal(card.source, planCard(finished()).source);
  assert.match(card.source, new RegExp(`^# Tonight's plan · ${NIGHT}\n\nReady by ${READY_BY}\\.\n\nShaped by the owner`));
  assert.notEqual(planCard(asRecorded()).source, card.source, 'a tick changes the card');
  for (const canvas of [undefined, CONFIG.canvas, { ...CONFIG.canvas, mode: 'live' }, { ...CONFIG.canvas, mode: 'immutable', liveKeys: ['night-plan'] }]) {
    const p = await project(t, { config: { ...CONFIG, canvas } });
    const r = keel(['morning', '--card', '--yes', '--date', NIGHT, '--json'], p.root, { KEEL_GH: p.gh, KEEL_ISOCAN: join(p.base, 'no-isocan') });
    assert.equal(r.code, 2, JSON.stringify(canvas));
    assert.match(r.json().error, canvas ? /keel canvas live --card pulse --card night-plan --yes/ : /No canvas is bound/);
    assert.equal(existsSync(join(p.root, '.keel/canvas')), false, 'nothing was written');
  }
});

test('the brief\'s repo: in a GitHub Actions run, the run\'s own repository; anywhere else, the project\'s config, never a stray GITHUB_REPOSITORY', async t => {
  const { repoOf } = morningModule;
  assert.equal(typeof repoOf, 'function');
  assert.equal(repoOf(CONFIG, { GITHUB_REPOSITORY: 'acme/elsewhere' }), 'acme/anvils', 'a local or test run: the config wins');
  assert.equal(repoOf(CONFIG, { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'acme/elsewhere' }), 'acme/elsewhere', 'in the workflow: the run\'s repository is the truth');
  assert.equal(repoOf(CONFIG, { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'not a repo' }), 'acme/anvils');
  assert.equal(repoOf({}, { GITHUB_REPOSITORY: 'acme/elsewhere' }), null, 'outside Actions with no config repo: no GitHub link, the page\'s path');
  // End to end: a stray GITHUB_REPOSITORY (keel's own CI) does not move the fixture's links.
  const p = await project(t);
  const r = keel(['morning', '--date', NIGHT, '--json'], p.root, { KEEL_GH: p.gh, GITHUB_REPOSITORY: 'acme/elsewhere' });
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(r.json().links.health, LINKS.health);
});
