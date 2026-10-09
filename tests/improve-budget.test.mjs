// The health page's Budget line (phase 43): each budgeted pass that is on
// (climb, tend, cross-review) shows its agent step's minutes in its last runs,
// from GitHub's record of the workflow's runs and jobs, which ran out, and a
// suggestion: extend, shorten to N, hold, or too few to say. A line, never a
// measure, and never a change. Synthetic runs: Acme's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { improve } from '../practices/night/files/scripts/keel/improve.mjs';
import { budgetUse, budgetPasses, budgetSince, budgetRaw, stepUse, BUDGET_RUNS, BUDGET_PASSES } from '../practices/night/files/scripts/keel/lib.mjs';
import { ENV, ghStub } from './helpers/improve.mjs';

const T0 = Date.parse('2026-10-01T09:42:00Z');
/**
 * A run's jobs whose agent step (`step`) used `min` minutes and ended
 * `conclusion`; 'skipped' never ran it. `ran`: its "Did the agent run?"
 * step's conclusion, or none (a run from before that step).
 */
const run = (min, { step = 'Tend', conclusion = 'success', camel = false, ran, created } = {}) => ({
  ...(created ? { created_at: created } : {}),
  jobs: [{ name: 'acme', steps: [
    { name: 'Set up job', conclusion: 'success', started_at: new Date(T0 - 60_000).toISOString(), completed_at: new Date(T0).toISOString() },
    conclusion === 'skipped'
      ? { name: step, conclusion: 'skipped', started_at: null, completed_at: null }
      : { name: step, conclusion, [camel ? 'startedAt' : 'started_at']: new Date(T0).toISOString(), [camel ? 'completedAt' : 'completed_at']: new Date(T0 + min * 60_000).toISOString() },
    ...(ran ? [{ name: 'Did the agent run?', conclusion: ran, started_at: new Date(T0 + min * 60_000).toISOString(), completed_at: new Date(T0 + min * 60_000 + 1000).toISOString() }] : []),
  ] }],
});
const tend = { step: 'Tend', check: 'Did the agent run?', minutes: 30 };

test('budgetUse: minutes from the agent step, a cancelled or full step ran out, a run without the step skipped', () => {
  const u = budgetUse([run(2), run(3, { camel: true }), run(12, { conclusion: 'cancelled' }), run(29.5), run(0, { conclusion: 'skipped' }), { jobs: [{ steps: [{ name: 'Brief', conclusion: 'success' }] }] }], tend);
  assert.deepEqual(u.used, [{ minutes: 2, ranOut: false }, { minutes: 3, ranOut: false }, { minutes: 12, ranOut: true }, { minutes: 30, ranOut: true }]);
  assert.equal(u.ranOut, 2);
  assert.equal(stepUse(run(28.9).jobs, tend).ranOut, false, 'under the budget less one minute');
  assert.equal(stepUse(run(29).jobs, tend).ranOut, true, 'the budget less one minute');
  assert.equal(stepUse(run(5, { conclusion: 'timed_out' }).jobs, tend).ranOut, true);
  assert.equal(stepUse(run(5, { step: 'Climb' }).jobs, tend), null, 'another pass\'s step is not this one');
});

test('budgetUse: a run whose agent never started is skipped: its agent step says success (continue-on-error), its check step failure', () => {
  const never = run(17 / 60, { ran: 'failure' });
  assert.equal(never.jobs[0].steps[1].conclusion, 'success');
  assert.equal(stepUse(never.jobs, tend), null);
  assert.deepEqual(stepUse(run(4, { ran: 'success' }).jobs, tend), { seconds: 240, ranOut: false }, 'the agent ran');
  assert.deepEqual(stepUse(run(4).jobs, tend), { seconds: 240, ranOut: false }, 'a run from before the check step is counted');
  const u = budgetUse([run(3), never, never, never, run(2), run(3), run(4)], tend);
  assert.deepEqual(u.used.map(x => x.minutes), [3, 2, 3, 4]);
  assert.equal(u.suggestion, 'shorten to 5');
});

