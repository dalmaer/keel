// The loop practice (phase 14): Stitch Loop's findings triaged the same way
// everywhere. The stitch CLI is stubbed at the process boundary
// (tests/fixtures/loop/stitch.mjs, via KEEL_STITCH), answering in the JSON
// envelope both source scripts parse; the script under test is the practice's
// own file, run as a project would run it. Fixtures are synthetic (Acme).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile, realpath, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './helpers/run.mjs';
import { load, render } from '../lib/practices.mjs';
import { survey, adopt } from '../lib/adopt.mjs';
import { diagnose } from '../lib/doctor.mjs';
import { plan, isData } from '../lib/night.mjs';
import { parseFinding, serializeFinding, parseYaml, stringifyYaml, findingProblems, reconcile, normalizeInsight, LOOP_DOC_HEADER } from '../practices/loop/files/scripts/loop.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRACTICE = join(KEEL, 'practices', 'loop', 'files');
const FIXTURES = join(KEEL, 'tests', 'fixtures', 'loop');
const STUB = join(FIXTURES, 'stitch.mjs');
const VERSION = { cli: '0.0.0', commit: null, practice: '0.0.0' };
const WIDGET = 'widget-cache-ignores-expiry', SPROCKET = 'sprocket-api-lacks-rate-limit';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const insight = (over = {}) => ({
  id: 'cccccccc-3333-4000-8000-000000000004', title: 'Gear loader drops errors', description: 'Errors from the gear loader are swallowed.',
  state: 'ACTIVE', priority: 'P2', severity: 'S1', confidence: 80, priorities: ['workspaces/acme-0000-workspace/goals/G-acme-1'],
  references: { a: { source: { uri: 'https://github.com/acme/widgets/blob/HEAD/lib/gear.mjs#L4-L9' } }, b: { note: { content: 'not a file' } } },
  ...over,
});
const BASE_STATE = {
  insights: [
    insight(),
    insight({ id: 'aaaaaaaa-1111-4000-8000-000000000001', title: 'Widget cache ignores expiry', priority: 'P1', severity: 'S1', state: 'ACTIVE' }),
    insight({ id: 'bbbbbbbb-2222-4000-8000-000000000002', title: 'Sprocket API lacks "rate limit"', priority: 'P1', severity: null, state: 'ACTIVE' }),
    insight({ id: 'bbbbbbbb-2222-4000-8000-000000000009', title: 'Sprocket API lacks "rate limit"', priority: 'P1', severity: null, state: 'ACTIVE' }),
  ],
  priorities: [{ id: 'G-acme-1', description: 'Widgets hold their shape' }, { id: 'G-acme-2', description: 'Sprockets are fast' }],
  contexts: [],
};

/** A copy of the Acme project with the practice's script and test installed, and a stub state. */
async function project(t, state = BASE_STATE) {
  await chmod(STUB, 0o755);
  const dir = join(await realpath(await mkdtemp(join(tmpdir(), 'keel-loop-'))), 'acme');
  t.after(() => rm(dirname(dir), { recursive: true, force: true }));
  await cp(join(FIXTURES, 'acme'), dir, { recursive: true });
  await mkdir(join(dir, 'scripts'), { recursive: true });
  await mkdir(join(dir, 'tests'), { recursive: true });
  await cp(join(PRACTICE, 'scripts', 'loop.mjs'), join(dir, 'scripts', 'loop.mjs'));
  await cp(join(PRACTICE, 'tests', 'loop.test.mjs'), join(dir, 'tests', 'loop.test.mjs'));
  const stateFile = join(dirname(dir), 'state.json'), log = join(dirname(dir), 'calls.jsonl');
  await writeFile(stateFile, JSON.stringify(state));
  await writeFile(log, '');
  const env = { ...process.env, KEEL_STITCH: STUB, STITCH_STUB_STATE: stateFile, STITCH_STUB_LOG: log };
  delete env.LOOP_WORKSPACE;
  const loop = (...args) => run(process.execPath, [join(dir, 'scripts', 'loop.mjs'), ...args], { cwd: dir, env });
  const calls = async () => (await readFile(log, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l));
  const finding = async slug => readFile(join(dir, 'docs', 'loop', `${slug}.md`), 'utf8');
  const setState = s => writeFile(stateFile, JSON.stringify(s));
  return { dir, loop, calls, finding, setState, env };
}

