import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, lstat, link, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { run } from './helpers/run.mjs';
import { adopt } from '../lib/adopt.mjs';
import { render, config, practiceVersion } from '../lib/practices.mjs';
import { diagnose, doctor } from '../lib/doctor.mjs';
import { guideDestination, guideTargetsOverlap } from '../lib/guide.mjs';
import { readLock } from '../lib/lock.mjs';
import { init } from '../lib/init.mjs';
import { update } from '../lib/update.mjs';
import { collect } from '../lib/migrations.mjs';
import * as ledger from '../migrations/0004-test-ledger.mjs';
const version = { cli: '0.0.0', practice: practiceVersion() };
async function acme(t) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-guide-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'acme', scripts: { check: 'node -e ""' } }));
  return dir;
}
const read = (dir, path) => readFile(join(dir, path), 'utf8');
const absent = async (dir, path) => assert.equal(await lstat(join(dir, path)).catch(() => null), null);
const adoptAt = (dir, opts = {}) => adopt({ dir, ...opts }, { version });

test('CLAUDE-only adoption, render, doctor, contracts, skip and eject share one guide', async t => {
  const dir = await acme(t), prose = '# Acme\r\n\r\nKeep my bytes.\r\n';
  await writeFile(join(dir, 'CLAUDE.md'), prose);
  const dry = await adoptAt(dir, { dryRun: true });
  assert.equal(dry.data.config.guide, 'CLAUDE.md');
  assert.match(dry.text, /Guide: CLAUDE.md/);
  for (const name of ['agents-md', 'lessons', 'night']) assert.equal(dry.data.practices.find(p => p.name === name).state, 'on');
  await absent(dir, '.keel');
  await adoptAt(dir);
  assert.ok((await read(dir, 'CLAUDE.md')).startsWith(prose));
  await absent(dir, 'AGENTS.md');
  assert.match(await read(dir, '.agents/skills/keel/SKILL.md'), /Read `CLAUDE.md`/);
  assert.ok((await readLock(dir)).files['CLAUDE.md#night']);
  assert.equal((await readLock(dir)).files['CLAUDE.md'], undefined);
  assert.equal((await render(dir, { check: true })).ok, true);
  assert.deepEqual((await diagnose(dir)).drift, []);
  const text = await read(dir, 'CLAUDE.md');
  await writeFile(join(dir, 'CLAUDE.md'), text.replace('**A hygiene note is work.**', '**Acme owns this rule.**'));
  assert.ok((await diagnose(dir)).drift.some(d => d.path === 'CLAUDE.md#night' && d.state === 'edited'));
  await assert.rejects(render(dir), /refusing to overwrite/);
  await doctor({ root: dir, fix: ['CLAUDE.md#night', 'eject'], yes: true });
  await render(dir);
  assert.match(await read(dir, 'CLAUDE.md'), /Acme owns this rule/);
  const cfg = JSON.parse(await read(dir, '.keel/keel.json'));
  cfg.blocksSkipped = ['agents-md']; cfg.contracts = [{ paths: ['src/**'], read: 'docs/contract.md', why: 'Acme contract' }];
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify(cfg));
  const note = (await diagnose(dir)).notes.find(n => n.rule === 'contract-guide');
  assert.equal(note.path, 'CLAUDE.md');
  assert.match(note.message, /rows to CLAUDE.md/);
});

test('both real guides default to AGENTS and preserve the other guide', async t => {
  const dir = await acme(t);
  await writeFile(join(dir, 'AGENTS.md'), '# Acme\n');
  await writeFile(join(dir, 'CLAUDE.md'), '# Acme Claude rules\n');
  const r = await adoptAt(dir);
  assert.equal(r.data.config.guide, 'AGENTS.md');
  assert.equal(await read(dir, 'CLAUDE.md'), '# Acme Claude rules\n');
  assert.deepEqual((await diagnose(dir)).drift, []);
});

test('custom guide and explicit AGENTS override seed only the chosen guide', async t => {
  for (const guide of ['docs/team.md', 'AGENTS.md']) {
    const dir = await acme(t);
    await writeFile(join(dir, 'CLAUDE.md'), '# Acme legacy\n');
    await adoptAt(dir, { guide });
    assert.match(await read(dir, guide), /keel:begin agents-md/);
    assert.ok((await read(dir, guide)).includes(guide === 'AGENTS.md'
      ? '[`docs/lessons.md`](docs/lessons.md)' : '[`docs/lessons.md`](lessons.md)'));
    assert.equal(await read(dir, 'CLAUDE.md'), '# Acme legacy\n');
    if (guide !== 'AGENTS.md') await absent(dir, 'AGENTS.md');
  }
});

