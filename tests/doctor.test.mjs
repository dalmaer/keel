// keel doctor: drift is signal, the practice's own rules are linted, and
// nothing changes unless a fix is chosen and answered with --yes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { run } from './helpers/run.mjs';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, lstat, readlink, realpath, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineDiff, blockBody } from '../lib/doctor.mjs';
import { lessonsTableSplit } from '../practices/night/files/scripts/keel/lib.mjs';
import { sha256 } from '../lib/lock.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(KEEL, 'bin', 'keel.mjs');
const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Acme Builder', GIT_AUTHOR_EMAIL: 'builder@acme.test',
  GIT_COMMITTER_NAME: 'Acme Builder', GIT_COMMITTER_EMAIL: 'builder@acme.test',
  GIT_CONFIG_NOSYSTEM: '1',
};
const keel = (args, cwd) => {
  const r = run(process.execPath, [BIN, ...args], { cwd, env: ENV });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const doctor = (dir, ...args) => {
  const r = keel(['doctor', '--json', ...args], dir);
  return { code: r.code, data: JSON.parse(r.out), err: r.err };
};

/** One keel init'd project, made once and copied per test. */
let template;
async function project(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'keel-doctor-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  if (!template) {
    template = await realpath(await mkdtemp(join(tmpdir(), 'keel-doctor-template-')));
    process.on('exit', () => rmSync(template, { recursive: true, force: true }));
    const r = keel(['init', join(template, 'acme-notes'), '--description', 'Acme Notes keeps meeting notes as plain files.', '--kind', 'node'], template);
    assert.equal(r.code, 0, r.err);
  }
  await cp(join(template, 'acme-notes'), join(dir, 'acme-notes'), { recursive: true, verbatimSymlinks: true });
  return join(dir, 'acme-notes');
}

