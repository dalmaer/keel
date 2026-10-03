// The CLI's surface: every verb is announced to agents, every verb speaks JSON,
// and keel installs from a checkout with no build step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { run } from './helpers/run.mjs';
import { mkdtemp, readFile, rm, cp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verbs, FLAGS, GUIDE, COLD_START_LIMIT, parseGuide, surfaceGaps } from '../lib/cli.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(KEEL, 'bin', 'keel.mjs');
const keel = (args, cwd = KEEL, bin = BIN, env = process.env) => {
  const r = bin === BIN
    ? run(process.execPath, [bin, ...args], { cwd, env })
    : run(bin, args, { cwd, env });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const names = () => [...verbs.keys(), ...FLAGS.map(f => f.name)];

/** keel's working tree (tracked and untracked, minus ignored), copied to `dir`. */
async function copyTree(dir) {
  const files = execFileSync('git', ['-C', KEEL, 'ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8' })
    .split('\0').filter(Boolean);
  for (const f of files) {
    await mkdir(dirname(join(dir, f)), { recursive: true });
    await cp(join(KEEL, f), join(dir, f), { verbatimSymlinks: true }).catch(e => {
      if (e.code !== 'ENOENT') throw e; // deleted in the working tree but still tracked
    });
  }
  return dir;
}

test('keel next --json equals the roadmap script\'s next', () => {
  const ours = keel(['next', '--json']);
  assert.equal(ours.code, 0, ours.err);
  const script = run(process.execPath, ['scripts/roadmap.mjs', '--json'], { cwd: KEEL });
  assert.equal(script.status, 0, script.stderr);
  assert.deepEqual(JSON.parse(ours.out), JSON.parse(script.stdout).next);
});

test('every registered verb and flag is announced in the cold start', async () => {
  assert.deepEqual(surfaceGaps(names(), await readFile(GUIDE, 'utf8')), []);
});

test('a verb registered without a guide line fails the surface check', async () => {
  const guide = await readFile(GUIDE, 'utf8');
  verbs.set('frobnicate', { summary: 'temp', usage: 'keel frobnicate', run: async () => ({ data: null, text: '' }) });
  try {
    assert.deepEqual(surfaceGaps(names(), guide), ['frobnicate']);
    // A prefix of an announced verb does not count as announced.
    verbs.set('stat', verbs.get('frobnicate'));
    assert.deepEqual(surfaceGaps(names(), guide), ['frobnicate', 'stat']);
  } finally {
    verbs.delete('frobnicate');
    verbs.delete('stat');
  }
  assert.deepEqual(surfaceGaps(names(), guide), []);
});

test('the guide lists only registered verbs, and names every topic', async () => {
  const { coldStart, topics } = parseGuide(await readFile(GUIDE, 'utf8'));
  const announced = [...coldStart.matchAll(/^- `keel ([^`]+?)`/gm)].map(m => m[1]);
  for (const line of announced) assert.ok(names().some(n => line === n || line.startsWith(`${n} `)), `unregistered: keel ${line}`);
  assert.ok(topics.length >= 1);
  for (const t of topics) assert.match(coldStart, new RegExp(`\`${t.slug}\``), `cold start does not name topic ${t.slug}`);
});

test(`the cold start stays under ${COLD_START_LIMIT} characters`, async () => {
  const { coldStart } = parseGuide(await readFile(GUIDE, 'utf8'));
  assert.ok(coldStart.length < COLD_START_LIMIT, `cold start is ${coldStart.length} characters`);
  const r = keel(['--agent-help']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.trim(), coldStart);
});