test('symlink pair canonicalizes old block locks without losing edited drift or ejections', async t => {
  const dir = await acme(t);
  await writeFile(join(dir, 'CLAUDE.md'), '# Acme\n');
  await symlink('CLAUDE.md', join(dir, 'AGENTS.md'));
  await adoptAt(dir);
  const raw = JSON.parse(await read(dir, '.keel/lock.json'));
  raw.files = Object.fromEntries(Object.entries(raw.files).map(([k,v]) => [k.replace(/^CLAUDE.md#/, 'AGENTS.md#'),v]));
  await writeFile(join(dir, '.keel/lock.json'), JSON.stringify(raw));
  const cfg = JSON.parse(await read(dir, '.keel/keel.json')); delete cfg.guide;
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify(cfg));
  const before = await read(dir, '.keel/keel.json'), lockBefore = await read(dir, '.keel/lock.json');
  assert.deepEqual((await diagnose(dir)).drift, []);
  assert.equal(await read(dir, '.keel/keel.json'), before);
  assert.equal(await read(dir, '.keel/lock.json'), lockBefore);
  const text = await read(dir, 'CLAUDE.md');
  await writeFile(join(dir, 'CLAUDE.md'), text.replace('**A hygiene note is work.**', '**Acme edited.**'));
  await assert.rejects(render(dir), /CLAUDE.md#night/);
  await doctor({ root: dir, fix: ['AGENTS.md#night', 'eject'], yes: true });
  await render(dir);
  assert.ok((await lstat(join(dir, 'AGENTS.md'))).isSymbolicLink());
  assert.match(await read(dir, 'CLAUDE.md'), /Acme edited/);
  assert.ok(Object.keys((await readLock(dir)).files).every(k => !k.startsWith('AGENTS.md#')));
});

test('locked guides cannot be silently moved, including when the original is missing', async t => {
  const dir = await acme(t);
  await adoptAt(dir);
  await assert.rejects(adoptAt(dir, { guide: 'docs/other.md' }), /refusing to move/);
  await rm(join(dir, 'AGENTS.md'));
  const cfg = JSON.parse(await read(dir, '.keel/keel.json')); delete cfg.guide;
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify(cfg));
  assert.ok((await diagnose(dir)).drift.some(d => d.path.startsWith('AGENTS.md#') && d.missing));
});

test('guide rejects traversal, directories, dangling, cyclic and escaping symlink chains before adoption writes', async t => {
  const dir = await acme(t), outside = await acme(t);
  await mkdir(join(dir, 'docs'));
  await symlink(outside, join(dir, 'escape'));
  await symlink('loop', join(dir, 'loop'));
  await symlink('missing.md', join(dir, 'dangling'));
  await symlink(join(dir, 'docs'), join(outside, 'return'));
  for (const guide of ['../outside.md', '/tmp/a.md', 'docs', 'escape/return/guide.md', 'loop', 'dangling', 'docs/../a.md', '.git/config', '.keel/keel.json', '.keel/lock.json', 'package.json']) {
    await assert.rejects(adoptAt(dir, { guide }), /guide:|ELOOP/);
    await absent(dir, '.keel');
  }
  await symlink('docs', join(dir, 'alias'));
  assert.equal(guideDestination(dir, 'alias/rules.md'), 'docs/rules.md');
});

test('init supports CLAUDE and custom paths without a duplicate', async t => {
  for (const guide of ['CLAUDE.md', 'docs/rules.md']) {
    const dir = await acme(t); await rm(join(dir, 'package.json'));
    await init({ dir, guide, name: 'Acme', description: 'Acme makes anvils.', kind: 'node' }, { version });
    await absent(dir, 'AGENTS.md');
    assert.match(await read(dir, guide), /Acme makes anvils/);
    assert.ok((await read(dir, guide)).includes(guide === 'CLAUDE.md'
      ? '[`docs/lessons.md`](docs/lessons.md)' : '[`docs/lessons.md`](lessons.md)'));
    assert.deepEqual((await diagnose(dir)).drift, []);
  }
});

test('legacy night migration writes the configured guide, and update keeps it single', async t => {
  const dir = await acme(t);
  await writeFile(join(dir, 'CLAUDE.md'), '# Acme\n');
  await adoptAt(dir);
  const text = await read(dir, 'CLAUDE.md');
  await writeFile(join(dir, 'CLAUDE.md'), text.replace(/\n<!-- keel:begin night -->[\s\S]*?<!-- keel:end night -->\n/, '\n'));
  const edits = await collect(dir, [ledger]);
  assert.ok(edits.edits.has('CLAUDE.md'));
  assert.ok(!edits.edits.has('AGENTS.md'));
  await writeFile(join(dir, 'CLAUDE.md'), text);
  const cfg = JSON.parse(await read(dir, '.keel/keel.json')); cfg.practice = '0.0.0';
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify(cfg));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'Acme fixture'], { cwd: dir });
  const env = { ...process.env }; for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  const r = await update({ dir, local: true, selfUpdate: false }, { version: version.practice, env });
  assert.equal(r.exitCode ?? 0, 0, r.text);
  await absent(dir, 'AGENTS.md');
  assert.ok((await read(dir, 'CLAUDE.md')).startsWith('# Acme\n'));
});

