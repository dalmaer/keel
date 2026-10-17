// One gate result per commit, shared by every pass (phase 79): scripts/keel/gate.mjs.
// Synthetic Acme repositories and a gh stub that answers the Actions API and an
// artifact's ZIP bytes from fixtures; no network, nobody's git settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, cp, chmod, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { deflateRawSync, crc32 } from 'node:zlib';
import { createHash } from 'node:crypto';
import * as gateModule from '../practices/night/files/scripts/keel/gate.mjs';
const { gate, gateLine, ciResult, ledgerEvidence, docsOnlyOf, docsOnlySkip, DOCS_ONLY } = gateModule;
// Read through the namespace, so this file loads without it and its tests fail on behaviour (keel prove).
const protectedPath = (...args) => gateModule.protectedPath?.(...args) ?? false;
import { readRuns, sha12 } from '../practices/night/files/scripts/keel/test-ledger.mjs';
import { ranOn } from '../scripts/keel/climb.mjs';
import { MEASURES, measure } from '../practices/night/files/scripts/keel/improve.mjs';
import { scratch, ENV } from './helpers/improve.mjs';
import { run } from './helpers/run.mjs';

const repo = 'acme/anvils';
const CHECK = "node -e \"require('fs').writeFileSync('ran','yes')\"";
const CONFIG = { name: 'Acme', repo, ci: { gateWorkflow: 'check.yml' }, check: CHECK };
const NIGHT = resolve('practices/night/files/scripts/keel');
const LOOP = resolve('practices/loop/files/.github/workflows/keel-loop.yml');
const CHECK_YML = resolve('practices/ci/files/.github/workflows/check.yml');
const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();

