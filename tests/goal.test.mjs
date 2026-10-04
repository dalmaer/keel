// keel goal add|show|retire and keel phase new|list, inside a keel init'd
// project: goals are outcomes, progress is derived, and every write leaves a
// roadmap the project's own check accepts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { run } from './helpers/run.mjs';
import { mkdtemp, readFile, writeFile, readdir, rename, rm, cp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatGoals, nextNumber } from '../lib/goals.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(KEEL, 'bin', 'keel.mjs');
const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Acme Builder', GIT_AUTHOR_EMAIL: 'builder@acme.test',
  GIT_COMMITTER_NAME: 'Acme Builder', GIT_COMMITTER_EMAIL: 'builder@acme.test',
  GIT_CONFIG_NOSYSTEM: '1',
};
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const keel = (dir, ...args) => {
  const r = run(process.execPath, [BIN, ...args], { cwd: dir, env: ENV });
  let data;
  try { data = JSON.parse(r.stdout); } catch { data = undefined; }
  return { code: r.status, out: r.stdout, err: r.stderr, data };
};
/** The project's own roadmap check, with the script keel rendered into it. */
const check = dir => run(process.execPath, ['scripts/roadmap.mjs', '--check'], { cwd: dir, env: ENV });
const read = (dir, path) => readFile(join(dir, path), 'utf8');

let template;
async function project(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'keel-goal-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  if (!template) {
    template = await realpath(await mkdtemp(join(tmpdir(), 'keel-goal-template-')));
    process.on('exit', () => rmSync(template, { recursive: true, force: true }));
    const r = run(process.execPath, [BIN, 'init', join(template, 'acme-notes'), '--description', 'Acme Notes keeps meeting notes as plain files.', '--kind', 'node'], { cwd: template, env: ENV });
    assert.equal(r.status, 0, r.stderr);
  }
  await cp(join(template, 'acme-notes'), join(dir, 'acme-notes'), { recursive: true, verbatimSymlinks: true });
  return join(dir, 'acme-notes');
}