const WRITES = /^(dismiss|create|delete|generate|edit|update)$/;
const sent = calls => calls.filter(c => WRITES.test(c.args[0]));

test('the practice is optional: keel init leaves it off, its files and secrets are declared', async () => {
  const practices = await load();
  const p = practices.get('loop');
  assert.equal(p.optional, true);
  assert.deepEqual(p.files.map(f => `${f.kind} ${f.path}`).sort(), [
    'block AGENTS.md', 'managed .github/workflows/keel-loop.yml', 'managed scripts/loop.mjs', 'managed tests/loop.test.mjs', 'seeded .stitch.json', 'seeded docs/loop/README.md',
  ]);
  assert.deepEqual(p.secrets.map(s => s.name).sort(), ['KEEL_TOKEN', 'LOOP_API_KEY', 'STITCH_INSTALLER_URL']);
  assert.equal(JSON.parse(p.files.find(f => f.path === '.stitch.json').template).workspace, '');
  const init = await readFile(join(KEEL, 'lib', 'init.mjs'), 'utf8');
  assert.match(init, /filter\(n => !practices\.get\(n\)\.optional\)/);
});

test('adopt: a project with its own loop script keeps it — loop is local, with the convergence proposal, and its findings are untouched', async t => {
  const { dir } = await project(t);
  await rm(join(dir, 'scripts', 'loop.mjs'));
  await rm(join(dir, '.keel'), { recursive: true });
  await writeFile(join(dir, 'scripts', 'loop.ts'), '// Acme\'s own Loop triage.\n');
  await writeFile(join(dir, 'AGENTS.md'), '# Acme\n');
  const loopDir = join(dir, 'docs', 'loop');
  const before = Object.fromEntries(await Promise.all((await readdir(loopDir)).map(async n => [n, await readFile(join(loopDir, n), 'utf8')])));
  const { data } = await adopt({ dir }, { version: VERSION });
  const row = data.practices.find(p => p.name === 'loop');
  assert.equal(row.state, 'local', JSON.stringify(row));
  assert.match(row.why, /its own scripts\/loop\.ts; proposal: render docs\/LOOP\.md with keel's scripts\/loop\.mjs/);
  assert.match(data.config.local.loop, /retire yours for keel's/);
  assert.ok(!data.config.practices.includes('loop'));
  const after = Object.fromEntries(await Promise.all((await readdir(loopDir)).map(async n => [n, await readFile(join(loopDir, n), 'utf8')])));
  assert.deepEqual(after, before, 'adopt touched docs/loop/');
  assert.ok(!existsSync(join(dir, 'scripts', 'loop.mjs')), 'nothing is installed beside the project\'s own script');
  assert.ok(!existsSync(join(dir, 'docs', 'LOOP.md')));
  assert.doesNotMatch(await readFile(join(dir, 'AGENTS.md'), 'utf8'), /keel:begin loop/);
});

test('adopt: on with a .stitch.json and no script of its own; off with neither', async t => {
  const practices = await load();
  const { dir } = await project(t);
  await rm(join(dir, 'scripts', 'loop.mjs'));
  await rm(join(dir, '.keel'), { recursive: true });
  await writeFile(join(dir, 'AGENTS.md'), '# Acme\n');
  let s = await survey(dir, { version: VERSION, practices });
  assert.equal(s.practices.find(p => p.name === 'loop').state, 'on');
  await rm(join(dir, '.stitch.json'));
  s = await survey(dir, { version: VERSION, practices });
  const row = s.practices.find(p => p.name === 'loop');
  assert.equal(row.state, 'off');
  assert.match(row.why, /no \.stitch\.json/);
});

test('pull files new insights as untriaged, through stitch find only, and a re-filing never overwrites our fields', async t => {
  const { dir, loop, calls, finding } = await project(t);
  const widgetBefore = parseFinding(await finding(WIDGET), WIDGET);
  const r = loop('pull');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /new \(1\): gear-loader-drops-errors/);
  assert.match(r.stdout, /re-filed by Loop under a new id \(1\): sprocket-api-lacks-rate-limit/);
  assert.match(r.stdout, /2 declined id\(s\) still active in Loop — a person runs: node scripts\/loop\.mjs push --yes/);

  const gear = parseFinding(await finding('gear-loader-drops-errors'), 'gear-loader-drops-errors');
  assert.equal(gear.decision, 'untriaged');
  assert.deepEqual(gear.loop, ['cccccccc-3333-4000-8000-000000000004']);
  assert.equal(gear.loop_rank, 'P2/S1');
  assert.equal(gear.loop_goal, 'G-acme-1');
  assert.match(gear.body, /^- `lib\/gear\.mjs#L4-L9`$/m);
  assert.match(gear.body, /## Our read\n\nNot yet checked against the code\.$/);

  const widget = parseFinding(await finding(WIDGET), WIDGET);
  assert.equal(widget.loop_rank, 'P1/S1', 'what Loop says is refreshed');
  for (const k of ['decision', 'rank', 'phase', 'lesson', 'since', 'note', 'body', 'title']) assert.deepEqual(widget[k], widgetBefore[k], `${k} was overwritten`);
  const sprocket = parseFinding(await finding(SPROCKET), SPROCKET);
  assert.equal(sprocket.decision, 'declined');
  assert.deepEqual(sprocket.loop, ['bbbbbbbb-2222-4000-8000-000000000002', 'bbbbbbbb-2222-4000-8000-000000000003', 'bbbbbbbb-2222-4000-8000-000000000009']);

  const log = await calls();
  assert.deepEqual(sent(log), [], 'a pull sends nothing');
  for (const c of log) {
    assert.equal(c.args[0], 'find');
    assert.deepEqual(c.args.slice(-3), ['--format', 'json', '-q']);
    assert.equal(c.args[c.args.indexOf('-w') + 1], 'acme-0000-workspace');
    assert.equal(c.includeDismissed, '1');
  }
  assert.equal(log.length, 1, 'one fetch per pull');
  assert.ok((await readFile(join(dir, 'docs', 'LOOP.md'), 'utf8')).startsWith(LOOP_DOC_HEADER));

  const snapshot = async () => Object.fromEntries(await Promise.all((await readdir(join(dir, 'docs', 'loop'))).map(async n => [n, await readFile(join(dir, 'docs', 'loop', n), 'utf8')])));
  const once = await snapshot();
  assert.equal(loop('pull').status, 0);
  assert.deepEqual(await snapshot(), once, 'a second pull of the same insights changes nothing');
  assert.equal(loop('render', '--check').status, 0, 'untriaged findings are not broken ones');
});

test('propose needs a read that cites file:line; it never decides, and never reaches Loop', async t => {
  const { loop, calls, finding } = await project(t);
  assert.equal(loop('pull').status, 0);
  const slug = 'gear-loader-drops-errors';
  const before = await finding(slug);
  let r = loop('propose', slug, '--rank', 'next', '--phase', '1', '--note', 'Real; small.');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--read must say what the code shows, citing file:line/);
  r = loop('propose', slug, '--rank', 'next', '--phase', '1', '--note', 'Real; small.', '--read', 'Looks true from the description.');
  assert.equal(r.status, 1);
  assert.equal(await finding(slug), before, 'a refused proposal writes nothing');
  r = loop('propose', slug, '--rank', 'next', '--phase', '1', '--note', 'Real; small.', '--read', '**Holds.** lib/gear.mjs:7 catches and drops the error.');
  assert.equal(r.status, 0, r.stderr);
  const f = parseFinding(await finding(slug), slug);
  assert.equal(f.decision, 'proposed');
  assert.equal(f.since, today());
  assert.match(f.body, /## Our read\n\n\*\*Holds\.\*\* lib\/gear\.mjs:7/);
  r = loop('propose', SPROCKET, '--rank', 'now', '--note', 'Reopen.', '--read', 'lib/sprocket.mjs:3 still serves one user.');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /already declined — that was a decision/);
  r = loop('propose', slug, '--rank', 'soon', '--note', 'x', '--read', 'lib/gear.mjs:7');
  assert.equal(r.status, 2, 'a bad rank is usage');
  assert.equal((await calls()).length, 1, 'only the pull reached stitch');
});

test('decide is the only verb that changes a decision, and it sends nothing without a person\'s --yes', async t => {
  const { loop, calls, finding } = await project(t);
  const before = await finding(WIDGET);
  let r = loop('decide', WIDGET, 'declined', '--note', 'Not worth it for Acme.');
  assert.equal(r.status, 3);
  assert.match(r.stderr, /needs --yes/);
  assert.match(r.stderr, /--no-push/);
  assert.equal(await finding(WIDGET), before, 'exit 3 wrote nothing');
  assert.deepEqual(await calls(), []);

  r = loop('decide', WIDGET, 'accepted', '--no-push');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(parseFinding(await finding(WIDGET), WIDGET).decision, 'accepted');
  assert.deepEqual(await calls(), [], '--no-push records it and sends nothing');

  r = loop('decide', WIDGET, 'declined', '--note', 'Not worth it for Acme.', '--yes');
  assert.equal(r.status, 0, r.stderr);
  const out = sent(await calls());
  assert.deepEqual(out.map(c => c.args[0]), ['dismiss', 'create']);
  const payload = JSON.parse(out[0].args[out[0].args.indexOf('--json') + 1]);
  assert.deepEqual(payload.ids.sort(), ['aaaaaaaa-1111-4000-8000-000000000001', 'bbbbbbbb-2222-4000-8000-000000000002']);
  assert.equal(payload.workspace, 'acme-0000-workspace');
  assert.ok(!out[0].args.includes('--format'), 'dismiss takes its ids as a JSON payload, never --format (stitch v0.10)');
  const body = JSON.parse(out[1].args[out[1].args.indexOf('--json') + 1]).body;
  assert.equal(body.dataSource, 'acme:docs/loop');
  const data = JSON.parse(body.data);
  assert.equal(data.kind, 'acme-triage-decisions');
  assert.deepEqual(data.decisions.map(d => [d.title, d.decision]), [['Widget cache ignores expiry', 'declined'], ['Sprocket API lacks "rate limit"', 'declined']], 'by decision, then our rank');
  assert.equal(r.status, 0);
});

test('push and mine are outward: exit 3 with the plan until --yes; --dry-run sends nothing', async t => {
  const { loop, calls, setState } = await project(t);
  let r = loop('push');
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stdout, /would dismiss 1 Loop insight\(s\)/);
  assert.match(r.stdout, /would create the Loop context "acme:docs\/loop"/);
  assert.deepEqual(sent(await calls()), []);
  r = loop('push', '--dry-run');
  assert.equal(r.status, 0);
  assert.deepEqual(sent(await calls()), []);
  r = loop('push', '--yes');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(sent(await calls()).map(c => c.args.slice(0, 2).join(' ')), ['dismiss --json', 'create context']);

  // Loop already holds this exact context: nothing to replace.
  const create = sent(await calls())[1].args;
  const data = JSON.parse(JSON.parse(create[create.indexOf('--json') + 1]).body.data);
  await setState({ ...BASE_STATE, insights: BASE_STATE.insights.map(i => ({ ...i, state: i.id.startsWith('bbbbbbbb') ? 'DISMISSED' : i.state })), contexts: [{ id: 'ctx-1', dataSource: 'acme:docs/loop', data: JSON.stringify(data) }] });
  const n = sent(await calls()).length;
  r = loop('push');
  assert.equal(r.status, 0, 'nothing owed is not a ⚑');
  assert.match(r.stdout, /already current/);
  assert.equal(sent(await calls()).length, n);

  r = loop('mine');
  assert.equal(r.status, 3);
  assert.match(r.stderr, /would ask Loop to re-mine 2 priorities: G-acme-1, G-acme-2/);
  assert.equal(sent(await calls()).length, n);
  r = loop('mine', 'G-acme-2', '--yes');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(sent(await calls()).slice(n).map(c => c.args), [['generate', 'insights', '-w', 'acme-0000-workspace', '--priority', 'G-acme-2', '--format', 'json', '-q']]);
});