test('agent-help opens a topic, and all', () => {
  const t = keel(['--agent-help', 'render', '--json']);
  assert.equal(t.code, 0, t.err);
  assert.equal(JSON.parse(t.out).slug, 'render');
  const all = keel(['--agent-help', 'all']);
  assert.equal(all.code, 0);
  assert.match(all.out, /## coming/);
  const bad = keel(['--agent-help', 'nope', '--json']);
  assert.equal(bad.code, 2);
  assert.match(JSON.parse(bad.out).error, /no agent-help topic/);
});

test('--json parses for every verb and flag; human text never mixes in', async () => {
  const dir = await copyTree(await mkdtemp(join(tmpdir(), 'keel-json-')));
  try {
    // A verb that cannot run bare gets the least it needs; init makes a commit,
    // so it gets a git identity (CI has none).
    // learn bare reads GitHub; its JSON is covered by tests/learn.test.mjs against a stub gh.
    const needs = { init: ['fresh', '--description', 'Acme is a test project.'], learn: ['render'] };
    const env = { ...process.env, GIT_AUTHOR_NAME: 'Acme', GIT_AUTHOR_EMAIL: 'acme@acme.test',
      GIT_COMMITTER_NAME: 'Acme', GIT_COMMITTER_EMAIL: 'acme@acme.test' };
    for (const name of names()) {
      const r = keel([...name.split(' '), ...(needs[name] ?? []), '--json'], dir, BIN, env);
      assert.equal(r.code, 0, `${name}: ${r.err}${r.out}`);
      assert.doesNotThrow(() => JSON.parse(r.out), `${name} --json did not parse: ${r.out}`);
      assert.equal(r.err, '', `${name} wrote to stderr`);
    }
    // render onto an unchanged copy rewrites nothing.
    await rm(join(dir, 'fresh'), { recursive: true, force: true });
    assert.equal(JSON.parse(keel(['render', '--check', '--json'], dir).out).ok, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('an error under --json is JSON, with a non-zero exit', () => {
  for (const args of [['frobnicate', '--json'], ['goal', '--json'], ['next', 'extra', '--json'], ['render', '--into', '--json']]) {
    const r = keel(args);
    assert.notEqual(r.code, 0, args.join(' '));
    assert.equal(typeof JSON.parse(r.out).error, 'string', args.join(' '));
  }
  const text = keel(['frobnicate']);
  assert.equal(text.code, 2);
  assert.equal(text.out, '');
  assert.match(text.err, /^keel: unknown verb/);
});

test('render --check exits 1 and names the drift', async () => {
  const dir = await copyTree(await mkdtemp(join(tmpdir(), 'keel-drift-')));
  try {
    await writeFile(join(dir, 'scripts/roadmap.mjs'), '// drifted\n');
    const r = keel(['render', '--check', '--json'], dir);
    assert.equal(r.code, 1);
    const out = JSON.parse(r.out);
    assert.equal(out.ok, false);
    assert.ok(out.differs.includes('scripts/roadmap.mjs'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('outside any project: a clear error, exit 2', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'keel-none-'));
  try {
    for (const verb of ['status', 'next', 'goal list', 'render']) {
      const r = keel([...verb.split(' ')], dir);
      assert.equal(r.code, 2, verb);
      assert.match(r.err, /not in a keel project: no \.keel\/keel\.json/);
      const j = keel([...verb.split(' '), '--json'], dir);
      assert.equal(j.code, 2);
      assert.match(JSON.parse(j.out).error, /not in a keel project/);
    }
    // Verbs that need no project still work there.
    assert.equal(keel(['--version'], dir).code, 0);
    assert.equal(keel(['help'], dir).code, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('--version reports the CLI, its commit and the practice version', async () => {
  const pkg = JSON.parse(await readFile(join(KEEL, 'package.json'), 'utf8'));
  const j = JSON.parse(keel(['--version', '--json']).out);
  assert.equal(j.cli, pkg.version);
  assert.equal(j.practice, pkg.version);
  assert.match(j.commit ?? '', /^[0-9a-f]{4,}$/);
  assert.match(keel(['--version']).out, /^keel \S+ \([0-9a-f]+\) practice \S+\n$/);
});

test('installs from a checkout with no build step, on a machine that has never seen keel', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'keel-install-'));
  try {
    // The working tree, not HEAD: an uncommitted bin/ would be missing from a clone.
    const src = await copyTree(join(tmp, 'src'));
    const prefix = join(tmp, 'prefix'), home = join(tmp, 'home');
    await mkdir(home);
    const env = { ...process.env, HOME: home, npm_config_cache: join(tmp, 'npm-cache'), npm_config_userconfig: join(home, '.npmrc') };
    const install = run('npm', ['install', '-g', src, '--prefix', prefix, '--no-audit', '--no-fund', '--offline'], { env });
    assert.equal(install.status, 0, install.stderr);
    const bin = join(prefix, 'bin', 'keel');
    const project = await copyTree(join(tmp, 'project')); // a copy of keel, run from the installed bin
    const v = keel(['--version'], project, bin, env);
    assert.equal(v.code, 0, v.err);
    assert.match(v.out, /^keel \S+ \(no git\) practice \S+/);
    const help = keel(['--agent-help'], project, bin, env);
    assert.equal(help.code, 0, help.err);
    assert.match(help.out, /keel --agent-help/);
    const next = keel(['next', '--json'], project, bin, env);
    assert.equal(next.code, 0, next.err);
    assert.deepEqual(JSON.parse(next.out), JSON.parse(keel(['next', '--json']).out));
  } finally { await rm(tmp, { recursive: true, force: true }); }
});
