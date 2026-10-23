// The morning (phase 77): when the night is over, one message says what it
// did. The brief is rendered in isocan's order from the plan as it finished
// (its record, the plan branch, each item at its furthest tick) and the health
// pages; --send opens one assigned, labelled issue, closes the previous one
// and never sends twice; the night is over when every build item is terminal
// or readyBy passed, never sooner; finalization puts the final outcomes in
// the night's record and health page (plates#137); the plan card is refused
// without a live binding that lists it. Fixtures are synthetic (Acme Anvils);
// gh is a stub at the boundary and origin is a local bare repo. Nothing here
// reads the live world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, chmod, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { run } from './helpers/run.mjs';
import { renderBrief, readiness, lastNight, finalPlan, healthAround, linksOf, withPlanSection, readyByOf, titleOf, LABEL, planCard, PLAN_CARD } from '../lib/morning.mjs';
import * as morningModule from '../lib/morning.mjs';
import { planSection, validatePlan, PLAN, REMOTE_PLAN } from '../lib/night-plan.mjs';

const PLATES = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(PLATES, 'bin', 'plates.mjs');
const NIGHT = '2026-10-05';
const READY_BY = `${NIGHT}T15:00:00Z`;
const BEFORE = new Date(`${NIGHT}T12:00:00Z`), AFTER = new Date(`${NIGHT}T16:00:00Z`);
const PR = 'https://github.com/acme/anvils/pull/21';

