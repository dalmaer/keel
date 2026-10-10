import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, win32, posix } from 'node:path';
import { run } from './helpers/run.mjs';
import * as timing from '../lib/time.mjs';
import { timeSummary, keelTime, workedAround, testIdentities } from '../lib/time.mjs';
import { timedCommand, readRuns } from '../practices/night/files/scripts/keel/test-ledger.mjs';
const quiet = { start: { load: [1, 1, 1], cores: 4 }, end: { load: [2, 2, 2], cores: 4 } };
const machine = { os: 'linux', arch: 'x64', cpus: 4 };
const at = (date, extra = {}) => ({ date, dir: '.', machine, config: 'acme', tests: [{ file: 'a.test.mjs', name: 'Acme ships', outcome: 'pass', ms: 10 }], busy: quiet, ...extra });
async function scratch(t) { const p = await mkdtemp(join(tmpdir(), 'keel-time-')); t.after(() => rm(p, { recursive: true, force: true })); return p; }

test('weeks separate full gates, subsets, machines and configs; no duration is fabricated', () => {
  const runs = [at('2026-09-28T12:00:00Z', { wallMs: 9999 }), at('2026-10-05T12:00:00Z'),
    at('2026-10-06T12:00:00Z', { kind: 'gate', runner: 'gate', status: 0, ms: 100, tests: [] }),
    at('2026-10-07T12:00:00Z', { kind: 'gate', runner: 'gate', status: 0, ms: 300, tests: [] }),
    at('2026-10-07T12:00:00Z', { config: 'other', tests: [{ file: 'a.test.mjs', name: 'Acme ships', outcome: 'pass', ms: 1000 }] }),
    at('2026-10-08T12:00:00Z', { machine: { ...machine, cpus: 8 }, busy: undefined })];
  const data = timeSummary(runs, { weeks: 3, now: Date.parse('2026-10-09T00:00:00Z') });
  assert.deepEqual(data.weeks.map(w => w.week), ['2026-09-21', '2026-09-28', '2026-10-05']);
  assert.deepEqual(data.coverage.missingWeeks, ['2026-09-21']);
  assert.equal(data.weeks[1].lanes[0].gateMs, null);
  assert.equal(data.weeks[2].lanes.find(l => l.kind === 'gate').gateMs, 200);
  assert.equal(data.weeks[2].lanes.length, 4);
  assert.equal(data.coverage.unknown, 1);
  assert.match(data.coverage.note, /retention/);
});

test('wrapper provides KEEL_USUAL before runner starts and records the whole command, with its exit status', async t => {
  const root = await scratch(t);
  await writeFile(join(root, 'runner.mjs'), `import {readFileSync} from 'node:fs'; const data = JSON.parse(readFileSync(process.env.KEEL_USUAL)); console.log(JSON.stringify({version:data.version, tests:data.tests})); process.exitCode=7;`);
  const result = await timedCommand('node runner.mjs', { cwd: root });
  assert.equal(result.status, 7);
  assert.equal(JSON.parse(result.stdout).version, 1);
  const { runs } = await readRuns(root, undefined, { gates: true });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].kind, 'gate');
  assert.equal(runs[0].status, 7);
  assert.ok(runs[0].ms >= 0);
  assert.ok(runs[0].busy.start.cores > 0);
  assert.ok(runs[0].busy.end.cores > 0);
  const report = await keelTime({ root, env: { CI: 'true' } });
  assert.equal(report.data.coverage.gateRuns, 1);
  assert.equal(report.data.workedAround.available, false);
});

test('fixture Claude transcript reports timeout/background/interrupt counts, no content, no writes; CI reads nothing', async t => {
  const home = await scratch(t), root = join(home, 'acme');
  const dir = join(home, '.claude', 'projects', resolve(root).replace(/[^a-zA-Z0-9]/g, '-'));
  await mkdir(dir, { recursive: true });
  const timestamp = '2026-10-09T00:00:00Z';
  const row = content => JSON.stringify({ timestamp, cwd: root, message: { content } });
  const raw = [row([{ type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'npm test # private text', timeout: 120000 } }]),
    row([{ type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'node --test a.test.mjs', run_in_background: true } }]),
    row([{ type: 'tool_result', tool_use_id: 'a', is_error: true, content: 'interrupted by user' }]),
    row([{ type: 'tool_use', id: 'c', name: 'Bash', input: { command: 'echo private', timeout: 500000 } }]), '{bad'].join('\n');
  await writeFile(join(dir, 'acme.jsonl'), raw);
  const before = await readdir(dir);
  const got = await workedAround({ root, home, env: {} });
  assert.deepEqual(got.counts, { longTimeout: 1, background: 1, interrupted: 1, workedAround: 2 });
  assert.equal(got.skipped, 1);
  assert.equal(got.coverage.state, 'partial');
  assert.equal(got.coverage.observedRecords, 4);
  assert.deepEqual(got.identities.map(i => [i.kind, i.id, i.counts.workedAround]), [['script', 'test', 1], ['file', 'a.test.mjs', 1]]);
  assert.doesNotMatch(JSON.stringify(got), /private|npm test/);
  assert.deepEqual(await readdir(dir), before);
  assert.equal(await readFile(join(dir, 'acme.jsonl'), 'utf8'), raw);
  const ci = await workedAround({ root, home, env: { CI: 'true' } });
  assert.equal(ci.reason, 'disabled in CI');
  assert.equal(ci.counts, null);
  assert.equal((await workedAround({ root: join(home, 'other'), home, env: {} })).available, false);
});

