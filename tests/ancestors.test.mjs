// Phase 16: the projects the practice came from can use keel without losing
// their shapes. Fixtures are synthetic: tests/fixtures/ancestors/acme-canvas is
// shaped like a project that keeps its phases as docs/projects/<p>/phases.md
// with **Status:** lines, its lessons in docs/reviews/lessons.md, its own
// conductor (the original keel's is adapted from) and no `check` script;
// tests/fixtures/adopt/acme-fold is shaped like one whose phases name no goal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyProject } from './helpers/copy-project.mjs';
import { run } from './helpers/run.mjs';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, lstat, readlink, rm, writeFile, realpath, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adopt } from '../lib/adopt.mjs';
import { load, render } from '../lib/practices.mjs';
import { pinsEvery } from './helpers/practices.mjs';
import { parseProject, nextOf, namedNext } from '../lib/phases-projects.mjs';
import { lessons } from '../lib/lessons.mjs';
import { measure } from '../lib/improve.mjs';
import { view } from '../lib/migrations.mjs';
import * as m0003 from '../migrations/0003-phases-gain-goals.mjs';
import { collect } from '../practices/phases/files/scripts/roadmap.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(KEEL, 'bin', 'keel.mjs');
const CANVAS = join(KEEL, 'tests', 'fixtures', 'ancestors', 'acme-canvas');
const FOLD = join(KEEL, 'tests', 'fixtures', 'adopt', 'acme-fold');
const VERSION = { cli: '0.0.0', commit: null, practice: '0.0.0' };
const GATE = 'npm test && npm run typecheck';
const keel = (args, cwd = KEEL) => {
  const r = run(process.execPath, [BIN, ...args], { cwd });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

async function copy(t, from) {
  const dir = join(await realpath(await mkdtemp(join(tmpdir(), 'keel-ancestors-'))), 'acme');
  t.after(() => rm(dirname(dir), { recursive: true, force: true }));
  await copyProject(from, dir);
  return dir;
}

test('ancestor fixture copies omit runtime ledgers before traversing project inputs', async t => {
  const source = await realpath(await mkdtemp(join(tmpdir(), 'acme-ancestor-source-')));
  t.after(() => rm(source, { recursive: true, force: true }));
  await mkdir(join(source, '.keel/test-runs/usual-acme'), { recursive: true });
  await writeFile(join(source, '.keel/test-runs/usual-acme/run.json'), '{}');
  await writeFile(join(source, '.keel/keel.json'), '{"name":"Acme"}');
  const dir = await copy(t, source);
  assert.deepEqual(JSON.parse(await readFile(join(dir, '.keel/keel.json'), 'utf8')), { name: 'Acme' });
  await assert.rejects(lstat(join(dir, '.keel/test-runs')), { code: 'ENOENT' });
});

async function tree(dir) {
  const out = {};
  const walk = async d => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name), rel = relative(dir, p);
      const info = await lstat(p);
      if (info.isSymbolicLink()) out[rel] = `-> ${await readlink(p)}`;
      else if (info.isDirectory()) await walk(p);
      else out[rel] = createHash('sha256').update(await readFile(p)).digest('hex');
    }
  };
  await walk(dir);
  return out;
}

const states = data => Object.fromEntries(data.practices.map(p => [p.name, p.state]));

// ---- bug 1: the gate --------------------------------------------------------

test('no check script: the dry run reports no gate and asks for --check; a write run exits 2 and writes nothing', async t => {
  const dry = keel(['adopt', CANVAS, '--dry-run']);
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /^Gate: none found — pass --check "<command>"$/m);
  const data = JSON.parse(keel(['adopt', CANVAS, '--dry-run', '--json']).out);
  assert.deepEqual(data.check, { check: null, from: 'none found' });
  assert.equal(data.config.check, undefined, 'never a gate the project does not have');
  assert.equal(states(data).ci, 'off');

  const dir = await copy(t, CANVAS);
  const before = await tree(dir);
  const write = keel(['adopt', dir]);
  assert.equal(write.code, 2);
  assert.match(write.err, /Gate: none found — pass --check "<command>"/);
  assert.deepEqual(await tree(dir), before, 'nothing written without a gate');
});

test('with --check, the gate is recorded as given', async t => {
  const dir = await copy(t, CANVAS);
  const r = keel(['adopt', dir, '--check', GATE]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^Gate: npm test && npm run typecheck \(--check\)$/m);
  assert.equal(JSON.parse(await readFile(join(dir, '.keel/keel.json'), 'utf8')).check, GATE);
});