test('budgetUse: the suggestion over the last runs (at most 8): extend, shorten to N, hold, too few to say', () => {
  assert.equal(budgetUse([run(30), run(2), run(3)], tend).suggestion, 'too few to say', 'three runs');
  assert.equal(budgetUse([], tend).suggestion, 'too few to say');
  assert.equal(budgetUse([run(30), run(29), run(3), run(4)], tend).suggestion, 'extend', 'half ran out');
  assert.equal(budgetUse([run(30, { conclusion: 'cancelled' }), run(29), run(3), run(4), run(5)], tend).suggestion, 'hold', 'two of five ran out');
  assert.equal(budgetUse([run(2), run(11.2), run(3), run(4)], tend).suggestion, 'shorten to 15', 'none above half: the most, rounded up to 5');
  assert.equal(budgetUse([run(1), run(2), run(1), run(0)], tend).suggestion, 'shorten to 5', 'at least 5');
  assert.equal(budgetUse([run(2), run(16), run(3), run(4)], tend).suggestion, 'hold', 'one above half, none ran out');
  assert.equal(budgetUse([run(2), run(3), run(2), run(4)], { step: 'Tend', minutes: 5 }).suggestion, 'hold', 'shortening to the budget is no change');
  // The window: the newest eight that reached the step; older runs are not counted.
  const nine = [...Array(8).fill(0).map(() => run(2)), run(30), run(30), run(30), run(30), run(30)];
  const w = budgetUse(nine, tend);
  assert.equal(w.used.length, BUDGET_RUNS);
  assert.equal(w.suggestion, 'shorten to 5');
});

test('budgetPasses: a pass is on by its key, with its budget or the default', () => {
  assert.deepEqual(budgetPasses({}), []);
  assert.deepEqual(budgetPasses({ tend: {}, climb: { budget: { minutes: 20 } }, crossReview: { for: ['codex/'] } }).map(p => [p.pass, p.step, p.check, p.minutes]),
    [['tend', 'Tend', 'Did the agent run?', 30], ['climb', 'Climb', 'Did the agent run?', 20], ['cross-review', 'Review', 'Did the agent run?', 15]]);
});

/** An Acme repo with this config. */
async function acme(t, config) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'keel-improve-budget-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, '.keel'), { recursive: true });
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ name: 'Acme', practices: ['base', 'night', 'climb'], ...config }));
  return dir;
}
const pageOf = async (dir, gh) => {
  const r = await improve({ root: dir, report: true, date: '2026-10-07' }, { env: { ...ENV, ...(gh ? { KEEL_GH: gh } : {}) }, measures: [] });
  return { data: r.data, text: await readFile(join(dir, 'docs/health/2026-10-07.md'), 'utf8') };
};
const R = 'repos/acme/anvils';
/** The REST answers for these workflows' runs: { 'keel-tend.yml': [run, …] }, ids numbered. */
function actions(byWorkflow, { history = [] } = {}) {
  const api = { [R]: { default_branch: 'main' }, [`${R}/commits`]: history.map(h => ({ sha: h.sha, commit: { committer: { date: h.date } } })) };
  for (const h of history) api[`${R}/contents/.keel/keel.json?ref=${h.sha}`] = h.config === null ? null : { encoding: 'base64', content: Buffer.from(JSON.stringify(h.config)).toString('base64') };
  let id = 100;
  for (const [wf, runs] of Object.entries(byWorkflow)) {
    api[`${R}/actions/workflows/${wf}/runs`] = { workflow_runs: runs.map(r => { const n = id++; api[`${R}/actions/runs/${n}/jobs`] = { jobs: r.jobs }; return { id: n, ...(r.created_at ? { created_at: r.created_at } : {}) }; }) };
  }
  return api;
}