test('public time command returns JSON and validates its week window', async t => {
  const root = await scratch(t);
  await mkdir(join(root, '.keel'));
  await writeFile(join(root, '.keel', 'keel.json'), JSON.stringify({ name: 'Acme', practices: [] }));
  const cli = resolve('bin/keel.mjs');
  const r = run(process.execPath, [cli, 'time', '--weeks', '2', '--json'], { cwd: root, env: { ...process.env, CI: 'true' } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).weeks.length, 2);
  const bad = run(process.execPath, [cli, 'time', '--weeks', '0', '--json'], { cwd: root });
  assert.equal(bad.status, 2);
  assert.match(JSON.parse(bad.stdout).error, /weeks/);
});


test('worked-around identities retain only safe test paths or known test/check scripts', () => {
  assert.deepEqual(testIdentities('node --test tests/acme.test.mjs --token=fake-private'), [{ kind: 'file', id: 'tests/acme.test.mjs' }]);
  assert.deepEqual(testIdentities('npm test && echo private.test.mjs'), [{ kind: 'script', id: 'test' }]);
  assert.deepEqual(testIdentities('npm run test:unit --secret fake-private', new Set(['test:unit'])), [{ kind: 'script', id: 'test:unit' }]);
  for (const command of ['node --test /private/acme.test.mjs', 'node --test ../other/acme.test.mjs', 'node --test --name=fake-private', 'npm run test:unknown', 'node --test tests/../../acme.test.mjs', 'cd /private && node --test private.test.mjs', 'node --test --secret private.test.mjs', 'echo private.test.mjs && npm test']) {
    assert.deepEqual(testIdentities(command), [{ kind: 'unknown', id: null }]);
  }
});

test('nested gate wrappers record only the outer boundary', async t => {
  const root = await scratch(t);
  const ledger = new URL('../practices/night/files/scripts/keel/test-ledger.mjs', import.meta.url).href;
  await writeFile(join(root, 'inner.mjs'), `import {timedCommand} from ${JSON.stringify(ledger)}; const result = await timedCommand('node -e "console.log(123)"'); process.stdout.write(result.stdout); process.exitCode=result.status;`);
  const result = await timedCommand('node inner.mjs', { cwd: root });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '123');
  assert.equal((await readRuns(root, undefined, { gates: true })).runs.length, 1);
  assert.equal((await readRuns(root)).runs.length, 0, 'gate records never displace a test baseline');
});

test('wrapped JUnit records local start/end context; omitted start ignores the outer gate sample', async t => {
  const root = await scratch(t);
  const ledger = new URL('../practices/night/files/scripts/keel/test-ledger.mjs', import.meta.url).href;
  await writeFile(join(root, 'test-ledger.mjs'), await readFile(new URL(ledger), 'utf8'));
  await writeFile(join(root, 'runner.mjs'), `import {writeFileSync} from 'node:fs'; writeFileSync('acme.xml', '<testsuites name="vitest tests"><testsuite name="acme.test.mjs"><testcase name="Acme ships" time="0.01"/></testsuite></testsuites>');`);
  await writeFile(join(root, 'producer.sh'), `keel_status=0
rm -f acme.xml
keel_start="$(node test-ledger.mjs --sample)" || keel_start=
node runner.mjs || keel_status=$?
printf '%s' "$keel_start" > acme-start.json
node test-ledger.mjs --junit acme.xml --runner vitest --status "$keel_status" --start "$keel_start"
`);
  const result = await timedCommand('sh producer.sh', { cwd: root });
  assert.equal(result.status, 0, result.stderr);
  const { runs } = await readRuns(root);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].runner, 'vitest');
  assert.ok(runs[0].busy.start.at);
  assert.deepEqual(runs[0].busy.start, JSON.parse(await readFile(join(root, 'acme-start.json'), 'utf8')), 'JUnit uses the producer sample, not the outer gate start');
  assert.ok(runs[0].busy.end.at);
  assert.equal(runs[0].busy.unavailable, null);
  await writeFile(join(root, 'acme.xml'), '<testsuites name="vitest tests"><testsuite name="acme.test.mjs"><testcase name="Acme ships" time="0.02"/></testsuite></testsuites>');
  const omitted = await timedCommand('node test-ledger.mjs --junit acme.xml --runner vitest', { cwd: root });
  assert.equal(omitted.status, 0, omitted.stderr);
  const last = (await readRuns(root)).runs.at(-1);
  assert.equal(last.busy.start, null);
  assert.match(last.busy.unavailable, /start was not captured/);
});


test('all unavailable transcript inputs have null counts; observed zero and partial coverage differ', async t => {
  const home = await scratch(t), root = join(home, 'acme');
  const dir = join(home, '.claude', 'projects', resolve(root).replace(/[^a-zA-Z0-9]/g, '-'));
  await mkdir(dir, { recursive: true });
  for (const input of ['{broken', '{}', 'null', ' '.repeat(4097)]) {
    await writeFile(join(dir, 'acme.jsonl'), input);
    const got = await workedAround({ root, home, env: {}, limits: { maxRowBytes: 4096 } });
    assert.equal(got.available, false);
    assert.equal(got.counts, null);
    assert.equal(got.identities, null);
    assert.equal(got.coverage.state, 'unavailable');
  }
  await rm(join(dir, 'acme.jsonl'));
  await mkdir(join(dir, 'unreadable.jsonl')); // reading a directory fails, also under root
  assert.equal((await workedAround({ root, home, env: {} })).counts, null);
  const valid = JSON.stringify({ timestamp: '2026-10-09T00:00:00Z', message: { content: [] } });
  await writeFile(join(dir, 'acme.jsonl'), valid);
  const partial = await workedAround({ root, home, env: {} });
  assert.equal(partial.coverage.state, 'partial');
  assert.equal(partial.counts.workedAround, 0);
  await rm(join(dir, 'unreadable.jsonl'), { recursive: true });
  const complete = await workedAround({ root, home, env: {} });
  assert.equal(complete.coverage.state, 'observed');
  assert.equal(complete.counts.workedAround, 0);
  assert.equal((await workedAround({ root, home, env: {}, since: Date.parse('2026-10-10') })).counts, null);
});

