// keel lessons: a project's new lesson rows, drift and practice commits go
// home as issues, once each. gh is stubbed at the boundary the way real gh
// behaves (lesson 8): `label list` prints tab-separated rows, `issue list
// --json` prints a JSON array of the asked fields, `issue create` prints the
// new URL. Fixtures are synthetic: Acme Notes, made by keel init.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { run as runCmd, cleanEnv } from './helpers/run.mjs';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, lstat, readlink, rm, writeFile, appendFile, realpath, chmod, copyFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '../lib/init.mjs';
import { lessons, practicePaths, parseLessons, normaliseShape, fingerprintOf, DATA_LINE, SENT } from '../lib/lessons.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(KEEL, 'bin', 'keel.mjs');
const FIXTURES = join(KEEL, 'tests', 'fixtures', 'lessons');
const ENV = {
  ...cleanEnv(),
  GIT_AUTHOR_NAME: 'Acme Builder', GIT_AUTHOR_EMAIL: 'builder@acme.test',
  GIT_COMMITTER_NAME: 'Acme Builder', GIT_COMMITTER_EMAIL: 'builder@acme.test',
  GIT_CONFIG_NOSYSTEM: '1',
};
const PROJECT = 'acme/notes', TO = 'acme/keel';
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: ENV, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const hex8 = s => createHash('sha256').update(s).digest('hex').slice(0, 8);