test('invalid init guide leaves an empty directory and no git or config writes', async t => {
  for (const guide of ['.git/config', '.keel/keel.json', '.keel/lock.json', 'package.json', '../escape.md']) {
    const dir = await acme(t); await rm(join(dir, 'package.json'));
    await assert.rejects(init({ dir, guide, description: 'Acme makes anvils.' }, { version }), /guide:/);
    await absent(dir, '.git'); await absent(dir, '.keel');
  }
});

test('guide review: init-owned files cannot be replaced by a selected guide', async t => {
  for (const guide of ['README.md', 'docs/ROADMAP.md', 'docs/evidence/README.md', 'docs/phases/00-first-thing-that-runs.md']) {
    const dir = await acme(t); await rm(join(dir, 'package.json'));
    await assert.rejects(init({ dir, guide, description: 'Acme makes anvils.' }, { version }), /guide:.*init-owned/);
    await absent(dir, '.git'); await absent(dir, '.keel'); await absent(dir, 'README.md'); await absent(dir, 'docs');
  }
});

test('reverse symlink, conflicting aliases, and unrelated block lock identities', async t => {
  const dir = await acme(t);
  await writeFile(join(dir, 'AGENTS.md'), '# Acme\n');
  await symlink('AGENTS.md', join(dir, 'CLAUDE.md'));
  await adoptAt(dir);
  assert.equal((await readLock(dir)).files['CLAUDE.md'], undefined);
  assert.deepEqual((await diagnose(dir)).drift, []);
  const raw = JSON.parse(await read(dir, '.keel/lock.json'));
  raw.files['CLAUDE.md#night'] = { ...raw.files['AGENTS.md#night'], sha256: 'different' };
  await writeFile(join(dir, '.keel/lock.json'), JSON.stringify(raw));
  const before = await read(dir, '.keel/keel.json');
  await assert.rejects(adoptAt(dir), /conflicting guide locks/);
  assert.equal(await read(dir, '.keel/keel.json'), before);
  await assert.rejects(render(dir), /conflicting guide locks/);
  delete raw.files['CLAUDE.md#night'];
  raw.files['other.md#custom'] = { practice: 'acme', sha256: 'unrelated' };
  await writeFile(join(dir, '.keel/lock.json'), JSON.stringify(raw));
  assert.equal((await config(dir)).guide, 'AGENTS.md');
  assert.ok((await readLock(dir)).files['other.md#custom']);
});


test('guide review: physical guide collisions reject before writes and safe directory links survive', async t => {
  const dir = await acme(t);
  await mkdir(join(dir, 'docs'));
  await symlink('docs', join(dir, '.agents'));
  for (const guide of ['docs/skills/keel/SKILL.md', 'docs/skills/keel', 'docs/skills/keel/SKILL.md/child']) {
    await assert.rejects(adoptAt(dir, { guide }), /guide:.*collides/);
    await absent(dir, '.keel');
    await absent(dir, 'docs/skills');
  }
  await adoptAt(dir, { guide: 'docs/team.md' });
  assert.equal((await render(dir, { check: true })).ok, true);
  assert.deepEqual((await diagnose(dir)).drift, []);
  await render(dir);
  assert.ok((await lstat(join(dir, '.agents'))).isSymbolicLink());
  assert.ok((await lstat(join(dir, '.claude/skills/keel'))).isSymbolicLink());
});