test('nested projects keep their gates out of the enclosing Git ledger; historical non-root gates remain explicit exclusions', async t => {
  const root = await scratch(t), child = join(root, 'fixtures', 'acme');
  const init = run('git', ['init', '-q', root]); assert.equal(init.status, 0);
  await mkdir(child, { recursive: true });
  const result = await timedCommand('node -e ""', { cwd: child });
  assert.equal(result.status, 0);
  assert.equal((await readRuns(root, undefined, { gates: true })).runs.length, 0);
  const records = (await readRuns(child, undefined, { gates: true })).runs;
  assert.equal(records.length, 1);
  assert.equal(records[0].dir, '.');
  assert.equal(records[0].gateSource, 'explicit-command');
  const old = at('2026-10-09T00:00:00Z', { kind: 'gate', dir: 'fixtures/acme', tests: [], ms: 100 });
  const summary = timeSummary([old], { now: Date.parse('2026-10-10') });
  assert.equal(summary.coverage.gateRuns, 0);
  assert.equal(summary.coverage.excludedGates[0].dir, 'fixtures/acme');
  assert.ok(summary.weeks.every(w => w.lanes.every(l => l.kind !== 'gate')));
  assert.equal(old.ms, 100, 'historical observation is not mutated');
});


test('transcripts exclude quoted test mentions and unverified cwd changes instead of counting unknown tests', async t => {
  const home = await scratch(t), root = join(home, 'acme');
  const dir = join(home, '.claude', 'projects', resolve(root).replace(/[^a-zA-Z0-9]/g, '-'));
  await mkdir(dir, { recursive: true });
  const row = (id, command, cwd = root) => JSON.stringify({ timestamp: '2026-10-09T00:00:00Z', cwd, message: { content: [{ type: 'tool_use', name: 'Bash', id, input: { command, timeout: 120000 } }] } });
  await writeFile(join(dir, 'acme.jsonl'), [row('a', 'echo "npm test"'), row('b', 'cd /other/acme && npm test')].join('\n'));
  const rejected = await workedAround({ root, home, env: {} });
  assert.equal(rejected.counts.longTimeout, 0);
  assert.equal(rejected.counts.workedAround, 0);
  assert.deepEqual(rejected.identities, []);
  assert.equal(rejected.coverage.state, 'partial');
  assert.equal(rejected.coverage.commandOmissions, 1);
  await writeFile(join(dir, 'acme.jsonl'), [row('c', 'node --test'), row('d', 'npm test', join(home, 'other')), row('e', 'node -e "console.log(123)"'), row('f', 'npm run check')].join('\n'));
  const actual = await workedAround({ root, home, env: {} });
  assert.equal(actual.counts.workedAround, 2);
  assert.deepEqual(actual.identities.map(i => [i.kind, i.id]), [['unknown', null], ['script', 'check']]);
  assert.equal(actual.coverage.state, 'partial');
  await writeFile(join(dir, 'acme.jsonl'), JSON.stringify({ timestamp: '2026-10-09T00:00:00Z', message: { content: [{ type: 'tool_use', name: 'Bash', id: 'no-cwd', input: { command: 'npm test', timeout: 120000 } }] } }));
  const unknownCwd = await workedAround({ root, home, env: {} });
  assert.equal(unknownCwd.counts.workedAround, 0);
  assert.equal(unknownCwd.coverage.commandOmissions, 1);
});


test('transcripts respect runner boundaries and reject outside targets or project-changing options before assigning unknown identity', async t => {
  const home = await scratch(t), root = join(home, 'acme');
  const dir = join(home, '.claude', 'projects', resolve(root).replace(/[^a-zA-Z0-9]/g, '-'));
  await mkdir(dir, { recursive: true });
  const row = (command, id) => JSON.stringify({ timestamp: '2026-10-09T00:00:00Z', cwd: root, message: { content: [{ type: 'tool_use', name: 'Bash', id, input: { command, timeout: 120000 } }] } });
  const rejected = ['node helper.mjs --test', 'node --test /other/acme.test.mjs', 'node --test ../other/acme.test.mjs', 'node --test tests/acme.test.mjs /other/acme.test.mjs', 'node --test tests/',
    ...['--prefix', '--cwd', '--dir', '-C'].flatMap(flag => [`npm test ${flag} /other/acme`, `npm test ${flag}=/other/acme`]),
    'npm test -C/other/acme', 'npm test --workspace other', 'vitest --root /other/acme'];
  await writeFile(join(dir, 'acme.jsonl'), rejected.map(row).join('\n'));
  const excluded = await workedAround({ root, home, env: {} });
  assert.equal(excluded.counts.longTimeout, 0);
  assert.equal(excluded.counts.workedAround, 0);
  assert.deepEqual(excluded.identities, []);
  assert.equal(excluded.coverage.commandOmissions, rejected.length);
  await writeFile(join(dir, 'acme.jsonl'), ['node --test', 'node --test tests/acme.test.mjs', 'node --test --test-name-pattern Acme custom.mjs'].map(row).join('\n'));
  const accepted = await workedAround({ root, home, env: {} });
  assert.equal(accepted.counts.workedAround, 3);
  assert.deepEqual(accepted.identities.map(i => [i.kind, i.id]), [['unknown', null], ['file', 'tests/acme.test.mjs'], ['file', 'custom.mjs']]);
  assert.equal(accepted.coverage.commandOmissions, 0);
});


