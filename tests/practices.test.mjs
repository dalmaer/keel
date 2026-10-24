import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, lstat, appendFile } from 'node:fs/promises';
import { run as spawnRun, testsRan } from './helpers/run.mjs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, claims, fill, plan, config, wanted, targets } from '../lib/practices.mjs';
import { optionalPractices } from './helpers/practices.mjs';
import { NAMES } from '../lib/names.mjs';
import { copyProject } from './helpers/copy-project.mjs';

const PLATES = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RENDER = 'scripts/render.mjs';
const node = (cwd, ...args) => spawnRun(process.execPath, args, { cwd });
const temp = prefix => mkdtemp(join(tmpdir(), `plates-practices-${prefix}-`));
const ACME = {
  name: 'Acme', tagline: 'Acme builds anvils, one checked phase at a time.', repo: 'acme/anvils',
  practice: '0.0.0', practices: ['base', 'agents-md', 'phases', 'evidence', 'lessons', 'conduct', 'ci'],
};
const acmeInto = async dir => {
  await mkdir(join(dir, '.plates'), { recursive: true });
  await writeFile(join(dir, '.plates/plates.json'), JSON.stringify(ACME, null, 2) + '\n');
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

test('every managed target exists on plates, and plates switches on every practice', async () => {
  const practices = await load();
  const self = await config(PLATES);
  // A conditional target (practice.json "when") is on plates only while plates's config meets it.
  for (const p of [...practices.values()].filter(p => !p.optional)) for (const f of p.files.filter(f => f.kind === 'managed' && wanted(f, self))) {
    const info = await lstat(join(PLATES, f.path)).catch(() => null);
    assert.ok(info, `${f.path} (${p.name}) is missing on plates`);
    if (f.link) assert.ok(info.isSymbolicLink(), `${f.path} should be a symlink`);
  }
  // Optional practices are each project's own choice: plates has no Loop workspace, keeps claude on (its owner set the token),
  // climbs nightly (the owner's call, 6 Oct), has its own PRs cross-reviewed (phase 48), and keeps a performance persona (the owner's call, 16 Oct).
  assert.deepEqual([...(await config(PLATES)).practices].sort(), [...practices.keys()].filter(n => !practices.get(n).optional || ['claude', 'climb', 'cross-review', 'personas', 'reconciliation'].includes(n)).sort(),
    "plates's .plates/plates.json switches on every practice that is not optional (and the optional ones its owner chose, named here)");
  assert.deepEqual([...practices.values()].filter(p => p.optional).map(p => p.name).sort(), optionalPractices(), 'load() reads each practice.json\'s optional flag');
  assert.ok(['claude', 'climb', 'cross-review', 'reconciliation'].every(n => practices.get(n)?.optional), 'the optional practices plates switches on are optional');
});

test('conduct pins its upstream source', async () => {
  const { source } = (await load()).get('conduct');
  assert.deepEqual(source, { repo: 'dglazkov/isocan', path: '.claude/skills/conduct/SKILL.md', commit: '7227f325', license: 'Apache-2.0' });
});

test('spin is the canonical conductor and conduct is a forwarding alias with no second policy', async () => {
  const practice = (await load()).get('conduct');
  const canonical = practice.files.find(file => file.path === '.agents/skills/spin/SKILL.md');
  const alias = practice.files.find(file => file.path === '.agents/skills/conduct/SKILL.md');
  assert.match(canonical.template, /^---\nname: spin\n/);
  assert.match(alias.template, /^---\nname: conduct\n/);
  assert.match(alias.template, /\(\.\.\/spin\/SKILL\.md\)/);
  assert.match(alias.template, /Forward every argument unchanged/);
  assert.match(alias.template, /adds no authority/);
  assert.ok(alias.template.length < 1000, 'alias forwards instead of copying execution policy');
  for (const name of ['spin', 'conduct']) {
    assert.equal(practice.files.find(file => file.path === `.claude/skills/${name}`).link, `../../.agents/skills/${name}`);
  }
  for (const argument of ['/spin status', '/spin <N>', '/spin one']) assert.ok(canonical.template.includes(argument));
  for (const rule of ['before every resume', 'digest used', 'claims', 'plates review', 'The default is unattended.']) assert.ok(canonical.template.includes(rule), rule);
});

test('ejected legacy conductor ownership prevents installing a different default spin policy', async () => {
  const { targets } = await import('../lib/practices.mjs');
  const all = await load();
  const base = { name: 'Acme', repo: 'acme/app', practices: ['base','agents-md','phases','evidence','lessons','conduct'] };
  assert.ok(targets(base, all).some(file => file.path === '.agents/skills/spin/SKILL.md'));
  for (const path of ['.agents/skills/conduct/SKILL.md', '.claude/skills/conduct']) {
    const files = targets({ ...base, ejected: [path] }, all);
    assert.ok(!files.some(file => file.practice === 'conduct'), path);
    assert.ok(files.some(file => file.practice === 'phases'), 'unrelated practice remains enabled');
  }
});

function withoutCanonicalNameValue(practice, file, line) {
  if (practice !== 'night' || file !== 'scripts/plates/names.mjs') return line;
  // Admit only the plates field of an explicit registered inventory row. The
  // rest of that row, adjacent prose and every other file still face the guard.
  const match = /^\s*Object\.freeze\((\{.*\})\),?\s*$/.exec(line);
  if (!match) return line;
  let row;
  try { row = JSON.parse(match[1]); } catch { return line; }
  const canonical = NAMES.find(value => value.id === row.id);
  if (!canonical || row.plates !== canonical.plates) return line;
  return line.replace(/("plates"\s*:\s*)("(?:\\.|[^"\\])*")/g,
    (field, key, value) => JSON.parse(value) === canonical.plates ? `${key}""` : field);
}

