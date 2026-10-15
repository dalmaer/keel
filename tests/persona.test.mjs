// Personas (phase 75): goals a project sets itself, measured by its own
// commands. The parser refuses what it cannot read, naming it; a run marks
// each goal met, missed or broken (never zero), writes the review page and
// nothing else, and refuses when a persona file changed while it ran; a missed
// goal becomes a candidate plan item naming its number. Every fixture is Acme's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { run as runNode } from './helpers/run.mjs';
import { parsePersona, run, planCandidates, personaMeasures, parseArgs, readPersonas } from '../practices/personas/files/scripts/keel/persona.mjs';
import { measure } from '../practices/night/files/scripts/keel/improve.mjs';

const BIN = resolve('bin/keel.mjs');
const EXAMPLE = resolve('practices/personas/files/.agents/personas/performance.md');
const DATE = '2026-10-14';
const FILE = '.agents/personas/speed.md';

const persona = (goals, more = '') => `---
name: speed
description: Whether Acme stays quick.
${more}goal:
${goals}
---

The lens, in prose.
`;
const goal = (name, bound, command, extra = '') => `  - name: ${name}\n    ${bound}\n    measured by: ${command}\n${extra}`;

async function project(t, files = {}) {
  const root = await mkdtemp(join(tmpdir(), 'keel-persona-acme-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.keel'), { recursive: true });
  await mkdir(join(root, '.agents/personas'), { recursive: true });
  await writeFile(join(root, '.keel/keel.json'), JSON.stringify({ name: 'Acme', practices: ['night', 'personas'] }));
  for (const [path, text] of Object.entries(files)) await writeFile(join(root, path), text);
  return root;
}

/** Every file under root with its bytes, so "wrote nothing else" is a comparison. */
async function tree(root, dir = '') {
  const out = {};
  for (const e of await readdir(join(root, dir), { withFileTypes: true })) {
    const path = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) Object.assign(out, await tree(root, path));
    else out[path] = await readFile(join(root, path), 'utf8');
  }
  return out;
}

test('a persona file parses into goals: bound, unit, direction, command and baseline; the body is kept', () => {
  const p = parsePersona(FILE, persona([
    goal('entry bundle size', 'at most: 250000', 'node scripts/measure.mjs bundle-bytes', '    baseline: 231000, 2026-10-01, 6bb8994\n'),
    goal('cache hit rate', 'at least: 90%', "echo 'a: b' | wc -l"),
    goal('interaction latency', 'at most: 100ms', '"sh scripts/latency.sh"'),
  ].join(''), 'model: opus\ntools: Read, Bash\n# a comment line\n'));
  assert.equal(p.name, 'speed');
  assert.equal(p.description, 'Whether Acme stays quick.');
  assert.match(p.body, /The lens, in prose\./);
  assert.deepEqual(p.goals, [
    { id: 'entry-bundle-size', name: 'entry bundle size', kind: 'at most', bound: 250000, unit: '', better: 'lower', measuredBy: 'node scripts/measure.mjs bundle-bytes', baseline: { value: 231000, date: '2026-10-01', commit: '6bb8994' } },
    { id: 'cache-hit-rate', name: 'cache hit rate', kind: 'at least', bound: 90, unit: '%', better: 'higher', measuredBy: "echo 'a: b' | wc -l", baseline: null },
    { id: 'interaction-latency', name: 'interaction latency', kind: 'at most', bound: 100, unit: 'ms', better: 'lower', measuredBy: 'sh scripts/latency.sh', baseline: null },
  ]);
});