/** A real ZIP of the ledger's records, deflated, as upload-artifact makes one. */
function zip(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const { name, body } of files) {
    const data = Buffer.from(body), packed = deflateRawSync(data), n = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x314, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE((0o100644 << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, n, packed); centrals.push(central, n); offset += local.length + n.length + packed.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** The records CI's gate leaves: its own (kind gate) and the test run under it. */
function records({ sha, tree, command = CHECK, status = 0, id = '00000000-0000-4000-8000-000000000001', tests = [{ file: 'tests/acme.test.mjs', name: 'anvil', outcome: 'pass', ms: 3 }], gateExtra = {}, runExtra = {} }) {
  const date = ago(5);
  return [
    { kind: 'gate', runner: 'gate', commit: sha, tree, dirty: false, invocationId: id, completed: true, provenance: { version: 1, source: 'outer-launcher', invocationId: id, outerCommandHash: sha12(command), scope: '.' }, gateSource: 'configured-check', commandHash: sha12(command), status, date, tests: [], ...gateExtra },
    { commit: sha, tree, dirty: false, parentInvocationId: id, completed: true, dir: '.', date, tests, ...runExtra },
  ];
}

/**
 * The Actions API for `commits` ({ sha, tree, records?, conclusion?, minutes?, artifacts?, event? }):
 * each a push run on main with one job and, unless `artifacts` says otherwise, one keel-test-runs artifact.
 */
function actions(commits) {
  const routes = { [`repos/${repo}`]: { private: false, default_branch: 'main' }, [`repos/${repo}/actions/workflows`]: { workflows: [{ id: 7, name: 'check', path: '.github/workflows/check.yml' }], total_count: 1 } };
  const zips = {};
  commits.forEach((c, i) => {
    const id = 100 + i, minutes = c.minutes ?? 5;
    routes[`repos/${repo}/actions/workflows/7/runs?head_sha=${c.sha}`] = { workflow_runs: [{ id, workflow_id: 7, run_attempt: 1, head_sha: c.sha, head_branch: 'main', event: c.event ?? 'push', head_repository: { full_name: repo }, status: 'completed', conclusion: c.conclusion ?? 'success', created_at: ago(minutes + 10), updated_at: ago(minutes) }], total_count: 1 };
    routes[`repos/${repo}/actions/runs/${id}/attempts/1/jobs`] = { jobs: [{ id: id * 10, run_id: id, run_attempt: 1, name: 'check', head_sha: c.sha, status: 'completed', conclusion: c.conclusion ?? 'success', started_at: ago(minutes + 3), completed_at: ago(minutes) }], total_count: 1 };
    const bytes = zip((c.records ?? records(c)).map((r, j) => ({ name: `2026-10-16T00-00-0${j}-acme.json`, body: JSON.stringify(r) })));
    const artifacts = c.artifacts ?? [{ id: id * 100, name: 'keel-test-runs', expired: false, size_in_bytes: bytes.length, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, workflow_run: { id, head_sha: c.sha } }];
    routes[`repos/${repo}/actions/runs/${id}/artifacts`] = { artifacts, total_count: artifacts.length };
    for (const a of artifacts) zips[a.id] = (c.zip ?? bytes).toString('base64');
  });
  return { routes, zips };
}

/** A gh stub: `gh api <path>` answers from the fixture (a ZIP's bytes for an artifact), logging each path. */
async function ghStub(t, fixture) {
  const dir = await scratch(t, 'keel-gate-gh-');
  const gh = join(dir, 'gh'), data = join(dir, 'fixture.json'), log = join(dir, 'log');
  await writeFile(data, JSON.stringify(fixture));
  await writeFile(gh, `#!${process.execPath}
const fs = require('node:fs'), a = process.argv.slice(2);
if (a[0] !== 'api' || a.length !== 2) process.exit(1);
fs.appendFileSync(${JSON.stringify(log)}, a[1] + '\\n');
const { routes, zips } = JSON.parse(fs.readFileSync(${JSON.stringify(data)}, 'utf8'));
const z = /^repos\\/[^/]+\\/[^/]+\\/actions\\/artifacts\\/(\\d+)\\/zip$/.exec(a[1]);
if (z) { if (!zips[z[1]]) process.exit(1); process.stdout.write(Buffer.from(zips[z[1]], 'base64')); process.exit(0); }
const p = a[1].replace(/[?&]per_page=\\d+&page=1$/, '');
if (!Object.hasOwn(routes, p) || routes[p] === null) { console.error('gh: Not Found (HTTP 404)'); process.exit(1); }
console.log(JSON.stringify(routes[p]));
`);
  await chmod(gh, 0o755);
  return { gh, env: { ...ENV, KEEL_GH: gh }, asked: async () => (existsSync(log) ? await readFile(log, 'utf8') : '').split('\n').filter(Boolean) };
}

/** An Acme repository: .keel/keel.json, a source file, committed on main; `scripts` copies the night's scripts in. */
async function acme(t, { config = CONFIG, scripts = false } = {}) {
  const root = await scratch(t, 'keel-gate-');
  const git = (...args) => execFileSync('git', args, { cwd: root, env: ENV, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  await mkdir(join(root, '.keel'));
  await writeFile(join(root, '.keel/keel.json'), JSON.stringify(config));
  await writeFile(join(root, 'anvil.mjs'), 'export const anvil = 1;\n');
  if (scripts) await cp(NIGHT, join(root, 'scripts/keel'), { recursive: true });
  git('add', '-A'); git('commit', '-qm', 'Acme');
  const head = () => ({ sha: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}') });
  const commit = async (path, text = 'Acme\n') => { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), text); git('add', '-A'); git('commit', '-qm', `Acme ${path}`); return head(); };
  return { root, git, head, commit, ran: () => existsSync(join(root, 'ran')) };
}

// ---- reuse: every pass that would run the gate on the commit CI tested ----------------

test('the gate reuses an exact, clean, successful CI result for HEAD and says so; without one it runs, saying why', async t => {
  const a = await acme(t);
  const stub = await ghStub(t, actions([a.head()]));
  const reused = await gate({ root: a.root, config: CONFIG, env: stub.env, stdio: 'pipe' });
  assert.equal(reused.action, 'reused');
  assert.equal(reused.status, 0);
  assert.equal(reused.tests, 1, 'the tests CI ran, from its ledger records');
  assert.equal(a.ran(), false, 'not run here');
  assert.match(gateLine(reused), /^keel gate: reused CI's result for [0-9a-f]{7} \(\.github\/workflows\/check\.yml run 100, attempt 1, 5 minutes old\): .* passed with 1 tests; not run here$/);
  assert.ok((await stub.asked()).includes(`repos/${repo}/actions/artifacts/10000/zip`), 'the artifact\'s contents are the evidence');
  // No result for this commit: the gate runs, and says why it did not reuse.
  const none = await ghStub(t, actions([]));
  const ran = await gate({ root: a.root, config: CONFIG, env: none.env, stdio: 'pipe' });
  assert.equal(ran.action, 'ran');
  assert.equal(ran.status, 0);
  assert.equal(a.ran(), true);
  assert.match(gateLine(ran), /^keel gate: ran `node -e .*`: exit 0 \(not reused: .+\)$/);
});

test('CI\'s own gate step (--ci) never reuses: it is the result the others reuse', async t => {
  const a = await acme(t);
  const stub = await ghStub(t, actions([a.head()]));
  const r = await gate({ root: a.root, config: CONFIG, env: stub.env, ci: true, stdio: 'pipe' });
  assert.equal(r.action, 'ran');
  assert.equal(a.ran(), true);
  assert.deepEqual(await stub.asked(), [], 'without docsOnly it reads nothing from GitHub');
  const gates = (await readRuns(a.root, undefined, { gates: true })).runs.filter(x => x.kind === 'gate');
  assert.equal(gates.length, 1, 'through the ledger\'s launcher, as test-ledger.mjs --gate');
  assert.deepEqual([gates[0].gateSource, gates[0].commandHash], ['configured-check', sha12(CHECK)], 'the record a later pass compares');
});

test('the night\'s gate measure reuses through the same function, with the tests CI ran; a dirty tree runs its own', async t => {
  const a = await acme(t);
  const stub = await ghStub(t, actions([a.head()]));
  const selected = MEASURES.filter(m => m.id === 'gate');
  const [g] = await measure({ root: a.root, config: CONFIG, env: stub.env, measures: selected });
  assert.equal(g.value, 0);
  assert.equal(g.facts.source, 'github-actions');
  assert.equal(g.facts.tests, 1);
  assert.match(g.detail, /not run locally/);
  assert.equal(a.ran(), false);
  await writeFile(join(a.root, 'anvil.mjs'), 'export const anvil = 2;\n');
  const [dirty] = await measure({ root: a.root, config: CONFIG, env: stub.env, measures: selected });
  assert.equal(dirty.facts.source, 'local-command');
  assert.match(dirty.facts.reuseUnavailable, /dirty/);
  assert.equal(a.ran(), true);
});

test('the loop\'s gate step and the pre-push helper: the shipped shell reuses for an unchanged pull and runs for a changed one', async t => {
  const a = await acme(t, { scripts: true });
  const stub = await ghStub(t, actions([a.head()]));
  const yml = await readFile(LOOP, 'utf8');
  const block = yml.split('      - name: Gate\n')[1].split('        run: |\n')[1].split('\n\n')[0].split('\n').map(l => l.slice(10)).join('\n')
    .replace('{{check}}', CHECK).replace('node scripts/loop.mjs render --check', 'true');
  const output = join(a.root, '..', `out-${Date.now()}`);
  const shell = () => run('bash', ['-e', '-c', block], { cwd: a.root, env: { ...stub.env, GITHUB_OUTPUT: output } });
  const unchanged = shell();
  assert.equal(unchanged.status, 0, unchanged.stderr);
  assert.match(unchanged.stdout, /keel gate: reused CI's result/);
  assert.match(await readFile(output, 'utf8'), /^gate=ok$/m);
  assert.equal(a.ran(), false, 'a pull that changed nothing is the commit CI tested');
  await mkdir(join(a.root, 'docs/loop'), { recursive: true });
  await writeFile(join(a.root, 'docs/loop/acme.md'), 'a finding\n');
  const pulled = shell();
  assert.equal(pulled.status, 0, pulled.stderr);
  assert.match(pulled.stdout, /keel gate: ran .*not reused: revision is dirty/);
  assert.equal(a.ran(), true, 'a pull that changed findings is a tree CI never tested');
  // The pre-push helper is the same command; --json says which, the check's own output kept off stdout.
  await a.commit('docs/loop/acme.md', 'a finding\n');
  const json = run(process.execPath, ['scripts/keel/gate.mjs', '--json'], { cwd: a.root, env: stub.env });
  assert.equal(json.status, 0, json.stderr);
  assert.equal(JSON.parse(json.stdout).action, 'ran', 'a new commit CI has not tested runs');
  const bad = run(process.execPath, ['scripts/keel/gate.mjs', '--acme'], { cwd: a.root, env: stub.env });
  assert.equal(bad.status, 2, 'usage');
});

// ---- never weaker --------------------------------------------------------------------

test('a result for another command, another tree, a dirty tree, or a run with no tests is never reused', () => {
  const sha = 'a'.repeat(40), tree = 'b'.repeat(40), ok = { sha, tree, command: CHECK };
  assert.equal(ledgerEvidence(records({ sha, tree }), ok).kind, 'ledger', 'the fixture itself passes');
  const refused = [
    ['another command', records({ sha, tree, command: 'npm run check:quick' }), /another command/],
    ['another command, gate hash only', records({ sha, tree, gateExtra: { commandHash: sha12('npm test') } }), /another command/],
    ['not the configured check', records({ sha, tree, gateExtra: { gateSource: 'explicit-command' } }), /another command/],
    ['another tree', records({ sha, tree: 'c'.repeat(40) }), /another tree/],
    ['a test run on another tree', records({ sha, tree, runExtra: { tree: 'c'.repeat(40) } }), /another commit or tree/],
    ['a dirty tree', records({ sha, tree, gateExtra: { dirty: true } }), /dirty/],
    ['an unknown tree state', records({ sha, tree, gateExtra: { dirty: null } }), /dirty/],
    ['a dirty test run', records({ sha, tree, runExtra: { dirty: true } }), /dirty/],
    ['no test ran', records({ sha, tree, tests: [] }), /no test ran/],
    ['only skipped tests', records({ sha, tree, tests: [{ file: 'tests/acme.test.mjs', name: 'anvil', outcome: 'skip' }] }), /no test ran/],
    ['no test run under the gate', records({ sha, tree }).slice(0, 1), /no test ran/],
    ['a test run under another gate', records({ sha, tree, runExtra: { parentInvocationId: 'other' } }), /no test ran/],
    ['a narrowed run', records({ sha, tree, runExtra: { filtered: true } }), /narrowed/],
    ['a failed test behind || true', records({ sha, tree, tests: [{ file: 'tests/acme.test.mjs', name: 'anvil', outcome: 'fail' }, { file: 'tests/acme.test.mjs', name: 'bell', outcome: 'pass' }] }), /failed/],
    ['a failed gate', records({ sha, tree, status: 1 }), /exited 1/],
    ['another commit', records({ sha: 'd'.repeat(40), tree }), /no gate record/],
    ['two gate records', [...records({ sha, tree }), records({ sha, tree, id: 'second' })[0]], /2 gate records/],
    ['an incomplete record', records({ sha, tree, gateExtra: { completed: false } }), /incomplete/],
  ];
  for (const [why, rs, pattern] of refused) {
    const r = ledgerEvidence(rs, ok);
    assert.equal(r.kind, undefined, why);
    assert.match(r.reason, pattern, why);
  }
});

test('CI runs that are not an exact, completed, successful, recent result of the gate are never reused', async t => {
  const a = await acme(t);
  const { sha, tree } = a.head();
  const ask = async (commit, extra = {}) => ciResult({ config: CONFIG, sha, tree, clean: true, env: (await ghStub(t, actions([{ sha, tree, ...commit }]))).env, ...extra });
  assert.equal((await ask({})).reused, true, 'the fixture itself is reused');
  const bytes = Buffer.from('not a zip');
  const refused = [
    ['a failed run', { conclusion: 'failure', records: records({ sha, tree, status: 1 }) }, /concluded failure|exited 1/],
    ['a cancelled run', { conclusion: 'cancelled' }, /no completed success/],
    ['older than 24 hours', { minutes: 25 * 60 }, /24-hour/],
    ['a pull request run', { event: 'pull_request' }, /no completed success/],
    ['no artifact', { artifacts: [] }, /kept no keel-test-runs artifact/],
    ['two artifacts', { artifacts: [1, 2].map(id => ({ id, name: 'keel-test-runs', expired: false, size_in_bytes: 10, workflow_run: { id: 100, head_sha: sha } })) }, /2 keel-test-runs artifacts/],
    ['an expired artifact', { artifacts: [{ id: 9, name: 'keel-test-runs', expired: true, size_in_bytes: 10, workflow_run: { id: 100, head_sha: sha } }] }, /expired/],
    ['another run\'s artifact', { artifacts: [{ id: 9, name: 'keel-test-runs', expired: false, size_in_bytes: 10, workflow_run: { id: 99, head_sha: sha } }] }, /not this run's/],
    ['a digest mismatch', { artifacts: [{ id: 9, name: 'keel-test-runs', expired: false, size_in_bytes: 10, digest: `sha256:${'0'.repeat(64)}`, workflow_run: { id: 100, head_sha: sha } }] }, /digest/],
    ['an unreadable archive', { zip: bytes, artifacts: [{ id: 9, name: 'keel-test-runs', expired: false, size_in_bytes: bytes.length, workflow_run: { id: 100, head_sha: sha } }] }, /unreadable/],
  ];
  for (const [why, commit, pattern] of refused) {
    const r = await ask(commit);
    assert.equal(r.reused, false, why);
    assert.match(r.reason, pattern, why);
  }
  assert.match((await ciResult({ config: CONFIG, sha, tree, clean: false, env: ENV })).reason, /dirty/, 'a dirty local tree');
  assert.match((await ciResult({ config: { ...CONFIG, ci: undefined }, sha, tree, clean: true, env: ENV })).reason, /explicitly configured/, 'discovery never authorizes reuse');
  assert.match((await ciResult({ config: { ...CONFIG, repo: undefined }, sha, tree, clean: true, env: ENV })).reason, /no repo/);
});

// ---- docs only -------------------------------------------------------------------------

const DOCS = { ...CONFIG, delivery: { docsOnly: ['docs/', 'README.md', '**/*.md'] } };

test('a docs-only commit records "skipped: docs only"; a commit touching anything else runs the suite', async t => {
  const a = await acme(t, { config: DOCS });
  const tested = a.head();
  const docs = await a.commit('docs/guide.md');
  const stub = await ghStub(t, actions([tested]));
  const skipped = await gate({ root: a.root, config: DOCS, env: stub.env, ci: true, stdio: 'pipe' });
  assert.equal(skipped.action, 'skipped');
  assert.equal(skipped.base, tested.sha, 'against the last fully tested commit');
  assert.equal(a.ran(), false);
  assert.match(gateLine(skipped), new RegExp(`^keel gate: ${DOCS_ONLY}: the 1 path changed since [0-9a-f]{7}`));
  const all = (await readRuns(a.root, undefined, { gates: true })).runs;
  assert.deepEqual(all.map(r => [r.kind, r.skipped, r.commit, r.base, r.tests.length]), [['gate-skip', DOCS_ONLY, docs.sha, tested.sha, 0]], 'recorded, as a skip');
  assert.deepEqual((await readRuns(a.root)).runs, [], 'never a test run: climb\'s and the robot\'s records of what ran never count it');
  assert.equal(ranOn((await readRuns(a.root)).runs, docs.sha), null);
  // Code beside the docs: the suite runs.
  await a.commit('anvil.mjs', 'export const anvil = 3;\n');
  const code = await gate({ root: a.root, config: DOCS, env: stub.env, ci: true, stdio: 'pipe' });
  assert.equal(code.action, 'ran');
  assert.match(code.reasons.join(' '), /anvil\.mjs changed since [0-9a-f]{7}.*not docs only/);
  assert.equal(a.ran(), true);
});

test('docs-only is decided against the last fully tested commit, never the parent: a cancelled code run is never covered', async t => {
  const a = await acme(t, { config: DOCS });
  const tested = a.head();
  const code = await a.commit('anvil.mjs', 'export const anvil = 4;\n');
  await a.commit('docs/guide.md');
  // The code commit's run was cancelled: CI has no result for it. The parent of HEAD is that code commit.
  const stub = await ghStub(t, actions([tested, { ...code, conclusion: 'cancelled' }]));
  const r = await docsOnlySkip({ root: a.root, config: DOCS, env: stub.env });
  assert.equal(r.skip, false);
  assert.match(r.reason, /anvil\.mjs changed since/);
  // Two docs commits in a row after a tested one: the first skipped (no full result), the second still skips against the tested one.
  const b = await acme(t, { config: DOCS });
  const base = b.head();
  await b.commit('docs/one.md');
  await b.commit('README.md');
  const twice = await docsOnlySkip({ root: b.root, config: DOCS, env: (await ghStub(t, actions([base]))).env });
  assert.equal(twice.skip, true);
  assert.equal(twice.base, base.sha);
  assert.deepEqual(twice.changed.sort(), ['README.md', 'docs/one.md']);
  // A tested commit that is only a gate-skip (no test run under a gate) is not "fully tested".
  const c = await acme(t, { config: DOCS });
  const first = c.head();
  await c.commit('docs/two.md');
  const onlySkip = await docsOnlySkip({ root: c.root, config: DOCS, env: (await ghStub(t, actions([{ ...first, records: [{ kind: 'gate-skip', commit: first.sha, tree: first.tree, dirty: false, skipped: DOCS_ONLY, status: 0, date: ago(5), tests: [] }] }]))).env });
  assert.equal(onlySkip.skip, false);
  // A dirty tree is never decided docs-only.
  await writeFile(join(c.root, 'docs/three.md'), 'Acme\n');
  assert.match((await docsOnlySkip({ root: c.root, config: DOCS, env: ENV })).reason, /dirty/);
});

test('delivery.docsOnly is a list of repo-relative paths that never covers code or the gate\'s own files', () => {
  assert.equal(docsOnlyOf({}), null);
  const d = docsOnlyOf(DOCS);
  for (const p of ['docs/a.md', 'README.md', 'web/notes.md']) assert.equal(d.test(p), true, p);
  for (const p of ['docs.mjs', 'src/index.js', 'readme.txt']) assert.equal(d.test(p), false, p);
  for (const docsOnly of [[], 'docs/', [''], ['/docs/'], ['../docs/'], ['docs/../src'], ['**'], ['*'], ['**/*'], ['.github/'], ['scripts/'], ['package.json'], ['*.json']]) {
    assert.throws(() => docsOnlyOf({ delivery: { docsOnly } }), e => e.exitCode === 2, JSON.stringify(docsOnly));
  }
});

test('check.yml\'s gate step runs gate.mjs --ci with a read-only token it keeps from the check, and still records a red gate', async t => {
  const yml = await readFile(CHECK_YML, 'utf8');
  assert.match(yml, /\n {6}actions: read\n/, 'reads its own runs and artifacts, nothing more');
  assert.match(yml, /- name: Run the configured gate\n {8}env:\n {10}GH_TOKEN: \$\{\{ github\.token \}\}\n {8}run: \|\n {10}if \[ -f scripts\/keel\/gate\.mjs \]; then\n {12}node scripts\/keel\/gate\.mjs --ci\n/);
  const a = await acme(t, { config: { ...CONFIG, check: 'node -e "process.exit(process.env.GH_TOKEN ? 9 : 7)"' }, scripts: true });
  const block = yml.split('      - name: Run the configured gate\n')[1].split('        run: |\n')[1].split('      # The test ledger')[0].split('\n').map(l => l.slice(10)).join('\n');
  const r = run('bash', ['-e', '-c', block.replace('{{check}}', 'exit 3')], { cwd: a.root, env: { ...ENV, GH_TOKEN: 'acme-read-token' } });
  assert.equal(r.status, 7, 'the check\'s own exit, and the token never reached it');
  const gates = (await readRuns(a.root, undefined, { gates: true })).runs.filter(x => x.kind === 'gate');
  assert.deepEqual(gates.map(g => g.status), [7]);
  assert.deepEqual(await readdir(join(a.root, '.keel/test-runs')).then(n => n.some(x => x.endsWith('.json'))), true, 'what Keep the test ledger uploads');
});

// PR #174 review: a list naming one executable file (keel's own scripts, a workflow) was accepted, and a clean
// commit changing only that file skipped the gate. A protected path is never docs only, whatever the list says.
const PROTECTED = ['scripts/keel/test-ledger.mjs', '.github/workflows/keel-night.yml', '.github/actions/acme/action.yml', 'package.json', 'web/package.json', 'package-lock.json', 'web/pnpm-lock.yaml', 'bun.lockb', 'yarn.lock', '.keel/keel.json', '.keel/lock.json', '.nvmrc', '.node-version', '.tool-versions'];

test('a docs-only list that reaches a protected path is refused at config time, structurally', () => {
  for (const entry of [...PROTECTED, 'scripts/keel/', 'scripts/', '.github/', '.github/workflows/*.yml', 'scripts/keel/*.mjs', '**/package.json', '**/*.lock', '**/*.mjs', '*.json', '**', '*']) {
    assert.throws(() => docsOnlyOf({ delivery: { docsOnly: ['docs/', entry] } }), e => e.exitCode === 2 && /never covers/.test(e.message), entry);
  }
  // A path keel manages, named in the project's .keel/lock.json, is refused by name too.
  assert.throws(() => docsOnlyOf({ delivery: { docsOnly: ['docs/templates/evidence.md'] } }, { managed: ['docs/templates/evidence.md'] }), /never covers/);
  for (const ok of [['docs/'], ['README.md'], ['**/*.md'], ['docs/**/*.md', 'CHANGELOG.md']]) assert.ok(docsOnlyOf({ delivery: { docsOnly: ok } }), JSON.stringify(ok));
});

test('a protected path is never docs only when changed, even if a pattern slipped through', async t => {
  for (const p of PROTECTED) assert.equal(protectedPath(p), true, p);
  for (const p of ['docs/guide.md', 'README.md', 'docs/package.json.md']) assert.equal(protectedPath(p), false, p);
  assert.equal(protectedPath('AGENTS.md', ['AGENTS.md']), true, 'a managed file');
  // A list that slipped past the config check (a broad prefix holds a nested package.json; a glob reaches .github/).
  const config = { ...CONFIG, delivery: { docsOnly: ['docs/', '**/*.md'] } };
  for (const path of ['docs/package.json', '.github/ISSUE_TEMPLATE/bug.md', 'scripts/keel/notes.md']) {
    const a = await acme(t, { config });
    const tested = a.head();
    await a.commit(path, '{}\n');
    const r = await docsOnlySkip({ root: a.root, config, env: (await ghStub(t, actions([tested]))).env });
    assert.equal(r.skip, false, path);
    assert.match(r.reason, /protected/, path);
  }
  // Keel's managed files, read from the committed .keel/lock.json, are protected too.
  const m = await acme(t, { config });
  await mkdir(join(m.root, 'docs/templates'), { recursive: true });
  await writeFile(join(m.root, 'docs/templates/evidence.md'), 'Acme\n');
  await writeFile(join(m.root, '.keel/lock.json'), JSON.stringify({ practice: '0.0.0', files: { 'docs/templates/evidence.md': {}, 'AGENTS.md#night': {} } }));
  m.git('add', '-A'); m.git('commit', '-qm', 'Acme lock');
  const base = m.head();
  await m.commit('docs/templates/evidence.md', 'Acme changed\n');
  const managed = await docsOnlySkip({ root: m.root, config, env: (await ghStub(t, actions([base]))).env });
  assert.equal(managed.skip, false);
  assert.match(managed.reason, /docs\/templates\/evidence\.md.*protected/);
});