test('goal add with no phase: the roadmap still generates, doctor reports it until a phase names it', async t => {
  const dir = await project(t);
  const r = keel(dir, 'goal', 'add', 'Acme exports notes', '--outcome', 'A person can export any meeting as one file.', '--json');
  assert.equal(r.code, 0, r.out + r.err);
  assert.deepEqual(r.data, { ok: true, goal: { id: 'G1', title: 'Acme exports notes', outcome: 'A person can export any meeting as one file.' }, file: 'docs/goals.json' });
  assert.equal(JSON.parse(await read(dir, 'docs/goals.json'))[1].id, 'G1');
  assert.equal(check(dir).status, 0, check(dir).stderr);
  assert.match(await read(dir, 'docs/ROADMAP.md'), /## G1 — Acme exports notes\n\nA person can export any meeting as one file\.\n\nNo phases yet — `keel phase new --goal G1`\./);

  const d = keel(dir, 'doctor', '--json');
  assert.equal(d.code, 1);
  assert.deepEqual(d.data.lint.map(l => [l.rule, l.message]), [['goal-without-phase', 'G1: no phase serves this goal']]);

  assert.equal(keel(dir, 'phase', 'new', 'Export one meeting', '--goal', 'G1').code, 0);
  const after = keel(dir, 'doctor', '--json');
  assert.equal(after.code, 0, after.out);
  assert.deepEqual(after.data.lint, []);

  // The next id is max + 1, never a reuse.
  assert.equal(keel(dir, 'goal', 'add', 'Later', '--outcome', 'Later.', '--json').data.goal.id, 'G2');
  assert.equal(keel(dir, 'goal', 'add', 'No outcome').code, 2);
});

test('goal show reports its phases, counts and next; deps in another goal count', async t => {
  const dir = await project(t);
  const g0 = keel(dir, 'goal', 'show', 'G0', '--json');
  assert.equal(g0.code, 0, g0.out);
  assert.deepEqual(Object.keys(g0.data), ['goal', 'phases', 'built', 'lived', 'next']);
  assert.equal(g0.data.goal.id, 'G0');
  assert.deepEqual(g0.data.phases, [{ id: 0, title: g0.data.phases[0].title, status: 'planned' }]);
  assert.equal(g0.data.built, 0);
  assert.equal(g0.data.lived, 0);
  assert.equal(g0.data.next.id, 0);
  assert.equal(g0.data.next.file, '00-first-thing-that-runs.md');

  keel(dir, 'goal', 'add', 'Export', '--outcome', 'Notes export.');
  keel(dir, 'phase', 'new', 'Export one meeting', '--goal', 'G1', '--depends', '0');
  const g1 = keel(dir, 'goal', 'show', 'G1', '--json');
  assert.deepEqual(g1.data.phases, [{ id: 1, title: 'Export one meeting', status: 'planned' }]);
  assert.equal(g1.data.next, null, 'phase 1 waits on phase 0, in G0');

  assert.equal(keel(dir, 'goal', 'show', 'G9').code, 2);
  assert.equal(keel(dir, 'goal', 'show').code, 2);
});

test('retiring a goal with unbuilt phases asks; supersede with --yes supersedes them', async t => {
  const dir = await project(t);
  keel(dir, 'goal', 'add', 'Export', '--outcome', 'Notes export.');
  keel(dir, 'phase', 'new', 'Export one meeting', '--goal', 'G1');
  const before = await read(dir, 'docs/phases/01-export-one-meeting.md');
  const goalsBefore = await read(dir, 'docs/goals.json');

  const ask = keel(dir, 'goal', 'retire', 'G1', '--reason', 'Nobody exports', '--json');
  assert.equal(ask.code, 2);
  assert.deepEqual(ask.data, { ok: false, needs: 'phases', goal: 'G1',
    unbuilt: [{ id: 1, file: '01-export-one-meeting.md', title: 'Export one meeting', status: 'planned' }], options: ['supersede', 'move:<Gm>'] });
  const text = keel(dir, 'goal', 'retire', 'G1', '--reason', 'Nobody exports');
  assert.match(text.out, /--phases supersede[\s\S]*--phases move:<Gm>/);

  const plan = keel(dir, 'goal', 'retire', 'G1', '--reason', 'Nobody exports', '--phases', 'supersede', '--json');
  assert.equal(plan.code, 3);
  assert.equal(plan.data.needs, 'yes');
  assert.deepEqual(plan.data.plan.phases.map(p => [p.id, p.action]), [[1, 'supersede']]);
  assert.equal(await read(dir, 'docs/phases/01-export-one-meeting.md'), before, 'nothing written without --yes');
  assert.equal(await read(dir, 'docs/goals.json'), goalsBefore);

  assert.equal(keel(dir, 'goal', 'retire', 'G1', '--reason', 'Nobody exports', '--phases', 'supersede', '--yes').code, 0);
  const phase = await read(dir, 'docs/phases/01-export-one-meeting.md');
  assert.match(phase, new RegExp(`^---\\nstatus: superseded\\nsince: ${today()}\\ngoal: G1\\n`));
  assert.match(phase, /^note: "Goal G1 retired: Nobody exports"$/m);
  assert.equal(phase.slice(phase.indexOf('\n# ')), before.slice(before.indexOf('\n# ')), 'the body is untouched');
  assert.equal(JSON.parse(await read(dir, 'docs/goals.json'))[1].retired, `${today()}: Nobody exports`);
  const roadmap = await read(dir, 'docs/ROADMAP.md');
  assert.match(roadmap, /## Retired[\s\S]*### G1 — Export\n\nRetired \d{4}-\d{2}-\d{2}: Nobody exports/);
  assert.match(roadmap, /0 of 2 phases lived in/);
  assert.equal(check(dir).status, 0);
  assert.equal(keel(dir, 'goal', 'retire', 'G1', '--reason', 'again').code, 2, 'already retired');
  assert.equal(keel(dir, 'phase', 'new', 'More export', '--goal', 'G1').code, 2, 'no new phase under a retired goal');
  assert.deepEqual(keel(dir, 'doctor', '--json').data.lint, [], 'a retired goal is not a goal without a phase');
});

test('retire --phases move:<Gm> gives the unbuilt phases to another goal', async t => {
  const dir = await project(t);
  keel(dir, 'goal', 'add', 'Export', '--outcome', 'Notes export.');
  keel(dir, 'phase', 'new', 'Export one meeting', '--goal', 'G1');
  assert.equal(keel(dir, 'goal', 'retire', 'G1', '--reason', 'Folded into G0', '--phases', 'move:G1', '--yes').code, 2);
  const r = keel(dir, 'goal', 'retire', 'G1', '--reason', 'Folded into G0', '--phases', 'move:G0', '--yes', '--json');
  assert.equal(r.code, 0, r.out);
  const phase = await read(dir, 'docs/phases/01-export-one-meeting.md');
  assert.match(phase, /^goal: G0$/m);
  assert.match(phase, /^status: planned$/m);
  assert.deepEqual(keel(dir, 'goal', 'show', 'G0', '--json').data.phases.map(p => p.id), [0, 1]);
  assert.match(await read(dir, 'docs/ROADMAP.md'), /### G1 — Export[\s\S]*No phases\./);
  assert.equal(check(dir).status, 0);
});

test('phase new picks max + 1, keeps the template, and validates', async t => {
  const dir = await project(t);
  const zero = await read(dir, 'docs/phases/00-first-thing-that-runs.md');
  await writeFile(join(dir, 'docs/phases/07-later.md'), zero.replace(/^# .+$/m, '# Later'));
  const r = keel(dir, 'phase', 'new', 'Acme: export, one meeting!', '--goal', 'G0', '--depends', '0,7', '--json');
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.data, { ok: true, id: 8, file: '08-acme-export-one-meeting.md', path: 'docs/phases/08-acme-export-one-meeting.md', goal: 'G0', depends: [0, 7] });
  const phase = await read(dir, r.data.path);
  const template = await read(dir, 'docs/templates/phase.md');
  assert.equal(phase.slice(0, phase.indexOf('\n---\n') + 5),
    `---\nstatus: planned\nsince: ${today()}\ngoal: G0\ndepends: [0,7]\nnote: "Drafted by keel phase new."\nevidence: []\n---\n`);
  assert.equal(phase.slice(phase.indexOf('\n## Done when')), template.slice(template.indexOf('\n## Done when')), 'sections as the template has them');
  assert.match(phase, /^# Acme: export, one meeting!$/m);
  assert.equal(check(dir).status, 0);
  assert.equal(keel(dir, 'phase', 'list', '--json').data.map(p => p.id).join(), '0,7,8');

  assert.equal(keel(dir, 'phase', 'new', 'X', '--goal', 'G7').code, 2);
  assert.equal(keel(dir, 'phase', 'new', 'X', '--goal', 'G0', '--depends', '42').code, 2);
  assert.equal(keel(dir, 'phase', 'new', 'X').code, 2);
  assert.equal((await readdir(join(dir, 'docs/phases'))).length, 4, 'refusals write nothing');
});

test('phase new matches a project that numbers its phases with one digit', async t => {
  const dir = await project(t);
  await rename(join(dir, 'docs/phases/00-first-thing-that-runs.md'), join(dir, 'docs/phases/0-practice-room.md'));
  const r = keel(dir, 'phase', 'new', 'Second', '--goal', 'G0', '--json');
  assert.equal(r.code, 0, r.out);
  assert.equal(r.data.file, '1-second.md');
  assert.deepEqual([nextNumber(['00-a.md', '14-b.md']).name, nextNumber(['3-a.md', '12-b.md']).name, nextNumber([]).name], ['15', '13', '00']);
});

test('two branches that took the same number are named, file by file', async t => {
  const dir = await project(t);
  const zero = await read(dir, 'docs/phases/00-first-thing-that-runs.md');
  await writeFile(join(dir, 'docs/phases/03-from-one-branch.md'), zero.replace(/^# .+$/m, '# One'));
  await writeFile(join(dir, 'docs/phases/03-from-another.md'), zero.replace(/^# .+$/m, '# Another'));
  const c = check(dir);
  assert.equal(c.status, 1);
  assert.match(c.stderr, /duplicate phase number 3: 03-from-another\.md and 03-from-one-branch\.md; renumber one/);
  const d = keel(dir, 'doctor', '--json');
  assert.ok(d.data.lint.some(l => l.rule === 'phase' && /03-from-another\.md and 03-from-one-branch\.md/.test(l.message)), d.out);
  const s = keel(dir, 'status');
  assert.equal(s.code, 1);
  assert.match(s.err, /03-from-another\.md and 03-from-one-branch\.md/);
  // The roadmap is broken, so phase new refuses rather than adding to it.
  assert.notEqual(keel(dir, 'phase', 'new', 'Fourth', '--goal', 'G0').code, 0);
});

test('goals.json keeps the style it was written in', () => {
  const oneLine = '[\n  { "id": "G0", "title": "A", "outcome": "B." }\n]\n';
  const goals = [...JSON.parse(oneLine), { id: 'G1', title: 'C', outcome: 'D.' }];
  assert.equal(formatGoals(goals, oneLine), '[\n  { "id": "G0", "title": "A", "outcome": "B." },\n  { "id": "G1", "title": "C", "outcome": "D." }\n]\n');
  assert.equal(formatGoals(goals, JSON.stringify(goals.slice(0, 1), null, 2)), `${JSON.stringify(goals, null, 2)}\n`);
});
