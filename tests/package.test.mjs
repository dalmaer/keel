// keel as npm delivers it: `npx -y github:dalmaer/keel` packs the repo, and
// npm drops some files on the way (every .gitignore among them). A local
// checkout has them all, so only a test that runs keel from the packed copy
// sees what a person running it through npx gets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, testsRan } from './helpers/run.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Nothing reaching the network, and a git identity for init's commit.
const ENV = {
  ...process.env,
  npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false',
  GIT_AUTHOR_NAME: 'Acme Builder', GIT_AUTHOR_EMAIL: 'builder@acme.test',
  GIT_COMMITTER_NAME: 'Acme Builder', GIT_COMMITTER_EMAIL: 'builder@acme.test',
  GIT_CONFIG_NOSYSTEM: '1',
};

const exists = p => stat(p).then(() => true, () => false);

test('keel run from its packed tarball inits a project that passes its own check', async t => {
  const tmp = await realpath(await mkdtemp(join(tmpdir(), 'keel-pack-')));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const env = { ...ENV, npm_config_cache: join(tmp, 'npm-cache') };

  // Expectations come from the checkout: a practice omitted wholesale from
  // the tarball must not disappear from both the check and its expectation.
  const expected = [];
  let optionalPractice;
  for (const entry of await readdir(join(KEEL, 'practices'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = `practices/${entry.name}/practice.json`;
    const spec = JSON.parse(await readFile(join(KEEL, manifest), 'utf8'));
    expected.push(manifest);
    for (const f of spec.files ?? []) if (f.from) expected.push(`practices/${entry.name}/files/${f.from}`);
    if (spec.optional && !optionalPractice) optionalPractice = `practices/${entry.name}/`;
  }
  expected.sort();
  assert.ok(expected.length > 0 && optionalPractice, 'checkout has manifests and an optional practice to probe');

  const pack = run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', tmp], { cwd: KEEL, env });
  assert.equal(pack.status, 0, `npm pack failed:\n${pack.stderr}`);
  const [{ filename }] = JSON.parse(pack.stdout);
  execFileSync('tar', ['xzf', join(tmp, filename), '-C', tmp]);
  const pkg = join(tmp, 'package');

  // Observe the unpacked files, without using packed manifests as the oracle.
  const present = new Set((await Promise.all(expected.map(async path => await exists(join(pkg, path)) ? path : null))).filter(Boolean));
  const missing = files => expected.filter(path => !files.has(path));
  assert.deepEqual(missing(present), [], 'manifests or templates npm left out of the package');

  // Negative controls reuse this pack's inventory; no extra pack or mutation
  // of the package needed by init below. Missing a whole optional practice
  // and missing one template must each produce the exact absent paths.
  const omittedPractice = expected.filter(path => path.startsWith(optionalPractice));
  const withoutPractice = new Set([...present].filter(path => !path.startsWith(optionalPractice)));
  assert.ok(omittedPractice.includes(`${optionalPractice}practice.json`) && omittedPractice.length > 1);
  assert.equal(present.size - withoutPractice.size, omittedPractice.length);
  assert.deepEqual(missing(withoutPractice), omittedPractice, 'an omitted optional practice is rejected');
  const template = expected.find(path => path.startsWith(optionalPractice) && path.includes('/files/'));
  const withoutTemplate = new Set(present);
  assert.equal(withoutTemplate.delete(template), true, 'the template removal must apply');
  assert.deepEqual(missing(withoutTemplate), [template], 'an omitted individual template is rejected');

  // The tests and their fixtures stay home; only what keel runs on ships.
  assert.ok(!(await exists(join(pkg, 'tests', 'init.test.mjs'))), 'the test suite is not in the package');

  const init = run(process.execPath, [join(pkg, 'bin', 'keel.mjs'), 'init', join(tmp, 'acme'), '--description', 'Acme. A probe.', '--kind', 'node'], { cwd: tmp, env });
  assert.equal(init.status, 0, `init from the packed keel failed:\n${init.stdout}${init.stderr}`);
  assert.ok(await exists(join(tmp, 'acme', '.gitignore')), 'the new project has its .gitignore');

  // The stack view's source is keel's catalogue as the package carries it (lesson 28).
  assert.equal(await readFile(join(pkg, 'docs', 'lessons.md'), 'utf8'), await readFile(join(KEEL, 'docs', 'lessons.md'), 'utf8'), 'the catalogue ships');
  const acmeConfig = JSON.parse(await readFile(join(tmp, 'acme', '.keel', 'keel.json'), 'utf8'));
  assert.deepEqual(acmeConfig.stack, ['node', 'github-actions'], 'init records the stack its files show');
  const { viewRows } = await import('../lib/stacks.mjs');
  const { parseLessons } = await import('../lib/lessons.mjs');
  const view = parseLessons(await readFile(join(tmp, 'acme', 'docs', 'keel-lessons.md'), 'utf8')).rows.map(r => r.n);
  assert.ok(view.length > 0, 'the new project reads keel\'s lessons');
  assert.deepEqual(view, viewRows(await readFile(join(KEEL, 'docs', 'lessons.md'), 'utf8'), acmeConfig.stack).rows.map(r => r.n));

  const check = run('npm', ['run', 'check'], { cwd: join(tmp, 'acme'), env });
  assert.equal(check.status, 0, `the new project's check failed:\n${check.stdout}${check.stderr}`);
  assert.ok(testsRan(check.stdout + check.stderr) > 0, `the gate ran no tests:\n${check.stdout}${check.stderr}`);
});