test('streamed transcripts skip oversized rows, bound total bytes and rows, and preserve only observed summaries', async t => {
  const home = await scratch(t), root = join(home, 'acme');
  const dir = join(home, '.claude', 'projects', resolve(root).replace(/[^a-zA-Z0-9]/g, '-'));
  await mkdir(dir, { recursive: true });
  const row = id => JSON.stringify({ timestamp: '2026-10-09T00:00:00Z', cwd: root, message: { content: [{ type: 'tool_use', name: 'Bash', id, input: { command: 'npm test', timeout: 120000 } }] } });
  const first = row('a'), second = row('b');
  await writeFile(join(dir, 'acme.jsonl'), first + '\n' + 'x'.repeat(130000) + '\n' + second);
  const complete = await workedAround({ root, home, env: {}, limits: { maxRowBytes: 2048 } });
  assert.equal(complete.counts.workedAround, 2);
  assert.equal(complete.coverage.oversizedRows, 1);
  assert.equal(complete.coverage.truncated, false);
  assert.equal(complete.coverage.state, 'partial');
  assert.equal(complete.coverage.rowsRead, 3);
  assert.equal(complete.coverage.bytesRead, Buffer.byteLength(first + '\n' + 'x'.repeat(130000) + '\n' + second));
  const byteCut = await workedAround({ root, home, env: {}, limits: { maxBytes: Buffer.byteLength(first) + 20, maxRowBytes: 2048 } });
  assert.equal(byteCut.counts.workedAround, 1);
  assert.equal(byteCut.coverage.bytesRead, Buffer.byteLength(first) + 20);
  assert.equal(byteCut.coverage.truncatedRows, 1);
  assert.equal(byteCut.coverage.truncated, true);
  assert.equal(byteCut.coverage.state, 'partial');
  await writeFile(join(dir, 'acme.jsonl'), first + '\n' + second + '\n');
  await writeFile(join(dir, 'later.jsonl'), row('c'));
  const rowCut = await workedAround({ root, home, env: {}, limits: { maxRows: 1 } });
  assert.equal(rowCut.counts.workedAround, 1);
  assert.equal(rowCut.coverage.rowsRead, 1);
  assert.equal(rowCut.coverage.omittedFiles, 1);
  assert.equal(rowCut.coverage.truncated, true);
  const noObservation = await workedAround({ root, home, env: {}, limits: { maxBytes: 10 } });
  assert.equal(noObservation.counts, null);
  assert.equal(noObservation.coverage.truncated, true);
  // CI returns before reading files or even validating injected limits.
  assert.equal((await workedAround({ root, home, env: { CI: 'true' }, limits: { maxBytes: 0 } })).reason, 'disabled in CI');
  assert.doesNotMatch(JSON.stringify(complete), /xxxx|npm test/);
});


test('CLI reports absent gate timing as unavailable and excludes negative durations from medians', async t => {
  const root = await scratch(t), date = new Date().toISOString();
  await mkdir(join(root, '.keel', 'test-runs'), { recursive: true });
  await writeFile(join(root, '.keel', 'keel.json'), JSON.stringify({ name: 'Acme', practices: [] }));
  const gate = { kind: 'gate', status: 0, dir: '.', tests: [], date, machine, config: 'acme' };
  await writeFile(join(root, '.keel', 'test-runs', 'missing.json'), JSON.stringify(gate));
  await writeFile(join(root, '.keel', 'test-runs', 'negative.json'), JSON.stringify({ ...gate, ms: -100 }));
  const cli = resolve('bin/keel.mjs');
  const shown = run(process.execPath, [cli, 'time', '--weeks', '1'], { cwd: root, env: { ...process.env, CI: 'true' } });
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, /gate unavailable/);
  assert.doesNotMatch(shown.stdout, /gate (?:0|-100) ms/);
  assert.equal((await keelTime({ root, weeks: 1, env: { CI: 'true' } })).data.weeks[0].lanes[0].gateMs, null);
  await writeFile(join(root, '.keel', 'test-runs', 'valid.json'), JSON.stringify({ ...gate, ms: 100 }));
  assert.equal((await keelTime({ root, weeks: 1, env: { CI: 'true' } })).data.weeks[0].lanes[0].gateMs, 100);
});


