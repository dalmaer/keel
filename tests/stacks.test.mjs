// Where a lesson applies (phase 30): a closed vocabulary of stack tags with
// file evidence, keel's catalogue's Where column, a project's declared stack,
// and the docs/keel-lessons.md view each project reads. Fixtures are
// synthetic (Acme), built in temp directories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vocabulary, tags, whereTags, stackProblems, unknownWhere, detect, disagreement, viewRows, shapeLessonsView, VIEW } from '../lib/stacks.mjs';
import { parseLessons, lessonFingerprint } from '../lib/lessons.mjs';
import { load, fill, render } from '../lib/practices.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFile(join(KEEL, p), 'utf8');

async function scratch(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'keel-stacks-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function repo(t, files) {
  const dir = await scratch(t);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    if (path.endsWith('/')) await mkdir(join(dir, path), { recursive: true });
    else await writeFile(join(dir, path), text);
  }
  return dir;
}

const CATALOGUE = `# Lessons

| # | The shape of it | What it cost | Guard | Where |
| --- | --- | --- | --- | --- |
| 1 | **A wait whose deadline nobody measured.** *(acme 1)* | A flaky suite. | A measured deadline. | |
| 2 | **A cache keyed by build serves the old page.** *(acme 2)* | A stale deploy. | A cache-busting test. | vercel |
| 3 | **A Cloud Build step that runs as the wrong account.** *(acme 3)* | A failed deploy. | A lint on the step. | \`gcp\` |
| 4 | **A secret in a preview environment.** *(acme 4)* | A leak alert. | A scan. | vercel, gcp |
`;

test('the vocabulary is closed: exactly the seven tags, each with a meaning and evidence', () => {
  const vocab = vocabulary();
  assert.deepEqual(tags(vocab), ['node', 'web', 'vercel', 'gcp', 'firebase', 'github-pages', 'github-actions']);
  for (const s of vocab) {
    assert.ok(s.means.trim(), `${s.tag} means something`);
    assert.ok(s.evidence.length, `${s.tag} has evidence`);
  }
  const bad = list => () => vocabulary(JSON.stringify(list));
  assert.throws(bad([{ tag: 'node', means: 'x', evidence: [] }]), /node has no evidence/);
  assert.throws(bad([{ tag: 'node', means: 'x', evidence: ['package.json'] }, { tag: 'node', means: 'y', evidence: ['package.json'] }]), /node twice/);
  assert.throws(bad([{ tag: 'node', means: '', evidence: ['package.json'] }]), /says nothing/);
  assert.throws(bad([{ tag: 'node', means: 'x', evidence: ['a guess about where it might be'] }]), /is not a path/);
  assert.throws(bad([{ tag: 'Node!', means: 'x', evidence: ['package.json'] }]), /bad tag/);
});