// ---- bug 2: the lessons file ------------------------------------------------

test('a lessons table elsewhere becomes config; nothing is seeded beside it; the block names it', async t => {
  const dir = await copy(t, CANVAS);
  const before = await tree(dir);
  const { data } = await adopt({ dir, check: GATE }, { version: VERSION });
  assert.deepEqual(data.lessons, { path: 'docs/reviews/lessons.md', from: 'found: docs/reviews/lessons.md holds a numbered lessons table' });
  assert.equal(data.config.lessons, 'docs/reviews/lessons.md');
  assert.equal(states(data).lessons, 'on');
  await assert.rejects(lstat(join(dir, 'docs/lessons.md')), { code: 'ENOENT' }, 'no second lessons table');
  const agents = await readFile(join(dir, 'AGENTS.md'), 'utf8');
  assert.match(/<!-- keel:begin lessons -->\n([\s\S]*?)<!-- keel:end lessons -->/.exec(agents)[1], /`docs\/reviews\/lessons\.md`/);
  // Additions only: every file the project had keeps its bytes, AGENTS.md only grows.
  const after = await tree(dir);
  for (const [path, sha] of Object.entries(before)) if (path !== 'AGENTS.md') assert.equal(after[path], sha, `${path} changed`);
  assert.ok(agents.startsWith(await readFile(join(CANVAS, 'AGENTS.md'), 'utf8')));
  // Render again: the seeded table is the project's, kept where it is.
  const again = await render(dir, { check: true });
  assert.ok(again.ok, JSON.stringify(again.differs));
  assert.equal(again.entries.find(e => e.practice === 'lessons' && e.kind === 'seeded').path, 'docs/reviews/lessons.md');
});

test('keel\'s own render with the default lessons path is byte-identical', () => {
  const r = keel(['render', '--check', '--json']);
  assert.equal(r.code, 0, r.out);
});

test('lessons and improve read the configured path; doctor lints one that is not there', async t => {
  const dir = await copy(t, CANVAS);
  await adopt({ dir, check: GATE }, { version: VERSION });
  const sent = await lessons({ dir, dryRun: true, to: 'acme/keel' }, { cliRoot: KEEL, practices: await load() });
  assert.equal(sent.data.counts.lesson, 2);
  assert.ok(sent.data.items.every(i => i.kind !== 'lesson' || i.body.includes('docs/reviews/lessons.md')));

  const config = JSON.parse(await readFile(join(dir, '.keel/keel.json'), 'utf8'));
  const [guard] = await measure({ root: dir, config, env: {}, date: '2026-10-03', measures: (await import('../lib/improve.mjs')).MEASURES.filter(m => m.id === 'lessons_without_guard') });
  assert.equal(guard.state, 'ok', JSON.stringify(guard));
  assert.match(guard.detail, /all 2 name a guard/);

  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ ...config, lessons: 'docs/gone/lessons.md' }, null, 2));
  const doc = JSON.parse(keel(['doctor', '--json'], dir).out);
  assert.ok(doc.lint.some(l => l.rule === 'lessons-path' && /docs\/gone\/lessons\.md/.test(l.message)));
});

// ---- bug 3: the projects shape, and conduct where it came from -----------------

test('the projects shape: phases local and read-only, conduct local as its upstream source, no copy beside it', async t => {
  const dir = await copy(t, CANVAS);
  const { data } = await adopt({ dir, check: GATE }, { version: VERSION });
  assert.deepEqual(data.config.phases, { shape: 'projects' });
  assert.deepEqual(states(data), pinsEvery({ base: 'on', 'agents-md': 'on', phases: 'local', evidence: 'local', lessons: 'on', conduct: 'local', ci: 'local', night: 'local', claude: 'off', renovate: 'on', loop: 'off', reconciliation: 'off', climb: 'off', 'cross-review': 'off' }, 'tests/ancestors.test.mjs: the projects shape'));
  assert.match(data.config.local.phases, /docs\/projects\/<project>\/phases\.md \(3 projects\)/);
  assert.match(data.config.local.conduct, /upstream source/);
  assert.match(data.config.local.night, /scripts\/night\.mjs/);
  await assert.rejects(lstat(join(dir, '.agents/skills/conduct')), { code: 'ENOENT' }, 'never a second conductor beside its own');
  await assert.rejects(lstat(join(dir, 'docs/ROADMAP.md')), { code: 'ENOENT' }, 'no roadmap for this shape');
  assert.ok((await lstat(join(dir, '.claude/skills/conduct'))).isDirectory(), 'its own conductor stays a directory');
});

