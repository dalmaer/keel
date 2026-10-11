import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { adopt } from '../lib/adopt.mjs';
import { render, config, practiceVersion } from '../lib/practices.mjs';
import { diagnose, doctor } from '../lib/doctor.mjs';
import { guideDestination } from '../lib/guide.mjs';
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
