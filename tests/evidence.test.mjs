import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { run, cleanEnv } from './helpers/run.mjs';
import { rederive, runMeasurement, LIMITS } from '../lib/evidence.mjs';

const BIN = resolve('bin/keel.mjs');
// Execution requires POSIX process-group cleanup; parsing and previews are portable.
const posixExecution = { skip: process.platform === 'win32' ? 'execution requires POSIX process groups' : false };
const CHILD = resolve('tests/helpers/evidence-child.mjs');
const record = (more = {}) => ({ id: 'acme-count', argv: [process.execPath, '-e', 'console.log(12)'], cwd: '.', value: 10, unit: 'characters', date: '2024-02-29', ...more });
const fence = records => '\n```keel-measurements\n' + JSON.stringify(records) + '\n```\n';
const phase = (refs = ['evidence/acme.md']) => `---
status: planned
since: 2026-10-11
goal: G0
note: "Acme measurement"
evidence: ${JSON.stringify(refs)}
---
# Acme
## Done when
The count is measured.
## Scope
Acme only.
## Acceptance
- [ ] Count the result.
## Proof
Run the Acme measurement.
## Deliberately open
None.
## Next action
Measure.
`;
async function fixture(t, records = [record()]) {
  const root = await mkdtemp(join(tmpdir(), 'keel-evidence-acme-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of ['.keel', 'docs/phases', 'docs/evidence']) await mkdir(join(root, dir), { recursive: true });
  await writeFile(join(root, '.keel/keel.json'), JSON.stringify({ name: 'Acme', practices: ['phases'] }));
  await writeFile(join(root, 'docs/phases/64-acme.md'), phase());
  await writeFile(join(root, 'docs/evidence/acme.md'), fence(records));
  return root;
}
function cli(root, args = []) {
  const r = run(process.execPath, [BIN, 'evidence', 'rederive', '64', ...args, '--json'], { cwd: root, timeout: 15_000 });
  assert.equal(r.stderr, '');
  return { code: r.status, data: JSON.parse(r.stdout) };
}

test('CLI preview, execution and unavailable receipts preserve history and literal argv', async t => {
  const root = await fixture(t, [record({ argv: [process.execPath, '-e', 'console.log(JSON.stringify({count: process.argv[1].length}))', '$(touch acme-marker);*'], jsonField: 'count' })]);
  const before = await readFile(join(root, 'docs/evidence/acme.md'), 'utf8');
  const preview = cli(root);
  assert.equal(preview.code, 0);
  assert.equal(preview.data.mode, 'preview');
  assert.equal(preview.data.records[0].new, null);
  assert.deepEqual(preview.data.limits, LIMITS);
  assert.deepEqual(preview.data.records[0].old, { value: 10, unit: 'characters', date: '2024-02-29' });
  if (process.platform === 'win32') {
    const rejected = cli(root, ['--yes']);
    assert.equal(rejected.code, 2);
    assert.match(rejected.data.error, /execution requires POSIX process groups/);
  }
  await t.test('execution preserves literal argv and dates the new receipt', posixExecution, () => {
    const executed = cli(root, ['--yes']);
    assert.equal(executed.code, 0);
    assert.equal(executed.data.records[0].new.value, '$(touch acme-marker);*'.length);
    assert.deepEqual(executed.data.records[0].old, preview.data.records[0].old);
    assert.match(executed.data.records[0].new.date, /^\d{4}-\d{2}-\d{2}$/);
  });
  assert.equal(await readFile(join(root, 'docs/evidence/acme.md'), 'utf8'), before);
  await assert.rejects(readFile(join(root, 'acme-marker')), { code: 'ENOENT' });
});

test('preview never executes; invalid later records or missing references prevent ALL execution', async t => {
  const sideEffect = record({ argv: [process.execPath, '-e', 'require("node:fs").writeFileSync("marker", "Acme"); console.log(1)'] });
  const root = await fixture(t, [sideEffect]);
  assert.equal(cli(root).code, 0);
  await assert.rejects(readFile(join(root, 'marker')), { code: 'ENOENT' });
  await writeFile(join(root, 'docs/evidence/acme.md'), fence([sideEffect, record({ id: 'bad', date: '2026-02-30' })]));
  assert.equal(cli(root, ['--yes']).code, 2);
  await assert.rejects(readFile(join(root, 'marker')), { code: 'ENOENT' });
  await writeFile(join(root, 'docs/evidence/acme.md'), fence([sideEffect]));
  await writeFile(join(root, 'docs/phases/64-acme.md'), phase(['evidence/acme.md', 'evidence/missing.md']));
  assert.equal(cli(root, ['--yes']).code, 2);
  await assert.rejects(readFile(join(root, 'marker')), { code: 'ENOENT' });
});

test('rejects malformed schema, impossible dates, duplicate records and duplicate phase IDs', async t => {
  const root = await fixture(t);
  for (const bad of [null, {}, record({ date: '2023-02-29' }), record({ date: '2026-13-01' }), record({ value: null }), record({ value: '1' }), record({ value: Infinity }), record({ unit: '' }), record({ argv: [] }), record({ argv: ['node', null] }), record({ cwd: '../escape' }), record({ jsonField: [] }), record({ surprise: true })]) {
    await writeFile(join(root, 'docs/evidence/acme.md'), fence([bad]));
    await assert.rejects(rederive({ root, phase: 64, yes: true }), { exitCode: 2 });
  }
  for (const text of ['```keel-measurements\n[]', '```keel-measurements\n{}\n```', '```keel-measurements\nnope\n```', fence([record(), record()])]) {
    await writeFile(join(root, 'docs/evidence/acme.md'), text);
    await assert.rejects(rederive({ root, phase: 64 }), { exitCode: 2 });
  }
  await writeFile(join(root, 'docs/evidence/acme.md'), fence([record()]));
  await writeFile(join(root, 'docs/phases/064-duplicate.md'), phase());
  await assert.rejects(rederive({ root, phase: 64 }), /duplicate phase id/);
});

test('rejects unsafe references, symlink escapes and non-directory cwd', async t => {
  const root = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'keel-evidence-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'acme.md'), fence([record()]));
  await symlink(outside, join(root, 'outside'));
  for (const cwd of ['outside', '/tmp', 'docs/../docs', 'docs/evidence/acme.md']) {
    await writeFile(join(root, 'docs/evidence/acme.md'), fence([record({ cwd })]));
    await assert.rejects(rederive({ root, phase: 64 }), { exitCode: 2 });
  }
  await rm(join(root, 'docs/evidence/acme.md'));
  await symlink(join(outside, 'acme.md'), join(root, 'docs/evidence/acme.md'));
  await assert.rejects(rederive({ root, phase: 64 }), /escapes repository/);
  await writeFile(join(root, 'docs/phases/64-acme.md'), phase(['evidence/../../outside/acme.md']));
  await assert.rejects(rederive({ root, phase: 64 }), /invalid evidence paths/);
});

test('phase discovery matches collect; selected filenames are validated by the shared parser', async t => {
  const root = await fixture(t);
  await rm(join(root, 'docs/phases/64-acme.md'));
  for (const name of ['64-Acme.md', '64-acme_record.md']) {
    await writeFile(join(root, `docs/phases/${name}`), phase());
    await assert.rejects(rederive({ root, phase: 64 }), /use NN-name\.md/);
    await rm(join(root, `docs/phases/${name}`));
  }
  await writeFile(join(root, 'docs/phases/64-acme.md'), phase());
  await writeFile(join(root, 'docs/phases/064-Acme.md'), phase());
  await assert.rejects(rederive({ root, phase: 64 }), /duplicate phase id/);
});

test('selected source and shape reject before reading archived files; shared planning validation applies', async t => {
  const root = await fixture(t);
  await rm(join(root, 'docs'), { recursive: true });
  for (const config of [{ phases: { source: 'milestones' } }, { phases: { shape: 'projects' } }, { local: { phases: 'Acme custom' } }]) {
    await writeFile(join(root, '.keel/keel.json'), JSON.stringify({ practices: ['base'], ...config }));
    await assert.rejects(rederive({ root, phase: 64 }), /selected planning source or shape is unsupported/);
  }
  for (const phases of [{ source: 'typo' }, { ownerLabel: '' }]) {
    await writeFile(join(root, '.keel/keel.json'), JSON.stringify({ phases }));
    await assert.rejects(rederive({ root, phase: 64 }), /phases\.(source|ownerLabel)/);
  }
});

test('only explicit fences execute: ignores prose, ordinary fences and nested examples', async t => {
  const root = await fixture(t);
  const examples = '\n`node -e "console.log(666)"`\n```json\n[]\n```\n````markdown\n' + fence([record({ id: 'example' })]) + '\n````\n';
  await writeFile(join(root, 'docs/evidence/acme.md'), examples);
  await assert.rejects(rederive({ root, phase: 64 }), /no explicit/);
  await writeFile(join(root, 'docs/phases/64-acme.md'), phase() + fence([record()]));
  assert.equal(cli(root).data.records.length, 1);
});

test('PR104: malformed external config cannot authorize archived measurement execution', async t => {
  const root = await fixture(t, [record({ argv: [process.execPath, '-e', 'require("node:fs").writeFileSync("acme-marker", "executed"); console.log(12)'] })]);
  const configs = [null, [], 'Acme', 42, true,
    ...[undefined, null, [], 'base,phases', {}, ['phases', null], ['']].map(practices => ({ practices, local: { phases: 'Acme local plan' } })),
    ...[null, [], 'phases'].map(local => ({ practices: ['phases'], local }))];
  for (const config of configs) {
    await writeFile(join(root, '.keel/keel.json'), JSON.stringify(config));
    const result = cli(root, ['--yes']);
    assert.equal(result.code, 2, JSON.stringify(config));
    assert.match(result.data.error, /config must be an object|practices must be a nonempty array|local must be an object/);
    await assert.rejects(readFile(join(root, 'acme-marker')), { code: 'ENOENT' });
  }
});

test('PR104: inline code comment markers cannot hide real measurements or expose commented ones', async t => {
  const root = await fixture(t);
  for (const prose of ['Use `<!--` literally.', 'Use ``a ` <!-- b`` literally.', 'Use `<!-- -->` and `<!--` literally.']) {
    await writeFile(join(root, 'docs/evidence/acme.md'), prose + '\n' + fence([record()]));
    const result = cli(root);
    assert.equal(result.code, 0, JSON.stringify(result.data));
    assert.equal(result.data.records[0].new, null);
  }
  // Unmatched code delimiters and a real comment after a code span remain prose.
  for (const prose of ['Use `<!--', 'Use ``a ` <!--', 'Use `<!--` then <!--']) {
    await writeFile(join(root, 'docs/evidence/acme.md'), prose + '\n' + fence([record()]) + '\n-->');
    const result = cli(root, ['--yes']);
    assert.equal(result.code, 2);
    assert.match(result.data.error, /no explicit keel-measurements/);
  }
});

test('PR104: commented and unclosed-comment measurements never execute', async t => {
  const root = await fixture(t);
  const hidden = record({ argv: [process.execPath, '-e', 'require("node:fs").writeFileSync("acme-marker", "executed"); console.log(12)'] });
  for (const end of ['\n-->\n', '']) {
    await writeFile(join(root, 'docs/evidence/acme.md'), 'Acme draft <!--\n' + fence([hidden]) + end);
    const result = cli(root, ['--yes']);
    assert.equal(result.code, 2);
    assert.match(result.data.error, /no explicit keel-measurements/);
    await assert.rejects(readFile(join(root, 'acme-marker')), { code: 'ENOENT' });
  }
});

test('PR104: ordinary fences inside comments cannot change real fence state', async t => {
  const root = await fixture(t);
  const live = record({ id: 'acme-live' });
  for (const hidden of ['```markdown\n', '~~~~text\n', '```text\nAcme\n```\n']) {
    const text = '<!-- Acme comment\n' + hidden + '--> <!-- another comment -->\n' + fence([live]);
    await writeFile(join(root, 'docs/evidence/acme.md'), text);
    const result = cli(root);
    assert.equal(result.code, 0, JSON.stringify(result.data));
    assert.deepEqual(result.data.records.map(r => r.id), ['acme-live']);
    assert.equal(result.data.records[0].new, null);
  }
  // An opening comment marker in an ordinary fenced example stays literal too.
  await writeFile(join(root, 'docs/evidence/acme.md'), '\n```text\n<!--\n```\n' + fence([live]));
  assert.equal(cli(root).code, 0);
});

test('PR104: literal HTML comment markers in measurement JSON preserve exact argv', async t => {
  const literal = '<!-- Acme --> followed by <!--';
  const argv = [process.execPath, '-e', 'const marker = "<!--"; console.log(process.argv[1].length + marker.length)', literal];
  const root = await fixture(t, [record({ argv })]);
  const result = cli(root);
  assert.equal(result.code, 0, JSON.stringify(result.data));
  assert.deepEqual(result.data.records[0].argv, argv);
  await t.test('execution preserves comment markers in argv', posixExecution, () => {
    const executed = cli(root, ['--yes']);
    assert.equal(executed.code, 0, JSON.stringify(executed.data));
    assert.equal(executed.data.records[0].new.value, literal.length + 4);
  });
});

test('strict numeric output and literal top-level JSON selection never turn unavailable into zero', posixExecution, async t => {
  const cases = [
    ['console.log(0)', undefined, 0], ['console.log(" -1.25e2 ")', undefined, -125],
    ['console.log("")', undefined, null], ['console.log("12 characters")', undefined, null],
    ['console.log("Infinity")', undefined, null], ['console.log("1e999")', undefined, null],
    ['console.log("0x12")', undefined, null], ['console.log("1\\n2")', undefined, null],
    ['console.log(JSON.stringify({"a.b": 7}))', 'a.b', 7],
    ['console.log(JSON.stringify({count: "7"}))', 'count', null],
    ['console.log("null")', 'count', null], ['console.log("{}")', 'count', null],
    ['console.log(12); process.exit(7)', undefined, null],
  ];
  const root = await fixture(t, cases.map(([code, jsonField], i) => record({ id: `case-${i}`, argv: [process.execPath, '-e', code], ...(jsonField === undefined ? {} : { jsonField }) })));
  const r = cli(root, ['--yes']);
  assert.equal(r.code, 1);
  r.data.records.forEach((receipt, i) => { assert.equal(receipt.new.value, cases[i][2]); assert.equal(receipt.new.error === null, cases[i][2] !== null); });
  assert.equal(r.data.records.at(-1).new.exitCode, 7);
  await writeFile(join(root, 'docs/evidence/acme.md'), fence([record({ argv: ['acme-nonexistent-program-76254'] })]));
  const missing = cli(root, ['--yes']);
  assert.equal(missing.code, 1);
  assert.equal(missing.data.records[0].new.value, null);
  assert.match(missing.data.records[0].new.error, /^spawn:/);
});

test('per-command deadline stops a real nonterminating command', { ...posixExecution, timeout: 10_000 }, async t => {
  const root = await fixture(t);
  const options = { env: cleanEnv(), timeoutMs: 500, outputBytes: 1024 };
  const timeout = await runMeasurement([process.execPath, '-e', 'setInterval(() => {}, 1000)'], root, options);
  assert.equal(timeout.error, 'timeout');
  assert.equal(timeout.stdout, '');
  assert.equal(timeout.stderr, '');
});

test('combined stdout/stderr bounds do not race child startup against the deadline', { ...posixExecution, timeout: 10_000 }, async t => {
  const root = await fixture(t);
  // Exercise real pipes and process cleanup, but hold the executor's clock:
  // startup under suite load is not evidence that an output bound is broken.
  // The real deadline is checked separately above, with the same 500 ms limit.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const [name, stdoutBytes, stderrBytes, error] of [
    ['stdout overflow', 2048, 0, 'output-limit'],
    ['stderr overflow', 0, 2048, 'output-limit'],
    ['combined overflow', 768, 768, 'output-limit'],
    ['exact combined bound', 512, 512, null],
  ]) {
    await t.test(name, async () => {
      const code = `require('node:fs').writeSync(1, 'x'.repeat(${stdoutBytes})); require('node:fs').writeSync(2, 'y'.repeat(${stderrBytes}));`;
      const output = await runMeasurement([process.execPath, '-e', code], root, { env: cleanEnv(), timeoutMs: 500, outputBytes: 1024 });
      assert.equal(output.error, error);
      assert.equal(Buffer.byteLength(output.stdout + output.stderr), 1024);
      assert.match(output.stdout, /^x*$/);
      assert.match(output.stderr, /^y*$/);
      if (error === null) {
        assert.equal(output.exitCode, 0);
        assert.equal(output.stdout.length, stdoutBytes);
        assert.equal(output.stderr.length, stderrBytes);
      }
    });
  }
});