test('render --check fails on a stale docs/LOOP.md and on a proposal with no read of the code', async t => {
  const { dir, loop, finding } = await project(t);
  let r = loop('render', '--check');
  assert.equal(r.status, 1, 'findings with no page are stale');
  await rm(join(dir, 'docs', 'loop'), { recursive: true });
  assert.equal(loop('render', '--check').status, 0, 'nothing pulled yet is current');
  await cp(join(FIXTURES, 'acme', 'docs', 'loop'), join(dir, 'docs', 'loop'), { recursive: true });
  r = loop('render', '--check');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /docs\/LOOP\.md is out of date — run: node scripts\/loop\.mjs render/);
  assert.equal(loop('render').status, 0);
  assert.equal(loop('render', '--check').status, 0);
  await writeFile(join(dir, 'docs', 'LOOP.md'), (await readFile(join(dir, 'docs', 'LOOP.md'), 'utf8')).replace('1 to decide', '2 to decide'));
  assert.equal(loop('render', '--check').status, 1, 'a hand edit is stale');
  assert.equal(loop('render').status, 0);

  const text = (await finding(WIDGET)).replace(/## Our read[\s\S]*$/, '## Our read\n\nNot yet checked against the code.\n');
  await writeFile(join(dir, 'docs', 'loop', `${WIDGET}.md`), text);
  assert.equal(loop('render').status, 0);
  r = loop('render', '--check');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /widget-cache-ignores-expiry\.md: not yet read — prove the claim against the code/);

  // The project's own gate runs the same check through the managed test.
  const gate = run(process.execPath, ['--test', 'tests/loop.test.mjs'], { cwd: dir });
  assert.notEqual(gate.status, 0, 'the managed test fails the gate on a broken finding');
  await cp(join(FIXTURES, 'acme', 'docs', 'loop', `${WIDGET}.md`), join(dir, 'docs', 'loop', `${WIDGET}.md`));
  assert.equal(loop('render').status, 0);
  const green = run(process.execPath, ['--test', 'tests/loop.test.mjs'], { cwd: dir });
  assert.equal(green.status, 0, green.stdout + green.stderr);
});