test('an unknown key, a goal with no command and a bound that is not a number are refused, naming each', () => {
  const ok = goal('size', 'at most: 10', 'echo 1');
  const refused = (text, pattern) => assert.throws(() => parsePersona(FILE, text), pattern);
  refused(persona(ok, 'trigger: nightly\n'), /speed\.md: unknown key "trigger" \(the night runs personas/);
  refused(persona(ok, 'colour: orange\n'), /speed\.md: unknown key "colour"$/);
  refused(persona(`${ok}    against: node scripts/ceiling.mjs\n`), /speed\.md: goal 1: unknown key "against"/);
  refused(persona(`${ok}    measured  by: echo 2\n`), /goal 1: unknown key "measured  by"/);
  refused(persona('  - name: size\n    at most: 10\n'), /speed\.md: goal 1 \("size"\): no command \(measured by:\)/);
  refused(persona('  - name: size\n    at most: 10\n    measured by:\n'), /goal 1 \("size"\): no command/);
  refused(persona(goal('size', 'at most: fast', 'echo 1')), /goal 1 \("size"\): at most: "fast" is not a number/);
  refused(persona(goal('size', 'at least: 1,000', 'echo 1')), /goal 1 \("size"\): at least: "1,000" is not a number/);
  refused(persona(goal('size', 'at most: about 5', 'echo 1')), /at most: "about 5" is not a number/);
  refused(persona('  - name: size\n    measured by: echo 1\n'), /goal 1 \("size"\): no bound \(at most: or at least:\)/);
  refused(persona(goal('size', 'at most: 1\n    at least: 0', 'echo 1')), /both at most: and at least:/);
  refused(persona(`${ok}    baseline: yesterday\n`), /baseline: "yesterday" is not "<number>, <YYYY-MM-DD>\[, <commit>\]"/);
  refused(persona(`${ok}${goal('Size!', 'at most: 2', 'echo 2')}`), /goals "size" and "Size!" share the measure id size/);
  refused(persona('  - at most: 10\n    measured by: echo 1\n'), /goal 1: no name/);
  refused(persona(''), /no goal: a persona measures at least one number/);
  refused(persona(ok).replace('name: speed', 'name: sped'), /name "sped" is not the file's name \(speed\)/);
  refused('no front matter\n', /speed\.md: missing front matter/);
  assert.throws(() => parsePersona('.agents/personas/Speed Test.md', persona(ok)), /lowercase letters, digits and dashes/);
});

test('keel persona run measures each goal, marks met, missed or broken, writes the review page, and writes nothing else', async t => {
  const root = await project(t, { [FILE]: persona([
    goal('bundle bytes', 'at most: 10', 'echo 7', '    baseline: 9, 2026-10-01\n'),
    goal('cold start', 'at most: 100ms', 'echo 140'),
    goal('cache hits', 'at least: 90%', 'echo 95'),
    goal('test count', 'at least: 50', 'echo 12'),
    goal('failing command', 'at most: 0', "echo 'no build here' >&2; exit 3"),
    goal('two numbers', 'at most: 5', 'echo 1 2'),
    goal('prose and a number', 'at most: 5', "echo 'size: 4'"),
    goal('nothing printed', 'at most: 5', 'true'),
    goal('too slow', 'at most: 5', 'sleep 5; echo 1'),
  ].join('')) });
  const before = await tree(root);
  const r = await run({ root, all: true, date: DATE, timeout: 1500 });
  const [p] = r.data.personas;
  assert.deepEqual(p.goals.map(g => [g.id, g.state, g.value]), [
    ['bundle-bytes', 'met', 7], ['cold-start', 'missed', 140], ['cache-hits', 'met', 95], ['test-count', 'missed', 12],
    ['failing-command', 'broken', null], ['two-numbers', 'broken', null], ['prose-and-a-number', 'broken', null],
    ['nothing-printed', 'broken', null], ['too-slow', 'broken', null],
  ]);
  const detail = Object.fromEntries(p.goals.filter(g => g.detail).map(g => [g.id, g.detail]));
  assert.equal(detail['failing-command'], 'exit 3: no build here');
  assert.equal(detail['two-numbers'], 'printed "1 2", not one number');
  assert.equal(detail['nothing-printed'], 'printed nothing, not one number');
  assert.equal(detail['too-slow'], 'timed out after 2 s');
  assert.deepEqual([r.data.met, r.data.missed, r.data.broken], [2, 2, 5]);
  assert.equal(r.exitCode, 2, 'a broken instrument outranks a missed number, as in keel improve');
  assert.equal(p.page, `docs/reviews/${DATE}-speed.md`);
  const after = await tree(root);
  const page = after[p.page];
  delete after[p.page];
  assert.deepEqual(after, before, 'the run wrote the review page and nothing else');
  assert.match(page, /^# speed — 2026-10-14\n/);
  assert.match(page, /\| bundle bytes \| at most 10 \| 7 \(was 9 on 2026-10-01\) \| met \|/);
  assert.match(page, /\| cold start \| at most 100ms \| 140ms \| \*\*missed\*\* \|/);
  assert.match(page, /\| failing command \| at most 0 \| — \| \*\*broken\*\* \|/);
  assert.match(page, /- failing command: `echo 'no build here' >&2; exit 3` — exit 3: no build here/);
  assert.match(page, /- build: cold start: back to at most 100ms \(measured 140ms\) \(`persona:speed:cold-start`\)/);
  assert.match(page, /- review: too slow: its command is broken/);
});

test('exit 1 when a goal is missed and none broken, 0 when every goal is met; one persona by name', async t => {
  const other = persona(goal('size', 'at most: 10', 'echo 1')).replace('name: speed', 'name: other');
  const root = await project(t, {
    [FILE]: persona(goal('size', 'at most: 10', 'echo 11')),
    '.agents/personas/other.md': other,
  });
  const missed = await run({ root, name: 'speed', date: DATE });
  assert.equal(missed.exitCode, 1);
  assert.deepEqual(missed.data.personas.map(p => p.name), ['speed']);
  assert.deepEqual(await readdir(join(root, 'docs/reviews')), [`${DATE}-speed.md`]);
  const met = await run({ root, name: 'other', date: DATE });
  assert.equal(met.exitCode, 0);
  assert.match(await readFile(join(root, `docs/reviews/${DATE}-other.md`), 'utf8'), /Nothing: every goal is met\./);
  await assert.rejects(run({ root, name: 'nobody', date: DATE }), e => e.exitCode === 2 && /no persona "nobody"; there is other, speed/.test(e.message));
  await assert.rejects(run({ root, date: DATE }), e => e.exitCode === 2 && /name one persona or --all/.test(e.message));
  assert.deepEqual(parseArgs(['run', '--all']), { name: undefined, all: true });
  assert.throws(() => parseArgs(['run', '--fast']), /unexpected argument: --fast/);
});

test('a review page that is a symlink or a hard link to a file outside the project is refused (exit 1), and the target is untouched', async t => {
  const outside = await mkdtemp(join(tmpdir(), 'keel-persona-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const target = join(outside, 'acme-precious.txt');
  await writeFile(target, 'Acme anvils ledger\n');
  const other = persona(goal('size', 'at most: 10', 'echo 1')).replace('name: speed', 'name: other');
  const root = await project(t, { [FILE]: persona(goal('size', 'at most: 10', 'echo 1')), '.agents/personas/other.md': other });
  await mkdir(join(root, 'docs/reviews'), { recursive: true });
  // other's page sorts first and is a plain new file: a refusal of speed's page must still write neither.
  await symlink(target, join(root, `docs/reviews/${DATE}-speed.md`));
  const before = await tree(root);
  await assert.rejects(run({ root, all: true, date: DATE }), e => e.exitCode === 1
    && /refused: docs\/reviews\/2026-10-14-speed\.md is not a regular file \(a symlink\); a run never writes through a link/.test(e.message));
  assert.equal(await readFile(target, 'utf8'), 'Acme anvils ledger\n', 'the linked target is byte-identical');
  assert.deepEqual(await tree(root), before, 'no other file changed: not even the other persona\'s page');
  // A hard link shares the outside file's bytes: truncating it would truncate them too.
  await rm(join(root, `docs/reviews/${DATE}-speed.md`));
  await link(target, join(root, `docs/reviews/${DATE}-speed.md`));
  await assert.rejects(run({ root, name: 'speed', date: DATE }), e => e.exitCode === 1 && /2026-10-14-speed\.md is not a regular file \(2 links\)/.test(e.message));
  assert.equal(await readFile(target, 'utf8'), 'Acme anvils ledger\n');
  // docs/ itself a link out of the project: refused before anything is made there.
  const elsewhere = await project(t, { [FILE]: persona(goal('size', 'at most: 10', 'echo 1')) });
  await symlink(outside, join(elsewhere, 'docs'));
  await assert.rejects(run({ root: elsewhere, all: true, date: DATE }), e => e.exitCode === 1 && /refused: docs is a symlink/.test(e.message));
  assert.deepEqual(await readdir(outside), ['acme-precious.txt'], 'nothing made outside the project');
});

test('a persona file that changes during the run is refused, and no review page is written', async t => {
  const root = await project(t, { [FILE]: persona(goal('size', 'at most: 10', "echo '# lowered' >> .agents/personas/speed.md; echo 1")) });
  await assert.rejects(run({ root, all: true, date: DATE }), e => e.exitCode === 1
    && /refused: \.agents\/personas\/speed\.md changed during the run.*no review page was written/.test(e.message));
  assert.ok(!(await readdir(root)).includes('docs'), 'nothing written');
  // Another persona's file counts too: the run compares every persona file's bytes.
  const second = await project(t, {
    [FILE]: persona(goal('size', 'at most: 10', 'rm .agents/personas/other.md; echo 1')),
    '.agents/personas/other.md': persona(goal('size', 'at most: 10', 'echo 1')).replace('name: speed', 'name: other'),
  });
  await assert.rejects(run({ root: second, name: 'speed', date: DATE }), /\.agents\/personas\/other\.md changed during the run/);
});

test('a missed goal is a candidate build item naming its number; a broken one a review item; a met one nothing', async t => {
  const root = await project(t, { [FILE]: persona([
    goal('entry bundle size', 'at most: 250000', 'echo 260000'),
    goal('cache hits', 'at least: 90%', 'echo 80'),
    goal('latency', 'at most: 100ms', 'exit 1'),
    goal('met one', 'at most: 1', 'echo 0'),
  ].join('')) });
  const r = await run({ root, all: true, date: DATE });
  const items = planCandidates(r.data.personas[0]);
  assert.deepEqual(items, [
    { id: 'persona-speed-entry-bundle-size', source: 'persona:speed', title: 'entry bundle size: back to at most 250000 (measured 260000)', kind: 'build',
      number: { measure: 'persona:speed:entry-bundle-size', bound: 250000, better: 'lower' }, lane: null, status: 'planned' },
    { id: 'persona-speed-cache-hits', source: 'persona:speed', title: 'cache hits: back to at least 90% (measured 80%)', kind: 'build',
      number: { measure: 'persona:speed:cache-hits', bound: 90, better: 'higher' }, lane: null, status: 'planned' },
    { id: 'persona-speed-latency', source: 'persona:speed', title: 'latency: its command is broken (`exit 1`: exit 1)', kind: 'review', number: null, lane: null, status: 'planned' },
  ]);
  assert.deepEqual(r.data.personas[0].candidates, items, 'the run reports its candidates');
  assert.ok(items.every(i => i.kind !== 'build' || i.number), 'a build item names its number first');
});

test("persona goals are measures the night's measure() takes, bounded by the persona file, never by .keel/bounds.json", async t => {
  const root = await project(t, { [FILE]: persona([
    goal('size', 'at most: 10', 'echo 4'),
    goal('hits', 'at least: 90', 'echo 80'),
    goal('broken', 'at most: 1', 'exit 2'),
  ].join('')) });
  const measures = await personaMeasures(root);
  assert.deepEqual(measures.map(m => [m.id, m.better, m.ratchet]), [
    ['persona:speed:size', 'lower', false], ['persona:speed:hits', 'higher', false], ['persona:speed:broken', 'lower', false]]);
  const results = await measure({ root, config: { name: 'Acme' }, date: DATE, measures, bounds: { 'persona:speed:size': 1 } });
  assert.deepEqual(results.map(r => [r.id, r.state, r.value, r.bound]), [
    ['persona:speed:size', 'ok', 4, 10], ['persona:speed:hits', 'outside', 80, 90], ['persona:speed:broken', 'broken', null, null]]);
});

test('a goal command runs in the project root with the gate environment: NODE_TEST_* stripped, .keel/keel.json env merged', async t => {
  const root = await project(t, { [FILE]: persona([
    goal('acme env', 'at most: 10', 'echo $ACME_N'),
    goal('test context', 'at most: 0', 'echo ${#NODE_TEST_CONTEXT}'),
    goal('cwd', 'at most: 1', 'test -f .keel/keel.json && echo 1'),
  ].join('')) });
  await writeFile(join(root, '.keel/keel.json'), JSON.stringify({ name: 'Acme', env: { ACME_N: '7' } }));
  const r = await run({ root, all: true, date: DATE, env: { ...process.env, NODE_TEST_CONTEXT: 'child' } });
  assert.deepEqual(r.data.personas[0].goals.map(g => [g.id, g.value]), [['acme-env', 7], ['test-context', 0], ['cwd', 1]]);
});

test("the shipped example parses, and its placeholder commands read broken, never met", async t => {
  const root = await project(t, { '.agents/personas/performance.md': await readFile(EXAMPLE, 'utf8') });
  const [{ persona: p }] = await readPersonas(root);
  assert.deepEqual(p.goals.map(g => [g.name, g.kind, g.bound, g.unit]), [['entry bundle size', 'at most', 250000, ''], ['interaction latency', 'at most', 100, 'ms']]);
  const r = await run({ root, all: true, date: DATE });
  assert.deepEqual(r.data.personas[0].goals.map(g => g.state), ['broken', 'broken']);
  assert.match(r.data.personas[0].goals[0].detail, /replace this with a command printing the entry bundle size in bytes/);
});

test('the keel persona run verb: JSON, the exit code, and usage errors exit 2', async t => {
  const root = await project(t, { [FILE]: persona(goal('size', 'at most: 10', 'echo 12')) });
  const r = runNode(process.execPath, [BIN, 'persona', 'run', '--all', '--json'], { cwd: root });
  assert.equal(r.status, 1, r.stderr);
  const data = JSON.parse(r.stdout);
  assert.equal(data.missed, 1);
  assert.equal(data.personas[0].candidates[0].number.measure, 'persona:speed:size');
  assert.match(await readFile(join(root, data.personas[0].page), 'utf8'), /Measured by `keel persona run`/);
  const bad = runNode(process.execPath, [BIN, 'persona', 'run', '--json'], { cwd: root });
  assert.equal(bad.status, 2);
  assert.match(JSON.parse(bad.stdout).error, /name one persona or --all/);
  const noVerb = runNode(process.execPath, [BIN, 'persona'], { cwd: root });
  assert.equal(noVerb.status, 2);
  assert.match(noVerb.stderr, /keel persona needs one of: run/);
});