// Hermetic: on GitHub Actions the runner sets GITHUB_REPOSITORY (plates's own repo) and
// GITHUB_ACTIONS; a fixture's repo comes from its config, so neither leaks in.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !['GITHUB_REPOSITORY', 'GITHUB_ACTIONS'].includes(k)));
const plates = (args, cwd, env = {}) => {
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
  const base = await mkdtemp(join(tmpdir(), 'plates-morning-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'acme'), origin = join(base, 'origin.git');
  git(base, 'init', '-q', '--bare', '-b', 'main', origin);
  await mkdir(join(root, '.plates'), { recursive: true });
  await mkdir(join(root, 'docs/night'), { recursive: true });
  await mkdir(join(root, 'docs/health'), { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'remote', 'add', 'origin', origin);
  await writeFile(join(root, '.plates/plates.json'), `${JSON.stringify(config, null, 2)}\n`);
  await writeFile(join(root, `docs/night/${NIGHT}.json`), `${JSON.stringify(asRecorded(), null, 2)}\n`);
  await writeFile(join(root, `docs/health/${NIGHT}.md`), page(NIGHT, 760000));
  await writeFile(join(root, 'docs/health/2026-10-06.md'), page('2026-10-06', 741000));
  // The night practice's scripts, as a project carries them.
  await mkdir(join(root, 'scripts/plates'), { recursive: true });
  for (const f of ['morning.mjs', 'night-plan.mjs', 'lib.mjs', 'production.mjs', 'production-store.mjs', 'production-collectors.mjs']) await cp(join(PLATES, 'practices/night/files/scripts/plates', f), join(root, 'scripts/plates', f));
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'Acme: the night');
  git(root, 'push', '-q', 'origin', 'main');
  if (branch) {
    git(root, 'checkout', '-q', '--orphan', 'keel-night-plan');
    git(root, 'rm', '-q', '-rf', '--cached', '.');
    await mkdir(join(root, '.keel/night'), { recursive: true });
    await writeFile(join(root, REMOTE_PLAN), `${JSON.stringify(branch, null, 2)}\n`);
    git(root, 'add', '-f', REMOTE_PLAN); git(root, 'commit', '-q', '-m', 'Acme: the plan, ticked');
    git(root, 'push', '-q', 'origin', 'keel-night-plan');
    git(root, 'checkout', '-q', '-f', 'main');
    await rm(join(root, '.plates/night'), { recursive: true, force: true });
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

test('plates morning renders the brief in isocan\'s order, with every link and each item\'s terminal outcome, from a fixture plan and health pages; deterministic', () => {
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
    ['.plates/night/plan.json', 'absent'],
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
  const r = plates(['morning', '--date', NIGHT, '--json'], p.root, { PLATES_GH: p.gh });
  assert.equal(r.code, 0, r.err + r.out);
  const data = r.json();
  assert.equal(data.title, `Good morning, ${NIGHT}`);
  assert.deepEqual(data.links, LINKS);
  assert.equal(data.markdown, renderBrief({ plan: found.plan, now: new Date(), health: h, links: LINKS }).markdown);
  assert.match(data.markdown, /760000 before → 741000 after/);
  assert.deepEqual(await p.calls(), [], 'rendering the brief never calls gh');
  const text = plates(['morning', '--date', NIGHT], p.root, { PLATES_GH: p.gh });
  assert.equal(text.out.trim(), data.markdown.trim());
  // No plan for the night: exit 2, naming where it looked.
  const none = plates(['morning', '--date', '2026-09-01', '--json'], p.root, { PLATES_GH: p.gh });
  assert.equal(none.code, 2);
  assert.match(none.json().error, /^no plan for the night of 2026-09-01: keel-night-plan:\.keel\/night\/plan\.json another night \(2026-10-05\)/);
  assert.equal(plates(['morning', '--date', '5/10/2026', '--json'], p.root, { PLATES_GH: p.gh }).code, 2);
  assert.equal(plates(['morning', '--send', '--card', '--json'], p.root, { PLATES_GH: p.gh }).code, 2);
  assert.equal(plates(['morning', '--yes', '--json'], p.root, { PLATES_GH: p.gh }).code, 2);
});

test('--send opens one assigned, labelled issue, closes the previous one, and a second send for the same night does nothing', async t => {
  const p = await project(t, { issues: [{ number: 20, title: 'Good morning, 2026-10-03', state: 'CLOSED' }, { number: 30, title: 'Good morning, 2026-10-04', state: 'OPEN' }] });
  const brief = plates(['morning', '--date', NIGHT, '--json'], p.root, { PLATES_GH: p.gh }).json().markdown;
  const r = plates(['morning', '--send', '--date', NIGHT, '--json'], p.root, { PLATES_GH: p.gh });
  assert.equal(r.code, 0, r.err + r.out);
  assert.deepEqual({ ...r.json(), readiness: undefined }, { ok: true, sent: true, date: NIGHT, issue: 31, url: 'https://github.com/acme/anvils/issues/31', assignee: 'acme-owner', closed: [30], readiness: undefined });
  const issues = await p.issuesNow();
  const sent = issues.find(i => i.number === 31);
  assert.deepEqual([sent.title, sent.state, sent.assignee, sent.label], [titleOf(NIGHT), 'OPEN', 'acme-owner', 'keel:morning']);
  assert.equal(sent.body, brief, 'the issue body is the brief');
  assert.deepEqual(issues.filter(i => i.state === 'OPEN').map(i => i.number), [31], 'one open at a time');
  assert.equal(issues.find(i => i.number === 30).comment, 'Superseded by #31 (plates morning).');
  const calls = (await p.calls()).map(c => c.a);
  assert.ok(calls.every(a => a.includes('--repo') && a[a.indexOf('--repo') + 1] === 'acme/anvils'), 'every call names the repo');
  assert.deepEqual(calls.map(a => a.slice(0, 2).join(' ')), ['issue list', 'label create', 'issue create', 'issue close']);
  // Again, the same night: nothing.
  const again = plates(['morning', '--send', '--date', NIGHT, '--json'], p.root, { PLATES_GH: p.gh });
  assert.equal(again.code, 0);
  assert.deepEqual(again.json(), { ok: true, sent: false, date: NIGHT, issue: 31, why: 'already sent' });
  assert.deepEqual((await p.calls()).slice(4).map(c => c.a.slice(0, 2).join(' ')), ['issue list'], 'nothing is created or closed');
  // Closed since: still this night's brief, never sent again.
  const closed = await project(t, { issues: [{ number: 31, title: titleOf(NIGHT), state: 'CLOSED' }] });
  assert.equal(plates(['morning', '--send', '--date', NIGHT, '--json'], closed.root, { PLATES_GH: closed.gh }).json().sent, false);
});

test('--send with no morning.assignee refuses, naming the key, and calls no gh; a failed create is exit 1', async t => {
  const { morning, ...rest } = CONFIG;
  for (const config of [rest, { ...rest, morning: {} }, { ...rest, morning: { assignee: 'not a login!' } }]) {
    const p = await project(t, { config });
    const r = plates(['morning', '--send', '--date', NIGHT, '--json'], p.root, { PLATES_GH: p.gh });
    assert.equal(r.code, 2);
    assert.match(r.json().error, /^morning\.assignee is not set in \.plates\/plates\.json/);
    assert.deepEqual(await p.calls(), []);
  }
  assert.equal(morning.assignee, 'acme-owner');
  const down = await project(t, { failCreate: true });
  const r = plates(['morning', '--send', '--date', NIGHT, '--json'], down.root, { PLATES_GH: down.gh });
  assert.equal(r.code, 1, 'a send that fails is red');
  assert.match(r.json().error, /cannot open the issue "Good morning, 2026-10-05": gh exited 1, HTTP 502/);
});

test('the workflow\'s decision: over and unsent, or not yet; already sent; no assignee is said, never sent', async t => {
  const p = await project(t);
  // decide reads the clock: in-process, with a fixed now (the script is the same module).
  const { decide: decideFn } = await import('../lib/morning.mjs');
  const out = join(p.base, 'out-before');
  const before = await decideFn({ root: p.root, env: { ...ENV, PLATES_GH: p.gh }, now: BEFORE, githubOutput: out });
  assert.deepEqual([before.data.day, before.data.ready, before.data.sent, before.data.assignee], [NIGHT, false, false, 'set']);
  assert.equal(await readFile(out, 'utf8'), `day=${NIGHT}\nready=false\nsent=false\nassignee=set\nplan=found\n`);
  assert.deepEqual(await p.calls(), [], 'a night not over asks GitHub nothing');
  const after = await decideFn({ root: p.root, env: { ...ENV, PLATES_GH: p.gh }, now: AFTER });
  assert.deepEqual([after.data.ready, after.data.sent], [true, false]);
  // Every build terminal: over before readyBy.
  const done = await project(t, { branch: { ...finished(), items: finished().items.map(i => (i.id === 'climb-docs' ? { ...i, status: 'done', result: { link: 'https://github.com/acme/anvils/pull/22' } } : i)) } });
  assert.equal((await decideFn({ root: done.root, env: { ...ENV, PLATES_GH: done.gh }, now: BEFORE })).data.ready, true);
  // Sent: the workflow does nothing more.
  const sent = await project(t, { issues: [{ number: 31, title: titleOf(NIGHT), state: 'OPEN' }] });
  const s = await decideFn({ root: sent.root, env: { ...ENV, PLATES_GH: sent.gh }, now: AFTER });
  assert.deepEqual([s.data.ready, s.data.sent, s.data.why], [true, true, 'already sent as #31']);
  const { morning: _, ...rest } = CONFIG;
  const unset = await project(t, { config: rest });
  assert.equal((await decideFn({ root: unset.root, env: { ...ENV, PLATES_GH: unset.gh }, now: AFTER })).data.assignee, 'unset');
  // The project's own script, as plates-morning.yml runs it: its output lines.
  const lines = join(p.base, 'out-script');
  const r = run(process.execPath, [join(p.root, 'scripts/plates/morning.mjs'), 'decide', '--github-output', lines, '--json'], { cwd: p.root, env: { ...ENV, PLATES_GH: p.gh } });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(await readFile(lines, 'utf8'), /^day=\d{4}-\d{2}-\d{2}\nready=(true|false)\nsent=(true|false)\nassignee=set\nplan=(found|none)\n$/);
});

test('plates#137: finalization puts a later build outcome in the night\'s record and its health page, keeping the rest of the page', async t => {
  const p = await project(t);
  const pageBefore = await readFile(join(p.root, `docs/health/${NIGHT}.md`), 'utf8');
  // The project's own script, as plates-morning.yml's finalize job runs it.
  const r = run(process.execPath, [join(p.root, 'scripts/plates/morning.mjs'), 'finalize', '--date', NIGHT, '--pr-input', join(p.base, 'pr.json'), '--json'], { cwd: p.root, env: { ...ENV, PLATES_GH: p.gh } });
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
  // plates-morning finalizes on every run once the night is over, sent or not: a repeat with nothing new writes the same bytes.
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
    const r = plates(['morning', '--card', '--yes', '--date', NIGHT, '--json'], p.root, { PLATES_GH: p.gh, PLATES_ISOCAN: join(p.base, 'no-isocan') });
    assert.equal(r.code, 2, JSON.stringify(canvas));
    assert.match(r.json().error, canvas ? /plates canvas live --card pulse --card night-plan --yes/ : /No canvas is bound/);
    assert.equal(existsSync(join(p.root, '.plates/canvas')), false, 'nothing was written');
  }
});

test('equal-rank ticks: the plan branch wins a tie, so a later done after a recorded failure, and a mended note or link on a done item, reach the brief', async t => {
  const withItem = (plan, id, over) => ({ ...plan, items: plan.items.map(i => (i.id === id ? { ...i, ...over } : i)) });
  // The record says failed; the plan branch, ticked later, says done (both terminal).
  const p = await project(t);
  await writeFile(join(p.root, `docs/night/${NIGHT}.json`), `${JSON.stringify(withItem(finished(), 'perf-bundle', { status: 'failed', result: { note: 'the first try timed out' } }), null, 2)}\n`);
  const later = (await finalPlan({ root: p.root, date: NIGHT })).plan.items.find(i => i.id === 'perf-bundle');
  assert.deepEqual([later.status, later.result], ['done', { note: 'Split the vendor chunk', link: PR }]);
  // Both done; the plan branch mends the note and link (night-plan.mjs allows done → done).
  const mended = await project(t, { branch: withItem(finished(), 'perf-bundle', { result: { note: 'Split the vendor chunk, 19 kB under', link: 'https://github.com/acme/anvils/pull/22' } }) });
  await writeFile(join(mended.root, `docs/night/${NIGHT}.json`), `${JSON.stringify(finished(), null, 2)}\n`);
  const fixed = (await finalPlan({ root: mended.root, date: NIGHT })).plan.items.find(i => i.id === 'perf-bundle');
  assert.deepEqual(fixed.result, { note: 'Split the vendor chunk, 19 kB under', link: 'https://github.com/acme/anvils/pull/22' });
  // A higher rank still beats the branch: its running never undoes a recorded done.
  const behind = await project(t, { branch: withItem(finished(), 'perf-bundle', { status: 'running', result: null }) });
  await writeFile(join(behind.root, `docs/night/${NIGHT}.json`), `${JSON.stringify(finished(), null, 2)}\n`);
  assert.equal((await finalPlan({ root: behind.root, date: NIGHT })).plan.items.find(i => i.id === 'perf-bundle').status, 'done');
});

test('the brief\'s repo: in a GitHub Actions run, the run\'s own repository; anywhere else, the project\'s config, never a stray GITHUB_REPOSITORY', async t => {
  const { repoOf } = morningModule;
  assert.equal(typeof repoOf, 'function');
  assert.equal(repoOf(CONFIG, { GITHUB_REPOSITORY: 'acme/elsewhere' }), 'acme/anvils', 'a local or test run: the config wins');
  assert.equal(repoOf(CONFIG, { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'acme/elsewhere' }), 'acme/elsewhere', 'in the workflow: the run\'s repository is the truth');
  assert.equal(repoOf(CONFIG, { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'not a repo' }), 'acme/anvils');
  assert.equal(repoOf({}, { GITHUB_REPOSITORY: 'acme/elsewhere' }), null, 'outside Actions with no config repo: no GitHub link, the page\'s path');
  // End to end: a stray GITHUB_REPOSITORY (plates's own CI) does not move the fixture's links.
  const p = await project(t);
  const r = plates(['morning', '--date', NIGHT, '--json'], p.root, { PLATES_GH: p.gh, GITHUB_REPOSITORY: 'acme/elsewhere' });
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(r.json().links.health, LINKS.health);
});

// Phase 78: the card ticks. Through a fake isocan home (tests/helpers/isocan.mjs): the card is
// republished from tonight's plan as it stands after each pass; a person's edit stops it.
test('the plan card republishes after each tick through the live card\'s conditional edit, sends nothing when nothing ticked, and stops at a person\'s edit', async t => {
  const { fixture: isocan } = await import('./helpers/isocan.mjs');
  const { publishPlanCard } = morningModule;
  const f = await isocan(t);
  await f.attach();
  await f.goLive({ cards: ['pulse', PLAN_CARD] });
  const night = async plan => { await mkdir(join(f.root, '.plates/night'), { recursive: true }); await writeFile(join(f.root, PLAN), `${JSON.stringify(plan, null, 2)}\n`); };
  const publish = () => publishPlanCard({ root: f.root, date: NIGHT, yes: true }, { transport: f.transport });
  const cardNow = async () => f.remote.items.get(JSON.parse(await readFile(join(f.root, '.plates/canvas/manifest.json'), 'utf8')).items[PLAN_CARD].itemId);
  // The night starts: the card is made once, from the plan as the night recorded it.
  await night(asRecorded());
  const first = await publish();
  assert.equal(first.exitCode ?? 0, 0, JSON.stringify(first.data));
  assert.equal(first.data.card, PLAN_CARD);
  const card = await cardNow();
  const made = card.currentVersionId;
  // Nothing ticked since: nothing sent.
  const same = await publish();
  assert.equal(same.data.state, 'unchanged');
  assert.equal(f.remote.edits.length, 0);
  // Climb finishes: its tick republishes the same card in place, one conditional edit on the version plates recorded.
  const climbed = asRecorded();
  climbed.items = climbed.items.map(i => (i.id === 'perf-bundle' ? { ...i, status: 'done', result: { note: 'Split the vendor chunk', link: PR } } : i));
  await night(climbed);
  const ticked = await publish();
  assert.equal(ticked.data.state, 'published', JSON.stringify(ticked.data));
  assert.equal(f.remote.edits.length, 1);
  assert.equal(f.remote.edits[0].ifVersion, made, 'the edit is conditional on plates\'s own last version');
  assert.notEqual((await cardNow()).currentVersionId, made, 'the card moved');
  assert.equal((await cardNow()).id, card.id, 'the same card, edited in place: never a new card per tick');
  assert.equal(f.remote.adds, [...f.remote.items.values()].filter(i => i.properties?.['keel.key']).length, 'no card was added for the tick');
  // A person edits the card: the next tick sends nothing, and says so; updates stay stopped.
  const human = await cardNow();
  human.versions.push({ id: 'ver_person', blobHash: 'f'.repeat(64) }); human.currentVersionId = 'ver_person';
  const robot = { ...climbed, items: climbed.items.map(i => (i.id === 'robot-12' ? { ...i, status: 'failed', result: { note: 'the gate failed' } } : i)) };
  await night(robot);
  const stopped = await publish();
  assert.equal(stopped.exitCode, 1);
  assert.equal(stopped.data.state, 'conflict');
  assert.equal(f.remote.edits.length, 1, 'no edit is sent over a person\'s (mutation: an unconditional republish writes over it)');
  assert.equal((await cardNow()).currentVersionId, 'ver_person');
  await night({ ...robot, items: robot.items.map(i => (i.id === 'climb-docs' ? { ...i, status: 'done' } : i)) });
  assert.equal((await publish()).data.state, 'conflict', 'still stopped at the next pass');
  assert.equal(f.remote.edits.length, 1);
});

test('on CI the card keeps the night\'s journal: restored from the newest canvas writer, saved for the next, with plates-morning\'s provenance', async t => {
  const { fixture: isocan } = await import('./helpers/isocan.mjs');
  const { restoreJournal } = await import('../lib/canvas-night.mjs');
  const { publishPlanCard } = morningModule;
  const f = await isocan(t);
  await f.attach();
  await f.goLive({ cards: ['pulse', PLAN_CARD] });
  await mkdir(join(f.root, '.plates/night'), { recursive: true });
  await writeFile(join(f.root, PLAN), `${JSON.stringify(asRecorded(), null, 2)}\n`);
  const config = JSON.parse(await readFile(join(f.root, '.plates/plates.json'), 'utf8'));
  await writeFile(join(f.root, '.plates/plates.json'), JSON.stringify({ ...config, canvas: { ...config.canvas, cadence: 'nightly' } }));
  const output = await realpath(await mkdtemp(join(tmpdir(), 'plates-card-output-')));
  t.after(() => rm(output, { recursive: true, force: true }));
  const env = { ...ENV, PLATES_CANVAS_PERSISTENCE: 'artifact-v1', PLATES_CANVAS_OUTPUT: output, GITHUB_REPOSITORY: 'acme/anvils', GITHUB_RUN_ID: '300', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'b'.repeat(40) };
  const r = await publishPlanCard({ root: f.root, date: NIGHT, yes: true, env, now: new Date() }, { transport: f.transport });
  assert.equal(r.exitCode ?? 0, 0, JSON.stringify(r.data));
  const bundle = JSON.parse(await readFile(join(output, 'recovery.json'), 'utf8'));
  assert.deepEqual(bundle.provenance, { repo: 'acme/anvils', workflow: '.github/workflows/plates-morning.yml', runId: '300', attempt: 1, headSha: 'b'.repeat(40) });
  assert.ok(bundle.manifest.items[PLAN_CARD], 'the card\'s own receipt travels in the journal');
  // A fresh checkout (the next night, or the next pass) restores it: one journal, so the card's edit is never taken for a person's.
  const fresh = await realpath(await mkdtemp(join(tmpdir(), 'plates-card-fresh-')));
  t.after(() => rm(fresh, { recursive: true, force: true }));
  await mkdir(join(fresh, '.plates'), { recursive: true });
  await writeFile(join(fresh, '.plates/plates.json'), await readFile(join(f.root, '.plates/plates.json'), 'utf8'));
  const restored = await restoreJournal({ root: fresh, config: JSON.parse(await readFile(join(fresh, '.plates/plates.json'), 'utf8')), env: { PLATES_CANVAS_RECOVERY: join(output, 'recovery.json') }, yes: true, now: Date.now() + 1000 });
  assert.equal(restored.binding.canvasId, config.canvas.canvasId);
  assert.deepEqual(JSON.parse(await readFile(join(fresh, '.plates/canvas/manifest.json'), 'utf8')).items[PLAN_CARD], bundle.manifest.items[PLAN_CARD]);
  // No journal to restore, and none provisioned: nothing is published.
  const empty = await realpath(await mkdtemp(join(tmpdir(), 'plates-card-empty-')));
  t.after(() => rm(empty, { recursive: true, force: true }));
  await mkdir(join(empty, '.plates'), { recursive: true });
  await cp(join(f.root, '.plates/plates.json'), join(empty, '.plates/plates.json'));
  await mkdir(join(empty, '.plates/night'), { recursive: true });
  await writeFile(join(empty, PLAN), `${JSON.stringify(asRecorded(), null, 2)}\n`);
  const adds = f.remote.adds;
  await assert.rejects(publishPlanCard({ root: empty, date: NIGHT, yes: true, env: { ...env, PLATES_CANVAS_OUTPUT: join(empty, 'out') } }, { transport: f.transport }), e => e.exitCode === 1 && /could not be restored/.test(e.message));
  assert.equal(f.remote.adds, adds, 'nothing was written to the canvas');
});

// plates#149: the issues go where the links point, and the night's page is read where its record was.
test('in a GitHub Actions run, --send lists, labels, opens and closes its issues in the run\'s own repository, the one the brief links into', async t => {
  const p = await project(t, { issues: [{ number: 30, title: 'Good morning, 2026-10-04', state: 'OPEN' }] });
  const r = plates(['morning', '--send', '--date', NIGHT, '--json'], p.root, { PLATES_GH: p.gh, GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'acme/anvils-fork' });
  assert.equal(r.code, 0, r.err + r.out);
  const calls = (await p.calls()).map(c => c.a);
  assert.deepEqual(calls.map(a => a.slice(0, 2).join(' ')), ['issue list', 'label create', 'issue create', 'issue close']);
  assert.deepEqual(calls.map(a => a[a.indexOf('--repo') + 1]), Array(4).fill('acme/anvils-fork'), 'not the config\'s acme/anvils');
  assert.match((await p.issuesNow()).find(i => i.number === 31).body, /https:\/\/github\.com\/acme\/anvils-fork\/blob\//);
});

test('while the night\'s PR is unmerged, the brief reads the night\'s health page from the night\'s branch, where its record came from, and links it there', async t => {
  const p = await project(t);
  // The night's PR is open: its branch holds the record and the page; the default branch has only an older page.
  git(p.root, 'push', '-q', 'origin', `main:refs/heads/keel-night/${NIGHT}`);
  await writeFile(join(p.root, 'docs/health/2026-10-04.md'), page('2026-10-04', 790000));
  git(p.root, 'rm', '-q', `docs/night/${NIGHT}.json`, `docs/health/${NIGHT}.md`);
  git(p.root, 'add', '-A'); git(p.root, 'commit', '-q', '-m', 'Acme: main without the night');
  git(p.root, 'push', '-q', 'origin', 'main');
  const found = await finalPlan({ root: p.root, date: NIGHT });
  assert.deepEqual([found.from, found.branch], [`keel-night/${NIGHT}:docs/night/${NIGHT}.json`, `keel-night/${NIGHT}`]);
  const h = await healthAround(p.root, CONFIG, NIGHT, { branch: found.branch });
  assert.deepEqual([h.before.file, h.before.ref, h.after.file, h.after.ref], [`docs/health/${NIGHT}.md`, `keel-night/${NIGHT}`, 'docs/health/2026-10-06.md', `keel-night/${NIGHT}`]);
  const r = plates(['morning', '--date', NIGHT, '--json'], p.root, { PLATES_GH: p.gh });
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(r.json().links.health, `https://github.com/acme/anvils/blob/keel-night/${NIGHT}/docs/health/${NIGHT}.md`);
  assert.match(r.json().markdown, /760000 before → 741000 after/, 'the night\'s own numbers, not the older page\'s 790000');
  // Merged, the checkout's page is the night's, linked at HEAD as before.
  const merged = await project(t);
  assert.equal(plates(['morning', '--date', NIGHT, '--json'], merged.root, { PLATES_GH: merged.gh }).json().links.health, LINKS.health);
});

// Phase 81: a failed verify of production is a line in the next morning brief, once.
test('a failed verify is a line in the next morning brief: each failure of the day before the night, in exactly one brief; an unreadable record is said', async t => {
  const sha = 'a1b2c3d'.padEnd(40, '0'), site = 'https://anvils.acme.example', run = 'https://github.com/acme/anvils/actions/runs/7';
  const result = (at, ok, failures = ok ? [] : ['GET /login: expected 307, got 500']) => ({ sha, ok, at, site, serving: sha, failures, ...(ok ? {} : { run }) });
  // The day before the night of 2026-10-05 started (07:23 UTC): from 2026-10-04 07:23 to 2026-10-05 07:23.
  const results = [result('2026-10-05T09:00:00Z', false), result('2026-10-05T07:00:00Z', true), result('2026-10-04T20:00:00Z', false), result('2026-10-04T07:00:00Z', false)];
  const { verifyFailuresFor, verifyLine } = morningModule;
  const tonight = verifyFailuresFor(results, NIGHT);
  assert.deepEqual(tonight.map(r => [r.at, r.passedSince]), [['2026-10-04T20:00:00Z', true]]);
  assert.deepEqual(verifyFailuresFor(results, '2026-10-06').map(r => r.at), ['2026-10-05T09:00:00Z'], 'one that failed after the night started is the next brief\'s');
  assert.deepEqual(verifyFailuresFor(results, '2026-10-04').map(r => r.at), ['2026-10-04T07:00:00Z']);
  // Every failure in exactly one night's brief.
  const nights = ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'];
  for (const r of results.filter(r => !r.ok)) assert.equal(nights.filter(d => verifyFailuresFor(results, d).some(f => f.at === r.at)).length, 1, r.at);
  const line = `Production failed its verify for \`a1b2c3d\` at 2026-10-04T20:00:00Z (${site}): GET /login: expected 307, got 500. ${run} Production has passed a verify since.`;
  assert.equal(verifyLine(tonight[0]), line);
  const b = renderBrief({ plan: finished(), now: AFTER, health: HEALTH, links: LINKS, verify: { failed: tonight, unread: null } });
  assert.equal(b.next[0], line, 'production first, under Your next');
  assert.match(b.markdown, new RegExp(`## Your next\\n\\n- ${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`));
  assert.equal(renderBrief({ plan: finished(), now: AFTER, health: HEALTH, links: LINKS, verify: { failed: [], unread: null } }).markdown, renderBrief({ plan: finished(), now: AFTER, health: HEALTH, links: LINKS }).markdown, 'nothing failed: the brief is as before');
  assert.match(renderBrief({ plan: finished(), now: AFTER, verify: { failed: [], unread: 'git ls-remote exited 128' } }).next[0], /^The verify record \(keel-verify:verify\.json\) could not be read: git ls-remote exited 128\. Whether production passed is unknown\.$/);

  // End to end: with delivery on, the brief reads origin's keel-verify branch.
  const p = await project(t, { config: { ...CONFIG, practices: ['night', 'delivery'] } });
  const write = (args, input) => execFileSync('git', args, { cwd: p.root, input, encoding: 'utf8' }).trim();
  const b2 = write(['hash-object', '-w', '--stdin'], JSON.stringify({ results }));
  const tree = write(['mktree'], `100644 blob ${b2}\tverify.json\n`);
  write(['push', '-q', 'origin', `${write(['commit-tree', tree, '-m', 'plates verify'])}:refs/heads/keel-verify`]);
  const r = plates(['morning', '--date', NIGHT, '--json'], p.root, { PLATES_GH: p.gh });
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(r.json().next[0], line);
  assert.deepEqual(await p.calls(), [], 'reading the record never calls gh');
  // Without delivery, the record is not read and the brief is as before.
  const off = await project(t);
  assert.doesNotMatch(plates(['morning', '--date', NIGHT, '--json'], off.root, { PLATES_GH: off.gh }).json().markdown, /verify/);
  // A record that is not one: said in the brief, never "nothing failed".
  const bad = write(['hash-object', '-w', '--stdin'], '{"results": "Acme"}');
  const badTree = write(['mktree'], `100644 blob ${bad}\tverify.json\n`);
  write(['push', '-q', '--force', 'origin', `${write(['commit-tree', badTree, '-m', 'not a record'])}:refs/heads/keel-verify`]);
  assert.match(plates(['morning', '--date', NIGHT, '--json'], p.root, { PLATES_GH: p.gh }).json().next[0], /^The verify record \(keel-verify:verify\.json\) could not be read: verify\.json holds no "results" list\./);
});

// PR #182 review: a preview's pass counted as production having passed since.
test('in the brief, "passed since" is the same site\'s pass only, and a preview\'s failure is said as the preview\'s', () => {
  const { verifyFailuresFor, verifyLine } = morningModule;
  const prod = 'https://anvils.acme.example', preview = 'https://preview-7.anvils.acme.example', sha = 'a1b2c3d'.padEnd(40, '0');
  const r = (site, ok, at) => ({ sha, ok, at, site, serving: sha, failures: ok ? [] : ['GET /: expected 200, got 500'], run: null });
  const failed = r(prod, false, '2026-10-04T20:00:00Z');
  let [f] = verifyFailuresFor([r(preview, true, '2026-10-04T21:00:00Z'), failed], NIGHT, { production: prod });
  assert.equal(f.passedSince, false, 'a preview\'s pass is not production\'s');
  assert.doesNotMatch(verifyLine(f), /passed a verify since/);
  [f] = verifyFailuresFor([r(prod, true, '2026-10-04T22:00:00Z'), failed], NIGHT, { production: prod });
  assert.equal(f.passedSince, true);
  [f] = verifyFailuresFor([r(preview, false, '2026-10-04T20:00:00Z')], NIGHT, { production: prod });
  assert.equal(verifyLine(f), `The preview ${preview} failed its verify for \`a1b2c3d\` at 2026-10-04T20:00:00Z: GET /: expected 200, got 500.`);
});
