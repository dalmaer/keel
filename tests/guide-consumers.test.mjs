import { test } from 'node:test';
import assert from 'node:assert/strict';
import { symlink, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acme, commit, git } from './helpers/climb.mjs';
import * as practices from '../lib/practices.mjs';
import * as roadmap from '../practices/phases/files/scripts/roadmap.mjs';

test('guide consumers: roadmap escapes every URL segment and preserves default bytes', () => {
  const config = { name: 'Acme', tagline: 'Working together.' };
  const render = guide => roadmap.render({ config: { ...config, ...(guide ? { guide } : {}) }, phases: [], goals: [] });
  assert.equal(render(), render('AGENTS.md'));
  const encoded = 'team%20%28Acme%29/rules%20%28v2%29%25%3F.md';
  assert.equal(render('team (Acme)/rules (v2)%?.md'), render().replace('../AGENTS.md', `../${encoded}`));
});

test('guide consumers: hidden managed briefs and skills render the selected guide', async () => {
  const all = await practices.load();
  for (const guide of ['CLAUDE.md', 'WORKING.md', 'team (Acme)/rules.md']) {
    for (const [name, path] of [['conduct', '.agents/skills/conduct/SKILL.md'], ['cross-review', '.agents/cross-review/REVIEW.md'], ['climb', '.agents/climb/PROTOCOL.md'], ['climb', '.agents/climb/TEND.md'], ['claude', '.github/workflows/claude.yml']]) {
      const f = all.get(name).files.find(f => f.path === path);
      const text = practices.fill(f.template, { name: 'Acme', repo: 'acme/acme', tagline: 'Acme', guide }, path);
      assert.ok(text.includes(guide), path);
      assert.doesNotMatch(text, /AGENTS\.md|\{\{guide\}\}/, path);
    }
  }
});

test('guide consumers: Claude invocation loads the configured guide without changing mention mode', async () => {
  const all = await practices.load();
  const f = all.get('claude').files.find(f => f.path === '.github/workflows/claude.yml');
  const text = practices.fill(f.template, { name: 'Acme', repo: 'acme/acme', guide: 'WORKING.md' }, f.path);
  const args = text.split('claude_args: |')[1];
  assert.match(args, /--append-system-prompt "Before working, read \.keel\/keel\.json\. If it names a guide, read and follow that file\./);
  assert.match(args, /--allowedTools/);
  assert.doesNotMatch(text, /^\s+prompt(?:_file)?:/m, 'a direct prompt would switch the mention workflow into automation mode');
});

test('guide consumers: standalone tend accepts the trusted canonical guide and denies candidate grants', async t => {
  const dir = await acme(t, { config: { guide: 'WORKING.md' }, files: { 'WORKING.md': '# Acme\n', 'OTHER.md': '# Other\n' } });
  const m = await import(pathToFileURL(join(dir, 'scripts/keel/tend.mjs')).href);
  assert.equal(m.tendSurface('.github/README.md'), true, 'legacy README surface; sandbox still prohibits workflows');
  assert.equal(m.tendSurface('docs/.hidden.md'), true, 'legacy docs surface');
  let base = git(dir, ['rev-parse', 'HEAD']);
  let head = await commit(dir, { 'WORKING.md': '# Acme rules\n' }, 'Acme\n\nTend: acme');
  assert.deepEqual(m.tendCheck(dir, base, head).refused, []);
  base = head;
  head = await commit(dir, { '.keel/keel.json': JSON.stringify({ guide: 'OTHER.md' }), 'OTHER.md': '# New rules\n' }, 'Acme\n\nTend: acme');
  assert.ok(m.tendCheck(dir, base, head).refused.some(s => s.startsWith('OTHER.md: outside')));
  assert.ok(m.sandboxProblems(dir, base, head).some(s => s.startsWith('.keel/keel.json:')));
});

test('guide consumers: tend resolves base aliases, including directories, without trusting candidate links', async t => {
  const dir = await acme(t, { config: { guide: 'aliases/CLAUDE.md' }, files: { 'rules/WORKING.md': '# Acme\n', 'OTHER.md': '# Other\n' } });
  await mkdir(join(dir, 'aliases'));
  await symlink('../rules/WORKING.md', join(dir, 'aliases/CLAUDE.md'));
  git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'Acme alias']);
  const m = await import(pathToFileURL(join(dir, 'scripts/keel/tend.mjs')).href);
  let base = git(dir, ['rev-parse', 'HEAD']);
  let head = await commit(dir, { 'rules/WORKING.md': '# Updated\n' }, 'Acme\n\nTend: acme');
  assert.deepEqual(m.tendCheck(dir, base, head).refused, []);
  base = head;
  await rm(join(dir, 'aliases/CLAUDE.md')); await symlink('../OTHER.md', join(dir, 'aliases/CLAUDE.md'));
  head = await commit(dir, { 'OTHER.md': '# Candidate\n' }, 'Acme\n\nTend: acme');
  assert.ok(m.tendCheck(dir, base, head).refused.some(s => s.startsWith('OTHER.md: outside')));
  await symlink('rules', join(dir, 'guide-dir'));
  base = await commit(dir, { '.keel/keel.json': JSON.stringify({ guide: 'guide-dir/WORKING.md' }) }, 'Acme base');
  head = await commit(dir, { 'rules/WORKING.md': '# Directory alias\n' }, 'Acme\n\nTend: acme');
  assert.deepEqual(m.tendCheck(dir, base, head).refused, []);
});

