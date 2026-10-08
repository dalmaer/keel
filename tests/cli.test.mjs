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
import { verbs, FLAGS, GUIDE, COLD_START_LIMIT, parseGuide, surfaceGaps, announced } from '../lib/cli.mjs';

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
  for (const line of announced(coldStart)) assert.ok(names().some(n => line === n || line.startsWith(`${n} `)), `unregistered: keel ${line}`);
  assert.ok(topics.length >= 1);
  for (const t of topics) assert.match(coldStart, new RegExp(`\`${t.slug}\``), `cold start does not name topic ${t.slug}`);
});

test('a word list announces one command per word', () => {
  assert.deepEqual(announced('- `keel goal list|show` — goals\n- `keel next` — n\n- `keel doctor --fix <path> restore|eject`'),
    ['goal list', 'goal show', 'next', 'doctor --fix <path> restore', 'doctor --fix <path> eject']);
  assert.deepEqual(surfaceGaps(['goal list', 'goal show', 'goal add'], '- `keel goal list|show` — goals'), ['goal add']);
});

// The cap is "one screen". It was 2,500 at seven verbs; at sixteen (phase 9),
// with each verb family on one line and details in topics, it is 3,200.
// Near the cap is said before it is a failure (phase 40's retro): above 95%
// the test still passes, but prints the size and what to trim. Over the cap
// stays red. A function of two numbers, so it is deterministic.
export function coldStartHeadroom(length, limit = COLD_START_LIMIT) {
  if (length < limit * 0.95) return null;
  return `cold start is ${length}/${limit} characters (${(length / limit * 100).toFixed(1)}%, ${limit - length} left): `
    + 'before adding to lib/agent-guide.md, trim it — move a detail into a topic, or fold a verb family onto one line';
}

test('the cold start\'s headroom: silent under 95% of the cap, said from 95%', () => {
  assert.equal(coldStartHeadroom(3039, 3200), null);
  assert.match(coldStartHeadroom(3040, 3200), /^cold start is 3040\/3200 characters \(95\.0%, 160 left\): .*trim/);
  assert.match(coldStartHeadroom(3188, 3200), /12 left/);
});

test(`the cold start stays under ${COLD_START_LIMIT} characters`, async t => {
  const { coldStart } = parseGuide(await readFile(GUIDE, 'utf8'));
  assert.equal(COLD_START_LIMIT, 3200);
  assert.ok(coldStart.length < COLD_START_LIMIT, `cold start is ${coldStart.length} characters`);
  const near = coldStartHeadroom(coldStart.length);
  if (near) t.diagnostic(near);
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
    // goal add runs before goal retire, which retires the goal it added.
    // improve bare would run keel's own check from inside it; its --selftest runs on its fixture.
    const added = `G${Math.max(...JSON.parse(await readFile(join(dir, 'docs/goals.json'), 'utf8')).map(g => Number(g.id.slice(1)))) + 1}`;
    // No verb here reads the live world (lesson 17's shape: a test that reads it goes red when
    // the world changes, as fleet update did once ledger was adopted). Every verb runs with a gh
    // that prints [], and fleet.json is a synthetic, empty fleet; tests/night.test.mjs,
    // tests/fleet.test.mjs and tests/learn.test.mjs cover those verbs against a stub gh; loose-ends
    // and retro read no one's transcripts (tests/loose-ends.test.mjs and tests/retro.test.mjs cover them).
    const emptyGh = join(dir, 'empty-gh');
    // GraphQL (keel review, loose-ends' review read) gets an answer with no PRs and no threads.
    const noThreads = { pageInfo: { hasNextPage: false }, nodes: [] };
    const graphql = JSON.stringify({ data: { repository: { pullRequest: { number: 1, title: 'Acme', url: 'https://github.com/acme/app/pull/1', state: 'OPEN', headRefOid: 'abc1234', reviewThreads: noThreads, comments: noThreads }, open: noThreads, merged: noThreads } } });
    await writeFile(emptyGh, `#!${process.execPath}\nconsole.log(process.argv.includes('graphql') ? ${JSON.stringify(graphql)} : '[]');\n`, { mode: 0o755 });
    await writeFile(join(dir, 'fleet.json'), '[]\n');
    // walk decide records a decision on a health page's proposal: a synthetic one, outside the health directory.
    await writeFile(join(dir, 'acme-health.md'), '# Acme health\n\n## Proposal\n\n**`acme_measure`** (outside) — Acme proposes.\n');
    const needs = { walk: ['decide', '--proposal', 'acme-health.md', '--decline', 'Acme test'], canvas: ['status'], init: ['fresh', '--description', 'Acme is a test project.'], learn: ['render'], improve: ['--selftest'], drain: ['keel-night/'],
      review: ['acme/app#1', '--reviewer', 'acme-reviewer'], 'goal show': ['G0'], 'goal add': ['Acme works', '--outcome', 'Acme works.'],
      'goal retire': [added, '--reason', 'Acme test'], 'phase new': ['Acme phase', '--goal', 'G0'] };
    const env = { ...process.env, GIT_AUTHOR_NAME: 'Acme', GIT_AUTHOR_EMAIL: 'acme@acme.test',
      GIT_COMMITTER_NAME: 'Acme', GIT_COMMITTER_EMAIL: 'acme@acme.test' };
    // canvas status reads local binding/receipts only; any accidental transport call
    // hits a nonexistent synthetic executable instead of the installed isocan.
    // phase new runs last: its draft fails the roadmap check (and doctor) until it is written (phase 32).
    for (const name of names().sort((a, b) => (a === 'phase new') - (b === 'phase new'))) {
      const r = keel([...name.split(' '), ...(needs[name] ?? []), '--json'], dir, BIN, { ...env, KEEL_GH: emptyGh, KEEL_ISOCAN: join(dir, 'no-isocan'), KEEL_CLAUDE_DIR: join(dir, 'no-transcripts'), KEEL_CACHE: join(dir, 'cache') });
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

test('--version reports the CLI, its commit and the practice version, each from its own source', async () => {
  const pkg = JSON.parse(await readFile(join(KEEL, 'package.json'), 'utf8'));
  const j = JSON.parse(keel(['--version', '--json']).out);
  assert.equal(j.cli, pkg.version);
  assert.equal(j.practice, (await readFile(join(KEEL, 'practices', 'VERSION'), 'utf8')).trim());
  assert.equal(JSON.parse(await readFile(join(KEEL, '.keel', 'keel.json'), 'utf8')).practice, j.practice, 'keel is self: its own practice is the one it ships');
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
    assert.match(v.out, /^keel \S+ practice \S+\n$/, 'no commit known: just the two versions');
    assert.doesNotMatch(v.out, /no git/);
    const help = keel(['--agent-help'], project, bin, env);
    assert.equal(help.code, 0, help.err);
    assert.match(help.out, /keel --agent-help/);
    const next = keel(['next', '--json'], project, bin, env);
    assert.equal(next.code, 0, next.err);
    assert.deepEqual(JSON.parse(next.out), JSON.parse(keel(['next', '--json']).out));
  } finally { await rm(tmp, { recursive: true, force: true }); }
});