test('the health page has a Budget entry for each pass that is on and none for one that is off', async t => {
  const api = actions({
    'keel-tend.yml': [run(2), run(3), run(30, { conclusion: 'cancelled' })],
    'keel-climb.yml': [run(41, { step: 'Climb' }), run(45, { step: 'Climb', conclusion: 'cancelled' }), run(44, { step: 'Climb' }), run(0, { step: 'Climb', conclusion: 'skipped' }), run(0.3, { step: 'Climb', ran: 'failure' }), run(45, { step: 'Climb' }), run(44.5, { step: 'Climb' })],
  });
  const gh = await ghStub(t, { api });
  const both = await pageOf(await acme(t, { repo: 'acme/anvils', tend: { budget: { minutes: 30 } }, climb: { jobs: ['test-time'] } }), gh);
  const line = 'Budget: tend 2, 3, 30⏱ of 30 min (last 3 runs; too few to say) · climb 41, 45⏱, 44⏱, 45⏱, 45⏱ of 45 min (last 5: 4 ran out; extend)';
  assert.match(both.text, new RegExp(`^${line.replace(/[()]/g, '\\$&')}$`, 'm'));
  assert.equal(both.data.budget, line);
  assert.doesNotMatch(both.text, /\| `budget/, 'a line, never a measure row');
  const asked = await readFile(`${gh}.api.log`, 'utf8');
  assert.match(asked, /actions\/workflows\/keel-tend\.yml\/runs\?status=completed&per_page=20&branch=main/, 'completed runs on the default branch');

  const tendOnly = await pageOf(await acme(t, { repo: 'acme/anvils', tend: {} }), gh);
  assert.match(tendOnly.text, /^Budget: tend 2, 3, 30⏱ of 30 min \(last 3 runs; too few to say\)$/m);
  assert.doesNotMatch(tendOnly.text, /climb/, 'climb off: no entry');

  const none = await pageOf(await acme(t, { repo: 'acme/anvils' }), gh);
  assert.doesNotMatch(none.text, /Budget:/, 'no pass on, no line');
  assert.equal(none.data.budget, null);
});

test('GitHub unreadable is n/a with why, never an empty line', async t => {
  const unread = await pageOf(await acme(t, { repo: 'acme/anvils', tend: {} }), await ghStub(t, { api: {} }));
  assert.match(unread.text, /^Budget: tend n\/a \(gh api repos\/acme\/anvils: exit 1, gh: Not Found \(HTTP 404\)\) of 30 min$/m);

  const noWorkflow = await pageOf(await acme(t, { repo: 'acme/anvils', tend: {}, climb: { jobs: ['test-time'] } }), await ghStub(t, { api: actions({ 'keel-tend.yml': [run(2)] }) }));
  assert.match(noWorkflow.text, /^Budget: tend 2 of 30 min \(last 1 run; too few to say\) · climb n\/a \(gh api repos\/acme\/anvils\/actions\/workflows\/keel-climb\.yml\/runs: exit 1, gh: Not Found \(HTTP 404\)\) of 45 min$/m, 'one pass unread, the other still said');

  const noRepo = await pageOf(await acme(t, { tend: {} }));
  assert.match(noRepo.text, /^Budget: tend n\/a \(no repo in \.keel\/keel\.json\) of 30 min$/m);

  const noGh = await pageOf(await acme(t, { repo: 'acme/anvils', tend: {} }), join(tmpdir(), 'keel-no-such-gh'));
  assert.match(noGh.text, /^Budget: tend n\/a \(gh api: gh is not installed \(.*keel-no-such-gh\)\) of 30 min$/m);

  const empty = await pageOf(await acme(t, { repo: 'acme/anvils', tend: {} }), await ghStub(t, { api: actions({ 'keel-tend.yml': [] }) }));
  assert.match(empty.text, /^Budget: tend: no runs yet of 30 min \(too few to say\)$/m);
});

test('the read is bounded: it stops once eight runs reached the step', async t => {
  const gh = await ghStub(t, { api: actions({ 'keel-tend.yml': Array(15).fill(0).map(() => run(2)) }) });
  const p = await pageOf(await acme(t, { repo: 'acme/anvils', tend: {} }), gh);
  assert.match(p.text, /^Budget: tend 2, 2, 2, 2, 2, 2, 2, 2 of 30 min \(last 8: none ran out; shorten to 5\)$/m);
  const jobs = (await readFile(`${gh}.api.log`, 'utf8')).split('\n').filter(l => l.includes('/jobs'));
  assert.equal(jobs.length, 8);
});

test('a budget changed is judged only by its runs since: raised 15 to 30, three runs that ran out at 15 are not counted', async t => {
  const at = day => `2026-09-${String(day).padStart(2, "0")}T09:42:00Z`;
  const runs = [
    run(3, { created: at(28) }), run(2, { created: at(21) }),
    run(15, { created: at(14), conclusion: 'cancelled' }), run(14.5, { created: at(7) }), run(15, { created: at(1), conclusion: 'cancelled' }),
  ];
  const history = [
    { sha: 'c3', date: '2026-09-27T10:00:00Z', config: { tend: { budget: { minutes: 30 } }, climb: { jobs: ['test-time'] } } },
    { sha: 'c2', date: '2026-09-20T10:00:00Z', config: { tend: { budget: { minutes: 30 } } } },
    { sha: 'c1', date: '2026-08-30T10:00:00Z', config: { tend: { budget: { minutes: 15 } } } },
    { sha: 'c0', date: '2026-08-01T10:00:00Z', config: { tend: {} } },
  ];
  const gh = await ghStub(t, { api: actions({ 'keel-tend.yml': runs }, { history }) });
  const p = await pageOf(await acme(t, { repo: 'acme/anvils', tend: { budget: { minutes: 30 } } }), gh);
  assert.match(p.text, /^Budget: tend 3, 2 of 30 min since 2026-09-20 \(last 2 runs; too few to say\)$/m, 'not shorten: the runs at 15 were another budget');
  const asked = (await readFile(`${gh}.api.log`, 'utf8')).split('\n');
  assert.ok(asked.includes('repos/acme/anvils/commits?path=.keel/keel.json&sha=main&per_page=30'));
  assert.deepEqual(asked.filter(l => l.includes('/contents/')).map(l => l.split('ref=')[1]), ['c3', 'c2', 'c1'], 'read until one differs, newest first');
  assert.equal(asked.filter(l => l.includes('/jobs')).length, 2, 'no run before the since is read');

  // Pure: the same runs with the cutoff passed in, and without it (the bug: they would say shorten).
  assert.equal(budgetUse(runs, tend, { since: '2026-09-20T10:00:00Z' }).suggestion, 'too few to say');
  assert.equal(budgetSince(history.map(h => ({ date: h.date, config: h.config })), { key: 'tend' }, 30), '2026-09-20T10:00:00Z');
  assert.equal(budgetSince(history.slice(0, 2), { key: 'tend' }, 30), null, 'the whole history read, none differs: no cutoff');
  // Codex on 0.8.7: a read that stopped short (the cap) keeps the oldest commit read as the cutoff, never every run.
  assert.equal(budgetSince(history.slice(0, 2), { key: 'tend' }, 30, { complete: false }), '2026-09-20T10:00:00Z');
  assert.equal(budgetSince(history.slice(2), { key: 'tend' }, 15), '2026-08-30T10:00:00Z');
  // Codex on 0.8.7 and 0.8.8: a budget left to the default is the default of its own practice version, never today's.
  assert.equal(budgetSince(history.slice(3), { key: 'tend' }, 30), null, 'a missing budget is the default of its version (30)');
  const acmePass = { key: 'acme', defaults: [['0.0.0', 15], ['0.9.0', 30]] };
  const implicit = [{ date: '2026-09-27T10:00:00Z', config: { practice: '0.9.1', acme: {} } }, { date: '2026-09-01T10:00:00Z', config: { practice: '0.8.4', acme: {} } }];
  assert.equal(budgetRaw(implicit[1].config, acmePass), 15);
  assert.equal(budgetSince(implicit, acmePass, budgetRaw(implicit[0].config, acmePass)), '2026-09-27T10:00:00Z', 'the default changed 15 → 30 at 0.9.0: runs before are another budget');
  // Codex on cajones#47: a pass off in an older config is not its default: runs from an earlier time it was on are cut off.
  const reenabled = [{ date: '2026-09-27T10:00:00Z', config: { tend: { budget: { minutes: 30 } } } }, { date: '2026-09-10T10:00:00Z', config: {} }, { date: '2026-08-01T10:00:00Z', config: { tend: {} } }];
  assert.equal(budgetSince(reenabled, { key: 'tend' }, 30), '2026-09-27T10:00:00Z');
  // Every shipped pass's newest default is its default today: a changed default must be recorded.
  for (const p of BUDGET_PASSES) assert.equal(p.defaults.at(-1)[1], p.minutes, p.pass);
  // And today's defaults are the passes' own: the scripts that set the timeout.
  const own = { tend: (await import('../scripts/keel/tend.mjs')).TEND_DEFAULTS.minutes, climb: (await import('../scripts/keel/climb.mjs')).DEFAULTS.minutes, 'cross-review': Number(/export const DEFAULTS = Object\.freeze\(\{ minutes: (\d+) \}\)/.exec(await readFile(new URL('../practices/cross-review/files/scripts/keel/cross-review.mjs', import.meta.url), 'utf8'))?.[1]), robot: (await import('../scripts/keel/robot.mjs')).DEFAULTS.runMinutes };
  assert.deepEqual(Object.fromEntries(BUDGET_PASSES.map(p => [p.pass, p.minutes])), own);

  // Lowered 30 to 15: the long runs before are not counted against 15 either.
  const lowered = [run(5, { created: at(28) }), run(29, { created: at(14) }), run(30, { created: at(7) }), run(29, { created: at(1) }), run(30, { created: at(1) })];
  assert.equal(budgetUse(lowered, { ...tend, minutes: 15 }, { since: '2026-09-20T10:00:00Z' }).suggestion, 'too few to say');
});

test('the budget\'s history unreadable is n/a with why, never every run', async t => {
  const runs = [run(3), run(2), run(3), run(4)];
  const noCommits = actions({ 'keel-tend.yml': runs });
  delete noCommits[`${R}/commits`];
  const a = await pageOf(await acme(t, { repo: 'acme/anvils', tend: {} }), await ghStub(t, { api: noCommits }));
  assert.match(a.text, /^Budget: tend n\/a \(gh api repos\/acme\/anvils\/commits: exit 1, gh: Not Found \(HTTP 404\)\) of 30 min$/m);
  const noContent = actions({ 'keel-tend.yml': runs }, { history: [{ sha: 'abc1234def', date: '2026-09-20T10:00:00Z', config: null }] });
  const b = await pageOf(await acme(t, { repo: 'acme/anvils', tend: {} }), await ghStub(t, { api: noContent }));
  assert.match(b.text, /^Budget: tend n\/a \(gh api repos\/acme\/anvils\/contents\/\.keel\/keel\.json: exit 1, gh: Not Found \(HTTP 404\)\) of 30 min$/m);
});