test('guide consumers: configured guide cannot authorize evidence, secrets or control paths', async t => {
  for (const path of ['docs/evidence/acme.md', '.env', 'secrets.md', '.git/config', '.keel/keel.json', '.github/WORKING.md', 'scripts/keel/WORKING.md', '../WORKING.md']) {
    const dir = await acme(t, { config: { guide: path } });
    const m = await import(pathToFileURL(join(dir, 'scripts/keel/tend.mjs')).href);
    assert.equal(m.tendSurface(path, path), false, path);
    if (path === '.git/config' || path.startsWith('../')) continue;
    const base = git(dir, ['rev-parse', 'HEAD']);
    const head = await commit(dir, { [path]: '# Forbidden\n' }, 'Acme\n\nTend: acme');
    assert.ok(m.tendCheck(dir, base, head).refused.length, path);
  }
});

test('guide consumers: tend refuses escaping and cyclic aliases and a canonical guide replaced by a link', async t => {
  for (const target of ['../WORKING.md', '/tmp/WORKING.md', 'CLAUDE.md', 'missing/../WORKING.md', '.keel/../WORKING.md']) {
    const dir = await acme(t, { config: { guide: 'CLAUDE.md' }, files: { 'WORKING.md': '# Acme\n' } });
    await symlink(target, join(dir, 'CLAUDE.md'));
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'Acme base']);
    const m = await import(pathToFileURL(join(dir, 'scripts/keel/tend.mjs')).href);
    const base = git(dir, ['rev-parse', 'HEAD']);
    const head = await commit(dir, { 'WORKING.md': '# Changed\n' }, 'Acme\n\nTend: acme');
    assert.ok(m.tendCheck(dir, base, head).refused.some(s => s.startsWith('WORKING.md: outside')), target);
  }
  const dir = await acme(t, { config: { guide: 'WORKING.md' }, files: { 'WORKING.md': '# Acme\n' } });
  const m = await import(pathToFileURL(join(dir, 'scripts/keel/tend.mjs')).href);
  const base = git(dir, ['rev-parse', 'HEAD']);
  await rm(join(dir, 'WORKING.md')); await symlink('/tmp/Acme.md', join(dir, 'WORKING.md'));
  git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'Acme\n\nTend: acme']);
  assert.ok(m.tendCheck(dir, base, 'HEAD').refused.some(s => s.includes('must remain a regular file')));
});

test('guide consumers: tend accepts hidden guides without granting protected hidden paths', async t => {
  for (const guide of ['.cursorrules', '.guides/WORKING.md']) {
    const dir = await acme(t, { config: { guide }, files: { [guide]: '# Acme\n' } });
    const m = await import(pathToFileURL(join(dir, 'scripts/keel/tend.mjs')).href);
    const base = git(dir, ['rev-parse', 'HEAD']);
    const head = await commit(dir, { [guide]: '# Acme updated\n' }, 'Acme\n\nTend: acme');
    assert.deepEqual(m.tendCheck(dir, base, head).refused, []);
    for (const path of ['.env.local', '.aws/credentials', '.claude/settings.json', '.codex/config.toml', '.git/config', '.keel/keel.json']) {
      assert.equal(m.tendSurface(path, path), false, path);
    }
  }
});

test('guide consumers: tend accepts a safe intermediate alias to the repository root', async t => {
  const dir = await acme(t, { config: { guide: 'docs/root/WORKING.md' }, files: { 'WORKING.md': '# Acme\n' } });
  await mkdir(join(dir, 'docs'), { recursive: true });
  await symlink('..', join(dir, 'docs/root'));
  git(dir, ['add', 'docs/root']); git(dir, ['commit', '-qm', 'Acme root alias']);
  const m = await import(pathToFileURL(join(dir, 'scripts/keel/tend.mjs')).href);
  const base = git(dir, ['rev-parse', 'HEAD']);
  const head = await commit(dir, { 'WORKING.md': '# Acme updated\n' }, 'Acme\n\nTend: acme');
  assert.deepEqual(m.tendCheck(dir, base, head).refused, []);
});