test('transcripts count only the leading validated invocation before quote-aware output and list boundaries', async t => {
  const home = await scratch(t), root = join(home, 'acme');
  const dir = join(home, '.claude', 'projects', resolve(root).replace(/[^a-zA-Z0-9]/g, '-'));
  await mkdir(dir, { recursive: true });
  const row = (command, id) => JSON.stringify({ timestamp: '2026-10-09T00:00:00Z', cwd: root, message: { content: [{ type: 'tool_use', name: 'Bash', id, input: { command, timeout: 120000 } }] } });
  const accepted = ['npm test 2>&1 | tail -n 20', 'node --test tests/acme.test.mjs > /tmp/acme.log',
    'node --test --test-name-pattern "Acme | rockets > crates" tests/acme.test.mjs >> "/tmp/acme log" 2>&1',
    'npm test && npm run check', 'npm run check; node --test private.test.mjs'];
  const rejected = ['echo "npm test 2>&1 | tail"', 'cd /other/acme && npm test', 'env ACME=1 npm test | tail',
    'npm test --prefix /other/acme | tail', 'node --test /other/acme.test.mjs > /tmp/acme.log',
    'node helper.mjs --test | tail', 'npm test > /tmp/acme.log --prefix /other/acme',
    'node --test > /tmp/acme.log /other/acme.test.mjs', 'npm test "unterminated > /tmp/acme.log'];
  await writeFile(join(dir, 'acme.jsonl'), [...accepted, ...rejected].map(row).join('\n'));
  const result = await workedAround({ root, home, env: {} });
  assert.equal(result.counts.workedAround, accepted.length);
  assert.equal(result.coverage.recognizedTestInvocations, accepted.length);
  assert.equal(result.coverage.ignoredTails, accepted.length);
  assert.equal(result.coverage.state, 'partial');
  assert.deepEqual(result.identities.map(i => [i.kind, i.id, i.counts.workedAround]), [['script', 'test', 2], ['file', 'tests/acme.test.mjs', 2], ['script', 'check', 1]]);
  assert.doesNotMatch(JSON.stringify(result), /private.test|acme.log|tail -n|rockets/);
});


test('transcript interruption uses structured status or an explicit tool error, never test stdout', async t => {
  const home = await scratch(t), root = join(home, 'acme');
  const dir = join(home, '.claude', 'projects', resolve(root).replace(/[^a-zA-Z0-9]/g, '-'));
  await mkdir(dir, { recursive: true });
  const row = (content, extra = {}) => JSON.stringify({ timestamp: '2026-10-09T00:00:00Z', cwd: root, message: { content }, ...extra });
  const use = id => row([{ type: 'tool_use', id, name: 'Bash', input: { command: 'npm test', timeout: 1000 } }]);
  const output = '✔ interrupted requests are cancelled safely\nℹ tests 1\nℹ pass 1\nℹ cancelled 0';
  const lines = [
    use('completed'), row([{ type: 'tool_result', tool_use_id: 'completed', content: output }]),
    use('actual'), row([{ type: 'tool_result', tool_use_id: 'actual', content: 'stopped' }], { toolUseResult: { interrupted: true } }),
    use('false-status'), row([{ type: 'tool_result', tool_use_id: 'false-status', is_error: true, content: 'interrupted by user' }], { toolUseResult: { interrupted: false } }),
    use('explicit-error'), row([{ type: 'tool_result', tool_use_id: 'explicit-error', is_error: true, content: '[Request interrupted by user for tool use]' }]),
    use('failing-test'), row([{ type: 'tool_result', tool_use_id: 'failing-test', is_error: true, content: output }]),
    use('plain-stdout'), row([{ type: 'tool_result', tool_use_id: 'plain-stdout', content: 'interrupted by user' }]),
  ];
  await writeFile(join(dir, 'acme.jsonl'), lines.join('\n'));
  const got = await workedAround({ root, home, env: {} });
  assert.equal(got.coverage.recognizedTestInvocations, 6);
  assert.deepEqual(got.counts, { longTimeout: 0, background: 0, interrupted: 2, workedAround: 2 });
  assert.equal(got.identities[0].counts.interrupted, 2);
  assert.doesNotMatch(JSON.stringify(got), /cancelled safely|stopped|ℹ/);
});

test('transcripts exclude Vitest discovery commands with flags before or after the verb', async t => {
  const home = await scratch(t), root = join(home, 'acme');
  const dir = join(home, '.claude', 'projects', resolve(root).replace(/[^a-zA-Z0-9]/g, '-'));
  await mkdir(dir, { recursive: true });
  const row = (command, id) => JSON.stringify({ timestamp: '2026-10-09T00:00:00Z', cwd: root, message: { content: [{ type: 'tool_use', name: 'Bash', id, input: { command, timeout: 120000 } }] } });
  const rejected = ['vitest list', 'npx vitest list', 'vitest --silent list', 'npx vitest --reporter=json list', 'vitest --reporter json list --silent', 'vitest list --reporter json'];
  await writeFile(join(dir, 'acme.jsonl'), rejected.map(row).join('\n'));
  const excluded = await workedAround({ root, home, env: {} });
  assert.equal(excluded.counts.workedAround, 0);
  assert.deepEqual(excluded.identities, []);
  await writeFile(join(dir, 'acme.jsonl'), ['vitest run tests/acme.test.ts', 'npx vitest --silent run tests/acme.test.ts', 'vitest --testNamePattern list run tests/acme.test.ts'].map(row).join('\n'));
  const accepted = await workedAround({ root, home, env: {} });
  assert.equal(accepted.counts.workedAround, 3);
});

test('review: Vitest outside targets are omissions and local targets retain identities after flags', async t => {
  const home = await scratch(t), root = join(home, 'acme');
  const dir = join(home, '.claude', 'projects', resolve(root).replace(/[^a-zA-Z0-9]/g, '-'));
  await mkdir(dir, { recursive: true });
  const outside = ['vitest /other/acme.test.mjs', 'npx vitest ../other/acme.test.mjs',
    'vitest run tests/acme.test.ts tests/../../other/acme.test.ts'];
  const local = ['vitest --silent tests/acme.test.ts', 'npx vitest --reporter json run ./tests/acme.test.ts',
    'vitest --testNamePattern ../Acme --run tests/acme.test.ts'];
  await writeFile(join(dir, 'acme.jsonl'), [...outside, ...local].map((command, id) => JSON.stringify({ timestamp: '2026-10-09T00:00:00Z', cwd: root,
    message: { content: [{ type: 'tool_use', name: 'Bash', id, input: { command, timeout: 120000 } }] } })).join('\n'));
  const got = await workedAround({ root, home, env: {}, now: Date.parse('2026-10-10') });
  assert.equal(got.coverage.commandOmissions, outside.length);
  assert.equal(got.coverage.state, 'partial');
  assert.equal(got.counts.workedAround, local.length);
  assert.deepEqual(got.identities.map(i => [i.kind, i.id, i.counts.workedAround]), [['file', 'tests/acme.test.ts', local.length]]);
});