test('guide review: root intermediate aliases resolve while invalid links remain rejected', async t => {
  const dir = await acme(t), outside = await acme(t);
  await mkdir(join(dir, 'docs'));
  await symlink('..', join(dir, 'docs/root'));
  await writeFile(join(dir, 'CLAUDE.md'), '# Acme rules\n');
  assert.equal(guideDestination(dir, 'docs/root/CLAUDE.md'), 'CLAUDE.md');
  assert.equal(guideDestination(dir, 'docs/root/new.md'), 'new.md');
  await symlink(outside, join(dir, 'escape'));
  await symlink('cycle', join(dir, 'cycle'));
  await symlink('missing', join(dir, 'dangling'));
  for (const guide of ['docs/root', 'docs/root/escape/file.md', 'docs/root/cycle/file.md', 'docs/root/dangling/file.md']) {
    assert.throws(() => guideDestination(dir, guide), /guide:|ELOOP/);
  }
  await adoptAt(dir, { guide: 'docs/root/CLAUDE.md' });
  assert.equal((await config(dir)).guide, 'docs/root/CLAUDE.md');
  assert.deepEqual((await diagnose(dir)).drift, []);
});

test('guide review: nested init guide links resolve to README and lessons', async t => {
  const dir = await acme(t); await rm(join(dir, 'package.json'));
  await init({ dir, guide: 'docs/team/rules.md', name: 'Acme', description: 'Acme makes anvils.', kind: 'node' }, { version });
  const guide = await read(dir, 'docs/team/rules.md');
  assert.ok(guide.includes('[README.md](../../README.md#how-to-run-it)'));
  assert.ok(guide.includes('[`docs/lessons.md`](../lessons.md)'));
  assert.deepEqual((await diagnose(dir)).drift, []);
});


test('guide review: noncolliding dangling and unsafe practice links retain adoption ownership', async t => {
  for (const link of ['missing', 'conduct', '../../../outside']) {
    const dir = await acme(t);
    await mkdir(join(dir, '.claude/skills'), { recursive: true });
    await symlink(link, join(dir, '.claude/skills/conduct'));
    const result = await adoptAt(dir);
    assert.equal(result.data.practices.find(p => p.name === 'conduct').state, 'off');
    assert.ok((await lstat(join(dir, '.claude/skills/conduct'))).isSymbolicLink());
    assert.equal((await render(dir, { check: true })).ok, true);
    assert.deepEqual((await diagnose(dir)).drift, []);
    await assert.rejects(adoptAt(dir, { guide: '.claude/skills/conduct/rules.md' }), /guide:|ELOOP/);
  }
});

test('guide review: collision lookup follows dangling destinations but leaves unsupported targets to survey', async t => {
  const dir = await acme(t);
  await mkdir(join(dir, '.claude/skills'), { recursive: true });
  await symlink('../../future', join(dir, '.claude/skills/conduct'));
  await assert.rejects(adoptAt(dir, { guide: 'future/rules.md' }), /guide:.*collides/);
  await absent(dir, '.keel');
  await writeFile(join(dir, 'plain'), 'Acme');
  assert.throws(() => guideDestination(dir, 'plain/child'), /guide:/);
});

test('guide review: a target that leaves and re-enters still cannot collide with the guide', async t => {
  const dir = await acme(t), outside = await acme(t);
  await mkdir(join(dir, 'docs'));
  await symlink(join(dir, 'docs'), join(outside, 'skills'));
  await symlink(outside, join(dir, '.agents'));
  await assert.rejects(adoptAt(dir, { guide: 'docs/keel/SKILL.md' }), /guide:.*collides/);
  await absent(dir, '.keel');
});

test('guide review: leading parent components may not leave and re-enter the repository', async t => {
  const dir = await acme(t);
  await mkdir(join(dir, 'docs'));
  await writeFile(join(dir, 'CLAUDE.md'), '# Acme\n');
  await symlink(`../../${basename(dir)}/CLAUDE.md`, join(dir, 'docs/escape.md'));
  await symlink(`../${basename(dir)}/CLAUDE.md`, join(dir, 'escape.md'));
  for (const guide of ['docs/escape.md', 'escape.md']) {
    await assert.rejects(adoptAt(dir, { guide }), /guide:.*leaves the repository/);
    await absent(dir, '.keel');
    assert.equal(await read(dir, 'CLAUDE.md'), '# Acme\n');
  }
  await symlink('../CLAUDE.md', join(dir, 'docs/safe.md'));
  assert.equal(guideDestination(dir, 'docs/safe.md'), 'CLAUDE.md');
});