async function scratch(t, prefix = 'keel-lessons-') {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** Every file, link and mode under dir, .git aside. */
async function treeHash(dir) {
  const h = createHash('sha256');
  const walk = async d => {
    for (const e of (await readdir(d, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === '.git') continue;
      const p = join(d, e.name), rel = relative(dir, p);
      const i = await lstat(p);
      if (i.isSymbolicLink()) h.update(`L ${rel} ${await readlink(p)}\n`);
      else if (i.isDirectory()) { h.update(`D ${rel}\n`); await walk(p); }
      else h.update(`F ${rel} ${createHash('sha256').update(await readFile(p)).digest('hex')}\n`);
    }
  };
  await walk(dir);
  return h.digest('hex');
}

/**
 * Acme Notes, made by keel init, then: two lesson rows (a practice commit), an
 * edit to the managed conduct skill (drift and a practice commit), a
 * keel-made commit touching AGENTS.md (skipped), and a code-only commit (not
 * practice-shaped).
 */
async function acme(t) {
  const dir = join(await scratch(t), 'acme-notes');
  await init({ dir, name: 'Acme Notes', description: 'Acme Notes keeps meeting notes as plain files.', kind: 'node', repo: PROJECT },
    { version: { cli: '0.1.0', commit: null, practice: '0.1.0' }, env: ENV });
  await copyFile(join(FIXTURES, 'lessons.md'), join(dir, 'docs/lessons.md'));
  git(dir, 'commit', '-qam', 'lessons: the stale cache and the piped gate');
  const lessonsCommit = git(dir, 'rev-parse', 'HEAD');
  await appendFile(join(dir, '.agents/skills/conduct/SKILL.md'), '\nAcme: ask before running the full suite twice.\n');
  git(dir, 'commit', '-qam', 'conduct: ask before the full suite runs twice');
  const skillCommit = git(dir, 'rev-parse', 'HEAD');
  await appendFile(join(dir, 'AGENTS.md'), '\n<!-- keel-made -->\n');
  git(dir, 'commit', '-qam', 'keel update: practice 0.0.0 → 0.1.0');
  const keelCommit = git(dir, 'rev-parse', 'HEAD');
  await writeFile(join(dir, 'notes.mjs'), 'export const notes = [];\n');
  git(dir, 'add', 'notes.mjs');
  git(dir, 'commit', '-qm', 'notes: the first store');
  return { dir, lessonsCommit, skillCommit, keelCommit };
}

/** A gh that behaves like gh, over a JSON state file. Returns { gh, log, state }. */
async function stubGh(t, seed = { labels: ['bug'], issues: [] }) {
  const dir = await scratch(t, 'keel-gh-');
  const log = join(dir, 'gh.log'), state = join(dir, 'state.json'), gh = join(dir, 'gh');
  await writeFile(state, JSON.stringify(seed));
  await writeFile(gh, `#!${process.execPath}
const fs = require('node:fs');
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(argv) + '\\n');
const s = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8'));
const opt = f => argv[argv.indexOf(f) + 1];
const save = () => fs.writeFileSync(${JSON.stringify(state)}, JSON.stringify(s));
const [a, b] = argv;
if (a === 'label' && b === 'list') { for (const l of s.labels) console.log(l + '\\t\\t#ededed'); }
else if (a === 'label' && b === 'create') { s.labels.push(argv[2]); save(); }
else if (a === 'issue' && b === 'list') {
  // GitHub search matches words, not exact lines: any issue mentioning the phrase.
  const q = (opt('--search') ?? '').replace(/^"|"$/g, '');
  const fields = opt('--json').split(',');
  const hits = s.issues.filter(i => i.labels.includes(opt('--label')) && i.body.includes(q));
  console.log(JSON.stringify(hits.map(i => Object.fromEntries(fields.map(f => [f, i[f]])))));
}
else if (a === 'issue' && b === 'create') {
  const url = 'https://github.com/' + opt('-R') + '/issues/' + (s.issues.length + 1);
  s.issues.push({ url, title: opt('--title'), body: opt('--body'), labels: [opt('--label')] });
  save();
  console.log(url);
}
else { console.error('stub gh: unknown ' + argv.join(' ')); process.exit(1); }
`);
  await chmod(gh, 0o755);
  return {
    gh, env: { ...ENV, KEEL_GH: gh },
    calls: async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(l => JSON.parse(l)),
    state: async () => JSON.parse(await readFile(state, 'utf8')),
  };
}

const keel = (args, cwd, env = { ...ENV, KEEL_GH: '/nonexistent/gh' }) => { // never the real gh
  const r = runCmd(process.execPath, [BIN, ...args], { cwd, env });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const send = (dir, env, extra = {}) => lessons({ dir, to: TO, yes: true, ...extra }, { cliRoot: KEEL, env, now: '2026-10-02T00:00:00.000Z' });

const SHAPE1 = "**A cache that outlives its key serves yesterday's answer.** *(acme 2)*";

test('parseLessons: a numbered table, escaped pipes, and a three-column table numbered by position', async () => {
  const numbered = parseLessons(await readFile(join(FIXTURES, 'lessons.md'), 'utf8'));
  assert.equal(numbered.numbered, true);
  assert.deepEqual(numbered.rows.map(r => r.n), [1, 2]);
  assert.equal(numbered.rows[0].shape, SHAPE1);
  assert.match(numbered.rows[1].shape, /`a \\\| b`/, 'an escaped pipe stays in its cell');
  assert.equal(numbered.rows[1].guard, 'Gates read exit codes, never a tail. *Planned:* phase 4.');
  const three = parseLessons(await readFile(join(FIXTURES, 'three-columns.md'), 'utf8'));
  assert.equal(three.numbered, false);
  assert.deepEqual(three.rows.map(r => [r.n, r.shape]), [[1, 'A timer that drifts is trusted as a clock'], [2, 'Offline proof is not device proof']]);
  assert.deepEqual(parseLessons('# Lessons\n\n| # | The shape of it | What it cost | Guard |\n| --- | --- | --- | --- |\n').rows, []);
});

test('a dry run lists exactly the new lessons, drift and practice commits, calls no gh, writes nothing, exits 3', async t => {
  const { dir, lessonsCommit, skillCommit, keelCommit } = await acme(t);
  const stub = await stubGh(t);
  const before = await treeHash(dir);
  const r = keel(['lessons', '--dry-run', '--json'], dir, stub.env);
  assert.equal(r.code, 3, r.err + r.out);
  const out = JSON.parse(r.out);
  assert.equal(out.to, 'dalmaer/keel-inbox', 'the default target is the CLI checkout\'s inbox');
  assert.equal(out.project, PROJECT);
  assert.deepEqual(out.counts, { lesson: 2, drift: 1, practice: 2 });
  const skill = await readFile(join(dir, '.agents/skills/conduct/SKILL.md'), 'utf8');
  const shape2 = parseLessons(await readFile(join(dir, 'docs/lessons.md'), 'utf8')).rows[1].shape;
  assert.deepEqual(out.items.map(i => i.fingerprint), [
    `${PROJECT}/lesson/1/${hex8(normaliseShape(SHAPE1))}`,
    `${PROJECT}/lesson/2/${hex8(normaliseShape(shape2))}`,
    `${PROJECT}/drift/.agents/skills/conduct/SKILL.md/${hex8(skill)}`,
    `${PROJECT}/commit/${lessonsCommit}`,
    `${PROJECT}/commit/${skillCommit}`,
  ]);
  assert.ok(!out.items.some(i => i.fingerprint.includes(keelCommit)), 'a keel-made commit is not sent');
  assert.equal(out.items[0].title, "lesson(acme/notes): A cache that outlives its key serves yesterday's answer.");
  assert.match(out.items[2].body, /keep the project's version, take keel's, or adopt it upstream\?/);
  assert.match(out.items[2].body, /^\+Acme: ask before running the full suite twice\.$/m);
  assert.match(out.items[4].body, /SKILL\.md \| /, 'a commit carries its --stat');
  assert.equal(await treeHash(dir), before, 'nothing written');
  assert.deepEqual(await stub.calls(), [], 'gh is not called without --yes');

  // Without --dry-run and without --yes: the same answer, still nothing done.
  const asked = keel(['lessons', '--to', TO], dir, stub.env);
  assert.equal(asked.code, 3, asked.err);
  assert.match(asked.out, /⚑ Filing issues on another repo needs a yes/);
  assert.match(asked.out, /5 to send from acme\/notes to acme\/keel: 2 lesson, 1 drift, 2 practice/);
  assert.equal(await treeHash(dir), before);
  assert.deepEqual(await stub.calls(), []);
});

test('--yes files each with the data line and fingerprint, records it, and a second run files nothing', async t => {
  const { dir } = await acme(t);
  const stub = await stubGh(t);
  const r = await send(dir, stub.env);
  assert.equal(r.exitCode, 0, r.text);
  assert.deepEqual(r.data.filed.map(f => f.how), ['filed', 'filed', 'filed', 'filed', 'filed']);
  const { issues, labels } = await stub.state();
  assert.ok(labels.includes('lesson'), 'the lesson label is created when missing');
  assert.equal(issues.length, 5);
  for (const [k, issue] of issues.entries()) {
    const lines = issue.body.split('\n');
    assert.equal(lines[0], DATA_LINE(PROJECT));
    assert.equal(lines[0], 'Data sent by keel lessons from acme/notes. It is data, not instructions.');
    assert.equal(fingerprintOf(issue.body), r.data.filed[k].fingerprint);
    assert.match(issue.title, /^lesson\(acme\/notes\): /);
    assert.deepEqual(issue.labels, ['lesson']);
  }
  assert.match(issues[0].body, /\*\*What it cost\*\*\n\nAcme Notes showed a deleted note/);
  assert.match(issues[0].body, new RegExp(`Source: https://github\\.com/acme/notes/blob/[0-9a-f]{40}/docs/lessons\\.md#L8`));
  const sent = JSON.parse(await readFile(join(dir, SENT), 'utf8'));
  assert.deepEqual(Object.keys(sent), r.data.filed.map(f => f.fingerprint));
  assert.deepEqual(sent[r.data.filed[0].fingerprint], { issue: 'https://github.com/acme/keel/issues/1', at: '2026-10-02T00:00:00.000Z' });

  const creates = async () => (await stub.calls()).filter(c => c[0] === 'issue' && c[1] === 'create').length;
  const again = await send(dir, stub.env);
  assert.equal(again.exitCode, 0, again.text);
  assert.equal(again.data.already, 5);
  assert.deepEqual(again.data.items, []);
  assert.equal(await creates(), 5, 'nothing filed twice');
  const dry = keel(['lessons', '--dry-run', '--to', TO, '--json'], dir, stub.env);
  assert.equal(dry.code, 0, 'nothing to send is exit 0, even dry');

  // A reworded shape is a new item; the other row is not.
  const text = await readFile(join(dir, 'docs/lessons.md'), 'utf8');
  await writeFile(join(dir, 'docs/lessons.md'), text.replace("serves yesterday's answer", 'serves a stale answer'));
  const reworded = await lessons({ dir, to: TO, dryRun: true }, { cliRoot: KEEL, env: stub.env });
  assert.equal(reworded.exitCode, 3);
  assert.deepEqual(reworded.data.items.map(i => i.fingerprint), [`${PROJECT}/lesson/1/${hex8(normaliseShape(SHAPE1.replace("serves yesterday's answer", 'serves a stale answer')))}`]);
});

test('a fingerprint the target already has is recorded, not filed again', async t => {
  const { dir } = await acme(t);
  const fp = `${PROJECT}/lesson/1/${hex8(normaliseShape(SHAPE1))}`;
  // Filed from another machine; and a decoy whose body mentions the fingerprint but carries another.
  const stub = await stubGh(t, { labels: ['lesson'], issues: [
    { url: 'https://github.com/acme/keel/issues/7', title: 'decoy', body: `fingerprint: ${PROJECT}/other\nsee ${fp}`, labels: ['lesson'] },
    { url: 'https://github.com/acme/keel/issues/9', title: 'lesson(acme/notes): …', body: `${DATA_LINE(PROJECT)}\n\nfingerprint: ${fp}\n`, labels: ['lesson'] },
  ] });
  const r = await send(dir, stub.env);
  assert.equal(r.exitCode, 0, r.text);
  const first = r.data.filed.find(f => f.fingerprint === fp);
  assert.deepEqual(first, { kind: 'lesson', fingerprint: fp, issue: 'https://github.com/acme/keel/issues/9', how: 'found' });
  assert.equal(r.data.filed.filter(f => f.how === 'filed').length, 4);
  const calls = await stub.calls();
  assert.ok(!calls.some(c => c[1] === 'create' && c[0] === 'label'), 'an existing label is not created');
  assert.equal((await stub.state()).issues.filter(i => fingerprintOf(i.body) === fp).length, 1);
  const sent = JSON.parse(await readFile(join(dir, SENT), 'utf8'));
  assert.equal(sent[fp].issue, 'https://github.com/acme/keel/issues/9');
});

test('keel itself refuses: keel is home', () => {
  const r = keel(['lessons', '--json'], KEEL, { ...ENV, KEEL_GH: '/nonexistent/gh' });
  assert.equal(r.code, 0, r.err);
  const out = JSON.parse(r.out);
  assert.equal(out.self, true);
  assert.deepEqual(out.items, []);
  assert.match(keel(['lessons'], KEEL).out, /keel is home — use keel learn/);
});

test('--since chooses the base; a bad ref or target is a usage error', async t => {
  const { dir, skillCommit, lessonsCommit } = await acme(t);
  const r = await lessons({ dir, to: TO, since: lessonsCommit }, { cliRoot: KEEL, env: ENV });
  assert.deepEqual(r.data.items.filter(i => i.kind === 'practice').map(i => i.fingerprint), [`${PROJECT}/commit/${skillCommit}`]);
  const bad = keel(['lessons', '--since', 'no-such-ref', '--to', TO, '--json'], dir);
  assert.equal(bad.code, 2);
  assert.match(JSON.parse(bad.out).error, /--since no-such-ref: not a commit/);
  assert.equal(keel(['lessons', '--to', 'not a repo', '--json'], dir).code, 2);
  assert.equal(keel(['lessons', 'extra', '--json'], dir).code, 2);
});

test('the target: --to, else the CLI checkout\'s inbox, else its repo; with inbox set, --yes files into the inbox', async t => {
  const { dir } = await acme(t);
  const cli = await scratch(t, 'keel-cli-');
  const config = async cfg => writeFile(join(cli, '.keel', 'keel.json'), JSON.stringify({ name: 'Acme Keel', keel: 'self', ...cfg }));
  await mkdir(join(cli, '.keel'), { recursive: true });
  const to = async (extra = {}) => (await lessons({ dir, dryRun: true, ...extra }, { cliRoot: cli, env: ENV })).data.to;

  await config({ repo: 'acme/keel', inbox: 'acme/keel-inbox' });
  assert.equal(await to(), 'acme/keel-inbox', 'the inbox wins over the repo');
  assert.equal(await to({ to: 'acme/elsewhere' }), 'acme/elsewhere', '--to wins over both');
  await config({ repo: 'acme/keel' });
  assert.equal(await to(), 'acme/keel', 'no inbox: the repo, as before');
  await config({});
  await assert.rejects(to(), /names no inbox or repo/);

  await config({ repo: 'acme/keel', inbox: 'acme/keel-inbox' });
  const stub = await stubGh(t);
  const r = await lessons({ dir, yes: true }, { cliRoot: cli, env: stub.env, now: '2026-10-02T00:00:00.000Z' });
  assert.equal(r.exitCode, 0, r.text);
  const creates = (await stub.calls()).filter(c => c[0] === 'issue' && c[1] === 'create');
  assert.equal(creates.length, 5);
  for (const c of creates) assert.equal(c[c.indexOf('-R') + 1], 'acme/keel-inbox');
  assert.ok(Object.values(JSON.parse(await readFile(join(dir, SENT), 'utf8'))).every(s => s.issue.startsWith('https://github.com/acme/keel-inbox/issues/')));
});

test('the stack view moves nothing keel lessons reads: the own table, its fingerprints and sent.json stay byte-identical, and nothing new is sent', async t => {
  const { dir, lessonsCommit } = await acme(t);
  const stub = await stubGh(t);
  // Render never writes over the project's edit to the skill; take keel's back first.
  git(dir, 'checkout', lessonsCommit, '--', '.agents/skills/conduct/SKILL.md');
  git(dir, 'commit', '-qam', 'conduct: keel\'s skill again');
  assert.equal((await send(dir, stub.env)).exitCode, 0);
  const { render } = await import('../lib/practices.mjs');
  const own = await readFile(join(dir, 'docs/lessons.md'), 'utf8');
  const sent = await readFile(join(dir, SENT), 'utf8');
  const prints = async () => (await lessons({ dir, to: TO, dryRun: true }, { cliRoot: KEEL, env: stub.env })).data;
  const before = await prints();
  assert.deepEqual(before.items, []);

  // The project declares a stack; render rewrites docs/keel-lessons.md for it.
  const cfg = JSON.parse(await readFile(join(dir, '.keel/keel.json'), 'utf8'));
  await writeFile(join(dir, '.keel/keel.json'), `${JSON.stringify({ ...cfg, stack: ['node', 'vercel', 'github-actions'] }, null, 2)}\n`);
  await writeFile(join(dir, 'vercel.json'), '{}\n');
  const done = await render(dir);
  assert.ok(done.entries.some(e => e.path === 'docs/keel-lessons.md' && e.status === 'update'), 'the view was rewritten');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'keel update: the stack');

  assert.equal(await readFile(join(dir, 'docs/lessons.md'), 'utf8'), own, 'the project\'s own table is byte-identical');
  assert.equal(await readFile(join(dir, SENT), 'utf8'), sent, '.keel/sent.json is byte-identical');
  const after = await prints();
  assert.deepEqual(after.items, [], 'keel lessons sends nothing new');
  assert.equal(after.already, before.already);
  assert.equal(parseLessons(await readFile(join(dir, 'docs/lessons.md'), 'utf8')).where, -1, 'a project\'s table keeps four columns');
});


test('guide review: lessons includes canonical guide commits and keeps raw config paths compatible', async t => {
  const dir = await scratch(t);
  await mkdir(join(dir, '.keel'));
  const cfg = { name: 'Acme', repo: PROJECT, guide: 'AGENTS.md', practices: ['agents-md'] };
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify(cfg));
  await writeFile(join(dir, 'CLAUDE.md'), '# Acme\n');
  await symlink('CLAUDE.md', join(dir, 'AGENTS.md'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'Acme adoption');
  await appendFile(join(dir, 'CLAUDE.md'), '\nAcme guide correction.\n');
  git(dir, 'commit', '-qam', 'guide: Acme correction');
  const sha = git(dir, 'rev-parse', 'HEAD'), before = await treeHash(dir);
  const stub = await stubGh(t);
  const result = await lessons({ dir, to: TO, dryRun: true }, { cliRoot: KEEL, env: stub.env });
  assert.deepEqual(result.data.items.filter(i => i.kind === 'practice').map(i => i.fingerprint), [`${PROJECT}/commit/${sha}`]);
  assert.ok(practicePaths(cfg).includes('AGENTS.md'));
  assert.ok(!practicePaths(cfg).includes('CLAUDE.md'));
  assert.ok(practicePaths(cfg, dir).includes('CLAUDE.md'));
  assert.equal(cfg.guide, 'AGENTS.md');
  assert.equal(await treeHash(dir), before);
  assert.deepEqual(await stub.calls(), []);
});
