// keel doctor: drift is signal, the practice's own rules are linted, and
// nothing changes unless a fix is chosen and answered with --yes.
// Git the same on every machine, also when this file is run alone without npm test's --import (the phase's Proof).
import './helpers/hermetic.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { run } from './helpers/run.mjs';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, lstat, readlink, realpath, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineDiff, blockBody, lessonsTableShapes, runsTest, globRegex } from '../lib/doctor.mjs';
import { lessonsTableSplit, setupEnvProblems, platformCalls, platformLints } from '../practices/night/files/scripts/keel/lib.mjs';
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

test('a change keel has since made too is behind, not both: render takes keel\'s; anything more stays both', async t => {
  // Renovate bumped an action in the project's keel-night.yml before keel shipped the same bump.
  const dir = await project(t);
  const path = '.github/workflows/keel-night.yml';
  const now = await readFile(join(dir, path), 'utf8'); // keel's template today
  assert.match(now, /@v7/);
  const old = now.replaceAll('@v7', '@v5').replace('\n', '\n# a line keel has since dropped\n'); // what keel wrote
  const edited = old.replaceAll('@v5', '@v7'); // the project's Renovate, on keel's old file
  assert.notEqual(edited, now);
  const previous = join(dir, '..', 'previous');
  await mkdir(join(previous, 'practices/night/files/.github/workflows'), { recursive: true });
  await writeFile(join(previous, 'practices/night/files', path), old);
  const lockPath = join(dir, '.keel', 'lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  lock.files[path].sha256 = sha256(old);
  await writeFile(lockPath, JSON.stringify(lock));
  await writeFile(join(dir, path), edited);
  const env = { ...ENV, KEEL_PREVIOUS_PRACTICES: previous };
  const run1 = args => run(process.execPath, [BIN, ...args], { cwd: dir, env });
  const d = run1(['doctor', '--json']);
  assert.equal(d.status, 0, d.stdout + d.stderr);
  assert.deepEqual(JSON.parse(d.stdout).drift.map(x => [x.path, x.state]), [[path, 'behind']]);
  // Without the template keel wrote, keel cannot tell: both, never guessed.
  assert.deepEqual(doctor(dir).data.drift.map(x => [x.path, x.state]), [[path, 'both']]);
  // A stand-in that is not what the lock says keel wrote is not used.
  const wrong = join(dir, '..', 'wrong');
  await mkdir(join(wrong, 'practices/night/files/.github/workflows'), { recursive: true });
  await writeFile(join(wrong, 'practices/night/files', path), old + '# a line no keel ever shipped\n'); // would merge cleanly to keel's today
  const w = run(process.execPath, [BIN, 'doctor', '--json'], { cwd: dir, env: { ...ENV, KEEL_PREVIOUS_PRACTICES: wrong } });
  assert.deepEqual(JSON.parse(w.stdout).drift.map(x => [x.path, x.state]), [[path, 'both']]);
  // The file exactly as keel shipped it at the lock's version is keel's, whatever hash the lock holds.
  await writeFile(join(dir, path), old);
  lock.files[path].sha256 = sha256('a hash from some other day\n');
  await writeFile(lockPath, JSON.stringify(lock));
  assert.deepEqual(JSON.parse(run1(['doctor', '--json']).stdout).drift.map(x => [x.path, x.state]), [[path, 'behind']]);
  lock.files[path].sha256 = sha256(old);
  await writeFile(lockPath, JSON.stringify(lock));
  await writeFile(join(dir, path), edited);
  // One more edit of the project's own is still its change.
  await writeFile(join(dir, path), edited + '# acme runs this by hand on Fridays\n');
  assert.deepEqual(JSON.parse(run1(['doctor', '--json']).stdout).drift.map(x => [x.path, x.state]), [[path, 'both']]);
  assert.equal(run1(['render']).status, 1, 'render refuses the project\'s own edit');
  // Back to the bump alone: render takes keel's.
  await writeFile(join(dir, path), edited);
  const r = run1(['render']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(await readFile(join(dir, path), 'utf8'), now);
});

test('a managed file new in this practice version (absent, never locked) is behind, for update to create; a locked one removed is still the project\'s change', async t => {
  const dir = await project(t);
  const lockPath = join(dir, '.keel', 'lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  const path = 'scripts/keel/drain.mjs';
  assert.ok(lock.files[path], 'the fixture locks it');
  // As if keel's next release added it: not on disk, not in the lock.
  await rm(join(dir, path));
  delete lock.files[path];
  await writeFile(lockPath, JSON.stringify(lock));
  let r = doctor(dir);
  assert.equal(r.code, 0, `a new file is not a finding: ${JSON.stringify(r.data.drift)}`);
  assert.deepEqual(r.data.drift.filter(d => d.path === path).map(d => [d.state, d.missing]), [['behind', true]]);
  // The same file removed while the lock knows it: the project's change, a finding.
  lock.files[path] = { practice: 'night', sha256: 'f'.repeat(64) };
  await writeFile(lockPath, JSON.stringify(lock));
  r = doctor(dir);
  assert.equal(r.code, 1);
  assert.notEqual(r.data.drift.find(d => d.path === path).state, 'behind');
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

// The three other ways a lessons table ends early (phase 29), each as a
// synthetic Acme table: prose between rows, a row stranded under a later
// heading, and a second header row starting a second table.
const SHAPED_LESSONS = [
  '# Lessons', '',                                                    // 1–2
  '| # | Shape | Cost | Guard |', '| --- | --- | --- | --- |',         // 3–4
  '| 1 | **Acme widgets drift.** | A day. | A test. |',                // 5
  '| 2 | **Acme sprockets stall.** | An hour. | A lint. |',           // 6
  '',                                                                 // 7
  '**A note on row 2:** Acme found the stall again a week later.',    // 8
  '',                                                                 // 9
  '| 3 | **Acme gears slip.** | A week. | planned |',                 // 10
  '| 4 | **Acme cogs jam.** | A day. | A test. |',                    // 11
  '',                                                                 // 12
  '## Habits', '',                                                    // 13–14
  '- **Look before you leap.** Acme leapt.',                          // 15
  '| 5 | **Acme belts fray.** | An hour. | A test. |',                // 16
  '',                                                                 // 17
  '| # | Shape | Cost | Guard |', '| --- | --- | --- | --- |',         // 18–19
  '| 6 | **Acme bolts shear.** | A week. | A test. |',                // 20
  '',
].join('\n');

test('lessons-table-split: prose between rows, a stranded row and a second header are each a finding naming its line', async t => {
  const lint = lessonsTableShapes(SHAPED_LESSONS, 'docs/lessons.md');
  assert.equal(lint.length, 3, JSON.stringify(lint));
  assert.ok(lint.every(l => l.rule === 'lessons-table-split' && l.path === 'docs/lessons.md'));
  assert.match(lint[0].message, /^prose between numbered rows \(line 8\) ends the lessons table at line 6: the rows from line 10 on/);
  assert.match(lint[1].message, /^a numbered row \(line 16\) is stranded after the lessons table ended at line 6/);
  assert.match(lint[2].message, /^a second header row \(line 18\) starts a second table/);
  assert.deepEqual(lessonsTableSplit(SHAPED_LESSONS), [], 'none of the three is a blank-line split: the night\'s lint saw nothing');
  const whole = SHAPED_LESSONS.split('\n').filter((l, i) => ![6, 7, 8, 11, 12, 13, 14, 16, 17, 18].includes(i)).join('\n');
  assert.deepEqual(lessonsTableShapes(whole), [], 'one table again: clean');
  assert.deepEqual(lessonsTableShapes(SPLIT_LESSONS), [], 'a blank-line split is the night\'s finding, not a second one; rows after another table are left alone');
  assert.deepEqual(lessonsTableShapes(null), []);
  assert.deepEqual(lessonsTableShapes('# Lessons\n\nNone yet.\n'), []);

  const dir = await project(t);
  await writeFile(join(dir, 'docs', 'lessons.md'), SHAPED_LESSONS);
  const { code, data } = doctor(dir);
  assert.equal(code, 1);
  assert.deepEqual(rules(data), ['lessons-table-split docs/lessons.md', 'lessons-table-split docs/lessons.md', 'lessons-table-split docs/lessons.md']);
  assert.deepEqual(data.lint.map(l => /\(line (\d+)\)/.exec(l.message)[1]), ['8', '16', '18']);
});

test('health-ignored: a health dir the project git-ignores is a finding, naming the fix; a configured one that is not, is clean', async t => {
  const dir = await project(t);
  const cfgPath = join(dir, '.keel', 'keel.json');
  const cfg = JSON.parse(await readFile(cfgPath, 'utf8'));
  assert.ok(cfg.practices.includes('night'), 'the night is on in a fresh project');
  const setCfg = over => writeFile(cfgPath, `${JSON.stringify({ ...cfg, ...over }, null, 2)}\n`);
  assert.ok(!doctor(dir).data.lint.some(l => l.rule.startsWith('health')), 'nothing ignored: clean');
  await writeFile(join(dir, '.gitignore'), '/docs/health/\n');
  const r = doctor(dir);
  assert.equal(r.code, 1, 'a finding, not information: the night silently loses its page');
  const lint = r.data.lint.filter(l => l.rule === 'health-ignored');
  assert.deepEqual(lint.map(l => l.path), ['docs/health']);
  assert.match(lint[0].message, /git-ignored.*set "health" in \.keel\/keel\.json to a directory that is not ignored/);
  const text = keel(['doctor'], dir);
  assert.match(text.out + text.err, /health-ignored/);
  await setCfg({ health: '.keel/health' });
  assert.ok(!doctor(dir).data.lint.some(l => l.rule.startsWith('health')), 'a configured dir that is not ignored is clean');
  await setCfg({ health: '.keel/health/' });
  assert.ok(!doctor(dir).data.lint.some(l => l.rule.startsWith('health')), 'a trailing slash is the same dir');
  for (const bad of ['../acme', '/acme/health', 'docs/./health', '.git/health', 7]) {
    await setCfg({ health: bad });
    const b = doctor(dir);
    assert.equal(b.code, 1, String(bad));
    assert.deepEqual(b.data.lint.filter(l => l.rule.startsWith('health')).map(l => l.rule), ['health-config'], String(bad));
  }
  // Without the night and without a setting, an ignored docs/health is none of keel's business.
  await setCfg({ practices: cfg.practices.filter(p => p !== 'night') });
  assert.ok(!doctor(dir).data.lint.some(l => l.rule.startsWith('health')));
});

test('shipped-test-unrun: a test keel ships that the gate\'s node --test never matches is a finding; a glob or a directory that matches it is not', async t => {
  const dir = await project(t);
  assert.ok(!rules(doctor(dir).data).some(r => r.startsWith('shipped-test-unrun')), 'keel init\'s own script runs them');
  const pkgPath = join(dir, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  const setTest = async script => writeFile(pkgPath, `${JSON.stringify({ ...pkg, scripts: { ...pkg.scripts, test: script } }, null, 2)}\n`);
  // Acme's own glob names .js files and the roadmap test alone (the shape a review found on a real project).
  await setTest('node --test --test-reporter=spec --test-reporter-destination=stdout tests/*.test.js tests/roadmap.test.mjs');
  const found = doctor(dir).data.lint.filter(l => l.rule === 'shipped-test-unrun');
  assert.deepEqual(found.map(l => l.path), ['tests/keel-generated.test.mjs', 'tests/keel-workflows.test.mjs'], 'phases\' test and ci\'s, not the roadmap test it names');
  assert.match(found[0].message, /keel ships tests\/keel-generated\.test\.mjs, and the gate .* never runs it.*migration 0005/);
  for (const ok of ['node --test', 'node --test tests/', 'node --test "tests/**/*.test.{js,mjs}"', 'node --import ./tests/helpers/acme.mjs --test tests/*.test.mjs']) {
    await setTest(ok);
    assert.ok(!rules(doctor(dir).data).some(r => r.startsWith('shipped-test-unrun')), ok);
  }
  await setTest('vitest run');
  assert.ok(!rules(doctor(dir).data).some(r => r.startsWith('shipped-test-unrun')), 'another runner: keel cannot tell, so it does not say');
  assert.equal(runsTest('node --test tests/*.test.js tests/roadmap.test.mjs', 'tests/keel-generated.test.mjs'), false);
  assert.equal(runsTest('node --import ./tests/helpers/acme.mjs --test', 'tests/keel-generated.test.mjs'), true, 'a flag\'s value is not a path: this names none, so node\'s default runs it');
  assert.equal(runsTest('npm run unit', 'tests/a.test.mjs'), null);
  assert.ok(globRegex('tests/**/*.test.mjs').test('tests/a.test.mjs') && globRegex('tests/**/*.test.mjs').test('tests/x/a.test.mjs'));
  assert.ok(!globRegex('tests/*.test.js').test('tests/a.test.mjs'));
});

test('a phase without Done when and a goal without a phase are linted', async t => {
  const dir = await project(t);
  const phase = join(dir, 'docs', 'phases', '00-first-thing-that-runs.md');
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
  const zero = await readFile(join(dir, 'docs', 'phases', '00-first-thing-that-runs.md'), 'utf8');
  await writeFile(join(dir, 'docs', 'phases', '01-acme-search.md'), zero.replace(/^---\n[\s\S]*?\n---\n/, [
    '---', 'status: built', 'since: 2020-01-05', 'goal: G0', 'depends: [0]', 'note: "Acme search works."', 'evidence: ["evidence/2020-01-05-acme-search.md"]', '---', '',
  ].join('\n')).replaceAll('- [ ]', '- [x]'));
  const { code, data } = doctor(dir);
  assert.equal(code, 0, JSON.stringify(data));
  assert.deepEqual(data.lint, []);
  const behind = d => d.notes.filter(n => n.rule === 'readme-behind');
  assert.deepEqual(behind(data).map(n => `${n.rule} ${n.path}`), ['readme-behind README.md']);
  assert.match(behind(data)[0].message, /2020-01-02.*01-acme-search\.md.*2020-01-05/);
  const text = keel(['doctor'], dir);
  assert.equal(text.code, 0);
  assert.match(text.out, /Notes \(information; never changes the exit code\):\n {2}readme-behind/);

  // A README committed on or after that day: no note.
  await writeFile(join(dir, 'README.md'), '# Acme Notes\n\nAcme Notes keeps and finds meeting notes.\n');
  git(['commit', '-q', '-am', 'Acme readme, search'], { GIT_AUTHOR_DATE: '2020-01-05T12:00:00Z', GIT_COMMITTER_DATE: '2020-01-05T12:00:00Z' });
  assert.deepEqual(behind(doctor(dir).data), []);

  // Not a git repo: skipped silently.
  await writeFile(join(dir, 'README.md'), '# Acme Notes\n');
  git(['commit', '-q', '-am', 'Acme readme, short'], { GIT_AUTHOR_DATE: '2020-01-02T12:00:00Z', GIT_COMMITTER_DATE: '2020-01-02T12:00:00Z' });
  assert.equal(behind(doctor(dir).data).length, 1);
  await rm(join(dir, '.git'), { recursive: true, force: true });
  const bare = doctor(dir);
  assert.equal(bare.code, 0);
  assert.deepEqual(behind(bare.data), []);
});

test('acceptance-unchecked: an old built phase whose boxes name no check is a note, never a finding, and no file changes', async t => {
  const dir = await project(t);
  const zero = await readFile(join(dir, 'docs', 'phases', '00-first-thing-that-runs.md'), 'utf8');
  const built = (status, extra = '') => zero.replace(/^---\n[\s\S]*?\n---\n/, [
    '---', `status: ${status}`, 'since: 2020-01-05', 'goal: G0', ...(extra ? [extra] : []), 'depends: [0]', 'note: "Acme search works."', 'evidence: ["evidence/2020-01-05-acme-search.md"]', '---', '',
  ].join('\n')).replaceAll('- [ ]', '- [x]').replace('# First thing that runs', '# Acme search');
  await mkdir(join(dir, 'docs', 'evidence'), { recursive: true });
  await writeFile(join(dir, 'docs', 'evidence', '2020-01-05-acme-search.md'), '# Acme search\n\nChecked by hand.\n');
  await writeFile(join(dir, 'docs', 'phases', '01-acme-search.md'), built('built'));
  const before = await tree(dir);
  const { code, data } = doctor(dir);
  assert.equal(code, 0, JSON.stringify(data.lint));
  const unchecked = data.notes.filter(n => n.rule === 'acceptance-unchecked');
  assert.deepEqual(unchecked.map(n => n.path), ['docs/phases/01-acme-search.md']);
  assert.match(unchecked[0].message, /^1 of 2 acceptance boxes name no check/);
  assert.match(keel(['doctor'], dir).out, /Notes \(information; never changes the exit code\):[\s\S]*acceptance-unchecked +docs\/phases\/01-acme-search\.md/);
  assert.deepEqual(await tree(dir), before, 'doctor rewrote nothing');

  // Unfinished, it is not yet owed; with spec: 2, the same box is the check's failure, so a finding.
  await writeFile(join(dir, 'docs', 'phases', '01-acme-search.md'), built('partial').replace('- [x] `npm run check`', '- [ ] `npm run check`'));
  assert.deepEqual(doctor(dir).data.notes.filter(n => n.rule === 'acceptance-unchecked'), []);
  await writeFile(join(dir, 'docs', 'phases', '01-acme-search.md'), built('partial', 'spec: 2').replace('- [x] `npm run check`', '- [ ] `npm run check`').replace('## Proof', '## Real surfaces\n\nnone\n\n## Proof'));
  const strict = doctor(dir);
  assert.equal(strict.code, 1);
  assert.deepEqual(rules(strict.data), ['phase docs/phases/01-acme-search.md']);
  assert.match(strict.data.lint[0].message, /## Acceptance: ".*" names no check/);
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

test('setupToken names a repo secret: checked, and doctor shows the name', async t => {
  assert.deepEqual(setupEnvProblems({ setup: 'npm ci', setupToken: 'ACME_DATA_TOKEN' }), []);
  assert.deepEqual(setupEnvProblems({ setup: 'npm ci' }), []);
  for (const [why, setupToken, setup] of [
    ['lower case', 'acme_data_token', 'npm ci'],
    ['a value, not a name', 'ghp_abc123', 'npm ci'],
    ['a dash', 'ACME-TOKEN', 'npm ci'],
    ['a number first', '1ACME', 'npm ci'],
    ['empty', '', 'npm ci'],
    ['not a string', 42, 'npm ci'],
    ['a reserved GITHUB_ name', 'GITHUB_TOKEN', 'npm ci'],
    ['no setup to hand it to', 'ACME_DATA_TOKEN', undefined],
  ]) assert.equal(setupEnvProblems({ setup, setupToken }).length, 1, why);

  const dir = await project(t);
  const path = join(dir, '.keel', 'keel.json');
  const cfg = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, `${JSON.stringify({ ...cfg, setup: 'npm ci', setupToken: 'ACME_DATA_TOKEN' }, null, 2)}\n`);
  let d = doctor(dir);
  assert.equal(d.code, 0, JSON.stringify(d.data.lint));
  assert.equal(d.data.gate.setupToken, 'ACME_DATA_TOKEN');
  assert.match(keel(['doctor'], dir).out, /setupToken: secrets\.ACME_DATA_TOKEN/);
  await writeFile(path, `${JSON.stringify({ ...cfg, setup: 'npm ci', setupToken: 'ghp_notaname' }, null, 2)}\n`);
  d = doctor(dir);
  assert.equal(d.code, 1);
  assert.deepEqual(d.data.lint.filter(l => l.rule === 'gate-config').map(l => /setupToken/.test(l.message)), [true]);
});

test('stack: a declaration the evidence disagrees with is a finding either way; none declared is a note; an unknown tag is a finding', async t => {
  const dir = await project(t);
  const path = join(dir, '.keel', 'keel.json');
  const cfg = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(cfg.stack, ['node', 'github-actions'], 'init records the stack its files show');
  const withStack = stack => writeFile(path, `${JSON.stringify({ ...cfg, stack }, null, 2)}\n`);
  const stackRules = data => [...data.lint, ...data.notes].filter(l => l.rule.startsWith('stack-')).map(l => `${l.rule} ${data.notes.includes(l) ? 'note' : 'finding'}`);

  // Declared without evidence: vercel, and no vercel.json.
  await withStack(['node', 'github-actions', 'vercel']);
  let r = doctor(dir);
  assert.equal(r.code, 1, JSON.stringify(r.data));
  assert.deepEqual(stackRules(r.data), ['stack-evidence finding']);
  assert.match(r.data.lint.find(l => l.rule === 'stack-evidence').message, /declares vercel, and nothing in the repo shows it/);

  // Evidence without declaration: vercel.json, and vercel not declared.
  await withStack(['node', 'github-actions']);
  await writeFile(join(dir, 'vercel.json'), '{}\n');
  r = doctor(dir);
  assert.equal(r.code, 1, JSON.stringify(r.data));
  assert.deepEqual(stackRules(r.data), ['stack-evidence finding']);
  assert.match(r.data.lint.find(l => l.rule === 'stack-evidence').message, /the files show vercel \(vercel\.json\), and "stack" does not declare it/);

  // Agreeing: clean of stack rules.
  await withStack(['node', 'vercel', 'github-actions']);
  r = doctor(dir);
  assert.deepEqual(stackRules(r.data), []);

  // An unknown tag: a finding, and doctor still reads everything else.
  await withStack(['node', 'netlify']);
  r = doctor(dir);
  assert.equal(r.code, 1, JSON.stringify(r.data));
  assert.deepEqual(stackRules(r.data), ['stack-unknown finding']);
  assert.match(r.data.lint[0].message, /names netlify, which is not in keel's vocabulary/);

  // None declared: a note naming what the files show; the exit code is not moved by it.
  const { stack, ...bare } = cfg;
  await writeFile(path, `${JSON.stringify(bare, null, 2)}\n`);
  await rm(join(dir, 'vercel.json'));
  r = doctor(dir);
  assert.deepEqual(stackRules(r.data), ['stack-evidence note']);
  assert.match(r.data.notes.find(n => n.rule === 'stack-evidence').message, /no "stack" declared; the files show node \(package\.json\), github-actions/);
});

// ---- the platform guard (phase 65) ------------------------------------------

const CHILD = ['node', 'child_process'].join(':');

test('platform guard: a tool counts only where a process runner the file imports runs it as a command', () => {
  // The fixtures' import is spelled through CHILD so tests/helpers.test.mjs's spawn guard reads no import here.
  const CP = `import { execFileSync, execSync, spawnSync, execFile, spawn } from '${CHILD}';\nimport { promisify } from 'node:util';\n`;
  const calls = (text, path = 'tests/a.test.mjs') => platformCalls(path.endsWith('.sh') ? text : CP + text, path);
  // Run as a command: a runner's first argument or array, a shell string, sh -c, a path to it, a two-word tool's array form.
  assert.deepEqual(calls("execFileSync('hdiutil', ['attach', 'acme.dmg']);"), { darwin: ['hdiutil'] });
  assert.deepEqual(calls("execSync('cd /tmp && hdiutil attach acme.dmg');"), { darwin: ['hdiutil'] });
  assert.deepEqual(calls("execFileSync('/usr/bin/hdiutil', ['info']);"), { darwin: ['hdiutil'] });
  assert.deepEqual(calls("execFile('sh', ['-c', 'pbcopy < notes.txt']);"), { darwin: ['pbcopy'] });
  assert.deepEqual(calls("await promisify(execFile)('codesign', ['-v', app]);"), { darwin: ['codesign'] });
  assert.deepEqual(calls("const sh = promisify(execFile);\nawait sh('codesign', ['-v', app]);"), { darwin: ['codesign'] });
  assert.deepEqual(calls("execFileSync('defaults', ['write', 'com.acme', 'x', '1']);"), { darwin: ['defaults write'] });
  assert.deepEqual(calls("execSync('powershell -Command Get-Date');"), { win32: ['powershell'] });
  assert.deepEqual(platformCalls("import { $ } from 'zx';\nawait $`osascript -e 'beep'`;", 'tests/a.test.mjs'), { darwin: ['osascript'] });
  assert.deepEqual(platformCalls("const cp = require('child_process');\ncp.execSync('launchctl list');", 'tests/a.test.cjs'), { darwin: ['launchctl'] });
  assert.deepEqual(calls('#!/bin/sh\nhdiutil attach acme.dmg\n', 'tests/mount.sh'), { darwin: ['hdiutil'] });
  // Prose, test names, comments and fixtures held in a string: not a command.
  assert.deepEqual(calls("// hdiutil attach is macOS only\ntest('hdiutil attaches the image', () => { assert.ok(says('uses hdiutil')); });"), {});
  assert.deepEqual(calls("/* execFileSync('hdiutil', []) */ const x = 1;"), {});
  assert.deepEqual(calls("const fixture = `execFileSync('hdiutil', ['attach'])`;"), {});
  assert.deepEqual(calls("execFileSync('defaults', ['read', 'com.acme']);"), {}, 'defaults read is not defaults write');
  assert.deepEqual(calls('# hdiutil is macOS only\necho ok\n', 'tests/mount.sh'), {});
  // Review of PR 58: a helper of the file's own is not a process runner; nor is a file that imports none.
  assert.deepEqual(calls("function run(x) { return x; }\nrun('powershell');\nconst sh = s => s; sh('hdiutil attach');"), {});
  assert.deepEqual(platformCalls("execFileSync('hdiutil', ['attach']);", 'tests/a.test.mjs'), {}, 'no runner imported: nothing runs');
  assert.deepEqual(calls("const m = /x/.exec('hdiutil attach');"), {}, 'a RegExp exec runs nothing');
  // Review of PR 58: a separator inside the shell's quotes separates nothing; $( ) inside double quotes still runs.
  assert.deepEqual(calls(`execSync('echo "hello; hdiutil attach acme.dmg"');`), {});
  assert.deepEqual(calls(`execSync("echo 'a && pbcopy'");`), {});
  assert.deepEqual(calls(`execSync('echo "size: $(hdiutil info)"');`), { darwin: ['hdiutil'] });
  // Review of PR 58: GNU stat -f (file system status) runs on Linux; BSD stat -f <format> is macOS-only.
  assert.deepEqual(calls("execSync('stat -f .');"), {});
  assert.deepEqual(calls("execFileSync('stat', ['-f', '.']);"), {});
  assert.deepEqual(calls('execSync(`stat -f %z ${file}`);'), { darwin: ['stat -f %'] });
  assert.deepEqual(calls(`execSync("stat -f '%m' x");`), { darwin: ['stat -f %'] });
  assert.deepEqual(calls("execFileSync('stat', ['-f', '%z', file]);"), { darwin: ['stat -f %'] });
});

test('platform guard: a skip clears only the command it guards, and only in the right direction', () => {
  const CP = `import { test, describe } from 'node:test';\nimport { execFileSync, execSync } from '${CHILD}';\n`;
  const calls = (text, path = 'tests/a.test.mjs') => platformCalls(path.endsWith('.sh') ? text : CP + text, path);
  const run = "execFileSync('hdiutil', ['attach']);";
  // Guards that cover the command.
  assert.deepEqual(calls(`test('mounts', { skip: process.platform !== 'darwin' }, () => { ${run} });`), {});
  assert.deepEqual(calls(`test('mounts', { skip: process.platform !== 'darwin' && 'macOS only' }, () => { ${run} });`), {});
  assert.deepEqual(calls(`describe('mac', { skip: process.platform !== 'darwin' }, () => { test('a', () => { ${run} }); });`), {});
  assert.deepEqual(calls(`describe.skipIf(process.platform !== 'darwin')('mac', () => { ${run} });`), {});
  assert.deepEqual(calls(`if (process.platform === 'darwin') { ${run} }`), {});
  assert.deepEqual(calls(`test('x', t => { if (process.platform !== 'darwin') return t.skip('macOS only'); ${run} });`), {});
  assert.deepEqual(calls(`const isMac = process.platform === 'darwin';\ntest('x', { skip: !isMac }, () => { ${run} });`), {});
  assert.deepEqual(calls(`if (process.platform !== 'darwin') process.exit(0);\n${run}`), {});
  assert.deepEqual(calls('[ "$(uname)" = Darwin ] || exit 0\nhdiutil attach acme.dmg\n', 'tests/mount.sh'), {});
  assert.deepEqual(calls('if [ "$(uname)" = "Darwin" ]; then\n  hdiutil attach acme.dmg\nfi\n', 'tests/mount.sh'), {});
  // Review of PR 58: one skipped test does not clear an unguarded one after it.
  assert.deepEqual(calls(`test('a', { skip: process.platform !== 'darwin' }, () => { ${run} });\ntest('b', () => { ${run} });`), { darwin: ['hdiutil'] });
  assert.deepEqual(calls('if [ "$(uname)" = "Darwin" ]; then\n  hdiutil attach a.dmg\nfi\nhdiutil detach b\n', 'tests/mount.sh'), { darwin: ['hdiutil'] });
  // Review of PR 58: a guard the wrong way round runs the command elsewhere.
  assert.deepEqual(calls(`test('x', { skip: process.platform === 'darwin' }, () => { ${run} });`), { darwin: ['hdiutil'] });
  assert.deepEqual(calls(`if (process.platform !== 'darwin') ${run}`), { darwin: ['hdiutil'] });
  assert.deepEqual(calls(`if (process.platform !== 'darwin') { ${run} }`), { darwin: ['hdiutil'] });
  // A skip for another platform guards nothing here; one that rules this platform out does.
  assert.deepEqual(calls(`test('x', { skip: process.platform !== 'win32' }, () => { ${run} });`), { darwin: ['hdiutil'] });
  assert.deepEqual(calls(`if (process.platform === 'win32') execSync('powershell x');`), {});
});

test('platform guard: doctor fails a tracked test calling hdiutil without a darwin skip, passes one with it, and checks a project\'s added tool', async t => {
  const dir = await project(t);
  const git = (...args) => assert.equal(run('git', ['-C', dir, ...args], { env: ENV }).status, 0, `git ${args.join(' ')}`);
  const guard = data => data.lint.filter(l => l.rule === 'platform-guard').map(l => l.path);
  // After the CLI's report is checked once, the rule runs in-process: each doctor run takes about a second.
  const guarded = async () => (await platformLints(dir, JSON.parse(await readFile(join(dir, '.keel', 'keel.json'), 'utf8')))).map(l => l.path);
  await mkdir(join(dir, 'tests'), { recursive: true });
  const bare = "import { test } from 'node:test';\nimport { execFileSync } from 'node:child_process';\ntest('mounts the image', () => { execFileSync('hdiutil', ['attach', 'acme.dmg']); });\n";
  await writeFile(join(dir, 'tests', 'mount.test.mjs'), bare);
  git('add', '-A'); git('commit', '-q', '-m', 'acme: mount test');
  let r = doctor(dir);
  assert.equal(r.code, 1, JSON.stringify(r.data.lint));
  assert.deepEqual(guard(r.data), ['tests/mount.test.mjs']);
  assert.match(r.data.lint.find(l => l.rule === 'platform-guard').message, /runs hdiutil \(macOS only\) with no darwin skip/);
  assert.match(keel(['doctor'], dir).out, /platform-guard\s+tests\/mount\.test\.mjs/, 'the text report names it');

  // An untracked test is not the gate's: only tracked files are read.
  await writeFile(join(dir, 'tests', 'scratch.test.mjs'), bare);
  assert.deepEqual(await guarded(), ['tests/mount.test.mjs']);
  await rm(join(dir, 'tests', 'scratch.test.mjs'));

  // With the skip: clean.
  await writeFile(join(dir, 'tests', 'mount.test.mjs'), bare.replace("test('mounts the image', ()", "test('mounts the image', { skip: process.platform !== 'darwin' }, ()"));
  git('commit', '-q', '-am', 'acme: skip off macOS');
  r = doctor(dir);
  assert.deepEqual(guard(r.data), []);
  assert.equal(r.code, 0, JSON.stringify(r.data.lint));

  // A tool the project adds ("platformTools"): checked too; a bad list is a finding on the config.
  await writeFile(join(dir, 'tests', 'sim.test.mjs'), "import { execFileSync } from 'node:child_process';\nexecFileSync('xcrun', ['simctl', 'list']);\n");
  git('add', '-A'); git('commit', '-q', '-m', 'acme: simulator test');
  assert.deepEqual(await guarded(), [], 'xcrun is not on keel\'s list');
  const path = join(dir, '.keel', 'keel.json');
  const cfg = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, `${JSON.stringify({ ...cfg, platformTools: ['xcrun'] }, null, 2)}\n`);
  assert.deepEqual(await guarded(), ['tests/sim.test.mjs']);
  await writeFile(path, `${JSON.stringify({ ...cfg, platformTools: [{ tool: 'xcrun', platform: 'darwin' }] }, null, 2)}\n`);
  assert.deepEqual(await guarded(), ['tests/sim.test.mjs']);
  await writeFile(path, `${JSON.stringify({ ...cfg, platformTools: [{ tool: 'xcrun' }] }, null, 2)}\n`);
  assert.deepEqual(await guarded(), ['.keel/keel.json']);
});

test('platform guard: keel\'s own tests are clean of it', async () => {
  assert.deepEqual(await platformLints(KEEL, JSON.parse(await readFile(join(KEEL, '.keel', 'keel.json'), 'utf8'))), []);
});
