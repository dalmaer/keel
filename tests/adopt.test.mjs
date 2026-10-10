// keel adopt: an existing project comes under keel without losing what is its
// own. Fixtures are synthetic (tests/fixtures/adopt/acme-*): acme-groove is
// shaped like a project with milestones, a check:all gate and a pages
// workflow; acme-fold like one whose phases carry only status/since/issue/note,
// with a TypeScript roadmap and its own workflows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, testsRan } from './helpers/run.mjs';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, readdir, lstat, readlink, rm, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, fill, wanted } from '../lib/practices.mjs';
import { pinsEvery, optionalPractices } from './helpers/practices.mjs';
import { adopt, appendBlocks, readmeTagline, detectCheck, workflowTriggers, ledgerCommand, testsPlan, testsLines, HEADING, REPORT } from '../lib/adopt.mjs';
import { testsConfigProblems } from '../practices/night/files/scripts/keel/test-ledger.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(KEEL, 'bin', 'keel.mjs');
const FIXTURES = join(KEEL, 'tests', 'fixtures', 'adopt');
const VERSION = { cli: '0.0.0', commit: null, practice: '0.0.0' };
const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Acme Builder', GIT_AUTHOR_EMAIL: 'builder@acme.test',
  GIT_COMMITTER_NAME: 'Acme Builder', GIT_COMMITTER_EMAIL: 'builder@acme.test',
  GIT_CONFIG_NOSYSTEM: '1',
};
const keel = (args, cwd = KEEL) => {
  const r = run(process.execPath, [BIN, ...args], { cwd, env: ENV });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

async function scratch(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'keel-adopt-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function copyFixture(t, name) {
  const dir = join(await scratch(t), name);
  await cp(join(FIXTURES, name), dir, { recursive: true });
  return dir;
}

/** Every path under dir with a hash of its bytes (or its link target). */
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

/**
 * The files an adopt writes, derived from the practices' practice.json: every
 * managed or seeded file (or link) of a switched-on practice the project did
 * not already have, plus keel's own fixed files. Blocks land in a file that is
 * there or written by its practice. `have` is the project's paths before. [path], sorted.
 */
function shippedFiles(practices, on, have) {
  const out = new Set(['.keel/keel.json', '.keel/lock.json', REPORT]);
  for (const p of practices.values()) if (on[p.name] === 'on') {
    // A conditional file (practice.json "when") only while its condition holds: these fixtures set no contracts.
    for (const f of p.files) if (f.kind !== 'block' && wanted(f, {}) && !(f.path in have)) out.add(f.path);
  }
  return [...out].sort();
}
const status = (data, path) => data.files.find(f => (f.block ? `${f.path}#${f.block}` : f.path) === path)?.status;

test('a dry run changes nothing, for either fixture', async () => {
  for (const name of ['acme-groove', 'acme-fold']) {
    const dir = join(FIXTURES, name);
    const before = await tree(dir);
    const r = keel(['adopt', dir, '--dry-run', '--json']);
    assert.equal(r.code, 0, r.err);
    const data = JSON.parse(r.out);
    assert.equal(data.dryRun, true);
    assert.deepEqual(data.written, []);
    assert.deepEqual(await tree(dir), before, `${name} changed under --dry-run`);
  }
});

test('acme-groove: milestones make phases local; its gate is check:all; its workflow keeps ci local', async () => {
  const { data } = await adopt({ dir: join(FIXTURES, 'acme-groove'), dryRun: true }, { version: VERSION });
  assert.deepEqual(states(data), pinsEvery({ base: 'on', 'agents-md': 'on', phases: 'local', evidence: 'on', lessons: 'on', conduct: 'on', ci: 'local', night: 'on', claude: 'off', renovate: 'on', loop: 'off', reconciliation: 'off', climb: 'off', 'cross-review': 'off' }, 'tests/adopt.test.mjs: acme-groove'));
  assert.equal(data.config.check, 'npm run check:all');
  assert.equal(data.config.name, 'acme-groove');
  assert.equal(data.config.tagline, 'A static practice room for Acme\'s hand drum.');
  assert.match(data.config.local.phases, /migrate milestone→goal \(phase 6 migration\)/);
  assert.match(data.config.local.ci, /pages\.yml already runs `npm run check:all`/);
  assert.deepEqual(data.config.practices, ['base', 'agents-md', 'evidence', 'lessons', 'conduct', 'night', 'renovate']);
  assert.equal(data.practices.find(p => p.name === 'claude').why, 'optional; --with claude to add it');
  assert.equal(status(data, 'scripts/roadmap.mjs'), 'keep-local');
  assert.equal(status(data, 'tests/roadmap.test.js'), 'keep-local');
  assert.equal(status(data, 'AGENTS.md'), 'keep-local');
  assert.equal(status(data, 'AGENTS.md#lessons'), 'create');
  assert.equal(status(data, 'AGENTS.md#phases'), undefined, 'a local practice installs nothing');
  assert.equal(status(data, 'docs/templates/evidence.md'), 'create');
  assert.equal(status(data, '.github/workflows/check.yml'), undefined, 'no second workflow running the gate');
});

test('acme-fold: phases without goal or evidence stay local; its TS roadmap is its own', async () => {
  const { data } = await adopt({ dir: join(FIXTURES, 'acme-fold'), dryRun: true }, { version: VERSION });
  assert.deepEqual(states(data), pinsEvery({ base: 'on', 'agents-md': 'on', phases: 'local', evidence: 'local', lessons: 'on', conduct: 'on', ci: 'local', night: 'on', claude: 'local', renovate: 'on', loop: 'off', reconciliation: 'off', climb: 'off', 'cross-review': 'off' }, 'tests/adopt.test.mjs: acme-fold'));
  assert.match(data.config.local.claude, /\.github\/workflows\/claude\.yml is the project's own/, 'its own claude.yml stays');
  assert.equal(data.config.check, 'npm run check');
  assert.equal(data.config.tagline, 'What an app can do on the Acme Fold, in every pose.');
  assert.match(data.config.local.phases, /missing goal/);
  assert.match(data.config.local.phases, /no docs\/goals\.json/);
  assert.match(data.config.local.evidence, /1 built phase name no evidence \(0-shell\.md\).*never invent it/);
  assert.match(data.config.local.ci, /claude\.yml, test\.yml/);
  assert.equal(status(data, 'scripts/roadmap.ts'), 'keep-local');
  assert.equal(status(data, 'scripts/roadmap.mjs'), undefined);
  assert.equal(status(data, 'CLAUDE.md'), 'same');
});

test('--check overrides the detected gate', async () => {
  const { data } = await adopt({ dir: join(FIXTURES, 'acme-fold'), dryRun: true, check: 'npm run check:ci' }, { version: VERSION });
  assert.equal(data.config.check, 'npm run check:ci');
  assert.equal(data.check.from, '--check');
});

test('adopting acme-groove keeps AGENTS.md\'s bytes, passes its own gate, and a second run is a no-op', async t => {
  const dir = await copyFixture(t, 'acme-groove');
  const agentsBefore = await readFile(join(dir, 'AGENTS.md'), 'utf8');
  const before = await tree(dir);
  const r = keel(['adopt', dir, '--json']);
  assert.equal(r.code, 0, r.err);
  const data = JSON.parse(r.out);

  const agents = await readFile(join(dir, 'AGENTS.md'), 'utf8');
  assert.ok(agents.startsWith(agentsBefore), 'existing AGENTS.md prose must be kept byte for byte');
  const tail = agents.slice(agentsBefore.length);
  assert.match(tail, new RegExp(`^\\n${HEADING}\\n`));
  for (const id of ['agents-md', 'evidence', 'lessons', 'conduct']) assert.match(tail, new RegExp(`<!-- keel:begin ${id} -->\\n\\S[\\s\\S]*?<!-- keel:end ${id} -->`));
  assert.doesNotMatch(tail, /keel:begin phases/);

  // Every byte the project had is still there, except AGENTS.md, which only grew.
  const after = await tree(dir);
  for (const [path, hash] of Object.entries(before)) if (path !== 'AGENTS.md') assert.equal(after[path], hash, `${path} changed`);
  for (const path of ['.keel/keel.json', REPORT, 'CLAUDE.md', '.nvmrc', '.agents/skills/conduct/SKILL.md', 'docs/templates/evidence.md']) assert.ok(after[path], `${path} not written`);
  assert.equal(after['.claude/skills/conduct'], '-> ../../.agents/skills/conduct');
  assert.equal(after['.github/workflows/check.yml'], undefined);

  const config = JSON.parse(await readFile(join(dir, '.keel/keel.json'), 'utf8'));
  assert.equal(config.check, 'npm run check:all');
  assert.equal(config.practice, data.config.practice);
  assert.ok(config.local.phases && config.local.ci);
  const report = await readFile(join(dir, REPORT), 'utf8');
  for (const p of Object.keys(config.local)) assert.match(report, new RegExp(`### ${p}\\n\\n${config.local[p].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

  const gate = run('npm', ['run', 'check:all'], { cwd: dir, env: ENV });
  assert.equal(gate.status, 0, gate.stdout + gate.stderr);
  assert.ok(testsRan(gate.stdout + gate.stderr) > 0, `the gate ran no tests:\n${gate.stdout}${gate.stderr}`);
  assert.match(gate.stdout + gate.stderr, /every phase names a known milestone/);
  assert.equal(keel(['render', '--check'], dir).code, 0, 'the adopted project renders clean');

  const settled = await tree(dir);
  const again = keel(['adopt', dir, '--json']);
  assert.equal(again.code, 0, again.err);
  assert.deepEqual(JSON.parse(again.out).written, []);
  assert.deepEqual(await tree(dir), settled, 're-running adopt changed files');
});

test('adopting acme-fold writes no phase, evidence, check or claude file and keeps its own', async t => {
  const dir = await copyFixture(t, 'acme-fold');
  const before = await tree(dir);
  const r = keel(['adopt', dir]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Local variants and proposals: docs\/keel-adoption\.md/);
  const after = await tree(dir);
  for (const [path, hash] of Object.entries(before)) if (path !== 'AGENTS.md') assert.equal(after[path], hash, `${path} changed`);
  const added = Object.keys(after).filter(p => !(p in before)).sort();
  // The expected list is derived from the practices' practice.json, never hand-kept
  // (phase 40's retro: phases 33 and 39 each had to edit a list here).
  const { data } = await adopt({ dir: join(FIXTURES, 'acme-fold'), dryRun: true }, { version: VERSION });
  const expected = shippedFiles(await load(), states(data), before);
  assert.deepEqual(added, expected, 'adopt writes exactly the switched-on practices\' files it lacked, and keel\'s own');
  assert.ok(expected.includes('.github/workflows/keel-night.yml') && expected.includes('renovate.json'), 'the night shift and Renovate beside its own workflows');
  for (const own of ['.github/workflows/claude.yml', '.github/workflows/check.yml']) assert.ok(!expected.includes(own), `never a second ${own}`);
  // Mutation, both ways: one file more, or one fewer, than the practices say fails.
  assert.notDeepEqual([...added, 'scripts/keel/acme.mjs'].sort(), expected, 'an extra file would pass');
  assert.notDeepEqual(added.filter(p => p !== 'scripts/keel/drain.mjs'), expected, 'a missing file would pass');
  const gate = run('npm', ['run', 'check'], { cwd: dir, env: ENV });
  assert.equal(gate.status, 0, gate.stdout + gate.stderr);
  assert.ok(testsRan(gate.stdout + gate.stderr) > 0, `the gate ran no tests:\n${gate.stdout}${gate.stderr}`);
  assert.match(gate.stdout + gate.stderr, /every phase has a status/);
});

test('a project that already is keel-shaped switches everything on, and its files stay as they are', async t => {
  const dir = join(await scratch(t), 'acme-notes');
  const init = keel(['init', dir, '--description', 'Acme Notes keeps meeting notes as plain files.', '--kind', 'node']);
  assert.equal(init.code, 0, init.err);
  await rm(join(dir, '.keel'), { recursive: true });
  const before = await tree(dir);
  const { data } = await adopt({ dir }, { version: VERSION });
  const optional = optionalPractices();
  assert.ok(data.practices.every(p => p.state === (optional.includes(p.name) ? 'off' : 'on')), JSON.stringify(data.practices)); // the optional practices: init left each off
  assert.equal(data.config.local, undefined);
  const after = await tree(dir);
  for (const [path, hash] of Object.entries(before)) assert.equal(after[path], hash, `${path} changed`);
  assert.deepEqual(Object.keys(after).filter(p => !(p in before)).sort(), ['.keel/keel.json', '.keel/lock.json', REPORT]);
});

test('a bare project: phases off, so is what needs them; ci on and runs its gate', async t => {
  const dir = await scratch(t);
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'acme-bare', scripts: { check: 'node -e 0' } }));
  const { data } = await adopt({ dir, dryRun: true }, { version: VERSION });
  assert.deepEqual(states(data), pinsEvery({ base: 'on', 'agents-md': 'on', phases: 'off', evidence: 'off', lessons: 'on', conduct: 'off', ci: 'on', night: 'on', claude: 'off', renovate: 'on', loop: 'off', reconciliation: 'off', climb: 'off', 'cross-review': 'off' }, 'tests/adopt.test.mjs: a bare project'));
  const asked = await adopt({ dir, dryRun: true, with: ['claude'] }, { version: VERSION });
  assert.equal(states(asked.data).claude, 'on', '--with claude switches it on');
  assert.equal(status(asked.data, '.github/workflows/claude.yml'), 'create');
  assert.deepEqual(asked.data.secrets.map(s => s.name), ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']);
  assert.equal(status(data, '.github/workflows/check.yml'), 'create');
});

test('a managed file or symlink the project has its own version of makes its practice local, never overwritten', async t => {
  const dir = await scratch(t);
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'acme-own', scripts: { check: 'node -e 0' } }));
  await writeFile(join(dir, 'CLAUDE.md'), 'Acme\'s own pointer.\n');
  await mkdir(join(dir, '.claude', 'skills', 'conduct'), { recursive: true });
  await mkdir(join(dir, 'docs', 'phases'), { recursive: true });
  await writeFile(join(dir, 'docs/phases/00-x.md'), '---\nstatus: planned\nsince: 2026-01-01\nnote: "x"\n---\n# X\n');
  const { data } = await adopt({ dir }, { version: VERSION });
  assert.equal(states(data)['agents-md'], 'local');
  assert.equal(status(data, 'CLAUDE.md'), 'keep-local');
  assert.equal(states(data).conduct, 'local');
  assert.equal(status(data, '.claude/skills/conduct'), 'conflict');
  assert.equal(await readFile(join(dir, 'CLAUDE.md'), 'utf8'), 'Acme\'s own pointer.\n');
  assert.ok((await lstat(join(dir, '.claude/skills/conduct'))).isDirectory());
});

test('the night shift\'s practices go local where the project already does the job, and keel\'s own files never count as the project\'s', async t => {
  const dir = await scratch(t);
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'acme-bot', scripts: { check: 'node -e 0' } }));
  await mkdir(join(dir, '.github', 'workflows'), { recursive: true });
  await writeFile(join(dir, '.github/workflows/assistant.yml'), 'name: assistant\non:\n  issue_comment:\n    types: [created]\njobs:\n  a:\n    steps:\n      - uses: anthropics/claude-code-action@v1\n');
  await writeFile(join(dir, '.github/dependabot.yml'), 'version: 2\n');
  const { data } = await adopt({ dir }, { version: VERSION });
  assert.equal(states(data).claude, 'local');
  assert.match(data.config.local.claude, /assistant\.yml already runs anthropics\/claude-code-action on issue_comment/);
  assert.equal(states(data).renovate, 'local');
  assert.match(data.config.local.renovate, /\.github\/dependabot\.yml/);
  assert.equal(states(data).night, 'on');
  assert.deepEqual(data.secrets.map(s => s.name), [], 'the night needs no secret: it runs from the project\'s own scripts');
  const again = await adopt({ dir }, { version: VERSION });
  // (The report also lists the AGENTS.md the first run seeded, as kept: not this test's concern.)
  assert.deepEqual(again.data.written.filter(p => p !== REPORT), [], 'keel-night.yml and scripts/keel/, once written, are not the project\'s own');
  assert.equal(again.data.config.local.ci, data.config.local.ci);
});

test('appendBlocks keeps every byte and adds the heading once', () => {
  const text = '# Acme\n\nProse with no trailing newline';
  const once = appendBlocks(text, ['lessons']);
  assert.ok(once.startsWith(text));
  assert.equal(once.split(HEADING).length, 2);
  const twice = appendBlocks(once, ['conduct']);
  assert.ok(twice.startsWith(once));
  assert.equal(twice.split(HEADING).length, 2);
  assert.equal(appendBlocks(text, []), text);
});

test('tagline and gate detection', () => {
  assert.equal(readmeTagline('# T\n\n[a](b) · [c](d)\n\nA thing for Acme. More.\n'), 'A thing for Acme.');
  assert.equal(readmeTagline('# T\n\n**Bold [claim](x).** → more\n'), 'Bold claim.');
  assert.equal(readmeTagline('# Only a heading\n'), null);
  assert.equal(detectCheck({ scripts: { check: 'a', 'check:all': 'b' } }).check, 'npm run check:all');
  assert.equal(detectCheck({ scripts: { check: 'a' } }).check, 'npm run check');
  assert.deepEqual(detectCheck(null), { check: null, from: 'none found' }, 'never a script that is not there (phase 16)');
  assert.deepEqual(detectCheck({ scripts: { test: 'vitest run', typecheck: 'tsc' } }), { check: null, from: 'none found' });
});

test('check.yml runs the config\'s check; keel\'s own stays byte-identical', async () => {
  const practices = await load();
  const f = practices.get('ci').files.find(f => f.path === '.github/workflows/check.yml');
  const keelConfig = JSON.parse(await readFile(join(KEEL, '.keel/keel.json'), 'utf8'));
  assert.equal(fill(f.template, keelConfig, f.path), await readFile(join(KEEL, '.github/workflows/check.yml'), 'utf8'));
  assert.match(fill(f.template, { check: 'npm run check:all' }, f.path), /^ {6}- run: npm run check:all$/m);
});

test('the conduct block and skill name the project\'s gate, never a bare npm run check', async t => {
  const dir = await copyFixture(t, 'acme-groove');
  assert.equal(keel(['adopt', dir]).code, 0);
  const agents = await readFile(join(dir, 'AGENTS.md'), 'utf8');
  const block = /<!-- keel:begin conduct -->\n([\s\S]*?)<!-- keel:end conduct -->/.exec(agents)[1];
  const skill = await readFile(join(dir, '.agents/skills/conduct/SKILL.md'), 'utf8');
  for (const [what, text] of [['conduct block', block], ['SKILL.md', skill]]) {
    assert.match(text, /`npm run check:all`/, what);
    assert.doesNotMatch(text, /npm run check(?!:all)/, `${what} names a bare npm run check`);
  }
});

test('--setup and repeated --env land in .keel/keel.json; a bad --env writes nothing', async t => {
  const dir = await copyFixture(t, 'acme-groove');
  const before = await tree(dir);
  const bad = keel(['adopt', dir, '--env', 'acme-flag=1', '--json']);
  assert.equal(bad.code, 2, bad.out);
  assert.deepEqual(await tree(dir), before);
  assert.equal(keel(['adopt', dir, '--env', 'NOEQUALS']).code, 2);
  const r = keel(['adopt', dir, '--setup', 'npm ci && npm ci --prefix web', '--env', 'ACME_SYNC=0', '--env', 'ACME_MODE=a=b', '--json']);
  assert.equal(r.code, 0, r.err + r.out);
  const cfg = JSON.parse(await readFile(join(dir, '.keel', 'keel.json'), 'utf8'));
  assert.equal(cfg.setup, 'npm ci && npm ci --prefix web');
  assert.deepEqual(cfg.env, { ACME_SYNC: '0', ACME_MODE: 'a=b' });
  // A second adopt without the flags keeps them.
  assert.equal(keel(['adopt', dir]).code, 0);
  assert.deepEqual(JSON.parse(await readFile(join(dir, '.keel', 'keel.json'), 'utf8')).env, { ACME_SYNC: '0', ACME_MODE: 'a=b' });
});

// A block whose rule the project's AGENTS.md already states in its own words is
// not appended a second time: it is recorded in blocksSkipped, render does not
// ask for its markers, and doctor lists it as information.
async function stated(t, agents) {
  const dir = await scratch(t);
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'acme-stated', scripts: { check: 'node -e 0' } }));
  await writeFile(join(dir, 'AGENTS.md'), agents);
  return dir;
}

test('adopt does not append a block whose first bold sentence AGENTS.md already states', async t => {
  const own = '# Acme\n\nOur own rules.\n\n**Lessons are shapes,\nnot  incidents.** We keep ours in docs/lessons.md.\n';
  const dir = await stated(t, own);
  const r = keel(['adopt', dir, '--json']);
  assert.equal(r.code, 0, r.err + r.out);
  const data = JSON.parse(r.out);
  assert.equal(status(data, 'AGENTS.md#lessons'), 'skip');
  assert.equal(status(data, 'AGENTS.md#agents-md'), 'create', 'a rule it does not state is still appended');
  const agents = await readFile(join(dir, 'AGENTS.md'), 'utf8');
  assert.ok(agents.startsWith(own), 'every byte kept');
  assert.doesNotMatch(agents, /keel:begin lessons/);
  assert.match(agents, /keel:begin agents-md/);
  const cfg = JSON.parse(await readFile(join(dir, '.keel', 'keel.json'), 'utf8'));
  assert.deepEqual(cfg.blocksSkipped, ['lessons']);
  assert.ok(cfg.practices.includes('lessons'), 'the practice stays on; only its block is skipped');
  assert.match(await readFile(join(dir, REPORT), 'utf8'), /`AGENTS\.md#lessons` — the project's AGENTS\.md already states this rule/);
  const check = keel(['render', '--check'], dir);
  assert.equal(check.code, 0, check.out + check.err);
  assert.doesNotMatch(check.out + check.err, /missing/);
  const doc = keel(['doctor'], dir);
  assert.match(doc.out, /Blocks not appended \(information; the project's AGENTS\.md already states each rule\): AGENTS\.md#lessons/);
  assert.ok(!JSON.parse(keel(['doctor', '--json'], dir).out).drift.some(d => d.path === 'AGENTS.md#lessons'));
  // Re-running is a no-op.
  const again = JSON.parse(keel(['adopt', dir, '--json']).out);
  assert.deepEqual(again.written, []);
});

test('adopt appends the block when AGENTS.md does not state its rule, or states it only inside keel markers', async t => {
  for (const agents of ['# Acme\n\nOur own rules: lessons go in a table.\n',
    '# Acme\n\n<!-- keel:begin agents-md -->\n**Lessons are shapes, not incidents.**\n<!-- keel:end agents-md -->\n']) {
    const dir = await stated(t, agents);
    const { data } = await adopt({ dir, dryRun: true }, { version: VERSION });
    assert.equal(status(data, 'AGENTS.md#lessons'), 'create', agents);
    assert.equal(data.config.blocksSkipped, undefined);
  }
});

// repo is recorded only when it is safely known: the dir is its own git top
// level and origin is on github.com. Anything else leaves it unset, and says so.
test('adopt records repo from a github.com origin of the project\'s own git repository, and only then', async t => {
  const git = (dir, ...args) => assert.equal(run('git', ['-C', dir, ...args], { env: ENV }).status, 0, args.join(' '));
  const cases = [
    ['https://github.com/acme/notes.git', 'acme/notes'],
    ['https://github.com/acme/notes', 'acme/notes'],
    ['git@github.com:acme/notes.git', 'acme/notes'],
    ['git@github.com:acme/notes', 'acme/notes'],
    ['https://gitlab.com/acme/notes.git', undefined],
    [null, undefined],
  ];
  for (const [url, want] of cases) {
    const dir = await scratch(t);
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'acme-repo', scripts: { check: 'node -e 0' } }));
    git(dir, 'init', '-q');
    if (url) git(dir, 'remote', 'add', 'origin', url);
    const { data, text } = await adopt({ dir, dryRun: true }, { version: VERSION });
    assert.equal(data.config.repo, want, String(url));
    assert.match(text, want ? new RegExp(`^Repo: ${want} \\(git remote origin\\)$`, 'm') : /^Repo: unset — (no origin remote|origin is not a github\.com remote)/m, String(url));
  }
  // A directory nested inside another repository is not its own: unset, even with a GitHub origin above it.
  const outer = await scratch(t);
  git(outer, 'init', '-q');
  git(outer, 'remote', 'add', 'origin', 'https://github.com/acme/outer.git');
  const inner = join(outer, 'packages', 'inner');
  await mkdir(inner, { recursive: true });
  await writeFile(join(inner, 'package.json'), JSON.stringify({ name: 'acme-inner', scripts: { check: 'node -e 0' } }));
  const nested = await adopt({ dir: inner, dryRun: true }, { version: VERSION });
  assert.equal(nested.data.config.repo, undefined);
  assert.match(nested.text, /^Repo: unset — not its own git repository/m);
  // An existing repo is never overwritten.
  await mkdir(join(outer, '.keel'));
  await writeFile(join(outer, '.keel', 'keel.json'), JSON.stringify({ name: 'outer', repo: 'acme/kept', practices: ['base'] }));
  const kept = await adopt({ dir: outer, dryRun: true }, { version: VERSION });
  assert.equal(kept.data.config.repo, 'acme/kept');
});

test('--with on an adopted project adds only that practice: its files, block and lock rows; every other byte stays', async t => {
  const dir = join(await scratch(t), 'acme-notes');
  const init = keel(['init', dir, '--description', 'Acme Notes keeps meeting notes as plain files.', '--kind', 'node']);
  assert.equal(init.code, 0, init.err);
  await writeFile(join(dir, '.stitch.json'), '{ "workspace": "acme-0000-workspace" }\n');
  // A managed file keel has moved on from (behind: the bytes are the lock's, not today's template).
  const lockPath = join(dir, '.keel', 'lock.json');
  const old = '// Acme: an older drain\n';
  await writeFile(join(dir, 'scripts', 'keel', 'drain.mjs'), old);
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  lock.files['scripts/keel/drain.mjs'].sha256 = createHash('sha256').update(old).digest('hex');
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  const cfgBefore = JSON.parse(await readFile(join(dir, '.keel', 'keel.json'), 'utf8'));
  await writeFile(join(dir, '.keel', 'keel.json'), `${JSON.stringify({ ...cfgBefore, practice: '0.0.1', loop: { run: 'npm run loop --' } }, null, 2)}\n`);
  const agentsBefore = await readFile(join(dir, 'AGENTS.md'), 'utf8');
  const lockBefore = JSON.parse(await readFile(lockPath, 'utf8'));
  const before = await tree(dir);

  // A project with its own loop script: refused, nothing written.
  await writeFile(join(dir, 'scripts', 'loop.ts'), '// Acme\'s own Loop triage.\n');
  let r = keel(['adopt', dir, '--with', 'loop']);
  assert.equal(r.code, 1);
  assert.match(r.err, /--with loop: loop would be local here — the project triages Loop with its own scripts\/loop\.ts.*nothing written/);
  await rm(join(dir, 'scripts', 'loop.ts'));
  assert.deepEqual(await tree(dir), before);

  r = keel(['adopt', dir, '--with', 'loop', '--dry-run', '--json']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out).added, ['loop']);
  assert.deepEqual(await tree(dir), before, 'a dry run writes nothing');

  r = keel(['adopt', dir, '--with', 'loop', '--json']);
  assert.equal(r.code, 0, r.err);
  const after = await tree(dir);
  const changed = Object.keys({ ...before, ...after }).filter(p => before[p] !== after[p]).sort();
  assert.deepEqual(changed, ['.github/workflows/keel-loop.yml', '.keel/keel.json', '.keel/lock.json', 'AGENTS.md', 'docs/loop/README.md', 'scripts/loop.mjs', 'tests/loop.test.mjs']);
  const cfg = JSON.parse(await readFile(join(dir, '.keel', 'keel.json'), 'utf8'));
  assert.deepEqual(cfg, { ...cfgBefore, practice: '0.0.1', loop: { run: 'npm run loop --' }, practices: [...cfgBefore.practices, 'loop'] }, 'only practices changed; the practice version is kept');
  const agents = await readFile(join(dir, 'AGENTS.md'), 'utf8');
  assert.ok(agents.startsWith(agentsBefore));
  // Appended after the project's last byte (under the keel heading adopt adds when it is missing).
  assert.match(agents.slice(agentsBefore.length), /^\n(## The keel practice\n\n.*\n\n)?<!-- keel:begin loop -->\n\*\*Loop's insights are claims[^]*<!-- keel:end loop -->\n$/);
  const lockAfter = JSON.parse(await readFile(lockPath, 'utf8'));
  assert.equal(lockAfter.practice, lockBefore.practice);
  for (const [k, v] of Object.entries(lockBefore.files)) assert.deepEqual(lockAfter.files[k], v, k);
  assert.deepEqual(Object.keys(lockAfter.files).filter(k => !lockBefore.files[k]).sort(), ['.github/workflows/keel-loop.yml', 'AGENTS.md#loop', 'scripts/loop.mjs', 'tests/loop.test.mjs']);
  assert.equal(await readFile(join(dir, 'scripts', 'keel', 'drain.mjs'), 'utf8'), old, 'a behind file is update\'s, not adopt\'s');

  // Run again: loop is on, so nothing is added and the whole re-run is the old no-op path.
  const again = await tree(dir);
  r = keel(['adopt', dir, '--with', 'loop', '--dry-run', '--json']);
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(r.out).added, undefined);
  assert.deepEqual(await tree(dir), again);
});

test('--with on an adopted project honours a block the config already skips', async t => {
  const dir = join(await scratch(t), 'acme-notes');
  assert.equal(keel(['init', dir, '--description', 'Acme Notes keeps meeting notes as plain files.', '--kind', 'node']).code, 0);
  await writeFile(join(dir, '.stitch.json'), '{ "workspace": "acme-0000-workspace" }\n');
  const cfg = JSON.parse(await readFile(join(dir, '.keel', 'keel.json'), 'utf8'));
  await writeFile(join(dir, '.keel', 'keel.json'), `${JSON.stringify({ ...cfg, blocksSkipped: ['loop'] }, null, 2)}\n`);
  const agentsBefore = await readFile(join(dir, 'AGENTS.md'), 'utf8');
  const r = keel(['adopt', dir, '--with', 'loop', '--json']);
  assert.equal(r.code, 0, r.err);
  const data = JSON.parse(r.out);
  assert.equal(data.files.find(f => f.block === 'loop').status, 'skip');
  assert.equal(await readFile(join(dir, 'AGENTS.md'), 'utf8'), agentsBefore);
  assert.deepEqual(JSON.parse(await readFile(join(dir, '.keel', 'keel.json'), 'utf8')).blocksSkipped, ['loop']);
  assert.ok(!Object.hasOwn(JSON.parse(await readFile(join(dir, '.keel', 'lock.json'), 'utf8')).files, 'AGENTS.md#loop'));
  assert.equal(keel(['render', '--check'], dir).code, 0, 'render agrees there is nothing to write');
});

test('a claude-code-action workflow on a schedule only answers nobody: claude stays off, not local, and says why', async t => {
  const dir = await scratch(t);
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'acme-diary', scripts: { check: 'node -e 0' } }));
  await mkdir(join(dir, '.github', 'workflows'), { recursive: true });
  // Shaped like a nightly changelog writer: schedule and a manual dispatch, a model step.
  await writeFile(join(dir, '.github/workflows/diary.yml'), [
    '# Acme writes yesterday up overnight.', 'name: diary', '', 'on:', '  schedule:', '    # after midnight', '    - cron: "3 8 * * *"',
    '  workflow_dispatch:', '    inputs:', '      day:', '        required: false', '',
    'jobs:', '  diary:', '    runs-on: ubuntu-latest', '    steps:', '      - uses: anthropics/claude-code-action@v1', '',
  ].join('\n'));
  const { data } = await adopt({ dir, dryRun: true }, { version: VERSION });
  assert.equal(states(data).claude, 'off');
  assert.equal(data.config.local?.claude, undefined);
  assert.match(data.practices.find(p => p.name === 'claude').why, /diary\.yml runs anthropics\/claude-code-action on schedule, workflow_dispatch, not on a mention/);
  const asked = await adopt({ dir, dryRun: true, with: ['claude'] }, { version: VERSION });
  assert.equal(states(asked.data).claude, 'on', 'a scheduled writer is no reason to refuse --with claude');

  // The same workflow answering mentions too is the project's own claude.
  await writeFile(join(dir, '.github/workflows/diary.yml'), 'name: diary\non: [schedule, issue_comment]\njobs:\n  d:\n    steps:\n      - uses: anthropics/claude-code-action@v1\n');
  const mentions = await adopt({ dir, dryRun: true }, { version: VERSION });
  assert.equal(states(mentions.data).claude, 'local');
});