test('review: time CLI rejects typo positional and missing week arguments', async t => {
  const root = await scratch(t);
  await mkdir(join(root, '.keel'));
  await writeFile(join(root, '.keel', 'keel.json'), JSON.stringify({ name: 'Acme', practices: [] }));
  for (const args of [['--week', '2'], ['2'], ['--weeks'], ['--weeks', '--json'], ['--weeks', '0'], ['--weeks', '53'], ['--weeks', '1.5']]) {
    const got = run(process.execPath, [resolve('bin/keel.mjs'), 'time', ...args, '--json'], { cwd: root, env: { ...process.env, CI: 'true' } });
    assert.equal(got.status, 2, JSON.stringify(args));
    assert.match(JSON.parse(got.stdout).error, /unexpected argument|weeks/);
  }
});

test('review: transcript window includes both boundaries and excludes future uses and results', async t => {
  const home = await scratch(t), root = join(home, 'acme');
  const dir = join(home, '.claude', 'projects', resolve(root).replace(/[^a-zA-Z0-9]/g, '-'));
  await mkdir(dir, { recursive: true });
  const now = Date.parse('2026-10-09T12:00:00Z');
  const use = (timestamp, id) => ({ timestamp, cwd: root, message: { content: [{ type: 'tool_use', name: 'Bash', id, input: { command: 'npm test', timeout: 120000 } }] } });
  const rows = [use('2026-10-04T23:59:59.999Z', 'old'), use('2026-10-05T00:00:00Z', 'start'),
    use('2026-10-09T12:00:00Z', 'end'), use('2026-10-09T12:00:00.001Z', 'future'),
    { timestamp: '2026-10-09T12:00:00.001Z', cwd: root, toolUseResult: { interrupted: true }, message: { content: [{ type: 'tool_result', tool_use_id: 'end', content: 'Acme private output' }] } }];
  await writeFile(join(dir, 'acme.jsonl'), rows.map(r => JSON.stringify(r)).join('\n'));
  const { data, text } = await keelTime({ root, home, env: {}, weeks: 1, now });
  assert.equal(data.workedAround.counts.workedAround, 2);
  assert.equal(data.workedAround.counts.interrupted, 0);
  assert.equal(data.workedAround.coverage.outOfWindow, 3);
  assert.equal(data.workedAround.coverage.observedRecords, 2);
  assert.match(text, /3 records out of window/);
  assert.doesNotMatch(JSON.stringify({ data, text }), /Acme private output/);
  await writeFile(join(dir, 'acme.jsonl'), JSON.stringify(rows[3]));
  const futureOnly = await keelTime({ root, home, env: {}, weeks: 1, now });
  assert.equal(futureOnly.data.workedAround.counts, null);
  assert.equal(futureOnly.data.workedAround.coverage.outOfWindow, 1);
});

test('review: human timing shows bounded named medians usual times failures and diagnosis with lane and window', async t => {
  const root = await scratch(t), dir = join(root, '.keel', 'test-runs');
  await mkdir(dir, { recursive: true });
  const tests = Array.from({ length: 12 }, (_, i) => ({ file: `tests/acme-${i}.test.mjs`, name: `Acme case ${i}`, outcome: 'pass', ms: 10 + i }));
  const first = at('2026-10-08T00:00:00Z', { tests, dirty: false, tree: 'acme-tree', runner: 'vitest' });
  const second = at('2026-10-09T00:00:00Z', { tests: [{ ...tests[11], outcome: 'fail', error: 'Acme expected shipment, received delay\nAcme detail' }], dirty: false, tree: 'acme-tree', runner: 'vitest' });
  await writeFile(join(dir, 'first.json'), JSON.stringify(first));
  await writeFile(join(dir, 'second.json'), JSON.stringify(second));
  const { text, data } = await keelTime({ root, env: { CI: 'true' }, weeks: 1, now: Date.parse('2026-10-09T12:00:00Z') });
  assert.match(text, /2026-10-05 through 2026-10-09T12:00:00.000Z/);
  assert.match(text, /runner=vitest dir=\. config=acme machine=linux-x64-4cpu/);
  assert.match(text, /tests\/acme-11.test.mjs — Acme case 11: median 21 ms/);
  assert.match(text, /Acme case 11: usual 21 ms/);
  assert.match(text, /Acme expected shipment, received delay/);
  assert.match(text, /different outcomes on an identical clean tree/);
  assert.equal((text.match(/2 entries omitted/g) ?? []).length, 2);
  assert.equal(data.usual.length, 12);
  assert.doesNotMatch(text, /Acme case 0:/);
  assert.match(text, /gate unavailable/);
  assert.match(text, /disabled in CI/);
  second.tests = Array.from({ length: 12 }, (_, i) => ({ ...tests[i], outcome: 'fail', error: i === 11 ? null : 'Acme '.repeat(100) }));
  await writeFile(join(dir, 'second.json'), JSON.stringify(second));
  const bounded = await keelTime({ root, env: { CI: 'true' }, weeks: 1, now: Date.parse('2026-10-09T12:00:00Z') });
  assert.match(bounded.text, /Acme case 11: unavailable/);
  assert.match(bounded.text, /characters omitted/);
  assert.equal((bounded.text.match(/2 entries omitted/g) ?? []).length, 4);
});