test('an unknown tag fails: in the catalogue, in a project\'s stack, and keel\'s own catalogue names none', async () => {
  assert.deepEqual(unknownWhere(await read('docs/lessons.md')), [], 'docs/lessons.md names only tags in practices/lessons/stacks.json');
  const netlify = CATALOGUE.replace('| vercel |', '| netlify |');
  assert.deepEqual(unknownWhere(netlify), [{ n: 2, unknown: ['netlify'] }]);
  assert.throws(() => viewRows(netlify, ['vercel']), /lesson 2 names netlify/);
  assert.deepEqual(stackProblems(undefined), []);
  assert.deepEqual(stackProblems(['node', 'vercel']), []);
  assert.match(stackProblems(['node', 'netlify'])[0], /names netlify, which is not in keel's vocabulary/);
  assert.match(stackProblems('node')[0], /must be a list/);
  assert.throws(() => shapeLessonsView('# x\n', { stack: ['netlify'] }, { catalogue: CATALOGUE }), /\.keel\/keel\.json: "stack" names netlify/);
});

test('the Where column: parsed when present, absent from a project\'s four columns, and no fingerprint moves', async () => {
  const five = parseLessons(CATALOGUE);
  assert.equal(five.where, 4);
  assert.deepEqual(five.rows.map(r => [r.n, r.guard, r.where]), [[1, 'A measured deadline.', ''], [2, 'A cache-busting test.', 'vercel'], [3, 'A lint on the step.', '`gcp`'], [4, 'A scan.', 'vercel, gcp']]);
  assert.deepEqual(whereTags('`vercel`, gcp'), ['vercel', 'gcp']);
  // Every row of keel's catalogue: the fingerprint (and guard) of its five-column
  // line is the one its four-column line had, and tagging it moves nothing.
  const text = await read('docs/lessons.md');
  const four = text.split('\n').map(l => l.endsWith(' | Where |') ? l.slice(0, -' Where |'.length)
    : l === '| --- | --- | --- | --- | --- |' ? '| --- | --- | --- | --- |'
    : /^\| \d+ \|.* \| \|$/.test(l) ? l.slice(0, -2) : l).join('\n');
  const tagged = text.replace(/ \| \|$/gm, ' | vercel, gcp |');
  const prints = t => parseLessons(t).rows.map(r => [lessonFingerprint('dalmaer/keel', r), r.guard]);
  assert.equal(parseLessons(four).where, -1, 'the four-column form has no Where');
  assert.ok(prints(text).length >= 56);
  assert.deepEqual(prints(text), prints(four));
  assert.deepEqual(prints(tagged), prints(four));
  // A pipe the guard did not escape stays in the guard, with Where after it.
  const piped = parseLessons(CATALOGUE.replace('A scan. | vercel, gcp', 'A scan | then a lint. | vercel, gcp'));
  assert.deepEqual([piped.rows[3].guard, piped.rows[3].where], ['A scan | then a lint.', 'vercel, gcp']);
});

test('detection: vercel.json and a workflow are vercel and github-actions; neither is neither', async t => {
  const tagged = await repo(t, { 'vercel.json': '{}\n', '.github/workflows/ci.yml': 'on: push\n' });
  assert.deepEqual((await detect(tagged)).map(d => d.tag), ['vercel', 'github-actions']);
  const bare = await repo(t, { 'README.md': '# Acme\n' });
  assert.deepEqual(await detect(bare), []);
  const full = await repo(t, {
    'package.json': JSON.stringify({ name: 'acme', dependencies: { react: '^19.0.0' } }),
    '.vercel/': '', 'firebase.json': '{}', 'cloudbuild.yaml': 'steps: []\n',
    '.github/workflows/pages.yaml': 'jobs:\n  deploy:\n    steps:\n      - uses: actions/deploy-pages@v4\n',
  });
  assert.deepEqual(await detect(full), [
    { tag: 'node', evidence: ['package.json'] },
    { tag: 'web', evidence: ['depends on react'] },
    { tag: 'vercel', evidence: ['.vercel/'] },
    { tag: 'gcp', evidence: ['cloudbuild.yaml', 'firebase.json'] },
    { tag: 'firebase', evidence: ['firebase.json'] },
    { tag: 'github-pages', evidence: ['workflow uses actions/deploy-pages'] },
    { tag: 'github-actions', evidence: ['.github/workflows/*.yaml'] },
  ]);
  // A workflow that only names the action in a comment is not using it.
  const comment = await repo(t, { '.github/workflows/ci.yml': '# someday: actions/deploy-pages\non: push\n' });
  assert.deepEqual((await detect(comment)).map(d => d.tag), ['github-actions']);
  const found = await detect(tagged);
  assert.deepEqual(disagreement(['vercel', 'github-actions'], found), { missing: [], unbacked: [] });
  assert.deepEqual(disagreement(['gcp', 'vercel'], found), { missing: ['github-actions'], unbacked: ['gcp'] });
});

test('the view: universal rows reach every project, a tagged row only its stack, in catalogue order', () => {
  const ids = stack => viewRows(CATALOGUE, stack).rows.map(r => r.n);
  assert.deepEqual(ids(['node', 'vercel']), [1, 2, 4], 'a vercel project: universal and vercel rows, no gcp-only row');
  assert.deepEqual(ids(['node', 'gcp']), [1, 3, 4], 'a gcp project: universal and gcp rows, no vercel-only row');
  assert.deepEqual(ids(['node']), [1], 'an untagged row reaches every project');
  assert.deepEqual(ids([]), [1], 'no stack: the universal rows');
  const view = shapeLessonsView('# Lessons from keel\n', { stack: ['vercel'] }, { catalogue: CATALOGUE });
  const lines = CATALOGUE.split('\n');
  assert.ok(view.includes(`${lines[2]}\n${lines[3]}\n${lines[4]}\n${lines[5]}\n${lines[7]}\n`), 'the header and rows exactly as the catalogue has them');
  assert.ok(!view.includes('Cloud Build'));
  assert.match(view, /`vercel`\. 3 of keel's lessons apply/);
});

test('keel\'s own docs/keel-lessons.md is the catalogue filtered for keel\'s stack, and a changed stack is stale', async t => {
  const config = JSON.parse(await read('.keel/keel.json'));
  assert.deepEqual(config.stack, ['node', 'github-actions']);
  const view = await read(VIEW);
  const { rows } = viewRows(await read('docs/lessons.md'), config.stack);
  assert.equal(parseLessons(view).rows.length, rows.length);
  assert.deepEqual(parseLessons(view).rows.map(r => r.n), rows.map(r => r.n));
  const f = (await load()).get('lessons').files.find(x => x.path === VIEW);
  assert.equal(f.kind, 'managed');
  assert.equal(fill(f.template, config, f.path), view, 'render --self --check would catch any difference');

  // A project's view goes stale when its stack changes; render --check names it.
  const dir = await scratch(t);
  await mkdir(join(dir, '.keel'), { recursive: true });
  const acme = { name: 'Acme', tagline: 'Acme. A probe.', practices: ['agents-md', 'lessons'], stack: ['node'] };
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify(acme));
  await writeFile(join(dir, 'AGENTS.md'), '# Acme\n\n<!-- keel:begin agents-md -->\n<!-- keel:end agents-md -->\n\n<!-- keel:begin lessons -->\n<!-- keel:end lessons -->\n');
  await render(dir);
  assert.equal((await render(dir, { check: true })).ok, true);
  assert.match(await readFile(join(dir, 'AGENTS.md'), 'utf8'), /`docs\/keel-lessons\.md`/, 'the lessons block names the view');
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ ...acme, stack: ['node', 'vercel'] }));
  const stale = await render(dir, { check: true });
  assert.deepEqual(stale.differs.map(e => e.path), [VIEW]);
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ ...acme, stack: ['netlify'] }));
  await assert.rejects(render(dir), /"stack" names netlify/);
});

test('keel learn appends a row with an empty Where to keel\'s catalogue, and four cells to a four-column table', async () => {
  const { appendLesson } = await import('../lib/learn.mjs');
  const row = { shape: 'A probe.', cost: 'Acme time.', guard: 'A test.', project: 'acme/notes' };
  const five = appendLesson(CATALOGUE, row);
  assert.equal(five.n, 5);
  const added = parseLessons(five.text).rows.at(-1);
  assert.deepEqual([added.n, added.guard, added.where], [5, 'A test.', '']);
  assert.match(five.text, /\| 5 \| \*\*A probe\.\*\* \*\(acme\/notes\)\* \| Acme time\. \| A test\. \| \|\n/);
  const four = appendLesson(CATALOGUE.replace(' Where |', '').replace('| --- | --- | --- | --- | --- |', '| --- | --- | --- | --- |'), row);
  assert.match(four.text, /\| A test\. \|\n/);
  assert.doesNotMatch(four.text, /\| A test\. \| \|/);
  assert.deepEqual(viewRows(five.text, []).rows.map(r => r.n), [1, 5], 'a new row is universal until a tag pass narrows it');
});
