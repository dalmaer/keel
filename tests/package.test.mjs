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

  const pack = run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', tmp], { cwd: KEEL, env: ENV });
  assert.equal(pack.status, 0, `npm pack failed:\n${pack.stderr}`);
  const [{ filename }] = JSON.parse(pack.stdout);
  execFileSync('tar', ['xzf', join(tmp, filename), '-C', tmp]);
  const pkg = join(tmp, 'package');

  // Every template a practice names reached the package.
  const practices = join(pkg, 'practices');
  const missing = [];
  for (const name of await readdir(practices)) {
    const manifest = join(practices, name, 'practice.json');
    if (!(await exists(manifest))) continue;
    for (const f of JSON.parse(await readFile(manifest, 'utf8')).files ?? []) {
      if (f.from && !(await exists(join(practices, name, 'files', f.from)))) missing.push(`${name}: files/${f.from}`);
    }
  }
  assert.deepEqual(missing, [], 'templates npm left out of the package');

  // The tests and their fixtures stay home; only what keel runs on ships.
  assert.ok(!(await exists(join(pkg, 'tests', 'init.test.mjs'))), 'the test suite is not in the package');

  const init = run(process.execPath, [join(pkg, 'bin', 'keel.mjs'), 'init', join(tmp, 'acme'), '--description', 'Acme. A probe.', '--kind', 'node'], { cwd: tmp, env: ENV });
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

  const check = run('npm', ['run', 'check'], { cwd: join(tmp, 'acme'), env: ENV });
  assert.equal(check.status, 0, `the new project's check failed:\n${check.stdout}${check.stderr}`);
  assert.ok(testsRan(check.stdout + check.stderr) > 0, `the gate ran no tests:\n${check.stdout}${check.stderr}`);
});
