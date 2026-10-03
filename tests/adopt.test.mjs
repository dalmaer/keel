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
import { load, fill } from '../lib/practices.mjs';
import { adopt, appendBlocks, readmeTagline, detectCheck, HEADING, REPORT } from '../lib/adopt.mjs';

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
  assert.deepEqual(states(data), { base: 'on', 'agents-md': 'on', phases: 'local', evidence: 'on', lessons: 'on', conduct: 'on', ci: 'local', night: 'on', claude: 'on', renovate: 'on', loop: 'off' });
  assert.equal(data.config.check, 'npm run check:all');
  assert.equal(data.config.name, 'acme-groove');
  assert.equal(data.config.tagline, 'A static practice room for Acme\'s hand drum.');
  assert.match(data.config.local.phases, /migrate milestone→goal \(phase 6 migration\)/);
  assert.match(data.config.local.ci, /pages\.yml already runs `npm run check:all`/);
  assert.deepEqual(data.config.practices, ['base', 'agents-md', 'evidence', 'lessons', 'conduct', 'night', 'claude', 'renovate']);
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
  assert.deepEqual(states(data), { base: 'on', 'agents-md': 'on', phases: 'local', evidence: 'local', lessons: 'on', conduct: 'on', ci: 'local', night: 'on', claude: 'local', renovate: 'on', loop: 'off' });
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
  assert.deepEqual(added, ['.agents/skills/conduct/SKILL.md', '.claude/skills/conduct', '.github/workflows/keel-night.yml', '.github/workflows/keel-update.yml', '.keel/keel.json', '.keel/lock.json', 'docs/keel-adoption.md', 'renovate.json'],
    'the night shift and Renovate beside its own workflows; never a second claude.yml or check.yml');
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
  assert.ok(data.practices.every(p => p.state === (p.name === 'loop' ? 'off' : 'on')), JSON.stringify(data.practices)); // loop is optional: no .stitch.json, no Loop
  assert.equal(data.config.local, undefined);
  const after = await tree(dir);
  for (const [path, hash] of Object.entries(before)) assert.equal(after[path], hash, `${path} changed`);
  assert.deepEqual(Object.keys(after).filter(p => !(p in before)).sort(), ['.keel/keel.json', '.keel/lock.json', REPORT]);
});

test('a bare project: phases off, so is what needs them; ci on and runs its gate', async t => {
  const dir = await scratch(t);
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'acme-bare', scripts: { check: 'node -e 0' } }));
  const { data } = await adopt({ dir, dryRun: true }, { version: VERSION });
  assert.deepEqual(states(data), { base: 'on', 'agents-md': 'on', phases: 'off', evidence: 'off', lessons: 'on', conduct: 'off', ci: 'on', night: 'on', claude: 'on', renovate: 'on', loop: 'off' });
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
  await writeFile(join(dir, '.github/workflows/assistant.yml'), 'name: assistant\njobs:\n  a:\n    steps:\n      - uses: anthropics/claude-code-action@v1\n');
  await writeFile(join(dir, '.github/dependabot.yml'), 'version: 2\n');
  const { data } = await adopt({ dir }, { version: VERSION });
  assert.equal(states(data).claude, 'local');
  assert.match(data.config.local.claude, /assistant\.yml already runs anthropics\/claude-code-action/);
  assert.equal(states(data).renovate, 'local');
  assert.match(data.config.local.renovate, /\.github\/dependabot\.yml/);
  assert.equal(states(data).night, 'on');
  assert.deepEqual(data.secrets.map(s => s.name), ['KEEL_TOKEN', 'KEEL_TOKEN'], 'the secrets of the practices switched on');
  const again = await adopt({ dir }, { version: VERSION });
  // (The report also lists the AGENTS.md the first run seeded, as kept: not this test's concern.)
  assert.deepEqual(again.data.written.filter(p => p !== REPORT), [], 'keel-night.yml and keel-update.yml, once written, are not the project\'s workflows');
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
  assert.equal(detectCheck(null).check, 'npm run check');
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