test('keel next reads docs/projects/<p>/phases.md: where-we-are\'s phase, else the first unfinished', async t => {
  const dir = await copy(t, CANVAS);
  await adopt({ dir, check: GATE }, { version: VERSION });
  const kiln = keel(['next', '--project', 'kiln', '--json'], dir);
  assert.equal(kiln.code, 0, kiln.err);
  const k = JSON.parse(kiln.out);
  assert.equal(k.shape, 'projects');
  assert.deepEqual([k.next.id, k.next.status, k.next.word, k.from], ['3', 'planned', 'NOT STARTED', 'where we are']);
  assert.match(keel(['next', '--project', 'kiln'], dir).out, /^kiln: phase 3 — the cone chart \[planned: NOT STARTED\] — docs\/projects\/kiln\/phases\.md:\d+ \(where we are\)$/m);

  const all = JSON.parse(keel(['next', '--json'], dir).out);
  const glaze = all.projects.find(p => p.project === 'glaze');
  assert.deepEqual([glaze.next.id, glaze.from], ['1', 'first unfinished phase']);
  const shelf = all.projects.find(p => p.project === 'shelf');
  assert.equal(shelf.next, null, 'unknown phases are never guessed unfinished');
  assert.deepEqual(shelf.unknown, ['1', '2']);

  const status = JSON.parse(keel(['status', '--json'], dir).out);
  assert.deepEqual(status.projects.find(p => p.project === 'kiln'), { phases: 6, built: 3, partial: 0, planned: 2, superseded: 1, ...projectNext(k) });
  assert.equal(keel(['next', '--project', 'nope'], dir).code, 2);
  assert.equal(keel(['goal', 'list'], dir).code, 2, 'goals belong to the files shape');
});
const projectNext = k => ({ project: k.project, file: k.file, next: k.next, from: k.from, unknown: k.unknown });

test('doctor lints off-vocabulary statuses and status kept in headings, never guessing', async t => {
  const dir = await copy(t, CANVAS);
  await adopt({ dir, check: GATE }, { version: VERSION });
  const r = keel(['doctor', '--json'], dir);
  const lint = JSON.parse(r.out).lint;
  assert.ok(lint.some(l => l.rule === 'off-vocabulary' && l.path.startsWith('docs/projects/kiln/phases.md:') && /Status: DONE/.test(l.message)));
  assert.equal(lint.filter(l => l.rule === 'phase-status' && l.path.startsWith('docs/projects/shelf/')).length, 2);
  assert.equal(r.code, 1);
});

test('the projects reader: the vocabulary maps, DONE is off it, unknown words and headings are unknown', () => {
  const p = parseProject('acme', [
    '# Acme', '', '**Where we are:** phase 1 is next.', '',
    '## Phase 0 — a', '', '**Status: CLOSED.**', '',
    '## Phase 1 — b', '', '**Status: PART-DONE (2026-09-12).**', '',
    '## Phase 2 — c', '', '**Status: DONE 27 Aug 2026 — proof taken.**', '',
    '## Phase 3 — d', '', '**Status: PAUSED.**', '',
    '## Phase 4 — e ✅', '', 'Done.', '',
    '```', '## Phase 9 — in a fence', '```', '',
  ].join('\n'));
  assert.deepEqual(p.phases.map(x => [x.id, x.status]), [['0', 'built'], ['1', 'partial'], ['2', 'built'], ['3', 'unknown'], ['4', 'unknown']]);
  assert.deepEqual(p.lint.map(l => l.rule), ['off-vocabulary', 'off-vocabulary', 'phase-status']);
  assert.equal(nextOf(p).next.id, '1');
  assert.equal(namedNext('**Where we are, 2 Oct 2026: phases 0–2 are CLOSED. Next: keys phase 3, owner-only spend.**'), '3');
  assert.equal(namedNext('**Where we are:** phases 1 and 2 are closed. Embed phase 3, MCP Apps, is next'), '3');
  assert.equal(namedNext('**Where we are:** every phase CLOSED.'), null);
});

// ---- ledger-shaped phases: migration 0003 -------------------------------------

test('0003 does not apply while a built phase owes evidence; adopt and doctor name each one and the honest moves', async t => {
  const dir = await copy(t, FOLD);
  assert.deepEqual(await m0003.owing(await view(dir)), ['0-shell.md']);
  const { data } = await adopt({ dir }, { version: VERSION });
  assert.match(data.config.local.phases, /migration 0003 .* 1 built phase owe it \(0-shell\.md\): write the evidence when each is next checked, or step it back to partial; 0003 never writes placeholder evidence/);
  assert.equal(await m0003.applies(await view(dir)), false);
  const doc = keel(['doctor'], dir);
  assert.match(doc.out, /Built phases owing evidence \(migration 0003 waits on every one\): 0-shell\.md/);
  assert.deepEqual(JSON.parse(keel(['doctor', '--json'], dir).out).owing, ['0-shell.md']);
});