test('stitch output past 64KB is read whole (a file, not a pipe), and its errors are surfaced', async t => {
  const many = Array.from({ length: 400 }, (_, i) => insight({ id: `dddddddd-${String(i).padStart(4, '0')}-4000-8000-000000000000`, title: `Acme gadget ${i} is slow`, description: 'x'.repeat(400) }));
  const { dir, loop, setState } = await project(t, { ...BASE_STATE, insights: many });
  let r = loop('pull');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /new \(400\)/);
  assert.equal((await readdir(join(dir, 'docs', 'loop'))).length, 402);
  await setState({ error: { code: 'PERMISSION_DENIED', message: 'Loop is not enabled for this workspace' } });
  r = loop('pull');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /stitch find insights: Loop is not enabled for this workspace/);
  r = run(process.execPath, [join(dir, 'scripts', 'loop.mjs'), 'pull'], { cwd: dir, env: { ...process.env, KEEL_STITCH: join(dir, 'no-such-stitch') } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /is not installed/);
  await writeFile(join(dir, '.stitch.json'), '{ "workspace": "" }\n');
  r = loop('pull');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /No Loop workspace/);
});

test('findings read and write as ledger\'s YAML does; the comma form of loop reads as a list', async () => {
  const canonical = await readFile(join(FIXTURES, 'acme', 'docs', 'loop', `${WIDGET}.md`), 'utf8');
  assert.equal(serializeFinding(parseFinding(canonical, WIDGET)), canonical);
  const sprocket = parseFinding(await readFile(join(FIXTURES, 'acme', 'docs', 'loop', `${SPROCKET}.md`), 'utf8'), SPROCKET);
  assert.equal(sprocket.title, 'Sprocket API lacks "rate limit"');
  assert.deepEqual(sprocket.loop, ['bbbbbbbb-2222-4000-8000-000000000002', 'bbbbbbbb-2222-4000-8000-000000000003']);
  assert.match(serializeFinding(sprocket), /^title: Sprocket API lacks "rate limit"\nloop:\n {2}- bbbbbbbb/m);
  for (const s of ['plain words', 'a: colon', '42', 'true', '- dash', '#hash', "it's", 'say "hi"', 'both \' and "', 'trailing:', 'two\nlines', '— dash']) {
    assert.equal(parseYaml(stringifyYaml({ note: s })).note, s, JSON.stringify(s));
  }
  assert.equal(stringifyYaml({ note: '42' }), 'note: "42"\n', 'a string that reads as a number is quoted');
  assert.deepEqual(findingProblems({ ...sprocket, body: '# x' }), ['not yet read — prove the claim against the code before proposing or deciding']);
  const i = normalizeInsight(insight({ priority: undefined, severity: undefined }));
  assert.equal(i.rank, 'unranked');
  assert.deepEqual(reconcile([], [i, { ...i, id: 'other' }]).findings[0].loop, [i.id, 'other']);
});