test('round3: Vitest related and bench runs disclose omissions without naming sources as tests', async t => {
  const home = await scratch(t), root = join(home, 'acme');
  const dir = join(home, '.claude', 'projects', resolve(root).replace(/[^a-zA-Z0-9]/g, '-'));
  await mkdir(dir, { recursive: true });
  const commands = ['vitest related --run src/acme.ts', 'npx vitest --silent related --run src/acme.ts',
    'vitest --reporter json related src/acme.ts', 'vitest bench --run',
    'npx vitest --silent bench tests/acme.bench.ts', 'vitest --reporter json bench --run'];
  await writeFile(join(dir, 'acme.jsonl'), commands.map((command, id) => JSON.stringify({ timestamp: '2026-10-09T00:00:00Z', cwd: root,
    message: { content: [{ type: 'tool_use', name: 'Bash', id, input: { command, timeout: 120000, run_in_background: true } }] } })).join('\n'));
  const got = await workedAround({ root, home, env: {}, now: Date.parse('2026-10-10') });
  assert.equal(got.coverage.commandOmissions, commands.length);
  assert.equal(got.coverage.state, 'partial');
  assert.equal(got.coverage.recognizedTestInvocations, 0);
  assert.deepEqual(got.identities, []);
  assert.doesNotMatch(JSON.stringify(got), /src\/acme/);
});

test('round3: usual times include older retained passes outside the weekly window and exclude future history', async t => {
  const root = await scratch(t), dir = join(root, '.keel', 'test-runs');
  await mkdir(dir, { recursive: true });
  const sample = (date, ms, name = 'Acme ships', extra = {}) => at(date, { tests: [{ file: 'acme.test.mjs', name, outcome: 'pass', ms }], ...extra });
  const runs = [sample('2026-09-01T00:00:00Z', 20), sample('2026-09-10T00:00:00Z', 40),
    sample('2026-10-08T00:00:00Z', 900), sample('2026-09-10T00:00:00Z', 55, 'Acme older only'),
    sample('2026-10-10T00:00:00Z', 9999), sample('2026-09-10T00:00:00Z', 9999, 'Acme ships', { kind: 'gate', status: 0 })];
  for (const [i, r] of runs.entries()) await writeFile(join(dir, `${i}.json`), JSON.stringify(r));
  const { data, text } = await keelTime({ root, weeks: 1, now: Date.parse('2026-10-09'), env: { CI: 'true' } });
  const usual = data.usual.find(t => t.name === 'Acme ships');
  assert.equal(usual.median, 40);
  assert.equal(usual.passes, 3);
  assert.equal(data.usual.find(t => t.name === 'Acme older only').median, 55);
  assert.equal(data.weeks[0].lanes[0].tests[0].median, 900);
  assert.equal(data.coverage.runs, 1);
  assert.match(text, /last ten retained passes through report time/);
  // Reverse input order and exceed ten passes: the oldest retained pass must drop.
  const many = Array.from({ length: 11 }, (_, i) => sample(`2026-09-${String(i + 1).padStart(2, '0')}T00:00:00Z`, i === 0 ? 9999 : i * 10));
  const lastTen = timeSummary(many.reverse(), { weeks: 1, now: Date.parse('2026-10-09') }).usual[0];
  assert.equal(lastTen.passes, 10);
  assert.equal(lastTen.median, 55);
});

test('round3: gate median excludes fast failures and reports outcome counts with unavailable all-failed lanes', async t => {
  const root = await scratch(t), dir = join(root, '.keel', 'test-runs');
  await mkdir(dir, { recursive: true });
  const gate = (status, ms, config = 'acme') => at('2026-10-08T00:00:00Z', { kind: 'gate', runner: 'gate', tests: [], status, ms, config });
  const runs = [gate(0, 1000), gate(0, 3000), gate(1, 1), gate(1, 2), gate(1, 3),
    gate(1, 4, 'acme-failed'), gate(undefined, 5, 'acme-unknown'), gate(0, null, 'acme-untimed')];
  for (const [i, r] of runs.entries()) await writeFile(join(dir, `${i}.json`), JSON.stringify(r));
  const { data, text } = await keelTime({ root, weeks: 1, now: Date.parse('2026-10-09'), env: { CI: 'true' } });
  const lanes = data.weeks[0].lanes, mixed = lanes.find(l => l.lane === '.\0acme\0gate');
  assert.equal(mixed.gateMs, 2000);
  assert.equal(mixed.successful, 2);
  assert.equal(mixed.unsuccessful, 3);
  assert.equal(mixed.runs, 5);
  for (const l of lanes.filter(l => l !== mixed)) assert.equal(l.gateMs, null);
  assert.match(text, /gate 2000 ms \(2 successful, 3 unsuccessful\)/);
  assert.match(text, /config=acme-failed[^\n]+gate unavailable \(0 successful, 1 unsuccessful\)/);
  assert.match(text, /config=acme-untimed[^\n]+gate unavailable \(1 successful, 0 unsuccessful\)/);
});