/** path → sha of bytes (or link target), every file and link outside .git. */
async function tree(root, dir = root, out = {}) {
  for (const d of await readdir(dir, { withFileTypes: true })) {
    if (d.name === '.git') continue;
    const path = join(dir, d.name), rel = relative(root, path);
    if (d.isSymbolicLink()) out[rel] = `-> ${await readlink(path)}`;
    else if (d.isDirectory()) await tree(root, path, out);
    else out[rel] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
  return out;
}

const rules = data => data.lint.map(l => `${l.rule} ${l.path}`).sort();

test('a fresh project is clean, has a lock, and doctor writes nothing', async t => {
  const dir = await project(t);
  const lock = JSON.parse(await readFile(join(dir, '.keel', 'lock.json'), 'utf8'));
  assert.ok(lock.files['CLAUDE.md'] && lock.files['AGENTS.md#conduct'] && lock.files['.claude/skills/conduct']);
  assert.equal(lock.files['AGENTS.md'], undefined, 'a seeded file is the project\'s, never locked');
  assert.equal(lock.files['CLAUDE.md'].sha256, sha256(await readFile(join(dir, 'CLAUDE.md'), 'utf8')));
  const before = await tree(dir);
  const { code, data } = doctor(dir);
  assert.equal(code, 0, JSON.stringify(data));
  assert.deepEqual(data, { drift: [], lint: [], notes: [], local: {}, qualifies: [], owing: [], ejected: [] });
  const text = keel(['doctor'], dir);
  assert.equal(text.code, 0);
  assert.match(text.out, /^Clean/m);
  assert.deepEqual(await tree(dir), before);
});

test('render writes the lock; render --check never does', async t => {
  const dir = await project(t);
  await rm(join(dir, '.keel', 'lock.json'));
  assert.equal(keel(['render', '--check'], dir).code, 0);
  await assert.rejects(lstat(join(dir, '.keel', 'lock.json')));
  assert.equal(keel(['render'], dir).code, 0);
  const once = await readFile(join(dir, '.keel', 'lock.json'), 'utf8');
  assert.equal(keel(['render'], dir).code, 0);
  assert.equal(await readFile(join(dir, '.keel', 'lock.json'), 'utf8'), once, 'a render that changes nothing leaves the lock as it was');
});

test('an edited managed file is drift with a diff, and doctor changes no byte', async t => {
  const dir = await project(t);
  const path = join(dir, 'docs', 'templates', 'evidence.md');
  await writeFile(path, `${await readFile(path, 'utf8')}\nAcme also records who ran the check.\n`);
  const before = await tree(dir);
  const { code, data } = doctor(dir);
  assert.equal(code, 1);
  assert.equal(data.drift.length, 1);
  const [d] = data.drift;
  assert.deepEqual([d.path, d.practice, d.state], ['docs/templates/evidence.md', 'evidence', 'edited']);
  assert.match(d.diff, /^\+Acme also records who ran the check\.$/m);
  assert.match(d.diff, /^--- keel /m);
  const text = keel(['doctor'], dir);
  assert.equal(text.code, 1);
  assert.match(text.out, /send it home with keel lessons \(phase 7\)/);
  assert.deepEqual(await tree(dir), before);
});

test('an edited block is drift for that block alone; the project\'s own lines are not', async t => {
  const dir = await project(t);
  const path = join(dir, 'AGENTS.md');
  const text = await readFile(path, 'utf8');
  await writeFile(path, `${text.replace('<!-- keel:end lessons -->', 'Acme reads the table first.\n<!-- keel:end lessons -->')}\nAcme's own closing note.\n`);
  const { code, data } = doctor(dir);
  assert.equal(code, 1);
  assert.deepEqual(data.drift.map(d => [d.path, d.state]), [['AGENTS.md#lessons', 'edited']]);
});

test('behind (keel moved on) is reported but is not a finding; both is', async t => {
  const dir = await project(t);
  const lockPath = join(dir, '.keel', 'lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  // Keel wrote older bytes, the project kept them: now = lock ≠ template.
  const old = 'Acme\'s copy of an older evidence template.\n';
  await writeFile(join(dir, 'docs', 'templates', 'evidence.md'), old);
  lock.files['docs/templates/evidence.md'].sha256 = sha256(old);
  // Keel wrote older bytes and the project changed them too: now ≠ lock ≠ template.
  await writeFile(join(dir, 'docs', 'templates', 'phase.md'), 'Acme rewrote this.\n');
  lock.files['docs/templates/phase.md'].sha256 = sha256('an older phase template\n');
  await writeFile(lockPath, JSON.stringify(lock));
  const { code, data } = doctor(dir);
  assert.equal(code, 1);
  assert.deepEqual(data.drift.map(d => [d.path, d.state]).sort(), [['docs/templates/evidence.md', 'behind'], ['docs/templates/phase.md', 'both']]);
  // Only behind: exit 0.
  await writeFile(join(dir, 'docs', 'templates', 'phase.md'), await readFile(join(KEEL, 'practices', 'phases', 'files', 'docs', 'templates', 'phase.md'), 'utf8'));
  assert.equal(doctor(dir).code, 0);
});

test('a copied skill outside .agents/skills is a second copy (lesson 1); the symlink is not', async t => {
  const dir = await project(t);
  await mkdir(join(dir, '.codex', 'skills', 'conduct'), { recursive: true });
  await cp(join(dir, '.agents', 'skills', 'conduct', 'SKILL.md'), join(dir, '.codex', 'skills', 'conduct', 'SKILL.md'));
  const { code, data } = doctor(dir);
  assert.equal(code, 1);
  assert.deepEqual(rules(data), ['second-copy .codex/skills/conduct/SKILL.md']);
  assert.deepEqual(data.drift, []);
});

test('a managed symlink replaced by a real directory is linted, and restore will not delete it', async t => {
  const dir = await project(t);
  const link = join(dir, '.claude', 'skills', 'conduct');
  await rm(link);
  await mkdir(link);
  await cp(join(dir, '.agents', 'skills', 'conduct', 'SKILL.md'), join(link, 'SKILL.md'));
  const { code, data } = doctor(dir);
  assert.equal(code, 1);
  assert.deepEqual(rules(data), ['second-copy .claude/skills/conduct/SKILL.md', 'symlink-replaced .claude/skills/conduct']);
  const fix = doctor(dir, '--fix', '.claude/skills/conduct', 'restore', '--yes');
  assert.equal(fix.code, 1);
  assert.match(fix.data.error, /move it aside/);
  assert.ok((await lstat(link)).isDirectory());
});

test('a CLAUDE.md that is more than a pointer is linted', async t => {
  const dir = await project(t);
  await writeFile(join(dir, 'CLAUDE.md'), 'Read AGENTS.md.\n\nAlso: run tests.\nAlso: be careful.\nAlso: Acme rules.\n');
  const { code, data } = doctor(dir);
  assert.equal(code, 1);
  assert.deepEqual(rules(data), ['claude-md-pointer CLAUDE.md']);
  assert.deepEqual(data.drift.map(d => [d.path, d.state]), [['CLAUDE.md', 'edited']]);
});

// The shape ledger's lessons.md had (rows 8 on rendered as raw text), with Acme's rows.
const SPLIT_LESSONS = [
  '# Lessons', '',
  '| # | The shape of it | What it cost | Guard |', '| --- | --- | --- | --- |',
  '| 1 | **Acme widgets drift.** | A day. | A test. |',
  '| 2 | **Acme sprockets stall.** | An hour. | A lint. |',
  '',
  '| 3 | **Acme gears slip.** | A week. | planned |',
  '| 4 | **Acme cogs jam.** | A day. | A test. |',
  '', '',
  '| 5 | **Acme belts fray.** | An hour. | A test. |',
  '',
  'Prose, then a second table is a table of its own:', '',
  '| Kind | Count |', '| --- | --- |', '| widgets | 2 |',
  '',
  '| Size | Count |', '| --- | --- |', '| large | 1 |',
  '', 'More prose.', '',
  '| 6 | **A numbered row after prose is not a split.** | — | — |',
  '',
].join('\n');

test('lessons-table-split: a blank line inside the lessons table is linted, naming its lines', async t => {
  const lint = lessonsTableSplit(SPLIT_LESSONS, 'docs/lessons.md');
  assert.deepEqual(lint.map(l => l.message.match(/\((lines? [\d–]+)\).*from line (\d+)/).slice(1)), [['line 7', '8'], ['lines 10–11', '12']]);
  assert.ok(lint.every(l => l.rule === 'lessons-table-split' && l.path === 'docs/lessons.md'));
  assert.deepEqual(lessonsTableSplit(SPLIT_LESSONS.replace('\n\n| 3 |', '\n| 3 |').replace('\n\n\n| 5 |', '\n| 5 |')), [], 'one table again: clean');
  assert.deepEqual(lessonsTableSplit(null), []);

  const dir = await project(t);
  assert.deepEqual(doctor(dir).data.lint, []);
  await writeFile(join(dir, 'docs', 'lessons.md'), SPLIT_LESSONS);
  const { code, data } = doctor(dir);
  assert.equal(code, 1);
  assert.deepEqual(rules(data), ['lessons-table-split docs/lessons.md', 'lessons-table-split docs/lessons.md']);
  assert.match(data.lint[0].message, /a blank line \(line 7\) splits the lessons table: the rows from line 8 on render as text/);
  // A configured lessons path is the one read.
  await mkdir(join(dir, 'notes'), { recursive: true });
  await writeFile(join(dir, 'notes', 'lessons.md'), SPLIT_LESSONS);
  await writeFile(join(dir, 'docs', 'lessons.md'), '# Lessons\n');
  const cfg = JSON.parse(await readFile(join(dir, '.keel', 'keel.json'), 'utf8'));
  await writeFile(join(dir, '.keel', 'keel.json'), JSON.stringify({ ...cfg, lessons: 'notes/lessons.md' }, null, 2));
  assert.deepEqual(rules(doctor(dir).data), ['lessons-table-split notes/lessons.md', 'lessons-table-split notes/lessons.md']);
});

test('a phase without Done when and a goal without a phase are linted', async t => {
  const dir = await project(t);
  const phase = join(dir, 'docs', 'phases', '00-practice-room.md');
  await writeFile(phase, (await readFile(phase, 'utf8')).replace(/## Done when\n[\s\S]*?(?=## Scope)/, ''));
  const goals = JSON.parse(await readFile(join(dir, 'docs', 'goals.json'), 'utf8'));
  goals.push({ id: 'G1', title: 'Acme search', outcome: 'Notes are found by who was there.' });
  await writeFile(join(dir, 'docs', 'goals.json'), JSON.stringify(goals));
  const { code, data } = doctor(dir);
  assert.equal(code, 1);
  assert.deepEqual(data.lint.map(l => l.rule).sort(), ['goal-without-phase', 'goal-without-phase', 'phase']);
  assert.match(data.lint.find(l => l.rule === 'phase').message, /Done when/);
});

test('a README older than the newest built phase is a readme-behind note, never a finding', async t => {
  const dir = await project(t);
  const git = (args, env = {}) => {
    const r = run('git', ['-C', dir, ...args], { env: { ...ENV, ...env } });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  // README last committed 2 Jan 2020; a phase built on 5 Jan 2020.
  await writeFile(join(dir, 'README.md'), '# Acme Notes\n\nAcme Notes keeps meeting notes.\n');
  git(['add', 'README.md']);
  git(['commit', '-q', '-m', 'Acme readme'], { GIT_AUTHOR_DATE: '2020-01-02T12:00:00Z', GIT_COMMITTER_DATE: '2020-01-02T12:00:00Z' });
  assert.equal(git(['log', '-1', '--format=%cs', '--', 'README.md']), '2020-01-02');
  const zero = await readFile(join(dir, 'docs', 'phases', '00-practice-room.md'), 'utf8');
  await writeFile(join(dir, 'docs', 'phases', '01-acme-search.md'), zero.replace(/^---\n[\s\S]*?\n---\n/, [
    '---', 'status: built', 'since: 2020-01-05', 'goal: G0', 'depends: [0]', 'note: "Acme search works."', 'evidence: ["evidence/2020-01-05-acme-search.md"]', '---', '',
  ].join('\n')).replaceAll('- [ ]', '- [x]'));
  const { code, data } = doctor(dir);
  assert.equal(code, 0, JSON.stringify(data));
  assert.deepEqual(data.lint, []);
  assert.deepEqual(data.notes.map(n => `${n.rule} ${n.path}`), ['readme-behind README.md']);
  assert.match(data.notes[0].message, /2020-01-02.*01-acme-search\.md.*2020-01-05/);
  const text = keel(['doctor'], dir);
  assert.equal(text.code, 0);
  assert.match(text.out, /Notes \(information; never changes the exit code\):\n {2}readme-behind/);

  // A README committed on or after that day: no note.
  await writeFile(join(dir, 'README.md'), '# Acme Notes\n\nAcme Notes keeps and finds meeting notes.\n');
  git(['commit', '-q', '-am', 'Acme readme, search'], { GIT_AUTHOR_DATE: '2020-01-05T12:00:00Z', GIT_COMMITTER_DATE: '2020-01-05T12:00:00Z' });
  assert.deepEqual(doctor(dir).data.notes, []);

  // Not a git repo: skipped silently.
  await writeFile(join(dir, 'README.md'), '# Acme Notes\n');
  git(['commit', '-q', '-am', 'Acme readme, short'], { GIT_AUTHOR_DATE: '2020-01-02T12:00:00Z', GIT_COMMITTER_DATE: '2020-01-02T12:00:00Z' });
  assert.equal(doctor(dir).data.notes.length, 1);
  await rm(join(dir, '.git'), { recursive: true, force: true });
  const bare = doctor(dir);
  assert.equal(bare.code, 0);
  assert.deepEqual(bare.data.notes, []);
});

test('--fix eject asks first, then hands the file to the project for good', async t => {
  const dir = await project(t);
  const path = join(dir, 'docs', 'templates', 'evidence.md');
  const ours = 'Acme\'s own evidence template.\n';
  await writeFile(path, ours);
  const before = await tree(dir);
  const ask = doctor(dir, '--fix', 'docs/templates/evidence.md', 'eject');
  assert.equal(ask.code, 3);
  assert.deepEqual([ask.data.ok, ask.data.needs, ask.data.plan.action], [false, 'yes', 'eject']);
  assert.deepEqual(await tree(dir), before, 'without --yes nothing changes');

  const yes = doctor(dir, '--fix', 'docs/templates/evidence.md', 'eject', '--yes');
  assert.equal(yes.code, 0, yes.err);
  const config = JSON.parse(await readFile(join(dir, '.keel', 'keel.json'), 'utf8'));
  assert.deepEqual(config.ejected, ['docs/templates/evidence.md']);
  const lock = JSON.parse(await readFile(join(dir, '.keel', 'lock.json'), 'utf8'));
  assert.equal(lock.files['docs/templates/evidence.md'], undefined);
  assert.equal(keel(['render'], dir).code, 0);
  assert.equal(keel(['render', '--check'], dir).code, 0);
  assert.equal(await readFile(path, 'utf8'), ours, 'render left the ejected file alone');
  const after = doctor(dir);
  assert.equal(after.code, 0);
  assert.deepEqual(after.data.ejected, ['docs/templates/evidence.md']);
});

test('--fix restore --yes puts keel\'s bytes back, for a file and for a block', async t => {
  const dir = await project(t);
  const clean = await tree(dir);
  await writeFile(join(dir, '.agents', 'skills', 'conduct', 'SKILL.md'), 'Acme trimmed the conductor.\n');
  const agents = join(dir, 'AGENTS.md');
  await writeFile(agents, (await readFile(agents, 'utf8')).replace('<!-- keel:end phases -->', 'Acme extra.\n<!-- keel:end phases -->'));
  assert.equal(doctor(dir, '--fix', '.agents/skills/conduct/SKILL.md', 'restore').code, 3);
  assert.equal(doctor(dir, '--fix', '.agents/skills/conduct/SKILL.md', 'restore', '--yes').code, 0);
  const r = doctor(dir, '--fix', 'AGENTS.md#phases', 'restore', '--yes');
  assert.equal(r.code, 0);
  assert.deepEqual(r.data.drift, []);
  assert.deepEqual(await tree(dir), clean);
  assert.equal(doctor(dir).code, 0);
});

test('a bad --fix is a usage error, and a seeded file cannot be fixed', async t => {
  const dir = await project(t);
  assert.equal(keel(['doctor', '--fix', 'CLAUDE.md'], dir).code, 2);
  assert.equal(keel(['doctor', '--fix', 'CLAUDE.md', 'revert'], dir).code, 2);
  assert.equal(keel(['doctor', '--yes'], dir).code, 2);
  assert.equal(doctor(dir, '--fix', 'AGENTS.md', 'restore', '--yes').code, 2);
});

test('local variants are information; one adopt would now switch on is named', async t => {
  const dir = await project(t);
  const path = join(dir, '.keel', 'keel.json');
  const config = JSON.parse(await readFile(path, 'utf8'));
  config.practices = config.practices.filter(p => p !== 'ci');
  config.local = { ci: 'Acme had its own workflow when adopted' };
  await writeFile(path, JSON.stringify(config, null, 2));
  const { code, data } = doctor(dir);
  assert.equal(code, 0, JSON.stringify(data));
  assert.deepEqual(data.local, config.local);
  assert.deepEqual(data.qualifies, ['ci']);
  assert.match(keel(['doctor'], dir).out, /Would now be on if adopted again: ci/);
});

test('keel itself is clean under its own doctor', () => {
  const r = keel(['doctor', '--json'], KEEL);
  assert.equal(r.code, 0, r.out);
});

test('lineDiff shows keel\'s lines as - and the project\'s as +, with context', () => {
  const a = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n';
  const b = 'one\ntwo\nthree\nFOUR\nfive\nsix\nseven\neight\n';
  assert.equal(lineDiff(a, b), '--- keel\n+++ project\n@@ -1,7 +1,7 @@\n one\n two\n three\n-four\n+FOUR\n five\n six\n seven\n');
  assert.equal(lineDiff(a, a), '');
  assert.match(lineDiff('x\n', ''), /^-x$/m);
  assert.equal(blockBody('a\n<!-- keel:begin z -->\nin\n<!-- keel:end z -->\n', 'z'), 'in\n');
  assert.equal(blockBody('no markers', 'z'), null);
});

test('render refuses to overwrite an edited managed file or block, and writes nothing', async t => {
  const dir = await project(t);
  const roadmap = join(dir, 'scripts', 'roadmap.mjs');
  await writeFile(roadmap, `${await readFile(roadmap, 'utf8')}// Acme's own line\n`);
  const agents = join(dir, 'AGENTS.md');
  await writeFile(agents, (await readFile(agents, 'utf8')).replace('<!-- keel:end evidence -->', 'Acme extra.\n<!-- keel:end evidence -->'));
  const before = await tree(dir);
  const r = keel(['render'], dir);
  assert.equal(r.code, 1);
  assert.match(r.err, /refusing to overwrite.*scripts\/roadmap\.mjs edited.*AGENTS\.md#evidence edited.*keel doctor --fix <path> restore\|eject/);
  assert.deepEqual(await tree(dir), before, 'render wrote nothing');
  const check = keel(['render', '--check', '--json'], dir);
  assert.equal(check.code, 1);
  assert.deepEqual(JSON.parse(check.out).changed.sort(), ['AGENTS.md#evidence', 'scripts/roadmap.mjs']);
  // Once restored, render runs again.
  assert.equal(doctor(dir, '--fix', 'scripts/roadmap.mjs', 'restore', '--yes').code, 0);
  assert.equal(doctor(dir, '--fix', 'AGENTS.md#evidence', 'restore', '--yes').code, 0);
  assert.equal(keel(['render'], dir).code, 0);
});

test('a behind file (keel moved on, the project did not touch it) still renders', async t => {
  const dir = await project(t);
  const path = join(dir, 'docs', 'templates', 'evidence.md');
  const old = 'Acme\'s copy of an older evidence template.\n';
  await writeFile(path, old);
  const lockPath = join(dir, '.keel', 'lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  lock.files['docs/templates/evidence.md'].sha256 = sha256(old);
  await writeFile(lockPath, JSON.stringify(lock));
  assert.equal(keel(['render'], dir).code, 0);
  assert.equal(await readFile(path, 'utf8'), await readFile(join(KEEL, 'practices', 'evidence', 'files', 'docs', 'templates', 'evidence.md'), 'utf8'));
  assert.equal(doctor(dir).code, 0);
});

test('adopt run again on a project with an ejected file keeps its practice on', async t => {
  const dir = await project(t);
  await writeFile(join(dir, 'docs', 'templates', 'evidence.md'), 'Acme\'s own evidence template.\n');
  assert.equal(doctor(dir, '--fix', 'docs/templates/evidence.md', 'eject', '--yes').code, 0);
  const r = keel(['adopt', dir, '--json'], dir);
  assert.equal(r.code, 0, r.out);
  const data = JSON.parse(r.out);
  assert.equal(data.practices.find(p => p.name === 'evidence').state, 'on');
  assert.ok(!data.files.some(f => f.path === 'docs/templates/evidence.md'));
  assert.ok(data.config.practices.includes('evidence'));
  assert.deepEqual(data.config.ejected, ['docs/templates/evidence.md']);
  assert.equal(await readFile(join(dir, 'docs', 'templates', 'evidence.md'), 'utf8'), 'Acme\'s own evidence template.\n');
});

test('doctor shows setup and env as information, and lints a bad one', async t => {
  const dir = await project(t);
  const path = join(dir, '.keel', 'keel.json');
  const cfg = JSON.parse(await readFile(path, 'utf8'));
  let d = doctor(dir);
  assert.equal(d.data.gate, undefined);
  assert.doesNotMatch(keel(['doctor'], dir).out, /The gate \(information\)/);
  await writeFile(path, `${JSON.stringify({ ...cfg, setup: 'npm ci --prefix web', env: { ACME_SYNC: '0' } }, null, 2)}\n`);
  d = doctor(dir);
  assert.equal(d.code, 0, JSON.stringify(d.data.lint));
  assert.deepEqual(d.data.gate, { check: cfg.check ?? 'npm run check', setup: 'npm ci --prefix web', env: { ACME_SYNC: '0' } });
  const text = keel(['doctor'], dir).out;
  assert.match(text, /setup: npm ci --prefix web/);
  assert.match(text, /env: {3}ACME_SYNC=0/);
  await writeFile(path, `${JSON.stringify({ ...cfg, setup: '', env: { 'acme-sync': 0 } }, null, 2)}\n`);
  d = doctor(dir);
  assert.equal(d.code, 1);
  assert.equal(d.data.lint.filter(l => l.rule === 'gate-config').length, 3);
});
