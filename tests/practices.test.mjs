import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, lstat, readdir, appendFile } from 'node:fs/promises';
import { run as spawnRun, testsRan } from './helpers/run.mjs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, claims, fill, plan, config, wanted } from '../lib/practices.mjs';
import { optionalPractices } from './helpers/practices.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RENDER = 'scripts/render.mjs';
const node = (cwd, ...args) => spawnRun(process.execPath, args, { cwd });
const temp = prefix => mkdtemp(join(tmpdir(), `keel-practices-${prefix}-`));
const ACME = {
  name: 'Acme', tagline: 'Acme builds anvils, one checked phase at a time.', repo: 'acme/anvils',
  practice: '0.0.0', practices: ['base', 'agents-md', 'phases', 'evidence', 'lessons', 'conduct', 'ci'],
};
const acmeInto = async dir => {
  await mkdir(join(dir, '.keel'), { recursive: true });
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify(ACME, null, 2) + '\n');
};

test('load preserves practice and file order and reads changed inputs on every call', async () => {
  const dir = await temp('fresh');
  const spec = name => ({ name, summary: 'Acme practice.', requires: [], files: [
    { path: `${name}-z.md`, from: 'z.md', kind: 'managed' },
    { path: `${name}-a.md`, from: 'a.md', kind: 'managed' },
  ] });
  const add = async name => {
    await mkdir(join(dir, name, 'files'), { recursive: true });
    await writeFile(join(dir, name, 'practice.json'), JSON.stringify(spec(name)));
    await writeFile(join(dir, name, 'files/z.md'), 'Acme z\n');
    await writeFile(join(dir, name, 'files/a.md'), 'Acme a\n');
  };
  try {
    await add('zeta');
    await add('alpha');
    const first = await load(dir);
    assert.deepEqual([...first.keys()], ['alpha', 'zeta']);
    assert.deepEqual(first.get('alpha').files.map(f => f.from), ['z.md', 'a.md']);
    const entries = await plan(dir, { ...ACME, practices: ['zeta', 'alpha'] }, first);
    assert.deepEqual(entries.map(e => e.path), ['zeta-z.md', 'zeta-a.md', 'alpha-z.md', 'alpha-a.md']);

    await writeFile(join(dir, 'alpha/files/z.md'), 'Acme revised\n');
    await writeFile(join(dir, 'alpha/practice.json'), JSON.stringify({ ...spec('alpha'), summary: 'Acme revised.' }));
    await rm(join(dir, 'zeta'), { recursive: true });
    await add('beta');
    const second = await load(dir);
    assert.deepEqual([...second.keys()], ['alpha', 'beta']);
    assert.equal(second.get('alpha').summary, 'Acme revised.');
    assert.equal(second.get('alpha').files[0].template, 'Acme revised\n');
    assert.equal(first.get('alpha').files[0].template, 'Acme z\n');

    // Multiple failures still report the first practice in name order, and a
    // previously loaded template cannot hide a later missing file.
    await rm(join(dir, 'alpha/files/a.md'));
    await writeFile(join(dir, 'beta/practice.json'), '{}');
    await assert.rejects(load(dir), /practices\/alpha\/practice\.json: missing template files\/a\.md/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('no target is claimed by two practices', async () => {
  const practices = await load();
  const { whole, blocks } = claims(practices.values());
  assert.ok(whole.size > 0 && blocks.size > 0);
  // The guard itself must be able to fail.
  const twice = [...practices.values()].map(p => p.name === 'ci'
    ? { ...p, files: [...p.files, { practice: 'ci', path: 'scripts/roadmap.mjs', kind: 'managed' }] } : p);
  assert.throws(() => claims(twice), /scripts\/roadmap\.mjs is claimed by (ci and phases|phases and ci)/);
  const blockInManaged = [...practices.values()].map(p => p.name === 'ci'
    ? { ...p, files: [...p.files, { practice: 'ci', path: 'CLAUDE.md', kind: 'block', block: 'ci' }] } : p);
  assert.throws(() => claims(blockInManaged), /sits in a managed file/);
});

test('every managed target exists on keel, and keel switches on every practice', async () => {
  const practices = await load();
  const self = await config(KEEL);
  // A conditional target (practice.json "when") is on keel only while keel's config meets it.
  for (const p of [...practices.values()].filter(p => !p.optional)) for (const f of p.files.filter(f => f.kind === 'managed' && wanted(f, self))) {
    const info = await lstat(join(KEEL, f.path)).catch(() => null);
    assert.ok(info, `${f.path} (${p.name}) is missing on keel`);
    if (f.link) assert.ok(info.isSymbolicLink(), `${f.path} should be a symlink`);
  }
  // Optional practices are each project's own choice: keel has no Loop workspace, keeps claude on (its owner set the token),
  // climbs nightly (the owner's call, 6 Oct), and has its own PRs cross-reviewed (phase 48).
  assert.deepEqual([...(await config(KEEL)).practices].sort(), [...practices.keys()].filter(n => !practices.get(n).optional || ['claude', 'climb', 'cross-review', 'reconciliation'].includes(n)).sort(),
    "keel's .keel/keel.json switches on every practice that is not optional (and the optional ones its owner chose, named here)");
  assert.deepEqual([...practices.values()].filter(p => p.optional).map(p => p.name).sort(), optionalPractices(), 'load() reads each practice.json\'s optional flag');
  assert.ok(['claude', 'climb', 'cross-review', 'reconciliation'].every(n => practices.get(n)?.optional), 'the optional practices keel switches on are optional');
});

test('conduct pins its upstream source', async () => {
  const { source } = (await load()).get('conduct');
  assert.deepEqual(source, { repo: 'dglazkov/isocan', path: '.claude/skills/conduct/SKILL.md', commit: '7227f325', license: 'Apache-2.0' });
});

test('templates name the project only through {{name}}', async () => {
  // Deliberate mentions: provenance and the keel tool itself, never the project.
  const allowed = [/Keel manages this file/, /Lineage: isocan → ledger .* → cajones/, /Adapted from ritmo's/];
  for (const p of (await load()).values()) for (const f of p.files.filter(f => f.template)) {
    for (const line of f.template.split('\n')) {
      if (/\bKeel\b|\bCajones\b/.test(line)) assert.ok(allowed.some(r => r.test(line)), `${p.name} ${f.from}: ${line}`);
    }
  }
});

test('an unknown placeholder is an error; GitHub expressions are not placeholders', () => {
  assert.equal(fill('# {{name}} at {{repo}}', ACME, 'x.md'), '# Acme at acme/anvils');
  assert.throws(() => fill('{{owner}}', ACME, 'x.md'), /x\.md: unknown placeholder \{\{owner\}\}/);
  assert.throws(() => fill('{{ name }}', { name: '' }, 'x.md'), /has no value/);
  assert.equal(fill('group: check-${{ github.ref }}', ACME, 'a.yml'), 'group: check-${{ github.ref }}');
  assert.equal(fill('"{{name}}"', { name: 'A "B"' }, 'a.json'), '"A \\"B\\""');
});

test('an unknown placeholder in a practice fails the render', async () => {
  const dir = await temp('bad');
  try {
    await mkdir(join(dir, 'practices/odd/files'), { recursive: true });
    await writeFile(join(dir, 'practices/odd/practice.json'), JSON.stringify({
      name: 'odd', summary: 'A practice with a typo.', requires: [],
      files: [{ path: 'ODD.md', from: 'ODD.md', kind: 'managed' }],
    }));
    await writeFile(join(dir, 'practices/odd/files/ODD.md'), '# {{nmae}}\n');
    const practices = await load(join(dir, 'practices'));
    await assert.rejects(plan(dir, { ...ACME, practices: ['odd'] }, practices), /ODD\.md: unknown placeholder \{\{nmae\}\}/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('--self --check passes on keel', () => {
  const run = node(KEEL, RENDER, '--self', '--check');
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^Checked \d+ practice targets/);
});

test('--self --check fails on a copy of keel whose managed file or block was edited', async () => {
  const dir = await temp('copy');
  try {
    for (const name of await readdir(KEEL)) {
      if (name === '.git' || name === 'node_modules') continue;
      await cp(join(KEEL, name), join(dir, name), { recursive: true, verbatimSymlinks: true });
    }
    assert.equal(node(dir, RENDER, '--self', '--check').status, 0, 'the untouched copy checks clean');
    await appendFile(join(dir, 'scripts/roadmap.mjs'), '// a local edit\n');
    const agents = join(dir, 'AGENTS.md');
    await writeFile(agents, (await readFile(agents, 'utf8')).replace('Builders test by file.', 'Builders run everything.'));
    const run = node(dir, RENDER, '--self', '--check');
    assert.equal(run.status, 1);
    assert.match(run.stderr, /scripts\/roadmap\.mjs \(phases\)/);
    assert.match(run.stderr, /AGENTS\.md#conduct \(conduct\)/);
    const json = JSON.parse(node(dir, RENDER, '--self', '--check', '--json').stdout);
    assert.deepEqual(json.differs.sort(), ['AGENTS.md#conduct', 'scripts/roadmap.mjs']);
    // A project's own lines outside the blocks are not keel's to check.
    await writeFile(agents, (await readFile(agents, 'utf8')).replace('## The map', '## The map, edited'));
    assert.deepEqual(JSON.parse(node(dir, RENDER, '--self', '--check', '--json').stdout).differs.sort(),
      ['AGENTS.md#conduct', 'scripts/roadmap.mjs']);
    // A local edit is signal: render refuses to write over it and changes nothing.
    const before = await readFile(agents, 'utf8');
    const refused = node(dir, RENDER, '--self');
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /refusing to overwrite what the project changed/);
    assert.equal(await readFile(agents, 'utf8'), before);
    // doctor's restore, asked for, brings keel's bytes back and keeps the project's own lines.
    for (const path of ['scripts/roadmap.mjs', 'AGENTS.md#conduct']) assert.equal(node(dir, 'bin/keel.mjs', 'doctor', '--fix', path, 'restore', '--yes').status, 0);
    assert.equal(node(dir, RENDER, '--self', '--check').status, 0, 'restored');
    assert.match(await readFile(agents, 'utf8'), /## The map, edited/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a render into an empty directory, plus one phase, passes its own npm run check', async () => {
  const dir = await temp('acme');
  try {
    await acmeInto(dir);
    const run = node(KEEL, RENDER, '--into', dir);
    assert.equal(run.status, 0, run.stderr);
    assert.ok((await lstat(join(dir, '.claude/skills/conduct'))).isSymbolicLink());
    assert.match(await readFile(join(dir, '.claude/skills/conduct/SKILL.md'), 'utf8'), /^---\nname: conduct/);
    const agents = await readFile(join(dir, 'AGENTS.md'), 'utf8');
    assert.match(agents, /^# Working on Acme\n/);
    assert.match(agents, /<!-- keel:begin conduct -->\n\*\*Conduct the walk\.\*\*/);
    assert.doesNotMatch(agents, /Keel|\{\{/);
    const lessons = await readFile(join(dir, 'docs/lessons.md'), 'utf8');
    assert.match(lessons, /\| --- \| --- \| --- \| --- \|\n$/, 'an empty table, not keel\'s central rows');
    const template = await readFile(join(dir, 'docs/templates/phase.md'), 'utf8');
    await writeFile(join(dir, 'docs/phases/00-acme-starts.md'), template.replace('YYYY-MM-DD', '2026-10-02'));
    const npm = (...a) => spawnRun('npm', a, { cwd: dir });
    assert.equal(npm('run', 'roadmap').status, 0);
    // The template as it stands is refused by the project's own check (phase 32), naming the section.
    const draft = npm('run', 'roadmap:check');
    assert.notEqual(draft.status, 0);
    assert.match(draft.stdout + draft.stderr, /docs\/phases\/00-acme-starts\.md: ## Done when still holds the template's text/);
    const written = template.replace('YYYY-MM-DD', '2026-10-02').replace(/^# .+$/m, '# Acme starts')
      .replace(/## Done when\n\n[\s\S]*?(?=## Proof)/, '## Done when\n\nAcme prints its name.\n\n## Scope\n\nOne command.\n\n## Acceptance\n\n- [ ] It prints "Acme". `node acme.mjs`\n\n## Real surfaces\n\nnone\n\n')
      .replace(/## Proof\n\n[\s\S]*$/, '## Proof\n\n`node acme.mjs`.\n\n## Deliberately open\n\nNothing yet.\n\n## Next action\n\nWrite acme.mjs.\n');
    await writeFile(join(dir, 'docs/phases/00-acme-starts.md'), written);
    assert.equal(npm('run', 'roadmap').status, 0);
    const check = npm('run', 'check');
    assert.equal(check.status, 0, check.stdout + check.stderr);
    assert.ok(testsRan(check.stdout + check.stderr) > 0, `the gate ran no tests:\n${check.stdout}${check.stderr}`);
    assert.match(check.stdout + check.stderr, /a well-formed phase parses/);
    const roadmap = await readFile(join(dir, 'docs/ROADMAP.md'), 'utf8');
    assert.match(roadmap, /^# Acme roadmap$/m);
    assert.match(roadmap, /\[Working rules\]\(\.\.\/AGENTS\.md\) · \[Lessons\]\(lessons\.md\)\n/, 'no link to a design doc Acme lacks');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a second render never overwrites seeded files, and refuses to overwrite edited managed ones', async () => {
  const dir = await temp('again');
  try {
    await acmeInto(dir);
    assert.equal(node(KEEL, RENDER, '--into', dir).status, 0);
    const mine = {
      'docs/lessons.md': '# Acme lessons\n\nOurs now.\n',
      'docs/goals.json': '[{ "id": "G0", "title": "Anvils", "outcome": "They ship." }]\n',
      'package.json': '{ "private": true, "scripts": {} }\n',
      '.gitignore': 'dist/\n',
    };
    for (const [path, text] of Object.entries(mine)) await writeFile(join(dir, path), text);
    const agents = join(dir, 'AGENTS.md');
    await writeFile(agents, (await readFile(agents, 'utf8')).replace('Write them here.', 'Anvils are heavy.')
      .replace('**Lessons are shapes, not incidents.**', '**Lessons are optional.**'));
    await writeFile(join(dir, 'CLAUDE.md'), 'Drifted.\n');
    const refused = node(KEEL, RENDER, '--into', dir);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /AGENTS\.md#lessons edited.*CLAUDE\.md edited|CLAUDE\.md edited.*AGENTS\.md#lessons edited/);
    assert.equal(await readFile(join(dir, 'CLAUDE.md'), 'utf8'), 'Drifted.\n');
    // Restored by choice (doctor --fix restore), the next render goes through.
    for (const path of ['CLAUDE.md', 'AGENTS.md#lessons']) assert.equal(node(dir, join(KEEL, 'bin/keel.mjs'), 'doctor', '--fix', path, 'restore', '--yes').status, 0);
    const second = JSON.parse(node(KEEL, RENDER, '--into', dir, '--json').stdout);
    assert.equal(second.ok, true);
    for (const [path, text] of Object.entries(mine)) assert.equal(await readFile(join(dir, path), 'utf8'), text, path);
    assert.ok(second.entries.filter(e => e.kind === 'seeded').every(e => e.status === 'kept'));
    const after = await readFile(agents, 'utf8');
    assert.match(after, /Anvils are heavy\./);
    assert.match(after, /\*\*Lessons are shapes, not incidents\.\*\*/);
    assert.equal(await readFile(join(dir, 'CLAUDE.md'), 'utf8'), await readFile(join(KEEL, 'CLAUDE.md'), 'utf8'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