test('workflowTriggers reads on: inline, as a list, and as a block of keys', () => {
  assert.deepEqual(workflowTriggers('on: push\n'), ['push']);
  assert.deepEqual(workflowTriggers('"on": [issues, "pull_request_review_comment"]\n'), ['issues', 'pull_request_review_comment']);
  assert.deepEqual(workflowTriggers('on:\n  - issue_comment\n  - push\njobs: {}\n'), ['issue_comment', 'push']);
  assert.deepEqual(workflowTriggers('on:\n  pull_request:\n    branches: [main]\n  issues:\n    types: [opened]\njobs:\n  a: {}\n'), ['pull_request', 'issues']);
  assert.deepEqual(workflowTriggers('name: x\njobs: {}\n'), []);
});

test('adopt detects the stack, says it in the dry run, records it, and doctor agrees with it', async t => {
  const dir = await scratch(t);
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'acme-site', scripts: { check: 'node -e 0' } }));
  await writeFile(join(dir, 'vercel.json'), '{}\n');
  const dry = keel(['adopt', dir, '--dry-run']);
  assert.equal(dry.code, 0, dry.err);
  // github-actions: keel's own check.yml, which the adoption writes.
  assert.match(dry.out, /^Stack: node, vercel, github-actions \(detected: node \(package\.json\), vercel \(vercel\.json\), github-actions \(\.github\/workflows\/\*\.yml\)/m);
  const { data } = await adopt({ dir }, { version: VERSION });
  assert.deepEqual(data.config.stack, ['node', 'vercel', 'github-actions']);
  assert.deepEqual(JSON.parse(await readFile(join(dir, '.keel/keel.json'), 'utf8')).stack, ['node', 'vercel', 'github-actions']);
  assert.match(await readFile(join(dir, 'docs/keel-lessons.md'), 'utf8'), /`node`, `vercel`, `github-actions`/);
  const doc = keel(['doctor', '--json'], dir);
  assert.deepEqual(JSON.parse(doc.out).lint.filter(l => l.rule.startsWith('stack-')), [], doc.out);

  // A declared stack stands.
  const again = await adopt({ dir, dryRun: true }, { version: VERSION });
  assert.equal(again.data.stack.from, '.keel/keel.json');
  // A repo that shows nothing and gets none of keel's files records no stack.
  const bare = await scratch(t);
  const none = await adopt({ dir: bare, dryRun: true }, { version: VERSION });
  assert.equal(none.data.config.stack, undefined);
  assert.match(none.text, /^Stack: none \(detected: nothing; docs\/keel-lessons\.md carries keel's universal lessons\)$/m);
});

// ---- the test runner (phase 59) ---------------------------------------------------

const J = '.keel/test-runs/junit.xml';
const posixDir = p => p.slice(0, p.lastIndexOf('/'));
/** The runner's step as adopt proposes it: the old file removed, the directory made (bun), the runner, its code kept, the ledger. */
const stepOf = (runner, runCmd, { junit = J, mkdir = runner === 'bun' ? posixDir(junit) : null } = {}) =>
  `keel_status=0; rm -f ${junit}; ${mkdir ? `mkdir -p ${mkdir} && ` : ''}${runCmd} || keel_status=$?; node scripts/keel/test-ledger.mjs --junit ${junit} --runner ${runner} --status $keel_status`;
const BUN_STEP = stepOf('bun', `bun test --reporter=junit --reporter-outfile=${J}`);

test('adopt detects bun test or vitest in the gate, records the runner, and proposes the ledger\'s reporter flags without rewriting the gate', async t => {
  const dir = await scratch(t);
  const pkg = `${JSON.stringify({ name: 'acme-bun', scripts: { check: 'npm run lint && npm test', lint: 'node -e 0', test: 'bun test' } }, null, 2)}\n`;
  await writeFile(join(dir, 'package.json'), pkg);
  const dry = await adopt({ dir, dryRun: true }, { version: VERSION });
  assert.deepEqual(dry.data.tests, { runner: 'bun', from: 'package.json scripts.test', junit: '.keel/test-runs/junit.xml', proposal: { where: 'package.json scripts.test', now: 'bun test', to: BUN_STEP } });
  assert.deepEqual(dry.data.config.tests, { runner: 'bun', junit: '.keel/test-runs/junit.xml' });
  assert.match(dry.text, /^Tests: bun \(package\.json scripts\.test\); the test ledger reads its JUnit from \.keel\/test-runs\/junit\.xml$/m);
  assert.ok(dry.text.includes(`\n  Proposal for package.json scripts.test (adopt never rewrites the gate): ${BUN_STEP}\n`), dry.text);
  // Written: the runner is recorded, the proposal is in the report, and the gate is the project's own bytes.
  const { data } = await adopt({ dir }, { version: VERSION });
  assert.equal(await readFile(join(dir, 'package.json'), 'utf8'), pkg, 'adopt never rewrites the gate');
  assert.deepEqual(JSON.parse(await readFile(join(dir, '.keel', 'keel.json'), 'utf8')).tests, { runner: 'bun', junit: '.keel/test-runs/junit.xml' });
  const report = await readFile(join(dir, REPORT), 'utf8');
  assert.match(report, /^## The test ledger$/m);
  assert.ok(report.includes(`\`\`\`sh\nbun test\n\`\`\`\n\nto\n\n\`\`\`sh\n${BUN_STEP}\n\`\`\``), report);
  assert.ok(data.written.includes('.keel/keel.json'));
  // doctor reads "tests": a known runner is fine, an unknown one is a lint.
  let doc = JSON.parse(keel(['doctor', '--json'], dir).out);
  assert.deepEqual(doc.lint.filter(l => l.rule === 'tests-config'), []);
  const cfg = JSON.parse(await readFile(join(dir, '.keel', 'keel.json'), 'utf8'));
  await writeFile(join(dir, '.keel', 'keel.json'), JSON.stringify({ ...cfg, tests: { runner: 'jest', junit: '../out.xml' } }, null, 2));
  doc = JSON.parse(keel(['doctor', '--json'], dir).out);
  assert.deepEqual(doc.lint.filter(l => l.rule === 'tests-config').map(l => l.message.split(';')[0]), ['"tests".runner must be one of node, bun, vitest', '"tests".junit must be a .xml file in .keel/test-runs/ (which ignores itself), of letters, digits, _ . and - only']);

  // vitest as one step of the gate itself: the step goes in braces, so the steps around it run as they did.
  const v = await scratch(t);
  await writeFile(join(v, 'package.json'), JSON.stringify({ name: 'acme-vite', scripts: { check: 'tsc && npx vitest run --coverage && eslint .' } }));
  const vd = (await adopt({ dir: v, dryRun: true }, { version: VERSION })).data;
  assert.deepEqual([vd.tests.runner, vd.tests.from], ['vitest', 'package.json scripts.check']);
  assert.equal(vd.tests.proposal.to, `tsc && { ${stepOf('vitest', `npx vitest run --reporter=default --reporter=junit --outputFile.junit=${J} --coverage`)}; } && eslint .`);
  // node --test: the reporter is node's own (init, migration 0004); nothing recorded, nothing proposed.
  const n = await scratch(t);
  await writeFile(join(n, 'package.json'), JSON.stringify({ name: 'acme-node', scripts: { check: 'npm test', test: 'node --test' } }));
  const nd = await adopt({ dir: n, dryRun: true }, { version: VERSION });
  assert.deepEqual(nd.data.tests, { runner: 'node', from: 'package.json scripts.test', junit: null, proposal: null });
  assert.equal(nd.data.config.tests, undefined);
  assert.match(nd.text, /^Tests: node --test \(package\.json scripts\.test\)/m);
  // Already wired, or a runner the config names: nothing proposed twice, and the config's runner stands.
  const w = await scratch(t);
  await writeFile(join(w, 'package.json'), JSON.stringify({ name: 'acme-wired', scripts: { check: 'npm test', test: BUN_STEP } }));
  assert.equal((await adopt({ dir: w, dryRun: true }, { version: VERSION })).data.tests.proposal, null);
  await mkdir(join(w, '.keel'), { recursive: true });
  await writeFile(join(w, '.keel', 'keel.json'), JSON.stringify({ check: 'npm test', tests: { runner: 'vitest', window: 30 } }));
  const own = (await adopt({ dir: w, dryRun: true }, { version: VERSION })).data;
  assert.deepEqual([own.tests.runner, own.tests.from, own.tests.proposal], ['vitest', '.keel/keel.json', null]);
  assert.deepEqual(own.config.tests, { runner: 'vitest', window: 30, junit: '.keel/test-runs/junit.xml' });
  // No runner keel knows: nothing said, nothing recorded.
  const none = await adopt({ dir: await scratch(t), dryRun: true }, { version: VERSION });
  assert.equal(none.data.tests, null);
  assert.doesNotMatch(none.text, /^Tests:/m);
});

test('the proposed gate runs: the ledger records the bun run, and the gate fails exactly when bun did, or when no test ran', async t => {
  const outer = await scratch(t), dir = join(outer, 'acme-bun');
  await mkdir(join(dir, 'scripts', 'keel'), { recursive: true });
  await cp(join(KEEL, 'practices', 'night', 'files', 'scripts', 'keel', 'test-ledger.mjs'), join(dir, 'scripts', 'keel', 'test-ledger.mjs'));
  const git = (...args) => run('git', ['-C', dir, ...args], { env: ENV });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'acme');
  // Acme's stand-in for bun: writes the fixture (a new copy each run) where --reporter-outfile says, and exits ACME_EXIT.
  const bin = join(outer, 'bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'bun'), '#!/bin/sh\nfor a in "$@"; do case "$a" in --reporter-outfile=*) out="${a#--reporter-outfile=}";; esac; done\n[ -n "$ACME_JUNIT" ] && { cat "$ACME_JUNIT"; echo "<!-- $$ -->"; } > "$out"\nexit "${ACME_EXIT:-0}"\n', { mode: 0o755 });
  const fixtures = join(KEEL, 'tests', 'fixtures', 'junit');
  await writeFile(join(bin, 'green.xml'), (await readFile(join(fixtures, 'bun.xml'), 'utf8')).replace(/<failure\b[^>]*\/>/g, ''));
  const gate = ledgerCommand('bun test && echo after', 'bun');
  const shell = (line, env, how = ['sh', '-c']) => run(how[0], [...how.slice(1), line], { cwd: dir, env: { ...ENV, PATH: `${bin}:${process.env.PATH}`, ...env } });
  const sh = env => shell(gate, env);
  let r = sh({ ACME_JUNIT: join(fixtures, 'bun.xml'), ACME_EXIT: '1' });
  assert.equal(r.status, 1, `bun failed: so does the gate\n${r.stdout}${r.stderr}`);
  assert.doesNotMatch(r.stdout, /after/);
  r = sh({ ACME_JUNIT: join(bin, 'green.xml'), ACME_EXIT: '0' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // Failed, then passed, on one clean tree: the hygiene block names it, with bun's command to run it alone; a note, never a red gate.
  assert.match(r.stdout, /^keel test ledger: 2 hygiene items \(2 runs in \.keel\/test-runs\)\./m);
  assert.match(r.stdout, /^ {2}flaky {3}a\.test\.ts "fails on purpose": passed 1, failed 1 on one clean tree/m);
  assert.match(r.stdout, /bun test a\.test\.ts -t '\^ \?fails on purpose\$'\nafter\n$/);
  r = sh({ ACME_JUNIT: join(bin, 'green.xml'), ACME_EXIT: '1' });
  assert.equal(r.status, 1, 'a failure bun left out of its JUnit (a file that would not load) still fails the gate');
  r = sh({ ACME_JUNIT: '', ACME_EXIT: '0' });
  assert.equal(r.status, 1, 'bun ran nothing and wrote nothing new: no tests ran');
  assert.match(r.stdout, /no tests ran/);
  const records = async () => (await readdir(join(dir, '.keel', 'test-runs'))).filter(n => n.endsWith('.json')).sort();
  const newest = async () => JSON.parse(await readFile(join(dir, '.keel', 'test-runs', (await records()).at(-1)), 'utf8'));
  assert.equal((await records()).length, 3);
  assert.deepEqual([(await newest()).runner, (await newest()).dirty], ['bun', false]);
  // GitHub runs a gate as bash -e: a red bun run still reaches the ledger and is recorded (review on #56).
  r = shell(ledgerCommand('bun test', 'bun'), { ACME_JUNIT: join(fixtures, 'bun.xml'), ACME_EXIT: '1' }, ['bash', '-e', '-c']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^keel test ledger: /m, 'the ledger ran after the red run');
  assert.equal((await records()).length, 4, 'and recorded it');
  // A step that changes directory first: the ledger is found from git's top level, and the run is recorded as that folder's (review on #56).
  await mkdir(join(dir, 'sub'), { recursive: true });
  r = shell(ledgerCommand('cd sub && bun test', 'bun'), { ACME_JUNIT: join(bin, 'green.xml'), ACME_EXIT: '0' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal((await records()).length, 5);
  const moved = await newest();
  assert.deepEqual([moved.dir, moved.tests[0].file, moved.dirty], ['sub', 'sub/a.test.ts', false]);
});

/** A proposal is a shell line sh can parse, and keeps every byte of the project's own steps. */
function assertProposals(make = ledgerCommand) {
  const bun = args => stepOf('bun', `bun test --reporter=junit --reporter-outfile=${J}${args}`);
  const cases = [
    // A quoted operator is part of a word, not a step's end (review on #56).
    ["bun test -t 'one|two' && echo done", `{ ${bun(" -t 'one|two'")}; } && echo done`],
    ['echo "a && b; c" && bun test', `echo "a && b; c" && { ${bun('')}; }`],
    ["vitest run -t 'x;y' --coverage", stepOf('vitest', `vitest run --reporter=default --reporter=junit --outputFile.junit=${J} -t 'x;y' --coverage`)],
    ['tsc && bun test a\\&b.test.ts && echo ok', `tsc && { ${bun(' a\\&b.test.ts')}; } && echo ok`],
    ['pnpm exec vitest run; echo ok', `{ ${stepOf('vitest', `pnpm exec vitest run --reporter=default --reporter=junit --outputFile.junit=${J}`)}; }; echo ok`],
  ];
  for (const [command, want] of cases) {
    const got = make(command, command.includes('vitest') ? 'vitest' : 'bun');
    assert.equal(got, want, command);
    const r = run('sh', ['-n', '-c', got], { env: ENV });
    assert.equal(r.status, 0, `sh -n: ${got}\n${r.stderr}`);
  }
  // Only a runner outside quotes is the runner: a quoted one is an argument.
  assert.equal(make("echo 'bun test' && bun test", 'bun'), `echo 'bun test' && { ${bun('')}; }`);
  // After a cd, the ledger and the JUnit file are found from git's top level (review on #56).
  const moved = make('cd web && npx vitest run', 'vitest');
  assert.equal(moved, `cd web && { keel_root="$(git rev-parse --show-toplevel)" || exit 1; keel_status=0; rm -f "$keel_root/${J}"; npx vitest run --reporter=default --reporter=junit --outputFile.junit="$keel_root/${J}" || keel_status=$?; node "$keel_root/scripts/keel/test-ledger.mjs" --junit "$keel_root/${J}" --runner vitest --status $keel_status; }`);
  assert.equal(run('sh', ['-n', '-c', moved], { env: ENV }).status, 0);
  assert.match(make('pushd web; bun test', 'bun'), /mkdir -p "\$keel_root\/\.keel\/test-runs" && bun test/);
  assert.doesNotMatch(make("echo 'cd web' && bun test", 'bun'), /keel_root/, 'a quoted cd moves nothing');
  // Outside the shape keel rewrites, no proposal (review on #56): a control clause or ! (the status means something else),
  // ||, a pipe or & after the runner, an inline variable or `time` before it (the ledger would not see it), or a script
  // whose name holds the runner's (`npm run vitest:unit` is its own step; its body is read where it is defined).
  for (const [command, runner] of [['if bun test; then echo ok; fi', 'bun'], ['! bun test', 'bun'], ['while bun test; do :; done', 'bun'],
    ['bun test || true', 'bun'], ['bun test | tee out.txt', 'bun'], ['bun test &', 'bun'], ['ACME_MODE=fast bun test', 'bun'],
    ['NODE_OPTIONS=--max-old-space-size=64 vitest run', 'vitest'], ['time bun test', 'bun'], ['env CI=1 bun test', 'bun'],
    ['npm run vitest:unit', 'vitest'], ['npx vitest-preview', 'vitest']]) {
    assert.equal(make(command, runner), null, command);
  }
  // What keel will not split by hand gets no proposal, never a broken one.
  for (const command of ["bun test 'unclosed", 'bun test $(cat list)', 'bun test `cat list`', '(cd web && bun test)', 'bun test > out.txt', 'echo "$(bun test)"']) {
    assert.equal(make(command, 'bun'), null, command);
  }
  // A JUnit path is written into the line as it is, so one a shell would read differently gets no proposal.
  // Nor one that names a directory, not a file (review on #56): `rm -f` and the reporter would both fail on it.
  for (const junit of ['reports/test results.xml', 'out/$HOME.xml', "a'b.xml", '-x.xml', '../out.xml', '/tmp/out.xml', 'a;b.xml', '.', '.keel/test-runs', 'reports/', 'reports/junit']) {
    assert.equal(make('bun test', 'bun', junit), null, junit);
  }
  assert.equal(make('bun test', 'bun', '.keel/test-runs/bun.xml'), stepOf('bun', 'bun test --reporter=junit --reporter-outfile=.keel/test-runs/bun.xml', { junit: '.keel/test-runs/bun.xml' }));
  // A report anywhere else would stay behind, untracked, after every gate (review on #56).
  assert.equal(make('bun test', 'bun', 'reports/junit-1.xml'), null);
}

test('a proposal parses in sh: a quoted operator or runner is a word, and a command or JUnit path keel cannot write safely gets none', () => {
  assertProposals();
  const plan = testsPlan({ tests: { junit: 'reports/test results.xml' } }, 'bun test', {});
  assert.equal(plan.proposal, null);
  assert.match(plan.declined, /is not a .xml file in \.keel\/test-runs\//);
  assert.match(testsPlan({}, 'bun test $(cat list)', {}).declined, /^the gate is not the shape keel rewrites \(plain steps joined by && or ;, an optional cd, the runner as its step's own command/);
  assert.match(testsPlan({}, 'ACME_MODE=fast bun test', {}).declined, /no inline variable/);
  // A script whose name holds "vitest" is followed to its body, which is what gets the flags (review on #56).
  const unit = testsPlan({}, 'npm run vitest:unit', { 'vitest:unit': 'vitest run' });
  assert.deepEqual([unit.runner, unit.from, unit.proposal?.where], ['vitest', 'package.json scripts.vitest:unit', 'package.json scripts.vitest:unit']);
  assert.equal(unit.proposal.to, stepOf('vitest', `vitest run --reporter=default --reporter=junit --outputFile.junit=${J}`));
  for (const junit of ['reports/test results.xml', 'out/$HOME.xml', '-x.xml', '.', '.keel/test-runs', 'reports/']) assert.ok(testsConfigProblems({ tests: { junit } }).length, junit);
  // A step that already picks a reporter or its output file: keel's flags would fight it (the last one wins), so none (review on #56).
  for (const [command, runner] of [['bun test --reporter=junit --reporter-outfile=reports/current.xml', 'bun'], ['bun test --reporter-outfile reports/current.xml', 'bun'],
    ['vitest run --outputFile.junit=reports/current.xml', 'vitest'], ['npx vitest run --reporter=verbose', 'vitest'], ['vitest run --reporter dot', 'vitest']]) {
    assert.equal(ledgerCommand(command, runner), null, command);
  }
  assert.match(testsPlan({}, 'bun test --reporter-outfile=reports/current.xml', {}).declined, /or reporter flags of its own/);
  assert.ok(ledgerCommand('bun test --timeout=10000', 'bun').includes('--reporter-outfile=.keel/test-runs/junit.xml --timeout=10000'), 'any other option stays');
  assert.ok(testsConfigProblems({ tests: { junit: 'reports/junit-1.xml' } }).length);
  // More than one runner in the gate (`npm test` runs bun, then vitest runs): record none, propose none (review on #56).
  const two = testsPlan({}, 'npm test && npx vitest run', { test: 'bun test' });
  assert.deepEqual([two.runner, two.proposal], [null, null]);
  assert.match(two.declined, /^the gate runs more than one test runner \(vitest, bun\); keel records none and proposes no line/);
  assert.deepEqual(testsLines(two), [`Tests: none recorded (the gate: vitest; package.json scripts.test: bun); ${two.declined}`]);
});

test('no proposal where the night practice is not on and the ledger is not there: the line would run a script nothing installs', async t => {
  const dir = await scratch(t);
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'acme-own-night', scripts: { check: 'npm test', test: 'bun test', night: 'node -e 0' } }));
  const { data, text } = await adopt({ dir, dryRun: true }, { version: VERSION });
  assert.equal(states(data).night, 'local', 'its own night script keeps night local');
  assert.equal(data.tests.proposal, null);
  assert.match(data.tests.declined, /^the night practice is local here, so keel does not install scripts\/keel\/test-ledger\.mjs, which the line would run/);
  assert.match(text, /^ {2}No proposal: the night practice is local here/m);
  assert.deepEqual(data.config.tests, { runner: 'bun', junit: J }, 'the runner is still recorded');
  // The ledger already in place: the line runs, so it is proposed.
  await mkdir(join(dir, 'scripts', 'keel'), { recursive: true });
  await cp(join(KEEL, 'practices', 'night', 'files', 'scripts', 'keel', 'test-ledger.mjs'), join(dir, 'scripts', 'keel', 'test-ledger.mjs'));
  assert.equal((await adopt({ dir, dryRun: true }, { version: VERSION })).data.tests.proposal.to, BUN_STEP);
});