test('keel-loop.yml reads Loop and files findings, and nothing else; it skips with a notice until its secrets exist', async () => {
  const yml = await readFile(join(PRACTICE, '.github', 'workflows', 'keel-loop.yml'), 'utf8');
  const code = yml.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(code, /loop\.mjs (decide|push|mine|propose)\b/, 'a pull that could decide would dismiss insights for the whole workspace');
  assert.match(code, /node scripts\/loop\.mjs pull/);
  assert.match(code, /stitch enable loop \|\| stitch yolo --enable loop[\s\S]*scripts\/loop\.mjs pull/);
  assert.match(code, /::notice::Skipped: add the LOOP_API_KEY and STITCH_INSTALLER_URL secrets/);
  assert.match(code, /STITCH_API_KEY: \$\{\{ secrets\.LOOP_API_KEY \}\}/);
  assert.match(code, /STITCH_BASE_URL: https:\/\/jules\.googleapis\.com\/v2alpha/);
  assert.match(code, /curl -fsSL "\$STITCH_INSTALLER_URL" -o/);
  assert.match(code, /render --check && \{\{check\}\}/, 'the gate is render --check, then the project\'s own');
  assert.match(code, /drain keel-loop\/ --yes --gate-passed/);
  assert.doesNotMatch(code, /anthropic|claude -p/i, 'no model proposes here');
  for (const dir of [PRACTICE, join(KEEL, 'practices', 'loop')]) {
    for (const n of await readdir(dir, { recursive: true })) {
      const p = join(dir, n);
      if (/\.(md|ya?ml|mjs|json)$/.test(n)) assert.doesNotMatch(await readFile(p, 'utf8'), /firebasestorage\.googleapis\.com[^\s"']*token=/, `${n}: the installer URL is a secret`);
    }
  }
});

test('drain: a keel-loop/ queue\'s data is the findings and their page, and nothing else', () => {
  for (const p of ['docs/loop/acme.md', 'docs/LOOP.md']) assert.ok(isData(p, 'keel-loop/'), p);
  for (const p of ['docs/health/2026-10-02.md', 'scripts/loop.mjs', 'docs/LOOP.md.bak', 'docs/loopy.md']) assert.ok(!isData(p, 'keel-loop/'), p);
  assert.ok(isData('docs/health/2026-10-02.md', 'keel-night/'));
  assert.ok(!isData('docs/loop/acme.md', 'keel-night/'));
  const pr = (number, files, at) => ({ number, headRefName: `keel-loop/2026-10-0${number}`, createdAt: `2026-10-0${at}T09:43:00Z`, mergeable: 'MERGEABLE', isCrossRepository: false, files: files.map(path => ({ path })) });
  const p = plan([pr(1, ['docs/loop/a.md', 'docs/LOOP.md'], 1), pr(2, ['docs/loop/a.md', 'scripts/loop.mjs'], 2), pr(3, ['docs/loop/b.md'], 3)], 'keel-loop/', { gatePassed: true });
  assert.deepEqual(p.actions.map(a => [a.number, a.action]), [[1, 'merge'], [2, 'close'], [3, 'merge']]);
});

test('doctor: loop on with no workspace, or a gate that never runs the loop check, is linted', async t => {
  const dir = join(await realpath(await mkdtemp(join(tmpdir(), 'keel-loop-doctor-'))), 'acme');
  t.after(() => rm(dirname(dir), { recursive: true, force: true }));
  await mkdir(join(dir, '.keel'), { recursive: true });
  await writeFile(join(dir, '.keel', 'keel.json'), JSON.stringify({ name: 'Acme', tagline: 'Widgets.', practice: '0.0.0', practices: ['base', 'agents-md', 'loop'] }));
  await writeFile(join(dir, 'AGENTS.md'), '# Acme\n\n<!-- keel:begin agents-md -->\n<!-- keel:end agents-md -->\n\n<!-- keel:begin loop -->\n<!-- keel:end loop -->\n');
  await render(dir);
  let r = await diagnose(dir, { version: '0.0.0' });
  assert.deepEqual(r.lint.map(l => l.rule), ['loop-workspace'], 'the base gate (npm test → node --test tests/*.test.mjs) runs tests/loop.test.mjs');
  await writeFile(join(dir, '.stitch.json'), '{ "workspace": "acme-0000-workspace" }\n');
  await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test test/unit.test.mjs', check: 'npm test' } }));
  r = await diagnose(dir, { version: '0.0.0' });
  assert.deepEqual(r.lint.map(l => l.rule), ['loop-gate']);
  assert.match(r.lint[0].message, /never runs tests\/loop\.test\.mjs or `node scripts\/loop\.mjs render --check`/);
  await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { check: 'npm run unit && npm run loop -- render --check', unit: 'node --test test/', loop: 'node scripts/loop.mjs' } }));
  r = await diagnose(dir, { version: '0.0.0' });
  assert.deepEqual(r.lint, []);
});