test('0003 with every built phase evidenced: goals, a goal each, sections marked as added, keel\'s roadmap; never evidence', async t => {
  const dir = await copy(t, FOLD);
  await adopt({ dir }, { version: VERSION });
  const shell = join(dir, 'docs/phases/0-shell.md');
  await writeFile(shell, (await readFile(shell, 'utf8')).replace('note:', 'evidence: ["evidence/2026-02-01-shell.md"]\nnote:'));
  await mkdir(join(dir, 'docs/evidence'), { recursive: true });
  await writeFile(join(dir, 'docs/evidence/2026-02-01-shell.md'), '# Evidence: phase 0 — the fold\n\n- Date: 2026-02-01\n- Claim being checked: six poses render.\n\nRan the explorer in each pose; all six rendered.\n');
  const project = await view(dir);
  assert.equal(await m0003.applies(project), true);
  const edits = await m0003.up(project);
  const paths = edits.map(e => e.path);
  assert.ok(!paths.some(p => p.startsWith('docs/evidence/')), 'never writes evidence');
  const goals = JSON.parse(edits.find(e => e.path === 'docs/goals.json').content);
  assert.equal(goals.length, 1);
  assert.equal(goals[0].id, 'G1');
  const zero = edits.find(e => e.path === 'docs/phases/0-shell.md').content;
  assert.match(zero, /^goal: G1$/m);
  assert.match(zero, /## Acceptance\n\n- \[x\] .*Added by keel migration 0003/);
  assert.match(zero, /^status: built$/m, 'never steps a phase back');
  const config = JSON.parse(edits.find(e => e.path === '.keel/keel.json').content);
  assert.ok(config.practices.includes('phases'), JSON.stringify(config.local));
  // Laid onto the tree, keel's roadmap reads every phase.
  for (const e of edits) {
    if (e.content === null) await rm(join(dir, e.path), { force: true });
    else { await mkdir(dirname(join(dir, e.path)), { recursive: true }); await writeFile(join(dir, e.path), e.content); }
  }
  const roadmap = await collect(dir);
  assert.deepEqual(roadmap.phases.map(p => [p.id, p.goal]), [[0, 'G1'], [1, 'G1']]);
  assert.equal(await m0003.applies(await view(dir)), false, 'idempotent: nothing left to do');
});

test('0003 groups: one goal per README group when every phase is in exactly one', () => {
  const files = ['0-a.md', '1-b.md', '2-c.md'];
  const readme = '# Phases\n\n## The store\n\n- [0. A](0-a.md)\n- [1. B](1-b.md)\n\n## The web\n\n- [2. C](./2-c.md)\n';
  assert.deepEqual(m0003.groupsOf(readme, files).map(g => [g.title, g.files]), [['The store', ['0-a.md', '1-b.md']], ['The web', ['2-c.md']]]);
  assert.deepEqual(m0003.groupsOf('# Phases\n\n## Some\n\n- [0](0-a.md)\n', files), [], 'a partial grouping is no grouping');
});

test('evidence_placeholders: a built phase whose evidence is the blank template is outside', async t => {
  const dir = await copy(t, join(KEEL, 'tests', 'fixtures', 'improve', 'unhealthy'));
  const config = JSON.parse(await readFile(join(dir, '.keel/keel.json'), 'utf8'));
  const { MEASURES } = await import('../lib/improve.mjs');
  const [r] = await measure({ root: dir, config, env: {}, date: '2026-10-03', measures: MEASURES.filter(m => m.id === 'evidence_placeholders') });
  assert.equal(r.state, 'outside');
  assert.match(r.detail, /phase 1 \(evidence\/2020-01-05-the-counter\.md\)/);
  await writeFile(join(dir, 'docs/evidence/2020-01-05-the-counter.md'), '# Evidence: phase 1 — the counter\n\n- Date: 2020-01-05\n- Claim being checked: an anvil can be ordered.\n\nOrdered one; it arrived.\n');
  const [ok] = await measure({ root: dir, config, env: {}, date: '2026-10-03', measures: MEASURES.filter(m => m.id === 'evidence_placeholders') });
  assert.equal(ok.state, 'ok');
});
