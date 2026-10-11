// keel's generated-file check (keel practice `phases`; managed: keel render
// rewrites it). Each file this project's practices declare generated is
// rewritten whole by its generator: a line appended to it does not survive
// (keel's lesson 52). The list and the probe are scripts/keel/generated.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENERATORS, generatedFiles, survivors, projectConfig } from '../scripts/keel/generated.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('each generated file is rewritten whole by its generator: a line appended to it does not survive', async t => {
  const config = await projectConfig(ROOT);
  const list = generatedFiles(config);
  const localPlan = config.practices?.includes('phases') && config.phases?.source !== 'milestones';
  assert.equal(list.some(g => g.path === 'docs/ROADMAP.md'), !!localPlan, 'only an active local plan declares docs/ROADMAP.md generated');
  if (config.phases?.source === 'milestones') t.diagnostic('Local roadmap generator inactive: milestones selected; archived plan is not probed.');
  assert.deepEqual(await survivors(ROOT, list), []);
});

test('the check can fail: a generator that appends instead of rewriting is named; one that rewrites is not', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'keel-generated-acme-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'docs'), { recursive: true });
  await writeFile(join(dir, 'docs', 'ACME.md'), '# Acme\n');
  await writeFile(join(dir, 'appends.mjs'), "import { appendFileSync } from 'node:fs';\nappendFileSync('docs/ACME.md', '- one more anvil\\n');\n");
  await writeFile(join(dir, 'rewrites.mjs'), "import { writeFileSync } from 'node:fs';\nwriteFileSync('docs/ACME.md', '# Acme\\n');\n");
  const appends = await survivors(dir, [{ path: 'docs/ACME.md', args: ['appends.mjs'] }]);
  assert.equal(appends.length, 1);
  assert.match(appends[0], /^docs\/ACME\.md: a line appended to it survived `node appends\.mjs`/);
  assert.deepEqual(await survivors(dir, [{ path: 'docs/ACME.md', args: ['rewrites.mjs'] }]), []);
  const broken = await survivors(dir, [{ path: 'docs/ACME.md', args: ['missing.mjs'] }]);
  assert.match(broken[0] ?? '', /its generator `node missing\.mjs` failed/);
});

test('the list: each practice\'s files only when it is on; keel\'s own files only on keel', () => {
  const paths = config => generatedFiles(config).map(g => g.path);
  assert.deepEqual(paths({ practices: ['phases'] }), ['docs/ROADMAP.md']);
  assert.deepEqual(paths({ practices: ['phases', 'loop', 'lessons'] }), ['docs/ROADMAP.md', 'docs/LOOP.md']);
  assert.deepEqual(paths({ practices: ['phases', 'loop', 'lessons'], phases: { source: 'milestones' } }), ['docs/LOOP.md']);
  assert.deepEqual(paths({ practices: ['phases', 'lessons'], keel: 'self' }), ['docs/ROADMAP.md', 'docs/keel-lessons.md', 'docs/patterns.md', 'docs/INBOX.md']);
  assert.ok(GENERATORS.every(g => Object.isFrozen(g) && g.path && g.args.length));
});

test('generated probes exclude rotating ledgers at every project depth and retain source inputs', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'keel-generated-acme-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const base of ['', 'tests/fixtures/acme']) {
    await mkdir(join(dir, base, '.keel', 'test-runs'), { recursive: true });
    await writeFile(join(dir, base, '.keel', 'test-runs', 'acme.json'), '{}');
    await writeFile(join(dir, base, '.keel', 'keel.json'), '{}');
  }
  await mkdir(join(dir, 'test-runs'), { recursive: true });
  await writeFile(join(dir, 'test-runs', 'source.json'), '{}');
  await mkdir(join(dir, 'docs'), { recursive: true });
  await writeFile(join(dir, 'docs', 'ACME.md'), '# Acme\n');
  await writeFile(join(dir, 'rewrites.mjs'), `
    import assert from 'node:assert/strict';
    import { existsSync, readFileSync, writeFileSync } from 'node:fs';
    for (const base of ['', 'tests/fixtures/acme/']) {
      assert.equal(existsSync(base + '.keel/test-runs'), false);
      assert.equal(readFileSync(base + '.keel/keel.json', 'utf8'), '{}');
    }
    assert.equal(readFileSync('test-runs/source.json', 'utf8'), '{}');
    writeFileSync('docs/ACME.md', '# Acme');
  `);
  assert.deepEqual(await survivors(dir, [{ path: 'docs/ACME.md', args: ['rewrites.mjs'] }]), []);
});
