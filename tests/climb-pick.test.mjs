// climb.mjs's tests, split from climb.test.mjs (2026-10-09) so they run in parallel.
// The synthetic Acme repo and the stubs are in tests/helpers/climb.mjs; nothing here reads the live world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, cp, realpath, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from './helpers/run.mjs';
import { runBlocks } from './helpers/workflows.mjs';
import { NIGHT, WORKFLOW, git, write, commit, acme, climb, json, load, stubGh, page, step, execution, bench, setConfig, LEDGER_TEST, suite } from './helpers/climb.mjs';

test('pick: the job tied to the worst measure, rotation when none is outside, and a job with an open PR waits', async t => {
  const dir = await acme(t, { files: { 'docs/health/2026-10-05.md': page([['gate', 0, '≤ 0', 'ok'], ['slow_tests', 3, '≤ 0', 'outside']]) } });
  const m = await load(dir);
  // Pure: a second job, so the measure and the rotation disagree.
  const table = { ...m.JOBS, 'acme-time': { measures: ['acme_slow'] } };
  const jobs = ['acme-time', 'test-time'];
  const outside = [{ id: 'slow_tests', value: 3, bound: 0, op: '≤', state: 'outside' }];
  assert.deepEqual([m.choose({ jobs, rows: outside, table }).job, m.choose({ jobs, rows: outside, table }).by], ['test-time', 'measure']);
  const both = [{ id: 'acme_slow', value: 1, bound: 0, op: '≤', state: 'outside' }, ...outside];
  assert.equal(m.choose({ jobs, rows: both, table }).job, 'test-time', 'the worst of two outside');
  assert.equal(m.choose({ jobs, rows: [{ ...both[0], state: 'broken' }, ...outside], table }).job, 'acme-time', 'broken beats outside');
  const fine = [{ ...outside[0], state: 'ok', value: 0 }];
  assert.deepEqual(['acme-time', null, 'test-time'].map(last => m.choose({ jobs, rows: fine, table, last: last === null ? 'test-time' : last }).job), ['test-time', 'acme-time', 'acme-time']);
  assert.equal(m.choose({ jobs, rows: fine, table }).job, 'acme-time', 'rotation starts at the first job');
  const waits = m.choose({ jobs, rows: outside, table, waiting: new Set(['test-time']) });
  assert.deepEqual([waits.job, waits.by], ['acme-time', 'rotation'], 'the measure\'s job has an open PR: the next in rotation');
  const all = m.choose({ jobs, rows: outside, table, waiting: new Set(jobs) });
  assert.equal(all.job, null);
  assert.match(all.reason, /every job waits for its open keel-climb\/<job>\/ PR/);
  assert.deepEqual([...m.waitingJobs(['keel-climb/test-time/2026-10-04', 'keel-night/2026-10-05', 'renovate/x'])], ['test-time']);
  // The health page's own rows, read from the table the night writes.
  assert.deepEqual(m.healthRows(page([['slow_tests', 3, '≤ 0', 'outside'], ['ci', '—', '≤ 0', 'n/a']])), [
    { id: 'slow_tests', value: 3, bound: 0, op: '≤', state: 'outside' }, { id: 'ci', value: null, bound: 0, op: '≤', state: 'n/a' }]);

  // The command line, against a stub gh.
  const none = await stubGh(t, ['keel-night/2026-10-05']);
  const p = json(climb(dir, ['pick', '--date', '2026-10-06', '--json'], { KEEL_GH: none }));
  assert.equal(p.job, 'test-time');
  assert.equal(p.by, 'measure');
  assert.match(p.why, /slow_tests is outside on the newest health page \(3 against ≤ 0\)/);
  assert.equal(p.branch, 'keel-climb/test-time/2026-10-06');
  assert.equal(p.health, 'docs/health/2026-10-05.md');
  // An open PR on the job's prefix: no climb tonight. (Mutation: pick ignoring it fails here.)
  const open = await stubGh(t, ['keel-climb/test-time/2026-10-04']);
  const w = climb(dir, ['pick', '--date', '2026-10-06', '--json'], { KEEL_GH: open });
  assert.equal(w.status, 0, w.stderr);
  assert.equal(json(w).job, null);
  assert.deepEqual(json(w).waiting, ['test-time']);
  // gh unreadable: exit 2, never a guess that nothing is open.
  const down = climb(dir, ['pick', '--json'], { KEEL_GH: await stubGh(t, null) });
  assert.equal(down.status, 2);
  assert.match(json(down).error, /pick never guesses that none are open/);
  // Weekly: Mondays (UTC) only, unless forced (a dispatch).
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ name: 'Acme', climb: { jobs: ['test-time'], schedule: 'weekly' } }));
  assert.match(json(climb(dir, ['pick', '--date', '2026-10-06', '--json'], { KEEL_GH: none })).reason, /not tonight: climb is weekly/);
  assert.equal(json(climb(dir, ['pick', '--date', '2026-10-05', '--json'], { KEEL_GH: none })).job, 'test-time');
  assert.equal(json(climb(dir, ['pick', '--date', '2026-10-06', '--force', '--json'], { KEEL_GH: none })).job, 'test-time');
});