test('late review: seeded guide encodes rebased lessons destinations', async t => {
  const dir = await acme(t);
  const lessons = "docs/acme lessons (#1)%/lessons.md";
  await mkdir(join(dir, 'docs/acme lessons (#1)%'), { recursive: true });
  await mkdir(join(dir, '.keel'));
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ lessons }));
  await writeFile(join(dir, lessons), '| # | Lesson |\n| --- | --- |\n| 1 | Acme preserves its work. |\n');
  await adoptAt(dir, { guide: 'docs/team/rules.md' });
  const text = await read(dir, 'docs/team/rules.md');
  assert.ok(text.includes('[`' + lessons + '`](../acme%20lessons%20%28%231%29%25/lessons.md)'), text);
  assert.equal(await read(dir, lessons), '| # | Lesson |\n| --- | --- |\n| 1 | Acme preserves its work. |\n');
});

test('late review: adoption report and its aliases are reserved before writes', async t => {
  for (const mode of ['direct', 'guide-alias', 'report-alias', 'parent', 'child']) {
    const dir = await acme(t), pkg = await read(dir, 'package.json');
    await mkdir(join(dir, 'docs'));
    let guide = 'docs/keel-adoption.md';
    const prose = '# Acme human rules\n';
    if (mode === 'parent') guide = 'docs';
    else if (mode === 'child') guide += '/rules.md';
    else if (mode === 'report-alias') {
      guide = 'rules.md';
      await writeFile(join(dir, guide), prose);
      await symlink('../rules.md', join(dir, 'docs/keel-adoption.md'));
    } else {
      await writeFile(join(dir, guide), prose);
      if (mode === 'guide-alias') {
        await symlink('docs/keel-adoption.md', join(dir, 'rules.md'));
        guide = 'rules.md';
      }
    }
    for (const dryRun of [true, false]) {
      await assert.rejects(adoptAt(dir, { guide, dryRun }), /guide:/);
      await absent(dir, '.keel');
      await absent(dir, 'AGENTS.md');
      assert.equal(await read(dir, 'package.json'), pkg);
      if (!['parent', 'child'].includes(mode)) assert.equal(await read(dir, guide), prose);
    }
  }
});

test('late review: guide collision checks follow filesystem case semantics', async t => {
  const dir = await acme(t), pkg = await read(dir, 'package.json');
  const insensitive = await lstat(join(dir, 'PACKAGE.JSON')).then(() => true, () => false);
  // Existing and not-yet-created targets, including ancestor collisions.
  const { validateGuideTargets, load } = await import('../lib/practices.mjs');
  const practices = await load();
  for (const guide of ['Package.json', 'Scripts/ROADMAP.mjs', 'Scripts/ROADMAP.mjs/child', 'RENOVATE.JSON']) {
    if (insensitive) {
      assert.throws(() => validateGuideTargets({ guide }, practices, dir), /guide:.*collides/);
      await assert.rejects(adoptAt(dir, { guide }), /guide:.*collides/);
    } else {
      assert.doesNotThrow(() => validateGuideTargets({ guide }, practices, dir));
    }
    await absent(dir, '.keel');
    assert.equal(await read(dir, 'package.json'), pkg);
  }
});

test('late review: invalid guide usage returns CLI status 2 without writes', async t => {
  const { main } = await import('../lib/cli.mjs');
  for (const verb of ['init', 'adopt']) for (const guide of ['', '/tmp/acme.md', '../acme.md', '.git/config', '.keel/lock.json']) {
    const dir = await acme(t);
    if (verb === 'init') await rm(join(dir, 'package.json'));
    let output = '';
    const args = [verb, dir, '--guide', guide, '--json', ...(verb === 'init' ? ['--description', 'Acme makes anvils.'] : [])];
    assert.equal(await main(args, { out: s => { output += s; }, err: s => assert.fail(s) }), 2, `${verb}: ${guide}`);
    assert.match(JSON.parse(output).error, /guide/);
    await absent(dir, '.git'); await absent(dir, '.keel');
  }
});