test('round4: transcript cwd normalizes win32 subfolders while rejecting escapes and other drives', () => {
  const root = 'C:\\Acme\\project';
  assert.equal(typeof timing.transcriptDir, 'function');
  assert.equal(timing.transcriptDir(root, 'C:\\Acme\\project\\packages\\web', win32), 'packages/web');
  assert.equal(timing.transcriptDir(root, 'C:/Acme/project/packages/web', win32), 'packages/web');
  assert.equal(timing.transcriptDir(root, root, win32), '');
  assert.equal(timing.transcriptDir(root, 'C:\\Acme\\other', win32), null);
  assert.equal(timing.transcriptDir(root, 'C:\\Acme\\project\\..\\other', win32), null);
  assert.equal(timing.transcriptDir(root, 'D:\\Acme\\project\\packages\\web', win32), null);
  assert.equal(timing.transcriptDir('\\\\acme-host\\share\\project', '\\\\acme-host\\share\\project\\packages\\web', win32), 'packages/web');
  assert.equal(timing.transcriptDir('/Acme/project', '/Acme/project/packages/web', posix), 'packages/web');
  assert.equal(timing.transcriptDir('/Acme/project', '/Acme/project/packages\\web', posix), null);
  assert.equal(timing.transcriptDir('/Acme/project', '/Acme/other', posix), null);
});

test('round4: transcript subfolder observations retain normalized file and script identities', async t => {
  const home = await scratch(t), root = join(home, 'acme');
  const dir = join(home, '.claude', 'projects', resolve(root).replace(/[^a-zA-Z0-9]/g, '-'));
  await mkdir(dir, { recursive: true });
  const rows = ['node --test tests/acme.test.mjs', 'npm test'].map((command, id) => ({ timestamp: '2026-10-09T00:00:00Z', cwd: join(root, 'packages', 'web'), message: { content: [{ type: 'tool_use', name: 'Bash', id, input: { command, timeout: 120000 } }] } }));
  rows.push({ ...rows[0], cwd: join(home, 'outside') });
  await writeFile(join(dir, 'acme.jsonl'), rows.map(r => JSON.stringify(r)).join('\n'));
  const got = await workedAround({ root, home, env: {}, now: Date.parse('2026-10-10') });
  assert.equal(got.counts.workedAround, 2);
  assert.equal(got.skipped, 1);
  assert.deepEqual(got.identities.map(i => [i.kind, i.id, i.dir]), [['file', 'packages/web/tests/acme.test.mjs', undefined], ['script', 'test', 'packages/web']]);
});

test('round4: gate summaries retain distinct config command and available source identity', () => {
  const gate = (config, commandHash, gateSource) => at('2026-10-09T00:00:00Z', { kind: 'gate', status: 0, ms: 100, config, commandHash, gateSource, tests: [] });
  const data = timeSummary([gate('acme-full', 'acme-full-hash', 'configured-gate'), gate('acme-subset', 'acme-subset-hash', 'explicit-command'), gate('acme-full', 'acme-full-hash', 'configured-gate')], { weeks: 1, now: Date.parse('2026-10-10') });
  assert.equal(data.weeks[0].lanes.length, 2);
  assert.deepEqual(data.weeks[0].lanes.map(l => [l.lane, l.commandHash, l.gateSources]), [
    ['.\0acme-full', 'acme-full-hash', ['configured-gate']], ['.\0acme-subset', 'acme-subset-hash', ['explicit-command']],
  ]);
});

test('round5: package scripts omit outside forwarded targets and unknown grammar while preserving local runs', async t => {
  const home = await scratch(t), root = join(home, 'acme');
  const dir = join(home, '.claude', 'projects', resolve(root).replace(/[^a-zA-Z0-9]/g, '-'));
  await mkdir(dir, { recursive: true });
  const rejected = ['npm test -- /other/acme.test.mjs', 'npm test -- ../other/acme.test.mjs',
    'npm run test -- tests/acme.test.mjs /other/acme.test.mjs', 'pnpm test ../other/acme.test.mjs',
    'yarn test -- /other/acme.test.mjs', 'bun run test -- tests/../../other/acme.test.mjs',
    'npm test -- --unknown tests/acme.test.mjs', 'npm test -- tests/', 'npm test -- "tests/*.test.mjs"', 'npm test -- --reporter',
    'npm test -- -- --reporter /other/acme.test.mjs', 'npm test -- -- --test-name-pattern ../other/acme.test.mjs',
    'npm test -- -- tests/acme.test.mjs'];
  const accepted = ['npm test', 'npm run check', 'npm test -- tests/acme.test.mjs',
    'pnpm test --silent tests/acme.test.mjs', 'yarn test --testNamePattern "Acme ../filter" tests/acme.test.mjs',
    'bun run test -- --test-reporter=spec --test-name-pattern Acme ./tests/acme.test.mjs'];
  await writeFile(join(dir, 'acme.jsonl'), [...rejected, ...accepted].map((command, id) => JSON.stringify({ timestamp: '2026-10-09T00:00:00Z', cwd: root,
    message: { content: [{ type: 'tool_use', name: 'Bash', id, input: { command, timeout: 120000 } }] } })).join('\n'));
  const got = await workedAround({ root, home, env: {}, now: Date.parse('2026-10-10') });
  assert.equal(got.coverage.commandOmissions, rejected.length);
  assert.equal(got.coverage.state, 'partial');
  assert.equal(got.counts.workedAround, accepted.length);
  assert.deepEqual(got.identities.map(i => [i.kind, i.id, i.counts.workedAround]), [
    ['script', 'test', 5], ['script', 'check', 1],
  ]);
});