function assertTemplateProjectNames(practices) {
  // Deliberate mentions: provenance and the plates tool itself, never the project.
  const allowed = [/Plates manages this file/, /Lineage: isocan → ledger .* → cajones/, /Adapted from ritmo's/, /Plates lessons?\b/, /Plates catalogue/];
  for (const p of practices) for (const f of p.files.filter(f => f.template)) {
    for (const line of f.template.split('\n')) {
      const checked = withoutCanonicalNameValue(p.name, f.from, line);
      if (/\bPlates\b|\bCajones\b/.test(checked)) assert.ok(allowed.some(r => r.test(checked)), `${p.name} ${f.from}: ${line}`);
    }
  }
}

test('templates name the project only through {{name}}', async () => {
  assertTemplateProjectNames((await load()).values());
});

test('canonical inventory values do not exempt arbitrary project names from the template guard', () => {
  const row = NAMES.find(value => value.id === 'web:Keel-Operation');
  assert.equal(row.plates, 'Plates-Operation');
  const line = value => `  Object.freeze(${JSON.stringify(value)}),`;
  const practice = (template, from = 'scripts/plates/names.mjs', name = 'night') => [{ name, files: [{ from, template }] }];
  assert.doesNotThrow(() => assertTemplateProjectNames(practice(line(row))));
  for (const template of [
    `${line(row)}\n// Plates is this project's name`,
    `// Cajones is this project's name\n${line(row)}`,
    `${line(row)} // Plates is this project's name`,
    line({ ...row, note: 'Plates is this project' }),
    line({ ...row, plates: 'Plates is this project' }),
    line({ ...row, id: 'acme:unknown' }),
  ]) assert.throws(() => assertTemplateProjectNames(practice(template)), /night scripts\/plates\/names\.mjs:/);
  assert.throws(() => assertTemplateProjectNames(practice(line(row), 'scripts/plates/acme.mjs')), /night scripts\/plates\/acme\.mjs:/);
  assert.throws(() => assertTemplateProjectNames(practice(line(row), 'scripts/plates/names.mjs', 'acme')), /acme scripts\/plates\/names\.mjs:/);
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

test('--self --check passes on plates', () => {
  const run = node(PLATES, RENDER, '--self', '--check');
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^Checked \d+ practice targets/);
});

test('--self --check fails on a copy of plates whose managed file or block was edited', async () => {
  const dir = await temp('copy');
  try {
    await copyProject(PLATES, dir);
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
    // A project's own lines outside the blocks are not plates's to check.
    await writeFile(agents, (await readFile(agents, 'utf8')).replace('## The map', '## The map, edited'));
    assert.deepEqual(JSON.parse(node(dir, RENDER, '--self', '--check', '--json').stdout).differs.sort(),
      ['AGENTS.md#conduct', 'scripts/roadmap.mjs']);
    // A local edit is signal: render refuses to write over it and changes nothing.
    const before = await readFile(agents, 'utf8');
    const refused = node(dir, RENDER, '--self');
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /refusing to overwrite what the project changed/);
    assert.equal(await readFile(agents, 'utf8'), before);
    // doctor's restore, asked for, brings plates's bytes back and keeps the project's own lines.
    for (const path of ['scripts/roadmap.mjs', 'AGENTS.md#conduct']) assert.equal(node(dir, 'bin/plates.mjs', 'doctor', '--fix', path, 'restore', '--yes').status, 0);
    assert.equal(node(dir, RENDER, '--self', '--check').status, 0, 'restored');
    assert.match(await readFile(agents, 'utf8'), /## The map, edited/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a render into an empty directory, plus one phase, passes its own npm run check', async () => {
  const dir = await temp('acme');
  try {
    await acmeInto(dir);
    const run = node(PLATES, RENDER, '--into', dir);
    assert.equal(run.status, 0, run.stderr);
    assert.ok((await lstat(join(dir, '.claude/skills/conduct'))).isSymbolicLink());
    const conduct = await readFile(join(dir, '.claude/skills/spin/SKILL.md'), 'utf8');
    assert.match(conduct, /^---\nname: spin/);
    // Phase 87: the adopted project's skill carries the restatement, the report shape and the conductor's checks.
    for (const line of ['Restate the success criteria in your own words before writing code.', '0. Done means: your restatement', '**Read the report\'s shape first.**'])
      assert.ok(conduct.includes(line), line);
    const agents = await readFile(join(dir, 'AGENTS.md'), 'utf8');
    assert.match(agents, /^# Working on Acme\n/);
    assert.match(agents, /<!-- plates:begin conduct -->\n\*\*Spin the next phase\.\*\*/);
    assert.doesNotMatch(agents, /\{\{/);
    assert.doesNotMatch(agents, /^# Working on Plates/m, 'provenance may name Plates; the project heading must name Acme');
    const lessons = await readFile(join(dir, 'docs/lessons.md'), 'utf8');
    assert.match(lessons, /\| --- \| --- \| --- \| --- \|\n$/, 'an empty table, not plates\'s central rows');
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
    assert.equal(node(PLATES, RENDER, '--into', dir).status, 0);
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
    const refused = node(PLATES, RENDER, '--into', dir);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /AGENTS\.md#lessons edited.*CLAUDE\.md edited|CLAUDE\.md edited.*AGENTS\.md#lessons edited/);
    assert.equal(await readFile(join(dir, 'CLAUDE.md'), 'utf8'), 'Drifted.\n');
    // Restored by choice (doctor --fix restore), the next render goes through.
    for (const path of ['CLAUDE.md', 'AGENTS.md#lessons']) assert.equal(node(dir, join(PLATES, 'bin/plates.mjs'), 'doctor', '--fix', path, 'restore', '--yes').status, 0);
    const second = JSON.parse(node(PLATES, RENDER, '--into', dir, '--json').stdout);
    assert.equal(second.ok, true);
    for (const [path, text] of Object.entries(mine)) assert.equal(await readFile(join(dir, path), 'utf8'), text, path);
    assert.ok(second.entries.filter(e => e.kind === 'seeded').every(e => e.status === 'kept'));
    const after = await readFile(agents, 'utf8');
    assert.match(after, /Anvils are heavy\./);
    assert.match(after, /\*\*Lessons are shapes, not incidents\.\*\*/);
    assert.equal(await readFile(join(dir, 'CLAUDE.md'), 'utf8'), await readFile(join(PLATES, 'CLAUDE.md'), 'utf8'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('render probe copies exclude runtime ledgers at every depth and preserve project inputs', async t => {
  const source = await temp('acme-copy-source'), destination = await temp('acme-copy-destination');
  t.after(() => Promise.all([source, destination].map(dir => rm(dir, { recursive: true, force: true }))));
  for (const base of ['', 'tests/fixtures/acme', 'packages/acme/nested']) {
    await mkdir(join(source, base, '.plates/test-runs'), { recursive: true });
    await writeFile(join(source, base, '.plates/test-runs/acme.json'), '{}');
    await writeFile(join(source, base, '.plates/plates.json'), JSON.stringify({ name: 'Acme' }));
  }
  for (const dir of ['.git', 'node_modules', 'test-runs', '.plates/test-runs-source']) {
    await mkdir(join(source, dir), { recursive: true });
    await writeFile(join(source, dir, 'acme.json'), '{}');
  }
  await copyProject(source, destination);
  for (const base of ['', 'tests/fixtures/acme', 'packages/acme/nested']) {
    await assert.rejects(lstat(join(destination, base, '.plates/test-runs')), { code: 'ENOENT' });
    assert.deepEqual(JSON.parse(await readFile(join(destination, base, '.plates/plates.json'), 'utf8')), { name: 'Acme' });
  }
  for (const dir of ['.git', 'node_modules']) await assert.rejects(lstat(join(destination, dir)), { code: 'ENOENT' });
  for (const dir of ['test-runs', '.plates/test-runs-source']) assert.equal(await readFile(join(destination, dir, 'acme.json'), 'utf8'), '{}');
  // A selected-root clone copies .plates independently, not necessarily its parent.
  const metadata = join(destination, 'metadata');
  await copyProject(join(source, '.plates'), metadata);
  await assert.rejects(lstat(join(metadata, 'test-runs')), { code: 'ENOENT' });
  assert.deepEqual(JSON.parse(await readFile(join(metadata, 'plates.json'), 'utf8')), { name: 'Acme' });
  assert.equal(await readFile(join(metadata, 'test-runs-source/acme.json'), 'utf8'), '{}');
  await assert.rejects(copyProject(join(source, 'missing'), join(destination, 'missing')), { code: 'ENOENT' }, 'ordinary missing inputs are not swallowed');
});

test('each shipped structural guide and conduct rule carries its cause with Plates provenance', async () => {
  const { ruleCauseNotes } = await import('../practices/night/files/scripts/plates/lib.mjs');
  const practices = await load();
  let scanned = 0;
  for (const practice of practices.values()) for (const file of practice.files) {
    if (!(file.kind === 'block' && file.path === 'AGENTS.md') && file.path !== '.agents/skills/spin/SKILL.md') continue;
    const path = `practices/${practice.name}/files/${file.from}`;
    const raw = await readFile(join(PLATES, path), 'utf8');
    assert.deepEqual(ruleCauseNotes(raw, path), [], path);
    assert.doesNotMatch(raw, /\(why: lesson \d/i, 'shipped lesson references must distinguish Plates from local numbers');
    scanned++;
  }
  assert.ok(scanned >= 8);
  const seed = await readFile(join(PLATES, 'practices/agents-md/files/AGENTS.md'), 'utf8');
  assert.match(seed, /Plates catalogue/);
});

test('the optional personas practice installs the runner and an example persona, renders clean, and the runner runs in the project', async () => {
  const dir = await temp('personas');
  try {
    await mkdir(join(dir, '.plates'), { recursive: true });
    await writeFile(join(dir, '.plates/plates.json'), JSON.stringify({ ...ACME, practices: ['base', 'agents-md', 'night', 'personas'] }, null, 2) + '\n');
    const rendered = node(PLATES, RENDER, '--into', dir);
    assert.equal(rendered.status, 0, rendered.stderr);
    const source = join(PLATES, 'practices/personas/files');
    assert.equal(await readFile(join(dir, 'scripts/plates/persona.mjs'), 'utf8'), await readFile(join(source, 'scripts/plates/persona.mjs'), 'utf8'), 'the runner, managed');
    assert.equal(await readFile(join(dir, '.agents/personas/performance.md'), 'utf8'), await readFile(join(source, '.agents/personas/performance.md'), 'utf8'), 'the example, seeded');
    const lock = await readFile(join(dir, '.plates/lock.json'), 'utf8');
    assert.ok(lock.includes('scripts/plates/persona.mjs'), 'the lock knows the runner');
    assert.ok(!lock.includes('.agents/personas/performance.md'), "a seeded example is the project's, not in the lock");
    const check = node(PLATES, RENDER, '--into', dir, '--check');
    assert.equal(check.status, 0, check.stderr);
    // The project's own copy runs with no plates: the example's placeholders read broken, never met.
    const ran = node(dir, 'scripts/plates/persona.mjs', 'run', '--all', '--json');
    assert.equal(ran.status, 2, ran.stderr);
    const data = JSON.parse(ran.stdout);
    assert.deepEqual(data.personas[0].goals.map(g => [g.name, g.state]), [['entry bundle size', 'broken'], ['interaction latency', 'broken']]);
    assert.match(await readFile(join(dir, data.personas[0].page), 'utf8'), /Measured by `node scripts\/plates\/persona\.mjs run`/);
    // The runner uses the night's lib.mjs: the practice requires night.
    assert.deepEqual((await load()).get('personas').requires, ['night']);
    assert.ok(optionalPractices().includes('personas'), 'personas is only ever asked for');
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('optional production secrets are validated and needed only for configured Vercel', async () => {
  const { secretsNeeded } = await import('../lib/init.mjs');
  const practices = await load();
  const source = { id:'acme', provider:'vercel', service:'acme', environment:'production', project:'prj_acme', scope:'team_acme', windowMinutes:60, maxEvents:100, maxBytes:10000, timeoutMs:5000, threshold:2 };
  const config = sources => ({ production:{version:1,enabled:true,sources} });
  for (const c of [{}, {production:{version:1,enabled:false}}, config([{...source,provider:'gcp',region:'us-west1'}])]) assert.deepEqual(secretsNeeded(practices,['night'],c), []);
  const needed = secretsNeeded(practices,['night'],config([source]));
  assert.equal(needed.length,1); assert.equal(needed[0].name,'VERCEL_API_TOKEN'); assert.equal(needed[0].optional,true);
  assert.match(needed[0].why,/OPTIONAL/);
  assert.throws(()=>secretsNeeded(practices,['night'],config([{...source,maxEvents:0}])));
  const dir = await temp('optional-secret');
  try {
    await mkdir(join(dir,'acme/files'),{recursive:true});
    await writeFile(join(dir,'acme/files/a.md'),'Acme');
    const spec = {name:'acme',summary:'Acme',requires:[],files:[{path:'a.md',from:'a.md',kind:'managed'}]};
    for (const metadata of [{optional:'true'}, {when:'unknown',optional:true}, {when:'production-vercel'}, {when:'production-vercel',optional:false}]) {
      await writeFile(join(dir,'acme/practice.json'),JSON.stringify({...spec,secrets:[{name:'ACME_TOKEN',why:'Acme',workflow:'acme.yml',...metadata}]}));
      await assert.rejects(load(dir),/secrets/);
    }
  } finally { await rm(dir,{recursive:true,force:true}); }
});


test('runtime imports keep one owner without enabling optional practice surfaces or overwriting local work', async t => {
  const dir = await temp('runtime-imports');t.after(() => rm(dir,{recursive:true,force:true}));
  const practices = await load();
  const cfg = {...ACME, practices:[...ACME.practices,'night','climb']};
  const selected = targets(cfg,practices);
  for (const path of ['scripts/plates/reconcile.mjs','scripts/plates/decision-context.mjs']) {
    const matches=selected.filter(f=>f.path===path);assert.equal(matches.length,1);assert.equal(matches[0].practice,'reconciliation');
  }
  assert.ok(!selected.some(f=>f.path==='.github/workflows/plates-impact.yml'));
  assert.ok(!selected.some(f=>f.path==='docs/reconciliation.md'));
  const both=targets({...cfg,practices:[...cfg.practices,'reconciliation']},practices);
  assert.equal(both.filter(f=>f.path==='scripts/plates/reconcile.mjs').length,1);
  assert.ok(both.some(f=>f.path==='.github/workflows/plates-impact.yml'));
  const local=targets({...cfg,local:{reconciliation:'Acme owns these scripts'}},practices);
  assert.ok(!local.some(f=>f.path==='scripts/plates/reconcile.mjs'));
  await mkdir(join(dir,'scripts/plates'),{recursive:true});
  await writeFile(join(dir,'scripts/plates/reconcile.mjs'),'// Acme human runtime\n');
  const entries=await plan(dir,cfg,practices);
  assert.equal(entries.find(f=>f.path==='scripts/plates/reconcile.mjs').state,'edited');
});

test('runtime declarations cannot import workflows, absent files, seeded files or symlinks', async t => {
  const dir=await temp('runtime-validation');t.after(()=>rm(dir,{recursive:true,force:true}));
  for(const name of ['source','consumer'])await mkdir(join(dir,name,'files'),{recursive:true});
  await mkdir(join(dir,'source/files/scripts/plates'),{recursive:true});
  await writeFile(join(dir,'source/files/scripts/plates/acme.mjs'),'// Acme\n');
  await writeFile(join(dir,'consumer/files/README.md'),'Acme\n');
  const source=kind=>({name:'source',summary:'Acme source',requires:[],files:[{path:'scripts/plates/acme.mjs',from:'scripts/plates/acme.mjs',kind}]});
  const consumer=path=>({name:'consumer',summary:'Acme consumer',requires:[],runtimeFiles:[{practice:'source',path}],files:[{path:'README.md',from:'README.md',kind:'seeded'}]});
  await writeFile(join(dir,'source/practice.json'),JSON.stringify(source('managed')));
  for(const path of ['.github/workflows/acme.yml','scripts/plates/missing.mjs','../acme.mjs']){
    await writeFile(join(dir,'consumer/practice.json'),JSON.stringify(consumer(path)));
    await assert.rejects(load(dir),/runtime/);
  }
  await writeFile(join(dir,'consumer/practice.json'),JSON.stringify(consumer('scripts/plates/acme.mjs')));
  await writeFile(join(dir,'source/practice.json'),JSON.stringify(source('seeded')));
  await assert.rejects(load(dir),/unconditional managed script/);
  const linked=source('managed');linked.files=[{path:'scripts/plates/acme.mjs',kind:'managed',link:'other.mjs'}];
  await writeFile(join(dir,'source/practice.json'),JSON.stringify(linked));
  await assert.rejects(load(dir),/unconditional managed script/);
});