// /proc's comm field can contain spaces and parentheses; state follows its
// final ')'. Zombies cannot execute but may await an uncooperative PID 1.
const zombie = text => /^\s+Z\s/.test(text.slice(text.lastIndexOf(')') + 1));

test('PR104: Linux zombie detection never accepts a running, sleeping or stopped descendant', () => {
  for (const state of ['R', 'S', 'D', 'T', 't', 'I']) assert.equal(zombie(`123 (Acme ) child) ${state} 1 2 3`), false);
  assert.equal(zombie('123 (Acme ) child) Z 1 2 3'), true);
  assert.equal(zombie(''), false);
});

async function gone(pid) {
  for (let i = 0; i < 100; i++) {
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return true; throw error; }
    if (process.platform === 'linux') {
      const status = await readFile(`/proc/${pid}/stat`, 'utf8').catch(error => {
        if (['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(error.code)) return '';
        throw error;
      });
      if (zombie(status)) return true;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return false;
}
test('parent exit and timeout clean ordinary descendants that inherit stdout; completion is bounded', { ...posixExecution, timeout: 10_000 }, async t => {
  const root = await fixture(t);
  for (const mode of ['exit', 'wait']) {
    const pidFile = join(root, `acme-${mode}.pid`);
    const started = Date.now();
    const result = await runMeasurement([process.execPath, CHILD, pidFile, mode], root, { env: cleanEnv(), timeoutMs: 1000 });
    assert.ok(Date.now() - started < 4000);
    const pid = Number(await readFile(pidFile, 'utf8'));
    t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } });
    assert.equal(await gone(pid), true, `descendant ${pid} was cleaned up`);
    assert.equal(result.error, mode === 'wait' ? 'timeout' : null);
    if (mode === 'exit') { assert.equal(result.exitCode, 0); assert.equal(result.stdout.trim(), '12'); }
  }
});

test('CLI unknown flags and missing selection return machine-readable usage errors', async t => {
  const root = await fixture(t);
  assert.equal(cli(root, ['--wat']).code, 2);
  const result = run(process.execPath, [BIN, 'evidence', 'rederive', '--json'], { cwd: root });
  assert.equal(result.status, 2);
  assert.match(JSON.parse(result.stdout).error, /phase/);
});

test('help and version never load the evidence executor', () => {
  const script = `
    import { registerHooks } from 'node:module';
    registerHooks({ resolve(specifier, context, next) {
      if (specifier.endsWith('/evidence.mjs')) throw new Error('eager evidence import');
      return next(specifier, context);
    }});
    const { main } = await import('./lib/cli.mjs');
    for (const args of [['--version', '--json'], ['help', '--json'], ['--agent-help', '--json']]) {
      if (await main(args, { out() {}, err() {} }) !== 0) process.exit(1);
    }
  `;
  const result = run(process.execPath, ['--input-type=module', '-e', script]);
  assert.equal(result.status, 0, result.stderr);
});