test('late review: Windows native symlink traversal is checked before resolution', async t => {
  const dir = await acme(t);
  await mkdir(join(dir, 'acme/docs'), { recursive: true });
  await writeFile(join(dir, 'acme/CLAUDE.md'), '# Acme\n');
  await symlink('..\\..\\acme\\CLAUDE.md', join(dir, 'acme/docs/escape.md'));
  await symlink('..\\CLAUDE.md', join(dir, 'acme/docs/safe.md'));
  await symlink('child\\..\\CLAUDE.md', join(dir, 'acme/docs/traverse.md'));
  // Run the real resolver using Node's win32 path implementation and real
  // symlink bytes. Only filesystem drive mapping is adapted for this host.
  const script = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import path from 'node:path';
    import { registerHooks } from 'node:module';
    const host = ${JSON.stringify(dir)}, w = path.win32;
    const mapped = p => path.join(host, w.relative('C:\\\\', p).split(w.sep).join('/'));
    globalThis.guideWindowsPath = w;
    globalThis.guideWindowsFs = {
      ...fs,
      lstatSync: p => fs.lstatSync(mapped(p)),
      readlinkSync: p => fs.readlinkSync(mapped(p)),
      readdirSync: p => fs.readdirSync(mapped(p)),
      realpathSync: p => w.resolve('C:\\\\', path.relative(fs.realpathSync(host), fs.realpathSync(mapped(p))).split(path.sep).join(w.sep)),
    };
    registerHooks({ resolve(specifier, context, next) {
      if (context.parentURL === ${JSON.stringify(new URL('../lib/guide.mjs', import.meta.url).href)} && ['node:fs', 'node:path'].includes(specifier)) {
        const source = specifier === 'node:path'
          ? 'export const { resolve, relative, dirname, basename, isAbsolute, sep } = globalThis.guideWindowsPath;'
          : 'export const { lstatSync, readlinkSync, realpathSync, readFileSync, readdirSync } = globalThis.guideWindowsFs;';
        return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true };
      }
      return next(specifier, context);
    }});
    const { guideDestination } = await import(${JSON.stringify(new URL('../lib/guide.mjs', import.meta.url).href)});
    assert.equal(guideDestination('C:/acme', 'docs/safe.md'), 'CLAUDE.md');
    assert.throws(() => guideDestination('C:/acme', 'docs/escape.md'), /leaves the repository/);
    assert.throws(() => guideDestination('C:/acme', 'docs/traverse.md'), /unsafe symlink traversal/);
  `;
  const result = run(process.execPath, ['--input-type=module', '-e', script]);
  assert.equal(result.status, 0, result.stderr);
});

test('late review: init rejects case collisions before creating an absent root', async t => {
  const parent = await acme(t);
  const insensitive = await lstat(join(parent, 'PACKAGE.JSON')).then(() => true, () => false);
  if (!insensitive) return t.skip('requires a case-insensitive filesystem');
  for (const existing of [true, false]) for (const guide of ['Package.json', 'Readme.md', 'DOCS/roadmap.md', 'Scripts/ROADMAP.mjs']) {
    const dir = join(parent, 'new-acme');
    if (existing) await mkdir(dir);
    await assert.rejects(init({ dir, guide, description: 'Acme makes anvils.' }, { version }), /guide:.*collides/);
    await absent(dir, '.git'); await absent(dir, '.keel');
    if (existing) await rm(dir, { recursive: true });
    else await absent(parent, 'new-acme');
  }
});

test('late review: hardlinked practice targets cannot become guides', async t => {
  const dir = await acme(t), pkg = await read(dir, 'package.json');
  await link(join(dir, 'package.json'), join(dir, 'rules.md'));
  await assert.rejects(adoptAt(dir, { guide: 'rules.md' }), /guide:.*collides/);
  assert.equal(await read(dir, 'package.json'), pkg);
  await absent(dir, '.keel');
});

test('late review: guide locks retain identity across filesystem case aliases', async t => {
  const dir = await acme(t);
  const insensitive = await lstat(join(dir, 'PACKAGE.JSON')).then(() => true, () => false);
  if (!insensitive) return t.skip('requires a case-insensitive filesystem');
  await adoptAt(dir);
  const cfg = JSON.parse(await read(dir, '.keel/keel.json'));
  cfg.guide = 'agents.md';
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify(cfg));
  assert.equal((await render(dir, { check: true })).ok, true);
  assert.deepEqual((await diagnose(dir)).drift, []);
  assert.ok((await readLock(dir)).files['AGENTS.md#night']);
  const text = await read(dir, 'AGENTS.md');
  await writeFile(join(dir, 'AGENTS.md'), text.replace('**A hygiene note is work.**', '**Acme keeps this edit.**'));
  await assert.rejects(render(dir), /refusing to overwrite/);
});

test('late review: metadata case aliases cannot select existing config or git pointers', async t => {
  const dir = await acme(t);
  const insensitive = await lstat(join(dir, 'PACKAGE.JSON')).then(() => true, () => false);
  if (!insensitive) return t.skip('requires a case-insensitive filesystem');
  await mkdir(join(dir, '.git'));
  await mkdir(join(dir, '.keel'));
  const cfg = '{}\n', git = '[core]\n\trepositoryformatversion = 0\n';
  await writeFile(join(dir, '.git/config'), git);
  await writeFile(join(dir, '.keel/keel.json'), cfg);
  for (const guide of ['.GIT/config', '.KEEL/keel.json', '.KeEl/lock.json']) {
    assert.throws(() => guideDestination(dir, guide), /reserved repository metadata/);
    await assert.rejects(adoptAt(dir, { guide }), /reserved repository metadata/);
    assert.equal(await read(dir, '.git/config'), git);
    assert.equal(await read(dir, '.keel/keel.json'), cfg);
    await absent(dir, '.keel/lock.json');
  }
  await rm(join(dir, '.git'), { recursive: true });
  await writeFile(join(dir, '.git'), 'gitdir: acme-worktree\n');
  await symlink('.GIT', join(dir, 'rules.md'));
  for (const guide of ['.GIT', 'rules.md']) assert.throws(() => guideDestination(dir, guide), /reserved repository metadata/);
  assert.equal(await read(dir, '.git'), 'gitdir: acme-worktree\n');
});

test('late review: absent metadata case aliases are reserved before init writes', async t => {
  const parent = await acme(t);
  const insensitive = await lstat(join(parent, 'PACKAGE.JSON')).then(() => true, () => false);
  if (!insensitive) return t.skip('requires a case-insensitive filesystem');
  for (const existing of [true, false]) for (const guide of ['.GIT/config', '.KEEL/keel.json', '.KeEl/lock.json', 'docs/.GIT/config']) {
    const dir = join(parent, 'new-acme');
    if (existing) await mkdir(dir);
    await assert.rejects(init({ dir, guide, description: 'Acme makes anvils.' }, { version }), /reserved repository metadata/);
    await absent(dir, '.git'); await absent(dir, '.keel'); await absent(dir, 'docs');
    if (existing) await rm(dir, { recursive: true });
    else await absent(parent, 'new-acme');
  }
  for (const guide of ['.GIT/config', '.KEEL/keel.json']) {
    await assert.rejects(adoptAt(parent, { guide }), /reserved repository metadata/);
    await absent(parent, '.git'); await absent(parent, '.keel');
  }
});

test('PR107: collision probes use each directory entry policy and preserve unknown safety', () => {
  // Synthetic per-directory Windows lookup, not a native Windows walk. This
  // generic filesystem resolves every component using its containing directory's
  // flag; it can represent combinations the host filesystem cannot create.
  const script = `
    import assert from 'node:assert/strict';
    import { win32 as w } from 'node:path';
    import { registerHooks } from 'node:module';
    let serial = 0, root;
    const directory = (sensitive, entries = {}) => ({ sensitive, entries, ino: ++serial });
    const file = (ino = ++serial) => ({ ino });
    function lookup(path) {
      let node = root;
      for (const part of w.resolve(path).slice(3).split(w.sep).filter(Boolean)) {
        if (!node.entries) throw Object.assign(new Error('not a directory'), { code: 'ENOTDIR' });
        const name = Object.keys(node.entries).find(name => name === part)
          ?? (!node.sensitive && Object.keys(node.entries).find(name => name.toLowerCase() === part.toLowerCase()));
        if (!name) throw Object.assign(new Error('missing ' + path), { code: 'ENOENT' });
        node = node.entries[name];
      }
      return node;
    }
    globalThis.casePaths = w;
    globalThis.caseFs = {
      readdirSync(path) {
        const node = lookup(path);
        if (!node.entries) throw Object.assign(new Error('not a directory'), { code: 'ENOTDIR' });
        return Object.keys(node.entries);
      },
      lstatSync(path) {
        const node = lookup(path);
        return { dev: 1, ino: node.ino, isFile: () => !node.entries, isDirectory: () => !!node.entries, isSymbolicLink: () => false };
      },
      realpathSync: path => { lookup(path); return w.resolve(path); },
      readlinkSync() { throw new Error('fixture has no symlinks'); },
      readFileSync() { throw new Error('unexpected content read'); },
    };
    registerHooks({ resolve(specifier, context, next) {
      if (context.parentURL === ${JSON.stringify(new URL('../lib/guide.mjs', import.meta.url).href)} && ['node:fs', 'node:path'].includes(specifier)) {
        const source = specifier === 'node:path'
          ? 'export const { resolve, relative, dirname, basename, isAbsolute, sep } = globalThis.casePaths;'
          : 'export const { lstatSync, readlinkSync, realpathSync, readFileSync, readdirSync } = globalThis.caseFs;';
        return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true };
      }
      return next(specifier, context);
    }});
    const { guideTargetsOverlap: overlap, validateGuideName } = await import(${JSON.stringify(new URL('../lib/guide.mjs', import.meta.url).href)});
    for (const parentSensitive of [true, false]) for (const sensitive of [true, false]) {
      root = directory(parentSensitive, { Acme: directory(sensitive, { 'package.json': file() }) });
      assert.equal(overlap('C:/Acme', 'Package.json', 'package.json'), !sensitive, 'existing file uses repository policy');
      assert.equal(overlap('C:/Acme', 'Rules.md', 'rules.md'), !sensitive, 'absent file uses repository policy');
      if (sensitive) assert.doesNotThrow(() => validateGuideName('.KEEL/config', 'C:/Acme'));
      else assert.throws(() => validateGuideName('.KEEL/config', 'C:/Acme'), /reserved/);
    }
    root = directory(false, { Acme: directory(true, {
      'package.json': file(),
      Docs: directory(false, { 'notes.md': file() }),
      docs: directory(false, { 'notes.md': file() }),
      Strict: directory(true, { 'notes.md': file() }),
      Empty: directory(true),
      Numeric: directory(true, { '123': file() }),
    }) });
    assert.equal(overlap('C:/Acme', 'Docs/Rules.md', 'docs/rules.md'), false, 'insensitive children must not fold distinct parent entries');
    assert.equal(overlap('C:/Acme', 'Docs/Rules.md', 'Docs/rules.md'), true, 'child policy differs from parent');
    assert.equal(overlap('C:/Acme', 'Strict/Rules.md', 'Strict/rules.md'), false, 'known sensitive child preserves valid variants');
    assert.equal(overlap('C:/Acme', 'Docs/Rules.md/child', 'Docs/rules.md'), true, 'ancestor collision');
    for (const folder of ['Empty', 'Numeric', 'Absent']) {
      assert.equal(overlap('C:/Acme', folder + '/Rules.md', folder + '/rules.md'), true, folder + ' remains unknown');
      assert.equal(overlap('C:/Acme', folder + '/guide.md', folder + '/other.md'), false, 'unknown only reserves case collisions');
      assert.throws(() => validateGuideName(folder + '/.KEEL/config', 'C:/Acme'), /reserved/);
    }
    const hardlink = file();
    root.entries.Acme.entries.Twins = directory(true, { Notes: hardlink, notes: hardlink });
    assert.equal(overlap('C:/Acme', 'Twins/Rules.md', 'Twins/rules.md'), false, 'two stored spellings establish sensitivity even for hardlinks');
  `;
  const result = run(process.execPath, ['--input-type=module', '-e', script]);
  assert.equal(result.status, 0, result.stderr);
});

// keel#120: an execute-only directory can be entered by name and not listed. Root lists it anyway, and Windows has no such mode.
test('a directory that cannot be listed is unknown case behaviour: case-only variants are reserved, and nothing aborts', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'keel-guide-'));
  const locked = join(dir, 'locked');
  try {
    await mkdir(locked);
    await writeFile(join(locked, 'guide.md'), 'x');
    await chmod(locked, 0o111);
    assert.equal(guideTargetsOverlap(dir, 'locked/Rules.md', 'locked/rules.md'), true, 'case-only variants are reserved');
    assert.equal(guideTargetsOverlap(dir, 'locked/guide.md', 'locked/other.md'), false, 'unknown only reserves case collisions');
  } finally {
    await chmod(locked, 0o755).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});
