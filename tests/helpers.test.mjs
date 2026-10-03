// The guard on tests/helpers/run.mjs: a spawned gate must be able to fail, and
// no test may spawn node or npm around the helper (the NODE_TEST_CONTEXT leak).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, testsRan } from './helpers/run.mjs';

const TESTS = dirname(fileURLToPath(import.meta.url));

test('through the helper, a project whose one test throws fails, and one that passes reports its test', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'keel-helpers-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.ok(process.env.NODE_TEST_CONTEXT, 'this file runs under node --test, so the leak would be live');
  await writeFile(join(dir, 'package.json'), '{ "type": "module", "scripts": { "test": "node --test acme.test.mjs" } }\n');
  await writeFile(join(dir, 'acme.test.mjs'), "import { test } from 'node:test';\ntest('acme throws', () => { throw new Error('acme'); });\n");
  for (const r of [run(process.execPath, ['--test', 'acme.test.mjs'], { cwd: dir }), run('npm', ['test'], { cwd: dir })]) {
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /acme throws/);
  }
  await writeFile(join(dir, 'acme.test.mjs'), "import { test } from 'node:test';\ntest('acme holds', () => {});\n");
  const ok = run('npm', ['test'], { cwd: dir });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(testsRan(ok.stdout + ok.stderr), 1);
});

test('no test spawns node or npm except through the helper', async () => {
  const files = (await readdir(TESTS)).filter(n => n.endsWith('.test.mjs'));
  const offenders = [];
  for (const f of files) {
    const text = await readFile(join(TESTS, f), 'utf8');
    // Any direct child_process spawn of node (process.execPath) or npm, or any spawnSync/spawn at all.
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (/\bspawn(Sync)?\s*\(/.test(line)) offenders.push(`${f}:${i + 1} ${line.trim()}`);
      if (/\bexecFile(Sync)?\s*\(\s*(process\.execPath|['"](npm|node|npx)['"])/.test(line)) offenders.push(`${f}:${i + 1} ${line.trim()}`);
      if (/\bexec(Sync)?\s*\(\s*['"`](npm|node|npx)\b/.test(line)) offenders.push(`${f}:${i + 1} ${line.trim()}`);
    });
    if (/from 'node:child_process'/.test(text) && /\b(spawn|spawnSync|exec|execSync|fork)\b[^;]*from 'node:child_process'/.test(text)) {
      offenders.push(`${f}: imports spawn/exec/fork from node:child_process`);
    }
  }
  assert.deepEqual(offenders, [], 'spawn node and npm with tests/helpers/run.mjs');
});