test('rotation: a night that keeps nothing is remembered by its record (the keel-climb artifact), so the next night moves on; .keel/climb.json never has to reach main (ledger#92)', async t => {
  const dir = await acme(t, { climb: { jobs: ['test-time', 'build-time'], build: 'node -e ""', buildOutput: 'dist' } });
  const gh = await stubGh(t, []);
  const pickWith = (args = []) => json(climb(dir, ['pick', '--date', '2026-10-07', ...args, '--json'], { KEEL_GH: gh }));
  assert.equal(pickWith().job, 'test-time', 'no memory: the first job');
  // The state on main says build-time ran on the 5th (its PR merged); the 6th was test-time and kept nothing.
  await write(dir, { '.keel/climb.json': JSON.stringify({ last: { job: 'build-time', date: '2026-10-05', kept: 1 } }) });
  assert.equal(pickWith().job, 'test-time', '.keel/climb.json alone: after build-time');
  const record = join(dir, '..', `${dir.split('/').pop()}-night.json`);
  t.after(() => rm(record, { force: true }));
  await writeFile(record, JSON.stringify({ job: 'test-time', date: '2026-10-06', base: 'x', tried: [] }));
  const p = pickWith(['--last-night', record]);
  assert.equal(p.job, 'build-time', 'the newer record wins: after test-time (mutation: pick ignoring --last-night picks test-time again)');
  assert.deepEqual(p.last, { job: 'test-time', date: '2026-10-06', from: "the last night's record" });
  // An older record than the state, or one that is not a night's: the state.
  await writeFile(record, JSON.stringify({ job: 'test-time', date: '2026-10-01' }));
  assert.equal(pickWith(['--last-night', record]).job, 'test-time');
  await writeFile(record, 'not json');
  assert.equal(pickWith(['--last-night', record]).job, 'test-time');
  assert.equal(pickWith(['--last-night', join(dir, 'no-such.json')]).job, 'test-time');

  // The workflow: the record, fetched read-only from the newest keel-climb artifact, reaches pick.
  const bin = await mkdtemp(join(tmpdir(), 'keel-climb-artifacts-'));
  t.after(() => rm(bin, { recursive: true, force: true }));
  await mkdir(join(bin, 'record'));
  await writeFile(join(bin, 'record/night.json'), JSON.stringify({ job: 'test-time', date: '2026-10-06' }));
  assert.equal(run('zip', ['-q', '-j', join(bin, 'night.zip'), join(bin, 'record/night.json')]).status, 0);
  await writeFile(join(bin, 'gh'), `#!/bin/sh\necho "$@" >> "${bin}/calls"\ncase "$2" in\n  *artifacts\\?name=keel-climb*) echo 7 ;;\n  */artifacts/7/zip) cat "${bin}/night.zip" ;;\n  *) exit 1 ;;\nesac\n`, { mode: 0o755 });
  const temp = join(bin, 'runner');
  await mkdir(temp);
  const env = { PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: temp, REPO: 'acme/anvils', BASE: 'main', KEEL_GH: gh, EVENT: 'schedule' };
  const read = await step(t, dir, "Read the last night's record", env);
  assert.equal(read.status, 0, read.out);
  assert.match(read.out, /the last night's record: artifact 7/);
  assert.match(await readFile(join(bin, 'calls'), 'utf8'), /^api repos\/acme\/anvils\/actions\/artifacts\?name=keel-climb&per_page=100 --jq .*select\(\.workflow_run\.head_branch == "main"\)/m);
  const picked = await step(t, dir, "Pick tonight's job", env);
  assert.equal(picked.status, 0, picked.out);
  assert.equal(picked.outputs.job, 'build-time', 'the workflow passes the record to pick');
  // No record to read: a plain line, green, and pick reads .keel/climb.json alone.
  await writeFile(join(bin, 'gh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await rm(join(temp, 'last-night'), { recursive: true, force: true });
  const none = await step(t, dir, "Read the last night's record", env);
  assert.equal(none.status, 0, none.out);
  assert.match(none.out, /No earlier night's record/);
  await writeFile(join(bin, 'gh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const blind = await step(t, dir, "Read the last night's record", env);
  assert.equal(blind.status, 0, blind.out);
  assert.match(blind.out, /^::notice::The last night's record could not be listed/m);
});

test('config: a bad climb is an error naming each key; the defaults fill the rest', async t => {
  const dir = await acme(t, { climb: { jobs: ['test-time', 'acme-time'], budget: { minutes: 4 }, margin: 0.6, schedule: 'hourly', acme: 1 } });
  const bad = climb(dir, ['config', '--json']);
  assert.equal(bad.status, 2);
  for (const m of [/unknown job "acme-time"/, /budget\.minutes must be a whole number from 5 to 180/, /margin must be a fraction from 0\.01 to 0\.5/, /schedule must be "nightly" or "weekly"/, /unknown key acme/]) assert.match(json(bad).error, m);
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ name: 'Acme', climb: { jobs: ['test-time'] } }));
  assert.deepEqual(json(climb(dir, ['config', '--json'])), { on: true, jobs: ['test-time'], minutes: 45, schedule: 'nightly', margin: 0.05, attempts: 10, testCommand: 'npm test' });
});

test('off: with no climb key the workflow does nothing; with no secret the run ends green with a notice', async t => {
  const off = await acme(t, { climb: null });
  const o = await step(t, off, 'Is climb on?');
  assert.equal(o.status, 0, o.out);
  assert.match(o.out, /climb is off: \.keel\/keel\.json has no "climb", so this run does nothing\./);
  assert.equal(o.outputs.on, 'false');
  assert.deepEqual(json(climb(off, ['config', '--json'])), { on: false });
  const p = climb(off, ['pick', '--json'], { KEEL_GH: await stubGh(t, null) });
  assert.equal(p.status, 0, 'climb off never asks gh');
  assert.match(json(p).reason, /climb is off/);

  const on = await acme(t);
  assert.equal((await step(t, on, 'Is climb on?')).outputs.on, 'true');
  const unset = await step(t, on, 'Configured?', { OAUTH: '', API_KEY: '' });
  assert.equal(unset.status, 0, unset.out);
  assert.match(unset.out, /^::notice::Skipped: add the CLAUDE_CODE_OAUTH_TOKEN \(or ANTHROPIC_API_KEY\) secret/m);
  assert.equal(unset.outputs.enabled, 'false');
  assert.equal((await step(t, on, 'Configured?', { OAUTH: 'acme-token', API_KEY: '' })).outputs.enabled, 'true');

  // Every step after those two waits on them: nothing runs when climb is off or unconfigured.
  // The agent's job is the first; the judge and the publish job wait on its pick (below).
  const text = await readFile(WORKFLOW, 'utf8');
  const agentJob = text.slice(0, text.indexOf('\n  judge:\n'));
  const steps = agentJob.split(/\n(?= {6}- )/).filter(s => /^ {6}- /.test(s));
  const after = steps.slice(steps.findIndex(s => s.includes('name: Configured?')) + 1);
  assert.ok(after.length >= 8);
  for (const s of after) {
    const cond = /(?:^ {6}- |\n {8})if: (.+)/.exec(s)?.[1] ?? '';
    // A step for one job (hygiene's gather, its issue) runs only when that job was picked: a job, so climb is on.
    assert.match(cond, /steps\.configured\.outputs\.enabled == 'true'|steps\.pick\.outputs\.job != ''|steps\.pick\.outputs\.job == '[a-z-]+'/, `step without the guard: ${s.split('\n')[0]}`);
  }
  assert.match(steps.find(s => s.includes('name: Configured?')), /if: steps\.on\.outputs\.on == 'true'/);
  assert.match(text, /\n  judge:\n    needs: agent\n    if: needs\.agent\.outputs\.job != ''\n/, 'no job picked, no judge');
  assert.match(text, /\n  publish:\n    needs: \[agent, judge\]\n    if: always\(\) && needs\.agent\.outputs\.job != ''\n/, 'no job picked, nothing published');
  assert.match(text, /\n    outputs:\n      job: \$\{\{ steps\.pick\.outputs\.job \}\}\n/);
});

test('pick: hygiene goes ahead of every other job when the ledger names a flaky test, never by rotation, and waits like any job', async t => {
  const dir = await acme(t, { climb: { jobs: ['test-time', 'build-time', 'hygiene'], build: 'node -e ""', buildOutput: 'dist' } });
  const m = await load(dir);
  const jobs = ['test-time', 'build-time', 'hygiene'];
  const flakyRow = { id: 'flaky_tests', value: 1, bound: 0, op: '≤', state: 'outside' };
  // Every other measure further outside, one even broken: a flaky test still goes first. (Mutation: pick not preferring hygiene fails here.)
  const worse = [{ id: 'slow_tests', value: null, bound: 0, op: '≤', state: 'broken' }, { id: 'build_time', value: 90000, bound: 1000, op: '≤', state: 'outside' }, flakyRow];
  assert.deepEqual([m.choose({ jobs, rows: worse }).job, m.choose({ jobs, rows: worse }).by], ['hygiene', 'measure']);
  assert.match(m.choose({ jobs, rows: worse }).why, /^flaky_tests is outside/);
  assert.equal(m.choose({ jobs, rows: worse.slice(0, 2) }).job, 'test-time', 'with no flaky test, broken beats outside as before');
  assert.equal(m.choose({ jobs, rows: [worse[1]] }).job, 'build-time', 'build_time outside sends the night to build-time');
  assert.equal(m.choose({ jobs, rows: worse, waiting: new Set(['hygiene']) }).job, 'test-time', 'hygiene with an open PR waits');
  // Rotation never lands on hygiene: with no flaky test there is nothing to fix.
  assert.equal(m.choose({ jobs, rows: [], last: 'build-time' }).job, 'test-time');
  assert.equal(m.choose({ jobs: ['hygiene'], rows: [] }).job, null);
  assert.match(m.choose({ jobs: ['hygiene'], rows: [] }).reason, /hygiene \(only when its measure is outside\)/);

  // The command line, from the health page the night writes.
  await write(dir, { 'docs/health/2026-10-05.md': page([['slow_tests', 9, '≤ 0', 'outside'], ['flaky_tests', 1, '≤ 0', 'outside'], ['build_time', 4000, '≤ 1000', 'outside']]) });
  const p = json(climb(dir, ['pick', '--date', '2026-10-06', '--json'], { KEEL_GH: await stubGh(t, []) }));
  assert.equal(p.job, 'hygiene', JSON.stringify(p));
  assert.equal(p.branch, 'keel-climb/hygiene/2026-10-06');
  assert.equal(p.command, 'the test ledger (.keel/test-runs)');
  // A build_time with no bound (recorded only) is a dash on the page: never a reason to climb.
  assert.deepEqual(m.healthRows(page([['build_time', 4000, '—', 'ok']])), []);
});

test('retirement: a job whose last three PRs were closed unmerged is skipped by pick until one is reopened or merged', async t => {
  const { climbRetiring, retireLine } = await import(pathToFileURL(join(NIGHT, 'lib.mjs')).href);
  const pr = (n, job, merged = false) => ({ headRefName: `keel-climb/${job}/2026-10-0${n}`, number: n, createdAt: `2026-10-0${n}T10:00:00Z`, mergedAt: merged ? `2026-10-0${n}T12:00:00Z` : null });
  const three = [pr(1, 'test-time'), pr(2, 'test-time'), pr(3, 'test-time'), pr(4, 'build-time')];
  assert.deepEqual(climbRetiring(three, ['test-time', 'build-time']), [{ job: 'test-time', prs: [3, 2, 1] }]);
  assert.deepEqual(climbRetiring([pr(1, 'test-time'), pr(2, 'test-time', true), pr(3, 'test-time')], ['test-time']), [], 'one merged among the last three');
  assert.deepEqual(climbRetiring([pr(1, 'test-time', true), pr(2, 'test-time'), pr(3, 'test-time'), pr(4, 'test-time')], ['test-time']).map(r => r.prs), [[4, 3, 2]], 'an older merge does not save it');
  assert.deepEqual(climbRetiring(three.slice(0, 2), ['test-time']), [], 'two is not three');
  assert.match(retireLine({ job: 'test-time', prs: [3, 2, 1] }), /^Climb: `test-time` proposes its own retirement: its last 3 keel-climb\/test-time\/ PRs \(#3, #2, #1\) were closed unmerged\. Remove it from "climb"\.jobs, or reopen one/);

  // pick, against gh's closed list: test-time is skipped, the rotation goes on. (Mutation: ignoring three closed PRs fails here.)
  const dir = await acme(t, { climb: { jobs: ['test-time', 'build-time'], build: 'node -e ""', buildOutput: 'dist' }, files: { 'docs/health/2026-10-05.md': page([['slow_tests', 3, '≤ 0', 'outside']]) } });
  const p = json(climb(dir, ['pick', '--date', '2026-10-06', '--json'], { KEEL_GH: await stubGh(t, [], three) }));
  assert.equal(p.job, 'build-time', JSON.stringify(p));
  assert.deepEqual(p.retiring, [{ job: 'test-time', prs: [3, 2, 1] }]);
  // The owner removes build-time too, or both retire: nothing runs, and pick says why.
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ name: 'Acme', climb: { jobs: ['test-time'] } }));
  const none = json(climb(dir, ['pick', '--date', '2026-10-06', '--json'], { KEEL_GH: await stubGh(t, [], three) }));
  assert.equal(none.job, null);
  assert.match(none.reason, /test-time \(retiring: its last three PRs were closed unmerged\)/);
  // Reopened: the PR is open, so the job waits for the person, and is not retired.
  const reopened = json(climb(dir, ['pick', '--date', '2026-10-06', '--json'], { KEEL_GH: await stubGh(t, ['keel-climb/test-time/2026-10-03'], three.slice(0, 2)) }));
  assert.deepEqual([reopened.job, reopened.waiting, reopened.retiring], [null, ['test-time'], []]);

  // gh's every-state list: the newest three by creation, counting closed-unmerged only.
  const st = (n, state) => ({ ...pr(n, 'test-time', state === 'MERGED'), state });
  assert.deepEqual(climbRetiring([st(1, 'CLOSED'), st(2, 'CLOSED'), st(3, 'MERGED'), st(4, 'CLOSED')], ['test-time']), [], 'closed, merged, closed, closed (newest first): the merge breaks the streak');
  assert.deepEqual(climbRetiring([st(1, 'CLOSED'), st(2, 'CLOSED'), st(3, 'CLOSED'), st(4, 'OPEN')], ['test-time']), [], 'an open one is the newest: not retiring');
  assert.deepEqual(climbRetiring([st(1, 'CLOSED'), st(2, 'CLOSED'), st(3, 'CLOSED')], ['test-time']).map(r => r.prs), [[3, 2, 1]]);
  // pick asks for every state: a newest PR that is open (build-time's only job here) is not three closed in a row.
  // (Mutation: pick reading --state closed sees only the three closed and retires the job.)
  const withOpen = [st(1, 'CLOSED'), st(2, 'CLOSED'), st(3, 'CLOSED'), { ...st(4, 'OPEN'), headRefName: 'keel-climb/test-time/2026-10-04' }];
  const mixed = json(climb(dir, ['pick', '--date', '2026-10-06', '--json'], { KEEL_GH: await stubGh(t, [], withOpen) }));
  assert.deepEqual(mixed.retiring, [], JSON.stringify(mixed));
});

test('agent ran: an agent that errored before its budget ends the run red, saying why from the result alone; a budget timeout is not red', async t => {
  const dir = await acme(t);
  const m = await load(dir);
  // Pure.
  const early = { is_error: true, num_turns: 1, duration_ms: 2000, subtype: 'success', result: 'Invalid API key · Please run /login' };
  const red = m.agentVerdict({ outcome: 'success', result: early, elapsedSec: 5, minutes: 45 });
  assert.equal(red.ok, false);
  assert.match(red.line, /^Claude did not start: is_error after 1 turn in 2 s \(success\), before its 45-minute budget; the secret was refused: check CLAUDE_CODE_OAUTH_TOKEN/);
  assert.match(red.line, /It said: "Invalid API key · Please run \/login"$/);
  assert.match(m.agentVerdict({ outcome: 'failure', result: { ...early, result: 'model: claude-acme-9 not_found_error' }, elapsedSec: 5, minutes: 45 }).line, /the model was refused/);
  assert.match(m.agentVerdict({ outcome: 'failure', result: null, elapsedSec: 3, minutes: 45 }).line, /^Claude did not start: the agent step ended failure after 3 s, before its 45-minute budget, with no result/);
  assert.equal(m.agentVerdict({ outcome: 'failure', result: null, elapsedSec: 45 * 60, minutes: 45 }).ok, true, 'the budget ran out: judged, not red');
  assert.equal(m.agentVerdict({ outcome: 'success', result: { is_error: false, num_turns: 40, duration_ms: 900_000 }, elapsedSec: 900, minutes: 45 }).ok, true);
  assert.equal(m.agentVerdict({ outcome: 'success', result: { is_error: true, num_turns: 80, subtype: 'error_max_turns' }, elapsedSec: 900, minutes: 45 }).ok, true, 'out of turns: judged');
  assert.equal(m.errorText({ result: 'x'.repeat(400) }).length, m.ERROR_CHARS);
  // The workflow's own step, on a synthetic execution file: red, with only the result's text.
  const file = join(dir, '..', `${dir.split('/').pop()}-execution.json`);
  t.after(() => rm(file, { force: true }));
  await writeFile(file, execution(early));
  const now = Math.floor(Date.now() / 1000);
  // The step runs the copy of keel's scripts the workflow kept before the agent ran (PR #59), in $RUNNER_TEMP/keel.
  const kept = await mkdtemp(join(tmpdir(), 'keel-kept-'));
  t.after(() => rm(kept, { recursive: true, force: true }));
  await cp(join(dir, 'scripts/keel'), join(kept, 'keel/scripts/keel'), { recursive: true });
  const s = await step(t, dir, 'Did the agent run?', { OUTCOME: 'success', EXECUTION: file, MINUTES: '45', STARTED: String(now - 5), RUNNER_TEMP: kept });
  assert.equal(s.status, 1, s.out);
  assert.match(s.out, /^::error::Claude did not start: is_error after 1 turn in 2 s/m);
  assert.doesNotMatch(s.out, /acme private session text/, 'never the session\'s messages');
  // The budget ran out: not red.
  const timeout = await step(t, dir, 'Did the agent run?', { OUTCOME: 'failure', EXECUTION: join(dir, 'none.json'), MINUTES: '45', STARTED: String(now - 45 * 60), RUNNER_TEMP: kept });
  assert.equal(timeout.status, 0, timeout.out);
  assert.match(timeout.out, /ran out its budget/);
  // A good run: not red.
  await writeFile(file, execution({ is_error: false, num_turns: 30, duration_ms: 600_000, result: 'done' }));
  const fine = await step(t, dir, 'Did the agent run?', { OUTCOME: 'success', EXECUTION: file, MINUTES: '45', STARTED: String(now - 600), RUNNER_TEMP: kept });
  assert.equal(fine.status, 0, fine.out);
  assert.doesNotMatch(fine.out, /done/, 'the result text is printed only on failure');
});

test('perf: reads the last line\'s number, honours "better" both ways past the margin, and the project\'s own perf check guards it', async t => {
  const perf = better => ({ jobs: ['perf'], margin: 0.1, perf: { command: 'node bench.mjs', better, unit: 'ops/s' } });
  const dir = await acme(t, { climb: perf('higher'), files: { 'bench.mjs': bench(100) } });
  const m = await load(dir);
  const base = git(dir, ['rev-parse', 'HEAD']);
  const at = async (branch, n) => { git(dir, ['checkout', '-q', '-b', branch, base]); return commit(dir, { 'bench.mjs': bench(n) }, `acme: ${branch}`); };
  const up = await at('up', 150), down = await at('down', 50), flat = await at('flat', 105);
  git(dir, ['checkout', '-q', 'main']);
  const verdict = cand => json(climb(dir, ['compare', '--base', base, '--candidate', cand, '--runs', '1', '--json'])).verdict;

  // Higher is better: 150 is kept, 50 and 105 (inside 10%) are not.
  assert.deepEqual([verdict(up), verdict(down), verdict(flat)], ['keep', 'revert', 'revert']);
  const r = json(climb(dir, ['compare', '--base', base, '--candidate', up, '--runs', '1', '--json']));
  assert.deepEqual(r.rounds.map(x => [x.base, x.candidate]), [[100, 150], [100, 150]], 'the printed number, not the wall time');
  assert.match(climb(dir, ['compare', '--base', base, '--candidate', up, '--runs', '1']).stdout, /round 1: base 100 ops\/s {2}candidate 150 ops\/s {2}\+50%/);
  // Flipped: lower is better, so the same two changes swap. (Mutation: a direction ignored, or flipped, fails here.)
  await setConfig(dir, { climb: perf('lower') });
  assert.deepEqual([verdict(up), verdict(down), verdict(flat)], ['revert', 'keep', 'revert']);
  assert.equal(m.betterOf('perf', { climb: perf('higher') }), 'higher');
  assert.equal(m.betterOf('test-time', {}), 'lower');

  // The number: one, on the last line; anything else cannot tell (exit 2), never a guess.
  assert.deepEqual(['1234', '12.5 ms', 'mean: 3e2', '  -4  '].map(m.lastNumber), [1234, 12.5, 300, -4]);
  assert.deepEqual(['', 'fast', 'took 3 of 4', 'p95: 12'].map(m.lastNumber), [null, null, null, null]);
  git(dir, ['checkout', '-q', '-b', 'chatter', base]);
  await commit(dir, { 'bench.mjs': "console.log('100');\nconsole.log('done');\n" }, 'acme: chatter last');
  const blind = climb(dir, ['measure', 'perf', '--runs', '1', '--json']);
  assert.equal(blind.status, 2);
  assert.match(json(blind).error, /printed no single number on its last line.*"done".*perf cannot tell/);
  git(dir, ['checkout', '-q', 'main']);

  // Config: perf names its command and which way is better.
  for (const [climbCfg, re] of [[{ jobs: ['perf'] }, /names perf, so "climb"\.perf must name its command/], [{ jobs: ['perf'], perf: { command: 'node bench.mjs', better: 'faster' } }, /"climb"\.perf\.better must be "lower" or "higher"/], [{ jobs: ['perf'], perf: { command: '', better: 'lower', acme: 1 } }, /perf\.command must be a shell command.*unknown key acme|unknown key acme.*perf\.command/]]) {
    await setConfig(dir, { climb: climbCfg });
    const bad = climb(dir, ['config', '--json']);
    assert.equal(bad.status, 2, JSON.stringify(climbCfg));
    assert.match(json(bad).error, re);
  }

  // A night: the baseline and the decided commit carry the number in its unit; the report says which way is better.
  // The guard compares the gate's test ledger with the base's own (#82: the base's gate runs first), so the gate records one.
  await write(dir, { 'acme.test.mjs': suite('acme adds') });
  await setConfig(dir, { climb: perf('higher'), check: LEDGER_TEST });
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'acme: perf higher']);
  const night0 = json(climb(dir, ['measure', 'perf', '--baseline', '--runs', '1', '--json']));
  assert.deepEqual([night0.median, night0.better, night0.unit], [100, 'higher', 'ops/s']);
  await commit(dir, { 'bench.mjs': bench(150) }, 'acme: a faster loop');
  assert.equal(json(climb(dir, ['compare', '--decide', '--runs', '1', '--json'])).verdict, 'keep');
  assert.match(git(dir, ['log', '-1', '--format=%B']), /\n\nclimb perf: 100 ops\/s → 150 ops\/s \(\+50%\); 100 ops\/s → 150 ops\/s \(\+50%\); margin 10%, base [0-9a-f]{7}$/);
  const rep = json(climb(dir, ['report', '--json']));
  assert.match(rep.line, /^climb perf \d{4}-\d{2}-\d{2}: kept 1 of 1 tried; `node bench\.mjs` 100 ops\/s → 150 ops\/s \(\+50%, higher is better\); \d+ min$/);
  assert.match(climb(dir, ['report']).stdout, /^\| `node bench\.mjs`'s number \(its last line; higher is better\), median \(the baseline against the last kept change\) \| 100 ops\/s \| 150 ops\/s \| \+50% \|$/m);

  // The project's own perf check runs in the guard: failing, the guard fails and names it.
  await setConfig(dir, { climb: { ...perf('higher'), perf: { ...perf('higher').perf, check: 'node -e "process.exit(4)"' } }, check: LEDGER_TEST });
  const g = climb(dir, ['guard', '--json']);
  assert.equal(g.status, 1, g.stdout + g.stderr);
  assert.match(json(g).problems[0], /the project's own perf check `node -e "process\.exit\(4\)"` failed \(exit 4\)/);
});
